/* =====================================================================
 * index.ts — Worker entry: HTTP router + cron keepalive.
 *
 * Routes
 *   GET  /                            service info
 *   GET  /v1/users?ids=a,b,c          batch unified (up to 100 ids, one call)
 *   GET  /v1/users/:id                unified (presence + profile + badges)
 *   GET  /v1/users/:id/presence       presence only
 *   GET  /v1/users/:id/profile        profile + badges only
 *   GET  /socket                      WebSocket (Lanyard protocol)
 *
 * The Durable Object is a singleton ("gateway") holding the Discord socket.
 * ===================================================================== */

import type { ApiEnvelope, Env, UnifiedPresence, UnifiedRecord, UnifiedGuildInvite, UnifiedGirlsRole, UnifiedGirlsMember } from "./types";
import { getProfile } from "./profile";
import { GatewayManager } from "./gateway";
import { getGuildInvite } from "./guild";
import { getGirlsResource, isGirlsIdType } from "./girls";

export { GatewayManager };

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json<T>(body: ApiEnvelope<T>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS },
  });
}

function gatewayStub(env: Env): DurableObjectStub {
  return env.GATEWAY.get(env.GATEWAY.idFromName("gateway"));
}

async function fetchPresence(env: Env, id: string): Promise<UnifiedPresence | null> {
  const res = await gatewayStub(env).fetch(`https://do/presence/${id}`);
  if (!res.ok) return null;
  const body = (await res.json()) as { monitored: boolean; presence: UnifiedPresence | null };
  return body.presence;
}

/** Every monitored presence in one Durable Object round-trip (used by the
 *  batch endpoint so N users cost one DO call instead of N). */
async function fetchAllPresences(env: Env): Promise<Record<string, UnifiedPresence>> {
  const res = await gatewayStub(env).fetch("https://do/presences");
  if (!res.ok) return {};
  return (await res.json()) as Record<string, UnifiedPresence>;
}

/** Assemble the unified record shape shared by the single + batch routes. */
function buildRecord(
  profile: NonNullable<Awaited<ReturnType<typeof getProfile>>>,
  presence: UnifiedPresence | null
): UnifiedRecord {
  return {
    user: profile.user,
    presence,
    badges: profile.badges,
    clientBadges: profile.clientBadges,
    connected_accounts: profile.connected_accounts,
    wishlist: profile.wishlist ?? null,
    updated_at: Date.now(),
    source: { presence: presence ? "gateway" : "none", profile: profile.source },
  };
}

