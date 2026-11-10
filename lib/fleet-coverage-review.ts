/**
 * V7.8.2 controlled historical coverage review (pure). It plans and counts the explicit, bounded, one-at-a-time vehicle-day reads that the
 * existing read queue (`runReadQueue`, concurrency 1, stops on rate limit) performs. A vehicle-day counts as REVIEWED only when the server
 * reports it in this user's cache; queued, reading, failed, cancelled or expired days are never counted. Nothing here calls Forth.
 */
import { FLEET_READ_CAP, type ReadState } from "./fleet-day-review";

export const PERIOD_READ_CAP = FLEET_READ_CAP;
/** "Checked vehicles" is a deliberately small set. */
export const MAX_CHECKED_VEHICLES = 5;
export type PeriodReadState = ReadState | "cancelled";
export type PlanScope = "selected" | "checked" | "batch";
export type CoverageRowLite = { vehicleId: string; registration: string; eligible: boolean; reviewedDayList: readonly string[] };

export const dayKey = (vehicleId: string, day: string) => `${vehicleId}|${day}`;
export function parseKey(key: string): { vehicleId: string; day: string } | null {
  const i = key.lastIndexOf("|"); if (i <= 0) return null;
  const vehicleId = key.slice(0, i), day = key.slice(i + 1);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && vehicleId.length > 0 && vehicleId.length <= 80 ? { vehicleId, day } : null;
}

