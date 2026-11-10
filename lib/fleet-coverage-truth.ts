/**
 * V7.8.4 tracking-coverage truth. Pure and read-only.
 *
 * Five different things were being summarised as "coverage":
 *   1. how many RECEIVED positions are GPS-verified (a quality share of what arrived);
 *   2. how much of the TIME has position evidence (GPS spacing of at most 5 minutes between verified positions);
 *   3. provider log gaps (more than 10 minutes between two log records, from the journey ledger);
 *   4. UNOBSERVED time under the GPS rule (any spacing over 5 minutes, a missing sample, an unverified or implausible position);
 *   5. whether the provider's own report is complete and reconciled.
 * They use different thresholds, so they legitimately disagree. 100% verified positions says nothing about time coverage, and zero
 * provider log gaps says nothing about unobserved time (a parked truck that misses a single report is a 10-minute spacing: unobserved
 * for GPS distance, not a "gap" for the ledger). This module computes them side by side, never converts one into another, and never
 * turns unobserved time into stationary time. Time is measured over the ELAPSED part of the day, so an in-progress day does not count
 * its future as missing.
 */
import { TELEMETRY_GAP_MS } from "./fleet-stop-intelligence";

export type CoverageGps = { start: string; end: string; state: string; reason: string | null; km: number | null };
export type CoverageInput = {
  day: string; nowMs?: number;
  /** Rows Forth returned that carry a usable time ("received positions") and how many of them are GPS-verified. */
  receivedPositions: number | null; verifiedPositions: number | null;
  gpsTimeline: readonly CoverageGps[] | null;
  /** The journey ledger's own gap figures (more than 10 minutes between log records), or null when there is no ledger. */
  ledger: { missingCount: number; missingMinutes: number; cadenceJitterGaps: number; openFinal: number } | null;
  provider: { read: boolean; reconciled: boolean; issues: readonly string[] };
};
export type ReasonBucket = { seconds: number; intervals: number };
export type CoverageTruth = {
  windowSeconds: number; inProgress: boolean;
  positions: { received: number | null; verified: number | null; verifiedPct: number | null };
  time: null | {
    supportedSeconds: number; supportedPct: number; unobservedSeconds: number; unobservedPct: number;
    byReason: Record<string, ReasonBucket>;
    /** Runs of unobserved time of 10 minutes or less (an ordinary missed report) and longer runs, counted separately. */
    short: ReasonBucket; long: ReasonBucket;
    /** Runs over 10 minutes that are chains of 5–10-minute spacings: the provider log shows no single spacing over 10 minutes, so these are not outages. */
    chained: ReasonBucket; longestRunSeconds: number;
  };
  providerLogGaps: null | { count: number; minutes: number; cadenceJitterGaps: number };
  provider: { state: "not_read" | "reconciled" | "withheld"; openSegments: number | null; issues: string[] };
  flags: {
    /** All received positions are verified, yet the time is not fully supported. */
    verificationIsNotCoverage: boolean;
    /** The ledger reports no gap, yet GPS time is unobserved: different gap definitions, not a contradiction. */
    zeroLogGapsButUnobservedTime: boolean;
  };
};

const ms = (iso: string) => Date.parse(iso);
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);

export function coverageTruth(input: CoverageInput): CoverageTruth {
  const dayStart = Date.parse(`${input.day}T00:00:00+07:00`), dayEnd = dayStart + 86_400_000;
  const nowMs = input.nowMs ?? Date.now();
  const winEnd = Math.max(dayStart, Math.min(dayEnd, nowMs));
  const windowSeconds = Math.round((winEnd - dayStart) / 1000);
  const clipSec = (s: number, e: number) => Math.max(0, Math.round((Math.min(e, winEnd) - Math.max(s, dayStart)) / 1000));

  const received = input.receivedPositions, verified = input.verifiedPositions;
  let time: CoverageTruth["time"] = null;
  if (input.gpsTimeline && windowSeconds > 0) {
    let supported = 0, unobserved = 0; const byReason: Record<string, ReasonBucket> = {};
    const short: ReasonBucket = { seconds: 0, intervals: 0 }, long: ReasonBucket = { seconds: 0, intervals: 0 }, chained: ReasonBucket = { seconds: 0, intervals: 0 };
    // When the ledger reports no spacing over 10 minutes, a longer unobserved run can only be several 5–10-minute spacings back to back (each just over the 5-minute GPS limit), never one outage.
    const noLongSpacing = input.ledger !== null && input.ledger.missingCount === 0; let longestRunSeconds = 0;
    // Contiguous unobserved intervals form one run; a run's length decides whether it was an ordinary missed report or a longer outage.
    let run: { s: number; e: number } | null = null;
    const closeRun = () => { if (!run) return; const sec = clipSec(run.s, run.e); if (sec > 0) { longestRunSeconds = Math.max(longestRunSeconds, sec); const b = run.e - run.s > TELEMETRY_GAP_MS ? (noLongSpacing ? chained : long) : short; b.seconds += sec; b.intervals++; } run = null; };
    for (const g of [...input.gpsTimeline].sort((a, b) => ms(a.start) - ms(b.start))) {
      const s = ms(g.start), e = ms(g.end), sec = clipSec(s, e);
      if (g.state === "unavailable") {
        unobserved += sec; const key = g.reason ?? "unknown_reason"; const b = (byReason[key] ??= { seconds: 0, intervals: 0 }); b.seconds += sec; if (sec > 0) b.intervals++;
        if (run && s <= run.e) run.e = Math.max(run.e, e); else { closeRun(); run = { s, e }; }
      } else { closeRun(); if (g.km !== null) supported += sec; else unobserved += sec; }
    }
    closeRun();
    time = { supportedSeconds: supported, supportedPct: pct(supported, windowSeconds), unobservedSeconds: unobserved, unobservedPct: pct(unobserved, windowSeconds), byReason, short, long, chained, longestRunSeconds };
  }
  const providerState: CoverageTruth["provider"]["state"] = !input.provider.read ? "not_read" : input.provider.reconciled ? "reconciled" : "withheld";
  const verifiedPct = received !== null && verified !== null && received > 0 ? pct(verified, received) : null;
  return {
    windowSeconds, inProgress: nowMs < dayEnd,
    positions: { received, verified, verifiedPct },
    time,
    providerLogGaps: input.ledger ? { count: input.ledger.missingCount, minutes: input.ledger.missingMinutes, cadenceJitterGaps: input.ledger.cadenceJitterGaps } : null,
    provider: { state: providerState, openSegments: input.ledger ? input.ledger.openFinal : null, issues: [...input.provider.issues] },
    flags: {
      verificationIsNotCoverage: verifiedPct === 100 && time !== null && time.supportedPct < 100,
      zeroLogGapsButUnobservedTime: input.ledger !== null && input.ledger.missingCount === 0 && time !== null && time.unobservedSeconds > 0
    }
  };
}

