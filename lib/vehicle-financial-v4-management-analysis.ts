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
  balanceEligible: boolean;
  reviewReasons: string[];
};

export type ReviewIssueSeverity = "high" | "medium" | "low";

export type ManagementReviewIssue = {
  registration: string;
  issue: string;
  severity: ReviewIssueSeverity;
  evidence: string;
  code: string;
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
  expenses: number | null;
  parkingFees: number | null;
  fuelAndLpg: number | null;
  fuel: number | null;
  lpg: number | null;
  maintenance: number | null;
  operatingCosts: number | null;
  totalRecordedCosts: number | null;
  indicativeRecordedBalance: number | null;
  indicativeRecordedMarginPercent: number | null;
  fuelSharePercent: number | null;
  revenuePerJob: number | null;
};

export type MonthComparisonMetric = {
  key: string;
  label: string;
  previous: number | null;
  current: number | null;
  absoluteChange: number | null;
  percentChange: number | null;
  confidence: ManagementAmountConfidence;
  category: "revenue" | "volume" | "driver" | "operating" | "indicative";
};

export type CostIncreaseInsight = {
  key: string;
  label: string;
  absoluteChange: number;
  percentChange: number | null;
  shareOfRecordedCostIncrease: number | null;
};

export type RankingMeta = {
  eligibleCompleteVehicles: number;
  incompleteVehicles: number;
  requestedLimit: number;
  strongestCount: number;
  weakestCount: number;
  note: string;
};

export type ManagementAnalysisResult = {
  policyNote: string;
  lpgNote: string;
  rankingNote: string;
  observedVsCauseNote: string;
  thresholdNote: string;
  previous: MonthManagementSummary | null;
  current: MonthManagementSummary;
  comparisons: MonthComparisonMetric[];
  costIncreaseInsights: CostIncreaseInsight[];
  vehicles: VehicleManagementMetrics[];
  reviewIssues: ManagementReviewIssue[];
  reviewVehicles: VehicleManagementMetrics[];
  topRevenue: VehicleManagementMetrics[];
  highestCosts: VehicleManagementMetrics[];
  strongestBalance: VehicleManagementMetrics[];
  weakestBalance: VehicleManagementMetrics[];
  rankingMeta: RankingMeta;
};

const LPG_VEHICLE_KEY = "ฒอ8453";
const DEFAULT_RANK_LIMIT = 5;
const HIGH_FUEL_SHARE_THRESHOLD = 45;

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
    if (row.sourceDashStatus?.lpg === "unresolved_source_dash" && row.lpg == null) {
      return { amount: null, incomplete: true };
    }
    return { amount: 0, incomplete: false };
  }
  if (!separateFromFuel) {
    return { amount: 0, incomplete: false };
  }
  const amount = parseManagementSourceAmount(row.lpg);
  return { amount, incomplete: amount == null };
}

function compareNullableNumber(left: number, right: number, direction: "asc" | "desc") {
  if (left === right) return 0;
  if (direction === "desc") return right - left;
  return left - right;
}

function sortByNullable(
  rows: VehicleManagementMetrics[],
  getter: (row: VehicleManagementMetrics) => number | null,
  direction: "asc" | "desc"
) {
  return [...rows]
    .filter((row) => getter(row) != null)
    .sort((left, right) => {
      const primary = compareNullableNumber(getter(left) as number, getter(right) as number, direction);
      if (primary !== 0) return primary;
      return left.registration.localeCompare(right.registration, "en");
    });
}

/**
 * Balance/margin rankings use only complete vehicle rows.
 * Top and bottom lists never share a vehicle; if fewer than 2*limit eligible
 * vehicles exist, each list is shortened (or one list emptied) instead of overlapping.
 */
