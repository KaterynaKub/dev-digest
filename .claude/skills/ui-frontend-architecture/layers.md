# Шари та напрямок залежностей

Деталізація правил із секцій «Напрямок залежностей» і «Публічний API фічі» в [SKILL.md](SKILL.md).

## Чотири шари

| Шар | Знає про | Не знає про |
| --- | --- | --- |
| `app/` | `features/`, `components/ui/`, `lib/` | — |
| `features/` | `lib/`, `components/ui/`, інші фічі через `index.ts` | `app/`, маршрути, URL |
| `components/ui/` | нічого з проєкту | домени, дані, маршрути |
| `lib/` | зовнішні бібліотеки, БД | домени, UI |

Стрілка залежності завжди вниз по таблиці.

## Чому фіча не знає про маршрут

Фіча, що імпортує `usePathname` чи знає свій URL, стає непереносною: її не можна відрендерити
в модалці, на іншій сторінці чи в тестах без маршрутизатора.

```tsx
// ПОГАНО: фіча прив'язана до маршруту
// features/billing/components/invoice-list.tsx
'use client';
import { useRouter } from 'next/navigation';

export function InvoiceList({ invoices }: { invoices: Invoice[] }) {
  const router = useRouter();
  return (
    <ul>
      {invoices.map((invoice) => (
        <li key={invoice.id} onClick={() => router.push(`/dashboard/invoices/${invoice.id}`)}>
          {invoice.number}
        </li>
      ))}
    </ul>
  );
}
```

```tsx
// ДОБРЕ: маршрут задає застосунок, фіча приймає поведінку
// features/billing/components/invoice-list.tsx
export function InvoiceList({
  invoices,
  onSelect,
}: {
  invoices: Invoice[];
  onSelect: (id: string) => void;
}) {
  return (
    <ul>
      {invoices.map((invoice) => (
        <li key={invoice.id} onClick={() => onSelect(invoice.id)}>
          {invoice.number}
        </li>
      ))}
    </ul>
  );
}

// app/(dashboard)/invoices/page.tsx — тут маршрут доречний
```

## Імпорт між фічами

```ts
// ПОГАНО: імпорт із глибини чужої фічі
import { mapUserRow } from '@/features/users/model/mapper';
import { UserAvatar } from '@/features/users/components/user-avatar';
```

```ts
// ДОБРЕ: тільки через публічний контракт
import { UserAvatar, type User } from '@/features/users';
```

Якщо потрібного експорту немає в `index.ts` — це свідоме рішення власника фічі. Додавати
експорт треба явно, і це привід перевірити, чи не порушується межа.

## Коли спільне піднімати вгору

Ситуація: `billing` і `reports` обидва потребують формат валюти.

| Варіант | Коли доречно |
| --- | --- |
| Дублювати | Логіка збігається випадково і може розійтися |
| Підняти в `lib/` | Чиста утиліта без домену — `formatCurrency(value, locale)` |
| Виділити третю фічу | Спільна доменна логіка зі своїм станом і UI |
| Імпорт `billing` ← `reports` | Майже ніколи: створює зв'язність між доменами |

За замовчуванням — дублювати до третього повторення, потім піднімати.

## Автоматичний контроль меж

ESLint не дає структурі поплисти мовчки.

```js
// eslint.config.js — заборонити імпорти в обхід публічного API фічі
{
  rules: {
    'import/no-restricted-paths': ['error', {
      zones: [
        {
          target: './src/features/*/!(index.ts)',
          from: './src/app',
          message: 'features/ не може імпортувати з app/',
        },
        {
          target: './src/lib',
          from: './src/features',
          message: 'lib/ не знає про домени',
        },
      ],
    }],
  },
}
```

Альтернатива з ширшими можливостями — `eslint-plugin-boundaries`: описує шари декларативно
й перевіряє всі напрямки одразу.

## Межа `server-only` / `client-only`

Ці пакети перетворюють архітектурне правило на помилку збірки:

```ts
// lib/dal/invoices.ts
import 'server-only'; // імпорт із клієнтського компонента впаде на етапі збірки

export async function getInvoices(userId: string) { /* ... */ }
```

```ts
// lib/analytics/browser.ts
import 'client-only'; // не потрапить у серверний бандл
```

Без цього межа тримається лише на уважності рев'ювера.
