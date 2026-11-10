"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatBangkokTime, formatThb } from "@/lib/finance-display";
import FinanceArrangeStage from "@/components/finance-arrange-stage";
import FinanceBillingSheetStage from "@/components/finance-billing-sheet-stage";
import FinanceTrnDocumentsStage from "@/components/finance-trn-documents-stage";
import { useFinanceFixture } from "@/components/finance-fixture-provider";
import { useAccountAccess } from "@/lib/use-account-access";
import { financeActionActor } from "@/lib/finance-intake-access";
import { isFinanceFixtureMode } from "@/lib/finance-fixture-mode";
import {
  applyAction,
  confirmedWorkOrder,
  openSheetFor,
  peekNextSimulatedTrn,
  satangToThb,
  sheetSummary,
  sheetCustomers,
  sheetTrnLabel,
  simulatedTrnAllowed,
  type State,
  type Action,
  type BillingSheet,
  type BillingSheetStage
} from "@/lib/finance-demo-centre";

export type FlowT = (en: string, th: string) => string;
/** Runs an action after a pure pre-check so the screen can explain exactly why it was blocked. */
export type FlowRun = (action: Action) => { ok: true } | { ok: false; code: string; detail: string };

export function sheetErrorText(code: string, detail: string, t: FlowT) {
  switch (code) {
    case "FINANCE_DUPLICATE_BILLING": return t("This work order is already assigned to an invoice. Open its existing group before continuing.", "ใบงานนี้อยู่ในใบแจ้งหนี้แล้ว ให้เปิดกลุ่มเดิมก่อนดำเนินการต่อ");
    case "FINANCE_APPROVED_FIGURES_LOCKED": return t("Approved figures are locked. Reopen for correction before editing.", "ยอดที่อนุมัติถูกล็อกแล้ว ต้องเปิดแก้ไขตามขั้นตอนก่อน");
    case "FINANCE_WO_NOT_FOUND": return t("No linked Finance record has this work order number. Admin must link the green paper in Admin Intake first.", "ไม่พบเลขที่ใบงานนี้ในระบบการเงิน ให้แอดมินเชื่อมใบงานสีเขียวในหน้ารับเอกสารก่อน");
    case "FINANCE_WO_OTHER_CUSTOMER": return t(`This work order belongs to another customer (${detail}). It was not added.`, `ใบงานนี้เป็นของลูกค้ารายอื่น (${detail}) จึงไม่ได้เพิ่ม`);
    case "FINANCE_WO_ALREADY_IN_LIST": return t(`Already in this list at paper position ${detail}.`, `มีอยู่ในรายการแล้ว ลำดับที่ ${detail}`);
    case "FINANCE_WO_IN_OTHER_SHEET": return t(`Already in billing sheet ${detail}. A work order can be billed only once.`, `อยู่ในชุดวางบิล ${detail} แล้ว ใบงานหนึ่งวางบิลได้ครั้งเดียว`);
    case "FINANCE_WO_REQUIRED": return t("Type a work order number first.", "กรุณาพิมพ์เลขที่ใบงาน");
    case "FINANCE_SHEET_LOCKED": return t("This sheet is locked for review or already approved. Reopen it to make corrections.", "ชุดนี้ถูกล็อกเพื่อตรวจสอบหรืออนุมัติแล้ว ต้องเปิดแก้ไขก่อน");
    case "FINANCE_REJECT_REASON_REQUIRED": return t("Write why it is being returned (at least 10 characters).", "ระบุเหตุผลที่ส่งกลับ (อย่างน้อย 10 ตัวอักษร)");
    case "FINANCE_REOPEN_AFTER_APPROVAL": return t("After management approval, write a clearer reason (at least 10 characters) to reopen for re-review.", "หลังผู้บริหารอนุมัติแล้ว ต้องระบุเหตุผลชัดเจน (อย่างน้อย 10 ตัวอักษร) เพื่อเปิดแก้ไขและตรวจใหม่");
    case "FINANCE_APPROVAL_NOTE": return t("Approval notes are limited to 200 characters.", "หมายเหตุการอนุมัติยาวได้ไม่เกิน 200 ตัวอักษร");
    case "FINANCE_WO_ALREADY_IN_GROUP": return t("That work order is already on another invoice group.", "ใบงานนี้อยู่ในกลุ่มใบแจ้งหนี้อื่นแล้ว");
    case "FINANCE_GROUP_LABEL": return t("Group names are up to 40 characters.", "ชื่อกลุ่มยาวได้ไม่เกิน 40 ตัวอักษร");
    case "FINANCE_SHEET_ALREADY_OPEN": return t("This customer already has an open billing list.", "ลูกค้ารายนี้มีรายการวางบิลที่เปิดอยู่แล้ว");
    case "FINANCE_AMOUNT_INVALID": return t("Enter a positive THB amount with up to 2 decimals (e.g. 2500 or 2500.50).", "กรอกจำนวนเงินบาทที่มากกว่า 0 ทศนิยมไม่เกิน 2 ตำแหน่ง");
    case "FINANCE_RATE_SUGGESTION_STALE": return t("The rate suggestion changed. Please check it again.", "ราคาที่แนะนำเปลี่ยนแปลง โปรดตรวจอีกครั้ง");
    case "FINANCE_OVERRIDE_REASON_REQUIRED": return t("A reason (at least 10 characters) is required when the price differs from the approved suggestion.", "ต้องระบุเหตุผล (อย่างน้อย 10 ตัวอักษร) เมื่อราคาต่างจากราคาที่แนะนำ");
    case "FINANCE_PRICE_OVERWRITE_CONFIRM": return t("This line already has a price. Tick \"Replace the price already entered\" to confirm.", "รายการนี้มีราคาอยู่แล้ว ติ๊ก \"แทนที่ราคาที่กรอกไว้แล้ว\" เพื่อยืนยัน");
    case "FINANCE_ROUTE_CONFIRM_REQUIRED": return t("Confirm that you checked the route and vehicle first.", "โปรดยืนยันว่าตรวจเส้นทางและรถแล้ว");
    case "FINANCE_RATE_UNAVAILABLE": return t("No approved rate applies to this job (check the mapping, dates and fuel price).", "ไม่มีราคาที่อนุมัติสำหรับงานนี้ (ตรวจการผูกสัญญา วันที่ และราคาน้ำมัน)");
    case "FINANCE_FUEL_EVIDENCE_GATE": return t("Enter a valid Diesel B7 price for a past or current date and a dated evidence note.", "กรอกราคาดีเซล B7 ที่ถูกต้องสำหรับวันที่ผ่านมา และหลักฐานที่ระบุวันที่");
    case "FINANCE_FUEL_DUPLICATE": return t("That Diesel B7 value is already recorded for this date.", "บันทึกราคาดีเซล B7 ค่านี้ของวันนี้ไว้แล้ว");
    case "FINANCE_FUEL_REVISION_REASON_REQUIRED": return t("A different value is already recorded for this date. Write why it changes (at least 10 characters).", "มีค่าอื่นของวันนี้อยู่แล้ว โปรดระบุเหตุผลที่เปลี่ยน (อย่างน้อย 10 ตัวอักษร)");
    case "FINANCE_RATE_MAPPING_GATE": return t("The mapping was not accepted: check the role, dates, contract reference, an existing overlapping mapping, or the required review reason.", "ไม่รับการผูกสัญญา: ตรวจสิทธิ์ วันที่ อ้างอิงสัญญา การซ้อนทับ หรือเหตุผลทบทวน");
    case "FINANCE_CHECK_REASON_REQUIRED": return t("Write a short reason for the office.", "ระบุเหตุผลสั้น ๆ ให้สำนักงาน");
    case "FINANCE_SHEET_NOT_READY": return t("Not ready yet — see the checklist.", "ยังไม่พร้อม — ดูรายการตรวจสอบ");
    case "FINANCE_SHEET_EMPTY": return t("Add at least one work order first.", "เพิ่มใบงานอย่างน้อยหนึ่งรายการก่อน");
    case "DEMO_ROLE_REQUIRED": return t("Your account cannot do this step. Sign in as Admin or select Finance.", "บัญชีนี้ทำขั้นตอนนี้ไม่ได้ ให้เข้าสู่ระบบเป็นแอดมินหรือเลือกบทบาทการเงิน");
    default: return t("This action was blocked.", "ดำเนินการไม่ได้");
  }
}

