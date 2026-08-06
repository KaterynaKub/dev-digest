/** Co-located constants for SettingsIntentLinks. */

/**
 * Client-side UX check ONLY — mirrors the server's `IntentLinkPattern`
 * (`vendor/shared/contracts/platform.ts`). The server re-validates via the
 * Zod body schema on `PUT /settings`; this regex only decides whether to
 * enable the Add button and what hint to show, it is never the gate.
 */
export const INTENT_LINK_PATTERN = /^(\*\.)?([a-z0-9-]+\.)+[a-z]{2,}$/i;

export const MAX_INTENT_LINK_ENTRIES = 50;
