"use client";

import {
  CheckCircle2,
  Loader2,
  ShieldCheck,
  TriangleAlert,
  X,
  XCircle
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useLanguage } from "@/lib/language-provider";
import { supabase } from "@/lib/supabase";

type Vehicle = {
  id: string;
  vehicle_reg: string;
  vehicle_model: string | null;
  vehicle_type: string | null;
};

type Driver = {
  id: number;
  name: string;
  vehicle_reg: string;
  vehicle_model: string | null;
  vehicle_type: string | null;
  active: boolean;
};

type Requirement = {
  id: string;
  code: string;
  name_en: string;
  name_th: string;
  description_en: string | null;
  description_th: string | null;
  required: boolean;
  sort_order: number;
  active?: boolean;
};

type ItemStatus = "ok" | "damaged" | "missing";

type CheckState = {
  status: ItemStatus | "";
  notes: string;
};

type Props = {
  vehicle: Vehicle;
  drivers: Driver[];
  assignedDriverId?: number | null;
  onClose: () => void;
  onSaved: () => void;
};

type SectionKey = "vehicle_equipment" | "driver_ppe";

const itemMeta: Record<
  string,
  {
    emoji: string;
    section: SectionKey;
  }
> = {
  fire_extinguisher: {
    emoji: "🧯",
    section: "vehicle_equipment"
  },
  wheel_chock: {
    emoji: "🛑",
    section: "vehicle_equipment"
  },
  traffic_cone: {
    emoji: "🚧",
    section: "vehicle_equipment"
  },
  cargo_straps: {
    emoji: "🔗",
    section: "vehicle_equipment"
  },
  spare_tyre: {
    emoji: "🛞",
    section: "vehicle_equipment"
  },
  reflective_vest: {
    emoji: "🦺",
    section: "driver_ppe"
  },
  safety_helmet: {
    emoji: "⛑️",
    section: "driver_ppe"
  },
  safety_shoes: {
    emoji: "🥾",
    section: "driver_ppe"
  },
  safety_goggles: {
    emoji: "🥽",
    section: "driver_ppe"
  }
};


