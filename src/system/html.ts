/**
 * Copyright (c) 2026 Clove Twilight
 * Licensed under the ESAL-2.0 Licence.
 * See LICENCE.md in the project root for full licence information.
 */

const HEX_PATTERN = /^[0-9a-fA-F]{6}$/;

export function escapeHtml(text: string): string {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

export function normalizeHex(color: string | null | undefined, defaultColor = "#FF69B4"): string {
  if (typeof color !== "string" || !color) return defaultColor;
  const c = color.replace(/^#+/, "");
  if (HEX_PATTERN.test(c)) return `#${c.toUpperCase()}`;
  return defaultColor;
}
