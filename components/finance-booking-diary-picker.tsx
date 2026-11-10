"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ADMIN_RECEIPT_FIELDS,
  nextUnlinkedDiaryBookingId,
  officeJobReference,
  parseOptionalReceiptThb,
  type AdminReceipts,
  type DiaryBookingSeed
} from "@/lib/finance-demo-centre";
import FinanceAdminReceiptFields, { emptyReceiptDraft } from "@/components/finance-admin-receipt-fields";
import { supabase, supabaseConfigError } from "@/lib/supabase";
import { intakePageBounds, intakeSearchLiteral, intakeStatusIds, type IntakeQuery } from "@/lib/finance-intake-query";
import type { Booking } from "@/lib/finance-demo-centre";

export type DiaryPickerRow = DiaryBookingSeed & {
  alreadyLinked: boolean;
  reconciliationStatus: string;
};

type StatusFilter = "all" | "available" | "linked" | "pending" | "verified";

type Props = {
  open: boolean;
  onClose: () => void;
  linkedIds: Set<string>;
  linkedStatusById: Map<string, string>;
  linkedWorkOrderById?: Map<string, string>;
  linkedCustomerJobNumberById?: Map<string, string>;
  onConfirm: (seeds: DiaryBookingSeed[]) => void;
  onAddWorkOrder: (seed: DiaryBookingSeed, workOrder: string, receipts: AdminReceipts, keepOpen: boolean) => Promise<void>;
  canAdd: boolean;
  accessLoading?: boolean;
  t: (en: string, th: string) => string;
  statusLabel: (status: string) => string;
};

export type DiaryPickerLoadOptions = {
  dateFrom?: string;
  dateTo?: string;
};

export const BOOKING_DIARY_FINANCE_FIELDS =
  "*,id,booking_id,client_id,booking_date,pickup_time,pickup,dropoff,driver,vehicle,vehicle_registration,job_order_number,notes,status,trailer_registration,client:clients(name)";

const PAGE_SIZE = 1000;

/** One bounded PostgREST page; database RLS and the authenticated client remain authoritative. */
export async function loadBookingDiaryIntakePage(options: IntakeQuery, bookings: Booking[]) {
  const empty = (error: string) => ({ rows: [] as DiaryBookingSeed[], count: 0, error });
  if (supabaseConfigError) return empty(supabaseConfigError);
  if (options.dateFrom && options.dateTo && options.dateFrom > options.dateTo) return empty("FINANCE_INTAKE_DATE_RANGE");
  const { from, to } = intakePageBounds(options.page, options.pageSize);
  let query = supabase.from("booking_diary")
    .select(options.customer ? BOOKING_DIARY_FINANCE_FIELDS.replace("client:clients(name)", "client:clients!inner(name)") : BOOKING_DIARY_FINANCE_FIELDS, { count: "exact" })
    .order("booking_date", { ascending: false }).order("pickup_time", { ascending: true }).order("id", { ascending: true })
    .range(from, to);
  if (options.dateFrom) query = query.gte("booking_date", options.dateFrom);
  if (options.dateTo) query = query.lte("booking_date", options.dateTo);
  if (options.vehicle) query = query.or(`vehicle_registration.ilike.%${intakeSearchLiteral(options.vehicle)}%,vehicle.ilike.%${intakeSearchLiteral(options.vehicle)}%`);
  if (options.customer) query = query.ilike("client.name", `%${intakeSearchLiteral(options.customer)}%`);
  if (options.driver) query = query.ilike("driver", `%${intakeSearchLiteral(options.driver)}%`);
  if (options.status !== "all") {
    const ids = intakeStatusIds(bookings, options.status);
    if (options.status !== "waiting" && !ids.length) return empty("");
    if (ids.length) query = options.status === "waiting" ? query.not("id", "in", `(${ids.join(",")})`) : query.in("id", ids);
  }
  const q = intakeSearchLiteral(options.search);
  if (q) {
    // Customer names live in clients; resolve only matching IDs, never the Booking Diary.
    const clients: string[] = [];
    for (let offset = 0; ; offset += 1000) {
      const result = await supabase.from("clients").select("id").ilike("name", `%${q}%`).order("id").range(offset, offset + 999);
      if (result.error) return empty(result.error.message);
      clients.push(...(result.data || []).map(row => String(row.id)));
      if ((result.data || []).length < 1000) break;
    }
    const linkedIds = bookings.filter(job => [confirmedWorkOrderForSearch(job), job.adminReceipts?.customerJobNumber].some(value => value?.toLowerCase().includes(q.toLowerCase()))).map(job => job.id);
    const parts = ["booking_id", "driver", "vehicle", "vehicle_registration", "pickup", "dropoff", "job_order_number"].map(field => `${field}.ilike.%${q}%`);
    if (clients.length) parts.push(`client_id.in.(${clients.join(",")})`);
    if (linkedIds.length) parts.push(`id.in.(${linkedIds.join(",")})`);
    if (/^\d{4}-\d{2}-\d{2}$/.test(q)) parts.push(`booking_date.eq.${q}`);
    query = query.or(parts.join(","));
  }
  const { data, count, error } = await query;
  if (error) return empty(error.message);
  if (count == null) return empty("FINANCE_INTAKE_COUNT_UNAVAILABLE");
  return { rows: ((data || []) as unknown as Record<string, unknown>[]).map(toDiaryPickerSeed), count, error: "" };
}

