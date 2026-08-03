# React / Frontend Best Practices — база джерел

Зібрано 2026-08-03. Матеріал-заготовка для майбутнього скіла з написання фронтенду.

Позначки надійності джерел:

- **A** — офіційна документація або першоджерело (react.dev, web.dev, OWASP, репозиторії мейнтейнерів).
- **B** — авторитетні автори та відомі community-ресурси.
- **C** — оглядові статті 2026 року; корисні як зріз галузі, але перевіряйте деталі за джерелами рівня A.

---

## 1. Першоджерела (фундамент скіла)

| Ресурс | Рівень | Про що |
| --- | --- | --- |
| [react.dev — головна документація](https://react.dev/) | A | Канонічна React-документація на функційних компонентах і хуках |
| [You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect) | A | Найважливіша сторінка про анти-патерни `useEffect` |
| [React Compiler](https://react.dev/learn/react-compiler) | A | Автоматична мемоїзація на етапі збірки |
| [React Compiler — Introduction](https://react.dev/learn/react-compiler/introduction) | A | Навіщо компілятор і що він робить |
| [React Compiler — Installation](https://react.dev/learn/react-compiler/installation) | A | Babel, Vite, Metro, Rsbuild |
| [React Compiler — Configuration](https://react.dev/reference/react-compiler/configuration) | A | Опції, зокрема таргет на React < 19 |
| [React Compiler v1.0 (блог)](https://react.dev/blog/2025/10/07/react-compiler-1) | A | Стабільний реліз компілятора |
| [React v19 (блог)](https://react.dev/blog/2024/12/05/react-19) | A | Actions, `use`, ref як звичайний проп |
| [React Versions](https://react.dev/versions) | A | Матриця версій |
| [React Blog](https://react.dev/blog) | A | Джерело оновлень |

**Ключові тези.** React Compiler стабільний і мемоїзує автоматично — `useMemo`/`useCallback` залишаються лише як escape hatch. ESLint-правило компілятора вказує на код, який не піддається оптимізації, тобто порушує Rules of React.

---

## 2. useEffect та анти-патерни хуків

| Ресурс | Рівень | Про що |
| --- | --- | --- |
| [You Might Not Need an Effect (react.dev)](https://react.dev/learn/you-might-not-need-an-effect) | A | Першоджерело |
| [eslint-plugin-react-you-might-not-need-an-effect](https://github.com/nickjvandyke/eslint-plugin-react-you-might-not-need-an-effect) | A | ESLint-плагін, що ловить зайві ефекти автоматично |
| [Обговорення плагіна в Biome](https://github.com/biomejs/biome/discussions/7626) | B | Перспектива портування правил у Biome |
| [You Might Not Need a React Effect (Medium)](https://medium.com/codetodeploy/you-might-not-need-a-react-effect-when-to-delete-that-useeffect-a77c9c13ef67) | C | Коли саме видаляти ефект |
| [Stop Using useEffect Like This (DEV)](https://dev.to/gavincettolo/stop-using-useeffect-like-this-5-patterns-that-are-silently-breaking-your-react-app-5e5f) | C | 5 патернів, що ламають застосунок |
| [You Probably Don't Need useEffect (DEV)](https://dev.to/itspedram/you-probably-dont-need-useeffect-most-of-the-time-3ac9) | C | Оглядово |
| [Are You Overusing useEffect?](https://darryledwards.me.uk/2025/04/02/antipattern-are-you-overusing-useeffect/) | C | Розбір анти-патерну |
| [React anti-patterns that lead to unnecessary complexity](https://letsbuild.cloud/2024-02-22-react-anti-patterns.html) | C | Ширший каталог анти-патернів |

**Ключові тези.** `useEffect` — інструмент синхронізації із зовнішньою системою, а не керування даними. Основні зловживання: обчислювані значення в стані, логіка обробників подій в ефектах, скидання стану при зміні пропа (замість цього — `key` для перемонтування), дзеркалювання одного стану в інший, кілька непов'язаних операцій в одному ефекті.

---

## 3. Server Components і Next.js App Router

| Ресурс | Рівень | Про що |
| --- | --- | --- |
| [React Server Components in practice (Medium)](https://medium.com/@vyakymenko/react-server-components-in-practice-next-js-d1c3c8a4971f) | B | Патерни App Router, streaming, кешування, PPR |
| [Next.js 16 App Router: Complete Guide for 2026 (DEV)](https://dev.to/getcraftly/nextjs-16-app-router-the-complete-guide-for-2026-2hi3) | C | Огляд Next.js 16 |
| [Next.js App Router Best Practices for Production (2026)](https://www.javascriptdoctor.blog/2026/07/nextjs-app-router-best-practices-for.html) | C | Продакшн-практики |
| [How to Handle RSC in Next.js (OneUptime)](https://oneuptime.com/blog/post/2026-01-24-nextjs-react-server-components/view) | C | Практичний розбір |
| [React Server Components: Practical Guide (2026)](https://inhaq.com/blog/react-server-components-practical-guide-2026) | C | Практичний гайд |
| [RSC Complete Guide 2026 (ZAX)](https://z-ax.com/en/blog/react-server-components-complete-guide-2026/) | C | Оглядовий гайд |
| [RSC Guide 2026 (Explainx)](https://www.explainx.ai/blog/react-server-components-guide-2026) | C | Оглядовий гайд |
| [React Stack Patterns (patterns.dev)](https://www.patterns.dev/react/react-2026/) | B | Патерни стеку на 2026 |

**Ключові тези.** Server Components — типовий вибір, Client Components лише там, де потрібні інтерактивність, браузерні API чи локальний стан; клієнтські компоненти тримати листками дерева. Головні пастки: `"use client"` високо в дереві піднімає весь піддерев'я на клієнт; читання `cookies()`/`headers()` у layout вимикає статику та PPR. Треба розрізняти чотири кеші: request memoization, data cache, full route cache, router cache.

---

## 4. Продуктивність і Core Web Vitals

| Ресурс | Рівень | Про що |
| --- | --- | --- |
| [Core Web Vitals 2026: INP, LCP & CLS Optimization](https://www.digitalapplied.com/blog/core-web-vitals-2026-inp-lcp-cls-optimization-guide) | C | Пороги і тактики оптимізації |
| [Fix LCP, INP & CLS in 2026 (DEV)](https://dev.to/dharanidharan_d_tech/fix-lcp-inp-cls-in-2026-the-complete-core-web-vitals-guide-with-real-benchmarks-54cl) | C | З реальними бенчмарками |
| [Web Performance Interview Questions (GreatFrontend)](https://www.greatfrontend.com/blog/web-performance-interview-questions) | B | Систематизація знань про рендеринг і метрики |
| [Core Web Vitals 2026 (Technova)](https://technovapartners.com/en/insights/core-web-vitals-guide-2026) | C | Огляд |
| [Core Web Vitals 2026 (Skymoon)](https://skymooninfotech.com/blogs/core-web-vitals/) | C | Бенчмарки |
| [Web development best practices: 2026 (Netguru)](https://www.netguru.com/blog/web-development-best-practices) | C | Загальний інженерний гайд |

**Ключові тези.** Цілі: LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1 на 75-му перцентилі CrUX за 28 днів. INP — найпроблемніша метрика 2026 року (≈43% сайтів не проходять поріг): треба дробити довгі задачі, віддавати керування головному потоку під час взаємодії, відкладати некритичну роботу, спрощувати DOM. Для LCP найбільший ефект дають preload зображень, інлайн критичного CSS, preload шрифтів із `display: swap` і SSR. Для CLS — явні `width`/`height` на всіх медіа та слотах.

---

## 5. Керування станом

| Ресурс | Рівень | Про що |
| --- | --- | --- |
| [React State Management in 2026 (ncctcr)](https://ncctcr.com/blog/react-state-management-2026) | C | Zustand, TanStack Query, Jotai — коли що |
| [Zustand vs Redux Toolkit (The Road to Enterprise)](https://theroadtoenterprise.com/blog/zustand-vs-redux-toolkit) | B | Предметне порівняння |
| [Stop Choosing State Management Blindly (Medium)](https://medium.com/lets-code-future/stop-choosing-state-management-blindly-zustand-tanstack-query-and-redux-toolkit-finally-9be18cd0ae51) | C | Розмежування задач |
| [State Management in 2026: Redux vs Context vs TanStack Query (DEV)](https://dev.to/iamsaadmehmood/state-management-in-2026-redux-vs-context-vs-tanstack-query-1b0b) | C | Порівняння |
| [How to Choose the Right Solution (Relia Software)](https://reliasoftware.com/blog/react-state-management-libraries) | C | Дерево рішень |
| [React State Management Comparison (Woyable)](https://woyable.com/en/posts/react-state-management-comparison) | C | Таблиця порівняння |
| [Writing Tests (Redux docs)](https://redux.js.org/usage/writing-tests) | A | Офіційний підхід до тестування стану |

**Ключові тези.** Головний зсув мислення — серверний і клієнтський стан є різними задачами. TanStack Query для всього, що приходить з сервера (кеш, рефетч, інвалідація); Zustand для глобального клієнтського стану (домінантний патерн поза Redux-екосистемою); Redux Toolkit виправданий для великих команд і суворих архітектурних стандартів; Context — для конфігурації та провайдерів, не для глобального стану.

---

## 6. Архітектура та структура проєкту

| Ресурс | Рівень | Про що |
| --- | --- | --- |
| [bulletproof-react (GitHub)](https://github.com/alan2207/bulletproof-react) | A | Еталонна продакшн-архітектура React |
| [bulletproof-react — project-structure.md](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md) | A | Конкретна структура тек |
| [React Folder Structure Best Practices (Robin Wieruch)](https://www.robinwieruch.de/react-folder-structure/) | B | Поетапна еволюція структури |
| [Project Standards (React Handbook)](https://reacthandbook.dev/project-standards) | B | Стандарти проєкту |
| [How to structure your React projects (Sandro Roth)](https://sandroroth.com/blog/project-structure/) | B | Практичний розбір |
| [Domain-Driven + Feature-Sliced Design (Medium)](https://medium.com/@albert_barsegyan/the-best-react-js-architecture-for-2026-domain-driven-feature-sliced-design-87f6e25d13fe) | C | FSD у поєднанні з DDD |
| [Scalable React Architecture Patterns 2026 (Softaims)](https://softaims.com/blog/scalable-react-architecture-patterns-2026) | C | Патерни масштабування |
| [Atomic Design + Feature Slices](https://www.codewithseb.com/blog/from-components-to-systems-scalable-frontend-with-atomiec-design) | C | Комбінація методологій |
| [How to Structure a Scalable React Project (Medium)](https://medium.com/@kasunnadeera100/how-to-structure-a-scalable-react-project-2026-guide-d533298dff24) | C | Оглядово |

**Ключові тези.** Колокація перемагає передчасну абстракцію: компонент, хуки, типи, стилі й тести — в одній теці фічі. Feature-Sliced Design задає односпрямовані залежності між шарами, що прибирає циклічні імпорти. Питання не «де лежить файл», а «хто власник домену і які контракти даних».

---

## 7. Доступність (a11y)

| Ресурс | Рівень | Про що |
| --- | --- | --- |
| [WCAG 2.2 Accessibility for React Developers (DEV)](https://dev.to/safdarali25/wcag-22-accessibility-for-react-developers-practical-guide-1b7o) | B | Практичний розбір критеріїв WCAG 2.2 |
| [React A11y Best Practices (rtCamp Handbook)](https://rtcamp.com/handbook/react-best-practices/accessibility/) | B | Хендбук команди |
| [React Accessibility Guide for WCAG-Compliant SPAs](https://www.allaccessible.org/blog/react-accessibility-best-practices-guide) | C | Специфіка SPA |
| [Accessibility Testing in React (Medium)](https://medium.com/@ignatovich.dm/accessibility-testing-in-react-tools-and-best-practices-119f3c0aee6e) | C | Інструменти тестування |
| [Building Accessible Frontend Applications with React (KPMG UK)](https://medium.com/kpmg-uk-engineering/building-accessible-frontend-applications-with-react-7f4b9d5bf9fe) | C | Досвід команди |
| [Frontend System Design: Web Accessibility (DEV)](https://dev.to/zeeshanali0704/frontend-system-design-web-accessibility-a11y-28cf) | C | Системний погляд |

**Ключові тези.** WCAG 2.2 додав критерії, що прямо стосуються React-застосунків: фокус не має бути перекритий, альтернатива до drag-операцій, мінімальний розмір цілі (24×24 px для AA, 44×44 px як бажана практика), консистентна допомога. Контраст: 4.5:1 для звичайного тексту, 3:1 для великого. Інструменти — `eslint-plugin-jsx-a11y`, `axe-core`, Axe DevTools. Автоматика ловить лише 30–40% проблем, ручна перевірка обов'язкова.

---

## 8. Тестування

| Ресурс | Рівень | Про що |
| --- | --- | --- |
| [Testing Library — Learning Material](https://testing-library.com/docs/learning/) | A | Офіційні матеріали |
| [Introducing react-testing-library (Kent C. Dodds)](https://kentcdodds.com/blog/introducing-the-react-testing-library) | A | Першоджерело філософії бібліотеки |
| [Writing Tests (Redux docs)](https://redux.js.org/usage/writing-tests) | A | Тестування зі стором |
| [Testing React Apps in 2026: Vitest, RTL, MSW](https://nirajiitr.com/blog/react-testing-2026-vitest-rtl-msw) | B | Сучасний стек |
| [Next.js Testing 2026: Vitest and Playwright](https://medium.com/@securestartkit/next-js-testing-in-2026-vitest-playwright-0caf6dd1f829) | C | Розподіл між Vitest і Playwright |
| [Master React Testing Step-by-Step (DEV)](https://dev.to/myogeshchavan97/master-react-testing-step-by-step-jest-vitest-react-testing-libraryj-3k60) | C | Покроково |
| [Best practices for using React Testing Library (Medium)](https://medium.com/@ignatovich.dm/best-practices-for-using-react-testing-library-0f71181bb1f4) | C | Список практик |

**Ключові тези.** «Testing Trophy» Кента Доддса: статичний аналіз → інтеграційні тести (основний фокус) → юніти для складної логіки → мінімум E2E на критичні шляхи. Vitest — типовий вибір для нових проєктів (Vite-native, API майже сумісний із Jest). Запити — за тим, що бачить користувач (`getByRole`, `getByLabelText`), не за класами й по можливості не за `test-id`. Якщо рефакторинг ламає тест без зміни поведінки для користувача — тест був неправильний. Async Server Components Vitest відрендерити не може — це зона Playwright.

---

## 9. Форми та валідація

| Ресурс | Рівень | Про що |
| --- | --- | --- |
| [Learn Zod validation with React Hook Form (Contentful)](https://www.contentful.com/blog/react-hook-form-validation-zod/) | B | Ґрунтовний вступ |
| [React Hook Form + Zod: Complete Guide for 2026 (DEV)](https://dev.to/marufrahmanlive/react-hook-form-with-zod-complete-guide-for-2026-1em1) | C | Повний гайд |
| [Form Validation in React with Zod and RHF (NashTech)](https://blog.nashtechglobal.com/form-validation-in-react-with-zod-and-react-hook-form/) | C | Практика |
| [How to Handle Form Validation in React (OneUptime)](https://oneuptime.com/blog/post/2026-01-24-react-form-validation/view) | C | Огляд підходів |
| [React Hook Form & Zod Validation Guide (PracticalDev)](https://practicaldev.online/blog/reactjs/react-hook-form-zod-validation-guide) | C | Приклади |

**Ключові тези.** Зв'язка `react-hook-form` + `zod` через `@hookform/resolvers`: RHF дає неконтрольовані поля й мінімум ре-рендерів, Zod — рантайм-валідацію, узгоджену з типами через `z.infer<typeof schema>`. Схема живе поза компонентом, а не в тілі UI. Для файлів — `z.preprocess` для перетворення `FileList`. Клієнтська валідація не скасовує серверної.

---

## 10. TypeScript у React

| Ресурс | Рівень | Про що |
| --- | --- | --- |
| [TypeScript for React Developers: 12 Common Mistakes (GreatFrontend)](https://www.greatfrontend.com/blog/typescript-for-react-developers) | B | Найкорисніше джерело в розділі |
| [Complete Guide to React Component Props with TypeScript (Steve Kinney)](https://stevekinney.com/courses/react-typescript/component-props-complete-guide) | B | Глибокий розбір пропів |
| [How to Learn TypeScript in 2026 (GreatFrontend)](https://www.greatfrontend.com/blog/how-to-learn-typescript) | B | Роадмап |
| [Typing Patterns: Props, Hooks, Refs, Generics (ResumeLens)](https://www.resumelens.org/blog/typescript/typescript-react-typing-patterns) | C | Патерни типізації |
| [Generic Components in React with TypeScript (OneUptime)](https://oneuptime.com/blog/post/2026-01-15-generic-components-react-typescript/view) | C | Дженерик-компоненти |
| [Type React Props, State, and Hooks (OneUptime)](https://oneuptime.com/blog/post/2026-01-15-type-react-props-state-hooks-typescript/view) | C | Основи |
| [Typing React Conditional Props with Generics](https://www.technetexperts.com/react-generic-props-narrowing/) | C | Звуження умовних пропів |
| [How to Type React Props in TypeScript (Reintech)](https://reintech.io/blog/how-to-type-react-props-typescript-complete-guide) | C | Довідково |

**Ключові тези.** Для пропів зазвичай `type`, а не `interface` — краще працює з юніонами й умовними типами. Справжня складність не в базових речах, а в проміжних: обгортання пропів нативних елементів, дженерики без конфлікту з JSX-синтаксисом, типізація станових машин `useReducer`. Не переускладнювати: тип, який ніхто в команді не може прочитати, — це борг, а не безпека.

---

## 11. Безпека фронтенду

| Ресурс | Рівень | Про що |
| --- | --- | --- |
| [Frontend security primer (Frontend Mastery)](https://frontendmastery.com/posts/frontend-security-primer/) | B | Найсильніший матеріал розділу |
| [Reviewing OWASP Top 10: Front-End with React](https://sokurenko.net/posts/owasp-top-10-react/) | B | OWASP Top 10 крізь призму React |
| [Is React Vulnerable to XSS? (Invicti)](https://www.invicti.com/blog/web-security/is-react-vulnerable-to-xss) | B | Межі вбудованого захисту React |
| [How to Prevent XSS Attacks in React (OneUptime)](https://oneuptime.com/blog/post/2026-01-15-prevent-xss-attacks-react/view) | C | Практика |
| [10 React.js Security Best Practices (Digiqt)](https://digiqt.com/blog/reactjs-security-best-practices/) | C | Чекліст |
| [OWASP Top 10 and frontend security (Zuniweb)](https://zuniweb.com/blog/-frontend-security-essentials-owasp-top-10-secure-auth-and-pentesting-tips/) | C | Огляд |
| [Web Security Best Practices: 2026 Guide](https://www.appsecmaster.net/blog/web-security-best-practices/) | C | Загальний гайд |
| [5 Frontend Security Hacks (Medium)](https://medium.com/@sanjeevanibhandari3/5-frontend-security-hacks-to-save-your-react-app-in-2026-my-real-world-fixes-486cda6fbc64) | C | Практичні фікси |

**Ключові тези.** React екранує рядки при рендері, але це не повний захист: `dangerouslySetInnerHTML`, `href="javascript:"`, інжекція пропів і сторонні інтеграції лишаються векторами. Основна лінія оборони — вихідне кодування під контекст рендеру, а не фільтрація вводу; DOMPurify для санітизації HTML; CSP і Trusted Types як шар зверху. Орієнтири: OWASP ASVS для критеріїв верифікації, OWASP Top 10 для пріоритезації ризиків, NIST SP 800-63 для автентифікації.

---

## 12. Next.js — архітектура

Фокус розділу — межі, структура та композиція, а не продуктивність.

### 12.1. Маршрутизація і файлові конвенції

| Ресурс | Рівень | Про що |
| --- | --- | --- |
| [Next.js Docs: App Router](https://nextjs.org/docs/app) | A | Корінь документації App Router |
| [Getting Started: Project Structure](https://nextjs.org/docs/app/getting-started/project-structure) | A | Повний перелік конвенцій тек і файлів |
| [Getting Started: Layouts and Pages](https://nextjs.org/docs/app/getting-started/layouts-and-pages) | A | Вкладені layout'и й сегменти |
| [File conventions: layout.js](https://nextjs.org/docs/app/api-reference/file-conventions/layout) | A | API layout'а |
| [File conventions: Route Groups](https://nextjs.org/docs/app/api-reference/file-conventions/route-groups) | A | `(folder)` — організація без впливу на URL |
| [File conventions: route.js](https://nextjs.org/docs/app/api-reference/file-conventions/route) | A | Route Handlers |
| [Routing: Project Organization](https://nextjs.org/docs/14/app/building-your-application/routing/colocation) | A | Колокація і приватні теки |
| [App Router: Glossary](https://nextjs.org/docs/app/glossary) | A | Термінологія |
| [Layouts RFC](https://nextjs.org/blog/layouts-rfc) | A | Первинне обґрунтування дизайну App Router |

**Ключові тези.** Теки визначають сегменти URL; маршрут стає публічним лише за наявності `page` або `route`. Спеціальні файли: `page`, `layout`, `loading`, `error`, `route`. Layout'и зберігають стан і не перемонтовуються при навігації. Route Groups `(name)` дають організацію за командою чи доменом і кілька кореневих layout'ів без зміни URL. Приватні теки `_name` виключаються з маршрутизації — зручно для `_components` поряд із маршрутом.

### 12.2. Просунуті патерни маршрутизації

| Ресурс | Рівень | Про що |
| --- | --- | --- |
| [File conventions: Parallel Routes](https://nextjs.org/docs/app/api-reference/file-conventions/parallel-routes) | A | Слоти `@folder`, незалежні loading/error |
| [File conventions: Intercepting Routes](https://nextjs.org/docs/app/api-reference/file-conventions/intercepting-routes) | A | Перехоплення маршруту, маскування URL |

**Ключові тези.** Parallel Routes через слоти `@analytics`, `@team` рендерять кілька сторінок в одному layout'і — кожен слот стрімиться незалежно і має власні `loading`/`error`. Intercepting Routes у парі з Parallel Routes дають канонічний патерн модалок із deep-linking: URL можна поділитися, оновлення сторінки не закриває модалку, «назад» закриває її, «вперед» — відкриває знову.

### 12.3. Межа Server / Client Components

| Ресурс | Рівень | Про що |
| --- | --- | --- |
| [Rendering: Composition Patterns](https://nextjs.org/docs/14/app/building-your-application/rendering/composition-patterns) | A | Офіційні патерни композиції |
| [Client-Server Component Boundaries (Vercel Academy)](https://vercel.com/academy/nextjs-foundations/client-server-boundaries) | A | Навчальний матеріал від Vercel |
| [Next.js Server vs Client Components: Drawing the Right Boundary](https://www.iamraghuveer.com/posts/nextjs-server-vs-client-components/) | B | Найпредметніший розбір межі |
| [RSC in Practice: Patterns and Pitfalls (Certificates.dev)](https://certificates.dev/blog/react-server-components-in-practice-patterns-and-pitfalls) | B | Патерни й пастки |
| [Mastering 'use client' (Strapi)](https://strapi.io/blog/use-client-next-js-client-component-guide) | B | Детально про директиву |
| [RSC vs Client Components — When to Use Which (DEV)](https://dev.to/safdarali25/react-server-components-vs-client-components-when-to-use-which-58kj) | C | Порівняння |

**Ключові тези.** Межа `use client` — найвагоміше архітектурне рішення в App Router. Server Component може містити Client Component, але не навпаки: серверний компонент передається в клієнтський через `children`, а не імпортом. Директива «заразна» — усе, що імпортує клієнтський файл, теж їде в браузер. Типові помилки: `use client` у кореневому layout'і (весь застосунок під ним успадковує межу), провайдери контексту прямо в layout замість окремого клієнтського файлу, монолітні клієнтські компоненти замість винесення лише інтерактивних частин. Правило: посувати межу якнайнижче по дереву.

### 12.4. Data Access Layer і Server Actions

| Ресурс | Рівень | Про що |
| --- | --- | --- |
| [Guides: Data Security (Next.js)](https://nextjs.org/docs/app/guides/data-security) | A | Офіційний гайд, першоджерело патерну DAL |
| [Securing data with Okta and OpenFGA (Vercel)](https://vercel.com/blog/securing-data-in-your-next-js-app-with-okta-and-openfga) | A | Авторизація на рівні даних |
| [Structuring Your Data Access Layer in Next.js (Medium)](https://medium.com/@samrose.mohammed/structuring-your-data-access-layer-in-next-js-patterns-that-actually-scale-2e4c07491866) | B | Патерни DAL, що масштабуються |
| [Understanding the Data Access Layer in Next.js (Ayush Sharma)](https://aysh.me/blogs/data-access-layer-nextjs) | B | Розбір концепції |
| [Protecting Next.js Applications in the Era of Server Actions](https://jsdev.space/server-actions-security/) | B | Безпека Server Actions |
| [Next.js Server Actions in Production: 2026 Patterns](https://www.digitalapplied.com/blog/nextjs-server-actions-production-patterns-2026-guide) | C | Продакшн-патерни |
| [Server Actions Security: The Auth Check Most Developers Miss (DEV)](https://dev.to/shubhradev/nextjs-16-server-actions-security-the-auth-check-most-developers-miss-1ei1) | C | Типова діра в авторизації |

**Ключові тези.** DAL централізує доступ до даних на сервері: авторизація, кешування та формування DTO в одному місці. Кожен модуль DAL імпортує `server-only`, щоб межа трималася на етапі збірки. Перевірки автентифікації й прав живуть **усередині** функцій DAL, а не розсипані по місцях виклику — Server Action є публічною HTTP-точкою, тож відсутність перевірки в ньому це вразливість, а не недогляд. Server Action лишається тонкою обгорткою: виклик DAL плюс `revalidatePath`/`revalidateTag`. Повертати назовні тільки те, що потрібно UI — плаский DTO, ніколи не сирий об'єкт ORM, бо значення, що повертається, серіалізується прямо клієнту.

### 12.5. Структура проєкту на Next.js

| Ресурс | Рівень | Про що |
| --- | --- | --- |
| [Getting Started: Project Structure](https://nextjs.org/docs/app/getting-started/project-structure) | A | Офіційна довідка |
| [Next.js Colocation Template](https://next-colocation-template.vercel.app/) | B | Готовий приклад структури з колокацією |
| [Next.js 16 App Router Folder Structure Best Practices](https://www.dharmsy.com/blog/nextjs-16-app-router-folder-structure) | C | Актуальна структура тек |
| [Next.js Project Structure: Real-World Guide](https://prateeksha.com/blog/nextjs-project-structure-maintainable-real-world) | C | Довгострокова підтримуваність |
| [Next.js project structure (Magic UI)](https://magicui.design/blog/next-js-project-structure) | C | Оглядово |
| [nextjs-project-structures (GitHub)](https://github.com/drbarzaga/nextjs-project-structures) | C | Збірка варіантів структур |

**Ключові тези.** Тримати `app/` виключно для маршрутизації, а бізнес-логіку виносити у `features/` за доменами. Доступ до даних — у `lib/`, щоб серверні компоненти лишалися тонкими й тестованими. Вкладати теки лише тоді, коли цього справді вимагає URL; для організації використовувати route groups. Специфічні для маршруту компоненти колокувати в `_components` поруч, а не звалювати в глобальний `components/`.

---

## 13. Загальні огляди 2026 (контекст, не істина в останній інстанції)

| Ресурс | Рівень | Про що |
| --- | --- | --- |
| [React Stack Patterns (patterns.dev)](https://www.patterns.dev/react/react-2026/) | B | Патерни стеку |
| [React Best Practises (AM Digital Playbook)](https://playbook.platformdev.amdigital.co.uk/Ways-of-Working/Toolkit/Quality-Standards/React-Best-Practises/) | B | Стандарти якості команди |
| [React Best Practices to up Your Game in 2026 (Kinsta)](https://kinsta.com/blog/react-best-practices/) | C | Широкий огляд |
| [33 React JS Best Practices For 2026 (Technostacks)](https://technostacks.com/blog/react-best-practices/) | C | Довгий список |
| [React.js Best Practices In 2026 (AWS Builder Center)](https://builder.aws.com/content/35mjuFWn4hSGCK6JjaZHFIGrzPG/reactjs-best-practices-in-2026) | C | Компілятор, RSC, Suspense |
| [React Best Practices 2026 (DEV)](https://dev.to/nozibul_islam_113b1d5334f/react-best-practices-2026-2ng2) | C | Якість коду |
| [Ultimate Guide to React Development in 2026 (RiseupLabs)](https://riseuplabs.com/react-development-ultimate-guide/) | C | Оглядово |

---

## Що з цього варто взяти в майбутній скіл

Наявний скіл `.claude/skills/react-best-practices/` уже покриває дизайн компонентів, derive-don't-store, хуки, мемоїзацію, ключі, умовний рендеринг, базову a11y та організацію коду. Порівняно з зібраним матеріалом бракує:

1. **React Compiler** — окрема секція: що змінюється в правилах мемоїзації, ESLint-правило як індикатор порушення Rules of React.
2. **Server Components / RSC** — межа `"use client"`, листкові клієнтські компоненти, чотири рівні кешу, пастка з `cookies()`/`headers()` у layout.
3. **Архітектура Next.js** (розділ 12) — найбільший окремий блок майбутнього скіла: межа server/client як головне рішення, route groups і приватні теки, parallel/intercepting routes для модалок, DAL з авторизацією всередині та Server Actions як тонкі обгортки, `app/` лише для маршрутизації.
4. **Core Web Vitals із числовими порогами** — INP ≤ 200 ms як головний біль, дроблення довгих задач, yield до головного потоку.
5. **Розмежування серверного і клієнтського стану** — TanStack Query vs Zustand vs Redux Toolkit як дерево рішень.
6. **Тестування** — Testing Trophy, пріоритет запитів RTL, межа між Vitest і Playwright.
7. **Форми** — `react-hook-form` + `zod` + `z.infer` як типовий стек.
8. **Безпека** — XSS поза межами автоекранування React, DOMPurify, CSP, Trusted Types.
9. **WCAG 2.2** — нові критерії (розмір цілі, фокус не перекрито, альтернатива drag).
10. **Архітектура React загалом** — FSD і bulletproof-react як конкретні орієнтири структури.
