# 0001a — Project Context: server core (discovery, tokenizer port, settings, attachments)

**Status:** approved
**Date:** 2026-08-24
**Mode:** single-agent
**Touches:** `server/src/vendor/shared/adapters.ts` · `client/src/vendor/shared/adapters.ts` · `server/src/adapters/tokenizer/` · `server/src/modules/project-context/` (new) · `server/src/db/schema/context.ts` · `server/src/platform/container.ts` · `server/src/modules/settings/feature-models.ts`

## Requirements

Джерело: `docs/specs/SPEC-01-project-context-folder.md` (**Status: approved**).
Серверний фундамент: AC-1…AC-6, AC-10, AC-12, AC-14, AC-15…AC-21, AC-23,
AC-44…AC-47, AC-51, AC-54, AC-55, AC-57…AC-64, AC-66 (серверний детектор),
AC-67, AC-68, NFR-3, NFR-5, NFR-9, NFR-11, NFR-16…NFR-23.
Ін'єкція у ран — `0001b`. UI — `0001c`.

## Requirements review

- **Специфікація помиляється щодо політики довіри в `reviewer-core`** — `[recommended]`
  «Module interactions» каже, що екзекутор загортає документи, а рендерер політики
  не застосовує. Для слоту `specs` це неправда: `prompt.ts:123-125` уже сам робить
  `wrapUntrusted('spec-N', s)` — на відміну від `skills`/`intent`, які приходять
  загорнутими. Наслідок зафіксовано в `0001b`: передавати **сирий** текст.
  Побічно: `wrapUntrusted` (`prompt.ts:45`) уже нейтралізує `</untrusted>`, тож
  **AC-49 виконано наявним кодом** і потребує лише тесту.
- **AC-59 має живого порушника вже сьогодні** — `[recommended]`
  `reviews/intent-inputs.ts:140` експортує `estimateTokens()` = `ceil(chars/4)`, і
  `intent.ts:224` пише це число в лог. AC-59 забороняє **вводити** другий метод, а
  не прибрати наявний; цей план його не чіпає — це число ніде не показується як
  «≈ N tokens». Рекомендація на майбутнє: перейменувати на `approxLogTokens`.
- **AC-22/AC-53 не мають синхронної точки, де попередження може заблокувати** — `[recommended]`
  `POST /repos/:id/resync` (`repo-intel/routes.ts:43-66`) ставить джобу і повертає
  202; `resyncRepo` виконується в `JobRunner` без каналу назад. Прийнято: сервер
  дає preflight `GET /repos/:id/project-context/dirty`, UI (`0001c`) блокує до
  підтвердження. Спостережувана поведінка виконана, механізм інший за формулювання.
- **AC-21 потребує git-спроможності, якої немає в порті** — `[proceeding as asked]`
  `GitClient` (`adapters.ts:219-241`) не має ні `status`, ні лістингу директорій.
  Обидві додаються як нові методи порту.
- **NFR-1/NFR-2/NFR-20 не мають фікстури потрібного масштабу** — `[proceeding as asked]`
  Специфікація сама це помічає. Бюджети перевіряються вручну, автоматичного гейта немає.
- **NFR-23 має тихий наслідок для AC-12** — `[recommended]`
  Ліміт 20 валідується в `project-context/service.ts`, а не в
  `AgentsRepository.update` — інакше перевірка сіла б на шлях версіонування, який
  вкладення навмисне обходять.

## Problem

Немає жодного API, яке б перелічило markdown у клоні, і жодного місця, де
користувач міг би обрати документ. Токенайзер задокументовано як «ONLY under
modules/repo-intel» (`adapters/tokenizer/index.ts:11`), тож студія не має чим
оцінити вартість. Слот `specs` у `reviewer-core` і `specs_read` у контракті
існують і не мають постачальника (див. `0001b`).

## Approach

