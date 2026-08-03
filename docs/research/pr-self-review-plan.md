# План: скіл `pr-self-review`

Локальний self-review усіх незакомічених/незапушених змін **до** відкриття PR.
Маршрутизує diff на релевантні наявні скіли й блокує PR, якщо знайдено хоча б
один **CRITICAL** finding.

---

## 1. Мета й межі

**Що робить:**
1. Збирає повний набір змін відносно `main` (staged + unstaged + untracked + коміти гілки).
2. Класифікує кожен змінений файл у *домени* (backend, frontend, DB, tests, e2e, infra).
3. Для кожного домену запускає **тільки релевантні** скіли з `.claude/skills/`.
4. Агрегує findings з єдиною severity-шкалою.
5. Виносить вердикт: `PASS` / `WARN` / `BLOCK`. При `BLOCK` — забороняє відкривати PR.

**Чого НЕ робить:**
- не пише код і не «фіксить» автоматично (окремий явний крок `--fix`, за замовчуванням off);
- не дублює CI (типи/лінт/тести — це `.github/workflows/*`, скіл лише читає їхній результат, якщо його попросили);
- не рев'ює `server/clones/**` (третьосторонні чекаути, виключені за конвенцією CLAUDE.md).

---

## 2. Розташування та артефакти

```
.claude/skills/pr-self-review/
├── SKILL.md              # головний файл: workflow, вердикт, severity
├── routing.md            # таблиця glob → скіли (єдине джерело правди)
├── severity.md           # що таке CRITICAL/HIGH/MEDIUM, як мапити чужі шкали
└── report-template.md    # формат звіту
```

Плюс:
- рядок у `.claude/skills/README.md` (каталог) — scope `Shared`;
- (опційно, п.8) `.claude/settings.json` з `PreToolUse` hook на `gh pr create`.

---

## 3. Frontmatter скіла

```yaml
---
name: pr-self-review
description: >
  Локальний self-review змін перед відкриттям PR. Збирає diff відносно main,
  маршрутизує змінені файли на релевантні скіли (UI-скіли на UI-файли,
  backend-архітектурні на backend-файли), агрегує findings і блокує створення
  PR при наявності CRITICAL. Use before opening a pull request, before
  `gh pr create`, when the user asks to review local changes, self-review,
  pre-PR check, or "чи можна мержити". Trigger terms: self review, pre-PR,
  before PR, gh pr create, review my changes, готовий до PR, блокувати мерж.
allowed-tools: Read, Write, Grep, Glob, Bash, Skill
metadata:
  tags: review, pre-pr, quality-gate, diff-routing, skills-orchestration
---
```

`Write` обов'язковий: скіл наприкінці пише `.git/pr-self-review-result.json`,
інакше hook з §8 не має що читати і gate не працює.

Важливо: `description` має містити і український, і англійський тригерний
словник — репозиторій ведеться англійською, спілкування українською.

---

## 4. Крок 1 — збір змін

Порядок команд (усі read-only, безпечні для allowlist):

```bash
git fetch origin main --quiet                # база порівняння
MERGE_BASE=$(git merge-base HEAD origin/main)
git diff --name-status $MERGE_BASE            # коміти гілки + робоче дерево
git diff --name-status --cached               # staged
git ls-files --others --exclude-standard      # untracked
git diff $MERGE_BASE --stat                   # обсяг
```

Правила:
- Якщо гілка = `main` і немає віддаленої бази → порівнювати з `HEAD` (тільки working tree) і **попередити**, що PR з `main` не відкривають.
- **`git fetch` вимагає мережі.** Якщо він падає (офлайн, немає доступу до
  remote) — не зупинятись: fallback на локальний `origin/main` і явна помітка
  в звіті, що база порівняння може бути застарілою. Якщо локального
  `origin/main` теж немає — fallback на `main`, далі на `HEAD~1`.
- Untracked файли читаються цілком (для них немає diff).
- Виключення завжди: `server/clones/**`, `**/node_modules/**`, `*.lock`, `pnpm-lock.yaml`, `**/dist/**`, `*.tsbuildinfo`.
- **Ліміт обсягу — 60 файлів.** Понад цей поріг diff рев'юїться пакетами по
  доменах (backend → UI → DB → решта), кожен пакет окремим проходом. Жодного
  мовчазного обрізання: у звіті вказується, що прогін був пакетним і скільки
  пакетів. Вердикт виноситься лише після **всіх** пакетів — якщо хоч один не
  завершився, результат не записується і gate лишається зачиненим.
