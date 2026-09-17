"use client";
import { useMemo, useState } from "react";
import { useLanguage } from "@/lib/language-provider";
import { maintenanceHistorySummary, sortMaintenanceHistory, type MaintenanceHistorySort } from "@/lib/maintenance-ux";
import { buildMaintenanceReminders } from "@/lib/maintenance";
import type { MaintenanceData, MaintenanceRecord, MaintenanceReminder } from "@/lib/maintenance-types";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { MaintenanceVisit } from "./maintenance-record-card";
import { MaintenanceField as Field } from "./maintenance-fields";

export function MaintenanceRecordCollection({ records, data, onEdit, onChanged, reminders, showSummary = true }: {
  records: MaintenanceRecord[]; data: MaintenanceData; onEdit: (record: MaintenanceRecord) => void;
  onChanged: () => void; reminders?: MaintenanceReminder[]; showSummary?: boolean;
}) {
  const { t, language } = useLanguage(), c = t.maintenance;
  const [sort, setSort] = useState<MaintenanceHistorySort>("newestFirst");
  const [view, setView] = useState("compact"), [group, setGroup] = useState("recordsGroup");
  const summary = useMemo(() => maintenanceHistorySummary(records), [records]);
  const sorted = useMemo(() => sortMaintenanceHistory(records, data, sort), [records, data, sort]);
  const statuses = useMemo(() => reminders ?? buildMaintenanceReminders(data), [reminders, data]);
  const groups = useMemo(() => {
    const grouped = new Map<string, MaintenanceRecord[]>();
    for (const record of sorted) {
      const key = group === "vehicleGroup" ? record.vehicle_id : "all";
      grouped.set(key, [...(grouped.get(key) ?? []), record]);
    }
    return Array.from(grouped);
  }, [sorted, group]);
  return <div className="space-y-4">
    {showSummary && <div aria-label={c.periodSummary} className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-violet-100 bg-violet-100 sm:grid-cols-4">{[[c.visits, formatNumber(summary.records, language)], [c.vehiclesServiced, formatNumber(summary.vehicles, language)], [c.spending, formatCurrency(summary.total, language)], [c.averageRecord, summary.average === null ? "—" : formatCurrency(summary.average, language)]].map(([label, value]) => <div key={label} className="min-w-0 bg-violet-50/90 p-3 sm:p-4"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 break-words text-base font-bold tracking-tight text-violet-950 sm:text-lg">{value}</p></div>)}</div>}
    <div className="grid gap-3 rounded-2xl border border-slate-100 bg-slate-50/60 p-3 sm:grid-cols-3"><Field label={c.sortBy}><select className="form-input !min-h-11" value={sort} onChange={e => setSort(e.target.value as MaintenanceHistorySort)}>{(["newestFirst", "oldestFirst", "highestCost", "vehicleRegistration"] as const).map(key => <option key={key} value={key}>{c[key]}</option>)}</select></Field><Field label={c.viewMode}><select className="form-input !min-h-11" value={view} onChange={e => setView(e.target.value)}><option value="compact">{c.compact}</option><option value="detailed">{c.detailed}</option></select></Field><Field label={c.groupBy}><select className="form-input !min-h-11" value={group} onChange={e => setGroup(e.target.value)}><option value="recordsGroup">{c.recordsGroup}</option><option value="vehicleGroup">{c.vehicleGroup}</option></select></Field></div>
    {!records.length && <p className="rounded-xl bg-slate-50 p-5 text-center text-sm text-slate-500">{c.empty}</p>}
    {groups.map(([key, entries]) => {
      const subtotal = maintenanceHistorySummary(entries);
      return <div key={key} className="space-y-3">{group === "vehicleGroup" && <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-violet-100 px-1 pb-2 pt-3"><h4 className="text-lg font-bold text-slate-900">{data.vehicles.find(vehicle => vehicle.id === key)?.vehicle_reg ?? "—"}</h4><p className="text-sm text-slate-500">{entries.length} {c.visits} · {formatCurrency(subtotal.total, language)}</p></div>}<div className={view === "compact" ? "grid items-start gap-3 lg:grid-cols-2 xl:gap-4" : "space-y-4"}>{entries.map(record => <MaintenanceVisit key={record.id} record={record} data={data} onEdit={onEdit} onChanged={onChanged} reminders={statuses} detailed={view === "detailed"}/>)}</div></div>;
    })}
  </div>;
}
