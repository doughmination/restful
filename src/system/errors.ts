/**
 * Copyright (c) 2026 Clove Twilight
 * Licensed under the ESAL-2.0 Licence.
 * See LICENCE.md in the project root for full licence information.
 */

/**
 * Lightweight HTTP error, thrown anywhere in the system API and translated
 * into a JSON `{ detail }` response by the Hono error handler (see app.ts).
 * Mirrors the old Express HttpError so ported handlers read identically.
 */
export class HttpError extends Error {
  public readonly statusCode: number;
  public readonly headers?: Record<string, string>;

  constructor(statusCode: number, detail: string, headers?: Record<string, string>) {
    super(detail);
    this.name = "HttpError";
    this.statusCode = statusCode;
    this.headers = headers;
  }
}
