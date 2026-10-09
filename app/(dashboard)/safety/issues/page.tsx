"use client";

import {
  ClipboardCheck,
  Download,
  FilterX,
  Eye,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
  Truck,
  XCircle
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { VehicleSafetyCheck } from "@/components/vehicle-safety-check";
import { VehicleSafetyRecord } from "@/components/vehicle-safety-record";
import { useLanguage } from "@/lib/language-provider";
import { supabase } from "@/lib/supabase";

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

type SafetyRequirement = {
  id: string;
  code: string;
  name_en: string;
  name_th: string;
};

const equipmentEmoji: Record<string, string> = {
  fire_extinguisher: "🧯", wheel_chock: "🛑", traffic_cone: "🚧",
  cargo_straps: "🔗", spare_tyre: "🛞", reflective_vest: "🦺",
  safety_helmet: "⛑️", safety_shoes: "🥾", safety_goggles: "🥽"
};

type SafetyIssue = {
  id: string;
  requirement_id: string | null;
  vehicle_id: string;
  issue_type: "missing" | "damaged" | "expired" | "incomplete" | "other";
  severity: "attention" | "critical";
  description: string | null;
  status: "open" | "in_progress" | "resolved";
  reported_at: string;
};

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
  const [requirements, setRequirements] = useState<SafetyRequirement[]>([]);

  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [issueFilter, setIssueFilter] = useState("all");
  const [vehicleTypeFilter, setVehicleTypeFilter] = useState("all");
  const [onlyWithIssues, setOnlyWithIssues] = useState(false);
  const [activeTab, setActiveTab] = useState<"overview" | "vehicles">("overview");

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
        requirementsResult
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
        supabase.from("vehicle_safety_requirements").select("id, code, name_en, name_th")
      ]);

      if (vehiclesResult.error) throw vehiclesResult.error;
      if (driversResult.error) throw driversResult.error;
      if (inspectionsResult.error) throw inspectionsResult.error;
      if (issuesResult.error) throw issuesResult.error;
      if (requirementsResult.error) throw requirementsResult.error;

      setVehicles((vehiclesResult.data ?? []) as Vehicle[]);
      setDrivers((driversResult.data ?? []) as Driver[]);
      setInspections((inspectionsResult.data ?? []) as SafetyInspection[]);
      setIssues((issuesResult.data ?? []) as SafetyIssue[]);
      setRequirements((requirementsResult.data ?? []) as SafetyRequirement[]);
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
      } else if (openIssues.length > 0) {
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

  const summary = useMemo(
    () => ({
      total: rows.length,
      ready: rows.filter((row) => row.status === "ready").length,
      attention: rows.filter((row) => row.status === "attention").length,
      notReady: rows.filter((row) => row.status === "not_ready").length,
      notChecked: rows.filter((row) => row.status === "not_checked").length
    }),
    [rows]
  );

  const issueCategories = useMemo(() => {
    const categories = new Set<string>();
    for (const row of rows) for (const issue of row.openIssues) categories.add(issue.issue_type);
    return Array.from(categories).sort();
  }, [rows]);

  const vehicleTypes = useMemo(() =>
    Array.from(new Set(rows.map((row) => row.vehicleType).filter((value): value is string => Boolean(value)))).sort(),
    [rows]
  );

  const priority = (status: VehicleSafetyStatus) =>
    ({ not_ready: 0, attention: 1, not_checked: 2, ready: 3 })[status];

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (statusFilter !== "all" && row.status !== statusFilter) return false;
      if (vehicleTypeFilter !== "all" && row.vehicleType !== vehicleTypeFilter) return false;
      if (onlyWithIssues && row.openIssues.length === 0) return false;
      if (issueFilter !== "all" && !row.openIssues.some((issue) => issue.issue_type === issueFilter)) return false;
      if (!term) return true;
      return [
        row.vehicle.vehicle_reg, row.model ?? "", row.vehicleType ?? "",
        row.assignedDrivers.map((driver) => driver.name).join(" "),
        ...row.openIssues.map((issue) => issue.description ?? ""),
        ...row.openIssues.map((issue) => {
          const requirement = issue.requirement_id ? requirements.find((item) => item.id === issue.requirement_id) : null;
          return requirement ? `${requirement.name_en} ${requirement.name_th}` : "";
        }),
        ...row.openIssues.map((issue) => issue.issue_type)
      ].join(" ").toLowerCase().includes(term);
    }).sort((a, b) => priority(a.status) - priority(b.status) ||
      a.vehicle.vehicle_reg.localeCompare(b.vehicle.vehicle_reg));
  }, [rows, search, statusFilter, vehicleTypeFilter, onlyWithIssues, issueFilter, requirements]);

  const actionRows = useMemo(() => rows
    .filter((row) => row.openIssues.length > 0)
    .sort((a, b) => priority(a.status) - priority(b.status) ||
      a.vehicle.vehicle_reg.localeCompare(b.vehicle.vehicle_reg)), [rows]);

  const outstandingCount = useMemo(() => actionRows.reduce((sum, row) => sum + row.openIssues.length, 0), [actionRows]);

  const requirementById = useMemo(() => new Map(requirements.map((item) => [item.id, item])), [requirements]);

  const issueName = (issue: SafetyIssue) => {
    const requirement = issue.requirement_id ? requirementById.get(issue.requirement_id) : null;
    return requirement ? (english ? requirement.name_en : requirement.name_th) : (english ? "Unspecified safety equipment" : "ไม่ได้ระบุอุปกรณ์ความปลอดภัย");
  };

  const issueTypeLabel = (type: SafetyIssue["issue_type"]) => {
    const labels: Record<SafetyIssue["issue_type"], [string, string]> = {
      missing: ["Missing", "สูญหาย"], damaged: ["Damaged", "ชำรุด"],
      expired: ["Expired", "หมดอายุ"], incomplete: ["Incomplete", "ไม่ครบ"],
      other: ["Other", "อื่น ๆ"]
    };
    return labels[type][english ? 0 : 1];
  };

  const exportIssues = () => {
    const header = ["Registration", "Driver", "Vehicle type", "Equipment / issue description", "Issue type", "Severity", "Progress", "Reported at"];
    const data = filteredRows.flatMap((row) => row.openIssues.map((issue) => [
      row.vehicle.vehicle_reg, assignedDriverLabel(row), row.vehicleType ?? "", issueName(issue),
      issue.issue_type, issue.severity, issue.status, issue.reported_at
    ]));
    const escapeCsv = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const csv = [header, ...data].map((columns) => columns.map(escapeCsv).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "ees-outstanding-safety-issues.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const statusLabel = (status: VehicleSafetyStatus) => {
    if (status === "ready") return english ? "Ready" : "พร้อมใช้งาน";
    if (status === "attention") return english ? "Attention" : "ต้องตรวจสอบ";
    if (status === "not_ready") return english ? "Not ready" : "ไม่พร้อมใช้งาน";
    return english ? "Not checked yet" : "ยังไม่ได้ตรวจ";
  };

  const formatInspectionDate = (value: string | null | undefined) => {
    if (!value) return "—";

    try {
      return new Intl.DateTimeFormat(english ? "en-GB" : "th-TH", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      }).format(new Date(value));
    } catch {
      return value;
    }
  };

  const assignedDriverLabel = (row: VehicleSafetyRow) => {
    if (row.assignedDrivers.length === 0) return "—";
    if (row.assignedDrivers.length === 1) return row.assignedDrivers[0].name;
    return `${row.assignedDrivers[0].name} +${row.assignedDrivers.length - 1}`;
  };

  const openRow = (row: VehicleSafetyRow) => {
    if (row.latestInspection) {
      setRecordRow(row);
      return;
    }

    setCheckRow(row);
  };

  const displayedRows = activeTab === "overview"
    ? filteredRows.filter((row) => row.status === "not_ready" || row.status === "attention")
    : filteredRows;

  const issueDescription = (issue: SafetyIssue) => {
    const description = issue.description?.trim() ?? "";
    const requirement = issue.requirement_id ? requirementById.get(issue.requirement_id) : null;
    return {
      item: issueName(issue),
      emoji: requirement ? equipmentEmoji[requirement.code] ?? "⚠️" : "⚠️",
      note: description || null
    };
  };

  return (
    <div className="maintenance-shell -m-3 min-h-full space-y-3 p-3 sm:-m-4 sm:p-4 lg:-m-5 lg:p-5">
      <section className="surface-card flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.16em] text-violet-500">EXPERT EXPRESS SENDER CO., LTD.</p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-950">{english ? "Vehicle Safety" : "ความปลอดภัยของรถ"}</h1>
          <p className="mt-1 text-xs text-slate-500">{english ? "See who needs equipment and which vehicles are ready." : "ดูอุปกรณ์ที่ขาดและสถานะความพร้อมของรถ"}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setActiveTab("overview")}
            className={`rounded-xl px-4 py-2 text-sm font-semibold ${activeTab === "overview" ? "bg-violet-700 text-white" : "bg-violet-50 text-violet-700"}`}>
            {english ? "Overview" : "ภาพรวม"}
          </button>
          <button type="button" onClick={() => setActiveTab("vehicles")}
            className={`rounded-xl px-4 py-2 text-sm font-semibold ${activeTab === "vehicles" ? "bg-violet-700 text-white" : "bg-violet-50 text-violet-700"}`}>
            {english ? "All vehicles" : "รถทั้งหมด"}
          </button>
          <button type="button" onClick={() => void load()} disabled={busy} className="btn-secondary min-h-9 px-3 text-xs">
            <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />{english ? "Refresh" : "รีเฟรช"}
          </button>
        </div>
      </section>

      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</div> : null}
      <section className="maintenance-panel space-y-3 p-3 sm:p-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {([
            [english ? "Vehicles" : "รถทั้งหมด", summary.total, "text-slate-900"],
            [english ? "Ready" : "พร้อม", summary.ready, "text-emerald-700"],
            [english ? "Need action" : "ต้องแก้ไข", summary.notReady + summary.attention, "text-rose-700"],
            [english ? "Unchecked" : "ยังไม่ตรวจ", summary.notChecked, "text-amber-700"]
          ] as const).map(([label, count, color]) => (
            <div key={label} className="rounded-xl border border-slate-200 bg-white/80 px-3 py-2">
              <p className="text-[11px] font-semibold text-slate-500">{label}</p>
              <p className={`mt-0.5 text-2xl font-semibold ${color}`}>{busy ? "—" : count}</p>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">{activeTab === "overview" ? (english ? "Equipment needing attention" : "อุปกรณ์ที่ต้องแก้ไข") : (english ? "Vehicle register" : "รายการรถ")}</h2>
            <p className="text-xs text-slate-500">{english ? `${outstandingCount} open issues · ${summary.notChecked} vehicles awaiting a first check` : `ปัญหา ${outstandingCount} รายการ · รถรอตรวจ ${summary.notChecked} คัน`}</p>
          </div>
          <button type="button" onClick={exportIssues} className="btn-secondary min-h-9 px-3 text-xs" disabled={busy || outstandingCount === 0}>
            <Download className="h-4 w-4" />{english ? "Export issues CSV" : "ส่งออกปัญหา CSV"}
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          <input aria-label={english ? "Search driver or registration" : "ค้นหาคนขับหรือทะเบียน"} type="search" className="form-input min-w-[190px] flex-[2] bg-white" placeholder={english ? "Search driver, registration or issue..." : "ค้นหาคนขับ ทะเบียน หรือปัญหา..."} value={search} onChange={(e) => setSearch(e.target.value)} />
          <select aria-label={english ? "Status" : "สถานะ"} className="form-input min-w-[130px] flex-1 bg-white" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}>
            <option value="all">{english ? "All statuses" : "ทุกสถานะ"}</option>
            <option value="not_ready">{english ? "Not ready" : "ไม่พร้อม"}</option>
            <option value="attention">{english ? "Attention" : "ต้องตรวจสอบ"}</option>
            <option value="not_checked">{english ? "Unchecked" : "ยังไม่ตรวจ"}</option>
            <option value="ready">{english ? "Ready" : "พร้อม"}</option>
          </select>
          <select aria-label={english ? "Vehicle type" : "ประเภทรถ"} className="form-input min-w-[130px] flex-1 bg-white" value={vehicleTypeFilter} onChange={(e) => setVehicleTypeFilter(e.target.value)}>
            <option value="all">{english ? "All vehicle types" : "รถทุกประเภท"}</option>
            {vehicleTypes.map((type) => <option key={type} value={type}>{formatVehicleType(type)}</option>)}
          </select>
          <select aria-label={english ? "Issue type" : "ประเภทปัญหา"} className="form-input min-w-[130px] flex-1 bg-white" value={issueFilter} onChange={(e) => setIssueFilter(e.target.value)}>
            <option value="all">{english ? "All issue types" : "ปัญหาทุกประเภท"}</option>
            {issueCategories.map((type) => <option key={type} value={type}>{issueTypeLabel(type as SafetyIssue["issue_type"])}</option>)}
          </select>
          <button type="button" className="btn-secondary min-h-10 px-3 text-xs" onClick={() => { setSearch(""); setStatusFilter("all"); setIssueFilter("all"); setVehicleTypeFilter("all"); setOnlyWithIssues(false); }}>
            <FilterX className="h-4 w-4" />{english ? "Clear" : "ล้างตัวกรอง"}
          </button>
        </div>
        {busy ? <p className="py-8 text-center text-sm text-slate-500">{english ? "Loading safety records..." : "กำลังโหลดข้อมูล..."}</p> : null}
        {!busy && !error && activeTab === "overview" && summary.notChecked > 0 ? (
          <button type="button" onClick={() => { setActiveTab("vehicles"); setStatusFilter("not_checked"); }} className="w-full rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-left text-xs font-medium text-amber-800">
            {english ? `${summary.notChecked} unchecked vehicles — show list →` : `รถ ${summary.notChecked} คันยังไม่ได้ตรวจ — ดูรายการ →`}
          </button>
        ) : null}
        {!busy && !error && displayedRows.length === 0 ? <p className="rounded-xl bg-slate-50 p-5 text-sm text-slate-600">{english ? "No vehicles match this view. Use All vehicles to review ready and unchecked records." : "ไม่พบรถในรายการนี้ เลือกรถทั้งหมดเพื่อดูรายการอื่น"}</p> : null}
        {!busy && !error && displayedRows.length > 0 ? (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white/90">
            <div className="hidden grid-cols-[minmax(135px,1fr)_minmax(130px,1fr)_minmax(260px,3fr)_minmax(100px,1fr)_auto] gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2 text-[11px] font-bold uppercase text-slate-500 lg:grid">
              <span>{english ? "Driver" : "คนขับ"}</span><span>{english ? "Registration" : "ทะเบียน"}</span><span>{english ? "Equipment / outstanding items" : "อุปกรณ์ที่ขาด / ปัญหา"}</span><span>{english ? "Status" : "สถานะ"}</span><span>{english ? "Action" : "ดำเนินการ"}</span>
            </div>
            {displayedRows.map((row) => (
              <div key={row.vehicle.id} className="grid gap-2 border-b border-slate-100 px-3 py-3 last:border-0 lg:grid-cols-[minmax(135px,1fr)_minmax(130px,1fr)_minmax(260px,3fr)_minmax(100px,1fr)_auto] lg:items-start lg:gap-3 lg:px-4">
                <div className="min-w-0"><p className="text-sm font-semibold text-slate-900">{assignedDriverLabel(row)}</p><p className="text-xs text-slate-500 lg:hidden">{row.vehicle.vehicle_reg}</p></div>
                <p className="hidden text-sm font-semibold text-slate-800 lg:block">{row.vehicle.vehicle_reg}</p>
                <div className="min-w-0 space-y-1">
                  {row.openIssues.length > 0 ? row.openIssues.map((issue) => {
                    const detail = issueDescription(issue);
                    return <div key={issue.id} className="text-xs leading-5">
                      <span className="font-semibold text-rose-700">{detail.emoji} {detail.item}</span>
                      <span className="ml-2 text-[11px] text-slate-500">({issueTypeLabel(issue.issue_type)}{issue.status === "in_progress" ? (english ? ", in progress" : ", กำลังดำเนินการ") : ""})</span>
                      {detail.note ? <p className="pl-2 text-[11px] text-slate-500">{english ? "Follow-up: " : "หมายเหตุ: "}{detail.note}</p> : null}
                    </div>;
                  }) : <span className="text-xs text-slate-500">{row.status === "ready" ? (english ? "All recorded checks passed" : "ผ่านการตรวจ") : row.status === "not_checked" ? (english ? "Inspection not submitted" : "ยังไม่ส่งแบบตรวจ") : (english ? "Status needs review; no open item recorded" : "ต้องตรวจสอบสถานะ ไม่มีปัญหาค้าง")}</span>}
                </div>
                <div><StatusBadge status={row.status} label={statusLabel(row.status)} /></div>
                <button type="button" onClick={() => openRow(row)} className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-semibold text-violet-700 hover:bg-violet-100">
                  {row.latestInspection ? (english ? "View" : "ดูบันทึก") : (english ? "Check" : "ตรวจรถ")}
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </section>
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
  );
}

function TableHead({ children }: { children: ReactNode }) {
  return (
    <th className="px-4 py-3 text-xs font-bold uppercase tracking-wide text-slate-500">
      {children}
    </th>
  );
}

function MobileFact({
  label,
  value
}: {
  label: string;
  value: string;
}) {
  return (
    <div>
      <dt className="text-xs font-semibold text-slate-400">{label}</dt>
      <dd className="mt-1 font-medium text-slate-700">{value}</dd>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  helper,
  tone,
  Icon,
  href
}: {
  label: string;
  value: number;
  helper: string;
  tone: "violet" | "emerald" | "amber" | "rose";
  Icon: typeof Truck;
  href?: string;
}) {
  const colors = {
    violet: "border-violet-200 bg-violet-50/70",
    emerald: "border-emerald-200 bg-emerald-50/70",
    amber: "border-amber-200 bg-amber-50/70",
    rose: "border-rose-200 bg-rose-50/70"
  };

  const inner = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">{label}</p>
        <Icon className="h-4 w-4 text-slate-400" />
      </div>
      <p className="mt-2 text-xl font-semibold tracking-tight text-slate-950 sm:text-2xl">{value}</p>
      <div className="mt-1 flex items-center justify-between gap-2">
        <p className="text-xs text-slate-500">{helper}</p>
        {href ? <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-violet-700">View →</span> : null}
      </div>
    </>
  );

  return href ? (
    <Link href={href} className={`group rounded-2xl border p-4 transition hover:-translate-y-0.5 hover:shadow-md ${colors[tone]}`}>
      {inner}
    </Link>
  ) : (
    <div className={`rounded-2xl border p-4 ${colors[tone]}`}>{inner}</div>
  );
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

function formatVehicleType(value: string) {
  const labels: Record<string, string> = {
    FOUR_WHEEL_TRUCK: "4 Wheel Truck",
    SIX_WHEEL_TRUCK: "6 Wheel Truck",
    TEN_WHEEL_TRUCK: "10 Wheel Truck",
    EIGHTEEN_WHEELER: "18 Wheeler",
    SIX_PLUS_SIX_WHEELER: "6 + 6 Wheeler",
    SIX_PLUS_TEN_WHEELER: "6 + 10 Wheeler",
    TRAILER: "Trailer",
    SEMI_TRAILER: "Semi-Trailer",
    PICKUP: "Pickup",
    VAN: "Van"
  };

  return (
    labels[value] ??
    value
      .replaceAll("_", " ")
      .toLowerCase()
      .replace(/\b\w/g, (letter) => letter.toUpperCase())
  );
}
