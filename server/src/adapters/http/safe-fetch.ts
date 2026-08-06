/**
 * SSRF-hardened `HttpFetcher` implementation (layer 5 — Infrastructure). This
 * is the ONLY file in the project allowed to import `node:dns` / `undici` —
 * every outbound-HTTP decision (scheme, allowlist, DNS, redirects, size,
 * content-type) lives here, behind the narrow `HttpFetcher` port.
 */
import { lookup as dnsLookup } from 'node:dns';
import { Agent, fetch as undiciFetch } from 'undici';
import type {
  FetchFailure,
  FetchFailureReason,
  FetchedDocument,
  HttpFetcher,
} from '@devdigest/shared';
import {
  ALLOWED_LINK_CONTENT_TYPES,
  LINK_MAX_REDIRECTS,
  LINK_TIMEOUT_MS,
  MAX_LINK_CHARS,
} from '../../modules/reviews/constants.js';
import { sanitiseHtml } from './html-sanitize.js';
import { hostMatchesAllowlist, isBlockedIp, normaliseHost } from './ip-guard.js';

const USER_AGENT = 'DevDigest-IntentFetcher/1.0';

/** DNS-resolved address, as returned by `dns.lookup(host, { all: true })`. */
interface ResolvedAddress {
  address: string;
  family: number;
}

function dnsLookupAll(host: string): Promise<ResolvedAddress[]> {
  return new Promise((resolve, reject) => {
    dnsLookup(host, { all: true, verbatim: true }, (err, addresses) => {
      if (err) return reject(err);
      resolve(addresses as ResolvedAddress[]);
    });
  });
}

/**
 * Shared `connect.lookup` hook: undici's connector forwards this straight
 * into Node's own `net.connect`/`tls.connect`, which calls it with the SAME
 * options contract as `dns.lookup` — including `{ all: true }`, which changes
 * the expected callback shape from `(err, address, family)` to
 * `(err, addresses[])`. Getting this wrong does not throw a helpful error: it
 * surfaces as `net`'s internals receiving `undefined` and failing with
 * `ERR_INVALID_IP_ADDRESS`, which reads like a broken hook rather than a
 * shape mismatch — verified empirically against a real connection, since the
 * public undici docs do not spell out that `net` is the actual caller.
 *
 * The hook still runs at ACTUAL connect time (not at an earlier, separate
 * resolution), so the block-list check below runs on the addresses undici is
 * really about to use — closing the DNS-rebinding / TOCTOU window between an
 * earlier `dns.lookup` and the socket connect.
 */
function connectLookup(
  hostname: string,
  opts: { all?: boolean } | undefined,
  cb: (err: Error | null, address?: string | ResolvedAddress[], family?: number) => void,
): void {
  dnsLookup(hostname, { all: true }, (err, addrs) => {
    if (err) return cb(err);
    const list = addrs as ResolvedAddress[];
    if (list.length === 0) return cb(new Error('dns_no_addresses'));
    if (list.some((a) => isBlockedIp(a.address, a.family as 4 | 6))) {
      return cb(new Error('blocked_address'));
    }
    // Honour the caller's requested shape — `net`/`tls` sets `all: true` when
    // it wants happy-eyeballs-style multi-address resolution; anything else
    // expects the single-address 3-arg form.
    if (opts?.all) return cb(null, list);
    const first = list[0]!;
    return cb(null, first.address, first.family);
  });
}

/**
 * One shared Agent (and its connection pool) for every fetch this process
 * makes, so the `connect.lookup` hook + pooling behaviour is consistent.
 * Constructed lazily so importing this module has no side effect.
 */
let sharedAgent: Agent | undefined;
function getAgent(): Agent {
  sharedAgent ??= new Agent({ connect: { lookup: connectLookup as never } });
  return sharedAgent;
}

function fail(url: string, reason: FetchFailureReason, status?: number): { ok: false; failure: FetchFailure } {
  return { ok: false, failure: { url, reason, ...(status !== undefined ? { status } : {}) } };
}

