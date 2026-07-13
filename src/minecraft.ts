/* =====================================================================
 * minecraft.ts — resolve a Minecraft UUID -> profile / Hypixel stats.
 *
 * Split into two endpoints so callers only pay for what they use:
 *   /v2/minecraft/general/:uuid  -> Mojang name + skin/cape textures.
 *   /v2/minecraft/hypixel/:uuid  -> raw Hypixel player + SkyBlock profiles.
 *
 * Hypixel needs an API key (HYPIXEL_API_KEY, sent as the `API-Key` header);
 * without it the Hypixel sections come back null with source "unavailable".
 * Both endpoints are cache-first (~5 min) since the upstreams drift slowly
 * and would rather not be hammered.
 * ===================================================================== */

import type {
  Env,
  MinecraftSourceState,
  UnifiedCape,
  UnifiedMinecraftGeneral,
  UnifiedMinecraftHypixel,
  VanillaCapeList,
  VanillaCapeRegistry,
} from "./types";

const MOJANG_PROFILE = "https://sessionserver.mojang.com/session/minecraft/profile";
const HYPIXEL_BASE = "https://api.hypixel.net/v2";
const CRAFTHEAD = "https://crafthead.net";
const MCHEADS = "https://mc-heads.net";
const CAPES_API = "https://api.capes.dev/load";
const TTL_SECONDS = 300;
const USER_AGENT = "doughmination-restful/2.0 (+https://doughmination.uk)";

/**
 * Profile sources tried in order. Mojang's own sessionserver 403-blocks
 * Cloudflare Workers egress IPs outright, so we lead with crafthead.net — it
 * mirrors Mojang and returns the identical { id, name, properties[textures] }
 * shape — and keep Mojang as a fallback for whenever the mirror is down.
 */
const PROFILE_SOURCES: Array<(short: string) => string> = [
  (short) => `${CRAFTHEAD}/profile/${short}`,
  (short) => `${MOJANG_PROFILE}/${short}`,
];

/**
 * Thrown when *every* profile source answered with something other than "here's
 * the profile" or "no such profile" — e.g. a 403 block, 429 rate-limit, 5xx, or
 * a network blip. The caller must NOT turn this into a 404: the account may well
 * exist, the upstreams just wouldn't tell us. Let the route surface a 502.
 */
export class MojangUpstreamError extends Error {
  constructor(readonly status: number) {
    super(`Minecraft profile upstream returned ${status || "a network error"}`);
    this.name = "MojangUpstreamError";
  }
}

/**
 * Resolve a Mojang profile via the source list. Returns null only when a source
 * gives a *definitive* not-found (204/404); a blocked/errored source is skipped
 * so the next one gets a shot. Throws MojangUpstreamError if none succeed.
 */
async function fetchMojangProfile(short: string): Promise<MojangProfileResponse | null> {
  let lastStatus = 0;
  for (const build of PROFILE_SOURCES) {
    let res: Response;
    try {
      res = await fetch(build(short), {
        headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      });
    } catch {
      lastStatus = 0;
      continue; // network failure — try the next source
    }
    // A definitive "no such account" from any mirror is trustworthy.
    if (res.status === 204 || res.status === 404) return null;
    // 403 block / 429 / 5xx — this source won't answer; fall through to next.
    if (!res.ok) {
      lastStatus = res.status;
      continue;
    }
    try {
      return (await res.json()) as MojangProfileResponse;
    } catch {
      lastStatus = res.status;
      continue; // ok status but empty/garbled body — try next source
    }
  }
  throw new MojangUpstreamError(lastStatus);
}

/** Strip dashes and lowercase — the form Mojang/Hypixel expect in URLs. */
function undash(uuid: string): string {
  return uuid.replace(/-/g, "").toLowerCase();
}

/** Mojang hands back texture URLs as plain http://textures.minecraft.net/...
 *  The host serves the same bytes over https, so upgrade the scheme to keep
 *  our output uniform (and dodge mixed-content blocking on https callers). */
