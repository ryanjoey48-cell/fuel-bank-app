/**
 * Fleet mileage reconciliation and exceptions. Pure, read-only. Inputs are rows already read from the
 * existing Fuel Logs, Weekly Mileage and Booking Diary tables plus provider days the operator already read.
 * Unknown never becomes zero; sources are never merged; incompatible periods are never compared.
 */
import { checkpointIntervals, type OdometerCheckpoint } from "./fleet-intelligence-mileage";
import { buildVehicleDayLedger, type VehicleDayLedger } from "./fleet-distance-ledger";
import { assessBookingQuality, type BookingQualityReport } from "./fleet-booking-quality";
import { allocateJourneyDistance, matchJourneysToBookings, summarizeFleetAllocation, type DistanceAllocation, type JourneyLedger } from "./fleet-journey-ledger";
import { compareSources, daysInRange, registrationKey, summarizeFuelRange, type FuelRow, type RegistryVehicle, type SourceDistance } from "./fleet-fuel-view";

export type WeeklyRow = { id: string | number; week_ending: string; vehicle_reg: string; vehicle_id?: string | null; odometer_reading?: unknown; mileage?: unknown;
  is_odometer_baseline?: boolean | null; created_at?: string | null };
export type BookingRow = { id: string | number; booking_date: string; booking_id?: string | null; pickup_lat?: number | string | null; pickup_lng?: number | string | null; dropoff_lat?: number | string | null; dropoff_lng?: number | string | null; pickup_time?: string | null; vehicle_id?: string | null; vehicle_registration?: string | null; vehicle?: string | null; job_order_number?: string | null };
export type ProviderDayLite = { day: string; km: number | null; reconciled: boolean; complete: boolean; gpsKm: number | null; segments: number;
  openSegments?: number; storedAt?: string | null; expiresAt?: string | null; segmentList?: { id: string; km: number }[]; journeyLedger?: JourneyLedger | null; journeyRestricted?: boolean };
export type LiveVehicleLite = { positionQuality: string | null; timestampStatus: string | null; lastGpsTimestamp: string | null };

export type ExceptionKind = "gps_unavailable_or_stale" | "provider_distance_missing" | "odometer_discrepancy" | "repeated_odometer" | "unusual_fuel_purchase" | "duplicate_registration_mapping" | "unmatched_booking_job" | "missing_observation_timestamp";
export type MileageException = { kind: ExceptionKind; vehicleId: string | null; registration: string | null; detail: string; evidence: string[] };

const num = (v: unknown): number | null => { const n = typeof v === "number" ? v : typeof v === "string" && /^\d+(?:\.\d+)?$/.test(v.trim()) ? Number(v) : NaN; return Number.isFinite(n) && n >= 0 ? n : null; };
/** Bangkok calendar days from..to inclusive. Noon avoids any day-boundary rounding. */
export const dayList = (from: string, to: string) => Array.from({ length: daysInRange(from, to) }, (_, i) => new Date(Date.parse(`${from}T12:00:00+07:00`) + i * 86400000 + 7 * 3600000).toISOString().slice(0, 10));

function toCheckpoint(source: "fuel_logs" | "weekly_mileage", vehicle: RegistryVehicle, row: { id: string | number; date: string; reg: string; odometer: number | null; created: string | null; baseline: boolean | null }): OdometerCheckpoint {
  return { id: String(row.id), source, vehicleId: vehicle.id, registrationSnapshot: row.reg, observationDate: row.date, observedAt: null, enteredAt: row.created ?? "", odometerKm: row.odometer,
    meterEpoch: "unconfirmed-original", baseline: row.baseline, identity: "registration_only", sourceHash: `${source}:${row.id}:${row.date}:${row.odometer}`, raw: {}, fullTankConfirmed: null };
}

export type OdometerSource = { readings: number; withKm: number; latest: { km: number; date: string } | null; spanKm: number | null; span: { from: string; to: string } | null; intervals: number; reviewIntervals: number;
  repeated: number; baselineUnknown: number; missingEntryTimestamp: number; withheldReasons: string[] };
