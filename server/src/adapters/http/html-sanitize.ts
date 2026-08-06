/**
 * Pure HTML→text sanitiser (layer 2 — Domain Services, pure), sibling to
 * `ip-guard.ts`. Lives under `adapters/http/` because its only caller is
 * `safe-fetch.ts` (constraint 9h: sanitise a fetched document BEFORE it ever
 * leaves the adapter) — but the function itself is dependency-free and
 * side-effect-free, so it is just as testable in isolation as any other pure
 * helper.
 */

/**
 * Drop `<script>`/`<style>` INCLUDING their contents first (a tag-strip-only
 * pass would inline the JS/CSS source into the prompt), then strip remaining
 * tags, decode a handful of basic entities, collapse whitespace, trim, and
 * truncate to `limit` with a `… [truncated]` tail. Regex-based is acceptable
 * here because the output is never rendered as markup — it becomes quoted
 * prompt text — so parser fidelity affects only readability, never safety.
 */
export function sanitiseHtml(raw: string, limit: number): string {
  let text = raw
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length > limit) {
    text = `${text.slice(0, limit)}… [truncated]`;
  }
  return text;
}
