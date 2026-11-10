/**
 * V6 booking-independent vehicle-day insights. Pure and read-only: it only reads the journey ledger that the server already
 * releases to authorised callers (no coordinates), the Forth day total and position counts. Nothing is saved, merged or
 * confirmed. Missing evidence stays unknown, never zero, and an unknown tracking gap is never counted as a stay.
 * Bookings are not an input: the view must be identical with zero Booking Diary records.
 */
import type { Journey, JourneyLedger } from "./fleet-journey-ledger";

export const LONG_DISTANCE_KM = 300;
export const LONG_STOP_MINUTES = 120;
export const TRACKING_GAP_MINUTES = 60;
export const MOSTLY_STATIONARY_SHARE = 0.9;
export const MIN_COVERAGE_FOR_INACTIVITY = 0.8;
export const IDLE_MIN_STOP_MINUTES = 15;
export const MEANINGFUL_STOP_MINUTES = 5;
export const MANY_STOPS = 8;
export const BOUNDARY_MINUTES = 10;
export const TRAIL_DIFFERENCE_PCT = 1;
const DAY_MINUTES = 24 * 60;

export type CoverageState =
  | "not_read" | "restricted" | "provider_distance_only" | "no_positions" | "unverified" | "partly_verified" | "verified_incomplete" | "verified_complete";

export type InsightId =
  | "long_distance" | "long_stop" | "mostly_stationary" | "tracking_gap" | "provider_trail_difference" | "unverified_positions"
  | "starts_mid_journey" | "ends_mid_journey" | "engine_on_during_stop" | "ambiguous_segments" | "many_stops";
export type Reliability = "verified_gps" | "provider_reported" | "mixed" | "unknown";

export type Insight = {
  id: InsightId;
  day: string;
  reliability: Reliability;
  /** Numbers behind the flag, always shown with the insight. */
  evidence: Record<string, number | string | null>;
};

export type DayActivity = {
  movingJourneys: number | null;
  stops: number | null;
  movingMinutes: number | null;
  stoppedMinutes: number | null;
  longestStopMinutes: number | null;
  missingMinutes: number | null;
  /** Share of the 24 h day with report segments and no missing history, or null when it cannot be known. */
  coverageShare: number | null;
  firstSegmentStart: string | null;
  lastSegmentEnd: string | null;
  startedMoving: boolean | null;
  endedMoving: boolean | null;
  observations: number | null;
  verifiedObservations: number | null;
};

/** Why the number of positions analysed can be lower than the number Forth returned. Nothing is lost without a reason. */
export type PositionCountReconciliation = { received: number | null; analysed: number | null; exactDuplicates: number | null; noValidTime: number | null; explained: boolean | null };
export type CoverageReason = "missing_history" | "open_final_segment" | "ambiguous_segments" | "provider_total_not_reconciled";
export type DayInsights = { day: string; coverage: CoverageState; coverageReasons: CoverageReason[]; activity: DayActivity; insights: Insight[]; positionCount: PositionCountReconciliation };

/** Why verified GPS still counts as incomplete. Empty for every other state. */
export function coverageReasons(input: DayInsightsInput): CoverageReason[] {
  const L = input.ledger; const out: CoverageReason[] = [];
  if (!L || input.journeysRestricted || !input.providerRead) return out;
  if (L.totals.missingMinutes > 10) out.push("missing_history");
  if (L.totals.openFinal > 0) out.push("open_final_segment");
  if (L.totals.ambiguousJourneys > 0) out.push("ambiguous_segments");
  if (!input.providerReconciled) out.push("provider_total_not_reconciled");
  return out;
}

/**
 * received = rows Forth returned. analysed = rows kept after removing exact duplicates (same time, distance and speed).
 * Rows without a readable timestamp cannot be placed on a timeline and are set aside; they are the remainder.
 */
export function reconcilePositionCount(received: number | null, analysed: number | null, exactDuplicates: number | null): PositionCountReconciliation {
  if (received === null || analysed === null || exactDuplicates === null) return { received, analysed, exactDuplicates, noValidTime: null, explained: null };
  const remainder = received - analysed - exactDuplicates;
  return { received, analysed, exactDuplicates, noValidTime: remainder >= 0 ? remainder : null, explained: remainder >= 0 };
}

