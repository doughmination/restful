/* =====================================================================
 * presence.ts — turn a raw Discord gateway presence into UnifiedPresence.
 * ===================================================================== */

import type { DiscordStatus, UnifiedCustomStatus, UnifiedPresence, UnifiedSpotify } from "./types";
import { activityAssetUrl, emojiUrl } from "./discord/constants";

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

/**
 * Resolve an activity's `assets.large_image`/`small_image` (which can be a
 * bare app-asset hash, or a scheme-prefixed external reference like
 * "twitch:username" for streams) into actual, directly-loadable URLs.
 * Leaves the original asset fields untouched and just adds the resolved
 * `*_url` companions, so this is purely additive.
 */
function enrichActivityAssets(a: any): any {
  if (!a || !a.assets) return a;
  const appId = a.application_id ?? null;
  return {
    ...a,
    assets: {
      ...a.assets,
      large_image_url: activityAssetUrl(a.assets.large_image, appId),
      small_image_url: activityAssetUrl(a.assets.small_image, appId),
    },
  };
}

export function buildPresence(raw: RawPresence): UnifiedPresence {
  const rawActivities = Array.isArray(raw.activities) ? raw.activities : [];
  const activities = rawActivities.map(enrichActivityAssets);
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