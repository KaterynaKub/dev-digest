# Приклади структур

Конкретні структури тек і рефакторинги «до/після» для правил із [SKILL.md](SKILL.md).

## Еволюція структури

Структура має рости за потребою. Створювати `features/` наперед, коли фіча одна, — це та сама
передчасна абстракція, тільки на рівні тек.

### Етап 1: маленький застосунок (до ~10 екранів)

```
src/
├── app/
│   ├── layout.tsx
│   ├── page.tsx
│   └── invoices/
│       ├── page.tsx
│       └── _components/
│           └── invoice-list.tsx
├── components/ui/
│   ├── button.tsx
│   └── card.tsx
└── lib/
    ├── dal/
    └── utils.ts
```

Фічі ще немає — колокація в `_components/` достатня.

### Етап 2: з'явилися домени

```
src/
├── app/
│   └── (dashboard)/
│       ├── layout.tsx
│       ├── invoices/page.tsx
│       └── customers/page.tsx
├── features/
│   ├── billing/
│   │   ├── api/
│   │   ├── components/
│   │   ├── model/
│   │   └── index.ts
│   └── customers/
│       └── ...
├── components/ui/
└── lib/dal/
```

Тригер переходу: логіка домену потрібна більш ніж на одному маршруті, або `_components/`
розрісся понад ~5 файлів.

### Етап 3: великий застосунок

Додаються `entities/` (спільні доменні сутності, які використовують кілька фіч) і
`widgets/` (композиції кількох фіч). Це вже наближення до строгого Feature-Sliced Design —
переходити варто, коли команда більша за ~5 осіб і конфлікти меж стають регулярними.

## Анатомія фічі

```
features/billing/
├── api/
│   ├── create-invoice.ts     # 'use server' обгортка
│   └── use-invoices.ts       # клієнтський хук запиту
├── components/
│   ├── invoice-list.tsx
│   ├── invoice-form.tsx
│   └── invoice-status-badge.tsx
├── model/
│   ├── types.ts              # доменні типи
│   ├── schema.ts             # zod-схеми
│   └── store.ts              # стан домену, якщо потрібен
├── lib/
│   └── format-amount.ts      # хелпери лише цієї фічі
└── index.ts                  # публічний API
```

```ts
// features/billing/index.ts
export { InvoiceList } from './components/invoice-list';
export { InvoiceForm } from './components/invoice-form';
export { createInvoiceAction } from './api/create-invoice';
export { invoiceSchema } from './model/schema';
export type { Invoice, InvoiceStatus } from './model/types';
```

`format-amount.ts` навмисно не експортується — це деталь реалізації.

## Рефакторинг: логіка в `page.tsx`

```tsx
// ПОГАНО: сторінка знає все
// app/(dashboard)/invoices/page.tsx
export default async function InvoicesPage({ searchParams }) {
  const session = await auth();
  if (!session) redirect('/login');

  const { status, page } = await searchParams;
  const where = { userId: session.user.id, ...(status ? { status } : {}) };
  const invoices = await db.invoice.findMany({
    where,
    skip: (Number(page ?? 1) - 1) * 20,
    take: 20,
    orderBy: { createdAt: 'desc' },
  });
  const total = await db.invoice.count({ where });

  return (
    <div>
      <h1>Інвойси</h1>
      <ul>
        {invoices.map((invoice) => (
          <li key={invoice.id}>
            {invoice.number} — {(invoice.amountCents / 100).toFixed(2)} грн
          </li>
        ))}
      </ul>
      <Pagination total={total} />
    </div>
  );
}
```

```tsx
// ДОБРЕ: сторінка як композиція
// app/(dashboard)/invoices/page.tsx
import { InvoiceList } from '@/features/billing';
import { getInvoices } from '@/lib/dal/invoices';

export default async function InvoicesPage({ searchParams }) {
  const { status, page } = await searchParams;
  const { invoices, total } = await getInvoices({ status, page: Number(page ?? 1) });

  return (
    <div>
      <h1>Інвойси</h1>
      <InvoiceList invoices={invoices} total={total} />
    </div>
  );
}
```

Авторизація й пагінація переїхали в DAL, розмітка — у фічу. Сторінка читається як опис.

## Рефакторинг: межа `use client` задрана вгору

```tsx
// ПОГАНО: увесь дашборд стає клієнтським
// app/(dashboard)/layout.tsx
'use client';
import { ThemeProvider } from '@/lib/theme';
import { QueryProvider } from '@/lib/query';

export default function DashboardLayout({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  return (
    <ThemeProvider>
      <QueryProvider>
        <Sidebar open={sidebarOpen} onToggle={() => setSidebarOpen((v) => !v)} />
        <main>{children}</main>
      </QueryProvider>
    </ThemeProvider>
  );
}
```

Наслідок: `children` лишається серверним (він переданий пропом), але сам layout, обидва
провайдери й `Sidebar` їдуть у бандл, а layout втрачає можливість робити серверні запити.

```tsx
// ДОБРЕ: клієнтські лише ті частини, яким це потрібно
// app/(dashboard)/providers.tsx
'use client';
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <QueryProvider>{children}</QueryProvider>
    </ThemeProvider>
  );
}

// features/navigation/components/sidebar.tsx
'use client';
export function Sidebar() {
  const [open, setOpen] = useState(true); // стан там, де використовується
  return <aside data-open={open}>...</aside>;
}

// app/(dashboard)/layout.tsx — лишається серверним
import { Providers } from './providers';
import { Sidebar } from '@/features/navigation';

export default async function DashboardLayout({ children }) {
  const user = await getCurrentUser(); // серверний запит можливий
  return (
    <Providers>
      <Sidebar />
      <main>{children}</main>
      <Footer userName={user.name} />
    </Providers>
  );
}
```

## Рефакторинг: доменний тип у примітиві

```tsx
// ПОГАНО: примітив знає про домен
// components/ui/user-card.tsx
import type { User } from '@/features/users'; // ui → features, напрямок порушено

export function UserCard({ user }: { user: User }) {
  return <div className="rounded border p-4">{user.name}</div>;
}
```

```tsx
// ДОБРЕ: примітив нейтральний, домен зверху
// components/ui/card.tsx
export function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded border p-4">{children}</div>;
}

// features/users/components/user-card.tsx
import { Card } from '@/components/ui/card';

export function UserCard({ user }: { user: User }) {
  return <Card>{user.name}</Card>;
}
```

## Рефакторинг: дублювання серверного стану

```tsx
// ПОГАНО: два джерела істини
const { data: invoices } = useInvoices();
const setInvoices = useBillingStore((s) => s.setInvoices);

useEffect(() => {
  if (invoices) setInvoices(invoices); // синхронізація, що завжди відстає
}, [invoices, setInvoices]);
```

```tsx
// ДОБРЕ: серверні дані живуть у кеші запитів, у сторі — лише UI-стан
const { data: invoices } = useInvoices();
const selectedIds = useBillingStore((s) => s.selectedIds); // це справді клієнтський стан
```

## Розміщення стану: приклади рішень

| Ситуація | Рішення |
| --- | --- |
| Активна вкладка на сторінці звіту | URL search param — посилання відтворює екран |
| Відкритий/закритий сайдбар | `useState` у самому `Sidebar` |
| Обрані рядки таблиці для масової дії | Стор фічі (`features/billing/model/store.ts`) |
| Список інвойсів із сервера | Кеш запитів або RSC, ніколи не стор |
| Поточний користувач | Context, наповнений із серверного layout |
| Чернетка форми | `react-hook-form`, локально в компоненті форми |
