# 0001c — Project Context: клієнт (сторінка, вкладки `Context`, збагачена траса)

**Status:** approved
**Date:** 2026-08-24
**Mode:** single-agent
**Touches:** `client/src/app/repos/[repoId]/project-context/` (new) · `client/src/app/agents/[id]/_components/AgentEditor/_components/ContextTab/` (new) · `.../SkillDetail/_components/ContextTab/` (new) · `client/src/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/` · `client/src/lib/hooks/project-context.ts` (new) · `client/messages/en/context.json` · `client/src/vendor/ui/nav.ts`

## Prerequisites

`0001a` **і** `0001b` мають бути в дереві. Одна команда підтвердження:

```
cd client && node -e "const t=require('fs').readFileSync('src/vendor/shared/contracts/trace.ts','utf8'); process.exit(t.includes('ContextDocRead')?0:1)" && ls src/vendor/shared/contracts/project-context.ts && echo OK
```

## Requirements

Джерело: `docs/specs/SPEC-01-project-context-folder.md` (**Status: approved**).
Ця частина — уся UI-поверхня: AC-3…AC-7, AC-13, AC-16, AC-21, AC-22, AC-37,
AC-41, AC-43, AC-50, AC-52, AC-53, AC-57…AC-68, NFR-7, NFR-12…NFR-15, NFR-19, NFR-22.

## Requirements review

- **AC-22/AC-53 не виконуються на сервері — механізм переїжджає в UI** — `[recommended]`
  `POST /repos/:id/resync` ставить джобу і повертає 202 (`repo-intel/routes.ts:43-66`);
  `resyncRepo` іде в `JobRunner` без каналу назад, тож блокувати до підтвердження
  означало б висячий джоб. Прийнято: клієнт викликає preflight
  `GET /repos/:id/project-context/dirty` (з `0001a`) і за непорожньої відповіді
  показує модальне підтвердження; resync не викликається до підтвердження.
  Спостережувана поведінка виконана, механізм інший за формулювання специфікації.
- **AC-50 виконано наполовину, і саме небезпечна половина відсутня** — `[recommended]`
  `vendor/ui/primitives/Markdown.tsx` рендерить **без** `rehype-raw`, тож сирий
  HTML екранується — половина AC-50 уже працює. Але його `a`-рендерер (рядки
  31-35) бере `href` дослівно, тож `[x](javascript:alert(1))` дає активне
  посилання. Це **вже** експлуатовна поверхня для тіл скілів, а не лише для нової
  фічі. Whitelist схем іде в сам primitive, не в локальну копію — інакше дірка
  лишиться у трьох інших місцях, що вже його рендерять.
- **`context.json` існує і його копія стала** — `[recommended]`
  Файл є, не референсується жодним компонентом, і його `empty.body` каже «under
  `.devdigest/specs/`» — той самий шлях поза репозиторієм, який D-2 визнав хибним;
  ключ `chunks` — артефакт D-3. Обидва переписуються, каркас зберігається.
- **`Used by N agents` (AC-14) не має рівноцінного для скілів** — `[proceeding as asked]`
  Документ, вкладений лише у скіл, покаже «Used by 0 agents», будучи вжитим у
  кожному рані цього скіла. Показую як написано; API з `0001a` віддає обидва
  лічильники, тож розширення на «N agents · M skills» буде однорядковим.
- **AC-43 не має за що зачепитися в UI** — `[proceeding as asked]`
  Реалізую як підпис-пояснення в дровері траси, поруч із маркером AC-16.

## Problem

Жодної поверхні не існує. Сторінки Project Context немає. `AgentEditor` має
рівно дві вкладки (`constants.ts` — `config`, `skills`), `SkillDetail` — п'ять,
серед яких `Context` немає. `TraceBody.tsx:41-44` рендерить `Specs read`
ітерацією по **голих рядках**, тож збагачений `ContextDocRead` з `0001b` там
або впаде, або відрендерить `[object Object]`. Простір повідомлень `context`
існує і мертвий.

## Approach

