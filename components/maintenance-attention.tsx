"use client";
import { maintenanceVehicleType } from "@/lib/maintenance-ux";
import { useMemo, useState } from "react";
import { useLanguage } from "@/lib/language-provider";
import { useAccountAccess } from "@/lib/use-account-access";
import { maintenanceDriver, maintenanceTones, reliableMaintenanceMileage } from "@/lib/maintenance";
import { repeatedMaintenanceRepairs } from "@/lib/maintenance-intelligence";
import { maintenanceCategoryLabels } from "@/lib/maintenance-translations";
import type { MaintenanceData, MaintenanceReminder } from "@/lib/maintenance-types";
import { formatCurrency, formatDate, formatNumber } from "@/lib/utils";

export function MaintenanceAttention({ data, reminders, today, filters, onAdd, onHistory }: {
  data: MaintenanceData; reminders: MaintenanceReminder[]; today: string; filters: import("@/lib/maintenance").MaintenanceFilters;
  onAdd: (vehicleId: string) => void; onHistory: (vehicleId: string) => void;
}) {
  const { t, language } = useLanguage(), c = t.maintenance, { can } = useAccountAccess();
  const [all, setAll] = useState(false);
  const repeats = useMemo(() => repeatedMaintenanceRepairs(data, today).filter(r => {
    const vehicle = data.vehicles.find(v => v.id === r.vehicleId);
    const visits = data.records.filter(v => !v.is_deleted && v.vehicle_id === r.vehicleId);
    return vehicle?.active !== false && !filters.status && (!filters.vehicle || r.vehicleId === filters.vehicle) && (!filters.vehicleType || vehicle?.vehicle_type === filters.vehicleType) && (!filters.driver || data.drivers.some(d => d.id === filters.driver && d.active !== false && d.assigned_vehicle_id === r.vehicleId)) && (!filters.category || filters.category === r.category) && (!filters.garage || visits.some(v => v.garage === filters.garage)) && `${vehicle?.vehicle_reg} ${maintenanceDriver(data, r.vehicleId)} ${r.name}`.toLowerCase().includes(filters.search.toLowerCase());
  }), [data, today, filters]);
  const count = reminders.length + repeats.length;
  const filtered = Boolean(filters.vehicle || filters.driver || filters.vehicleType || filters.category || filters.status || filters.garage || filters.search);
  return <section id="maintenance-attention" className="maintenance-panel scroll-mt-24 space-y-3 overflow-hidden border-violet-200 p-4 shadow-[0_12px_30px_rgba(49,46,129,0.08)] sm:p-5">
    <div className="flex items-start justify-between gap-2"><div><h3 className="section-title">{c.upcoming}</h3><p className="mt-1 text-xs text-slate-500">{c.attentionSubtitle}</p></div><span className="rounded-full bg-violet-100 px-3 py-1 text-sm font-semibold text-violet-900">{count}</span></div>
    {!reminders.length && <div className={`flex items-start gap-3 rounded-xl border p-3 ${filtered?"border-violet-100 bg-violet-50/70 text-violet-900":"border-emerald-100 bg-emerald-50/80 text-emerald-900"}`}><span aria-hidden="true" className="font-bold">{filtered?"○":"✓"}</span><div><p className="text-sm font-semibold">{filtered?c.noUrgentItems:c.fleetUpToDate}</p>{!filtered&&<p className="mt-0.5 text-xs text-emerald-800">{c.noUrgentReminders}</p>}</div></div>}
    <div className="grid gap-3 lg:grid-cols-2">{(all ? reminders : reminders.slice(0, 6)).map(r => {
      const vehicle = data.vehicles.find(v => v.id === r.vehicle_id), last = data.records.find(v => v.id === r.record_id);
      const mileage = reliableMaintenanceMileage(data.mileage, r.vehicle_id, today);
      const high = r.status === "overdue" || r.status === "mileageDue" || r.days !== null && r.days <= 7;
      return <article key={r.key} className={`min-w-0 space-y-2 rounded-xl border p-3 ${maintenanceTones[r.status]}`}>
        <div className="flex flex-wrap justify-between gap-2"><strong>{vehicle?.vehicle_reg}</strong><span className="text-xs font-semibold">{r.mileage_unavailable && r.status === "ok" ? c.unassessed : c[r.status]}</span></div>
        <p className="text-xs text-slate-600">{maintenanceDriver(data, r.vehicle_id) || c.unassigned} · {maintenanceVehicleType(vehicle?.vehicle_type,t.weeklyMileage.oil.vehicleTypes)}</p>
        <p className="break-words font-semibold">{r.name}</p><p className="text-xs">{c.priority}: {high ? c.highPriority : r.status === "dueSoon" ? c.mediumPriority : c.informational}</p>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
          {[[c.nextDate, r.due_date ? formatDate(r.due_date, language) : "—"], [c.remainingDays, r.days === null ? "—" : String(r.days)], [c.nextMileage, r.due_km === null ? "—" : formatNumber(r.due_km, language)], [c.remainingKm, r.km === null ? "—" : formatNumber(r.km, language)], [c.latestMileage, mileage.value === null ? c.insufficient : formatNumber(mileage.value, language)], [c.lastCompleted, last ? formatDate(last.service_date, language) : "—"]].map(([label, value]) => <div key={label}><dt className="text-slate-500">{label}</dt><dd className="mt-0.5 font-medium">{value}</dd></div>)}
        </dl>
        {r.mileage_unavailable && <p className="text-xs text-amber-900">{c.mileageUnavailable} · {r.mileage_date ?? "—"}</p>}
        <div className="flex flex-wrap gap-2 pt-1">{can("business:write") && <button className="btn-secondary" onClick={() => onAdd(r.vehicle_id)}>{c.add}</button>}<button className="btn-secondary" onClick={() => onHistory(r.vehicle_id)}>{c.openHistory}</button></div>
      </article>;
    })}</div>
    <details className="rounded-xl border border-amber-200 bg-amber-50/55 p-3" open={repeats.length>0}><summary className="cursor-pointer text-sm font-semibold text-amber-950">{c.recurringTrends} ({repeats.length})</summary><p className="mt-1 text-xs text-amber-800/80">{c.recurrenceHelp}</p><div className="mt-3 grid gap-3 lg:grid-cols-2">{(all ? repeats : repeats.slice(0,6)).map(r => <article key={`${r.vehicleId}:${r.category}:${r.name}`} className="space-y-2 rounded-xl border border-amber-200 bg-[#fffaf0] p-3">
      <div className="flex flex-wrap justify-between gap-2"><strong>{data.vehicles.find(v => v.id === r.vehicleId)?.vehicle_reg}</strong><span className="text-xs">{c.informational}</span></div>
      <p className="text-xs text-slate-500">{maintenanceDriver(data, r.vehicleId) || c.unassigned} · {maintenanceVehicleType(data.vehicles.find(v => v.id === r.vehicleId)?.vehicle_type,t.weeklyMileage.oil.vehicleTypes)}</p>
      <p className="font-semibold">{c.recurringRepair}</p><p className="text-sm">{r.categoryFallback ? maintenanceCategoryLabels[language][r.category] : r.name} · {r.visits} {c.occurrences}</p>
      <p className="text-xs text-slate-500">{formatDate(r.first, language)} – {formatDate(r.last, language)} · {formatCurrency(r.total, language)}</p>
      <button className="btn-secondary" onClick={() => onHistory(r.vehicleId)}>{c.openHistory}</button>
    </article>)}</div></details>
    {count > 6 && <button className="btn-secondary" aria-expanded={all} onClick={() => setAll(!all)}>{all ? c.showFewerReminders : `${c.viewAll} (${count})`}</button>}
    <p className="text-xs text-slate-500">{c.enabledOnly}</p>
  </section>;
}
