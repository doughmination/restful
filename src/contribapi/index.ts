/* =====================================================================
 * contribapi/index.ts — merge per-forge contribution heatmaps.
 *
 * getContributions() runs every configured forge in parallel and merges the
 * results into one object keyed by forge name, e.g.
 *   { github: Day[], codeberg: Day[] }
 *
 * To add another Forgejo instance (git.gay, etc.), write a query function
 * that returns { <name>: Day[] } and add it to `forgeQueries`. A forge that
 * throws is treated as an empty series so one bad token can't fail the whole
 * response.
 * ===================================================================== */

import type { Env } from "../types";
import type { Day } from "./common";
import { queryGithub } from "./github";
import { queryCodeberg } from "./codeberg";

export type { Day } from "./common";

/** Merged heatmap: one array of days per configured forge. */
export type ContribData = Record<string, Day[]>;

function forgeQueries(env: Env): Array<Promise<Record<string, Day[]>>> {
  return [
    queryGithub(env).catch(() => ({ github: [] as Day[] })),
    queryCodeberg(env).catch(() => ({ codeberg: [] as Day[] })),
  ];
}

export async function getContributions(env: Env): Promise<ContribData> {
  const responses = await Promise.all(forgeQueries(env));
  return Object.assign({}, ...responses) as ContribData;
}