Новий модуль `server/src/modules/project-context/` у канонічній формі
(`routes.ts` → `service.ts` → `repository.ts` → `helpers.ts` → `constants.ts`),
зареєстрований у `src/modules/index.ts`.

Токенайзер виводиться з-під `repo-intel` **підняттям інтерфейсу в порт**:
`Tokenizer` переїжджає в `vendor/shared/adapters.ts` (обидві копії), реалізація
лишається на місці й імпортує порт — бо прямий імпорт
`../../adapters/tokenizer/index.js` із `service.ts` спрацював би
`service-no-concrete-adapters` і підняв би базову лінію з 6 до 7.

Обхід markdown — власна функція, а не `walkClone`, бо `walk.ts:98-101` фільтрує
по `SUPPORTED_EXT` (лише JS/TS) і `.md` там не існує в принципі. `EXCLUDED_DIRS`
при цьому імпортується з `repo-intel/constants.ts` — крос-модульний імпорт
`constants.ts` дозволений, і саме той набір вимагає AC-2.

`GitClient` отримує лістинг директорій, статус і запис, бо порт має лише
`readFile`. Вкладення — дві link-таблиці за зразком `agent_skills`
(`schema/agents.ts:52-64`), з колонкою `order` і без снапшоту у версії (NFR-23).

## Affected packages and modules

| Package | Path | What changes | Layer |
|---|---|---|---|
| server | `src/vendor/shared/adapters.ts` | `Tokenizer` порт (переїзд); `GitClient.listFiles` + `GitClient.dirtyPaths` + `GitClient.writeFile` | 3 — Ports |
| client | `src/vendor/shared/adapters.ts` | те саме, дзеркально | 3 |
| server | `src/adapters/{tokenizer,git/simple-git,mocks}.ts` | порт замість оголошення; 3 нові методи git; моки | 5 |
| server | `src/db/schema/context.ts` + нова міграція | `agent_context_docs`, `skill_context_docs` | 5 |
| server | `src/modules/project-context/` (new) | увесь модуль | 2/4/5 |
| server | `src/modules/settings/feature-models.ts` | `readContextRoots()` fail-safe | 5 |
| both | `src/vendor/shared/contracts/platform.ts` | `ContextRoots` + ключ у `SettingsKnown` | 1 |
| both | `src/vendor/shared/contracts/project-context.ts` (new) | DTO сторінки/вкладень | 1 |
| server | `src/platform/container.ts` · `src/modules/index.ts` | `projectContextRepo`; реєстрація модуля | Composition root |

`@devdigest/shared` вендорено двічі й скрипта синхронізації немає — **кожна
правка контракту та `adapters.ts` є правкою двох файлів**. Канонічний бік —
`server/`. Перевірка: `diff server/src/vendor/shared/<f> client/src/vendor/shared/<f>`.

## Architectural constraints

- `project-context/service.ts` **не імпортує** ані `Container`, ані `src/adapters/**`,
  ані `src/db/**`. Усі порти приходять у явному `ProjectContextDeps`, зібраному в
  `routes.ts`. `Tokenizer` імпортується **тільки** як тип з `@devdigest/shared` —
  імпорт `../../adapters/tokenizer/index.js` дав би 7-е попередження.
- `Tokenizer` у `vendor/shared/adapters.ts` не має імпортувати нічого з
  `src/(adapters|db|modules)/` — `ports-know-no-adapters`, severity **error**.
  Інтерфейс уже чистий, тож переїзд безпечний; `approxTokens()` лишається в
  адаптері як реалізаційна деталь fallback-у.
- `EXCLUDED_DIRS` імпортується з `../repo-intel/constants.js`, не копіюється —
  AC-2 вимагає **той самий** набір, а копія розійдеться мовчки.
- `routes.ts` не звертається до Drizzle і не будує репозиторій — той приходить
  із `container.projectContextRepo` (`routes-no-persistence`, warn — не збільшувати).
