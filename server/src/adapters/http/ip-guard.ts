/**
 * Pure IP / host guard (layer 2 — Domain Services, pure). Three
 * dependency-free functions holding the security-critical logic for the
 * outbound-HTTP port, precisely so it can be tested exhaustively offline.
 * This file imports NOTHING — no `node:*`, no `zod` — so any caller can
 * exercise it with plain strings/numbers.
 */

/** Lowercase + strip one trailing dot. The `URL` constructor already applies
 *  IDN→punycode before this runs, so no additional Unicode handling belongs
 *  here. */
export function normaliseHost(hostname: string): string {
  const lower = hostname.toLowerCase();
  return lower.endsWith('.') ? lower.slice(0, -1) : lower;
}

/**
 * Structural host match — never `endsWith`/substring, which would let
 * `evil-github.com` match a naive `.github.com` suffix check. A pattern is
 * either an exact host, or `*.suffix` matched by comparing label arrays (the
 * apex is NOT covered by the wildcard form).
 */
export function hostMatchesAllowlist(host: string, patterns: string[]): boolean {
  const normalisedHost = normaliseHost(host);
  const hostLabels = normalisedHost.split('.');
  for (const raw of patterns) {
    const pattern = normaliseHost(raw);
    if (pattern === normalisedHost) return true;
    if (pattern.startsWith('*.')) {
      const suffixLabels = pattern.slice(2).split('.');
      if (hostLabels.length <= suffixLabels.length) continue;
      const hostSuffix = hostLabels.slice(hostLabels.length - suffixLabels.length);
      if (hostSuffix.join('.') === suffixLabels.join('.')) return true;
    }
  }
  return false;
}

/** Parse an IPv4 dotted-quad to a 4-byte array, or null if not one. */
function parseIpv4(addr: string): [number, number, number, number] | null {
  const parts = addr.split('.');
  if (parts.length !== 4) return null;
  const bytes: number[] = [];
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    bytes.push(n);
  }
  return bytes as [number, number, number, number];
}

/** IPv4 CIDR ranges that must never be connected to, compared numerically. */
const BLOCKED_IPV4_CIDRS: { base: [number, number, number, number]; bits: number }[] = [
  { base: [127, 0, 0, 0], bits: 8 }, // loopback
  { base: [10, 0, 0, 0], bits: 8 }, // private
  { base: [172, 16, 0, 0], bits: 12 }, // private
  { base: [192, 168, 0, 0], bits: 16 }, // private
  { base: [169, 254, 0, 0], bits: 16 }, // link-local (covers cloud metadata 169.254.169.254)
  { base: [100, 64, 0, 0], bits: 10 }, // carrier-grade NAT
  { base: [0, 0, 0, 0], bits: 8 }, // "this" network
  { base: [224, 0, 0, 0], bits: 4 }, // multicast
];

function ipv4ToInt(b: [number, number, number, number]): number {
  return ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0;
}

function isBlockedIpv4(addr: string): boolean {
  const bytes = parseIpv4(addr);
  if (!bytes) return false;
  const value = ipv4ToInt(bytes);
  for (const { base, bits } of BLOCKED_IPV4_CIDRS) {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    if ((value & mask) === (ipv4ToInt(base) & mask)) return true;
  }
  return false;
}

/**
 * Expand an IPv6 address to 8 lowercase hextets (handles `::` compression AND
 * the dotted-quad tail form used by IPv4-mapped/-compatible addresses, e.g.
 * `::ffff:127.0.0.1`, where the last "group" is actually an embedded IPv4
 * address rather than one hextet).
 */
function expandIpv6(addr: string): string[] | null {
  let a = addr;
  if (a.startsWith('[') && a.endsWith(']')) a = a.slice(1, -1);
  const parts = a.split('::');
  if (parts.length > 2) return null;
  const parseGroup = (s: string): string[] | null => {
    if (s.length === 0) return [];
    const groups = s.split(':');
    const last = groups[groups.length - 1]!;
    // An embedded IPv4 dotted-quad in the final group (e.g. "ffff:127.0.0.1")
    // counts as TWO hextets, not one.
    if (last.includes('.')) {
      const v4 = parseIpv4(last);
      if (!v4) return null;
      const hi = ((v4[0] << 8) | v4[1]).toString(16);
      const lo = ((v4[2] << 8) | v4[3]).toString(16);
      return [...groups.slice(0, -1), hi, lo];
    }
    return groups;
  };
  const head = parseGroup(parts[0] ?? '');
  const tail = parts.length === 2 ? parseGroup(parts[1] ?? '') : [];
  if (head === null || tail === null) return null;
  if (parts.length === 1 && head.length !== 8) return null;
  const missing = 8 - head.length - tail.length;
  if (missing < 0) return null;
  const middle = parts.length === 2 ? new Array(missing).fill('0') : [];
  const full = [...head, ...middle, ...tail];
  if (full.length !== 8) return null;
  return full.map((h) => (h.length === 0 ? '0' : h.toLowerCase().padStart(4, '0')));
}

function isBlockedIpv6(addr: string): boolean {
  const hextets = expandIpv6(addr);
  if (!hextets) return false;

  // ::1 — loopback
  if (hextets.every((h, i) => (i < 7 ? h === '0000' : h === '0001'))) return true;

  // IPv4-mapped IPv6 (::ffff:a.b.c.d) — unwrap to IPv4 and recheck. This is
  // the classic bypass: an attacker-supplied literal that looks like IPv6 but
  // resolves through the IPv4 block-list.
  const isV4Mapped = hextets.slice(0, 5).every((h) => h === '0000') && hextets[5] === 'ffff';
  if (isV4Mapped) {
    const hi = parseInt(hextets[6]!, 16);
    const lo = parseInt(hextets[7]!, 16);
    const ipv4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
    return isBlockedIpv4(ipv4);
  }

  const first = parseInt(hextets[0]!, 16);
  // fe80::/10 — link-local
  if ((first & 0xffc0) === 0xfe80) return true;
  // fc00::/7 — unique local
  if ((first & 0xfe00) === 0xfc00) return true;
  // ff00::/8 — multicast
  if ((first & 0xff00) === 0xff00) return true;

  return false;
}

/** Parse to bytes and compare CIDR ranges numerically — never string-match.
 *  Unwraps IPv4-mapped IPv6 (`::ffff:a.b.c.d`) to the IPv4 address and
 *  re-checks it, which is the classic bypass. */
export function isBlockedIp(addr: string, family: 4 | 6): boolean {
  if (family === 4) return isBlockedIpv4(addr);
  return isBlockedIpv6(addr);
}
