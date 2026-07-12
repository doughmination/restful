/**
 * Copyright (c) 2026 Clove Twilight
 * Licensed under the ESAL-2.0 Licence.
 * See LICENCE.md in the project root for full licence information.
 */

/**
 * Discord bot API. The token is now set manually (DOUGH_BOT_TOKEN secret),
 * so the two regenerate endpoints no longer mint tokens — they return 410
 * pointing at the secret. Everything else is a straight port.
 */

import { Hono } from "hono";

import type { Env } from "../hono";
import { getSystem, getMembers, getFronters, setFront } from "../services/pluralkit";
import { enrichMembersWithTags } from "../services/tags";
import { enrichMembersWithStatus } from "../services/status";
import { requireAuth, requireOwner, verifyBotAccess } from "../middleware/auth";
import { HttpError } from "../errors";
import { MultiSwitchRequestSchema } from "../models";

export const botRoutes = new Hono<Env>();

// ---- Health & token management --------------------------------------------

botRoutes.get("/bot/health", verifyBotAccess, (c) =>
  c.json({ status: "ok", message: "Bot API is operational", authenticated: true }),
);

const TOKEN_MANAGED_MSG =
  "Bot token is now set manually via the DOUGH_BOT_TOKEN secret; rotate it with `wrangler secret put DOUGH_BOT_TOKEN`.";

botRoutes.post("/bot/token/regenerate", requireAuth, requireOwner, () => {
  throw new HttpError(410, TOKEN_MANAGED_MSG);
});

botRoutes.post("/bot/token/regenerate-self", verifyBotAccess, () => {
  throw new HttpError(410, TOKEN_MANAGED_MSG);
});

// ---- System info ----------------------------------------------------------

botRoutes.get("/bot/system/info", verifyBotAccess, async (c) => {
  try {
    return c.json({ success: true, data: await getSystem() });
  } catch (err) {
    throw new HttpError(500, `Failed to fetch system info: ${String(err)}`);
  }
});

botRoutes.get("/bot/members", verifyBotAccess, async (c) => {
  try {
    const withTags = await enrichMembersWithTags(await getMembers());
    const withStatus = await enrichMembersWithStatus(withTags);
    return c.json({ success: true, data: withStatus });
  } catch (err) {
    throw new HttpError(500, `Failed to fetch members: ${String(err)}`);
  }
});

botRoutes.get("/bot/fronters", verifyBotAccess, async (c) => {
  try {
    return c.json({ success: true, data: await getFronters() });
  } catch (err) {
    throw new HttpError(500, `Failed to fetch fronters: ${String(err)}`);
  }
});

// ---- Fronting control -----------------------------------------------------

botRoutes.post("/bot/switch", verifyBotAccess, async (c) => {
  const parsed = MultiSwitchRequestSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ detail: parsed.error.issues }, 422);
  const { member_ids } = parsed.data;

  try {
    const allMembers = await getMembers();
    const validIds = new Set(allMembers.map((m) => m.id));
    const invalidIds = member_ids.filter((mid) => !validIds.has(mid));
    if (invalidIds.length > 0) {
      throw new HttpError(400, `Invalid member IDs: ${invalidIds.join(", ")}`);
    }

    await setFront(member_ids);
    const updatedFronters = await getFronters();

    return c.json({
      status: "success",
      message: "Fronters updated successfully",
      fronters: updatedFronters.members ?? [],
      count: member_ids.length,
    });
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(500, `Failed to switch fronters: ${String(err)}`);
  }
});
