// Internal pricing audit: how each work order's customer transport charge was (or would be) determined.
// Pure functions over saved Finance data — nothing here is hardcoded for display and nothing writes.
import {
  confirmedWorkOrder,
  diagnoseRate,
  fuelReferenceFor,
  fuelStatusOf,
  type BillingSheet,
  type Booking,
  type FuelReference,
  type State
} from "./finance-demo-centre";

export type FuelCalcState = "applied" | "ready" | "provisional" | "blocked";
export type FuelCalculation = {
  state: FuelCalcState;
  workOrder: string; customer: string; jobDate: string; route: string; vehicle: string; registration: string;
  fuel: { priceThb: number | null; status: "missing" | "proposed" | "verified" | "disputed"; sourceUrl: string; evidence: string; verifiedBy: string; verifiedAt: string };
  schedule: string; scheduleVersion: string; sourcePage: number | null; routeRow: string; rowVehicle: string; band: string;
  tableCharge: number | null; applied: number | null; overrideReason: string; source: "schedule" | "manual" | "none";
  note: string;
};

const FUEL_URL = "https://xn--42c6baaa9bl0b2fcebb3cztja2d.com/history";
const TH_MONTHS = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
const EN_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** Where to look on the approved history page: its month list is in Thai and its rows use the Buddhist year (2026 = พ.ศ. 2569). */
export function sourceLookup(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return { thaiMonth: TH_MONTHS[m - 1], enMonth: EN_MONTHS[m - 1], buddhistYear: y + 543, gregorianYear: y, day: d, rowText: `${d} ${TH_MONTHS[m - 1]} ${y + 543}`, url: FUEL_URL };
}

/** One internal calculation line for a work order: job date → fuel price (and its status) → band → exact table charge → applied charge. */
export function fuelCalculation(state: State, sheet: BillingSheet | null, job: Booking): FuelCalculation {
  const line = sheet?.lines[job.id]?.transport ?? null;
  const p = line?.provenance ?? null;
  const ref = fuelReferenceFor(state, job.date);
  const status = ref ? fuelStatusOf(ref) : "missing";
  const base = {
    workOrder: confirmedWorkOrder(job), customer: job.client, jobDate: job.date, route: `${job.pickup} → ${job.delivery}`,
    vehicle: job.diarySource?.vehicle || "", registration: job.diarySource?.vehicle_registration || job.vehicle
  };
  const fuelOf = (r: FuelReference | null) => ({
    priceThb: r ? r.priceThb : null, status: (r ? fuelStatusOf(r) : "missing") as FuelCalculation["fuel"]["status"], sourceUrl: r?.sourceUrl ?? FUEL_URL, evidence: r?.evidence ?? "",
    verifiedBy: r?.verifiedBy ?? "", verifiedAt: r?.verifiedAt ?? ""
  });
  if (p) {
    return { ...base, state: "applied", fuel: { priceThb: p.fuel.priceThb, status: ref && ref.priceThb === p.fuel.priceThb ? status : "verified", sourceUrl: p.fuel.sourceUrl, evidence: p.fuel.evidence, verifiedBy: (ref && ref.priceThb === p.fuel.priceThb ? ref.verifiedBy : null) ?? p.fuel.reviewer ?? "", verifiedAt: (ref && ref.priceThb === p.fuel.priceThb ? ref.verifiedAt : null) ?? "" },
      schedule: p.scheduleName, scheduleVersion: p.scheduleVersion, sourcePage: p.sourcePage, routeRow: p.route, rowVehicle: p.vehicle, band: p.bandLabel, tableCharge: p.suggestedThb, applied: p.appliedThb, overrideReason: p.overrideReason ?? "",
      source: line?.source ?? "schedule", note: p.overrideReason ? "Manual override of the table charge (the table amount is kept for comparison)." : "Charge taken exactly from the approved rate table." };
  }
  const d = diagnoseRate(state, job);
  if (d.kind === "suggested") {
    return { ...base, state: "ready", fuel: fuelOf(ref), schedule: d.scheduleName, scheduleVersion: d.scheduleVersion, sourcePage: d.sourcePage, routeRow: d.route, rowVehicle: d.vehicle, band: d.bandLabel, tableCharge: d.amountThb,
      applied: line ? line.amount : null, overrideReason: line?.overrideReason ?? "", source: line ? line.source : "none", note: line ? "A price was entered manually before the table price was applied." : "Verified fuel and an approved mapping give this table charge; not applied yet." };
  }
  const prov = d.provisional;
  if (prov) {
    return { ...base, state: "provisional", fuel: fuelOf(ref), schedule: prov.scheduleName, scheduleVersion: prov.scheduleVersion, sourcePage: prov.sourcePage, routeRow: prov.route, rowVehicle: prov.vehicle, band: prov.bandLabel, tableCharge: prov.amountThb,
      applied: line ? line.amount : null, overrideReason: line?.overrideReason ?? "", source: line ? line.source : "none", note: "Provisional: the fuel price is proposed, not verified. Subject to mapping and fuel confirmation." };
  }
  return { ...base, state: "blocked", fuel: fuelOf(ref), schedule: "", scheduleVersion: "", sourcePage: null, routeRow: "", rowVehicle: "", band: "", tableCharge: null, applied: line ? line.amount : null, overrideReason: line?.overrideReason ?? "",
    source: line ? line.source : "none", note: d.en };
}

