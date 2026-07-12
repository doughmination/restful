/* =====================================================================
 * contribapi/codeberg.ts — Codeberg/Forgejo contribution heatmap.
 *
 * Forgejo's /users/:name/heatmap endpoint is public (no token) and already
 * returns { timestamp, contributions } rows. If CODEBERG_USERNAME is unset,
 * this yields an empty series.
 * ===================================================================== */

import type { Env } from "../types";
import { CONTRIB_USER_AGENT, type Day } from "./common";

export async function queryCodeberg(env: Env): Promise<{ codeberg: Day[] }> {
  if (!env.CODEBERG_USERNAME) return { codeberg: [] };

  const response = await fetch(
    `https://codeberg.org/api/v1/users/${encodeURIComponent(env.CODEBERG_USERNAME)}/heatmap`,
    { headers: { "User-Agent": CONTRIB_USER_AGENT } },
  );
  if (!response.ok) return { codeberg: [] };

  const body = (await response.json()) as Array<{ timestamp?: unknown; contributions?: unknown }>;
  if (!Array.isArray(body)) return { codeberg: [] };

  const codeberg: Day[] = [];
  for (const row of body) {
    const timestamp = Number(row.timestamp);
    const contributions = Number(row.contributions);
    if (Number.isNaN(timestamp) || Number.isNaN(contributions)) continue;
    codeberg.push({ timestamp, contributions });
  }
  return { codeberg };
}
