/* =====================================================================
 * guild.ts — resolve a server invite code -> guild info.
 * ===================================================================== */

import type { Env, UnifiedGuildInvite } from "./types";
import { fetchInvite } from "./discord/rest";
import { CDN } from "./discord/constants";

function iconUrl(guildId: string, hash: string | null): string | null {
  if (!hash) return null;
  const ext = hash.startsWith("a_") ? "gif" : "png";
  return `${CDN}/icons/${guildId}/${hash}.${ext}`;
}

function bannerUrl(guildId: string, hash: string | null | undefined): string | null {
  if (!hash) return null;
  const ext = hash.startsWith("a_") ? "gif" : "png";
  return `${CDN}/banners/${guildId}/${hash}.${ext}`;
}

function splashUrl(guildId: string, hash: string | null | undefined): string | null {
  if (!hash) return null;
  return `${CDN}/splashes/${guildId}/${hash}.png`;
}

function cacheKey(code: string): string {
  return `invite:${code}`;
}

/**
 * Resolve an invite code, cache-first (~10 min — invite counts drift but
 * the invite endpoint is generously rate-limited regardless).
 */
export async function getGuildInvite(
  env: Env,
  code: string,
  ctx?: ExecutionContext,
  force = false
): Promise<UnifiedGuildInvite | null> {
  if (!force) {
    const cached = (await env.PROFILE_CACHE.get(cacheKey(code), "json")) as UnifiedGuildInvite | null;
    if (cached) return cached;
  }

  const raw = await fetchInvite(env, code);
  if (!raw || !raw.guild) return null;

  const g = raw.guild;
  const result: UnifiedGuildInvite = {
    id: g.id,
    name: g.name,
    icon_url: iconUrl(g.id, g.icon),
    banner_url: bannerUrl(g.id, g.banner),
    splash_url: splashUrl(g.id, g.splash),
    description: g.description ?? null,
    member_count: raw.approximate_member_count ?? null,
    online_count: raw.approximate_presence_count ?? null,
  };

  const write = env.PROFILE_CACHE.put(cacheKey(code), JSON.stringify(result), {
    expirationTtl: 600,
  });
  if (ctx) ctx.waitUntil(write);
  else await write;

  return result;
}