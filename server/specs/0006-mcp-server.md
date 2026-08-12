# 0006 — Локальний MCP-сервер (5 інструментів)

**Status:** done
**Date:** 2026-08-11
**Touches:** src/mcp/ · src/modules/mcp-tools/ · src/modules/reviews/service.ts · src/platform/container.ts · package.json

## Problem

DevDigest вміє рев'ювати PR лише через свій HTTP API + студію. Модель у Claude
Code не має способу спитати «які агенти є», запустити рев'ю і отримати findings —
людина мусить перемикатись у браузер. Потрібен локальний MCP-сервер, який дає
моделі 5 інструментів поверх уже наявної доменної логіки.

Головна перешкода в коді: `ReviewService.runReview` (`reviews/service.ts:180`) —
fire-and-forget. Він створює `agent_runs` рядки, повертає `runIds` ОДРАЗУ, а
`void this.executor.executeRuns(...)` крутиться у фоні (`service.ts:212`). Тобто
«запусти і дочекайся результату» наявним API НЕ підтримується.

## Approach

**Окремий entrypoint `src/mcp-server.ts` + модуль `src/modules/mcp-tools/`** —
НЕ Fastify-модуль у `modules/index.ts` (там реєструються лише HTTP-плагіни, а MCP
працює на stdio і не має `FastifyRequest`).

- `src/mcp-server.ts` (layer 5, композиційний корінь для MCP) — `loadConfig()`,
  `createDb()`, `new Container(...)`, збирає deps, реєструє 5 інструментів,
  підключає stdio-транспорт. Дзеркалить `server.ts`, не імпортує `app.ts`.
- `src/modules/mcp-tools/service.ts` (layer 4) — `McpToolsService`, чисті
  use-case методи (`listAgents`, `runAgentOnPr`, `getFindings`,
  `getConventions`), приймає `McpToolsDeps`. Нічого не знає про MCP-протокол.
- `src/mcp/tools/*.ts` (layer 5) — обгортки: JSON Schema, annotations, тексти
  описів/помилок, перетворення в `CallToolResult`. Протокол живе ТУТ, не в сервісі.

**Чому не Fastify-модуль:** `getContext(container, req)` вимагає `FastifyRequest`;
MCP працює поза HTTP-запитом. Workspace резолвиться напряму через
`container.auth.currentWorkspace()` — `LocalNoAuthProvider` (`adapters/auth/local.ts:28`)
ігнорує аргумент `req` і завжди повертає seeded default workspace, тож виклик без
аргументу коректний. Це зафіксовано як обмеження в `Architectural constraints`.

**Чому окремий entrypoint, а не тонкий пакет:** MCP-серверу потрібні `Container`,
репозиторії й `ReviewService` — окремий пакет означав би третю вендорену копію
`@devdigest/shared`. Entrypoint усередині `server/` перевикористовує все як є.

**Транспорт — stdio** (клієнт сам спавнить процес): без порту, CORS,
Origin-валідації і без автентифікації, бо канал — це stdin/stdout дочірнього
процесу. Streamable HTTP відхилено — він додає localhost-порт, який стає новою
externally-reachable поверхнею, і вимагає Origin-валідації проти DNS-rebinding
заради нуля виграшу для локального сценарію.

**Очікування завершення рев'ю — новий метод `runReviewAndWait` у `ReviewService`**
(варіант «в»). Аргументи (а) підписка на RunBus і (б) полінг статусу відхилено:
`RunBus.complete()` викликається окремо для КОЖНОГО runId (`run-executor.ts:379`,
`:409`, `:148`), а `onDone` для ще не створеного emitter'а зависає — обидва дають
гонку. Деталі механіки — Step 4.

**Контракти `@devdigest/shared` НЕ змінюються.** Перевірено: MCP-відповіді — це
власні DTO модуля (`mcp-tools/helpers.ts`), клієнт їх не споживає. Отже двофайлове
редагування вендореної копії НЕ потрібне.

## Affected packages and modules

| Package | Path | What changes | Layer |
|---|---|---|---|
| server | `src/mcp-server.ts` | new — stdio entrypoint + DI | 5 (композиційний корінь) |
| server | `src/mcp/server-factory.ts` | new — створює McpServer, реєструє tools у фікс. порядку | 5 |
| server | `src/mcp/tools/*.ts` | new — 5 файлів: схеми, annotations, описи, помилки | 5 |
| server | `src/mcp/errors.ts` | new — `toolError(code, text)` → `isError:true` CallToolResult | 5 |
| server | `src/modules/mcp-tools/service.ts` | new — `McpToolsService` + `mcpToolsDeps()` | 4 |
| server | `src/modules/mcp-tools/helpers.ts` | new — чисті: DTO-компресія, truncation, verdict | 2 |
| server | `src/modules/mcp-tools/constants.ts` | new — таймаути, ліміти, назви інструментів | — |
| server | `src/modules/reviews/service.ts` | new метод `runReviewAndWait` | 4 |
| server | `src/modules/reviews/repository.ts` + `repository/pull.repo.ts` | new `findPullByNumber`, `getRunStatuses` | 5 |
| server | `package.json` | new скрипт `mcp` + залежності MCP SDK | — |
| server | `README.md` | edit — розділ «MCP-сервер»: запуск, вимога db:migrate + db:seed | — |
| repo root | `.mcp.json` | new — конфіг для Claude Code | — |

**Не змінюються (перевірено, всупереч початковому припущенню):**