- **Кешу немає — щоразу повний прогін.** Свідомий вибір на користь простоти й
  чесності: інкрементальний рев'ю по SHA пропустив би finding, що виникає від
  *взаємодії* нового файлу зі старим (наприклад, імпорт, який щойно став
  порушенням шару). Ціна — час прогону; вона прийнятна, бо запуск один раз
  перед PR, а не на кожен збережений файл.

---

## 5. Крок 2 — маршрутизація diff → скіли (`routing.md`)

Ядро скіла. Таблиця glob-патернів; файл може потрапити в кілька рядків — скіли об'єднуються в множину.

| # | Glob | Домен | Скіли до запуску |
|---|------|-------|------------------|
| 1 | `client/src/app/**`, `client/src/components/**`, `client/**/*.tsx` | UI | `ui-frontend-architecture`, `react-best-practices`, `next-best-practices` |
| 2 | `client/src/app/**/{page,layout,route,loading,error}.tsx`, `client/next.config.mjs` | Next.js специфіка | `next-best-practices` |
| 3 | `client/src/**/*.test.tsx`, `client/src/test/**` | UI-тести | `react-testing-library` |
| 4 | `server/src/modules/**`, `server/src/adapters/**`, `server/src/platform/**`, `reviewer-core/src/**` | Backend-архітектура | `onion-architecture` |
| 5 | `server/src/modules/**/*.routes.ts`, `server/src/app.ts`, `server/src/server.ts`, `server/src/platform/**` | HTTP-шар | `fastify-best-practices` |
| 6 | `server/src/db/**`, `**/schema.ts`, `**/*.repository.ts` | Персистентність | `drizzle-orm-patterns`, `postgresql-table-design` |
| 7 | `server/src/db/migrations/**`, `**/drizzle/**` | Міграції | `postgresql-table-design`, `drizzle-orm-patterns` |
| 8 | будь-який `*.ts`/`*.tsx` зі змінами, що містять `z.object`/`z.infer`/`safeParse` | Валідація | `zod` |
| 9 | усі `*.ts`, `*.tsx` | Мова | `typescript-expert` |
| 10 | `server/src/modules/**` (auth/settings/secrets), `**/*.routes.ts`, будь-що, що торкається `~/.devdigest/secrets.json`, env, токенів | Безпека | `security` |
| 11 | `e2e/**` | E2E | (немає профільного скіла — базовий чекліст у SKILL.md) |
| 12 | `.github/workflows/**`, `docker-compose.yml`, `scripts/**` | Infra | (базовий чекліст) |

**Правило відсікання шуму:** скіл із рядка 9 (`typescript-expert`) і 10 (`security`)
запускається лише якщо в diff є змістовні зміни, а не лише форматування/коментарі.

**Guard-правила поверх таблиці** (перевіряються завжди, дешеві, без запуску скіла):
- секрети/токени в diff (шаблони `sk-`, `ghp_`, `AKIA`, `PRIVATE KEY`) → одразу CRITICAL;
- зміна `server/src/db/**` без відповідної міграції → CRITICAL (конвенція: міграції не бігають на бутстрапі);
- DB-тест, названий не `*.it.test.ts`, але з реальним підключенням → HIGH (потрапить у герметичну сюїту);
- імпорт з `server/clones/**` → CRITICAL.

---

## 6. Крок 3 — виконання перевірок

### Крок 0 — детерміновані перевірки ПЕРЕД будь-яким LLM-проходом

`typecheck` і тести дають CRITICAL-класу відповіді безкоштовно й без false
positive. Витрачати десять LLM-проходів на diff, який навіть не компілюється, —
марно.

| Перевірка | Де | Умова запуску | Наслідок падіння |
|-----------|-----|---------------|------------------|
| `pnpm typecheck` | у кожному зачепленому пакеті | є змінені `*.ts`/`*.tsx` | **CRITICAL → миттєвий BLOCK**, LLM-проходи не запускаються |
| `pnpm arch:check` | `server/` | змінено backend-файли | **CRITICAL** (порушення шару, доведене графом імпортів) |
| `pnpm test` | у зачепленому пакеті | опційно, за прапорцем `--with-tests` | CRITICAL |

**Стан на 2026-08-03 (перевірено прогоном):** `arch:check` **існує** в `server/`
і `reviewer-core/` (dependency-cruiser 17.4.3), у `client/` є `lint`. Набір
скриптів різний по пакетах — перед запуском перевіряти `package.json`.

