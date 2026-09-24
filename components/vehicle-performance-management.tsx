"use client";

import { useState } from "react";
import { useLanguage } from "@/lib/language-provider";
import { percentChange, type PerformanceManagement, type ManagedVehicle, type Direction } from "@/lib/vehicle-performance-management";
import type { VehiclePerformanceSummary } from "@/lib/vehicle-performance";

const tone = (value: string) => value === "needsAttention" || value === "Worsening" ? "border-rose-200 bg-rose-50 text-rose-800" : value === "monitor" ? "border-amber-200 bg-amber-50 text-amber-900" : value === "strong" || value === "Improving" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-slate-50 text-slate-700";

function Metric({ label, value, good }: { label: string; value: string; good?: boolean | null }) {
  return <div className="rounded-xl border border-slate-100 bg-slate-50 p-3"><p className="text-xs text-slate-500">{label}</p><p className={`mt-1 text-lg font-bold ${good == null ? "text-slate-900" : good ? "text-emerald-700" : "text-rose-700"}`}>{value}</p></div>;
}

function useManagementFormatters() {
  const { language, t } = useLanguage();
  const c = t.vehiclePerformance.management;
  const locale = language === "th" ? "th-TH" : "en-GB";
  const money = (value: number) => new Intl.NumberFormat(locale, { style: "currency", currency: "THB", maximumFractionDigits: 0 }).format(value);
  const pct = (value: number | null) => value == null ? c.unavailable : `${value.toFixed(1)}%`;
  const delta = (value: number | null, unit = "%") => value == null ? c.unavailable : `${value > 0 ? "+" : ""}${value.toFixed(1)}${unit}`;
  const month = (value: number) => new Intl.DateTimeFormat(locale, { month: "short" }).format(new Date(2026, value - 1, 1));
  const directionLabel = (value: Direction) => value === "Improving" ? c.improving : value === "Worsening" ? c.worsening : value === "Stable" ? c.stable : c.notComparable;
  const statusLabel = (value: string) => value === "needsAttention" ? c.attention : value === "monitor" ? c.monitor : value === "strong" ? c.strong : c.stable;
  return { c, language, money, pct, delta, month, directionLabel, statusLabel };
}

