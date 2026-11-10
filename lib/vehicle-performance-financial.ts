/** All money arithmetic uses integer satang. Null remains unknown, including revenue. */
export const COST_FIELDS = ['salary', 'tripPayments', 'expenses', 'parkingFees', 'fuel', 'lpg', 'maintenance'] as const;
export const SOURCE_FIELDS = ['salary', 'jobs', 'tripPayments', 'expenses', 'parkingFees', 'totalReceived', 'fuel', 'lpg', 'maintenance'] as const;
export type CostField = typeof COST_FIELDS[number];
export type SourceField = typeof SOURCE_FIELDS[number];
export type FinancialCell = { value: string | null; status: 'recorded' | 'recorded_zero' | 'unknown' | 'not_applicable'; sourceDash: boolean; adjustmentId?: string };
export type FinancialVehicle = {
  registration: string; month: number; cells: Record<SourceField, FinancialCell>;
  salaryProvisional: boolean; identityReview: boolean;
};
export type FinancialReport = {
  month: number; year: number; sourceFile: string; sourceSha256: string;
  verifiedAgainstPdf: boolean; rows: FinancialVehicle[]; controls: Record<SourceField, string>;
};
export function satang(value: string): number {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) throw new Error('Invalid financial amount');
  const fraction = (match[3] ?? '').padEnd(3, '0');
  const amount = Number(match[2]) * 100 + Number(fraction.slice(0, 2)) + (Number(fraction[2]) >= 5 ? 1 : 0);
  if (!Number.isSafeInteger(amount)) throw new Error('Financial amount exceeds safe range');
  return match[1] ? -amount : amount;
}
export function decimal(amount: number): string {
  if (!Number.isSafeInteger(amount)) throw new Error('Expected integer satang');
  return `${amount < 0 ? '-' : ''}${Math.floor(Math.abs(amount) / 100)}.${String(Math.abs(amount) % 100).padStart(2, '0')}`;
}
export function baht(amount: number | null): string {
  return amount == null ? '—' : `฿${(amount / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
export function vehicleFinancials(row: FinancialVehicle) {
  const missingCosts = COST_FIELDS.filter(field => row.cells[field].status === 'unknown');
  const knownCosts = COST_FIELDS.reduce((sum, field) => sum + (row.cells[field].value == null ? 0 : satang(row.cells[field].value!)), 0);
  const revenue = row.cells.totalReceived.value == null ? null : satang(row.cells.totalReceived.value);
  const balance = revenue == null ? null : revenue - knownCosts;
  const jobs = row.cells.jobs.value == null ? null : Number(row.cells.jobs.value);
  const confirmed = revenue != null && missingCosts.length === 0 && !row.salaryProvisional && !row.identityReview;
  return { knownCosts, revenue, balance, missingCosts, jobs, confirmed,
    status: revenue == null ? 'revenue_unconfirmed' as const : confirmed ? 'confirmed' as const : 'provisional' as const,
    margin: revenue != null && revenue > 0 && balance != null ? balance / revenue * 100 : null,
    revenuePerJob: jobs && revenue != null ? Math.round(revenue / jobs) : null,
    costPerJob: jobs ? Math.round(knownCosts / jobs) : null
  };
}
export function fleetFinancials(report: FinancialReport) {
  const totals = Object.fromEntries(SOURCE_FIELDS.map(field => [field, report.rows.reduce((sum, row) => sum + (row.cells[field].value == null ? 0 : satang(row.cells[field].value!)), 0)])) as Record<SourceField, number>;
  const differences = SOURCE_FIELDS.map(field => ({ field, difference: totals[field] - satang(report.controls[field]) }));
  const knownCosts = COST_FIELDS.reduce((sum, field) => sum + totals[field], 0);
  const controlCosts = COST_FIELDS.reduce((sum, field) => sum + satang(report.controls[field]), 0);
  const aggregateBalance = satang(report.controls.totalReceived) - controlCosts;
  const metrics = report.rows.map(vehicleFinancials);
  const calculableBalance = metrics.reduce((sum, row) => sum + (row.balance ?? 0), 0);
  return { totals, differences, reconciled: differences.every(d => d.difference === 0), knownCosts, aggregateBalance,
    calculableBalance, balanceBridge: calculableBalance - aggregateBalance,
    confirmedCount: metrics.filter(row => row.confirmed).length,
    provisionalCount: metrics.filter(row => row.status === 'provisional').length,
    unconfirmedRevenueCount: metrics.filter(row => row.revenue == null).length,
    confirmedBalance: metrics.reduce((sum, row) => sum + (row.confirmed ? row.balance! : 0), 0)
  };
}
export type FinancialSort = 'balance' | 'revenue' | 'jobs' | 'margin' | 'knownCosts';
export function sortFinancialRows(rows: FinancialVehicle[], sort: FinancialSort, ascending = false) {
  return [...rows].sort((a, b) => {
    const left = vehicleFinancials(a), right = vehicleFinancials(b);
    // Unknown revenue is always separated, in either direction and for every metric.
    if ((left.revenue == null) !== (right.revenue == null)) return left.revenue == null ? 1 : -1;
    const l = left[sort], r = right[sort];
    if (l == null || r == null) return l == null && r == null ? a.registration.localeCompare(b.registration) : l == null ? 1 : -1;
    return (ascending ? l - r : r - l) || a.registration.localeCompare(b.registration);
  });
}
export type LocalFinancialAdjustment = {
  id: string; userId: string; registration: string; month: number; field: SourceField;
  kind: 'amount' | 'not_applicable'; value: string | null; reason: string; createdAt: string; sourceSha256: string;
};
export function validateAdjustment(value: LocalFinancialAdjustment, report: FinancialReport): boolean {
  const row = report.rows.find(r => r.registration === value.registration);
  return Boolean(row && value.userId && value.id && value.month === report.month && value.sourceSha256 === report.sourceSha256
    && SOURCE_FIELDS.includes(value.field) && row.cells[value.field].status === 'unknown'
    && value.reason.trim().length >= 8 && Number.isFinite(Date.parse(value.createdAt))
    && (value.kind === 'not_applicable' ? COST_FIELDS.includes(value.field as CostField) && value.value === null
      : value.kind === 'amount' && value.value != null && /^\d+(\.\d{1,2})?$/.test(value.value) && Number(value.value) <= 100000000));
}

/** Contribution in satang: blank/dash/N/A unknown cells contribute 0 for owner-approved reporting only. Source status is unchanged. */
export function contributionSatang(cell: FinancialCell): number {
  return cell.value == null ? 0 : satang(cell.value);
}

export type ReportingStatus = 'reported' | 'adjusted' | 'review';

/**
 * Owner-approved internal operating-balance convention for August/September reporting.
 * Blank cost or revenue cells contribute ฿0 to the calculation without rewriting source data.
 */
export function reportedVehicleFinancials(row: FinancialVehicle) {
  const knownCosts = COST_FIELDS.reduce((sum, field) => sum + contributionSatang(row.cells[field]), 0);
  const revenue = contributionSatang(row.cells.totalReceived);
  const balance = revenue - knownCosts;
  const jobs = row.cells.jobs.value == null ? null : Number(row.cells.jobs.value);
  const missingCosts = COST_FIELDS.filter(field => row.cells[field].status === 'unknown');
  const adjusted = SOURCE_FIELDS.some(field => Boolean(row.cells[field].adjustmentId));
  const reportingStatus: ReportingStatus = row.identityReview ? 'review' : adjusted ? 'adjusted' : 'reported';
  const fuel = contributionSatang(row.cells.fuel);
  return {
    knownCosts, revenue, balance, missingCosts, jobs,
    confirmed: true,
    status: reportingStatus,
    reportingStatus,
    margin: revenue > 0 ? balance / revenue * 100 : null,
    fuelPercent: revenue > 0 ? fuel / revenue * 100 : null,
    revenuePerJob: jobs && revenue > 0 ? Math.round(revenue / jobs) : null,
    costPerJob: jobs ? Math.round(knownCosts / jobs) : null,
    sourceRevenueBlank: row.cells.totalReceived.value == null,
    sourceUnreportedCosts: missingCosts,
    adjusted
  };
}

/** Dashboard/PDF/worksheet operating figures use the owner-approved reporting convention. */
export function operationalVehicleFinancials(row: FinancialVehicle) {
  return reportedVehicleFinancials(row);
}

export function operationalFleetFinancials(report: FinancialReport) {
  const metrics = report.rows.map(reportedVehicleFinancials);
  const totals = Object.fromEntries(SOURCE_FIELDS.map(field => [
    field,
    report.rows.reduce((sum, row) => sum + contributionSatang(row.cells[field]), 0)
  ])) as Record<SourceField, number>;
  const revenue = totals.totalReceived;
  const knownCosts = COST_FIELDS.reduce((sum, field) => sum + totals[field], 0);
  const balance = revenue - knownCosts;
  return {
    totals, revenue, knownCosts, balance,
    jobs: report.rows.reduce((sum, row) => sum + (row.cells.jobs.value == null ? 0 : Number(row.cells.jobs.value)), 0),
    margin: revenue > 0 ? balance / revenue * 100 : null,
    incompleteCount: 0,
    missingRevenueCount: metrics.filter(row => row.sourceRevenueBlank).length,
    provisional: false,
    adjustedCount: metrics.filter(row => row.reportingStatus === 'adjusted').length,
    reviewCount: metrics.filter(row => row.reportingStatus === 'review').length
  };
}

export type FinancialChange = {
  year: number; month: number; registration: string; field: SourceField;
  value: string | null; kind: 'amount' | 'unknown' | 'not_applicable';
  expected: string;
};
export type FinancialCorrection = FinancialChange & {
  id: string; userId: string; createdAt: string; sourceSha256: string;
  previousValue: string | null; previousStatus: FinancialCell['status'];
};
export function financialCellKey(month: number, registration: string, field: SourceField) {
  return `${month}:${registration}:${field}`;
}
export function financialCellVersion(report: FinancialReport, row: FinancialVehicle, field: SourceField) {
  return row.cells[field].adjustmentId || report.sourceSha256;
}

/** A blank remains unknown; zero is a recorded amount. Never round or coerce invalid input. */
export function normalizeFinancialInput(field: SourceField, input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  if (!(field === 'jobs' ? /^\d+$/ : /^\d+(?:\.\d{1,2})?$/).test(value)) throw new Error('Enter a non-negative amount with at most two decimals; jobs must be a whole number.');
  const number = field === 'jobs' ? Number(value) : satang(value);
  if (!Number.isSafeInteger(number) || number > (field === 'jobs' ? 100000000 : 10000000000)) throw new Error('Value exceeds the supported range.');
  return field === 'jobs' ? String(number) : decimal(number);
}

export function applyFinancialCorrections(sources: FinancialReport[], corrections: FinancialCorrection[]) {
  const reports = structuredClone(sources);
  for (const entry of corrections) {
    const report = reports.find(r => r.year === entry.year && r.month === entry.month);
    const row = report?.rows.find(r => r.registration === entry.registration);
    if (!report || !row || report.sourceSha256 !== entry.sourceSha256 || !SOURCE_FIELDS.includes(entry.field)) throw new Error('Correction does not match its immutable source.');
    row.cells[entry.field] = { ...row.cells[entry.field], value: entry.kind === 'not_applicable' ? '0.00' : entry.value,
      status: entry.kind === 'unknown' ? 'unknown' : entry.kind === 'not_applicable' ? 'not_applicable' : Number(entry.value) === 0 ? 'recorded_zero' : 'recorded', adjustmentId: entry.id };
  }
  return reports;
}

/** Baht amount from a financial cell; unknown stays null. */
export function cellBaht(cell: FinancialCell): number | null {
  return cell.value == null ? null : satang(cell.value) / 100;
}

export type V6DashboardVehicleMeta = {
  registration: string;
  month: number;
  status: ReportingStatus;
  missingCosts: CostField[];
  salaryProvisional: boolean;
  identityReview: boolean;
  jobs: number | null;
  knownCostsBaht: number;
  provisionalBalanceBaht: number | null;
  recordedBalanceBaht: number;
  marginPercent: number | null;
  fuelPercent: number | null;
  sourceRevenueBlank: boolean;
};

/**
 * Projects saved V6 reports into the January–July KPI record/fuel shapes.
 * Owner-approved convention: blank source costs/revenue contribute ฿0 to the operating balance.
 * Original source blanks remain untouched in the worksheet/source store.
 */
export function v6ReportsAsDashboardProjection(reports: FinancialReport[], months: number[]) {
  const selected = reports.filter(report => months.includes(report.month));
  const records: Array<{
    id: string; user_id: null; vehicle_id: null; year: number; month: number; vehicle_registration: string;
    salary_cost: number; trip_income: number; other_expenses: number; gross_revenue: number; lpg_cost: number;
    notes: string; created_at: string; updated_at: string; created_by: null; updated_by: null;
  }> = [];
  const fuelRows: Array<{ vehicleRegistration: string; year: number; month: number; fuelSpend: number; fuelLogCount: number }> = [];
  const meta: V6DashboardVehicleMeta[] = [];
  for (const report of selected) {
    for (const row of report.rows) {
      const metrics = reportedVehicleFinancials(row);
      const salary = contributionSatang(row.cells.salary) / 100;
      const tripPayments = contributionSatang(row.cells.tripPayments) / 100;
      const expenses = contributionSatang(row.cells.expenses) / 100;
      const parkingFees = contributionSatang(row.cells.parkingFees) / 100;
      const maintenance = contributionSatang(row.cells.maintenance) / 100;
      const fuel = contributionSatang(row.cells.fuel) / 100;
      const lpg = contributionSatang(row.cells.lpg) / 100;
      const grossRevenue = metrics.revenue / 100;
      records.push({
        id: `v6-effective:${report.year}:${report.month}:${row.registration}`,
        user_id: null, vehicle_id: null, year: report.year, month: report.month,
        vehicle_registration: row.registration,
        salary_cost: salary, trip_income: tripPayments,
        other_expenses: expenses + parkingFees + maintenance,
        gross_revenue: grossRevenue, lpg_cost: lpg,
        notes: metrics.reportingStatus === 'review'
          ? 'Owner-approved reported balance · registration identity review'
          : metrics.reportingStatus === 'adjusted'
            ? 'Owner-approved reported balance · includes saved adjustment'
            : 'Owner-approved reported operating balance',
        created_at: '', updated_at: '', created_by: null, updated_by: null
      });
      fuelRows.push({
        vehicleRegistration: row.registration, year: report.year, month: report.month,
        fuelSpend: fuel, fuelLogCount: row.cells.fuel.value == null ? 0 : 1
      });
      meta.push({
        registration: row.registration, month: report.month, status: metrics.reportingStatus,
        missingCosts: metrics.missingCosts, salaryProvisional: row.salaryProvisional,
        identityReview: row.identityReview, jobs: metrics.jobs,
        knownCostsBaht: metrics.knownCosts / 100,
        provisionalBalanceBaht: metrics.balance / 100,
        recordedBalanceBaht: metrics.balance / 100,
        marginPercent: metrics.margin,
        fuelPercent: metrics.fuelPercent,
        sourceRevenueBlank: metrics.sourceRevenueBlank
      });
    }
  }
  return { records, fuelRows, meta };
}

export function v6FleetHeroTotals(report: FinancialReport) {
  const fleet = operationalFleetFinancials(report);
  const fuel = fleet.totals.fuel;
  return {
    revenueBaht: fleet.revenue / 100,
    knownCostsBaht: fleet.knownCosts / 100,
    balanceBaht: fleet.balance / 100,
    marginPercent: fleet.margin,
    fuelBaht: fuel / 100,
    fuelPercent: fleet.revenue > 0 ? fuel / fleet.revenue * 100 : null,
    jobs: fleet.jobs,
    vehicleCount: report.rows.length,
    incompleteCount: 0,
    provisional: false,
    missingRevenueCount: fleet.missingRevenueCount,
    adjustedCount: fleet.adjustedCount,
    reviewCount: fleet.reviewCount
  };
}

export const OWNER_REPORTING_NOTE_EN = 'Unreported source costs are treated as zero contributions for internal operating-balance calculations; this does not verify that those costs were zero.';
export const OWNER_REPORTING_NOTE_TH = 'ต้นทุนที่ต้นฉบับเว้นว่างถูกนับเป็นศูนย์ในการคำนวณยอดดำเนินงานภายในเท่านั้น ไม่ได้ยืนยันว่าต้นทุนนั้นเป็นศูนย์จริง';
