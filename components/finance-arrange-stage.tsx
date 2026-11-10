"use client";

import { useCallback, useRef, useState, type DragEvent } from "react";
import FinanceActionMenu from "@/components/finance-action-menu";
import { sheetErrorText, type FlowRun, type FlowT } from "@/components/finance-billing-flow";
import {
  confirmedWorkOrder,
  customerJobReference,
  lookupWorkOrderForSheet,
  sheetFileReference,
  sheetTrnLabel,
  type BillingSheet,
  type Booking,
  type State
} from "@/lib/finance-demo-centre";
import { displayVehicle, formatBangkokDateTime, formatUiDate } from "@/lib/finance-display";

/** Only meaningful status is shown: a job sent back for checking or awaiting management. Nothing otherwise. */
export function statusBadge(job: Booking, t: FlowT) {
  if (job.financeCheck || job.status === "discrepancy" || job.status === "needs_recheck")
    return <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 align-middle text-xs font-bold text-amber-900">{t("Flagged", "ต้องตรวจสอบ")}</span>;
  return null;
}

export default function FinanceArrangeStage({ state, sheet, run, t, language, onContinue, openAdminIntake }: {
  state: State; sheet: BillingSheet; run: FlowRun; t: FlowT; language: "en" | "th";
  onContinue: () => void; openAdminIntake: (jobId?: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState<{ tone: "ok" | "warn" | "error"; text: string } | null>(null);
  const [menuId, setMenuId] = useState("");
  const closeMenu = useCallback(() => setMenuId(""), []);
  const groupsToMoveTo = (state.billingSheets || []).filter((item) => item.clientId === sheet.clientId && item.id !== sheet.id && !item.readyForApprovalAt);
  const unassigned = state.bookings.filter((job) => job.clientId === sheet.clientId && job.workOrderConfirmed && !!confirmedWorkOrder(job) && !(state.billingSheets || []).some((item) => item.jobIds.includes(job.id)));
  const [flagId, setFlagId] = useState("");
  const [flagReason, setFlagReason] = useState("");
  const [dragId, setDragId] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const locked = !!sheet.readyForApprovalAt;
  const lookup = lookupWorkOrderForSheet(state, sheet, query);
  const jobs = sheet.jobIds.map((id) => state.bookings.find((item) => item.id === id)).filter(Boolean) as Booking[];

  const refocus = () => window.setTimeout(() => inputRef.current?.focus(), 0);
  const add = () => {
    if (lookup.kind !== "match") return;
    const result = run({ type: "sheet_add_paper", sheetId: sheet.id, workOrder: query });
    if (!result.ok) { setMessage({ tone: "error", text: sheetErrorText(result.code, result.detail, t) }); return; }
    setMessage({ tone: "ok", text: t(`WO ${confirmedWorkOrder(lookup.job)} added as paper #${sheet.jobIds.length + 1}.`, `เพิ่ม WO ${confirmedWorkOrder(lookup.job)} เป็นใบที่ ${sheet.jobIds.length + 1} แล้ว`) });
    setQuery("");
    refocus();
  };
  const flagMissing = () => {
    const result = run({ type: "sheet_note_missing", sheetId: sheet.id, workOrder: query });
    if (!result.ok) { setMessage({ tone: "error", text: sheetErrorText(result.code, result.detail, t) }); return; }
    setMessage({ tone: "warn", text: t("Noted as a paper with no record. It was not added.", "บันทึกว่าไม่พบข้อมูลแล้ว ยังไม่ได้เพิ่มใบงาน") });
    setQuery("");
    refocus();
  };
  const move = (jobId: string, toIndex: number) => {
    const result = run({ type: "sheet_move_paper", sheetId: sheet.id, jobId, toIndex });
    if (!result.ok) setMessage({ tone: "error", text: sheetErrorText(result.code, result.detail, t) });
  };
  const onDrop = (event: DragEvent, toIndex: number) => { event.preventDefault(); if (dragId) move(dragId, toIndex); setDragId(""); };

  const printChecklist = () => {
    document.body.classList.add("ees-finance-printing");
    document.body.dataset.eesPrint = "arrange";
    const done = () => { document.body.classList.remove("ees-finance-printing"); delete document.body.dataset.eesPrint; window.removeEventListener("afterprint", done); };
    window.addEventListener("afterprint", done);
    window.print();
  };
  const exportCsv = () => {
    const rows = [["DRAFT/TEST", sheetTrnLabel(sheet), sheet.client], ["Position", "Work order", "Customer job number", "Job date", "Pickup", "Delivery", "Vehicle", "Driver"]];
    jobs.forEach((job, index) => rows.push([String(index + 1), confirmedWorkOrder(job), customerJobReference(job), job.date, job.pickup, job.delivery, displayVehicle(job.vehicle), job.driver]));
    for (const missing of sheet.missingPapers) rows.push(["NO RECORD", missing.workOrder, "", "", "", "", "", ""]);
    downloadCsv(rows, `DRAFT-paper-order-${sheetFileReference(sheet)}.csv`);
  };

  const feedback = (() => {
    if (lookup.kind === "ambiguous") return { tone: "error" as const, text: t("Several linked jobs have this work order. Open Admin Intake and resolve the duplicate before billing: ", "มีหลายงานใช้เลขใบงานนี้ เปิดหน้ารับใบงานและแก้รายการซ้ำก่อนวางบิล: ") + lookup.candidates.map(job => `${job.client} · ${formatUiDate(job.date, language)} · ${displayVehicle(job.vehicle)} · ${job.diarySource?.booking_id || job.id}`).join(" / ") };
    if (lookup.kind === "not_found") return { tone: "error" as const, text: t(`No linked job has work order ${lookup.workOrder}. Check the number, or ask Admin to enter it.`, `ไม่พบงานที่มีเลขที่ใบงาน ${lookup.workOrder} ตรวจเลข หรือให้แอดมินกรอกก่อน`) };
    if (lookup.kind === "other_customer") return { tone: "error" as const, text: sheetErrorText("FINANCE_WO_OTHER_CUSTOMER", lookup.job.client, t) };
    if (lookup.kind === "already_in_list") return { tone: "warn" as const, text: sheetErrorText("FINANCE_WO_ALREADY_IN_LIST", String(lookup.position), t) };
    if (lookup.kind === "in_other_sheet") return { tone: "warn" as const, text: sheetErrorText("FINANCE_WO_IN_OTHER_SHEET", sheetTrnLabel(lookup.sheet), t) };
    return null;
  })();

  return (
    <div className="fc6-arrange">
      <section className="ees-fc-card fc6-paper-entry">
        <p className="fc6-eyebrow">{t("From your paper stack", "จากกองใบงานบนโต๊ะ")}</p><label htmlFor="ees-wo-find" className="block text-base font-bold text-violet-950">{t("Enter work order number", "พิมพ์เลขที่ใบงาน")}</label>
        <input id="ees-wo-find" ref={inputRef} autoFocus autoComplete="off" disabled={locked} value={query}
          onChange={(event) => { setQuery(event.target.value); setMessage(null); }}
          onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); if (lookup.kind === "match") add(); } }}
          placeholder={t("Top paper on the stack", "ใบบนสุดของกอง")}
          className="w-full rounded-xl border-2 border-violet-300 bg-white px-4 py-2.5 text-3xl font-black text-slate-950 placeholder:text-lg placeholder:font-medium placeholder:text-slate-400 focus:border-violet-700 focus:outline-none disabled:bg-slate-100" />

        <div aria-live="polite">
          {lookup.kind === "match" ? (
            <div className="rounded-xl bg-violet-50/70 p-3 ring-1 ring-violet-200">
              <p className="text-3xl font-black text-slate-950">{confirmedWorkOrder(lookup.job)}{statusBadge(lookup.job, t)}</p>
              <p className="mt-1 text-base font-semibold text-slate-800">{formatUiDate(lookup.job.date, language)} · {displayVehicle(lookup.job.vehicle) || "—"} · {lookup.job.driver || "—"}</p>
              <p className="text-sm text-slate-700">{lookup.job.pickup || "—"} → {lookup.job.delivery || "—"}</p>
              <button type="button" onClick={add} className="ees-fc-btn-primary mt-3 w-full">{t(`Add to invoice · paper #${sheet.jobIds.length + 1}`, `เพิ่มเป็นใบที่ ${sheet.jobIds.length + 1}`)} ↵</button>
            </div>
          ) : feedback ? (
            <div className={`rounded-xl p-3 text-base font-semibold ${feedback.tone === "error" ? "bg-rose-50 text-rose-900" : "bg-amber-50 text-amber-950"}`}>
              <p>{feedback.text}</p>
              {lookup.kind === "in_other_sheet" ? <a className="mt-2 inline-block text-sm underline" target="_blank" rel="noopener" href={"/finance-centre?section=sheet&customer=" + encodeURIComponent(lookup.sheet.clientId) + "&sheet=" + encodeURIComponent(lookup.sheet.id)}>{t("Open existing invoice", "เปิดใบแจ้งหนี้เดิม")}</a> : null}
              {lookup.kind === "ambiguous" ? <button type="button" className="mt-2 text-sm underline" onClick={() => openAdminIntake()}>{t("Open Admin Intake", "เปิดหน้ารับใบงาน")}</button> : null}
              {lookup.kind === "not_found" && !locked ? (
                <div className="mt-2 flex flex-wrap gap-3 text-sm">
                  <button type="button" className="font-bold underline-offset-2 hover:underline" onClick={flagMissing}>{t("Note paper with no record", "บันทึกใบงานที่ไม่มีข้อมูล")}</button>
                  <button type="button" className="font-bold underline-offset-2 hover:underline" onClick={() => openAdminIntake()}>{t("Open Admin Intake", "เปิดหน้ารับใบงาน")}</button>
                </div>
              ) : null}
            </div>
          ) : message ? (
            <p role="status" className={`rounded-xl p-3 text-base font-semibold ${message.tone === "ok" ? "bg-emerald-50 text-emerald-900" : message.tone === "warn" ? "bg-amber-50 text-amber-950" : "bg-rose-50 text-rose-900"}`}>{message.text}</p>
          ) : (
            <p className="px-1 text-sm text-slate-500">{t("Enter the green-paper number. Review the match, then press Enter to add it to this invoice.", "พิมพ์เลขแล้วกด Enter")}</p>
          )}
        </div>

        {sheet.missingPapers.length ? (
          <div className="rounded-xl bg-amber-50 p-3">
            <p className="text-sm font-bold text-amber-950">{t("Papers with no record", "ใบงานที่ไม่มีข้อมูล")}</p>
            <ul className="mt-1 flex flex-wrap gap-2">
              {sheet.missingPapers.map((item) => (
                <li key={item.workOrder} className="flex items-center gap-2 rounded-lg bg-white px-2 py-1 text-base font-bold">
                  {item.workOrder}
                  <button type="button" disabled={locked} aria-label={t("Clear", "ลบ")} className="text-sm text-amber-900" onClick={() => run({ type: "sheet_clear_missing", sheetId: sheet.id, workOrder: item.workOrder })}>×</button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section className="ees-fc-card fc6-paper-organisation" data-print-scope="arrange">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
          <h2 className="text-base font-bold text-violet-950" title={t("Positions are only the order of the papers — not work order, TRN or invoice numbers.", "ลำดับเป็นเพียงการเรียงใบงาน ไม่ใช่เลขที่ใบงาน TRN หรือใบแจ้งหนี้")}>{t("Work orders in this invoice", "ใบงานในใบแจ้งหนี้นี้")}</h2>
          <p className="text-base font-bold text-slate-700">{jobs.length} {t(jobs.length === 1 ? "work order" : "work orders", "ใบงาน")}</p>
        </div>
        <p className="hidden px-4 text-sm font-bold print:block">DRAFT / TEST · {sheetTrnLabel(sheet)}{sheet.simulatedTrn ? " (simulated TRN — not issued)" : ""} · {formatBangkokDateTime(new Date())}</p>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 print:overflow-visible" data-testid="paper-list">
        {!jobs.length ? (
          <div className="ees-fc-empty my-3" data-testid="arrange-empty">
            <p className="text-base font-bold text-slate-800">{t("No papers yet", "ยังไม่มีใบงาน")}</p>
            <p className="text-sm">{t("Type a work order number on the left and press Enter.", "พิมพ์เลขที่ใบงานทางซ้ายแล้วกด Enter")}</p>
          </div>
        ) : (
          <ol className="divide-y divide-slate-100">
            {jobs.map((job, index) => (
              <li key={job.id} draggable={!locked} data-paper-row
                onDragStart={() => setDragId(job.id)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => onDrop(event, index)}
                className={`flex items-center gap-3 py-1 ${dragId === job.id ? "opacity-50" : ""} ${locked ? "" : "cursor-grab"}`}>
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-100 text-xs font-black text-violet-900">{index + 1}</span>
                <p className="fc6-paper-number w-20 shrink-0 text-xl font-black leading-tight text-slate-950">{confirmedWorkOrder(job)}</p>
                <div className="min-w-0 flex-1">
                  <p className="fc6-paper-details flex min-w-0 items-baseline gap-x-3 text-sm text-slate-800">
                    <span className="shrink-0">{formatUiDate(job.date, language)}</span>
                    <span className="shrink-0 font-bold">{displayVehicle(job.vehicle) || "—"}</span>
                    <span className="fc6-paper-driver">{job.driver || "—"}</span>
                    <span className="fc6-paper-route min-w-0 text-slate-600" title={`${job.pickup} → ${job.delivery}`}>{job.pickup || "—"} → {job.delivery || "—"}</span>
                    {statusBadge(job, t)}
                  </p>
                  {job.financeCheck ? <p className="text-xs font-semibold text-amber-900">{job.financeCheck.reason}</p> : null}
                  {flagId === job.id ? (
                    <div className="mt-1 flex flex-wrap gap-2 print:hidden">
                      <input autoFocus className="min-w-[12rem] flex-1 rounded-lg border border-amber-300 px-3 py-1.5 text-sm" placeholder={t("What needs checking?", "ต้องตรวจอะไร")} value={flagReason} onChange={(event) => setFlagReason(event.target.value)} />
                      <button type="button" className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-bold text-white" onClick={() => {
                        const result = run({ type: "flag_needs_checking", jobId: job.id, reason: flagReason });
                        if (!result.ok) { setMessage({ tone: "error", text: sheetErrorText(result.code, result.detail, t) }); return; }
                        setFlagId(""); setFlagReason("");
                      }}>{t("Flag", "แจ้ง")}</button>
                      <button type="button" className="text-sm text-slate-600" onClick={() => setFlagId("")}>{t("Cancel", "ยกเลิก")}</button>
                    </div>
                  ) : null}
                </div>
                <div className="relative flex shrink-0 items-center gap-1 print:hidden">
                  <button type="button" className="ees-fc-icon-btn !h-8 !w-8" aria-label={t("Move up", "เลื่อนขึ้น")} disabled={locked || index === 0} onClick={() => move(job.id, index - 1)}>↑</button>
                  <button type="button" className="ees-fc-icon-btn !h-8 !w-8" aria-label={t("Move down", "เลื่อนลง")} disabled={locked || index === jobs.length - 1} onClick={() => move(job.id, index + 1)}>↓</button>
                  <FinanceActionMenu open={menuId === job.id} onClose={closeMenu} onToggle={() => setMenuId(menuId === job.id ? "" : job.id)} label={t("More actions", "การดำเนินการเพิ่มเติม")}>
                      <button role="menuitem" type="button" disabled={locked} className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50 disabled:opacity-40" onClick={() => { setMenuId(""); run({ type: "sheet_remove_paper", sheetId: sheet.id, jobId: job.id }); }}>{t("Remove from list", "นำออกจากรายการ")}</button>
                      <button role="menuitem" type="button" className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => { setMenuId(""); setFlagId(job.id); }}>{t("Flag for checking", "แจ้งให้ตรวจสอบ")}</button>
                      <button role="menuitem" type="button" className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => { setMenuId(""); openAdminIntake(job.id); }}>{t("Open in Admin Intake", "เปิดในหน้ารับใบงาน")}</button>
                      {groupsToMoveTo.map((other) => (
                        <button key={other.id} role="menuitem" type="button" disabled={locked} data-testid="move-to-group" className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-violet-50 disabled:opacity-40"
                          onClick={() => {
                            setMenuId("");
                            const reason = window.prompt(t(`Why is this work order moving to ${sheetTrnLabel(other)}? (kept in the history)`, `เหตุผลที่ย้ายใบงานนี้ไป ${sheetTrnLabel(other)} (เก็บในประวัติ)`), "");
                            if (reason === null) return;
                            const result = run({ type: "sheet_move_to_group", fromSheetId: sheet.id, toSheetId: other.id, jobId: job.id, reason });
                            setMessage(result.ok ? { tone: "ok", text: t(`Moved WO ${confirmedWorkOrder(job)} to ${sheetTrnLabel(other)} with its charges.`, `ย้ายใบงาน ${confirmedWorkOrder(job)} ไป ${sheetTrnLabel(other)} พร้อมค่าใช้จ่ายแล้ว`) } : { tone: "error", text: sheetErrorText(result.code, result.detail, t) });
                          }}>
                          ⇄ {t("Move to", "ย้ายไป")} {sheetTrnLabel(other)}{other.label ? ` · ${other.label}` : ""}
                        </button>
                      ))}
                  </FinanceActionMenu>
                </div>
              </li>
            ))}
          </ol>
        )}
        </div>
        {unassigned.length ? (
          <div className="fc6-unassigned print:hidden" data-testid="unassigned-work-orders">
            <p className="text-sm font-semibold text-slate-800">{t(`Not in any invoice group yet (${unassigned.length})`, `ยังไม่อยู่ในกลุ่มใบแจ้งหนี้ใด (${unassigned.length})`)}</p>
            <ul className="mt-1 flex flex-wrap gap-2">
              {unassigned.map((job) => (
                <li key={job.id}>
                  <button type="button" disabled={locked} className="rounded-lg bg-slate-50 px-2.5 py-1 text-left text-sm ring-1 ring-slate-300 hover:bg-violet-50 disabled:opacity-40" data-testid="add-unassigned"
                    onClick={() => { const result = run({ type: "sheet_add_paper", sheetId: sheet.id, workOrder: confirmedWorkOrder(job) }); setMessage(result.ok ? { tone: "ok", text: t(`Added WO ${confirmedWorkOrder(job)} to ${sheetTrnLabel(sheet)}.`, `เพิ่มใบงาน ${confirmedWorkOrder(job)} ใน ${sheetTrnLabel(sheet)} แล้ว`) } : { tone: "error", text: sheetErrorText(result.code, result.detail, t) }); }}>
                    <b className="text-base">{confirmedWorkOrder(job)}</b> <span className="text-xs text-slate-600">{formatUiDate(job.date, language)} · {job.pickup} → {job.delivery}</span> <span className="font-semibold text-violet-800">+ {t("Add to Invoice", "เพิ่มในใบแจ้งหนี้")}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-4 py-2.5 print:hidden">
          <button type="button" className="ees-fc-btn-quiet" disabled={!jobs.length} onClick={printChecklist}>{t("Print paper checklist", "พิมพ์รายการใบงาน")}</button>
          <button type="button" className="ees-fc-btn-quiet" disabled={!jobs.length} onClick={exportCsv}>{t("Export CSV", "ส่งออก CSV")}</button>
          <button type="button" className="ees-fc-btn-primary ml-auto" disabled={!jobs.length} onClick={onContinue}>{t("Continue to Customer Billing", "ไปที่วางบิลลูกค้า")} →</button>
        </div>
      </section>
    </div>
  );
}

/** Excel-friendly UTF-8 CSV with formula-injection protection. */
export function downloadCsv(rows: string[][], fileName: string) {
  const quote = (value: string) => `"${(/^[=+@\t\r]/.test(value) || /^-[^\d]/.test(value) ? "'" : "") + value.replaceAll('"', '""')}"`;
  const url = URL.createObjectURL(new Blob(["﻿" + rows.map((row) => row.map((cell) => quote(cell ?? "")).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}
