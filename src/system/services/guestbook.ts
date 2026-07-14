/**
 * Copyright (c) 2026 Clove Twilight
 * Licensed under the ESAL-2.0 Licence.
 * See LICENCE.md in the project root for full licence information.
 */

/**
 * Guestbook state. Ported from the standalone `guestbook` Worker (Cloudflare
 * KV) to the SystemState DO blob store. Entries live newest-first in a single
 * JSON blob under `guestbook_entries`; each entry carries a random UID so it
 * can be deleted individually.
 *
 * Per-IP rate limiting is kept, stored as a timestamp under
 * `guestbook_rl:<ip>` (compared against RATE_LIMIT_SECONDS on each POST).
 */

import { rt } from "../runtime";

export interface GuestbookEntry {
  id: string;
  name: string;
  message: string;
  website: string;
  ts: number;
}

/** Fields a caller may submit. */
export interface GuestbookInput {
  name: string;
  message: string;
  website: string;
}

const ENTRIES_KEY = "guestbook_entries";
const RL_PREFIX = "guestbook_rl:";
const MAX_ENTRIES = 1000; // keep the blob bounded (well under the DO 128KB value cap)

export const RATE_LIMIT_SECONDS = 60; // min seconds between posts from one IP

export const LIMITS = {
  name: 40,
  message: 500,
  website: 200,
} as const;

// Collapse whitespace, trim, and strip control chars. We do NOT store HTML;
// consumers render everything as text, so this is just tidy-up.
export function clean(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\x00-\x1F\x7F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

// Accept only http(s) links; otherwise drop it.
export function cleanWebsite(value: unknown): string {
  const v = clean(value, LIMITS.website);
  if (!v) return "";
  let url = v;
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    return u.toString().slice(0, LIMITS.website);
  } catch {
    return "";
  }
}

export async function readEntries(): Promise<GuestbookEntry[]> {
  return rt().store.get<GuestbookEntry[]>(ENTRIES_KEY, []);
}

async function saveEntries(entries: GuestbookEntry[]): Promise<void> {
  await rt().store.put(ENTRIES_KEY, entries);
}

/**
 * Insert a new entry (newest first) with a fresh UID and the current time.
 * Inputs are assumed already cleaned/validated by the caller.
 */
export async function addEntry(input: GuestbookInput): Promise<GuestbookEntry> {
  const entry: GuestbookEntry = {
    id: crypto.randomUUID(),
    name: input.name,
    message: input.message,
    website: input.website,
    ts: Date.now(),
  };

  const entries = await readEntries();
  entries.unshift(entry);
  if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES;
  await saveEntries(entries);
  return entry;
}

/** Remove an entry by UID. Returns true if it existed and was deleted. */
export async function deleteEntry(id: string): Promise<boolean> {
  const entries = await readEntries();
  const idx = entries.findIndex((e) => e.id === id);
  if (idx === -1) return false;
  entries.splice(idx, 1);
  await saveEntries(entries);
  return true;
}

/**
 * Per-IP rate limit. Returns true if the caller is allowed to post now (and
 * records this post's time); false if they posted within RATE_LIMIT_SECONDS.
 * A blank IP is never rate-limited.
 */
export async function checkAndRecordRateLimit(ip: string | undefined): Promise<boolean> {
  if (!ip) return true;
  const key = RL_PREFIX + ip;
  const last = await rt().store.get<number>(key, 0);
  const now = Date.now();
  if (last && now - last < RATE_LIMIT_SECONDS * 1000) return false;
  await rt().store.put(key, now);
  return true;
}