function summarizeOdometer(checkpoints: OdometerCheckpoint[], source: "fuel_logs" | "weekly_mileage"): OdometerSource {
  const own = checkpoints.filter(c => c.source === source).sort((a, b) => a.observationDate.localeCompare(b.observationDate) || a.enteredAt.localeCompare(b.enteredAt));
  const withKm = own.filter(c => c.odometerKm !== null);
  const repeated = withKm.filter((c, i) => i > 0 && c.odometerKm === withKm[i - 1].odometerKm).length;
  let intervals: ReturnType<typeof checkpointIntervals> = [];
  try { intervals = checkpointIntervals(own); } catch { intervals = []; }
  const valid = intervals.filter(i => i.source === source);
  const spanKm = valid.length > 0 && valid.every(i => i.metric.value !== null) ? valid.reduce((n, i) => n + i.metric.value!, 0) : null;
  const last = withKm.at(-1);
  return { readings: own.length, withKm: withKm.length, latest: last ? { km: last.odometerKm!, date: last.observationDate } : null, spanKm, span: valid.length ? { from: valid[0].from.observationDate, to: valid.at(-1)!.to.observationDate } : null,
    intervals: valid.length, reviewIntervals: valid.filter(i => i.metric.value === null).length, repeated, baselineUnknown: source === "weekly_mileage" ? own.filter(c => c.baseline === null).length : 0,
    missingEntryTimestamp: own.filter(c => !Number.isFinite(Date.parse(c.enteredAt))).length,
    withheldReasons: [...new Set(valid.filter(i => i.metric.value === null).flatMap(i => i.metric.reasons))] };
}