const bangkokToday = (now: Date) => new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
/** Bangkok calendar days from..to that can be reviewed: today is excluded (its evidence would be incomplete) and so is the future. */
export function reviewableDays(from: string, to: string, now: Date = new Date()): string[] {
  const today = bangkokToday(now), out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`) && out.length < 62; t += 86_400_000) { const d = new Date(t).toISOString().slice(0, 10); if (d < today) out.push(d); }
  return out;
}

export type CoverageNumbers = { eligibleVehicles: number; eligibleVehicleDays: number; reviewed: number; missing: number; percent: number | null };
/** Numerator/denominator over eligible vehicles and reviewable days only. */
export function coverageNumbers(rows: readonly CoverageRowLite[], days: readonly string[]): CoverageNumbers {
  const eligible = rows.filter(r => r.eligible), set = new Set(days);
  const total = eligible.length * days.length;
  const reviewed = eligible.reduce((n, r) => n + new Set(r.reviewedDayList.filter(d => set.has(d))).size, 0);
  return { eligibleVehicles: eligible.length, eligibleVehicleDays: total, reviewed, missing: Math.max(0, total - reviewed), percent: total ? Math.round((reviewed / total) * 1000) / 10 : null };
}

export type ReadPlan = { keys: string[]; totalMissing: number; capped: boolean; vehicles: number };
/**
 * The vehicle-days one run would request. Only eligible vehicles and only reviewable days not already reviewed. "selected" is one vehicle,
 * "checked" a small set (at most MAX_CHECKED_VEHICLES), "batch" the most recent missing days across eligible vehicles. Every run is capped
 * at PERIOD_READ_CAP requests; the rest simply stay missing. Duplicates collapse.
 */
export function buildReadPlan(input: { rows: readonly CoverageRowLite[]; days: readonly string[]; scope: PlanScope; selectedId?: string | null; checkedIds?: readonly string[]; limit?: number }): ReadPlan {
  const limit = Math.max(1, Math.min(input.limit ?? PERIOD_READ_CAP, PERIOD_READ_CAP));
  const checked = new Set((input.checkedIds ?? []).slice(0, MAX_CHECKED_VEHICLES));
  const pool = input.rows.filter(r => r.eligible && (input.scope === "batch" || (input.scope === "selected" ? r.vehicleId === input.selectedId : checked.has(r.vehicleId))));
  const entries: { key: string; day: string; reg: string }[] = []; const seen = new Set<string>();
  for (const r of pool) { const done = new Set(r.reviewedDayList); for (const d of input.days) { const key = dayKey(r.vehicleId, d); if (!done.has(d) && !seen.has(key)) { seen.add(key); entries.push({ key, day: d, reg: r.registration }); } } }
  entries.sort((a, b) => b.day.localeCompare(a.day) || a.reg.localeCompare(b.reg));
  const keys = entries.slice(0, limit).map(e => e.key);
  return { keys, totalMissing: entries.length, capped: entries.length > keys.length, vehicles: new Set(keys.map(k => parseKey(k)!.vehicleId)).size };
}

export type ReadCounts = { total: number; queued: number; reading: number; done: number; failed: number; cancelled: number; rateLimited: number; noDevice: number; unavailable: number; notStarted: number };
export function countReads(keys: readonly string[], states: Readonly<Record<string, PeriodReadState>>): ReadCounts {
  const c: ReadCounts = { total: keys.length, queued: 0, reading: 0, done: 0, failed: 0, cancelled: 0, rateLimited: 0, noDevice: 0, unavailable: 0, notStarted: 0 };
  for (const k of keys) { const s = states[k] ?? "idle"; if (s === "queued") c.queued++; else if (s === "loading") c.reading++; else if (s === "done") c.done++; else if (s === "failed") c.failed++; else if (s === "cancelled") c.cancelled++; else if (s === "rate_limited") c.rateLimited++; else if (s === "no_device") c.noDevice++; else if (s === "unavailable") c.unavailable++; else c.notStarted++; }
  return c;
}
/** After a run ends: days that never completed become "cancelled" if the user stopped it, otherwise they stay not started. Completed and failed results are kept. A request already sent cannot be undone. */
export function finalizeStates(keys: readonly string[], states: Readonly<Record<string, PeriodReadState>>, userCancelled: boolean): Record<string, PeriodReadState> {
  const next: Record<string, PeriodReadState> = { ...states };
  for (const k of keys) { const s = next[k] ?? "idle"; if (s === "queued" || s === "loading" || s === "idle") next[k] = userCancelled ? "cancelled" : "idle"; }
  return next;
}

/** Vehicle-days that were reviewed on the previous check but are not in the cache now: expired (never silently counted, never re-fetched). */
export function expiredSince(previous: ReadonlySet<string>, current: ReadonlySet<string>): string[] {
  return [...previous].filter(k => !current.has(k)).sort();
}
export function reviewedKeySet(rows: readonly CoverageRowLite[], days: readonly string[]): Set<string> {
  const allowed = new Set(days), out = new Set<string>();
  for (const r of rows) for (const d of r.reviewedDayList) if (allowed.has(d)) out.add(dayKey(r.vehicleId, d));
  return out;
}

type Pair = readonly [string, string];
export const REVIEW_COPY = {
  reviewedDay: ["Reviewed day", "วันที่ตรวจแล้ว"], missingDay: ["Missing day", "วันที่ยังไม่มี"], queued: ["Queued", "รอคิว"], reading: ["Reading", "กำลังอ่าน"], done: ["Read", "อ่านแล้ว"],
  cancelled: ["Cancelled", "ยกเลิก"], failed: ["Failed", "ล้มเหลว"], rateLimited: ["Rate limited", "ถึงขีดจำกัด"], cacheExpired: ["Cache expired", "แคชหมดอายุ"],
  sourceEvidence: ["Source evidence", "หลักฐานต้นทาง"], fuelPurchase: ["Recorded fuel purchase", "การซื้อเชื้อเพลิงที่บันทึก"], odometerInterval: ["Odometer interval", "ช่วงเลขไมล์"],
  comparable: ["Comparable", "เปรียบเทียบได้"], notComparable: ["Not comparable", "เปรียบเทียบไม่ได้"], reviewCandidate: ["Review candidate", "ควรตรวจสอบ"], insufficient: ["Insufficient evidence", "หลักฐานไม่พอ"],
  confirmed: ["Observed in source", "พบในข้อมูลต้นทาง"], openInvestigation: ["Open investigation", "เปิดการตรวจสอบ"]
} as const satisfies Record<string, Pair>;
export const reviewText = (key: keyof typeof REVIEW_COPY, language: "en" | "th") => REVIEW_COPY[key][language === "th" ? 1 : 0];
