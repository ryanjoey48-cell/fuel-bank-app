"use client";

import { useMemo, useState } from "react";
import { Download, Search } from "lucide-react";
import { useLanguage } from "@/lib/language-provider";
import { exportToCsv, exportWorkbookToXlsx } from "@/lib/export";
import { formatDate } from "@/lib/utils";
import {
  buildFleetComponentRows,
  maintenanceComponentCatalogue,
  type FleetComponentRow,
  type MaintenanceComponentCategory,
} from "@/lib/maintenance-components";
import type { MaintenanceData } from "@/lib/maintenance-types";
import type { VehicleMaintenanceCheck } from "@/lib/maintenance-office";
import type { OilChangeAlertRow } from "@/lib/operations";

type ComponentView = "fleet" | "inspections" | "replacements" | "attention";

const categories: { key: MaintenanceComponentCategory | "all"; icon: string; en: string; th: string }[] = [
  { key: "all", icon: "", en: "All categories", th: "ทุกหมวด" },
  { key: "engine", icon: "🛢️", en: "Engine & filters", th: "เครื่องยนต์และไส้กรอง" },
  { key: "cooling", icon: "💧", en: "Cooling system", th: "ระบบหล่อเย็น" },
  { key: "brakes", icon: "🛞", en: "Brakes & wheels", th: "เบรกและล้อ" },
  { key: "electrical", icon: "🔋", en: "Electrical", th: "ระบบไฟฟ้า" },
  { key: "mechanical", icon: "⚙️", en: "Mechanical", th: "ระบบกลไก" },
  { key: "custom", icon: "+", en: "Custom items", th: "รายการกำหนดเอง" },
];

