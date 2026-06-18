/* =====================================================================
 * presence.ts — turn a raw Discord gateway presence into UnifiedPresence.
 * ===================================================================== */

import type { DiscordStatus, UnifiedCustomStatus, UnifiedPresence, UnifiedSpotify } from "./types";
import { emojiUrl } from "./discord/constants";

export interface RawPresence {
  user: { id: string };
  status?: DiscordStatus;
  activities?: any[];
  client_status?: { desktop?: string; mobile?: string; web?: string };
}

function spotifyArt(largeImage: string | undefined): string | null {
  if (!largeImage) return null;
  // Spotify activity asset looks like "spotify:ab67616d00...".
  const id = largeImage.startsWith("spotify:") ? largeImage.slice("spotify:".length) : largeImage;
  return `https://i.scdn.co/image/${id}`;
}

function extractSpotify(activities: any[]): UnifiedSpotify | null {
  const a = activities.find((x) => x && x.type === 2 && x.name === "Spotify" && x.sync_id);
  if (!a) return null;
  return {
    track_id: a.sync_id ?? null,
    song: a.details ?? "",
    artist: a.state ?? "",
    album: a.assets?.large_text ?? "",
    album_art_url: spotifyArt(a.assets?.large_image),
    timestamps: a.timestamps
      ? { start: a.timestamps.start ?? null, end: a.timestamps.end ?? null }
      : null,
  };
}

function extractCustomStatus(activities: any[]): UnifiedCustomStatus | null {
  const c = activities.find((x) => x && x.type === 4);
  if (!c) return null;
  const text: string | null = c.state ?? null;
  const e = c.emoji;
  const hasEmoji = e && (e.id || e.name);
  if (!text && !hasEmoji) return null;
  return {
    text,
    emoji: hasEmoji
      ? {
          id: e.id ?? null,
          name: e.name ?? null,
          animated: !!e.animated,
          url: e.id ? emojiUrl(e.id, !!e.animated) : null,
        }
      : null,
  };
}

export function buildPresence(raw: RawPresence): UnifiedPresence {
  const activities = Array.isArray(raw.activities) ? raw.activities : [];
  const status: DiscordStatus = raw.status ?? "offline";
  const cs = raw.client_status || {};
  const spotify = extractSpotify(activities);

  return {
    user_id: raw.user.id,
    status,
    online: status !== "offline",
    platform: {
      desktop: !!cs.desktop,
      mobile: !!cs.mobile,
      web: !!cs.web,
    },
    activities,
    custom_status: extractCustomStatus(activities),
    listening_to_spotify: !!spotify,
    spotify,
    updated_at: Date.now(),
  };
}

/** Presence for someone we can't see on the gateway (offline placeholder). */
export function offlinePresence(userId: string): UnifiedPresence {
  return {
    user_id: userId,
    status: "offline",
    online: false,
    platform: { desktop: false, mobile: false, web: false },
    activities: [],
    custom_status: null,
    listening_to_spotify: false,
    spotify: null,
    updated_at: Date.now(),
  };
}
