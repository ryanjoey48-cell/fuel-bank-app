import { createHash, randomUUID } from "node:crypto";

/**
 * V7.8.3 request-origin diagnostics for historical Forth provider reads. Structured server log lines plus a small in-memory ring (cleared on
 * restart); no database, no new endpoint beyond the existing authorised diagnostics GET. It records WHICH application action asked, never
 * what was returned: no tokens, no credentials, no coordinates, no device ids, no registrations, no driver data, no raw request payloads, and
 * the user is only a one-way short hash. Origins come from a fixed allow-list; anything else is stored as "unlabelled", which is itself a
 * finding (an entry point that does not identify itself). Requests made before this logging existed cannot be reconstructed.
 *
 * All three server routes that can contact Forth history record here: the provider-day evidence route and (since the second V7.8.3 pass)
 * journey playback and the one-day journey report. Every exit is recorded, including requests refused before any Forth call.
 */
export const REQUEST_ORIGINS = [
  "reports_day_review_queue", "reports_coverage_review", "daily_read_button", "daily_refresh_button", "journeys_unread_batch", "locations_evidence_panel",
  "journey_playback_load", "live_journey_history_form"
] as const;
export type RequestOrigin = (typeof REQUEST_ORIGINS)[number] | "unlabelled";
/** Which server route handled the request. All three can contact Forth; only provider_day fills the evidence cache. */
export type RequestRoute = "provider_day" | "journey_playback" | "journey_report";
export const ORIGIN_HEADER = "x-ees-request-origin";
export const REQUEST_ID_HEADER = "x-ees-request-id";

export function parseOrigin(value: string | null | undefined): RequestOrigin {
  return (REQUEST_ORIGINS as readonly string[]).includes(value ?? "") ? (value as RequestOrigin) : "unlabelled";
}
/** Client-supplied correlation id, accepted only in a harmless shape; otherwise the server makes one. */
export function parseRequestId(value: string | null | undefined): string {
  return /^[A-Za-z0-9-]{8,48}$/.test(value ?? "") ? (value as string) : randomUUID();
}
/** One-way, short and salted per process: enough to tell two actors apart in a log, not to identify one. */
const salt = randomUUID();
export function actorRef(userId: string): string { return createHash("sha256").update(`${salt}:${userId}`).digest("hex").slice(0, 12); }
/** Actor reference for a request that failed before sign-in was verified: there is no user id to hash. */
export const UNVERIFIED_ACTOR = "unverified";

/** refused_before_provider: rejected (sign-in, permission, approval gate, validation, vehicle identity) before any Forth call was made. */
export type RequestOutcome = "cache_hit" | "provider_read" | "rate_limited" | "failed" | "cancelled" | "deduplicated_cache_hit" | "refused_before_provider";
export type ProviderRequestEvent = {
  id: string; at: string; route: RequestRoute; actor: string; origin: RequestOrigin; initiation: "explicit_user_action" | "unlabelled";
  vehicleRef: string; day: string; refresh: boolean; outcome: RequestOutcome; status: number; cacheHit: boolean; forthRequests: number; durationMs: number; rateLimited: boolean; waitedForInFlight: boolean;
};
export const MAX_REQUEST_EVENTS = 100;
const host = globalThis as typeof globalThis & { eesProviderRequestLog?: ProviderRequestEvent[]; eesProviderInflight?: Map<string, Promise<void>> };
const ring = () => (host.eesProviderRequestLog ??= []);
const inflight = () => (host.eesProviderInflight ??= new Map());