export function VehicleSafetyCheck({
  vehicle,
  drivers,
  assignedDriverId,
  onClose,
  onSaved
}: Props) {
  const { language } = useLanguage();
  const english = language === "en";

  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [checks, setChecks] = useState<Record<string, CheckState>>({});
  const [driverId, setDriverId] = useState(
    assignedDriverId ? String(assignedDriverId) : ""
  );
  const [inspectionNotes, setInspectionNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDriverId(assignedDriverId ? String(assignedDriverId) : "");
  }, [assignedDriverId]);

  useEffect(() => {
    const loadRequirements = async () => {
      setLoading(true);

      const result = await supabase
        .from("vehicle_safety_requirements")
        .select(
          "id, code, name_en, name_th, description_en, description_th, required, sort_order, active"
        )
        .order("sort_order", { ascending: true });

      if (result.error) {
        setError(result.error.message);
        setLoading(false);
        return;
      }

      const rows = ((result.data ?? []) as Requirement[]).filter(
        (row) => row.active !== false
      );

      const initial: Record<string, CheckState> = {};

      for (const row of rows) {
        initial[row.id] = {
          status: "",
          notes: ""
        };
      }

      setRequirements(rows);
      setChecks(initial);
      setError(null);
      setLoading(false);
    };

    void loadRequirements();
  }, []);

  const numberedDrivers = useMemo(
    () =>
      [...drivers]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((driver, index) => ({
          ...driver,
          displayNumber: index + 1
        })),
    [drivers]
  );

  const groupedRequirements = useMemo(() => {
    const groups: Record<SectionKey, Requirement[]> = {
      vehicle_equipment: [],
      driver_ppe: []
    };

    for (const requirement of requirements) {
      const section =
        itemMeta[requirement.code]?.section ?? "vehicle_equipment";
      groups[section].push(requirement);
    }

    return groups;
  }, [requirements]);

  const completedCount = useMemo(
    () =>
      requirements.filter((requirement) =>
        Boolean(checks[requirement.id]?.status)
      ).length,
    [requirements, checks]
  );

  const issueCount = useMemo(
    () =>
      requirements.filter((requirement) => {
        const status = checks[requirement.id]?.status;
        return status === "damaged" || status === "missing";
      }).length,
    [requirements, checks]
  );

  const notesValid = useMemo(
    () =>
      requirements.every((requirement) => {
        const check = checks[requirement.id];
        if (check?.status === "damaged" || check?.status === "missing") {
          return check.notes.trim().length > 0;
        }
        return true;
      }),
    [requirements, checks]
  );


  const allComplete =
    requirements.length > 0 &&
    completedCount === requirements.length;

  const canSubmit =
    allComplete &&
    notesValid &&
    !saving;

  const overallStatus = useMemo(() => {
    const statuses = requirements.map(
      (requirement) => checks[requirement.id]?.status
    );

    if (statuses.some((status) => status === "missing")) {
      return "not_ready" as const;
    }

    if (statuses.some((status) => status === "damaged")) {
      return "attention" as const;
    }

    if (allComplete) return "ready" as const;
    return "pending" as const;
  }, [requirements, checks, allComplete]);

  const setStatus = (requirementId: string, status: ItemStatus) => {
    setChecks((current) => ({
      ...current,
      [requirementId]: {
        ...current[requirementId],
        status
      }
    }));
  };

  const setNotes = (requirementId: string, notes: string) => {
    setChecks((current) => ({
      ...current,
      [requirementId]: {
        ...current[requirementId],
        notes
      }
    }));
  };


  const save = async () => {
    if (!canSubmit) return;

    setSaving(true);
    setError(null);

    try {
      const inspectionResult = await supabase
        .from("vehicle_safety_inspections")
        .insert({
          vehicle_id: vehicle.id,
          driver_id: driverId ? Number(driverId) : null,
          overall_status: overallStatus,
          notes: inspectionNotes.trim() || null
        })
        .select("id")
        .single();

      if (inspectionResult.error) throw inspectionResult.error;

      const inspectionId = inspectionResult.data.id;

      const itemRows = requirements.map((requirement) => ({
        inspection_id: inspectionId,
        requirement_id: requirement.id,
        status: checks[requirement.id].status,
        notes: checks[requirement.id].notes.trim() || null
      }));

      const itemsResult = await supabase
        .from("vehicle_safety_inspection_items")
        .insert(itemRows);

      if (itemsResult.error) throw itemsResult.error;

      const issueRows = requirements
        .filter((requirement) => {
          const status = checks[requirement.id].status;
          return status === "missing" || status === "damaged";
        })
        .map((requirement) => ({
          vehicle_id: vehicle.id,
          driver_id: driverId ? Number(driverId) : null,
          inspection_id: inspectionId,
          requirement_id: requirement.id,
          issue_type:
            checks[requirement.id].status === "missing"
              ? "missing"
              : "damaged",
          severity:
            checks[requirement.id].status === "missing"
              ? "critical"
              : "attention",
          description: checks[requirement.id].notes.trim(),
          status: "open"
        }));

      if (issueRows.length > 0) {
        const issuesResult = await supabase
          .from("vehicle_safety_issues")
          .insert(issueRows);

        if (issuesResult.error) throw issuesResult.error;
      }

      onSaved();
      onClose();
    } catch (caught) {
      console.error("Safety inspection save failed", caught);
      setError(
        caught instanceof Error
          ? caught.message
          : english
            ? "Unable to save safety inspection."
            : "ไม่สามารถบันทึกการตรวจความปลอดภัยได้"
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/35 backdrop-blur-[3px] sm:items-center sm:p-5">
      <div className="flex max-h-[95dvh] w-full max-w-[1000px] flex-col overflow-hidden rounded-t-3xl border border-slate-200 bg-[#fffdf8] shadow-2xl sm:rounded-3xl">
        <header className="shrink-0 border-b border-slate-200 px-5 py-3.5 sm:px-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-violet-600">
                {english ? "PRE-TRIP SAFETY CHECK" : "ตรวจความปลอดภัยก่อนออกงาน"}
              </p>

              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <h2 className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-[28px]">
                  {vehicle.vehicle_reg}
                </h2>

                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                  🚚 {formatVehicleType(vehicle.vehicle_type)}
                </span>

                <span className="rounded-full bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-700">
                  🏷️ {vehicle.vehicle_model || (english ? "Model not set" : "ยังไม่ระบุรุ่น")}
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition hover:text-slate-900"
              aria-label={english ? "Close" : "ปิด"}
            >
              <X className="h-4.5 w-4.5" />
            </button>
          </div>
        </header>

        <div className="overflow-y-auto px-5 py-4 sm:px-6">
          {loading ? (
            <div className="flex min-h-[240px] items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-violet-600" />
            </div>
          ) : error ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
              {error}
            </div>
          ) : (
            <div className="space-y-4">
              <section className="grid gap-3 lg:grid-cols-[minmax(0,1.55fr)_155px_155px]">
                <label className="block rounded-2xl border border-slate-200 bg-white p-3.5">
                  <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                    {english ? "Driver" : "คนขับ"}
                  </span>

                  <select
                    className="form-input bg-white"
                    value={driverId}
                    onChange={(event) => setDriverId(event.target.value)}
                  >
                    <option value="">
                      {english ? "Select driver" : "เลือกคนขับ"}
                    </option>

                    {numberedDrivers.map((driver) => (
                      <option key={driver.id} value={driver.id}>
                        {String(driver.displayNumber).padStart(2, "0")} · {driver.name}
                      </option>
                    ))}
                  </select>
                </label>

                <MetricCard
                  label={english ? "Progress" : "ความคืบหน้า"}
                  value={`${completedCount}/${requirements.length}`}
                  helper={
                    english
                      ? `${requirements.length - completedCount} remaining`
                      : `เหลือ ${requirements.length - completedCount} รายการ`
                  }
                />

                <MetricCard
                  label={english ? "Issues" : "ปัญหา"}
                  value={issueCount}
                  helper={
                    issueCount === 0
                      ? english
                        ? "No issues"
                        : "ยังไม่พบปัญหา"
                      : english
                        ? "Needs action"
                        : "ต้องดำเนินการ"
                  }
                />
              </section>

              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold text-slate-950">
                      {english ? "Safety inspection" : "การตรวจความปลอดภัย"}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {english
                        ? "Vehicle equipment first, then driver PPE."
                        : "ตรวจอุปกรณ์ประจำรถก่อน แล้วจึงตรวจ PPE ของคนขับ"}
                    </p>
                  </div>

                  <InspectionResultCompact
                    status={overallStatus}
                    english={english}
                  />
                </div>

                <div className="mt-2.5 h-1.5 rounded-full bg-slate-100">
                  <div
                    className="h-1.5 rounded-full bg-violet-600 transition-all duration-300"
                    style={{
                      width: `${
                        requirements.length === 0
                          ? 0
                          : (completedCount / requirements.length) * 100
                      }%`
                    }}
                  />
                </div>
              </div>

              <ChecklistSection
                title={english ? "Vehicle equipment" : "อุปกรณ์ประจำรถ"}
                subtitle={
                  english
                    ? "Choose the condition of each safety item."
                    : "เลือกสภาพของอุปกรณ์ความปลอดภัยแต่ละรายการ"
                }
                requirements={groupedRequirements.vehicle_equipment}
                checks={checks}
                setStatus={setStatus}
                setNotes={setNotes}
                english={english}
                compact={false}
              />

              <ChecklistSection
                title={english ? "Driver PPE" : "อุปกรณ์ PPE คนขับ"}
                subtitle={
                  english
                    ? "Quick condition check for personal protective equipment."
                    : "ตรวจสภาพอุปกรณ์ป้องกันส่วนบุคคลแบบรวดเร็ว"
                }
                requirements={groupedRequirements.driver_ppe}
                checks={checks}
                setStatus={setStatus}
                setNotes={setNotes}
                english={english}
                compact
              />

              <label className="block rounded-2xl border border-slate-200 bg-white p-3.5">
                <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                  {english ? "General notes" : "หมายเหตุเพิ่มเติม"}
                </span>
                <textarea
                  className="form-input min-h-[76px] bg-white"
                  value={inspectionNotes}
                  onChange={(event) => setInspectionNotes(event.target.value)}
                  placeholder={
                    english
                      ? "Optional notes for this check..."
                      : "หมายเหตุเพิ่มเติมสำหรับการตรวจครั้งนี้..."
                  }
                />
              </label>
            </div>
          )}
        </div>

        {!loading && !error ? (
          <footer className="shrink-0 border-t border-slate-200 bg-white/95 px-5 py-3.5 sm:px-6">
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-700">
                  {!allComplete
                    ? english
                      ? `${requirements.length - completedCount} item(s) still need a condition.`
                      : `เหลืออีก ${requirements.length - completedCount} รายการที่ต้องเลือกสภาพ`
                      : !notesValid
                        ? english
                          ? "Add details for damaged or missing items."
                          : "กรุณาใส่รายละเอียดในรายการชำรุดหรือสูญหาย"
                        : english
                          ? "Ready to complete."
                          : "พร้อมบันทึก"}
                </p>
                <p className="mt-0.5 text-xs text-slate-400">
                  {english
                    ? "Damaged or missing items require a note."
                    : "รายการที่ชำรุดหรือสูญหายต้องระบุหมายเหตุ"}
                </p>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn-secondary min-h-10"
                  onClick={onClose}
                  disabled={saving}
                >
                  {english ? "Cancel" : "ยกเลิก"}
                </button>

                <button
                  type="button"
                  className="btn-primary min-h-10 px-5"
                  disabled={!canSubmit}
                  onClick={() => void save()}
                >
                  {saving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4" />
                  )}
                  {saving
                    ? english
                      ? "Saving..."
                      : "กำลังบันทึก..."
                    : english
                      ? "Complete safety check"
                      : "บันทึกการตรวจ"}
                </button>
              </div>
            </div>
          </footer>
        ) : null}
      </div>
    </div>
  );
}