Чотири незалежні поверхні, збудовані в порядку зростання ризику:
хук-шар → вкладка `Context` агента (найпростіша, є прямий прецедент) → вкладка
скіла (той самий компонент) → сторінка Project Context → дровер траси (єдина
поверхня зі зворотною сумісністю).

Вкладка `Context` **не** пишеться з нуля: `SkillsTab`
(`agents/[id]/_components/AgentEditor/_components/SkillsTab/SkillsTab.tsx`) вже
робить рівно цей патерн — один список із вкладеними першими в порядку промпту,
чекбокс як контроль вкладання, нативний HTML5 drag плюс ▲/▼ як клавіатурний
шлях, і збереження повною заміною масиву. Її форма копіюється; ▲/▼ і є
відповіддю на NFR-13, а не додатковою роботою.

Зворотна сумісність траси живе **тільки** тут: `run.repo.ts:217` робить
`row.trace as RunTrace`, маршрут не оголошує response-схему, а
`hooks/trace.ts` робить `api.get<RunTrace>` — жоден шар не парсить. Стара траса
дійде до рендеру голими рядками, і рендер мусить це витримати.

## Affected packages and modules

| Package | Path | What changes |
|---|---|---|
| client | `src/lib/hooks/project-context.ts` (new) + `hooks/index.ts` | усі хуки фічі |
| client | `src/app/repos/[repoId]/project-context/` (new) | сторінка + `ProjectContextView` |
| client | `.../AgentEditor/_components/ContextTab/` (new) + `constants.ts` | вкладка агента, 3-й запис у `TABS` |
| client | `.../SkillDetail/_components/ContextTab/` (new) + `constants.ts` | вкладка скіла (той самий компонент) |
| client | `.../RunTraceDrawer/_components/TraceBody/` | `Specs read` обома формами; блок `Project context` (AC-41) |
| client | `src/vendor/ui/primitives/Markdown.tsx` · `src/vendor/ui/nav.ts` | whitelist схем (AC-50); пункт меню |
| client | `messages/en/{context,agents,skills,runs}.json` | `context.json` переписано; нові ключі в решті |

Контракти вже двосторонньо вирівняні в `0001a`/`0001b` — цей план **не** править
`vendor/shared`. Якщо доведеться — це двофайлова правка, і `diff` обов'язковий.

## Architectural constraints

- Жодного `fetch` у компоненті. Увесь HTTP — через `src/lib/api.ts`,
  споживаний через `src/lib/hooks/project-context.ts`.
- Типи — з `@devdigest/shared`, ніколи не передекларовані. Але **значення**
  (Zod-схеми, константи) з контрактів не імпортувати: барель `export *`-ить
  десять файлів і не тришейкається — один імпорт значення коштує ~17 kB бандла.
  Інлайнити літерали локально з коментарем, як `SKILL_TYPES` уже робить.
- Усі рядки — з `messages/`, ніколи інлайном у JSX. Status line збирається на
  клієнті з `messages/`, зі структури, яку віддав сервер, — сервер рядок не
  форматує.
- **Кожна асинхронна дія показує лоадер.** Кнопка-тригер отримує
  `loading={isPending}` плюс `…`-лейбл із `messages/`; повільні області —
  `Skeleton` **з** іменованим `role="status"` рядком, що каже, що саме
  вантажиться (це і є NFR-14). Мутація з подальшим `router.push` тримає busy до
  завершення навігації, а не до `onSuccess`.
- Кожен feature-компонент — колокована тека `_components/<Name>/` з `Name.tsx` ·
  `constants.ts` · `styles.ts` · `index.ts` · `Name.test.tsx`. **`src/features/` у
  цьому репозиторії не існує** — там, де `ui-frontend-architecture` описує
  `src/features/*`, чинним є `client/CLAUDE.md`.
- **`@testing-library/user-event` не встановлений.** Інтеракційні тести
  використовують `fireEvent` з `@testing-library/react`. Імпорт `user-event`
  падає на збиранні з помилкою, що називає тест-файл, а не відсутній пакет.
- Автоматичного архітектурного гейта у фронтенді немає (`arch:check` у
  `client/` відсутній). Ці обмеження **і є** гейт.

## Implementation steps