| Path | Чому не треба |
|---|---|
| `src/platform/container.ts` | усі 4 потрібні репозиторії вже є гетерами: `agentsRepo:114`, `conventionsRepo:122`, `reviewRepo:126`, `repoRepo:130`. MCP-корінь лише читає їх |
| `src/modules/index.ts` | MCP — не Fastify-плагін; реєстрація там була б помилкою |
| `src/app.ts`, `src/server.ts` | HTTP-застосунок не знає про MCP; це другий незалежний entrypoint |
| `src/vendor/shared/**` (обидві копії) | контракти не змінюються → двофайлове редагування не потрібне |
| `client/**` | UI для MCP поза скоупом |
| `reviewer-core/**` | логіка рев'ю не змінюється — MCP лише викликає її |
| `e2e/**` | stdio-протокол не тестується браузерними флоу |

## Принципи замовника (зі слайдів) — як враховано

| # | Принцип | Втілення в цьому плані |
|---|---|---|
| 1 | **Результат, а не операція** | `run_agent_on_pr` робить три кроки всередині одного виклику: резолв `repo`+`pr` → `runReviewAndWait` → повертає готові `{verdict, findings[]}`. Жодного job-id, жодного полінгу з боку моделі. Ціна — довгий виклик (до 5 хв), прийнято свідомо; таймаут у Step 4. |
| 2 | **Плоскі аргументи** | Кожна `inputSchema` — плаский об'єкт з ≤4 полів примітивних типів (`repo: string`, `pr: number`, `agent: string`). Жодних вкладених об'єктів і масивів об'єктів у входах. |
| 3 | **Стисла структурована відповідь** | `compactFinding()` у `helpers.ts` віддає рівно 6 полів (`severity, category, title, file, lines, rationale`) — НЕ `ReviewDtoFinding`, який тягне `evidence`, `trifecta_components`, `review_id`, таймстемпи. `get_findings` за замовчуванням `CONCISE`. Ліміти в Step 3. |
| 4 | **Помилка веде далі** | Кожен `toolError` містить назву наступного інструменту. Точні тексти — Step 6. Помилки повертаються як `isError:true` всередині `CallToolResult`, НЕ як JSON-RPC protocol error, щоб модель могла самовиправитись. |

## Architectural constraints

Обов'язкові правила саме для цієї зміни:

1. `src/modules/mcp-tools/service.ts` не імпортує `Container`, `db/**`,
   `drizzle-orm`, `fastify`, нічого з `@modelcontextprotocol/*`. Приймає лише
   `McpToolsDeps`. Порушення ловлять `service-no-sql`, `service-no-http`,
   `service-no-container` — усі `error` у `.dependency-cruiser.cjs`.
2. **Правило `no-cross-module-service` (severity `error`) забороняє імпорт
   `service.ts` іншого модуля.** `McpToolsService` НЕ імпортує `ReviewService`
   чи `ConventionsService`. Замість цього `McpToolsDeps` отримує вже
   сконструйовані інстанси як порти з `mcp-server.ts` (layer 5), типізовані
   локальними структурними інтерфейсами в `mcp-tools/service.ts`:
   ```ts
   export interface ReviewRunner {
     resolveTargets(wsId: string, o: { agentId?: string }): Promise<{ id: string; name: string }[]>;
     runReviewAndWait(wsId: string, prId: string, targets: ..., timeoutMs: number): Promise<...>;
   }
   ```
   `import type` з `../reviews/service.js` теж заборонений — `tsPreCompilationDeps: true`
   бачить type-only імпорти. Структурний інтерфейс оголошується локально.
3. Репозиторії інших модулів імпортувати МОЖНА (`agentsRepo`, `reviewRepo`,
   `conventionsRepo`) — так уже роблять `reviews/run-executor.ts:16` і
   `conventions/service.ts:50`.
4. `mcp-tools/helpers.ts` — чистий (layer 2): без I/O, без `db/**`, без адаптерів.
   **Матриця скіла `onion-architecture` для `modules/*/helpers.ts` додатково
   забороняє імпорт власного `repository.ts`** — тож `compactFinding` приймає
   доменну форму, а не `FindingRow`; див. constraint 7.
5. `src/mcp/**` — layer 5: єдине місце, де живуть MCP SDK, JSON Schema та
   тексти протоколу. Сервіс кидає типізовані помилки з `platform/errors.ts`;
   `src/mcp/errors.ts` мапить їх у `isError:true`.
6. Порядок реєстрації інструментів у `server-factory.ts` — детермінований
   літерал-масив, не `Object.values()` мапи (стабільний `tools/list` → hit rate
   prompt-кешу).
7. **Persistence-типи не перетинають межу layer 4 (правило скіла
   `onion-architecture`, `rules/persistence.md`).** Перевірено в коді:
   `AgentsRepository.list()` повертає `AgentRow` (`agents/repository.ts:54`,
   ре-експорт із `db/rows.js:15`), а `ReviewRow = typeof t.reviews.$inferSelect`
   (`reviews/repository.ts:21`) — це **Drizzle-рядки**, тобто наявний код тут
   успадкував борг («де репозиторій ще повертає рядки, мапінг робить сервіс»).
   Новий код мапить одразу: `McpToolsService` НЕ пропускає `AgentRow`/`FindingRow`
   у свою публічну сигнатуру і НЕ віддає їх в `src/mcp/**`. Методи сервісу
   повертають власні DTO модуля (`McpAgent`, `McpFinding`), зібрані чистими
   мапперами в `helpers.ts`. Це те, що не дає схемі БД протекти в контракт
   MCP-інструмента, який побачить стороння модель.
8. **`src/mcp-server.ts` — композиційний корінь**, і лише він має право знати
   все одразу (`Container`, конкретні репозиторії, `ReviewService`,
   `ConventionsService`, MCP SDK). Скіл виводить композиційний корінь з-під
   правила залежностей саме для цього. Це робить `mcp-server.ts` єдиним
   легальним місцем, де сходяться протокол і DI.

Enforced by: `cd server && pnpm arch:check` — судити за рядком
`x N dependency violations (E errors, W warnings)`, не за exit code.

## Implementation steps

### Step 1 — Верифікація SDK і сумісності zod (ДОСЛІДЖЕННЯ, робиться першим)