function httpsify(u: string | null): string | null {
  return u ? u.replace(/^http:\/\//i, "https://") : u;
}

/** Insert dashes into a 32-char hex uuid -> canonical 8-4-4-4-12 form. */
function dash(short: string): string {
  return `${short.slice(0, 8)}-${short.slice(8, 12)}-${short.slice(12, 16)}-${short.slice(16, 20)}-${short.slice(20)}`;
}

/**
 * Accept any of the three UUID spellings Minecraft tooling emits and return the
 * canonical 32-char lowercase hex (dashless), or null if it isn't a UUID:
 *   - dashed:    d20b556a-e2cc-452d-ab72-6ae082d439af
 *   - undashed:  d20b556ae2cc452dab726ae082d439af
 *   - NBT int[]: [I;-771009174,-489929427,-1418564896,-2100020817]
 * The NBT form (as stored in player .dat / seen on NameMC) is the 128-bit UUID
 * as four signed 32-bit ints, big-endian; each becomes 8 hex chars once read
 * back unsigned. Whitespace is tolerated inside the array.
 */
export function normalizeMcUuid(input: string): string | null {
  const s = input.trim();

  const nbt = s.match(/^\[I;\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*\]$/);
  if (nbt) {
    return nbt
      .slice(1, 5)
      .map((n) => (Number(n) >>> 0).toString(16).padStart(8, "0"))
      .join("");
  }

  const hex = undash(s);
  return /^[0-9a-f]{32}$/.test(hex) ? hex : null;
}

/** True for any of the three accepted UUID spellings (see normalizeMcUuid). */
export function isMinecraftUuid(uuid: string): boolean {
  return normalizeMcUuid(uuid) !== null;
}

const generalKey = (short: string) => `minecraft:general:${short}`;
const hypixelKey = (short: string) => `minecraft:hypixel:${short}`;
/** KV key holding the accumulated registry of vanilla cape textures we've seen. */
const VANILLA_CAPES_KEY = "minecraft:capes:vanilla";

interface MojangTexturePayload {
  textures?: {
    SKIN?: { url?: string; metadata?: { model?: string } };
    CAPE?: { url?: string };
  };
}

interface MojangProfileResponse {
  id: string;
  name: string;
  properties?: Array<{ name: string; value: string }>;
}

/** One provider block in a capes.dev /load response. */
interface CapesDevEntry {
  type: string;
  exists: boolean;
  capeUrl?: string | null;
}

const DOUGH_BASE_URL = "https://doughmination.uk";

/**
 * Custom "doughmination" cape for hand-picked accounts. A cape is enabled simply
 * by dropping a PNG at assets/capes/<uuid>.png (undashed or dashed) — this checks
 * the ASSETS binding for its existence and, if found, returns a cape entry
 * pointing at the public URL. Returns null when there's no file (or no binding).
 */
async function fetchDoughminationCape(env: Env, short: string): Promise<UnifiedCape | null> {
  if (!env.ASSETS) return null;
  const base = env.BASE_URL ?? DOUGH_BASE_URL;
  for (const id of [short, dash(short)]) {
    const url = `${base}/capes/${id}.png`;
    try {
      const res = await env.ASSETS.fetch(new Request(url, { method: "GET" }));
      if (res.ok) return { source: "doughmination", cape_url: url };
    } catch {
      /* asset lookup failed — treat as no cape */
    }
  }
  return null;
}

/**
 * List every cape a player has via capes.dev, which aggregates all the cape
 * providers (Minecraft, OptiFine, MinecraftCapes, LabyMod, 5zig, TLauncher,
 * SkinMC). Returns only the providers where a cape actually exists. Best-effort:
 * any failure yields [] so the general endpoint still succeeds without capes.
 */
async function fetchCapes(short: string): Promise<UnifiedCape[]> {
  try {
    const res = await fetch(`${CAPES_API}/${short}`, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    });
    if (!res.ok) return [];
    const body = (await res.json()) as Record<string, CapesDevEntry>;
    return Object.values(body)
      .filter((c) => c && c.exists)
      .map((c) => ({
        source: c.type,
        cape_url: c.capeUrl ?? null,
      }));
  } catch {
    return [];
  }
}

