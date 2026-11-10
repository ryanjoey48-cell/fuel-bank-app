/**
 * Who may retrieve historical vehicle location. Server-side decision; hiding a button is never the control.
 *
 * Allowed when the account is active, has office access (business:read), AND either:
 *  - holds the fleet:history_playback permission (super_admin and admin only), or
 *  - is named in the server-side allowlist FORTH_HISTORY_PLAYBACK_ALLOWED_USER_IDS (explicit, per person).
 * The allowlist is empty by default. It must not be filled for non-administrators until durable audit
 * logging is approved (see docs/forth-playback-security-and-audit.md).
 */
import type { Permission } from "./authorization";

export const HISTORY_PLAYBACK_PERMISSION: Permission = "fleet:history_playback";
export const HISTORY_PLAYBACK_ALLOWLIST_ENV = "FORTH_HISTORY_PLAYBACK_ALLOWED_USER_IDS";

/** User ids only (UUID-like), comma or whitespace separated, lower-cased, capped. Anything else is ignored. */
export function parsePlaybackAllowlist(value: string | undefined | null): string[] {
  if (!value) return [];
  return [...new Set(value.split(/[\s,;]+/).map(v => v.trim().toLowerCase()).filter(v => /^[0-9a-f][0-9a-f-]{7,63}$/.test(v)))].slice(0, 25);
}

export type PlaybackAccessDecision =
  | { allowed: true; basis: "role_permission" | "explicit_allowlist" }
  | { allowed: false; reason: "no_office_access" | "playback_permission_required" };

export function decideHistoricalPlaybackAccess(input: {
  access: unknown;
  userId: string;
  checkPermission: (access: never, permission: Permission) => boolean;
  allowedUserIds: readonly string[];
}): PlaybackAccessDecision {
  const check = (permission: Permission) => input.checkPermission(input.access as never, permission);
  if (!check("business:read")) return { allowed: false, reason: "no_office_access" };
  if (check(HISTORY_PLAYBACK_PERMISSION)) return { allowed: true, basis: "role_permission" };
  if (typeof input.userId === "string" && input.allowedUserIds.includes(input.userId.toLowerCase())) return { allowed: true, basis: "explicit_allowlist" };
  return { allowed: false, reason: "playback_permission_required" };
}

export const PLAYBACK_DENIED_MESSAGE = "Historical journey access needs explicit authorisation. Ask an administrator.";

/**
 * V4.5: journey-level detail (segment times, per-journey km, job matching) is derived from Forth history, so it is
 * released only to callers who may retrieve historical journeys. Others still get the provider-reported day total.
 * Decided on the server from the resolved account; the browser only displays the result.
 */
export function canViewJourneyDetail(input: { access: unknown; userId: string; checkPermission: (access: never, permission: Permission) => boolean; env?: Record<string, string | undefined> }): boolean {
  const env = input.env ?? (typeof process !== "undefined" ? process.env : {});
  return decideHistoricalPlaybackAccess({ access: input.access, userId: input.userId, checkPermission: input.checkPermission, allowedUserIds: parsePlaybackAllowlist(env[HISTORY_PLAYBACK_ALLOWLIST_ENV]) }).allowed;
}

/** Removes journey detail from a provider-day payload when the caller is not authorised, and says so explicitly. */
export function applyJourneyAccess<T extends { journeyLedger?: unknown }>(day: T, allowed: boolean): Omit<T, "journeyLedger"> & { journeyLedger: unknown; journeyAccess: "granted" | "requires_authorisation" } {
  return { ...day, journeyLedger: allowed ? (day.journeyLedger ?? null) : null, journeyAccess: allowed ? "granted" : "requires_authorisation" };
}