Підтверджений факт: `@modelcontextprotocol/server@2.0.0` має
`dependencies = { zod: '^4.2.0', '@modelcontextprotocol/core': '2.0.0' }`, а
`server/package.json:43` фіксує `zod: ^3.24.1`. Це реальний конфлікт, не гіпотеза.
`@modelcontextprotocol/sdk` (монолітний) — `1.30.0`, maintenance-only.

- **Do:** виконати й записати результат кожної команди:
  ```
  cd server
  npm view @modelcontextprotocol/server@2 dependencies peerDependencies
  npm view @modelcontextprotocol/core@2 dependencies
  ```
  Потім встановити у **тимчасовій копії** `package.json` (не в робочій):
  `pnpm add @modelcontextprotocol/server@^2 @modelcontextprotocol/client@^2`
  і перевірити, чи pnpm ставить zod 4 як вкладену копію (`pnpm ls zod --depth=2`).
  Написати 15-рядковий пробний скрипт: `registerTool` зі схемою, побудованою
  локальним `zod@3`, і перевірити, чи SDK її приймає через Standard Schema
  (`~standard` property; zod 3.24+ його має — саме це треба підтвердити емпірично
  для обраної версії SDK).
- **Рішення за результатом:**
  - **A (бажаний):** zod 3 приймається через Standard Schema → лишаємо `zod ^3.24.1`
    у `dependencies`, zod 4 живе вкладено під MCP-пакетами. Схеми пишемо на zod 3.
  - **B (план Б):** несумісно → **передаємо `inputSchema`/`outputSchema` як
    сирий JSON Schema** (SDK це підтримує), а валідацію входу робимо власним
    zod 3 `safeParse` всередині обгортки в `src/mcp/tools/*.ts`. Схеми плоскі й
    прості — ручний JSON Schema тут дешевий. **НЕ оновлювати zod до 4 у
    `server/`**: 11 модулів і `fastify-type-provider-zod@4` зав'язані на zod 3,
    це окрема міграція.
  - **C (запасний):** якщо v2 не встановлюється взагалі → `@modelcontextprotocol/sdk@1.30`
    (він на zod 3), з нотаткою що це maintenance-only.
- **Done when:** у цьому файлі, у секції `Open questions`, дописано один рядок
  «SDK: <пакет@версія>, шлях схем: A|B|C» — і лише після цього починається Step 2.

### Step 2 — Резолвер `repo` + `pr` → `prId`

Перевірено: такої функції НЕМАЄ. `pull.repo.ts` вміє лише `getPull(wsId, prId)`;
`repos/repository.ts:24` має `findByFullName(wsId, fullName)`.

- **Files:** `src/modules/reviews/repository/pull.repo.ts` (edit),
  `src/modules/reviews/repository.ts` (edit — делегувальний метод)
- **Do:** додати `findPullByNumber(db, workspaceId, fullName, number)` — join
  `pull_requests` × `repos` на `repos.fullName = fullName`,
  `pullRequests.number = number`, `pullRequests.workspaceId = workspaceId`.
  Повертає `{ prId, repoId, headSha } | undefined`. Прокинути методом-делегатом
  у `ReviewRepository` (той самий стиль, що `getPull` на `repository.ts:34`).
- **Done when:** `pnpm typecheck` не додає помилок понад baseline (2).

### Step 3 — `mcp-tools/helpers.ts` + `constants.ts` (чисті, тестуються першими)

- **Files:** `src/modules/mcp-tools/helpers.ts` (new), `constants.ts` (new)
- **Do:**
  - Оголосити власні DTO модуля: `McpAgent { id, name, provider, model, enabled }`,
    `McpFinding { severity, category, title, file, lines, rationale }`. **Вони не
    є Drizzle-рядками** — constraint 7. `helpers.ts` не імпортує `db/**` і не
    імпортує чужих `repository.ts`; вхідні типи мапперів описуються локальними
    структурними інтерфейсами (лише ті поля, які реально читаються).
  - `compactFinding(f)` → рівно `{ severity, category, title, file, lines: "12-18", rationale }`.
    `rationale` обрізається до `RATIONALE_MAX_CHARS = 400` з суфіксом `…`.
  - `toMcpAgent(row)` → `McpAgent` — мапить у 5 полів, відкидаючи
    `system_prompt`, `output_schema`, таймстемпи й `workspace_id`. Це і принцип
    «стисла відповідь», і бар'єр проти протікання схеми БД у контракт MCP.
  - `deriveVerdict(findings, agentCiFailOn)` → `'blocked' | 'concerns' | 'clean'`.
    Рахується з severity findings проти гейту агента — **не** з self-reported
    `verdict` моделі (те саме правило, що в `reviews/CLAUDE.md`).
  - `truncateFindings(list, limit)` → `{ shown, total, note }`, де при `total > limit`
    `note = "показано N з M findings, звузьте фільтр параметром severity"`.
  - `normalizeRepo(input)` → `"owner/name" | undefined` (рішення замовника —
    приймати обидва формати). Розпізнає: `"owner/name"`,
    `"https://github.com/owner/name"`, `"github.com/owner/name"`, а також URL з
    хвостом (`/pull/42`, `.git`, trailing slash). Чиста функція, без мережі;
    невідповідність → `undefined`, який обгортка мапить у текст помилки
    «repo у нерозпізнаному форматі» (Step 6). **Не** намагається вгадувати
    неповні значення на кшталт `"payments-api"` без owner — це `undefined`.
  - `constants.ts`: `RUN_TIMEOUT_MS = 300_000` (5 хв — верхня межа рев'ю за
    вимогою), `FINDINGS_LIMIT_CONCISE = 20`, `FINDINGS_LIMIT_DETAILED = 50`,
    `RATIONALE_MAX_CHARS = 400`, `TOOL_NAMES` (масив у фіксованому порядку).