export type DayInsightsInput = {
  day: string;
  providerRead: boolean;
  providerKm: number | null;
  providerReconciled: boolean;
  ledger: JourneyLedger | null;
  journeysRestricted: boolean;
  observations: number | null;
  verifiedObservations: number | null;
  /** Rows Forth returned before any filtering, when known. */
  receivedObservations?: number | null;
};

const r1 = (n: number) => Math.round(n * 10) / 10;
const sum = (vals: (number | null)[]) => vals.reduce<number>((n, v) => n + (v ?? 0), 0);
const ms = (iso: string | null) => (iso ? Date.parse(iso) : Number.NaN);

function reliabilityOf(source: Journey["positionSource"] | "unknown"): Reliability {
  return source === "gps" ? "verified_gps" : source === "no_gps" ? "provider_reported" : source === "mixed" ? "mixed" : "unknown";
}

/** How much of the day can be said to be tracked: provider report time minus known missing history. Null when no report exists. */
function coverageShareOf(ledger: JourneyLedger): number | null {
  const reportMinutes = sum(ledger.journeys.map(j => j.minutes));
  if (reportMinutes <= 0) return null;
  const share = (reportMinutes - ledger.totals.missingMinutes) / DAY_MINUTES;
  return Math.max(0, Math.min(1, Math.round(share * 1000) / 1000));
}

export function classifyCoverage(input: DayInsightsInput): CoverageState {
  if (!input.providerRead) return "not_read";
  if (input.journeysRestricted) return "restricted";
  const L = input.ledger;
  if (!L) return "provider_distance_only";
  if (L.totals.observations === 0 || L.totals.positionSource === "none") return "no_positions";
  if (L.totals.positionSource === "no_gps") return "unverified";
  if (L.totals.positionSource === "mixed") return "partly_verified";
  const incomplete = L.totals.missingMinutes > 10 || L.totals.openFinal > 0 || L.totals.ambiguousJourneys > 0 || !input.providerReconciled;
  return incomplete ? "verified_incomplete" : "verified_complete";
}

