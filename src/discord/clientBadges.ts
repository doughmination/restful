import type { Env, UnifiedClientBadge } from "../types";

const API_BASE = "https://badges.equicord.org";

interface EquibadgesResponse {
  status: number;
  /** Flat array (no `separated` query) — one list across all services. */
  badges: { tooltip: string; badge: string }[];
}

function cacheKey(id: string): string {
  return `clientbadges:${id}`;
}

/** Cache freshness window — these change rarely, so an hour is plenty. */
const TTL_SECONDS = 3600;

/**
 * Fetch a user's third-party client-mod badges, cache-first.
 * Returns [] when the user has none, null when the aggregator couldn't be
 * reached and there's nothing usable cached either.
 */
export async function getClientBadges(
  env: Env,
  id: string,
  ctx?: ExecutionContext,
  force = false
): Promise<UnifiedClientBadge[] | null> {
  if (!force) {
    const cached = (await env.PROFILE_CACHE.get(cacheKey(id), "json")) as
      | UnifiedClientBadge[]
      | null;
    if (cached) return cached;
  }

  const fetched = await fetchClientBadges(id);

  // 404 ("no badges found") is a valid, cacheable empty result — only a
  // genuine fetch failure (network error, 5xx, etc.) should fall through.
  if (fetched === undefined) {
    if (force) {
      // Caller explicitly asked for a fresh fetch; fall back to whatever's
      // cached (even if stale) rather than returning null outright.
      const stale = (await env.PROFILE_CACHE.get(cacheKey(id), "json")) as
        | UnifiedClientBadge[]
        | null;
      return stale ?? null;
    }
    return null;
  }

  const write = env.PROFILE_CACHE.put(cacheKey(id), JSON.stringify(fetched), {
    expirationTtl: TTL_SECONDS,
  });
  if (ctx) ctx.waitUntil(write);
  else await write;

  return fetched;
}

/** Returns the badge list, [] for none, or undefined on a fetch failure. */
async function fetchClientBadges(id: string): Promise<UnifiedClientBadge[] | undefined> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/${id}`);
  } catch {
    return undefined;
  }

  if (res.status === 404) return [];
  if (!res.ok) return undefined;

  let data: EquibadgesResponse;
  try {
    data = (await res.json()) as EquibadgesResponse;
  } catch {
    return undefined;
  }

  if (!Array.isArray(data.badges)) return [];

  return data.badges
    .filter((b) => b && typeof b.badge === "string")
    // The aggregator also throws in official Discord badges (HypeSquad,
    // Nitro, etc) under /public/badges/discord/. Those already live in
    // `data.badges` via Discord's own flags, so drop them here to avoid
    // duplicating them under clientBadges.
    .filter((b) => !/\/public\/badges\/discord\//i.test(b.badge))
    .map((b) => ({
      tooltip: typeof b.tooltip === "string" ? b.tooltip : "",
      icon_url: b.badge,
    }));
}