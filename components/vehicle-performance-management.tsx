'use client';
import { useState } from 'react';
import { percentChange, type PerformanceManagement, type ManagedVehicle, type Direction } from '@/lib/vehicle-performance-management';
import type { VehiclePerformanceSummary } from '@/lib/vehicle-performance';
const money = (n: number) => `฿${new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 }).format(n)}`;
const pct = (n: number | null) => n == null ? 'Unavailable' : `${n.toFixed(1)}%`;
const delta = (n: number | null, unit = '%') => n == null ? 'Unavailable' : `${n > 0 ? '+' : ''}${n.toFixed(1)}${unit}`;
const month = (n: number) => new Intl.DateTimeFormat('en-GB', { month: 'short' }).format(new Date(2026, n - 1, 1));
const statusLabel = (s: string) => s === 'needsAttention' ? 'Attention' : s[0].toUpperCase() + s.slice(1);
const tone = (s: string) => s === 'needsAttention' || s === 'Worsening' ? 'border-rose-200 bg-rose-50 text-rose-800' : s === 'monitor' ? 'border-amber-200 bg-amber-50 text-amber-900' : s === 'strong' || s === 'Improving' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-slate-50 text-slate-700';
function Metric({ label, value, good }: {
    label: string;
    value: string;
    good?: boolean | null;
}) { return <div className="rounded-xl border border-slate-100 bg-slate-50 p-3"><p className="text-xs text-slate-500">{label}</p><p className={`mt-1 text-lg font-bold ${good == null ? 'text-slate-900' : good ? 'text-emerald-700' : 'text-rose-700'}`}>{value}</p></div>; }
export function BusinessImpact({ model, actual, onMovement }: {
    model: PerformanceManagement;
    actual: VehiclePerformanceSummary;
    onMovement: (direction: Direction | null) => void;
}) {
    const c = model.comparison;
    const direction = c?.direction ?? 'Not comparable';
    const ratioGood = c?.fuelRatio == null ? null : c.fuelRatio < 0 ? true : c.fuelRatio > 0 ? false : null;
    const fuelGood = c?.fuelSpend == null || c.revenue == null ? null : c.fuelSpend < 0 && c.revenue >= 0 ? true : c.fuelSpend > 0 && c.revenue <= 0 ? false : null;
    const bm = model.benchmark;
    return <section className="surface-card p-4 sm:p-5" aria-label="Business Impact">
  <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="section-title">Business Impact</h3><p className="section-subtitle">Latest complete-month fleet movement; benchmark ratios use the selected period.</p></div><span className={`rounded-full border px-3 py-1 text-sm font-bold ${tone(direction)}`}>{direction}</span></div>
  <p className="mt-3 text-sm font-medium text-slate-700">{c ? `${month(c.previous.month)} → ${month(c.current.month)}: ${direction === 'Improving' ? 'at least two contribution / efficiency indicators improved without material deterioration.' : direction === 'Worsening' ? 'at least two contribution / efficiency indicators weakened without material improvement.' : 'movements are small or mixed; review the individual indicators.'}` : 'Two consecutive complete months with positive revenue and fuel evidence are needed for a reliable comparison.'}</p>
  {c && <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-5">
    <Metric label="Revenue change" value={delta(c.revenue)} good={c.revenue == null || c.revenue === 0 ? null : c.revenue > 0}/>
    <Metric label="Recorded Balance change" value={delta(c.balance)} good={c.balance == null || c.balance === 0 ? null : c.balance > 0}/>
    <Metric label="Margin change" value={delta(c.margin, ' pp')} good={c.margin == null || c.margin === 0 ? null : c.margin > 0}/>
    <Metric label="Fuel Spend change" value={delta(c.fuelSpend)} good={fuelGood}/>
    <Metric label="Fuel / Revenue change" value={delta(c.fuelRatio, ' pp')} good={ratioGood}/>
  </div>}
  <div className="mt-4 flex flex-wrap gap-2" aria-label="Vehicle movement counts">{(['Improving', 'Stable', 'Worsening', 'Not comparable'] as Direction[]).map(d => <button key={d} type="button" onClick={() => onMovement(d)} className={`rounded-lg border px-3 py-2 text-sm font-semibold ${tone(d)}`}>{model.changes.filter(v => v.direction === d).length} {d === 'Improving' ? 'improved' : d === 'Worsening' ? 'worsened' : d === 'Stable' ? 'broadly stable' : 'without comparable data'}</button>)}<button type="button" onClick={() => onMovement(null)} className="text-xs font-semibold text-brand-700">Show all vehicles</button></div>
  {model.current && model.first && model.current.month !== model.first.month && <div className="mt-4 border-t border-slate-100 pt-4"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Since tracking · complete months only</p><div className="mt-2 grid gap-2 text-sm text-slate-700 lg:grid-cols-3">
    <p>{month(model.first.month)} → {month(model.current.month)} revenue: <strong>{delta(percentChange(model.current.grossRevenue, model.first.grossRevenue))}</strong>.</p>
    {model.worstFuel && <p>Highest fuel ratio {pct(model.worstFuel.fuelPercent)} in {month(model.worstFuel.month)} → {pct(model.current.fuelPercent)} in {month(model.current.month)} <strong>({delta(model.current.fuelPercent! - model.worstFuel.fuelPercent!, ' pp')})</strong>.</p>}
    {model.lowestMargin && <p>Lowest margin {pct(model.lowestMargin.marginPercent)} in {month(model.lowestMargin.month)} → {pct(model.current.marginPercent)} in {month(model.current.month)} <strong>({delta(model.current.marginPercent! - model.lowestMargin.marginPercent!, ' pp')})</strong>.</p>}
  </div></div>}
  {model.partialMonths.length > 0 && <p className="mt-3 text-xs font-medium text-amber-800">{model.partialMonths.map(month).join(', ')} have partial fleet coverage and are excluded from complete-month trend comparisons.</p>}
  <div className="mt-4 rounded-xl border border-slate-200 p-3"><h4 className="text-sm font-semibold">Actual vs Fleet benchmark</h4><div className="mt-3 grid gap-2 sm:grid-cols-2">
   <Metric label="Fuel / Revenue · actual / fleet median" value={`${pct(actual.fuelPercent)} / ${pct(bm.fuel)}`}/><Metric label="Margin · actual / fleet median" value={`${pct(actual.marginPercent)} / ${pct(bm.margin)}`}/>
   <p className="text-sm">Fuel variance: {delta(actual.fuelPercent == null || bm.fuel == null ? null : actual.fuelPercent - bm.fuel, ' pp')}</p><p className="text-sm">Margin variance: {delta(actual.marginPercent == null || bm.margin == null ? null : actual.marginPercent - bm.margin, ' pp')}</p>
   <p className="text-sm">Revenue: {money(actual.grossRevenue)}</p><p className="text-sm">Recorded Balance: {money(actual.recordedBalance)}</p>
  </div><details className="mt-3"><summary className="cursor-pointer text-xs font-semibold text-brand-700">Benchmark, status and movement methodology</summary><p className="mt-3 text-xs leading-5 text-slate-600">Unweighted median of eligible vehicle ratios over the selected period; {bm.eligibleCount} eligible, {bm.excludedCount} excluded. At least 3 peers, positive revenue, one record and fuel evidence in every selected month are required. Actual ratios reflect the page selection and are revenue-weighted totals. Search never changes the benchmark. These are fleet benchmarks, not company targets; vehicle duty and route differences still need review.</p>
  <p className="mt-2 text-xs leading-5 text-slate-600">Attention: negative balance, margin below 35%, or fuel above 45%. Monitor: fuel ≥3 pp above median or margin ≥3 pp below median, or both ≥2 pp worse. Strong: one ratio ≥3 pp better and neither worse. Stable: remaining eligible vehicles. Incomplete data stays in Monitor for coverage review, without an estimate. Movement uses at least two aligned indicators (margin/fuel ≥0.5 pp, balance ≥2%) and no materially opposing revenue movement (≥2%); small or mixed movement is broadly stable. A percentage change from zero/negative balance is unavailable.</p>
  <p className="mt-2 text-xs leading-5 text-slate-600">Recorded Balance = Revenue − Fuel − Salary − Trip Payments − Other Costs. Revenue less recorded direct costs; full company overheads are not included. Historical differences do not establish causation or actual savings.</p></details></div>
 </section>;
}
export function ActionQueue({ model, onVehicle }: {
    model: PerformanceManagement;
    onVehicle: (registration: string) => void;
}) {
    return <section className="surface-card p-4 sm:p-5" aria-label="Action Queue"><div className="flex flex-wrap justify-between gap-3"><div><h3 className="section-title">Action Queue</h3><p className="section-subtitle">Attention first, then Monitor; largest indicative opportunity first within each status.</p></div><div className="rounded-xl border border-brand-100 bg-brand-50 px-4 py-3"><p className="text-xs font-semibold text-brand-700">Estimated Opportunity</p><p className="text-xl font-bold text-brand-800">{model.benchmark.fuel == null ? 'Unavailable' : money(model.totalOpportunity)}</p><p className="text-xs text-brand-700">Indicative fuel opportunity · {model.estimatedVehicleCount} vehicles</p></div></div>
 <p className="mt-3 text-xs leading-5 text-slate-600" title="Revenue × max(0, vehicle fuel percentage − fleet median fuel percentage) ÷ 100">Estimate for the selected period and registration search, not an annual forecast or guaranteed saving. Revenue × excess fuel ratio above the {pct(model.benchmark.fuel)} fleet median. Each eligible vehicle is counted once; no overlapping margin estimate is added. Review routes, loads, prices and fuel records before setting a target.</p>
 {!model.actionRows.length ? <p className="mt-4 rounded-xl bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">No vehicles in this selection require monitoring or attention.</p> : <div className="mt-4 grid gap-3 xl:grid-cols-2">{model.actionRows.map(row => <article key={row.vehicleRegistration} className="rounded-xl border border-slate-200 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><button type="button" onClick={() => onVehicle(row.vehicleRegistration)} className="font-bold text-brand-700 underline decoration-brand-200 underline-offset-4">{row.vehicleRegistration}</button><span className={`rounded-full border px-2 py-1 text-xs font-bold ${tone(row.status)}`}>{statusLabel(row.status)}</span></div><dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm"><div><dt className="text-xs text-slate-500">Revenue</dt><dd className="font-semibold">{money(row.grossRevenue)}</dd></div><div><dt className="text-xs text-slate-500">Recorded Balance</dt><dd className="font-semibold">{money(row.recordedBalance)}</dd></div><div><dt className="text-xs text-slate-500">Margin</dt><dd>{pct(row.marginPercent)} · {delta(row.marginVariance, ' pp')} vs median</dd></div><div><dt className="text-xs text-slate-500">Fuel / Revenue</dt><dd>{pct(row.fuelPercent)} · {delta(row.fuelVariance, ' pp')} vs median</dd></div></dl><p className="mt-3 text-sm text-slate-700">{row.statusReason}</p><div className="mt-3 flex flex-wrap justify-between gap-2 border-t border-slate-100 pt-3 text-xs"><span className={row.eligible ? 'text-slate-600' : 'font-semibold text-amber-800'}>{row.monthsLoaded} / {row.monthsExpected} months</span><strong className="text-brand-700">Indicative fuel opportunity: {row.opportunity == null ? 'Not estimated' : money(row.opportunity)}</strong></div>{row.exclusionReason && <p className="mt-2 text-xs text-amber-800">Excluded from estimate: {row.exclusionReason}.</p>}<button type="button" className="btn-secondary mt-3 text-xs" onClick={() => onVehicle(row.vehicleRegistration)}>View vehicle</button></article>)}</div>}
 </section>;
}
export function VehicleDrillDown({ registration, history, onClose }: {
    registration: string;
    history: Array<{
        month: number;
        row: ManagedVehicle | undefined;
        benchmark: PerformanceManagement['benchmark'];
    }>;
    onClose: () => void;
}) {
    const [expanded, setExpanded] = useState(true);
    const present = history.filter(h => h.row);
    const last = present.at(-1), previous = present.at(-2);
    return <section className="surface-card border-brand-200 p-4 sm:p-5" aria-label="Vehicle detail"><div className="flex items-center justify-between gap-3"><div><h3 className="section-title">{registration} · Vehicle detail</h3><p className="section-subtitle">Monthly history and same-month fleet comparisons. Missing records remain visible.</p></div><button type="button" className="btn-secondary" onClick={onClose}>Close detail</button></div>
 {last && previous && last.month === previous.month + 1 && <p className="mt-3 text-sm">Latest recorded trend ({month(previous.month)} → {month(last.month)}): margin {delta(last.row!.marginPercent == null || previous.row!.marginPercent == null ? null : last.row!.marginPercent - previous.row!.marginPercent, ' pp')}; fuel ratio {delta(last.row!.fuelPercent == null || previous.row!.fuelPercent == null ? null : last.row!.fuelPercent - previous.row!.fuelPercent, ' pp')}.</p>}
 <details open={expanded} onToggle={e => setExpanded(e.currentTarget.open)} className="mt-3"><summary className="cursor-pointer text-sm font-semibold">Monthly performance and status history</summary><div className="mt-3 overflow-x-auto"><table className="w-full min-w-[850px] text-sm"><thead><tr>{['Month', 'Revenue', 'Fuel', 'Fuel %', 'Balance', 'Margin', 'Fleet fuel / margin', 'Status / reason'].map(h => <th key={h} className="p-2 text-left text-xs text-slate-500">{h}</th>)}</tr></thead><tbody>{history.map(h => <tr key={h.month} className="border-t border-slate-100"><td className="p-2 font-semibold">{month(h.month)}</td>{h.row ? <><td className="p-2">{money(h.row.grossRevenue)}</td><td className="p-2">{money(h.row.fuelSpend)}</td><td className="p-2">{pct(h.row.fuelPercent)}</td><td className="p-2">{money(h.row.recordedBalance)}</td><td className="p-2">{pct(h.row.marginPercent)}</td><td className="p-2">{pct(h.benchmark.fuel)} / {pct(h.benchmark.margin)}</td><td className="max-w-xs p-2"><strong>{statusLabel(h.row.status)}</strong><p className="text-xs text-slate-600">{h.row.statusReason}</p></td></> : <td colSpan={7} className="p-2 text-amber-800">Missing vehicle-month record</td>}</tr>)}</tbody></table></div></details></section>;
}
