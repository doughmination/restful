/**
 * Copyright (c) 2026 Clove Twilight
 * Licensed under the ESAL-2.0 Licence.
 * See LICENCE.md in the project root for full licence information.
 */

import { Hono } from "hono";

import type { Env } from "../hono";
import { getMemberStatus, setMemberStatus, clearMemberStatus } from "../services/status";
import { requireAuth, requireAdmin } from "../middleware/auth";
import { HttpError } from "../errors";

export const memberStatusRoutes = new Hono<Env>();

/** Public: get a member's status. */
memberStatusRoutes.get("/members/:member_identifier/status", async (c) => {
  try {
    const memberIdentifier = c.req.param("member_identifier") ?? "";
    const status = await getMemberStatus(memberIdentifier);
    return c.json({ success: true, member_identifier: memberIdentifier, status });
  } catch (err) {
    throw new HttpError(500, `Failed to fetch member status: ${String(err)}`);
  }
});

/** Admin: set/update a member's status. */
memberStatusRoutes.post("/members/:member_identifier/status", requireAuth, requireAdmin, async (c) => {
  const memberIdentifier = c.req.param("member_identifier") ?? "";
  const body = (await c.req.json().catch(() => ({}))) as { text?: unknown; emoji?: unknown };
  const statusText = body.text;
  const emoji = typeof body.emoji === "string" ? body.emoji : null;

  if (!statusText) throw new HttpError(400, "Status text is required");
  if (String(statusText).length > 100) {
    throw new HttpError(400, "Status text must be 100 characters or less");
  }

  try {
    const status = await setMemberStatus(memberIdentifier, String(statusText), emoji);
    return c.json({ success: true, message: `Status updated for ${memberIdentifier}`, status });
  } catch (err) {
    throw new HttpError(500, `Failed to set member status: ${String(err)}`);
  }
});

/** Admin: clear a member's status. */
memberStatusRoutes.delete(
  "/members/:member_identifier/status",
  requireAuth,
  requireAdmin,
  async (c) => {
    try {
      const memberIdentifier = c.req.param("member_identifier") ?? "";
      const ok = await clearMemberStatus(memberIdentifier);
      return ok
        ? c.json({ success: true, message: `Status cleared for ${memberIdentifier}` })
        : c.json({ success: false, message: `No status found for ${memberIdentifier}` });
    } catch (err) {
      throw new HttpError(500, `Failed to clear member status: ${String(err)}`);
    }
  },
);