export function buildDayInsights(input: DayInsightsInput): DayInsights {
  const coverage = classifyCoverage(input);
  const L = coverage === "restricted" ? null : input.ledger;
  const insights: Insight[] = [];
  const empty: DayActivity = { movingJourneys: null, stops: null, movingMinutes: null, stoppedMinutes: null, longestStopMinutes: null, missingMinutes: null, coverageShare: null, firstSegmentStart: null, lastSegmentEnd: null, startedMoving: null, endedMoving: null, observations: input.observations, verifiedObservations: input.verifiedObservations };
  if (!L) {
    // Without the ledger only the provider total can speak, and only for distance.
    if (input.providerRead && input.providerReconciled && input.providerKm !== null && input.providerKm >= LONG_DISTANCE_KM) {
      insights.push({ id: "long_distance", day: input.day, reliability: "provider_reported", evidence: { providerKm: r1(input.providerKm), thresholdKm: LONG_DISTANCE_KM } });
    }
    return { day: input.day, coverage, coverageReasons: coverageReasons(input), activity: empty, insights, positionCount: reconcilePositionCount(input.receivedObservations ?? null, null, null) };
  }

  const source = L.totals.positionSource;
  const rel = reliabilityOf(source);
  const ordered = [...L.journeys].sort((a, b) => ms(a.start) - ms(b.start));
  const clean = ordered.filter(j => !j.ambiguous);
  const moving = clean.filter(j => j.kind === "moving");
  const stopped = clean.filter(j => j.kind === "stopped");
  const movingMinutes = sum(moving.map(j => j.minutes)), stoppedMinutes = sum(stopped.map(j => j.minutes));
  const longest = stopped.reduce<number | null>((m, j) => (j.minutes !== null && (m === null || j.minutes > m) ? j.minutes : m), null);
  const share = coverageShareOf(L);
  const first = ordered[0] ?? null, last = ordered.at(-1) ?? null;
  const activity: DayActivity = {
    movingJourneys: moving.length, stops: stopped.length, movingMinutes: r1(movingMinutes), stoppedMinutes: r1(stoppedMinutes), longestStopMinutes: longest === null ? null : r1(longest),
    missingMinutes: L.totals.missingMinutes, coverageShare: share, firstSegmentStart: first?.start ?? null, lastSegmentEnd: last ? (last.end ?? last.start) : null,
    startedMoving: first ? first.kind === "moving" : null, endedMoving: last ? last.kind === "moving" || last.kind === "open_final" : null,
    observations: input.observations ?? L.totals.observations, verifiedObservations: input.verifiedObservations
  };

  if (input.providerReconciled && input.providerKm !== null && input.providerKm >= LONG_DISTANCE_KM) insights.push({ id: "long_distance", day: input.day, reliability: "provider_reported", evidence: { providerKm: r1(input.providerKm), thresholdKm: LONG_DISTANCE_KM } });
  // A long stay is flagged only on observed time inside the report; unknown gaps are never added to it.
  const longStops = stopped.filter(j => (j.minutes ?? 0) >= LONG_STOP_MINUTES).sort((a, b) => (b.minutes ?? 0) - (a.minutes ?? 0));
  if (longStops.length) insights.push({ id: "long_stop", day: input.day, reliability: rel, evidence: { longestMinutes: r1(longStops[0].minutes ?? 0), start: longStops[0].start, stopsOverThreshold: longStops.length, thresholdMinutes: LONG_STOP_MINUTES, gapsInsideLongest: longStops[0].gapsInside } });
  if (L.totals.missingMinutes >= TRACKING_GAP_MINUTES) {
    const biggest = [...L.missing].sort((a, b) => b.minutes - a.minutes)[0];
    insights.push({ id: "tracking_gap", day: input.day, reliability: "unknown", evidence: { missingMinutes: L.totals.missingMinutes, longestGapMinutes: biggest ? r1(biggest.minutes) : null, longestGapStart: biggest?.start ?? null, thresholdMinutes: TRACKING_GAP_MINUTES } });
  }
  // Inactivity needs adequate tracking coverage: an untracked day is unknown, not inactive.
  const trackedMinutes = movingMinutes + stoppedMinutes;
  if (share !== null && share >= MIN_COVERAGE_FOR_INACTIVITY && trackedMinutes > 0 && stoppedMinutes / trackedMinutes >= MOSTLY_STATIONARY_SHARE && (input.providerKm ?? 0) < 10) {
    insights.push({ id: "mostly_stationary", day: input.day, reliability: rel, evidence: { stoppedShare: r1((stoppedMinutes / trackedMinutes) * 100), providerKm: input.providerKm === null ? null : r1(input.providerKm), coverageShare: share } });
  }
  const trail = L.totals.reportedTrailKm;
  if (input.providerReconciled && trail !== null && input.providerKm !== null && input.providerKm > 0) {
    const pct = r1(((trail - input.providerKm) / input.providerKm) * 100);
    if (Math.abs(pct) > TRAIL_DIFFERENCE_PCT) insights.push({ id: "provider_trail_difference", day: input.day, reliability: "provider_reported", evidence: { providerKm: r1(input.providerKm), trailKm: r1(trail), differencePct: pct } });
  }
  if (source === "no_gps" || source === "mixed") insights.push({ id: "unverified_positions", day: input.day, reliability: rel, evidence: { observations: input.observations ?? L.totals.observations, verifiedObservations: input.verifiedObservations } });
  // Only a segment touching the day boundary hides the true departure or return; a move that starts at 05:18 is an observed departure.
  const dayStart = Date.parse(`${input.day}T00:00:00+07:00`), dayEnd = dayStart + DAY_MINUTES * 60_000, edge = BOUNDARY_MINUTES * 60_000;
  const startsAtBoundary = first?.kind === "moving" && Number.isFinite(dayStart) && ms(first.start) - dayStart <= edge;
  const lastEnd = last ? ms(last.end ?? last.start) : Number.NaN;
  const endsAtBoundary = last !== null && (last.kind === "open_final" || (last.kind === "moving" && Number.isFinite(dayEnd) && dayEnd - lastEnd <= edge));
  if (startsAtBoundary && first) insights.push({ id: "starts_mid_journey", day: input.day, reliability: rel, evidence: { firstSegmentStart: first.start } });
  if (endsAtBoundary && last) insights.push({ id: "ends_mid_journey", day: input.day, reliability: rel, evidence: { lastSegmentKind: last.kind, lastSegmentStart: last.start } });
  // Engine-on during a stop uses the provider's engine flag, never zero speed.
  const idling = stopped.filter(j => (j.minutes ?? 0) >= IDLE_MIN_STOP_MINUTES && j.engineOnObservations !== null && j.observations > 0 && j.engineOnObservations / j.observations >= 0.5);
  if (idling.length) insights.push({ id: "engine_on_during_stop", day: input.day, reliability: "provider_reported", evidence: { stops: idling.length, longestMinutes: r1(Math.max(...idling.map(j => j.minutes ?? 0))), engineFlag: "provider_reported" } });
  if (L.totals.ambiguousJourneys > 0) insights.push({ id: "ambiguous_segments", day: input.day, reliability: "unknown", evidence: { ambiguousJourneys: L.totals.ambiguousJourneys } });
  // Forth reports many very short stop segments (traffic, junctions); only stops of a meaningful length count as "many stops".
  const meaningful = stopped.filter(j => (j.minutes ?? 0) >= MEANINGFUL_STOP_MINUTES);
  if (meaningful.length >= MANY_STOPS) insights.push({ id: "many_stops", day: input.day, reliability: rel, evidence: { stopsOverFiveMinutes: meaningful.length, allStopSegments: stopped.length } });
  return { day: input.day, coverage, coverageReasons: coverageReasons(input), activity, insights, positionCount: reconcilePositionCount(input.receivedObservations ?? null, L.totals.observations, L.totals.duplicateObservations) };
}