/** Pull the stable texture hash out of a textures.minecraft.net cape URL. */
function capeTextureHash(url: string | null): string | null {
  return url?.match(/\/texture\/([0-9a-f]+)/i)?.[1]?.toLowerCase() ?? null;
}

/**
 * Add a vanilla (Mojang) cape to the shared registry the first time we see it,
 * so /v2/minecraft/capes builds up a catalogue of every vanilla cape that has
 * passed through the API. Keyed by texture hash. Best-effort and fire-and-forget:
 * it reads-modifies-writes a single KV entry, so under heavy concurrency an
 * occasional new cape could be missed — acceptable for a slowly-growing list.
 */
function recordVanillaCape(env: Env, capeUrl: string | null, ctx?: ExecutionContext): void {
  const hash = capeTextureHash(capeUrl);
  if (!hash || !capeUrl) return;
  const work = (async () => {
    try {
      const reg =
        ((await env.PROFILE_CACHE.get(VANILLA_CAPES_KEY, "json")) as VanillaCapeRegistry | null) ?? {};
      if (reg[hash]) return; // already catalogued
      reg[hash] = { hash, url: capeUrl, first_seen: Date.now() };
      await env.PROFILE_CACHE.put(VANILLA_CAPES_KEY, JSON.stringify(reg));
    } catch {
      /* registry write failed — non-fatal */
    }
  })();
  if (ctx) ctx.waitUntil(work);
}

/** The accumulated vanilla-cape catalogue, newest first. */
export async function getVanillaCapeList(env: Env): Promise<VanillaCapeList> {
  const reg = ((await env.PROFILE_CACHE.get(VANILLA_CAPES_KEY, "json")) as VanillaCapeRegistry | null) ?? {};
  const capes = Object.values(reg).sort((a, b) => b.first_seen - a.first_seen);
  return { count: capes.length, capes };
}

/** Fetch a Hypixel v2 endpoint and unwrap { success, <key> }.
 *  Returns [value, state] where state explains a null value. */
async function fetchHypixel<T>(
  env: Env,
  path: string,
  key: string,
): Promise<[T | null, MinecraftSourceState]> {
  const apiKey = env.HYPIXEL_API_KEY;
  if (!apiKey) return [null, "unavailable"];
  try {
    const res = await fetch(`${HYPIXEL_BASE}${path}`, {
      headers: { "API-Key": apiKey, Accept: "application/json" },
    });
    if (!res.ok) return [null, "error"];
    const body = (await res.json()) as Record<string, unknown> & { success?: boolean };
    if (!body.success) return [null, "error"];
    const value = body[key] as T | null | undefined;
    // Hypixel returns success:true with player:null for accounts that never
    // logged in — treat that as not_found rather than an error.
    if (value === null || value === undefined) return [null, "not_found"];
    return [value, "ok"];
  } catch {
    return [null, "error"];
  }
}

/**
 * Mojang identity + skin/cape for a UUID. Cache-first (~5 min). Returns null
 * only when the UUID doesn't map to a Mojang account (so the caller can 404).
 */