export const FUEL_CALC_CSV_HEADER = ["Work order", "Customer", "Job date", "Route (diary)", "Registration", "Diesel B7 THB/L", "Fuel status", "Fuel evidence", "Fuel verified by", "Fuel verified at", "Fuel source", "Schedule", "Schedule version", "Source page", "Rate row", "Row vehicle", "Fuel band", "Table charge THB", "Applied charge THB", "Override reason", "State", "Note"];
export function fuelCalculationRow(c: FuelCalculation): string[] {
  return [c.workOrder, c.customer, c.jobDate, c.route, c.registration, c.fuel.priceThb === null ? "" : c.fuel.priceThb.toFixed(2), c.fuel.status, c.fuel.evidence, c.fuel.verifiedBy, c.fuel.verifiedAt, c.fuel.sourceUrl, c.schedule, c.scheduleVersion,
    c.sourcePage === null ? "" : String(c.sourcePage), c.routeRow, c.rowVehicle, c.band, c.tableCharge === null ? "" : c.tableCharge.toFixed(2), c.applied === null ? "" : c.applied.toFixed(2), c.overrideReason, c.state, c.note];
}

/** One line per distinct job date in a batch: the fuel value, its status and what it drives. */
export function fuelDateSummary(state: State, sheet: BillingSheet, jobs: Booking[]) {
  const dates = [...new Set(jobs.map((job) => job.date))].sort();
  return dates.map((date) => {
    const onDate = jobs.filter((job) => job.date === date);
    const ref = fuelReferenceFor(state, date);
    const calcs = onDate.map((job) => fuelCalculation(state, sheet, job));
    const bands = [...new Set(calcs.filter((c) => c.band).map((c) => `${c.schedule.replace(/ Pricing$/, "")}: ${c.band}`))];
    const history = (state.fuelReferences || []).filter((item) => item.date === date);
    const discrepancies: string[] = [];
    if (!ref) discrepancies.push("No value recorded for this date.");
    else if (fuelStatusOf(ref) === "proposed") discrepancies.push("Proposed value — not yet verified against the source.");
    else if (fuelStatusOf(ref) === "disputed") discrepancies.push(`Disputed: ${ref.disputeReason ?? ""}`);
    for (const c of calcs) if (c.applied !== null && c.tableCharge !== null && Math.round(c.applied * 100) !== Math.round(c.tableCharge * 100)) discrepancies.push(`WO ${c.workOrder}: applied ฿${c.applied.toFixed(2)} differs from table ฿${c.tableCharge.toFixed(2)}${c.overrideReason ? ` (${c.overrideReason})` : ""}.`);
    const charges = calcs.map((c) => ({ workOrder: c.workOrder, band: c.band, schedule: c.schedule, table: c.tableCharge, applied: c.applied, state: c.state }));
    return { date, charges, jobCount: onDate.length, workOrders: onDate.map((job) => confirmedWorkOrder(job)), ref, status: (ref ? fuelStatusOf(ref) : "missing") as "missing" | "proposed" | "verified" | "disputed", bands, history, discrepancies };
  });
}
