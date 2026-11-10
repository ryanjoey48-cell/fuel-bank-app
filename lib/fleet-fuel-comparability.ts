/**
 * V7.8.2 fuel period comparability (pure). An odometer interval (two Fuel Log readings) is compared with Forth ONLY for the days it covers,
 * and only when every one of those days has validated reviewed Forth evidence. Fuel Log readings carry a date but no time, so the two
 * boundary days are only partly inside the interval: the comparison is therefore a range (interior days = lower bound, all days including
 * both boundary days = upper bound), never a single figure. Unknown values stay unknown (null), never zero. Purchased litres play no part:
 * nothing here is, or implies, fuel consumption.
 */
/**
 * openAtDayEnd (V7.8.3): the day's Forth report ends with a segment that has no end time (recorded as 0 km), i.e. a trip still running at
 * midnight. Observed for 3ฒน-9565 on 1 Nov 2026: that trip's distance appeared in neither day's provider total, so a Forth upper bound that
 * includes such a day can understate distance. gpsKm: the day's whole-day GPS-derived km, shown beside the Forth range, never substituted.
 */
export type ForthDayKm = { day: string; providerKm: number | null; reconciled: boolean; openAtDayEnd?: boolean; gpsKm?: number | null };
export type IntervalInput = { fromDate: string; toDate: string; km: number | null; withheld: string | null };
export type ComparabilityReason = "odometer_withheld" | "odometer_unknown" | "forth_days_not_reviewed" | "forth_day_not_reconciled" | "invalid_interval";
export type IntervalComparison =
  | { status: "not_comparable"; reason: ComparabilityReason; coveredDays: number; reviewedDays: number; missingDays: string[] }
  | { status: "within_range" | "outside_range"; coveredDays: number; reviewedDays: number; lowerKm: number; upperKm: number; odometerKm: number; /** distance to the nearest bound when outside, else 0 */ gapKm: number; boundaryDaysPartlyOutside: boolean;
      /** Days in the interval whose Forth report ends with an open segment (a trip crossing midnight). */ openEndDays: string[];
      /** GPS-derived km over the same days (interior / all days), shown for context only; null unless every needed day has a GPS figure. */ gpsLowerKm: number | null; gpsUpperKm: number | null };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
export function daysInclusive(from: string, to: string): string[] {
  if (!DAY.test(from) || !DAY.test(to) || to < from) return [];
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`) && out.length < 400; t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

export function compareIntervalToForth(interval: IntervalInput, forth: readonly ForthDayKm[]): IntervalComparison {
  const days = daysInclusive(interval.fromDate, interval.toDate);
  if (days.length === 0) return { status: "not_comparable", reason: "invalid_interval", coveredDays: 0, reviewedDays: 0, missingDays: [] };
  const byDay = new Map<string, ForthDayKm>();
  for (const f of forth) if (!byDay.has(f.day)) byDay.set(f.day, f); // a duplicate day is counted once (first record wins)
  const reviewed = days.filter(d => byDay.has(d));
  const base = { coveredDays: days.length, reviewedDays: reviewed.length };
  if (interval.withheld && interval.withheld !== "identical_odometer_review") return { status: "not_comparable", reason: "odometer_withheld", ...base, missingDays: [] };
  if (interval.km === null || !Number.isFinite(interval.km)) return { status: "not_comparable", reason: "odometer_unknown", ...base, missingDays: [] };
  const missingDays = days.filter(d => !byDay.has(d));
  if (missingDays.length) return { status: "not_comparable", reason: "forth_days_not_reviewed", ...base, missingDays };
  const unusable = days.filter(d => { const f = byDay.get(d)!; return !f.reconciled || f.providerKm === null || !Number.isFinite(f.providerKm); });
  if (unusable.length) return { status: "not_comparable", reason: "forth_day_not_reconciled", ...base, missingDays: unusable };
  const km = (d: string) => byDay.get(d)!.providerKm as number;
  const upper = days.reduce((n, d) => n + km(d), 0);
  // Same-day interval: both readings are on one day, so the day is wholly a boundary day and the lower bound is zero.
  const interior = days.length <= 2 ? [] : days.slice(1, -1);
  const lower = interior.reduce((n, d) => n + km(d), 0);
  const round = (n: number) => Math.round(n * 100) / 100;
  const lo = round(lower), hi = round(upper);
  const gap = interval.km < lo ? lo - interval.km : interval.km > hi ? interval.km - hi : 0;
  const gpsSum = (list: string[]) => list.every(d => typeof byDay.get(d)!.gpsKm === "number" && Number.isFinite(byDay.get(d)!.gpsKm)) ? round(list.reduce((n, d) => n + (byDay.get(d)!.gpsKm as number), 0)) : null;
  return { status: gap === 0 ? "within_range" : "outside_range", ...base, lowerKm: lo, upperKm: hi, odometerKm: interval.km, gapKm: round(gap), boundaryDaysPartlyOutside: true,
    openEndDays: days.filter(d => byDay.get(d)!.openAtDayEnd === true), gpsLowerKm: gpsSum(interior), gpsUpperKm: gpsSum(days) };
}

type Pair = readonly [string, string];
export const COMPARABILITY_COPY: Record<ComparabilityReason, Pair> = {
  odometer_withheld: ["Odometer distance withheld for review", "ระยะทางเลขไมล์ถูกระงับเพื่อตรวจสอบ"],
  odometer_unknown: ["Odometer distance unknown", "ไม่ทราบระยะทางจากเลขไมล์"],
  forth_days_not_reviewed: ["Not every day in this interval has a reviewed Forth report", "ยังไม่มีรายงาน Forth ที่ตรวจแล้วครบทุกวันในช่วงนี้"],
  forth_day_not_reconciled: ["A reviewed Forth day does not reconcile, so its distance is not used", "วัน Forth ที่ตรวจแล้วบางวันกระทบยอดไม่ได้ จึงไม่ใช้ระยะทาง"],
  invalid_interval: ["Interval dates are not valid", "วันที่ของช่วงไม่ถูกต้อง"]
};
export function comparabilityText(c: IntervalComparison, language: "en" | "th", km: (n: number) => string): string {
  const th = language === "th";
  if (c.status === "not_comparable") return `${th ? "เปรียบเทียบไม่ได้" : "Not comparable"} · ${COMPARABILITY_COPY[c.reason][th ? 1 : 0]}${c.reason === "forth_days_not_reviewed" ? ` (${c.reviewedDays}/${c.coveredDays} ${th ? "วัน" : "days"})` : ""}`;
  const range = `${km(c.lowerKm)}–${km(c.upperKm)}`;
  return c.status === "within_range"
    ? `${th ? "เปรียบเทียบได้ · อยู่ในช่วง" : "Comparable · within range"} ${range} ${th ? "กม." : "km"} (${th ? "ช่วงต่ำสุดใช้วันกลาง ช่วงสูงสุดรวมวันขอบทั้งสอง เพราะเลขไมล์ระบุเฉพาะวันที่" : "lower bound uses interior days, upper bound adds both boundary days, because readings are date-only"})`
    : `${th ? "เปรียบเทียบได้ · อยู่นอกช่วง ควรตรวจสอบ" : "Comparable · outside range, review candidate"} ${range} ${th ? "กม." : "km"} (${th ? "ห่าง" : "gap"} ${km(c.gapKm)} ${th ? "กม." : "km"})`;
}
