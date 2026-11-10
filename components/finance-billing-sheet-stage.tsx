"use client";

import { Fragment, useEffect, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { downloadCsv, statusBadge } from "@/components/finance-arrange-stage";
import { sheetErrorText, type FlowRun, type FlowT } from "@/components/finance-billing-flow";
import { transportEvidenceState } from "@/lib/finance-workspace-view";
import { financePricingAdminHref, useCanManagePricing } from "@/lib/use-finance-pricing-access";
import { useFinanceVerifiedPrices } from "@/lib/use-finance-verified-prices";
import {
  SHEET_EXTRA_KINDS,
  confirmedWorkOrder,
  customerJobReference,
  extraStatus,
  parseOptionalReceiptThb,
  satangToThb,
  sheetFileReference,
  sheetRateSuggestion,
  ownerTransportDecision,
  sheetRowTotals,
  sheetSummary,
  sheetTrnLabel,
  type AdminReceiptKind,
  type BillingSheet,
  type Booking,
  type State
} from "@/lib/finance-demo-centre";
import { displayVehicle, formatPeriod, formatThb, formatThbShort, formatUiDate } from "@/lib/finance-display";

export const thb = formatThb;

/** Column order follows the existing EES billing workbook. Tolls stay separate from parking. */
export const EXTRA_COLUMNS: { kind: AdminReceiptKind; en: string; th: string }[] = [
  { kind: "other", en: "Other Charges", th: "ค่าอื่น ๆ" },
  { kind: "parking", en: "Parking Fees", th: "ค่าจอดรถ" },
  { kind: "toll", en: "Toll Fees", th: "ค่าทางด่วน" },
  { kind: "overtime", en: "Overtime", th: "ค่าล่วงเวลา" },
  { kind: "container_pickup", en: "Container Pickup", th: "ค่ารับตู้" },
  { kind: "overnight", en: "Overnight", th: "ค่าค้างคืน" }
];
const SHORT: Record<AdminReceiptKind, [string, string]> = {
  parking: ["Parking", "จอด"], toll: ["Toll", "ทางด่วน"], overtime: ["OT", "ล่วงเวลา"], container_pickup: ["Container", "รับตู้"], overnight: ["Overnight", "ค้างคืน"], other: ["Other", "อื่น ๆ"]
};

const head = "sticky top-0 z-10 bg-slate-50 px-3 py-2.5 text-left text-sm font-semibold text-slate-600 shadow-[inset_0_-1px_0_#e2e8f0]";
const cell = "border-b border-slate-100 px-3 py-2 align-top text-sm";

function focusCell(row: number, col: string) {
  const el = document.querySelector<HTMLInputElement>(`[data-sheet-row="${row}"][data-sheet-col="${col}"]`);
  el?.focus();
  el?.select();
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="inline-flex items-center gap-2 whitespace-nowrap text-sm font-semibold text-slate-700">
      <span className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition ${checked ? "bg-violet-700" : "bg-slate-300"}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${checked ? "left-[1.125rem]" : "left-0.5"}`} />
      </span>
      {label}
    </button>
  );
}

function AmountCell({ value, onCommit, row, col, disabled, label, tone, onEnterNext, wide }: {
  value: number | null; onCommit: (text: string) => boolean; row: number; col: string; disabled: boolean; label: string;
  tone: "normal" | "missing" | "pending"; onEnterNext: () => void; wide?: boolean;
}) {
  const [text, setText] = useState(value == null ? "" : String(value));
  const [bad, setBad] = useState(false);
  useEffect(() => { setText(value == null ? "" : String(value)); setBad(false); }, [value]);
  const commit = () => {
    if (text.trim() === (value == null ? "" : String(value))) return true;
    const ok = onCommit(text);
    setBad(!ok);
    return ok;
  };
  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") { event.preventDefault(); if (commit()) onEnterNext(); }
    else if (event.key === "ArrowDown") { event.preventDefault(); commit(); focusCell(row + 1, col); }
    else if (event.key === "ArrowUp") { event.preventDefault(); commit(); focusCell(row - 1, col); }
    else if (event.key === "Escape") { setText(value == null ? "" : String(value)); setBad(false); }
  };
  const ring = bad ? "ring-2 ring-rose-500 bg-rose-50" : tone === "missing" ? "ring-2 ring-amber-300 bg-amber-50/60" : tone === "pending" ? "ring-1 ring-amber-300 bg-amber-50/40" : "ring-1 ring-slate-300 bg-white";
  return (
    <input aria-label={label} inputMode="decimal" autoComplete="off" disabled={disabled} value={text} placeholder={tone === "missing" ? "฿ —" : ""}
      data-sheet-row={row} data-sheet-col={col}
      onChange={(event) => setText(event.target.value)} onBlur={commit} onKeyDown={onKey}
      className={`${wide ? "w-full text-lg" : "w-24 text-base"} rounded-lg border-0 px-3 py-2 text-right font-bold tabular-nums text-slate-950 focus:outline-none focus:ring-2 focus:ring-violet-500 disabled:bg-slate-100 ${ring}`} />
  );
}

export default function FinanceBillingSheetStage({ state, sheet, run, t, language, save, onContinue, onBack, openRateTools }: {
  state: State; sheet: BillingSheet; run: FlowRun; t: FlowT; language: "en" | "th"; save: () => Promise<void>;
  onContinue: () => void; onBack: () => void; openRateTools: (jobId: string) => void;
}) {
  const [message, setMessage] = useState("");
  const [openRow, setOpenRow] = useState("");
  const [onlyAttention, setOnlyAttention] = useState(false);
  const [allColumns, setAllColumns] = useState(false);
  const [addFor, setAddFor] = useState("");
  const [addKind, setAddKind] = useState<AdminReceiptKind>("other");
  const [addAmount, setAddAmount] = useState("");
  const [addNote, setAddNote] = useState("");
  const [confirmRemove, setConfirmRemove] = useState("");
  const canManagePricing = useCanManagePricing();
  const [removeReason, setRemoveReason] = useState("");
  const locked = !!sheet.readyForApprovalAt;
  const summary = sheetSummary(state, sheet);
  const jobs = sheet.jobIds.map((id) => state.bookings.find((item) => item.id === id)).filter(Boolean) as Booking[];
  useFinanceVerifiedPrices(state, sheet, jobs, run);
  const L = (pair: [string, string]) => t(pair[0], pair[1]);

  const report = (result: ReturnType<FlowRun>) => { setMessage(result.ok ? "" : sheetErrorText(result.code, result.detail, t)); return result.ok; };
  const parse = (text: string) => { try { return { ok: true as const, value: parseOptionalReceiptThb(text) }; } catch { return { ok: false as const, value: null }; } };
  const setTransport = (jobId: string, text: string) => {
    const parsed = parse(text);
    if (!parsed.ok || parsed.value === 0) { setMessage(sheetErrorText("FINANCE_AMOUNT_INVALID", "", t)); return false; }
    const existing = sheet.lines[jobId]?.transport;
    let overrideReason: string | undefined;
    if (existing?.provenance && (parsed.value === null || Math.round(parsed.value * 100) !== Math.round(existing.amount * 100))) {
      const answer = window.prompt(t("Reason for changing the approved / calculated price (kept in the audit history):", "เหตุผลที่เปลี่ยนราคาที่อนุมัติ/คำนวณไว้ (เก็บในประวัติ):"), "");
      if (answer === null) return false;
      overrideReason = answer.trim();
    }
    return report(run({ type: "sheet_set_transport", sheetId: sheet.id, jobId, transport: parsed.value === null ? null : { amount: parsed.value, source: "manual", ...(overrideReason ? { overrideReason } : {}) } }));
  };
  const setExtraText = (jobId: string, kind: AdminReceiptKind, text: string) => {
    const parsed = parse(text);
    if (!parsed.ok || parsed.value === 0) { setMessage(sheetErrorText("FINANCE_AMOUNT_INVALID", "", t)); return false; }
    return report(run({ type: "sheet_set_extra", sheetId: sheet.id, jobId, kind, value: parsed.value === null ? null : { decision: "bill", amount: parsed.value } }));
  };
  const setExtra = (jobId: string, kind: AdminReceiptKind, value: { decision: "bill" | "not_billable"; amount: number | null; note?: string } | null) =>
    report(run({ type: "sheet_set_extra", sheetId: sheet.id, jobId, kind, value }));
  // Auto-save (provider) persists each committed cell; Enter just moves to the next paper.
  const nextPaper = (index: number) => { if (index + 1 < jobs.length) focusCell(index + 1, "transport"); };
  const period = formatPeriod(summary.periodStart, summary.periodEnd, "doc");
  const extrasColumnTotal = (kind: AdminReceiptKind) => jobs.reduce((sum, job) => sum + (sheetRowTotals(state, sheet, job.id).extrasSatang[kind] ?? 0), 0);

  const exportCsv = () => {
    const rows = [["DRAFT/TEST", sheetTrnLabel(sheet), sheet.simulatedTrn ? "Simulated TRN — local test only, not issued" : "Official TRN pending confirmation", sheet.client, period],
      ["Position", "Transport Date", "Customer Job Number", "Work Order Number", "Pickup Location", "Delivery Location", "Vehicle Registration", "Driver", "Trip Charge", ...EXTRA_COLUMNS.map((c) => c.en), "Total Customer Amount"]];
    jobs.forEach((job) => {
      const totals = sheetRowTotals(state, sheet, job.id);
      rows.push([String(totals.position), job.date, customerJobReference(job), confirmedWorkOrder(job), job.pickup, job.delivery, displayVehicle(job.vehicle), job.driver,
        totals.transportSatang === null ? "" : (totals.transportSatang / 100).toFixed(2),
        ...EXTRA_COLUMNS.map((c) => totals.extrasSatang[c.kind] === null ? "" : (totals.extrasSatang[c.kind]! / 100).toFixed(2)),
        totals.totalSatang === null ? "" : (totals.totalSatang / 100).toFixed(2)]);
    });
    rows.push(["", "", "", "", "", "", "", "TOTAL", (summary.transportSatang / 100).toFixed(2), ...EXTRA_COLUMNS.map((c) => (extrasColumnTotal(c.kind) / 100).toFixed(2)), (summary.totalSatang / 100).toFixed(2)]);
    downloadCsv(rows, `DRAFT-billing-sheet-${sheetFileReference(sheet)}.csv`);
  };

  // One click bills every recorded, still-undecided Admin receipt as a customer charge on its own work order (never pooled across invoices).
  const pendingReceipts = jobs.flatMap((job) => SHEET_EXTRA_KINDS.filter((kind) => extraStatus(job, sheet.lines[job.id], kind) === "needs_decision" && (job.adminReceipts?.amounts[kind] ?? 0) > 0).map((kind) => ({ job, kind, amount: job.adminReceipts!.amounts[kind] as number })));
  const billAllReceipts = () => {
    let done = 0;
    for (const item of pendingReceipts) if (run({ type: "sheet_set_extra", sheetId: sheet.id, jobId: item.job.id, kind: item.kind, value: { decision: "bill", amount: item.amount } }).ok) done += 1;
    setMessage("");
    return done;
  };
  const visible = jobs.filter((job) => {
    if (!onlyAttention) return true;
    const totals = sheetRowTotals(state, sheet, job.id);
    return totals.missingTransport || totals.pendingExtras.length > 0 || !!statusBadge(job, t);
  });

  const renderExtras = (job: Booking) => {
    const line = sheet.lines[job.id];
    const chips = SHEET_EXTRA_KINDS.filter((kind) => job.adminReceipts?.amounts[kind] != null || line?.extras[kind]);
    const free = SHEET_EXTRA_KINDS.filter((kind) => !line?.extras[kind] && job.adminReceipts?.amounts[kind] == null);
    return (
      <div className="fc6-charge-list">
        {chips.map((kind) => {
          const status = extraStatus(job, line, kind);
          const recorded = job.adminReceipts?.amounts[kind];
          const decision = line?.extras[kind];
          const label = `${L(SHORT[kind])} ${formatThbShort(decision?.decision === "bill" ? decision.amount : recorded)}`;
          if (status === "billed") return (
            <span key={kind} className="fc6-charge-row" data-charge-state="bill">
              <button key={kind} type="button" disabled={locked} title={[decision?.note, t("Billed to customer — click to undo", "เรียกเก็บลูกค้า — คลิกเพื่อยกเลิก")].filter(Boolean).join(" · ")}
              onClick={() => setExtra(job.id, kind, null)} className="rounded-full bg-violet-700 px-2.5 py-1 text-xs font-bold text-white disabled:opacity-60"><span>{label}</span><small>{t("Billable · Undo", "เรียกเก็บ · ยกเลิก")}</small></button>
              {free.length && !locked ? (
                <select aria-label={t("Re-label this charge", "เปลี่ยนหมวดค่าใช้จ่ายนี้")} data-testid="bill-as" className="rounded-full bg-white px-1 py-0.5 text-xs text-violet-800 ring-1 ring-violet-200" value="" title={t("Verified under a different category? Re-label it; it is still counted once.", "ยืนยันว่าเป็นหมวดอื่น? เปลี่ยนหมวดได้ ยังนับครั้งเดียว")}
                  onChange={(event) => { const to = event.target.value as AdminReceiptKind; if (to) report(run({ type: "sheet_reclassify_extra", sheetId: sheet.id, jobId: job.id, from: kind, to })); }}>
                  <option value="">{t("Category…", "หมวด…")}</option>
                  {free.map((other) => <option key={other} value={other}>{L(SHORT[other])}</option>)}
                </select>
              ) : null}
            </span>
          );
          if (status === "not_billable") return (
            <button key={kind} type="button" disabled={locked} title={t("Not billed — click to undo", "ไม่เรียกเก็บ — คลิกเพื่อยกเลิก")}
              onClick={() => setExtra(job.id, kind, null)} className="fc6-internal-charge">{label}<small>{t("Internal / not billed · Undo", "ภายใน / ไม่เรียกเก็บ · ยกเลิก")}</small></button>
          );
          return (
            <span key={kind} className="fc6-charge-row fc6-charge-pending" title={t("Paid by driver (receipt). Not billed until you click Bill.", "คนขับจ่าย (ใบเสร็จ) ยังไม่เรียกเก็บจนกว่าจะกด เก็บ")}>
              <span className="bg-amber-50 px-2.5 py-1 text-amber-950">{label}</span>
              {(recorded ?? 0) > 0 ? <button type="button" disabled={locked} className="bg-white px-2 py-1 font-bold text-violet-800 hover:bg-violet-50" onClick={() => setExtra(job.id, kind, { decision: "bill", amount: recorded! })}>{t("Bill", "เก็บ")}</button> : null}
              {(recorded ?? 0) > 0 && free.length ? (
                <select disabled={locked} aria-label={t("Bill as another category", "เรียกเก็บเป็นหมวดอื่น")} data-testid="bill-as" className="bg-white px-1 py-1 text-xs text-violet-800" value="" title={t("Bill this receipt under a different category (e.g. recorded as Toll, verified as Other). It is counted once.", "เรียกเก็บใบเสร็จนี้ในหมวดอื่น (เช่น บันทึกเป็นทางด่วน แต่จริงคืออื่น ๆ) นับครั้งเดียว")}
                  onChange={(event) => { const to = event.target.value as AdminReceiptKind; if (to) report(run({ type: "sheet_reclassify_extra", sheetId: sheet.id, jobId: job.id, from: kind, to })); }}>
                  <option value="">{t("as…", "เป็น…")}</option>
                  {free.map((other) => <option key={other} value={other}>{L(SHORT[other])}</option>)}
                </select>
              ) : null}
              <button type="button" disabled={locked} aria-label={t("Do not bill", "ไม่เรียกเก็บ")} className="bg-white px-1.5 py-1 text-slate-500 hover:bg-slate-50" onClick={() => setExtra(job.id, kind, { decision: "not_billable", amount: null })}>{t("Internal", "ภายใน")}</button>
            </span>
          );
        })}
        {!locked && free.length ? (
          addFor === job.id ? (
            <span className="flex w-full flex-wrap items-center gap-1.5">
              <select className="rounded-lg px-2 py-1 text-xs ring-1 ring-slate-300" value={free.includes(addKind) ? addKind : free[0]} onChange={(event) => setAddKind(event.target.value as AdminReceiptKind)}>
                {free.map((kind) => <option key={kind} value={kind}>{L(SHORT[kind])}</option>)}
              </select>
              <input className="w-20 rounded-lg px-2 py-1 text-right text-xs ring-1 ring-slate-300" inputMode="decimal" placeholder="฿" value={addAmount} onChange={(event) => setAddAmount(event.target.value)} />
              <input className="min-w-0 flex-1 rounded-lg px-2 py-1 text-xs ring-1 ring-slate-300" placeholder={t("Note", "หมายเหตุ")} value={addNote} onChange={(event) => setAddNote(event.target.value)} />
              <button type="button" className="rounded-lg bg-violet-700 px-2 py-1 text-xs font-bold text-white" onClick={() => {
                const parsed = parse(addAmount);
                if (!parsed.ok || !parsed.value) { setMessage(sheetErrorText("FINANCE_AMOUNT_INVALID", "", t)); return; }
                if (setExtra(job.id, free.includes(addKind) ? addKind : free[0], { decision: "bill", amount: parsed.value, note: addNote })) { setAddFor(""); setAddAmount(""); setAddNote(""); }
              }}>{t("Add", "เพิ่ม")}</button>
              <button type="button" className="text-xs text-slate-500" onClick={() => setAddFor("")}>{t("Cancel", "ยกเลิก")}</button>
            </span>
          ) : (
            <button type="button" className="rounded-full px-2 py-1 text-xs font-semibold text-violet-800 hover:bg-violet-50" onClick={() => { setAddFor(job.id); setAddKind(free[0]); }}>+ {t("Add", "เพิ่ม")}</button>
          )
        ) : null}
      </div>
    );
  };

  const colCount = allColumns ? 15 : 9;

  return (
    <section className="fc6-billing space-y-3">
      <div className="fc6-billing-summary">
        <dl className="fc6-totals" aria-label={t("Current invoice totals", "ยอดใบแจ้งหนี้ปัจจุบัน")}>
          <div><dt>{t("Transport charges", "ค่าขนส่ง")}</dt><dd>{thb(satangToThb(summary.transportSatang))}</dd><span>{summary.jobCount} {t(summary.jobCount === 1 ? "work order" : "work orders", "ใบงาน")}</span></div>
          <div><dt>{t("Customer-billable extras", "ค่าใช้จ่ายเรียกเก็บลูกค้า")}</dt><dd>{thb(satangToThb(summary.approvedExtrasSatang))}</dd><span>{t("Explicit billing decisions only", "เฉพาะรายการที่เลือกเรียกเก็บ")}</span></div>
          <div className="fc6-total-primary"><dt>{t("Current invoice total", "ยอดใบแจ้งหนี้ปัจจุบัน")}</dt><dd>{thb(satangToThb(summary.totalSatang))}</dd><span>{summary.missingPrices ? t("Incomplete — transport price pending", "ยังไม่ครบ — รอค่าขนส่ง") : sheet.approvedAt ? t("Approved, not issued", "อนุมัติแล้ว ยังไม่ออก") : sheet.readyForApprovalAt ? t("Awaiting review", "รอตรวจสอบ") : t("Draft · not issued", "ร่าง · ยังไม่ออก")}</span></div>
        </dl>
        <div className="fc6-billing-meta"><span>{t("Billing period", "รอบวางบิล")}: <b>{period}</b></span><span data-testid="customer-aggregate">{t("All invoice groups for this customer", "ทุกกลุ่มใบแจ้งหนี้ของลูกค้านี้")}: <b>{thb(satangToThb((state.billingSheets || []).filter(group => group.clientId === sheet.clientId).reduce((sum, group) => sum + sheetSummary(state, group).totalSatang, 0)))}</b></span></div>
        {summary.missingPrices ? <p className="fc6-attention" data-testid="invoice-incomplete-header"><span data-testid="mandatory-pricing-checks">{summary.missingPrices} {t("work orders need a transport price before review. Totals are incomplete.", "รายการต้องใส่ค่าขนส่งก่อนส่งตรวจสอบ ยอดรวมยังไม่ครบ")}</span>{canManagePricing ? <Link className="ml-2 font-semibold text-violet-900 underline" href={financePricingAdminHref(sheet.clientId, sheet.id)}>{t("Review in Pricing Administration", "ตรวจในหน้าตั้งค่าราคา")} →</Link> : <span className="ml-2">{t("Ask an administrator to review.", "ติดต่อผู้ดูแลเพื่อตรวจสอบ")}</span>}</p> : null}
      </div>

      {locked ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-violet-50 px-4 py-2 text-base text-violet-950" data-testid="sheet-completed">
          <b>{sheet.approvedAt ? t("Approved — amounts locked (not issued)", "อนุมัติแล้ว — ล็อกยอด (ยังไม่ออกจริง)") : t("Ready for review — amounts locked", "พร้อมตรวจสอบ — ล็อกยอด")}</b>
          <button type="button" className="ees-fc-btn-secondary !py-1" onClick={() => report(run({ type: "sheet_reopen", sheetId: sheet.id, reason: sheet.approvedAt ? "Material correction after management approval (local test)" : "Edited by owner (local test)" }))}>{t("Edit draft", "แก้ไขร่าง")}</button>
        </div>
      ) : null}
      {message ? <p role="alert" className="rounded-xl bg-rose-50 p-3 text-base font-semibold text-rose-900">{message}</p> : null}

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <Toggle checked={onlyAttention} onChange={setOnlyAttention} label={t("Only rows needing attention", "เฉพาะแถวที่ต้องดำเนินการ")} />
        {pendingReceipts.length && !locked ? (
          <button type="button" className="ees-fc-btn-secondary !py-1" data-testid="bill-all-receipts" onClick={() => billAllReceipts()}>{t(`Bill all ${pendingReceipts.length} recorded receipt(s) to this invoice`, `เรียกเก็บใบเสร็จที่บันทึกไว้ทั้งหมด ${pendingReceipts.length} รายการในใบแจ้งหนี้นี้`)}</button>
        ) : null}
        <Toggle checked={allColumns} onChange={setAllColumns} label={t("Show all charge columns", "แสดงคอลัมน์ค่าใช้จ่ายทั้งหมด")} />
        <span className="ml-auto text-xs text-slate-500">{t("Enter = next row · ↑ ↓ = move · Esc = undo typing", "Enter = แถวถัดไป · ↑ ↓ = เลื่อน · Esc = ยกเลิกที่พิมพ์")}</span>
      </div>

      <div className="ees-fc-card fc6-billing-table" data-mode={allColumns ? "expanded" : "compact"}>
        <table className={`w-full border-separate border-spacing-0 ${allColumns ? "min-w-[1500px]" : "min-w-[1120px] table-fixed"}`}>
          {!allColumns ? (
            <colgroup><col className="w-10" /><col className="w-[7.5rem]" /><col className="w-[6.5rem]" /><col className="w-[6.5rem]" /><col /><col className="w-[9rem]" /><col className="w-[8.5rem]" /><col className="w-[15rem]" /><col className="w-[8rem]" /></colgroup>
          ) : null}
          <thead>
            <tr>
              <th className={`${head} sticky left-0 z-20 text-center`}>#</th>
              <th className={`${head} ${allColumns ? "sticky left-10 z-20" : ""}`}>{t("Work Order", "เลขที่ใบงาน")}</th>
              <th className={head}>{t("Date", "วันที่")}</th>
              <th className={head}>{t("Cust. Job No.", "เลขงานลูกค้า")}</th>
              <th className={head}>{t("Route", "เส้นทาง")}</th>
              <th className={head}>{t("Vehicle / Driver", "รถ / คนขับ")}</th>
              <th className={`${head} text-right`}>{t("Transport Charge", "ค่าขนส่ง")}</th>
              {allColumns ? EXTRA_COLUMNS.map((column) => <th key={column.kind} className={`${head} text-right`}>{t(column.en, column.th)}</th>) : <th className={head}>{t("Customer extras", "ค่าเพิ่มลูกค้า")}</th>}
              <th className={`${head} text-right`}>{t("Total", "ยอดรวม")}</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((job) => {
              const index = sheet.jobIds.indexOf(job.id);
              const line = sheet.lines[job.id];
              const totals = sheetRowTotals(state, sheet, job.id);
              const wo = confirmedWorkOrder(job);
              return (
                <Fragment key={job.id}>
                  <tr className="group hover:bg-violet-50/30 focus-within:bg-violet-50/70" data-testid="billing-row">
                    <td className={`${cell} sticky left-0 z-[5] bg-white text-center font-semibold text-slate-500 group-hover:bg-violet-50/30 group-focus-within:bg-violet-50 group-focus-within:text-violet-900 group-focus-within:shadow-[inset_4px_0_0_#6d28d9]`}>{index + 1}</td>
                    <td className={`${cell} ${allColumns ? "sticky left-10 z-[5] bg-white group-focus-within:bg-violet-50" : ""}`}>
                      <button type="button" className="text-left" onClick={() => setOpenRow(openRow === job.id ? "" : job.id)} title={t("Show details", "ดูรายละเอียด")}>
                        <span className="text-xl font-black leading-tight text-slate-950">{wo}</span>
                      </button>
                      {statusBadge(job, t)}
                      {canManagePricing ? <Link className="mt-0.5 block text-xs font-semibold text-violet-800 hover:underline" data-testid="view-fuel-calc" href={financePricingAdminHref(sheet.clientId, sheet.id, job.id)}>{t("Pricing evidence", "หลักฐานราคา")}</Link> : null}
                    </td>
                    <td className={`${cell} whitespace-nowrap`}>{formatUiDate(job.date, language)}</td>
                    <td className={`${cell} truncate`} title={customerJobReference(job)}>{customerJobReference(job) || <span className="text-slate-300">—</span>}</td>
                    <td className={cell} title={`${job.pickup} → ${job.delivery}`}>
                      <p className="truncate font-medium text-slate-900">{job.pickup || "—"}</p>
                      <p className="truncate text-slate-600">→ {job.delivery || "—"}</p>
                    </td>
                    <td className={cell}>
                      <p className="truncate font-semibold text-slate-900">{displayVehicle(job.vehicle) || "—"}</p>
                      <p className="truncate text-slate-600">{job.driver || "—"}</p>
                    </td>
                    <td className={`${cell} text-right`}>
                      <AmountCell value={line?.transport?.amount ?? null} row={index} col="transport" disabled={locked} wide={!allColumns}
                        label={t(`Transport charge for WO ${wo}`, `ค่าขนส่ง WO ${wo}`)} tone={totals.missingTransport ? "missing" : "normal"}
                        onCommit={(text) => setTransport(job.id, text)} onEnterNext={() => nextPaper(index)} />
                      {!line?.transport ? <p className="mt-1 text-xs font-bold text-amber-800" data-testid="price-status-needed">{t("Price needed", "ต้องใส่ราคา")}</p>
                        : line.transport.overrideReason ? <p className="mt-1 text-xs font-semibold text-violet-900" data-testid="price-status-override" title={line.transport.overrideReason}>{t("Manual override", "ราคาแก้เอง")}</p>
                        : transportEvidenceState(line.transport) === "verified" ? <p className="mt-1 text-xs text-emerald-700" data-testid="price-status-verified">{t("Verified schedule", "ราคาตามตารางที่ยืนยัน")}</p>
                        : <p className="mt-1 text-xs font-semibold text-slate-700" data-testid="price-status-manual">{transportEvidenceState(line.transport) === "entered" ? t("Price entered · evidence pending", "กรอกราคาแล้ว · รอหลักฐาน") : t("Manual price", "ราคากรอกเอง")}</p>}
                    </td>
                    {allColumns ? EXTRA_COLUMNS.map((column) => {
                      const status = extraStatus(job, line, column.kind);
                      const decision = line?.extras[column.kind];
                      const recorded = job.adminReceipts?.amounts[column.kind];
                      return (
                        <td key={column.kind} className={`${cell} text-right`}>
                          {status === "not_billable" ? <button type="button" disabled={locked} className="text-xs text-slate-500 line-through" onClick={() => setExtra(job.id, column.kind, null)}>{t("not billed", "ไม่เก็บ")}</button> : (
                            <AmountCell value={decision?.decision === "bill" ? decision.amount : null} row={index} col={column.kind} disabled={locked}
                              label={t(`${column.en} billed, WO ${wo}`, `${column.th} เรียกเก็บ WO ${wo}`)} tone={status === "needs_decision" ? "pending" : "normal"}
                              onCommit={(text) => setExtraText(job.id, column.kind, text)} onEnterNext={() => nextPaper(index)} />
                          )}
                          {recorded != null ? <p className="mt-1 text-xs text-slate-500">{t("Receipt", "ใบเสร็จ")} {formatThbShort(recorded)}</p> : null}
                        </td>
                      );
                    }) : <td className={cell}>{renderExtras(job)}</td>}
                    <td className={`${cell} bg-violet-50/50 text-right text-lg font-black tabular-nums shadow-[inset_1px_0_0_#e9e1f3] ${totals.totalSatang === null ? "text-amber-700" : "text-violet-950"}`} data-testid="billing-row-total">
                      {totals.totalSatang === null ? t("Price needed", "ต้องใส่ราคา") : thb(satangToThb(totals.totalSatang))}
                    </td>
                  </tr>
                  {openRow === job.id ? (
                    <tr>
                      <td colSpan={colCount} className="border-b border-slate-100 bg-slate-50/70 px-4 py-3">
                        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm" data-testid="line-actions">
                          {confirmRemove === job.id ? (
                            <span className="flex flex-wrap items-center gap-2 rounded-lg bg-rose-50 px-3 py-1.5 text-rose-900">
                              {t("Remove this work order from this invoice? Its Booking Diary and green-paper records stay; you can restore it.", "นำใบงานนี้ออกจากใบแจ้งหนี้นี้? ข้อมูลสมุดจองและใบงานไม่ถูกลบ และกู้คืนได้")}
                              <input className="rounded px-2 py-1 text-sm ring-1 ring-rose-300" placeholder={t("Reason (optional)", "เหตุผล (ไม่บังคับ)")} value={removeReason} onChange={(e) => setRemoveReason(e.target.value)} />
                              <button type="button" className="rounded-lg bg-rose-700 px-3 py-1 font-semibold text-white" data-testid="confirm-remove-line" onClick={() => { if (report(run({ type: "sheet_remove_paper", sheetId: sheet.id, jobId: job.id, reason: removeReason }))) { setConfirmRemove(""); setRemoveReason(""); setOpenRow(""); } }}>{t("Remove", "นำออก")}</button>
                              <button type="button" className="ees-fc-btn-quiet !py-1" onClick={() => setConfirmRemove("")}>{t("Cancel", "ยกเลิก")}</button>
                            </span>
                          ) : <button type="button" className="ees-fc-btn-quiet !py-1 text-rose-800" disabled={locked} data-testid="remove-line" onClick={() => setConfirmRemove(job.id)}>🗑 {t("Remove line", "นำบรรทัดออก")}</button>}
                        </div>
                        <div className="grid gap-4 text-sm md:grid-cols-2">
                          <div>
                            <p className="font-semibold text-slate-700">{t("Admin notes", "หมายเหตุแอดมิน")}</p>
                            <p className="whitespace-pre-wrap text-slate-700">{job.adminReceipts?.notes || "—"}</p>
                            {job.financeCheck ? <p className="mt-1 font-semibold text-amber-900">{t("Flagged", "ต้องตรวจสอบ")}: {job.financeCheck.reason}</p> : null}
                          </div>
                          <div>
                            <p className="font-semibold text-slate-700">{t("Recorded by Admin (paid by driver)", "บันทึกโดยแอดมิน (คนขับจ่าย)")}</p>
                            <p className="text-slate-700">{SHEET_EXTRA_KINDS.filter((kind) => job.adminReceipts?.amounts[kind] != null).map((kind) => `${L(SHORT[kind])} ${formatThbShort(job.adminReceipts!.amounts[kind])}`).join(" · ") || "—"}</p>
                          </div>
                        </div>
                        {canManagePricing ? <Link className="mt-3 inline-block font-semibold text-violet-900 underline" href={financePricingAdminHref(sheet.clientId, sheet.id, job.id)}>{t("View pricing calculation in Pricing Administration", "ดูการคำนวณราคาในหน้าตั้งค่าราคา")} →</Link> : null}
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={6} className="sticky bottom-0 bg-violet-50 px-3 py-3 text-base font-bold text-violet-950">{summary.jobCount} {t(summary.jobCount === 1 ? "work order" : "work orders", "ใบงาน")}</td>
              <td className="sticky bottom-0 bg-violet-50 px-3 py-3 text-right text-base font-bold tabular-nums">{thb(satangToThb(summary.transportSatang))}</td>
              {allColumns ? EXTRA_COLUMNS.map((column) => <td key={column.kind} className="sticky bottom-0 bg-violet-50 px-3 py-3 text-right font-bold tabular-nums">{thb(satangToThb(extrasColumnTotal(column.kind)))}</td>)
                : <td className="sticky bottom-0 bg-violet-50 px-3 py-3 text-sm font-semibold text-slate-700">{t("Billable", "เรียกเก็บ")} {thb(satangToThb(summary.approvedExtrasSatang))}</td>}
              <td className="sticky bottom-0 bg-violet-50 px-3 py-3 text-right text-lg font-black tabular-nums text-violet-950">{thb(satangToThb(summary.totalSatang))}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {(sheet.removedPapers || []).length ? (
        <div className="rounded-xl bg-amber-50 px-4 py-2 text-sm text-amber-950" data-testid="removed-papers">
          <p className="font-semibold">{t("Removed from this invoice (restorable)", "นำออกจากใบแจ้งหนี้นี้ (กู้คืนได้)")}</p>
          <ul className="mt-1 space-y-1">
            {(sheet.removedPapers || []).map((entry) => {
              const removedJob = state.bookings.find((item) => item.id === entry.jobId);
              return (
                <li key={entry.jobId} className="flex flex-wrap items-center gap-3">
                  <b>WO {removedJob ? confirmedWorkOrder(removedJob) : entry.jobId}</b>
                  <span className="text-xs text-amber-900">{entry.removedAt.slice(0, 16).replace("T", " ")}{entry.reason ? " · " + entry.reason : ""}</span>
                  <button type="button" className="ees-fc-btn-secondary !py-0.5" disabled={locked} data-testid="restore-line" onClick={() => report(run({ type: "sheet_restore_paper", sheetId: sheet.id, jobId: entry.jobId }))}>↶ {t("Restore", "กู้คืน")}</button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="ees-fc-btn-quiet" onClick={onBack}>← {t("Arrange Work Orders", "จัดเรียงใบงาน")}</button>
        <button type="button" className="ees-fc-btn-secondary" onClick={() => void save()}>{t("Save", "บันทึก")}</button>
        <button type="button" className="ees-fc-btn-secondary" onClick={exportCsv}>{t("Export CSV", "ส่งออก CSV")}</button>
        <button type="button" className="ees-fc-btn-primary ml-auto" onClick={() => { void save(); onContinue(); }}>{t("Continue to Documents", "ไปที่เอกสาร")} →</button>
      </div>
    </section>
  );
}
