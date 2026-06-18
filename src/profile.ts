/* =====================================================================
 * profile.ts — build the UnifiedUser + badges + connections.
 *
 * Combines the bot-token /users/:id (basic) with the optional user-token
 * /users/:id/profile (rich), merges badges, and caches the result in KV
 * because none of this comes over the gateway.
 * ===================================================================== */

import type {
  Env,
  UnifiedBadge,
  UnifiedConnectedAccount,
  UnifiedUser,
} from "./types";
import {
  avatarUrl,
  badgeIconUrl,
  bannerUrl,
  clanBadgeUrl,
  decorationUrl,
  FLAG_BADGES,
} from "./discord/constants";
import { fetchBotUser, fetchUserProfile, type RawDiscordUser } from "./discord/rest";

export interface ProfileResult {
  user: UnifiedUser;
  badges: UnifiedBadge[];
  connected_accounts: UnifiedConnectedAccount[];
  source: "bot" | "user" | "cache";
}

function flagBadges(flags: number): UnifiedBadge[] {
  const out: UnifiedBadge[] = [];
  for (const [bit, id, description, hash] of FLAG_BADGES) {
    if (flags & bit) {
      out.push({
        id,
        description,
        icon: hash,
        icon_url: badgeIconUrl(hash),
        link: null,
        source: "flags",
      });
    }
  }
  return out;
}

function buildUser(u: RawDiscordUser, bio: string | null, pronouns: string | null): UnifiedUser {
  const pg = u.primary_guild;
  const clan =
    pg && pg.tag && pg.identity_enabled && pg.identity_guild_id
      ? {
          guild_id: pg.identity_guild_id,
          tag: pg.tag,
          badge: pg.badge ?? null,
          badge_url: pg.badge ? clanBadgeUrl(pg.identity_guild_id, pg.badge) : null,
        }
      : null;

  const deco = u.avatar_decoration_data;

  return {
    id: u.id,
    username: u.username,
    global_name: u.global_name ?? null,
    display_name: u.display_name ?? u.global_name ?? null,
    avatar: u.avatar ?? null,
    avatar_url: avatarUrl(u.id, u.avatar),
    banner: u.banner ?? null,
    banner_url: bannerUrl(u.id, u.banner ?? null),
    accent_color: u.accent_color ?? null,
    avatar_decoration: deco
      ? { asset: deco.asset, sku_id: deco.sku_id ?? null, url: decorationUrl(deco.asset) }
      : null,
    clan,
    collectibles: (u.collectibles as Record<string, unknown> | null) ?? null,
    bio,
    pronouns,
  };
}

function cacheKey(id: string): string {
  return `profile:${id}`;
}

/** Build profile from Discord, with a KV read-through cache. */
export async function getProfile(env: Env, id: string): Promise<ProfileResult | null> {
  const cached = await env.PROFILE_CACHE.get(cacheKey(id), "json");
  if (cached) {
    const c = cached as Omit<ProfileResult, "source">;
    return { ...c, source: "cache" };
  }

  const result = await buildFreshProfile(env, id);
  if (!result) return null;

  const ttl = Math.max(60, Number(env.PROFILE_CACHE_TTL_SECONDS || "300"));
  await env.PROFILE_CACHE.put(
    cacheKey(id),
    JSON.stringify({
      user: result.user,
      badges: result.badges,
      connected_accounts: result.connected_accounts,
    }),
    { expirationTtl: ttl }
  );
  return result;
}

async function buildFreshProfile(env: Env, id: string): Promise<ProfileResult | null> {
  // Rich path first (if user token present); fall back to bot-only.
  const profile = await fetchUserProfile(env, id);

  if (profile && profile.user) {
    const u = profile.user;
    const bio = profile.user_profile?.bio ?? u.bio ?? null;
    const pronouns = profile.user_profile?.pronouns ?? null;

    const badges: UnifiedBadge[] = [];
    // Flag badges from the user object (so classic badges are always present).
    badges.push(...flagBadges(u.public_flags ?? u.flags ?? 0));
    // Rich badges (Nitro/boost/quest/orb/gifting…) from the profile.
    for (const b of profile.badges ?? []) {
      if (badges.some((x) => x.id === b.id)) continue;
      badges.push({
        id: b.id,
        description: b.description,
        icon: b.icon,
        icon_url: badgeIconUrl(b.icon),
        link: b.link ?? null,
        source: "profile",
      });
    }

    const connected: UnifiedConnectedAccount[] = (profile.connected_accounts ?? []).map((c) => ({
      type: c.type,
      id: c.id,
      name: c.name,
      verified: !!c.verified,
    }));

    return { user: buildUser(u, bio, pronouns), badges, connected_accounts: connected, source: "user" };
  }

  // Bot-only fallback.
  const u = await fetchBotUser(env, id);
  if (!u) return null;
  return {
    user: buildUser(u, null, null),
    badges: flagBadges(u.public_flags ?? u.flags ?? 0),
    connected_accounts: [],
    source: "bot",
  };
}
