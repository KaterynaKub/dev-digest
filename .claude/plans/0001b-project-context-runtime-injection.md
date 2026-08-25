# 0001b — Project Context: ін'єкція у ран, бюджет і трасування

**Status:** approved
**Date:** 2026-08-24
**Mode:** single-agent
**Touches:** `server/src/modules/reviews/run-executor.ts` · `server/src/vendor/shared/contracts/trace.ts` (×2) · `server/src/platform/trace-builder.ts` · `server/src/modules/reviews/routes.ts`

## Prerequisites

`0001a` має бути в дереві. Одна команда підтвердження:

```
cd server && node -e "const a=require('fs').readFileSync('src/vendor/shared/adapters.ts','utf8'); process.exit(a.includes('interface Tokenizer')&&a.includes('listFiles')?0:1)" && echo OK
```

Плюс: `ls src/modules/project-context/service.ts` існує, і `pnpm arch:check`
показує `x 6 dependency violations (0 errors, 6 warnings)`.

## Requirements

Джерело: `docs/specs/SPEC-01-project-context-folder.md` (**Status: approved**).
Ця частина: AC-24…AC-36, AC-38…AC-43, AC-48, AC-49, AC-51, AC-56,
NFR-4, NFR-6, NFR-8, NFR-10, NFR-17, NFR-24. Клієнтський рендер збагаченого
`specs_read` — `0001c`.

## Requirements review

- **`reviewer-core` вже застосовує політику довіри до `specs`** — `[recommended]`
  `prompt.ts:123-125` робить `wrapUntrusted('spec-N', s)` сам, на відміну від
  `skills`/`intent`, які приходять загорнутими (`run-executor.ts:290-292`). Отже
  екзекутор передає **сирий** текст: подвійна обгортка порушила б AC-41 («exact
  text injected» — один рівень делімітерів, не два).
  **Наслідок: `reviewer-core` не потребує змін узагалі** — слот, рендер секції,
  омісія на порожньому слоті (AC-28) і нейтралізація `</untrusted>` (AC-49,
  `prompt.ts:45`) вже є. Цей план не торкається жодного файлу в `reviewer-core/`.
- **Порядок AC-33 і AC-49 специфікація не називає** — `[recommended]`
  Усічення робить екзекутор, нейтралізацію — `wrapUntrusted` після нього. Різ
  посеред літерала `</untrusted>` лишає нешкідливий залишок, тож порядок
  безпечний; але маркер усічення мусить бути **всередині** обгортки (AC-33), а
  отже дописується до тексту **до** передачі.
- **AC-34 не уточнює, чи бюджет рахується до чи після обгортки** — `[proceeding as asked]`
  Рахую по **сирому тексту**: обгортка додає ~10 токенів на документ, шум < 0.5 %.
  Записати в коментар коду, щоб наступний автор не «виправив» на іншу інтерпретацію.
- **Зворотна сумісність `specs_read` не має захисту на сервері** — `[recommended]`
  `run.repo.ts:217` — сирий каст `row.trace as RunTrace`, без `.parse`. Маршрут
  (`reviews/routes.ts:152-157`) не оголошує response-схему, `hooks/trace.ts` теж
  кастить. Жоден шар не валідує, тож розширення **не впаде на сервері** — воно
  зламається в рендері (`TraceBody.tsx:41-44`, ітерує по голих рядках). Тягар
  сумісності повністю на клієнті (`0001c`); контракт мусить приймати обидві форми.
- **NFR-6 і AC-35 — різні стани, і трасі потрібні обидва** — `[proceeding as asked]`
  AC-35 — один документ не прочитався (per-doc `missing`). NFR-6 — читач упав
  цілком. Додаю `specs_reader_error` окремим nullish-полем.

## Problem

`run-executor.ts:372` і `:580` хардкодять `specs_read: []`, і `reviewPullRequest`
ніколи не отримує `specs`, тож секція `## Project context` мертва в кожному рані.
`RunTrace.specs_read` — `z.array(z.string())` (`trace.ts:103`, обидві копії),
тобто голий шлях: усічений, скинутий за бюджетом і відсутній документ виглядають
однаково — дефект, який D-13 назвав робить трасу оманливою рівно тоді, коли щось
пішло не так.

## Approach

Уся логіка живе в **екзекуторі**, не в маршруті — тоді MCP `run_agent_on_pr`
отримує її автоматично (AC-31): `mcp-tools/service.ts:92` тримає порт
`ReviewRunner`, який веде в той самий `ReviewRunExecutor`.