export function selectDisjointBalanceRanks(
  vehicles: VehicleManagementMetrics[],
  limit = DEFAULT_RANK_LIMIT
): {
  strongest: VehicleManagementMetrics[];
  weakest: VehicleManagementMetrics[];
  eligible: VehicleManagementMetrics[];
  meta: RankingMeta;
} {
  const eligible = sortByNullable(
    vehicles.filter((row) => row.balanceEligible && row.indicativeRecordedBalance != null),
    (row) => row.indicativeRecordedBalance,
    "desc"
  );
  const incompleteVehicles = vehicles.length - eligible.length;
  const requestedLimit = Math.max(0, limit);
  let perSide = Math.min(requestedLimit, Math.floor(eligible.length / 2));
  if (eligible.length === 1) {
    return {
      strongest: eligible.slice(0, 1),
      weakest: [],
      eligible,
      meta: {
        eligibleCompleteVehicles: 1,
        incompleteVehicles,
        requestedLimit,
        strongestCount: 1,
        weakestCount: 0,
        note: "Only one complete vehicle-level balance is available; weakest list is omitted to avoid overlap."
      }
    };
  }
  if (eligible.length === 0) {
    return {
      strongest: [],
      weakest: [],
      eligible,
      meta: {
        eligibleCompleteVehicles: 0,
        incompleteVehicles,
        requestedLimit,
        strongestCount: 0,
        weakestCount: 0,
        note: "No complete vehicle-level balances are available. Incomplete cost rows are excluded from rankings."
      }
    };
  }
  const strongest = eligible.slice(0, perSide);
  const weakest = eligible.slice(eligible.length - perSide).reverse();
  return {
    strongest,
    weakest,
    eligible,
    meta: {
      eligibleCompleteVehicles: eligible.length,
      incompleteVehicles,
      requestedLimit,
      strongestCount: strongest.length,
      weakestCount: weakest.length,
      note:
        eligible.length < requestedLimit * 2
          ? `Only ${eligible.length} complete vehicle balances are available; showing ${strongest.length} strongest and ${weakest.length} weakest with no overlap. Incomplete cost rows are excluded.`
          : `Rankings use ${eligible.length} complete vehicle balances only. Incomplete cost rows are excluded.`
    }
  };
}

