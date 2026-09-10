import type { VehicleMonthlyPerformance } from '@/types/database';
import { buildVehiclePerformanceRows, buildVehiclePerformanceSummary, buildVehicleMonthlyPerformanceRows, vehiclePerformanceKey, type VehicleFuelSpendRow, type VehiclePerformanceRow, type VehiclePerformanceSummary } from '@/lib/vehicle-performance';
import { normalizeComparableText } from '@/lib/utils';
export const MANAGEMENT_BANDS = { materialPP: 3, combinedPP: 2, trendPP: 0.5, trendMoneyPercent: 2, minPeers: 3 } as const;
export type Direction = 'Improving' | 'Stable' | 'Worsening' | 'Not comparable';
export type Benchmark = {
    fuel: number | null;
    margin: number | null;
    eligibleCount: number;
    excludedCount: number;
};
export type ManagedVehicle = VehiclePerformanceRow & {
    statusReason: string;
    monthsLoaded: number;
    monthsExpected: number;
    eligible: boolean;
    exclusionReason: string | null;
    fuelVariance: number | null;
    marginVariance: number | null;
    opportunity: number | null;
};
const key = (value: string) => normalizeComparableText(value);
const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); const mid = Math.floor(sorted.length / 2); return sorted.length ? (sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2) : null; };
export function percentChange(current: number, previous: number) { return previous > 0 ? (current - previous) / previous * 100 : null; }
const pp = (current: number | null, previous: number | null) => current == null || previous == null ? null : current - previous;
const fmt = (n: number) => n.toFixed(1);
export function movement(current: VehiclePerformanceSummary, previous: VehiclePerformanceSummary) {
    const revenue = percentChange(current.grossRevenue, previous.grossRevenue), balance = percentChange(current.recordedBalance, previous.recordedBalance);
    const margin = pp(current.marginPercent, previous.marginPercent), fuelRatio = pp(current.fuelPercent, previous.fuelPercent);
    const balanceSignal = balance == null ? Math.sign(current.recordedBalance - previous.recordedBalance) : Math.abs(balance) >= MANAGEMENT_BANDS.trendMoneyPercent ? Math.sign(balance) : 0;
    const marginSignal = margin != null && Math.abs(margin) >= MANAGEMENT_BANDS.trendPP ? Math.sign(margin) : 0;
    const fuelSignal = fuelRatio != null && Math.abs(fuelRatio) >= MANAGEMENT_BANDS.trendPP ? -Math.sign(fuelRatio) : 0;
    const financial = [balanceSignal, marginSignal, fuelSignal];
    const positive = financial.filter(x => x > 0).length, negative = financial.filter(x => x < 0).length;
    const revenueSignal = revenue != null && Math.abs(revenue) >= MANAGEMENT_BANDS.trendMoneyPercent ? Math.sign(revenue) : 0;
    const direction: Direction = positive >= 2 && negative === 0 && revenueSignal >= 0 ? 'Improving' : negative >= 2 && positive === 0 && revenueSignal <= 0 ? 'Worsening' : 'Stable';
    return { direction, revenue, balance, margin, fuelSpend: percentChange(current.fuelSpend, previous.fuelSpend), fuelRatio };
}
export function explainStatus(row: VehiclePerformanceRow, benchmark: Benchmark, eligible: boolean, exclusionReason: string | null): Pick<ManagedVehicle, 'status' | 'statusReason'> {
    const margin = row.marginPercent, fuel = row.fuelPercent;
    if (row.recordedBalance < 0)
        return { status: 'needsAttention', statusReason: 'Negative recorded balance.' };
    if (margin != null && margin < 35)
        return { status: 'needsAttention', statusReason: `Margin ${fmt(margin)}%, below the 35% critical threshold.` };
    if (fuel != null && fuel > 45)
        return { status: 'needsAttention', statusReason: `Fuel ${fmt(fuel)}%, above the 45% critical threshold.` };
    if (!eligible)
        return { status: 'monitor', statusReason: `Coverage / data review: ${exclusionReason}. Peer comparison withheld.` };
    if (benchmark.fuel == null || benchmark.margin == null)
        return { status: 'monitor', statusReason: 'Insufficient eligible peers for a fleet comparison.' };
    const fuelGap = fuel! - benchmark.fuel, marginGap = margin! - benchmark.margin;
    if (fuelGap >= MANAGEMENT_BANDS.materialPP || marginGap <= -MANAGEMENT_BANDS.materialPP || (fuelGap >= MANAGEMENT_BANDS.combinedPP && marginGap <= -MANAGEMENT_BANDS.combinedPP))
        return { status: 'monitor', statusReason: [fuelGap >= MANAGEMENT_BANDS.combinedPP ? `Fuel ${fmt(fuel!)}%, ${fmt(fuelGap)} pp above fleet median` : '', marginGap <= -MANAGEMENT_BANDS.combinedPP ? `margin ${fmt(margin!)}%, ${fmt(-marginGap)} pp below fleet median` : ''].filter(Boolean).join('; ') + '.' };
    if ((marginGap >= MANAGEMENT_BANDS.materialPP && fuelGap <= 0) || (fuelGap <= -MANAGEMENT_BANDS.materialPP && marginGap >= 0))
        return { status: 'strong', statusReason: `Margin ${fmt(margin!)}%, fuel ${fmt(fuel!)}%: at least one ratio is 3 pp better than the fleet median, with neither worse.` };
    return { status: 'stable', statusReason: `Margin ${fmt(margin!)}%, fuel ${fmt(fuel!)}%: within the fleet tolerance bands.` };
}
export function buildPerformanceManagement({ records, fuelRows, months }: {
    records: VehicleMonthlyPerformance[];
    fuelRows: VehicleFuelSpendRow[];
    months: number[];
}) {
    const selectedMonths = [...new Set(months)].sort((a, b) => a - b);
    const selected = records.filter(r => selectedMonths.includes(r.month));
    const baseRows = buildVehiclePerformanceRows({ records: selected, fuelRows });
    const fuelEvidence = new Set(fuelRows.filter(f => Number.isFinite(f.fuelSpend) && (f.fuelLogCount ?? 0) > 0).map(f => vehiclePerformanceKey(f.year, f.month, f.vehicleRegistration)));
    const prepared = baseRows.map(row => {
        const source = selected.filter(r => key(r.vehicle_registration) === key(row.vehicleRegistration));
        const monthsLoaded = new Set(source.map(r => r.month)).size;
        const complete = monthsLoaded === selectedMonths.length && source.length === selectedMonths.length;
        const valid = source.every(r => [r.gross_revenue, r.salary_cost, r.trip_income, r.other_expenses].every(n => n != null && Number.isFinite(Number(n)) && Number(n) >= 0) && Number(r.gross_revenue) > 0);
        const hasFuel = source.every(r => fuelEvidence.has(vehiclePerformanceKey(r.year, r.month, r.vehicle_registration)));
        const exclusionReason = !complete ? `${monthsLoaded}/${selectedMonths.length} months; missing or duplicate vehicle-month records` : !valid ? 'zero revenue or incomplete financial fields' : !hasFuel ? 'missing fuel evidence for one or more months' : null;
        return { ...row, monthsLoaded, monthsExpected: selectedMonths.length, eligible: !exclusionReason, exclusionReason };
    });
    const eligible = prepared.filter(r => r.eligible && r.fuelPercent != null && r.marginPercent != null);
    const enough = eligible.length >= MANAGEMENT_BANDS.minPeers;
    const benchmark: Benchmark = { fuel: enough ? median(eligible.map(r => r.fuelPercent!)) : null, margin: enough ? median(eligible.map(r => r.marginPercent!)) : null, eligibleCount: eligible.length, excludedCount: prepared.length - eligible.length };
    const rows: ManagedVehicle[] = prepared.map(row => {
        const status = explainStatus(row, benchmark, row.eligible, row.exclusionReason);
        const fuelVariance = row.eligible ? pp(row.fuelPercent, benchmark.fuel) : null;
        const marginVariance = row.eligible ? pp(row.marginPercent, benchmark.margin) : null;
        const opportunity = row.eligible && fuelVariance != null && ['monitor', 'needsAttention'].includes(status.status) ? row.grossRevenue * Math.max(0, fuelVariance) / 100 : null;
        return { ...row, ...status, fuelVariance, marginVariance, opportunity };
    });
    const actionRows = rows.filter(r => r.status === 'monitor' || r.status === 'needsAttention').sort((a, b) => (a.status === 'needsAttention' ? 0 : 1) - (b.status === 'needsAttention' ? 0 : 1) || (b.opportunity ?? 0) - (a.opportunity ?? 0) || a.vehicleRegistration.localeCompare(b.vehicleRegistration));
    const expected = new Set(records.map(r => key(r.vehicle_registration))).size;
    const monthly = buildVehicleMonthlyPerformanceRows({ records: selected, fuelRows, months: selectedMonths, expectedVehicleCount: expected });
    // Never bridge missing calendar months or compare changing cohorts as fleet movement.
    const trendRecords = records.filter(r => r.month <= Math.max(...selectedMonths));
    const trendMonths = [...new Set(trendRecords.map(r => r.month))].sort((a, b) => a - b);
    const trendMonthly = buildVehicleMonthlyPerformanceRows({ records: trendRecords, fuelRows, months: trendMonths, expectedVehicleCount: expected });
    const completeMonths = trendMonthly.filter(m => m.status === 'complete' && m.recordCount === expected && m.grossRevenue > 0 && rows.length > 0 && trendRecords.filter(r => r.month === m.month).every(r => [r.gross_revenue, r.salary_cost, r.trip_income, r.other_expenses].every(n => n != null && Number.isFinite(Number(n)) && Number(n) >= 0) && (Number(r.gross_revenue) === 0 || fuelEvidence.has(vehiclePerformanceKey(r.year, r.month, r.vehicle_registration)))));
    const current = completeMonths.at(-1) ?? null;
    const previous = current ? completeMonths.find(m => m.month === current.month - 1) ?? null : null;
    const comparison = current && previous ? { ...movement(current, previous), current, previous } : null;
    const first = completeMonths[0] ?? null;
    const worstFuel = completeMonths.filter(m => m.fuelPercent != null).sort((a, b) => b.fuelPercent! - a.fuelPercent!)[0] ?? null;
    const lowestMargin = completeMonths.filter(m => m.marginPercent != null).sort((a, b) => a.marginPercent! - b.marginPercent!)[0] ?? null;
    const changes = [...new Set(records.map(r => r.vehicle_registration))].map(vehicleRegistration => {
        const row = { vehicleRegistration };
        if (!current || !previous)
            return { registration: row.vehicleRegistration, direction: 'Not comparable' as Direction };
        const pair = trendRecords.filter(r => key(r.vehicle_registration) === key(row.vehicleRegistration) && (r.month === current.month || r.month === previous.month));
        if (pair.length !== 2 || new Set(pair.map(r => r.month)).size !== 2 || pair.some(r => Number(r.gross_revenue) <= 0 || !fuelEvidence.has(vehiclePerformanceKey(r.year, r.month, r.vehicle_registration))))
            return { registration: row.vehicleRegistration, direction: 'Not comparable' as Direction };
        const byMonth = (m: number) => buildVehiclePerformanceSummary(buildVehiclePerformanceRows({ records: pair.filter(r => r.month === m), fuelRows }));
        return { registration: row.vehicleRegistration, direction: movement(byMonth(current.month), byMonth(previous.month)).direction };
    });
    return { rows, actionRows, benchmark, summary: buildVehiclePerformanceSummary(rows), monthly, comparison, first, worstFuel, lowestMargin, current, changes, totalOpportunity: actionRows.reduce((s, r) => s + (r.opportunity ?? 0), 0), estimatedVehicleCount: actionRows.filter(r => r.opportunity != null && r.opportunity > 0).length, partialMonths: monthly.filter(m => m.status === 'partial').map(m => m.month) };
}
export type PerformanceManagement = ReturnType<typeof buildPerformanceManagement>;