export function BusinessImpact({ model, actual, onMovement }: { model: PerformanceManagement; actual: VehiclePerformanceSummary; onMovement: (direction: Direction | null) => void }) {
  const { c, money, pct, delta, month, directionLabel } = useManagementFormatters();
  const comparison = model.comparison;
  const direction = comparison?.direction ?? "Not comparable";
  const ratioGood = comparison?.fuelRatio == null ? null : comparison.fuelRatio < 0 ? true : comparison.fuelRatio > 0 ? false : null;
  const fuelGood = comparison?.fuelSpend == null || comparison.revenue == null ? null : comparison.fuelSpend < 0 && comparison.revenue >= 0 ? true : comparison.fuelSpend > 0 && comparison.revenue <= 0 ? false : null;
  const benchmark = model.benchmark;
  const comparisonReason = !comparison ? c.comparisonNeeded : direction === "Improving" ? c.improvingReason : direction === "Worsening" ? c.worseningReason : c.stableReason;
  const movementCopy = (value: Direction) => value === "Improving" ? c.improved : value === "Worsening" ? c.worsened : value === "Stable" ? c.broadlyStable : c.withoutComparable;

  return <section className="surface-card p-4 sm:p-5" aria-label={c.businessImpact}>
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="section-title">{c.businessImpact}</h3><p className="section-subtitle">{c.businessImpactDescription}</p></div><span className={`rounded-full border px-3 py-1 text-sm font-bold ${tone(direction)}`}>{directionLabel(direction)}</span></div>
    <p className="mt-3 text-sm font-medium text-slate-700">{comparison ? `${month(comparison.previous.month)} → ${month(comparison.current.month)}: ` : ""}{comparisonReason}</p>
    {comparison ? <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-5">
      <Metric label={c.revenueChange} value={delta(comparison.revenue)} good={comparison.revenue == null || comparison.revenue === 0 ? null : comparison.revenue > 0} />
      <Metric label={c.balanceChange} value={delta(comparison.balance)} good={comparison.balance == null || comparison.balance === 0 ? null : comparison.balance > 0} />
      <Metric label={c.marginChange} value={delta(comparison.margin, " pp")} good={comparison.margin == null || comparison.margin === 0 ? null : comparison.margin > 0} />
      <Metric label={c.fuelSpendChange} value={delta(comparison.fuelSpend)} good={fuelGood} />
      <Metric label={c.fuelRatioChange} value={delta(comparison.fuelRatio, " pp")} good={ratioGood} />
    </div> : null}
    <div className="mt-4 flex flex-wrap gap-2" aria-label={c.businessImpact}>{(["Improving", "Stable", "Worsening", "Not comparable"] as Direction[]).map((value) => <button key={value} type="button" onClick={() => onMovement(value)} className={`rounded-lg border px-3 py-2 text-sm font-semibold ${tone(value)}`}>{model.changes.filter((item) => item.direction === value).length} {movementCopy(value)}</button>)}<button type="button" onClick={() => onMovement(null)} className="text-xs font-semibold text-brand-700">{c.showAll}</button></div>
    {model.current && model.first && model.current.month !== model.first.month ? <div className="mt-4 border-t border-slate-100 pt-4"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">{c.sinceTracking}</p><div className="mt-2 grid gap-2 text-sm text-slate-700 lg:grid-cols-3">
      <p>{month(model.first.month)} → {month(model.current.month)} {c.revenue}: <strong>{delta(percentChange(model.current.grossRevenue, model.first.grossRevenue))}</strong></p>
      {model.worstFuel ? <p>{c.highestFuelRatio} {pct(model.worstFuel.fuelPercent)} · {month(model.worstFuel.month)} → {pct(model.current.fuelPercent)} · {month(model.current.month)}</p> : null}
      {model.lowestMargin ? <p>{c.lowestMargin} {pct(model.lowestMargin.marginPercent)} · {month(model.lowestMargin.month)} → {pct(model.current.marginPercent)} · {month(model.current.month)}</p> : null}
    </div></div> : null}
    {model.partialMonths.length ? <p className="mt-3 text-xs font-medium text-amber-800">{model.partialMonths.map(month).join(", ")} {c.partialExcluded}</p> : null}
    <div className="mt-4 rounded-xl border border-slate-200 p-3"><h4 className="text-sm font-semibold">{c.actualBenchmark}</h4><div className="mt-3 grid gap-2 sm:grid-cols-2">
      <Metric label={c.fuelActualMedian} value={`${pct(actual.fuelPercent)} / ${pct(benchmark.fuel)}`} /><Metric label={c.marginActualMedian} value={`${pct(actual.marginPercent)} / ${pct(benchmark.margin)}`} />
      <p className="text-sm">{c.fuelVariance}: {delta(actual.fuelPercent == null || benchmark.fuel == null ? null : actual.fuelPercent - benchmark.fuel, " pp")}</p><p className="text-sm">{c.marginVariance}: {delta(actual.marginPercent == null || benchmark.margin == null ? null : actual.marginPercent - benchmark.margin, " pp")}</p>
      <p className="text-sm">{c.revenue}: {money(actual.grossRevenue)}</p><p className="text-sm">{c.recordedBalance}: {money(actual.recordedBalance)}</p>
    </div><details className="mt-3"><summary className="cursor-pointer text-xs font-semibold text-brand-700">{c.methodology}</summary><p className="mt-3 text-xs leading-5 text-slate-600">{c.methodologySummary}</p><p className="mt-2 text-xs leading-5 text-slate-600">{c.methodologyThresholds}</p><p className="mt-2 text-xs leading-5 text-slate-600">{c.balanceDefinition}</p></details></div>
  </section>;
}

