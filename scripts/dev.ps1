#!/usr/bin/env pwsh
#
# DevDigest local bootstrap -- bring the whole stack up from zero.
#
#   .\scripts\dev.ps1              # full: docker -> migrate -> seed -> server + client
#   .\scripts\dev.ps1 -NoSeed      # skip the demo seed
#   .\scripts\dev.ps1 -NoClient    # run only Postgres + API (no Next.js)
#   .\scripts\dev.ps1 -DbOnly      # just Postgres + migrate + seed, then exit
#
# Idempotent: re-running installs only what's missing, migrations and seed
# both upsert. Ctrl-C stops the dev servers and leaves Postgres running.

[CmdletBinding()]
param(
  [switch]$NoSeed,
  [switch]$NoClient,
  [switch]$DbOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# Expected failures (no docker, failed install) should read as one clear line,
# not a PowerShell stack trace. Unexpected ones still surface in full via -Debug.
trap {
  Write-Host "x $($_.Exception.Message)" -ForegroundColor Red
  if ($DebugPreference -ne 'SilentlyContinue') { Write-Host $_.ScriptStackTrace }
  exit 1
}

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$Container = 'devdigest-postgres'

function Write-Log  { param([string]$Message) Write-Host "> $Message" -ForegroundColor Cyan }
function Write-Warn { param([string]$Message) Write-Host "! $Message" -ForegroundColor Yellow }

# Run a native command and fail the script if it exits non-zero. PowerShell does
# not do this on its own -- a failing exe just sets $LASTEXITCODE and carries on.
function Invoke-Native {
  param(
    [Parameter(Mandatory)][string]$Command,
    [string[]]$Arguments = @(),
    [string]$WorkingDirectory = ''
  )
  if ([string]::IsNullOrEmpty($WorkingDirectory)) { $WorkingDirectory = $Root }
  Push-Location $WorkingDirectory
  try {
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
      throw "$Command $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
    }
  }
  finally { Pop-Location }
}

# --- prerequisites -----------------------------------------------------------
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'docker not found' }
if (-not (Get-Command pnpm   -ErrorAction SilentlyContinue)) { throw 'pnpm not found (npm i -g pnpm)' }
if (-not (Get-Command npm    -ErrorAction SilentlyContinue)) { throw 'npm not found' }

# `pnpm` resolves to pnpm.ps1 first, which Start-Process cannot execute. Grab
# the .cmd shim instead -- that one runs under cmd.exe for the long-lived dev
# servers below.
$PnpmCmdPath = Get-Command pnpm -All |
  Where-Object { $_.Source -and $_.Source.EndsWith('.cmd', [StringComparison]::OrdinalIgnoreCase) } |
  Select-Object -First 1 -ExpandProperty Source
if (-not $PnpmCmdPath) { throw 'could not locate pnpm.cmd next to pnpm on PATH' }

# --- env files ---------------------------------------------------------------
foreach ($dir in 'server', 'client') {
  $envFile     = Join-Path $Root "$dir/.env"
  $envExample  = Join-Path $Root "$dir/.env.example"
  if (-not (Test-Path $envFile) -and (Test-Path $envExample)) {
    Copy-Item $envExample $envFile
    Write-Warn "created $dir/.env from .env.example -- add your API keys (OPENAI/ANTHROPIC/GITHUB_TOKEN) in server/.env"
  }
}

# --- Postgres ----------------------------------------------------------------
# Probe the container quietly. In 5.1 a native command's stderr becomes a
# NativeCommandError under $ErrorActionPreference='Stop', so redirect it away
# inside a temporary Continue scope rather than with a bare 2>$null.
function Get-DockerField {
  param([Parameter(Mandatory)][string]$Format)
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $value = (docker inspect -f $Format $Container 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) { return '' }
    return $value
  }
  finally { $ErrorActionPreference = $prev }
}

# Fail fast with a clear message when the daemon isn't reachable at all.
$ErrorActionPreference = 'Continue'
docker info 2>&1 | Out-Null
$dockerUp = ($LASTEXITCODE -eq 0)
$ErrorActionPreference = 'Stop'
if (-not $dockerUp) { throw 'docker daemon not reachable -- is Docker Desktop running?' }

# The container name is fixed (container_name: devdigest-postgres), so if one is
# already running (possibly under another compose project) we reuse it instead
# of failing on a name conflict. If it exists but is stopped, start it; else
# create it via compose.
$state = Get-DockerField '{{.State.Status}}'
if (-not $state) { $state = 'missing' }

