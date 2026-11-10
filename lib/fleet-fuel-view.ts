/**
 * Pure, read-only fuel range logic over rows already read from the existing Fuel Logs table.
 * No writes, no network, no mileage/maintenance/finance imports. Missing values stay null.
 */
export type FuelRow = {
  id: string | number; date: string; vehicle_reg: string; vehicle_id?: string | null;
  litres: unknown; total_cost: unknown; fuel_type?: string | null; odometer?: unknown;
  created_at?: string | null; station?: string | null; receipt_checked?: boolean | null; full_tank_confirmed?: boolean | null;
};
export type RegistryVehicle = { id: string; vehicle_reg: string };

/** THB is always two decimals; litres up to two; null is "—", never zero. */
export const formatThb = (n: number | null | undefined, language: "en" | "th") => n === null || n === undefined ? "—" : n.toLocaleString(language === "th" ? "th-TH" : "en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const formatLitres = (n: number | null | undefined, language: "en" | "th") => n === null || n === undefined ? "—" : n.toLocaleString(language === "th" ? "th-TH" : "en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
export const registrationKey = (s: string) => s.normalize("NFKC").replace(/[\s\-‐‑‒–—]/g, "").toUpperCase();
const nonnegative = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d+(?:\.\d+)?$/.test(v.trim()) ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const typeLabel = (v: unknown) => typeof v === "string" && v.trim() ? v.trim().toLowerCase() : "unrecorded";
const dayNumber = (d: string) => Math.floor(Date.parse(`${d}T00:00:00+07:00`) / 86400000);
export const daysInRange = (from: string, to: string) => dayNumber(to) - dayNumber(from) + 1;

export type FuelTransaction = {
  id: string; date: string; enteredAt: string | null; station: string | null; fuelType: string;
  litres: number | null; costThb: number | null; odometerKm: number | null; receiptChecked: boolean | null; fullTankConfirmed: boolean | null;
  pricePerLitre: number | null; reviewFlags: ("price_outside_review_range" | "zero_litres_and_cost" | "missing_litres_or_cost")[];
};
/** Heuristic review range only (THB per litre). A flagged record is shown, never corrected or excluded from recorded totals. */
export const PRICE_REVIEW_RANGE = { min: 10, max: 100 } as const;
export type FuelByType = { fuelType: string; records: number; litres: number | null; costThb: number | null };
export type FuelInterval = {
  from: { id: string; date: string; odometerKm: number }; to: { id: string; date: string; odometerKm: number };
  km: number | null; withheld: string | null; reviewRequired: boolean;
  /** Purchases dated after the opening reading up to and including the closing one. Not consumption. */
  purchasedLitresByType: FuelByType[]; purchaseCostThb: number | null; recordsWithoutOdometer: number;
  efficiency: { status: "unknown"; reason: string };
};

function sum(values: (number | null)[]) { return values.some(v => v === null) ? null : values.reduce<number>((n, v) => n + v!, 0); }
export function groupByType(rows: readonly FuelTransaction[]): FuelByType[] {
  const groups = new Map<string, FuelTransaction[]>();
  for (const r of rows) groups.set(r.fuelType, [...(groups.get(r.fuelType) ?? []), r]);
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([fuelType, g]) => ({ fuelType, records: g.length, litres: sum(g.map(r => r.litres)), costThb: sum(g.map(r => r.costThb)) }));
}
/** A single litre total is meaningful only for one recorded fuel type. */
export function singleTypeLitres(groups: readonly FuelByType[]) {
  return groups.length === 0 ? 0 : groups.length === 1 && groups[0].fuelType !== "unrecorded" ? groups[0].litres : null;
}

