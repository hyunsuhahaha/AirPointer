// Agent Links made in this browser, so the user can delete them later even
// after closing the result -- essential for links that never expire.
import type { AgentLink } from "./agent-link";
import { isExpired } from "./link-ttl";

const KEY = "whatwas.agent-links";

export function readMyLinks(now = Date.now()): AgentLink[] {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? "[]") as AgentLink[];
    const alive = Array.isArray(stored) ? stored.filter((link) => link?.token && !isExpired(link.expiresAt, now)) : [];
    if (alive.length !== stored.length) writeMyLinks(alive);
    return alive.sort((left, right) => right.createdAt - left.createdAt);
  } catch { return []; }
}

function writeMyLinks(links: AgentLink[]) {
  try { localStorage.setItem(KEY, JSON.stringify(links)); } catch { /* Storage may be blocked; the list is a convenience. */ }
}

export const rememberLink = (link: AgentLink) => writeMyLinks([link, ...readMyLinks().filter((entry) => entry.token !== link.token)]);
export const forgetLink = (token: string) => writeMyLinks(readMyLinks().filter((entry) => entry.token !== token));
export const unlimitedLinkCount = (links: AgentLink[]) => links.filter((link) => link.expiresAt === null).length;
