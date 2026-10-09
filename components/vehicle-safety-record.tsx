"use client";

import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Edit3,
  Loader2,
  Save,
  ShieldCheck,
  UserRound,
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
};

type Inspection = {
  id: string;
  driver_id: number | null;
  inspected_at: string;
  overall_status: "pending" | "ready" | "attention" | "not_ready";
  notes: string | null;
};

type InspectionItem = {
  id: string;
  requirement_id: string;
  status: "ok" | "damaged" | "missing" | "not_applicable";
  quantity_available: number | null;
  notes: string | null;
};

type Requirement = {
  id: string;
  code: string;
  name_en: string;
  name_th: string;
  sort_order: number;
};

type DraftState = {
  status: "ok" | "damaged" | "missing";
  notes: string;
};

type Props = {
  vehicle: Vehicle;
  inspection: Inspection;
  drivers: Driver[];
  onClose: () => void;
  onNewCheck: () => void;
  onUpdated?: () => void;
};

const itemEmoji: Record<string, string> = {
  fire_extinguisher: "🧯",
  wheel_chock: "🛑",
  traffic_cone: "🚧",
  cargo_straps: "🔗",
  spare_tyre: "🛞",
  reflective_vest: "🦺",
  safety_helmet: "⛑️",
  safety_shoes: "🥾",
  safety_goggles: "🥽"
};