function transactionFlags(litres: number | null, cost: number | null): { pricePerLitre: number | null; reviewFlags: FuelTransaction["reviewFlags"] } {
  if (litres === null || cost === null) return { pricePerLitre: null, reviewFlags: ["missing_litres_or_cost"] };
  if (litres === 0 && cost === 0) return { pricePerLitre: null, reviewFlags: ["zero_litres_and_cost"] };
  const price = litres > 0 ? cost / litres : null;
  return { pricePerLitre: price, reviewFlags: price === null || price < PRICE_REVIEW_RANGE.min || price > PRICE_REVIEW_RANGE.max ? ["price_outside_review_range"] : [] };
}
export function toTransaction(row: FuelRow): FuelTransaction {
  const litres = nonnegative(row.litres), costThb = nonnegative(row.total_cost);
  return { ...transactionFlags(litres, costThb), id: String(row.id), date: row.date, enteredAt: typeof row.created_at === "string" ? row.created_at : null, station: typeof row.station === "string" && row.station.trim() ? row.station.trim() : null,
    fuelType: typeLabel(row.fuel_type), litres, costThb, odometerKm: nonnegative(row.odometer),
    receiptChecked: typeof row.receipt_checked === "boolean" ? row.receipt_checked : null, fullTankConfirmed: typeof row.full_tank_confirmed === "boolean" ? row.full_tank_confirmed : null };
}
const order = (a: FuelTransaction, b: FuelTransaction) => a.date.localeCompare(b.date) || (a.enteredAt ?? "").localeCompare(b.enteredAt ?? "") || a.id.localeCompare(b.id);

/** Consecutive usable odometer readings. Date-only observations always need office review. */
export function fuelIntervals(transactions: readonly FuelTransaction[], maxKmPerDay = 2000): FuelInterval[] {
  const all = [...transactions].sort(order);
  const usable = all.filter(t => t.odometerKm !== null);
  const result: FuelInterval[] = [];
  for (let i = 1; i < usable.length; i++) {
    const a = usable[i - 1], b = usable[i];
    const between = all.slice(all.indexOf(a) + 1, all.indexOf(b) + 1);
    const delta = b.odometerKm! - a.odometerKm!;
    const days = Math.max(1, daysInRange(a.date, b.date));
    const withheld = delta < 0 ? "odometer_decrease_requires_review" : delta > maxKmPerDay * days ? "implausible_odometer_jump" : delta === 0 ? "identical_odometer_review" : null;
    result.push({
      from: { id: a.id, date: a.date, odometerKm: a.odometerKm! }, to: { id: b.id, date: b.date, odometerKm: b.odometerKm! },
      km: withheld === "identical_odometer_review" ? 0 : withheld ? null : delta, withheld, reviewRequired: true,
      purchasedLitresByType: groupByType(between), purchaseCostThb: sum(between.map(t => t.costThb)), recordsWithoutOdometer: between.filter(t => t.odometerKm === null).length,
      efficiency: { status: "unknown", reason: between.every(t => t.fullTankConfirmed === true) && a.fullTankConfirmed === true ? "estimate_requires_validated_full_to_full_review" : "full_tank_evidence_unavailable" }
    });
  }
  return result;
}

export type VehicleFuelSummary = {
  vehicleId: string; registration: string; attribution: "unique" | "duplicate_registration";
  records: number | null; litresByType: FuelByType[] | null; litres: number | null; costThb: number | null; reviewRecords: number | null;
  latestOdometer: { km: number; date: string; id: string } | null;
  coverage: { records: number; withOdometer: number; withFuelType: number; receiptChecked: number; daysWithRecords: number; firstDate: string | null; lastDate: string | null; latestEntryAt: string | null } | null;
  transactions: FuelTransaction[] | null; intervals: FuelInterval[] | null;
};

