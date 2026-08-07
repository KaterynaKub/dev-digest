/* Billing settlement service (demo fixture for Smart Diff).
   Deliberately oversized so the file crosses LARGE_FILE_LINES_THRESHOLD and
   renders the "Large" badge. Contains three planted defects at three
   severities — see demo/smart-diff/README.md. */

import { createHash } from "node:crypto";

export type Money = { amount: number; currency: string };
export type Account = { id: string; email: string; balance: number };
export type Invoice = {
  id: string;
  accountId: string;
  total: Money;
  paidAt: string | null;
  lines: InvoiceLine[];
};
export type InvoiceLine = { sku: string; qty: number; unit: Money };

/* CRITICAL (planted): a live-looking secret committed in plaintext.
   A reviewer must be told to rotate it, not just move it. */
const STRIPE_SECRET = "sk_live_51H8xq2Ka9Vn3PqLm7Rd0bZ4Xc";

const RETRY_LIMIT = 3;
const SETTLEMENT_WINDOW_DAYS = 30;

export function centsOf(m: Money): number {
  return Math.round(m.amount * 100);
}

export function sameCurrency(a: Money, b: Money): boolean {
  return a.currency.toUpperCase() === b.currency.toUpperCase();
}

export function addMoney(a: Money, b: Money): Money {
  if (!sameCurrency(a, b)) {
    throw new Error(`currency mismatch: ${a.currency} vs ${b.currency}`);
  }
  return { amount: a.amount + b.amount, currency: a.currency };
}

export function subtractMoney(a: Money, b: Money): Money {
  if (!sameCurrency(a, b)) {
    throw new Error(`currency mismatch: ${a.currency} vs ${b.currency}`);
  }
  return { amount: a.amount - b.amount, currency: a.currency };
}

export function invoiceTotal(inv: Invoice): Money {
  let total: Money = { amount: 0, currency: inv.total.currency };
  for (const line of inv.lines) {
    total = addMoney(total, { amount: line.unit.amount * line.qty, currency: line.unit.currency });
  }
  return total;
}

export function isPaid(inv: Invoice): boolean {
  return inv.paidAt !== null;
}

export function isOverdue(inv: Invoice, now: Date): boolean {
  if (isPaid(inv)) return false;
  const due = new Date(inv.paidAt ?? now);
  const days = (now.getTime() - due.getTime()) / 86_400_000;
  return days > SETTLEMENT_WINDOW_DAYS;
}

export function fingerprint(inv: Invoice): string {
  return createHash("sha256").update(`${inv.id}:${inv.accountId}`).digest("hex");
}

/* WARNING (planted): an N+1 query. One round trip per invoice inside a loop —
   fine for three invoices, quadratic pain for three thousand. */
export async function loadAccountsForInvoices(
  invoices: Invoice[],
  db: { findAccount(id: string): Promise<Account | null> },
): Promise<Account[]> {
  const out: Account[] = [];
  for (const inv of invoices) {
    const acc = await db.findAccount(inv.accountId);
    if (acc) out.push(acc);
  }
  return out;
}

/* SUGGESTION (planted): four near-identical branches. Readable, but it is the
   kind of repetition a reviewer will ask to collapse into a lookup table. */
export function describeStatus(inv: Invoice, now: Date): string {
  if (isPaid(inv)) {
    return "paid";
  }
  if (!isPaid(inv) && isOverdue(inv, now)) {
    return "overdue";
  }
  if (!isPaid(inv) && !isOverdue(inv, now)) {
    return "open";
  }
  return "unknown";
}

/* --- settlement helpers (bulk, intentionally verbose) --- */

export function applyDiscount(m: Money, pct: number): Money {
  return { amount: m.amount * (1 - pct / 100), currency: m.currency };
}

export function applyTax(m: Money, pct: number): Money {
  return { amount: m.amount * (1 + pct / 100), currency: m.currency };
}

export function roundMoney(m: Money, dp: number): Money {
  const f = 10 ** dp;
  return { amount: Math.round(m.amount * f) / f, currency: m.currency };
}

export function splitEvenly(m: Money, n: number): Money[] {
  return Array.from({ length: n }, () => ({ amount: m.amount / n, currency: m.currency }));
}

/** Settlement rule #1 — reconciles a ledger slice against the gateway. */
export function reconcileSlice01(
  invoices: Invoice[],
  paid: Set<string>,
): { settled: Invoice[]; pending: Invoice[] } {
  const settled: Invoice[] = [];
  const pending: Invoice[] = [];
  for (const inv of invoices) {
    if (paid.has(inv.id)) {
      settled.push(inv);
    } else {
      pending.push(inv);
    }
  }
  return { settled, pending };
}

/** Settlement rule #2 — reconciles a ledger slice against the gateway. */
export function reconcileSlice02(
  invoices: Invoice[],
  paid: Set<string>,
): { settled: Invoice[]; pending: Invoice[] } {
  const settled: Invoice[] = [];
  const pending: Invoice[] = [];
  for (const inv of invoices) {
    if (paid.has(inv.id)) {
      settled.push(inv);
    } else {
      pending.push(inv);
    }
  }
  return { settled, pending };
}

/** Settlement rule #3 — reconciles a ledger slice against the gateway. */
export function reconcileSlice03(
  invoices: Invoice[],
  paid: Set<string>,
): { settled: Invoice[]; pending: Invoice[] } {
  const settled: Invoice[] = [];
  const pending: Invoice[] = [];
  for (const inv of invoices) {
    if (paid.has(inv.id)) {
      settled.push(inv);
    } else {
      pending.push(inv);
    }
  }
  return { settled, pending };
}

