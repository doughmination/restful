/* =====================================================================
 * contribapi/github.ts — GitHub contribution calendar via the GraphQL API.
 *
 * Requires a token (fine-grained PAT is enough for the calendar). If either
 * GITHUB_USERNAME or GITHUB_TOKEN is unset, this yields an empty series so a
 * partial config still returns the other forges rather than 500ing.
 * ===================================================================== */

import type { Env } from "../types";
import { CONTRIB_USER_AGENT, type Day } from "./common";

const GRAPHQL_QUERY = `query($username: String!) {
  user(login: $username) {
    contributionsCollection {
      contributionCalendar {
        weeks {
          contributionDays {
            date
            contributionCount
          }
        }
      }
    }
  }
}`;

interface GithubGraphQL {
  data?: {
    user?: {
      contributionsCollection?: {
        contributionCalendar?: {
          weeks?: Array<{
            contributionDays?: Array<{ date?: string; contributionCount?: number }>;
          }>;
        };
      };
    };
  };
}

export async function queryGithub(env: Env): Promise<{ github: Day[] }> {
  if (!env.GITHUB_USERNAME || !env.GITHUB_TOKEN) return { github: [] };

  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      "User-Agent": CONTRIB_USER_AGENT,
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    },
    body: JSON.stringify({
      query: GRAPHQL_QUERY,
      variables: { username: env.GITHUB_USERNAME },
    }),
  });
  if (!response.ok) return { github: [] };

  const body = (await response.json()) as GithubGraphQL;
  const weeks = body.data?.user?.contributionsCollection?.contributionCalendar?.weeks ?? [];

  const github: Day[] = [];
  for (const week of weeks) {
    for (const day of week.contributionDays ?? []) {
      const ms = day.date ? Date.parse(day.date) : NaN;
      if (Number.isNaN(ms)) continue;
      github.push({
        timestamp: Math.floor(ms / 1000),
        contributions: day.contributionCount ?? 0,
      });
    }
  }
  return { github };
}