/**
 * The batch reference, shown the same way on every Finance stage. A simulated TRN (TRN###/2026, local test only) is
 * always flagged DRAFT/TEST; batches created before the numbering existed keep their original draft reference.
 */
export function SheetTrnReference({ sheet, t, large = false }: { sheet: BillingSheet; t: FlowT; large?: boolean }) {
  const simulated = !!sheet.simulatedTrn;
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2 gap-y-0.5" data-testid="sheet-trn">
      <span className="text-sm font-semibold text-slate-600">{simulated ? t("TRN (simulated)", "TRN (จำลอง)") : t("Draft TRN", "ร่าง TRN")}</span>
      <span className={`${large ? "text-2xl" : "text-lg"} font-black tabular-nums text-violet-900`}>{sheetTrnLabel(sheet)}</span>
      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-900"
        title={simulated ? t("Simulated number for local testing only — not an issued or official TRN.", "เลขจำลองสำหรับทดสอบในเครื่องเท่านั้น — ไม่ใช่ TRN ที่ออกจริง") : undefined}>
        {t("DRAFT/TEST · not issued", "ร่าง/ทดสอบ · ยังไม่ออกจริง")}
      </span>
    </span>
  );
}

/** The sheet shown for a customer: the explicitly chosen one, else the open one, else the latest. */
export function resolveSheet(state: State, clientId: string, sheetId: string): BillingSheet | undefined {
  const sheets = (state.billingSheets || []).filter((item) => item.clientId === clientId);
  return sheets.find((item) => item.id === sheetId) ?? openSheetFor(state, clientId) ?? sheets[sheets.length - 1];
}

