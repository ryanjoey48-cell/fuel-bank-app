/**
 * Candidate management analysis for V4 source previews.
 * NOT an approved accounting policy. Never enables official profit publication.
 */

export type ManagementAmountConfidence = "confirmed" | "indicative" | "unavailable" | "provisional";

export type ManagementSourceRow = {
  registration: string;
  salary: string | null;
  jobs: string | null;
  tripPayments: string | null;
  expenses: string | null;
  parkingFees: string | null;
  totalReceived: string | null;
  fuel: string | null;
  lpg: string | null;
  maintenance: string | null;
  sourceDashStatus?: Record<string, string>;
  lpgBasis?: string;
};

export type ManagementMonthReport = {
  reportingMonth: string;
  salaryStatus?: string;
  rows: ManagementSourceRow[];
  sourceFooterTotals: Record<string, string | null>;
};

export type VehicleManagementMetrics = {
  registration: string;
  confidence: ManagementAmountConfidence;
  incompleteFields: string[];
  provisionalFields: string[];
  clientRevenue: number | null;
  jobs: number | null;
  driverCost: number | null;
  salary: number | null;
  tripPayments: number | null;
  operatingCosts: number | null;
  fuelAndLpg: number | null;
  expenses: number | null;
  parkingFees: number | null;
  maintenance: number | null;
  totalRecordedCosts: number | null;
  indicativeRecordedBalance: number | null;
  indicativeRecordedMarginPercent: number | null;
  fuelSharePercent: number | null;
  revenuePerJob: number | null;
  recordedCostPerJob: number | null;
  reviewReasons: string[];
};

export type MonthManagementSummary = {
  reportingMonth: string;
  confidence: ManagementAmountConfidence;
  note: string;
  clientRevenue: number | null;
  jobs: number | null;
  driverCost: number | null;
  salary: number | null;
  tripPayments: number | null;
  fuelAndLpg: number | null;
  maintenance: number | null;
  operatingCosts: number | null;
  totalRecordedCosts: number | null;
  indicativeRecordedBalance: number | null;
  indicativeRecordedMarginPercent: number | null;
  fuelSharePercent: number | null;
};

export type MonthComparisonMetric = {
  key: string;
  label: string;
  previous: number | null;
  current: number | null;
  absoluteChange: number | null;
  percentChange: number | null;
  confidence: ManagementAmountConfidence;
};

export type ManagementAnalysisResult = {
  policyNote: string;
  lpgNote: string;
  previous: MonthManagementSummary | null;
  current: MonthManagementSummary;
  comparisons: MonthComparisonMetric[];
  vehicles: VehicleManagementMetrics[];
  reviewVehicles: VehicleManagementMetrics[];
  topRevenue: VehicleManagementMetrics[];
  highestCosts: VehicleManagementMetrics[];
  strongestBalance: VehicleManagementMetrics[];
  weakestBalance: VehicleManagementMetrics[];
};

const LPG_VEHICLE_KEY = "ฒอ8453";

export function parseManagementSourceAmount(value: string | null | undefined): number | null {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (!/^-?\d+(?:\.\d+)?$/.test(raw)) return null;
  const amount = Number(raw);
  return Number.isFinite(amount) ? amount : null;
}

function registrationKey(value: string) {
  return value.normalize("NFKC").trim().replace(/[\s-]/g, "").toLowerCase();
}

function isLpgVehicle(registration: string) {
  return registrationKey(registration) === LPG_VEHICLE_KEY;
}

function addNullable(values: Array<number | null>): number | null {
  if (values.some((value) => value == null)) return null;
  let total = 0;
  for (const value of values) total += value as number;
  return Number.isFinite(total) ? total : null;
}

function divideNullable(numerator: number | null, denominator: number | null): number | null {
  if (numerator == null || denominator == null || denominator === 0) return null;
  const result = numerator / denominator;
  return Number.isFinite(result) ? result : null;
}

