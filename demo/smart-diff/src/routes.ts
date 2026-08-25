/* routes.ts — classifier rule 11 puts this in `wiring` by basename. */
import { webhookHandler } from "./api/webhooks";

export function registerRoutes(app: {
  post(path: string, h: unknown): void;
}): void {
  app.post("/webhooks/forward", webhookHandler);
  app.post("/settlement/reconcile", () => ({ ok: true }));
}
