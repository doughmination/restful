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

// ---- client fingerprint -------------------------------------------------
// Discord applies MUCH gentler rate limits to requests that look like its real
// client. Bare API calls to /profile get throttled hard; the same calls with a
// proper User-Agent + X-Super-Properties (base64 client-info) get the client's
// treatment. Keep BROWSER_UA + the build number reasonably current — Discord
// trusts up-to-date clients more. Build number is overridable via
// DISCORD_CLIENT_BUILD_NUMBER so you can bump it without a code change.
// Matched to a real Firefox web client (stable channel). Keep these in sync with
// an actual client's X-Super-Properties — re-grab and bump when they drift.
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:152.0) Gecko/20100101 Firefox/152.0";

// A real web client also sends these per-"launch" identifiers. Discord doesn't
// appear to validate them (Dustin runs static ones fine for months), so we mint
// one set per worker start and reuse it — i.e. behave like a single client launch.
let launchIdentity: {
  client_launch_id: string;
  launch_signature: string;
  client_heartbeat_session_id: string;
} | null = null;

function getLaunchIdentity() {
  if (!launchIdentity) {
    launchIdentity = {
      client_launch_id: crypto.randomUUID(),
      launch_signature: crypto.randomUUID(),
      client_heartbeat_session_id: crypto.randomUUID(),
    };
  }
  return launchIdentity;
}

function superProperties(env: Env): string {
  const build = Number(env.DISCORD_CLIENT_BUILD_NUMBER || "579073");
  // Field set matched to a real Firefox WEB client. Do NOT add desktop-only
  // fields (native_build_number, os_arch, X-Installation-ID, …) — a "Firefox"
  // client that claims those is inconsistent and reads as MORE suspicious.
  const props = {
    os: "Mac OS X",
    browser: "Firefox",
    device: "",
    system_locale: "en-GB",
    has_client_mods: false,
    browser_user_agent: BROWSER_UA,
    browser_version: "152.0",
    os_version: "10.15",
    referrer: "",
    referring_domain: "",
    referrer_current: "",
    referring_domain_current: "",
    release_channel: "stable",
    client_build_number: build,
    client_event_source: null,
    ...getLaunchIdentity(),
    client_app_state: "focused",
  };
  return btoa(JSON.stringify(props));
}

/** Headers that make a user-token request look like the official web client. */
function clientHeaders(env: Env, token: string): Record<string, string> {
  return {
    Authorization: token,
    "User-Agent": BROWSER_UA,
    "X-Super-Properties": superProperties(env),
    "X-Discord-Locale": "en-GB",
    "X-Discord-Timezone": "Europe/London",
    "X-Debug-Options": "bugReporterEnabled",
    Accept: "*/*",
    "Accept-Language": "en-GB,en;q=0.9",
    Origin: "https://discord.com",
    Referer: "https://discord.com/channels/@me",
  };
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
  /** Pre-2023 handle Discord still exposes on some rich profiles. */
  legacy_username?: string | null;
  display_name_styles?: {
    colors?: number[] | null;
    font_id?: number | null;
    effect_id?: number | null;
  } | null;
}

/** A guild entry from the rich profile's `mutual_guilds` array. */
export interface RawMutualGuild {
  id: string;
  nick?: string | null;
}

/** A friend entry from the rich profile's `mutual_friends` array. */
export interface RawMutualFriend {
  id: string;
  username: string;
  global_name?: string | null;
  avatar?: string | null;
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
    /** Equipped profile effect (Shop collectible). */
    profile_effect?: { id?: string | null } | null;
  };
  badges?: RawProfileBadge[];
  connected_accounts?: Array<{ type: string; id: string; name: string; verified: boolean }>;
  premium_type?: number;
  premium_since?: string | null;
  premium_guild_since?: string | null;
  legacy_username?: string | null;
  /** Guilds shared with the token account (with_mutual_guilds=true). */
  mutual_guilds?: RawMutualGuild[] | null;
  /** Friends shared with the token account (with_mutual_friends=true). */
  mutual_friends?: RawMutualFriend[] | null;
  mutual_friends_count?: number | null;
  /** Profile wishlist: map of WISHLIST id -> per-wishlist settings. The items
   *  themselves are NOT here — fetch them with fetchWishlist(wishlistId). */
  wishlist_settings?: Record<string, { visibility?: number; updated_at?: string }>;
}

