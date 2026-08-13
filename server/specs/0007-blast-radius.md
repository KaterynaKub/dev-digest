# 0007 — Blast Radius (карта потенційного впливу змін)

**Статус:** реалізовано (кроки 0-7); кроки 8 (MCP-тул) і 9 (Graph-вигляд) свідомо відкладені
**Пакети:** `server/` (новий модуль `blast`), `client/` (нова секція на Overview),
`server/src/mcp/` (заміна заглушки)
**Модель:** не використовується. Жодного LLM-виклику на жодному кроці.

---

## 1. Що це і навіщо

Blast Radius відповідає на запитання рев'юера **«що ще може зачепити цей diff?»**
Змінених рядків для відповіді недостатньо — потрібні зв'язки між символами й файлами.

Карта показує три шари:

1. **Які символи оголошені у змінених файлах** (`changed_symbols`).
2. **Хто імпортує/викликає ці символи** (`downstream[].callers`) — крос-файлові
   посилання з persistent-індексу.
3. **Які HTTP-ендпоінти та cron-джоби можуть залежати від зміненого коду**
   (`downstream[].endpoints_affected` / `crons_affected`) — атрибутовані до
   конкретного символу через `factsByFile`.

Усі факти вже є в `repo-intel`. Фіча лише **читає індекс** і формує зрозуміле
представлення — жодного нового парсингу, жодного нового індексатора.

---

## 2. Що вже існує (перевірено в коді)

Це найважливіша частина плану: **важкий шар уже написаний**. Не переписувати.

| Що | Де | Стан |
|---|---|---|
| Facade-метод `getBlastRadius(repoId, changedFiles)` | `server/src/modules/repo-intel/service.ts:259` | ✅ реалізовано |
| Persistent-шлях (читання з Postgres, без парсингу клону) | `service.ts#tryPersistentBlast` (~:344) | ✅ реалізовано |
| Degraded-шлях (ripgrep/codeIndex best-effort) | `service.ts:267-341` | ✅ реалізовано |
| Типи `BlastResult` / `BlastCallerRow` / `BlastChangedSymbol` | `server/src/modules/repo-intel/types.ts:57-87` | ✅ є |
| `factsByFile: { endpoints, crons }` per caller-file | `types.ts:84` | ✅ є (persistent-шлях) |
| Ранжування callers за `file_rank.rank` + `MAX_CALLERS_PER_SYMBOL` | `service.ts` (сорт + slice) | ✅ є |
| Zod-контракт `BlastRadius` / `DownstreamImpact` / `BlastCaller` / `ChangedSymbol` | `server/src/vendor/shared/contracts/brief.ts:49-77` (і дзеркало в `client/`) | ✅ є, **вже синхронізовані** |
| i18n-ключі (`stat.symbols/callers/endpoints/crons`, `view.tree/graph`, `callerCount`, `noDownstream`, `graph.*`) | `client/messages/en/blast.json` | ✅ є, збігаються з макетом |
| Реєстр модулів явно резервує назву `blast` | `server/src/modules/index.ts` (коментар) | ✅ |

### Чого НЕМАЄ

- HTTP-модуля, що зшиває `prId → changedFiles → repoIntel.getBlastRadius() → BlastRadius`.
  Зараз facade **не має жодного HTTP-споживача** — `repo-intel/routes.ts` віддає
  тільки `/index-state` і `/resync`.
- Мапінгу `BlastResult` (плоский, per-caller) → `BlastRadius` (згрупований
  per-symbol, з `summary`). Це головна нова логіка, і вона **чисто арифметична**.
- Будь-якого UI.
- MCP-тул `get_blast_radius` — заглушка, що завжди повертає `isError: true`
  (`server/src/mcp/tools/get-blast-radius.ts`).

### Свідомо поза скопом

- **«Prior PRs touching these files»** (нижній колапс на макеті) — це `PrHistory`
  з `brief.ts:98-111`, окрема фіча (історія PR-ів), не Blast Radius. У цьому
  плані рендериться **лише згорнутий заголовок-плейсхолдер або не рендериться
  зовсім** — рішення нижче в §6.4.
