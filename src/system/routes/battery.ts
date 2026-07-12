/**
 * Copyright (c) 2026 Clove Twilight
 * Licensed under the ESAL-2.0 Licence.
 * See LICENCE.md in the project root for full licence information.
 */

/**
 * Device battery levels. Mounted at /v2/battery.
 *   POST /v2/battery?device=iphone&level=25   (X-Battery-Key required)
 *   GET  /v2/battery                          (public, all devices)
 *   GET  /v2/battery/:device                  (public, one device)
 */

import { Hono } from "hono";

import type { Env } from "../hono";
import { getAllLevels, getDeviceLevel, setDeviceLevel } from "../services/battery";
import { verifyBatteryAccess } from "../middleware/auth";

export const batteryRoutes = new Hono<Env>();

batteryRoutes.post("/", verifyBatteryAccess, async (c) => {
  const device = c.req.query("device");
  const levelRaw = c.req.query("level");

  if (typeof device !== "string" || device.length < 1 || device.length > 64) {
    return c.json({ detail: "Query param 'device' must be a string between 1 and 64 characters" }, 422);
  }

  const level = Number(levelRaw);
  if (typeof levelRaw !== "string" || Number.isNaN(level) || level < 0 || level > 100) {
    return c.json({ detail: "Query param 'level' must be an integer between 0 and 100" }, 422);
  }

  const record = await setDeviceLevel(device, level);
  return c.json({ success: true, ...record });
});

batteryRoutes.get("/", async (c) => {
  const levels = await getAllLevels();
  const result: Record<string, unknown> = {};
  for (const [device, record] of Object.entries(levels)) {
    result[device] = { device, ...record };
  }
  return c.json(result);
});

batteryRoutes.get("/:device", async (c) => {
  const device = c.req.param("device");
  const record = await getDeviceLevel(device);
  if (record === null) {
    return c.json({ detail: `No battery level recorded for device '${device}'` }, 404);
  }
  return c.json({ device, ...record });
});