function percentChange(previous: number | null, current: number | null): number | null {
  if (previous == null || current == null || previous === 0) return null;
  const result = ((current - previous) / Math.abs(previous)) * 100;
  return Number.isFinite(result) ? result : null;
}

function absoluteChange(previous: number | null, current: number | null): number | null {
  if (previous == null || current == null) return null;
  return current - previous;
}

function lpgAmountForRow(row: ManagementSourceRow, reportingMonth: string): { amount: number | null; incomplete: boolean } {
  const month = Number(reportingMonth.slice(5, 7));
  const separateFromFuel = month >= 8;
  if (!isLpgVehicle(row.registration)) {
    // Confirmed non-LPG vehicles use owner rule zero; unresolved would be incomplete.
    if (row.sourceDashStatus?.lpg === "unresolved_source_dash" && row.lpg == null) {
      return { amount: null, incomplete: true };
    }
    return { amount: 0, incomplete: false };
  }
  if (!separateFromFuel) {
    // Jan–Jul: LPG included in Fuel — do not add again.
    return { amount: 0, incomplete: false };
  }
  const amount = parseManagementSourceAmount(row.lpg);
  return { amount, incomplete: amount == null };
}

export function analyseVehicleManagementRow(
  row: ManagementSourceRow,
  reportingMonth: string,
  options?: { salaryProvisional?: boolean }
): VehicleManagementMetrics {
  const incompleteFields: string[] = [];
  const provisionalFields: string[] = [];
  const salary = parseManagementSourceAmount(row.salary);
  const jobs = parseManagementSourceAmount(row.jobs);
  const tripPayments = parseManagementSourceAmount(row.tripPayments);
  const expenses = parseManagementSourceAmount(row.expenses);
  const parkingFees = parseManagementSourceAmount(row.parkingFees);
  const clientRevenue = parseManagementSourceAmount(row.totalReceived);
  const fuel = parseManagementSourceAmount(row.fuel);
  const maintenance = parseManagementSourceAmount(row.maintenance);
  const lpg = lpgAmountForRow(row, reportingMonth);

  if (salary == null) incompleteFields.push("salary");
  if (jobs == null) incompleteFields.push("jobs");
  if (tripPayments == null) incompleteFields.push("tripPayments");
  if (expenses == null) incompleteFields.push("expenses");
  if (parkingFees == null) incompleteFields.push("parkingFees");
  if (clientRevenue == null) incompleteFields.push("totalReceived");
  if (fuel == null) incompleteFields.push("fuel");
  if (lpg.incomplete) incompleteFields.push("lpg");
  if (maintenance == null) incompleteFields.push("maintenance");
  if (options?.salaryProvisional && salary != null) provisionalFields.push("salary");

  const driverCost = addNullable([salary, tripPayments]);
  const fuelAndLpg = addNullable([fuel, lpg.amount]);
  const operatingCosts = addNullable([fuel, lpg.amount, expenses, parkingFees, maintenance]);
  const totalRecordedCosts = addNullable([driverCost, operatingCosts]);
  const indicativeRecordedBalance = addNullable([clientRevenue, totalRecordedCosts == null ? null : -totalRecordedCosts]);
  const completeForProfit = incompleteFields.length === 0;
  const confidence: ManagementAmountConfidence = !completeForProfit
    ? "unavailable"
    : provisionalFields.length
      ? "provisional"
      : "indicative";

  const metrics: VehicleManagementMetrics = {
    registration: row.registration,
    confidence,
    incompleteFields,
    provisionalFields,
    clientRevenue,
    jobs,
    driverCost,
    salary,
    tripPayments,
    operatingCosts: completeForProfit ? operatingCosts : null,
    fuelAndLpg: fuel == null || lpg.incomplete ? null : fuelAndLpg,
    expenses,
    parkingFees,
    maintenance,
    totalRecordedCosts: completeForProfit ? totalRecordedCosts : null,
    indicativeRecordedBalance: completeForProfit ? indicativeRecordedBalance : null,
    indicativeRecordedMarginPercent: completeForProfit
      ? (() => {
          const ratio = divideNullable(indicativeRecordedBalance, clientRevenue);
          return ratio == null ? null : ratio * 100;
        })()
      : null,
    fuelSharePercent: (() => {
      const ratio = divideNullable(fuelAndLpg, clientRevenue);
      return ratio == null ? null : ratio * 100;
    })(),
    revenuePerJob: divideNullable(clientRevenue, jobs),
    recordedCostPerJob: completeForProfit ? divideNullable(totalRecordedCosts, jobs) : null,
    reviewReasons: []
  };

  if (incompleteFields.length) {
    metrics.reviewReasons.push(`Incomplete source fields: ${incompleteFields.join(", ")}`);
  }
  if (provisionalFields.includes("salary")) {
    metrics.reviewReasons.push("September salary remains provisional pending independent payroll verification");
  }
  if (metrics.indicativeRecordedBalance != null && metrics.indicativeRecordedBalance < 0) {
    metrics.reviewReasons.push("Indicative recorded balance is negative");
  }
  if (metrics.fuelSharePercent != null && metrics.fuelSharePercent >= 45) {
    metrics.reviewReasons.push(`Fuel + LPG share is ${metrics.fuelSharePercent.toFixed(1)}% of client revenue`);
  }
  if ((jobs === 0 || jobs == null) && fuel != null && fuel > 0) {
    metrics.reviewReasons.push("Fuel recorded with zero or unknown jobs");
  }
  if (clientRevenue === 0 && (fuel ?? 0) > 0) {
    metrics.reviewReasons.push("Fuel recorded with zero client revenue");
  }

  return metrics;
}

