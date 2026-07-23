/**
 * Copyright (c) 2026 Clove Twilight
 * Licensed under the ESAL-2.0 Licence.
 * See LICENCE.md in the project root for full licence information.
 */

import { Hono } from "hono";
import { z } from "zod";

import type { Env } from "../hono";
import { getMembers } from "../services/pluralkit";
import {
  getMemberTags,
  updateMemberTags,
  addMemberTag,
  removeMemberTag,
  enrichMembersWithTags,
} from "../services/tags";
import { enrichMembersWithStatus } from "../services/status";
import {
  getMemberPride,
  addMemberPride,
  removeMemberPride,
  enrichMembersWithPride,
} from "../services/pride";
import { requireAuth, requireAdmin, requireOwner } from "../middleware/auth";
import { setInCache } from "../cache";
import { HttpError } from "../errors";

export const membersRoutes = new Hono<Env>();

membersRoutes.get("/members", async (c) => {
  try {
    const membersData = await getMembers();
    const withTags = await enrichMembersWithTags(membersData);
    const withStatus = await enrichMembersWithStatus(withTags);
    const withPride = await enrichMembersWithPride(withStatus);
    return c.json(withPride);
  } catch (err) {
    throw new HttpError(500, `Failed to fetch members: ${String(err)}`);
  }
});

membersRoutes.get("/member/:member_id", async (c) => {
  try {
    const memberId = c.req.param("member_id") ?? "";
    const members = await getMembers();
    const member = members.find(
      (m) => m.id === memberId || String(m.name ?? "").toLowerCase() === memberId.toLowerCase(),
    );
    if (!member) throw new HttpError(404, "Member not found");

    const [withTags] = await enrichMembersWithTags([member]);
    const [withStatus] = await enrichMembersWithStatus([withTags]);
    const [withPride] = await enrichMembersWithPride([withStatus]);
    return c.json(withPride);
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(500, `Failed to fetch member details: ${String(err)}`);
  }
});

// ---- Member tags ----------------------------------------------------------

membersRoutes.get("/member-tags", requireAuth, requireAdmin, async (c) => {
  try {
    return c.json({ status: "success", member_tags: await getMemberTags() });
  } catch (err) {
    throw new HttpError(500, `Failed to fetch member tags: ${String(err)}`);
  }
});

membersRoutes.post("/member-tags/:member_identifier", requireAuth, requireAdmin, async (c) => {
  const parsed = z.array(z.string()).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ detail: parsed.error.issues }, 422);

  const memberIdentifier = c.req.param("member_identifier") ?? "";
  try {
    const ok = await updateMemberTags(memberIdentifier, parsed.data);
    if (!ok) throw new HttpError(500, "Failed to update member tags");
    setInCache("members_raw", null, 0);
    return c.json({
      status: "success",
      message: `Updated tags for ${memberIdentifier}`,
      tags: parsed.data,
    });
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(500, `Failed to update member tags: ${String(err)}`);
  }
});

membersRoutes.post("/member-tags/:member_identifier/add", requireAuth, requireAdmin, async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { tag?: unknown };
  const memberIdentifier = c.req.param("member_identifier") ?? "";
  if (typeof body.tag !== "string") {
    return c.json({ detail: "Body must include a 'tag' string field" }, 422);
  }
  try {
    const ok = await addMemberTag(memberIdentifier, body.tag);
    setInCache("members_raw", null, 0);
    return ok
      ? c.json({ status: "success", message: `Added tag '${body.tag}' to ${memberIdentifier}` })
      : c.json({ status: "info", message: `Tag '${body.tag}' already exists for ${memberIdentifier}` });
  } catch (err) {
    throw new HttpError(500, `Failed to add member tag: ${String(err)}`);
  }
});

membersRoutes.delete(
  "/member-tags/:member_identifier/:tag",
  requireAuth,
  requireAdmin,
  async (c) => {
    const memberIdentifier = c.req.param("member_identifier") ?? "";
    const tag = c.req.param("tag") ?? "";
    try {
      const ok = await removeMemberTag(memberIdentifier, tag);
      if (!ok) throw new HttpError(404, `Tag '${tag}' not found for ${memberIdentifier}`);
      setInCache("members_raw", null, 0);
      return c.json({ status: "success", message: `Removed tag '${tag}' from ${memberIdentifier}` });
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(500, `Failed to remove member tag: ${String(err)}`);
    }
  },
);

// ---- Member pride identities ----------------------------------------------

membersRoutes.get("/member-pride", requireAuth, requireOwner, async (c) => {
  try {
    return c.json({ status: "success", member_pride: await getMemberPride() });
  } catch (err) {
    throw new HttpError(500, `Failed to fetch member pride: ${String(err)}`);
  }
});

membersRoutes.post(
  "/member-pride/:member_identifier/add",
  requireAuth,
  requireOwner,
  async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { identity?: unknown };
    const memberIdentifier = c.req.param("member_identifier") ?? "";
    if (typeof body.identity !== "string") {
      return c.json({ detail: "Body must include an 'identity' string field" }, 422);
    }
    try {
      const added = await addMemberPride(memberIdentifier, body.identity);
      setInCache("members_raw", null, 0);
      return added
        ? c.json({
            status: "success",
            message: `Added pride '${body.identity}' to ${memberIdentifier}`,
          })
        : c.json({
            status: "info",
            message: `Pride '${body.identity}' already set for ${memberIdentifier}`,
          });
    } catch (err) {
      throw new HttpError(500, `Failed to add member pride: ${String(err)}`);
    }
  },
);

membersRoutes.delete(
  "/member-pride/:member_identifier/:identity",
  requireAuth,
  requireOwner,
  async (c) => {
    const memberIdentifier = c.req.param("member_identifier") ?? "";
    const identity = c.req.param("identity") ?? "";
    try {
      const removed = await removeMemberPride(memberIdentifier, identity);
      if (!removed) {
        throw new HttpError(404, `Pride '${identity}' not found for ${memberIdentifier}`);
      }
      setInCache("members_raw", null, 0);
      return c.json({
        status: "success",
        message: `Removed pride '${identity}' from ${memberIdentifier}`,
      });
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(500, `Failed to remove member pride: ${String(err)}`);
    }
  },
);