- Зміни в самому індексаторі `repo-intel/pipeline/**`.
- Нові таблиці. Нічого не персиститься (як у `smart-diff`).

---

## 3. Архітектурні обмеження

Обов'язкові до дотримання (з `server/CLAUDE.md`, `repo-intel/CLAUDE.md`,
skill `onion-architecture`):

1. **Тільки через facade.** Модуль `blast` імпортує `RepoIntel` як порт
   (`container.repoIntel`), і **ніколи** не лізе в `repo-intel/pipeline/**`,
   `adapters/astgrep/**`, `adapters/codeindex/**` чи в таблиці індексу.
   Це прямо заборонено `repo-intel/CLAUDE.md`.
2. **Жодного LLM.** У `BlastDeps` не з'являється `llm`. Дзеркалить дисципліну
   `smart-diff/CLAUDE.md` («No model call, ever»).
3. **Форма модуля:** `routes.ts` (HTTP + zod) → `service.ts` (без SQL) →
   `repository.ts` (без HTTP) → `helpers.ts` (чисті функції) → `constants.ts`.
4. **Сервіс не імпортує `Container`** — залежності передаються явним
   `BlastDeps`, зібраним у `routes.ts` (як `smartDiffDeps`).
5. **Degrade, never throw.** Неіндексований репозиторій → порожня карта з
   поясненням, ніколи не 500. `repo-intel` це вже гарантує; модуль не має
   зламати гарантію.
6. **`workspace_id` через `getContext()`** — PR резолвиться workspace-scoped
   рівно один раз, як у `SmartDiffRepository.getPull`.
7. **Vendored shared × 2.** Якщо контракт доведеться розширювати (§4.2), правка
   йде в **обидва** файли, `server/` — канонічний. Верифікація:
   `diff server/src/vendor/shared/contracts/brief.ts client/src/vendor/shared/contracts/brief.ts`.

---

## 4. Серверна частина

### 4.1 Новий модуль `server/src/modules/blast/`

```
blast/
  CLAUDE.md        # конвенції модуля
  constants.ts     # ліміти
  helpers.ts       # чисті функції: BlastResult → BlastRadius
  repository.ts    # select-only: getPull, getPrFiles
  routes.ts        # GET /pulls/:id/blast
  service.ts       # оркестрація
```

**Ендпоінт:** `GET /pulls/:id/blast` → `BlastRadius`.
Чисте читання, без витрат — **без rate-limit**, точно як `/pulls/:id/smart-diff`.

### 4.2 Контракт — розширюється явним станом індексу

**ЗАФІКСОВАНЕ РІШЕННЯ (варіант B).** Порожній масив ніколи не є відповіддю
«немає впливу», якщо насправді бракує даних. Ці два випадки контракт мусить
розрізняти явно:

- «індекс повний, downstream справді порожній» — валідний результат;
- «індекс неповний / не збудований» — **не** результат, а стан.

Маскувати друге під перше заборонено. Тому `BlastRadius` у `brief.ts`
розширюється:

```ts
export const BlastIndexStatus = z.enum(['full', 'partial', 'degraded', 'failed']);

export const BlastRadius = z.object({
  changed_symbols: z.array(ChangedSymbol),
  downstream: z.array(DownstreamImpact),
  summary: z.string(),
  /** Стан індексу, з якого побудовано карту. Ніколи не опускається. */
  index_status: BlastIndexStatus,
  /** true, коли карта побудована на неповних даних. */
  degraded: z.boolean(),
  /** Машиночитана причина деградації; null на повному індексі. */
  reason: z.string().nullish(),
});
```

**Джерело істини для цих полів** — `BlastResult.degraded` / `BlastResult.reason`
(`repo-intel/types.ts:85-86`, тип `DegradedReason`: `flag_off` · `index_failed` ·
`index_partial` · `repo_too_large` · `no_data`). Мапінг:

