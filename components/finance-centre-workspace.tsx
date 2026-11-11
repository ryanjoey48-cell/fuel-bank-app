"use client";
import "@/components/finance-workspace-v6.css";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import FinanceBookingDiaryPicker, {
  countAvailableBookingDiaryJobs, BOOKING_DIARY_FINANCE_FIELDS, toDiaryPickerSeed
} from "@/components/finance-booking-diary-picker";
import FinanceDemoPrint from "@/components/finance-demo-print";
import FinancePaperStack from "@/components/finance-paper-stack";
import FinanceBillingFlow, { resolveSheet } from "@/components/finance-billing-flow";
import FinanceAdminIntake, { isFlagged } from "@/components/finance-admin-intake";
import { financePricingAdminHref, useCanManagePricing } from "@/lib/use-finance-pricing-access";
import { ClipboardList } from "lucide-react";
import { useFinanceSettings } from "@/lib/use-finance-settings";
import type { DiaryBookingSeed } from "@/lib/finance-demo-centre";
import { formatBangkokTime, isLikelyTestBooking } from "@/lib/finance-display";
import { sheetSummary } from "@/lib/finance-demo-centre";
import FinanceAdminReceiptSummary from "@/components/finance-admin-receipt-summary";
import FinanceCustomerPricing from "@/components/finance-customer-pricing";
import { useFinanceFixture } from "@/components/finance-fixture-provider";
import { getAccessToken } from "@/lib/account-management";
import { useAccountAccess } from "@/lib/use-account-access";
import { useLanguage } from "@/lib/language-provider";
import {
  batchIssues,
  batchTotal,
  blockers,
  confirmedWorkOrder,
  returnedFieldsFor,
  customerTotal,
  customerJobReference,
  customerJobNumberDiffers,
  dashboardMetrics,
  docsFor,
  expenseTotal,
  fieldCompareStatus,
  missingDocs,
  missingReturnedFields,
  mismatches,
  nextAction,
  packManifest,
  ready,
  weekOf,
  type DocKind,
  type ExpenseKind,
  type ReturnedField,
  type Role
} from "@/lib/finance-demo-centre";
import { demoCopy } from "@/lib/finance-demo-copy";
import { financeRecordsCopy } from "@/lib/finance-records-copy";
import { sheetLifecycle } from "@/lib/finance-records";
import { supabase, supabaseConfigError } from "@/lib/supabase";
import type { FinanceWorkspaceId } from "@/lib/finance-local-persistence";
import { canUseFinanceAdminIntake } from "@/lib/finance-intake-access";
import { isFinanceFixtureMode } from "@/lib/finance-fixture-mode";

export type FinanceCentreSection = "overview" | "reconciliation" | "billing" | "documents" | "arrange" | "sheet" | "trn";
type Section = FinanceCentreSection;

const FLOW_SECTIONS = ["arrange", "sheet", "trn"] as const;
const LEGACY_SECTIONS: Section[] = ["overview", "billing", "documents"];
/** Developer drawer (role switcher, workspaces, audit, store tools) exists only in development builds. */
/** Developer diagnostics: development builds only, and only when opened deliberately with ?dev=1. Never in production. */
const IS_DEV_BUILD = process.env.NODE_ENV !== "production";
const flowStage = (value: Section) => (value === "sheet" ? "billing" : value === "trn" ? "documents" : "arrange") as "arrange" | "billing" | "documents";
const SECTION_ALIASES: Record<string, Section> = {
  arrange: "arrange",
  "arrange-work-orders": "arrange",
  sheet: "sheet",
  "billing-sheet": "sheet",
  trn: "trn",
  "trn-documents": "trn",
  intake: "reconciliation",
  "admin-intake": "reconciliation",
  overview: "overview",
  reconciliation: "reconciliation",
  verify: "reconciliation",
  verification: "reconciliation",
  inbox: "reconciliation",
  paperwork: "reconciliation",
  billing: "billing",
  expenses: "billing",
  pricing: "billing",
  // Older document / draft / pack / approval names open the ONE authoritative TRN & Documents stage.
  documents: "trn",
  drafts: "trn",
  packs: "trn",
  approval: "trn"
};

