"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useFinanceFixture } from "@/components/finance-fixture-provider";
import { loadBookingDiaryIntakePage } from "@/components/finance-booking-diary-picker";
import { isFinanceFixtureMode } from "@/lib/finance-fixture-mode";
import { fixtureDiaryRowsBetween } from "@/lib/finance-fixture-diary-rows";
import {
  ADMIN_RECEIPT_FIELDS,
  confirmedWorkOrder,
  findWorkOrder,
  sheetTrnLabel,
  parseOptionalReceiptThb,
  type AdminReceiptKind,
  type AdminReceipts,
  type Booking,
  type DiaryBookingSeed,
  type IntakeCheck
} from "@/lib/finance-demo-centre";
import { displayVehicle, formatDocDate, formatUiDate, isLikelyTestBooking } from "@/lib/finance-display";
import { isBeforeFinanceStart, isValidFinanceStartDate } from "@/lib/finance-settings";
import { useFinanceSettings } from "@/lib/use-finance-settings";
import { FINANCE_CUTOVER_DATE, dayBefore } from "@/lib/finance-settings";
import { hasAuthenticatedFinanceAdminIntake } from "@/lib/finance-intake-access";
import { useAccountAccess } from "@/lib/use-account-access";
import { safeSessionStorage } from "@/lib/safe-browser-storage";
import { intakeDateRange, type IntakeDatePreset } from "@/lib/finance-intake-view";
import { fixtureIntakePage, type IntakeQuery } from "@/lib/finance-intake-query";
import { bangkokDate } from "@/lib/finance-demo-centre";

type T = (en: string, th: string) => string;
type Filter = IntakeQuery["status"];
type Draft = { issueCategory: string; workOrder: string; customerJobNumber: string; amounts: Record<AdminReceiptKind, string>; notes: string; check: IntakeCheck["result"] | ""; checkNote: string };
type Filters = { from: string; to: string; vehicle: string };
const FILTER_KEY = "ees-finance-intake-filters";
const readFilters = (): Filters | null => { try { const raw = safeSessionStorage.getItem(FILTER_KEY); const p = raw ? JSON.parse(raw) : null; return p && typeof p.from === "string" && typeof p.to === "string" && typeof p.vehicle === "string" ? p : null; } catch { return null; } };
const writeFilters = (value: Filters | null) => { if (value) safeSessionStorage.setItem(FILTER_KEY, JSON.stringify(value)); else safeSessionStorage.removeItem(FILTER_KEY); };

const emptyDraft = (): Draft => ({
  issueCategory: "Other", workOrder: "", customerJobNumber: "", notes: "", check: "", checkNote: "",
  amounts: Object.fromEntries(ADMIN_RECEIPT_FIELDS.map((kind) => [kind, ""])) as Draft["amounts"]
});
const MORE_KINDS: AdminReceiptKind[] = ["overtime", "container_pickup", "overnight", "other"];
const ISSUE_CATEGORIES = [
  ["Missing paperwork", "ขาดเอกสาร"], ["Missing Work Order Number", "ขาดเลขที่ใบงาน"],
  ["Wrong vehicle", "รถไม่ตรง"], ["Wrong customer", "ลูกค้าไม่ตรง"], ["Wrong date", "วันที่ไม่ตรง"],
  ["Route discrepancy", "เส้นทางไม่ตรง"], ["Missing attachment", "ขาดไฟล์แนบ"],
  ["Possible duplicate", "อาจซ้ำ"], ["Pricing discrepancy", "ราคาไม่ตรง"], ["Other", "อื่น ๆ"]
] as const;
const LABELS: Record<AdminReceiptKind, [string, string]> = {
  parking: ["Parking (THB)", "ค่าจอดรถ (บาท)"], toll: ["Toll (THB)", "ค่าทางด่วน (บาท)"], overtime: ["Overtime (THB)", "ค่าล่วงเวลา (บาท)"],
  container_pickup: ["Container pickup (THB)", "ค่ารับตู้ (บาท)"], overnight: ["Overnight (THB)", "ค่าค้างคืน (บาท)"], other: ["Other (THB)", "ค่าอื่น ๆ (บาท)"]
};
const PAGE = 50;

/**
 * Row source for Admin Intake. Only the isolated fixture mode (development, no Supabase credentials) uses synthetic rows;
 * everywhere else this is exactly the real, server-filtered and fully paginated Booking Diary loader.
 */
async function loadIntakeRows(options: IntakeQuery, bookings: Booking[]) {
  if (isFinanceFixtureMode()) return fixtureIntakePage(fixtureDiaryRowsBetween(options.dateFrom, options.dateTo), options, bookings);
  return loadBookingDiaryIntakePage(options, bookings);
}

type RowState = "awaiting" | "entered" | "flagged" | "ready";
const ROW_DOT: Record<RowState, string> = { awaiting: "bg-slate-300", entered: "bg-violet-500", flagged: "bg-amber-500", ready: "bg-emerald-500" };
/** Distinguishes jobs awaiting entry / with a work order / flagged for checking / confirmed and ready for Finance. */
export function intakeRowState(job: Booking | undefined, workOrder: string): RowState {
  if (isFlagged(job)) return "flagged";
  if (!workOrder) return "awaiting";
  return job?.status === "verified" ? "ready" : "entered";
}

export function isFlagged(job: Booking | undefined) {
  return !!job && (job.status === "discrepancy" || job.status === "needs_recheck" || !!job.financeCheck);
}

/** "Waiting for work order": no confirmed WO yet and dated on/after the Finance start date. */
export function isWaitingForWorkOrder(row: Pick<DiaryBookingSeed, "booking_date">, job: Booking | undefined, startDate: string) {
  if (job && confirmedWorkOrder(job)) return false;
  return !isBeforeFinanceStart(row.booking_date, startDate);
}

function draftFor(job: Booking | undefined, row: DiaryBookingSeed | undefined): Draft {
  const draft = emptyDraft();
  draft.customerJobNumber = job?.adminReceipts?.customerJobNumber !== undefined ? job.adminReceipts.customerJobNumber || "" : row?.customer_job_number ?? job?.diarySource?.customer_job_number ?? "";
  if (!job) return draft;
  draft.workOrder = confirmedWorkOrder(job);
  for (const kind of ADMIN_RECEIPT_FIELDS) {
    const value = job.adminReceipts?.amounts[kind];
    draft.amounts[kind] = value == null ? "" : value.toFixed(2);
  }
  draft.notes = job.adminReceipts?.notes || "";
  if (job.intakeCheck) {
    draft.check = job.intakeCheck.result;
    const category = ISSUE_CATEGORIES.find(([en]) => job.intakeCheck!.note.startsWith(`[${en}] `));
    draft.issueCategory = category?.[0] || "Other";
    draft.checkNote = category ? job.intakeCheck.note.slice(category[0].length + 3) : job.intakeCheck.note;
  }
  return draft;
}