export function buildMileageReport(input: { registry: readonly (RegistryVehicle & { active?: boolean | null })[]; range: { from: string; to: string }; fuel: readonly FuelRow[] | null; weekly: readonly WeeklyRow[] | null;
  bookings: readonly BookingRow[] | null; providerDays: ReadonlyMap<string, readonly ProviderDayLite[]>; live: ReadonlyMap<string, LiveVehicleLite> | null }) {
  const { registry, range } = input; const days = dayList(range.from, range.to);
  const byKey = new Map<string, RegistryVehicle[]>(); for (const v of registry) byKey.set(registrationKey(v.vehicle_reg), [...(byKey.get(registrationKey(v.vehicle_reg)) ?? []), v]);
  const unique = (reg: string) => { const m = byKey.get(registrationKey(reg ?? "")); return m && m.length === 1 ? m[0] : null; };
  const fuelSummary = summarizeFuelRange(registry, input.fuel, range);
  const fuelCheckpoints = new Map<string, OdometerCheckpoint[]>(), weeklyCheckpoints = new Map<string, OdometerCheckpoint[]>();
  const seen = new Set<string>(); let weeklyUnmatched = 0, weeklyAmbiguous = 0, weeklyDuplicates = 0, weeklyOutside = 0;
  for (const row of input.fuel ?? []) { const v = unique(row.vehicle_reg); if (!v || row.date < range.from || row.date > range.to) continue; const id = `f:${row.id}`; if (seen.has(id)) continue; seen.add(id);
    fuelCheckpoints.set(v.id, [...(fuelCheckpoints.get(v.id) ?? []), toCheckpoint("fuel_logs", v, { id: row.id, date: row.date, reg: row.vehicle_reg, odometer: num(row.odometer), created: row.created_at ?? null, baseline: false })]); }
  for (const row of input.weekly ?? []) { const id = `w:${row.id}`; if (seen.has(id)) { weeklyDuplicates++; continue; } seen.add(id);
    if (row.week_ending < range.from || row.week_ending > range.to) { weeklyOutside++; continue; }
    const candidates = byKey.get(registrationKey(row.vehicle_reg ?? "")) ?? []; const v = row.vehicle_id ? registry.find(r => r.id === row.vehicle_id) : candidates.length === 1 ? candidates[0] : undefined;
    if (!v) { if (candidates.length > 1) weeklyAmbiguous++; else weeklyUnmatched++; continue; }
    const km = num(row.odometer_reading) ?? num(row.mileage);
    weeklyCheckpoints.set(v.id, [...(weeklyCheckpoints.get(v.id) ?? []), toCheckpoint("weekly_mileage", v, { id: row.id, date: row.week_ending, reg: row.vehicle_reg, odometer: km, created: row.created_at ?? null, baseline: typeof row.is_odometer_baseline === "boolean" ? row.is_odometer_baseline : null })]); }

  const exceptions: MileageException[] = [];
  const dateOnly = { fuel_logs: 0, weekly_mileage: 0 };
  const vehicles = registry.map(v => {
    const dup = (byKey.get(registrationKey(v.vehicle_reg))?.length ?? 0) > 1;
    const fuelV = fuelSummary.vehicles.find(x => x.vehicleId === v.id)!;
    const all = [...(fuelCheckpoints.get(v.id) ?? []), ...(weeklyCheckpoints.get(v.id) ?? [])];
    const fuelOdo = dup ? null : summarizeOdometer(all, "fuel_logs"), weeklyOdo = dup ? null : summarizeOdometer(all, "weekly_mileage");
    const pdays = input.providerDays.get(v.id) ?? [];
    const read = pdays.filter(d => days.includes(d.day));
    const accepted = read.filter(d => d.reconciled && d.km !== null);
    const provider = { daysInRange: days.length, daysRead: read.length, daysReconciled: accepted.length, km: accepted.length ? accepted.reduce((n, d) => n + d.km!, 0) : null,
      coverage: read.length === 0 ? "none" as const : accepted.length === days.length && accepted.every(d => d.complete) ? "complete" as const : "partial" as const, gpsKm: null as number | null,
      // Per-day retrieval status with cache provenance (stored/expiry). Failed reconciliations are listed but contribute no km.
      days: read.map(d => ({ day: d.day, km: d.reconciled ? d.km : null, reconciled: d.reconciled, complete: d.complete, segments: d.segments, openSegments: d.openSegments ?? null, storedAt: d.storedAt ?? null, expiresAt: d.expiresAt ?? null })) };
    const sourceFuel: SourceDistance = { source: "fuel_log_odometer", km: fuelOdo?.spanKm ?? null, periodStart: fuelOdo?.span?.from ?? null, periodEnd: fuelOdo?.span?.to ?? null, complete: false };
    const sourceWeekly: SourceDistance = { source: "weekly_odometer", km: weeklyOdo?.spanKm ?? null, periodStart: weeklyOdo?.span?.from ?? null, periodEnd: weeklyOdo?.span?.to ?? null, complete: false };
    const sourceProvider: SourceDistance = { source: "forth_provider", km: provider.coverage === "complete" ? provider.km : null, periodStart: provider.coverage === "complete" ? range.from : null, periodEnd: provider.coverage === "complete" ? range.to : null, complete: provider.coverage === "complete" };
    const comparisons = [["provider_vs_fuel_odometer", sourceProvider, sourceFuel], ["provider_vs_weekly_odometer", sourceProvider, sourceWeekly], ["fuel_vs_weekly_odometer", sourceFuel, sourceWeekly]].map(([pair, a, b]) => ({ pair: pair as string, ...compareSources(a as SourceDistance, b as SourceDistance) }));
    const liveRec = input.live?.get(registrationKey(v.vehicle_reg));
    const push = (kind: ExceptionKind, detail: string, evidence: string[] = []) => exceptions.push({ kind, vehicleId: v.id, registration: v.vehicle_reg, detail, evidence });
    if (dup) push("duplicate_registration_mapping", "registration_shared_by_multiple_registry_rows", [`registry_rows:${byKey.get(registrationKey(v.vehicle_reg))!.length}`]);
    if (input.live !== null && !dup) { if (!liveRec) push("gps_unavailable_or_stale", "not_in_live_gps_fleet"); else if (liveRec.positionQuality !== "gps") push("gps_unavailable_or_stale", `position_quality_${liveRec.positionQuality ?? "unknown"}`, [liveRec.lastGpsTimestamp ?? "no_last_gps_timestamp"]); else if (liveRec.timestampStatus === "stale") push("gps_unavailable_or_stale", "position_time_stale", [liveRec.lastGpsTimestamp ?? ""]); }
    if (!dup && v.active !== false && provider.coverage !== "complete") push("provider_distance_missing", provider.coverage === "none" ? "no_provider_day_read_for_period" : provider.daysReconciled < provider.daysInRange ? `provider_days_reconciled_${provider.daysReconciled}_of_${provider.daysInRange}` : "all_days_read_but_full_day_coverage_unverified");
    for (const tx of fuelV.transactions ?? []) if (tx.reviewFlags.length) push("unusual_fuel_purchase", tx.reviewFlags.join(","), [`fuel_log:${tx.id}`, `date:${tx.date}`, `litres:${tx.litres ?? "unknown"}`, `cost_thb:${tx.costThb ?? "unknown"}`]);
    for (const [name, odo] of [["fuel_logs", fuelOdo], ["weekly_mileage", weeklyOdo]] as const) if (odo) {
      if (odo.repeated > 0) push("repeated_odometer", `${odo.repeated}_consecutive_identical_readings_in_${name}`);
      if (odo.reviewIntervals > 0) push("odometer_discrepancy", `${odo.reviewIntervals}_interval_withheld_in_${name}`, odo.withheldReasons.length ? odo.withheldReasons : ["reason_not_reported"]);
      if (odo.missingEntryTimestamp > 0) push("missing_observation_timestamp", `${odo.missingEntryTimestamp}_readings_without_a_valid_entry_timestamp_in_${name}`);
      dateOnly[name] += odo.readings;
    }
    for (const c of comparisons) if (c.status === "review_required") push("odometer_discrepancy", c.pair, [`difference_km:${c.differenceKm}`]);
    return { vehicleId: v.id, registration: v.vehicle_reg, registryStatus: dup ? "duplicate" as const : v.active === false ? "inactive" as const : v.active === true ? "active" as const : "unknown" as const,
      attribution: dup ? "duplicate_registration" as const : "unique" as const, fuel: dup ? null : { records: fuelV.records, litres: fuelV.litres, litresByType: fuelV.litresByType, costThb: fuelV.costThb }, fuelOdometer: fuelOdo, weeklyOdometer: weeklyOdo, provider, comparisons };
  });

  // Systematic, not per-vehicle: observation times are not recorded at all in these sources.
  if (dateOnly.fuel_logs > 0) exceptions.push({ kind: "missing_observation_timestamp", vehicleId: null, registration: null, detail: "fuel_log_odometer_readings_are_date_only", evidence: [`readings:${dateOnly.fuel_logs}`, "entry_time_is_not_observation_time"] });
  if (dateOnly.weekly_mileage > 0) exceptions.push({ kind: "missing_observation_timestamp", vehicleId: null, registration: null, detail: "weekly_mileage_date_is_week_ending_proxy", evidence: [`readings:${dateOnly.weekly_mileage}`, "entry_time_is_not_observation_time"] });
  // Booking Diary rows that cannot be tied to exactly one registry vehicle.
  let bookingsInRange = 0; const unmatchedBookings: BookingRow[] = [];
  // Every job is only a booked assignment: status stays "unconfirmed" and no kilometres are allocated to it.
  const jobs: { id: string; date: string; registration: string | null; workOrder: string | null; vehicleId: string | null; status: "unconfirmed"; allocatedKm: null; pickupTime: string | null; assignment: "stable_vehicle_id" | "registration_only" }[] = [];
  if (input.bookings) for (const b of input.bookings) { if (b.booking_date < range.from || b.booking_date > range.to) continue; bookingsInRange++;
    const byId = b.vehicle_id ? registry.some(v => v.id === b.vehicle_id) : false; const m = byKey.get(registrationKey(b.vehicle_registration ?? b.vehicle ?? ""));
    if (jobs.length < 200) jobs.push({ id: String(b.id), date: b.booking_date, registration: b.vehicle_registration ?? b.vehicle ?? null, workOrder: b.job_order_number ?? null, vehicleId: byId ? b.vehicle_id! : m && m.length === 1 ? m[0].id : null, status: "unconfirmed", allocatedKm: null, pickupTime: typeof b.pickup_time === "string" ? b.pickup_time : null, assignment: byId ? "stable_vehicle_id" : "registration_only" });
    if (!byId && !(m && m.length === 1)) { unmatchedBookings.push(b); exceptions.push({ kind: "unmatched_booking_job", vehicleId: null, registration: b.vehicle_registration ?? b.vehicle ?? null, detail: m && m.length > 1 ? "booking_registration_shared_by_multiple_registry_rows" : "booking_vehicle_not_in_registry", evidence: [`booking:${b.id}`, `date:${b.booking_date}`, `work_order:${b.job_order_number ?? "none"}`] }); } }

  // Aggregates: only unique registry vehicles, only reconciled provider days, never mixed with odometer or GPS figures.
  const eligible = vehicles.filter(v => v.attribution === "unique" && v.registryStatus !== "inactive");
  const withProvider = eligible.filter(v => v.provider.daysReconciled > 0);
  const completeProvider = eligible.filter(v => v.provider.coverage === "complete");
  const totals = {
    eligibleVehicles: eligible.length, excludedDuplicates: vehicles.filter(v => v.attribution !== "unique").length, excludedInactive: vehicles.filter(v => v.registryStatus === "inactive").length,
    providerContributingVehicles: withProvider.length, providerCompleteVehicles: completeProvider.length,
    providerKmPartial: withProvider.length ? withProvider.reduce((n, v) => n + v.provider.km!, 0) : null, providerKmPartialDays: withProvider.reduce((n, v) => n + v.provider.daysReconciled, 0),
    providerKmFleet: completeProvider.length === eligible.length && eligible.length > 0 ? completeProvider.reduce((n, v) => n + v.provider.km!, 0) : null,
    gpsDerivedKm: null as number | null, fuelRecords: fuelSummary.fleet.matchedRecords, fuelCostThb: fuelSummary.fleet.costThb, fuelByType: fuelSummary.fleet.byType,
    vehiclesWithFuelOdometer: vehicles.filter(v => (v.fuelOdometer?.withKm ?? 0) > 0).length, vehiclesWithWeeklyOdometer: vehicles.filter(v => (v.weeklyOdometer?.withKm ?? 0) > 0).length,
    bookingsInRange: input.bookings ? bookingsInRange : null, unmatchedBookings: input.bookings ? unmatchedBookings.length : null, weeklyUnmatched, weeklyAmbiguous, weeklyDuplicates, weeklyOutside };
  // Vehicle-day accountability ledger: only vehicle-days that have some evidence, only unique-registration vehicles.
  const jobsByVehicleDay = new Map<string, { id: string; workOrder: string | null; pickupTime: string | null; assignment: "stable_vehicle_id" | "registration_only" }[]>();
  for (const j of jobs) if (j.vehicleId) jobsByVehicleDay.set(`${j.vehicleId}|${j.date}`, [...(jobsByVehicleDay.get(`${j.vehicleId}|${j.date}`) ?? []), { id: j.id, workOrder: j.workOrder, pickupTime: j.pickupTime, assignment: j.assignment }]);
  // V4.4: per vehicle-day journey allocation, only from provider days already read this session (no new Forth calls).
  const ledger: (VehicleDayLedger & { journeysRestricted: boolean; journeys: { moving: number; candidateJobs: number; needsReview: number; allocation: DistanceAllocation } | null })[] = [];
  for (const v of vehicles) {
    if (v.attribution !== "unique") continue;
    const tx = fuelSummary.vehicles.find(x => x.vehicleId === v.vehicleId)?.transactions ?? [];
    for (const day of days) {
      if (ledger.length >= 2000) break;
      const pd = (input.providerDays.get(v.vehicleId) ?? []).find(d => d.day === day) ?? null;
      const dayTx = tx.filter(t => t.date === day), wcp = (weeklyCheckpoints.get(v.vehicleId) ?? []).filter(c => c.observationDate === day), dayJobs = jobsByVehicleDay.get(`${v.vehicleId}|${day}`) ?? [];
      if (!pd && dayTx.length === 0 && wcp.length === 0 && dayJobs.length === 0) continue;
      const ex: string[] = [];
      if (pd && !pd.reconciled) ex.push("provider_totals_not_reconciled");
      if (pd && (pd.openSegments ?? 0) > 0) ex.push("open_final_segment_coverage_unverified");
      if (dayTx.some(t => t.reviewFlags.length)) ex.push("unusual_fuel_purchase");
      const litres = dayTx.length ? (dayTx.some(t => t.litres === null) ? null : dayTx.reduce((n, t) => n + t.litres!, 0)) : 0, cost = dayTx.length ? (dayTx.some(t => t.costThb === null) ? null : dayTx.reduce((n, t) => n + t.costThb!, 0)) : 0;
      const matches = pd?.journeyLedger ? matchJourneysToBookings(day, pd.journeyLedger, input.bookings === null ? null : dayJobs.map(j => ({ jobId: j.id, workOrder: j.workOrder, pickupTime: j.pickupTime, bookingAssignment: j.assignment }))) : null;
      const journeys = pd?.journeyLedger && matches ? { moving: pd.journeyLedger.totals.movingJourneys, candidateJobs: matches.jobs.filter(j => j.status === "candidate").length, needsReview: matches.jobs.filter(j => j.status === "needs_review" || j.status === "no_journey").length,
        allocation: allocateJourneyDistance({ ledger: pd.journeyLedger, matches, providerReconciled: pd.reconciled, providerComplete: pd.complete && (pd.openSegments ?? 0) === 0, providerTotalKm: pd.reconciled ? pd.km : null }) } : null;
      if (journeys && journeys.needsReview > 0) ex.push("job_matches_need_office_review");
      if (pd?.journeyLedger?.totals.outsideReportLogKm) ex.push("log_distance_outside_report_segments");
      ledger.push({ journeys, journeysRestricted: Boolean(pd?.journeyRestricted), ...buildVehicleDayLedger({ vehicleId: v.vehicleId, registration: v.registration, day, timeZone: "Asia/Bangkok",
        provider: pd ? { km: pd.km, reconciled: pd.reconciled, complete: pd.complete, segments: pd.segments, openSegments: pd.openSegments ?? 0, capturedAt: pd.storedAt ?? null, expiresAt: pd.expiresAt ?? null, segmentList: pd.segmentList } : null,
        gpsKm: pd?.gpsKm ?? null, fuelOdometer: dayTx.map(t => ({ id: t.id, km: t.odometerKm })), weeklyOdometer: wcp.map(c => ({ id: c.id, km: c.odometerKm, baseline: c.baseline })),
        fuelPurchase: input.fuel === null ? null : { records: dayTx.length, litres, costThb: cost }, bookings: input.bookings === null ? null : dayJobs.map(j => ({ id: j.id, workOrder: j.workOrder })), exceptions: ex }) });
    }
  }
  const journeyTotals = summarizeFleetAllocation(ledger.filter(l => l.provider.state !== "not_read").map(l => ({ vehicleId: l.vehicleId, registration: l.registration, day: l.day, allocation: l.journeys?.allocation ?? null })));
  const bookingQuality: BookingQualityReport | null = input.bookings ? assessBookingQuality(input.bookings.filter(b => b.booking_date >= range.from && b.booking_date <= range.to), registry) : null;
  return { range, days: days.length, vehicles, exceptions, totals: { ...totals, journeyTotals }, jobs, ledger, bookingQuality };
}
export type MileageReport = ReturnType<typeof buildMileageReport>;