Новий приватний метод `buildProjectContext(agent, workspaceId, repo, runLog)`
за формою `buildSkillBodies` (`run-executor.ts` — той самий best-effort шаблон:
`try/catch` → `undefined` → секція опускається). Він читає впорядкований
дедуплікований набір через `ProjectContextRepository.listForAgentWithSkills`
(доданий у `0001a`), читає тексти, застосовує усічення й бюджет, і повертає
**дві** речі: `specs: string[]` (сирий текст для `reviewPullRequest`) і
`specsRead: ContextDocRead[]` (для траси).

`RunTrace.specs_read` стає union: `z.array(z.union([z.string(), ContextDocRead]))`.
Union, а не `.nullish()`-поля, бо старі елементи — примітивні рядки, а не
об'єкти з відсутніми ключами; це та сама логіка, що зробила `RunStats.cost_usd`
`nullish()`, застосована на рівень вище.

## Affected packages and modules

| Package | Path | What changes | Layer |
|---|---|---|---|
| server | `src/vendor/shared/contracts/trace.ts` | `ContextDocRead`; `specs_read` → union; `specs_reader_error` | 1 |
| client | `src/vendor/shared/contracts/trace.ts` | те саме, дзеркально | 1 |
| server | `src/modules/reviews/run-executor.ts` | `ReviewRunDeps` +2 порти; `buildProjectContext`; передача `specs`; заповнення `specs_read` в обох місцях (`:372`, `:580`) | 4 |
| server | `src/modules/reviews/routes.ts` | зібрати нові `deps` | 5 |
| server | `src/platform/trace-builder.ts` | тип `specsRead` розширено | 5 |
| server | `src/mcp-server.ts` / `src/modules/mcp-tools/service.ts` | тільки якщо `ReviewRunner` будується з `reviewDeps` — перевірити, зміни може не бути | 4/5 |
| reviewer-core | — | **без змін** (див. Requirements review) | — |

Контракт `trace.ts` вендоровано двічі — двофайлова правка, перевірка `diff`-ом.

## Architectural constraints

- Уся нова логіка — в `run-executor.ts`, який `arch:check` трактує як шар 4
  разом із `service.ts` (`from: ^src/modules/[^/]+/(service|run-executor)\.ts$`).
  Отже: **жодного** імпорту `src/adapters/**` (`service-no-concrete-adapters`,
  warn), `src/db/**` (`service-no-sql`, **error**), `src/platform/container.ts`
  (`service-no-container`, **error**).
- `ProjectContextRepository` імпортується **як тип**, і лише репозиторій — не
  `project-context/service.ts`. Крос-модульний імпорт `service.ts` — це
  `no-cross-module-service`, severity **error**. Прецедент уже стоїть у файлі:
  `SkillsRepository` імпортується так само (`run-executor.ts:23` з поясненням
  у коментарі). Повторити ту саму форму й той самий коментар.
- `Tokenizer` береться **тільки** з `@devdigest/shared` (порт із `0001a`), не з
  `../../adapters/tokenizer/index.js`.
- `reviewer-core` лишається чистим рендерером: жодних `fs`, `db`, `fastify`.
  Цей план його не торкається.
- NFR-17: у лог ідуть шлях, розмір і лічильники. **Ніколи** текст документа —
  ані в `runLog.info`, ані в `logger.debug`.

Enforced by: `cd server && pnpm arch:check` — ціль незмінна, `6 warnings / 0 errors`.

## Implementation steps

### Step 1 — Контракт `ContextDocRead` (двофайлова правка)
- **Files:** `server/src/vendor/shared/contracts/trace.ts`, `client/src/vendor/shared/contracts/trace.ts`
- **Do:** Перед `RunTrace` додати:
  ```ts
  export const ContextDocStatus = z.enum(['injected', 'truncated', 'dropped_budget', 'missing']);
  export const ContextDocRead = z.object({
    path: z.string(),
    tokens: z.number().int(),           // AC-39 — заміряно в цьому рані
    status: ContextDocStatus,           // AC-56
    origin: z.enum(['agent', 'skill']), // AC-40
    skill_name: z.string().nullish(),   // назва скіла для origin='skill'
  });
  ```
  У `RunTrace` замінити `specs_read: z.array(z.string())` на
  `specs_read: z.array(z.union([z.string(), ContextDocRead]))` і додати
  `specs_reader_error: z.string().nullish()` (NFR-6).
  Коментар над полем **обов'язковий**: пояснити, що голий `string` — це форма
  трас, збережених до цієї фічі, що жоден шар не парсить трасу
  (`run.repo.ts:217` — сирий каст, `hooks/trace.ts` — теж), і що рендер мусить
  розрізняти обидві форми. Той самий текст — у клієнтську копію.