switch ($state) {
  'running' { Write-Log 'Postgres container already running -- reusing it' }
  { $_ -in 'exited', 'created' } {
    Write-Log 'starting existing Postgres container'
    Invoke-Native docker @('start', $Container) | Out-Null
  }
  default {
    Write-Log 'starting Postgres (docker compose up -d)'
    Invoke-Native docker @('compose', 'up', '-d')
  }
}

Write-Log 'waiting for Postgres to be healthy'
$status = ''
foreach ($attempt in 1..60) {
  $status = Get-DockerField '{{.State.Health.Status}}'
  if (-not $status) { $status = 'starting' }
  if ($status -eq 'healthy') { break }
  Start-Sleep -Seconds 1
}
if ($status -ne 'healthy') { throw 'Postgres did not become healthy in time' }
Write-Log 'Postgres healthy'

# --- install deps (only if missing) ------------------------------------------
function Install-IfNeeded {
  param([Parameter(Mandatory)][string]$Dir)
  $target = Join-Path $Root $Dir
  if (Test-Path (Join-Path $target 'node_modules')) { return }

  Write-Log "installing deps in $Dir"
  Push-Location $target
  try {
    pnpm install
    # pnpm exits 1 on ERR_PNPM_IGNORED_BUILDS (unapproved build scripts) even
    # though the install itself succeeded, so treat node_modules as the verdict.
    if ($LASTEXITCODE -ne 0 -and -not (Test-Path (Join-Path $target 'node_modules'))) {
      throw "pnpm install failed in $Dir with exit code $LASTEXITCODE"
    }
  }
  finally { Pop-Location }
}
Install-IfNeeded server
if (-not $DbOnly -and -not $NoClient) { Install-IfNeeded client }
# reviewer-core's RAW source is imported by the API at runtime (tsconfig alias);
# without its deps the API crashes at boot with ERR_MODULE_NOT_FOUND. It uses npm.
if (-not (Test-Path (Join-Path $Root 'reviewer-core/node_modules'))) {
  Write-Log 'installing deps in reviewer-core'
  Invoke-Native npm @('ci') -WorkingDirectory (Join-Path $Root 'reviewer-core')
}

# --- migrate + seed ----------------------------------------------------------
# Before running a script, pnpm re-checks deps by shelling out to `pnpm install`
# -- which exits 1 on ERR_PNPM_IGNORED_BUILDS and takes the script down with it,
# even though deps are fine. We installed above, so skip that redundant check.
$env:PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN = 'false'

Write-Log 'applying migrations'
Invoke-Native pnpm @('db:migrate') -WorkingDirectory (Join-Path $Root 'server')

if (-not $NoSeed) {
  Write-Log 'seeding demo data'
  Invoke-Native pnpm @('db:seed') -WorkingDirectory (Join-Path $Root 'server')
}

if ($DbOnly) {
  Write-Log 'DB ready. Postgres is running; server/client not started (-DbOnly).'
  exit 0
}

# --- dev servers -------------------------------------------------------------
# pnpm on Windows is a .cmd shim, so killing the job leaves the node child
# alive. Start-Process gives us a real PID whose whole tree we can tear down.
$serverProc = $null
$clientProc = $null

function Stop-Tree {
  param($Process)
  if ($null -ne $Process -and -not $Process.HasExited) {
    # /T kills the shim's children (node) too, which a plain Stop-Process misses.
    taskkill /PID $Process.Id /T /F 2>$null | Out-Null
  }
}

function Invoke-Cleanup {
  Write-Log 'shutting down dev servers (Postgres stays up; stop it with: docker compose down)'
  Stop-Tree $clientProc
  Stop-Tree $serverProc
}

try {
  Write-Log 'starting API on :3001 (server)'
  $serverProc = Start-Process -FilePath $PnpmCmdPath -ArgumentList 'dev' `
    -WorkingDirectory (Join-Path $Root 'server') -NoNewWindow -PassThru

  if (-not $NoClient) {
    Write-Log 'starting web on :3000 (client) -- Ctrl-C to stop both'
    $clientProc = Start-Process -FilePath $PnpmCmdPath -ArgumentList 'dev' `
      -WorkingDirectory (Join-Path $Root 'client') -NoNewWindow -PassThru
    $clientProc.WaitForExit()
  }
  else {
    Write-Log "API running (PID $($serverProc.Id)) -- Ctrl-C to stop"
    $serverProc.WaitForExit()
  }
}
finally {
  Invoke-Cleanup
}
