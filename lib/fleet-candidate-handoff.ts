import "server-only";
import { HANDOFF_MAX_PER_USER, HANDOFF_MAX_TOTAL, HANDOFF_TTL_MS, type CandidatePayload } from "./fleet-location-candidate";

/**
 * Short-lived candidate handoff held in server process memory only. It is keyed by the authenticated user AND an unguessable token,
 * so another user (or a guessed token) reads nothing. Nothing is persisted: it expires after ten minutes, is lost on a server
 * restart and is not shared between server instances. It stores a summary, never raw positions.
 */
type Entry = { expires: number; payload: CandidatePayload };
const host = globalThis as typeof globalThis & { eesFleetCandidateHandoff?: Map<string, Entry> };
const store = host.eesFleetCandidateHandoff ??= new Map<string, Entry>();
const key = (userId: string, token: string) => JSON.stringify([userId, token]);
const sweep = (now: number) => { for (const [k, v] of store) if (v.expires <= now) store.delete(k); };

export function createHandoff(userId: string, payload: CandidatePayload, now = Date.now()): { token: string; expiresAt: string } {
  sweep(now);
  const mine = [...store.entries()].filter(([k]) => (JSON.parse(k) as [string, string])[0] === userId);
  while (mine.length >= HANDOFF_MAX_PER_USER) { const oldest = mine.shift(); if (oldest) store.delete(oldest[0]); }
  while (store.size >= HANDOFF_MAX_TOTAL) { const first = store.keys().next().value; if (first === undefined) break; store.delete(first); }
  const token = crypto.randomUUID(); const expires = now + HANDOFF_TTL_MS;
  store.set(key(userId, token), { expires, payload: { ...payload, createdAt: new Date(now).toISOString(), expiresAt: new Date(expires).toISOString() } });
  return { token, expiresAt: new Date(expires).toISOString() };
}
export type HandoffRead = { status: "ok"; payload: CandidatePayload } | { status: "expired" } | { status: "not_found" };
export function readHandoff(userId: string, token: string, now = Date.now()): HandoffRead {
  const k = key(userId, token); const entry = store.get(k);
  if (!entry) return { status: "not_found" };
  if (entry.expires <= now) { store.delete(k); return { status: "expired" }; }
  return { status: "ok", payload: entry.payload };
}
export function dismissHandoff(userId: string, token: string): boolean { return store.delete(key(userId, token)); }
export function handoffCountForTests() { return store.size; }
export function resetHandoffForTests() { store.clear(); }