### Step 1 — Хук-шар
- **Files:** `client/src/lib/hooks/project-context.ts` (new), `client/src/lib/hooks/index.ts` (edit)
- **Do:** `useContextDocs(repoId)`, `useContextDoc(repoId, path)`,
  `useSaveContextDoc()`, `useDirtyContextDocs(repoId)`,
  `useAgentContextDocs(agentId)` / `useSetAgentContextDocs()`,
  `useSkillContextDocs(skillId)` / `useSetSkillContextDocs()` — форма
  `hooks/skills.ts`, тонкі обгортки над `api`, з інвалідацією зв'язаних ключів.
  `useSaveContextDoc` після успіху інвалідує і документ, і `dirty`-запит, бо
  запис робить файл брудним (AC-21). **`useContextDoc` ставить
  `staleTime: 0` і `gcTime: 0`** — AC-19 забороняє кешувати показану оцінку
  токенів між запитами, а вона приїжджає в тій самій відповіді.
- **Done when:** `pnpm typecheck` у `client/` — exit 0.

### Step 2 — AC-50: whitelist схем у `Markdown` primitive
- **Files:** `client/src/vendor/ui/primitives/Markdown.tsx`, `client/src/vendor/ui/primitives/Markdown.test.tsx` (new)
- **Do:** У `a`-рендерері (рядки 31-35) пропускати `href` лише для `http:`,
  `https:`, `mailto:` і відносних якорів; усе інше рендерити як звичайний
  текст без `href` (не як мертве посилання — мертве посилання виглядає
  клікабельним). Розбирати через `new URL(href, 'https://x.invalid')` у
  `try/catch`, не регексом — `java\tscript:` та URL-кодовані форми регекс
  обходять. `rehype-raw` **не** додавати: його відсутність і є та половина
  AC-50, що вже працює.
- **Done when:** новий тест доводить, що `[x](javascript:alert(1))` рендериться
  без атрибута `href`, а `[y](https://example.com)` — з ним; наявні 108 тестів
  клієнта лишаються зеленими.

### Step 3 — `ContextTab` (спільний для агента і скіла)
- **Files:** `client/src/app/agents/[id]/_components/AgentEditor/_components/ContextTab/{ContextTab.tsx,constants.ts,styles.ts,index.ts,ContextTab.test.tsx}` (new), `.../AgentEditor/constants.ts` (edit), `.../SkillDetail/_components/ContextTab/` (new, тонка обгортка) , `.../SkillDetail/constants.ts` (edit), `messages/en/agents.json` + `skills.json` (edit)
- **Do:** Один компонент, параметризований `{ entity: 'agent' | 'skill'; id: string; repoId: string }`.
  Форма — `SkillsTab`: один список, вкладені першими в persisted order (AC-52),
  далі решта; чекбокс вкладає/відкладає (AC-8/AC-9); нативний HTML5 drag
  реордерить (AC-11); ▲/▼ поруч — клавіатурний еквівалент (NFR-13), видимі при
  фокусі, не лише при hover. Рядок несе шлях, префікс і тип-мітку з matched root
  (AC-7/AC-64) у фіксованому кольорі для `specs/`/`docs/`/`insights/` і
  нейтральному для будь-якого іншого (AC-65/AC-68). Відсутній шлях позначається
  текстом «missing», вкладення **не** знімається (AC-37). Заголовок —
  «N of M attached» (AC-13); підвал — сумарна оцінка з маркером `≈` і поясненням
  (AC-16/AC-17). Спроба 21-го — тост із текстом ліміту, чекбокс не перемикається
  (AC-12). Підпис під списком описує **лише** ефект на зібраний блок, без обіцянки
  якості рев'ю (D-6). Додати запис `context` у `TABS` і в `SKILL_TABS`.
  Чекбокси, фільтр і контроли прев'ю — справжні `<input>`/`<button>`, не `div` з
  `onClick` (NFR-12).
- **Done when:** тест на `fireEvent` доводить перемикання, реордер через ▲/▼,
  відхилення 21-го і рендер мітки для кастомного root `adr/`.