| Шлях у facade | `index_status` | `degraded` | `reason` |
|---|---|---|---|
| persistent, `state.status === 'full'` | `full` | `false` | `null` |
| persistent, `state.status === 'partial'` | `partial` | `true` | `index_partial` |
| ripgrep-фолбек (`degraded: true`) | `degraded` | `true` | з `BlastResult.reason` |
| facade кинув / репо без клону | `failed` | `true` | `index_failed` |

`BlastResult` **не несе** `state.status` назовні — persistent-шлях повертає
лише `degraded: false`. Тому `partial` не відрізнити від `full` на боці
модуля `blast`. Щоб не вигадувати стан, сервіс додатково викликає
`repoIntel.getIndexState(repoId)` (метод контрактно «ALWAYS works, even
degraded» — `types.ts:143`) і бере `status` звідти. Це один дешевий read
через той самий facade, без нових портів.

**Це двофайлова правка vendored shared** — `server/` канонічний, потім
дзеркалиться в `client/`. Обов'язкова верифікація перед «готово»:

```bash
diff server/src/vendor/shared/contracts/brief.ts client/src/vendor/shared/contracts/brief.ts
```

Порожній вивід = синхронізовано. Одностороння правка типчекається у своєму
пакеті й тихо розсинхронізовує API.

**Сумісність:** `PrBrief` (`brief.ts:161`) вбудовує `BlastRadius`. Нові поля
обов'язкові (`index_status`, `degraded`), тож будь-який існуючий продюсер
`PrBrief` перестане валідуватися — перевірити, чи такі є, і оновити. Якщо
продюсер знайдеться і оновити його недешево — зробити `index_status`/`degraded`
опційними **тільки там**, але не в самому `BlastRadius`.

### 4.3 `repository.ts` (select-only)

Дві вибірки, обидві дзеркалять `smart-diff/repository.ts`:

- `getPull(workspaceId, prId)` — єдина перевірка scope. `pr_files` не має
  власного `workspace_id`.
- `getPrFiles(prId)` — **тільки `path`**, без `patch` і навіть без
  additions/deletions: Blast потребує лише список шляхів.

Потрібен також `repoId` — він є на рядку `pull_requests`, тож окремого запиту не треба.

Жодного `insert`/`update`/`delete`/транзакції у файлі.

### 4.4 `service.ts`

```ts
export interface BlastDeps {
  repo: BlastRepository;
  repoIntel: RepoIntel;   // порт, НЕ контейнер
}
```

Оркестрація, без жодної логіки перетворення:

1. `getPull(workspaceId, prId)` → `NotFoundError` якщо немає.
2. `getPrFiles(prId)` → `string[]` шляхів. Порожньо → карта з
   `index_status: 'full'`, `degraded: false` і порожнім `downstream`: це
   чесний результат («PR не змінив жодного файлу»), а не брак даних.
3. Паралельно (`Promise.all`): `repoIntel.getBlastRadius(pull.repoId, paths)`
   і `repoIntel.getIndexState(pull.repoId)` — другий дає `status` для
   `index_status` (див. таблицю мапінгу в §4.2).
4. Якщо `getBlastRadius` **кинув** — не пропускати помилку назовні і не
   віддавати порожній масив мовчки: повернути карту з `index_status: 'failed'`,
   `degraded: true`, `reason: 'index_failed'` і пояснювальним `summary`.
5. `return buildBlastRadius(result, indexState)` — усе перетворення в `helpers.ts`.

### 4.5 `helpers.ts` — єдина нова логіка

Чиста функція
`buildBlastRadius(result: BlastResult, indexState: IndexState | null): BlastRadius`.

**Перетворення плоского в згрупований.** `BlastResult.callers` — плоский список,
де кожен рядок несе `viaSymbol` (який змінений символ він досягає). `BlastRadius`
натомість групований **per changed symbol**. Алгоритм:

