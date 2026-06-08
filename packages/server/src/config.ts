/**
 * Centralised configuration constants for the Cove server.
 *
 * Environment variables are parsed and validated once here.
 * All modules should import from this file instead of parsing env vars directly.
 */

// ─── Session TTL ────────────────────────────────────────────────────────────

const rawTTL = process.env["SESSION_TTL_MS"] ?? "604800000"; // 7 days default
const parsedTTL = parseInt(rawTTL, 10);

if (!Number.isFinite(parsedTTL) || parsedTTL <= 0) {
  throw new Error(`Invalid SESSION_TTL_MS: ${process.env["SESSION_TTL_MS"]}`);
}

/** Session time-to-live in milliseconds. Defaults to 7 days (604800000). */
export const SESSION_TTL_MS = parsedTTL;