Три пастки, знайдені на живому прогоні й уже враховані в `SKILL.md`:

1. **`| tail` з'їдає код виходу** — `pnpm typecheck 2>&1 | tail -15` завжди дає
   exit 0. Треба редирект у файл і `$?`.
2. **`arch:check` виходить з 0, маючи 20 порушень** — усі правила налаштовані як
   `warn`. Судити за кодом виходу означає пропустити всі. Треба парсити рядок
   `x N dependency violations`.
3. **`pnpm` падає на pre-install перевірці** (`ERR_PNPM_IGNORED_BUILDS`) ще до
   скрипта. Це проблема середовища, не коду — не має давати `BLOCK`. Fallback:
   викликати `node node_modules/typescript/bin/tsc` напряму (але **не**
   `node_modules/.bin/`, це shell-shim, node на ньому падає з `SyntaxError`).

Перевірка anti-noise правила на реальних даних: з 20 порушень `arch:check` лише
**2** припадають на файли з diff. Решта 18 — наявний борг, який скіл ігнорує.

Розподіл ролей: **інструмент ловить те, що доводиться графом і типами; LLM —
те, що потребує читання змісту** (чи правильний це шар за суттю, а не за
напрямком стрілки).

### Крок 1–3 — LLM-проходи по скілах

Для кожного домену, що має ≥1 змінений файл:

1. Завантажити відповідні скіли через `Skill` tool (по одному, послідовно в межах домену).
2. Дати їм **тільки relevant slice** diff'а — не весь diff (контекст і точність).
3. Зібрати findings у нормалізованій формі:

```
{ file, line, severity, skill, rule, what, why, fix }
```

**Розпаралелювання:** домени незалежні — backend-домен і UI-домен можна виконувати
паралельно (окремі проходи), але **не** спавнити субагентів за замовчуванням;
це робиться інлайн. Субагенти — тільки якщо користувач явно попросить.

**Крок 4 — запис insights.** Наприкінці прогону викликається скіл
`engineering-insights` і записує в найближчий `INSIGHTS.md` те, що виявилося
неочевидним: повторювані патерни findings, false positive, які довелося
калібрувати, тонкощі маршрутизації. Умова: **тільки на `PASS`/`WARN`**.
При `BLOCK` цей крок пропускається — поки блокери не виправлені, «урок» ще не
дожитий до кінця, і запис у `INSIGHTS.md` змішався б із незакінченим
полагодженням. Записи, за конвенцією самого скіла, — англійською.

---

## 7. Severity та вердикт (`severity.md`)

Проблема: скіли мають різні шкали (`react-best-practices` — CRITICAL/HIGH/MEDIUM;
`security` — HIGH/MEDIUM/LOW confidence; `onion-architecture` — порушення/не порушення).
Потрібна нормалізація.

| Наш рівень | Що сюди мапиться | Наслідок |
|-----------|------------------|----------|
| **CRITICAL** | секрет у diff; порушення dependency rule (inner→outer import); SQL-ін'єкція / XSS / обхід auth з HIGH confidence у `security`; CRITICAL з `react-best-practices`; зміна схеми без міграції; імпорт з `clones/` | **BLOCK** |
| **HIGH** | HIGH з react/next; MEDIUM-confidence security; відсутній індекс на FK; неправильна назва DB-тесту; `'use client'` піднятий занадто високо | WARN (не блокує) |
| **MEDIUM** | стилістика, найменування, дрібні перформанс-поради | інформативно |

**Вердикт:**
- `BLOCK` — ≥1 CRITICAL. Явно сказати: **PR відкривати не можна**, перелічити блокери, дати fix для кожного.
- `WARN` — 0 CRITICAL, ≥1 HIGH. PR можна відкривати, але список — у описі PR.
- `PASS` — інше.

**Ключове правило проти false positive:** finding йде в CRITICAL лише коли
підтверджено *трасуванням* (є конкретний файл, рядок і сценарій відмови).
Підозра без підтвердження → максимум HIGH. Це прямо запозичено з
confidence-таблиці скіла `security`.

### Anti-noise контракт (без нього gate помре)

1. **Тільки рядки з diff.** Скіл не має права репортити finding у файлі, якого
   немає в diff, або в рядку, якого не торкалися. Наявний технічний борг — не
   предмет цього рев'ю. Інакше PR, що змінив один рядок у старому модулі,
   отримає двадцять зауважень до сусіднього коду, і всі почнуть писати
   `PR_SELF_REVIEW=skip`.
   Виняток лише один: змінений рядок **ламає** існуючий код деінде — тоді
   репортиться зі сценарієм відмови.