type Pair = readonly [string, string];
export const COVERAGE_DEFINITIONS: { id: "positions" | "time" | "log_gaps" | "unobserved" | "provider"; title: Pair; text: Pair }[] = [
  { id: "positions", title: ["Received positions verified", "ตำแหน่งที่ได้รับและยืนยันด้วย GPS"], text: ["The share of the positions Forth returned that carry a verified GPS fix. It describes the quality of what arrived, not how much of the day was tracked.", "สัดส่วนตำแหน่งที่ Forth ส่งมาและมีค่า GPS ยืนยัน บอกคุณภาพของข้อมูลที่ได้รับ ไม่ได้บอกว่าติดตามได้ครอบคลุมกี่ส่วนของวัน"] },
  { id: "time", title: ["Time with position evidence", "เวลาที่มีหลักฐานตำแหน่ง"], text: ["Time between two verified positions that are at most 5 minutes apart, over the part of the day that has passed.", "เวลาระหว่างสองตำแหน่งที่ยืนยันแล้วซึ่งห่างกันไม่เกิน 5 นาที นับเฉพาะส่วนของวันที่ผ่านไปแล้ว"] },
  { id: "log_gaps", title: ["Provider log gaps", "ช่วงที่ log ของผู้ให้บริการขาด"], text: ["More than 10 minutes between two Forth log records. A shorter spacing is not counted here, even when GPS distance treats it as unobserved.", "เกิน 10 นาทีระหว่างสองบันทึก log ของ Forth ช่วงที่สั้นกว่านี้ไม่นับที่นี่ แม้การคำนวณระยะทาง GPS จะถือว่าไม่ได้สังเกต"] },
  { id: "unobserved", title: ["Unobserved time", "เวลาที่ไม่ได้สังเกต"], text: ["Any time without a usable position pair: spacing over 5 minutes, a missing sample, an unverified or implausible position. It is never counted as stationary time.", "เวลาที่ไม่มีคู่ตำแหน่งที่ใช้ได้ เช่น ห่างเกิน 5 นาที ไม่มีตัวอย่าง ตำแหน่งไม่ยืนยัน หรือไม่สมเหตุสมผล ไม่นับเป็นการจอดนิ่ง"] },
  { id: "provider", title: ["Provider report", "รายงานของผู้ให้บริการ"], text: ["Whether Forth's own trip report reconciles with its total and has no open or invalid segments. Independent of the GPS measures above.", "รายงานเที่ยวของ Forth กระทบยอดกับยอดรวมได้และไม่มีช่วงที่ยังไม่ปิดหรือไม่ถูกต้องหรือไม่ แยกจากตัวชี้วัด GPS ข้างต้น"] }
];
export const REASON_COPY: Record<string, Pair> = {
  sample_gap: ["spacing over 5 minutes", "ห่างเกิน 5 นาที"], missing_samples: ["no samples recorded", "ไม่มีตัวอย่างที่บันทึก"], unverified_position: ["unverified position", "ตำแหน่งไม่ยืนยัน"],
  conflicting_timestamp: ["conflicting timestamps", "เวลาขัดแย้งกัน"], day_boundary_without_sample: ["day boundary without a sample", "ขอบเขตวันไม่มีตัวอย่าง"], unrealistic_jump: ["implausible jump", "กระโดดผิดปกติ"], counter_reset_or_conflict: ["distance counter reset or conflict", "ตัวนับระยะรีเซ็ตหรือขัดแย้ง"], unknown_reason: ["unspecified", "ไม่ระบุ"]
};
