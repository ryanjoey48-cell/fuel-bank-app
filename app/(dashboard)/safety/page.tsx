"use client";

import {
  Download,
  Search,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { VehicleSafetyCheck } from "@/components/vehicle-safety-check";
import { VehicleSafetyRecord } from "@/components/vehicle-safety-record";
import { SafetyReplacementPanel, type TrackedIssue } from "@/components/ees-safety-replacement-panel";
import { useLanguage } from "@/lib/language-provider";
import { supabase } from "@/lib/supabase";
import { openSafetyReport, type SafetyReportFormat, type SafetyReportVehicle } from "@/lib/ees-safety-reports";

type Vehicle = {
  id: string;
  vehicle_reg: string;
  vehicle_type: string | null;
  active: boolean;
};

type Driver = {
  id: number;
  name: string;
  vehicle_reg: string;
  vehicle_model: string | null;
  vehicle_type: string | null;
  active: boolean;
};

type SafetyInspection = {
  id: string;
  vehicle_id: string;
  driver_id: number | null;
  inspection_date: string;
  inspected_at: string;
  overall_status: "pending" | "ready" | "attention" | "not_ready";
  notes: string | null;
};

type SafetyIssue = {
  id: string;
  vehicle_id: string;
  requirement_id: string | null;
  issue_type: "missing" | "damaged" | "expired" | "incomplete" | "other";
  severity: "attention" | "critical";
  description: string | null;
  status: "open" | "in_progress" | "resolved";
  reported_at: string;
};

type InspectionItem = { inspection_id: string; requirement_id: string; status: string; notes: string | null };
type Requirement = { id: string; code: string; name_en: string; name_th: string; sort_order: number };

type VehicleSafetyStatus =
  | "ready"
  | "attention"
  | "not_ready"
  | "not_checked";

type VehicleSafetyRow = {
  vehicle: Vehicle;
  model: string | null;
  vehicleType: string | null;
  assignedDrivers: Driver[];
  primaryDriver: Driver | null;
  latestInspection: SafetyInspection | null;
  inspectionDriver: Driver | null;
  openIssues: SafetyIssue[];
  status: VehicleSafetyStatus;
};

type StatusFilter =
  | "all"
  | "ready"
  | "attention"
  | "not_ready"
  | "not_checked";

function normalizeRegistration(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s\-–—]/g, "");
}