type Pair = readonly [string, string];
export const COVERAGE_COPY: Record<CoverageState, Pair> = {
  not_read: ["Forth report not read for this day", "ยังไม่ได้อ่านรายงาน Forth ของวันนี้"],
  restricted: ["Journey detail needs administrator authorisation; the Forth day total is still shown", "รายละเอียดเที่ยวต้องได้รับอนุญาตจากผู้ดูแลระบบ ยอดรวมของ Forth ยังแสดงอยู่"],
  provider_distance_only: ["Provider distance only: no position history was returned", "มีเฉพาะระยะทางจากผู้ให้บริการ ไม่มีประวัติตำแหน่ง"],
  no_positions: ["No positions returned for this day", "ไม่มีตำแหน่งสำหรับวันนี้"],
  unverified: ["Positions returned but none verified as GPS", "มีตำแหน่งแต่ไม่มีที่ยืนยันว่าเป็น GPS"],
  partly_verified: ["Positions partly verified as GPS", "ยืนยันตำแหน่งเป็น GPS บางส่วน"],
  verified_incomplete: ["Verified GPS, but coverage is incomplete", "GPS ที่ยืนยันแล้ว แต่ข้อมูลไม่ครบ"],
  verified_complete: ["Verified GPS with no known gaps", "GPS ที่ยืนยันแล้ว ไม่พบช่วงที่ขาด"]
};
export const INSIGHT_COPY: Record<InsightId, { title: Pair; reason: Pair; action: Pair }> = {
  long_distance: { title: ["Long distance for one day", "ระยะทางไกลในวันเดียว"], reason: ["The provider-reported distance is above the fixed threshold. It is not compared with this vehicle's history.", "ระยะทางที่ผู้ให้บริการรายงานเกินเกณฑ์ที่กำหนด ไม่ได้เทียบกับประวัติของรถคันนี้"], action: ["Check the journey list to see whether this was a planned long trip.", "ดูรายการเที่ยวว่าเป็นเที่ยวไกลที่วางแผนไว้หรือไม่"] },
  long_stop: { title: ["Long stay observed", "พบการจอดนาน"], reason: ["A stopped segment lasts at least the threshold in observed time. Unknown gaps are not added.", "ช่วงจอดมีเวลาที่สังเกตได้ไม่ต่ำกว่าเกณฑ์ ช่วงที่ไม่มีข้อมูลไม่ถูกนับรวม"], action: ["Look at the stop in Journeys and ask the driver if the reason is unclear.", "ดูจุดจอดในแท็บเที่ยวรถ และสอบถามคนขับหากไม่ทราบสาเหตุ"] },
  mostly_stationary: { title: ["Mostly stationary with good coverage", "จอดนิ่งเป็นส่วนใหญ่ และข้อมูลครบพอ"], reason: ["Most tracked time was stopped and the day was well covered, so this is a real low-activity day, not a missing-data day.", "ส่วนใหญ่ของเวลาที่ติดตามได้คือจอด และข้อมูลครอบคลุมดี จึงเป็นวันที่ใช้งานน้อยจริง ไม่ใช่ข้อมูลหาย"], action: ["Confirm whether the vehicle was meant to be idle (maintenance, no work).", "ยืนยันว่ารถตั้งใจจอดหรือไม่ (ซ่อมบำรุง ไม่มีงาน)"] },
  tracking_gap: { title: ["Significant tracking gap", "ช่วงที่ไม่มีข้อมูลติดตามนาน"], reason: ["No position was recorded for this period. It is unknown, not a stop and not inactivity.", "ไม่มีการบันทึกตำแหน่งในช่วงนี้ ไม่ทราบว่าเป็นการจอดหรือไม่ใช้งาน"], action: ["Include the vehicle and date when asking Forth why history is missing.", "ระบุรถและวันที่เมื่อสอบถาม Forth ว่าเหตุใดประวัติหาย"] },
  provider_trail_difference: { title: ["Provider distance differs from the trail", "ระยะทางของผู้ให้บริการต่างจากเส้นทาง"], reason: ["Forth's day total and the distance in its position log disagree by more than the tolerance.", "ยอดรายวันของ Forth ต่างจากระยะทางในบันทึกตำแหน่งเกินเกณฑ์"], action: ["Treat the provider total as the reported figure and note the difference for Forth.", "ใช้ยอดของผู้ให้บริการเป็นตัวเลขที่รายงาน และแจ้งความต่างให้ Forth"] },
  unverified_positions: { title: ["Positions not verified as GPS", "ตำแหน่งไม่ได้ยืนยันว่าเป็น GPS"], reason: ["Forth labels the position source as not GPS. Coordinates exist but cannot be treated as verified.", "Forth ระบุแหล่งตำแหน่งว่าไม่ใช่ GPS มีพิกัดแต่ไม่ถือว่ายืนยันแล้ว"], action: ["Ask Forth why the source is reported that way; do not treat these stops as confirmed.", "สอบถาม Forth ว่าเหตุใดจึงระบุแหล่งเช่นนี้ และอย่าถือว่าจุดจอดยืนยันแล้ว"] },
  starts_mid_journey: { title: ["Day starts mid-journey", "วันเริ่มระหว่างเดินทาง"], reason: ["The first report segment is moving, so the departure time is unknown. No departure is assumed from the start of the day.", "ช่วงแรกของรายงานเป็นการเคลื่อนที่ จึงไม่ทราบเวลาออกเดินทาง ไม่ได้สมมติว่าออกตอนต้นวัน"], action: ["Read the previous day if the departure time matters.", "ดูวันก่อนหน้าหากต้องการเวลาออกเดินทาง"] },
  ends_mid_journey: { title: ["Day ends mid-journey", "วันสิ้นสุดระหว่างเดินทาง"], reason: ["The last segment is moving or open, so the arrival or return is not observed on this day.", "ช่วงสุดท้ายยังเคลื่อนที่หรือยังไม่ปิด จึงไม่ได้เห็นการมาถึงหรือกลับในวันนี้"], action: ["Read the next day to see where the journey ended.", "ดูวันถัดไปเพื่อดูว่าเที่ยวสิ้นสุดที่ใด"] },
  engine_on_during_stop: { title: ["Engine reported on during a stop", "Forth รายงานว่าเครื่องยนต์ทำงานขณะจอด"], reason: ["Based on the provider's engine flag, not on zero speed. The flag itself is provider-reported.", "อ้างอิงสถานะเครื่องยนต์จากผู้ให้บริการ ไม่ใช่ความเร็วศูนย์ และสถานะนี้เป็นค่าที่ผู้ให้บริการรายงาน"], action: ["Review only if idling cost matters.", "ตรวจสอบเมื่อค่าใช้จ่ายจากการจอดติดเครื่องมีผล"] },
  ambiguous_segments: { title: ["Ambiguous segments excluded from totals", "ช่วงที่ไม่ชัดเจนถูกตัดออกจากยอดรวม"], reason: ["Some report segments overlap or conflict, so their time is not used in these figures.", "บางช่วงในรายงานซ้อนทับหรือขัดแย้งกัน จึงไม่นำเวลามารวม"], action: ["Open the journey list and review the flagged segments.", "เปิดรายการเที่ยวรถและตรวจช่วงที่ถูกทำเครื่องหมาย"] },
  many_stops: { title: ["Many stops in one day", "จอดหลายครั้งในวันเดียว"], reason: ["The report shows eight or more stops of at least five minutes. This describes activity only; no stop is a confirmed visit.", "รายงานแสดงการจอดตั้งแต่ห้านาทีขึ้นไปแปดครั้งขึ้นไป เป็นเพียงข้อมูลกิจกรรม ไม่ถือว่ายืนยันการเยี่ยมชม"], action: ["Review the stops list for repeated areas.", "ดูรายการจุดจอดว่ามีพื้นที่ซ้ำหรือไม่"] }
};
export const RELIABILITY_COPY: Record<Reliability, Pair> = {
  verified_gps: ["Verified GPS", "GPS ที่ยืนยันแล้ว"], provider_reported: ["Provider-reported, not verified", "ผู้ให้บริการรายงาน ยังไม่ยืนยัน"], mixed: ["Partly verified", "ยืนยันบางส่วน"], unknown: ["Unknown", "ไม่ทราบ"]
};
export const coverageLabel = (c: CoverageState, lang: "en" | "th") => COVERAGE_COPY[c][lang === "th" ? 1 : 0];
export const reliabilityLabel = (r: Reliability, lang: "en" | "th") => RELIABILITY_COPY[r][lang === "th" ? 1 : 0];