- `helpers.ts` лишається чистим: жодних `fs`, `git`, `db` — обхід живе в
  `service.ts` (`helpers-are-pure`, warn — не збільшувати).
- Кожна доменна таблиця несе `workspace_id`; резолв через `getContext()`.
- AC-47/NFR-18: containment перевіряється **до** будь-якого доступу до ФС, за
  зразком `intent-inputs.ts:46`, плюс відхилення Windows-абсолютних (`^[A-Za-z]:`)
  і backslash-сегментів; симлінки пропускаються під час обходу (`walk.ts:89`).

Enforced by: `cd server && pnpm arch:check` — судити за рядком
`x N dependency violations (E errors, W warnings)`, ціль **6 warnings / 0 errors**.

## Implementation steps

### Step 1 — Підняти `Tokenizer` у порт
- **Files:** `server/src/vendor/shared/adapters.ts` (edit), `client/src/vendor/shared/adapters.ts` (edit), `server/src/adapters/tokenizer/index.ts` (edit), `server/src/platform/container.ts` (edit), `server/src/modules/repo-intel/pipeline/full.ts` (edit), `server/src/adapters/mocks.ts` (edit)
- **Do:** Додати в обидві копії `adapters.ts` секцію `// ---------- Tokenizer ----------`.
  У `adapters/tokenizer/index.ts` замінити локальне оголошення на
  `import type { Tokenizer } from '@devdigest/shared'` + `export type { Tokenizer }`
  (реекспорт зберігає наявні імпорти) і переписати шапку файлу: замість «Scope:
  in-process, ONLY under modules/repo-intel» — «consumed by repo-intel's repo-map
  budget search and by project-context token estimation». `full.ts:28` і
  `container.ts:41` — тип із `@devdigest/shared`, клас із адаптера.
  Розширити порт до `count(text: string): number` + `readonly approximate: boolean`
  — прапорець стає `true`, коли адаптер перейшов на евристику (`broken` у
  `TiktokenTokenizer:27`); це і живить AC-18/AC-60, лишаючись доменною мовою без
  жодного типу `js-tiktoken`. Додати `MockTokenizer` у `mocks.ts` (детермінований
  `ceil(len/4)`), щоб тести не платили за ліниву ініціалізацію BPE.
- **Done when:** `pnpm arch:check` показує 6 warnings / 0 errors, і
  `diff server/src/vendor/shared/adapters.ts client/src/vendor/shared/adapters.ts`
  порожній.

### Step 2 — Розширити `GitClient` трьома методами
- **Files:** `server/src/vendor/shared/adapters.ts`, `client/src/vendor/shared/adapters.ts`, `server/src/adapters/git/simple-git.ts`, `server/src/adapters/mocks.ts`
- **Do:** У порт (обидві копії):
  - `listFiles(repo, opts: { roots: string[]; ext: string; excludeDirs: string[]; limit: number }): Promise<{ paths: string[]; truncated: boolean }>`
  - `dirtyPaths(repo, prefixes: string[]): Promise<string[]>` — репо-відносні шляхи, що відрізняються від коміченого вмісту.
  - `writeFile(repo, path, content): Promise<void>`
  `SimpleGitClient`: `listFiles` — рекурсивний `readdir` від `clonePathFor(repo)`
  з `EXCLUDED_DIRS`, пропуском симлінків, нормалізацією `sep`→`/`, стабільним
  сортуванням і зрізом на `limit` — за зразком `walk.ts:73-120`; `dirtyPaths` —
  `simpleGit(...).status()`, звужений по `prefixes`; `writeFile` — `fs.writeFile`
  під `clonePathFor`, що **кидає**, якщо шлях не міститься в директорії клона.
  `MockGitClient`: `listFiles` віддає ключі `opts.files` під roots; `dirtyPaths` —
  `this.opts.dirty ?? []`; `writeFile` пише в ту саму мапу.
- **Done when:** `pnpm typecheck` у `server/` не має нових помилок, окрім
  2 передіснуючих; обидві копії `adapters.ts` ідентичні.