export function summariseMonthFromFooter(
  report: ManagementMonthReport,
  options?: { salaryProvisional?: boolean }
): MonthManagementSummary {
  const totals = report.sourceFooterTotals;
  const salary = parseManagementSourceAmount(totals.salary);
  const jobs = parseManagementSourceAmount(totals.jobs);
  const tripPayments = parseManagementSourceAmount(totals.tripPayments);
  const expenses = parseManagementSourceAmount(totals.expenses);
  const parkingFees = parseManagementSourceAmount(totals.parkingFees);
  const clientRevenue = parseManagementSourceAmount(totals.totalReceived);
  const fuel = parseManagementSourceAmount(totals.fuel);
  const lpg = parseManagementSourceAmount(totals.lpg);
  const maintenance = parseManagementSourceAmount(totals.maintenance);
  const driverCost = addNullable([salary, tripPayments]);
  const fuelAndLpg = addNullable([fuel, lpg ?? 0]);
  const operatingCosts = addNullable([fuel, lpg ?? 0, expenses, parkingFees, maintenance]);
  const totalRecordedCosts = addNullable([driverCost, operatingCosts]);
  const indicativeRecordedBalance = addNullable([clientRevenue, totalRecordedCosts == null ? null : -totalRecordedCosts]);
  const complete = [salary, jobs, tripPayments, expenses, parkingFees, clientRevenue, fuel, maintenance].every((value) => value != null);
  const confidence: ManagementAmountConfidence = !complete
    ? "unavailable"
    : options?.salaryProvisional
      ? "provisional"
      : "indicative";

  return {
    reportingMonth: report.reportingMonth,
    confidence,
    note: "Printed source-footer illustration using dash-as-zero reconciliation for aggregate totals. Not approved accounting profit.",
    clientRevenue,
    jobs,
    driverCost,
    salary,
    tripPayments,
    fuelAndLpg: fuel == null ? null : fuelAndLpg,
    maintenance,
    operatingCosts: complete ? operatingCosts : null,
    totalRecordedCosts: complete ? totalRecordedCosts : null,
    indicativeRecordedBalance: complete ? indicativeRecordedBalance : null,
    indicativeRecordedMarginPercent: complete && clientRevenue && clientRevenue > 0 && indicativeRecordedBalance != null
      ? (indicativeRecordedBalance / clientRevenue) * 100
      : null,
    fuelSharePercent: clientRevenue != null && clientRevenue > 0 && fuel != null
      ? (((fuel + (lpg ?? 0)) / clientRevenue) * 100)
      : null
  };
}

