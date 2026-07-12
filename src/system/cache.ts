/**
 * Copyright (c) 2026 Clove Twilight
 * Licensed under the ESAL-2.0 Licence.
 * See LICENCE.md in the project root for full licence information.
 */

/**
 * Simple in-memory cache, unchanged from the old backend. It lives in the
 * SystemState DO isolate, so it survives between requests for as long as the
 * DO stays warm and is reset (harmlessly) if the DO is evicted.
 */

interface CacheEntry {
  value: unknown;
  expireAt: number;
}

const cache = new Map<string, CacheEntry>();

export function getFromCache<T = unknown>(key: string): T | undefined {
  const entry = cache.get(key);
  if (entry) {
    if (Date.now() < entry.expireAt) {
      return entry.value as T;
    }
    cache.delete(key);
  }
  return undefined;
}

export function setInCache(key: string, value: unknown, ttlSeconds = 30): void {
  cache.set(key, { value, expireAt: Date.now() + ttlSeconds * 1000 });
}

export function clearCache(key?: string): void {
  if (key) {
    cache.delete(key);
  } else {
    cache.clear();
  }
}
