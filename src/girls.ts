/* =====================================================================
 * girls.ts — resolve /v1/girls/:idType/:id against the configured
 * "Girls" guild (env.GIRLS_GUILD_ID).
 *
 * Supported idType values today:
 *   role    -> GET /v1/girls/role/:roleId     (role details)
 *   member  -> GET /v1/girls/member/:userId   (member details incl. roles)
 *
 * Adding a new idType later is just: add a case below + a small mapper.
 * ===================================================================== */

import type { Env, UnifiedGirlsMember, UnifiedGirlsRole } from "./types";
import { fetchGuildMember, fetchGuildRoles } from "./discord/rest";
import { avatarUrl, roleIconUrl } from "./discord/constants";

export const GIRLS_ID_TYPES = ["role", "member"] as const;
export type GirlsIdType = (typeof GIRLS_ID_TYPES)[number];

export function isGirlsIdType(v: string): v is GirlsIdType {
  return (GIRLS_ID_TYPES as readonly string[]).includes(v);
}

function cacheKey(idType: GirlsIdType, id: string): string {
  return `girls:${idType}:${id}`;
}

/**
 * Fetch + cache-first resolve for a single /v1/girls/:idType/:id lookup.
 * Returns null on "not found"; throws only on missing configuration.
 */
export async function getGirlsResource(
  env: Env,
  idType: GirlsIdType,
  id: string,
  ctx?: ExecutionContext,
  force = false
): Promise<UnifiedGirlsRole | UnifiedGirlsMember | null> {
  const guildId = env.GIRLS_GUILD_ID;
  if (!guildId) {
    throw new Error("GIRLS_GUILD_ID is not configured (set it in wrangler.jsonc vars).");
  }

  if (!force) {
    const cached = await env.PROFILE_CACHE.get(cacheKey(idType, id), "json");
    if (cached) return cached as UnifiedGirlsRole | UnifiedGirlsMember;
  }

  const result = idType === "role" ? await getRole(env, guildId, id) : await getMember(env, guildId, id);

  if (result) {
    const write = env.PROFILE_CACHE.put(cacheKey(idType, id), JSON.stringify(result), {
      expirationTtl: 300, // 5 min — roles/members don't change that often
    });
    if (ctx) ctx.waitUntil(write);
    else await write;
  }

  return result;
}

async function getRole(env: Env, guildId: string, roleId: string): Promise<UnifiedGirlsRole | null> {
  // Discord has no single-role GET for bots, so we fetch the guild's role
  // list and pick the one we want. Cheap call, cached above regardless.
  const roles = await fetchGuildRoles(env, guildId);
  const role = roles?.find((r) => r.id === roleId);
  if (!role) return null;

  return {
    id: role.id,
    guild_id: guildId,
    name: role.name,
    color: role.color,
    colors: role.colors
      ? {
          primary_color: role.colors.primary_color,
          secondary_color: role.colors.secondary_color ?? null,
          tertiary_color: role.colors.tertiary_color ?? null,
        }
      : null,
    hoist: role.hoist,
    icon_url: roleIconUrl(role.id, role.icon),
    unicode_emoji: role.unicode_emoji ?? null,
    position: role.position,
    permissions: role.permissions,
    managed: role.managed,
    mentionable: role.mentionable,
    // Discord doesn't return a per-role member count from this endpoint —
    // getting one requires iterating the full member list (privileged intent
    // + expensive on large guilds), so it's left null for now.
    member_count: null,
  };
}

async function getMember(env: Env, guildId: string, userId: string): Promise<UnifiedGirlsMember | null> {
  const member = await fetchGuildMember(env, guildId, userId);
  if (!member || !member.user) return null;

  return {
    user_id: member.user.id,
    guild_id: guildId,
    nick: member.nick ?? null,
    avatar_url: member.avatar
      ? `https://cdn.discordapp.com/guilds/${guildId}/users/${member.user.id}/avatars/${member.avatar}.${
          member.avatar.startsWith("a_") ? "gif" : "png"
        }`
      : avatarUrl(member.user.id, member.user.avatar),
    roles: member.roles,
    joined_at: member.joined_at ?? null,
    premium_since: member.premium_since ?? null,
    pending: !!member.pending,
    communication_disabled_until: member.communication_disabled_until ?? null,
  };
}