function ChecklistSection({
  title,
  subtitle,
  requirements,
  checks,
  setStatus,
  setNotes,
  english,
  compact
}: {
  title: string;
  subtitle: string;
  requirements: Requirement[];
  checks: Record<string, CheckState>;
  setStatus: (requirementId: string, status: ItemStatus) => void;
  setNotes: (requirementId: string, notes: string) => void;
  english: boolean;
  compact: boolean;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-4 py-3 sm:px-5">
        <h3 className="text-base font-semibold text-slate-950">{title}</h3>
        <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>
      </div>

      <div className="divide-y divide-slate-100">
        {requirements.map((requirement, index) => {
          const meta = itemMeta[requirement.code];
          const check = checks[requirement.id];
          const hasProblem =
            check?.status === "damaged" || check?.status === "missing";

          const rowTone =
            check?.status === "ok"
              ? "bg-emerald-50/35"
              : check?.status === "damaged"
                ? "bg-amber-50/45"
                : check?.status === "missing"
                  ? "bg-rose-50/45"
                  : "bg-white";

          return (
            <article
              key={requirement.id}
              className={`${rowTone} px-4 py-3 transition sm:px-5`}
            >
              <div
                className={
                  compact
                    ? "grid gap-3 lg:grid-cols-[minmax(0,1.5fr)_330px] lg:items-center"
                    : "grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_330px] lg:items-center"
                }
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-[19px]">
                    {meta?.emoji ?? "✅"}
                  </div>

                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-slate-900 px-1.5 text-[10px] font-bold text-white">
                        {index + 1}
                      </span>
                      <h4 className="text-sm font-semibold text-slate-950">
                        {english ? requirement.name_en : requirement.name_th}
                      </h4>
                    </div>

                    <p className="mt-0.5 text-xs leading-5 text-slate-500">
                      {english
                        ? requirement.description_en
                        : requirement.description_th}
                    </p>
                  </div>
                </div>

                <div>
                  <p className="mb-1 text-[9px] font-bold uppercase tracking-[0.1em] text-slate-400">
                    {english ? "Condition" : "สภาพ"}
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    <StatusButton
                      active={check?.status === "ok"}
                      tone="ok"
                      label={english ? "OK" : "ปกติ"}
                      onClick={() => setStatus(requirement.id, "ok")}
                    />
                    <StatusButton
                      active={check?.status === "damaged"}
                      tone="damaged"
                      label={english ? "Damaged" : "ชำรุด"}
                      onClick={() => setStatus(requirement.id, "damaged")}
                    />
                    <StatusButton
                      active={check?.status === "missing"}
                      tone="missing"
                      label={english ? "Missing" : "ไม่มี"}
                      onClick={() => setStatus(requirement.id, "missing")}
                    />
                  </div>
                </div>
              </div>

              {hasProblem ? (
                <textarea
                  className="form-input mt-2.5 min-h-[64px] bg-white"
                  placeholder={
                    english
                      ? "Required: describe the issue..."
                      : "จำเป็น: ระบุรายละเอียดปัญหา..."
                  }
                  value={check?.notes ?? ""}
                  onChange={(event) =>
                    setNotes(requirement.id, event.target.value)
                  }
                />
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function MetricCard({
  label,
  value,
  helper
}: {
  label: string;
  value: string | number;
  helper: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3.5">
      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">
        {value}
      </p>
      <p className="mt-0.5 text-[11px] text-slate-500">{helper}</p>
    </div>
  );
}

function QuantityBubble({
  value,
  active,
  onClick
}: {
  value: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-8 min-w-8 items-center justify-center rounded-full border px-2.5 text-xs font-semibold transition ${
        active
          ? "border-violet-600 bg-violet-600 text-white shadow-sm"
          : "border-slate-200 bg-white text-slate-700 hover:border-violet-300 hover:text-violet-700"
      }`}
    >
      {value}
    </button>
  );
}

function StatusButton({
  active,
  tone,
  label,
  onClick
}: {
  active: boolean;
  tone: "ok" | "damaged" | "missing";
  label: string;
  onClick: () => void;
}) {
  const activeStyles = {
    ok: "border-emerald-500 bg-emerald-100 text-emerald-900 shadow-sm",
    damaged: "border-amber-500 bg-amber-100 text-amber-900 shadow-sm",
    missing: "border-rose-500 bg-rose-100 text-rose-900 shadow-sm"
  };

  const inactiveStyles = {
    ok: "border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-50",
    damaged: "border-amber-200 bg-white text-amber-700 hover:bg-amber-50",
    missing: "border-rose-200 bg-white text-rose-700 hover:bg-rose-50"
  };

  const icon = tone === "ok" ? "✓" : tone === "damaged" ? "⚠" : "✕";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-9 rounded-xl border px-2.5 text-xs font-semibold transition ${
        active ? activeStyles[tone] : inactiveStyles[tone]
      }`}
    >
      <span className="inline-flex items-center gap-1.5">
        <span>{icon}</span>
        <span>{label}</span>
      </span>
    </button>
  );
}

function InspectionResultCompact({
  status,
  english
}: {
  status: "pending" | "ready" | "attention" | "not_ready";
  english: boolean;
}) {
  if (status === "ready") {
    return (
      <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700">
        <ShieldCheck className="h-4 w-4" />
        {english ? "Ready" : "พร้อมใช้งาน"}
      </span>
    );
  }

  if (status === "attention") {
    return (
      <span className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700">
        <TriangleAlert className="h-4 w-4" />
        {english ? "Attention" : "ต้องตรวจสอบ"}
      </span>
    );
  }

  if (status === "not_ready") {
    return (
      <span className="inline-flex items-center gap-2 rounded-full bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700">
        <XCircle className="h-4 w-4" />
        {english ? "Not ready" : "ไม่พร้อมใช้งาน"}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600">
      {english ? "In progress" : "กำลังตรวจ"}
    </span>
  );
}

function formatVehicleType(value: string | null) {
  if (!value) return "—";

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