export type ProviderRequestInput = Omit<ProviderRequestEvent, "at" | "initiation" | "rateLimited" | "cacheHit" | "route"> & { route?: RequestRoute; log?: (line: string, payload: Record<string, unknown>) => void };
export function logProviderRequest(input: ProviderRequestInput) {
  const { log, route, ...rest } = input;
  const event: ProviderRequestEvent = { ...rest, route: route === "journey_playback" || route === "journey_report" ? route : "provider_day", at: new Date().toISOString(),
    initiation: rest.origin === "unlabelled" ? "unlabelled" : "explicit_user_action", rateLimited: rest.outcome === "rate_limited", cacheHit: rest.outcome === "cache_hit" || rest.outcome === "deduplicated_cache_hit",
    actor: /^[0-9a-f]{12}$/.test(rest.actor) ? rest.actor : UNVERIFIED_ACTOR,
    day: /^\d{4}-\d{2}-\d{2}$/.test(rest.day) ? rest.day : "invalid", vehicleRef: rest.vehicleRef.slice(0, 80), durationMs: Math.max(0, Math.round(rest.durationMs)), forthRequests: Math.max(0, Math.min(10, Math.trunc(rest.forthRequests))) };
  const r = ring(); r.push(event); if (r.length > MAX_REQUEST_EVENTS) r.splice(0, r.length - MAX_REQUEST_EVENTS);
  try { (log ?? ((line, payload) => console.info(line, JSON.stringify(payload))))("fleet_provider_request", event); } catch { /* logging must never break a request */ }
  return event;
}
export function recentProviderRequests(): ProviderRequestEvent[] { return ring().map(e => ({ ...e })); }
export function summariseByOrigin(events: readonly ProviderRequestEvent[] = ring()) {
  const out: Record<string, { requests: number; providerReads: number; cacheHits: number; refused: number; forthRequests: number }> = {};
  for (const e of events) {
    const o = (out[e.origin] ??= { requests: 0, providerReads: 0, cacheHits: 0, refused: 0, forthRequests: 0 });
    o.requests++; if (e.outcome === "provider_read") o.providerReads++; if (e.cacheHit) o.cacheHits++; if (e.outcome === "refused_before_provider") o.refused++; o.forthRequests += e.forthRequests;
  }
  return out;
}
/**
 * Maps a failed request to an outcome: a browser cancellation, a refusal before any Forth call, or a failure after Forth was contacted.
 * This is what makes "requests" and "Forth calls" reconcilable in diagnostics: a refused request is counted, but never as a Forth read.
 */
export function failureOutcome(input: { cancelled: boolean; forthRequests: number; status: number }): RequestOutcome {
  if (input.cancelled) return "cancelled";
  if (input.status === 429) return "rate_limited";
  return input.forthRequests > 0 ? "failed" : "refused_before_provider";
}
/** The history routes address Forth by device id, which this log never stores: a salted one-way reference keeps two devices apart. */
export const deviceRef = (deviceId: string) => `device-${actorRef(`device:${deviceId}`)}`;

type HistoryAuditOutcomeLike = "authorised_ready" | "rate_limited" | "upstream_unavailable" | string;
/**
 * Shared recorder for the two Forth history routes (journey playback, journey report). Called once per request from the route's
 * existing audit hook, so the existing audit event and its fields stay exactly as they were.
 */
export function historyRequestRecorder(input: { request: Request; route: "journey_playback" | "journey_report"; log?: typeof logProviderRequest }) {
  const started = Date.now();
  const id = parseRequestId(input.request.headers.get(REQUEST_ID_HEADER)), origin = parseOrigin(input.request.headers.get(ORIGIN_HEADER));
  const state = { actor: UNVERIFIED_ACTOR, vehicleRef: "", day: "", forthRequests: 0, done: false };
  return {
    setUser(userId: string) { state.actor = actorRef(userId); },
    setTarget(deviceId: string, day: string) { state.vehicleRef = deviceRef(deviceId); state.day = /^\d{8}$/.test(day) ? `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6)}` : day; },
    /** Call immediately before the one Forth history request this route makes. */
    providerCalled() { state.forthRequests++; },
    finish(auditOutcome: HistoryAuditOutcomeLike, status: number) {
      if (state.done) return null; state.done = true;
      const outcome: RequestOutcome = auditOutcome === "authorised_ready" ? "provider_read"
        : failureOutcome({ cancelled: input.request.signal?.aborted === true, forthRequests: state.forthRequests, status });
      try {
        return (input.log ?? logProviderRequest)({ id, route: input.route, actor: state.actor, origin, vehicleRef: state.vehicleRef, day: state.day, refresh: false, outcome, status,
          forthRequests: state.forthRequests, durationMs: Date.now() - started, waitedForInFlight: false });
      } catch { return null; }
    }
  };
}
export function resetProviderRequestLogForTests() { host.eesProviderRequestLog = []; host.eesProviderInflight = new Map(); }

/**
 * Same user, same vehicle, same day, already being read: wait for that read to settle instead of starting a second Forth call. The key includes
 * the user, so requests are never merged across users. The waiter then looks in the cache again; if the first read failed it proceeds on its own.
 */
export const inFlightKey = (userId: string, vehicleId: string, day: string) => `${userId}|${vehicleId}|${day}`;
export async function waitForInFlight(key: string): Promise<boolean> {
  const existing = inflight().get(key); if (!existing) return false;
  await existing.catch(() => undefined); return true;
}
export function registerInFlight(key: string): () => void {
  let release!: () => void; const p = new Promise<void>(r => { release = r; });
  inflight().set(key, p);
  return () => { if (inflight().get(key) === p) inflight().delete(key); release(); };
}
