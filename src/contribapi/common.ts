/* =====================================================================
 * contribapi/common.ts — shared types for the git contribution heatmap
 * namespace (/v2/contribapi).
 *
 * Ported into the mono API from doughmination/contribapi, itself a fork of
 * dragsbruh's contribapi (https://codeberg.org/dragsbruh/contribapi). The
 * original used zod for runtime validation; here we parse defensively by
 * hand so the mono API keeps a zero-dependency footprint.
 * ===================================================================== */

export const CONTRIB_USER_AGENT =
  "doughmination-api/contribapi (forked from: https://codeberg.org/dragsbruh/contribapi)";

/** One day on a contribution heatmap. `timestamp` is unix seconds. */
export interface Day {
  timestamp: number;
  contributions: number;
}