export default function FinanceAdminIntake({ t, language, focusJobId, onDirtyChange }: { t: T; language: "en" | "th"; focusJobId?: string; onDirtyChange?: (dirty: boolean) => void }) {
  const { state, addDiaryWorkOrder, saveAdminIntake, ensureDiaryBooking, canAddDiaryWorkOrder, accessLoading, hydrateReady, dispatch, role } = useFinanceFixture();
  const [rows, setRows] = useState<DiaryBookingSeed[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [reload, setReload] = useState(0);
  // null = default range (from the Finance start date). An explicit object (even with blank dates) always wins.
  const [filters, setFiltersState] = useState<Filters | null>(null);
  const [flagOpen, setFlagOpen] = useState(false);
  const focusedRef = useRef("");
  const setFilters = (next: Filters | null) => {
    if (dirty && !window.confirm(t("You have unsaved intake edits. Change filters without saving?", "มีการแก้ไขที่ยังไม่ได้บันทึก ต้องการเปลี่ยนตัวกรองโดยไม่บันทึกหรือไม่?"))) return;
    if (dirty) setSelectedId("");
    setFiltersState(next); writeFilters(next); resetPage();
  };
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("waiting");
  const [showTests, setShowTests] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE);
  const [total, setTotal] = useState(0);
  const [customer, setCustomer] = useState("");
  const [driver, setDriver] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [pinnedRow, setPinnedRow] = useState<DiaryBookingSeed>();
  const resetPage = () => setPage(1);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [moreOpen, setMoreOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [decision, setDecision] = useState("");
  const woRef = useRef<HTMLInputElement>(null);
  const { settings: financeSettings, saveStartDate } = useFinanceSettings();
  const startDate = financeSettings.startDate;
  const { access } = useAccountAccess();
  const canEditStartDate = hasAuthenticatedFinanceAdminIntake(access);
  const [startEditing, setStartEditing] = useState(false);
  const [startDraft, setStartDraft] = useState("");
  const [startMessage, setStartMessage] = useState("");

  useEffect(() => {
    setFiltersState(readFilters());
    try {
      const saved = JSON.parse(safeSessionStorage.getItem("ees-finance-intake-view-v5") || "null");
      if (!saved) return;
      if (typeof saved.search === "string") setSearch(saved.search);
      if (["waiting", "entered", "flagged", "verified", "all"].includes(saved.filter)) setFilter(saved.filter);
      if (typeof saved.selectedId === "string") setSelectedId(saved.selectedId);
      if (typeof saved.customer === "string") setCustomer(saved.customer);
      if (typeof saved.driver === "string") setDriver(saved.driver);
      if ([25, 50, 100].includes(saved.pageSize)) setPageSize(saved.pageSize);
      if (Number.isInteger(saved.page) && saved.page > 0) setPage(saved.page);
    } catch { /* Invalid view preferences fall back to the existing defaults. */ }
  }, []);
  useEffect(() => {
    safeSessionStorage.setItem("ees-finance-intake-view-v5", JSON.stringify({ search, filter, selectedId, customer, driver, page, pageSize }));
  }, [search, filter, selectedId, customer, driver, page, pageSize]);

  const lastHistoricalDay = dayBefore(startDate);
  const inHistorical = !!filters && !filters.from && filters.to === lastHistoricalDay && !!lastHistoricalDay;
  const effFrom = filters ? filters.from : startDate;
  const effTo = filters ? filters.to : "";
  // Fetch one database page. Debounce typing and ignore superseded responses.
  const queryKey = JSON.stringify({ dateFrom: effFrom, dateTo: effTo, search, vehicle: filters?.vehicle || "", customer, driver, status: filter, page, pageSize });
  const bookingsForQuery = useRef(state.bookings);
  bookingsForQuery.current = state.bookings;
  const statusKey = useMemo(() => JSON.stringify(state.bookings.map(job => [job.id, confirmedWorkOrder(job), job.status, !!job.financeCheck, job.adminReceipts?.customerJobNumber])), [state.bookings]);
  useEffect(() => {
    let active = true;
    setRows(null); setLoadError("");
    const timer = window.setTimeout(() => {
      void loadIntakeRows(JSON.parse(queryKey) as IntakeQuery, bookingsForQuery.current).then(result => {
        if (!active) return;
        setRows(result.rows); setTotal(result.count); setLoadError(result.error);
        const last = Math.max(1, Math.ceil(result.count / (JSON.parse(queryKey) as IntakeQuery).pageSize));
        if (!result.error && page > last) setPage(last);
      }).catch(() => { if (active) { setRows([]); setTotal(0); setLoadError("FINANCE_INTAKE_CONNECTION"); } });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [reload, queryKey, statusKey, page]);

  // Opened for a specific job (e.g. from Arrange → "Open in Admin Intake"): show it whatever the filter.
  useEffect(() => {
    if (!focusJobId || focusedRef.current === focusJobId) return;
    const source = state.bookings.find(job => job.id === focusJobId)?.diarySource;
    if (source) { focusedRef.current = focusJobId; setPinnedRow(source); setSelectedId(focusJobId); setFilter("all"); return; }
    if (rows?.some((row) => row.id === focusJobId)) { focusedRef.current = focusJobId; setFilter("all"); setShowTests(true); setSelectedId(focusJobId); return; }
    if (rows && effFrom) setFiltersState({ from: "", to: "", vehicle: "" }); // job is outside the range: widen once, then it is found
  }, [focusJobId, rows, effFrom, state.bookings]);

  const jobById = useMemo(() => new Map(state.bookings.map((job) => [job.id, job])), [state.bookings]);
  const allRows = useMemo(() => rows ?? [], [rows]);
  const testCount = useMemo(() => allRows.filter((row) => isLikelyTestBooking(row)).length, [allRows]);

  const filtered = useMemo(() => allRows.filter(row => showTests || !isLikelyTestBooking(row)), [allRows, showTests]);
  const counts = useMemo(() => ({ waiting: filter === "waiting" ? total : "", entered: filter === "entered" ? total : "", flagged: filter === "flagged" ? total : "", all: filter === "all" ? total : "" }), [filter, total]);

  const saveStart = async () => {
    setStartMessage("");
    if (!isValidFinanceStartDate(startDraft)) { setStartMessage(t("Choose a valid date.", "เลือกวันที่ให้ถูกต้อง")); return; }
    try {
      await saveStartDate(startDraft);
      setStartEditing(false);
    } catch (caught) {
      setStartMessage(caught instanceof Error && /permission/i.test(caught.message)
        ? t("Only Admin can change the Finance start date.", "เฉพาะแอดมินเท่านั้นที่เปลี่ยนวันเริ่มการเงินได้")
        : t("Not saved — try again.", "ยังไม่ได้บันทึก — ลองอีกครั้ง"));
    }
  };

  const selectedRow = allRows.find((row) => row.id === selectedId) || (pinnedRow?.id === selectedId ? pinnedRow : undefined) || jobById.get(selectedId)?.diarySource;
  useEffect(() => { const row = allRows.find(item => item.id === selectedId); if (row) setPinnedRow(row); }, [allRows, selectedId]);
  const selectedJob = selectedId ? jobById.get(selectedId) : undefined;

  // Select the first job of the list when nothing (or something no longer listed) is selected.
  useEffect(() => {
    if (!rows || !hydrateReady) return;
    if (dirty) return;
    if (selectedId && selectedRow) return;
    setSelectedId(filtered[0]?.id ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the visible list changes
  }, [filtered, rows, hydrateReady]);

  // Load the selected job into the form and focus the work order box.
  useEffect(() => {
    if (!hydrateReady) return;
    const job = selectedId ? jobById.get(selectedId) : undefined;
    const next = draftFor(job, selectedRow);
    setDraft(next);
    setMoreOpen(MORE_KINDS.some((kind) => next.amounts[kind]) || !!next.notes);
    setFlagOpen(next.check === "different");
    setDecision("");
    if (selectedId) window.setTimeout(() => { woRef.current?.focus(); woRef.current?.select(); }, 30);
    // Keep the linked copy in step with the Booking Diary source (read-only there).
    if (job && selectedRow) {
      const source = job.diarySource;
      const changed = !source || (["booking_date", "pickup", "dropoff", "driver", "vehicle_registration", "vehicle", "client_id", "customer_job_number", "notes"] as const)
        .some((field) => (source[field] ?? null) !== (selectedRow[field] ?? null));
      if (changed && !state.billingSheets?.some(sheet => sheet.jobIds.includes(job.id) && (sheet.readyForApprovalAt || sheet.approvedAt || sheet.officialTrn))) ensureDiaryBooking(selectedRow);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload the form only when the selection changes
  }, [selectedId, selectedRow?.id, hydrateReady]);

  const duplicate = useMemo(() => {
    const wo = draft.workOrder.trim();
    if (wo.length < 1) return undefined;
    const other = findWorkOrder(state, wo);
    return other && other.id !== selectedId ? other : undefined;
  }, [draft.workOrder, state, selectedId]);

  const assignedSheet = state.billingSheets?.find(sheet => sheet.jobIds.includes(selectedId));
  const intakeLocked = !!assignedSheet && !!(assignedSheet.readyForApprovalAt || assignedSheet.approvedAt || assignedSheet.officialTrn);
  const canSave = !intakeLocked && !!selectedRow && hydrateReady && !accessLoading && canAddDiaryWorkOrder && !saving;

  const dirty = useMemo(() => {
    if (!selectedRow) return false;
    const baseline = draftFor(selectedJob, selectedRow);
    return JSON.stringify(draft) !== JSON.stringify(baseline);
  }, [draft, selectedJob, selectedRow]);

  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const selectBooking = (id: string) => {
    if (id === selectedId) return;
    if (dirty && !window.confirm(t("You have unsaved intake edits. Leave without saving?", "มีการแก้ไขที่ยังไม่ได้บันทึก ต้องการออกโดยไม่บันทึกหรือไม่?"))) return;
    const row = allRows.find(item => item.id === id);
    if (row) setPinnedRow(row);
    setSelectedId(id);
  };

  const errorText = (code: string) => {
    if (code === "FINANCE_APPROVED_FIGURES_LOCKED") return t("This job belongs to a locked invoice. Open that invoice and use the correction process.", "งานนี้อยู่ในใบแจ้งหนี้ที่ล็อกแล้ว ให้เปิดใบแจ้งหนี้และใช้ขั้นตอนแก้ไข");
    if (code === "FINANCE_DUPLICATE_BILLING") return t("This work order is already assigned to an invoice. Open its existing record before continuing.", "ใบงานนี้อยู่ในใบแจ้งหนี้แล้ว ให้เปิดรายการเดิมก่อนดำเนินการต่อ");
    if (code === "FINANCE_INTAKE_INCOMPLETE") return t("Cannot confirm: check customer, date, route, vehicle, driver and work order against the paperwork.", "ยังยืนยันไม่ได้: ตรวจลูกค้า วันที่ เส้นทาง รถ คนขับ และเลขใบงานกับเอกสาร");
    if (code === "DEMO_DUPLICATE_WO") return t("This work order number is already linked to another booking.", "เลขที่ใบงานนี้เชื่อมกับงานอื่นแล้ว");
    if (code === "DEMO_WO_REQUIRED") return t("Enter the work order number from the green paper (at least 3 characters).", "กรอกเลขที่ใบงานจากใบสีเขียว (อย่างน้อย 3 ตัวอักษร)");
    if (code === "FINANCE_RECEIPT_AMOUNT_INVALID") return t("Amounts must be numbers with up to 2 decimals (no commas), or left blank.", "จำนวนเงินต้องเป็นตัวเลข ทศนิยมไม่เกิน 2 ตำแหน่ง (ไม่ใส่จุลภาค) หรือเว้นว่าง");
    if (code === "FINANCE_INTAKE_NOTE_REQUIRED") return t("Write a short note saying what is different.", "เขียนหมายเหตุสั้น ๆ ว่าอะไรต่างกัน");
    if (code === "FINANCE_MANAGEMENT_REVIEW_PENDING") return t("This job is waiting for a management decision before it can be marked as matching.", "งานนี้รอผู้บริหารตัดสินก่อนจึงจะยืนยันว่าตรงกันได้");
    if (code === "FINANCE_SHEET_LOCKED") return t("This job is on a billing pack waiting for approval. Finance must reopen it first.", "งานนี้อยู่ในชุดวางบิลที่รออนุมัติ ฝ่ายการเงินต้องเปิดแก้ไขก่อน");
    if (code === "FINANCE_ADMIN_INTAKE_REQUIRED") return t("Only signed-in Admin staff can save green papers.", "เฉพาะแอดมินที่เข้าสู่ระบบเท่านั้นที่บันทึกใบงานได้");
    return t("Not saved. Your entries are kept — check the connection and try again.", "ยังไม่ได้บันทึก ข้อมูลที่กรอกยังอยู่ — ตรวจการเชื่อมต่อแล้วลองอีกครั้ง");
  };

  const save = async (andNext: boolean, confirm = false) => {
    if (!selectedRow || !canSave) return;
    setMessage(null);
    if (duplicate) { setMessage({ tone: "error", text: duplicateText(duplicate) }); return; }
    let amounts: AdminReceipts["amounts"];
    try {
      amounts = Object.fromEntries(ADMIN_RECEIPT_FIELDS.map((kind) => [kind, parseOptionalReceiptThb(draft.amounts[kind])])) as AdminReceipts["amounts"];
    } catch { setMessage({ tone: "error", text: errorText("FINANCE_RECEIPT_AMOUNT_INVALID") }); return; }
    const receipts: AdminReceipts = { amounts, notes: draft.notes, customerJobNumber: draft.customerJobNumber.trim() || null };
    // No routine "matches booking" question. A check is recorded only for a real flag, or an explicit Confirm job.
    const check = confirm ? { result: "matches" as const, note: "" } : flagOpen && draft.checkNote.trim() ? { result: "different" as const, note: `[${draft.issueCategory}] ${draft.checkNote.trim()}` } : null;
    if (flagOpen && !confirm && draft.checkNote.trim().length < 3) { setMessage({ tone: "error", text: errorText("FINANCE_INTAKE_NOTE_REQUIRED") }); return; }
    const workOrder = draft.workOrder.trim();
    const submittedDraft = JSON.stringify(draft);
    setSaving(true);
    try {
      if (selectedJob) await saveAdminIntake({ type: "admin_save_intake", jobId: selectedJob.id, workOrder, receipts, check });
      else await addDiaryWorkOrder(selectedRow, workOrder, receipts, check);
      const savedText = workOrder ? t(`Saved WO ${workOrder}.`, `บันทึก WO ${workOrder} แล้ว`) : t("Issue saved. Work order number is still missing.", "บันทึกปัญหาแล้ว ยังขาดเลขที่ใบงาน");
      if (JSON.stringify(draftRef.current) !== submittedDraft) {
        setMessage({ tone: "ok", text: t("Submitted values saved. Your newer edits are still unsaved; review and save them before moving on.", "บันทึกค่าที่ส่งแล้ว การแก้ไขใหม่ยังไม่ได้บันทึก โปรดตรวจและบันทึกก่อนเปลี่ยนงาน") });
        return;
      }
      if (check) setDraft(current => ({ ...current, check: check.result, checkNote: check.result === "matches" ? "" : current.checkNote.trim(), issueCategory: check.result === "matches" ? "Other" : current.issueCategory }));
      if (andNext) {
        const index = filtered.findIndex((row) => row.id === selectedRow.id);
        const after = [...filtered.slice(index + 1), ...filtered.slice(0, Math.max(index, 0))];
        const next = after.find((row) => row.id !== selectedRow.id && !confirmedWorkOrderFor(row.id));
        setPinnedRow(next || selectedRow);
        setSelectedId(next?.id ?? selectedRow.id);
        setMessage({ tone: "ok", text: next ? `${savedText} ${t("Next job ready.", "พร้อมงานถัดไป")}` : `${savedText} ${t("No more jobs waiting in this list.", "ไม่มีงานที่รออยู่ในรายการนี้แล้ว")}` });
      } else {
        setMessage({ tone: "ok", text: savedText });
      }
    } catch (caught) {
      setMessage({ tone: "error", text: errorText(caught instanceof Error ? caught.message.split(":")[0] : "") });
    } finally {
      setSaving(false);
    }
  };
  const confirmedWorkOrderFor = (id: string) => { const job = jobById.get(id); return job ? confirmedWorkOrder(job) : ""; };
  const duplicateText = (other: Booking) => t(
    `WO ${confirmedWorkOrder(other)} is already linked to ${other.client} · ${formatUiDate(other.date)} · ${displayVehicle(other.vehicle)}. Check the number on the paper.`,
    `WO ${confirmedWorkOrder(other)} เชื่อมกับ ${other.client} · ${formatUiDate(other.date, "th")} · ${displayVehicle(other.vehicle)} แล้ว โปรดตรวจเลขบนใบงาน`);

  const onSubmit = (event: FormEvent) => { event.preventDefault(); };
  const formatAmount = (kind: AdminReceiptKind, value: string) => { try { const amount = parseOptionalReceiptThb(value); if (amount != null) setAmount(kind, amount.toFixed(2)); } catch { /* Keep invalid typing visible for validation on Save. */ } };
  const setAmount = (kind: AdminReceiptKind, value: string) => setDraft((current) => ({ ...current, amounts: { ...current.amounts, [kind]: value } }));

  const chip = (id: Filter, en: string, th: string, count: number | string, dot?: string) => (
    <button key={id} type="button" aria-pressed={filter === id} onClick={() => { setFilter(id); resetPage(); }}
      className={`rounded-full px-3 py-1.5 text-sm font-semibold transition ${filter === id ? "bg-violet-800 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-violet-50"}`}>
      {dot ? <span aria-hidden="true" className={`mr-1.5 inline-block h-2 w-2 rounded-full align-middle ${dot}`} /> : null}{t(en, th)} <span className={filter === id ? "text-violet-200" : "text-slate-400"}>{count}</span>
    </button>
  );

  const field = "mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-950 focus:border-violet-600 focus:outline-none focus:ring-2 focus:ring-violet-200";
  const flagged = isFlagged(selectedJob);
  const managementCanDecide = flagged && selectedJob?.status === "discrepancy" && !selectedJob.decision && (role === "management" || role === "super_admin");

  return (
    <section data-testid="intake-workspace" className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]" aria-label={t("Admin Intake", "รับใบงาน (แอดมิน)")}>
      <div className="ees-fc-card flex min-h-[26rem] flex-col p-0 lg:h-[calc(100dvh-14.9rem)]">
        <div className="space-y-2 border-b border-slate-100 p-3">
          <div className="grid grid-cols-2 items-end gap-2 sm:grid-cols-[minmax(10rem,1.6fr)_9.5rem_9.5rem_minmax(7rem,1fr)_auto]" data-testid="intake-filters">
            <label className="col-span-2 text-xs font-semibold text-slate-600 sm:col-span-1">{t("Search", "ค้นหา")}
              <input type="search" value={search} onChange={(event) => { setSearch(event.target.value); resetPage(); }}
                placeholder={t("Customer, WO, driver, route", "ลูกค้า ใบงาน คนขับ เส้นทาง")}
                aria-label={t("Search bookings", "ค้นหางาน")} className={`${field} mt-0.5 py-1.5 text-sm`} />
            </label>
            <label className="text-xs font-semibold text-slate-600">{t("Date from", "วันที่เริ่มต้น")}
              <input type="date" value={effFrom} max={effTo || undefined} onChange={(event) => setFilters({ from: event.target.value, to: effTo, vehicle: filters?.vehicle ?? "" })} className={`${field} mt-0.5 py-1.5 text-sm`} />
            </label>
            <label className="text-xs font-semibold text-slate-600">{t("Date to", "วันที่สิ้นสุด")}
              <input type="date" value={effTo} min={effFrom || undefined} onChange={(event) => setFilters({ from: effFrom, to: event.target.value, vehicle: filters?.vehicle ?? "" })} className={`${field} mt-0.5 py-1.5 text-sm`} />
            </label>
            <label className="text-xs font-semibold text-slate-600">{t("Vehicle registration", "ทะเบียนรถ")}
              <input value={filters?.vehicle ?? ""} onChange={event => setFilters({ from: effFrom, to: effTo, vehicle: event.target.value })} placeholder={t("All vehicles", "ทุกคัน")} className={field + " mt-0.5 py-1.5 text-sm"} />
            </label>
            <button type="button" className="ees-fc-btn-secondary col-span-2 whitespace-nowrap px-3 py-1.5 sm:col-span-1" onClick={() => { setFilters(null); setSearch(""); setCustomer(""); setDriver(""); }}>{t("Clear filters", "ล้างตัวกรอง")}</button>
          </div>
          <button type="button" className="text-xs font-semibold text-violet-800" aria-expanded={advanced} onClick={() => setAdvanced(value => !value)}>{t("Advanced filters", "ตัวกรองเพิ่มเติม")}</button>
          {advanced ? <div className="grid grid-cols-2 gap-2">
            <label className="text-xs font-semibold">{t("Customer", "ลูกค้า")}<input value={customer} onChange={event => { setCustomer(event.target.value); setPage(1); }} className={field} /></label>
            <label className="text-xs font-semibold">{t("Driver", "คนขับ")}<input value={driver} onChange={event => { setDriver(event.target.value); setPage(1); }} className={field} /></label>
            <p className="col-span-2 text-xs text-slate-500">{t("Search also matches work order, customer job number and booking reference.", "ค้นหาเลขใบงาน เลขงานลูกค้า และเลขอ้างอิงการจองได้ด้วย")}</p>
          </div> : null}
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label={t("Date presets", "ช่วงวันที่")}>
            {([["today", "Today", "วันนี้"], ["week", "This week", "สัปดาห์นี้"], ["month", "This month", "เดือนนี้"], ["lastMonth", "Last month", "เดือนก่อน"]] as const).map(([id, en, th]) => (
              <button key={id} type="button" className="ees-fc-btn-quiet !px-2 !py-1 !text-xs" onClick={() => setFilters({ ...intakeDateRange(id as IntakeDatePreset, bangkokDate()), vehicle: filters?.vehicle ?? "" })}>{t(en, th)}</button>
            ))}
            <span className="ml-auto text-xs text-slate-500">{t("Custom: use dates above", "กำหนดเอง: เลือกวันที่ด้านบน")}</span>
          </div>
          {inHistorical ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 px-3 py-1.5 text-sm text-amber-950" data-testid="historical-banner">
              <b>{t("Historical Bookings", "งานย้อนหลัง")}</b>
              <span>{t(`Jobs dated before ${formatDocDate(startDate)}. They are not part of the daily queue or its counts; nothing here is marked invoiced or paid.`, `งานก่อน ${formatDocDate(startDate)} ไม่รวมในคิวประจำวันและตัวเลขรอดำเนินการ และไม่ถูกทำเครื่องหมายว่าวางบิลหรือชำระแล้ว`)}</span>
              <button type="button" className="ml-auto font-semibold text-violet-900 underline" data-testid="back-to-current-queue" onClick={() => { setFilters(null); setSearch(""); }}>← {t("Current queue", "คิวปัจจุบัน")}</button>
            </div>
          ) : !filters ? (
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600" data-testid="cutover-note">
              <span>{t(`Daily queue starts ${formatDocDate(startDate)}.`, `คิวประจำวันเริ่มตั้งแต่ ${formatDocDate(startDate)}`)}</span>
              <button type="button" className="font-semibold text-violet-900 underline" data-testid="open-historical" onClick={() => setFilters({ from: "", to: lastHistoricalDay, vehicle: "" })}>{t("Historical Bookings", "งานย้อนหลัง")} →</button>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t("Filter", "ตัวกรอง")}>
            {chip("waiting", "Waiting", "รอใบงาน", counts.waiting, ROW_DOT.awaiting)}
            {chip("entered", "Entered", "กรอกแล้ว", counts.entered, ROW_DOT.entered)}
            {chip("flagged", "Flagged", "ต้องตรวจสอบ", counts.flagged, ROW_DOT.flagged)}
            {chip("verified", "Verified", "ตรวจแล้ว", filter === "verified" ? total : "", ROW_DOT.ready)}
            {chip("all", "All", "ทั้งหมด", counts.all)}
            <span className="ml-auto text-xs text-slate-500" aria-live="polite" data-testid="intake-count">
              {rows === null ? t("Loading…", "กำลังโหลด…") : t(`${filtered.length} matching bookings`, `พบ ${filtered.length} งาน`)}
              {" · "}{effFrom ? formatDocDate(effFrom) : t("any date", "ทุกวันที่")} – {effTo ? formatDocDate(effTo) : t("any date", "ทุกวันที่")}
            </span>
            <button type="button" className="text-xs font-semibold text-violet-800 underline-offset-2 hover:underline" onClick={() => setReload((value) => value + 1)}>{t("Refresh", "รีเฟรช")}</button>
            {testCount ? (
              <button type="button" className="text-xs text-slate-500 underline-offset-2 hover:underline" onClick={() => setShowTests((value) => !value)}>
                {showTests ? t(`Hide ${testCount} test`, `ซ่อนทดสอบ ${testCount}`) : t(`${testCount} test hidden · show`, `ซ่อนทดสอบ ${testCount} · แสดง`)}
              </button>
            ) : null}
            {!filters ? (
              <span className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500" data-testid="finance-start-date">
                {startEditing ? (
                  <>
                    <input type="date" value={startDraft} aria-label={t("Default start date", "วันเริ่มต้นเริ่มต้น")} onChange={(event) => setStartDraft(event.target.value)} className="rounded-md border border-slate-300 px-1.5 py-0.5 text-xs text-slate-900" />
                    <button type="button" className="font-semibold text-violet-800 hover:underline" onClick={() => setStartDraft(FINANCE_CUTOVER_DATE)}>{t("1 Nov 2026", "1 พ.ย. 2569")}</button>
                    <button type="button" className="font-semibold text-violet-800 hover:underline" onClick={() => void saveStart()}>{t("Save", "บันทึก")}</button>
                    <button type="button" className="hover:underline" onClick={() => { setStartEditing(false); setStartMessage(""); }}>{t("Cancel", "ยกเลิก")}</button>
                  </>
                ) : canEditStartDate ? (
                  <button type="button" className="font-semibold text-violet-800 underline-offset-2 hover:underline" onClick={() => { setStartDraft(startDate); setStartEditing(true); }}>{t("Change default start", "เปลี่ยนวันเริ่มต้น")}</button>
                ) : null}
                {startMessage ? <span role="alert" className="font-semibold text-rose-700">{startMessage}</span> : null}
              </span>
            ) : null}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {rows === null ? (
            <ul className="space-y-2" aria-busy="true">{[0, 1, 2, 3, 4, 5, 6].map((i) => <li key={i} className="h-12 animate-pulse rounded-lg bg-slate-100" />)}</ul>
          ) : loadError ? (
            <p role="alert" className="rounded-xl bg-rose-50 p-4 text-base text-rose-900">{t("Could not load the Booking Diary.", "โหลดสมุดจองไม่สำเร็จ")} {loadError === "FINANCE_INTAKE_CONNECTION" ? t("Connection failed. Try Refresh.", "การเชื่อมต่อล้มเหลว โปรดรีเฟรช") : loadError === "FINANCE_INTAKE_DATE_RANGE" ? t("The start date must be before the end date.", "วันที่เริ่มต้นต้องไม่เกินวันที่สิ้นสุด") : loadError === "FINANCE_INTAKE_COUNT_UNAVAILABLE" ? t("The booking count could not be confirmed. Try Refresh.", "ยืนยันจำนวนงานไม่ได้ โปรดรีเฟรช") : loadError}</p>
          ) : !filtered.length ? (
            <div className="ees-fc-empty">
              <p className="font-bold text-slate-900">{!allRows.length ? t("No bookings in this date range", "ไม่มีงานในช่วงวันที่นี้") : t("No bookings match these filters", "ไม่มีงานตรงกับตัวกรองนี้")}</p>
              <p className="text-sm">{t("Try an earlier period or clear your search and status filters.", "ลองช่วงเวลาก่อนหน้า หรือล้างคำค้นหาและสถานะ")}</p>
              <div className="mt-2 flex flex-wrap justify-center gap-2">
                <button type="button" className="ees-fc-btn-secondary" onClick={() => { const before = dayBefore(effFrom || startDate); setFilters({ from: "", to: before, vehicle: "" }); setSearch(""); setFilter("all"); }}>{t("View earlier bookings", "ดูงานก่อนหน้านี้")}</button>
                <button type="button" className="ees-fc-btn-quiet" onClick={() => { setSearch(""); setFilter("all"); setFilters({ from: effFrom, to: effTo, vehicle: "" }); }}>{t("Show all in range", "แสดงทั้งหมดในช่วงนี้")}</button>
              </div>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg ring-1 ring-slate-200" role="listbox" aria-label={t("Booking list", "รายการจอง")}
              onKeyDown={(event) => {
                if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") return;
                const visible = filtered;
                const index = visible.findIndex((row) => row.id === selectedId);
                let next = index;
                if (event.key === "ArrowDown") next = Math.min(visible.length - 1, Math.max(0, index) + 1);
                if (event.key === "ArrowUp") next = Math.max(0, (index < 0 ? 0 : index) - 1);
                if (event.key === "Home") next = 0;
                if (event.key === "End") next = visible.length - 1;
                if (next < 0 || !visible[next]) return;
                event.preventDefault();
                selectBooking(visible[next].id);
                const button = (event.currentTarget.querySelectorAll("[data-intake-row]")[next] as HTMLElement | undefined);
                button?.focus();
              }}>
              {filtered.map((row, index) => {
                const job = jobById.get(row.id);
                const wo = job ? confirmedWorkOrder(job) : "";
                const active = row.id === selectedId;
                const plate = displayVehicle(row.vehicle_registration || row.vehicle) || "—";
                const rowState = intakeRowState(job, wo);
                const rowStateLabel = rowState === "ready" ? t("Ready for Finance", "พร้อมส่งฝ่ายการเงิน") : rowState === "flagged" ? t("Flagged for checking", "แจ้งตรวจสอบ")
                  : rowState === "entered" ? t("Work order entered", "บันทึกเลขใบงานแล้ว") : t("Awaiting entry", "รอบันทึก");
                const route = `${row.pickup || "—"} → ${row.dropoff || "—"}`;
                return (
                  <li key={row.id}>
                    <button type="button" data-intake-row onClick={() => selectBooking(row.id)} aria-current={active ? "true" : undefined}
                      className={`relative grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-3 py-1.5 lg:grid-cols-[minmax(0,15rem)_minmax(5.5rem,auto)_minmax(0,1fr)_auto] lg:py-1 text-left transition ${active ? "bg-violet-100 ring-2 ring-inset ring-violet-600" : index % 2 ? "bg-slate-50/70 hover:bg-violet-50" : "bg-white hover:bg-violet-50"}`}>
                      <span className="flex min-w-0 items-baseline gap-2">
                        <span aria-hidden="true" title={rowStateLabel} data-row-state={rowState} className={`inline-block h-2.5 w-2.5 shrink-0 self-center rounded-full ${ROW_DOT[rowState]}`} />
                        <span className="sr-only">{rowStateLabel}</span>
                        <span className="min-w-0 truncate text-sm font-bold text-slate-950" title={row.client_name || ""}>{row.client_name || "—"}</span>
                        <span className="shrink-0 text-xs text-slate-600">{formatDocDate(row.booking_date)} {row.pickup_time?.slice(0,5)}<small className="block max-w-[7rem] truncate" title={row.booking_id || row.id}>{row.booking_id || row.id}</small></span>
                        {isFlagged(job) ? <span className="shrink-0 rounded-full bg-amber-100 px-1.5 text-xs font-bold text-amber-900">{t("Flagged", "ต้องตรวจสอบ")}</span> : null}
                      </span>
                      <span className="shrink-0 whitespace-nowrap text-sm font-bold text-slate-950">{plate}</span>
                      <span className="min-w-0 truncate text-sm text-slate-700" title={route}>{route}</span>
                      <span className="flex shrink-0 items-baseline gap-2 whitespace-nowrap text-sm text-slate-600">
                        <span className="max-w-[7.5rem] truncate" title={row.driver || ""}>{row.driver || "—"}</span>
                        {wo ? <span className="text-base font-black text-violet-950">{rowState === "ready" ? <span className="mr-1 text-emerald-600" title={rowStateLabel}>✓</span> : null}{wo}</span> : <span className="w-6 text-center text-slate-300" aria-hidden="true">·</span>}
                      </span>
                    </button>
                  </li>
                );
              })}

            </ul>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 p-2 text-xs" data-testid="intake-pagination" aria-busy={rows === null}>
          <span role="status">{rows === null ? t("Loading…", "กำลังโหลด…") : loadError ? t("Load failed", "โหลดไม่สำเร็จ") : t(total + " matching bookings", "พบ " + total + " งาน")}</span>
          <label className="ml-auto">{t("Rows", "แถว")} <select aria-label={t("Rows per page", "จำนวนแถวต่อหน้า")} value={pageSize} disabled={dirty || saving} onChange={event => { setPageSize(Number(event.target.value)); setPage(1); }}>{[25,50,100].map(size => <option key={size}>{size}</option>)}</select></label>
          <button type="button" className="ees-fc-btn-secondary" disabled={page <= 1 || rows === null || dirty || saving} onClick={() => setPage(value => value - 1)}>{t("Previous", "ก่อนหน้า")}</button>
          <span>{t("Page", "หน้า")} {page} / {Math.max(1, Math.ceil(total / pageSize))}</span>
          <button type="button" className="ees-fc-btn-secondary" disabled={page * pageSize >= total || rows === null || !!loadError || dirty || saving} onClick={() => setPage(value => value + 1)}>{t("Next", "ถัดไป")}</button>
        </div>
      </div>

      <form className="ees-fc-card flex min-h-[26rem] flex-col p-0 lg:h-[calc(100dvh-14.9rem)]" onSubmit={onSubmit} onKeyDown={event => { if (event.key === "Enter" && (event.target as HTMLElement).tagName === "INPUT") event.preventDefault(); }} aria-label={t("Selected job", "งานที่เลือก")}>
        {!selectedRow ? (
          <p className="py-16 text-center text-base text-slate-500">{rows === null ? t("Loading…", "กำลังโหลด…") : t("Select a job on the left.", "เลือกงานจากรายการด้านซ้าย")}</p>
        ) : (
          <>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
              <div className="rounded-lg bg-slate-50 px-3 py-2">
                {!allRows.some(row => row.id === selectedId) ? <p className="text-xs font-semibold text-violet-800">{t("Selected job kept open outside the current page or filters.", "คงงานที่เลือกไว้ แม้ไม่อยู่ในหน้าหรือตัวกรองปัจจุบัน")}</p> : null}
                <p className="flex flex-wrap items-baseline gap-x-2 text-base font-bold text-slate-950">{selectedRow.client_name || "—"} <span className="text-sm font-semibold text-slate-600">{formatDocDate(selectedRow.booking_date)}</span>
                  {selectedRow.pickup_time ? <span className="text-sm font-semibold text-slate-700">{t("Pickup", "รับ")} {selectedRow.pickup_time}</span> : null}
                  <span className="ml-auto text-sm font-bold">{displayVehicle(selectedRow.vehicle_registration || selectedRow.vehicle) || "—"}</span></p>
                <p className="text-sm text-slate-800">{selectedRow.pickup || "—"} <span className="text-violet-500">→</span> {selectedRow.dropoff || "—"}</p>
                <p className="text-sm text-slate-600">{selectedRow.driver || "—"}</p>
                {selectedRow.notes ? <p className="mt-1 line-clamp-2 text-xs text-slate-500" title={selectedRow.notes}>{selectedRow.notes}</p> : null}
              </div>

              {intakeLocked && assignedSheet ? <p role="status" className="rounded-lg bg-violet-50 p-2 text-sm">{t("This job is locked in ", "งานนี้ถูกล็อกใน ")}{sheetTrnLabel(assignedSheet)}. <a className="font-semibold underline" href={"/finance-centre?section=sheet&customer=" + encodeURIComponent(assignedSheet.clientId) + "&sheet=" + encodeURIComponent(assignedSheet.id)}>{t("Open invoice for controlled correction", "เปิดใบแจ้งหนี้เพื่อแก้ไขตามขั้นตอน")}</a></p> : null}
              {selectedJob?.financeCheck ? (
                <p role="alert" className="rounded-lg bg-amber-50 p-2 text-sm font-semibold text-amber-950">{t("Finance sent this back", "การเงินส่งกลับมา")}: {selectedJob.financeCheck.reason}</p>
              ) : null}

              <label className="block">
                <span className="text-sm font-bold text-violet-950">{t("Green-paper Work Order Number", "เลขที่ใบงาน (ใบสีเขียว)")}</span>
                <input ref={woRef} value={draft.workOrder} autoComplete="off" inputMode="text"
                  onChange={(event) => setDraft((current) => ({ ...current, workOrder: event.target.value }))}
                  className={`mt-1 w-full rounded-lg border-2 px-3 py-2 text-3xl font-black tracking-normal text-slate-950 focus:outline-none ${duplicate ? "border-rose-400 bg-rose-50" : "border-violet-400 focus:border-violet-700"}`} />
              </label>
              {duplicate ? <p role="alert" className="-mt-2 text-sm font-semibold text-rose-800">{duplicateText(duplicate)} <a className="underline" target="_blank" rel="noopener" href={"/finance-centre?section=reconciliation&booking=" + encodeURIComponent(duplicate.id)}>{t("Open existing job", "เปิดงานเดิม")}</a></p> : null}

              <p className="text-xs text-slate-600">{t("Receipt amounts below are for customer billing decisions later. They are not automatic invoice lines. Internal driver costs stay in Admin notes until Finance marks them billable.", "จำนวนเงินด้านล่างใช้ตัดสินใจเรียกเก็บลูกค้าทีหลัง ไม่กลายเป็นรายการในใบแจ้งหนี้อัตโนมัติ ค่าใช้จ่ายภายในของคนขับอยู่ที่หมายเหตุแอดมินจนกว่าการเงินจะทำเครื่องหมายว่าเรียกเก็บได้")}</p>
              <div className="grid gap-2 sm:grid-cols-3">
                <label className="block text-sm font-semibold text-slate-700">{t("Customer job no. (optional)", "เลขที่งานลูกค้า (ไม่บังคับ)")}
                  <input value={draft.customerJobNumber} autoComplete="off" onChange={(event) => setDraft((current) => ({ ...current, customerJobNumber: event.target.value }))} className={`${field} py-1.5`} />
                </label>
                {(["parking", "toll"] as AdminReceiptKind[]).map((kind) => (
                  <label key={kind} className="block text-sm font-semibold text-slate-700">{t(...LABELS[kind])}
                    <input inputMode="decimal" autoComplete="off" value={draft.amounts[kind]} placeholder={t("blank = none", "เว้นว่าง = ไม่มี")} onBlur={event => formatAmount(kind, event.target.value)} onChange={(event) => setAmount(kind, event.target.value)} className={`${field} py-1.5 text-right tabular-nums`} />
                  </label>
                ))}
              </div>
              {moreOpen ? (
                <div className="grid gap-2 sm:grid-cols-3">
                  {MORE_KINDS.map((kind) => (
                    <label key={kind} className="block text-sm font-semibold text-slate-700">{t(...LABELS[kind])}
                      <input inputMode="decimal" autoComplete="off" value={draft.amounts[kind]} onBlur={event => formatAmount(kind, event.target.value)} onChange={(event) => setAmount(kind, event.target.value)} className={`${field} py-1.5 text-right tabular-nums`} />
                    </label>
                  ))}
                  <label className="block text-sm font-semibold text-slate-700 sm:col-span-3">{t("Note (optional)", "หมายเหตุ (ไม่บังคับ)")}
                    <input value={draft.notes} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} className={`${field} py-1.5`} />
                  </label>
                </div>
              ) : (
                <button type="button" className="text-sm font-semibold text-violet-800 hover:underline" onClick={() => setMoreOpen(true)}>+ {t("More charges", "ค่าใช้จ่ายอื่น")}</button>
              )}

              <details className="fc6-evidence" open>
                <summary>{t("Booking evidence & billing decisions", "หลักฐานงานและการเรียกเก็บ")}</summary>
                <p>{t("Source booking", "งานต้นทาง")}: <b>{selectedRow.booking_id || selectedRow.id}</b> · {t("Recorded receipts are evidence, not automatic invoice charges.", "ใบเสร็จที่บันทึกเป็นหลักฐาน ไม่กลายเป็นค่าเรียกเก็บอัตโนมัติ")}</p>
                {selectedJob?.adminReceipts && ADMIN_RECEIPT_FIELDS.some(kind => selectedJob.adminReceipts?.amounts[kind] != null) ? <dl>
                  {ADMIN_RECEIPT_FIELDS.filter(kind => selectedJob.adminReceipts?.amounts[kind] != null).map(kind => {
                    const group = (state.billingSheets || []).find(item => item.jobIds.includes(selectedJob.id));
                    const decision = group?.lines[selectedJob.id]?.extras[kind];
                    return <div key={kind}><dt>{t(...LABELS[kind])}</dt><dd>{selectedJob.adminReceipts!.amounts[kind]?.toLocaleString(language === "th" ? "th-TH" : "en-US", { minimumFractionDigits: 2 })}<small>{decision?.decision === "bill" ? t("Customer-billable", "เรียกเก็บลูกค้า") : decision?.decision === "not_billable" ? t("Internal / not billed", "ภายใน / ไม่เรียกเก็บ") : t("Pending Finance decision", "รอฝ่ายการเงินตัดสินใจ")}{decision?.note ? ` · ${decision.note}` : ""}</small></dd></div>;
                  })}
                </dl> : <p>{t("No saved receipt evidence for this booking. Enter only amounts shown on the returned paperwork.", "ยังไม่มีหลักฐานใบเสร็จที่บันทึก กรอกเฉพาะยอดตามเอกสารที่ได้รับคืน")}</p>}
              </details>

              {flagOpen ? (
                <div className="rounded-lg bg-amber-50 p-2">
                  <label className="block text-sm font-semibold text-amber-950">{t("Issue category", "ประเภทปัญหา")}<select aria-label={t("Issue category", "ประเภทปัญหา")} className={field} value={draft.issueCategory} onChange={event => setDraft(current => ({ ...current, issueCategory: event.target.value }))}>{ISSUE_CATEGORIES.map(([en, th]) => <option key={en} value={en}>{t(en, th)}</option>)}</select></label>
                  <label className="block text-sm font-semibold text-amber-950">{t("What is wrong? (goes to management)", "มีปัญหาอะไร (ส่งให้ผู้บริหาร)")}
                    <input value={draft.checkNote} onChange={(event) => setDraft((current) => ({ ...current, checkNote: event.target.value }))} className={`${field} border-amber-300 py-1.5`} />
                  </label>
                  <button type="button" className="mt-1 text-sm font-semibold text-slate-600 hover:underline" onClick={() => { setFlagOpen(false); setDraft((current) => ({ ...current, check: "", checkNote: "", issueCategory: "Other" })); }}>{t("Cancel flag", "ยกเลิกการแจ้ง")}</button>
                </div>
              ) : null}

              {flagged && selectedJob?.status === "discrepancy" ? (
                <div className="rounded-lg bg-amber-50 p-2 text-sm text-amber-950">
                  <p className="font-semibold">{t("Waiting for management review", "รอผู้บริหารตรวจสอบ")}{selectedJob.intakeCheck?.note ? `: ${selectedJob.intakeCheck.note}` : ""}</p>
                  {managementCanDecide ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <input value={decision} onChange={(event) => setDecision(event.target.value)} placeholder={t("Management decision", "คำตัดสินผู้บริหาร")} className="min-w-[14rem] flex-1 rounded-lg border border-amber-300 px-3 py-2" />
                      <button type="button" className="rounded-lg bg-amber-700 px-3 py-2 font-semibold text-white disabled:opacity-40" disabled={decision.trim().length < 10}
                        onClick={() => { if (dispatch({ type: "resolve_discrepancy", jobId: selectedJob.id, reason: decision })) setDecision(""); }}>{t("Record decision", "บันทึกคำตัดสิน")}</button>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {message ? <p role={message.tone === "error" ? "alert" : "status"} className={`rounded-lg p-2 text-sm font-semibold ${message.tone === "ok" ? "bg-emerald-50 text-emerald-900" : "bg-rose-50 text-rose-900"}`}>{message.text}</p> : null}
              {!canAddDiaryWorkOrder && !accessLoading ? <p className="text-sm text-slate-600">{t("Sign in as Admin to save green papers.", "เข้าสู่ระบบเป็นแอดมินเพื่อบันทึกใบงาน")}</p> : null}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 bg-white p-3">
              <span role="status" className={`mr-auto text-xs font-semibold ${dirty ? "text-amber-800" : "text-slate-500"}`}>{saving ? t("Saving…", "กำลังบันทึก…") : dirty ? t("Unsaved changes", "ยังไม่ได้บันทึก") : t("No unsaved changes", "ไม่มีการแก้ไขค้าง")}</span>
              <button type="button" className="ees-fc-btn-quiet" disabled={!selectedRow} onClick={() => setFlagOpen((value) => !value)}>⚑ {t("Flag issue", "แจ้งปัญหา")}</button>
              <button type="button" className="ees-fc-btn-secondary" disabled={!canSave || draft.workOrder.trim().length < 3 || flagOpen} onClick={() => void save(true, true)} title={t("Record that you reviewed this job, then go to the next", "บันทึกว่าตรวจงานนี้แล้ว และไปงานถัดไป")}>✓ {t("Confirm job", "ยืนยันงาน")}</button>
              <button type="button" className="ees-fc-btn-secondary" disabled={!canSave} onClick={() => void save(false)}>{t("Save", "บันทึก")}</button>
              <button type="button" onClick={() => void save(true)} className="ees-fc-btn-primary" disabled={!canSave}>{saving ? t("Saving…", "กำลังบันทึก…") : `${t("Save & Next", "บันทึกและไปงานถัดไป")} ↵`}</button>
            </div>
          </>
        )}
      </form>
    </section>
  );
}
