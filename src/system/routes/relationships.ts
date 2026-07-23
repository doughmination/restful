/**
 * Copyright (c) 2026 Clove Twilight
 * Licensed under the ESAL-2.0 Licence.
 * See LICENCE.md in the project root for full licence information.
 */

import { Hono } from "hono";
import { z } from "zod";

import type { Env } from "../hono";
import {
  getRelationships,
  addRelationship,
  removeRelationship,
} from "../services/relationships";
import { requireAuth, requireOwner } from "../middleware/auth";
import { HttpError } from "../errors";

export const relationshipsRoutes = new Hono<Env>();

const relationshipSchema = z.object({
  memberA: z.string().min(1),
  memberB: z.string().min(1),
  type: z.string().min(1).optional(),
  since: z.string().nullable().optional(),
});

// Public read — the whole system's relationship map.
relationshipsRoutes.get("/relationships", async (c) => {
  try {
    return c.json({ status: "success", relationships: await getRelationships() });
  } catch (err) {
    throw new HttpError(500, `Failed to fetch relationships: ${String(err)}`);
  }
});

relationshipsRoutes.post("/relationships", requireAuth, requireOwner, async (c) => {
  const parsed = relationshipSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ detail: parsed.error.issues }, 422);

  if (parsed.data.memberA === parsed.data.memberB) {
    return c.json({ detail: "A member cannot be in a relationship with themselves" }, 422);
  }

  try {
    const relationship = await addRelationship(parsed.data);
    return c.json({ status: "success", relationship });
  } catch (err) {
    throw new HttpError(400, err instanceof Error ? err.message : String(err));
  }
});

relationshipsRoutes.delete("/relationships/:id", requireAuth, requireOwner, async (c) => {
  const id = c.req.param("id") ?? "";
  try {
    const removed = await removeRelationship(id);
    if (!removed) throw new HttpError(404, `Relationship '${id}' not found`);
    return c.json({ status: "success", message: `Removed relationship ${id}` });
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(500, `Failed to remove relationship: ${String(err)}`);
  }
});