export function VehicleSafetyRecord({
  vehicle,
  inspection,
  drivers,
  onClose,
  onNewCheck,
  onUpdated
}: Props) {
  const { language } = useLanguage();
  const english = language === "en";

  const [items, setItems] = useState<InspectionItem[]>([]);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [editing, setEditing] = useState(false);
  const [driverId, setDriverId] = useState(
    inspection.driver_id == null ? "" : String(inspection.driver_id)
  );
  const [generalNotes, setGeneralNotes] = useState(inspection.notes ?? "");
  const [drafts, setDrafts] = useState<Record<string, DraftState>>({});

  const load = async () => {
    setLoading(true);

    const [itemsResult, requirementsResult] = await Promise.all([
      supabase
        .from("vehicle_safety_inspection_items")
        .select("id, requirement_id, status, quantity_available, notes")
        .eq("inspection_id", inspection.id),

      supabase
        .from("vehicle_safety_requirements")
        .select("id, code, name_en, name_th, sort_order")
        .order("sort_order", { ascending: true })
    ]);

    if (itemsResult.error) {
      setError(itemsResult.error.message);
      setLoading(false);
      return;
    }

    if (requirementsResult.error) {
      setError(requirementsResult.error.message);
      setLoading(false);
      return;
    }

    const loadedItems = (itemsResult.data ?? []) as InspectionItem[];
    const nextDrafts: Record<string, DraftState> = {};

    for (const item of loadedItems) {
      nextDrafts[item.requirement_id] = {
        status:
          item.status === "damaged" || item.status === "missing"
            ? item.status
            : "ok",
        notes: item.notes ?? ""
      };
    }

    setItems(loadedItems);
    setRequirements((requirementsResult.data ?? []) as Requirement[]);
    setDrafts(nextDrafts);
    setDriverId(
      inspection.driver_id == null ? "" : String(inspection.driver_id)
    );
    setGeneralNotes(inspection.notes ?? "");
    setError(null);
    setLoading(false);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inspection.id]);

  const driverName =
    driverId === ""
      ? null
      : drivers.find((driver) => driver.id === Number(driverId))?.name ?? null;

  const rows = useMemo(() => {
    const requirementMap = new Map(
      requirements.map((requirement) => [requirement.id, requirement])
    );

    return items
      .map((item) => ({
        item,
        requirement: requirementMap.get(item.requirement_id) ?? null
      }))
      .sort(
        (a, b) =>
          (a.requirement?.sort_order ?? 999) -
          (b.requirement?.sort_order ?? 999)
      );
  }, [items, requirements]);

  const liveCounts = useMemo(() => {
    const values = Object.values(drafts);

    return {
      ok: values.filter((item) => item.status === "ok").length,
      damaged: values.filter((item) => item.status === "damaged").length,
      missing: values.filter((item) => item.status === "missing").length
    };
  }, [drafts]);

  const liveStatus = useMemo(() => {
    if (liveCounts.missing > 0) return "not_ready" as const;
    if (liveCounts.damaged > 0) return "attention" as const;
    return "ready" as const;
  }, [liveCounts]);

  const problems = useMemo(
    () =>
      rows.filter(({ item }) => {
        const draft = drafts[item.requirement_id];
        return draft?.status === "damaged" || draft?.status === "missing";
      }),
    [rows, drafts]
  );

  const statusMeta = getStatusMeta(liveStatus, english);

  const setStatus = (
    requirementId: string,
    status: DraftState["status"]
  ) => {
    setDrafts((current) => ({
      ...current,
      [requirementId]: {
        ...current[requirementId],
        status
      }
    }));
  };


  const setNotes = (requirementId: string, notes: string) => {
    setDrafts((current) => ({
      ...current,
      [requirementId]: {
        ...current[requirementId],
        notes
      }
    }));
  };

  const editValid = useMemo(() => {
    return rows.every(({ item, requirement }) => {
      if (!requirement) return true;
      const draft = drafts[item.requirement_id];
      if (!draft) return false;


      if (
        (draft.status === "damaged" || draft.status === "missing") &&
        draft.notes.trim() === ""
      ) {
        return false;
      }

      return true;
    });
  }, [rows, drafts]);

  const saveChanges = async () => {
    if (!editValid || saving) return;

    setSaving(true);
    setError(null);

    try {
      const inspectionUpdate = await supabase
        .from("vehicle_safety_inspections")
        .update({
          driver_id: driverId ? Number(driverId) : null,
          overall_status: liveStatus,
          notes: generalNotes.trim() || null
        })
        .eq("id", inspection.id);

      if (inspectionUpdate.error) throw inspectionUpdate.error;

      for (const { item, requirement } of rows) {
        if (!requirement) continue;

        const draft = drafts[item.requirement_id];
        const itemUpdate = await supabase
          .from("vehicle_safety_inspection_items")
          .update({
            status: draft.status,
            notes: draft.notes.trim() || null
          })
          .eq("id", item.id);

        if (itemUpdate.error) throw itemUpdate.error;
      }

      // Preserve issue IDs and linked replacement history when editing a check.
      // Resolved items remain as historical issue records instead of being deleted.
      const existingResult = await supabase
        .from("vehicle_safety_issues")
        .select("id, requirement_id, status")
        .eq("inspection_id", inspection.id);
      if (existingResult.error) throw existingResult.error;

      const existingIssues = (existingResult.data ?? []) as Array<{
        id: string; requirement_id: string | null; status: string;
      }>;
      const matchedIds = new Set<string>();
      for (const { item, requirement } of rows) {
        if (!requirement) continue;
        const draft = drafts[item.requirement_id];
        if (!draft) continue;
        const found = existingIssues.find(issue =>
          issue.requirement_id === item.requirement_id && !matchedIds.has(issue.id)
        );
        if (draft.status === "missing" || draft.status === "damaged") {
          const values = {
            vehicle_id: vehicle.id,
            driver_id: driverId ? Number(driverId) : null,
            inspection_id: inspection.id,
            requirement_id: item.requirement_id,
            issue_type: draft.status,
            severity: draft.status === "missing" ? "critical" : "attention",
            description: draft.notes.trim(),
            status: "open"
          };
          if (found) {
            matchedIds.add(found.id);
            const update = await supabase.from("vehicle_safety_issues")
              .update(values).eq("id", found.id);
            if (update.error) throw update.error;
          } else {
            const insert = await supabase.from("vehicle_safety_issues").insert(values);
            if (insert.error) throw insert.error;
          }
        } else if (found) {
          matchedIds.add(found.id);
          const resolve = await supabase.from("vehicle_safety_issues")
            .update({ status: "resolved" }).eq("id", found.id);
          if (resolve.error) throw resolve.error;
        }
      }
      // Historical duplicates or removed checklist requirements are closed,
      // never deleted, so their activity trail remains available.
      for (const old of existingIssues) {
        if (matchedIds.has(old.id) || old.status === "resolved") continue;
        const resolve = await supabase.from("vehicle_safety_issues")
          .update({ status: "resolved" }).eq("id", old.id);
        if (resolve.error) throw resolve.error;
      }

      setEditing(false);
      await load();
      onUpdated?.();
    } catch (caught) {
      console.error("Safety record update failed", caught);
      setError(
        caught instanceof Error
          ? caught.message
          : english
            ? "Unable to update the saved safety check."
            : "ไม่สามารถแก้ไขบันทึกการตรวจได้"
      );
    } finally {
      setSaving(false);
    }
  };

  const cancelEdit = () => {
    const reset: Record<string, DraftState> = {};

    for (const item of items) {
      reset[item.requirement_id] = {
        status:
          item.status === "damaged" || item.status === "missing"
            ? item.status
            : "ok",
        notes: item.notes ?? ""
      };
    }

    setDrafts(reset);
    setDriverId(
      inspection.driver_id == null ? "" : String(inspection.driver_id)
    );
    setGeneralNotes(inspection.notes ?? "");
    setEditing(false);
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-end justify-center bg-slate-950/35 backdrop-blur-[3px] sm:items-center sm:p-5">
      <div className="flex max-h-[94dvh] w-full max-w-[920px] flex-col overflow-hidden rounded-t-3xl border border-slate-200 bg-[#fffdf8] shadow-2xl sm:rounded-3xl">
        <header className="shrink-0 border-b border-slate-200 px-5 py-4 sm:px-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-violet-600">
                  {english ? "SAVED SAFETY CHECK" : "บันทึกการตรวจความปลอดภัย"}
                </p>

                {editing ? (
                  <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-bold text-amber-700">
                    {english ? "EDITING" : "กำลังแก้ไข"}
                  </span>
                ) : null}
              </div>

              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <h2 className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-[28px]">
                  {vehicle.vehicle_reg}
                </h2>

                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                  🚚 {formatVehicleType(vehicle.vehicle_type)}
                </span>

                <span className="rounded-full bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-700">
                  🏷️ {vehicle.vehicle_model || "—"}
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition hover:text-slate-900"
              aria-label={english ? "Close" : "ปิด"}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div className="overflow-y-auto px-5 py-4 sm:px-6">
          {loading ? (
            <div className="flex min-h-[260px] items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-violet-600" />
            </div>
          ) : error ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
              {error}
            </div>
          ) : (
            <div className="space-y-4">
              <section
                className={`rounded-2xl border p-4 ${statusMeta.panelClass}`}
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      {statusMeta.icon}
                      <h3 className="text-lg font-semibold">
                        {statusMeta.title}
                      </h3>
                    </div>
                    <p className="mt-1 text-sm opacity-80">
                      {statusMeta.description}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2 text-xs">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/70 px-3 py-1.5 font-semibold">
                      <Clock3 className="h-3.5 w-3.5" />
                      {formatDate(inspection.inspected_at, english)}
                    </span>

                    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/70 px-3 py-1.5 font-semibold">
                      <UserRound className="h-3.5 w-3.5" />
                      {driverName ||
                        (english ? "No driver recorded" : "ไม่ได้ระบุคนขับ")}
                    </span>
                  </div>
                </div>
              </section>

              <section className="grid grid-cols-3 gap-3">
                <SummaryStat
                  label={english ? "OK" : "ปกติ"}
                  value={liveCounts.ok}
                  tone="emerald"
                />
                <SummaryStat
                  label={english ? "Damaged" : "ชำรุด"}
                  value={liveCounts.damaged}
                  tone="amber"
                />
                <SummaryStat
                  label={english ? "Missing" : "ไม่มี"}
                  value={liveCounts.missing}
                  tone="rose"
                />
              </section>

              {!editing ? (
                <>
                  {problems.length > 0 ? (
                    <section className="overflow-hidden rounded-2xl border border-rose-200 bg-white">
                      <div className="border-b border-rose-100 bg-rose-50/60 px-4 py-3">
                        <div className="flex items-center gap-2">
                          <AlertTriangle className="h-4 w-4 text-rose-600" />
                          <h3 className="font-semibold text-rose-900">
                            {english
                              ? `${problems.length} item${problems.length === 1 ? "" : "s"} need action`
                              : `มี ${problems.length} รายการที่ต้องดำเนินการ`}
                          </h3>
                        </div>

                        <p className="mt-0.5 text-xs text-rose-700">
                          {english
                            ? "Only the problems are shown here so the next action is obvious."
                            : "แสดงเฉพาะปัญหาเพื่อให้เห็นสิ่งที่ต้องดำเนินการทันที"}
                        </p>
                      </div>

                      <div className="divide-y divide-slate-100">
                        {problems.map(({ item, requirement }) => (
                          <ProblemRow
                            key={item.requirement_id}
                            item={item}
                            draft={drafts[item.requirement_id]}
                            requirement={requirement}
                            english={english}
                          />
                        ))}
                      </div>
                    </section>
                  ) : (
                    <section className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4">
                      <div className="flex items-center gap-2 text-emerald-800">
                        <ShieldCheck className="h-5 w-5" />
                        <p className="font-semibold">
                          {english
                            ? "No problems were recorded on this check."
                            : "ไม่พบปัญหาในการตรวจครั้งนี้"}
                        </p>
                      </div>
                    </section>
                  )}

                  {generalNotes ? (
                    <section className="rounded-2xl border border-slate-200 bg-white p-4">
                      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
                        {english ? "General notes" : "หมายเหตุเพิ่มเติม"}
                      </p>
                      <p className="mt-1.5 text-sm leading-6 text-slate-700">
                        {generalNotes}
                      </p>
                    </section>
                  ) : null}

                  <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                    <button
                      type="button"
                      onClick={() => setShowAll((current) => !current)}
                      className="flex w-full items-center justify-between px-4 py-3 text-left"
                    >
                      <div className="flex items-center gap-2">
                        <ClipboardList className="h-4 w-4 text-violet-600" />
                        <div>
                          <p className="font-semibold text-slate-900">
                            {english ? "Full saved checklist" : "รายการตรวจทั้งหมด"}
                          </p>
                          <p className="text-xs text-slate-500">
                            {english
                              ? "See the saved condition for every item."
                              : "ดูสภาพที่บันทึกไว้ของทุกอุปกรณ์"}
                          </p>
                        </div>
                      </div>

                      <span className="text-sm font-semibold text-violet-700">
                        {showAll
                          ? english
                            ? "Hide"
                            : "ซ่อน"
                          : english
                            ? "Show"
                            : "แสดง"}
                      </span>
                    </button>

                    {showAll ? (
                      <div className="divide-y divide-slate-100 border-t border-slate-100">
                        {rows.map(({ item, requirement }) => (
                          <SavedItemRow
                            key={item.requirement_id}
                            item={item}
                            draft={drafts[item.requirement_id]}
                            requirement={requirement}
                            english={english}
                          />
                        ))}
                      </div>
                    ) : null}
                  </section>
                </>
              ) : (
                <>
                  <section className="rounded-2xl border border-violet-200 bg-violet-50/50 p-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="block">
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
                          {drivers.map((driver, index) => (
                            <option key={driver.id} value={driver.id}>
                              {String(index + 1).padStart(2, "0")} · {driver.name}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="block">
                        <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                          {english ? "General notes" : "หมายเหตุเพิ่มเติม"}
                        </span>
                        <input
                          className="form-input bg-white"
                          value={generalNotes}
                          onChange={(event) => setGeneralNotes(event.target.value)}
                          placeholder={
                            english
                              ? "Optional general note..."
                              : "หมายเหตุเพิ่มเติม..."
                          }
                        />
                      </label>
                    </div>
                  </section>

                  <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                    <div className="border-b border-slate-100 px-4 py-3">
                      <h3 className="font-semibold text-slate-900">
                        {english ? "Edit saved checklist" : "แก้ไขรายการตรวจ"}
                      </h3>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {english
                          ? "Change a condition or note. Saving will update this same inspection record."
                          : "แก้ไขสภาพหรือหมายเหตุ การบันทึกจะอัปเดตบันทึกเดิม"}
                      </p>
                    </div>

                    <div className="divide-y divide-slate-100">
                      {rows.map(({ item, requirement }) => (
                        <EditableItemRow
                          key={item.requirement_id}
                          item={item}
                          draft={drafts[item.requirement_id]}
                          requirement={requirement}
                          english={english}
                          onStatus={(status) =>
                            setStatus(item.requirement_id, status)
                          }
                          onNotes={(value) =>
                            setNotes(item.requirement_id, value)
                          }
                        />
                      ))}
                    </div>
                  </section>
                </>
              )}
            </div>
          )}
        </div>

        <footer className="shrink-0 border-t border-slate-200 bg-white/95 px-5 py-3.5 sm:px-6">
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-slate-500">
              {editing
                ? english
                  ? "You are editing the existing saved inspection."
                  : "คุณกำลังแก้ไขบันทึกการตรวจเดิม"
                : english
                  ? "The latest inspection stays on file until you deliberately start a new check."
                  : "บันทึกการตรวจล่าสุดจะถูกเก็บไว้จนกว่าจะเริ่มการตรวจใหม่"}
            </p>

            <div className="flex flex-wrap gap-2">
              {editing ? (
                <>
                  <button
                    type="button"
                    className="btn-secondary min-h-10"
                    onClick={cancelEdit}
                    disabled={saving}
                  >
                    {english ? "Cancel changes" : "ยกเลิกการแก้ไข"}
                  </button>

                  <button
                    type="button"
                    className="btn-primary min-h-10 px-5"
                    onClick={() => void saveChanges()}
                    disabled={!editValid || saving}
                  >
                    {saving ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                    {saving
                      ? english
                        ? "Saving..."
                        : "กำลังบันทึก..."
                      : english
                        ? "Save changes"
                        : "บันทึกการแก้ไข"}
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="btn-secondary min-h-10"
                    onClick={onClose}
                  >
                    {english ? "Close" : "ปิด"}
                  </button>

                  <button
                    type="button"
                    className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-4 text-sm font-semibold text-violet-700 transition hover:bg-violet-100"
                    onClick={() => setEditing(true)}
                  >
                    <Edit3 className="h-4 w-4" />
                    {english ? "Edit saved check" : "แก้ไขบันทึก"}
                  </button>

                  <button
                    type="button"
                    className="btn-primary min-h-10 px-5"
                    onClick={onNewCheck}
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    {english ? "Start new check" : "เริ่มตรวจใหม่"}
                  </button>
                </>
              )}
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}

function ProblemRow({
  item,
  draft,
  requirement,
  english
}: {
  item: InspectionItem;
  draft: DraftState | undefined;
  requirement: Requirement | null;
  english: boolean;
}) {
  const missing = draft?.status === "missing";
  const label = requirement
    ? english
      ? requirement.name_en
      : requirement.name_th
    : english
      ? "Safety item"
      : "รายการความปลอดภัย";

  return (
    <div className="px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-lg">
          {requirement ? itemEmoji[requirement.code] ?? "⚠️" : "⚠️"}
        </div>

        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-slate-900">{label}</p>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                missing
                  ? "bg-rose-100 text-rose-700"
                  : "bg-amber-100 text-amber-700"
              }`}
            >
              {missing
                ? english
                  ? "MISSING"
                  : "ไม่มี"
                : english
                  ? "DAMAGED"
                  : "ชำรุด"}
            </span>
          </div>

          <p className="mt-1 text-sm text-slate-600">
            {draft?.notes ||
              (english ? "No issue note recorded." : "ไม่ได้ระบุรายละเอียดปัญหา")}
          </p>
        </div>
      </div>
    </div>
  );
}

function SavedItemRow({
  item,
  draft,
  requirement,
  english
}: {
  item: InspectionItem;
  draft: DraftState | undefined;
  requirement: Requirement | null;
  english: boolean;
}) {
  const label = requirement
    ? english
      ? requirement.name_en
      : requirement.name_th
    : english
      ? "Safety item"
      : "รายการความปลอดภัย";

  const status = draft?.status ?? "ok";

  const tone =
    status === "ok"
      ? "text-emerald-700 bg-emerald-50"
      : status === "damaged"
        ? "text-amber-700 bg-amber-50"
        : "text-rose-700 bg-rose-50";

  const statusText =
    status === "ok"
      ? english
        ? "OK"
        : "ปกติ"
      : status === "damaged"
        ? english
          ? "Damaged"
          : "ชำรุด"
        : english
          ? "Missing"
          : "ไม่มี";

  return (
    <div className="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_120px] sm:items-center">
      <div className="flex items-center gap-3">
        <span className="text-lg">
          {requirement ? itemEmoji[requirement.code] ?? "✅" : "✅"}
        </span>
        <span className="text-sm font-medium text-slate-800">{label}</span>
      </div>

      <span
        className={`rounded-full px-3 py-1 text-center text-xs font-semibold ${tone}`}
      >
        {statusText}
      </span>
    </div>
  );
}

function EditableItemRow({
  item,
  draft,
  requirement,
  english,
  onStatus,
  onNotes
}: {
  item: InspectionItem;
  draft: DraftState | undefined;
  requirement: Requirement | null;
  english: boolean;
  onStatus: (status: DraftState["status"]) => void;
  onNotes: (value: string) => void;
}) {
  if (!requirement || !draft) return null;

  const hasProblem =
    draft.status === "damaged" || draft.status === "missing";

  return (
    <div
      className={`px-4 py-3 ${
        draft.status === "ok"
          ? "bg-emerald-50/25"
          : draft.status === "damaged"
            ? "bg-amber-50/35"
            : "bg-rose-50/35"
      }`}
    >
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_330px] lg:items-center">
        <div className="flex items-center gap-3">
          <span className="text-xl">{itemEmoji[requirement.code] ?? "✅"}</span>
          <p className="font-semibold text-slate-900">
            {english ? requirement.name_en : requirement.name_th}
          </p>
        </div>

        <div>
          <p className="mb-1 text-[9px] font-bold uppercase tracking-[0.1em] text-slate-400">
            {english ? "Condition" : "สภาพ"}
          </p>
          <div className="grid grid-cols-3 gap-2">
            <EditStatusButton
              active={draft.status === "ok"}
              tone="ok"
              label={english ? "OK" : "ปกติ"}
              onClick={() => onStatus("ok")}
            />
            <EditStatusButton
              active={draft.status === "damaged"}
              tone="damaged"
              label={english ? "Damaged" : "ชำรุด"}
              onClick={() => onStatus("damaged")}
            />
            <EditStatusButton
              active={draft.status === "missing"}
              tone="missing"
              label={english ? "Missing" : "ไม่มี"}
              onClick={() => onStatus("missing")}
            />
          </div>
        </div>
      </div>

      {hasProblem ? (
        <textarea
          className="form-input mt-2.5 min-h-[62px] bg-white"
          value={draft.notes}
          onChange={(event) => onNotes(event.target.value)}
          placeholder={
            english
              ? "Required: describe what is wrong..."
              : "จำเป็น: ระบุรายละเอียดปัญหา..."
          }
        />
      ) : null}
    </div>
  );
}

function EditStatusButton({
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
  const selected = {
    ok: "border-emerald-500 bg-emerald-100 text-emerald-900",
    damaged: "border-amber-500 bg-amber-100 text-amber-900",
    missing: "border-rose-500 bg-rose-100 text-rose-900"
  };

  const idle = {
    ok: "border-emerald-200 bg-white text-emerald-700",
    damaged: "border-amber-200 bg-white text-amber-700",
    missing: "border-rose-200 bg-white text-rose-700"
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-9 rounded-xl border px-2 text-xs font-semibold transition ${
        active ? selected[tone] : idle[tone]
      }`}
    >
      {tone === "ok" ? "✓ " : tone === "damaged" ? "⚠ " : "✕ "}
      {label}
    </button>
  );
}

function SummaryStat({
  label,
  value,
  tone
}: {
  label: string;
  value: number;
  tone: "emerald" | "amber" | "rose";
}) {
  const styles = {
    emerald: "border-emerald-200 bg-emerald-50/70 text-emerald-800",
    amber: "border-amber-200 bg-amber-50/70 text-amber-800",
    rose: "border-rose-200 bg-rose-50/70 text-rose-800"
  };

  return (
    <div className={`rounded-2xl border p-3.5 ${styles[tone]}`}>
      <p className="text-[10px] font-bold uppercase tracking-[0.12em] opacity-70">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );
}

function getStatusMeta(
  status: "ready" | "attention" | "not_ready",
  english: boolean
) {
  if (status === "ready") {
    return {
      title: english ? "Vehicle ready" : "รถพร้อมใช้งาน",
      description: english
        ? "No safety problems are recorded on this inspection."
        : "ไม่พบปัญหาด้านความปลอดภัยในการตรวจครั้งนี้",
      panelClass: "border-emerald-200 bg-emerald-50 text-emerald-900",
      icon: <ShieldCheck className="h-5 w-5" />
    };
  }

  if (status === "attention") {
    return {
      title: english ? "Attention required" : "ต้องดำเนินการ",
      description: english
        ? "Damaged safety equipment needs follow-up."
        : "พบอุปกรณ์ความปลอดภัยชำรุดที่ต้องติดตาม",
      panelClass: "border-amber-200 bg-amber-50 text-amber-900",
      icon: <AlertTriangle className="h-5 w-5" />
    };
  }

  return {
    title: english ? "Vehicle not ready" : "รถไม่พร้อมใช้งาน",
    description: english
      ? "Required safety equipment is missing."
      : "พบอุปกรณ์ความปลอดภัยที่จำเป็นสูญหาย",
    panelClass: "border-rose-200 bg-rose-50 text-rose-900",
    icon: <XCircle className="h-5 w-5" />
  };
}

function formatDate(value: string, english: boolean) {
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