- **Done when:** `diff server/src/vendor/shared/contracts/trace.ts client/src/vendor/shared/contracts/trace.ts` порожній; `pnpm typecheck` в обох пакетах не додав помилок понад базову лінію.

### Step 2 — `buildProjectContext` в екзекуторі
- **Files:** `server/src/modules/reviews/run-executor.ts`
- **Do:** Розширити `ReviewRunDeps`:
  ```ts
  /** Read-only: agent + inherited-skill context attachments, in persisted order. */
  contextRepo: ProjectContextRepository;
  tokenizer: Tokenizer;
  ```
  (Той самий коментар-виправдання крос-модульного імпорту репозиторію, що й у
  `skillsRepo` вище.) Додати приватний метод:
  ```
  buildProjectContext(agent, workspaceId, repo, runLog):
    Promise<{ specs?: string[]; specsRead: ContextDocRead[]; readerError?: string }>
  ```
  Алгоритм, у цьому порядку:
  1. `contextRepo.listForAgentWithSkills(workspaceId, agent.id)` — вкладення
     агента в persisted order, далі успадковані від **enabled** пов'язаних
     скілів у порядку `agent_skills.order` (AC-25, AC-29). Кидок → повернути
     `{ specsRead: [], readerError: msg }`, ран продовжується (NFR-6).
  2. Дедуплікація по шляху, перше входження виграє, пізніші відкидаються
     (AC-26, AC-42). Використати `dedupeByPath` з `project-context/helpers.ts`.
  3. Для кожного: `git.readFile(ref, path)` у `try/catch`. Кидок **або**
     порожній результат → `status: 'missing'`, `tokens: 0`, документ не
     потрапляє в промпт, ран живе (AC-35, AC-36).
  4. `text.length > MAX_DOC_CHARS` (150 000) → зріз + рядок-маркер усічення,
     дописаний до тексту **до** передачі, щоб `wrapUntrusted` накрив і його
     (AC-33). `status: 'truncated'`.
  5. Бюджет: накопичувати `deps.tokenizer.count(text)` по сирому тексту; коли
     сума перевищила `MAX_CONTEXT_BLOCK_TOKENS` (40 000), **кожен наступний**
     документ (від хвоста послідовності) отримує `status: 'dropped_budget'` і
     не йде в промпт. Викидаються цілі документи, ніколи не частина (AC-34).
  6. Повернути `specs` (сирі тексти вцілілих, у порядку) та `specsRead` (**усі**
     вкладення, включно з missing і dropped — AC-56 вимагає статусу для кожного
     вкладеного, не лише для інжектованих).
  7. `runLog.info` з лічильниками read / missing / truncated / dropped
     (NFR-10). Без тексту документів (NFR-17).
  **Не** гейтити на `agent.repoIntel` — виклик стоїть поряд із `buildSkillBodies`
  (`run-executor.ts:263`), який теж не гейтиться, з тим самим поясненням
  «orthogonal to repo-intel» (AC-30).
- **Done when:** метод компілюється; `arch:check` = 6/0.

### Step 3 — Передати `specs` у `reviewPullRequest` і в трасу
- **Files:** `server/src/modules/reviews/run-executor.ts`
- **Do:** Поряд із `const skills = await this.buildSkillBodies(...)` (`:263`)
  додати `const projectContext = await this.buildProjectContext(...)`.
  У виклик `reviewPullRequest` додати, у тій же формі omit-when-empty, що й
  сусіди:
  ```ts
  // Attached project-context documents — RAW text. `assemblePrompt` wraps each
  // element via wrapUntrusted('spec-N', …) itself (reviewer-core/src/prompt.ts:125),
  // unlike `skills`/`intent` which arrive pre-wrapped. Do NOT wrap here — that
  // would nest the delimiters twice.
  ...(projectContext.specs?.length ? { specs: projectContext.specs } : {}),
  ```
  У `const trace: RunTrace` (`:345`) замінити `specs_read: []` на
  `specs_read: projectContext.specsRead` і додати
  `specs_reader_error: projectContext.readerError ?? null`.
  У `traceFromBuffer` (`:555`, фейл/кенсел-шлях, `specs_read: []` на `:580`)
  лишити `[]` — ран, що впав до збірки контексту, справді нічого не прочитав;
  додати `specs_reader_error: null` для форми.
  Порожній набір → `specs` не передається → `assemblePrompt` опускає секцію
  цілком, без порожнього заголовка (AC-28, `prompt.ts:146`).