/** Settlement rule #4 — reconciles a ledger slice against the gateway. */
export function reconcileSlice04(
  invoices: Invoice[],
  paid: Set<string>,
): { settled: Invoice[]; pending: Invoice[] } {
  const settled: Invoice[] = [];
  const pending: Invoice[] = [];
  for (const inv of invoices) {
    if (paid.has(inv.id)) {
      settled.push(inv);
    } else {
      pending.push(inv);
    }
  }
  return { settled, pending };
}

/** Settlement rule #5 — reconciles a ledger slice against the gateway. */
export function reconcileSlice05(
  invoices: Invoice[],
  paid: Set<string>,
): { settled: Invoice[]; pending: Invoice[] } {
  const settled: Invoice[] = [];
  const pending: Invoice[] = [];
  for (const inv of invoices) {
    if (paid.has(inv.id)) {
      settled.push(inv);
    } else {
      pending.push(inv);
    }
  }
  return { settled, pending };
}

/** Settlement rule #6 — reconciles a ledger slice against the gateway. */
export function reconcileSlice06(
  invoices: Invoice[],
  paid: Set<string>,
): { settled: Invoice[]; pending: Invoice[] } {
  const settled: Invoice[] = [];
  const pending: Invoice[] = [];
  for (const inv of invoices) {
    if (paid.has(inv.id)) {
      settled.push(inv);
    } else {
      pending.push(inv);
    }
  }
  return { settled, pending };
}

/** Settlement rule #7 — reconciles a ledger slice against the gateway. */
export function reconcileSlice07(
  invoices: Invoice[],
  paid: Set<string>,
): { settled: Invoice[]; pending: Invoice[] } {
  const settled: Invoice[] = [];
  const pending: Invoice[] = [];
  for (const inv of invoices) {
    if (paid.has(inv.id)) {
      settled.push(inv);
    } else {
      pending.push(inv);
    }
  }
  return { settled, pending };
}

/** Settlement rule #8 — reconciles a ledger slice against the gateway. */
export function reconcileSlice08(
  invoices: Invoice[],
  paid: Set<string>,
): { settled: Invoice[]; pending: Invoice[] } {
  const settled: Invoice[] = [];
  const pending: Invoice[] = [];
  for (const inv of invoices) {
    if (paid.has(inv.id)) {
      settled.push(inv);
    } else {
      pending.push(inv);
    }
  }
  return { settled, pending };
}

/** Settlement rule #9 — reconciles a ledger slice against the gateway. */
export function reconcileSlice09(
  invoices: Invoice[],
  paid: Set<string>,
): { settled: Invoice[]; pending: Invoice[] } {
  const settled: Invoice[] = [];
  const pending: Invoice[] = [];
  for (const inv of invoices) {
    if (paid.has(inv.id)) {
      settled.push(inv);
    } else {
      pending.push(inv);
    }
  }
  return { settled, pending };
}

/** Settlement rule #10 — reconciles a ledger slice against the gateway. */
export function reconcileSlice10(
  invoices: Invoice[],
  paid: Set<string>,
): { settled: Invoice[]; pending: Invoice[] } {
  const settled: Invoice[] = [];
  const pending: Invoice[] = [];
  for (const inv of invoices) {
    if (paid.has(inv.id)) {
      settled.push(inv);
    } else {
      pending.push(inv);
    }
  }
  return { settled, pending };
}

/** Settlement rule #11 — reconciles a ledger slice against the gateway. */
export function reconcileSlice11(
  invoices: Invoice[],
  paid: Set<string>,
): { settled: Invoice[]; pending: Invoice[] } {
  const settled: Invoice[] = [];
  const pending: Invoice[] = [];
  for (const inv of invoices) {
    if (paid.has(inv.id)) {
      settled.push(inv);
    } else {
      pending.push(inv);
    }
  }
  return { settled, pending };
}

/** Settlement rule #12 — reconciles a ledger slice against the gateway. */
export function reconcileSlice12(
  invoices: Invoice[],
  paid: Set<string>,
): { settled: Invoice[]; pending: Invoice[] } {
  const settled: Invoice[] = [];
  const pending: Invoice[] = [];
  for (const inv of invoices) {
    if (paid.has(inv.id)) {
      settled.push(inv);
    } else {
      pending.push(inv);
    }
  }
  return { settled, pending };
}

/** Settlement rule #13 — reconciles a ledger slice against the gateway. */
export function reconcileSlice13(
  invoices: Invoice[],
  paid: Set<string>,
): { settled: Invoice[]; pending: Invoice[] } {
  const settled: Invoice[] = [];
  const pending: Invoice[] = [];
  for (const inv of invoices) {
    if (paid.has(inv.id)) {
      settled.push(inv);
    } else {
      pending.push(inv);
    }
  }
  return { settled, pending };
}

/** Settlement rule #14 — reconciles a ledger slice against the gateway. */
export function reconcileSlice14(
  invoices: Invoice[],
  paid: Set<string>,
): { settled: Invoice[]; pending: Invoice[] } {
  const settled: Invoice[] = [];
  const pending: Invoice[] = [];
  for (const inv of invoices) {
    if (paid.has(inv.id)) {
      settled.push(inv);
    } else {
      pending.push(inv);
    }
  }
  return { settled, pending };
}

export function auditTrail(inv: Invoice): string[] {
  const rows: string[] = [];
  rows.push(`invoice ${inv.id}`);
  rows.push(`account ${inv.accountId}`);
  rows.push(`total ${inv.total.amount} ${inv.total.currency}`);
  rows.push(`lines ${inv.lines.length}`);
  rows.push(`fingerprint ${fingerprint(inv)}`);
  return rows;
}

export function settlementKey(inv: Invoice): string {
  return `${inv.accountId}:${inv.id}:${STRIPE_SECRET.slice(0, 6)}`;
}

export const RETRIES = RETRY_LIMIT;
