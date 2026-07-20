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
    /** Profile-scoped collectibles blob — this is where `profile_frame`
     *  lives (nameplates sit on `user.collectibles` instead). */
    collectibles?: Record<string, unknown> | null;
  };
  badges?: RawProfileBadge[];
  connected_accounts?: Array<{ type: string; id: string; name: string; verified: boolean }>;
  premium_type?: number;
  premium_since?: string | null;
  premium_guild_since?: string | null;
  legacy_username?: string | null;
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

/** Configured user tokens, in slot order, skipping blanks. */
function userTokens(env: Env): string[] {
  return [env.DISCORD_USER_TOKEN, env.DISCORD_USER_TOKEN2, env.DISCORD_USER_TOKEN3].filter(
    (t): t is string => !!t && t.trim().length > 0
  );
}

/* ---- dead-token quarantine ---------------------------------------------
 * A user token dies for good (password change, "log out all devices", or
 * Discord flagging the automation) — unlike a 429 it will never recover. Before
 * this, a 401 aborted the whole attempt, so one dead token in slot 1 meant every
 * request burned a call on it and then fell back to bot-tier profiles, even with
 * healthy tokens sitting in slots 2 and 3.
 *
 * Dead tokens are recorded in one KV key and skipped until the entry lapses.
 * The entry is keyed by a HASH OF THE TOKEN VALUE, not its slot index — so
 * dropping a fresh token into DISCORD_USER_TOKEN is picked up immediately
 * rather than inheriting the old one's quarantine.
 */

const DEAD_TOKENS_KEY = "profile:dead-tokens";
/** How long a token stays quarantined. Long, because 401s don't self-heal;
 *  it re-tests occasionally in case the token was reinstated. */
const DEAD_TTL_MS = 6 * 60 * 60 * 1000;

type DeadMap = Record<string, number>;

