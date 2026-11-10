"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchBookingDiaryEntries } from "@/lib/data";
import { isFinanceLocalPreview } from "@/lib/finance-local-preview";
import { supabase } from "@/lib/supabase";
import { useLanguage } from "@/lib/language-provider";
import type { BookingDiaryEntry } from "@/types/database";
import { financeRpc } from "@/lib/finance-cost-pricing";
import { invoiceApprovalCopy } from "@/lib/finance-invoice-approval-copy";
import { formatThb } from "@/lib/finance-format";
import {
  canDecideSubmission,
  canSubmitDraft,
  latestActiveSubmission,
  loadInvoiceApprovals,
  type InvoiceDecision,
  type InvoiceSubmission
} from "@/lib/finance-invoice-approval";
import { loadWeeklyDrafts, thailandWeekEnd, thailandWeekStart } from "@/lib/finance-weekly-billing";
import FinanceCentreWorkspace from "@/components/finance-centre-workspace";
import { usesFinanceLocalDemoScreens } from "@/lib/finance-fixture-mode";

type DraftData = Awaited<ReturnType<typeof loadWeeklyDrafts>>;
type ApprovalData = Awaited<ReturnType<typeof loadInvoiceApprovals>>;
const emptyDrafts: DraftData = { batches: [], drafts: [], revisions: [], lines: [], events: [] };
const emptyApprovals: ApprovalData = { submissions: [], decisions: [], events: [] };
const input = "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm";