### Step 3 — Налаштування context roots
- **Files:** `server/src/vendor/shared/contracts/platform.ts`, `client/src/vendor/shared/contracts/platform.ts`, `server/src/modules/settings/feature-models.ts`
- **Do:** Поряд з `IntentLinkPattern` (`platform.ts:94`) додати
  `ContextRoot = z.string().regex(/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*\/?$/)`
  — регекс сам відкидає провідний `/`, `..` і Windows-абсолютні (AC-47); і
  `ContextRoots = z.array(ContextRoot).min(1).max(20)`. У `SettingsKnown` додати
  `context_roots: ContextRoots.default(['specs/','docs/','insights/'])` (AC-44).
  У `feature-models.ts` додати `readContextRoots(container, workspaceId)` точно за
  формою `readLinkAllowlist` (`:67-75`), але **fail-open у дефолт**, не в порожнечу:
  `parsed.success ? parsed.data : DEFAULT_CONTEXT_ROOTS` (AC-46). При
  `!parsed.success` **і** наявному збереженому значенні — `container` логера немає,
  тож повернути другим полем `{ roots, rejected: true }` і дати `routes.ts`
  залогувати `req.log.warn` (AC-54).
- **Done when:** обидві копії `platform.ts` ідентичні; `GET /settings` віддає
  `context_roots` з дефолтом на незаповненому воркспейсі.

### Step 4 — Схема вкладень + міграція
- **Files:** `server/src/db/schema/context.ts` (edit), `server/src/db/migrations/` (generated)
- **Do:** Дві таблиці за формою `agentSkills` (`schema/agents.ts:52-64`):
  ```
  agentContextDocs: agent_id → agents(cascade), path text, order integer default 0,
                    workspace_id → workspaces(cascade), pk(agent_id, path)
  skillContextDocs: skill_id → skills(cascade), path text, order integer default 0,
                    workspace_id → workspaces(cascade), pk(skill_id, path)
  ```
  `path` — репо-відносний рядок, **не** текст документа (AC-10, NFR-16); PK на
  `(entity_id, path)` робить повторне вкладання ідемпотентним. Згенерувати
  `pnpm db:generate`. Міграції не йдуть на буті — `pnpm db:migrate` окремо.
- **Done when:** новий `.sql` існує в `src/db/migrations/`, і `pnpm db:migrate`
  на порожній БД проходить.

### Step 5 — Модуль: `constants.ts` + `helpers.ts` (чисті)
- **Files:** `server/src/modules/project-context/constants.ts` (new), `.../helpers.ts` (new)
- **Do:** `constants.ts`: `DEFAULT_CONTEXT_ROOTS = ['specs/','docs/','insights/']`,
  `MAX_DOCS_PER_ENTITY = 20` (AC-12/NFR-3), `MAX_LISTED_DOCS = 1000` (NFR-5),
  `MAX_DOC_CHARS = 150_000` (AC-33), `MAX_CONTEXT_BLOCK_TOKENS = 40_000` (AC-34),
  `SUM_ESTIMATE_BUDGET_MS = 3_000` (NFR-20/21),
  `SUM_ESTIMATE_MAX_BYTES = 20 * 1024 * 1024` (NFR-22), реекспорт `EXCLUDED_DIRS`
  з `../repo-intel/constants.js` (AC-2). Кольори мітки — суто клієнтські, живуть
  у `0001c`; сервер віддає лише matched root.
  `helpers.ts` (чисті функції, кожна з юніт-тестом):
  - `isContainedPath(path: string): boolean` — false на `..`, провідному `/`,
    `^[A-Za-z]:`, backslash (AC-47/NFR-18).
  - `matchRoot(path, roots): string | null` — перший root, під який підпадає шлях;
    саме він дає type label (AC-64).
  - `dedupeByPath(entries)` — перше входження виграє (готується під AC-26 у `0001b`).
  - `buildStatusLine(input)` → `{ count, tokenSum, scannedAt, truncated, fallbackUsed, cloned }`
    зі всіма станами AC-3, AC-57…AC-63, NFR-19, NFR-22. **Не форматує рядок** —
    віддає структуру, рядок збирає клієнт із `messages/`.
