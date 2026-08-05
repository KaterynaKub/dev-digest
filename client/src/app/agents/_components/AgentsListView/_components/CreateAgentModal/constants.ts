import type { Provider } from "@devdigest/shared";

/** Default provider/model for a new agent. */
export const DEFAULT_PROVIDER: Provider = "openai";
export const DEFAULT_MODEL = "gpt-4.1";

/** Fallback model per provider — used when the provider changes, until the
    live /models list arrives (or when it never does: missing API key). */
export const DEFAULT_MODEL_BY_PROVIDER: Record<Provider, string> = {
  openai: DEFAULT_MODEL,
  anthropic: "claude-sonnet-5",
  openrouter: "anthropic/claude-sonnet-5",
};

/** Selectable providers in the create form. */
export const PROVIDER_OPTIONS: readonly Provider[] = ["openai", "anthropic", "openrouter"];

/** Modal width (px). */
export const MODAL_WIDTH = 620;