const ID_RE = /^\d{16,21}$/;

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    // ---- WebSocket ----
    if (path === "/socket" || path === "/ws") {
      return gatewayStub(env).fetch(new Request("https://do/ws", req));
    }

    // ---- Gateway status (debug) ----
    if (path === "/status") {
      const res = await gatewayStub(env).fetch("https://do/status");
      const body = await res.json();
      return json({ success: true, data: body as any });
    }

    if (path === "/") {
      return json({
        success: true,
        data: {
          service: "Doughmination Restful",
          description: "Combined Discord presence + profile/badges API.",
          licence: "ESAL-2.0",
          repository_url: "https://github.com/doughmination/restful",
          main_endpoint: "/v1/users/:id",
          websocket: "/socket",
          healthcheck: "/status",
          other_endpoints: [
            "/v1/users?ids=a,b,c (batch, up to 100)",
            "/v1/users/:id/presence",
            "/v1/users/:id/profile",
            "/v1/guilds/:serverInvite",
            "/v1/girls/:idType/:id (idType: role | member)",
          ],
        },
        authors: {
          doughmination: "https://codeberg.org/clove",
        },
      } as any);
    }

    // ---- /v1/guilds/:serverInvite ----
    const gm = path.match(/^\/v1\/guilds\/([\w-]+)$/);
    if (gm) {
      const inviteCode = gm[1];
      const force =
        url.searchParams.has("fresh") ||
        url.searchParams.has("nocache") ||
        url.searchParams.has("refresh");

      const invite = await getGuildInvite(env, inviteCode, ctx, force);
      if (!invite) {
        return json({ success: false, error: { code: "not_found", message: "Invalid or expired invite." } }, 404);
      }
      return json<UnifiedGuildInvite>({ success: true, data: invite });
    }

    // ---- /v1/girls/:idType/:id ----
    const gr = path.match(/^\/v1\/girls\/([\w-]+)\/(\d{1,32})$/);
    if (gr) {
      const [, idType, id] = gr;
      if (!isGirlsIdType(idType)) {
        return json(
          { success: false, error: { code: "invalid_id_type", message: "idType must be one of: role, member." } },
          400
        );
      }

      const force =
        url.searchParams.has("fresh") ||
        url.searchParams.has("nocache") ||
        url.searchParams.has("refresh");

      try {
        const resource = await getGirlsResource(env, idType, id, ctx, force);
        if (!resource) {
          return json({ success: false, error: { code: "not_found", message: `No ${idType} with that id.` } }, 404);
        }
        return json<UnifiedGirlsRole | UnifiedGirlsMember>({ success: true, data: resource });
      } catch (err) {
        return json(
          { success: false, error: { code: "misconfigured", message: (err as Error).message } },
          500
        );
      }
    }

    // ---- /v1/users?ids=a,b,c  (batch: many users in one round-trip) ----
    if (path === "/v1/users") {
      const ids = Array.from(
        new Set((url.searchParams.get("ids") || "").split(",").map((s) => s.trim()).filter(Boolean))
      );
      if (!ids.length) {
        return json({ success: false, error: { code: "missing_ids", message: "Provide ?ids=comma,separated,snowflakes." } }, 400);
      }
      if (ids.length > 100) {
        return json({ success: false, error: { code: "too_many_ids", message: "Maximum 100 ids per request." } }, 400);
      }
      const bad = ids.find((id) => !ID_RE.test(id));
      if (bad) {
        return json({ success: false, error: { code: "invalid_id", message: `Not a Discord snowflake: ${bad}` } }, 400);
      }

      const force =
        url.searchParams.has("fresh") ||
        url.searchParams.has("nocache") ||
        url.searchParams.has("refresh");

      // One DO call for all presences; profiles fetched in parallel (each cached
      // in KV). A user with no profile → null entry, mirroring the single route.
      const [presences, profiles] = await Promise.all([
        fetchAllPresences(env),
        Promise.all(ids.map((id) => getProfile(env, id, ctx, force).catch(() => null))),
      ]);

      const data: Record<string, UnifiedRecord | null> = {};
      ids.forEach((id, i) => {
        const profile = profiles[i];
        data[id] = profile ? buildRecord(profile, presences[id] ?? null) : null;
      });

      return json<Record<string, UnifiedRecord | null>>({ success: true, data });
    }

    // ---- /v1/users/:id[/presence|/profile] ----
    const m = path.match(/^\/v1\/users\/(\d{1,32})(?:\/(presence|profile))?$/);
    if (m) {
      const id = m[1];
      const sub = m[2];
      if (!ID_RE.test(id)) {
        return json({ success: false, error: { code: "invalid_id", message: "Not a Discord snowflake." } }, 400);
      }

      // Debug/ops escape hatch: ?fresh=1 (or nocache / refresh) bypasses the
      // profile + per-SKU caches and forces a live re-fetch + re-resolve.
      const force =
        url.searchParams.has("fresh") ||
        url.searchParams.has("nocache") ||
        url.searchParams.has("refresh");

      if (sub === "presence") {
        const presence = await fetchPresence(env, id);
        if (!presence) {
          return json({ success: false, error: { code: "not_monitored", message: "User shares no monitored guild with the bot." } }, 404);
        }
        return json<UnifiedPresence>({ success: true, data: presence });
      }

      if (sub === "profile") {
        const profile = await getProfile(env, id, ctx, force);
        if (!profile) {
          return json({ success: false, error: { code: "not_found", message: "User not found." } }, 404);
        }
        return json({ success: true, data: profile as any });
      }

      // Unified record: profile (REST) + presence (gateway), in parallel.
      const [profile, presence] = await Promise.all([getProfile(env, id, ctx, force), fetchPresence(env, id)]);
      if (!profile) {
        return json({ success: false, error: { code: "not_found", message: "User not found." } }, 404);
      }
      return json<UnifiedRecord>({ success: true, data: buildRecord(profile, presence) });
    }

    return json({ success: false, error: { code: "not_found", message: "Unknown route." } }, 404);
  },

  // Cron keepalive — make sure the gateway DO is connected.
  async scheduled(_event: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    await gatewayStub(env).fetch("https://do/connect");
  },
};