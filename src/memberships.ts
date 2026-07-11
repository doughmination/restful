/* =====================================================================
 * memberships.ts — per-guild membership across configured tracked guilds.
 *
 * Generalises the /v1/girls member lookup to every guild in
 * MEMBERSHIP_GUILD_IDS (falling back to TRACKED_GUILD_IDS): for each guild the
 * bot shares, resolve the user's roles, join date, boosting, guild-specific
 * nick/avatar and timeout. Bot-token only. Guild name/icon are cached per
 * guild (they rarely change); the per-user membership is cached per (guild,
 * user). Returns null when no guilds are configured, [] when the user is in
 * none of them.
 * ===================================================================== */

import type { Env, UnifiedGuildMembership } from "./types";
import { fetchGuildBasic, fetchGuildMember } from "./discord/rest";
import { avatarUrl, guildIconUrl, guildMemberAvatarUrl } from "./discord/constants";

/** Guild ids to resolve memberships for — explicit override, else the tracked
 *  set the gateway already watches. Empty when neither is configured. */
function membershipGuildIds(env: Env): string[] {
  const raw = env.MEMBERSHIP_GUILD_IDS || env.TRACKED_GUILD_IDS || "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^\d{16,21}$/.test(s));
}

/** Cache guild name/icon per guild (~6h) — shared across all users. */
async function guildMeta(
  env: Env,
  guildId: string,
  ctx?: ExecutionContext
): Promise<{ name: string | null; icon_url: string | null }> {
  const key = `guildmeta:${guildId}`;
  const cached = (await env.PROFILE_CACHE.get(key, "json")) as
    | { name: string | null; icon_url: string | null }
    | null;
  if (cached) return cached;

  const g = await fetchGuildBasic(env, guildId);
  const meta = {
    name: g?.name ?? null,
    icon_url: g ? guildIconUrl(guildId, g.icon) : null,
  };
  if (g) {
    const write = env.PROFILE_CACHE.put(key, JSON.stringify(meta), { expirationTtl: 21600 });
    if (ctx) ctx.waitUntil(write);
    else await write;
  }
  return meta;
}

function memberCacheKey(guildId: string, userId: string): string {
  return `membership:${guildId}:${userId}`;
}

async function oneMembership(
  env: Env,
  guildId: string,
  userId: string,
  ctx?: ExecutionContext,
  force = false
): Promise<UnifiedGuildMembership | null> {
  if (!force) {
    const cached = (await env.PROFILE_CACHE.get(memberCacheKey(guildId, userId), "json")) as
      | UnifiedGuildMembership
      | null;
    if (cached) return cached;
  }

  const member = await fetchGuildMember(env, guildId, userId);
  if (!member || !member.user) return null; // not in this guild (or 404)

  const meta = await guildMeta(env, guildId, ctx);
  const membership: UnifiedGuildMembership = {
    guild_id: guildId,
    guild_name: meta.name,
    guild_icon_url: meta.icon_url,
    nick: member.nick ?? null,
    avatar_url: member.avatar
      ? guildMemberAvatarUrl(guildId, member.user.id, member.avatar)
      : avatarUrl(member.user.id, member.user.avatar),
    roles: Array.isArray(member.roles) ? member.roles : [],
    joined_at: member.joined_at ?? null,
    premium_since: member.premium_since ?? null,
    pending: !!member.pending,
    communication_disabled_until: member.communication_disabled_until ?? null,
  };

  const write = env.PROFILE_CACHE.put(memberCacheKey(guildId, userId), JSON.stringify(membership), {
    expirationTtl: 300,
  });
  if (ctx) ctx.waitUntil(write);
  else await write;

  return membership;
}

/**
 * Resolve a user's membership across every configured guild. null when no
 * guilds are configured; [] when the user is in none of them.
 */
export async function getMemberships(
  env: Env,
  userId: string,
  ctx?: ExecutionContext,
  force = false
): Promise<UnifiedGuildMembership[] | null> {
  const guildIds = membershipGuildIds(env);
  if (!guildIds.length) return null;

  const results = await Promise.all(
    guildIds.map((gid) => oneMembership(env, gid, userId, ctx, force).catch(() => null))
  );
  return results.filter((m): m is UnifiedGuildMembership => m != null);
}
