/**
 * Copyright (c) 2026 Clove Twilight
 * Licensed under the ESAL-2.0 Licence.
 * See LICENCE.md in the project root for full licence information.
 */

import type { MentalState } from "../models";
import { parseTimestamp } from "../datetime";
import { rt } from "../runtime";

const KEY = "mental_state";

interface StoredMentalState {
  level: string;
  updated_at: string;
  notes?: string | null;
}

function defaultState(): MentalState {
  return { level: "safe", updated_at: new Date(), notes: null };
}

export async function getMentalState(): Promise<MentalState> {
  try {
    const stateData = await rt().store.get<StoredMentalState | null>(KEY, null);
    if (!stateData) return defaultState();
    return {
      level: stateData.level,
      updated_at: parseTimestamp(stateData.updated_at),
      notes: stateData.notes ?? null,
    };
  } catch (err) {
    console.error(`Error loading mental state: ${String(err)}`);
    return defaultState();
  }
}

export async function saveMentalState(state: MentalState): Promise<boolean> {
  try {
    const stateData: StoredMentalState = {
      level: state.level,
      updated_at: state.updated_at.toISOString(),
      notes: state.notes ?? null,
    };
    await rt().store.put(KEY, stateData);
    return true;
  } catch (err) {
    console.error(`Error saving mental state: ${String(err)}`);
    return false;
  }
}

export async function updateMentalState(
  level: string,
  notes?: string | null,
): Promise<MentalState> {
  const state: MentalState = { level, updated_at: new Date(), notes: notes ?? null };
  await saveMentalState(state);
  return state;
}
