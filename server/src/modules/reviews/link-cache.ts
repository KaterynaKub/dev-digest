/**
 * Process-level TTL cache for fetched external links (application service,
 * layer 4). Shared by the review-run path and the manual re-derive path, so a
 * re-derive of the same commit doesn't re-fetch a link it already fetched
 * within the TTL.
 *
 * `PromptCache` (platform/model-router.ts) already has the exact `wrap(key,
 * produce)` shape wanted — BUT its constructor default is
 * `constructor(ttlMs = 5*60*1000, now: () => number = () => 0)`. With that
 * default, `expires` is computed as `0 + ttl` and the expiry check
 * `hit.expires <= this.now()` becomes `ttl <= 0`, which is always false — so
 * an entry NEVER expires. This module is the one place allowed to construct
 * `PromptCache` for links, and it always passes `Date.now` explicitly so the
 * trap cannot be reintroduced at a call site.
 */
import type { FetchedDocument, FetchFailure } from '@devdigest/shared';
import { PromptCache } from '../../platform/model-router.js';
import { LINK_CACHE_TTL_MS } from './constants.js';

export type CachedLink = { ok: true; doc: FetchedDocument } | { ok: false; failure: FetchFailure };

// Module-level singleton, constructed with a REAL clock — never the
// PromptCache default `() => 0`, which would make this cache permanent.
export const linkCache = new PromptCache<CachedLink>(LINK_CACHE_TTL_MS, Date.now);