### Step 4 — Сторінка Project Context
- **Files:** `client/src/app/repos/[repoId]/project-context/page.tsx` (new), `.../_components/ProjectContextView/{ProjectContextView.tsx,constants.ts,styles.ts,index.ts,ProjectContextView.test.tsx}` (new), `client/src/vendor/ui/nav.ts` (edit), `messages/en/context.json` (rewrite)
- **Do:** Сторінка тонка; уся логіка — у `ProjectContextView`. Двоколонковий
  лейаут: список документів ліворуч, прев'ю праворуч.
  **Status line** (AC-3, AC-57…AC-63, NFR-19, NFR-22) збирається з структури
  сервера: кількість · `≈ N tokens` з маркером і поясненням · час сканування.
  Стани, кожен свій ключ у `context.json`: сума рахується → pending-індикатор
  **на місці суми**, лістинг рендериться негайно (AC-61); порожній лістинг →
  явні «0 tokens» (AC-62); репо не клоновано → кількість і сума **відсутні**, не
  нулі (AC-63); хоч один fallback → приписка (AC-60); обрізано на 1000 →
  приписка (NFR-19); вихід за межі NFR-20 → приписка, що сума покриває лише
  показані (NFR-22).
  **Три стани відсутності, які специфікація розрізняє:** roots нічого не дали →
  порожній стан, що **називає обшукані roots** (AC-5); репо не клоноване →
  окремий стан, не порожній список (AC-6); клон недоступний → повідомлення про
  неможливість прочитати, **ніколи** порожній список як успіх (NFR-7).
  Прев'ю — через `Markdown` primitive із кроку 2 (AC-4/AC-50). «Used by N agents»
  на кожному документі (AC-14). Режим `edit` пише в working tree; на успіху —
  постійний **текстовий** стан «uncommitted», який каже, що зміна існує лише в
  локальному клоні й зникне на наступному resync (AC-21, NFR-15 — не кольором).
  Провал показує причину (AC-55). Хлібні крихти `<repo> > Project Context`
  (AC-67). У `nav.ts` — запис у секцію `WORKSPACE` з
  `href: "/repos/:repoId/project-context"`; `gKey` **не** призначати — вільних
  однолітерних чордів у `SHORTCUTS` немає, а колізія тихо перехопить наявний.
  Переписати `context.json`: прибрати `chunks` (D-3), замінити `empty.body`, що
  згадує `.devdigest/specs/` (D-2), на текст із налаштованими roots; зберегти
  `mode.*` та `editor.save`.
- **Done when:** тест рендерить усі шість станів status line і обидва стани
  відсутності; `AppShell` замоканий, і `next/navigation` теж — мокати лише
  один із двох усе одно кидає «invariant expected app router to be mounted».

### Step 5 — Попередження при resync (AC-22/AC-53/AC-66)
- **Files:** `client/src/app/repos/[repoId]/pulls/...` або де живе кнопка resync (знайти через `useResyncRepo`), `messages/en/context.json`
- **Do:** Перед викликом `useResyncRepo().mutate()` виконати
  `useDirtyContextDocs(repoId)`. Непорожній результат → модальне підтвердження
  зі списком шляхів, які буде перезаписано, і текстом, що `sync()` робить
  `git reset --hard origin/<branch>` (`simple-git.ts:86`) і незакомічені правки
  зникнуть. Resync **не** викликається, поки користувач не підтвердив (AC-53).
  Порожній результат → resync іде без модалки. Список приходить із сервера вже
  обмеженим до `*.md` під налаштованими roots (AC-66) — клієнт **не** фільтрує
  повторно й не показує іншої розбіжності клона.
- **Done when:** тест доводить, що при непорожньому `dirty` мутація resync не
  викликається до підтвердження, і викликається після.