/** Basic user via bot token. Returns null on 404 / failure. */
export async function fetchBotUser(env: Env, id: string): Promise<RawDiscordUser | null> {
  const res = await fetch(`${apiBase(env)}/users/${id}`, {
    headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` },
  });
  if (!res.ok) return null;
  return (await res.json()) as RawDiscordUser;
}

export interface UserProfileFetch {
  data: RawProfileResponse | null;
  /** HTTP status (0 = not attempted / no token). */
  status: number;
  /** Seconds from a 429 Retry-After header, when present. */
  retryAfter: number;
}

/** Configured user tokens (1 or 2), in order, skipping blanks. */
function userTokens(env: Env): string[] {
  return [env.DISCORD_USER_TOKEN, env.DISCORD_USER_TOKEN2, env.DISCORD_USER_TOKEN3].filter(
    (t): t is string => !!t && t.trim().length > 0
  );
}

/**
 * Rich profile via USER token(s) (self-bot — ToS risk). If two tokens are
 * configured, load is spread across them (random start) and a 429 on one fails
 * over to the other — doubling the /profile rate-limit headroom. Reports the
 * HTTP status so callers can tell a 429 (back off) from a 401/403 token issue.
 */
export async function fetchUserProfile(env: Env, id: string): Promise<UserProfileFetch> {
  const tokens = userTokens(env);
  if (tokens.length === 0) return { data: null, status: 0, retryAfter: 0 };

  // Pull mutuals too — they ride on the same request, so it's free extra data.
  // (Only mutuals with the userbot account are visible, by Discord's design.)
  const url =
    `${apiBase(env)}/users/${id}/profile` +
    `?with_mutual_guilds=true&with_mutual_friends=true`;

  // Spread load: start on a random token, then rotate to the next on a 429.
  const start = Math.floor(Math.random() * tokens.length);
  let lastStatus = 0;
  let lastRetryAfter = 0;

  for (let i = 0; i < tokens.length; i++) {
    const idx = (start + i) % tokens.length;
    const res = await fetch(url, { headers: clientHeaders(env, tokens[idx]) });
    if (res.ok) {
      return { data: (await res.json()) as RawProfileResponse, status: 200, retryAfter: 0 };
    }
    lastStatus = res.status;
    lastRetryAfter = Number(res.headers.get("retry-after")) || 0;
    console.warn(
      `[dough-api] user-token #${idx + 1} /users/${id}/profile -> HTTP ${res.status}` +
        (lastRetryAfter ? ` (retry ${lastRetryAfter}s)` : "")
    );
    // Only a rate-limit is worth retrying on another token; 401/403/404 would
    // behave the same (or signal a token problem we'd rather surface).
    if (res.status !== 429) break;
  }
  return { data: null, status: lastStatus, retryAfter: lastRetryAfter };
}

// ---- wishlist (the profile's wishlist_settings key is a WISHLIST id) -----

export interface WishlistFetch {
  /** Raw wishlist JSON ({ id, user_id, wishlist_items: [...] }); null on fail. */
  raw: any | null;
  /** HTTP status (0 = not attempted / no token). */
  status: number;
}

/** One GET attempt; reads body as text so failures show in `wrangler tail`. */
async function tryJson(url: string, headers: Record<string, string>, label: string): Promise<WishlistFetch> {
  const res = await fetch(url, { headers });
  const text = await res.text().catch(() => "");
  if (res.ok) {
    try {
      return { raw: JSON.parse(text), status: 200 };
    } catch {
      console.warn(`[dough-api] ${label} 200 non-JSON: ${text.slice(0, 100)}`);
      return { raw: null, status: 200 };
    }
  }
  console.warn(`[dough-api] ${label} HTTP ${res.status}: ${text.slice(0, 140)}`);
  return { raw: null, status: res.status };
}

/**
 * Fetch a user's wishlist by its id (the key inside the profile's
 * `wishlist_settings`). GET /wishlists/{id} returns every item already
 * resolved (names + collectible image data), so no per-item lookups are
 * needed. User token + client fingerprint first, bot token as a fallback;
 * configured API version then v10.
 */