/** Short stable id for a token — never log or store the token itself. */
async function tokenId(token: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(buf).slice(0, 8)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function readDeadMap(env: Env): Promise<DeadMap> {
  try {
    const raw = await env.PROFILE_CACHE.get(DEAD_TOKENS_KEY);
    if (!raw) return {};
    const map = JSON.parse(raw) as DeadMap;
    const now = Date.now();
    // Drop lapsed entries on read so the key self-cleans.
    return Object.fromEntries(Object.entries(map).filter(([, exp]) => exp > now));
  } catch {
    return {}; // KV unavailable / corrupt → behave as if nothing is quarantined
  }
}

/** Quarantine a token after an unambiguous 401. */
async function markTokenDead(env: Env, token: string, label: string): Promise<void> {
  try {
    const id = await tokenId(token);
    const map = await readDeadMap(env);
    if (map[id] && map[id] > Date.now()) return; // already quarantined
    map[id] = Date.now() + DEAD_TTL_MS;
    await env.PROFILE_CACHE.put(DEAD_TOKENS_KEY, JSON.stringify(map), {
      expirationTtl: Math.ceil(DEAD_TTL_MS / 1000) + 60,
    });
    console.error(
      `[dough-api] user token ${label} (${id}) returned 401 — quarantined for ` +
        `${DEAD_TTL_MS / 3600000}h. Rotate the secret to restore rich profiles.`
    );
  } catch {
    /* quarantine is an optimisation; never fail the request over it */
  }
}

export interface LiveToken {
  token: string;
  /** Human label for logs, e.g. "#2" — matches the DISCORD_USER_TOKEN slot. */
  label: string;
}

/**
 * Configured tokens minus any currently quarantined, in a rotated order so load
 * spreads across them. Logs loudly when there's nothing usable, because that
 * silently degrades every profile to bot-tier (no bio, no connected accounts).
 */
async function liveTokens(env: Env): Promise<LiveToken[]> {
  const all = userTokens(env);
  if (all.length === 0) {
    console.error(
      "[dough-api] no DISCORD_USER_TOKEN configured — profiles will be bot-tier " +
        "(no bio, no connected_accounts, no wishlist). Set the secret to enable rich profiles."
    );
    return [];
  }

  const dead = await readDeadMap(env);
  const ids = await Promise.all(all.map(tokenId));
  const live: LiveToken[] = [];
  for (let i = 0; i < all.length; i++) {
    if (dead[ids[i]] && dead[ids[i]] > Date.now()) continue;
    live.push({ token: all[i], label: `#${i + 1}` });
  }

  if (live.length === 0) {
    console.error(
      `[dough-api] all ${all.length} user token(s) are quarantined as dead — ` +
        "profiles are bot-tier until a working token is set."
    );
    return [];
  }

  // Spread load: rotate the starting point rather than always hitting slot 1.
  const start = Math.floor(Math.random() * live.length);
  return live.slice(start).concat(live.slice(0, start));
}

/**
 * Rich profile via USER token(s) (self-bot — ToS risk). Load is spread across
 * the configured tokens, and both a 429 (rate limited) and a 401 (token dead)
 * fail over to the next one; a 401 additionally quarantines that token so it
 * isn't retried on every subsequent request. Reports the HTTP status so callers
 * can tell a 429 (back off) from a token problem.
 */
export async function fetchUserProfile(env: Env, id: string): Promise<UserProfileFetch> {
  const tokens = await liveTokens(env);
  if (tokens.length === 0) return { data: null, status: 0, retryAfter: 0 };

  // We don't surface mutuals, so don't ask for them (skips the extra guild
  // name/icon resolution work they'd otherwise trigger downstream).
  const url =
    `${apiBase(env)}/users/${id}/profile` +
    `?with_mutual_guilds=false&with_mutual_friends=false&with_mutual_friends_count=false`;

  let lastStatus = 0;
  let lastRetryAfter = 0;

  for (const { token, label } of tokens) {
    const res = await fetch(url, { headers: clientHeaders(env, token) });
    if (res.ok) {
      return { data: (await res.json()) as RawProfileResponse, status: 200, retryAfter: 0 };
    }
    lastStatus = res.status;
    lastRetryAfter = Number(res.headers.get("retry-after")) || 0;
    console.warn(
      `[dough-api] user-token ${label} /users/${id}/profile -> HTTP ${res.status}` +
        (lastRetryAfter ? ` (retry ${lastRetryAfter}s)` : "")
    );

    // 401 → this token is dead: quarantine it and try the next one.
    if (res.status === 401) {
      await markTokenDead(env, token, label);
      continue;
    }
    // 429 → this token is throttled but fine: try the next one.
    if (res.status === 429) continue;
    // 403/404/5xx are about the request or Discord, not the token — another
    // token would answer identically, so stop here.
    break;
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
  const tokens = await liveTokens(env);
  let lastStatus = 0;

  for (const ver of versions) {
    const url = `https://discord.com/api/v${ver}/wishlists/${wishlistId}`;
    for (const { token, label } of tokens) {
      const r = await tryJson(url, clientHeaders(env, token), `wishlist ${wishlistId} v${ver} user${label}`);
      if (r.raw) return r;
      lastStatus = r.status;
      // A dead token shouldn't burn a request here on every future call either.
      if (r.status === 401) {
        await markTokenDead(env, token, label);
        continue;
      }
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
  const tokens = await liveTokens(env);
  const locale = "en-GB";

  for (const ver of versions) {
    const url =
      `https://discord.com/api/v${ver}/collectibles-products/${skuId}` +
      `?locale=${locale}`;
    for (const { token, label } of tokens) {
      const r = await tryJson(url, clientHeaders(env, token), `collectible ${skuId} v${ver} user${label}`);
      if (r.raw) return r.raw as RawCollectibleProduct;
      if (r.status === 401) {
        await markTokenDead(env, token, label);
        continue;
      }
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