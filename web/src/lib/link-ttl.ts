// How long an Agent Link stays open. Shared by the export panel and the API.
// "unlimited" links stay until someone deletes them.
export const UNLIMITED = "unlimited";
export const LINK_TTL_OPTIONS = [5, 10, 20, 30, 60, UNLIMITED] as const;
export type LinkTtl = (typeof LINK_TTL_OPTIONS)[number];
export const DEFAULT_LINK_TTL: LinkTtl = 20;
export const MAX_LINK_TTL_MS = 60 * 60 * 1_000;
// Unlimited links a single browser may keep at once.
export const MAX_UNLIMITED_LINKS = 5;

export function parseLinkTtl(value: unknown): LinkTtl {
  if (value === UNLIMITED) return UNLIMITED;
  const minutes = Number(value);
  return (LINK_TTL_OPTIONS as readonly unknown[]).includes(minutes) ? minutes as LinkTtl : DEFAULT_LINK_TTL;
}

// Milliseconds until expiry, or null for a link that never expires.
export function linkTtlMs(value: unknown) {
  const ttl = parseLinkTtl(value);
  return ttl === UNLIMITED ? null : ttl * 60 * 1_000;
}

export const linkTtlLabel = (ttl: LinkTtl) => ttl === UNLIMITED ? "삭제할 때까지" : ttl < 60 ? `${ttl}분` : `${ttl / 60}시간`;
export const isExpired = (expiresAt: number | null, now = Date.now()) => expiresAt !== null && expiresAt <= now;
