/**
 * Copyright (c) 2026 Clove Twilight
 * Licensed under the ESAL-2.0 Licence.
 * See LICENCE.md in the project root for full licence information.
 */

/**
 * PluralKit API integration, rewritten to use `fetch` instead of `axios`.
 * Behaviour and caching match the old service.
 */

import { PLURALKIT_BASE_URL, pluralkitHeaders, cacheTtl } from "../config";
import { getFromCache, setInCache } from "../cache";
import type { PKObject } from "../types";

const SPECIAL_DISPLAY_NAMES: Record<string, string> = {
  answer: "Answer Machine",
  system: "Unsure",
  sleeping: "I am sleeping",
};

async function pkGet<T>(path: string): Promise<T> {
  const resp = await fetch(`${PLURALKIT_BASE_URL}${path}`, { headers: pluralkitHeaders() });
  if (!resp.ok) {
    throw new Error(`PluralKit GET ${path} failed: ${resp.status}`);
  }
  return (await resp.json()) as T;
}

export async function getSystem(): Promise<PKObject> {
  const cacheKey = "system";
  const cached = getFromCache<PKObject>(cacheKey);
  if (cached) return cached;

  const data = await pkGet<PKObject>("/systems/@me");
  setInCache(cacheKey, data, cacheTtl());
  return data;
}

export async function getMembers(): Promise<PKObject[]> {
  const cacheKey = "members";
  const cached = getFromCache<PKObject[]>(cacheKey);
  if (cached) return cached;

  const baseCacheKey = "members_raw";
  let cachedRaw = getFromCache<PKObject[]>(baseCacheKey);
  if (!cachedRaw) {
    cachedRaw = await pkGet<PKObject[]>("/systems/@me/members");
    setInCache(baseCacheKey, cachedRaw, cacheTtl());
  }

  const processedMembers: PKObject[] = cachedRaw.map((member) => {
    const memberName = member.name;
    if (memberName in SPECIAL_DISPLAY_NAMES) {
      return {
        ...member,
        display_name: SPECIAL_DISPLAY_NAMES[memberName],
        is_special: true,
        original_name: memberName,
      };
    }
    return member;
  });

  setInCache(cacheKey, processedMembers, cacheTtl());
  return processedMembers;
}

export async function getFronters(): Promise<PKObject> {
  const cacheKey = "fronters";
  const cached = getFromCache<PKObject>(cacheKey);
  if (cached) return cached;

  const data = await pkGet<PKObject>("/systems/@me/fronters");

  if ("members" in data) {
    const allMembers = await getMembers();
    data.members = (data.members as PKObject[]).map(
      (member) => allMembers.find((m) => m.id === member.id) ?? member,
    );
  }

  setInCache(cacheKey, data, cacheTtl());
  return data;
}

/** Set the current front. Throws on a non-2xx PluralKit response. */
export async function setFront(memberIds: string[]): Promise<unknown> {
  setInCache("fronters", null, 0);

  const resp = await fetch(`${PLURALKIT_BASE_URL}/systems/@me/switches`, {
    method: "POST",
    headers: { ...pluralkitHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ members: memberIds }),
  });

  if (resp.status !== 200 && resp.status !== 204) {
    const body = await resp.text();
    throw new Error(`Failed to set front: ${resp.status} - ${body}`);
  }

  if (resp.status === 204) return null;
  const text = await resp.text();
  return text ? JSON.parse(text) : null;
}

export async function getSwitches(limit = 1000): Promise<PKObject[]> {
  const cacheKey = `switches_${limit}`;
  const cached = getFromCache<PKObject[]>(cacheKey);
  if (cached) return cached;

  const data = await pkGet<PKObject[]>(`/systems/@me/switches?limit=${limit}`);
  setInCache(cacheKey, data, cacheTtl());
  return data;
}
