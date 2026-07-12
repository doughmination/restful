/**
 * Copyright (c) 2026 Clove Twilight
 * Licensed under the ESAL-2.0 Licence.
 * See LICENCE.md in the project root for full licence information.
 */

import { Hono } from "hono";

import type { Env } from "../hono";
import { getFronters, setFront, getMembers } from "../services/pluralkit";
import { enrichMembersWithTags } from "../services/tags";
import { enrichMembersWithStatus } from "../services/status";
import { requireAuth } from "../middleware/auth";
import { broadcastFrontingUpdate } from "../ws";
import { HttpError } from "../errors";

export const frontingRoutes = new Hono<Env>();

frontingRoutes.get("/fronters", async (c) => {
  try {
    const frontersData = await getFronters();
    if ("members" in frontersData) {
      const withTags = await enrichMembersWithTags(frontersData.members);
      frontersData.members = await enrichMembersWithStatus(withTags);
    }
    return c.json(frontersData);
  } catch (err) {
    throw new HttpError(500, `Failed to fetch fronters: ${String(err)}`);
  }
});

frontingRoutes.post("/switch", requireAuth, async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { members?: unknown };
  const memberIds = body.members ?? [];
  if (!Array.isArray(memberIds)) throw new HttpError(400, "'members' must be a list of member IDs");

  try {
    await setFront(memberIds);
    broadcastFrontingUpdate(await getFronters());
    return c.json({ status: "success", message: "Front updated successfully" });
  } catch (err) {
    throw new HttpError(500, String(err));
  }
});

frontingRoutes.post("/switch_front", requireAuth, async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { member_id?: unknown };
  if (!body.member_id) throw new HttpError(400, "member_id is required");

  try {
    const result = await setFront([String(body.member_id)]);
    broadcastFrontingUpdate(await getFronters());
    return c.json({ success: true, message: "Front updated", data: result });
  } catch (err) {
    throw new HttpError(500, `Failed to switch front: ${String(err)}`);
  }
});

frontingRoutes.post("/multi_switch", requireAuth, async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { member_ids?: unknown };
  const memberIds = body.member_ids ?? [];
  if (!Array.isArray(memberIds)) throw new HttpError(400, "'member_ids' must be a list");

  try {
    const allMembers = await getMembers();
    const switchingMembers: Array<{ id: unknown; name: unknown; display_name: unknown }> = [];
    for (const memberId of memberIds) {
      const member = allMembers.find((m) => m.id === memberId);
      if (member) {
        switchingMembers.push({
          id: member.id,
          name: member.name,
          display_name: member.display_name ?? member.name,
        });
      }
    }

    await setFront(memberIds);
    broadcastFrontingUpdate(await getFronters());

    return c.json({
      status: "success",
      message: "Fronters updated successfully",
      fronters: switchingMembers,
      count: switchingMembers.length,
    });
  } catch (err) {
    throw new HttpError(500, String(err));
  }
});