- **Done when:** `pnpm exec vitest run project-context-helpers` зелений; `arch:check` = 6/0.

### Step 6 — `repository.ts`
- **Files:** `server/src/modules/project-context/repository.ts` (new), `server/src/platform/container.ts` (edit)
- **Do:** `ProjectContextRepository(db)` з методами, всі workspace-scoped:
  `listForAgent(workspaceId, agentId)`, `listForSkill(workspaceId, skillId)`,
  `setForAgent(workspaceId, agentId, paths[])` і `setForSkill(...)` — **повна заміна
  масиву** в одній транзакції з `order = index` (форма `POST /agents/:id/skills`),
  `attachmentCountsByPath(workspaceId, repoId?)` → `Map<path, number>` для AC-14,
  `listForAgentWithSkills(workspaceId, agentId)` — агентські вкладення + вкладення
  його **enabled** пов'язаних скілів у порядку `agent_skills.order` (AC-25/AC-29;
  споживається в `0001b`). Повертати доменні структури, не Drizzle-рядки.
  У `container.ts` — лінивий геттер `projectContextRepo`.
- **Done when:** `pnpm exec vitest run .it.test` — новий
  `project-context.it.test.ts` підтверджує персистенцію, порядок і повну заміну.

### Step 7 — `service.ts`
- **Files:** `server/src/modules/project-context/service.ts` (new)
- **Do:** `ProjectContextService(deps: ProjectContextDeps, repo: ProjectContextRepository)`,
  де `ProjectContextDeps = { git: GitClient; tokenizer: Tokenizer; contextRoots: (workspaceId: string) => Promise<string[]> }`.
  Методи:
  - `listDocuments(workspaceId, repoId)` — резолв roots (AC-45: читаються **на
    кожен запит**), `git.listFiles` з `EXCLUDED_DIRS` і `limit = MAX_LISTED_DOCS`,
    фільтр через `isContainedPath`, збагачення `attachmentCountsByPath` (AC-14),
    і **паралельно** — сумарна оцінка з дедлайном `SUM_ESTIMATE_BUDGET_MS`: за
    прострочення `tokenSum: null` + `pending: true` (AC-61/NFR-21), лістинг
    ніколи не чекає. Немає клона → `cloned: false`, `count`/`tokenSum`
    **відсутні**, не нулі (AC-6/AC-63). `git.listFiles` кинув → підняти помилку,
    **не** повертати порожній список як успіх (NFR-7).
  - `readDocument(...)` — guard → `git.readFile`; кидок **або** порожній рядок
    трактуються однаково як «missing» (AC-36), за зразком
    `conventions/service.ts#readFileSafe:204-211`.
  - `estimateTokens(text)` — `deps.tokenizer.count(text)`; **жодного кешу**
    (AC-19). Прапорець fallback (AC-18/AC-60) читається з `tokenizer.approximate`
    (див. Step 1), не вгадується порівнянням із `ceil(len/4)`.
  - `writeDocument(...)` — guard → `git.writeFile`, без коміта (AC-20). Провал →
    лишити файл як був і повернути причину (AC-23/AC-55). Лог: шлях + результат,
    **ніколи не текст** (NFR-11/NFR-17).
  - `dirtyDocuments(...)` — `git.dirtyPaths(ref, roots)`, звужені до `*.md` під
    roots (AC-21/AC-66).
  - `setAgentDocs` / `setSkillDocs` — валідація `MAX_DOCS_PER_ENTITY` **до**
    запису → `ValidationError` з текстом ліміту (AC-12); containment на кожен
    шлях. Не торкається `AgentsRepository.update`, тож версія не бампиться (NFR-23).
  - `attachmentsFor(...)` позначає відсутні на диску шляхи `missing: true`, не
    видаляючи їх (AC-37).
