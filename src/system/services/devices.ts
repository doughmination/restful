/**
 * Copyright (c) 2026 Clove Twilight
 * Licensed under the ESAL-2.0 Licence.
 * See LICENCE.md in the project root for full licence information.
 */

/** Latest-known device state (no history). DO blob store. */

import { rt } from "../runtime";

interface DeviceRecord {
  level?: number;
  charging?: boolean;
  lowPowerMode?: boolean;
  wifi?: string;
  updated_at: string;
}

/** Fields a caller may set. All optional — only provided fields are updated. */
type DevicePatch = Pick<DeviceRecord, "level" | "charging" | "lowPowerMode" | "wifi">;

type DevicesMap = Record<string, DeviceRecord>;

const KEY = "battery_levels";

export async function getAllLevels(): Promise<DevicesMap> {
  return rt().store.get<DevicesMap>(KEY, {});
}

export async function saveAllLevels(levels: DevicesMap): Promise<void> {
  await rt().store.put(KEY, levels);
}

export async function getDeviceLevel(device: string): Promise<DeviceRecord | null> {
  const levels = await getAllLevels();
  return levels[device] ?? null;
}

/** Merge `patch` into the device's record, preserving any fields not supplied. */
export async function setDeviceLevel(
  device: string,
  patch: DevicePatch,
): Promise<{ device: string } & DeviceRecord> {
  const levels = await getAllLevels();
  const existing = levels[device] ?? {};

  const record: DeviceRecord = {
    ...existing,
    ...(patch.level !== undefined ? { level: patch.level } : {}),
    ...(patch.charging !== undefined ? { charging: patch.charging } : {}),
    ...(patch.lowPowerMode !== undefined ? { lowPowerMode: patch.lowPowerMode } : {}),
    ...(patch.wifi !== undefined ? { wifi: patch.wifi } : {}),
    updated_at: new Date().toISOString(),
  };

  levels[device] = record;
  await saveAllLevels(levels);
  return { device, ...record };
}