1. **Групування:** `callers` → `Map<viaSymbol, BlastCallerRow[]>`.
2. **Атрибуція ендпоінтів/кронів:** для кожного символу зібрати унікальні
   `file` його callers → підняти `factsByFile[file].endpoints` і `.crons`.
   Саме для цього `factsByFile` і існує (див. коментар у `types.ts:80-84`).
   Якщо `factsByFile` відсутнє (degraded-шлях), використати
   `impactedEndpoints` як плоский union і **не** атрибутувати його до
   конкретного символу — тобто в degraded-режимі `endpoints_affected`
   заповнюється тільки для символів, що мають callers, або лишається порожнім.
   Це свідомий вибір точності над повнотою.
3. **Мапінг полів:** `BlastCallerRow{ file, symbol, line }` → `BlastCaller{ name: symbol, file, line }`.
4. **Порядок — тотальний і детермінований.** Це та сама вимога, що й
   `sortWithinGroup` у smart-diff: без останнього тай-брейку два послідовні
   запити можуть дати різний байтовий результат.
   - `downstream` сортується за: кількість callers ↓, потім максимальний
     `rank` ↓, потім **ім'я символу за зростанням**.
   - `callers` усередині символу: `rank` ↓, потім `file` ↑, потім `line` ↑.
   - `endpoints_affected` / `crons_affected`: лексикографічно ↑.
5. **Ліміти** (`constants.ts`): `MAX_DOWNSTREAM_SYMBOLS`, `MAX_CALLERS_PER_SYMBOL`
   (facade уже ріже, але helper має бути самодостатнім), `MAX_ENDPOINTS_PER_SYMBOL`.
   Обрізання відбувається **після** сортування, щоб відкидалося найменш важливе.
6. **`summary`** — детермінований рядок, що будується арифметикою, не моделлю.
   Напр. `"2 changed symbols · 14 callers across 9 files · 3 endpoints · 1 cron"`.
   Символи без жодного callers **не потрапляють** у `downstream`, але
   рахуються в `changed_symbols` — саме тому i18n має ключ `noDownstream`.
7. **Стан індексу вбудовується, а не приховується.** `index_status` / `degraded`
   / `reason` заповнюються за таблицею §4.2. Коли `degraded === true`, `summary`
   **зобов'язаний** це сказати словами, а не звітувати нулі як факт. Різниця,
   яку користувач мусить бачити:
   - `full` + порожній `downstream` → `"No downstream callers found."`
   - `partial` → `"Index is partial — downstream may be incomplete."`
   - `degraded`/`failed` → `"Index not built — downstream unavailable."`

   Формулювання «0 callers» на неповному індексі — це баг, а не порожній
   результат.

### 4.6 Реєстрація

- `server/src/platform/container.ts`: гетер `blastRepo` (лінива ініціалізація,
  як `smartDiffRepo`). `repoIntel` уже є.
- `server/src/modules/index.ts`: один import + один запис `blast`.

### 4.7 MCP-тул — зняти заглушку

`server/src/mcp/tools/get-blast-radius.ts` наразі завжди повертає помилку, а
його `description` починається з `STUB:`. Після появи сервісу:

- Прибрати `blastRadiusStubText()` з `mcp/errors.ts` (перевірити інших споживачів).
- Переписати `description` — прибрати `STUB:` і «use get_findings instead».
- `handler` резолвить `repo` + `pr` у `prId` тим самим шляхом, що й інші
  реалізовані тули (`get_findings`), і викликає `BlastService`.
- `annotations: { readOnlyHint: true, openWorldHint: false }` лишаються.

**Це окремий крок, залежний від 4.1-4.6.** Якщо скоп треба звузити — цей пункт
відкладається першим, заглушка чесно лишається заглушкою.

---

## 5. Тести (сервер)

Baseline: `server` 209 hermetic тестів (23 файли). Судити за дельтою.

**Гермтичні, `helpers.test.ts`** — основна маса. Чисті функції, без БД:

