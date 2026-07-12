/**
 * Copyright (c) 2026 Clove Twilight
 * Licensed under the ESAL-2.0 Licence.
 * See LICENCE.md in the project root for full licence information.
 */

/** Parse an ISO-8601 timestamp, tolerating excess fractional-second digits
 *  and missing offsets (naive input is treated as UTC). Ported verbatim. */

const TIMESTAMP_PATTERN = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d+)?([+-]\d{2}:\d{2})?$/;

export function parseTimestamp(timestampStr: string): Date {
  let s = timestampStr;
  const hadExplicitTz = /[zZ]$|[+-]\d{2}:\d{2}$/.test(s);

  if (s.endsWith("Z") || s.endsWith("z")) {
    s = `${s.slice(0, -1)}+00:00`;
  }

  const match = s.match(TIMESTAMP_PATTERN);
  if (match) {
    const [, base, frac, tz] = match;
    const fracPart = frac ? frac.slice(0, 4) : "";
    s = `${base}${fracPart}${tz ?? ""}`;
  }

  const dt = new Date(s);
  if (Number.isNaN(dt.getTime())) {
    throw new Error(`Could not parse timestamp: ${timestampStr}`);
  }

  if (!hadExplicitTz) {
    return new Date(
      Date.UTC(
        dt.getFullYear(),
        dt.getMonth(),
        dt.getDate(),
        dt.getHours(),
        dt.getMinutes(),
        dt.getSeconds(),
        dt.getMilliseconds(),
      ),
    );
  }
  return dt;
}
