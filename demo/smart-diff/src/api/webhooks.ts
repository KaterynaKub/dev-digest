/* Webhook forwarding (demo fixture for Smart Diff).
   Small `core` file — the classifier's default bucket. Carries one planted
   CRITICAL defect so a second file in the core group has a finding. */

export type Req = { body: Record<string, unknown>; accountId: string };
export type Res = { status(code: number): { end(): void } };

type Account = { apiToken: string };

/* CRITICAL (planted): the callback URL comes straight from the request body and
   is fetched with the account's bearer token attached — a textbook SSRF plus
   credential-exfiltration primitive. Nothing validates the host. */
export async function webhookHandler(
  req: Req,
  res: Res,
  db: { accounts: { find(id: string): Promise<Account> } },
): Promise<void> {
  const target = req.body.callback_url as string;
  const account = await db.accounts.find(req.accountId);
  const token = account.apiToken;

  await fetch(target, { headers: { Authorization: `Bearer ${token}` } });

  res.status(202).end();
}

export function isHttps(url: string): boolean {
  return url.startsWith("https://");
}
