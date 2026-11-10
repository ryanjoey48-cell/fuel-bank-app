/**
 * Vehicle-day distance accountability. Pure and read-only. No persistence exists for office confirmations, so
 * `confirmedAllocations` is normally undefined and no confirmed job distance is ever claimed. Local preview
 * allocations are reported separately and never feed the accounting states.
 */

export type Provenance = "confirmed" | "derived" | "partial" | "unknown";
export type SemanticsFact = { id: string; status: Provenance; en: string; th: string; evidence: string };

/** What the Forth parkingTrip report and log mean, labelled by how well it is established. Verified live 5–6 Nov 2026 (device 519698, 2–4 Nov). */
export const FORTH_DISTANCE_SEMANTICS: readonly SemanticsFact[] = [
  { id: "day_scoped_independent", status: "confirmed", en: "A day report is independent and day-scoped. It is not cumulative: each day restarts.", th: "รายงานรายวันแยกอิสระและเป็นของวันนั้น ไม่สะสมข้ามวัน", evidence: "Direct 4 Nov report Total 344.85 km, 3 Nov 289.20 km, 2 Nov 0 km; one request per day (startDate = endDate)." },
  { id: "multi_day_additive", status: "confirmed", en: "A multi-day request returns one Total per day then a grand Total (289.20 + 344.85 = 634.05). The adapter rejects it (one Total expected), so reads stay one day each.", th: "รายงานหลายวันให้ยอดรวมรายวันและยอดรวมทั้งหมด (289.20 + 344.85 = 634.05) ระบบอ่านทีละวัน", evidence: "Range 3–4 Nov: 36 rows, 1 header, 3 Total rows (289.2, 344.85, 634.05)." },
  { id: "total_equals_segment_sum", status: "confirmed", en: "Each day's Total equals the sum of that day's segment distances.", th: "ยอดรวมของวันเท่ากับผลรวมระยะทางของช่วงในวันนั้น", evidence: "2–4 Nov: segment sums 0, 289.20, 344.85 equal the Totals." },
  { id: "open_segment_final_zero", status: "derived", en: "Every day ends with one open segment (end '-', 0 km) starting at the day's last log record; it is the final stopped or ongoing state, not travel.", th: "ทุกวันจบด้วยช่วงที่ยังไม่ปิด (end '-', 0 กม.) เริ่มที่รายการล่าสุดของวัน ไม่ใช่การเดินทาง", evidence: "3 of 3 days: open rows at 23:59:45, 23:55:20 and 23:55:03, all 0 km. The meaning is inferred, not documented." },
  { id: "local_bangkok_time", status: "derived", en: "Report and log times are local Asia/Bangkok.", th: "เวลาในรายงานและบันทึกเป็นเวลาไทย", evidence: "A 000000–235959 request returns records from 00:00 to 23:59 on the same date; UTC would shift by 7 h. Not documented by Forth." },
  { id: "log_distance_increments", status: "confirmed", en: "Log 'Distance' is incremental metres: the straight-line distance from the previous coordinate to this one (as Forth documents). It is not a cumulative odometer, so it falls often. The app still derives GPS distance only from verified fixes, never from this field.", th: "ค่า Distance ในบันทึกคือระยะทางเป็นเมตรที่เพิ่มขึ้นจากพิกัดก่อนหน้าถึงพิกัดปัจจุบัน (ตามเอกสาร Forth) ไม่ใช่เลขไมล์สะสม ระบบไม่ใช้ค่านี้คำนวณระยะทาง GPS", evidence: "Verified on 3 device-days (519697 on 5 Nov, 546298 on 5 Nov, 519698 on 3 Nov): it equals the haversine chord to the previous point for 510/523, 844/935 and 681/750 records (median ratio 1.001, 0.998, 1.000); daily sums are within 0.4%, 0.5%, 1.0% of the chord path; it decreases 94, 243, 176 times a day." },
  { id: "report_distance_method", status: "derived", en: "Report distance equals the sum of the log's incremental Distance (within 0.15%), for devices labelled 'No GPS' and 'GPS' alike, so it appears to be computed from the same reported coordinates. Forth has not documented this, and it does not show the coordinates are satellite fixes.", th: "ระยะทางในรายงานเท่ากับผลรวม Distance ในบันทึก (ต่างไม่เกิน 0.15%) ทั้งอุปกรณ์ที่ระบุ No GPS และ GPS จึงน่าจะคำนวณจากพิกัดชุดเดียวกัน Forth ไม่ได้ระบุไว้ และไม่ได้พิสูจน์ว่าพิกัดมาจากดาวเทียม", evidence: "Report vs log sum: 185.55 vs 185.71 km (64-5954, 5 Nov), 363.42 vs 363.72 (3ฒน-9565, 5 Nov), 289.20 vs 289.54 (519698, 3 Nov)." },
  { id: "position_source_label", status: "unknown", en: "positionSource is not in the documented field list. It is constant per device across whole days while the documented GPS field is ON for all 21 devices, so it behaves like a device property, not intermittent signal loss. What it means (and whether it is reliable on older firmware) is unknown.", th: "positionSource ไม่อยู่ในรายการฟิลด์ตามเอกสาร และคงที่ต่ออุปกรณ์ทั้งวัน ขณะที่ฟิลด์ GPS เปิดทั้ง 21 คัน จึงดูเป็นคุณสมบัติของอุปกรณ์ ไม่ใช่สัญญาณขาดเป็นช่วง ความหมายที่แท้จริงยังไม่ทราบ", evidence: "6 Nov live: 15 'No GPS' and 6 'GPS', GPS ON and GPRS ON for all 21. 5 Nov history: 524/524 'No GPS' (64-5954) and 936/936 'GPS' (3ฒน-9565); 3 Nov: 751/751 'No GPS' (519698). Positions of 'No GPS' vehicles advance with time and speed (45-second re-read)." },
  { id: "day_coverage", status: "partial", en: "Whether a report covers the whole day is not established: records arrive about every 5 minutes with 301-second gaps.", th: "ยังไม่ยืนยันว่ารายงานครอบคลุมทั้งวัน", evidence: "Log cadence and gaps; no coverage field in the response." },
  { id: "history_coordinates", status: "partial", en: "The log holds a coordinate for every record. On 3 Nov they trace a real-looking route (straight-line total 286.6 km vs the report's 289.20 km, 99.9 km from the start) but none is labelled verified GPS, so they are unverified. No route is drawn here; route playback is a separate, owner-gated feature, and no other history endpoint exists.", th: "บันทึกมีพิกัดทุกรายการ วันที่ 3 พ.ย. ดูเป็นเส้นทางจริง (ผลรวมเส้นตรง 286.6 กม. เทียบรายงาน 289.20 กม.) แต่ไม่มีรายการใดยืนยันว่าเป็น GPS จึงยังไม่ยืนยัน ไม่วาดเส้นทางที่นี่ การเล่นย้อนเส้นทางเป็นฟีเจอร์แยกที่ต้องได้รับอนุมัติ", evidence: "Offline analysis of the stored 3 Nov log: 751 points, 375 distinct, 0 verified; capability matrix." },
  { id: "retention_and_rate", status: "unknown", en: "Retention depth and rate limits are undocumented; 2–4 Nov were available and none of the bounded requests so far returned a 429.", th: "ไม่มีเอกสารเรื่องการเก็บข้อมูลย้อนหลังและขีดจำกัดการเรียก", evidence: "Observed only." },
  { id: "monthly_summary_endpoint", status: "unknown", en: "A documented monthly summary endpoint (summaryMonthlys) exists but has not been probed or compared.", th: "มีรายงานสรุปรายเดือนในเอกสารแต่ยังไม่ได้ทดสอบ", evidence: "docs/forth-history-capability-matrix.md" }
];
export const FORTH_QUESTIONS = [
  "How is the positionSource field defined (it is not in the documented field list), and why do some devices report 'No GPS' all day while the GPS field is ON and positions keep updating?",
  "Can positionSource be wrong or unpopulated on older firmware (for example FTS-PLUS, VER 16-10-2019.A), and is there a field that shows a real satellite fix?",
  "Is the parkingTrip sumDistance computed from the same coordinates as the log Distance (we see them agree within 0.15%), and does the final open segment ('-') ever carry distance?",
  "Are report and log timestamps local Asia/Bangkok, and are the day boundaries inclusive at 00:00:00 and 23:59:59?",
  "Are device model and firmware, and the time of the last genuine GPS fix, available through the API?",
  "What are the retention depth, request and rate limits, and is summaryMonthlys supported for reconciliation?"
] as const;