function buildReviewIssues(metrics: VehicleManagementMetrics): ManagementReviewIssue[] {
  const issues: ManagementReviewIssue[] = [];
  const fuel = metrics.fuelAndLpg;
  const knownFuel = fuel != null ? fuel : null;
  const revenue = metrics.clientRevenue;
  const jobs = metrics.jobs;

  if (revenue === 0 && knownFuel != null && knownFuel > 0) {
    issues.push({
      registration: metrics.registration,
      issue: "Zero client revenue with recorded fuel spend",
      severity: "high",
      evidence: `Source shows Total Received 0 with fuel/LPG ${knownFuel.toFixed(2)} THB. Incomplete fields: ${metrics.incompleteFields.join(", ") || "none"}. Review assignment and source notes; do not assume misconduct.`,
      code: "zero_revenue_with_fuel"
    });
  } else if ((jobs === 0 || jobs == null) && knownFuel != null && knownFuel > 0 && revenue !== 0) {
    issues.push({
      registration: metrics.registration,
      issue: "Fuel recorded with zero or unknown jobs",
      severity: "high",
      evidence: `Fuel/LPG ${knownFuel.toFixed(2)} THB against jobs ${jobs == null ? "unknown" : "0"}.`,
      code: "fuel_without_jobs"
    });
  }

  if (metrics.indicativeRecordedBalance != null && metrics.indicativeRecordedBalance < 0) {
    issues.push({
      registration: metrics.registration,
      issue: "Negative indicative recorded balance",
      severity: "medium",
      evidence: `Complete-row indicative balance ${metrics.indicativeRecordedBalance.toFixed(2)} THB.`,
      code: "negative_indicative_balance"
    });
  }

  if (metrics.fuelSharePercent != null && metrics.fuelSharePercent >= HIGH_FUEL_SHARE_THRESHOLD && metrics.balanceEligible) {
    issues.push({
      registration: metrics.registration,
      issue: "High fuel + LPG share of revenue",
      severity: "medium",
      evidence: `Fuel + LPG share ${metrics.fuelSharePercent.toFixed(1)}% (provisional review threshold ${HIGH_FUEL_SHARE_THRESHOLD}%, not an approved rule).`,
      code: "high_fuel_share"
    });
  }

  const criticalMissing = metrics.incompleteFields.filter((field) =>
    ["expenses", "parkingFees", "tripPayments", "maintenance", "fuel", "salary", "totalReceived"].includes(field)
  );
  if (criticalMissing.length && !(revenue === 0 && knownFuel != null && knownFuel > 0)) {
    const onlyMaintenance = criticalMissing.length === 1 && criticalMissing[0] === "maintenance";
    issues.push({
      registration: metrics.registration,
      issue: onlyMaintenance ? "Maintenance not stated in source" : "Incomplete required expense fields",
      severity: onlyMaintenance ? "low" : "medium",
      evidence: onlyMaintenance
        ? "Maintenance cell is a source dash (unknown). It is not treated as a confirmed expense of zero or any amount."
        : `Unknown required fields: ${criticalMissing.join(", ")}. Vehicle-level balance withheld.`,
      code: onlyMaintenance ? "maintenance_unknown" : "incomplete_required_expenses"
    });
  }

  if (metrics.provisionalFields.includes("salary")) {
    issues.push({
      registration: metrics.registration,
      issue: "Provisional September salary",
      severity: "low",
      evidence: "Salary remains provisional pending independent payroll verification.",
      code: "provisional_salary"
    });
  }

  return issues;
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
  const balanceEligible = incompleteFields.length === 0;
  const confidence: ManagementAmountConfidence = !balanceEligible
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
    operatingCosts: balanceEligible ? operatingCosts : null,
    fuelAndLpg: fuel == null || lpg.incomplete ? null : fuelAndLpg,
    expenses,
    parkingFees,
    maintenance,
    totalRecordedCosts: balanceEligible ? totalRecordedCosts : null,
    indicativeRecordedBalance: balanceEligible ? indicativeRecordedBalance : null,
    indicativeRecordedMarginPercent: balanceEligible
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
    recordedCostPerJob: balanceEligible ? divideNullable(totalRecordedCosts, jobs) : null,
    balanceEligible,
    reviewReasons: []
  };

  const issues = buildReviewIssues(metrics);
  metrics.reviewReasons = issues.map((issue) => `${issue.issue}: ${issue.evidence}`);
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
    note: "Printed source-footer illustration using dash-as-zero reconciliation for aggregate totals. Aggregate figures stay separate from complete vehicle-level calculations. Not approved accounting profit.",
    clientRevenue,
    jobs,
    driverCost,
    salary,
    tripPayments,
    expenses,
    parkingFees,
    fuelAndLpg: fuel == null ? null : fuelAndLpg,
    fuel,
    lpg: lpg ?? 0,
    maintenance,
    operatingCosts: complete ? operatingCosts : null,
    totalRecordedCosts: complete ? totalRecordedCosts : null,
    indicativeRecordedBalance: complete ? indicativeRecordedBalance : null,
    indicativeRecordedMarginPercent: complete && clientRevenue && clientRevenue > 0 && indicativeRecordedBalance != null
      ? (indicativeRecordedBalance / clientRevenue) * 100
      : null,
    fuelSharePercent: clientRevenue != null && clientRevenue > 0 && fuel != null
      ? (((fuel + (lpg ?? 0)) / clientRevenue) * 100)
      : null,
    revenuePerJob: divideNullable(clientRevenue, jobs)
  };
}