/** Each Fuel Log row is assigned to at most one registry vehicle; duplicates and unmatched rows are counted, never split. */
export function summarizeFuelRange(registry: readonly RegistryVehicle[], rows: readonly FuelRow[] | null, range: { from: string; to: string }) {
  const byKey = new Map<string, RegistryVehicle[]>();
  for (const v of registry) byKey.set(registrationKey(v.vehicle_reg), [...(byKey.get(registrationKey(v.vehicle_reg)) ?? []), v]);
  const seen = new Set<string>();
  const assigned = new Map<string, FuelTransaction[]>();
  let unmatched = 0, duplicateRows = 0, outsideRange = 0, ambiguous = 0;
  for (const row of rows ?? []) {
    const id = String(row.id);
    if (seen.has(id)) { duplicateRows++; continue; } seen.add(id);
    if (row.date < range.from || row.date > range.to) { outsideRange++; continue; }
    const candidates = byKey.get(registrationKey(row.vehicle_reg ?? "")) ?? [];
    // A stable vehicle_id on the source row wins; otherwise a registration must map to exactly one registry vehicle.
    const target = row.vehicle_id ? registry.find(v => v.id === row.vehicle_id) : candidates.length === 1 ? candidates[0] : undefined;
    if (!target) { if (candidates.length > 1) ambiguous++; else unmatched++; continue; }
    assigned.set(target.id, [...(assigned.get(target.id) ?? []), toTransaction(row)]);
  }
  const vehicles: VehicleFuelSummary[] = registry.map(v => {
    const duplicate = (byKey.get(registrationKey(v.vehicle_reg))?.length ?? 0) > 1;
    const base = { vehicleId: v.id, registration: v.vehicle_reg, attribution: duplicate ? "duplicate_registration" as const : "unique" as const };
    if (rows === null || (duplicate && !rows.some(r => r.vehicle_id === v.id))) return { ...base, records: null, litresByType: null, litres: null, costThb: null, reviewRecords: null, latestOdometer: null, coverage: null, transactions: null, intervals: null };
    const tx = (assigned.get(v.id) ?? []).sort(order);
    const groups = groupByType(tx);
    const odo = tx.filter(t => t.odometerKm !== null);
    const last = odo.at(-1);
    return { ...base, records: tx.length, litresByType: groups, litres: singleTypeLitres(groups), costThb: sum(tx.map(t => t.costThb)), reviewRecords: tx.filter(t => t.reviewFlags.length > 0).length,
      latestOdometer: last ? { km: last.odometerKm!, date: last.date, id: last.id } : null,
      coverage: { records: tx.length, withOdometer: odo.length, withFuelType: tx.filter(t => t.fuelType !== "unrecorded").length, receiptChecked: tx.filter(t => t.receiptChecked === true).length,
        daysWithRecords: new Set(tx.map(t => t.date)).size, firstDate: tx[0]?.date ?? null, lastDate: tx.at(-1)?.date ?? null, latestEntryAt: tx.map(t => t.enteredAt).filter((x): x is string => !!x).sort().at(-1) ?? null },
      transactions: tx, intervals: fuelIntervals(tx) };
  });
  const matched = [...assigned.values()].reduce((n, g) => n + g.length, 0);
  const all = [...assigned.values()].flat();
  const fleetGroups = groupByType(all);
  return { vehicles, fleet: { matchedRecords: matched, unmatchedRecords: unmatched, ambiguousRegistrationRecords: ambiguous, duplicateSourceRows: duplicateRows, outsideRangeRecords: outsideRange,
    byType: fleetGroups, costThb: sum(all.map(t => t.costThb)), reviewRecords: all.filter(t => t.reviewFlags.length > 0).length, vehiclesWithPurchases: vehicles.filter(v => (v.records ?? 0) > 0).length, daysInRange: daysInRange(range.from, range.to) } };
}

/** Three-source comparison. Only identical observation periods are comparable; otherwise the reason is shown. */
export type SourceDistance = { source: "forth_provider" | "forth_gps" | "fuel_log_odometer" | "weekly_odometer"; km: number | null; periodStart: string | null; periodEnd: string | null; complete: boolean };
export function compareSources(a: SourceDistance, b: SourceDistance, toleranceKm = 5) {
  if (a.km === null || b.km === null) return { status: "not_comparable" as const, reason: "missing_distance", differenceKm: null };
  if (!a.periodStart || !b.periodStart || a.periodStart !== b.periodStart || a.periodEnd !== b.periodEnd) return { status: "not_comparable" as const, reason: "different_observation_periods", differenceKm: null };
  if (!a.complete || !b.complete) return { status: "incomplete" as const, reason: "coverage_or_observation_time_uncertain", differenceKm: b.km - a.km };
  const d = b.km - a.km;
  return { status: Math.abs(d) > toleranceKm ? "review_required" as const : "within_tolerance" as const, reason: "same_period_comparison_no_source_correction", differenceKm: d };
}