- **Done when:** інтеграційний тест бачить `## Project context` у
  `prompt_assembly.user` для агента з вкладеннями і **не** бачить для агента без.

### Step 4 — Зібрати нові `deps` і вирівняти CI-шлях
- **Files:** `server/src/modules/reviews/routes.ts`, `server/src/platform/trace-builder.ts`, `server/src/mcp-server.ts` (перевірити)
- **Do:** У фабриці `reviewDeps` (у `routes.ts`) додати
  `contextRepo: container.projectContextRepo` і `tokenizer: container.tokenizer`.
  У `trace-builder.ts:52` розширити тип поля `specsRead` до
  `(string | ContextDocRead)[]` — CI-шлях свого набору поки не будує і передає
  порожній масив; це лише вирівнювання типу, не нова поведінка.
  **Перевірити**, чи `mcp-server.ts:46-47` будує `ReviewRunner` через ту саму
  фабрику; якщо він конструює `ReviewRunExecutor` окремо — додати ті самі два
  порти там, інакше MCP-ран отримає `undefined` і впаде (AC-31).
- **Done when:** `pnpm exec vitest run mcp-tools` зелений; ручний MCP-виклик
  `run_agent_on_pr` на агенті з вкладеннями дає трасу з непорожнім `specs_read`.

### Step 5 — Тести
- **Files:** `server/test/project-context-prompt.it.test.ts` (new), `server/test/project-context-budget.test.ts` (new)
- **Do:** Герметичні (`project-context-budget.test.ts`, чисті функції +
  `MockTokenizer`): порядок і дедуплікація (AC-25, AC-26, AC-42) — включно з
  кейсом «той самий документ вкладено і в агента, і в його скіл» та «в два різні
  скіли»; усічення на 150 000 із видимим маркером усередині обгортки (AC-33);
  бюджет — цілі документи з хвоста, ніколи частина (AC-34); детермінізм — той
  самий набір дає побайтово однаковий блок (NFR-8).
  Інтеграційні (`project-context-prompt.it.test.ts`, за зразком
  `skills-in-prompt.it.test.ts` — найближчий прецедент асерту на зібраний
  промпт; **починати з `await seed(db)`**): секція присутня/відсутня (AC-27,
  AC-28); незалежність від `repo_intel:false` (AC-30); вимкнений скіл не
  віддає документів (AC-29); траса несе шлях, токени, статус і origin зі
  skill_name (AC-38…AC-40, AC-56); рівно один `completeStructured` — вкладення
  не додають модельного виклику (AC-32, той самий прийом, що в
  `conventions.it.test.ts`); **AC-36 у двох формах** — один кейс з
  `MockGitClient`, що повертає `''`, і другий зі стабом, що **кидає**; NFR-6 —
  падіння читача цілком лишає ран успішним із записаною причиною.
- **Done when:** обидві смуги зелені, кожна прогнана окремо.

### Step 6 — Прибрати застарілу прозу попередніх хвиль
- **Files:** `server/src/modules/reviews/run-executor.ts`, `reviewer-core/src/prompt.ts`, `reviewer-core/src/review/run.ts`, `server/src/modules/project-context/CLAUDE.md` (new)
- **Do:** Прогрепати весь діф на `later wave`, `not yet`, `will eventually`,
  `TODO once`, «permanently empty», «inert» — записана пастка кореневого
  `INSIGHTS.md`. Конкретно: `prompt.ts:67` («Project-context spec chunks
  (untrusted content)») і `run.ts:65` тепер мають живого постачальника —
  оновити коментарі так, щоб вони називали `run-executor.ts#buildProjectContext`
  і **явно зафіксували**, що `specs` (на відміну від `skills`/`intent`)
  загортається саме тут, у `prompt.ts`. Написати
  `modules/project-context/CLAUDE.md` за формою сусідніх модулів, з трьома
  правилами: сирий текст у `specs`, ліміт 20 валідується в сервісі поза шляхом
  версіонування, `specs_read` — union зі старою формою.
- **Done when:** `git diff main -- server reviewer-core | grep -nE 'later wave|not yet|will eventually|TODO once'` порожній.

## Verification plan

