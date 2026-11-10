/**
 * V6.2 privacy-safe, bounded diagnostics for historical provider reads. Process memory only: nothing is persisted, there is no
 * telemetry export, and a server restart clears it. It records outcomes, HTTP statuses and durations only: never coordinates,
 * device ids, registrations, tokens, user ids or provider payloads.
 */
export type ProviderReadOutcome = "cache_hit" | "provider_read" | "rate_limited" | "device_refused" | "provider_error" | "invalid_request" | "unauthorised" | "client_cancelled" | "other_error";
export type ProviderReadEvent = { at: string; outcome: ProviderReadOutcome; status: number; durationMs: number; forthRequests: number };
export type ProviderMetricsSnapshot = {
  since: string; requests: number; cacheHits: number; cacheMisses: number; providerReads: number; forthRequestsMade: number;
  rateLimited: number; deviceRefused: number; providerErrors: number; otherErrors: number; byStatus: Record<string, number>; recent: ProviderReadEvent[];
  note: string;
};

export const MAX_RECENT_EVENTS = 50;
type State = { since: number; counts: Omit<ProviderMetricsSnapshot, "since" | "recent" | "note" | "byStatus">; byStatus: Record<string, number>; recent: ProviderReadEvent[] };
const host = globalThis as typeof globalThis & { eesFleetProviderMetrics?: State };
const fresh = (): State => ({ since: Date.now(), counts: { requests: 0, cacheHits: 0, cacheMisses: 0, providerReads: 0, forthRequestsMade: 0, rateLimited: 0, deviceRefused: 0, providerErrors: 0, otherErrors: 0 }, byStatus: {}, recent: [] });
const state = () => (host.eesFleetProviderMetrics ??= fresh());

/** Forth report reads made for one provider read: the parking report and the log report (the fleet identity read is cached separately). */
export const FORTH_REQUESTS_PER_READ = 2;

export function recordProviderRead(event: { outcome: ProviderReadOutcome; status: number; durationMs: number; forthRequests?: number }) {
  const s = state(); const c = s.counts;
  c.requests++;
  const forth = Math.max(0, Math.min(10, Math.trunc(event.forthRequests ?? 0)));
  c.forthRequestsMade += forth;
  if (event.outcome === "cache_hit") c.cacheHits++; else if (event.outcome !== "invalid_request" && event.outcome !== "unauthorised" && event.outcome !== "client_cancelled") c.cacheMisses++;
  if (event.outcome === "provider_read") c.providerReads++;
  if (event.outcome === "rate_limited") c.rateLimited++;
  if (event.outcome === "device_refused") c.deviceRefused++;
  if (event.outcome === "provider_error") c.providerErrors++;
  if (event.outcome === "other_error") c.otherErrors++;
  const key = String(Math.trunc(event.status));
  s.byStatus[key] = (s.byStatus[key] ?? 0) + 1;
  s.recent.push({ at: new Date().toISOString(), outcome: event.outcome, status: Math.trunc(event.status), durationMs: Math.max(0, Math.round(event.durationMs)), forthRequests: forth });
  if (s.recent.length > MAX_RECENT_EVENTS) s.recent.splice(0, s.recent.length - MAX_RECENT_EVENTS);
}

export function providerMetricsSnapshot(): ProviderMetricsSnapshot {
  const s = state();
  return { since: new Date(s.since).toISOString(), ...s.counts, byStatus: { ...s.byStatus }, recent: s.recent.map(e => ({ ...e })), note: "Process memory only. No coordinates, device ids, registrations or user ids are recorded. Cleared on server restart." };
}
export function resetProviderMetricsForTests() { host.eesFleetProviderMetrics = fresh(); }
