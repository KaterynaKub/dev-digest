# Шар доступу до даних (DAL)

Деталізація секції «Шар доступу до даних» у [SKILL.md](SKILL.md).

Вибір між Server Component, Server Action і Route Handler — у `next-best-practices` →
`data-patterns.md`. Тут — про те, як цей шар **структурувати**.

## Навіщо окремий шар

Без DAL перевірки прав розповзаються по місцях виклику. Достатньо одного забутого місця,
щоб отримати вразливість:

```ts
// ПОГАНО: авторизація в місці виклику
// app/(dashboard)/invoices/page.tsx
export default async function Page() {
  const session = await auth();
  if (!session) redirect('/login');
  const invoices = await db.invoice.findMany({ where: { userId: session.user.id } });
  return <InvoiceList invoices={invoices} />;
}

// features/billing/api/actions.ts
'use server';
export async function deleteInvoice(id: string) {
  // перевірку забули — будь-хто видаляє будь-який інвойс
  await db.invoice.delete({ where: { id } });
}
```

Server Action — публічна HTTP-точка. Її можна викликати напряму, минаючи UI, тому
відсутність перевірки тут є вразливістю, а не стилістичною вадою.

```ts
// ДОБРЕ: авторизація всередині DAL
// lib/dal/invoices.ts
import 'server-only';
import { cache } from 'react';

export const requireUser = cache(async () => {
  const session = await auth();
  if (!session) throw new UnauthorizedError();
  return session.user;
});

export async function getInvoices(): Promise<InvoiceDTO[]> {
  const user = await requireUser();
  const rows = await db.invoice.findMany({ where: { userId: user.id } });
  return rows.map(toInvoiceDTO);
}

export async function deleteInvoice(id: string): Promise<void> {
  const user = await requireUser();
  const invoice = await db.invoice.findUnique({ where: { id } });
  if (invoice?.userId !== user.id) throw new ForbiddenError();
  await db.invoice.delete({ where: { id } });
}
```

Тепер жоден шлях до даних не оминає перевірку.

## DTO замість сирих рядків ORM

Значення, що повертається з Server Action, серіалізується прямо клієнту:

```ts
// ПОГАНО: витік внутрішніх колонок у браузер
export async function getUser(id: string) {
  return db.user.findUnique({ where: { id } });
  // → passwordHash, stripeCustomerId, internalNotes їдуть клієнту
}
```

```ts
// ДОБРЕ: явний контракт
type UserDTO = { id: string; name: string; avatarUrl: string | null };

function toUserDTO(row: UserRow): UserDTO {
  return { id: row.id, name: row.name, avatarUrl: row.avatarUrl };
}

export async function getUser(id: string): Promise<UserDTO> {
  await requireUser();
  const row = await db.user.findUniqueOrThrow({ where: { id } });
  return toUserDTO(row);
}
```

Мапер `toUserDTO` — це місце, де ухвалюється рішення «що взагалі можна показати клієнту».
Його варто тримати поруч зі схемою, а не в компоненті.

## Server Action як тонка обгортка

```ts
// features/billing/api/delete-invoice.ts
'use server';
import { revalidateTag } from 'next/cache';
import { deleteInvoice as deleteInvoiceFromDb } from '@/lib/dal/invoices';

export async function deleteInvoiceAction(id: string) {
  await deleteInvoiceFromDb(id); // уся логіка й авторизація — там
  revalidateTag('invoices');
  return { success: true }; // плаский результат, не об'єкт ORM
}
```

Дія робить рівно три речі: викликає DAL, інвалідує кеш, повертає слim-результат. Щойно в дії
з'являється робота з БД чи бізнес-правила — вона перестала бути обгорткою.

## Не ходити fetch-ом на самого себе

```ts
// ПОГАНО: зайвий HTTP-стрибок із серверного компонента
const res = await fetch('http://localhost:3000/api/invoices');
const invoices = await res.json();
```

```ts
// ДОБРЕ: прямий виклик
import { getInvoices } from '@/lib/dal/invoices';
const invoices = await getInvoices();
```

Route Handler потрібен для зовнішніх споживачів — мобільних клієнтів, вебхуків, публічного API.
Для власного серверного рендеру він лише додає латентність і втрачає типізацію.

## Дедуплікація через `cache`

Коли кілька компонентів одного дерева потребують ті самі дані, `cache` з React прибирає
повторні запити в межах одного рендеру:

```ts
import { cache } from 'react';

export const getInvoice = cache(async (id: string): Promise<InvoiceDTO> => {
  await requireUser();
  const row = await db.invoice.findUniqueOrThrow({ where: { id } });
  return toInvoiceDTO(row);
});
```

Це дозволяє викликати `getInvoice(id)` і в `layout`, і в `page`, і в `generateMetadata`
без потрійного походу в БД — і без підняття даних у пропси заради економії.

## Розміщення файлів

```
lib/
└── dal/
    ├── invoices.ts      # server-only, авторизація, DTO
    ├── users.ts
    └── dto.ts           # спільні типи DTO

features/billing/
└── api/
    ├── delete-invoice.ts   # 'use server' — обгортка над DAL
    └── create-invoice.ts
```

DAL живе в `lib/`, бо не належить жодному домену UI і не має знати про фічі. Server Actions
живуть у фічі, бо є частиною її публічного контракту.

## Чекліст рев'ю шару даних

- [ ] Кожен модуль DAL починається з `import 'server-only'`
- [ ] Перевірка автентифікації та прав — усередині функції DAL, не в місці виклику
- [ ] Функція повертає DTO, а не рядок ORM
- [ ] Server Action не містить запитів до БД
- [ ] Серверні компоненти викликають DAL напряму, без `fetch` на власний хост
- [ ] Дані, потрібні кільком компонентам дерева, обгорнуті в `cache`