export default function FinanceBillingFlow({ stage, onStage, clientId, onClient, sheetId, onSheet, language, t, openAdminIntake, openRateTools }: {
  stage: BillingSheetStage;
  onStage: (stage: BillingSheetStage) => void;
  clientId: string;
  onClient: (clientId: string) => void;
  sheetId: string;
  onSheet: (sheetId: string) => void;
  language: "en" | "th";
  t: FlowT;
  openAdminIntake: (jobId?: string) => void;
  openRateTools: (jobId: string) => void;
}) {
  const { state, workspaces, activeWorkspace, role, dispatch, saveCurrentWorkspace, persistStatus, lastSavedAt, hydrateReady } = useFinanceFixture();
  const { access } = useAccountAccess();
  const customers = useMemo(() => sheetCustomers(state), [state]);
  const [note, setNote] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [editingName, setEditingName] = useState("");
  const [nameDraft, setNameDraft] = useState<Record<string, string>>({});
  const customerSheets = (state.billingSheets || []).filter((item) => item.clientId === clientId);
  const sheet = clientId ? resolveSheet(state, clientId, sheetId) : undefined;

  // Pin the resolved sheet id so Submit for review / Approve does not jump to another open draft
  // (resolveSheet falls back to the first unlocked sheet when sheetId is empty).
  useEffect(() => {
    if (sheet && sheet.id !== sheetId) onSheet(sheet.id);
  }, [sheet?.id, sheetId, onSheet]);

  const run: FlowRun = (action) => {
    const actor = financeActionActor(access, role, isFinanceFixtureMode(), action.type);
    try {
      applyAction(state, action, actor);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "BLOCKED";
      const [code, ...rest] = message.split(":");
      return { ok: false, code, detail: rest.join(":") };
    }
    return dispatch(action) ? { ok: true } : { ok: false, code: "BLOCKED", detail: "" };
  };

  // Always save the latest rendered workspace: a pending edit (e.g. committed on blur) must never be overwritten
  // by a stale closure, so wait for React to flush and then use the newest save function.
  const saveRef = useRef(saveCurrentWorkspace);
  useEffect(() => { saveRef.current = saveCurrentWorkspace; }, [saveCurrentWorkspace]);
  const save = async () => {
    setNote("");
    try {
      await new Promise((resolve) => window.setTimeout(resolve, 60));
      await saveRef.current();
    } catch {
      setNote(t("Not saved — keep this page open and press Save again.", "ยังไม่ได้บันทึก — เปิดหน้านี้ไว้แล้วกดบันทึกอีกครั้ง"));
    }
  };

  const goStage = (next: BillingSheetStage) => {
    if (sheet && sheet.stage !== next && (next === "arrange" || sheet.jobIds.length)) run({ type: "sheet_set_stage", sheetId: sheet.id, stage: next });
    onStage(next);
  };

  const status = !hydrateReady || persistStatus === "loading" ? t("Loading…", "กำลังโหลด…")
    : persistStatus === "saving" ? t("Saving…", "กำลังบันทึก…")
      : persistStatus === "conflict" ? t("Not saved — changed in another tab, reload", "ยังไม่ได้บันทึก — มีการแก้ไขในแท็บอื่น โหลดใหม่")
      : persistStatus === "error" ? t("Not saved — press Save", "ยังไม่ได้บันทึก — กดบันทึก")
        : lastSavedAt ? t(`All changes saved · ${formatBangkokTime(lastSavedAt)}`, `บันทึกแล้ว · ${formatBangkokTime(lastSavedAt)} น.`) : t("Ready", "พร้อม");

  return (
    <section className="fc6-flow" aria-label={t("Finance billing workflow", "ขั้นตอนวางบิลการเงิน")}>
      <div className="ees-fc-card fc6-context"><div className="fc6-context-main">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="shrink-0 text-sm font-semibold text-slate-600">{t("Customer", "ลูกค้า")}</span>
          <details className="relative min-w-0 flex-1">
            <summary className="ees-fc-btn-secondary w-full cursor-pointer justify-between text-left"><span className="truncate">{customers.find((item) => item.clientId === clientId)?.client || t("Choose customer…", "เลือกลูกค้า…")}</span><span aria-hidden="true">▾</span></summary>
            <div className="absolute left-0 top-full z-30 mt-1 w-full min-w-[15rem] rounded-xl bg-white p-2 shadow-xl ring-1 ring-violet-200">
              <input type="search" autoComplete="off" className="ees-fc-input" aria-label={t("Find customer", "ค้นหาลูกค้า")} value={customerSearch} onChange={(event) => setCustomerSearch(event.target.value)} />
              <ul className="mt-2 max-h-64 overflow-auto">
                {customers.filter((item) => item.client.toLowerCase().includes(customerSearch.trim().toLowerCase())).map((item) => <li key={item.clientId}><button type="button" aria-current={clientId === item.clientId ? "true" : undefined} className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-violet-50" onClick={(event) => { onClient(item.clientId); setCustomerSearch(""); event.currentTarget.closest("details")?.removeAttribute("open"); }}>{item.client} · {item.workOrders} {t("WO", "ใบงาน")}</button></li>)}
              </ul>
              {!customers.some((item) => item.client.toLowerCase().includes(customerSearch.trim().toLowerCase())) ? <p role="status" className="p-2 text-sm text-slate-500">{t("No matching customers", "ไม่พบลูกค้า")}</p> : null}
            </div>
          </details>
        </div>
        {/* Hidden until a customer (and so a billing pack) is chosen — no placeholder dash. */}
        {clientId && sheet ? (
          <SheetTrnReference sheet={sheet} t={t} large />
        ) : null}
        <div className="ml-auto flex items-center gap-3">
          <span role="status" className="ees-fc-save" data-state={persistStatus === "error" || persistStatus === "conflict" ? "error" : !hydrateReady || persistStatus === "loading" || persistStatus === "saving" ? "saving" : lastSavedAt ? "saved" : "idle"}>{status}</span>
          <button type="button" className="ees-fc-btn-secondary" disabled={!hydrateReady} onClick={() => void save()}>{t("Save", "บันทึก")}</button>
        </div>
        {note ? <p role="alert" className="w-full text-sm font-semibold text-rose-800">{note}</p> : null}
      </div>

      {clientId ? (
        <div className="fc6-invoice-groups" data-testid="invoice-groups" aria-label={t("Invoice groups", "กลุ่มใบแจ้งหนี้")}>
          <span className="text-sm font-bold text-violet-950">{t("Invoices", "ใบแจ้งหนี้")}</span>
          {customerSheets.map((item) => {
            const sum = sheetSummary(state, item);
            const active = !!sheet && item.id === sheet.id;
            if (editingName === item.id) {
              const draft = nameDraft[item.id] ?? item.label ?? "";
              const commit = () => {
                const result = run({ type: "sheet_set_label", sheetId: item.id, label: draft });
                if (!result.ok) { setNote(sheetErrorText(result.code, result.detail, t)); return; }
                setNameDraft((prev) => { const copy = { ...prev }; delete copy[item.id]; return copy; }); setEditingName("");
              };
              return (
                <span key={item.id} className="flex items-center gap-1 rounded-xl bg-violet-50 px-2 py-1 ring-2 ring-violet-600">
                  <b className="text-sm tabular-nums">{sheetTrnLabel(item)}</b>
                  <input autoFocus className="w-36 rounded-lg border border-slate-300 px-2 py-1 text-sm" data-testid="group-name-input" aria-label={t("Group name", "ชื่อกลุ่ม")} placeholder={t("Group name", "ชื่อกลุ่ม")} value={draft}
                    onChange={(event) => setNameDraft((prev) => ({ ...prev, [item.id]: event.target.value }))} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commit(); } if (event.key === "Escape") setEditingName(""); }} />
                  <button type="button" className="ees-fc-btn-primary !py-0.5 !text-xs" data-testid="group-name-save" onClick={commit}>{t("Save", "บันทึก")}</button>
                  <button type="button" className="text-xs text-slate-600" onClick={() => setEditingName("")}>{t("Cancel", "ยกเลิก")}</button>
                </span>
              );
            }
            return (
              <span key={item.id} className="inline-flex items-center">
                <button type="button" data-testid="invoice-group-chip" aria-current={active ? "true" : undefined} onClick={() => onSheet(item.id)}
                  className={`rounded-xl px-3 py-1.5 text-left text-sm ring-1 ${active ? "bg-violet-700 text-white shadow ring-violet-700" : "bg-white text-slate-800 ring-slate-300 hover:bg-violet-50"}`}>
                  <b className="tabular-nums">{sheetTrnLabel(item)}</b>{item.label ? <span> · {item.label}</span> : null}
                  <span className="block text-xs opacity-90">{item.jobIds.length} {t(item.jobIds.length === 1 ? "work order" : "work orders", "ใบงาน")} · <b className="tabular-nums">{formatThb(satangToThb(sum.totalSatang))}</b> · {item.approvedAt ? t("Approved", "อนุมัติแล้ว") : item.readyForApprovalAt ? t("Ready for review", "พร้อมตรวจสอบ") : t("Draft", "ร่าง")}</span>
                </button>
                {active && !item.readyForApprovalAt ? <button type="button" className="ml-1 rounded-full px-1.5 text-sm text-slate-500 hover:bg-violet-50 hover:text-violet-900" data-testid="group-rename" aria-label={t("Rename this group", "เปลี่ยนชื่อกลุ่มนี้")} title={t("Rename this group", "เปลี่ยนชื่อกลุ่มนี้")} onClick={() => setEditingName(item.id)}>✎</button> : null}
              </span>
            );
          })}
          <button type="button" className="ees-fc-btn-secondary !py-1" data-testid="new-invoice-group" onClick={() => {
            const predicted = `SHEET-${(state.billingSheetSeq || (state.billingSheets || []).length) + 1}`;
            const result = run({ type: "sheet_create", clientId, additional: customerSheets.some((item) => !item.readyForApprovalAt) });
            if (!result.ok) { setNote(sheetErrorText(result.code, result.detail, t)); return; }
            onSheet(predicted); onStage("arrange");
          }}>+ {t("New invoice group", "สร้างกลุ่มใบแจ้งหนี้ใหม่")}</button>
          {customerSheets.length > 1 ? (
            <span className="ml-auto text-sm text-slate-700" data-testid="flow-customer-aggregate">
              {t(`Aggregate across ${customerSheets.length} separate invoices`, `ยอดรวมของ ${customerSheets.length} ใบแจ้งหนี้แยกกัน`)}: <b className="tabular-nums">{formatThb(satangToThb(customerSheets.reduce((sum, item) => sum + sheetSummary(state, item).totalSatang, 0)))}</b>
              <span className="block text-xs text-slate-500">{t("Each invoice is issued and stored separately; this is only a customer-level total.", "แต่ละใบแจ้งหนี้ออกและเก็บแยกกัน ยอดนี้เป็นเพียงยอดรวมระดับลูกค้า")}</span>
            </span>
          ) : null}
        </div>
      ) : null}

      </div>

      {!customers.length ? (
        <p className="ees-fc-card p-5 text-base text-slate-700">
          {t("No green-paper work orders are linked yet.", "ยังไม่มีใบงานสีเขียวที่เชื่อมไว้")}{" "}
          <button type="button" className="font-bold text-violet-800 hover:underline" onClick={() => openAdminIntake()}>{t("Open Admin Intake", "เปิดหน้ารับใบงาน")}</button>
        </p>
      ) : !clientId ? (
        <div className="ees-fc-card p-4" data-testid="customer-workspace">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div><h2 className="text-lg font-bold text-violet-950">{t("Choose a customer to arrange work orders", "เลือกลูกค้าเพื่อจัดเรียงใบงาน")}</h2>
              <p className="text-sm text-slate-600">{t("Review available papers and existing invoice groups. Selecting a customer does not move any work orders.", "ตรวจใบงานที่พร้อมและกลุ่มใบแจ้งหนี้เดิม การเลือกลูกค้าไม่ย้ายใบงาน")}</p></div>
            <label className="text-sm font-semibold text-slate-600">{t("Find customer", "ค้นหาลูกค้า")}<input type="search" className="ees-fc-input mt-1" value={customerSearch} onChange={(event) => setCustomerSearch(event.target.value)} /></label>
          </div>
          <ul className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {customers.filter((item) => item.client.toLowerCase().includes(customerSearch.trim().toLowerCase())).map((item) => {
              const groups = (state.billingSheets || []).filter((group) => group.clientId === item.clientId);
              const assigned = new Set(groups.flatMap((group) => group.jobIds));
              const available = state.bookings.filter((job) => job.clientId === item.clientId && job.workOrderConfirmed && confirmedWorkOrder(job) && !assigned.has(job.id)).length;
              return <li key={item.clientId}><button type="button" className="ees-fc-customer" onClick={() => { onClient(item.clientId); }}>
                <strong className="block text-base text-violet-950">{item.client}</strong>
                <span className="mt-2 block text-sm text-slate-600">{t(`${item.workOrders} entered · ${available} unassigned · ${groups.length} invoice groups`, `กรอกแล้ว ${item.workOrders} · ยังไม่จัดกลุ่ม ${available} · กลุ่มใบแจ้งหนี้ ${groups.length}`)}</span>
                <span className="mt-3 block text-sm font-bold text-violet-800">{t("Open workspace", "เปิดพื้นที่ทำงาน")} →</span>
              </button></li>;
            })}
          </ul>
          {!customers.length ? <div className="ees-fc-empty"><p>{t("No entered work orders yet. Add the green-paper number in Admin Intake first.", "ยังไม่มีใบงานที่กรอกแล้ว กรุณากรอกเลขใบงานสีเขียวในหน้ารับใบงานก่อน")}</p><button type="button" className="ees-fc-btn-primary" onClick={() => openAdminIntake()}>{t("Open Admin Intake", "เปิดหน้ารับใบงาน")}</button></div>
            : !customers.some((item) => item.client.toLowerCase().includes(customerSearch.trim().toLowerCase())) ? <p role="status" className="ees-fc-empty">{t("No matching customers. Try another name.", "ไม่พบลูกค้า ลองชื่ออื่น")}</p> : null}
        </div>
      ) : !sheet ? (
        <div className="ees-fc-card p-8 text-center">
          <p className="text-lg text-slate-700">{t("Start a new paper list for this customer.", "เริ่มรายการใบงานใหม่สำหรับลูกค้ารายนี้")}</p>
          {simulatedTrnAllowed() ? (
            <p className="mt-1 text-sm text-slate-600" data-testid="next-simulated-trn">
              {t("This batch will be numbered", "ชุดนี้จะได้เลข")}{" "}
              <strong className="tabular-nums text-violet-900">{peekNextSimulatedTrn(state, [activeWorkspace === "owner" ? workspaces.previous_demo : workspaces.owner])}</strong>{" "}
              · {t("simulated, local test only — not an issued TRN", "จำลองสำหรับทดสอบเท่านั้น — ไม่ใช่ TRN ที่ออกจริง")}
            </p>
          ) : null}
          <button type="button" className="ees-fc-btn-primary mt-4"
            onClick={() => { const result = run({ type: "sheet_create", clientId }); if (!result.ok) setNote(sheetErrorText(result.code, result.detail, t)); }}>
            {t("Start paper list", "เริ่มรายการใบงาน")}
          </button>
        </div>
      ) : stage === "arrange" ? (
        <FinanceArrangeStage state={state} sheet={sheet} run={run} t={t} language={language}
          onContinue={() => goStage("billing")} openAdminIntake={openAdminIntake} />
      ) : stage === "billing" ? (
        <FinanceBillingSheetStage state={state} sheet={sheet} run={run} t={t} language={language} save={save}
          onContinue={() => goStage("documents")} onBack={() => goStage("arrange")} openRateTools={openRateTools} />
      ) : (
        <FinanceTrnDocumentsStage state={state} allStates={[workspaces.owner, workspaces.previous_demo]} sheet={sheet} run={run} t={t}
          language={language} backToBilling={() => goStage("billing")} openAdminIntake={openAdminIntake} />
      )}
    </section>
  );
}