const SEVERITY: Record<ExceptionKind, number> = { unusual_fuel_purchase: 1, odometer_discrepancy: 2, duplicate_registration_mapping: 3, unmatched_booking_job: 4, repeated_odometer: 5, gps_unavailable_or_stale: 6, provider_distance_missing: 7, missing_observation_timestamp: 9 };
/** Compact investigation queue: highest-impact exceptions first, grouped per vehicle so one vehicle is not listed twenty times. */
export function prioritizeExceptions(exceptions: readonly MileageException[], limit = 12) {
  const byVehicle = new Map<string, { vehicleId: string | null; registration: string | null; worst: number; kinds: Set<ExceptionKind>; count: number }>();
  for (const e of exceptions) {
    if (e.kind === "provider_distance_missing" || e.kind === "missing_observation_timestamp") continue;          // coverage notes, not investigations
    const k = e.vehicleId ?? `fleet:${e.kind}`; const g = byVehicle.get(k) ?? { vehicleId: e.vehicleId, registration: e.registration, worst: 99, kinds: new Set<ExceptionKind>(), count: 0 };
    g.worst = Math.min(g.worst, SEVERITY[e.kind]); g.kinds.add(e.kind); g.count++; byVehicle.set(k, g);
  }
  return [...byVehicle.values()].sort((a, b) => a.worst - b.worst || b.count - a.count || (a.registration ?? "").localeCompare(b.registration ?? "")).slice(0, limit).map(g => ({ vehicleId: g.vehicleId, registration: g.registration, kinds: [...g.kinds].sort((x, y) => SEVERITY[x] - SEVERITY[y]), count: g.count }));
}

