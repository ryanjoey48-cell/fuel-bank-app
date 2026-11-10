/**
 * V7.8.4 explanation of a Forth provider day total. Pure and read-only: it changes no figure and accepts nothing.
 *
 * The provider total is accepted only when the report's own segments are valid and their sum equals its asserted total. Otherwise it is
 * WITHHELD, and the day shows no provider km. This module says why, using only what the report returned, and keeps three different
 * measures apart: the report's asserted total, the sum of the segments it listed (source arithmetic, shown for explanation, never used
 * as the day's provider km while withheld), and the log's reported trail distance (a different source, never an accepted provider total
 * by implication). GPS-derived distance is shown elsewhere and is not touched here.
 */
export type WithholdInput = {
  read: boolean;
  arithmeticStatus: string; arithmeticReason?: string | null;
  assertedTotalKm: number | null;
  segments: readonly { km: number; end: string | null }[];
  issues: readonly string[];
  duplicates?: number | null; foreignRows?: number | null;
  reportedTrailKm: number | null; gpsKm: number | null;
};
export type WithholdReason = { code: string; en: string; th: string };
export type ProviderTotalExplanation = {
  state: "not_read" | "accepted" | "withheld";
  assertedTotalKm: number | null;
  /** Sum of the segments the report listed. Display only: invalid rows are dropped before this point, so it may be incomplete. */
  segmentSumKm: number | null; segmentCount: number; openSegments: number;
  differenceKm: number | null;
  sumMayBeIncomplete: boolean;
  reportedTrailKm: number | null; gpsKm: number | null;
  reasons: WithholdReason[];
};

const REASONS: Record<string, [string, string]> = {
  invalid_segment: ["At least one report row has an unreadable distance or time, or ends before it starts. The row is dropped, so the listed segments may not add up to the real total.", "แถวในรายงานอย่างน้อยหนึ่งแถวมีระยะทางหรือเวลาที่อ่านไม่ได้ หรือสิ้นสุดก่อนเริ่ม แถวนั้นถูกตัดออก ผลรวมของช่วงที่แสดงจึงอาจไม่เท่ายอดจริง"],
  open_segment_with_distance: ["A segment has no end time but carries distance, so the total cannot be attributed to a closed trip.", "มีช่วงที่ไม่มีเวลาสิ้นสุดแต่มีระยะทาง จึงระบุยอดให้เที่ยวที่ปิดแล้วไม่ได้"],
  overlapping_segments: ["Two report segments overlap in time, so adding them would count the same time twice.", "ช่วงในรายงานสองช่วงทับซ้อนกันในเวลา การรวมจะนับเวลาเดียวกันซ้ำ"],
  distance_without_positive_interval: ["A segment has distance but no positive time interval.", "มีช่วงที่มีระยะทางแต่ไม่มีช่วงเวลาที่เป็นบวก"],
  foreign_or_wrong_day_row: ["The report contained rows for another device or another day, which were set aside.", "รายงานมีแถวของอุปกรณ์หรือวันอื่น ซึ่งถูกแยกออก"],
  missing_or_multiple_total_rows: ["The report does not contain exactly one total row, so there is no single asserted total to check against.", "รายงานไม่มีแถวยอดรวมเพียงแถวเดียว จึงไม่มียอดรวมเดียวให้ตรวจเทียบ"],
  totals_differ: ["The sum of the listed segments does not equal the report's own total.", "ผลรวมของช่วงที่แสดงไม่เท่ากับยอดรวมของรายงานเอง"],
  missing_numeric_evidence: ["The report has no usable numeric total or segment list to compare.", "รายงานไม่มียอดรวมหรือรายการช่วงที่ตัวเลขใช้ได้เพื่อเปรียบเทียบ"]
};
export const reasonText = (code: string, language: "en" | "th") => (REASONS[code] ?? ["The report did not reconcile.", "รายงานกระทบยอดไม่ได้"])[language === "th" ? 1 : 0];

export function explainProviderTotal(input: WithholdInput): ProviderTotalExplanation {
  const round = (n: number) => Math.round(n * 100) / 100;
  const sum = input.segments.length ? round(input.segments.reduce((n, s) => n + Math.round(s.km * 100), 0) / 100) : null;
  const open = input.segments.filter(s => s.end === null).length;
  const base = { assertedTotalKm: input.assertedTotalKm, segmentSumKm: sum, segmentCount: input.segments.length, openSegments: open,
    differenceKm: sum !== null && input.assertedTotalKm !== null ? round(sum - input.assertedTotalKm) : null,
    sumMayBeIncomplete: input.issues.includes("invalid_segment"), reportedTrailKm: input.reportedTrailKm, gpsKm: input.gpsKm };
  if (!input.read) return { state: "not_read", ...base, reasons: [] };
  if (input.arithmeticStatus === "pass") return { state: "accepted", ...base, reasons: [] };
  const codes = [...new Set(input.issues)];
  if (input.arithmeticStatus === "fail" && !codes.includes("totals_differ")) codes.push("totals_differ");
  if (codes.length === 0) codes.push(input.arithmeticReason && REASONS[input.arithmeticReason] ? input.arithmeticReason : "missing_numeric_evidence");
  return { state: "withheld", ...base, reasons: codes.map(code => ({ code, en: reasonText(code, "en"), th: reasonText(code, "th") })) };
}