- Групування per-symbol із плоского `callers`.
- Атрибуція endpoints/crons через `factsByFile` до правильного символу.
- Degraded-шлях (`factsByFile` відсутнє) не вигадує атрибуцію.
- Детермінізм: двічі викликати з входом у переставленому порядку → байт-в-байт
  однаковий результат (це тест на тотальність сортування).
- Ліміти обрізають після сортування, не до.
- Змінений символ без callers → присутній у `changed_symbols`, відсутній у `downstream`.
- Порожній вхід → валідний `BlastRadius` з пояснювальним `summary`, не throw.
- `summary` рахує правильно (callers across N files, а не N callers).

**Стан індексу — окремий блок тестів, головна вимога цієї ітерації.**
Порожнеча ніколи не має бути невідрізненною від браку даних:

- `index_status: 'full'` + порожній `downstream` → `degraded: false`,
  `reason: null`, `summary` каже «no downstream callers found».
- `index_status: 'partial'` → `degraded: true`, `reason: 'index_partial'`,
  `summary` **явно** попереджає про неповноту.
- `BlastResult.degraded === true` (ripgrep-фолбек) → `index_status: 'degraded'`,
  `reason` проброшено з `BlastResult.reason`, не перезаписано.
- **Ключовий негативний тест:** два входи з однаково порожнім `downstream` —
  один на `full`-індексі, другий на `partial` — дають **різні** відповіді
  (різні `degraded`/`reason`/`summary`). Це і є тест на «не маскувати
  відсутні дані порожнім масивом».
- `indexState === null` → `failed` + `degraded: true`, не `full`.

**`service.test.ts`** — з мок-`repoIntel` (контейнер уже підтримує
`ContainerOverrides.repoIntel`, `container.ts:59`):

- Невідомий `prId` → `NotFoundError`.
- PR без файлів → `degraded: false`, `index_status: 'full'`, `repoIntel`
  не викликається (це не брак даних).
- `getBlastRadius` кидає → `index_status: 'failed'`, `degraded: true`,
  `reason: 'index_failed'`, HTTP 200 — не 500 і не тихий порожній масив.
- `getIndexState` кидає, а `getBlastRadius` спрацював → результат віддається,
  але `index_status` не вигадується як `full`.

**Не писати** `*.it.test.ts`, якщо не додається жодного нового запиту, який
варто перевіряти проти реальної БД — дві прості select-и покриваються мок-репо.

---

## 6. Клієнтська частина

### 6.1 Розміщення

Макет ставить BLAST RADIUS **праворуч від INTENT, у два стовпці, на вкладці
Overview**.

Тут є розбіжність із поточним кодом, яку треба вирішити:
`OverviewTab.tsx` наразі рендерить **лише `prBody`**, а `IntentCard`
рендериться на вкладці **Findings** (`FindingsTab.tsx`). Макет показує обидві
картки на Overview.

**Рішення:** перенести `IntentCard` на Overview і покласти поруч `BlastRadiusCard`
у двоколонковому гріді — інакше макет не відтворюється. Це зачіпає
`FindingsTab.tsx` (прибрати звідти `IntentCard`) і `OverviewTab.tsx`
(прийняти `prId` пропом, додати грід). Якщо перенос небажаний — узгодити
окремо; тоді Blast сідає на Overview сам, на всю ширину.

### 6.2 Компонент `BlastRadiusCard`

Шлях (за конвенцією колокації з `client/CLAUDE.md`):
`client/src/app/repos/[repoId]/pulls/[number]/_components/BlastRadiusCard/`
з файлами `BlastRadiusCard.tsx` · `constants.ts` · `styles.ts` · `index.ts` ·
`BlastRadiusCard.test.tsx` (+ за потреби `helpers.ts`, `_components/BlastTree/`).

Структура за макетом:

- Заголовок `SectionLabel` з іконкою — «BLAST RADIUS».
- **Рядок статистики:** `2 symbols · 14 callers · 3 endpoints · 1 cron` —
  ключі `blast.stat.*` уже є. Числа рахуються з відповіді, не з окремого API.
