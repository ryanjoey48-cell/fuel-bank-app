/** Presentation totals never turn missing or malformed purchase values into zero. */
export function purchaseTotal(rows: readonly { purchasedLitres?: number | null; costThb?: number | null }[] | null, field: "purchasedLitres" | "costThb") {
  if (rows === null || rows.some(row => typeof row[field] !== "number" || !Number.isFinite(row[field]) || row[field]! < 0)) return null;
  return rows.reduce((sum, row) => sum + row[field]!, 0);
}

export function bangkokDateInput(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export type PurchaseRow = { fuelType?: string | null; purchasedLitres?: number | null; costThb?: number | null };
export type FuelTypeGroup = { fuelType: string; records: number; purchasedLitres: number | null; costThb: number | null };

/**
 * Purchased litres of different recorded fuel types are never added together.
 * Labels are kept as recorded (only trimmed/lower-cased for grouping); an absent
 * label stays "unrecorded" and is never defaulted to diesel or relabelled LPG.
 */
export function purchasesByFuelType(rows: readonly PurchaseRow[] | null): FuelTypeGroup[] | null {
  if (rows === null) return null;
  const groups = new Map<string, PurchaseRow[]>();
  for (const row of rows) {
    const label = typeof row.fuelType === "string" && row.fuelType.trim() ? row.fuelType.trim().toLowerCase() : "unrecorded";
    groups.set(label, [...(groups.get(label) ?? []), row]);
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([fuelType, group]) => ({
    fuelType, records: group.length, purchasedLitres: purchaseTotal(group, "purchasedLitres"), costThb: purchaseTotal(group, "costThb")
  }));
}

/** A single litre figure is only meaningful when every purchase has the same recorded fuel type. */
export function singleFuelTypeLitres(groups: readonly FuelTypeGroup[] | null) {
  if (groups === null) return null;
  if (groups.length === 0) return 0;
  return groups.length === 1 && groups[0].fuelType !== "unrecorded" ? groups[0].purchasedLitres : null;
}

type IntervalLike = { source: string; from: string; to: string; metric: { value: number | null }; reviewRequired: boolean };
/**
 * Odometer span inside ONE source, only when every consecutive interval of that
 * source has an accepted difference. Fuel-log and weekly readings are never mixed
 * or summed together. Date-only readings keep reviewRequired=true.
 */
export function checkpointSpan(intervals: readonly IntervalLike[] | null, source: "fuel_logs" | "weekly_mileage") {
  if (intervals === null) return null;
  const rows = intervals.filter(row => row.source === source);
  if (rows.length === 0 || rows.some(row => row.metric.value === null || !Number.isFinite(row.metric.value) || row.metric.value < 0)) return null;
  return { km: rows.reduce((sum, row) => sum + row.metric.value!, 0), intervals: rows.length, from: rows[0].from, to: rows.at(-1)!.to, reviewRequired: rows.some(row => row.reviewRequired) };
}
