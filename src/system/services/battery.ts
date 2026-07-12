/**
 * Copyright (c) 2026 Clove Twilight
 * Licensed under the ESAL-2.0 Licence.
 * See LICENCE.md in the project root for full licence information.
 */

/** Latest-known battery level per device (no history). DO blob store. */

import { rt } from "../runtime";

interface BatteryRecord {
  level: number;
  updated_at: string;
}

type LevelsMap = Record<string, BatteryRecord>;

const KEY = "battery_levels";

export async function getAllLevels(): Promise<LevelsMap> {
  return rt().store.get<LevelsMap>(KEY, {});
}

export async function saveAllLevels(levels: LevelsMap): Promise<void> {
  await rt().store.put(KEY, levels);
}

export async function getDeviceLevel(device: string): Promise<BatteryRecord | null> {
  const levels = await getAllLevels();
  return levels[device] ?? null;
}

export async function setDeviceLevel(
  device: string,
  level: number,
): Promise<{ device: string } & BatteryRecord> {
  const levels = await getAllLevels();
  const record: BatteryRecord = { level, updated_at: new Date().toISOString() };
  levels[device] = record;
  await saveAllLevels(levels);
  return { device, ...record };
}