function severityRank(severity: ReviewIssueSeverity) {
  if (severity === "high") return 0;
  if (severity === "medium") return 1;
  return 2;
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

  const comparisonDefs: Array<[string, string, number | null, number | null, MonthComparisonMetric["category"], ManagementAmountConfidence]> =
    previousSummary
      ? [
          ["clientRevenue", "Client revenue (Total Received)", previousSummary.clientRevenue, currentSummary.clientRevenue, "revenue", "indicative"],
          ["jobs", "Jobs", previousSummary.jobs, currentSummary.jobs, "volume", "confirmed"],
          ["revenuePerJob", "Revenue per job", previousSummary.revenuePerJob, currentSummary.revenuePerJob, "revenue", "indicative"],
          ["salary", "Salary", previousSummary.salary, currentSummary.salary, "driver", salaryProvisional || previousProvisional ? "provisional" : "indicative"],
          ["tripPayments", "Trip payments", previousSummary.tripPayments, currentSummary.tripPayments, "driver", "indicative"],
          ["fuelAndLpg", "Fuel + separately recorded LPG", previousSummary.fuelAndLpg, currentSummary.fuelAndLpg, "operating", "indicative"],
          ["expenses", "Expenses", previousSummary.expenses, currentSummary.expenses, "operating", "indicative"],
          ["parkingFees", "Parking fees", previousSummary.parkingFees, currentSummary.parkingFees, "operating", "indicative"],
          ["maintenance", "Maintenance", previousSummary.maintenance, currentSummary.maintenance, "operating", "indicative"],
          ["indicativeRecordedBalance", "Indicative recorded balance (aggregate footer)", previousSummary.indicativeRecordedBalance, currentSummary.indicativeRecordedBalance, "indicative", salaryProvisional || previousProvisional ? "provisional" : "indicative"]
        ]
      : [];

  const comparisons: MonthComparisonMetric[] = comparisonDefs.map(([key, label, previousValue, currentValue, category, confidence]) => ({
    key,
    label,
    previous: previousValue,
    current: currentValue,
    absoluteChange: absoluteChange(previousValue, currentValue),
    percentChange: percentChange(previousValue, currentValue),
    confidence,
    category
  }));

  const costKeys = ["fuelAndLpg", "maintenance", "expenses", "parkingFees", "salary", "tripPayments"] as const;
  const costIncreases = comparisons
    .filter((item) => costKeys.includes(item.key as (typeof costKeys)[number]) && item.absoluteChange != null && item.absoluteChange > 0)
    .map((item) => ({
      key: item.key,
      label: item.label,
      absoluteChange: item.absoluteChange as number,
      percentChange: item.percentChange
    }));
  const totalRecordedCostIncrease = costIncreases.reduce((sum, item) => sum + item.absoluteChange, 0);
  const costIncreaseInsights: CostIncreaseInsight[] = costIncreases
    .map((item) => ({
      ...item,
      shareOfRecordedCostIncrease: totalRecordedCostIncrease > 0 ? (item.absoluteChange / totalRecordedCostIncrease) * 100 : null
    }))
    .sort((left, right) => right.absoluteChange - left.absoluteChange);

  const reviewIssues = vehicles
    .flatMap((row) => buildReviewIssues(row))
    .sort((left, right) => {
      const bySeverity = severityRank(left.severity) - severityRank(right.severity);
      if (bySeverity !== 0) return bySeverity;
      return left.registration.localeCompare(right.registration, "en");
    });

  const ranks = selectDisjointBalanceRanks(vehicles, DEFAULT_RANK_LIMIT);
  const completeCostVehicles = vehicles.filter((row) => row.balanceEligible);

  return {
    policyNote: "Candidate management analysis only. These figures are not an approved V4 accounting policy and must not be treated as official profit.",
    lpgNote: "Only ฒอ-8453 uses LPG. January–July LPG stays inside Fuel; August–September LPG is separate and counted once.",
    rankingNote: ranks.meta.note,
    observedVsCauseNote: "Month-to-month differences below are observed printed-source changes. Possible operational causes are hypotheses only until independently verified.",
    thresholdNote: `Review thresholds such as fuel share ≥ ${HIGH_FUEL_SHARE_THRESHOLD}% are configurable owner proposals for investigation, not approved business rules.`,
    previous: previousSummary,
    current: currentSummary,
    comparisons,
    costIncreaseInsights,
    vehicles,
    reviewIssues,
    reviewVehicles: vehicles.filter((row) => row.reviewReasons.length > 0).slice(0, 12),
    topRevenue: sortByNullable(vehicles, (row) => row.clientRevenue, "desc").slice(0, Math.min(DEFAULT_RANK_LIMIT, vehicles.filter((row) => row.clientRevenue != null).length)),
    highestCosts: sortByNullable(completeCostVehicles, (row) => row.totalRecordedCosts, "desc").slice(0, Math.min(DEFAULT_RANK_LIMIT, completeCostVehicles.length)),
    strongestBalance: ranks.strongest,
    weakestBalance: ranks.weakest,
    rankingMeta: ranks.meta
  };
}