export async function getMinecraftGeneral(
  env: Env,
  uuid: string,
  ctx?: ExecutionContext,
  force = false,
): Promise<UnifiedMinecraftGeneral | null> {
  const short = undash(uuid);

  if (!force) {
    const cached = (await env.PROFILE_CACHE.get(generalKey(short), "json")) as UnifiedMinecraftGeneral | null;
    if (cached) return cached;
  }

  let name: string | null = null;
  let skin_url: string | null = null;
  let cape_url: string | null = null;
  let skin_model: "classic" | "slim" | null = null;

  // Profile resolution, cape aggregation, and the custom doughmination cape are
  // independent upstreams, so fire them together. fetchMojangProfile throws
  // MojangUpstreamError if every source is blocked/errored, and returns null
  // only on a definitive not-found.
  const [data, providerCapes, doughCape] = await Promise.all([
    fetchMojangProfile(short),
    fetchCapes(short),
    fetchDoughminationCape(env, short),
  ]);
  if (!data) return null;

  name = data.name ?? null;
  const texturesB64 = data.properties?.find((p) => p.name === "textures")?.value;
  if (texturesB64) {
    try {
      const decoded = JSON.parse(atob(texturesB64)) as MojangTexturePayload;
      skin_url = httpsify(decoded.textures?.SKIN?.url ?? null);
      cape_url = httpsify(decoded.textures?.CAPE?.url ?? null);
      if (skin_url) skin_model = decoded.textures?.SKIN?.metadata?.model === "slim" ? "slim" : "classic";
    } catch {
      /* malformed texture blob — leave nulls */
    }
  }

  // Every vanilla cape we see contributes to the shared registry, so the list at
  // /v2/minecraft/capes fills in over time. Best-effort, off the response path.
  recordVanillaCape(env, cape_url, ctx);

  const capes = doughCape ? [...providerCapes, doughCape] : providerCapes;

  const result: UnifiedMinecraftGeneral = {
    uuid: dash(short),
    uuid_short: short,
    name,
    skin_url,
    skin_model,
    cape_url,
    capes,
    // mc-heads renders the overlay (hat/jacket/second layer) by default, so the
    // base URLs include the outer layer; the `_flat` variants append `/nohelm`
    // to drop it and show the inner skin only. `face` is the 2D head, `head`
    // the isometric 3D head, `body` the isometric 3D full body, `player` the
    // flat front-facing full body, `combo` a face+body composite, and `skin`
    // the raw texture PNG.
    render: {
      face: `${MCHEADS}/avatar/${short}`,
      face_flat: `${MCHEADS}/avatar/${short}/nohelm`,
      head: `${MCHEADS}/head/${short}`,
      head_flat: `${MCHEADS}/head/${short}/nohelm`,
      body: `${MCHEADS}/body/${short}`,
      body_flat: `${MCHEADS}/body/${short}/nohelm`,
      player: `${MCHEADS}/player/${short}`,
      player_flat: `${MCHEADS}/player/${short}/nohelm`,
      combo: `${MCHEADS}/combo/${short}`,
      skin: `${MCHEADS}/skin/${short}`,
    },
    updated_at: Date.now(),
  };

  const write = env.PROFILE_CACHE.put(generalKey(short), JSON.stringify(result), {
    expirationTtl: TTL_SECONDS,
  });
  if (ctx) ctx.waitUntil(write);
  else await write;

  return result;
}

/**
 * Raw Hypixel player object + SkyBlock profiles for a UUID. Cache-first
 * (~5 min). Never returns null: Hypixel gaps degrade gracefully via `source`
 * (unavailable / not_found / error), so the caller gets a 200 either way.
 */
export async function getMinecraftHypixel(
  env: Env,
  uuid: string,
  ctx?: ExecutionContext,
  force = false,
): Promise<UnifiedMinecraftHypixel> {
  const short = undash(uuid);

  if (!force) {
    const cached = (await env.PROFILE_CACHE.get(hypixelKey(short), "json")) as UnifiedMinecraftHypixel | null;
    if (cached) return cached;
  }

  const [[player, playerState], [skyblock, skyblockState]] = await Promise.all([
    fetchHypixel<Record<string, unknown>>(env, `/player?uuid=${short}`, "player"),
    fetchHypixel<unknown[]>(env, `/skyblock/profiles?uuid=${short}`, "profiles"),
  ]);

  const result: UnifiedMinecraftHypixel = {
    uuid: dash(short),
    name: (player?.displayname as string | undefined) ?? null,
    player,
    skyblock,
    updated_at: Date.now(),
    source: { player: playerState, skyblock: skyblockState },
  };

  const write = env.PROFILE_CACHE.put(hypixelKey(short), JSON.stringify(result), {
    expirationTtl: TTL_SECONDS,
  });
  if (ctx) ctx.waitUntil(write);
  else await write;

  return result;
}
