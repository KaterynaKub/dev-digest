import type { Provider } from "@devdigest/shared";

/**
 * Scans always run through OpenRouter: it is the only provider that exposes a
 * live model list WITH prices, which is what makes "pick a cheap model" a real
 * choice rather than a guess. A provider selector here would double the state
 * for a choice this feature does not need — the workspace-wide provider
 * override still lives in Settings → Feature Models.
 */
export const SCAN_PROVIDER: Provider = "openrouter";