- **Done when:** `test/mcp-helpers.test.ts` зелений (див. Test strategy).

### Step 4 — `ReviewService.runReviewAndWait` (розв'язання fire-and-forget)

**Механіка.** `runReview` (`service.ts:180`) робить дві речі: створює
`agent_runs` рядки (`:197`) і запускає `void this.executor.executeRuns(...)` (`:212`).
Новий метод виконує ті самі кроки, але **тримає** проміс від `executeRuns`
замість `void`.

Це безпечно, бо `executeRuns` за контрактом **не кидає на per-agent помилках** —
`runOneAgent` персистить статус і ковтає помилку у своєму try/catch
(`run-executor.ts:200-208`), а pre-work-фейл проходить через `failAll` (`:127`) і
теж повертає нормально. Тобто `await executeRuns(...)` резолвиться саме тоді,
коли всі runs дійшли до термінального статусу в БД.

- **Files:** `src/modules/reviews/service.ts` (edit), `src/modules/reviews/run-executor.ts` (без змін)
- **Do:** додати метод:
  ```ts
  async runReviewAndWait(
    workspaceId: string, prId: string, targets: AgentRow[],
    timeoutMs: number, logger?: Logger,
  ): Promise<{ runs: {...}[]; timedOut: boolean; reviews: ReviewDto[] }>
  ```
  Кроки: (1) той самий блок створення `agent_runs`, що у `runReview` — винести
  спільну приватну `createRuns(...)`, щоб не дублювати; (2)
  `await Promise.race([executeRuns(...), sleep(timeoutMs).then(() => TIMEOUT)])`;
  (3) при таймауті — викликати `this.cancelRun(runId)` для кожного runId
  (метод уже є, `service.ts:162`) і повернути `timedOut: true`; (4) після
  завершення — `await this.reviewsForPull(workspaceId, prId)` і відфільтрувати
  за `run_id ∈ runIds` (свіжі reviews цього виклику).
- **Fan-out і таймаут (наслідок рішення зробити `agent` опціональним).** Без
  `agent` цілей може бути N. `JobRunner` має `concurrency: 3` (`platform/jobs.ts:38`),
  але `executeRuns` виконує агентів послідовно, тож 5-хвилинний бюджет ділиться
  між усіма — при 3+ агентах таймаут спрацює з високою ймовірністю і скасує
  ВСІ прогони (див. рішення замовника нижче). Пом'якшення без зміни принципу №1:
  (1) у `run_agent_on_pr` віддавати `agents[]` зі статусом КОЖНОГО прогону, щоб
  модель бачила, хто встиг; (2) текст таймауту для fan-out згадує, що можна
  звузитись до одного агента. **Тексти помилок — у таблиці Step 6.**
- **КРИТИЧНО:** `runReview` лишається БЕЗ ЗМІН у поведінці — HTTP-роут
  `POST /pulls/:id/review` (`routes.ts:68`) і далі повертає одразу. Новий метод
  — додатковий, не заміна. Це те, що не ламає наявні `reviews.it.test.ts`.
- **Done when:** `pnpm test` — 209 герметичних лишаються зеленими; жоден наявний
  тест не змінено.

### Step 5 — `McpToolsService` (layer 4)

- **Files:** `src/modules/mcp-tools/service.ts` (new)
- **Do:** оголосити `McpToolsDeps` (структурні порти, див. constraint 2):
  `agentsRepo`, `reviewRepo`, `conventionsRepo`, `repoRepo`, `reviewRunner`
  (структурний інтерфейс над `ReviewService`), `conventionsReader` (структурний
  над `ConventionsService.view`), `workspaceId: () => Promise<string>`.
  Експортувати `mcpToolsDeps(container)` — фабрика поруч із сервісом, як
  `reviewDeps` (`reviews/service.ts:54`) і `conventionsDeps` (`conventions/service.ts:268`).
  Методи: `listAgents()`, `runAgentOnPr(repo, pr, agent)`, `getFindings(repo, pr, format)`,
  `getConventions(repo)`. Кидають `NotFoundError`/`ValidationError` з
  `platform/errors.ts` — жодних HTTP-кодів.
- **Done when:** `pnpm arch:check` — сумарний рядок не гірший за baseline
  (6 warnings, 0 errors).

### Step 6 — Обгортки інструментів: схеми, описи, annotations, помилки

- **Files:** `src/mcp/tools/list-agents.ts`, `run-agent-on-pr.ts`, `get-findings.ts`,
  `get-conventions.ts`, `get-blast-radius.ts`, `src/mcp/errors.ts` (усі new)
- **Do:** для кожного інструменту — назва, `inputSchema`, `outputSchema`,
  `description`, `annotations`, як нижче.

**Назви — БЕЗ префікса** (`list_agents`, не `devdigest_list_agents`). MCP-клієнти
самі неймспейсять інструменти за іменем сервера (`devdigest`), тож префікс дає
подвійне екранування і з'їдає бюджет 200-400 символів опису. `get_findings` і
`get_conventions` достатньо специфічні в контексті сервера `devdigest`.

> ## ⚠️ ДОСЛІВНІ ТЕКСТИ — КОПІЮВАТИ БЕЗ ЗМІН
>
> Усі рядки в блоках нижче (`description` кожного інструмента і кожен текст
> помилки) — **фінальні**. Під час імплементації вони переносяться в код
> **дослівно**, символ у символ. Не перефразовувати, не «покращувати», не
> перекладати. Кожен формульований так, щоб виконувати конкретне правило
> (таблиця відповідності — наприкінці Step 6).
>
> **Мова — англійська**, як і весь user-facing текст у репозиторії
> (`NotFoundError('Agent not found')` — `agents/routes.ts:85`,
> `ValidationError('Repository has not finished cloning yet')` —
> `conventions/service.ts:85`). Плейсхолдери `<...>` підставляються рантаймом.