export const COVERAGE_REASON_COPY: Record<CoverageReason, Pair> = {
  missing_history: ["Some history is missing", "ประวัติบางช่วงหายไป"],
  open_final_segment: ["The last segment is still open, so the end of the day is not observed", "ช่วงสุดท้ายยังไม่ปิด จึงไม่เห็นช่วงท้ายวัน"],
  ambiguous_segments: ["Some segments overlap or conflict", "บางช่วงซ้อนทับหรือขัดแย้งกัน"],
  provider_total_not_reconciled: ["The provider total does not reconcile with its segments", "ยอดรวมของผู้ให้บริการไม่ตรงกับรายช่วง"]
};
export const EVIDENCE_LABELS: Record<string, Pair> = {
  providerKm: ["Provider km", "กม. ผู้ให้บริการ"], thresholdKm: ["Threshold km", "เกณฑ์ กม."], longestMinutes: ["Longest (min)", "นานสุด (นาที)"], start: ["Start", "เริ่ม"],
  stopsOverThreshold: ["Stops over threshold", "จุดจอดที่เกินเกณฑ์"], thresholdMinutes: ["Threshold (min)", "เกณฑ์ (นาที)"], gapsInsideLongest: ["Gaps inside longest", "ช่วงขาดในจุดจอดที่นานสุด"],
  missingMinutes: ["Missing (min)", "ขาดหาย (นาที)"], longestGapMinutes: ["Longest gap (min)", "ช่วงขาดนานสุด (นาที)"], longestGapStart: ["Longest gap starts", "ช่วงขาดนานสุดเริ่ม"],
  stoppedShare: ["Stopped share (%)", "สัดส่วนจอด (%)"], coverageShare: ["Day covered", "สัดส่วนวันที่มีข้อมูล"], trailKm: ["Trail km", "กม. ตามเส้นทาง"], differencePct: ["Difference (%)", "ส่วนต่าง (%)"],
  observations: ["Positions", "ตำแหน่ง"], verifiedObservations: ["Verified positions", "ตำแหน่งที่ยืนยัน"], firstSegmentStart: ["First segment", "ช่วงแรก"], lastSegmentKind: ["Last segment", "ช่วงสุดท้าย"], lastSegmentStart: ["Last segment starts", "ช่วงสุดท้ายเริ่ม"],
  stops: ["Stops", "จุดจอด"], engineFlag: ["Engine flag", "สถานะเครื่องยนต์"], ambiguousJourneys: ["Ambiguous segments", "ช่วงที่ไม่ชัดเจน"], stopsOverFiveMinutes: ["Stops of 5+ min", "จุดจอด 5+ นาที"], allStopSegments: ["All stop segments", "ช่วงจอดทั้งหมด"]
};
export const coverageReasonLabel = (r: CoverageReason, lang: "en" | "th") => COVERAGE_REASON_COPY[r][lang === "th" ? 1 : 0];
export const evidenceLabel = (key: string, lang: "en" | "th") => (EVIDENCE_LABELS[key] ?? [key, key])[lang === "th" ? 1 : 0];