export default function SafetyPage() {
  const { language } = useLanguage();
  const english = language === "en";

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [inspections, setInspections] = useState<SafetyInspection[]>([]);
  const [issues, setIssues] = useState<SafetyIssue[]>([]);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [inspectionItems, setInspectionItems] = useState<InspectionItem[]>([]);
  const [activeTab, setActiveTab] = useState<"overview" | "vehicles" | "equipment">("overview");
  const [equipmentFilter, setEquipmentFilter] = useState("all");

  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const [trackingIssue, setTrackingIssue] = useState<TrackedIssue | null>(null);
  const [recordRow, setRecordRow] = useState<VehicleSafetyRow | null>(null);
  const [checkRow, setCheckRow] = useState<VehicleSafetyRow | null>(null);

  const load = useCallback(async () => {
    setBusy(true);

    try {
      const [
        vehiclesResult,
        driversResult,
        inspectionsResult,
        issuesResult,
        requirementsResult,
        itemsResult
      ] = await Promise.all([
        supabase
          .from("vehicles")
          .select("id, vehicle_reg, vehicle_type, active")
          .eq("active", true)
          .order("vehicle_reg"),

        supabase
          .from("drivers")
          .select("id, name, vehicle_reg, vehicle_model, vehicle_type, active")
          .eq("active", true)
          .order("name"),

        supabase
          .from("vehicle_safety_inspections")
          .select(
            "id, vehicle_id, driver_id, inspection_date, inspected_at, overall_status, notes"
          )
          .order("inspected_at", { ascending: false }),

        supabase
          .from("vehicle_safety_issues")
          .select(
            "id, vehicle_id, requirement_id, issue_type, severity, description, status, reported_at"
          )
          .in("status", ["open", "in_progress"])
          .order("reported_at", { ascending: false }),
        supabase.from("vehicle_safety_requirements")
          .select("id, code, name_en, name_th, sort_order")
          .order("sort_order"),
        supabase.from("vehicle_safety_inspection_items")
          .select("inspection_id, requirement_id, status, notes")
      ]);

      if (vehiclesResult.error) throw vehiclesResult.error;
      if (driversResult.error) throw driversResult.error;
      if (inspectionsResult.error) throw inspectionsResult.error;
      if (issuesResult.error) throw issuesResult.error;
      if (requirementsResult.error) throw requirementsResult.error;
      if (itemsResult.error) throw itemsResult.error;

      setVehicles((vehiclesResult.data ?? []) as Vehicle[]);
      setDrivers((driversResult.data ?? []) as Driver[]);
      setInspections((inspectionsResult.data ?? []) as SafetyInspection[]);
      setIssues((issuesResult.data ?? []) as SafetyIssue[]);
      setRequirements((requirementsResult.data ?? []) as Requirement[]);
      setInspectionItems((itemsResult.data ?? []) as InspectionItem[]);
      setError(null);
    } catch (caught) {
      console.error("Vehicle safety load failed", caught);
      setError(
        caught instanceof Error
          ? caught.message
          : english
            ? "Unable to load vehicle safety data."
            : "ไม่สามารถโหลดข้อมูลความปลอดภัยของรถได้"
      );
    } finally {
      setBusy(false);
    }
  }, [english]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo<VehicleSafetyRow[]>(() => {
    const driversById = new Map(drivers.map((driver) => [driver.id, driver]));
    const driversByReg = new Map<string, Driver[]>();

    for (const driver of drivers) {
      const key = normalizeRegistration(driver.vehicle_reg);
      if (!key) continue;
      const list = driversByReg.get(key) ?? [];
      list.push(driver);
      driversByReg.set(key, list);
    }

    const latestInspectionByVehicle = new Map<string, SafetyInspection>();
    for (const inspection of inspections) {
      if (!latestInspectionByVehicle.has(inspection.vehicle_id)) {
        latestInspectionByVehicle.set(inspection.vehicle_id, inspection);
      }
    }

    const issuesByVehicle = new Map<string, SafetyIssue[]>();
    for (const issue of issues) {
      const list = issuesByVehicle.get(issue.vehicle_id) ?? [];
      list.push(issue);
      issuesByVehicle.set(issue.vehicle_id, list);
    }

    const uniqueVehicles = new Map<string, Vehicle>();
    for (const vehicle of vehicles) {
      const key = normalizeRegistration(vehicle.vehicle_reg);
      if (!key) continue;
      if (!uniqueVehicles.has(key)) uniqueVehicles.set(key, vehicle);
    }

    return Array.from(uniqueVehicles.entries()).map(([regKey, vehicle]) => {
      const assignedDrivers = driversByReg.get(regKey) ?? [];
      const primaryDriver = assignedDrivers[0] ?? null;

      const model =
        assignedDrivers.find((driver) => driver.vehicle_model?.trim())
          ?.vehicle_model?.trim() ?? null;

      const vehicleType =
        assignedDrivers.find((driver) => driver.vehicle_type)?.vehicle_type ??
        vehicle.vehicle_type ??
        null;

      const latestInspection =
        latestInspectionByVehicle.get(vehicle.id) ?? null;

      const openIssues = issuesByVehicle.get(vehicle.id) ?? [];

      const inspectionDriver =
        latestInspection?.driver_id != null
          ? driversById.get(latestInspection.driver_id) ?? null
          : null;

      let status: VehicleSafetyStatus = "not_checked";

      if (openIssues.some((issue) => issue.severity === "critical")) {
        status = "not_ready";
      } else if (openIssues.some((issue) => issue.severity === "attention")) {
        status = "attention";
      } else if (latestInspection?.overall_status === "ready") {
        status = "ready";
      } else if (latestInspection?.overall_status === "attention") {
        status = "attention";
      } else if (latestInspection?.overall_status === "not_ready") {
        status = "not_ready";
      }

      return {
        vehicle,
        model,
        vehicleType,
        assignedDrivers,
        primaryDriver,
        latestInspection,
        inspectionDriver,
        openIssues,
        status
      };
    });
  }, [vehicles, drivers, inspections, issues]);

  const requirementsById = useMemo(() => new Map(requirements.map(r => [r.id, r])), [requirements]);
  const emojiByCode: Record<string,string> = {
    fire_extinguisher: "🧯", wheel_chock: "🛑", traffic_cone: "🚧", cargo_straps: "🔗",
    spare_tyre: "🛞", reflective_vest: "🦺", safety_helmet: "⛑️", safety_shoes: "🥾", safety_goggles: "🥽"
  };
  const latestInspections = useMemo(() => {
    const map = new Map<string, SafetyInspection>();
    for (const item of inspections) if (!map.has(item.vehicle_id)) map.set(item.vehicle_id,item);
    return map;
  },[inspections]);
  const issueInfo = (issue: SafetyIssue) => {
    let requirementId = issue.requirement_id;
    if (!requirementId) {
      const inspection = latestInspections.get(issue.vehicle_id);
      const candidates = inspectionItems.filter(item =>
        item.inspection_id === inspection?.id && item.status === issue.issue_type &&
        (item.notes ?? "").trim() === (issue.description ?? "").trim()
      );
      // Only infer equipment when exactly one checklist item matches the recorded condition and note.
      if (candidates.length === 1) requirementId = candidates[0].requirement_id;
    }
    const r = requirementId ? requirementsById.get(requirementId) : undefined;
    return { name: r ? (english ? r.name_en : r.name_th) : (english ? "Safety item – check record" : "อุปกรณ์ความปลอดภัย – ตรวจบันทึก"), emoji: r ? (emojiByCode[r.code] ?? "⚠️") : "⚠️", code: r?.id ?? "unknown" };
  };
  const summary = {
    total: rows.length,
    ready: rows.filter(r => r.status === "ready").length,
    attention: rows.filter(r => r.status === "attention").length,
    notReady: rows.filter(r => r.status === "not_ready").length,
    notChecked: rows.filter(r => r.status === "not_checked").length
  };
  const actionRows = rows.filter(r => r.openIssues.length > 0).sort((a,b) => b.openIssues.length - a.openIssues.length);
  const equipmentSummary = Array.from(rows.flatMap(row => row.openIssues).reduce((map, issue) => {
    const info = issueInfo(issue);
    const old = map.get(info.code);
    map.set(info.code, { name:info.name, emoji:info.emoji, id:info.code, count:(old?.count ?? 0)+1 });
    return map;
  },new Map<string,{name:string;emoji:string;id:string;count:number}>()).values()).sort((a,b)=>b.count-a.count);
  const filteredRows = rows.filter(row => {
    if (statusFilter !== "all" && row.status !== statusFilter) return false;
    if (equipmentFilter !== "all" && !row.openIssues.some(i => issueInfo(i).code === equipmentFilter)) return false;
    const q = search.trim().toLowerCase();
    return !q || [row.vehicle.vehicle_reg,row.model ?? "",row.vehicleType ?? "",...row.assignedDrivers.map(d=>d.name),...row.openIssues.map(i=>issueInfo(i).name),...row.openIssues.map(i=>i.description ?? "")].join(" ").toLowerCase().includes(q);
  }).sort((a,b)=>{
    const priority = {not_ready:0, attention:1, not_checked:2, ready:3};
    return priority[a.status]-priority[b.status] || a.vehicle.vehicle_reg.localeCompare(b.vehicle.vehicle_reg);
  });
  const visibleRows = activeTab === "equipment" ? filteredRows.filter(row => row.openIssues.length > 0) : filteredRows;
  const resetFilters = () => { setSearch(""); setStatusFilter("all"); setEquipmentFilter("all"); };
  const chooseTab = (tab: "overview" | "vehicles" | "equipment") => { setActiveTab(tab); resetFilters(); };
  const statusLabel = (status:VehicleSafetyStatus) => ({
    ready: english ? "Ready" : "พร้อมใช้งาน",
    attention: english ? "Attention" : "ต้องตรวจสอบ",
    not_ready: english ? "Not ready" : "ไม่พร้อมใช้งาน",
    not_checked: english ? "Not checked" : "ยังไม่ได้ตรวจ"
  })[status];
  const assignedDriverLabel = (row:VehicleSafetyRow) => row.assignedDrivers.map(d=>d.name).join(", ") || "—";
  const formatInspectionDate = (value:string|null|undefined) => {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat(english ? "en-GB" : "th-TH",{day:"2-digit",month:"short",year:"numeric"}).format(date);
  };
  const openRow = (row:VehicleSafetyRow) => row.latestInspection ? setRecordRow(row) : setCheckRow(row);
  const exportCsv = () => {
    const entries = actionRows.flatMap(row => row.openIssues.map(issue => [row.vehicle.vehicle_reg,assignedDriverLabel(row),issueInfo(issue).name,issue.issue_type,issue.description ?? "",issue.status,issue.reported_at]));
    const csv = [["Registration","Driver","Equipment","Issue","Notes","Status","Reported"],...entries].map(line => line.map(value=>'"'+String(value).replaceAll('"','""')+'"').join(",")).join("\r\n");
    const blob = new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8"});
    const url = URL.createObjectURL(blob);
    const a=document.createElement("a"); a.href=url; a.download="ees-safety-open-issues.csv"; a.click();
    URL.revokeObjectURL(url);
  };
  const exportSafetyPdf = (format: SafetyReportFormat) => {
    if (busy || error) return;
    const exportRows: SafetyReportVehicle[] = rows.map(row => ({
      registration: row.vehicle.vehicle_reg,
      driver: assignedDriverLabel(row),
      model: row.model || row.vehicleType || "—",
      status: row.status,
      inspectedAt: row.latestInspection?.inspected_at ?? null,
      issues: row.openIssues.map(issue => {
        const info = issueInfo(issue);
        let requirementId = issue.requirement_id;
        if (!requirementId) {
          const inspection = latestInspections.get(issue.vehicle_id);
          const matches = inspectionItems.filter(item =>
            item.inspection_id === inspection?.id && item.status === issue.issue_type &&
            (item.notes ?? "").trim() === (issue.description ?? "").trim()
          );
          if (matches.length === 1) requirementId = matches[0].requirement_id;
        }
        const requirement = requirementId ? requirementsById.get(requirementId) : undefined;
        return {
          id: issue.id,
          nameEn: requirement?.name_en ?? "Safety item - check record",
          nameTh: requirement?.name_th ?? "อุปกรณ์ความปลอดภัย - ตรวจบันทึก",
          icon: info.emoji,
          type: issue.issue_type,
          notes: issue.description ?? "",
          reportedAt: issue.reported_at
        };
      })
    }));
    void openSafetyReport(format, { vehicles: exportRows });
  };
  const labelIssue = (issue:SafetyIssue) => issue.issue_type === "missing" ? (english ? "Missing" : "ไม่มี") : issue.issue_type === "damaged" ? (english ? "Damaged" : "ชำรุด") : issue.issue_type;
  const issueLine = (issue:SafetyIssue) => {
    const info=issueInfo(issue);
    return <div key={issue.id} className="flex items-start gap-2 py-1.5">
      <span aria-hidden="true" className="text-lg leading-6">{info.emoji}</span>
      <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-semibold text-slate-900">{info.name}</span><span className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${issue.issue_type === "missing" ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700"}`}>{labelIssue(issue)}</span></div>
      {issue.description ? <p className="mt-0.5 text-xs leading-5 text-slate-500">{issue.description}</p> : null}</div></div>;
  };
  const manageIssue = (row: VehicleSafetyRow, issue: SafetyIssue) => {
    const info = issueInfo(issue);
    setTrackingIssue({ id: issue.id, equipment: info.name, emoji: info.emoji,
      registration: row.vehicle.vehicle_reg, driver: assignedDriverLabel(row),
      problem: labelIssue(issue), originalNote: issue.description });
  };
  const nav = [{id:"overview",en:"Overview",th:"ภาพรวม"},{id:"vehicles",en:"All vehicles",th:"รถทั้งหมด"},{id:"equipment",en:"Equipment issues",th:"ปัญหาอุปกรณ์"}] as const;

  return <div className="maintenance-shell -m-3 min-h-full space-y-4 p-3 sm:-m-4 sm:p-4 lg:-m-5 lg:p-5">
    <section className="surface-card flex flex-col gap-4 p-5 sm:p-6 lg:flex-row lg:items-center lg:justify-between">
      <div><p className="text-[11px] font-bold uppercase tracking-[.15em] text-violet-500">EXPERT EXPRESS SENDER CO., LTD.</p>
        <h1 className="mt-1 text-2xl font-semibold text-slate-950">{english ? "Vehicle Safety" : "ความปลอดภัยของรถ"}</h1>
        <p className="mt-1 text-sm text-slate-500">{english ? "Know who's ready, what's missing and what needs replacing." : "ดูรถที่พร้อมใช้งาน อุปกรณ์ที่ขาด และรายการที่ต้องเปลี่ยน"}</p></div>
      <div className="flex flex-wrap items-center gap-2"><div className="flex flex-wrap rounded-2xl border border-violet-100 bg-violet-50/70 p-1">
        {nav.map(n=><button key={n.id} type="button" onClick={()=>chooseTab(n.id)} className={`rounded-xl px-3 py-2.5 text-sm font-medium transition ${activeTab===n.id ? "bg-white text-violet-700 shadow-sm" : "text-slate-500 hover:text-slate-900"}`}>{english ? n.en : n.th}</button>)}
      </div><button type="button" onClick={()=>void load()} disabled={busy} className="btn-secondary min-h-10"><RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`}/>{english ? "Refresh" : "รีเฟรช"}</button></div>
    </section>
    {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div> : null}
    <section className="maintenance-panel space-y-5 p-4 sm:p-6">
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {([
          {key:"total",val:summary.total,title:english?"Total fleet":"รถทั้งหมด",subtitle:english?"Active vehicles":"รถที่ใช้งาน",color:"text-slate-900",tab:"vehicles",status:"all"},
          {key:"ready",val:summary.ready,title:english?"Ready":"พร้อมใช้งาน",subtitle:english?"Safety checks cleared":"ผ่านการตรวจ",color:"text-emerald-700",tab:"vehicles",status:"ready"},
          {key:"action",val:summary.attention+summary.notReady,title:english?"Needs action":"ต้องดำเนินการ",subtitle:english?"Equipment requires attention":"มีปัญหาอุปกรณ์",color:"text-rose-700",tab:"equipment",status:"all"},
          {key:"unchecked",val:summary.notChecked,title:english?"Not checked":"ยังไม่ได้ตรวจ",subtitle:english?"Awaiting inspection":"รอการตรวจ",color:"text-amber-700",tab:"vehicles",status:"not_checked"}
        ] as const).map(card=><button key={card.key} type="button" onClick={()=>{setActiveTab(card.tab);setStatusFilter(card.status);setEquipmentFilter("all");setSearch("");}} className="group rounded-2xl border border-[#eae4dc] bg-[#fffdf9] px-4 py-3.5 text-left transition hover:border-violet-300 hover:shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500">
          <p className="text-xs font-medium text-slate-500">{card.title}</p>
          <div className="mt-1 flex items-end justify-between gap-2"><span className={`text-[29px] font-semibold leading-none tracking-tight tabular-nums ${card.color}`}>{busy?"—":card.val}</span><span className="text-xs text-slate-400 transition group-hover:text-violet-600">↗</span></div>
          <p className="mt-2 text-[11px] text-slate-400">{card.subtitle}</p>
        </button>)}
      </div>
      {error ? <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</p> : null}
      {busy ? <div className="py-14 text-center text-sm text-slate-500">{english?"Loading safety records…":"กำลังโหลดข้อมูลการตรวจ…"}</div> : <>
        {(activeTab === "overview" || activeTab === "equipment") && <section className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div><h2 className="text-base font-semibold tracking-tight text-slate-900">{english?"Equipment requiring action":"อุปกรณ์ที่ต้องดำเนินการ"}</h2><p className="mt-0.5 text-xs text-slate-500">{english?"Select an item to see the affected vehicles":"เลือกอุปกรณ์เพื่อดูรถที่มีปัญหา"}</p></div>
            <div className="flex flex-wrap items-center gap-2"><button type="button" onClick={() => exportSafetyPdf("summary")} disabled={busy || !!error} className="inline-flex min-h-9 items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-3 text-xs font-semibold text-violet-700 transition hover:bg-violet-100 disabled:opacity-50"><Download className="h-3.5 w-3.5"/>{english ? "Summary PDF" : "PDF สรุป"}</button><button type="button" onClick={() => exportSafetyPdf("detailed")} disabled={busy || !!error} className="inline-flex min-h-9 items-center gap-2 rounded-xl border border-[#e8e1d7] bg-white px-3 text-xs font-medium text-slate-700 hover:border-violet-300 disabled:opacity-50"><Download className="h-3.5 w-3.5"/>{english ? "Detailed PDF" : "PDF รายละเอียด"}</button><button type="button" onClick={exportCsv} disabled={!actionRows.length} className="inline-flex min-h-9 items-center gap-2 rounded-xl border border-[#e8e1d7] bg-white px-3 text-xs font-medium text-slate-600 transition hover:border-violet-300 disabled:opacity-50"><Download className="h-3.5 w-3.5"/>{english?"Export issues":"ส่งออกรายการ"}</button></div>
          </div>
          {equipmentSummary.length ? <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">{equipmentSummary.map(item=><button key={item.id} type="button" onClick={()=>{setEquipmentFilter(item.id);setSearch("");setStatusFilter("all");setActiveTab("equipment");}} className={`group flex items-center gap-3 rounded-xl border px-3 py-3 text-left transition hover:border-violet-300 hover:bg-white ${equipmentFilter===item.id&&activeTab==="equipment"?"border-violet-400 bg-violet-50":"border-[#ebe5db] bg-[#fffdfa]"}`}><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#f6f1e9] text-xl" aria-hidden="true">{item.emoji}</span><span className="min-w-0 flex-1"><span className="block text-xs font-medium leading-4 text-slate-800">{item.name}</span><span className="mt-0.5 block text-[11px] text-slate-400">{english?"Open items":"รายการที่ยังไม่แก้ไข"}</span></span><span className="text-xl font-semibold tabular-nums text-rose-700">{item.count}</span></button>)}</div> : <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{english?"No outstanding equipment issues.":"ไม่มีปัญหาอุปกรณ์ที่ยังไม่แก้ไข"}</p>}
        </section>}
        {activeTab==="overview" && <section className="space-y-3">
          <div className="flex items-end justify-between gap-3 border-b border-[#eee8df] pb-2"><div><h2 className="text-base font-semibold text-slate-900">{english?"Vehicles needing attention":"รถที่ต้องดำเนินการ"}</h2><p className="mt-0.5 text-xs text-slate-500">{english?`${actionRows.length} vehicles · ${actionRows.reduce((sum,row)=>sum+row.openIssues.length,0)} equipment issues`:`${actionRows.length} คัน · ${actionRows.reduce((sum,row)=>sum+row.openIssues.length,0)} รายการ`}</p></div><button type="button" onClick={()=>chooseTab("equipment")} className="whitespace-nowrap text-xs font-semibold text-violet-700 hover:text-violet-900">{english?"View issues →":"ดูปัญหา →"}</button></div>
          <div className="divide-y divide-[#ede7df] overflow-hidden rounded-2xl border border-[#ede7df] bg-[#fffdfa]">{actionRows.length?actionRows.map(row=><div key={row.vehicle.id} className="grid items-center gap-2 px-3 py-3 transition hover:bg-white sm:grid-cols-[minmax(165px,.8fr)_minmax(0,1.7fr)_auto] sm:gap-4 sm:px-4"><div className="min-w-0"><p className="text-sm font-semibold text-slate-900">{assignedDriverLabel(row)}</p><p className="mt-0.5 text-xs font-medium text-slate-500">{row.vehicle.vehicle_reg}</p><p className="truncate text-[11px] text-slate-400">{row.model||row.vehicleType||"—"}</p></div><div className="flex flex-wrap gap-1.5">{row.openIssues.map(issue=>{const info=issueInfo(issue);return <span key={issue.id} title={issue.description||""} className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-rose-100 bg-rose-50/70 px-2.5 py-1.5 text-xs font-medium text-rose-800"><span aria-hidden="true">{info.emoji}</span><span className="truncate">{info.name}</span><span className="text-[10px] font-normal opacity-70">{labelIssue(issue)}</span></span>})}<button type="button" onClick={() => { setActiveTab("equipment"); setStatusFilter("all"); setEquipmentFilter("all"); setSearch(row.vehicle.vehicle_reg); }} className="text-xs font-semibold text-violet-700 hover:underline">{english ? "Manage items →" : "จัดการอุปกรณ์ →"}</button></div><button type="button" onClick={()=>openRow(row)} className="min-h-9 justify-self-start whitespace-nowrap rounded-lg border border-[#e8e1d8] bg-white px-3 text-xs font-semibold text-slate-700 transition hover:border-violet-300 hover:text-violet-700">{english?"View details →":"ดูรายละเอียด →"}</button></div>):<p className="p-4 text-sm text-slate-500">{english?"No vehicles require action.":"ไม่มีรถที่ต้องดำเนินการ"}</p>}</div>
          {summary.notChecked>0&&<button type="button" onClick={()=>{chooseTab("vehicles");setStatusFilter("not_checked");}} className="inline-flex items-center gap-2 text-xs font-medium text-amber-800 hover:underline">{english?`◷ ${summary.notChecked} vehicles still need an inspection →`:`◷ รถอีก ${summary.notChecked} คันรอการตรวจ →`}</button>}
        </section>}
        {activeTab!=="overview"&&<section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-base font-semibold text-slate-900">{activeTab==="vehicles"?(english?"Fleet register":"ทะเบียนรถ"):(english?"Open equipment issues":"ปัญหาอุปกรณ์ที่ยังไม่แก้ไข")}</h2><p className="mt-0.5 text-xs text-slate-500">{english?`${visibleRows.length} of ${activeTab==="equipment"?actionRows.length:rows.length} vehicles shown`:`แสดง ${visibleRows.length} จาก ${activeTab==="equipment"?actionRows.length:rows.length} คัน`}</p></div><button type="button" onClick={resetFilters} className="rounded-lg border border-[#e8e1d8] bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:text-violet-700">{english?"Clear filters":"ล้างตัวกรอง"}</button></div>
          <div className="grid gap-2 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)]"><label className="relative"><span className="sr-only">{english?"Search":"ค้นหา"}</span><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400"/><input className="form-input pl-9" placeholder={english?"Search driver, registration or equipment":"ค้นหาคนขับ ทะเบียน หรืออุปกรณ์"} value={search} onChange={e=>setSearch(e.target.value)}/></label><label><span className="sr-only">{english?"Filter by status":"กรองตามสถานะ"}</span><select className="form-input" value={statusFilter} onChange={e=>setStatusFilter(e.target.value as StatusFilter)}><option value="all">{english?"All statuses":"ทุกสถานะ"}</option><option value="ready">{english?"Ready":"พร้อมใช้งาน"}</option><option value="attention">{english?"Attention":"ต้องตรวจสอบ"}</option><option value="not_ready">{english?"Not ready":"ไม่พร้อมใช้งาน"}</option><option value="not_checked">{english?"Not checked":"ยังไม่ได้ตรวจ"}</option></select></label><label><span className="sr-only">{english?"Filter by equipment":"กรองตามอุปกรณ์"}</span><select className="form-input" value={equipmentFilter} onChange={e=>setEquipmentFilter(e.target.value)}><option value="all">{english?"All equipment":"อุปกรณ์ทั้งหมด"}</option>{equipmentSummary.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div>
          <div className="divide-y divide-[#ede7df] overflow-hidden rounded-2xl border border-[#ede7df] bg-[#fffdfa]">{visibleRows.length?visibleRows.map(row=><div key={row.vehicle.id} className="grid items-center gap-2 px-3 py-3 transition hover:bg-white sm:px-4 lg:grid-cols-[minmax(150px,.8fr)_minmax(0,1.5fr)_110px_auto] lg:gap-4"><div className="min-w-0"><p className="text-sm font-semibold text-slate-900">{row.vehicle.vehicle_reg}</p><p className="truncate text-xs text-slate-500">{assignedDriverLabel(row)}</p><p className="truncate text-[11px] text-slate-400">{row.model||row.vehicleType||"—"}</p></div><div className="flex flex-wrap gap-1.5">{row.openIssues.length?row.openIssues.filter(issue=>equipmentFilter==="all"||issueInfo(issue).code===equipmentFilter).map(issue=>{const info=issueInfo(issue);return <span key={issue.id} title={issue.description||""} className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-rose-100 bg-rose-50/70 px-2.5 py-1 text-xs font-medium text-rose-800"><span>{info.emoji}</span><span className="truncate">{info.name}</span><span className="text-[10px] opacity-75">{labelIssue(issue)}</span></span>}):<span className="text-xs text-slate-400">{row.status==="not_checked"?(english?"Inspection pending":"รอการตรวจ"):(english?"No open issues":"ไม่มีปัญหา")}</span>}{activeTab === "equipment" && row.openIssues.filter(issue => equipmentFilter === "all" || issueInfo(issue).code === equipmentFilter).map(issue => <button key={`manage-${issue.id}`} type="button" onClick={() => manageIssue(row, issue)} className="rounded-lg border border-violet-200 bg-white px-2 py-1 text-xs font-semibold text-violet-700 hover:bg-violet-50">{english ? `Manage ${issueInfo(issue).name} →` : `จัดการ ${issueInfo(issue).name} →`}</button>)}</div><div><StatusBadge status={row.status} label={statusLabel(row.status)}/><p className="mt-1 text-[10px] text-slate-400">{formatInspectionDate(row.latestInspection?.inspected_at)}</p></div><button type="button" onClick={()=>openRow(row)} className="min-h-9 justify-self-start whitespace-nowrap rounded-lg border border-[#e8e1d8] bg-white px-3 text-xs font-semibold text-slate-700 transition hover:border-violet-300 hover:text-violet-700">{row.latestInspection?(english?"View record →":"ดูบันทึก →"):(english?"Check vehicle →":"ตรวจรถ →")}</button></div>):<p className="p-5 text-sm text-slate-500">{english?"No vehicles match these filters.":"ไม่พบรถตามตัวกรอง"}</p>}</div>
        </section>}
      </>}
    </section>
      {trackingIssue ? <SafetyReplacementPanel issue={trackingIssue} onClose={() => setTrackingIssue(null)} onChange={() => void load()} /> : null}
      {recordRow?.latestInspection ? (
        <VehicleSafetyRecord
          vehicle={{
            id: recordRow.vehicle.id,
            vehicle_reg: recordRow.vehicle.vehicle_reg,
            vehicle_model: recordRow.model,
            vehicle_type: recordRow.vehicleType
          }}
          inspection={recordRow.latestInspection}
          drivers={drivers}
          onClose={() => setRecordRow(null)}
          onNewCheck={() => {
            const row = recordRow;
            setRecordRow(null);
            setCheckRow(row);
          }}
          onUpdated={() => void load()}
        />
      ) : null}

      {checkRow ? (
        <VehicleSafetyCheck
          vehicle={{
            id: checkRow.vehicle.id,
            vehicle_reg: checkRow.vehicle.vehicle_reg,
            vehicle_model: checkRow.model,
            vehicle_type: checkRow.vehicleType
          }}
          drivers={drivers}
          assignedDriverId={checkRow.primaryDriver?.id ?? null}
          onClose={() => setCheckRow(null)}
          onSaved={() => {
            setCheckRow(null);
            void load();
          }}
        />
      ) : null}
    </div>
  ;
}

function StatusBadge({
  status,
  label
}: {
  status: VehicleSafetyStatus;
  label: string;
}) {
  const styles: Record<VehicleSafetyStatus, string> = {
    ready: "border-emerald-200 bg-emerald-50 text-emerald-700",
    attention: "border-amber-200 bg-amber-50 text-amber-700",
    not_ready: "border-rose-200 bg-rose-50 text-rose-700",
    not_checked: "border-slate-200 bg-slate-100 text-slate-600"
  };

  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold ${styles[status]}`}
    >
      {label}
    </span>
  );
}