### Step 6 — Дровер траси: обидві форми `specs_read` + блок `Project context`
- **Files:** `.../RunTraceDrawer/_components/TraceBody/TraceBody.tsx`, `.../RunTraceDrawer/helpers.ts`, `messages/en/runs.json`, `.../TraceBody/TraceBody.test.tsx` (new або edit)
- **Do:** Замінити ітерацію на `trace.specs_read` (`TraceBody.tsx:41-44`)
  нормалізацією в `helpers.ts`:
  ```
  normalizeSpecsRead(raw): { path, tokens: number|null, status: string|null,
                             origin: string|null, skillName: string|null }[]
  ```
  де елемент-`string` дає `{ path: s, tokens: null, status: null, origin: null, skillName: null }`.
  **Це єдиний захист від зламу історичних трас**: `run.repo.ts:217` кастить
  сирий jsonb, маршрут не має response-схеми, `hooks/trace.ts` теж кастить —
  жоден шар не парсить, тож стара траса доїде сюди голими рядками.
  Рендер: шлях · `≈ N tokens` з маркером і підписом, що це заміряно **для цього
  рану** і може відрізнятися від оцінки в редакторі (AC-16/AC-39/AC-43) · бейдж
  статусу `injected`/`truncated`/`dropped for budget`/`missing` (AC-56) ·
  походження `agent` або `via <skill>` (AC-40). Для старої форми — сам шлях без
  бейджів і без «unknown»-заглушок.
  Додати блок `Project context` у секцію `promptAssembly` через наявний
  `PromptBlock` із `trace.prompt_assembly.specs` — **точний** інжектований текст
  разом із делімітерами `<untrusted source="spec-N">` (AC-41). `specs` уже
  `nullish` у `PromptAssembly`, тож на старих трасах блок опускається сам.
  Непорожній `specs_reader_error` — окремий рядок (NFR-6).
- **Done when:** тест рендерить **дві** фікстури траси — одну зі старим
  `specs_read: ["docs/a.md"]`, одну з новою формою — і обидві не кидають; бейджі
  з'являються лише на новій.

### Step 7 — e2e-флоу
- **Files:** `e2e/specs/09-project-context.flow.json` (new)
- **Do:** Флоу US-3 + US-6: відкрити сторінку Project Context, відкрити вкладку
  `Context` агента, вкласти документ, запустити рев'ю, відкрити трасу і
  побачити шлях у `Specs read`.
- **Done when:** `pnpm e2e:hermetic` у `e2e/` проходить.

## Verification plan

| When | Command | Run from | Pass criterion |
|---|---|---|---|
| перед стартом | `pnpm lint > lint-base.log 2>&1; echo "exit=$?"` | `client/` | зафіксувати **0 errors, 3 warnings** |
| перед стартом | `pnpm exec vitest run` | `client/` | зафіксувати 108 passed / 22 files |
| перед стартом | `pnpm typecheck` | `client/` | exit 0 |
| після кожного кроку | `pnpm typecheck > tc.log 2>&1; echo "exit=$?"` | `client/` | exit 0 — у клієнта немає передіснуючих помилок, тож будь-яка нова є регресією |
| після Steps 2, 3, 4, 5, 6 | `pnpm exec vitest run` | `client/` | ≥ 108 + нові, 0 failed |
| після Steps 3, 4, 6 | `pnpm lint > lint.log 2>&1; grep -c warning lint.log` | `client/` | **3** — 4-е попередження є регресією; типове джерело — `exhaustive-deps` після інлайн-об'єкта в JSX |
| після Steps 4, 6 | `pnpm exec vitest run 2>&1 \| grep IntlError; echo "grep-exit=$?"` | `client/` | без збігів — `t.rich` із тегом, якого немає в рядку повідомлення, кидає проковтнутий `IntlError`, видимий лише як шум у stderr, і суїта лишається зеленою |
| після Step 4 | `pnpm build` | `client/` | exit 0 — `next build` ловить те, що `tsc --noEmit` пропускає: перший імпорт **значення** з `vendor/shared` ламає webpack-резолв `.js`-специфікаторів |
| після Step 7 | `pnpm e2e:hermetic` | `e2e/` | exit 0 |
| фінал | `pnpm typecheck` · `pnpm lint` · `pnpm exec vitest run` · `pnpm build` | `client/` | чотири окремі команди, жодного пайпа в `tail`/`head` |

Baseline to record before starting: client typecheck exit 0; lint 0 errors /
**3** warnings; 108 tests / 22 files.