- **Перемикач Tree / Graph** — ключі `blast.view.tree` / `blast.view.graph` є.
  **ОНОВЛЕНО (ітерація 2, за рішенням замовника): Graph реалізується
  повноцінно.** У першій ітерації він був disabled-кнопкою; це читалося як
  зламаний елемент, тому кнопка більше не може лишатися вимкненою.

  Вимоги до графа:
  - Inline-SVG, **без нових залежностей** (жодних d3/cytoscape — пакет їх не має).
  - Дані ті самі, що й у Tree — `downstream[]`. Граф НЕ робить окремого запиту.
  - Форма: змінений символ у центрі/ліворуч, його callers — вузлами навколо,
    ребра `symbol → caller`. Двошаровий layout (не force-directed: він
    недетермінований, а детермінізм — вимога §4.5).
  - Позиціювання **детерміноване** — з того самого відсортованого масиву
    завжди та сама картинка.
  - Порожній стан — наявний ключ `blast.graph.empty`; контейнер `<svg>` має
    `role="img"` + `aria-label` з `blast.graph.ariaLabel`.
  - Теми: тільки CSS-змінні (`var(--text-muted)`, `var(--border)` тощо),
    жодних захардкоджених кольорів — картка живе і в темній, і в світлій темі.
  - Великий `downstream` не повинен ламати верстку: обмежити кількість
    відмальованих вузлів константою і показати «+N more», а не рендерити сотні.
- **Tree:** список змінених символів, кожен — розкривний рядок
  (`<symbol>()` + бейдж `{count} callers`, ключ `blast.callerCount`).
  Розгорнутий показує `file:line` кожного викликача, під ними — бейджі
  ендпоінтів (`GET /api/public/items`) і кронів, візуально відрізнені кольором,
  як на макеті.
- **Два різні порожні стани — не один.** Це UI-відповідник вимоги з §4.2:
  - `degraded === false` + порожній `downstream` → `blast.noDownstream`
    (`{count} changed symbol(s), no downstream callers found.`) — це
    констатація факту.
  - `degraded === true` → **банер стану індексу**, а не «нічого не знайдено»:
    пояснює, що карта неповна, показує причину (`reason`) і веде на Resync
    (`useResyncRepoIntel`, `hooks/repo-intel.ts:41`). Нулі в рядку статистики
    в цьому стані **не подаються як факт** — або приховуються, або
    супроводжуються позначкою неповноти.

  Показати «0 callers» на неповному індексі = збрехати рев'юеру, що впливу
  немає. Потрібні нові i18n-ключі (`blast.degraded.*`) — у `blast.json` їх
  зараз немає.

### 6.3 Дані

Хук `useBlast(prId)` у `client/src/lib/hooks/reviews.ts` (там уже живе
`useSmartDiff` — `reviews.ts:167`), `queryKey: ["blast", prId]`.
**Ніколи не `fetch` із компонента** — тільки через `api.get`.

Інвалідація: `useSmartDiff` інвалідується після ранів (`reviews.ts:138`).
Blast **не залежить від ранів рев'ю** — він залежить від індексу репозиторію.
Тому інвалідувати його після рев'ю не треба; доречніше — після
`useResyncRepoIntel` (`hooks/repo-intel.ts:41`), який перебудовує індекс.