const money = (n: number) =>
  `฿${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const panel = "rounded-xl border border-violet-100 bg-white p-4 lg:p-5";
const button =
  "rounded-lg bg-violet-800 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300";
const buttonSecondary =
  "rounded-lg border border-violet-300 bg-white px-3 py-2 text-sm font-semibold text-violet-900 disabled:opacity-40";
const input = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900";
const tableHead = "bg-violet-50 text-left text-xs font-bold uppercase tracking-wide text-violet-950";
const tableCell = "border-b border-slate-100 px-3 py-2 align-middle text-sm";

const roleLabels: Record<Role, { en: string; th: string }> = {
  office: { en: "Office", th: "สำนักงาน" },
  admin: { en: "Admin", th: "ผู้ดูแลงาน" },
  management: { en: "Management", th: "ผู้บริหาร" },
  finance: { en: "Finance", th: "การเงิน" },
  approver: { en: "Approver", th: "ผู้อนุมัติ" },
  super_admin: { en: "Super Admin", th: "ผู้ดูแลระบบสูงสุด" }
};

export default function FinanceCentreWorkspace({
  initialSection = "overview"
}: {
  initialSection?: Section;
}) {
  const { language } = useLanguage();
  const { access } = useAccountAccess();
  const canManagePricing = useCanManagePricing();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const {
    state,
    workspaces,
    activeWorkspace,
    setActiveWorkspace,
    role,
    canAddDiaryWorkOrder,
    accessLoading,
    setRole,
    dispatch,
    ensureDiaryBooking,
    addDiaryWorkOrder,
    saveCurrentWorkspace,
    error,
    clearError,
    hydrateReady,
    persistStatus,
    lastSavedAt,
    resetActiveWorkspace,
    loadCompletedIntoPreviousDemo,
    clearPersistedStore
  } = useFinanceFixture();
  const c = demoCopy[language];
  const th = language === "th";
  const t = (en: string, thai: string) => (th ? thai : en);
  const canActAs = (required: Role) => required === "admin"
    ? canUseFinanceAdminIntake(access, role, isFinanceFixtureMode())
    : role === "super_admin" || role === required;
  const returnedFieldLabel = (field: Exclude<ReturnedField, "workOrder">) => field === "client" ? c.customer : field === "jobNumber" ? t("Job number", "เลขงาน") : field === "pickupTime" ? t("Pickup time", "เวลารับ") : c.fields[field];
  const isOwner = activeWorkspace === "owner";
  const bookingParam = params.get("booking");
  const sectionParam = params.get("section");
  const resolvedInitial =
    (sectionParam && SECTION_ALIASES[sectionParam]) ||
    initialSection ||
    "overview";
  const [section, setSection] = useState<Section>(resolvedInitial);
  const [intakeDirty, setIntakeDirty] = useState(false);
  const [jobId, setJobId] = useState(bookingParam || "");
  const [batchId, setBatchId] = useState("");
  const [physical, setPhysical] = useState("");
  const [workOrder, setWorkOrder] = useState("");
  const [expenseKind, setExpenseKind] = useState<ExpenseKind>("parking");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseReference, setExpenseReference] = useState("");
  const [decision, setDecision] = useState("");
  const [priceAmount, setPriceAmount] = useState("");
  const [priceReason, setPriceReason] = useState("");
  const [customer, setCustomer] = useState("");
  const [week, setWeek] = useState("");
  const [rejection, setRejection] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [devToolsOpen, setDevToolsOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [flowClient, setFlowClient] = useState(params.get("customer") || "");
  const [flowSheet, setFlowSheet] = useState(params.get("sheet") || "");
  const [confirmClear, setConfirmClear] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [paperSaving, setPaperSaving] = useState(false);
  const [paperSaveMessage, setPaperSaveMessage] = useState("");
  const [availableDiaryCount, setAvailableDiaryCount] = useState<number | null>(null);
  const { settings: financeSettings } = useFinanceSettings();

  const [returnedDraft, setReturnedDraft] = useState<Record<Exclude<ReturnedField, "workOrder">, string>>({
    client: "", jobNumber: "", pickupTime: "",
    date: "",
    pickup: "",
    delivery: "",
    driver: "",
    vehicle: ""
  });
  const [waiveKind, setWaiveKind] = useState<Exclude<DocKind, "green_order">>("parking");
  const [waiveReason, setWaiveReason] = useState("");

  useEffect(() => {
    if (!isOwner) return;
    let active = true;
    void countAvailableBookingDiaryJobs().then((count) => {
      if (active) setAvailableDiaryCount(count);
    });
    return () => {
      active = false;
    };
  }, [isOwner, state.bookings.length]);




  useEffect(() => {
    if (!bookingParam || supabaseConfigError) return;
    if (state.bookings.some((item) => item.id === bookingParam)) {
      setJobId(bookingParam);
      if (!sectionParam) setSection("reconciliation");
      return;
    }
    let active = true;
    void (async () => {
      const { data, error: queryError } = await supabase
        .from("booking_diary")
        .select("id,booking_id,client_id,booking_date,pickup_time,pickup,dropoff,driver,vehicle,vehicle_registration,job_order_number,client:clients(name)")
        .eq("id", bookingParam)
        .maybeSingle();
      if (!active || queryError || !data) return;
      const row = data as {
        id: string;
        booking_id?: string | null;
        client_id?: string | null;
        booking_date: string;
        pickup_time?: string | null;
        pickup: string;
        dropoff: string;
        driver?: string | null;
        vehicle?: string | null;
        vehicle_registration?: string | null;
        job_order_number?: string | null;
        client?: { name?: string | null } | { name?: string | null }[] | null;
      };
      const clientRel = Array.isArray(row.client) ? row.client[0] : row.client;
      ensureDiaryBooking({
        id: row.id,
        booking_id: row.booking_id,
        client_id: row.client_id,
        client_name: clientRel?.name ?? null,
        booking_date: row.booking_date,
        pickup_time: row.pickup_time,
        pickup: row.pickup,
        dropoff: row.dropoff,
        driver: row.driver,
        vehicle: row.vehicle,
        vehicle_registration: row.vehicle_registration,
        job_order_number: row.job_order_number
      });
      setJobId(row.id);
      setSection("reconciliation");
    })();
    return () => {
      active = false;
    };
  }, [bookingParam, state.bookings, ensureDiaryBooking, sectionParam]);

  useEffect(() => {
    if (sectionParam && SECTION_ALIASES[sectionParam]) {
      setSection(SECTION_ALIASES[sectionParam]);
    } else if (!sectionParam && initialSection) {
      setSection(initialSection);
    }
  }, [sectionParam, initialSection]);

  useEffect(() => {
    if (bookingParam && state.bookings.some((item) => item.id === bookingParam)) {
      setJobId(bookingParam);
    } else if (!bookingParam && jobId && !state.bookings.some((item) => item.id === jobId)) {
      setJobId(state.bookings[0]?.id || "");
    } else if (!jobId && state.bookings[0]?.id) {
      setJobId(state.bookings[0].id);
    }
  }, [bookingParam, state.bookings, jobId]);

  const selected = state.bookings.find((j) => j.id === jobId);
  const selectedBatch = state.batches.find((b) => b.id === batchId) ?? state.batches[0];
  const selectedDiaryId = isOwner && selected?.origin === "booking_diary_local_test" ? selected.id : null;
  useEffect(() => {
    if (!selectedDiaryId || !hydrateReady || supabaseConfigError) return;
    let active = true;
    const refresh = async () => {
      const { data, error: sourceError } = await supabase.from("booking_diary").select(BOOKING_DIARY_FINANCE_FIELDS).eq("id", selectedDiaryId).maybeSingle();
      if (active && !sourceError && data) ensureDiaryBooking(toDiaryPickerSeed(data as Record<string, unknown>));
    };
    void refresh();
    window.addEventListener("focus", refresh);
    return () => { active = false; window.removeEventListener("focus", refresh); };
  }, [selectedDiaryId, hydrateReady, ensureDiaryBooking]);
  const metrics = dashboardMetrics(state);
  const customers = useMemo(
    () => [...new Map(state.bookings.map((j) => [j.clientId, j.client])).entries()],
    [state.bookings]
  );
  const action = selected ? nextAction(state, selected.id) : null;
  const actionSection: Section =
    action?.view === "billing" || action?.view === "expenses"
      ? "billing"
      : action?.view === "drafts" || action?.view === "packs"
        ? "documents"
        : "reconciliation";

  useEffect(() => {
    if (!selected) {
      setWorkOrder("");
      setReturnedDraft({ client: "", jobNumber: "", pickupTime: "", date: "", pickup: "", delivery: "", driver: "", vehicle: "" });
      return;
    }
    // Only re-seed drafts when the selected booking changes — not on every reconciliation save.
    setWorkOrder(confirmedWorkOrder(selected) || selected.returned.workOrder || "");
    setPriceAmount(selected.price?.amount.toString() || "");
    setPriceReason(selected.price?.reason || "");
    setReturnedDraft({
      client: selected.returned.client || "", jobNumber: selected.returned.jobNumber || "", pickupTime: selected.returned.pickupTime || "",
      date: selected.returned.date || "",
      pickup: selected.returned.pickup || "",
      delivery: selected.returned.delivery || "",
      driver: selected.returned.driver || "",
      vehicle: selected.returned.vehicle || ""
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally keyed by booking id
  }, [selected?.id]);

  useEffect(() => {
    if (!selected?.workOrderConfirmed) return;
    setWorkOrder(confirmedWorkOrder(selected));
  }, [selected?.id, selected?.workOrderConfirmed, selected?.returned.workOrder]);

  const syncUrl = (nextJobId: string, nextSection: Section, client = flowClient, sheet = flowSheet) => {
    const query = new URLSearchParams();
    query.set("section", nextSection);
    if (params.get("dev") === "1") query.set("dev", "1"); // keep the development diagnostics open while navigating
    if (nextJobId) query.set("booking", nextJobId);
    if (client) query.set("customer", client);
    if (sheet) query.set("sheet", sheet);
    router.replace(`${pathname}?${query.toString()}`, { scroll: false });
  };

  const chooseJob = (id: string, target?: Section) => {
    setJobId(id);
    const nextSection = target || section;
    if (target) setSection(target);
    clearError();
    syncUrl(id, nextSection);
  };

  const syncFlow = (client: string, sheet: string) => syncUrl("", section, client, sheet);

  const chooseSection = (id: Section) => {
    if (id !== section && intakeDirty && !window.confirm(t("You have unsaved intake edits. Leave without saving?", "มีการแก้ไขที่ยังไม่ได้บันทึก ต้องการออกโดยไม่บันทึกหรือไม่?"))) return;
    setSection(id);
    setMoreOpen(false);
    // Only the legacy screens are booking-centric; the new steps keep the URL clean (customer/sheet only).
    syncUrl(LEGACY_SECTIONS.includes(id) ? selected?.id || jobId : "", id);
  };

  const switchWorkspace = (id: FinanceWorkspaceId) => {
    setActiveWorkspace(id);
    setJobId("");
    setBatchId("");
    clearError();
    syncUrl("", "overview");
    setSection("overview");
  };

  const openBookingPicker = () => {
    setPickerOpen(true);
  };

  const customerId = customer || selected?.clientId || customers[0]?.[0] || "";
  const billingWeek = week || (selected ? weekOf(selected.date) : null) || "";
  const availableWeeks = [
    ...new Set(
      state.bookings
        .filter((j) => j.clientId === customerId)
        .map((j) => weekOf(j.date))
        .filter(Boolean)
    )
  ] as string[];
  const batchJobs = selectedBatch
    ? state.bookings.filter(
        (j) => j.clientId === selectedBatch.clientId && weekOf(j.date) === selectedBatch.week
      )
    : [];
  const documentRows = selected ? state.documents.filter((d) => d.suggestedJobId === selected.id) : [];
  const missing = selected ? missingDocs(state, selected.id) : [];
  const missingReturned = selected ? missingReturnedFields(selected).filter((field) => field !== "workOrder") : [];
  const issues = selectedBatch ? batchIssues(state, selectedBatch) : [];
  const activeWeek = availableWeeks.includes(billingWeek) ? billingWeek : availableWeeks[0] ?? "";
  const canCompare =
    !!selected &&
    canActAs("admin") &&
    selected.workOrderConfirmed &&
    !!confirmedWorkOrder(selected) &&
    selected.status !== "verified" &&
    selected.status !== "discrepancy" &&
    missingReturned.length === 0 &&
    missing.length === 0;
  const linkedIds = useMemo(() => new Set(state.bookings.map((job) => job.id)), [state.bookings]);
  const linkedStatusById = useMemo(
    () => new Map(state.bookings.map((job) => [job.id, job.status])),
    [state.bookings]
  );
  const linkedCustomerJobNumberById = useMemo(() => new Map(state.bookings.map((job) => [job.id, customerJobReference(job)])), [state.bookings]);
  const linkedWorkOrderById = useMemo(
    () =>
      new Map(
        state.bookings
          .map((job) => [job.id, confirmedWorkOrder(job) || job.returned.workOrder || ""] as const)
          .filter((entry) => entry[1])
      ),
    [state.bookings]
  );
  const operationalCounts = useMemo(() => {
    const selectedForRecon = state.bookings.length;
    const awaitingPaperwork = state.bookings.filter((job) => missingDocs(state, job.id).length > 0).length;
    const awaitingVerification = state.bookings.filter((job) => {
      const step = nextAction(state, job.id);
      return step.key === "verify" || step.key === "enter_work_order" || step.key === "match_paperwork";
    }).length;
    const mismatchCount = state.bookings.filter((job) => (mismatches(job).length > 0 || customerJobNumberDiffers(job)) && job.status !== "verified").length;
    const awaitingManagement = state.bookings.filter((job) => job.status === "discrepancy").length;
    const awaitingRecheck = state.bookings.filter((job) => job.status === "needs_recheck").length;
    const verifiedReady = state.bookings.filter((job) => ready(state, job.id)).length;
    return {
      availableDiary: availableDiaryCount,
      selectedForRecon,
      awaitingPaperwork,
      awaitingVerification,
      mismatchCount,
      awaitingManagement,
      awaitingRecheck,
      verifiedReady
    };
  }, [state, availableDiaryCount]);

  const isFlowSection = (FLOW_SECTIONS as readonly Section[]).includes(section);
  const friendlySaveStatus = intakeDirty ? t("Unsaved changes", "ยังไม่ได้บันทึก") : !hydrateReady || persistStatus === "loading" ? t("Loading…", "กำลังโหลด…")
    : persistStatus === "saving" ? t("Saving…", "กำลังบันทึก…")
      : persistStatus === "conflict" ? t("Not saved — changed elsewhere", "ยังไม่ได้บันทึก — มีการแก้ไขที่อื่น")
      : persistStatus === "error" ? t("Not saved — try again", "ยังไม่ได้บันทึก — ลองอีกครั้ง")
        : lastSavedAt ? t(`All changes saved · ${formatBangkokTime(lastSavedAt)}`, `บันทึกแล้ว · ${formatBangkokTime(lastSavedAt)} น.`) : "";
  const currentSheet = isOwner && flowClient ? resolveSheet(state, flowClient, flowSheet) : undefined;
  const countSheets = currentSheet ? [currentSheet] : (state.billingSheets || []).filter((sheet) => !sheet.readyForApprovalAt);
  const missingPriceCount = countSheets.reduce((sum, sheet) => sum + sheetSummary(state, sheet).missingPrices, 0);
  const intakeEntered = state.bookings.filter(job => !!confirmedWorkOrder(job)).length;
  const intakeVerified = state.bookings.filter(job => job.status === "verified").length;
  // Completion is derived from saved data only — visiting a screen never marks it done, and a draft that is ready for
  // review is shown as "Ready for review", never as issued. Amber marks a stage that needs action.
  const lifecycle = currentSheet ? sheetLifecycle(state, currentSheet) : null;
  const selectedSummary = currentSheet ? sheetSummary(state, currentSheet) : null;
  const flaggedJobs = state.bookings.filter((job) => isFlagged(job)).length;
  const reviewDone = !!lifecycle && ["approved", "issued"].includes(lifecycle) && selectedSummary?.blockers.length === 0;
  const billingBlockers = countSheets.reduce((sum, sheet) => sum + sheetSummary(state, sheet).blockers.length, 0);
  const hasPapers = !!currentSheet?.jobIds.length;
  const stepItems: { id: Section; label: string; number: string; count: string; done: boolean; attention: boolean }[] = [
    { id: "reconciliation", label: t("Admin Intake", "รับใบงาน"), number: "", attention: flaggedJobs > 0,
      count: flaggedJobs ? t(flaggedJobs + " flagged · all intake", "แจ้งตรวจ " + flaggedJobs + " · งานรับทั้งหมด") : intakeEntered ? t(intakeEntered + " entered · " + intakeVerified + " verified", "บันทึก " + intakeEntered + " · ตรวจแล้ว " + intakeVerified) : t("No saved intake", "ยังไม่มีงานรับที่บันทึก"),
      done: false },
    { id: "arrange", label: t("Arrange Work Orders", "จัดเรียงใบงาน"), number: "1", attention: !!selectedSummary && (selectedSummary.missingPapers > 0 || selectedSummary.needsChecking.length > 0),
      count: currentSheet ? t(`${currentSheet.jobIds.length} ${currentSheet.jobIds.length === 1 ? "paper" : "papers"}`, `${currentSheet.jobIds.length} ใบ`) : (state.billingSheets || []).length ? t("Choose invoice", "เลือกใบแจ้งหนี้") : "",
      done: hasPapers && !selectedSummary!.missingPapers && !selectedSummary!.needsChecking.length },
    { id: "sheet", label: t("Customer Billing", "วางบิลลูกค้า"), number: "2", attention: hasPapers && billingBlockers > 0,
      count: !currentSheet && (state.billingSheets || []).length ? t("Choose invoice", "เลือกใบแจ้งหนี้") : countSheets.some((sheet) => sheet.jobIds.length) ? (missingPriceCount ? t(`${missingPriceCount} prices missing`, `ขาดราคา ${missingPriceCount}`) : t(currentSheet?.approvedAt ? "Approved, not issued" : currentSheet?.readyForApprovalAt ? "Awaiting review" : "Draft · all priced", currentSheet?.approvedAt ? "อนุมัติแล้ว ยังไม่ออก" : currentSheet?.readyForApprovalAt ? "รอตรวจสอบ" : "ร่าง · ใส่ราคาครบ")) : "",
      done: hasPapers && billingBlockers === 0 && !!currentSheet?.readyForApprovalAt },
    { id: "trn", label: t("Invoice & Documents", "ใบแจ้งหนี้และเอกสาร"), number: "3", attention: lifecycle === "needs_correction",
      count: lifecycle ? financeRecordsCopy[language].status[lifecycle] : (state.billingSheets || []).length ? t("Choose invoice", "เลือกใบแจ้งหนี้") : "", done: reviewDone }
  ];

  const awaitingJobs = state.bookings.filter((j) => {
    const n = nextAction(state, j.id);
    return n.key !== "complete";
  });

  return (
    <>
      <main className="finance-centre-workspace ees-fc ees-fc-shell fc6-workspace space-y-3 text-slate-900" onClickCapture={(event) => {
        if (!intakeDirty || !(event.target instanceof Element) || !event.target.closest("a[href]")) return;
        if (!window.confirm(t("You have unsaved intake edits. Leave without saving?", "มีการแก้ไขที่ยังไม่ได้บันทึก ต้องการออกโดยไม่บันทึกหรือไม่?"))) { event.preventDefault(); event.stopPropagation(); }
      }}>
        {persistStatus === "conflict" ? (
          <div role="alert" data-testid="finance-conflict" className="flex flex-wrap items-center gap-3 rounded-xl bg-rose-50 px-4 py-2 text-sm text-rose-900 ring-1 ring-rose-200">
            <span className="font-semibold">{t("These Finance records were changed in another tab or window. Nothing from this tab was saved over them.", "ข้อมูลการเงินถูกแก้ไขในแท็บหรือหน้าต่างอื่น ระบบไม่ได้บันทึกทับข้อมูลนั้น")}</span>
            <button type="button" className="ees-fc-btn-primary !py-1" onClick={() => window.location.reload()}>{t("Reload latest", "โหลดข้อมูลล่าสุด")}</button>
          </div>
        ) : null}
        <header className="ees-fc-header">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-slate-950">{t("Finance Centre", "ศูนย์การเงิน")}</h1>
        {isOwner && hydrateReady ? <details className="fc6-progress" data-testid="finance-progress-summary"><summary>{t("Workspace progress", "ความคืบหน้างาน")} · {(state.billingSheets || []).length} {t((state.billingSheets || []).length === 1 ? "invoice group" : "invoice groups", "กลุ่มใบแจ้งหนี้")}</summary><div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-1 text-xs text-slate-600" aria-label={t("Finance progress summary", "สรุปความคืบหน้าการเงิน")}>
          <span>{t("Invoice groups", "กลุ่มใบแจ้งหนี้")}: <b>{(state.billingSheets || []).length}</b></span>
          <span>{t("Drafts to complete", "ร่างที่ต้องดำเนินการ")}: <b>{(state.billingSheets || []).filter((group) => !group.readyForApprovalAt && !group.approvedAt).length}</b></span>
          <span>{t("Awaiting review", "รอตรวจสอบ")}: <b>{(state.billingSheets || []).filter((group) => group.readyForApprovalAt && !group.approvedAt).length}</b></span>
          <span className="text-emerald-800">{t("Approved, not issued", "อนุมัติแล้ว ยังไม่ออก")}: <b>{(state.billingSheets || []).filter((group) => group.approvedAt).length}</b></span>
          {flaggedJobs ? <span className="font-semibold text-orange-800">{t("Flagged jobs", "งานที่แจ้งปัญหา")}: {flaggedJobs}</span> : null}
        </div></details> : null}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {!isFlowSection && friendlySaveStatus ? <span role="status" className="ees-fc-save" data-state={intakeDirty ? "unsaved" : persistStatus === "error" || persistStatus === "conflict" ? "error" : persistStatus === "saving" || persistStatus === "loading" || !hydrateReady ? "saving" : "saved"}>{friendlySaveStatus}</span> : null}
            <Link className="ees-fc-btn-secondary !py-1.5" href="/finance-records" data-testid="open-finance-records">{financeRecordsCopy[language].nav} →</Link>
            <span className="rounded-full bg-orange-50 px-3 py-1 text-xs font-semibold text-orange-800 ring-1 ring-orange-200">{t("Test mode — browser workspace · no invoices issued", "โหมดทดสอบ — เก็บในเบราว์เซอร์ · ยังไม่ออกใบแจ้งหนี้")}</span>
          </div>
        </header>

        <nav aria-label={t("Finance steps", "ขั้นตอนการเงิน")} className="ees-fc-steps">
          <ol className="flex min-w-0 flex-1 flex-wrap gap-1.5">
            {stepItems.map((step) => {
              const current = section === step.id;
              return (
                <li key={step.id} className="min-w-0 flex-1 basis-[11rem]">
                  <button type="button" data-stage-state={step.attention ? "attention" : step.done ? "complete" : current ? "active" : "pending"} aria-current={current ? "step" : undefined} onClick={() => chooseSection(step.id)}
                    className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition ${current ? "bg-violet-800 text-white shadow-sm" : "text-slate-700 hover:bg-white"}`}>
                    <span className={`relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${step.attention ? "ees-fc-step-attention " : ""}${current ? "bg-white text-violet-900" : step.done ? "bg-emerald-100 text-emerald-800" : "bg-white text-slate-600 ring-1 ring-slate-200"}`}>
                      {step.done && !current ? "✓" : step.number || <ClipboardList aria-hidden="true" className="h-4 w-4" strokeWidth={2.25} />}
                      {step.attention ? <span className="sr-only">{t("Needs attention", "ต้องดำเนินการ")}</span> : null}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-base font-bold leading-tight">{step.label}</span>
                      <span className={`block truncate text-xs ${current ? "text-violet-100" : step.attention ? "font-semibold text-amber-700" : "text-slate-500"}`}>{step.count || (step.attention ? t("Needs attention", "ต้องดำเนินการ") : step.done ? t("Completed", "เสร็จแล้ว") : current ? t("In progress", "กำลังดำเนินการ") : t("Not started", "ยังไม่เริ่ม"))}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          <div className="relative shrink-0">
            <button type="button" aria-haspopup="menu" aria-expanded={moreOpen} onClick={() => setMoreOpen((value) => !value)}
              className={`rounded-xl px-3 py-2.5 text-sm font-semibold ${LEGACY_SECTIONS.includes(section) ? "bg-white text-violet-900 ring-1 ring-violet-300" : "text-slate-700 hover:bg-white"}`}>
              {t("More", "เพิ่มเติม")} ▾
            </button>
            {moreOpen ? (
              <div role="menu" className="absolute right-0 z-40 mt-1 w-72 rounded-xl bg-white p-1 shadow-xl ring-1 ring-slate-200">
                {([
                  ["overview", t("Overview", "ภาพรวม")],
                  ["billing", t("Legacy billing", "วางบิลแบบเดิม")]
                ] as [Section, string][]).filter(([id]) => id !== "billing" || canManagePricing).map(([id, label]) => (
                  <button key={id} role="menuitem" type="button" title={id === "billing" ? t("Rates, Fuel & Legacy Billing", "ราคา น้ำมัน และวางบิลแบบเดิม") : undefined} onClick={() => { setMoreOpen(false); chooseSection(id); }}
                    className={`w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50 ${section === id ? "font-bold text-violet-900" : "text-slate-800"}`}>{label}</button>
                ))}
                {canManagePricing ? <Link role="menuitem" data-testid="more-pricing-administration" href={financePricingAdminHref(flowClient, currentSheet?.id || flowSheet)} className="block rounded-lg px-3 py-2 text-sm text-slate-800 hover:bg-slate-50" onClick={() => setMoreOpen(false)}>{t("Pricing Administration", "ตั้งค่าราคา")} ↗</Link> : null}
                <Link role="menuitem" href="/finance-records" className="block rounded-lg px-3 py-2 text-sm text-slate-800 hover:bg-slate-50" onClick={() => setMoreOpen(false)}>{financeRecordsCopy[language].nav} ↗</Link>
                <Link role="menuitem" href="/booking-diary" className="block rounded-lg px-3 py-2 text-sm text-slate-800 hover:bg-slate-50" onClick={() => setMoreOpen(false)}>{t("Open Booking Diary", "เปิดสมุดจอง")} ↗</Link>
              </div>
            ) : null}
          </div>
        </nav>


        {error ? (
          <div
            role="alert"
            className="flex justify-between rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900"
          >
            <span>
              {c.errors[error.split(":")[0] as keyof typeof c.errors] ?? c.error}{" "}
              {error.includes(":") ? error.split(":")[1] : ""}
            </span>
            <button type="button" onClick={clearError} className="underline">
              {c.close}
            </button>
          </div>
        ) : null}

        {(FLOW_SECTIONS as readonly Section[]).includes(section) ? (
          isOwner ? (
            <FinanceBillingFlow
              stage={flowStage(section)}
              onStage={(stage) => chooseSection(stage === "billing" ? "sheet" : stage === "documents" ? "trn" : "arrange")}
              clientId={flowClient}
              onClient={(id) => { setFlowClient(id); setFlowSheet(""); syncFlow(id, ""); }}
              sheetId={flowSheet}
              onSheet={(id) => { setFlowSheet(id); syncFlow(flowClient, id); }}
              language={language}
              t={t}
              openAdminIntake={(id) => (id ? chooseJob(id, "reconciliation") : chooseSection("reconciliation"))}
              openRateTools={(id) => chooseJob(id, "billing")}
            />
          ) : (
            <p className={`${panel} text-base`}>
              {t("The billing workflow uses the owner walkthrough records only.", "ขั้นตอนวางบิลใช้ข้อมูลเวิร์กโฟลว์เจ้าของเท่านั้น")}{" "}
              <button type="button" className="font-bold text-violet-800 underline" onClick={() => switchWorkspace("owner")}>{t("Switch to owner walkthrough", "สลับไปเวิร์กโฟลว์เจ้าของ")}</button>
            </p>
          )
        ) : null}

        {section === "reconciliation" && isOwner ? <FinanceAdminIntake t={t} language={language} focusJobId={bookingParam || undefined} onDirtyChange={setIntakeDirty} /> : null}

        {state.bookings.length > 0 && !isFlowSection && !(section === "reconciliation" && isOwner) ? (
          <section className={`${panel} border-l-4 border-l-violet-700`}>
            <div className="grid gap-4 lg:grid-cols-[minmax(260px,0.85fr)_minmax(0,2fr)]">
              <div>
                <label className="block text-xs font-bold text-slate-500" htmlFor="finance-job">
                  {t("Selected booking", "รายการจองที่เลือก")}
                </label>
                <select
                  id="finance-job"
                  className={`${input} mt-1 font-semibold`}
                  value={selected?.id ?? ""}
                  onChange={(e) => chooseJob(e.target.value)}
                >
                  {state.bookings.map((j) => {
                    const wo = confirmedWorkOrder(j);
                    const label = wo
                      ? `WO ${wo} · ${j.client} · ${j.date}`
                      : `${j.client} · ${j.date} · ${c.awaitingGreenSheet}`;
                    return (
                      <option key={j.id} value={j.id}>
                        {label}
                      </option>
                    );
                  })}
                </select>
                <p className="mt-2 text-xs text-slate-500">
                  {selected?.origin === "booking_diary_local_test"
                    ? t(
                        "Linked from Booking Diary · original booking not overwritten",
                        "เชื่อมจากสมุดจอง · ไม่เขียนทับรายการจองต้นฉบับ"
                      )
                    : selected?.source
                      ? `${selected.source.sheet}!${selected.source.row} · ${c.sourceOnly}`
                      : c.simulated}
                </p>
              </div>
              {selected ? (
                <div className="grid grid-cols-2 gap-x-5 gap-y-2 text-sm md:grid-cols-3 xl:grid-cols-5">
                  <div>
                    <small className="text-slate-500">{c.workOrder}</small>
                    <p className="font-semibold text-violet-900">
                      {confirmedWorkOrder(selected) || t("Pending", "รอดำเนินการ")}
                    </p>
                  </div>
                  <div>
                    <small className="text-slate-500">{t("Customer Job Number", "เลขที่งานลูกค้า")}</small>
                    <p className="break-words font-semibold">{customerJobReference(selected) || "—"}</p>
                  </div>
                  <div>
                    <small className="text-slate-500">{c.customer}</small>
                    <p className="font-semibold">{selected.client}</p>
                  </div>
                  <div>
                    <small className="text-slate-500">{c.status}</small>
                    <p className="font-semibold text-violet-800">{c.statuses[selected.status]}</p>
                  </div>
                  <div className="col-span-2">
                    <small className="text-slate-500">{c.route}</small>
                    <p>
                      {selected.pickup || t("Pending", "รอดำเนินการ")} →{" "}
                      {selected.delivery || t("Pending", "รอดำเนินการ")}
                    </p>
                  </div>
                </div>
              ) : null}
            </div>
            {selected?.financeCheck ? (
              <p role="alert" className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-base font-semibold text-amber-950">
                {t("Finance sent this work order back for checking", "การเงินส่งใบงานนี้กลับมาให้ตรวจสอบ")}: {selected.financeCheck.reason}
                <span className="block text-xs font-normal">{t("Re-check and verify it in Job Reconciliation; the flag clears when it is verified.", "ตรวจและยืนยันใหม่ในหน้ากระทบยอด การแจ้งจะหายเมื่อยืนยันแล้ว")}</span>
              </p>
            ) : null}
            {selected && action ? (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-violet-50 pt-3 text-sm">
                <p>
                  <strong>{c.nextAction}:</strong> {c.nextActions[action.key]}{" "}
                  <span className="ml-2 rounded bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-900">
                    {c.roles[action.role]}
                  </span>
                </p>
                <button className="font-bold text-violet-800 underline" type="button" onClick={() => chooseSection(actionSection)}>
                  {t("Open this step →", "เปิดขั้นตอนนี้ →")}
                </button>
              </div>
            ) : null}
          </section>
        ) : null}

        {section === "billing" && isOwner ? (
          <FinancePaperStack state={state} role={role} dispatch={dispatch} selectedId={jobId}
            openJob={(id) => chooseJob(id, "billing")} saveSequence={() => saveCurrentWorkspace()} t={t} />
        ) : null}
        {section === "billing" && isOwner && selected ? <FinanceCustomerPricing key={selected.id} state={state} job={selected} role={role} dispatch={dispatch} t={t} /> : null}
        {section === "overview" ? (
          <div className="space-y-4">
            {isOwner ? (
              <section className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
                {(
                  [
                    [t("Available Booking Diary jobs", "งานในสมุดจองที่พร้อม"), operationalCounts.availableDiary ?? "…"],
                    [t("Selected for reconciliation", "เลือกแล้วเพื่อกระทบยอด"), operationalCounts.selectedForRecon],
                    [t("Awaiting paperwork", "รอเอกสาร"), operationalCounts.awaitingPaperwork],
                    [t("Awaiting verification", "รอตรวจยืนยัน"), operationalCounts.awaitingVerification],
                    [t("Mismatches", "ข้อมูลไม่ตรง"), operationalCounts.mismatchCount],
                    [t("Awaiting management", "รอผู้บริหาร"), operationalCounts.awaitingManagement],
                    [t("Awaiting office recheck", "รอสำนักงานตรวจซ้ำ"), operationalCounts.awaitingRecheck],
                    [t("Verified · ready for billing", "ตรวจแล้ว · พร้อมวางบิล"), operationalCounts.verifiedReady]
                  ] as [string, number | string][]
                ).map(([label, value]) => (
                  <article className={panel} key={label}>
                    <p className="text-[11px] font-semibold leading-snug text-slate-500">{label}</p>
                    <p className="mt-1 text-2xl font-bold text-violet-900">{value}</p>
                  </article>
                ))}
              </section>
            ) : null}
            {isOwner ? (
              <section className={`${panel} flex flex-wrap gap-2`}>
                <button type="button" className={button} onClick={openBookingPicker}>
                  {t("Select Booking Diary Jobs", "เลือกงานจากสมุดจอง")}
                </button>
                <button
                  type="button"
                  className={buttonSecondary}
                  disabled={state.bookings.length === 0}
                  onClick={() => chooseSection("reconciliation")}
                >
                  {t("Continue Job Reconciliation", "ดำเนินการกระทบยอดงานต่อ")}
                </button>
                <button
                  type="button"
                  className={buttonSecondary}
                  disabled={operationalCounts.awaitingManagement + operationalCounts.mismatchCount === 0}
                  onClick={() => {
                    const hold = state.bookings.find((job) => job.status === "discrepancy" || mismatches(job).length > 0 || customerJobNumberDiffers(job));
                    if (hold) chooseJob(hold.id, "reconciliation");
                    else chooseSection("reconciliation");
                  }}
                >
                  {t("Review Discrepancies", "ตรวจทานข้อแตกต่าง")}
                </button>
                <button
                  type="button"
                  className={buttonSecondary}
                  disabled={operationalCounts.verifiedReady === 0}
                  onClick={() => {
                    const readyJob = state.bookings.find((job) => ready(state, job.id));
                    if (readyJob) chooseJob(readyJob.id, "billing");
                    else chooseSection("billing");
                  }}
                >
                  {t("Prepare Customer Billing", "เตรียมวางบิลลูกค้า")}
                </button>
              </section>
            ) : null}
            {isOwner && state.bookings.length === 0 ? (
              <section className={`${panel} text-center`}>
                <h2 className="text-lg font-bold text-violet-950">{t("Select existing Booking Diary jobs", "เลือกงานจากสมุดจองที่มีอยู่")}</h2>
                <p className="mx-auto mt-2 max-w-xl text-sm text-slate-600">
                  {t(
                    "Your test bookings already exist in Booking Diary. Select them here to reconcile against returned green job orders — do not recreate them.",
                    "งานทดสอบมีอยู่ในสมุดจองแล้ว เลือกจากที่นี่เพื่อกระทบยอดกับใบสั่งงานสีเขียว — ไม่ต้องสร้างใหม่"
                  )}
                </p>
                <button type="button" className={`${button} mt-4`} onClick={openBookingPicker}>
                  {t("Select Booking Diary Jobs", "เลือกงานจากสมุดจอง")}
                </button>
              </section>
            ) : (
              <>
                {!isOwner ? (
                  <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    {(
                      [
                        [t("Jobs in workspace", "งานในพื้นที่นี้"), metrics.totalJobs],
                        [t("Need action", "ต้องดำเนินการ"), awaitingJobs.length],
                        [t("Ready for billing", "พร้อมวางบิล"), metrics.readyForFinance],
                        [t("Weekly batches", "ชุดวางบิล"), state.batches.length]
                      ] as [string, number][]
                    ).map(([label, value]) => (
                      <article className={panel} key={label}>
                        <p className="text-xs font-semibold text-slate-500">{label}</p>
                        <p className="mt-1 text-2xl font-bold text-violet-900">{value}</p>
                      </article>
                    ))}
                  </section>
                ) : null}
                <section className={panel}>
                  <h2 className="text-lg font-bold text-violet-950">{c.overviewQueue}</h2>
                  {awaitingJobs.length === 0 ? (
                    <p className="mt-3 text-sm text-slate-500">{t("No jobs currently awaiting action.", "ไม่มีงานที่ต้องดำเนินการตอนนี้")}</p>
                  ) : (
                    <div className="mt-3 overflow-x-auto">
                      <table className="w-full min-w-[720px] text-left text-sm">
                        <thead className={tableHead}>
                          <tr>
                            {[c.workOrder, c.customer, c.date, c.status, c.nextAction, t("Open", "เปิด")].map((h) => (
                              <th key={h} className="px-3 py-2">
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {awaitingJobs.map((j) => {
                            const n = nextAction(state, j.id);
                            return (
                              <tr key={j.id} className="hover:bg-violet-50/60">
                                <td className={`${tableCell} font-semibold`}>
                                  {confirmedWorkOrder(j) || t("Pending", "รอดำเนินการ")}
                                    <span className="block text-sm font-normal">{t("Customer Job Number", "เลขที่งานลูกค้า")}: {customerJobReference(j) || "—"}</span>
                                </td>
                                <td className={tableCell}>{j.client}</td>
                                <td className={tableCell}>{j.date}</td>
                                <td className={tableCell}>{c.statuses[j.status]}</td>
                                <td className={tableCell}>
                                  {c.nextActions[n.key]} · {c.roles[n.role]}
                                </td>
                                <td className={tableCell}>
                                  <button
                                    type="button"
                                    className="font-bold text-violet-800 underline"
                                    onClick={() =>
                                      chooseJob(
                                        j.id,
                                        n.view === "expenses" || n.view === "billing"
                                          ? "billing"
                                          : n.view === "drafts" || n.view === "packs"
                                            ? "documents"
                                            : "reconciliation"
                                      )
                                    }
                                  >
                                    {c.view}
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              </>
            )}
          </div>
        ) : null}

        {section === "reconciliation" && !isOwner ? (
          !selected ? (
            <section className={panel}>
              <h2 className="text-lg font-bold text-violet-950">{t("Job Reconciliation", "ตรวจสอบและกระทบยอดงาน")}</h2>
              <p className="mt-2 text-sm text-slate-600">
                {t(
                  "Select one or more existing Booking Diary jobs, then enter the returned green job-order details here.",
                  "เลือกงานจากสมุดจองที่มีอยู่ แล้วกรอกรายละเอียดจากใบสั่งงานสีเขียวที่คืนที่นี่"
                )}
              </p>
              <button type="button" className={`${button} mt-4`} onClick={openBookingPicker}>
                {t("Select Booking Diary Jobs", "เลือกงานจากสมุดจอง")}
              </button>
            </section>
          ) : (
            <div className="space-y-4">
              <section className={panel}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h2 className="text-lg font-bold text-violet-950">
                      A. {t("Original Booking vs Returned Green Sheet", "สมุดจองต้นฉบับเทียบใบสีเขียวที่คืน")}
                    </h2>
                    <p className="mt-1 text-xs text-slate-500">
                      {t(
                        "Office records the original booking in Booking Diary. Admin compares it with the returned signed green job order; mismatches stay on hold for management.",
                        "สำนักงานบันทึกงานต้นฉบับในสมุดจอง ผู้ดูแลเปรียบเทียบกับใบสั่งงานสีเขียวที่ลงนามและส่งคืน หากไม่ตรงให้ผู้บริหารพิจารณา"
                      )}
                    </p>
                  </div>
                  <button type="button" className={buttonSecondary} onClick={openBookingPicker}>
                    {t("Select Booking Diary Jobs", "เลือกงานจากสมุดจอง")}
                  </button>
                </div>
                <FinanceAdminReceiptSummary job={selected} t={t} />
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[720px] text-left text-sm">
                    <thead className={tableHead}>
                      <tr>
                        <th className="px-3 py-2">{t("Field", "ฟิลด์")}</th>
                        <th className="px-3 py-2">{t("Booking Diary", "สมุดจอง")}</th>
                        <th className="px-3 py-2">{t("Returned green job order", "ใบสั่งงานสีเขียวที่คืน")}</th>
                        <th className="px-3 py-2">{t("Compare", "เทียบ")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td className={`${tableCell} font-semibold`}>{c.customer}</td>
                        <td className={`${tableCell} font-semibold`} colSpan={3}>
                          {selected.client}
                          {selected.pickupTime ? (
                            <span className="ml-2 text-xs font-normal text-slate-500">
                              {t("Pickup time", "เวลารับ")}: {selected.pickupTime}
                            </span>
                          ) : null}
                        </td>
                      </tr>
                      {returnedFieldsFor(selected).filter((field): field is Exclude<ReturnedField, "workOrder"> => field !== "workOrder").map((field) => {
                        const diaryValue = selected[field] || t("Missing on booking", "ขาดในสมุดจอง");
                        const compare = fieldCompareStatus(selected, field);
                        return (
                          <tr
                            key={field}
                            className={
                              compare === "mismatch"
                                ? "bg-amber-50/80"
                                : compare === "missing"
                                  ? "bg-slate-50"
                                  : undefined
                            }
                          >
                            <td className={`${tableCell} font-semibold`}>{returnedFieldLabel(field)}</td>
                            <td className={tableCell}>{diaryValue}</td>
                            <td className={tableCell}>
                              <input
                                className={input}
                                value={returnedDraft[field]}
                                disabled={!canActAs("admin") || selected.status === "discrepancy"}
                                onChange={(e) =>
                                  setReturnedDraft((current) => ({ ...current, [field]: e.target.value }))
                                }
                                aria-label={`${returnedFieldLabel(field)} · ${t("Returned paper", "เอกสารที่คืน")}`}
                                placeholder={t("Enter from green paper", "กรอกจากใบสีเขียว")}
                              />
                              <button type="button" className="mt-1 text-xs font-semibold text-violet-900 underline"
                                disabled={!canActAs("admin") || selected.status === "discrepancy" || !selected[field]}
                                onClick={() => setReturnedDraft((current) => ({ ...current, [field]: selected[field] }))}>
                                {t("Confirm matches booking", "ยืนยันตรงกับสมุดจอง")}
                              </button>
                            </td>
                            <td className={`${tableCell} text-xs font-semibold`}>
                              {compare === "matched"
                                ? t("Matched", "ตรงกัน")
                                : compare === "mismatch"
                                  ? t("Mismatch — Management Review Required", "ไม่ตรง — ต้องให้ผู้บริหารพิจารณา")
                                  : t("Missing information", "ข้อมูลขาด")}
                            </td>
                          </tr>
                        );
                      })}
                      <tr
                        className={
                          fieldCompareStatus(selected, "workOrder") === "mismatch"
                            ? "bg-amber-50/80"
                            : fieldCompareStatus(selected, "workOrder") === "missing"
                              ? "bg-slate-50"
                              : undefined
                        }
                      >
                        <td className={`${tableCell} font-semibold`}>{c.fields.workOrder}</td>
                        <td className={tableCell}>
                          {selected.workOrder && !selected.workOrderConfirmed
                            ? `${selected.workOrder} (${t("Provisional on diary — verify", "ชั่วคราวในสมุดจอง — ต้องยืนยัน")})`
                            : selected.workOrderConfirmed
                              ? selected.workOrder
                              : t("Blank until green sheet returns", "ว่างจนกว่าใบสีเขียวจะคืน")}
                        </td>
                        <td className={tableCell}>
                          <input
                            aria-label={t("Returned work order number", "เลขใบสั่งงานที่คืน")}
                            className={input}
                            placeholder={th ? "เช่น 3628 หรือ 3628.1" : "e.g. 3628 or 3628.1"}
                            value={workOrder}
                            disabled={!canActAs("admin")}
                            onChange={(e) => setWorkOrder(e.target.value)}
                          />
                        </td>
                        <td className={`${tableCell} text-xs font-semibold`}>
                          {fieldCompareStatus(selected, "workOrder") === "matched"
                            ? t("Matched", "ตรงกัน")
                            : fieldCompareStatus(selected, "workOrder") === "mismatch"
                              ? t("Mismatch — Management Review Required", "ไม่ตรง — ต้องให้ผู้บริหารพิจารณา")
                              : t("Missing information", "ข้อมูลขาด")}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={button}
                    disabled={!canActAs("admin") || selected.status === "discrepancy"}
                    onClick={() =>
                      dispatch({
                        type: "set_returned_details",
                        jobId: selected.id,
                        fields: returnedDraft
                      })
                    }
                  >
                    {t("Save returned details", "บันทึกรายละเอียดที่คืน")}
                  </button>
                  <button
                    type="button"
                    className={button}
                    disabled={!canActAs("admin") || workOrder.trim().length < 3}
                    onClick={() => dispatch({ type: "set_returned_work_order", jobId: selected.id, workOrder })}
                  >
                    {t("Save work order number", "บันทึกเลขใบสั่งงาน")}
                  </button>
                  {selected.workOrderConfirmed ? (
                    <p className="self-center text-sm font-semibold text-emerald-800">
                      {c.workOrderConfirmed}: {confirmedWorkOrder(selected)}
                    </p>
                  ) : null}
                </div>
              </section>

              <section className={panel}>
                <h2 className="text-lg font-bold text-violet-950">
                  B. {t("Supporting Documents & Operational Expenses", "เอกสารประกอบและค่าใช้จ่ายปฏิบัติการ")}
                </h2>
                <div className="mt-4 grid gap-6 lg:grid-cols-2">
                  <div>
                    <h3 className="text-sm font-bold text-violet-900">{t("Paperwork matching", "จับคู่เอกสาร")}</h3>
                    <p className="mt-1 text-xs text-slate-500">
                      {t(
                        "Only confirmed matches with a filing reference count. Simulated placeholders are not treated as uploaded files.",
                        "นับเฉพาะการจับคู่ที่ยืนยันพร้อมเลขอ้างอิงจัดเก็บ ไม่ถือว่าช่องจำลองเป็นไฟล์อัปโหลดจริง"
                      )}
                    </p>
                    <div className="mt-3 space-y-2">
                      {documentRows.length === 0 ? (
                        <p className="rounded-lg border border-dashed border-slate-200 p-3 text-sm text-slate-500">
                          {t("No paperwork rows yet. Add a slot or upload a local test file after creating a document row.", "ยังไม่มีแถวเอกสาร เพิ่มช่องหรืออัปโหลดไฟล์ทดสอบหลังสร้างแถวเอกสาร")}
                        </p>
                      ) : (
                        documentRows.map((d) => (
                          <div key={d.id} className="rounded-lg border border-slate-200 p-3 text-sm">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div>
                                <strong>{c.kinds[d.kind]}</strong>
                                <p className="text-xs text-slate-500">
                                  {d.waivedBy
                                    ? `${t("Not applicable", "ไม่เกี่ยวข้อง")}: ${d.waiveReason || ""}`
                                    : d.attachmentStoredName
                                      ? t(`Uploaded file: ${d.attachmentFileName || d.attachmentStoredName}`, `ไฟล์อัปโหลด: ${d.attachmentFileName || d.attachmentStoredName}`)
                                      : t("No real file uploaded", "ยังไม่มีไฟล์จริง")}
                                  {!d.waivedBy ? (
                                    <>
                                      {" · "}
                                      {d.confirmedBy ? `${c.matched}: ${d.physicalRef}` : t("Pending match", "รอจับคู่")}
                                    </>
                                  ) : null}
                                </p>
                              </div>
                              {!d.confirmedBy ? (
                                <button
                                  className={button}
                                  disabled={!canActAs("admin") || physical.trim().length < 3}
                                  onClick={() =>
                                    dispatch({
                                      type: "confirm_document",
                                      documentId: d.id,
                                      jobId: selected.id,
                                      physicalRef: physical
                                    })
                                  }
                                >
                                  {c.confirm}
                                </button>
                              ) : null}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                    <label className="mt-3 block text-xs font-bold">
                      {c.physical}
                      <input
                        className={`${input} mt-1`}
                        value={physical}
                        onChange={(e) => setPhysical(e.target.value)}
                        placeholder={c.physicalExample}
                      />
                    </label>
                    <label className="mt-3 block text-xs font-bold">
                      {t("Local test attachment (PDF/JPEG/PNG)", "ไฟล์ทดสอบในเครื่อง (PDF/JPEG/PNG)")}
                      <input
                        className={`${input} mt-1`}
                        type="file"
                        accept="application/pdf,image/jpeg,image/png,image/webp"
                        disabled={!canActAs("admin") || uploading || documentRows.length === 0}
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          const doc = documentRows.find((d) => !d.attachmentStoredName) || documentRows[0];
                          event.target.value = "";
                          if (!file || !doc) return;
                          void (async () => {
                            setUploading(true);
                            setUploadError("");
                            try {
                              const token = await getAccessToken().catch(() => null);
                              const form = new FormData();
                              form.set("documentId", doc.id);
                              form.set("file", file);
                              const response = await fetch("/api/finance-local-store/attachments", {
                                method: "POST",
                                headers: token ? { Authorization: `Bearer ${token}` } : undefined,
                                body: form
                              });
                              const payload = (await response.json()) as {
                                storedName?: string;
                                fileName?: string;
                                error?: string;
                              };
                              if (!response.ok || !payload.storedName) throw new Error(payload.error || "UPLOAD_FAILED");
                              dispatch({
                                type: "set_document_attachment",
                                documentId: doc.id,
                                jobId: selected.id,
                                fileName: payload.fileName || file.name,
                                storedName: payload.storedName
                              });
                            } catch (caught) {
                              setUploadError(caught instanceof Error ? caught.message : "UPLOAD_FAILED");
                            } finally {
                              setUploading(false);
                            }
                          })();
                        }}
                      />
                    </label>
                    {uploadError ? <p className="mt-1 text-xs text-rose-700">{uploadError}</p> : null}
                    <div className="mt-3 flex flex-wrap gap-2">
                      {(["green_order", "parking", "toll"] as DocKind[]).map((kind) => (
                        <button
                          key={kind}
                          type="button"
                          className={buttonSecondary}
                          disabled={!canActAs("admin")}
                          onClick={() => dispatch({ type: "add_document", jobId: selected.id, kind })}
                        >
                          + {c.kinds[kind]}
                        </button>
                      ))}
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-[8rem_1fr_auto]">
                      <select
                        className={input}
                        value={waiveKind}
                        onChange={(e) => setWaiveKind(e.target.value as Exclude<DocKind, "green_order">)}
                        aria-label={t("Document not applicable", "เอกสารไม่เกี่ยวข้อง")}
                      >
                        <option value="parking">{c.kinds.parking}</option>
                        <option value="toll">{c.kinds.toll}</option>
                      </select>
                      <input
                        className={input}
                        value={waiveReason}
                        onChange={(e) => setWaiveReason(e.target.value)}
                        placeholder={t("N/A reason required", "ต้องระบุเหตุผลว่าไม่เกี่ยวข้อง")}
                      />
                      <button
                        type="button"
                        className={buttonSecondary}
                        disabled={!canActAs("admin") || waiveReason.trim().length < 3}
                        onClick={() => {
                          dispatch({
                            type: "waive_document",
                            jobId: selected.id,
                            kind: waiveKind,
                            reason: waiveReason
                          });
                          setWaiveReason("");
                        }}
                      >
                        {t("Mark N/A", "ทำเครื่องหมายไม่เกี่ยวข้อง")}
                      </button>
                    </div>
                    <p className="mt-3 text-xs font-semibold text-slate-700">
                      {missing.length
                        ? `${t("Missing", "ขาด")}: ${missing.map((kind) => c.kinds[kind]).join(", ")}`
                        : c.ready}
                    </p>
                    {documentRows
                      .filter((d) => d.waivedBy)
                      .map((d) => (
                        <p key={`${d.id}-waive`} className="mt-1 text-xs text-slate-600">
                          {c.kinds[d.kind]} · {t("Not applicable", "ไม่เกี่ยวข้อง")}: {d.waiveReason}
                        </p>
                      ))}
                  </div>

                  <div>
                    <h3 className="text-sm font-bold text-violet-900">{t("Operational expenses", "ค่าใช้จ่ายปฏิบัติการ")}</h3>
                    <p className="mt-1 text-xs text-slate-500">
                      {t(
                        "Internal costs only — never added automatically to the customer selling price.",
                        "ต้นทุนภายในเท่านั้น — ไม่ถูกบวกเข้ากับราคาขายลูกค้าโดยอัตโนมัติ"
                      )}
                    </p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-3">
                      <select
                        aria-label={t("Expense category", "ประเภทค่าใช้จ่าย")}
                        className={input}
                        value={expenseKind}
                        onChange={(e) => setExpenseKind(e.target.value as ExpenseKind)}
                      >
                        {(Object.keys(c.expenses) as ExpenseKind[]).map((k) => (
                          <option key={k} value={k}>
                            {c.expenses[k]}
                          </option>
                        ))}
                      </select>
                      <input
                        aria-label={c.amount}
                        type="number"
                        min="0.01"
                        step="0.01"
                        className={input}
                        value={expenseAmount}
                        onChange={(e) => setExpenseAmount(e.target.value)}
                        placeholder={c.amount}
                      />
                      <input
                        aria-label={c.reference}
                        className={input}
                        value={expenseReference}
                        onChange={(e) => setExpenseReference(e.target.value)}
                        placeholder={c.reference}
                      />
                    </div>
                    <button
                      type="button"
                      className={`${button} mt-2`}
                      disabled={
                        !(["admin", "finance"] as string[]).includes(role) ||
                        !expenseAmount ||
                        !expenseReference.trim() ||
                        !selected.workOrderConfirmed
                      }
                      onClick={() => {
                        dispatch({
                          type: "add_expense",
                          jobId: selected.id,
                          kind: expenseKind,
                          amount: Number(expenseAmount),
                          reference: expenseReference
                        });
                        setExpenseAmount("");
                        setExpenseReference("");
                      }}
                    >
                      {c.addExpense}
                    </button>
                    <ul className="mt-3 space-y-1 text-sm">
                      {selected.expenses.length === 0 ? (
                        <li className="text-slate-500">{t("No expenses recorded.", "ยังไม่มีค่าใช้จ่าย")}</li>
                      ) : (
                        selected.expenses.map((e) => (
                          <li key={e.id}>
                            {c.expenses[e.kind]} · {money(e.amount)} · {e.reference}
                          </li>
                        ))
                      )}
                    </ul>
                    <p className="mt-2 font-bold">
                      {c.total}: {money(expenseTotal(selected))}
                    </p>
                  </div>
                </div>
              </section>

              <section className={panel}>
                <h2 className="text-lg font-bold text-violet-950">
                  C. {t("Verification / Management Decision", "การตรวจยืนยัน / คำตัดสินผู้บริหาร")}
                </h2>
                <p className="mt-2 text-sm">
                  {c.status}: <strong>{c.statuses[selected.status]}</strong>
                </p>
                {missingReturned.length > 0 ? (
                  <p className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">
                    {t("Missing information", "ข้อมูลขาด")}:{" "}
                    {missingReturned.map((f) => c.fields[f]).join(", ")}
                  </p>
                ) : null}
                {mismatches(selected).length > 0 ? (
                  <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                    {t("Mismatch — Management Review Required", "ไม่ตรง — ต้องให้ผู้บริหารพิจารณา")}:{" "}
                    {mismatches(selected).map((f) => c.fields[f]).join(", ")}
                  </p>
                ) : null}
                {selected.decision ? (
                  <p className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                    {c.decision}: {selected.decision}
                  </p>
                ) : null}
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    className={button}
                    disabled={!canCompare && selected.status !== "needs_recheck"}
                    title={
                      !selected.workOrderConfirmed
                        ? t("Enter and save the green-sheet work order first.", "กรอกและบันทึกเลขใบสีเขียวก่อน")
                        : missingReturned.length
                          ? t("Save returned green-sheet details first.", "บันทึกรายละเอียดจากใบสีเขียวก่อน")
                          : missing.length
                            ? t("Match or mark N/A for required paperwork first.", "จับคู่หรือทำเครื่องหมายไม่เกี่ยวข้องสำหรับเอกสารที่จำเป็นก่อน")
                            : undefined
                    }
                    onClick={() => dispatch({ type: "verify_job", jobId: selected.id })}
                  >
                    {selected.status === "needs_recheck" ? t("Reverify job", "ตรวจงานซ้ำ") : c.compare}
                  </button>
                  {!canCompare && selected.status !== "needs_recheck" && selected.status !== "verified" ? (
                    <p className="text-xs text-slate-500">
                      {t(
                        "Compare & Verify enables after returned details, work order save, and required paperwork (or N/A).",
                        "ปุ่มเทียบและตรวจเปิดใช้หลังบันทึกรายละเอียดที่คืน เลขใบสั่งงาน และเอกสารที่จำเป็น (หรือทำเครื่องหมายไม่เกี่ยวข้อง)"
                      )}
                    </p>
                  ) : null}
                </div>
                {selected.status === "discrepancy" ? (
                  <div className="mt-4 max-w-xl">
                    <textarea
                      aria-label={c.decision}
                      className={input}
                      value={decision}
                      onChange={(e) => setDecision(e.target.value)}
                      placeholder={c.decisionExample}
                    />
                    <button
                      className={`${button} mt-2`}
                      disabled={!canActAs("management") || decision.trim().length < 10}
                      onClick={() => {
                        dispatch({ type: "resolve_discrepancy", jobId: selected.id, reason: decision });
                        setDecision("");
                      }}
                    >
                      {c.resolve}
                    </button>
                  </div>
                ) : null}
              </section>
            </div>
          )
        ) : null}

        {section === "billing" ? (
          !selected && state.bookings.length === 0 ? (
            <section className={panel}>
              <h2 className="text-lg font-bold text-violet-950">{t("Customer Billing", "วางบิลลูกค้า")}</h2>
              <p className="mt-2 text-sm text-slate-600">
                {t(
                  "Verified work orders appear here after Job Reconciliation. Select Booking Diary jobs to begin.",
                  "ใบสั่งงานที่ตรวจแล้วจะปรากฏที่นี่หลังกระทบยอดงาน เลือกงานจากสมุดจองเพื่อเริ่ม"
                )}
              </p>
              <button type="button" className={`${button} mt-4`} onClick={openBookingPicker}>
                {t("Select Booking Diary Jobs", "เลือกงานจากสมุดจอง")}
              </button>
            </section>
          ) : (
            <div className="space-y-4">
              {selected ? (
                <section className={panel}>
                  <h2 className="text-lg font-bold text-violet-950">
                    {t("Customer selling price", "ราคาขายลูกค้า")}
                  </h2>
                  <div className="mt-3 grid gap-4 lg:grid-cols-2">
                    <div className="rounded-lg border border-violet-100 bg-violet-50/40 p-3 text-sm">
                      <p className="font-semibold text-violet-950">
                        {confirmedWorkOrder(selected)
                          ? `WO ${confirmedWorkOrder(selected)} · ${selected.client} · ${selected.date}`
                          : `${selected.client} · ${selected.date}`}
                      </p>
                      <p className="mt-2">
                        {t("Customer selling price", "ราคาขายลูกค้า")}:{" "}
                        <strong className="text-xl tabular-nums">{selected.price?.confirmed ? money(selected.price.amount) : t("Pending", "รอดำเนินการ")}</strong>
                      </p>
                      <p className="mt-1 text-slate-600">
                        {t("Internal expenses", "ค่าใช้จ่ายภายใน")}: {money(expenseTotal(selected))}
                      </p>
                      <p className="mt-2 text-xs text-slate-500">{c.noAutoAdd}</p>
                    </div>
                    <div className="space-y-2">
                      <div className="grid gap-2 sm:grid-cols-[8rem_1fr_auto]">
                        <input
                          aria-label={c.manualPrice}
                          type="number"
                          min="0.01"
                          step="0.01"
                          className={input}
                          value={priceAmount}
                          onChange={(e) => setPriceAmount(e.target.value)}
                          placeholder={c.amount}
                        />
                        <input
                          aria-label={c.override}
                          className={input}
                          value={priceReason}
                          onChange={(e) => setPriceReason(e.target.value)}
                          placeholder={c.overrideExample}
                        />
                        <button
                          className={button}
                          disabled={!canActAs("finance") || !ready(state, selected.id)}
                          onClick={() =>
                            dispatch({
                              type: "set_price",
                              jobId: selected.id,
                              source: "manual",
                              amount: Number(priceAmount),
                              reason: priceReason
                            })
                          }
                        >
                          {c.setManual}
                        </button>
                        {isOwner ? <button className={buttonSecondary}
                          disabled={paperSaving || !canActAs("finance") || !ready(state, selected.id) || !state.paperStacks?.some((item) => item.jobIds.includes(selected.id))}
                          onClick={async () => {
                            const stack = state.paperStacks?.find((item) => item.jobIds.includes(selected.id));
                            if (!stack) return;
                            setPaperSaving(true); setPaperSaveMessage("");
                            try {
                              const enteredPrice = priceAmount.trim();
                              if (!enteredPrice && !selected.price?.confirmed) throw new Error("PRICE_REQUIRED");
                              const changePrice = enteredPrice && (!selected.price?.confirmed || Number(enteredPrice) !== selected.price.amount);
                              await saveCurrentWorkspace(changePrice ? { type: "set_price", jobId: selected.id, source: "manual", amount: Number(enteredPrice), reason: priceReason } : undefined);
                              const nextId = stack.jobIds[stack.jobIds.indexOf(selected.id) + 1];
                              if (nextId) chooseJob(nextId, "billing");
                              setPaperSaveMessage(nextId ? t("Saved. Next paper opened.", "บันทึกแล้ว เปิดใบงานถัดไปแล้ว") : t("Saved. Last paper in this stack.", "บันทึกแล้ว เป็นใบงานสุดท้ายของชุดนี้"));
                            } catch { setPaperSaveMessage(t("Save not confirmed. Check the price, reason, connection and receipt status. This paper stays open.", "ยังยืนยันการบันทึกไม่ได้ โปรดตรวจราคา เหตุผล การเชื่อมต่อ และการรับเอกสาร ใบงานนี้ยังเปิดอยู่")); }
                            finally { setPaperSaving(false); }
                          }}>
                          {t("Save & Next Paper", "บันทึกและไปใบงานถัดไป")}
                        </button> : null}
                        {paperSaveMessage ? <p role="status" className="text-sm text-violet-950">{paperSaveMessage}</p> : null}
                      </div>
                    </div>
                  </div>
                </section>
              ) : null}

              {selected?.source ? (
                <section className={panel}>
                  <h2 className="text-lg font-bold text-violet-950">
                    {t("Recorded total collected · source workbook", "ยอดเก็บรวมที่บันทึก · สมุดงานต้นทาง")}
                  </h2>
                  <p className="mt-2 text-3xl font-bold tabular-nums text-violet-950">
                    {money(selected.collection?.amount ?? selected.source.totalCollected)}
                  </p>
                  <p className="mt-2 text-sm text-slate-600">
                    {t(
                      "Historical workbook fact for this local demo only. Finance review does not prove receipt of payment and never sets the customer selling price.",
                      "ข้อเท็จจริงย้อนหลังจากสมุดงานสำหรับตัวอย่างในเครื่องเท่านั้น การตรวจของฝ่ายการเงินไม่ใช่หลักฐานว่าได้รับชำระ และไม่กำหนดราคาขายลูกค้า"
                    )}
                  </p>
                  <p className="mt-2 text-sm font-semibold">
                    {selected.collection?.confirmed
                      ? t("Workbook amount reviewed (demo only)", "ตรวจยอดจากสมุดงานแล้ว (ตัวอย่างเท่านั้น)")
                      : t("Workbook amount review pending", "รอตรวจยอดจากสมุดงาน")}
                  </p>
                  <button
                    className={`${button} mt-3`}
                    disabled={!canActAs("finance") || !ready(state, selected.id) || !!selected.collection?.confirmed}
                    onClick={() => dispatch({ type: "confirm_source_amount", jobId: selected.id })}
                  >
                    {t("Review recorded amount · local demo", "ตรวจยอดที่บันทึก · ตัวอย่างในเครื่อง")}
                  </button>
                </section>
              ) : null}

              <section className={panel}>
                <h2 className="text-lg font-bold text-violet-950">
                  {t("Weekly billing batch", "ชุดวางบิลรายสัปดาห์")}
                </h2>
                <div className="mt-3 flex flex-wrap gap-2">
                  <select
                    aria-label={c.customer}
                    className={`${input} w-auto min-w-[12rem]`}
                    value={customerId}
                    onChange={(e) => {
                      setCustomer(e.target.value);
                      setWeek("");
                    }}
                  >
                    {customers.length === 0 ? <option value="">{t("No customers yet", "ยังไม่มีลูกค้า")}</option> : null}
                    {customers.map(([id, name]) => (
                      <option key={id} value={id}>
                        {name}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label={c.week}
                    className={`${input} w-auto min-w-[9rem]`}
                    value={activeWeek}
                    onChange={(e) => setWeek(e.target.value)}
                  >
                    {availableWeeks.length === 0 ? <option value="">{t("No week", "ไม่มีสัปดาห์")}</option> : null}
                    {availableWeeks.map((w) => (
                      <option key={w} value={w}>
                        {w}
                      </option>
                    ))}
                  </select>
                  <button
                    className={button}
                    disabled={!canActAs("finance") || !customerId || !activeWeek}
                    onClick={() => dispatch({ type: "create_batch", clientId: customerId, week: activeWeek })}
                  >
                    {c.createBatch}
                  </button>
                  <select
                    aria-label={c.selectBatch}
                    className={`${input} w-auto min-w-[14rem]`}
                    value={selectedBatch?.id ?? ""}
                    onChange={(e) => setBatchId(e.target.value)}
                  >
                    <option value="">{c.selectBatch}</option>
                    {state.batches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.id} · {state.bookings.find((j) => j.clientId === b.clientId)?.client} · {b.week}
                      </option>
                    ))}
                  </select>
                </div>

                {selectedBatch ? (
                  <>
                    <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
                      <p className="font-bold text-violet-900">
                        {selectedBatch.id} · {selectedBatch.draft ? c.draftNumber : c.pending}
                      </p>
                      <p className="rounded-lg bg-violet-100 px-3 py-1 font-bold text-violet-950">
                        {c.batchTotal}: {money(batchTotal(state, selectedBatch))}
                      </p>
                      <p className="text-slate-600">
                        {selectedBatch.jobIds.length} {c.workOrder}
                      </p>
                    </div>
                    <div className="mt-4 overflow-x-auto rounded-xl border border-violet-100">
                      <table className="w-full min-w-[960px] text-left">
                        <thead className={tableHead}>
                          <tr>
                            <th className="px-3 py-2">#</th>
                            <th className="px-3 py-2">{c.workOrder}</th>
                            <th className="px-3 py-2">{c.customer}</th>
                            <th className="px-3 py-2">{c.date}</th>
                            <th className="px-3 py-2">{c.customerCharge}</th>
                            <th className="px-3 py-2">{c.expenseLedger}</th>
                            <th className="px-3 py-2">{t("Eligibility / action", "ความพร้อม / การกระทำ")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {batchJobs.map((j) => {
                            const reasons = blockers(state, selectedBatch, j.id);
                            const inBatch = selectedBatch.jobIds.includes(j.id);
                            const order = inBatch ? selectedBatch.jobIds.indexOf(j.id) + 1 : null;
                            return (
                              <tr key={j.id} className={j.id === selected?.id ? "bg-violet-50/80" : "hover:bg-slate-50"}>
                                <td className={tableCell}>{order ?? "—"}</td>
                                <td className={`${tableCell} font-semibold`}>
                                  <button type="button" className="underline decoration-violet-300" onClick={() => chooseJob(j.id)}>
                                    {confirmedWorkOrder(j) || t("Pending", "รอดำเนินการ")}
                                  </button>
                                </td>
                                <td className={tableCell}>{j.client}</td>
                                <td className={tableCell}>{j.date}</td>
                                <td className={tableCell}>{j.price?.confirmed ? money(customerTotal(j)) : t("Pending", "รอดำเนินการ")}</td>
                                <td className={tableCell}>{money(expenseTotal(j))}</td>
                                <td className={tableCell}>
                                  <div className="flex flex-wrap gap-2">
                                    <button
                                      className={button}
                                      disabled={!canActAs("finance") || selectedBatch.draft || inBatch || reasons.length > 0}
                                      onClick={() => dispatch({ type: "allocate_job", batchId: selectedBatch.id, jobId: j.id })}
                                    >
                                      {inBatch ? c.currentBatch : c.allocate}
                                    </button>
                                    {inBatch
                                      ? ([-1, 1] as const).map((direction) => (
                                          <button
                                            key={direction}
                                            type="button"
                                            className="text-violet-800 underline disabled:opacity-30"
                                            disabled={
                                              !canActAs("finance") ||
                                              selectedBatch.draft ||
                                              (order ?? 0) - 1 + direction < 0 ||
                                              (order ?? 0) - 1 + direction >= selectedBatch.jobIds.length
                                            }
                                            onClick={() =>
                                              dispatch({
                                                type: "move_job",
                                                batchId: selectedBatch.id,
                                                jobId: j.id,
                                                direction
                                              })
                                            }
                                          >
                                            {direction < 0 ? c.moveUp : c.moveDown}
                                          </button>
                                        ))
                                      : null}
                                  </div>
                                  {!inBatch && reasons.length ? (
                                    <p className="mt-1 text-xs text-amber-800">
                                      {reasons.map((r) => c.batchIssues[r as keyof typeof c.batchIssues] ?? r).join(", ")}
                                    </p>
                                  ) : null}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        className={button}
                        disabled={!canActAs("finance") || selectedBatch.draft || issues.length > 0}
                        onClick={() => dispatch({ type: "create_draft", batchId: selectedBatch.id })}
                      >
                        {c.draftAction}
                      </button>
                      {issues.length > 0 ? (
                        <p className="self-center text-xs text-amber-800">
                          {c.batchValidation}:{" "}
                          {issues.map((i) => c.batchIssues[i as keyof typeof c.batchIssues] ?? i).join(", ")}
                        </p>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <p className="mt-3 text-sm text-slate-500">{c.noBatch}</p>
                )}
              </section>
            </div>
          )
        ) : null}

        {section === "documents" ? (
          <div className="grid gap-4 xl:grid-cols-[minmax(340px,0.9fr)_minmax(0,1.4fr)]">
            <section className={panel}>
              <h2 className="text-lg font-bold text-violet-950">
                {t("Finance manager review", "ผู้จัดการการเงินตรวจร่าง")}
              </h2>
              <select
                aria-label={c.selectBatch}
                className={`${input} mt-3`}
                value={selectedBatch?.id ?? ""}
                onChange={(e) => setBatchId(e.target.value)}
              >
                <option value="">{c.selectBatch}</option>
                {state.batches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.id} · {b.week}
                  </option>
                ))}
              </select>
              {selectedBatch ? (
                <>
                  <p className="mt-3 text-sm">
                    {selectedBatch.id} · {selectedBatch.jobIds.length} {c.workOrder} ·{" "}
                    {money(batchTotal(state, selectedBatch))}
                  </p>
                  <p className="mt-1 font-bold text-violet-900">
                    {selectedBatch.approvedBy
                      ? c.approved
                      : selectedBatch.draft
                        ? c.approvalRequired
                        : c.pending}
                  </p>
                  {selectedBatch.rejectedReason ? (
                    <p className="mt-2 rounded bg-rose-50 p-2 text-sm">
                      {c.reason}: {selectedBatch.rejectedReason}
                    </p>
                  ) : null}
                  <div className="mt-4 overflow-x-auto rounded-lg border">
                    <table className="w-full min-w-[360px] text-left text-sm">
                      <thead className={tableHead}>
                        <tr>
                          <th className="px-2 py-2">#</th>
                          <th className="px-2 py-2">{c.workOrder}</th>
                          <th className="px-2 py-2">{c.customerCharge}</th>
                          <th className="px-2 py-2">{t("Open", "เปิด")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedBatch.jobIds.map((id, i) => {
                          const j = state.bookings.find((item) => item.id === id)!;
                          return (
                            <tr key={id}>
                              <td className={tableCell}>{i + 1}</td>
                              <td className={`${tableCell} font-semibold`}>{j.workOrder}<span className="block text-sm font-normal">{t("Customer Job Number", "เลขที่งานลูกค้า")}: {customerJobReference(j) || "—"}</span></td>
                              <td className={tableCell}>{money(customerTotal(j))}</td>
                              <td className={tableCell}>
                                <button type="button" className="underline" onClick={() => chooseJob(id)}>
                                  {c.view}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      className={button}
                      disabled={!canActAs("approver") || !selectedBatch.draft || !!selectedBatch.approvedBy}
                      onClick={() => dispatch({ type: "approve_draft", batchId: selectedBatch.id })}
                    >
                      {c.approve}
                    </button>
                    <button
                      className="rounded-lg border border-rose-300 px-3 py-2 text-sm font-semibold text-rose-800 disabled:opacity-30"
                      disabled={
                        !canActAs("approver") ||
                        !selectedBatch.draft ||
                        !!selectedBatch.approvedBy ||
                        rejection.trim().length < 10
                      }
                      onClick={() =>
                        dispatch({ type: "reject_draft", batchId: selectedBatch.id, reason: rejection })
                      }
                    >
                      {t("Reject with reason", "ปฏิเสธพร้อมเหตุผล")}
                    </button>
                  </div>
                  <textarea
                    aria-label={t("Rejection reason", "เหตุผลที่ปฏิเสธ")}
                    className={`${input} mt-2`}
                    value={rejection}
                    onChange={(e) => setRejection(e.target.value)}
                    placeholder={c.decisionExample}
                  />
                  <p className="mt-3 text-xs font-semibold text-slate-600">{c.noIssuance}</p>
                </>
              ) : (
                <p className="mt-3 text-sm text-slate-500">
                  {state.batches.length === 0
                    ? t("No drafts in this workspace yet.", "ยังไม่มีร่างในพื้นที่นี้")
                    : c.noBatch}
                </p>
              )}
            </section>

            <section className={panel}>
              <h2 className="text-lg font-bold text-violet-950">
                {t("Ordered customer document pack", "ชุดเอกสารลูกค้าตามลำดับ")}
              </h2>
              {selectedBatch ? (
                <>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      className={button}
                      disabled={!canActAs("finance") || !selectedBatch.approvedBy || selectedBatch.packReady}
                      onClick={() => dispatch({ type: "prepare_pack", batchId: selectedBatch.id })}
                    >
                      {c.packAction}
                    </button>
                    {selectedBatch.packReady ? (
                      <button className={buttonSecondary} onClick={() => window.print()}>
                        {c.print}
                      </button>
                    ) : null}
                  </div>
                  <div className="mt-4 grid gap-4 lg:grid-cols-2">
                    <div>
                      <h3 className="font-semibold">{t("Pack order", "ลำดับชุดเอกสาร")}</h3>
                      <ol className="mt-2 max-h-[22rem] space-y-2 overflow-y-auto text-sm">
                        {packManifest(state, selectedBatch).map((item, i) => (
                          <li key={item.key} className="rounded border p-2">
                            {i + 1}. {item.label}
                          </li>
                        ))}
                      </ol>
                      <h3 className="mt-4 font-semibold">{c.originals}</h3>
                      {selectedBatch.jobIds.flatMap((id) => docsFor(state, id)).map((d) => (
                        <label className="mt-1 block text-sm" key={d.id}>
                          <input type="checkbox" className="mr-2" readOnly /> {c.kinds[d.kind]} · {d.physicalRef}
                        </label>
                      ))}
                      <h3 className="mt-4 font-semibold">{c.dispatch}</h3>
                      {c.dispatchItems.map((item, i) => (
                        <label className="mt-1 block text-sm" key={i}>
                          <input type="checkbox" className="mr-2" readOnly /> {item}
                        </label>
                      ))}
                    </div>
                    <div className="rounded-xl border border-violet-200 bg-violet-50/30 p-3">
                      <h3 className="font-semibold text-violet-950">
                        {t("Document / print preview", "ตัวอย่างเอกสาร / พิมพ์")}
                      </h3>
                      <p className="mt-1 text-xs text-slate-600">
                        {t("Draft / DEMONSTRATION watermark preserved. No final TRN issuance.", "คงลายน้ำร่าง / สาธิต ไม่มีการออกเลข TRN จริง")}
                      </p>
                      {selectedBatch.packReady ? (
                        <div className="mt-3 max-h-[40rem] overflow-auto rounded-lg border bg-white p-3 shadow-inner">
                          <FinanceDemoPrint state={state} batch={selectedBatch} language={language} preview />
                        </div>
                      ) : (
                        <p className="mt-6 text-sm text-slate-500">
                          {t(
                            "Prepare the sample pack after manager approval to show the print preview here.",
                            "จัดชุดเอกสารตัวอย่างหลังผู้จัดการอนุมัติ เพื่อแสดงตัวอย่างพิมพ์ที่นี่"
                          )}
                        </p>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <p className="mt-3 text-sm text-slate-500">{c.noBatch}</p>
              )}
            </section>
          </div>
        ) : null}

        {selectedBatch?.packReady && section !== "documents" ? (
          <FinanceDemoPrint state={state} batch={selectedBatch} language={language} />
        ) : null}

        {IS_DEV_BUILD && params.get("dev") === "1" ? (
          <details className="ees-fc-dev rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3 print:hidden" open={devToolsOpen}
            onToggle={(event) => setDevToolsOpen((event.target as HTMLDetailsElement).open)}>
            <summary className="cursor-pointer text-sm font-bold text-slate-600">{t("Developer tools", "เครื่องมือนักพัฒนา")}</summary>
            <p className="mt-2 text-xs text-slate-500">{t("Development build only. Never shown in production.", "เฉพาะเวอร์ชันพัฒนา ไม่แสดงในเวอร์ชันใช้งานจริง")}</p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                {t("Act as", "สวมบทบาท")}
                <select aria-label={t("Role", "บทบาท")} className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm" value={role} disabled={role === "super_admin"} onChange={(event) => setRole(event.target.value as Role)}>
                  {(Object.keys(roleLabels) as Role[]).filter((item) => {
                    if (item === "super_admin") return role === "super_admin";
                    if (item === "admin") return canUseFinanceAdminIntake(access, item, isFinanceFixtureMode());
                    return true;
                  }).map((item) => <option key={item} value={item}>{th ? roleLabels[item].th : roleLabels[item].en}</option>)}
                </select>
              </label>
              <span className="text-sm font-semibold text-slate-700">{t("Workspace", "พื้นที่ทำงาน")}:</span>
              <button type="button" className={`rounded-lg px-3 py-1 text-sm font-semibold ${isOwner ? "bg-violet-800 text-white" : "bg-white ring-1 ring-slate-300"}`} onClick={() => switchWorkspace("owner")}>
                {t("Owner walkthrough", "เวิร์กโฟลว์เจ้าของ")} ({workspaces.owner.bookings.length})
              </button>
              <button type="button" className={`rounded-lg px-3 py-1 text-sm font-semibold ${!isOwner ? "bg-violet-800 text-white" : "bg-white ring-1 ring-slate-300"}`} onClick={() => switchWorkspace("previous_demo")}>
                {t("Previous demonstration data", "ข้อมูลสาธิตก่อนหน้า")} ({workspaces.previous_demo.bookings.length})
              </button>
            </div>
            <div className="mt-3">
              <p className="text-sm font-bold text-slate-700">{t("Simulated audit history", "ประวัติการตรวจสอบจำลอง")}</p>
        {state.audit.length > 0 ? (
          <section className="rounded-xl bg-white p-3">
            <h2 className="font-bold text-violet-950">{c.audit}</h2>
            <div className="mt-2 max-h-36 overflow-auto text-xs text-slate-600">
              {state.audit
                .slice(-12)
                .reverse()
                .map((a) => (
                  <p key={a.step} className="border-b py-1">
                    #{a.step} · {a.actor} · {c.auditActions[a.action as keyof typeof c.auditActions] ?? a.action} ·{" "}
                    {a.subject}
                  </p>
                ))}
            </div>
          </section>
        ) : null}

        <div className="mt-3 border-t border-slate-200 pt-3">
          <p className="text-sm font-bold text-slate-700">{t("Local store", "ที่เก็บในเครื่อง")}</p>
          <p className="mt-2 text-xs text-slate-500">
            {t(
              "These controls can alter local Finance memory. They never write production finance tables or issue invoices.",
              "เครื่องมือเหล่านี้อาจเปลี่ยนหน่วยความจำการเงินในเครื่อง ไม่เขียนตารางการเงินจริงและไม่ออกใบแจ้งหนี้"
            )}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className={buttonSecondary}
              onClick={() => {
                if (
                  window.confirm(
                    t(
                      `Reset the active "${isOwner ? "Owner walkthrough" : "Previous demonstration"}" workspace memory?`,
                      `รีเซ็ตหน่วยความจำพื้นที่ "${isOwner ? "เวิร์กโฟลว์เจ้าของ" : "ข้อมูลสาธิตก่อนหน้า"}"?`
                    )
                  )
                ) {
                  resetActiveWorkspace();
                }
              }}
            >
              {t("Reset active workspace memory", "รีเซ็ตหน่วยความจำพื้นที่ที่ใช้งาน")}
            </button>
            <button
              type="button"
              className={buttonSecondary}
              onClick={() => {
                if (
                  window.confirm(
                    t(
                      "Load the completed demonstration scenario into Previous demonstration data only?",
                      "โหลดสถานการณ์สาธิตที่ครบแล้วเข้าข้อมูลสาธิตก่อนหน้าเท่านั้น?"
                    )
                  )
                ) {
                  loadCompletedIntoPreviousDemo();
                }
              }}
            >
              {t("Load completed walkthrough → previous data", "โหลดขั้นตอนครบ → ข้อมูลก่อนหน้า")}
            </button>
          </div>
          <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3">
            <p className="text-xs font-semibold text-rose-900">
              {t(
                "Clear entire local Finance store (both workspaces). Type CLEAR to enable.",
                "ล้างที่เก็บการเงินในเครื่องทั้งหมด (ทั้งสองพื้นที่) พิมพ์ CLEAR เพื่อเปิดใช้"
              )}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <input
                className={`${input} max-w-[10rem]`}
                value={confirmClear}
                onChange={(e) => setConfirmClear(e.target.value)}
                placeholder="CLEAR"
                aria-label={t("Type CLEAR to confirm", "พิมพ์ CLEAR เพื่อยืนยัน")}
              />
              <button
                type="button"
                className="rounded-lg bg-rose-800 px-3 py-2 text-sm font-semibold text-white disabled:bg-slate-300"
                disabled={confirmClear !== "CLEAR"}
                onClick={() => {
                  if (
                    window.confirm(
                      t(
                        "This erases owner walkthrough AND previous demonstration local Finance data. Continue?",
                        "การกระทำนี้ลบทั้งเวิร์กโฟลว์เจ้าของและข้อมูลสาธิตก่อนหน้า ดำเนินการต่อ?"
                      )
                    )
                  ) {
                    void clearPersistedStore().then(() => setConfirmClear(""));
                  }
                }}
              >
                {t("Clear local test store", "ล้างที่เก็บทดสอบ")}
              </button>
            </div>
          </div>
        </div>
            </div>
          </details>
        ) : null}
      </main>
      <FinanceBookingDiaryPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        linkedIds={linkedIds}
        linkedStatusById={linkedStatusById}
        linkedCustomerJobNumberById={linkedCustomerJobNumberById}
        linkedWorkOrderById={linkedWorkOrderById}
        statusLabel={(status) => c.statuses[status as keyof typeof c.statuses] || status}
        t={t}
        onConfirm={(seeds) => {
          // Existing links open without assigning another work-order number.
          for (const seed of seeds) ensureDiaryBooking(seed);
          const first = seeds[0];
          if (first) {
            setActiveWorkspace("owner");
            chooseJob(first.id, "reconciliation");
          }
        }}
        canAdd={canAddDiaryWorkOrder && hydrateReady && !accessLoading}
        accessLoading={accessLoading}
        onAddWorkOrder={async (seed, number, receipts, keepOpen) => {
          await addDiaryWorkOrder(seed, number, receipts);
          if (!keepOpen) chooseJob(seed.id, "reconciliation");
        }}
      />
      <style jsx global>{`
        @media print {
          body:not(.ees-finance-printing) .finance-centre-workspace,
          body:not(.ees-finance-printing) .top-navigation,
          body:not(.ees-finance-printing) .ees-v3 {
            display: none !important;
          }
          .finance-demo-print {
            display: block !important;
          }
          .finance-demo-print-break {
            break-before: page;
            page-break-before: always;
          }
        }
      `}</style>
    </>
  );
}