2. **У CRITICAL не потрапляють** «best practice deviation», стилістика,
   найменування, «можна було б краще». Тільки те, що ламається: падає, тече,
   пускає чужого, втрачає дані.
3. **Один finding — одне місце.** Той самий патерн у п'яти файлах — це один
   finding зі списком місць, не п'ять.
4. **Мовчання — валідний результат.** `PASS` без жодного finding не означає, що
   рев'ю не спрацювало. Вигадувати зауваження, щоб виглядати корисним, —
   найшвидший спосіб втратити довіру до gate.

### Що робити після BLOCK

Вердикт без наступного кроку робить скіл вахтером. При `BLOCK`:

- кожен CRITICAL **зобов'язаний** містити конкретний fix (не «перегляньте
  підхід», а що саме змінити);
- скіл пропонує `/pr-self-review --fix` для механічних правок (порядок
  імпортів, винесення типу в порт, перейменування DB-тесту) з обов'язковим
  повторним прогоном після;
- змістовні правки лишаються людині — `--fix` їх не чіпає й каже про це прямо;
- `--fix` **ніколи не запускається сам** — тільки за явним викликом.

---

## 8. Тригер: автоматичний та ручний — **блокування увімкнено**

**Ручний:** `/pr-self-review` (скіл user-invocable за замовчуванням).

**Автоматичний перед PR:** `PreToolUse` hook у `.claude/settings.json`, що
перехоплює `gh pr create` і **справді забороняє** його виконання.

```jsonc
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "Bash",
      "hooks": [{
        "type": "command",
        "command": "node .claude/hooks/pr-guard.mjs",
        "if": "Bash(gh pr create*)",     // хук не спавниться на інших командах
        "timeout": 10,
        "statusMessage": "PR self-review gate…"
      }]
    }]
  }
}
```

Ключові деталі реалізації `pr-guard.mjs` (перевірено по схемі settings.json):

- Відмова повертається через **`hookSpecificOutput.permissionDecision: "deny"`**,
  а не через `decision: "block"` — останнє для `PreToolUse` вважається застарілим:
  ```json
  {
    "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "permissionDecision": "deny",
      "permissionDecisionReason": "PR self-review: 2 CRITICAL. Виправ і перезапусти /pr-self-review."
    }
  }
  ```
- Поле `if` фільтрує за патерном команди на рівні харнеса, тому хук не
  запускається на кожному `Bash` — сам скрипт лише перестраховується, читаючи
  `tool_input.command` зі stdin.
- Джерело правди про вердикт — `.git/pr-self-review-result.json`, який скіл
  пише в кінці прогону: `{ sha, verdict, criticalCount, timestamp }`.
  Файл усередині `.git/`, тому ніколи не потрапляє в коміт.