**Стани (усі обов'язкові за `client/CLAUDE.md`):** `Skeleton` із іменованим
`role="status"` рядком під час завантаження, error-стан із retry, empty-стан,
**degraded-стан** (§6.2). Мовчазних пропусків не буває.

### 6.4 «Prior PRs touching these files»

На макеті це згорнутий рядок унизу картки. Це **інша фіча** (`PrHistory`),
API для якої не існує. Не імітувати її порожнім колапсом — краще не рендерити
зовсім, ніж рендерити елемент, що нічого не відкриває. Додається пізніше,
разом із history-модулем.

### 6.5 i18n

`client/messages/en/blast.json` уже містить рівно ті ключі, що потрібні макету.
Перевірити, чи є `blast` у неймспейсах провайдера, і чи не бракує ключів для
заголовка секції та станів loading/error — їх у файлі немає, доведеться додати.

### 6.7 Ширина колонок Overview (ітерація 2)

**Вимога замовника: дві РІВНІ колонки, які НЕ змінюють ширину.**
`gridTemplateColumns: "1fr 1fr"` лишається — жодних `auto`, `min-content`
чи медіа-брейкпоінтів. Адаптивність тут не потрібна й не додається.

Проте `1fr 1fr` **сам по собі не гарантує рівності**. Grid-елемент має
`min-width: auto`, тобто не може стати вужчим за свій найдовший нерозривний
вміст. У картці такий вміст є завжди: шляхи файлів (`src/api/public/index.ts:23`),
бейджі ендпоінтів, довгі імена символів. Один такий рядок розпирає свою
колонку понад половину, і вона «розширюється» — саме те, що видно на скриншоті.

Тому фікс складається з двох частин, і **друга обов'язкова**:

1. Кожен grid-елемент отримує `minWidth: 0` — це знімає `min-width: auto` і
   змушує колонку тримати рівно 50%.
2. Довгий вміст усередині картки мусить мати куди дітися: `overflow-wrap`
   (або `text-overflow: ellipsis` + `overflow: hidden`) на рядках callers,
   шляхів і бейджів. Без цього `minWidth: 0` призведе до горизонтального
   переповнення замість розтягування — інша вада, не краща.

Перевірка: картка з дуже довгим шляхом файлу не повинна робити ліву колонку
вужчою за праву, і не повинна давати горизонтальний скрол сторінці.

### 6.6 Тести (клієнт)

Baseline: `client` 108 тестів (22 файли).
`BlastRadioCard.test.tsx` (React Testing Library, за skill `react-testing-library`):
рендер статистики з мок-даних, розкриття/згортання символу, порожній стан,
loading має доступний `role="status"`, error показує retry.

---

## 7. Порядок робіт

| # | Крок | Залежить від |
|---|---|---|
| 0 | Розширити `BlastRadius` у `server/src/vendor/shared/contracts/brief.ts` (`index_status`, `degraded`, `reason`) → дзеркалити в `client/` → `diff` | — |
| 1 | `helpers.ts` + `helpers.test.ts` (чиста трансформація `BlastResult → BlastRadius`) | 0 |
| 2 | `repository.ts`, `service.ts`, `constants.ts` + `service.test.ts` | 1 |
| 3 | `routes.ts`, гетер у `container.ts`, запис у `modules/index.ts` | 2 |
| 4 | `blast/CLAUDE.md` | 3 |
| 5 | Хук `useBlast` + i18n-ключі, яких бракує | 3 |
| 6 | `BlastRadiusCard` (Tree) + тест | 5 |
| 7 | Перенос `IntentCard` на Overview + двоколонковий грід | 6 |
| 8 | *(опційно)* MCP `get_blast_radius` замість заглушки | 3 |
| 9 | Graph-вигляд (ітерація 2 — **у скопі**, див. §6.2) | 6 |
| 10 | Фікс ширини колонок Overview (§6.7) | 7 |

Крок 8 лишається відкладеним. Кроки 9-10 — ітерація 2.

---

## 8. Верифікація

Пакети незалежні — запускати **з директорії пакета**, ніколи з кореня.

```bash
# server
cd server
pnpm typecheck        # очікувано: 2 pre-existing помилки (migrate.ts:38, seed.ts:499). Дельта має бути 0.
pnpm test             # baseline 209 hermetic / 23 файли → має зрости
pnpm arch:check       # судити за рядком "x N dependency violations (E errors, W warnings)"
                      # baseline: 6 warnings, 0 errors. НОВИХ errors бути не має.
                      # Особливо: blast/service.ts не повинен тягнути adapters/** чи db/**.

# client
cd client
pnpm typecheck
pnpm lint             # baseline: 0 errors, 3 pre-existing warnings
pnpm test             # baseline 108 / 22 файли → має зрости
```

Контракт у `brief.ts` **змінюється** (варіант B у §4.2) — перевірка синхрону
vendored shared обов'язкова, не опційна:

```bash
diff server/src/vendor/shared/contracts/brief.ts client/src/vendor/shared/contracts/brief.ts
# порожній вивід = синхронізовано
```

`arch:check` **виходить із кодом 0 навіть за наявності порушень** — читати
підсумковий рядок, не exit code.

---

## 9. Критерії приймання

- [ ] `GET /pulls/:id/blast` повертає валідний `BlastRadius` для PR в
      індексованому репозиторії.
- [ ] Для неіндексованого репозиторію ендпоінт віддає **200** з
      `index_status: 'failed'|'degraded'`, `degraded: true`, заповненим `reason`
      і пояснювальним `summary` — не 500 і не тихий порожній масив.
- [ ] **Порожній `downstream` на повному індексі й порожній `downstream` на
      неповному дають різні відповіді** (різні `degraded`/`reason`/`summary`).
      Це головний критерій цієї ітерації.
- [ ] `index_status` і `degraded` присутні в кожній відповіді — ніколи не
      опускаються й ніколи не вигадуються як `full` за браку даних.
- [ ] UI на `degraded: true` показує стан індексу з причиною і шляхом до
      Resync, а не «no downstream callers found»; нулі не подаються як факт.
- [ ] Два послідовні виклики на незмінних даних дають байт-ідентичний результат.
- [ ] `endpoints_affected` атрибутовані до символу, чиї callers живуть у файлі
      з відповідними `file_facts` — не плоский union на всі символи.
- [ ] Змінений символ без callers присутній у `changed_symbols` і відсутній у
      `downstream`.
- [ ] У жодному файлі `modules/blast/**` немає імпорту `Container`, `db/**`,
      `adapters/**`, `repo-intel/pipeline/**`, `LLMProvider`.
- [ ] `repository.ts` не містить `insert`/`update`/`delete`/`transaction`.
- [ ] Картка на Overview показує статистику, дерево символів із розкриттям,
      бейджі ендпоінтів/кронів, і має loading/error/empty стани.
- [ ] Жодного рядка UI-тексту в JSX — усе через `messages/en/blast.json`.
- [ ] `server` arch:check не додав жодної нової **error**.
- [ ] Кількість тестів зросла в обох пакетах; pre-existing помилки typecheck
      лишилися рівно двома.

---

## 10. Ризики та відкриті питання

1. **Порожній Blast на реальних даних.** `tryPersistentBlast` вимагає
   `state.status === 'full' | 'partial'`, а callers рахуються **тільки** з
   резолвлених посилань (`decl_file` не NULL) — свідома точність над повнотою
   (коментар у `service.ts`). На слабо проіндексованому репозиторії карта
   виглядатиме порожньою при формально робочій фічі. Саме тому `index_status`
   винесено в контракт (§4.2) — це вже не «ризик, який пояснить UI», а стан,
   який передається даними.
2. **Degraded-шлях не має `factsByFile`** — атрибуція ендпоінтів у ньому
   принципово слабша. UI не повинен показувати degraded-результат так само
   впевнено, як persistent; `index_status: 'degraded'` це кодує.
3. **`partial` не видно з `BlastResult`** — потрібен додатковий
   `getIndexState()` (§4.2). Якщо цей виклик почне коштувати дорого, правильна
   відповідь — розширити `BlastResult` полем `indexStatus` у `repo-intel`,
   а **не** повертатися до вгадування `full`.
4. **Перенос `IntentCard` на Overview** (§6.1) — єдина зміна, що чіпає існуючий
   екран. Потребує підтвердження, бо це продуктове рішення, а не технічне.
5. **Graph-вигляд** (§6.2) — найбільша невизначеність за обсягом. Рекомендація:
   не входить у першу ітерацію.

**Закрито:** degraded-поле в контракті — зафіксовано варіант B (§4.2).