**Пастки клієнтських тестів:** `user-event` не встановлений — усі інтеракції
через `fireEvent`. Будь-який top-level `*View` тягне `AppShell` →
`useRouter`/`usePathname`: мокати **обидва** (`@/components/app-shell` **і**
`next/navigation`) — мок лише одного все одно кидає «invariant expected app
router to be mounted». `getByDisplayValue` ніколи не збігається з багаторядковою
`textarea` (RTL нормалізує пробіли в матчері, але порівнює з сирим `value`) —
матчити регексом на перший рядок. Клік по тексту всередині картки не запускає
її `onClick` — вибирати через `closest("div[style*='cursor: pointer']")`. jsdom
не має `Element.prototype.scrollIntoView` — застабити раз на файл.

## Acceptance
- [ ] AC-3, AC-5, AC-6, AC-57…AC-63, NFR-7, NFR-19, NFR-22 — status line у всіх шести станах; порожній, не-клонований і недоступний клон розрізняються, і жоден не показується як успішний порожній список.
- [ ] AC-4, AC-50 — прев'ю рендериться як markdown без виконання HTML, і посилання з не-`http(s)` схемою не активується.
- [ ] AC-7, AC-13, AC-52, AC-64, AC-65, AC-68 — вкладка `Context` списує всі документи зі станом, префіксом і тип-міткою з matched root; лічильник «N of M»; persisted order усюди.
- [ ] AC-8, AC-9, AC-11, AC-12, AC-37, NFR-12, NFR-13 — вкладання, реордер драгом і ▲/▼, відхилення 21-го з текстом ліміту, «missing» без зняття вкладення; усе досяжне з клавіатури.
- [ ] AC-16, AC-17, AC-43 — кожна показана цифра токенів має маркер `≈` і пояснення; цифра в трасі підписана як заміряна для цього рану.
- [ ] AC-20, AC-21, AC-55, NFR-15 — збереження пише в working tree; стан «uncommitted» постійний і виражений текстом, не лише кольором; провал показує причину.
- [ ] AC-22, AC-53, AC-66 — resync не стартує, поки користувач не підтвердив попередження зі списком брудних `*.md` під roots.
- [ ] AC-14, AC-67 — «Used by N agents» на кожному документі; сторінка scoped на один репозиторій.
- [ ] AC-38…AC-41, AC-56 — траса показує шлях, токени, статус і походження; блок `Project context` показує точний інжектований текст із делімітерами.
- [ ] **Стара траса з `specs_read: ["docs/a.md"]` рендериться без помилки і без заглушок «unknown».**
- [ ] NFR-14 — кожна асинхронна дія має лоадер, а повільна область — `role="status"`, що називає, що вантажиться.
- [ ] `client` lint: 0 errors, рівно 3 попередження. `pnpm build`: exit 0.

## Out of scope
- Будь-яка серверна зміна (`0001a`, `0001b`). Якщо крок вимагає нового поля —
  це двофайлова правка `vendor/shared` з обов'язковим `diff`, і вона належить попереднім частинам.
- Написання чи правка специфікації.
- Вкладки `Evals`, `Stats`, `CI`; створення, завантаження, перейменування,
  видалення документів; коміт/пуш; `COVERAGE`-кільце; лічильник чанків — Non-goals специфікації.
- Розширення `Used by N agents` до «N agents · M skills» — рекомендовано, не робиться тут.

## Open questions
- **Чи має сторінка Project Context бути досяжною без активного репозиторію?**
  `nav.ts` резолвить `:repoId` через `resolveHref`, який на відсутньому репо
  підставляє `_` і дає 404-подібний стан. Продовжую тим самим шляхом, що й
  `Pull Requests` — той самий компроміс уже прийнято для наявного пункту меню.
- **Ризиковані та погано верифіковані пункти обсягу, названі явно:** AC-22 і
  AC-53 перетинають UI та індексатор і не мають наявного тестового шва — крок 5
  створює перший; NFR-1 і NFR-2 (і NFR-20) не мають автоматичної гарнітури й
  фікстури реального масштабу, тож перевіряються **вручну**, а замір мусить
  включати **холодний** перший виклик енкодера — ліниво ініціалізований BPE
  робить перший виклик у процесі істотно повільнішим, і бенчмарк на теплому
  енкодері занижує вартість відкриття сторінки.
