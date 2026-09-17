"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, ChevronUp, FileCheck2, FileText } from "lucide-react";
import { useLanguage } from "@/lib/language-provider";
import { useAccountAccess } from "@/lib/use-account-access";
import { deleteMaintenanceRecord, viewMaintenanceAttachment } from "@/lib/maintenance-data";
import { buildMaintenanceReminders, maintenanceDowntime, receiptDifference } from "@/lib/maintenance";
import { maintenanceDriver } from "@/lib/maintenance";
import { maintenanceCategoryTone, maintenanceHighCostThreshold, maintenanceVehicleType, nearestMaintenanceMileage } from "@/lib/maintenance-ux";
import { maintenanceCategoryShortLabels } from "@/lib/maintenance-translations";
import type { MaintenanceData, MaintenanceRecord, MaintenanceReminder } from "@/lib/maintenance-types";
import { formatCurrency, formatDate, formatNumber } from "@/lib/utils";
import { MaintenanceItemTable } from "./maintenance-item-table";
import { MaintenanceAttachmentList } from "./maintenance-attachments";

export function MaintenanceVisit({ record, data, onEdit, onChanged, reminders, detailed = false }: {
  record: MaintenanceRecord; data: MaintenanceData; onEdit: (record: MaintenanceRecord) => void;
  onChanged: () => void; reminders?: MaintenanceReminder[]; detailed?: boolean;
}) {
  const { t, language } = useLanguage(), c = t.maintenance;
  const { can } = useAccountAccess();
  const [expanded, setExpanded] = useState(detailed);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const detailsId = useId();
  const receiptsRef = useRef<HTMLDivElement>(null);
  useEffect(() => { setExpanded(detailed); }, [detailed]);
  const items = data.items.filter(item => item.record_id === record.id).sort((a, b) => a.position - b.position);
  const categories = Array.from(new Set(items.map(item => item.category)));
  const attachments = data.attachments.filter(a => a.record_id === record.id);
  const currentReminders = (reminders ?? buildMaintenanceReminders(data)).filter(r => r.record_id === record.id);
  const difference = receiptDifference(Number(record.calculated_total), record.receipt_total === null ? null : Number(record.receipt_total));
  const vehicle = data.vehicles.find(v => v.id === record.vehicle_id);
  const inferredMileage = record.odometer === null ? nearestMaintenanceMileage(data, record.vehicle_id, record.service_date) : null;
  const highCostThreshold = maintenanceHighCostThreshold(data.records);
  const highCost = highCostThreshold !== null && Number(record.calculated_total) >= highCostThreshold;
  const openReceipt = async () => {
    setError(null);
    if (attachments.length > 1) {
      setExpanded(true);
      window.setTimeout(() => receiptsRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
      return;
    }
    if (!attachments.length) return;
    const tab = window.open("about:blank", "_blank");
    if (tab) tab.opener = null;
    setBusy(true);
    try {
      const url = await viewMaintenanceAttachment(attachments[0]);
      if (tab) tab.location.href = url; else window.location.assign(url);
    } catch { tab?.close(); setError(c.receiptOpenError); }
    finally { setBusy(false); }
  };
  return <article className={`min-w-0 overflow-hidden rounded-2xl border border-violet-100/90 bg-[#faf9fe] shadow-[0_4px_16px_rgba(67,56,202,0.055)] transition duration-200 hover:-translate-y-0.5 hover:border-violet-200 hover:shadow-[0_10px_24px_rgba(67,56,202,0.09)] ${expanded?"lg:col-span-2":""}`}>
    <div className="space-y-3 p-3.5 sm:p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h4 className="break-words text-lg font-bold tracking-tight text-slate-950">{vehicle?.vehicle_reg ?? "—"}</h4>{highCost&&<span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800">{c.highCostRepair}</span>}</div><p className="mt-0.5 text-xs text-slate-500">{maintenanceVehicleType(vehicle?.vehicle_type,t.weeklyMileage.oil.vehicleTypes)} · {maintenanceDriver(data,record.vehicle_id)||c.unassigned}</p><p className="mt-0.5 text-xs text-slate-500">{formatDate(record.service_date, language)} · {record.garage||"—"}{record.is_deleted&&` · ${c.deleted}`}</p></div>
        <div className="min-w-0 max-w-[55%] text-right"><p className="break-words text-lg font-bold tracking-tight text-violet-950 sm:text-xl">{formatCurrency(Number(record.calculated_total), language)}</p><p className="mt-1 text-[11px] text-slate-400">{c.recordTotal}</p></div>
      </div>
      <div className="flex flex-wrap gap-1.5">{categories.slice(0,3).map(category=><span key={category} className={`rounded-full border px-2.5 py-1 text-xs font-medium ${maintenanceCategoryTone[category]}`}>{maintenanceCategoryShortLabels[language][category]}</span>)}{categories.length>3&&<span title={categories.slice(3).map(category=>maintenanceCategoryShortLabels[language][category]).join(", ")} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">+{categories.length-3} {c.moreCategories}</span>}</div>
      <div className="space-y-1 text-xs leading-5 text-slate-500"><p className="font-medium text-slate-700">{items.length} {items.length===1?c.maintenanceItem:c.maintenanceItemsCount}</p>{(record.odometer!==null||inferredMileage)&&<p>{record.odometer!==null?c.mileage:c.inferredMileage}: <span className="text-slate-700">{formatNumber(record.odometer??inferredMileage!.value,language)}{inferredMileage?` · ${formatDate(inferredMileage.date,language)}`:""}</span></p>}</div>
      <div className="flex flex-wrap items-center gap-2 text-xs">{attachments.length?<span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 font-medium text-emerald-700"><FileCheck2 className="h-3.5 w-3.5"/>{attachments.length===1?c.receiptAttached:`${attachments.length} ${c.receiptsAttached}`}</span>:<span className="text-slate-400">{c.noReceipt}</span>}{difference===0&&<span className="rounded-full bg-emerald-50 px-2.5 py-1 font-medium text-emerald-700">✓ {c.matched}</span>}</div>
      <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3"><button type="button" className="btn-secondary min-h-11 gap-1.5" aria-expanded={expanded} aria-controls={detailsId} onClick={() => setExpanded(value => !value)}>{expanded ? c.hideDetails : c.viewRecord}{expanded ? <ChevronUp className="h-4 w-4"/> : <ChevronDown className="h-4 w-4"/>}</button>{attachments.length > 0 && <button type="button" disabled={busy} className="btn-secondary min-h-11 gap-1.5" onClick={() => void openReceipt()}><FileText className="h-4 w-4" aria-hidden="true"/>{attachments.length > 1 ? c.viewReceipts : c.viewReceipt}</button>}</div>
      {difference !== null && difference !== 0 && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">⚠ {c.difference}: {formatCurrency(difference, language)}</p>}
      {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
    </div>
    <div id={detailsId} hidden={!expanded} className="space-y-4 border-t border-violet-100 bg-[#f5f3fc]/70 p-4 sm:p-5">
      <section className="rounded-xl border border-violet-100 bg-[#faf9fe] p-3"><h5 className="text-[11px] font-bold uppercase tracking-[.14em] text-violet-700">{c.maintenanceSummary}</h5><dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">{[[c.vehicle,vehicle?.vehicle_reg??"—"],[c.driver,maintenanceDriver(data,record.vehicle_id)||c.unassigned],[c.vehicleType,maintenanceVehicleType(vehicle?.vehicle_type,t.weeklyMileage.oil.vehicleTypes)],[c.serviceDate,formatDate(record.service_date,language)],[c.garage,record.garage||"—"],[c.mileage,record.odometer===null?inferredMileage?`${formatNumber(inferredMileage.value,language)} · ${c.inferredMileage}`:"—":formatNumber(record.odometer,language)],[c.recordTotal,formatCurrency(Number(record.calculated_total),language)]].map(([label,value])=><div key={label}><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-0.5 break-words font-semibold text-slate-900">{value}</dd></div>)}</dl></section>
      <section className={`rounded-xl border p-3 ${difference!==null&&difference!==0?"border-amber-300 bg-amber-50 text-amber-900":"border-emerald-200 bg-emerald-50/70"}`}><h5 className="text-[11px] font-bold uppercase tracking-[.14em]">{c.receiptCheck}</h5><div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">{record.receipt_reference&&<p>{c.receiptReference}: <strong>{record.receipt_reference}</strong></p>}<p>{c.enteredTotal}: <strong>{formatCurrency(Number(record.calculated_total),language)}</strong></p><p>{c.receiptTotal}: <strong>{record.receipt_total===null?"—":formatCurrency(Number(record.receipt_total),language)}</strong></p>{difference!==null&&<p className="font-semibold">{difference===0?`✓ ${c.matched}`:`⚠ ${c.difference}: ${formatCurrency(difference,language)}`}{difference!==0&&record.mismatch_confirmed&&` · ${c.confirmMismatch}`}</p>}</div></section>
      <MaintenanceItemTable items={items} record={record}/>
      {currentReminders.map(reminder => <p key={reminder.key} className="rounded-xl bg-violet-50 p-3 text-sm">{reminder.name} · {reminder.mileage_unavailable && reminder.status === "ok" ? c.unassessed : c[reminder.status]}</p>)}
      {record.notes && <div className="text-sm"><p className="font-semibold">{c.generalNotes}</p><p className="mt-1 whitespace-pre-wrap break-words text-slate-600">{record.notes}</p></div>}
      {record.off_road_at && <p className="text-sm">{c.downtime}: {formatNumber(maintenanceDowntime(record), language, 1)} {c.hours} · {new Date(record.off_road_at).toLocaleString(language, { timeZone: "Asia/Bangkok" })} → {record.returned_at ? new Date(record.returned_at).toLocaleString(language, { timeZone: "Asia/Bangkok" }) : c.ongoing}</p>}
      <div ref={receiptsRef} className="space-y-2"><h5 className="text-sm font-semibold">{c.attachments}</h5>{attachments.length ? <MaintenanceAttachmentList attachments={attachments} onChange={onChanged}/> : <p className="text-sm text-slate-500">{c.noReceipt}</p>}</div>
      <details><summary className="cursor-pointer py-2 text-xs text-slate-500">{c.auditDetails}</summary><dl className="grid gap-2 text-xs text-slate-500 sm:grid-cols-2">{[[c.createdBy, record.created_by], [c.updatedBy, record.updated_by], [c.createdAt, new Date(record.created_at).toLocaleString(language)], [c.updatedAt, new Date(record.updated_at).toLocaleString(language)]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd className="break-all">{value}</dd></div>)}</dl></details>
      {!record.is_deleted && <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-3">{can("business:write") && <button className="btn-secondary min-h-11" disabled={busy} onClick={() => onEdit(record)}>{c.edit}</button>}{can("business:delete") && <button className="btn-secondary min-h-11 text-rose-700" disabled={busy} onClick={async () => { if (!window.confirm(c.confirmDelete)) return; setBusy(true); setError(null); try { await deleteMaintenanceRecord(record); onChanged(); } catch { setError(c.saveError); } finally { setBusy(false); } }}>{c.delete}</button>}</div>}
    </div>
  </article>;
}
