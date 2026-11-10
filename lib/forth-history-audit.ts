/**
 * Access audit for historical vehicle-location requests (journey playback points and journey reports).
 *
 * Events are built field by field from a fixed allowlist, so tokens, credentials, request bodies, addresses and
 * coordinates cannot reach the log by accident. This module is NOT durable: events go to the server log line
 * "forth_history_audit" and to a bounded in-memory ring that disappears on restart. Durable storage needs the
 * review-only schema in docs/fleet-intelligence-persistence-review-only.sql, which has not been approved or applied.
 */
export type HistoryAuditAction = "playback_points" | "journey_report";
export type HistoryAuditOutcome =
  | "authorised_ready"
  | "unauthenticated"
  | "denied_no_office_access"
  | "denied_playback_permission"
  | "denied_gate_closed"
  | "rejected_invalid_request"
  | "rejected_device_not_in_fleet"
  | "rejected_ambiguous_device"
  | "rate_limited"
  | "upstream_unavailable"
  | "error";

export type HistoryAuditEvent = {
  correlationId: string;
  at: string;
  atBangkok: string;
  userId: string | null;
  role: "super_admin" | "admin" | "office_staff" | "read_only" | null;
  accessBasis: "role_permission" | "explicit_allowlist" | null;
  action: HistoryAuditAction;
  outcome: HistoryAuditOutcome;
  reason: string | null;
  httpStatus: number | null;
  deviceId: string | null;
  date: string | null;
  window: { startTime: string; endTime: string } | null;
  /** A count only. Coordinates and per-point history are never recorded. */
  observationCount: number | null;
};
export type HistoryAuditInput = Partial<Omit<HistoryAuditEvent, "at" | "atBangkok">> & Pick<HistoryAuditEvent, "correlationId" | "action" | "outcome">;

const MAX_EVENTS = 300;
const host = globalThis as typeof globalThis & { eesForthHistoryAudit?: HistoryAuditEvent[] };
const ring = host.eesForthHistoryAudit ??= [];

export function newCorrelationId() {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return c?.randomUUID ? c.randomUUID() : `cid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
const ROLES = ["super_admin", "admin", "office_staff", "read_only"] as const;
const text = (v: unknown, pattern: RegExp) => typeof v === "string" && pattern.test(v) ? v : null;
const bangkok = (ms: number) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Bangkok", dateStyle: "short", timeStyle: "medium" }).format(new Date(ms));

/** Builds a sanitized event. Unknown or malformed values become null; device IDs that do not look like IDs become "invalid". */
export function buildHistoryAuditEvent(input: HistoryAuditInput, now = Date.now()): HistoryAuditEvent {
  const window = input.window && text(input.window.startTime, /^(\d{2}:\d{2}|\d{14})$/) && text(input.window.endTime, /^(\d{2}:\d{2}|\d{14})$/) ? { startTime: input.window.startTime, endTime: input.window.endTime } : null;
  return {
    correlationId: text(input.correlationId, /^[A-Za-z0-9-]{8,64}$/) ?? "invalid",
    at: new Date(now).toISOString(), atBangkok: `${bangkok(now)} Asia/Bangkok`,
    userId: text(input.userId, /^[A-Za-z0-9-]{1,64}$/),
    role: ROLES.find(r => r === input.role) ?? null,
    accessBasis: input.accessBasis === "role_permission" || input.accessBasis === "explicit_allowlist" ? input.accessBasis : null,
    action: input.action === "journey_report" ? "journey_report" : "playback_points",
    outcome: input.outcome,
    reason: text(input.reason, /^[a-z0-9_]{1,60}$/),
    httpStatus: typeof input.httpStatus === "number" && Number.isInteger(input.httpStatus) ? input.httpStatus : null,
    deviceId: input.deviceId === null || input.deviceId === undefined ? null : text(input.deviceId, /^[A-Za-z0-9_-]{1,40}$/) ?? "invalid",
    date: text(input.date, /^\d{4}-\d{2}-\d{2}$/) ?? text(input.date, /^\d{8}$/),
    window,
    observationCount: typeof input.observationCount === "number" && Number.isInteger(input.observationCount) && input.observationCount >= 0 ? input.observationCount : null
  };
}

export function recordHistoryAudit(input: HistoryAuditInput, sink: (line: string, event: HistoryAuditEvent) => void = (line, event) => console.info(line, JSON.stringify(event))) {
  const event = buildHistoryAuditEvent(input);
  ring.push(event); if (ring.length > MAX_EVENTS) ring.splice(0, ring.length - MAX_EVENTS);
  try { sink("forth_history_audit", event); } catch { /* logging must never break a request */ }
  return event;
}
export const recentHistoryAudit = (limit = 50) => ring.slice(-Math.max(1, Math.min(limit, MAX_EVENTS))).reverse();
export const resetHistoryAuditForTests = () => { ring.length = 0; };

export function auditOutcomeForStatus(status: number): HistoryAuditOutcome {
  if (status === 401) return "unauthenticated";
  if (status === 403) return "denied_no_office_access";
  if (status === 400 || status === 413 || status === 415) return "rejected_invalid_request";
  if (status === 404) return "rejected_device_not_in_fleet";
  if (status === 409) return "rejected_ambiguous_device";
  if (status === 429) return "rate_limited";
  // Only a gateway or availability status means the provider or fleet feed was the problem; a plain 500 is our own failure.
  return status === 502 || status === 503 || status === 504 ? "upstream_unavailable" : "error";
}
