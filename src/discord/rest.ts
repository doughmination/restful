/* =====================================================================
 * discord/rest.ts — thin Discord REST client.
 *
 * Two callers:
 *   fetchBotUser()   — bot token, /users/:id        (basic, always safe)
 *   fetchUserProfile() — user token, /users/:id/profile (rich, ToS risk)
 * ===================================================================== */

import type { Env } from "../types";

function apiBase(env: Env): string {
  const v = env.DISCORD_API_VERSION || "10";
  return `https://discord.com/api/v${v}`;
}

export interface RawDiscordUser {
  id: string;
  username: string;
  global_name?: string | null;
  display_name?: string | null;
  avatar: string | null;
  banner?: string | null;
  accent_color?: number | null;
  public_flags?: number;
  flags?: number;
  avatar_decoration_data?: { asset: string; sku_id?: string | null } | null;
  primary_guild?: {
    identity_guild_id?: string | null;
    identity_enabled?: boolean | null;
    tag?: string | null;
    badge?: string | null;
  } | null;
  collectibles?: Record<string, unknown> | null;
  discriminator?: string;
  display_name_styles?: {
    colors?: number[] | null;
    font_id?: number | null;
    effect_id?: number | null;
  } | null;
}

export interface RawProfileBadge {
  id: string;
  description: string;
  icon: string;
  link?: string;
}

export interface RawProfileResponse {
  user?: RawDiscordUser & { bio?: string };
  user_profile?: {
    bio?: string;
    pronouns?: string;
    accent_color?: number | null;
    theme_colors?: number[] | null;
  };
  badges?: RawProfileBadge[];
  connected_accounts?: Array<{ type: string; id: string; name: string; verified: boolean }>;
  premium_type?: number;
  premium_since?: string | null;
  premium_guild_since?: string | null;
}

/** Basic user via bot token. Returns null on 404 / failure. */
export async function fetchBotUser(env: Env, id: string): Promise<RawDiscordUser | null> {
  const res = await fetch(`${apiBase(env)}/users/${id}`, {
    headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` },
  });
  if (!res.ok) return null;
  return (await res.json()) as RawDiscordUser;
}

/**
 * Rich profile via USER token (self-bot — ToS risk). Returns null if no user
 * token is configured or the request fails, so callers degrade gracefully.
 */
export async function fetchUserProfile(env: Env, id: string): Promise<RawProfileResponse | null> {
  if (!env.DISCORD_USER_TOKEN) return null;
  const url =
    `${apiBase(env)}/users/${id}/profile` +
    `?with_mutual_guilds=false&with_mutual_friends=false`;
  const res = await fetch(url, {
    headers: { Authorization: env.DISCORD_USER_TOKEN },
  });
  if (!res.ok) return null;
  return (await res.json()) as RawProfileResponse;
}
