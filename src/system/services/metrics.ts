/**
 * Copyright (c) 2026 Clove Twilight
 * Licensed under the ESAL-2.0 Licence.
 * See LICENCE.md in the project root for full licence information.
 */

/** Fronting-time and switch-frequency metrics. Logic ported verbatim. */

import { getSwitches, getMembers } from "./pluralkit";
import { parseTimestamp } from "../datetime";
import type { PKObject } from "../types";

interface MemberDetail {
  name: string;
  display_name: string;
  avatar_url: string | null;
}

interface FrontingTimeTotals {
  total_seconds: number;
  "24h": number;
  "48h": number;
  "5d": number;
  "7d": number;
  "30d": number;
}

const TIMEFRAME_KEYS = ["24h", "48h", "5d", "7d", "30d"] as const;

function emptyFrontingMetrics(): PKObject {
  return {
    total_time: 0,
    members: {},
    timeframes: { "24h": {}, "48h": {}, "5d": {}, "7d": {}, "30d": {} },
  };
}

export async function getFrontingTimeMetrics(days = 30): Promise<PKObject> {
  try {
    const switches = await getSwitches(1000);

    const now = new Date();
    const cutoffTime = new Date(now.getTime() - days * 24 * 3600 * 1000);

    const memberDetails: Record<string, MemberDetail> = {};
    try {
      const members = await getMembers();
      for (const member of members) {
        memberDetails[member.id] = {
          name: member.name,
          display_name: member.display_name ?? member.name,
          avatar_url: member.avatar_url ?? null,
        };
      }
    } catch (err) {
      console.error(`Error fetching member details: ${String(err)}`);
    }

    const filteredSwitches: PKObject[] = [];
    for (const switchObj of switches) {
      try {
        const timestamp = parseTimestamp(switchObj.timestamp);
        if (timestamp >= cutoffTime) {
          filteredSwitches.push({ ...switchObj, _parsed_timestamp: timestamp });
        }
      } catch (err) {
        console.error(`Error parsing timestamp: ${String(err)}`);
      }
    }

    filteredSwitches.sort(
      (a, b) => (a._parsed_timestamp as Date).getTime() - (b._parsed_timestamp as Date).getTime(),
    );

    if (filteredSwitches.length === 0) return emptyFrontingMetrics();

    const currentMembers = filteredSwitches[filteredSwitches.length - 1].members;
    filteredSwitches.push({
      timestamp: now.toISOString(),
      members: currentMembers,
      _parsed_timestamp: now,
    });

    const frontingTimes: Record<string, FrontingTimeTotals> = {};
    let totalTimeSeconds = 0;

    for (let i = 1; i < filteredSwitches.length; i++) {
      const prevSwitch = filteredSwitches[i - 1];
      const currSwitch = filteredSwitches[i];

      try {
        const prevTime: Date = prevSwitch._parsed_timestamp;
        const currTime: Date = currSwitch._parsed_timestamp;
        const durationSeconds = (currTime.getTime() - prevTime.getTime()) / 1000;
        totalTimeSeconds += durationSeconds;

        for (const memberId of prevSwitch.members as string[]) {
          if (!(memberId in frontingTimes)) {
            frontingTimes[memberId] = {
              total_seconds: 0,
              "24h": 0,
              "48h": 0,
              "5d": 0,
              "7d": 0,
              "30d": 0,
            };
          }

          frontingTimes[memberId].total_seconds += durationSeconds;

          const timeAgo = (now.getTime() - prevTime.getTime()) / 1000;
          if (timeAgo <= 24 * 3600) frontingTimes[memberId]["24h"] += durationSeconds;
          if (timeAgo <= 48 * 3600) frontingTimes[memberId]["48h"] += durationSeconds;
          if (timeAgo <= 5 * 24 * 3600) frontingTimes[memberId]["5d"] += durationSeconds;
          if (timeAgo <= 7 * 24 * 3600) frontingTimes[memberId]["7d"] += durationSeconds;
          if (timeAgo <= 30 * 24 * 3600) frontingTimes[memberId]["30d"] += durationSeconds;
        }
      } catch (err) {
        console.error(`Error processing switch: ${String(err)}`);
      }
    }

    const result: PKObject = {
      total_time: totalTimeSeconds,
      members: {},
      timeframes: { "24h": {}, "48h": {}, "5d": {}, "7d": {}, "30d": {} },
    };

    for (const [memberId, times] of Object.entries(frontingTimes)) {
      let name = memberId;
      let displayName = memberId;
      let avatarUrl: string | null = null;

      if (memberId in memberDetails) {
        name = memberDetails[memberId].name;
        displayName = memberDetails[memberId].display_name;
        avatarUrl = memberDetails[memberId].avatar_url;
      }

      const totalPercent = totalTimeSeconds > 0 ? (times.total_seconds / totalTimeSeconds) * 100 : 0;

      result.members[memberId] = {
        id: memberId,
        name,
        display_name: displayName,
        avatar_url: avatarUrl,
        total_seconds: times.total_seconds,
        total_percent: totalPercent,
        "24h": times["24h"],
        "48h": times["48h"],
        "5d": times["5d"],
        "7d": times["7d"],
        "30d": times["30d"],
      };

      for (const tf of TIMEFRAME_KEYS) {
        result.timeframes[tf][memberId] = times[tf];
      }
    }

    return result;
  } catch (err) {
    console.error(`Error in getFrontingTimeMetrics: ${String(err)}`);
    return emptyFrontingMetrics();
  }
}

export async function getSwitchFrequencyMetrics(days = 30): Promise<PKObject> {
  try {
    const switches = await getSwitches(1000);

    const now = new Date();
    const cutoffTime = new Date(now.getTime() - days * 24 * 3600 * 1000);

    const filteredSwitches: PKObject[] = [];
    for (const switchObj of switches) {
      try {
        const timestamp = parseTimestamp(switchObj.timestamp);
        if (timestamp >= cutoffTime) {
          filteredSwitches.push({ ...switchObj, _parsed_timestamp: timestamp });
        }
      } catch (err) {
        console.error(`Error parsing timestamp in switch_frequency: ${String(err)}`);
      }
    }

    const totalSwitches = filteredSwitches.length;
    const timeframes: Record<string, number> = {
      "24h": 0,
      "48h": 0,
      "5d": 0,
      "7d": 0,
      "30d": totalSwitches,
    };

    for (const switchObj of filteredSwitches) {
      try {
        const timestamp: Date = switchObj._parsed_timestamp;
        const timeAgo = (now.getTime() - timestamp.getTime()) / 1000;
        if (timeAgo <= 24 * 3600) timeframes["24h"] += 1;
        if (timeAgo <= 48 * 3600) timeframes["48h"] += 1;
        if (timeAgo <= 5 * 24 * 3600) timeframes["5d"] += 1;
        if (timeAgo <= 7 * 24 * 3600) timeframes["7d"] += 1;
      } catch (err) {
        console.error(`Error calculating timeframes: ${String(err)}`);
      }
    }

    const avgSwitchesPerDay = days > 0 ? totalSwitches / days : 0;

    return {
      total_switches: totalSwitches,
      avg_switches_per_day: avgSwitchesPerDay,
      timeframes,
    };
  } catch (err) {
    console.error(`Error in getSwitchFrequencyMetrics: ${String(err)}`);
    return {
      total_switches: 0,
      avg_switches_per_day: 0,
      timeframes: { "24h": 0, "48h": 0, "5d": 0, "7d": 0, "30d": 0 },
    };
  }
}
