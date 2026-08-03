# ui-frontend-architecture — джерела

Джерельна база скіла [ui-frontend-architecture](SKILL.md), зібрана 2026-08-03.

Позначки надійності:

- **A** — офіційна документація або першоджерело
- **B** — авторитетні автори та відомі community-ресурси
- **C** — оглядові статті 2026 року; корисні як зріз галузі, деталі перевіряти за A

Повне дослідження, з якого вибрано ці джерела (включно з темами поза межами цього скіла —
продуктивність, тестування, безпека, форми), лежить у
[`docs/research/react-frontend-best-practices-sources.md`](../../../docs/research/react-frontend-best-practices-sources.md).

---

## Структура проєкту та архітектура

| Ресурс | Рівень | Що взято в скіл |
| --- | --- | --- |
| [bulletproof-react (GitHub)](https://github.com/alan2207/bulletproof-react) | A | Базова feature-based модель, публічний API фічі |
| [bulletproof-react — project-structure.md](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md) | A | Анатомія теки фічі, заборона глибоких імпортів |
| [Next.js — Getting Started: Project Structure](https://nextjs.org/docs/app/getting-started/project-structure) | A | Приватні теки `_name`, колокація в `app/` |
| [Next.js — Routing: Project Organization](https://nextjs.org/docs/14/app/building-your-application/routing/colocation) | A | Колокація за замовчуванням, коли потрібні приватні теки |
| [Next.js — Route Groups](https://nextjs.org/docs/app/api-reference/file-conventions/route-groups) | A | Організація без впливу на URL, кілька кореневих layout'ів |
| [React Folder Structure Best Practices (Robin Wieruch)](https://www.robinwieruch.de/react-folder-structure/) | B | Еволюція структури за етапами зростання |
| [Project Standards (React Handbook)](https://reacthandbook.dev/project-standards) | B | Стандарти організації проєкту |
| [How to structure your React projects (Sandro Roth)](https://sandroroth.com/blog/project-structure/) | B | Практичний розбір колокації |
| [Next.js Colocation Template](https://next-colocation-template.vercel.app/) | B | Приклад структури з колокацією |
| [Domain-Driven + Feature-Sliced Design (Medium)](https://medium.com/@albert_barsegyan/the-best-react-js-architecture-for-2026-domain-driven-feature-sliced-design-87f6e25d13fe) | C | Шари FSD, односпрямовані залежності (етап 3) |
| [Scalable React Architecture Patterns 2026 (Softaims)](https://softaims.com/blog/scalable-react-architecture-patterns-2026) | C | Ознаки ерозії структури |
| [Next.js 16 App Router Folder Structure](https://www.dharmsy.com/blog/nextjs-16-app-router-folder-structure) | C | `app/` лише для маршрутизації, домени в `features/` |
| [Next.js Project Structure: Real-World Guide](https://prateeksha.com/blog/nextjs-project-structure-maintainable-real-world) | C | Довгострокова підтримуваність |
| [Atomic Design + Feature Slices](https://www.codewithseb.com/blog/from-components-to-systems-scalable-frontend-with-atomiec-design) | C | Межа між дизайн-системою і доменом |
| [nextjs-project-structures (GitHub)](https://github.com/drbarzaga/nextjs-project-structures) | C | Збірка варіантів структур |
| [Next.js project structure (Magic UI)](https://magicui.design/blog/next-js-project-structure) | C | Оглядово |

## Межа Server / Client

| Ресурс | Рівень | Що взято в скіл |
| --- | --- | --- |
| [Next.js — Rendering: Composition Patterns](https://nextjs.org/docs/14/app/building-your-application/rendering/composition-patterns) | A | Передача серверного компонента через `children` |
| [Client-Server Component Boundaries (Vercel Academy)](https://vercel.com/academy/nextjs-foundations/client-server-boundaries) | A | Межа як архітектурне рішення |
| [Drawing the Right Boundary (iamraghuveer)](https://www.iamraghuveer.com/posts/nextjs-server-vs-client-components/) | B | `use client` у layout як найдорожча помилка |
| [RSC in Practice: Patterns and Pitfalls (Certificates.dev)](https://certificates.dev/blog/react-server-components-in-practice-patterns-and-pitfalls) | B | Розділення монолітних клієнтських компонентів |
| [Mastering 'use client' (Strapi)](https://strapi.io/blog/use-client-next-js-client-component-guide) | B | «Заразність» директиви |
| [React Server Components in practice (Medium)](https://medium.com/@vyakymenko/react-server-components-in-practice-next-js-d1c3c8a4971f) | B | Листкові клієнтські компоненти |
| [RSC vs Client Components (DEV)](https://dev.to/safdarali25/react-server-components-vs-client-components-when-to-use-which-58kj) | C | Критерії вибору |

## Шар доступу до даних

| Ресурс | Рівень | Що взято в скіл |
| --- | --- | --- |
| [Next.js — Guides: Data Security](https://nextjs.org/docs/app/guides/data-security) | A | Патерн DAL, `server-only`, DTO замість сирих рядків |
| [Securing data with Okta and OpenFGA (Vercel)](https://vercel.com/blog/securing-data-in-your-next-js-app-with-okta-and-openfga) | A | Авторизація на рівні шару даних |
| [Structuring Your Data Access Layer in Next.js (Medium)](https://medium.com/@samrose.mohammed/structuring-your-data-access-layer-in-next-js-patterns-that-actually-scale-2e4c07491866) | B | Розміщення DAL, Server Action як тонка обгортка |
| [Understanding the Data Access Layer in Next.js (Ayush Sharma)](https://aysh.me/blogs/data-access-layer-nextjs) | B | Авторизація всередині DAL, не в місці виклику |
| [Protecting Next.js Applications in the Era of Server Actions](https://jsdev.space/server-actions-security/) | B | Server Action як публічна HTTP-точка |
| [Server Actions Security: The Auth Check Most Developers Miss (DEV)](https://dev.to/shubhradev/nextjs-16-server-actions-security-the-auth-check-most-developers-miss-1ei1) | C | Типова діра в авторизації |
| [Next.js Server Actions in Production: 2026 Patterns](https://www.digitalapplied.com/blog/nextjs-server-actions-production-patterns-2026-guide) | C | Продакшн-патерни |

## Розміщення стану

| Ресурс | Рівень | Що взято в скіл |
| --- | --- | --- |
| [React State Management in 2026 (ncctcr)](https://ncctcr.com/blog/react-state-management-2026) | C | Розмежування серверного і клієнтського стану |
| [Zustand vs Redux Toolkit (The Road to Enterprise)](https://theroadtoenterprise.com/blog/zustand-vs-redux-toolkit) | B | Критерії вибору сховища |
| [Stop Choosing State Management Blindly (Medium)](https://medium.com/lets-code-future/stop-choosing-state-management-blindly-zustand-tanstack-query-and-redux-toolkit-finally-9be18cd0ae51) | C | Різні задачі — різні інструменти |
| [State Management in 2026: Redux vs Context vs TanStack Query (DEV)](https://dev.to/iamsaadmehmood/state-management-in-2026-redux-vs-context-vs-tanstack-query-1b0b) | C | Context як DI, не сховище |
| [How to Choose the Right Solution (Relia Software)](https://reliasoftware.com/blog/react-state-management-libraries) | C | Дерево рішень |

## Композиція маршрутів

| Ресурс | Рівень | Що взято в скіл |
| --- | --- | --- |
| [Next.js — Layouts and Pages](https://nextjs.org/docs/app/getting-started/layouts-and-pages) | A | Layout як спільна оболонка, не місце для логіки |
| [Next.js — layout.js](https://nextjs.org/docs/app/api-reference/file-conventions/layout) | A | Поведінка layout'а при навігації |
| [Next.js — Parallel Routes](https://nextjs.org/docs/app/api-reference/file-conventions/parallel-routes) | A | Слоти як композиція незалежних піддерев |
| [Next.js — Intercepting Routes](https://nextjs.org/docs/app/api-reference/file-conventions/intercepting-routes) | A | Модалки з deep-linking |
| [Next.js — App Router Glossary](https://nextjs.org/docs/app/glossary) | A | Термінологія |
| [Layouts RFC](https://nextjs.org/blog/layouts-rfc) | A | Обґрунтування дизайну App Router |
| [Next.js Docs: App Router](https://nextjs.org/docs/app) | A | Корінь документації |

## Загальний контекст React

| Ресурс | Рівень | Що взято в скіл |
| --- | --- | --- |
| [react.dev](https://react.dev/) | A | Канонічна документація |
| [React Compiler](https://react.dev/learn/react-compiler) | A | Чому мемоїзація не є архітектурним рішенням |
| [React v19 (блог)](https://react.dev/blog/2024/12/05/react-19) | A | Actions, `use`, ref як проп |
| [You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect) | A | Межа між синхронізацією і логікою (деталі — у `react-best-practices`) |
| [React Stack Patterns (patterns.dev)](https://www.patterns.dev/react/react-2026/) | B | Патерни стеку 2026 |
| [React Best Practises (AM Digital Playbook)](https://playbook.platformdev.amdigital.co.uk/Ways-of-Working/Toolkit/Quality-Standards/React-Best-Practises/) | B | Командні стандарти якості |

## Контроль меж інструментами

| Ресурс | Рівень | Що взято в скіл |
| --- | --- | --- |
| [eslint-plugin-boundaries](https://github.com/javierbrea/eslint-plugin-boundaries) | A | Декларативний опис шарів і дозволених залежностей |
| [import/no-restricted-paths (eslint-plugin-import)](https://github.com/import-js/eslint-plugin-import/blob/main/docs/rules/no-restricted-paths.md) | A | Заборона імпортів у зворотному напрямку |
| [server-only (npm)](https://www.npmjs.com/package/server-only) | A | Межа сервер/клієнт як помилка збірки |

---

## Що свідомо не увійшло

Ці теми покриті іншими скілами — дублювати їх тут означало б створити два джерела істини:

| Тема | Скіл |
| --- | --- |
| Механіка RSC, серіалізовність пропів, async client components | `next-best-practices` → `rsc-boundaries.md` |
| Конвенції файлів, `(.)`/`@slot`, middleware/proxy | `next-best-practices` → `file-conventions.md` |
| Вибір Server Component / Action / Route Handler, водоспади даних | `next-best-practices` → `data-patterns.md` |
| Хуки, `useEffect`, мемоїзація, ключі, derive-don't-store | `react-best-practices` |
| Тестування компонентів і хуків | `react-testing-library` |
| Валідація схем | `zod` |
| Продуктивність, Core Web Vitals, INP | `next-best-practices` (image/font/bundling) |
| Безпека, XSS, CSP | `security` |
| Шари backend'а | `onion-architecture` |