**1. `list_agents`** — `inputSchema: {}` (порожній).
`outputSchema: { agents: [{ id, name, provider, model, enabled }] }`
`annotations: { readOnlyHint: true, openWorldHint: false }`

```text
Lists the review agents configured in DevDigest, with their id, name, provider and model. Takes no arguments. Call this FIRST, before run_agent_on_pr, to get a valid agent id — the other tools accept an agent's id, never its name.
```

**2. `run_agent_on_pr`** — `inputSchema: { repo: string, pr: number, agent?: string }` — `agent`
**опціональний** (рішення замовника): без нього прогін усіма `enabled` агентами, як
`all: true` у HTTP (`reviews/routes.ts:58`). Схема лишається плоскою — три поля примітивів.
`outputSchema: { verdict, findings[], agents[], run_status, shown, total, note? }`
`annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }`

```text
Reviews a pull request and WAITS for the run to finish (up to 5 minutes), then returns the finished verdict with the findings. Arguments: repo as "owner/name" or a GitHub URL, pr as the PR number, agent as an id from list_agents — omit agent to run every enabled agent. This is the only tool that spends money.
```

**3. `get_findings`** — `inputSchema: { repo: string, pr: number, response_format?: 'CONCISE' | 'DETAILED' }` (default `CONCISE`).
`outputSchema` той самий, що в `run_agent_on_pr`.
`annotations: { readOnlyHint: true, openWorldHint: false }`

```text
Returns the verdict and findings of a review that ALREADY ran — it starts nothing and spends nothing. Arguments: repo as "owner/name" or a GitHub URL, pr as the PR number, response_format CONCISE (default) or DETAILED. Prefer this over run_agent_on_pr whenever the PR has been reviewed before.
```

**4. `get_conventions`** — `inputSchema: { repo: string }`.
`outputSchema: { conventions: [{ category, rule, evidence_path }], scanned_at, total }`
`annotations: { readOnlyHint: true, openWorldHint: false }`

```text
Returns the coding conventions this repository actually follows — naming, error handling, module layout — extracted from its real code, each backed by a path to the file that evidences it. Argument: repo as "owner/name" or a GitHub URL. Read this before writing code in the repository.
```

**5. `get_blast_radius`** — ЗАГЛУШКА. `inputSchema: { repo: string, pr: number }`.
`annotations: { readOnlyHint: true, openWorldHint: false }`
Реалізація: завжди `toolError('not_implemented', ...)` — текст у таблиці нижче.

```text
STUB: not yet implemented. Will map how far a PR's changes ripple through the rest of the codebase. For now it always returns an error — use get_findings instead to see the concrete problems in the changed code.
```

**Тексти помилок (принцип «помилка веде далі»).** Усі — `isError: true` всередині
`CallToolResult`, ніколи не JSON-RPC protocol error. Дослівні:

| Ситуація | Текст (дослівно) |
|---|---|
| невідомий agent id | `Agent "<id>" was not found. Call list_agents to get the valid agent ids, then retry with one of them.` |
| невідомий repo | `Repository "<repo>" is not connected to DevDigest. Check the "owner/name" spelling, or add the repository in the DevDigest studio at http://localhost:3000.` |
| repo у нерозпізнаному форматі | `Could not read "<input>" as a repository. Expected "owner/name" or a GitHub URL, for example "acme/payments-api" or "https://github.com/acme/payments-api".` |
| PR не імпортовано | `Pull request #<n> was not found in "<repo>". Import it in the DevDigest studio, or check the number — this expects the PR number as shown on GitHub, not an internal id.` |
| `get_findings` без прогонів | `No review has run yet for pull request #<n> in "<repo>". Call run_agent_on_pr with an agent id from list_agents — it runs the review and returns the findings in one call.` |
| таймаут (один агент) | `The review did not finish within 5 minutes and was cancelled; no partial results were saved. Retry, or pick a faster model — list_agents shows the model behind each agent.` |
| таймаут (fan-out) | `<k> of <N> agents did not finish within 5 minutes, so all runs were cancelled. Call run_agent_on_pr again with a single agent id from list_agents — one agent fits the 5-minute budget.` |
| провал прогону | `The review failed: <error>. Call list_agents to check the agent's provider and model; if its API key is missing, add it in the DevDigest studio settings.` |
| `get_blast_radius` | `STUB: get_blast_radius is not implemented yet. Use get_findings on the same pull request — it shows the concrete problems in the changed code.` |

