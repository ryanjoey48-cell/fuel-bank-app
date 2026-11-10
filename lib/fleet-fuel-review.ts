/**
 * V7.7 fuel and kilometre review candidates. Pure and read-only, built only from evidence already loaded for the selected vehicle and dates.
 * A candidate is a prompt for the office to look, never a finding of fault: purchased fuel is not consumed fuel, no km/L is calculated, and a
 * source that was not read is "unknown", never zero. To avoid noise it lists only a few deterministic conditions, each with its evidence.
 */
import type { HistoryDay, OdometerSpan } from "@/components/fleet-operating-history";

export type FuelReviewSeverity = "medium" | "info";
export type FuelReviewKey = "odometer_vs_provider" | "odometer_date_only" | "odometer_interval_withheld" | "fuel_cost_missing" | "fuel_type_unrecorded" | "purchases_on_unreviewed_days";
export type FuelReviewCandidate = { key: FuelReviewKey; severity: FuelReviewSeverity; evidence: Record<string, number | string>; };
export type OdometerIntervalInput = { source: string; from: string; to: string; withheld: boolean };

/** Same display rule as the km/fuel table: at least 5 km and at least 10% of the larger figure. It only prompts a review; nothing is adjusted. */
export const ODOMETER_DISAGREEMENT_KM = 5;
export const ODOMETER_DISAGREEMENT_SHARE = 0.1;

export function fuelReviewCandidates(input: { days: readonly HistoryDay[]; spans: readonly OdometerSpan[]; intervals: readonly OdometerIntervalInput[] }): FuelReviewCandidate[] {
  const out: FuelReviewCandidate[] = [];
  for (const s of input.spans) {
    if (!s) continue;
    const covered = input.days.filter(d => d.day >= s.from && d.day <= s.to);
    // Only comparable when every day inside the span has a reconciled Forth day; otherwise no comparison is made at all.
    const comparable = covered.length > 0 && covered.every(d => d.read && d.providerReconciled && d.providerKm !== null);
    if (comparable) {
      // Forth distance over exactly the days the odometer span covers, never the whole displayed period.
      const providerSum = Math.round(covered.reduce((n, d) => n + (d.providerKm ?? 0), 0) * 100) / 100;
      const diff = Math.round(Math.abs(providerSum - s.km) * 100) / 100;
      if (diff >= Math.max(ODOMETER_DISAGREEMENT_KM, ODOMETER_DISAGREEMENT_SHARE * Math.max(providerSum, s.km))) out.push({ key: "odometer_vs_provider", severity: "medium", evidence: { source: s.label, odometerKm: s.km, providerKm: providerSum, differenceKm: diff, from: s.from, to: s.to } });
    }
    if (s.reviewRequired) out.push({ key: "odometer_date_only", severity: "info", evidence: { source: s.label, from: s.from, to: s.to } });
  }
  // One candidate per source (not one per interval): repeated withheld intervals are a single prompt with a count and the dates they span.
  for (const source of [...new Set(input.intervals.filter(i => i.withheld).map(i => i.source))].sort()) {
    const rows = input.intervals.filter(i => i.withheld && i.source === source);
    out.push({ key: "odometer_interval_withheld", severity: "info", evidence: { source, intervals: rows.length, from: rows.map(r => r.from).sort()[0], to: rows.map(r => r.to).sort().at(-1)! } });
  }
  const known = input.days.filter(d => d.fuel !== null);
  const groups = known.flatMap(d => d.fuel ?? []);
  const noCost = groups.filter(g => g.costThb === null).reduce((n, g) => n + g.records, 0);
  const noType = groups.filter(g => g.fuelType === "unrecorded").reduce((n, g) => n + g.records, 0);
  if (noCost > 0) out.push({ key: "fuel_cost_missing", severity: "info", evidence: { records: noCost } });
  if (noType > 0) out.push({ key: "fuel_type_unrecorded", severity: "info", evidence: { records: noType } });
  const unreviewedWithFuel = input.days.filter(d => !d.read && d.fuel !== null && d.fuel.length > 0).length;
  if (unreviewedWithFuel > 0) out.push({ key: "purchases_on_unreviewed_days", severity: "info", evidence: { days: unreviewedWithFuel } });
  const rank: Record<FuelReviewSeverity, number> = { medium: 2, info: 1 };
  return out.sort((a, b) => rank[b.severity] - rank[a.severity] || a.key.localeCompare(b.key));
}

type Lang = "en" | "th";
export const FUEL_REVIEW_COPY: Record<FuelReviewKey, { title: readonly [string, string]; action: readonly [string, string] }> = {
  odometer_vs_provider: { title: ["Odometer span and Forth distance differ", "ระยะทางจากเลขไมล์กับ Forth ต่างกัน"], action: ["Check the two odometer readings and whether the vehicle drove outside Forth tracking. Neither figure is treated as correct.", "ตรวจเลขไมล์สองค่านั้น และดูว่ารถวิ่งนอกการติดตามของ Forth หรือไม่ ไม่ถือว่าตัวเลขใดถูกต้อง"] },
  odometer_date_only: { title: ["Odometer date is only a day proxy", "วันที่ของเลขไมล์เป็นค่าอ้างอิงรายวัน"], action: ["Confirm the real reading date if the span matters.", "ยืนยันวันที่อ่านจริงหากช่วงนี้สำคัญ"] },
  odometer_interval_withheld: { title: ["An odometer interval was withheld", "มีช่วงเลขไมล์ที่ระงับไว้"], action: ["A reading is missing, reset or conflicting. Review the readings in range.", "เลขไมล์ขาด รีเซ็ต หรือขัดแย้ง ตรวจเลขไมล์ในช่วงที่เลือก"] },
  fuel_cost_missing: { title: ["Fuel records without a cost", "รายการเชื้อเพลิงที่ไม่มีจำนวนเงิน"], action: ["Cost totals are shown as unknown for those days, not zero.", "ยอดเงินของวันเหล่านั้นแสดงว่าไม่ทราบ ไม่ใช่ศูนย์"] },
  fuel_type_unrecorded: { title: ["Fuel records without a fuel type", "รายการเชื้อเพลิงที่ไม่ระบุชนิด"], action: ["Litres are shown per type; records with no type are kept separate.", "แสดงลิตรแยกตามชนิด รายการที่ไม่ระบุชนิดแยกไว้ต่างหาก"] },
  purchases_on_unreviewed_days: { title: ["Fuel purchased on days without a Forth review", "มีการซื้อเชื้อเพลิงในวันที่ยังไม่ได้ตรวจ Forth"], action: ["Read those days in Daily Activity if a comparison is needed. Nothing is read automatically.", "อ่านวันเหล่านั้นใน กิจกรรมประจำวัน หากต้องการเปรียบเทียบ ไม่มีการอ่านอัตโนมัติ"] }
};
export const fuelReviewTitle = (k: FuelReviewKey, l: Lang) => FUEL_REVIEW_COPY[k].title[l === "th" ? 1 : 0];
export const fuelReviewAction = (k: FuelReviewKey, l: Lang) => FUEL_REVIEW_COPY[k].action[l === "th" ? 1 : 0];
