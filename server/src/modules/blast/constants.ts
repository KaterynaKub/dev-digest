/**
 * 0007 — blast module constants. Every limit `helpers.ts` applies lives here.
 */

/**
 * Cap on downstream symbols returned. `repo-intel` has no cap of its own on
 * `changedSymbols`, so this helper must be self-sufficient — it does not rely
 * on the facade having already trimmed the list.
 */
export const MAX_DOWNSTREAM_SYMBOLS = 50;

/**
 * Cap on callers per symbol. `repo-intel/service.ts#tryPersistentBlast`
 * already slices to this same number on the persistent path — this constant
 * makes the helper self-sufficient (mirrors the facade's own limit) rather
 * than trusting the facade's slice to always have happened, e.g. on the
 * ripgrep-degraded path where no such slice exists.
 */
export const MAX_CALLERS_PER_SYMBOL = 20;

/** Cap on endpoints (and, separately, crons) attributed to one symbol. */
export const MAX_ENDPOINTS_PER_SYMBOL = 20;