function confirmedWorkOrderForSearch(job: Booking) { return job.workOrderConfirmed ? job.returned.workOrder.trim() : ""; }

/** Display Booking Diary calendar dates as DD/MM/YYYY for office users. Internal filters stay ISO. */
export function formatDiaryDateDisplay(isoDate: string | null | undefined) {
  const value = String(isoDate || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value || "—";
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function clientName(row: {
  client?: { name?: string | null } | { name?: string | null }[] | null;
}) {
  const rel = Array.isArray(row.client) ? row.client[0] : row.client;
  return rel?.name ?? null;
}

export function toDiaryPickerSeed(row: Record<string, unknown>): DiaryBookingSeed {
  return {
    id: String(row.id),
    booking_id: (row.booking_id as string | null) ?? null,
    client_id: (row.client_id as string | null) ?? null,
    client_name: clientName(row as { client?: { name?: string | null } | { name?: string | null }[] | null }),
    booking_date: String(row.booking_date || ""),
    pickup_time: (row.pickup_time as string | null) ?? null,
    pickup: String(row.pickup || ""),
    dropoff: String(row.dropoff || ""),
    driver: (row.driver as string | null) ?? null,
    vehicle: (row.vehicle as string | null) ?? null,
    vehicle_registration: (row.vehicle_registration as string | null) ?? null,
    customer_job_number: (row.customer_job_number as string | null) ?? null,
    job_order_number: (row.job_order_number as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    diary_status: (row.status as string | null) ?? null,
    trailer_registration: (row.trailer_registration as string | null) ?? null
  };
}

/**
 * Load Booking Diary rows for Finance selection.
 * Uses the same authoritative `booking_diary` table as Booking Diary.
 * Date filters are applied server-side on the calendar `booking_date` (inclusive ISO YYYY-MM-DD).
 * Pages through the full result set — never truncates to a recent-only window before filtering.
 */
export async function loadBookingDiaryPickerRows(
  options: DiaryPickerLoadOptions = {}
): Promise<{ rows: DiaryBookingSeed[]; error: string }> {
  if (supabaseConfigError) return { rows: [], error: supabaseConfigError };

  const dateFrom = String(options.dateFrom || "").trim();
  const dateTo = String(options.dateTo || "").trim();
  if (dateFrom && !/^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) {
    return { rows: [], error: "From date must be a valid calendar date." };
  }
  if (dateTo && !/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
    return { rows: [], error: "To date must be a valid calendar date." };
  }
  if (dateFrom && dateTo && dateFrom > dateTo) {
    return { rows: [], error: "From date cannot be after the to date." };
  }

  const rows: DiaryBookingSeed[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabase
      .from("booking_diary")
      .select(BOOKING_DIARY_FINANCE_FIELDS)
      .order("booking_date", { ascending: false })
      .order("pickup_time", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (dateFrom) query = query.gte("booking_date", dateFrom);
    if (dateTo) query = query.lte("booking_date", dateTo);

    const { data, error } = await query;
    if (error) {
      return {
        rows: [],
        error: error.message || "Unable to load Booking Diary jobs. Check your connection and try again."
      };
    }

    const page = ((data as Record<string, unknown>[]) || []).map(toDiaryPickerSeed);
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }

  return { rows, error: "" };
}

function financeBadgeClass(linked: boolean, status: string) {
  if (!linked) return "bg-emerald-50 text-emerald-800 ring-emerald-200";
  if (status === "verified") return "bg-violet-100 text-violet-900 ring-violet-300";
  if (status === "discrepancy") return "bg-amber-100 text-amber-950 ring-amber-300";
  if (status === "needs_recheck") return "bg-sky-100 text-sky-950 ring-sky-300";
  if (status === "missing_paperwork") return "bg-orange-50 text-orange-900 ring-orange-200";
  return "bg-slate-100 text-slate-800 ring-slate-300";
}

function financeBadgeLabel(
  linked: boolean,
  status: string,
  t: (en: string, th: string) => string,
  statusLabel: (status: string) => string
) {
  if (!linked) return t("Available", "พร้อมเลือก");
  if (status === "verified") return t("Verified", "ตรวจแล้ว");
  if (status === "pending") return t("Awaiting check", "รอตรวจ");
  if (status === "missing_paperwork") return t("Awaiting paperwork", "รอเอกสาร");
  return statusLabel(status) || t("Already linked", "เชื่อมแล้ว");
}

export default function FinanceBookingDiaryPicker({
  open,
  onClose,
  linkedIds,
  linkedStatusById,
  linkedWorkOrderById,
  linkedCustomerJobNumberById,
  onConfirm,
  onAddWorkOrder,
  canAdd,
  accessLoading = false,
  t,
  statusLabel
}: Props) {
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [rows, setRows] = useState<DiaryBookingSeed[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [loadToken, setLoadToken] = useState(0);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [workOrder, setWorkOrder] = useState("");
  const [customerJobNumber, setCustomerJobNumber] = useState("");
  const [entryError, setEntryError] = useState("");
  const [amounts, setAmounts] = useState(emptyReceiptDraft);
  const [receiptNotes, setReceiptNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState("");

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog?.showModal();
    return () => {
      dialog?.close();
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [open]);

  useEffect(() => { setWorkOrder(""); setEntryError(""); setAmounts(emptyReceiptDraft()); setReceiptNotes(""); }, [activeId, open]);

  useEffect(() => {
    if (!open) {
      setActiveId(null);
      setSearch("");
      setDateFrom("");
      setDateTo("");
      setStatusFilter("all");
      setRows([]);
      setError("");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setError("");
    const timer = window.setTimeout(() => {
      void loadBookingDiaryPickerRows({ dateFrom, dateTo }).then((result) => {
        if (!active) return;
        setRows(result.rows);
        setError(result.error);
        setLoading(false);
      });
    }, dateFrom || dateTo ? 200 : 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [open, dateFrom, dateTo, loadToken]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      const linked = linkedIds.has(row.id);
      const financeStatus = linkedStatusById.get(row.id) || "";
      if (statusFilter === "available" && linked) return false;
      if (statusFilter === "linked" && !linked) return false;
      if (statusFilter === "pending" && !(linked && (financeStatus === "pending" || financeStatus === "missing_paperwork"))) {
        return false;
      }
      if (statusFilter === "verified" && !(linked && financeStatus === "verified")) return false;
      if (!q) return true;
      const linkedWo = linkedWorkOrderById?.get(row.id) || "";
      const hay = [
        row.booking_date,
        formatDiaryDateDisplay(row.booking_date),
        row.booking_id,
        row.client_name,
        row.pickup,
        row.dropoff,
        row.driver,
        row.vehicle,
        row.vehicle_registration,
        row.job_order_number,
        row.customer_job_number,
        row.notes,
        row.diary_status,
        linkedWo,
        linkedCustomerJobNumberById?.get(row.id),
        row.id
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [rows, search, statusFilter, linkedIds, linkedStatusById, linkedWorkOrderById, linkedCustomerJobNumberById]);

  // Keep the active row in the visible list; otherwise preselect the first match.
  useEffect(() => {
    if (!filtered.length) {
      setActiveId(null);
      return;
    }
    if (activeId && filtered.some((row) => row.id === activeId)) return;
    setActiveId(filtered[0].id);
  }, [filtered, activeId]);

  const linkedInView = useMemo(
    () => filtered.reduce((count, row) => count + (linkedIds.has(row.id) ? 1 : 0), 0),
    [filtered, linkedIds]
  );

  const preview = filtered.find((row) => row.id === activeId) || null;
  const sourceCustomerJobNumber = preview?.customer_job_number || "";
  useEffect(() => { setCustomerJobNumber(sourceCustomerJobNumber); }, [activeId, open, sourceCustomerJobNumber]);
  const previewLinked = preview ? linkedIds.has(preview.id) : false;
  const previewFinanceStatus = preview ? linkedStatusById.get(preview.id) || "pending" : "";
  const previewLinkedWo = preview ? linkedWorkOrderById?.get(preview.id) || "" : "";

  const emptyMessage = (() => {
    if (loading) return null;
    if (error) return null;
    if (rows.length === 0 && (dateFrom || dateTo)) {
      return t("No Booking Diary jobs in this date range.", "ไม่พบงานในสมุดจองในช่วงวันที่นี้");
    }
    if (rows.length === 0) return t("No Booking Diary jobs found.", "ไม่พบงานในสมุดจอง");
    if (filtered.length === 0 && (search.trim() || statusFilter !== "all")) {
      return t("No bookings match this filter.", "ไม่พบรายการที่ตรงกับตัวกรอง");
    }
    return t("No bookings to show.", "ไม่มีรายการให้แสดง");
  })();

  const chips: { id: StatusFilter; en: string; th: string }[] = [
    { id: "all", en: "All", th: "ทั้งหมด" },
    { id: "available", en: "Available only", th: "พร้อมเลือกเท่านั้น" },
    { id: "linked", en: "Already linked", th: "เชื่อมแล้ว" },
    { id: "pending", en: "Awaiting check", th: "รอตรวจ" },
    { id: "verified", en: "Verified", th: "ตรวจแล้ว" }
  ];

  const confirmActive = async (keepOpen = false) => {
    if (!preview || saving) return;
    setEntryError(""); setSavedMessage("");
    try {
      if (previewLinked) onConfirm([preview]);
      else {
        if (!canAdd || workOrder.trim().length < 3) return;
        if ([...(linkedWorkOrderById?.values() || [])].some((value) => value.trim() === workOrder.trim())) {
          setEntryError(t("This work order is already linked to another job.", "เลขที่ใบงานนี้เชื่อมกับงานอื่นแล้ว"));
          return;
        }
        const receiptAmounts = Object.fromEntries(ADMIN_RECEIPT_FIELDS.map((kind) => [kind, parseOptionalReceiptThb(amounts[kind])])) as AdminReceipts["amounts"];
        setSaving(true);
        await onAddWorkOrder(preview, workOrder.trim(), { amounts: receiptAmounts, notes: receiptNotes, customerJobNumber }, keepOpen);
        if (keepOpen) {
          const nextId = nextUnlinkedDiaryBookingId(filtered, linkedIds, preview.id);
          setActiveId(nextId);
          setWorkOrder(""); setAmounts(emptyReceiptDraft()); setReceiptNotes("");
          setSavedMessage(t(`Saved work order ${workOrder.trim()}. ${nextId ? "Ready for the next job." : "No further unlinked jobs match this filter."}`, `บันทึกใบงาน ${workOrder.trim()} แล้ว ${nextId ? "พร้อมรับงานถัดไป" : "ไม่มีงานที่ยังไม่เชื่อมตามตัวกรองนี้"}`));
          return;
        }
      }
      onClose();
    } catch (caught) {
      setEntryError(caught instanceof Error && caught.message === "FINANCE_RECEIPT_AMOUNT_INVALID"
        ? t("Enter THB amounts with up to two decimals, or leave blank. Negative amounts and commas are not accepted.", "กรอกจำนวนบาททศนิยมไม่เกินสองตำแหน่ง หรือเว้นว่าง ไม่รับค่าติดลบและเครื่องหมายจุลภาค")
        : t("Save was not confirmed. Your entries are kept here; check the connection, Admin access and duplicate numbers, then retry.", "ยังยืนยันการบันทึกไม่ได้ ข้อมูลที่กรอกยังอยู่ โปรดตรวจการเชื่อมต่อ สิทธิ์ผู้ดูแล และเลขซ้ำ แล้วลองอีกครั้ง"));
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      onCancel={(event) => { event.preventDefault(); if (!saving) onClose(); }}
      className="m-auto max-h-[96vh] w-[calc(100%-1rem)] max-w-6xl overflow-hidden bg-transparent p-0 backdrop:bg-slate-950/45"
      role="dialog"
      aria-modal="true"
      aria-label={t("Select Booking Diary Jobs", "เลือกงานจากสมุดจอง")}
    >
      <div className="flex h-[94dvh] max-h-[94dvh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-violet-100 bg-white shadow-2xl">
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-violet-100 bg-violet-50/70 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-violet-950">{t("Select Booking Diary Jobs", "เลือกงานจากสมุดจอง")}</h2>
            <p className="mt-1 text-xs text-slate-600">
              {t(
                "Office records the original booking in Booking Diary. Admin uses the returned signed green order to verify it and enter optional receipt-backed charges.",
                "สำนักงานบันทึกงานต้นฉบับในสมุดจอง ผู้ดูแลใช้ใบสั่งงานสีเขียวที่ลงนามและส่งคืนเพื่อตรวจสอบและกรอกค่าใช้จ่ายจากใบเสร็จเมื่อมี"
              )}
            </p>
          </div>
          <button
            type="button"
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700"
            onClick={onClose} disabled={saving}
          >
            {t("Close", "ปิด")}
          </button>
        </header>

        <div className="space-y-2 border-b border-slate-100 px-4 py-3 sm:px-5">
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_9rem_auto]">
            <input
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder={t(
                "Search customer, driver, vehicle, job no., WO…",
                "ค้นหาลูกค้า คนขับ ทะเบียน เลขงาน ใบสั่งงาน…"
              )}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label={t("Search bookings", "ค้นหารายการจอง")}
            />
            <input
              type="date"
              className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              aria-label={t("From date", "ตั้งแต่วันที่")}
            />
            <input
              type="date"
              className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              aria-label={t("To date", "ถึงวันที่")}
            />
            <button
              type="button"
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60"
              onClick={() => setLoadToken((value) => value + 1)}
              disabled={loading}
            >
              {t("Refresh", "รีเฟรช")}
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("Quick filters", "ตัวกรองด่วน")}>
            {chips.map((chip) => {
              const active = statusFilter === chip.id;
              return (
                <button
                  key={chip.id}
                  type="button"
                  className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 transition ${
                    active
                      ? "bg-violet-800 text-white ring-violet-800"
                      : "bg-white text-slate-700 ring-slate-200 hover:bg-violet-50"
                  }`}
                  aria-pressed={active}
                  onClick={() => setStatusFilter(chip.id)}
                >
                  {t(chip.en, chip.th)}
                </button>
              );
            })}
          </div>
        </div>

        {error ? (
          <p role="alert" className="mx-4 mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 sm:mx-5">
            {error}
          </p>
        ) : null}

        <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1.15fr)_minmax(300px,0.85fr)]">
          <div className="min-h-0 overflow-y-auto overflow-x-hidden border-b border-slate-100 px-3 py-3 sm:px-4 lg:border-b-0 lg:border-r">
            {loading ? (
              <p className="p-3 text-sm text-slate-500">{t("Loading Booking Diary…", "กำลังโหลดสมุดจอง…")}</p>
            ) : error ? (
              <p className="p-3 text-sm text-rose-800">
                {t(
                  "Could not load Booking Diary jobs. Fix the error above and refresh.",
                  "โหลดสมุดจองไม่สำเร็จ แก้ไขข้อผิดพลาดด้านบนแล้วรีเฟรช"
                )}
              </p>
            ) : filtered.length === 0 ? (
              <p className="p-3 text-sm text-slate-500">{emptyMessage}</p>
            ) : (
              <ul className="space-y-2" aria-label={t("Matching bookings", "รายการจองที่ตรงกัน")}>
                {filtered.map((row) => {
                  const linked = linkedIds.has(row.id);
                  const financeStatus = linkedStatusById.get(row.id) || "pending";
                  const isActive = activeId === row.id;
                  const reg = row.vehicle_registration || row.vehicle || "—";
                  const linkedWo = linkedWorkOrderById?.get(row.id);
                  return (
                    <li key={row.id}>
                      <button
                        type="button"
                        onClick={() => setActiveId(row.id)} disabled={saving}
                        className={`w-full rounded-xl border px-3 py-3 text-left transition ${
                          isActive
                            ? "border-violet-400 bg-violet-50 shadow-sm ring-1 ring-violet-300"
                            : linked
                              ? "border-slate-200 bg-slate-50/80 hover:border-violet-200 hover:bg-violet-50/40"
                              : "border-slate-200 bg-white hover:border-violet-200 hover:bg-violet-50/50"
                        }`}
                        aria-current={isActive ? "true" : undefined}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="break-words text-base font-bold leading-relaxed text-slate-950">
                              {row.client_name || t("Not recorded", "ไม่ได้บันทึก")}
                              <span className="mx-1.5 font-normal text-slate-400">·</span>
                              <span className="text-sm font-semibold text-slate-800">{formatDiaryDateDisplay(row.booking_date)}</span>
                            </p>
                          </div>
                          <span
                            className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold ring-1 ${financeBadgeClass(linked, financeStatus)}`}
                          >
                            {financeBadgeLabel(linked, financeStatus, t, statusLabel)}
                          </span>
                        </div>
                        <p className="mt-1.5 text-sm font-medium leading-snug text-slate-800">
                          <span className="break-words">{row.pickup || "—"}</span>
                          <span className="mx-1.5 text-violet-500">→</span>
                          <span className="break-words">{row.dropoff || "—"}</span>
                        </p>
                        <p className="mt-2 text-sm leading-relaxed text-slate-800">
                          <span className="text-[15px] font-bold text-slate-950">
                            {t("Reg", "ทะเบียน")}: {reg}
                          </span>
                          <span className="mx-1.5 text-slate-300">•</span>
                          <span>
                            {t("Driver", "คนขับ")}: {row.driver || "—"}
                          </span>
                        </p>
                        <p className="mt-2 break-words text-lg font-bold leading-relaxed text-violet-950">
                          {t("Work Order", "เลขที่ใบงาน")}: {linkedWo || t("Not entered", "ยังไม่ได้กรอก")}
                        </p>
                        {linked ? <p className="mt-1 text-xs font-semibold text-violet-900">{t("Already linked — cannot duplicate", "เชื่อมแล้ว — ห้ามซ้ำ")}</p> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <aside className="min-h-0 overflow-y-auto bg-slate-50/90 px-4 py-4 sm:px-5">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-base font-bold text-violet-950">{t("Booking details", "รายละเอียดการจอง")}</h3>
              {preview ? (
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-bold ring-1 ${financeBadgeClass(previewLinked, previewFinanceStatus)}`}
                >
                  {financeBadgeLabel(previewLinked, previewFinanceStatus, t, statusLabel)}
                </span>
              ) : null}
            </div>

            {!preview ? (
              <p className="mt-3 text-sm text-slate-500">
                {t("Select a booking to preview its details.", "เลือกงานเพื่อดูรายละเอียด")}
              </p>
            ) : (
              <>
                <p className="mt-2 text-base font-bold leading-relaxed text-slate-950">
                  {preview.client_name || t("Not recorded", "ไม่ได้บันทึก")} · {formatDiaryDateDisplay(preview.booking_date)}
                </p>
                <p className="mt-1 text-sm leading-snug text-slate-700">
                  {preview.pickup || "—"} <span className="text-violet-500">→</span> {preview.dropoff || "—"}
                </p>
                <p className="mt-2 text-[15px] font-semibold text-slate-950">{t("Vehicle", "ทะเบียนรถ")}: {preview.vehicle_registration || "—"}</p>
                <p className="mt-1 text-sm text-slate-900">{t("Driver", "คนขับ")}: {preview.driver || "—"}</p>
                {previewLinked ? <p className="mt-3 text-lg font-bold text-violet-950">{t("Work Order", "เลขที่ใบงาน")}: {previewLinkedWo || t("Not entered", "ยังไม่ได้กรอก")}</p> : null}

                {previewLinked ? <p className="mt-2 break-words text-base"><strong>{t("Customer Job Number", "เลขที่งานลูกค้า")}: </strong>{linkedCustomerJobNumberById?.has(preview.id) ? linkedCustomerJobNumberById.get(preview.id) || "—" : sourceCustomerJobNumber || "—"}</p> : null}
                {!previewLinked ? (
                  <label className="mt-3 block text-sm font-semibold text-violet-950">
                    {t("Green-paper Work Order Number", "เลขที่ใบงานสีเขียว")}
                    <input type="text" className="mt-1 w-full rounded-lg border border-violet-400 px-3 py-2 text-lg font-bold"
                      value={workOrder} onChange={(event) => { setWorkOrder(event.target.value); setEntryError(""); }}
                      disabled={!canAdd || saving} autoComplete="off" />
                    <span className="mt-1 block text-xs font-normal text-slate-500">
                      {t("Enter the actual printed number. This does not verify the job.", "กรอกเลขที่พิมพ์บนใบงาน การกรอกนี้ยังไม่ใช่การตรวจยืนยันงาน")}
                    </span>
                    {accessLoading ? <span role="status" className="text-xs text-slate-500">{t("Checking account permissions…", "กำลังตรวจสอบสิทธิ์บัญชี…")}</span> : !canAdd ? <span className="text-xs text-amber-800">{t("Admin access required.", "ต้องใช้สิทธิ์ผู้ดูแล")}</span> : null}
                  </label>
                ) : null}
                {!previewLinked ? <label className="mt-3 block text-sm font-semibold text-slate-800">
                  {t("Customer Job Number (optional)", "เลขที่งานลูกค้า (ไม่บังคับ)")}
                  <input type="text" autoComplete="off" className="mt-1 w-full rounded-lg border border-slate-400 px-3 py-2 text-base"
                    value={customerJobNumber} onChange={(event) => setCustomerJobNumber(event.target.value)} disabled={!canAdd || saving} />
                  {sourceCustomerJobNumber && customerJobNumber.trim() !== sourceCustomerJobNumber.trim() ? <span className="mt-1 block text-sm text-amber-800">
                    {t("Different from Booking Diary; retained for reconciliation", "ต่างจากสมุดจอง เก็บไว้เพื่อกระทบยอด")}: {sourceCustomerJobNumber}
                  </span> : null}
                </label> : null}
                {!previewLinked ? <FinanceAdminReceiptFields amounts={amounts} notes={receiptNotes} disabled={!canAdd || saving}
                  onAmount={(kind, value) => setAmounts((current) => ({ ...current, [kind]: value }))}
                  onNotes={setReceiptNotes} t={t} /> : null}
                {entryError ? <p role="alert" className="mt-2 text-sm text-rose-800">{entryError}</p> : null}
                <details className="mt-4">
                  <summary className="cursor-pointer text-sm font-semibold text-violet-900">{t("More booking details / source references", "รายละเอียดเพิ่มเติม / ข้อมูลอ้างอิงต้นทาง")}</summary>
                <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  {(
                    [
                      [t("Booking date", "วันที่จอง"), formatDiaryDateDisplay(preview.booking_date)],
                      [t("Pickup time", "เวลารับ"), preview.pickup_time || "—"],
                      [t("Customer", "ลูกค้า"), preview.client_name || "—"],
                      [t("Pickup", "จุดรับ"), preview.pickup || "—"],
                      [t("Delivery", "จุดส่ง"), preview.dropoff || "—"],
                      [t("Vehicle registration", "ทะเบียนรถ"), preview.vehicle_registration || "—"],
                      [t("Vehicle type", "ประเภทรถ"), preview.vehicle || "—"],
                      [t("Trailer", "พ่วง"), preview.trailer_registration || t("None", "ไม่มี")],
                      [t("Driver", "คนขับ"), preview.driver || "—"],
                      [t("Job number", "เลขงาน"), officeJobReference(preview.booking_id) || t("Not recorded", "ไม่ได้บันทึก")],
                      [t("Internal booking reference", "รหัสอ้างอิงภายใน"), preview.booking_id || "—"],
                      [
                        t("Provisional WO on diary", "เลขใบสั่งงานในสมุดจอง (ชั่วคราว)"),
                        preview.job_order_number || t("Blank", "ว่าง")
                      ],
                      [t("Booking status", "สถานะการจอง"), preview.diary_status || "—"],
                      [
                        t("Finance status", "สถานะการเงิน"),
                        previewLinked
                          ? financeBadgeLabel(true, previewFinanceStatus, t, statusLabel)
                          : t("Available", "พร้อมเลือก")
                      ],
                      [
                        t("Linked work order", "ใบสั่งงานที่เชื่อมแล้ว"),
                        previewLinkedWo || t("Not linked yet", "ยังไม่เชื่อม")
                      ],
                      [t("Notes", "หมายเหตุ"), preview.notes?.trim() || t("None", "ไม่มี")]
                    ] as [string, string][]
                  ).map(([label, value]) => (
                    <div key={label} className="border-b border-slate-200/80 pb-2 last:border-b-0">
                      <dt className="text-xs font-bold text-slate-700">{label}</dt>
                      <dd className="mt-0.5 break-words font-semibold text-slate-900">{value}</dd>
                    </div>
                  ))}
                </dl>
                </details>

                {previewLinked ? (
                  <p className="mt-4 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-medium text-violet-950">
                    {t(
                      "This booking is already in Finance Centre. Opening it will not create a duplicate.",
                      "งานนี้มีในศูนย์การเงินแล้ว การเปิดจะไม่สร้างรายการซ้ำ"
                    )}
                  </p>
                ) : (
                  <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-950">
                    {t(
                      "Confirm this is the correct Booking Diary job before adding it.",
                      "ยืนยันว่างานนี้ถูกต้องก่อนเพิ่มเข้าศูนย์การเงิน"
                    )}
                  </p>
                )}
              </>
            )}

            <p className="mt-4 text-xs text-slate-500">
              {t(
                `${filtered.length} booking(s) shown · ${linkedInView} already linked`,
                `แสดง ${filtered.length} รายการ · เชื่อมแล้ว ${linkedInView} งาน`
              )}
            </p>
          </aside>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-violet-100 bg-white px-4 py-3 sm:px-5">
          <p role="status" className="max-w-xl text-sm text-slate-700">
            {saving ? t("Saving job, work order and receipt amounts…", "กำลังบันทึกงาน เลขที่ใบงาน และยอดใบเสร็จ…") : savedMessage ||
            t(
              "Single-select: click one booking, review the details, then confirm.",
              "เลือกทีละงาน: คลิกหนึ่งรายการ ตรวจรายละเอียด แล้วยืนยัน"
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={saving} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold" onClick={onClose}>
              {t("Cancel", "ยกเลิก")}
            </button>
            <button
              type="button"
              className="rounded-lg bg-violet-800 px-3 py-2 text-sm font-semibold text-white disabled:bg-slate-300"
              disabled={saving || !preview || (!previewLinked && (!canAdd || workOrder.trim().length < 3))}
              onClick={() => void confirmActive(false)}
            >
              {previewLinked
                ? t("Open existing reconciliation", "เปิดการกระทบยอดที่มีอยู่")
                : t("Save Job & Work Order", "บันทึกงานและเลขที่ใบงาน")}
            </button>
            <button type="button" className="rounded-lg border border-violet-400 bg-violet-50 px-3 py-2 text-sm font-bold text-violet-950 disabled:opacity-40"
              disabled={saving || !preview || previewLinked || !canAdd || workOrder.trim().length < 3}
              onClick={() => void confirmActive(true)}>{t("Save & Next Job", "บันทึกและไปงานถัดไป")}</button>
          </div>
        </footer>
      </div>
    </dialog>
  );
}

export async function countAvailableBookingDiaryJobs() {
  if (supabaseConfigError) return 0;
  const { count, error } = await supabase.from("booking_diary").select("id", { count: "exact", head: true });
  if (error) return 0;
  return count || 0;
}