export class SafeHttpFetcher implements HttpFetcher {
  async get(
    url: string,
    opts: { allowlist: string[]; timeoutMs?: number },
  ): Promise<{ ok: true; doc: FetchedDocument } | { ok: false; failure: FetchFailure }> {
    const timeoutMs = opts.timeoutMs ?? LINK_TIMEOUT_MS;
    let currentUrl = url;

    for (let hop = 0; hop <= LINK_MAX_REDIRECTS; hop++) {
      if (hop === LINK_MAX_REDIRECTS) return fail(url, 'too_many_redirects');

      // 1. Scheme — https only, before any network syscall.
      let parsed: URL;
      try {
        parsed = new URL(currentUrl);
      } catch {
        return fail(url, 'network_error');
      }
      if (parsed.protocol !== 'https:') return fail(url, 'bad_scheme');

      // 2. Allowlist — structural host match, BEFORE any DNS/socket work
      //    (constraint 9a: deny by default, zero network calls otherwise).
      const host = normaliseHost(parsed.hostname);
      if (!hostMatchesAllowlist(host, opts.allowlist)) return fail(url, 'not_allowlisted');

      // 3. DNS resolution + IP block-list — EVERY resolved address must pass;
      //    one bad address rejects the whole request.
      let addresses: ResolvedAddress[];
      try {
        addresses = await dnsLookupAll(host);
      } catch {
        return fail(url, 'dns_failed');
      }
      if (addresses.length === 0) return fail(url, 'dns_failed');
      if (addresses.some((a) => isBlockedIp(a.address, a.family as 4 | 6))) {
        return fail(url, 'blocked_address');
      }

      // 4-5. Connect (pinned via the Agent's connect.lookup hook, re-checked
      //    at actual connect time) + no credentials, no cookies, capped time.
      let res: Response;
      try {
        res = await undiciFetch(currentUrl, {
          method: 'GET',
          redirect: 'manual',
          credentials: 'omit',
          headers: { Accept: 'text/html,text/plain,text/markdown,application/json', 'User-Agent': USER_AGENT },
          signal: AbortSignal.timeout(timeoutMs),
          dispatcher: getAgent(),
        });
      } catch (err) {
        if (err instanceof Error && err.name === 'TimeoutError') return fail(url, 'timeout');
        if (err instanceof Error && err.message === 'blocked_address') return fail(url, 'blocked_address');
        return fail(url, 'network_error');
      }

      // 6. Redirects — same host only, re-checked every hop from the top.
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (!location) return fail(url, 'http_error', res.status);
        let nextUrl: URL;
        try {
          nextUrl = new URL(location, currentUrl);
        } catch {
          return fail(url, 'network_error');
        }
        if (normaliseHost(nextUrl.hostname) !== host) return fail(url, 'redirect_host_changed');
        currentUrl = nextUrl.toString();
        continue; // loop from step 1 with the new URL — full gate re-runs.
      }

      if (res.status < 200 || res.status >= 300) return fail(url, 'http_error', res.status);

      // 7. Content-Type gate — compare only the part before `;`.
      const rawContentType = res.headers.get('content-type') ?? '';
      const contentType = rawContentType.split(';')[0]!.trim().toLowerCase();
      if (!(ALLOWED_LINK_CONTENT_TYPES as readonly string[]).includes(contentType)) {
        return fail(url, 'unsupported_content_type');
      }

      // 8. Read the body as a STREAM, capping by bytes actually read — never
      //    by trusting Content-Length, which is attacker-controlled and may
      //    lie or be absent.
      const { text, bytes, truncated } = await readCapped(res, MAX_LINK_CHARS);

      // 9. Sanitise (HTML→text) or pass through (plain/markdown/json), then
      //    return the already-safe document.
      const finalText = contentType === 'text/html' ? sanitiseHtml(text, MAX_LINK_CHARS) : text.slice(0, MAX_LINK_CHARS);

      return {
        ok: true,
        doc: {
          url: currentUrl,
          host,
          status: res.status,
          contentType,
          text: finalText,
          bytes,
          truncated,
        },
      };
    }

    return fail(url, 'too_many_redirects');
  }
}

/** Read a Response body as a stream, aborting once `limitChars` bytes have
 *  been read — the response is discarded past that point regardless of what
 *  Content-Length claimed. */
async function readCapped(res: Response, limitChars: number): Promise<{ text: string; bytes: number; truncated: boolean }> {
  const reader = res.body?.getReader();
  if (!reader) {
    const text = await res.text();
    const truncated = text.length > limitChars;
    return { text: truncated ? text.slice(0, limitChars) : text, bytes: text.length, truncated };
  }
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  let truncated = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      text += decoder.decode(value, { stream: true });
      if (text.length >= limitChars) {
        truncated = true;
        break;
      }
    }
  } finally {
    if (truncated) {
      // Abandon the stream rather than draining the rest of a possibly-huge body.
      await reader.cancel().catch(() => undefined);
    }
  }
  return { text: truncated ? text.slice(0, limitChars) : text, bytes, truncated };
}