export type SegmentLite = { id: string; km: number };
export type PreviewSelection = { jobId: string; segmentIds: readonly string[] };
/** Local, non-persistent preview. Each segment can belong to at most one job; the first job listed wins and conflicts are reported. */
export function previewAllocation(segments: readonly SegmentLite[], selections: readonly PreviewSelection[]) {
  const known = new Map(segments.map(s => [s.id, s.km])); const owner = new Map<string, string>(); const conflicts: { segmentId: string; keptBy: string; rejectedFor: string }[] = []; const unknown: string[] = [];
  const perJob = new Map<string, number>();
  for (const sel of selections) for (const id of sel.segmentIds) {
    if (!known.has(id)) { unknown.push(id); continue; }
    if (owner.has(id) && owner.get(id) !== sel.jobId) { conflicts.push({ segmentId: id, keptBy: owner.get(id)!, rejectedFor: sel.jobId }); continue; }
    if (owner.get(id) === sel.jobId) continue; owner.set(id, sel.jobId);
    perJob.set(sel.jobId, Math.round(((perJob.get(sel.jobId) ?? 0) + known.get(id)!) * 100) / 100);
  }
  const allocatedKm = [...perJob.values()].reduce((n, v) => Math.round((n + v) * 100) / 100, 0);
  return { perJob: Object.fromEntries(perJob), allocatedKm, conflicts, unknown, previewOnly: true as const };
}

