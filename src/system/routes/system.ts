/**
 * Copyright (c) 2026 Clove Twilight
 * Licensed under the ESAL-2.0 Licence.
 * See LICENCE.md in the project root for full licence information.
 */

import { Hono } from "hono";

import type { Env } from "../hono";
import { MentalStateSchema } from "../models";
import { getSystem } from "../services/pluralkit";
import { getMentalState, saveMentalState } from "../services/mental_state";
import { requireAuth, requireAdmin } from "../middleware/auth";
import { broadcastMentalStateUpdate } from "../ws";
import { HttpError } from "../errors";

export const systemRoutes = new Hono<Env>();

/** PluralKit system info + mental state. */
systemRoutes.get("/system", async (c) => {
  try {
    const systemData = await getSystem();
    systemData.mental_state = await getMentalState();
    return c.json(systemData);
  } catch (err) {
    throw new HttpError(500, `Failed to fetch system info: ${String(err)}`);
  }
});

systemRoutes.get("/mental-state", async (c) => {
  try {
    return c.json(await getMentalState());
  } catch (err) {
    throw new HttpError(500, `Failed to fetch mental state: ${String(err)}`);
  }
});

systemRoutes.post("/mental-state", requireAuth, requireAdmin, async (c) => {
  const parsed = MentalStateSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ detail: parsed.error.issues }, 422);
  const state = parsed.data;

  try {
    const ok = await saveMentalState(state);
    if (!ok) throw new HttpError(500, "Failed to save mental state");

    await broadcastMentalStateUpdate({ ...state, updated_at: state.updated_at.toISOString() });
    return c.json({ success: true, message: "Mental state updated" });
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(500, `Failed to update mental state: ${String(err)}`);
  }
});
