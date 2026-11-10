import "server-only";
import type { ProviderDay } from "./fleet-intelligence-day";

// Ephemeral local review cache, partitioned by authenticated user. No source records persist.
// It is process memory only: a server restart, or a second server instance, forgets it.
export const PROVIDER_DAY_CACHE_TTL_MS = 30 * 60000;
type Entry = { expires: number; storedAt: number; evidence: ProviderDay };
const host = globalThis as typeof globalThis & { eesFleetIntelligenceReviewCache?: Map<string, Entry> };
const cache = host.eesFleetIntelligenceReviewCache ??= new Map<string, Entry>();
const key = (userId: string, vehicleId: string, registration: string, day: string) => JSON.stringify([userId, vehicleId, registration, day]);
export function rememberProviderDay(userId: string, evidence: ProviderDay) {
  const now = Date.now();
  for (const [k, v] of cache) if (v.expires <= now) cache.delete(k);
  if (cache.size >= 400) cache.delete(cache.keys().next().value!);
  cache.set(key(userId, evidence.vehicleId, evidence.registration, evidence.day), { storedAt: now, expires: now + PROVIDER_DAY_CACHE_TTL_MS, evidence });
}
/** The evidence plus when it was stored and when it will expire, or null. A failed refresh never calls remember, so older evidence is kept until it expires. */
export function recalledProviderDayEntry(userId: string, vehicleId: string, registration: string, day: string): { evidence: ProviderDay; storedAt: string; expiresAt: string } | null {
  const k = key(userId, vehicleId, registration, day), entry = cache.get(k);
  if (!entry || entry.expires <= Date.now()) { cache.delete(k); return null; }
  return { evidence: entry.evidence, storedAt: new Date(entry.storedAt).toISOString(), expiresAt: new Date(entry.expires).toISOString() };
}
export function recalledProviderDay(userId: string, vehicleId: string, registration: string, day: string): ProviderDay | null {
  return recalledProviderDayEntry(userId, vehicleId, registration, day)?.evidence ?? null;
}
