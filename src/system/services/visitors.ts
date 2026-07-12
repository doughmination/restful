/**
 * Copyright (c) 2026 Clove Twilight
 * Licensed under the ESAL-2.0 Licence.
 * See LICENCE.md in the project root for full licence information.
 */

/**
 * Visitor logging, backed by the SystemState DO's embedded SQLite
 * (`rt().sql`) instead of bun:sqlite + a JSONL file. Same schema and the
 * same query helpers the /v2/system-data viewer relies on.
 */

import { rt } from "../runtime";
import type { PKObject } from "../types";

let initialised = false;

function db(): SqlStorage {
  return rt().sql;
}

export function initVisitorSchema(): void {
  if (initialised) return;
  const sql = db();
  sql.exec(`
    CREATE TABLE IF NOT EXISTS visitor_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      unix_timestamp REAL NOT NULL,
      ip_address TEXT NOT NULL,
      user_agent TEXT,
      referer TEXT,
      method TEXT,
      path TEXT,
      query_string TEXT,
      remote_addr TEXT,
      x_forwarded_for TEXT,
      x_real_ip TEXT,
      accept_language TEXT,
      accept_encoding TEXT,
      host TEXT,
      all_headers TEXT,
      cookies TEXT,
      body_size INTEGER,
      response_code INTEGER,
      request_time_ms REAL,
      browser_fingerprint TEXT,
      country TEXT,
      asn TEXT
    )
  `);
  sql.exec("CREATE INDEX IF NOT EXISTS idx_timestamp ON visitor_logs(timestamp)");
  sql.exec("CREATE INDEX IF NOT EXISTS idx_ip ON visitor_logs(ip_address)");
  sql.exec("CREATE INDEX IF NOT EXISTS idx_path ON visitor_logs(path)");
  initialised = true;
}

function headerObject(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  req.headers.forEach((v, k) => {
    out[k] = v;
  });
  return out;
}

function getClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  for (const header of ["cf-connecting-ip", "x-real-ip", "true-client-ip"]) {
    const v = req.headers.get(header);
    if (v) return v;
  }
  return "";
}

async function browserFingerprint(req: Request): Promise<string> {
  const ua = req.headers.get("user-agent") ?? "";
  const lang = req.headers.get("accept-language") ?? "";
  const encoding = req.headers.get("accept-encoding") ?? "";
  const data = new TextEncoder().encode(`${ua}|${lang}|${encoding}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

/** Record a page visit. `path` overrides the request path (frontend supplies it). */
export async function logVisitor(
  req: Request,
  options: { path?: string; bodySize?: number; responseCode?: number; requestTimeMs?: number } = {},
): Promise<void> {
  initVisitorSchema();

  const url = new URL(req.url);
  const now = new Date();
  const headers = headerObject(req);

  db().exec(
    `INSERT INTO visitor_logs (
      timestamp, unix_timestamp, ip_address, user_agent, referer,
      method, path, query_string, remote_addr, x_forwarded_for,
      x_real_ip, accept_language, accept_encoding, host,
      all_headers, cookies, body_size, response_code,
      request_time_ms, browser_fingerprint, country, asn
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    now.toISOString(),
    now.getTime() / 1000,
    getClientIp(req),
    headers["user-agent"] ?? "",
    headers["referer"] ?? "",
    req.method,
    options.path || url.pathname,
    url.search ? url.search.slice(1) : "",
    "",
    headers["x-forwarded-for"] ?? "",
    headers["x-real-ip"] ?? "",
    headers["accept-language"] ?? "",
    headers["accept-encoding"] ?? "",
    headers["host"] ?? "",
    JSON.stringify(headers),
    JSON.stringify(parseCookies(req.headers.get("cookie"))),
    options.bodySize ?? 0,
    options.responseCode ?? 200,
    options.requestTimeMs ?? 0,
    await browserFingerprint(req),
    headers["cf-ipcountry"] ?? "Unknown",
    "Unknown",
  );
}

// ---- Query helpers (used by the /v2/system-data viewer) -------------------

function rows(cursor: SqlStorageCursor<Record<string, SqlStorageValue>>): PKObject[] {
  return cursor.toArray() as PKObject[];
}

export const LogQuery = {
  stats(): PKObject {
    const sql = db();
    const total = (sql.exec("SELECT COUNT(*) AS n FROM visitor_logs").one() as { n: number }).n;
    const uniqueIps = (
      sql.exec("SELECT COUNT(DISTINCT ip_address) AS n FROM visitor_logs").one() as { n: number }
    ).n;
    const last24h = (
      sql
        .exec(
          "SELECT COUNT(*) AS n FROM visitor_logs WHERE unix_timestamp > strftime('%s','now') - 86400",
        )
        .one() as { n: number }
    ).n;
    const topPaths = rows(
      sql.exec(
        "SELECT path, COUNT(*) c FROM visitor_logs GROUP BY path ORDER BY c DESC LIMIT 10",
      ),
    );
    return {
      total_visits: total,
      unique_ips: uniqueIps,
      last_24h: last24h,
      top_paths: topPaths.map((r) => ({ path: r.path, count: r.c })),
    };
  },

  recent(limit: number): PKObject[] {
    return rows(
      db().exec(
        `SELECT id, timestamp, ip_address, method, path, response_code, user_agent, referer
         FROM visitor_logs ORDER BY unix_timestamp DESC LIMIT ?`,
        limit,
      ),
    );
  },

  findByIp(ipAddress: string): PKObject[] {
    return rows(
      db().exec(
        "SELECT * FROM visitor_logs WHERE ip_address = ? ORDER BY timestamp DESC",
        ipAddress,
      ),
    );
  },

  findByPath(path: string): PKObject[] {
    return rows(
      db().exec(
        "SELECT * FROM visitor_logs WHERE path LIKE ? ORDER BY timestamp DESC",
        `%${path}%`,
      ),
    );
  },

  findSuspiciousPatterns(): PKObject[] {
    return rows(
      db().exec(`
        SELECT ip_address, COUNT(*) as visit_count,
               MIN(timestamp) as first_visit, MAX(timestamp) as last_visit
        FROM visitor_logs
        WHERE unix_timestamp > (unixepoch('now') - 3600)
        GROUP BY ip_address
        HAVING COUNT(*) > 20
        ORDER BY visit_count DESC
      `),
    );
  },

  entry(entryId: number): PKObject | null {
    const result = rows(db().exec("SELECT * FROM visitor_logs WHERE id = ?", entryId));
    return result[0] ?? null;
  },
};