**Як кожен текст виконує правило** (перевірка при рев'ю імплементації):

| Правило | Де саме виконано |
|---|---|
| Принцип №4 «помилка веде далі» | у КОЖНОМУ з 9 текстів названо наступний інструмент або конкретну дію; жоден не закінчується констатацією провалу |
| Принцип №1 «результат, а не операція» | `run_agent_on_pr`: слово `WAITS` капсом — модель не шукає окремий status-tool |
| Принцип №2 «плоскі аргументи» | описи перелічують аргументи як прості значення (`repo as "owner/name"`, `pr as the PR number`) |
| Принцип №3 «стисла відповідь» | `get_findings`: `response_format CONCISE (default)` названо просто в описі |
| «коли обрати саме цей інструмент» | `list_agents` → `Call this FIRST`; `get_findings` → `Prefer this over run_agent_on_pr whenever…`; `get_conventions` → `Read this before writing code` |
| Економічний сигнал під permission prompt | `run_agent_on_pr` → `the only tool that spends money`; `get_findings` → `spends nothing` |
| Заглушка не марнує токенів | `get_blast_radius`: `STUB:` — перші 5 символів опису, тож модель відсіює його ще на етапі вибору |
| Довжина 200-400 символів | **заміряно 2026-08-11:** `list_agents` 232 · `run_agent_on_pr` 312 · `get_findings` 295 · `get_conventions` 289 · `get_blast_radius` 213 — усі в межах. Якщо текст правлять, переміряти |

- **Do (окремо):** якщо оголошено `outputSchema` — обгортка **зобов'язана**
  повернути `structuredContent` І продублювати той самий JSON у `TextContent`
  (клієнти без підтримки structuredContent інакше побачать порожньо).
- **Done when:** `pnpm typecheck` без нових помилок; кожен `description` і кожен
  текст помилки збігається з текстом вище **символ у символ** (довжини вже
  заміряно — переміряти лише якщо текст правили).

### Step 7 — Entrypoint, реєстрація, конфіг запуску

- **Files:** `src/mcp-server.ts` (new), `src/mcp/server-factory.ts` (new),
  `package.json` (edit), `.mcp.json` у корені репо (new)
- **Do:**
  - `server-factory.ts`: `createMcpServer(deps)` реєструє 5 інструментів у
    порядку `TOOL_NAMES` (детермінований `tools/list`).
  - `mcp-server.ts`: `loadConfig()` → `createDb()` → `new Container(config, db)`
    → `mcpToolsDeps(container)` → `createMcpServer` → stdio-транспорт.
    **Логи ТІЛЬКИ у stderr** — stdout зайнятий JSON-RPC кадрами, будь-який
    `console.log` ламає протокол. Graceful shutdown на SIGTERM/SIGINT із
    закриттям пулу postgres (дзеркалить `server.ts:12-26`).
  - `package.json`: `"mcp": "tsx src/mcp-server.ts"`.
  - `.mcp.json` у корені репо:
    ```json
    { "mcpServers": { "devdigest": {
        "command": "pnpm", "args": ["--dir", "server", "mcp"] } } }
    ```
    У `README.md` сервера дописати альтернативу для Claude Desktop
    (`claude_desktop_config.json`, той самий блок) і **вимогу: спершу
    `pnpm db:migrate` + `pnpm db:seed`** — міграції не біжать на бутстрапі, а
    `LocalNoAuthProvider` кидає `'No default workspace found — run pnpm db:seed.'`
    без сіду.
- **Done when:** `pnpm mcp` стартує, не пише нічого в stdout до першого
  JSON-RPC кадру, і відповідає на `tools/list` п'ятьма інструментами у
  сталому порядку.

  **Реалізація 2026-08-12:** `.mcp.json` у корені репозиторію (поза `server/`)
  СВІДОМО НЕ створено — виконавцю було доручено працювати ВИКЛЮЧНО в `server/`.
  Замість цього JSON-блок для `.mcp.json`/`claude_desktop_config.json`
  задокументовано в `server/README.md`, розділ «MCP server», для ручного
  копіювання. Це єдина розбіжність зі Step 7 в цьому плані; усе інше зі
  списку `Files`/`Do` реалізовано як описано. `pnpm mcp` перевірено
  end-to-end без реального Postgres: `createMcpServer` + `InMemoryTransport`
  підтвердили 5 інструментів у сталому порядку, коректні annotations,
  `structuredContent`+`TextContent` для кожного, і `isError:true` тексти —
  живий запуск `npx tsx src/mcp-server.ts` підтвердив мовчазний stdout (жодних
  байтів до JSON-RPC кадру), але не міг завершити рукостискання, бо Docker/
  Postgres недоступні в цьому середовищі (як і передбачено в дорученні).

### Step 8 — Тести

- **Files:** `test/mcp-helpers.test.ts` (new), `test/mcp-tools.test.ts` (new),
  `test/mcp-tools.it.test.ts` (new)
- **Do:** див. `Test strategy` нижче.
- **Done when:** дельта тестів відповідає очікуваній (+18…24 герметичних).

### Step 9 — Фінальний прохід

- **Do:** перечитати прозу Steps 1-8 у цьому файлі й виправити твердження, які
  Step 1 зробив несвіжими (обраний пакет SDK і шлях схем A/B/C згадані у Steps 6-7).
  Оновити `Status` на `done`. Якщо спливло щось несподіване — записати в
  `server/INSIGHTS.md` через скіл інсайтів.

## Test strategy

**Герметичні** (`test/*.test.ts`, без Docker):

- `mcp-helpers.test.ts` (~12): `compactFinding` віддає рівно 6 полів і не тягне
  `evidence`/`trifecta_components`; обрізання `rationale` на 400; `deriveVerdict`
  за гейтом агента, не за self-reported verdict; `truncateFindings` формує
  note при перевищенні і не формує при рівності ліміту; `normalizeRepo` — таблиця
  кейсів: `"owner/name"`, `https://github.com/owner/name`,
  `github.com/owner/name`, URL із `/pull/42`, `.git`, trailing slash — усі в
  `"owner/name"`; `"payments-api"` без owner і порожній рядок → `undefined`.
- `mcp-tools.test.ts` (~10-14): `McpToolsService` з мок-портами (звичайні
  об'єкти — ніякої БД, це і є сенс explicit-ports DI). Покриває: невідомий
  агент → `isError` і текст містить `list_agents`; невідомий repo; PR без
  прогонів; `get_blast_radius` завжди `isError:true` і його текст починається з
  `STUB:`; `tools/list` повертає рівно 5 інструментів у сталому порядку; кожен
  інструмент має очікувані annotations; при оголошеному `outputSchema` відповідь
  містить і `structuredContent`, і `TextContent`.
  **Тексти асертяться на підрядок** (`toContain('list_agents')`), а не на повний
  збіг рядка — інакше кожне майбутнє редагування копірайту ламає тест. Дослівність
  забезпечує рев'ю за таблицею Step 6, не асерт.

**Інтеграційні** (`test/mcp-tools.it.test.ts`, +2-3, **потребує Docker** —
пропускається, коли Docker недоступний): `runReviewAndWait` із `MockLLMProvider`
доходить до термінального статусу і повертає findings у межах одного виклику;
таймаут (`timeoutMs: 50`) скасовує прогін і віддає `timedOut: true`.

**Обов'язково:** будь-який тест із БД називається `*.it.test.ts`, інакше він
потрапляє в герметичний набір. Кожен `.it.test.ts` спершу викликає `await seed(db)`
і читає seeded workspace через `eq(t.repos.fullName, 'acme/payments-api')` —
`LocalNoAuthProvider` резолвить лише seeded default workspace за назвою, тож
власноруч вставлений рядок `workspaces` дає фікстуру, до якої тест не дістанеться
(див. `server/INSIGHTS.md`).

**Очікувана дельта:** 209 → 231…237 герметичних (23 → 25 файлів).

## Verification plan

**Baseline — ЗАМІРЯНО 2026-08-11** (судити за дельтою, не за exit code):
- `cd server && pnpm typecheck` → **2 передіснуючі** помилки TS2345
  (`src/db/migrate.ts:38`, `src/db/seed.ts:499`). ✅ підтверджено.
- `cd server && pnpm arch:check` → `x 6 dependency violations (0 errors, 6 warnings).
  156 modules, 490 dependencies cruised.` ✅ підтверджено.
- `cd server && pnpm test` → **256 passed | 57 skipped (313), 25 files passed |
  10 skipped (35)**, ~91 s.
  ⚠️ **Кореневий `CLAUDE.md` каже «209 hermetic (23 files)» — це застаріло.**
  Реально 24 герметичні файли + 10 `.it.test.ts` (пропускаються без Docker).
  Судити за **256**, а не за 209. Розбіжність зафіксувати в `CLAUDE.md`
  окремо від цієї роботи (не в межах цього плану).

| When | Command | Run from | Pass criterion |
|---|---|---|---|
| Step 1 | `npm view @modelcontextprotocol/server@2 dependencies` | `server/` | зафіксовано версію + вимогу до zod; обрано шлях A/B/C |
| після 2, 4, 5 | `pnpm typecheck` | `server/` | рівно 2 помилки, обидві ті самі (migrate.ts:38, seed.ts:499); жодного `error TS` у нових файлах |
| після 5 і 7 | `pnpm arch:check` | `server/` | сумарний рядок ≤ `6 warnings, 0 errors`. **Не** судити за exit code — він 0 і при порушеннях. Не пайпити у `tail`/`head` — губиться код виходу |
| після 4 | `pnpm test` | `server/` | ≥ 209 passed, 0 failed — жоден наявний тест не зламано |
| після 8 | `pnpm test` | `server/` | 231…237 passed (25 files), 0 failed |
| після 7 | `pnpm mcp` + `tools/list` | `server/` | 5 інструментів, сталий порядок, stdout чистий до першого JSON-RPC кадру |
| фінал | `git diff --stat -- src/vendor/shared` | `server/` | **порожньо** — контракти не змінювались, двофайлове редагування не потрібне |

## Acceptance

- [ ] `list_agents` без аргументів повертає id/назви/моделі агентів workspace.
- [ ] `run_agent_on_pr("owner/name", 42, "<id>")` в ОДНОМУ виклику повертає
      `{verdict, findings[]}` завершеного рев'ю — без job-id і без полінгу.
- [ ] `run_agent_on_pr` БЕЗ `agent` запускає всіх `enabled` агентів і повертає
      `agents[]` зі статусом кожного прогону.
- [ ] `repo` приймається і як `"owner/name"`, і як GitHub URL; нерозпізнане
      значення дає `isError:true` з текстом про очікуваний формат.
- [ ] Виклик із неіснуючим `agent` дає `isError:true` з текстом, що містить
      `list_agents`, і НЕ JSON-RPC protocol error.
- [ ] `get_blast_radius` зареєстрований, його опис починається з `STUB:`, і він
      завжди повертає `isError:true` з відсиланням до `get_findings`.
- [ ] Кожен із 5 інструментів має annotations рівно за таблицею Step 6.
- [ ] Усі 5 `description` і всі 9 текстів помилок збігаються з дослівними
      блоками Step 6 **символ у символ** — англійською, без перефразувань.
      Тексти помилок — єдиним місцем у `src/mcp/` (не розсипані по сервісу).
- [ ] `get_findings` за замовчуванням `CONCISE`; при >20 findings у відповіді є
      note «показано N з M».
- [ ] `runReview` (fire-and-forget) поведінково не змінився — наявні тести
      `reviews.it.test.ts` зелені без правок.
- [ ] Таймаут 5 хв скасовує прогони через наявний `cancelRun` і повертає
      `timedOut: true` з текстом, що веде далі.
- [ ] `pnpm arch:check` не перевищує baseline; `src/modules/mcp-tools/service.ts`
      не має жодного імпорту `Container`/`db/**`/`fastify`/`@modelcontextprotocol/*`.
- [ ] Жоден Drizzle-рядок (`AgentRow`, `ReviewRow`, `FindingRow`, `PullRow`) не
      з'являється у публічних сигнатурах `McpToolsService` і ніде в `src/mcp/**`
      (constraint 7). Перевірка:
      `grep -rn "AgentRow\|ReviewRow\|FindingRow\|PullRow" src/mcp/ src/modules/mcp-tools/` →
      порожньо.
- [ ] `server/src/vendor/shared/` не змінено.

## Out of scope

- Реалізація `get_blast_radius` (окрема майбутня робота).
- Remote MCP, OAuth, Streamable HTTP, автентифікація.
- MCP resources і prompts — лише tools.
- Мультиворкспейсність MCP-сесії (працює лише seeded default workspace).
- UI у `client/` для керування MCP.
- Оновлення zod 3 → 4 у `server/`.

## Open questions

1. **Версія SDK і шлях передачі схем (A/B/C).** **ЧАСТКОВО ВИРІШЕНО 2026-08-11
   замірами:**
   - `@modelcontextprotocol/server@2.0.0` → `zod ^4.2.0` (конфлікт підтверджено).
   - `@modelcontextprotocol/sdk@1.30.0` → `zod '^3.25 || ^4.0'` — **сумісний**.
   - Фактично встановлений у `server/node_modules` zod — **3.25.76**, і він
     **має `~standard`** (`vendor: 'zod', version: 1`), тобто Standard Schema
     працює вже зараз, без бампа `package.json`.
   - ⚠️ Розбіжність: `package.json:43` декларує `^3.24.1`, а lock дає 3.25.76.
     `^3.24.1` формально дозволяє 3.25.x, тож `sdk@1.30` встановиться, але
     декларований діапазон **ширший** за вимогу SDK. Якщо йдемо шляхом C —
     підняти декларацію до `^3.25.0`, щоб свіжий `pnpm install` не дав 3.24.x.
   *Лишилось перевірити в Step 1:* чи приймає обраний SDK zod-3-схему через
   Standard Schema на практиці (пробний `registerTool`). Дефолт — **C**
   (`sdk@1.30`, вже сумісний із zod 3), бо він не тягне другу копію zod.

   **ВИРІШЕНО 2026-08-12 (Step 1, емпірично):** SDK: `@modelcontextprotocol/sdk@1.30.0`,
   шлях схем: **C** (по суті ідентичний до "A" з погляду коду — zod-3-схеми напряму,
   без ручного JSON Schema). `pnpm add @modelcontextprotocol/sdk@^1.30` встановив
   РІВНО одну копію zod у дереві: `pnpm ls zod --depth=2` показує `zod@3.25.76`
   як **peer**-залежність SDK, дедуплікований з `fastify-type-provider-zod` та
   `openai` — жодної вкладеної другої копії. `package.json`'s `zod: ^3.24.1`
   лишено БЕЗ ЗМІН (не піднято до `^3.25.0`) — `pnpm add` не зачепив декларацію,
   і оскільки шлях зрештою той самий SDK/zod-3, ризик формально ширшого діапазону
   (з Кроку 1 вище) прийнятний без правки.

   Реальний API `@modelcontextprotocol/sdk@1.30.0` (перевірено читанням
   `.d.ts` + робочим пробним скриптом з `InMemoryTransport`, СУТТЄВО відрізняється
   від того, що план описував як "SDK", і від monolithic-server API з Кроку 1's
   гіпотези):
   - Клас `McpServer` (`server/mcp.js`), метод `registerTool(name, config, cb)`.
     `config.inputSchema` / `config.outputSchema` — це **`ZodRawShapeCompat`**,
     тобто `Record<string, ZodType>` (плаский об'єкт полів, як
     `{ text: z.string() }`), **НЕ** `z.object({...})` і не сирий JSON Schema.
     Типи в `zod-compat.d.ts` явно імпортують `zod/v3` і `zod/v4/core` —
     офіційно підтримує ОБИДВІ мажорні версії одночасно через Standard Schema.
   - `cb: (args, extra) => CallToolResult | Promise<CallToolResult>` — `args` вже
     розпарсені й типізовані з `inputSchema`. Валідація вхідних аргументів
     робиться ВСЕРЕДИНІ SDK (`validateToolInput`) — при провалі SDK САМ формує
     `CallToolResult` із `isError: true` і текстом
     `MCP error -32602: Input validation error: ...` (підтверджено пробним
     викликом через `client.callTool` з невалідним аргументом) — це НЕ JSON-RPC
     protocol error і не виняток, що долітає до нашого коду. Так само виклик
     неіснуючого інструмента дає `isError:true` з текстом `Tool X not found`,
     не protocol-level throw.
   - `CallToolResult` = `{ content: (TextContent | ...)[], structuredContent?:
     Record<string, unknown>, isError?: boolean }`; `TextContent` =
     `{ type: 'text', text: string, annotations?, _meta? }`.
   - Транспорт: `StdioServerTransport` з `@modelcontextprotocol/sdk/server/stdio.js`
     (конструктор без аргументів = читає `process.stdin`/пише `process.stdout`);
     підключення — `await mcpServer.connect(transport)`.
   - `tools/list` автоматично серіалізує `inputSchema`/`outputSchema` у справжній
     JSON Schema (draft-07) — підтверджено пробним `client.listTools()`.
   Наслідок для Step 6: `inputSchema`/`outputSchema` у файлах `src/mcp/tools/*.ts`
   пишуться як `{ field: z.string(), ... }` (raw shape), не `z.object({...})`.
2. ~~**`repo` як "owner/name" vs URL.**~~ **ВИРІШЕНО 2026-08-11 (замовник):**
   приймаємо ОБИДВА формати. `normalizeRepo()` у Step 3, текст помилки для
   нерозпізнаного формату — у Step 6.
3. ~~**Поведінка `run_agent_on_pr` без `agent`.**~~ **ВИРІШЕНО 2026-08-11
   (замовник):** `agent` **опціональний**; без нього — прогін усіма `enabled`
   агентами. Ризик прийнято свідомо: 5-хвилинний бюджет ділиться між агентами,
   тож на 3+ агентах таймаут імовірний і скасовує ВСІ прогони. Пом'якшення
   (`agents[]` зі статусом кожного + окремий текст таймауту для fan-out) — Step 4
   і Step 6. Таймаут лишається 5 хв і при спрацюванні скасовує прогони — теж
   рішення замовника.
4. **Чи має MCP-сервер піднімати власне з'єднання з БД, чи вимагати запущений
   API на :3001.** План обрав власне з'єднання (`createDb` у `mcp-server.ts`) —
   менше рухомих частин, MCP працює без запущеної студії. *Припущення:* так;
   ціна — два процеси тримають окремі пули postgres до однієї БД, що для
   локального сценарію нормально.