function sortByNullable(
  rows: VehicleManagementMetrics[],
  getter: (row: VehicleManagementMetrics) => number | null,
  direction: "asc" | "desc"
) {
  return [...rows]
    .filter((row) => getter(row) != null)
    .sort((left, right) => {
      const a = getter(left) as number;
      const b = getter(right) as number;
      return direction === "desc" ? b - a : a - b;
    });
}

export function buildVehicleFinancialV4ManagementAnalysis(
  current: ManagementMonthReport,
  previous?: ManagementMonthReport | null
): ManagementAnalysisResult {
  const salaryProvisional = /provisional/i.test(current.salaryStatus ?? "");
  const previousProvisional = previous ? /provisional/i.test(previous.salaryStatus ?? "") : false;
  const currentSummary = summariseMonthFromFooter(current, { salaryProvisional });
  const previousSummary = previous ? summariseMonthFromFooter(previous, { salaryProvisional: previousProvisional }) : null;
  const vehicles = current.rows.map((row) => analyseVehicleManagementRow(row, current.reportingMonth, { salaryProvisional }));

  const comparisons: MonthComparisonMetric[] = previousSummary
    ? [
        ["clientRevenue", "Client revenue (Total Received)", previousSummary.clientRevenue, currentSummary.clientRevenue],
        ["jobs", "Jobs", previousSummary.jobs, currentSummary.jobs],
        ["fuelAndLpg", "Fuel + separately recorded LPG", previousSummary.fuelAndLpg, currentSummary.fuelAndLpg],
        ["maintenance", "Maintenance", previousSummary.maintenance, currentSummary.maintenance],
        ["driverCost", "Driver cost (Salary + Trip Payments)", previousSummary.driverCost, currentSummary.driverCost],
        ["indicativeRecordedBalance", "Indicative recorded balance", previousSummary.indicativeRecordedBalance, currentSummary.indicativeRecordedBalance]
      ].map(([key, label, previousValue, currentValue]) => ({
        key: String(key),
        label: String(label),
        previous: previousValue as number | null,
        current: currentValue as number | null,
        absoluteChange: absoluteChange(previousValue as number | null, currentValue as number | null),
        percentChange: percentChange(previousValue as number | null, currentValue as number | null),
        confidence: key === "indicativeRecordedBalance" || key === "driverCost"
          ? (salaryProvisional || previousProvisional ? "provisional" : "indicative")
          : "indicative"
      }))
    : [];

  return {
    policyNote: "Candidate management analysis only. These figures are not an approved V4 accounting policy and must not be treated as official profit.",
    lpgNote: "Only ฒอ-8453 uses LPG. January–July LPG stays inside Fuel; August–September LPG is separate and counted once.",
    previous: previousSummary,
    current: currentSummary,
    comparisons,
    vehicles,
    reviewVehicles: vehicles.filter((row) => row.reviewReasons.length > 0).slice(0, 8),
    topRevenue: sortByNullable(vehicles, (row) => row.clientRevenue, "desc").slice(0, 5),
    highestCosts: sortByNullable(vehicles, (row) => row.totalRecordedCosts, "desc").slice(0, 5),
    strongestBalance: sortByNullable(vehicles, (row) => row.indicativeRecordedBalance, "desc").slice(0, 5),
    weakestBalance: sortByNullable(vehicles, (row) => row.indicativeRecordedBalance, "asc").slice(0, 5)
  };
}