export async function fetchWishlist(env: Env, wishlistId: string): Promise<WishlistFetch> {
  const configured = env.DISCORD_API_VERSION || "10";
  const versions = configured === "10" ? ["10"] : [configured, "10"];
  const tokens = userTokens(env);
  let lastStatus = 0;

  for (const ver of versions) {
    const url = `https://discord.com/api/v${ver}/wishlists/${wishlistId}`;
    for (let i = 0; i < tokens.length; i++) {
      const r = await tryJson(url, clientHeaders(env, tokens[i]), `wishlist ${wishlistId} v${ver} user#${i + 1}`);
      if (r.raw) return r;
      lastStatus = r.status;
      if (r.status !== 429 && r.status !== 404) break;
    }
    const rb = await tryJson(
      url,
      { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` },
      `wishlist ${wishlistId} v${ver} bot`
    );
    if (rb.raw) return rb;
    lastStatus = rb.status || lastStatus;
  }
  return { raw: null, status: lastStatus };
}


// ---- collectibles products (resolve an equipped collectible's SKU) -------
// The rich profile's `collectibles` blob only carries SKU ids (+ a little
// metadata) per slot — nameplate, and since mid-2026 the new `profile_frame`.
// GET /collectibles-products/{sku_id} resolves one of those SKUs into a full
// product (name, summary, styles, and an `items[]` array whose entries carry
// ready-made static/animated/video asset URLs). Same fingerprint trick as the
// profile call so we get the client's gentler rate limits; bot token fallback.

/** One resolved item inside a collectible product (avatar deco / effect /
 *  nameplate / frame). Only the fields we surface are typed; the rest ride
 *  along untyped so a brand-new item kind still passes through. */
export interface RawCollectibleItem {
  type?: number;
  id?: string;
  sku_id?: string;
  asset?: string;
  label?: string;
  palette?: string;
  title?: string;
  description?: string;
  accessibilityLabel?: string;
  assets?: {
    static_image_url?: string | null;
    animated_image_url?: string | null;
    video_url?: string | null;
  } | null;
  // profile-effect image fields live directly on the item
  staticFrameSrc?: string | null;
  thumbnailPreviewSrc?: string | null;
  reducedMotionSrc?: string | null;
  [k: string]: unknown;
}

export interface RawCollectibleProduct {
  sku_id?: string;
  store_listing_id?: string;
  type?: number;
  name?: string;
  summary?: string;
  items?: RawCollectibleItem[];
  [k: string]: unknown;
}

/**
 * Resolve one collectible SKU to its product. User token + client fingerprint
 * first (better rate limits, and some collectibles are gated to it), bot token
 * as a fallback; configured API version then v10. null on failure.
 */
export async function fetchCollectibleProduct(
  env: Env,
  skuId: string
): Promise<RawCollectibleProduct | null> {
  const configured = env.DISCORD_API_VERSION || "10";
  const versions = configured === "10" ? ["10"] : [configured, "10"];
  const tokens = userTokens(env);
  const locale = "en-GB";

  for (const ver of versions) {
    const url =
      `https://discord.com/api/v${ver}/collectibles-products/${skuId}` +
      `?locale=${locale}`;
    for (let i = 0; i < tokens.length; i++) {
      const r = await tryJson(url, clientHeaders(env, tokens[i]), `collectible ${skuId} v${ver} user#${i + 1}`);
      if (r.raw) return r.raw as RawCollectibleProduct;
      // 404/429 → try next token/version; anything else → give up this version.
      if (r.status !== 429 && r.status !== 404) break;
    }
    if (env.DISCORD_BOT_TOKEN) {
      const rb = await tryJson(
        url,
        { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` },
        `collectible ${skuId} v${ver} bot`
      );
      if (rb.raw) return rb.raw as RawCollectibleProduct;
    }
  }
  return null;
}


// ---- guild roles / members (for /v1/girls/:idType/:id) -------------------

export interface RawGuildRole {
  id: string;
  name: string;
  color: number;
  colors?: { primary_color: number; secondary_color: number | null; tertiary_color: number | null };
  hoist: boolean;
  icon?: string | null;
  unicode_emoji?: string | null;
  position: number;
  permissions: string;
  managed: boolean;
  mentionable: boolean;
}

export interface RawGuildMember {
  user?: RawDiscordUser;
  nick?: string | null;
  avatar?: string | null;
  roles: string[];
  joined_at: string;
  premium_since?: string | null;
  pending?: boolean;
  communication_disabled_until?: string | null;
}

/** All roles for a guild. Bot token only — no privileged intent needed. */
export async function fetchGuildRoles(env: Env, guildId: string): Promise<RawGuildRole[] | null> {
  const res = await fetch(`${apiBase(env)}/guilds/${guildId}/roles`, {
    headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` },
  });
  if (!res.ok) return null;
  return (await res.json()) as RawGuildRole[];
}

/** One guild member. Bot token only — no privileged intent needed. */
export async function fetchGuildMember(env: Env, guildId: string, userId: string): Promise<RawGuildMember | null> {
  const res = await fetch(`${apiBase(env)}/guilds/${guildId}/members/${userId}`, {
    headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` },
  });
  if (!res.ok) return null;
  return (await res.json()) as RawGuildMember;
}

export interface RawGuildBasic {
  id: string;
  name: string;
  icon: string | null;
}

/** Minimal guild info (name + icon) via bot token; cache-friendly. null on fail. */
export async function fetchGuildBasic(env: Env, guildId: string): Promise<RawGuildBasic | null> {
  const res = await fetch(`${apiBase(env)}/guilds/${guildId}`, {
    headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` },
  });
  if (!res.ok) return null;
  return (await res.json()) as RawGuildBasic;
}

export interface RawInviteResponse {
  code: string;
  expires_at?: string | null;
  approximate_member_count?: number;
  approximate_presence_count?: number;
  guild?: {
    id: string;
    name: string;
    icon: string | null;
    splash?: string | null;
    banner?: string | null;
    description?: string | null;
    verification_level?: number;
    vanity_url_code?: string | null;
    nsfw_level?: number;
    premium_subscription_count?: number;
    features?: string[];
  };
  channel?: { id: string; name: string; type: number };
}

/** Resolve a server invite code to guild info. Returns null on 404/failure. */
export async function fetchInvite(env: Env, code: string): Promise<RawInviteResponse | null> {
  const url =
    `${apiBase(env)}/invites/${encodeURIComponent(code)}` +
    `?with_counts=true&with_expiration=true`;
  // Bot token gives slightly better rate limits than an unauthenticated call;
  // falls back to unauthenticated if no bot token configured.
  const headers: Record<string, string> = {};
  if (env.DISCORD_BOT_TOKEN) headers.Authorization = `Bot ${env.DISCORD_BOT_TOKEN}`;
  const res = await fetch(url, { headers });
  if (!res.ok) return null;
  return (await res.json()) as RawInviteResponse;
}