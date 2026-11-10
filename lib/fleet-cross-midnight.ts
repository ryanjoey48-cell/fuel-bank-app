/**
 * V7.8.4 cross-midnight continuity. Pure, read-only, no coordinates.
 *
 * Verified on 3ฒน-9565, 1–2 Nov 2026: Forth's report for 1 Nov ended with a segment that started at 23:57:32 with no end time (0 km), and
 * its report for 2 Nov had no segment before 06:20. GPS showed the truck moving from 23:55 to 04:36 (about 307.7 km). Forth counted that
 * trip on neither day. This module recognises that shape from two consecutive, already-reviewed vehicle-days and presents the
 * GPS-observed continuation SEPARATELY. It never changes a provider total, never adds the movement to either day, never requests the
 * next day, and counts every GPS interval at most once. GPS chords are sampled path estimates, not proof of every kilometre travelled.
 */
import { TELEMETRY_GAP_MS } from "./fleet-stop-intelligence";
import type { ChronoGps } from "./fleet-day-chronology";

export type CrossMidnightDay = {
  day: string;
  journeys: readonly { id: string; start: string; end: string | null; kind: "moving" | "stopped" | "open_final"; providerKm: number }[];
  gps: readonly ChronoGps[] | null;
};
export type CrossMidnightStatus =
  | "continuation_observed"          // provider reports leave the movement out and GPS shows it across midnight
  | "open_segment_no_continuation"   // the previous day ends open, but no unreported GPS movement continues across midnight
  | "not_applicable"                 // nothing at the boundary
  | "next_day_not_reviewed" | "previous_day_not_reviewed" | "gps_unavailable";
export type ContinuationWindow = { day: string; start: string; end: string; minutes: number; km: number };
export type CrossMidnight = {
  status: CrossMidnightStatus;
  boundary: string;
  openSegment: { day: string; start: string } | null;
  firstProviderSegmentNextDay: string | null;
  windows: ContinuationWindow[];
  observedStart: string | null; observedEnd: string | null;
  gpsKm: { previousDay: number; nextDay: number; total: number } | null;
  /** GPS movement that only partly overlaps a provider segment: shown as uncertainty, not added to the continuation. */
  edgeIntervals: number; edgeKm: number;
  /** Unobserved time inside the continuation's own span (unavailable GPS intervals), in minutes. */
  unobservedInsideMinutes: number | null;
  providerAllocation: "none_found" | "partly_found" | null;
  reliability: "verified_gps" | null;
  limits: ("sampled_path_estimate" | "provider_totals_unchanged" | "cause_not_established" | "unobserved_time_inside")[];
};

const ms = (iso: string) => Date.parse(iso);
const GPS_EDGE_MS = 5 * 60_000;
const r2 = (n: number) => Math.round(n * 100) / 100;
export const nextBangkokDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

