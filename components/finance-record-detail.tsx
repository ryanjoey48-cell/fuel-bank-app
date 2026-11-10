"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import FinanceActivityHistory from "@/components/finance-activity-history";
import { EXTRA_COLUMNS } from "@/components/finance-billing-sheet-stage";
import { FinanceStatusChip, SimulatedTrnBadge } from "@/components/finance-status-chip";
import { satangToThb, type AdminReceiptKind, type State } from "@/lib/finance-demo-centre";
import { formatBangkokDateTime, formatDocDate, formatThb } from "@/lib/finance-display";
import { financeRecordsCopy, type FinanceRecordsLanguage } from "@/lib/finance-records-copy";
import { trnKindLabel } from "@/lib/finance-records-export";
import { batchActivity, buildFinanceRecords, workOrderActivity, workOrderDetail, type BatchRecord } from "@/lib/finance-records";

export type RecordSelection = { type: "work_order"; id: string } | { type: "batch"; id: string };
export type ReopenOutcome = "ok" | "reason" | "blocked" | "workspace";

const money = (satang: number | null) => formatThb(satangToThb(satang));

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 text-sm font-bold text-violet-950">{title}</h3>
      {children}
    </section>
  );
}
function Fields({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-xs font-semibold text-slate-500">{label}</dt>
          <dd className="break-words font-medium text-slate-900">{value === "" || value == null ? "—" : value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ReopenControl({ batch, language, canReopen, workspaceOk, onReopen, billingHref }: {
  batch: BatchRecord; language: FinanceRecordsLanguage; canReopen: boolean; workspaceOk: boolean;
  onReopen: (sheetId: string, reason: string) => ReopenOutcome; billingHref: string;
}) {
  const copy = financeRecordsCopy[language].detail;
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const outcome = message ? <p role={message.tone === "error" ? "alert" : "status"} className={`text-sm font-semibold ${message.tone === "ok" ? "text-emerald-800" : "text-rose-800"}`}>{message.text}</p> : null;
  if (batch.status === "issued") return <p className="text-sm text-slate-600">{copy.reopenBlockedIssued}</p>;
  if (batch.status !== "ready_for_review") {
    return (
      <div className="space-y-1">
        {outcome}
        <p className="text-sm text-slate-600">{copy.reopenNotReady}{" "}
          {batch.status === "draft" || batch.status === "needs_correction" ? <Link className="font-semibold text-violet-800 underline" href={billingHref}>{copy.openBilling} →</Link> : null}
        </p>
      </div>
    );
  }
  if (!workspaceOk) return <p className="text-sm text-slate-600">{copy.reopenBlockedWorkspace}</p>;
  if (!canReopen) return <p className="text-sm text-slate-600">{copy.reopenBlocked}</p>;
  const submit = () => {
    const outcome = onReopen(batch.sheetId, reason);
    if (outcome === "ok") { setMessage({ tone: "ok", text: copy.reopenDone }); setOpen(false); setReason(""); }
    else setMessage({ tone: "error", text: outcome === "reason" ? copy.reopenNeedsReason : outcome === "workspace" ? copy.reopenBlockedWorkspace : copy.reopenBlocked });
  };
  return (
    <div className="space-y-2">
      {!open ? (
        <button type="button" className="ees-fc-btn-secondary" onClick={() => { setOpen(true); setMessage(null); }}>{copy.reopen}</button>
      ) : (
        <div className="space-y-2 rounded-lg bg-slate-50 p-3">
          <p className="text-sm text-slate-700">{copy.reopenNote}</p>
          <input className="ees-fc-input" autoFocus value={reason} placeholder={copy.reopenReason} aria-label={copy.reopenReason} onChange={(event) => setReason(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); submit(); } }} />
          <div className="flex gap-2">
            <button type="button" className="ees-fc-btn-primary !py-1.5" onClick={submit}>{copy.reopenConfirm}</button>
            <button type="button" className="ees-fc-btn-quiet" onClick={() => { setOpen(false); setReason(""); setMessage(null); }}>{copy.reopenCancel}</button>
          </div>
        </div>
      )}
      {outcome}
    </div>
  );
}

/** Slide-over detail for one work order or one billing batch. Read-only except the guarded reopen action. */
export default function FinanceRecordDetail({ state, selection, language, canViewActivity, canReopen, workspaceOk, onClose, onSelect, onReopen, onDownloadBatchCsv }: {
  state: State;
  selection: RecordSelection;
  language: FinanceRecordsLanguage;
  canViewActivity: boolean;
  canReopen: boolean;
  workspaceOk: boolean;
  onClose: () => void;
  onSelect: (selection: RecordSelection) => void;
  onReopen: (sheetId: string, reason: string) => ReopenOutcome;
  onDownloadBatchCsv: (batch: BatchRecord) => void;
}) {
  const copy = financeRecordsCopy[language];
  const d = copy.detail;
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const extraLabel = (kind: AdminReceiptKind) => {
    const column = EXTRA_COLUMNS.find((item) => item.kind === kind);
    return column ? (language === "th" ? column.th : column.en) : kind;
  };
  const docsHref = (batch: BatchRecord) => `/finance-centre?section=trn&customer=${encodeURIComponent(batch.clientId)}&sheet=${encodeURIComponent(batch.sheetId)}`;
  const invoiceHref = (batch: BatchRecord) => `${docsHref(batch)}&doc=invoice`;
  const billingHref = (batch: BatchRecord) => `/finance-centre?section=sheet&customer=${encodeURIComponent(batch.clientId)}&sheet=${encodeURIComponent(batch.sheetId)}`;

  const batchFromSelection = selection.type === "batch" ? buildFinanceRecords(state).batches.find((item) => item.sheetId === selection.id) ?? null : null;
  const workOrder = selection.type === "work_order" ? workOrderDetail(state, selection.id) : null;
  const sheet = (state.billingSheets || []).find((item) => item.id === (batchFromSelection?.sheetId ?? workOrder?.record.sheetId));

  const title = selection.type === "batch"
    ? <>{batchFromSelection?.trn}{batchFromSelection?.trnSimulated ? <SimulatedTrnBadge language={language} /> : null}</>
    : <>{workOrder?.record.workOrder}</>;
  const status = selection.type === "batch" ? batchFromSelection?.status : workOrder?.record.status;

  const body = (() => {
    if (selection.type === "batch") {
      const batch = batchFromSelection;
      if (!batch || !sheet) return <p className="text-sm text-slate-600">{copy.empty.noMatchTitle}</p>;
      return (
        <>
          <Fields rows={[
            [copy.detailHeaders.customer, <strong key="c">{batch.client}</strong>],
            [d.period, batch.billingPeriod],
            [copy.detailHeaders.draftRef, batch.draftReference],
            [copy.detailHeaders.numbering, trnKindLabel(batch.trnKind, copy)],
            [d.created, formatBangkokDateTime(batch.createdAt)],
            [d.confirmedAt, batch.readyAt ? formatBangkokDateTime(batch.readyAt) : "—"]
          ]} />
          <Section title={d.batchTotals}>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-5">
              {([[copy.columns.transport, batch.transportSatang], [copy.columns.parking, batch.parkingSatang], [copy.columns.tolls, batch.tollSatang], [copy.columns.other, batch.otherSatang]] as [string, number][]).map(([label, value]) => (
                <div key={label}><dt className="text-xs font-semibold text-slate-500">{label}</dt><dd className="font-semibold tabular-nums">{money(value)}</dd></div>
              ))}
              <div><dt className="text-xs font-semibold text-slate-500">{copy.columns.total}</dt><dd className="text-lg font-black tabular-nums text-violet-950" data-testid="detail-total">{money(batch.totalSatang)}</dd></div>
            </dl>
            {batch.missingPrices ? <p className="mt-1 text-sm font-semibold text-amber-800">{language === "th" ? `มีใบงาน ${batch.missingPrices} รายการที่ยังไม่ใส่ราคา` : `${batch.missingPrices} work order(s) have no price yet`}</p> : null}
          </Section>
          <Section title={d.workOrderList}>
            <ol className="divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200" data-testid="detail-paper-order">
              {batch.workOrders.map((row) => (
                <li key={row.jobId}>
                  <button type="button" className="grid w-full grid-cols-[2rem_5rem_minmax(0,1fr)_auto] items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-violet-50" onClick={() => onSelect({ type: "work_order", id: row.jobId })}>
                    <span className="font-bold text-slate-500">{row.position}</span>
                    <span className="text-base font-black text-slate-950">{row.workOrder}</span>
                    <span className="min-w-0 truncate text-slate-600" title={`${row.pickup} → ${row.delivery}`}>{formatDocDate(row.date)} · {row.vehicle} · {row.pickup} → {row.delivery}</span>
                    <span className="font-semibold tabular-nums">{money(row.totalSatang)}</span>
                  </button>
                </li>
              ))}
            </ol>
          </Section>
          <Section title={d.documents}>
            <div className="flex flex-wrap gap-2">
              <Link className="ees-fc-btn-primary !py-1.5" href={docsHref(batch)}>{d.openDocuments}</Link>
              <Link className="ees-fc-btn-secondary !py-1.5" href={invoiceHref(batch)} data-testid="open-invoice">{language === "th" ? "เปิดใบแจ้งหนี้" : "Open invoice"}</Link>
              <button type="button" className="ees-fc-btn-secondary !py-1.5" onClick={() => onDownloadBatchCsv(batch)}>{d.downloadBatchCsv}</button>
              <Link className="ees-fc-btn-quiet" href={billingHref(batch)}>{d.openBilling}</Link>
            </div>
          </Section>
          <ReopenControl batch={batch} language={language} canReopen={canReopen} workspaceOk={workspaceOk} onReopen={onReopen} billingHref={billingHref(batch)} />
          <FinanceActivityHistory entries={batchActivity(state, sheet)} canView={canViewActivity} language={language} />
        </>
      );
    }
    if (!workOrder) return <p className="text-sm text-slate-600">{copy.empty.noMatchTitle}</p>;
    const { record, job, original, receipts, billable, transport, batch } = workOrder;
    const differs = (job.adminReceipts?.customerJobNumber ?? "") !== (original.customerJobNumber ?? "") && job.adminReceipts?.customerJobNumber !== undefined;
    return (
      <>
        <Fields rows={[
          [copy.detailHeaders.customer, <strong key="c">{record.client}</strong>],
          [copy.columns.date, formatDocDate(record.date)],
          [copy.columns.trn, record.trn ? <span key="t" className="font-bold tabular-nums">{record.trn}{record.trnSimulated ? <SimulatedTrnBadge language={language} /> : null}</span> : d.notBatched],
          [copy.columns.period, record.billingPeriod ?? "—"]
        ]} />
        <Section title={d.bookingDiary}>
          <Fields rows={[
            [d.bookingRef, workOrder.bookingReference],
            [copy.columns.date, formatDocDate(original.date)],
            [d.pickupTime, original.pickupTime],
            [copy.columns.vehicle, original.vehicle],
            [copy.columns.pickup, original.pickup],
            [copy.columns.delivery, original.delivery],
            [copy.columns.driver, original.driver],
            [d.customerJobOriginal, original.customerJobNumber],
            [d.notes, original.notes]
          ]} />
        </Section>
        <Section title={d.adminEntry}>
          <Fields rows={[
            [copy.columns.workOrder, <strong key="w" className="text-lg">{record.workOrder}</strong>],
            [d.customerJobEntered, <span key="cj">{record.customerJobNumber || "—"}{differs ? <em className="ml-1 text-xs font-semibold not-italic text-amber-800">({d.differs})</em> : null}</span>],
            [d.intakeStatus, job.intakeCheck
              ? <span key="ic">{job.intakeCheck.result === "matches" ? d.confirmed : d.flagged} · {copy.activity.roles[job.intakeCheck.by] ?? job.intakeCheck.by} · {formatBangkokDateTime(job.intakeCheck.at)}{job.intakeCheck.note ? ` — ${job.intakeCheck.note}` : ""}</span>
              : d.notChecked],
            [d.financeCheck, job.financeCheck ? `${job.financeCheck.reason} · ${formatBangkokDateTime(job.financeCheck.at)}` : "—"]
          ]} />
        </Section>
        <Section title={d.receipts}>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
            {receipts.map((item) => (
              <div key={item.kind}><dt className="text-xs font-semibold text-slate-500">{extraLabel(item.kind)}</dt><dd className="font-semibold tabular-nums">{money(item.satang)}</dd></div>
            ))}
          </dl>
          {job.adminReceipts?.notes ? <p className="mt-1 text-sm text-slate-600">{d.notes}: {job.adminReceipts.notes}</p> : null}
        </Section>
        <Section title={d.billable}>
          {!batch ? <p className="text-sm text-slate-600">{d.notBatched}</p> : (
            <ul className="space-y-1 text-sm" data-testid="detail-billable">
              <li className="flex justify-between gap-3"><span>{d.transport} <span className="text-xs text-slate-500">{transport.source === "manual" ? `(${d.sourceManual})` : transport.source === "schedule" ? `(${d.sourceSchedule}${transport.rateLabel ? ` · ${transport.rateLabel}` : ""})` : ""}</span></span>
                <strong className="tabular-nums">{transport.satang === null ? d.notPriced : money(transport.satang)}</strong></li>
              {transport.provenance ? (
                <li className="text-xs text-slate-600" data-testid="detail-pricing-provenance">
                  {transport.provenance.scheduleName} v{transport.provenance.scheduleVersion} · p.{transport.provenance.sourcePage} · {transport.provenance.route} · {transport.provenance.vehicle} · {transport.provenance.bandLabel} · Diesel B7 ฿{transport.provenance.fuel.priceThb.toFixed(2)}/L ({transport.provenance.fuel.date}, {transport.provenance.fuel.method}) · {transport.provenance.jobDate} · {transport.provenance.contractReference}
                  {transport.provenance.overrideReason ? ` · override of ฿${transport.provenance.suggestedThb.toFixed(2)}: ${transport.provenance.overrideReason}` : ""} · {transport.provenance.decidedBy} {formatBangkokDateTime(transport.provenance.decidedAt)}
                </li>
              ) : null}
              {transport.history.map((entry, index) => <li key={index} className="text-xs text-slate-500">↳ {money(Math.round(entry.transport.amount * 100))} ({entry.transport.source}) → {entry.replacedBy} {formatBangkokDateTime(entry.replacedAt)}{entry.reason ? ` · ${entry.reason}` : ""}</li>)}
              {billable.filter((item) => item.decision !== "none").map((item) => (
                <li key={item.kind} className="flex justify-between gap-3"><span>{extraLabel(item.kind)}{item.note ? <span className="text-xs text-slate-500"> — {item.note}</span> : null}</span>
                  <span className="tabular-nums">{item.decision === "billed" ? <strong>{d.billed} {money(item.satang)}</strong> : item.decision === "not_billable" ? d.notBillable : <em className="not-italic text-amber-800">{d.needsDecision}</em>}</span></li>
              ))}
            </ul>
          )}
          <p className="mt-2 flex items-baseline justify-between border-t border-slate-100 pt-2 text-sm font-bold text-slate-700">
            <span>{d.finalPrice}</span><span className="text-xl font-black tabular-nums text-violet-950" data-testid="detail-total">{money(record.totalSatang)}</span>
          </p>
        </Section>
        <Section title={d.batchOrder}>
          {!batch ? <p className="text-sm text-slate-600">{d.notBatched}</p> : (
            <>
              <p className="text-sm font-semibold text-slate-800">{batch.trn}{batch.trnSimulated ? <SimulatedTrnBadge language={language} /> : null} · {batch.client} · {record.position ? d.paperOf(record.position, batch.workOrderCount) : ""}</p>
              <p className="mt-1 flex flex-wrap items-center gap-1 text-sm" data-testid="detail-paper-order">
                {batch.workOrders.map((row) => (
                  <button key={row.jobId} type="button" onClick={() => onSelect({ type: "work_order", id: row.jobId })}
                    className={`rounded-md px-2 py-0.5 font-bold tabular-nums ${row.jobId === record.jobId ? "bg-violet-800 text-white" : "bg-slate-100 text-slate-800 hover:bg-violet-100"}`}>{row.position}. {row.workOrder}</button>
                ))}
              </p>
            </>
          )}
        </Section>
        <Section title={d.documents}>
          {batch ? (
            <div className="flex flex-wrap gap-2">
              <Link className="ees-fc-btn-primary !py-1.5" href={docsHref(batch)}>{d.openDocuments}</Link>
              <Link className="ees-fc-btn-secondary !py-1.5" href={invoiceHref(batch)} data-testid="open-invoice">{language === "th" ? "เปิดใบแจ้งหนี้" : "Open invoice"}</Link>
              <button type="button" className="ees-fc-btn-secondary !py-1.5" onClick={() => onSelect({ type: "batch", id: batch.sheetId })}>{d.openBatch}</button>
            </div>
          ) : (
            <Link className="ees-fc-btn-secondary !py-1.5" href={`/finance-centre?section=reconciliation&booking=${encodeURIComponent(job.id)}`}>{d.openIntake}</Link>
          )}
        </Section>
        <FinanceActivityHistory entries={workOrderActivity(state, record)} canView={canViewActivity} language={language} />
      </>
    );
  })();

  return (
    <div className="fixed inset-0 z-[1200]" role="dialog" aria-modal="true" aria-label={selection.type === "batch" ? d.batch : d.workOrder} data-testid="record-detail">
      <button type="button" tabIndex={-1} aria-label={d.close} className="absolute inset-0 bg-slate-900/35" onClick={onClose} />
      <aside className="ees-fc absolute inset-y-0 right-0 flex w-[min(38rem,100vw)] flex-col bg-white shadow-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div className="min-w-0">
            <p className="text-xs font-bold text-slate-500">{selection.type === "batch" ? d.batch : d.workOrder}</p>
            <h2 className="text-2xl font-black leading-tight tabular-nums text-slate-950">{title}</h2>
            {status ? <div className="mt-1"><FinanceStatusChip status={status} language={language} /></div> : null}
          </div>
          <button ref={closeRef} type="button" className="ees-fc-icon-btn" onClick={onClose} aria-label={d.close}>×</button>
        </header>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">{body}</div>
      </aside>
    </div>
  );
}