- **Done when:** `pnpm typecheck` без нових помилок; `arch:check` = 6/0.

### Step 8 — `routes.ts` + реєстрація
- **Files:** `server/src/modules/project-context/routes.ts` (new), `server/src/modules/index.ts` (edit), `server/src/vendor/shared/contracts/project-context.ts` (new, ×2)
- **Do:** Контракт (обидві копії): `ContextDoc`, `ContextListing`
  (`docs[]`, `status: { count?, token_sum?, token_sum_pending, scanned_at,
  truncated, fallback_used, cloned }`), `ContextAttachment`, `SetContextDocsBody`.
  Ендпоїнти, всі через `getContext(container, req)`:
  `GET /repos/:id/project-context/docs` → `ContextListing` (AC-1/AC-67) ·
  `GET …/doc?path=` → `{ path, content, tokens, approximate, dirty }` (AC-4/AC-15/AC-16) ·
  `PUT …/doc` (AC-20/AC-55) · `GET …/dirty` → `{ paths }` (preflight AC-22/AC-53) ·
  `GET|POST /agents/:id/context-docs` · `GET|POST /skills/:id/context-docs`.
  `ProjectContextDeps` збирається тут; `contextRoots` — резолвер-функція
  `(wsId) => readContextRoots(container, wsId)`, за зразком `linkAllowlist`
  (`ReviewRunDeps:72`). Додати `projectContext` у `modules/index.ts`.
- **Done when:** `pnpm exec vitest run routes-smoke` зелений; ручний `curl`
  на `GET /repos/:id/project-context/docs` повертає непорожній лістинг для
  засіданого репо.

## Verification plan

| When | Command | Run from | Pass criterion |
|---|---|---|---|
| перед першою правкою | `pnpm typecheck > tc-base.log 2>&1; echo "exit=$?"`, потім `pnpm arch:check > arch-base.log 2>&1`, потім `pnpm exec vitest run --exclude '**/*.it.test.ts'` | `server/` | зафіксувати 2 помилки, `x 6 dependency violations (0 errors, 6 warnings)`, 209 passed / 23 files |
| після Step 1 | `pnpm arch:check > arch.log 2>&1; echo "exit=$?"; grep 'dependency violations' arch.log` | `server/` | **точно** `0 errors, 6 warnings` — 7-е попередження означає прямий імпорт адаптера в сервісі |
| після Steps 1, 2, 3, 8 | `diff server/src/vendor/shared/adapters.ts client/src/vendor/shared/adapters.ts && diff server/src/vendor/shared/contracts/platform.ts client/src/vendor/shared/contracts/platform.ts && diff server/src/vendor/shared/contracts/project-context.ts client/src/vendor/shared/contracts/project-context.ts` | repo root | нульовий вивід — односторонню правку не ловить жоден typecheck |
| після Step 4 | `pnpm db:generate` потім `pnpm db:migrate` | `server/` | міграція застосовується; `pnpm db:seed` проходить |
| після Steps 5, 7 | `pnpm typecheck > tc.log 2>&1; echo "exit=$?"; grep -c 'error TS' tc.log` | `server/` | рівно 2 — порівнювати з базовою лінією, зелений прогін неможливий |
| після Step 5 | `pnpm exec vitest run --exclude '**/*.it.test.ts'` | `server/` | ≥ 209 passed, 0 failed |
| після Steps 6, 8 | `pnpm exec vitest run .it.test` | `server/` | окремо від герметичної смуги — одночасний прогін падає від контенції |
| фінал | `pnpm arch:check`, потім `pnpm exec vitest run --exclude '**/*.it.test.ts'`, потім `pnpm exec vitest run .it.test` | `server/` | три окремі команди, **жодного** пайпа в `tail`/`head` — пайп губить exit code |