function LiveInvoiceApprovalPage() {
  const { language } = useLanguage();
  const c = invoiceApprovalCopy[language];
  const [bookings, setBookings] = useState<BookingDiaryEntry[]>([]);
  const [customer, setCustomer] = useState("");
  const [week, setWeek] = useState(() => thailandWeekStart());
  const [drafts, setDrafts] = useState<DraftData>(emptyDrafts);
  const [approvals, setApprovals] = useState<ApprovalData>(emptyApprovals);
  const [canFinance, setCanFinance] = useState(false);
  const [canApprove, setCanApprove] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [withdrawReason, setWithdrawReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const activeDraft = drafts.drafts.find((row) => row.status === "draft") || null;
  const activeRevision = drafts.revisions.find((row) => row.id === activeDraft?.current_revision_id) || null;
  const activeLines = drafts.lines
    .filter((row) => row.revision_id === activeDraft?.current_revision_id)
    .sort((a, b) => a.position - b.position);
  const submission = latestActiveSubmission(approvals.submissions);
  const decision = approvals.decisions.find((row) => row.submission_id === submission?.id) || null;
  const snapshot = submission?.review_snapshot;
  const customers = useMemo(
    () => [...new Map(bookings.filter((row) => row.client_id).map((row) => [row.client_id!, { id: row.client_id!, name: row.client?.name || row.client_id! }])).values()]
      .sort((a, b) => a.name.localeCompare(b.name)),
    [bookings]
  );

  const refresh = useCallback(async (clientId: string, monday: string) => {
    const loaded = await loadWeeklyDrafts(supabase, clientId, monday);
    const draft = loaded.drafts.find((row) => row.status === "draft") || null;
    const approvalData = draft ? await loadInvoiceApprovals(supabase, draft.id) : emptyApprovals;
    setDrafts(loaded);
    setApprovals(approvalData);
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [rows, user] = await Promise.all([fetchBookingDiaryEntries(), supabase.auth.getUser()]);
        if (!active) return;
        setBookings(rows);
        const initial = rows.find((row) => row.client_id);
        if (initial?.client_id) {
          setCustomer(initial.client_id);
          setWeek(thailandWeekStart(initial.booking_date));
        }
        if (user.data.user) {
          setUserId(user.data.user.id);
          const grants = await supabase.from("finance_role_grants").select("capability").eq("user_id", user.data.user.id);
          if (!active) return;
          const caps = new Set((grants.data || []).map((row) => row.capability));
          setCanFinance(caps.has("finance_reviewer"));
          setCanApprove(caps.has("invoice_approver"));
        }
      } catch {
        if (active && !isFinanceLocalPreview()) setError(c.saveError);
      }
    })();
    return () => { active = false; };
  }, [c.saveError]);

  useEffect(() => {
    if (!customer) return;
    let active = true;
    setDrafts(emptyDrafts);
    setApprovals(emptyApprovals);
    void (async () => {
      try {
        await refresh(customer, week);
        if (active) setError("");
      } catch {
        if (active && !isFinanceLocalPreview()) setError(c.saveError);
      }
    })();
    return () => { active = false; };
  }, [customer, week, refresh, c.saveError]);

  const submitReady = canSubmitDraft({
    canFinance,
    draftStatus: activeDraft?.status || null,
    validationStatus: activeDraft?.validation_status || null,
    revisionNumber: activeDraft?.revision_number || null,
    activeSubmission: submission
  });
  const decideReady = canDecideSubmission({ canApprove, userId, submission });

  async function submitDraft() {
    if (!activeDraft || !submitReady || busy) return;
    setBusy(true); setError("");
    try {
      await financeRpc<InvoiceSubmission>(supabase, "finance_submit_invoice_draft", {
        p_draft_id: activeDraft.id,
        p_expected_revision: activeDraft.revision_number
      });
      await refresh(customer, week);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "";
      setError(/CONFLICT|STALE|PENDING|APPROVED|40001|23505|23514/.test(message) ? c.conflict : c.saveError);
    } finally {
      setBusy(false);
    }
  }

  async function withdraw() {
    if (!submission || submission.status !== "pending" || !canFinance || withdrawReason.trim().length < 10 || busy) return;
    setBusy(true); setError("");
    try {
      await financeRpc(supabase, "finance_withdraw_invoice_submission", {
        p_submission_id: submission.id,
        p_reason: withdrawReason
      });
      setWithdrawReason("");
      await refresh(customer, week);
    } catch {
      setError(c.saveError);
    } finally {
      setBusy(false);
    }
  }

  async function decide(approve: boolean) {
    if (!submission || !decideReady || reason.trim().length < 10 || busy) return;
    setBusy(true); setError("");
    try {
      await financeRpc<InvoiceDecision>(supabase, "finance_decide_invoice_submission", {
        p_submission_id: submission.id,
        p_approve: approve,
        p_reason: reason
      });
      setReason("");
      await refresh(customer, week);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "";
      setError(/APPROVER_MUST_DIFFER/.test(message) ? c.samePerson : /CONFLICT|CURRENT|PENDING|40001|23514/.test(message) ? c.conflict : c.saveError);
    } finally {
      setBusy(false);
    }
  }

  const statusLabel = (status: InvoiceSubmission["status"]) =>
    status === "pending" ? c.pending
      : status === "approved" ? c.approved
        : status === "rejected" ? c.rejected
          : status === "invalidated" ? c.invalidated
            : c.withdrawn;

  return <main className="finance-centre-workspace w-full max-w-none space-y-5 text-slate-900">
    <header className="rounded-2xl bg-violet-900 p-6 text-white">
      <p className="text-xs font-bold tracking-[.2em]">EES · FINANCE</p>
      <h1 className="mt-2 text-2xl font-bold">{c.title}</h1>
      <p className="mt-1 text-sm text-violet-100">{c.subtitle}</p>
    </header>
    <nav className="flex flex-wrap gap-2">
      <Link className="btn-secondary" href="/booking-diary">{c.diary}</Link>
      <Link className="btn-secondary" href="/finance-centre">{c.finance}</Link>
      <Link className="btn-secondary" href="/weekly-billing">{c.billing}</Link>
      <Link className="btn-secondary" href="/document-packs">{c.packs}</Link>
    </nav>
    <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900">{c.demoWarning}</p>
    {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
    <section className="surface-card grid gap-4 p-5 sm:grid-cols-2">
      <label className="text-sm font-medium">{c.customer}
        <select className={input} value={customer} onChange={(event) => setCustomer(event.target.value)}>
          <option value="">{c.noCustomer}</option>
          {customers.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
        </select>
      </label>
      <label className="text-sm font-medium">{c.week}
        <input className={input} type="date" value={week} onChange={(event) => {
          try { setWeek(thailandWeekStart(event.target.value)); } catch { setError(c.saveError); }
        }} />
      </label>
      <p className="text-sm text-slate-600 sm:col-span-2">{c.period}: {week} – {thailandWeekEnd(week)}</p>
    </section>

    <div className="grid gap-5 lg:grid-cols-[1.05fr_.95fr]">
      <section className="surface-card space-y-3 p-5">
        <h2 className="text-lg font-bold">{c.draft}</h2>
        {!activeDraft && <p className="text-sm text-slate-500">{c.noDraft}</p>}
        {activeDraft && <>
          <div className="rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm">
            <strong>{activeDraft.draft_identifier}</strong>
            <p>{c.noNumber} · {c.revision} {activeDraft.revision_number} · {activeDraft.validation_status === "stale" ? c.stale : c.current}</p>
            <p className="mt-1 font-semibold">{c.total}: <span className="text-2xl tabular-nums">{formatThb(Number(activeRevision?.total_thb || 0))}</span></p>
          </div>
          {activeLines.map((line) => (
            <div key={line.id} className="border-b py-2 text-sm">
              <div className="flex justify-between gap-3">
                <span>{line.position}. {line.work_order_number} · {String(line.booking_snapshot.pickup || "")} → {String(line.booking_snapshot.dropoff || "")}</span>
                <strong>{formatThb(Number(line.amount_thb))}</strong>
              </div>
            </div>
          ))}
          <button className="btn-primary" disabled={!submitReady || busy} onClick={() => void submitDraft()}>{c.submit}</button>
          {!canFinance && <p className="text-sm text-amber-800">{c.roleFinance}</p>}
          {submission?.status === "pending" && <div className="space-y-2 border-t pt-3">
            <label className="text-sm">{c.withdrawReason}<input className={input} value={withdrawReason} onChange={(event) => setWithdrawReason(event.target.value)} /></label>
            <button className="btn-secondary" disabled={!canFinance || busy || withdrawReason.trim().length < 10} onClick={() => void withdraw()}>{c.withdraw}</button>
          </div>}
        </>}
      </section>

      <div className="space-y-5">
        <section className="surface-card space-y-3 p-5">
          <h2 className="text-lg font-bold">{c.review}</h2>
          {!submission && <p className="text-sm text-slate-500">{c.noSubmission}</p>}
          {submission && <>
            <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm font-semibold">{statusLabel(submission.status)} · #{submission.submission_number}</p>
            {snapshot && <>
              <p className="text-sm">{snapshot.client_name} · {snapshot.week_start} – {snapshot.week_end}</p>
              <p className="text-xs text-slate-600">{c.layoutNote}</p>
              {snapshot.lines.map((line) => (
                <article key={`${line.booking_id}-${line.position}`} className="rounded-lg border border-slate-200 p-3 text-sm">
                  <div className="flex justify-between gap-2">
                    <strong>{line.position}. {line.work_order_number}</strong>
                    <span>{formatThb(Number(line.amount_thb))}</span>
                  </div>
                  <p>{c.route}: {String(line.booking_snapshot.pickup || "")} → {String(line.booking_snapshot.dropoff || "")}</p>
                  <p>{c.driver}: {String(line.booking_snapshot.driver || "—")} · {c.vehicle}: {String(line.booking_snapshot.vehicle_registration || line.booking_snapshot.vehicle || "—")}</p>
                  <p>{c.sellingPrice}: {formatThb(Number(line.pricing_snapshot.selling_price_thb || line.amount_thb))}</p>
                  <p className="mt-1 text-xs font-semibold">{c.paperwork}</p>
                  {(line.paperwork_refs || []).length === 0 && <p className="text-xs text-amber-800">{c.missingPaper}</p>}
                  {(line.paperwork_refs || []).map((doc) => (
                    <p key={doc.document_id} className="text-xs">{doc.kind} · {doc.original_filename} · {doc.physical_location || c.missingPaper}</p>
                  ))}
                </article>
              ))}
              {snapshot.missing_green_paper && <p className="text-sm font-semibold text-amber-800">{c.missingPaper}</p>}
              <p className="text-xl font-bold">{c.total}: <span className="text-2xl tabular-nums">{formatThb(Number(snapshot.total_thb))}</span></p>
            </>}
            {decision && <p className="text-sm text-slate-700">{decision.decision === "approved" ? c.decidedApproved : c.decidedRejected}: {decision.reason}</p>}
            {submission.status === "pending" && <div className="space-y-2 border-t pt-3">
              <label className="text-sm">{c.decisionReason}<input className={input} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
              <div className="flex flex-wrap gap-2">
                <button className="btn-primary" disabled={!decideReady || busy || reason.trim().length < 10} onClick={() => void decide(true)}>{c.approve}</button>
                <button className="btn-secondary" disabled={!decideReady || busy || reason.trim().length < 10} onClick={() => void decide(false)}>{c.reject}</button>
              </div>
              {!canApprove && <p className="text-sm text-amber-800">{c.roleApprover}</p>}
              {canApprove && submission.submitted_by === userId && <p className="text-sm text-amber-800">{c.samePerson}</p>}
            </div>}
          </>}
        </section>
        <section className="surface-card p-5">
          <h2 className="text-lg font-bold">{c.history}</h2>
          {approvals.events.map((event) => (
            <p key={event.id} className="border-b py-2 text-xs">
              {event.occurred_at} · {
                event.event_type === "submitted" ? c.submitted
                  : event.event_type === "approved" ? c.decidedApproved
                    : event.event_type === "rejected" ? c.decidedRejected
                      : event.event_type === "invalidated" ? c.eventInvalidated
                        : event.event_type === "withdrawn" ? c.eventWithdrawn
                          : event.event_type === "pack_prepared" ? c.eventPack
                            : c.eventPackSuperseded
              } · {event.actor_id || c.system}
            </p>
          ))}
        </section>
      </div>
    </div>
  </main>;
}

export default function InvoiceApprovalPage() {
  if (usesFinanceLocalDemoScreens()) return <FinanceCentreWorkspace initialSection="trn" />;
  return <LiveInvoiceApprovalPage />;
}