| When | Command | Run from | Pass criterion |
|---|---|---|---|
| перед стартом | `pnpm typecheck > tc-base.log 2>&1; echo "exit=$?"` | `server/` | 2 передіснуючі помилки |
| перед стартом | `pnpm arch:check > arch-base.log 2>&1; grep 'dependency violations' arch-base.log` | `server/` | `x 6 dependency violations (0 errors, 6 warnings)` |
| після Step 1 | `diff server/src/vendor/shared/contracts/trace.ts client/src/vendor/shared/contracts/trace.ts` | repo root | нульовий вивід |
| після Step 1 | `pnpm typecheck` | `client/` | exit 0 — клієнт компілюється проти union ще до змін рендеру |
| після Steps 2, 3 | `pnpm arch:check > arch.log 2>&1; grep 'dependency violations' arch.log` | `server/` | **точно** 6 warnings / 0 errors — імпорт `project-context/service.ts` замість репозиторію дав би `error`, а він **не** росте в кількості warnings і легко пропускається |
| після Steps 2, 3 | `pnpm typecheck > tc.log 2>&1; grep -c 'error TS' tc.log` | `server/` | рівно 2 |
| після Step 5 | `pnpm exec vitest run --exclude '**/*.it.test.ts'` | `server/` | ≥ 209 + нові, 0 failed |
| після Step 5 | `pnpm exec vitest run .it.test` | `server/` | окремо; без Docker набір скіпається — це не «зелено» |
| після Step 5 | `pnpm exec vitest run --exclude '**/*.it.test.ts'` | `reviewer-core/` | 34 passed / 4 files — незмінно, план цей пакет не чіпає |
| фінал | `pnpm arch:check` · `pnpm exec vitest run --exclude '**/*.it.test.ts'` · `pnpm exec vitest run .it.test` | `server/` | три окремі команди, жодного пайпа в `tail`/`head` |

Baseline to record before starting: 2 typecheck errors; `6 warnings / 0 errors`;
209 hermetic / 23 files (server), 34 / 4 (reviewer-core).

**Пастка, яку цей план мусить не проспати:** тест «реплей минулого рану» не
відтворить його проєктний контекст — вкладення не версіонуються (NFR-23), тож
фікстура, що змінює вкладення і перезапускає агента, отримає **новий** набір,
поки `agent_versions` рапортує стару конфігурацію як актуальну. Набір документів
минулого рану перевіряти **виключно з траси цього рану** (NFR-24), ніколи з
поточних вкладень агента і ніколи зі снапшоту версії.

## Acceptance
- [ ] AC-24, AC-25, AC-26, AC-42 — читаються вкладення агента, потім успадковані від enabled скілів у порядку лінків; дублікат інжектується один раз, на першій позиції, і в трасі стоїть рівно один раз.
- [ ] AC-27, AC-28, AC-48, AC-49, AC-51 — документи рендеряться в `## Project context`, кожен обгорнутий як untrusted, `</untrusted>` нейтралізовано, порожній набір опускає секцію, жоден root не привілейований.
- [ ] AC-29, AC-30, AC-31, AC-32 — вимкнений скіл не віддає документів; `repo_intel:false` не впливає; MCP-ран поводиться ідентично студійному; жодного додаткового модельного виклику.
- [ ] AC-33, AC-34, NFR-4 — усічення 150 000 символів із маркером усередині обгортки; бюджет 40 000 токенів скидає цілі документи з хвоста.
- [ ] AC-35, AC-36, NFR-6 — нечитний документ пропускається, ран завершується; кидок і порожній результат трактуються однаково; повне падіння читача лишає ран живим із записаною причиною.
- [ ] AC-38, AC-39, AC-40, AC-43, AC-56, NFR-10, NFR-24 — траса несе шлях, заміряні в цьому рані токени, статус і походження зі skill_name; лічильники в лог рану.
- [ ] NFR-8 — той самий набір у тому самому порядку дає побайтово однаковий блок.
- [ ] NFR-17 — жоден лог не несе тексту документа.
- [ ] Обидві копії `trace.ts` побайтово збігаються; `client/` typecheck зелений проти union.

## Out of scope
- Клієнтський рендер збагаченого `specs_read` і `Project context` блоку (`0001c`).
- Будь-яка зміна в `reviewer-core/src/` — доведено непотрібною (Requirements review).
- Заповнення `specs_read` для CI-шляху `trace-builder.ts` — тип вирівнюється, поведінка ні.
- Написання чи правка специфікації.

## Open questions
- **Чи має траса нести також набір, що був скинутий за бюджетом, коли він
  великий?** AC-56 вимагає статус для кожного **вкладеного** документа, а
  вкладень щонайбільше 20 на сутність — верхня межа `specs_read` порядку
  кількох десятків елементів. Продовжую без обмеження розміру.
