/**
 * tokenizer adapter — token counter for the repo-map budget search (T3) and
 * for project-context token estimation.
 *
 * The repo-map renderer (pipeline/repo-map.ts) binary-searches the largest set
 * of symbols that fits a token budget; that loop calls `count()` ≤ ~13 times.
 *
 * Default impl: js-tiktoken `cl100k_base` (pure-JS, no natives). The encoder is
 * lazy-initialised (loading the BPE ranks is the heavy part) and any failure
 * falls back to the `ceil(chars / 4)` heuristic — the renderer must never throw.
 * `approximate` flips to `true` once the fallback is in use, so callers can
 * surface an "≈" count instead of an exact one.
 *
 * Scope: in-process. Consumed by repo-intel's repo-map budget search and by
 * project-context token estimation. Swappable in tests via a mock counter
 * (ContainerOverrides.tokenizer).
 */
import { getEncoding, type Tiktoken } from 'js-tiktoken';
import type { Tokenizer } from '@devdigest/shared';

export type { Tokenizer };

/** Heuristic fallback used before/instead of a real encoder. */
export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export class TiktokenTokenizer implements Tokenizer {
  private enc?: Tiktoken;
  private broken = false;

  get approximate(): boolean {
    return this.broken;
  }

  count(text: string): number {
    if (this.broken) return approxTokens(text);
    try {
      this.enc ??= getEncoding('cl100k_base');
      return this.enc.encode(text).length;
    } catch {
      // BPE load failed once — don't retry per call; stick to the heuristic.
      this.broken = true;
      return approxTokens(text);
    }
  }
}