export function detectCrossMidnight(previous: CrossMidnightDay | null, next: CrossMidnightDay | null, day: string): CrossMidnight {
  const nextDay = nextBangkokDay(day);
  const boundaryMs = Date.parse(`${nextDay}T00:00:00+07:00`);
  const empty = (status: CrossMidnightStatus, extra: Partial<CrossMidnight> = {}): CrossMidnight => ({ status, boundary: new Date(boundaryMs).toISOString(), openSegment: null, firstProviderSegmentNextDay: null, windows: [], observedStart: null, observedEnd: null, gpsKm: null, edgeIntervals: 0, edgeKm: 0, unobservedInsideMinutes: null, providerAllocation: null, reliability: null, limits: [], ...extra });
  if (!previous || previous.day !== day) return empty("previous_day_not_reviewed");
  // The open segment is known from the previous day alone, so it is reported even when continuity cannot be checked: the office then sees
  // why a check is worth making. Nothing is requested for the missing day.
  const open = previous.journeys.find(j => j.kind === "open_final") ?? null;
  const openSegment = open ? { day, start: open.start } : null;
  if (!next || next.day !== nextDay) return empty("next_day_not_reviewed", { openSegment });
  if (!previous.gps || !next.gps) return empty("gps_unavailable", { openSegment });
  const firstNext = [...next.journeys].filter(j => j.kind !== "open_final").sort((a, b) => ms(a.start) - ms(b.start))[0] ?? next.journeys[0] ?? null;
  const providerIvs = [...previous.journeys, ...next.journeys].filter(j => j.kind === "moving" && j.end).map(j => ({ s: ms(j.start), e: ms(j.end!) }));

  type Mv = { day: string; s: number; e: number; km: number; start: string; end: string };
  const outside: Mv[] = []; let edgeIntervals = 0, edgeKm = 0;
  const seen = new Set<string>(); // an interval can appear once only, whatever the caller passed
  for (const [d, list] of [[previous.day, previous.gps], [next.day, next.gps]] as const) for (const g of list) {
    if (g.state !== "moving" || g.km === null) continue;
    const key = `${g.start}|${g.end}`; if (seen.has(key)) continue; seen.add(key);
    const s = ms(g.start), e = ms(g.end);
    if (providerIvs.some(p => s >= p.s - GPS_EDGE_MS && e <= p.e + GPS_EDGE_MS)) continue;      // the same movement the provider reports
    if (providerIvs.some(p => Math.min(e, p.e) - Math.max(s, p.s) > 0)) { edgeIntervals++; edgeKm += g.km; continue; } // partly overlaps a provider segment: uncertain
    outside.push({ day: d, s, e, km: g.km, start: g.start, end: g.end });
  }
  outside.sort((a, b) => a.s - b.s);
  // The continuation is the chain of unreported movement that reaches across the boundary; breaks of up to 10 minutes (a short stop, a missed report) do not end it.
  const chains: Mv[][] = [];
  for (const m of outside) { const last = chains.at(-1); if (last && m.s - last.at(-1)!.e <= TELEMETRY_GAP_MS) last.push(m); else chains.push([m]); }
  const chain = chains.find(c => c[0].s <= boundaryMs + TELEMETRY_GAP_MS && c.at(-1)!.e >= boundaryMs - TELEMETRY_GAP_MS) ?? null;
  const bothSides = chain !== null && chain.some(m => m.day === day) && chain.some(m => m.day === nextDay);
  const base = { openSegment, firstProviderSegmentNextDay: firstNext?.start ?? null, edgeIntervals, edgeKm: r2(edgeKm) };
  if (!chain || (!bothSides && !openSegment)) return empty(openSegment ? "open_segment_no_continuation" : "not_applicable", base);
  if (!bothSides) return empty("open_segment_no_continuation", base); // movement on one side only: not shown as a crossing

  const windows: ContinuationWindow[] = chain.map(m => ({ day: m.day, start: m.start, end: m.end, minutes: Math.round((m.e - m.s) / 60_000), km: r2(m.km) }));
  const sumDay = (d: string) => r2(chain.filter(m => m.day === d).reduce((n, m) => n + Math.round(m.km * 100), 0) / 100);
  const a = sumDay(day), b = sumDay(nextDay);
  const spanS = chain[0].s, spanE = chain.at(-1)!.e;
  const unobserved = Math.round([...previous.gps, ...next.gps].filter(g => g.state === "unavailable").reduce((n, g) => n + Math.max(0, Math.min(ms(g.end), spanE) - Math.max(ms(g.start), spanS)), 0) / 60_000);
  const touched = providerIvs.some(p => Math.min(spanE, p.e) - Math.max(spanS, p.s) > 0);
  return {
    status: "continuation_observed", boundary: new Date(boundaryMs).toISOString(), ...base,
    windows, observedStart: chain[0].start, observedEnd: chain.at(-1)!.end,
    gpsKm: { previousDay: a, nextDay: b, total: r2(a + b) }, unobservedInsideMinutes: unobserved,
    providerAllocation: touched ? "partly_found" : "none_found", reliability: "verified_gps",
    limits: ["sampled_path_estimate", "provider_totals_unchanged", "cause_not_established", ...(unobserved > 0 ? ["unobserved_time_inside" as const] : [])]
  };
}

type Pair = readonly [string, string];
export const CROSS_MIDNIGHT_COPY: Record<CrossMidnightStatus, Pair> = {
  continuation_observed: ["GPS shows movement continuing across midnight that Forth's daily reports do not count.", "GPS แสดงการเคลื่อนที่ต่อเนื่องข้ามเที่ยงคืนซึ่งรายงานรายวันของ Forth ไม่ได้นับ"],
  open_segment_no_continuation: ["The Forth report ends with an open segment, but no unreported GPS movement continues across midnight.", "รายงาน Forth จบด้วยช่วงที่ยังไม่ปิด แต่ไม่พบการเคลื่อนที่ของ GPS ที่ไม่ได้รายงานต่อเนื่องข้ามเที่ยงคืน"],
  not_applicable: ["Nothing unusual at the day boundary.", "ไม่พบสิ่งผิดปกติที่รอยต่อวัน"],
  next_day_not_reviewed: ["The next day has not been read, so continuity across midnight cannot be checked. Nothing was requested.", "ยังไม่ได้อ่านวันถัดไป จึงตรวจความต่อเนื่องข้ามเที่ยงคืนไม่ได้ และไม่มีการร้องขอข้อมูล"],
  previous_day_not_reviewed: ["The previous day has not been read.", "ยังไม่ได้อ่านวันก่อนหน้า"],
  gps_unavailable: ["A GPS log is missing for one of the two days.", "ไม่มี log GPS ของหนึ่งในสองวัน"]
};
export const CROSS_MIDNIGHT_LIMITS: Record<CrossMidnight["limits"][number], Pair> = {
  sampled_path_estimate: ["GPS distance is a sampled path estimate, not proof of every kilometre.", "ระยะทาง GPS เป็นค่าประมาณจากตัวอย่าง ไม่ใช่หลักฐานทุกกิโลเมตร"],
  provider_totals_unchanged: ["Forth's totals are unchanged and this movement is added to neither day.", "ยอดของ Forth ไม่เปลี่ยน และการเคลื่อนที่นี้ไม่ถูกบวกเข้าวันใดวันหนึ่ง"],
  cause_not_established: ["Why Forth left it out is not established. It is not evidence of misuse or a faulty tracker.", "ยังไม่ทราบสาเหตุที่ Forth ไม่นับ ไม่ใช่หลักฐานการใช้งานผิดปกติหรืออุปกรณ์เสีย"],
  unobserved_time_inside: ["Some time inside this span has no usable position.", "บางช่วงเวลาในช่วงนี้ไม่มีตำแหน่งที่ใช้ได้"]
};