/** Calendar buckets in Asia/Bangkok. Weeks run Monday to Sunday and are clipped to the selected range; months are calendar months. */
export function bucketKey(day: string, view: "day" | "week" | "month") {
  if (view === "day") return day;
  if (view === "month") return day.slice(0, 7);
  const dow = new Date(`${day}T12:00:00+07:00`).getUTCDay(); const back = (dow + 6) % 7;                       // Monday = 0
  return new Date(Date.parse(`${day}T12:00:00+07:00`) - back * 86400000 + 7 * 3600000).toISOString().slice(0, 10);
}
export function bucketReport(report: Pick<MileageReport, "vehicles" | "range">, view: "day" | "week" | "month") {
  const days = dayList(report.range.from, report.range.to); const eligible = report.vehicles.filter(v => v.attribution === "unique" && v.registryStatus !== "inactive");
  const buckets = new Map<string, string[]>(); for (const d of days) buckets.set(bucketKey(d, view), [...(buckets.get(bucketKey(d, view)) ?? []), d]);
  return [...buckets].map(([key, bucketDays]) => {
    const expected = eligible.length * bucketDays.length; let reconciled = 0, complete = 0, km = 0; const vehicles = new Set<string>(); let unreconciledRead = 0;
    for (const v of eligible) for (const d of v.provider.days) if (bucketDays.includes(d.day)) {
      if (d.reconciled && d.km !== null) { reconciled++; km += d.km; vehicles.add(v.vehicleId); if (d.complete && (d.openSegments ?? 0) === 0) complete++; } else unreconciledRead++; }
    return { key, from: bucketDays[0], to: bucketDays.at(-1)!, days: bucketDays.length, eligibleVehicles: eligible.length, expectedVehicleDays: expected, reconciledVehicleDays: reconciled, unreconciledVehicleDays: unreconciledRead, reportingVehicles: vehicles.size,
      providerKmPartial: reconciled ? Math.round(km * 100) / 100 : null,
      // A bucket total is the fleet's distance only when every eligible vehicle-day is reconciled AND complete. Today coverage is never complete, so this stays null.
      providerKmFleet: expected > 0 && complete === expected ? Math.round(km * 100) / 100 : null,
      status: reconciled === 0 ? "not_read" as const : complete === expected ? "complete" as const : "partial" as const };
  });
}