export type LedgerProvider = { km: number | null; reconciled: boolean; complete: boolean; segments: number; openSegments: number; capturedAt: string | null; expiresAt: string | null; segmentList?: SegmentLite[] };
export type LedgerInput = {
  vehicleId: string; registration: string; day: string; timeZone: "Asia/Bangkok";
  provider: LedgerProvider | null; gpsKm: number | null;
  fuelOdometer: { id: string; km: number | null }[] | null; weeklyOdometer: { id: string; km: number | null; baseline: boolean | null }[] | null;
  fuelPurchase: { records: number; litres: number | null; costThb: number | null } | null;
  bookings: { id: string; workOrder: string | null }[] | null;
  /** Genuinely confirmed allocations. Undefined means no confirmation source exists (the current state): nothing is claimed. */
  confirmedAllocations?: readonly { jobId: string; km: number }[];
  preview?: ReturnType<typeof previewAllocation> | null;
  exceptions?: string[];
};
export type ProviderState = "not_read" | "not_reconciled" | "reconciled_incomplete" | "reconciled_complete";
export type AccountabilityState = "no_source" | "unresolved_coverage_unverified" | "unresolved_no_confirmed_allocation" | "balanced" | "overallocated";

export function buildVehicleDayLedger(input: LedgerInput) {
  const p = input.provider;
  const providerState: ProviderState = !p ? "not_read" : !p.reconciled || p.km === null ? "not_reconciled" : p.complete && p.openSegments === 0 ? "reconciled_complete" : "reconciled_incomplete";
  // An open final segment, unverified coverage or a failed reconciliation never counts as an accountable total.
  const accountableKm = providerState === "reconciled_complete" ? p!.km : null;
  const confirmedKm = input.confirmedAllocations === undefined ? null : Math.round(input.confirmedAllocations.reduce((n, a) => n + a.km, 0) * 100) / 100;
  let state: AccountabilityState; let unattributedKm: number | null = null; let attributedShare: number | null = null;
  if (providerState === "not_read" || providerState === "not_reconciled") state = "no_source";
  else if (accountableKm === null) state = "unresolved_coverage_unverified";
  else if (confirmedKm === null) state = "unresolved_no_confirmed_allocation";
  else if (confirmedKm > accountableKm + 1e-9) state = "overallocated";
  else { state = "balanced"; unattributedKm = Math.round((accountableKm - confirmedKm) * 100) / 100; attributedShare = accountableKm > 0 ? confirmedKm / accountableKm : null; }
  const bookings = input.bookings === null ? { state: "source_unavailable" as const, count: null } : input.bookings.length === 0 ? { state: "none_found" as const, count: 0 } : { state: "found" as const, count: input.bookings.length };
  return {
    vehicleId: input.vehicleId, registration: input.registration, day: input.day, timeZone: input.timeZone,
    provider: { state: providerState, km: providerState === "not_read" || providerState === "not_reconciled" ? null : p!.km, segments: p?.segments ?? null, openSegments: p?.openSegments ?? null, capturedAt: p?.capturedAt ?? null, expiresAt: p?.expiresAt ?? null, source: "forth_parkingTrip_report" as const },
    gps: { km: input.gpsKm, state: input.gpsKm === null ? "unknown" as const : "verified_intervals_only" as const },
    odometer: { fuelLogs: input.fuelOdometer?.filter(c => c.km !== null).length ?? null, weekly: input.weeklyOdometer?.filter(c => c.km !== null).length ?? null, weeklyBaselineUnknown: input.weeklyOdometer?.filter(c => c.baseline === null).length ?? null },
    fuel: input.fuelPurchase ? { ...input.fuelPurchase, note: "purchased_not_consumed" as const } : null,
    bookings, candidateJobs: input.bookings?.length ?? null,
    attribution: { confirmedKm, confirmationSource: input.confirmedAllocations === undefined ? "not_available" as const : "supplied" as const, unattributedKm, attributedShare, preview: input.preview ?? null },
    accountability: { state, accountableKm, rule: "confirmed + remaining = accountable only when the source is complete, comparable and confirmed allocations exist" },
    // Never labelled empty/repositioning: that needs journey and operational evidence this source cannot give.
    emptyRunningKm: null as null,
    exceptions: input.exceptions ?? []
  };
}
export type VehicleDayLedger = ReturnType<typeof buildVehicleDayLedger>;