export function MaintenanceComponentOverview({
  data,
  checks,
  oilRows,
  checksAvailable=true,
  onVehicle,
}: {
  data: MaintenanceData;
  checks: VehicleMaintenanceCheck[];
  oilRows: OilChangeAlertRow[];
  checksAvailable?:boolean;
  onVehicle: (vehicleId: string, componentKey: string) => void;
}) {
  const { language,t } = useLanguage();
  const th = language === "th";
  const catalogue = useMemo(() => maintenanceComponentCatalogue(data, checks), [data, checks]);
  const [category, setCategory] = useState<MaintenanceComponentCategory | "all">("all");
  const available = catalogue.filter(item => category === "all" || item.category === category);
  const [componentKey, setComponentKey] = useState(catalogue[0]?.key ?? "engine_oil");
  const selected = available.find(item => item.key === componentKey) ?? available[0] ?? catalogue[0];
  const rows = useMemo(() => selected ? buildFleetComponentRows(data, checks, oilRows, selected.key) : [], [data, checks, oilRows, selected]);
  const [view, setView] = useState<ComponentView>("fleet");
  const [query, setQuery] = useState("");
  const [vehicleType, setVehicleType] = useState("");
  const [condition, setCondition] = useState("");
  const [replacement, setReplacement] = useState("");
  const [dueStatus, setDueStatus] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const filtered = rows.filter(row => {
    const term = query.trim().toLocaleLowerCase();
    const inspectionDate = row.latestInspection?.check_date ?? "";
    const replacementDate = row.lastReplacement?.date ?? "";
    const date = view === "inspections" ? inspectionDate : replacementDate || inspectionDate;
    return (!term || `${row.registration} ${row.driver}`.toLocaleLowerCase().includes(term))
      && (!vehicleType || row.vehicleType === vehicleType)
      && (!condition || row.inspectionResult === condition)
      && (!replacement || (replacement === "known" ? !!row.lastReplacement : !row.lastReplacement))
      && (!dueStatus || row.scheduleStatus === dueStatus)
      && (!start || !!date && date >= start)
      && (!end || !!date && date <= end)
      && (view !== "inspections" || !!row.latestInspection)
      && (view !== "replacements" || !!row.lastReplacement)
      && (view !== "attention" || row.inspectionResult === "attention" || row.scheduleStatus === "overdue" || row.scheduleStatus === "dueSoon" || row.scheduleStatus === "urgent" || row.scheduleStatus === "unknown");
  });
  const exportRows = filtered.map(row => componentExportRow(row, selected?.[th ? "nameTh" : "nameEn"] ?? "", language));
  const vehicleTypes = [...new Set(rows.map(row => row.vehicleType).filter(Boolean))].sort();

  if(!checksAvailable)return <section className="rounded-xl border border-amber-200 bg-amber-50 p-4" role="status">{th?'ไม่สามารถโหลดประวัติการตรวจได้ กรุณาโหลดใหม่ก่อนใช้ข้อมูลสภาพรถ':'Inspection history is unavailable. Refresh before assessing component coverage or condition.'}</section>;
  return <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-3 sm:p-4" aria-label={th ? "ภาพรวมชิ้นส่วนทั้งฝูงรถ" : "Fleet-wide component overview"}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-[11px] font-semibold uppercase tracking-wider text-violet-600">{th ? "ข้อมูลชิ้นส่วนทั้งฝูงรถ" : "FLEET COMPONENT CONTROL"}</p><h2 className="text-lg font-semibold text-slate-950">{th ? "ชิ้นส่วนและการตรวจสภาพ" : "Components & inspections"}</h2><p className="text-xs text-slate-500">{th ? "แยกประวัติการตรวจออกจากการเปลี่ยนอะไหล่ที่ยืนยันแล้ว" : "Inspection history stays separate from confirmed replacement history."}</p></div>
      <details className="relative"><summary className="btn-secondary inline-flex cursor-pointer list-none items-center gap-2"><Download size={15}/>{th ? "ส่งออก" : "Export"}</summary><div className="absolute right-0 z-20 mt-2 grid min-w-44 gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-lg"><button className="btn-secondary" disabled={!filtered.length} onClick={() => exportToCsv(exportRows, `maintenance-${selected?.key ?? "components"}`)}>CSV</button><button className="btn-secondary" disabled={!filtered.length} onClick={() => exportWorkbookToXlsx([{ name: th ? "ชิ้นส่วน" : "Components", rows: exportRows }], `maintenance-${selected?.key ?? "components"}`)}>Excel</button></div></details>
    </div>
    <div className="flex flex-wrap gap-1 rounded-xl bg-violet-50/70 p-1" role="group" aria-label={th ? "หมวดชิ้นส่วน" : "Component categories"}>{categories.map(item => <button key={item.key} type="button" aria-pressed={category === item.key} className={`min-h-9 rounded-lg px-3 text-xs font-semibold ${category === item.key ? "bg-white text-violet-800 shadow-sm" : "text-slate-600 hover:bg-white"}`} onClick={() => { setCategory(item.key); const next = catalogue.find(row => item.key === "all" || row.category === item.key); if (next) setComponentKey(next.key); }}>{item.icon} {th ? item.th : item.en}</button>)}</div>
    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
      <label className="text-xs font-medium text-slate-600">{th ? "ชิ้นส่วน" : "Component"}<select className="form-input mt-1" value={selected?.key ?? ""} onChange={event => setComponentKey(event.target.value)}>{available.map(item => <option key={item.key} value={item.key}>{th ? item.nameTh : item.nameEn}</option>)}</select></label>
      <label className="relative text-xs font-medium text-slate-600">{th ? "ทะเบียนหรือคนขับ" : "Registration or driver"}<Search size={15} className="absolute bottom-3 left-3 text-slate-400"/><input className="form-input mt-1 !pl-9" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={th ? "ค้นหารถ" : "Search fleet"}/></label>
      <label className="text-xs font-medium text-slate-600">{th ? "ประเภทรถ" : "Vehicle type"}<select className="form-input mt-1" value={vehicleType} onChange={event => setVehicleType(event.target.value)}><option value="">{th ? "ทั้งหมด" : "All types"}</option>{vehicleTypes.map(value => <option key={value} value={value}>{t.weeklyMileage.oil.vehicleTypes[value as keyof typeof t.weeklyMileage.oil.vehicleTypes]??value.replaceAll("_"," ")}</option>)}</select></label>
      <label className="text-xs font-medium text-slate-600">{th ? "ผลตรวจ" : "Inspection condition"}<select className="form-input mt-1" value={condition} onChange={event => setCondition(event.target.value)}><option value="">{th ? "ทั้งหมด" : "All conditions"}</option><option value="ok">{th ? "ปกติ" : "Good"}</option><option value="attention">{th ? "ต้องดูแล" : "Needs attention"}</option><option value="not_checked">{th ? "ยังไม่ได้ตรวจ" : "Not yet inspected"}</option><option value="not_applicable">{th ? "ไม่ใช้" : "Not applicable"}</option></select></label>
      <label className="text-xs font-medium text-slate-600">{th ? "ประวัติการเปลี่ยน" : "Replacement history"}<select className="form-input mt-1" value={replacement} onChange={event => setReplacement(event.target.value)}><option value="">{th ? "ทั้งหมด" : "All history"}</option><option value="known">{th ? "ยืนยันแล้ว" : "Confirmed"}</option><option value="unknown">{th ? "ไม่ทราบประวัติ" : "History unknown"}</option></select></label>
      <label className="text-xs font-medium text-slate-600">{th ? "สถานะรอบบริการ" : "Service due status"}<select className="form-input mt-1" value={dueStatus} onChange={event => setDueStatus(event.target.value)}><option value="">{th ? "ทั้งหมด" : "All statuses"}</option>{["overdue", "urgent", "dueSoon", "ok", "unknown", "notConfigured", "condition", "notApplicable"].map(value => <option key={value} value={value}>{scheduleText(value, language)}</option>)}</select></label>
      <label className="text-xs font-medium text-slate-600">{th ? "ตั้งแต่วันที่" : "From date"}<input className="form-input mt-1" type="date" value={start} max={end || undefined} onChange={event => setStart(event.target.value)}/></label>
      <label className="text-xs font-medium text-slate-600">{th ? "ถึงวันที่" : "To date"}<input className="form-input mt-1" type="date" value={end} min={start || undefined} onChange={event => setEnd(event.target.value)}/></label>
    </div>
    <div className="grid grid-cols-2 gap-2 xl:grid-cols-4" aria-label={th ? "สรุปชิ้นส่วน" : "Selected component summary"}>
      {([
        [th ? "รถที่เลือก" : "Vehicles in scope", rows.length],
        [th ? "ตรวจแล้ว" : "Inspected", rows.filter(row => !!row.latestInspection && row.inspectionResult !== "not_checked").length],
        [th ? "ต้องดูแล" : "Needs attention", rows.filter(row => row.inspectionResult === "attention").length],
        [th ? "มีประวัติเปลี่ยน" : "Confirmed replacements", rows.filter(row => !!row.lastReplacement).length],
      ] as const).map(([label, total]) => <div key={label} className="rounded-xl border border-violet-100 bg-white px-3 py-2.5"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-xl font-semibold tabular-nums text-slate-950">{total}</p></div>)}
    </div>
    <p className="text-xs text-slate-500">{th ? "ไม่มีประวัติ ไม่ได้หมายความว่าอะไหล่เสียหรือไม่เคยเปลี่ยน" : "No recorded history does not mean a part has failed or was never replaced."}</p>
    <div className="flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1" role="group" aria-label={th ? "มุมมองชิ้นส่วน" : "Component view"}>{(["fleet", "inspections", "replacements", "attention"] as const).map(value => <button key={value} type="button" aria-pressed={view === value} className={`min-h-9 flex-1 rounded-lg px-3 text-xs font-semibold sm:flex-none ${view === value ? "bg-white text-violet-800 shadow-sm" : "text-slate-600"}`} onClick={() => setView(value)}>{viewText(value, language)}</button>)}</div>
    <div className="flex flex-wrap gap-3 rounded-xl bg-violet-50/60 p-3 text-xs text-slate-700"><span>{th?'รถที่ใช้งาน':'Active'}: {rows.length}</span><span>{th?'ประเมินแล้ว':'Assessed'}: {rows.filter(r=>r.inspectionResult==='ok'||r.inspectionResult==='attention'||r.inspectionResult==='not_applicable'&&!!r.latestInspection?.notes?.trim()).length}</span><span>{th?'ยังไม่ประเมิน':'Not yet assessed'}: {rows.filter(r=>r.inspectionResult==='not_checked'||r.inspectionResult==='not_applicable'&&!r.latestInspection?.notes?.trim()).length}</span><span>{th?'พบปัญหา':'Confirmed problems'}: {rows.filter(r=>r.inspectionResult==='attention').length}</span><span>{th?'ยืนยันเปลี่ยนแล้ว':'Confirmed replacements'}: {rows.filter(r=>r.lastReplacement).length}</span></div>
    <p className="text-xs text-slate-500">{filtered.length} {th ? "คันจากรถที่ใช้งาน" : "active vehicles shown"} · {th ? "การกล่าวถึงในหมายเหตุทั่วไปไม่ถือเป็นการเปลี่ยนอะไหล่" : "Generic notes are not treated as replacement proof."}</p>
    <div className="hidden overflow-x-auto rounded-xl border border-slate-200 md:block"><table className="w-full min-w-[980px] text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="p-3">{th ? "รถ / คนขับ" : "Vehicle / driver"}</th><th className="p-3">{th ? "ประเภทรถ" : "Vehicle type"}</th><th className="p-3">{th ? "ตรวจล่าสุด" : "Latest inspection"}</th><th className="p-3">{th ? "สภาพ" : "Condition"}</th><th className="p-3">{th ? "เปลี่ยนล่าสุด" : "Last replacement"}</th><th className="p-3">{th ? "เลขไมล์" : "Odometer"}</th><th className="p-3">{th ? "สถานะบริการ" : "Service status"}</th><th className="p-3"></th></tr></thead><tbody className="divide-y divide-slate-100">{filtered.map(row => <ComponentTableRow key={row.vehicleId} row={row} language={language} onVehicle={onVehicle}/>)}</tbody></table></div>
    <div className="grid gap-2 md:hidden">{filtered.map(row => <ComponentCard key={row.vehicleId} row={row} language={language} onVehicle={onVehicle}/>)}</div>
    {!filtered.length && <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-5 text-center text-sm text-slate-600">{th ? "ไม่พบรถตามตัวกรองนี้" : "No active vehicles match these filters."}</p>}
  </section>;
}

function ComponentTableRow({ row, language, onVehicle }: { row: FleetComponentRow; language: "en" | "th"; onVehicle: (id: string, key: string) => void }) {
  const th = language === "th";
  return <tr className="align-top hover:bg-violet-50/40"><td className="p-3"><strong className="block text-slate-950">{row.registration}</strong><span className="text-xs text-slate-500">{row.driver || (th ? "ยังไม่มอบหมาย" : "Unassigned")}</span></td><td className="p-3">{componentVehicleType(row.vehicleType,language)}</td><td className="p-3">{row.latestInspection ? formatDate(row.latestInspection.check_date, language) : (th ? "ยังไม่ได้ตรวจ" : "Not yet inspected")}</td><td className="p-3"><Condition value={row.inspectionResult} language={language}/>{row.issueNotes && <p className="mt-1 max-w-48 text-xs text-amber-800">{row.issueNotes}</p>}</td><td className="p-3">{row.lastReplacement ? <><strong className="block">{formatDate(row.lastReplacement.date, language)}</strong>{row.replacementRecord&&<span className="mt-1 block max-w-52 text-xs text-slate-600">{row.replacementRecord.garage|| (th?"ไม่ระบุอู่":"Garage not specified")}{row.replacementRecord.receipt_reference?` · ${row.replacementRecord.receipt_reference}`:""}</span>}</> : (th ? "ไม่ทราบประวัติ" : "History unknown")}</td><td className="p-3 tabular-nums">{row.lastReplacement?.odometer == null ? "—" : `${row.lastReplacement.odometer.toLocaleString()} km`}</td><td className="p-3"><Status value={row.scheduleStatus} language={language}/>{row.packageScheduled&&<p className="text-[11px] text-violet-700">{language==='th'?'กำหนดพร้อมชุดน้ำมันเครื่อง':'Scheduled with oil package'}</p>}<p className="mt-1 text-xs text-slate-500">{[row.dueDate ? formatDate(row.dueDate, language) : "", row.dueKm == null ? "" : `${row.dueKm.toLocaleString()} km`].filter(Boolean).join(" · ")}</p></td><td className="p-3"><button className="min-h-9 whitespace-nowrap text-xs font-semibold text-violet-700" onClick={() => onVehicle(row.vehicleId, row.componentKey)}>{th ? "ดูรายละเอียด" : "View details"} →</button></td></tr>;
}

function ComponentCard({ row, language, onVehicle }: { row: FleetComponentRow; language: "en" | "th"; onVehicle: (id: string, key: string) => void }) {
  const th = language === "th";
  return <article className="rounded-xl border border-slate-200 p-3"><div className="flex items-start justify-between gap-2"><div><strong className="text-slate-950">{row.registration}</strong><p className="text-xs text-slate-500">{row.driver || (th ? "ยังไม่มอบหมาย" : "Unassigned")} · {componentVehicleType(row.vehicleType,language)}</p></div><Condition value={row.inspectionResult} language={language}/></div><dl className="mt-3 grid grid-cols-2 gap-2 text-xs"><div><dt className="text-slate-500">{th ? "ตรวจล่าสุด" : "Latest inspection"}</dt><dd className="mt-1 font-medium">{row.latestInspection ? formatDate(row.latestInspection.check_date, language) : (th ? "ยังไม่ได้ตรวจ" : "Not yet inspected")}</dd></div><div><dt className="text-slate-500">{th ? "เปลี่ยนล่าสุด" : "Last replacement"}</dt><dd className="mt-1 font-medium">{row.lastReplacement ? <>{formatDate(row.lastReplacement.date, language)}{row.replacementRecord&&<span className="mt-1 block text-[11px] font-normal text-slate-600">{row.replacementRecord.garage|| (th?"ไม่ระบุอู่":"Garage not specified")}</span>}</> : (th ? "ไม่ทราบประวัติ" : "History unknown")}</dd></div></dl><div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-3"><Status value={row.scheduleStatus} language={language}/><button className="min-h-9 text-xs font-semibold text-violet-700" onClick={() => onVehicle(row.vehicleId, row.componentKey)}>{th ? "รายละเอียด" : "Details"} →</button></div></article>;
}

function Condition({ value, language }: { value: FleetComponentRow["inspectionResult"]; language: "en" | "th" }) { const label = value === "ok" ? (language === "th" ? "ปกติ" : "Good") : value === "attention" ? (language === "th" ? "ต้องดูแล" : "Needs attention") : value === "not_applicable" ? (language === "th" ? "ไม่ใช้" : "Not applicable") : (language === "th" ? "ยังไม่ได้ตรวจ" : "Not yet inspected"); const tone = value === "ok" ? "bg-emerald-50 text-emerald-800" : value === "attention" ? "bg-amber-50 text-amber-900" : "bg-slate-100 text-slate-700"; return <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${tone}`}>{label}</span>; }
function Status({ value, language }: { value: FleetComponentRow["scheduleStatus"]; language: "en" | "th" }) { const tone = value === "overdue" ? "bg-rose-50 text-rose-800" : (value === "dueSoon"||value === "urgent") ? "bg-amber-50 text-amber-900" : value === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-700"; return <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${tone}`}>{scheduleText(value, language)}</span>; }
function scheduleText(value: string, language: "en" | "th") { const labels = language === "th" ? { urgent:"เร่งด่วน",overdue: "เกินกำหนด", dueSoon: "ใกล้กำหนด", ok: "ปกติ", unknown: "ต้องตรวจสอบเลขไมล์", notConfigured: "ยังไม่ได้ตั้งรอบ", condition: "ตามสภาพ", notApplicable: "ไม่ใช้" } : { overdue: "Overdue", dueSoon: "Due soon", urgent:"Urgent",ok: "No service due", unknown: "Mileage review", notConfigured: "Interval not set", condition: "Condition based", notApplicable: "Not applicable" }; return labels[value as keyof typeof labels] ?? value; }
function viewText(value: ComponentView, language: "en" | "th") { const labels = language === "th" ? { fleet: "ภาพรวมฝูงรถ", inspections: "ประวัติการตรวจ", replacements: "ประวัติการเปลี่ยน", attention: "ต้องดูแล" } : { fleet: "Fleet overview", inspections: "Inspection history", replacements: "Replacement history", attention: "Needs attention" }; return labels[value]; }
function componentExportRow(row: FleetComponentRow, component: string, language: "en" | "th") { const th = language === "th"; return { [th ? "ชิ้นส่วน" : "Component"]: component, [th ? "ทะเบียน" : "Registration"]: row.registration, [th ? "คนขับ" : "Driver"]: row.driver, [th ? "ประเภทรถ" : "Vehicle type"]: row.vehicleType, [th ? "วันที่ตรวจล่าสุด" : "Latest inspection"]: row.latestInspection?.check_date ?? "", [th ? "ผลตรวจ" : "Inspection condition"]: row.inspectionResult, [th ? "วันที่เปลี่ยนล่าสุด" : "Last confirmed replacement"]: row.lastReplacement?.date ?? (th ? "ไม่ทราบประวัติ" : "History unknown"), [th ? "เลขไมล์ตอนเปลี่ยน" : "Replacement odometer"]: row.lastReplacement?.odometer ?? "", [th ? "สถานะบริการ" : "Service status"]: scheduleText(row.scheduleStatus, language), [th ? "วันครบกำหนด" : "Due date"]: row.dueDate ?? "", [th ? "เลขไมล์ครบกำหนด" : "Due odometer"]: row.dueKm ?? "" }; }

function componentVehicleType(value:string,language:"en"|"th"){const types:Record<string,[string,string]>={FOUR_WHEEL_TRUCK:["4-wheel","4 ล้อ"],SIX_WHEEL_TRUCK:["6-wheel","6 ล้อ"],SIX_PLUS_SIX_WHEELER:["6+6-wheel","6+6 ล้อ"],EIGHTEEN_WHEELER:["18-wheel","18 ล้อ"]};return (types[value]?.[language==="th"?1:0]??value.replaceAll("_"," "))||"—";}