- **Deny, якщо:** вердикт `BLOCK`; або `sha` у файлі ≠ поточний `HEAD`
  (тобто після рев'ю щось змінилося); або файлу немає взагалі.
  **Allow, якщо:** `PASS`/`WARN` для поточного SHA.
- Скрипт має бути fail-open на власних помилках (пошкоджений JSON, немає node):
  gate, який ламає роботу через свій же баг, вимкнуть уже за тиждень. Але
  «вердикт відсутній» — це deny, не помилка.

**Escape hatch:** `PR_SELF_REVIEW=skip gh pr create …` — скрипт бачить змінну і
пропускає. Рішення про мерж лишається за людиною, але має бути свідомим і
видимим у транскрипті.

**Доповнення (не заміна):** `pre-push` git-hook, що робить те саме читання
`.git/pr-self-review-result.json`. Він не має доступу до скілів і не може
запустити рев'ю, але ловить push повз Claude Code — з терміналу чи IDE.

⚠️ Після додавання хука конфіг треба перечитати: якщо `.claude/settings.json`
не існував на старті сесії, watcher за ним не стежить. Відкрити `/hooks` один
раз або перезапустити сесію — інакше хук лежить правильний, але не спрацьовує.

---

## 9. Формат звіту (`report-template.md`)

```markdown
## PR Self-Review — ❌ BLOCK

Base: origin/main (a1b2c3d) · 14 файлів · +420 −87
Домени: UI (6), Backend (5), DB (2), E2E (1)
Скіли: ui-frontend-architecture, react-best-practices, onion-architecture,
       drizzle-orm-patterns, security, typescript-expert

### 🔴 CRITICAL — 2 (блокують PR)
1. `server/src/modules/reviews/review.service.ts:42` — [onion-architecture]
   Domain-сервіс імпортує Fastify-тип із platform-шару.
   → Winести тип у порт `modules/reviews/ports.ts`.
2. ...

### 🟠 HIGH — 3
...

### 🟡 MEDIUM — 5
<details>...</details>

### ✅ Чисто
- e2e/specs/pulls.spec.ts — змін по суті немає

**Вердикт: BLOCK.** Виправ 2 CRITICAL і перезапусти `/pr-self-review`.
```

Звіт — українською (мова спілкування), назви правил/скілів/шляхи — як є.

### Блок для тіла PR (на `PASS`/`WARN`)

Прогін закінчується там, де починається реальна робота — опис PR. Тому на
`PASS`/`WARN` скіл одразу віддає **готовий до вставки** markdown, англійською
(мова репозиторію), який автор копіює в тіло PR:

```markdown
## Self-review
Pre-PR self-review passed (`/pr-self-review`).
Checked: UI (6 files), Backend (5), DB (2) · typecheck ✅
Skills applied: ui-frontend-architecture, react-best-practices,
onion-architecture, drizzle-orm-patterns, security

Accepted HIGH findings (deliberate):
- `client/src/components/PullList.tsx:88` — inline sort kept; list is capped at 50.
```

Це те, що перетворює gate з перешкоди на економію часу: рев'юер бачить, що
автор уже пройшовся, і які HIGH лишені свідомо.

---

## 10. Порядок реалізації

| Крок | Що робимо | Результат |
|------|-----------|-----------|
| 1 | `SKILL.md` — каркас: збір diff, вердикт, звіт | працює end-to-end без маршрутизації |
| 2 | `routing.md` — таблиця з п.5 | правильні скіли на правильних файлах |
| 3 | `severity.md` — нормалізація шкал + anti-noise контракт | стабільний вердикт без шуму |
| 4 | Guard-правила + крок 0 (`typecheck`) | дешеві CRITICAL без LLM |
| 5 | Пакетний режим для > 60 файлів | великі PR не обрізаються мовчки |
| 6 | `report-template.md` + запис `.git/pr-self-review-result.json` | стабільний вивід, є що читати hook'у |
| 7 | Hook `pr-guard.mjs` + `.claude/settings.json` | **реальний блок** на `gh pr create` |
| 8 | `pre-push` git-hook (те саме читання результату) | ловить push повз Claude Code |
| 9 | Виклик `engineering-insights` на `PASS`/`WARN` | знахідки не губляться |
| 10 | Рядок у `.claude/skills/README.md` | скіл у каталозі |
| 11 | Прогін на реальній гілці (напр. `feature/lab1-findings-column`) | калібрування false positive |

Кроки 1–4 дають робочий рев'ю без блокування; 7–8 вмикають сам gate. Розумно
пожити на 1–6 кілька PR і лише потім вмикати deny — щоб gate зачинявся на
відкаліброваних правилах, а не на сирих.

---

## 11. Зафіксовані рішення

| # | Питання | Рішення | Де в плані |
|---|---------|---------|-----------|
| 1 | Блокування — hook чи текстова відмова? | **Hook.** `PreToolUse` на `Bash` з `if: "Bash(gh pr create*)"`, відмова через `permissionDecision: "deny"`. Плюс `pre-push` як доповнення проти обходу повз Claude Code. | §8 |
| 2 | Писати `INSIGHTS.md`? | **Так**, через скіл `engineering-insights`, останнім кроком, тільки на `PASS`/`WARN`. | §6, крок 4 |
| 3 | Поріг для великих diff? | **60 файлів** → пакетний прогін по доменах, вердикт тільки після всіх пакетів. | §4 |
| 4 | Кеш чи повний прогін? | **Повний прогін щоразу.** Інкремент по SHA пропускав би findings від взаємодії нового коду зі старим. | §4 |

### Що лишається перевірити на практиці (не блокує старт)

- Поріг 60 файлів — число взяте з голови; відкалібрувати на реальному великому diff.
- Час повного прогону на середньому PR — якщо вийде за межі терпіння, першим
  кандидатом на оптимізацію є не кеш, а звуження набору скілів на домен.
- Частка false positive у CRITICAL після першого тижня — саме вона вирішує,
  житиме gate чи його вимкнуть.