export function ActionQueue({ model, onVehicle }: { model: PerformanceManagement; onVehicle: (registration: string) => void }) {
  const { c, money, pct, delta, statusLabel, language } = useManagementFormatters();
  return <section className="surface-card p-4 sm:p-5" aria-label={c.actionQueue}><div className="flex flex-wrap justify-between gap-3"><div><h3 className="section-title">{c.actionQueue}</h3><p className="section-subtitle">{c.actionQueueDescription}</p></div><div className="rounded-xl border border-brand-100 bg-brand-50 px-4 py-3"><p className="text-xs font-semibold text-brand-700">{c.estimatedOpportunity}</p><p className="text-xl font-bold text-brand-800">{model.benchmark.fuel == null ? c.unavailable : money(model.totalOpportunity)}</p><p className="text-xs text-brand-700">{c.indicativeOpportunity} · {model.estimatedVehicleCount} {c.vehicles}</p></div></div>
    <p className="mt-3 text-xs leading-5 text-slate-600">{c.estimateNote} ({pct(model.benchmark.fuel)})</p>
    {!model.actionRows.length ? <p className="mt-4 rounded-xl bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">{c.noAction}</p> : <div className="mt-4 grid gap-3 xl:grid-cols-2">{model.actionRows.map((row) => <article key={row.vehicleRegistration} className="rounded-xl border border-slate-200 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><button type="button" onClick={() => onVehicle(row.vehicleRegistration)} className="font-bold text-brand-700 underline decoration-brand-200 underline-offset-4">{row.vehicleRegistration}</button><span className={`rounded-full border px-2 py-1 text-xs font-bold ${tone(row.status)}`}>{statusLabel(row.status)}</span></div><dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm"><div><dt className="text-xs text-slate-500">{c.revenue}</dt><dd className="font-semibold">{money(row.grossRevenue)}</dd></div><div><dt className="text-xs text-slate-500">{c.recordedBalance}</dt><dd className="font-semibold">{money(row.recordedBalance)}</dd></div><div><dt className="text-xs text-slate-500">{c.margin}</dt><dd>{pct(row.marginPercent)} · {delta(row.marginVariance, " pp")} {c.vsMedian}</dd></div><div><dt className="text-xs text-slate-500">{c.fuelRatio}</dt><dd>{pct(row.fuelPercent)} · {delta(row.fuelVariance, " pp")} {c.vsMedian}</dd></div></dl><p className="mt-3 text-sm text-slate-700">{language === "th" ? c.reviewReason : row.statusReason}</p><div className="mt-3 flex flex-wrap justify-between gap-2 border-t border-slate-100 pt-3 text-xs"><span className={row.eligible ? "text-slate-600" : "font-semibold text-amber-800"}>{row.monthsLoaded} / {row.monthsExpected} {c.months}</span><strong className="text-brand-700">{c.indicativeOpportunity}: {row.opportunity == null ? c.notEstimated : money(row.opportunity)}</strong></div>{row.exclusionReason ? <p className="mt-2 text-xs text-amber-800">{c.excluded}: {language === "th" ? c.reviewReason : row.exclusionReason}</p> : null}<button type="button" className="btn-secondary mt-3 text-xs" onClick={() => onVehicle(row.vehicleRegistration)}>{c.viewVehicle}</button></article>)}</div>}
  </section>;
}

export function VehicleDrillDown({ registration, history, onClose }: { registration: string; history: Array<{ month: number; row: ManagedVehicle | undefined; benchmark: PerformanceManagement["benchmark"] }>; onClose: () => void }) {
  const [expanded, setExpanded] = useState(true);
  const { c, money, pct, delta, month, statusLabel, language } = useManagementFormatters();
  const present = history.filter((item) => item.row);
  const last = present.at(-1), previous = present.at(-2);
  const headers = [c.month, c.revenue, c.fuel, c.fuelPercent, c.balance, c.margin, c.fleetFuelMargin, c.statusReason];
  return <section className="surface-card border-brand-200 p-4 sm:p-5" aria-label={c.vehicleDetail}><div className="flex items-center justify-between gap-3"><div><h3 className="section-title">{registration} · {c.vehicleDetail}</h3><p className="section-subtitle">{c.vehicleDetailDescription}</p></div><button type="button" className="btn-secondary" onClick={onClose}>{c.closeDetail}</button></div>
    {last && previous && last.month === previous.month + 1 ? <p className="mt-3 text-sm">{c.latestTrend} ({month(previous.month)} → {month(last.month)}): {c.margin} {delta(last.row!.marginPercent == null || previous.row!.marginPercent == null ? null : last.row!.marginPercent - previous.row!.marginPercent, " pp")}; {c.fuelRatio} {delta(last.row!.fuelPercent == null || previous.row!.fuelPercent == null ? null : last.row!.fuelPercent - previous.row!.fuelPercent, " pp")}</p> : null}
    <details open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)} className="mt-3"><summary className="cursor-pointer text-sm font-semibold">{c.monthlyHistory}</summary><div className="mt-3 overflow-x-auto"><table className="w-full min-w-[850px] text-sm"><thead><tr>{headers.map((header) => <th key={header} className="p-2 text-left text-xs text-slate-500">{header}</th>)}</tr></thead><tbody>{history.map((item) => <tr key={item.month} className="border-t border-slate-100"><td className="p-2 font-semibold">{month(item.month)}</td>{item.row ? <><td className="p-2">{money(item.row.grossRevenue)}</td><td className="p-2">{money(item.row.fuelSpend)}</td><td className="p-2">{pct(item.row.fuelPercent)}</td><td className="p-2">{money(item.row.recordedBalance)}</td><td className="p-2">{pct(item.row.marginPercent)}</td><td className="p-2">{pct(item.benchmark.fuel)} / {pct(item.benchmark.margin)}</td><td className="max-w-xs p-2"><strong>{statusLabel(item.row.status)}</strong><p className="text-xs text-slate-600">{language === "th" ? c.reviewReason : item.row.statusReason}</p></td></> : <td colSpan={7} className="p-2 text-amber-800">{c.missingMonth}</td>}</tr>)}</tbody></table></div></details>
  </section>;
}
