import type { ConventionCandidate } from "@devdigest/shared";

/** Bucket labels for the "last scan …" line. The caller renders them through
 *  i18n, so this returns a key + count rather than a formatted string. */
export type RelativeTime =
  | { key: "justNow" }
  | { key: "minutesAgo"; count: number }
  | { key: "hoursAgo"; count: number }
  | { key: "daysAgo"; count: number };

export function relativeTime(iso: string, now: number = Date.now()): RelativeTime {
  const elapsed = Math.max(0, now - new Date(iso).getTime());
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return { key: "justNow" };
  if (minutes < 60) return { key: "minutesAgo", count: minutes };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { key: "hoursAgo", count: hours };
  return { key: "daysAgo", count: Math.floor(hours / 24) };
}

export function countByStatus(candidates: ConventionCandidate[]) {
  let accepted = 0;
  let pending = 0;
  for (const c of candidates) {
    if (c.status === "accepted") accepted += 1;
    else if (c.status === "pending") pending += 1;
  }
  return { accepted, pending };
}