Baseline to record before starting: 2 typecheck errors; `x 6 dependency
violations (0 errors, 6 warnings)`; 209 hermetic tests у 23 файлах.

**Тести, які цей план зобов'язаний додати.** Герметичні: containment-guard
(AC-47/NFR-18) з кейсами `../`, `/etc/passwd`, Windows-абсолютного і
backslash-сегмента; `matchRoot` для кастомного root `adr/` (AC-64); `buildStatusLine` у станах empty / no-clone / pending /
fallback / truncated (AC-3, AC-57…AC-63, NFR-19, NFR-22); fail-safe парсинг
`context_roots` (AC-46/AC-54); токен-оцінка та fallback (AC-15/AC-18) на
`MockTokenizer`.
**AC-36 обов'язково двома формами** — і читанням, що кидає, і читанням, що
повертає `''`: тест лише на моці пройде, поки реальний клієнт кидає.
Інтеграційні (`*.it.test.ts`, Docker; без нього скіпаються): персистенція і
порядок вкладень (AC-8…AC-11, AC-52), ліміт 20 (AC-12), `Used by N agents`
(AC-14), запис без коміта (AC-20), провал запису лишає файл (AC-23/AC-55).
Фікстура **мусить** починатися з `await seed(db)` — інакше
`LocalNoAuthProvider` резолвить воркспейс, якого тест не створював.

## Acceptance
- [ ] AC-1…AC-6, AC-57…AC-63, AC-67, NFR-5, NFR-19…NFR-22 — лістинг з усіма станами status line доступний через API; порожній, не-клонований і недоступний клон розрізняються; сума ніколи не блокує лістинг.
- [ ] AC-10, AC-12, AC-14, AC-37, AC-52, NFR-3, NFR-16, NFR-23 — вкладення персистяться як шляхи в порядку; ліміт 20 діє; версія не бампиться.
- [ ] AC-15…AC-19, AC-59, AC-60, AC-64, AC-65, AC-68 — одна методика підрахунку через порт, fallback позначається, нічого не кешується; мітка з matched root.
- [ ] AC-20, AC-21, AC-23, AC-55, AC-66, NFR-11, NFR-17 — запис без коміта; dirty обмежено `*.md` під roots; провал не руйнує файл; лог без тексту.
- [ ] AC-44…AC-47, AC-51, AC-54, NFR-18 — roots читаються щоразу, невалідні деградують у дефолт із записом; containment відхиляє втечу.
- [ ] AC-36 перевірено **обома** формами провалу читання — кидком і порожнім рядком.
- [ ] `arch:check` — рівно 6 warnings / 0 errors; усі три пари вендорованих файлів побайтово збігаються.

## Out of scope
- Ін'єкція в ран, дедуплікація, бюджет, усічення, трасування (`0001b`); уся UI-частина (`0001c`).
- Написання чи правка специфікації — `docs/specs/` і `<package>/specs/` недоторканні.
- Прибирання `estimateTokens()` з `intent-inputs.ts` — рекомендовано, не робиться тут.
- Автоматичний гейт для NFR-1/NFR-2/NFR-20: фікстури потрібного масштабу не існує.
- Коміт/пуш, створення/видалення/перейменування документів, `COVERAGE`, чанкінг — Non-goals специфікації.

## Open questions
- **Per-workspace чи per-repo `context_roots`?** Специфікація каже per-workspace
  (AC-44), але сторінка scoped на репозиторій (AC-67), а структура документації в
  двох репо воркспейсу зазвичай різна. Продовжую як написано; per-repo override
  був би адитивною зміною.
- **`writeFile` у `GitClient` чи окремий порт?** `GitClient` задокументовано як
  read-only дзеркало (`simple-git.ts:78-80`). Продовжую з `GitClient.writeFile` —
  окремий порт заради одного методу над тією ж директорією додав би DI-шум без
  ізоляції; безпеку несе containment-guard усередині реалізації.
