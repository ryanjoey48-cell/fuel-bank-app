"use client";

import { EES_COMPANY } from "@/lib/ees-company";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchBookingDiaryEntries } from "@/lib/data";
import { supabase } from "@/lib/supabase";
import { useLanguage } from "@/lib/language-provider";
import type { BookingDiaryEntry } from "@/types/database";
import { financeRpc } from "@/lib/finance-cost-pricing";
import { documentPackCopy } from "@/lib/finance-document-packs-copy";
import {
  buildPackManifest,
  canPreparePack,
  coverLayoutHeadings,
  invoiceLayoutHeadings,
  loadDocumentPacks,
  packDispatchBlocked,
  type DocumentPack
} from "@/lib/finance-document-packs";
import { latestActiveSubmission, loadInvoiceApprovals, type InvoiceSubmission } from "@/lib/finance-invoice-approval";
import { loadWeeklyDrafts, thailandWeekEnd, thailandWeekStart } from "@/lib/finance-weekly-billing";
import FinanceCentreWorkspace from "@/components/finance-centre-workspace";
import { usesFinanceLocalDemoScreens } from "@/lib/finance-fixture-mode";

type DraftData = Awaited<ReturnType<typeof loadWeeklyDrafts>>;
type PackData = Awaited<ReturnType<typeof loadDocumentPacks>>;
const emptyDrafts: DraftData = { batches: [], drafts: [], revisions: [], lines: [], events: [] };
const emptyPacks: PackData = { packs: [], lines: [], checklists: [] };
const input = "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm";
const money = (value: number) => `?${Number(value).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

function LiveDocumentPacksPage() {
  const { language } = useLanguage();
  const c = documentPackCopy[language];
  const [bookings, setBookings] = useState<BookingDiaryEntry[]>([]);
  const [customer, setCustomer] = useState("");
  const [week, setWeek] = useState(() => thailandWeekStart());
  const [drafts, setDrafts] = useState<DraftData>(emptyDrafts);
  const [approvedSubmission, setApprovedSubmission] = useState<InvoiceSubmission | null>(null);
  const [packs, setPacks] = useState<PackData>(emptyPacks);
  const [canFinance, setCanFinance] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const activeDraft = drafts.drafts.find((row) => row.status === "draft") || null;
  const activePack = packs.packs.find((row) => row.status === "prepared" || row.status === "held") || packs.packs[0] || null;
  const activeLines = packs.lines.filter((row) => row.pack_id === activePack?.id).sort((a, b) => a.position - b.position);
  const greenChecklist = packs.checklists.find((row) => row.pack_id === activePack?.id && row.checklist_type === "green_paper_retrieval");
  const dispatchChecklist = packs.checklists.find((row) => row.pack_id === activePack?.id && row.checklist_type === "customer_dispatch");
  const snapshot = activePack?.pack_snapshot;
  const customers = useMemo(
    () => [...new Map(bookings.filter((row) => row.client_id).map((row) => [row.client_id!, { id: row.client_id!, name: row.client?.name || row.client_id! }])).values()]
      .sort((a, b) => a.name.localeCompare(b.name)),
    [bookings]
  );

  const refresh = useCallback(async (clientId: string, monday: string) => {
    const loaded = await loadWeeklyDrafts(supabase, clientId, monday);
    const draft = loaded.drafts.find((row) => row.status === "draft") || null;
    if (!draft) {
      setDrafts(loaded);
      setApprovedSubmission(null);
      setPacks(emptyPacks);
      return;
    }
    const [approvals, packData] = await Promise.all([
      loadInvoiceApprovals(supabase, draft.id),
      loadDocumentPacks(supabase, draft.id)
    ]);
    const submission = latestActiveSubmission(approvals.submissions);
    setDrafts(loaded);
    setApprovedSubmission(submission?.status === "approved" ? submission : null);
    setPacks(packData);
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
          const grant = await supabase.from("finance_role_grants").select("capability").eq("user_id", user.data.user.id).eq("capability", "finance_reviewer").maybeSingle();
          if (active) setCanFinance(!grant.error && !!grant.data);
        }
      } catch {
        if (active) setError(c.saveError);
      }
    })();
    return () => { active = false; };
  }, [c.saveError]);

  useEffect(() => {
    if (!customer) return;
    let active = true;
    setDrafts(emptyDrafts);
    setPacks(emptyPacks);
    void (async () => {
      try {
        await refresh(customer, week);
        if (active) setError("");
      } catch {
        if (active) setError(c.saveError);
      }
    })();
    return () => { active = false; };
  }, [customer, week, refresh, c.saveError]);

  async function preparePack() {
    if (!approvedSubmission || !canPreparePack({ canFinance, submission: approvedSubmission }) || busy) return;
    setBusy(true); setError("");
    try {
      await financeRpc<DocumentPack>(supabase, "finance_prepare_document_pack", { p_submission_id: approvedSubmission.id });
      await refresh(customer, week);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "";
      setError(/CURRENT|APPROVED|23514|40001/.test(message) ? c.conflict : c.saveError);
    } finally {
      setBusy(false);
    }
  }

  const statusLabel = (status: DocumentPack["status"]) =>
    status === "prepared" ? c.prepared : status === "held" ? c.held : c.superseded;
  const manifest = snapshot ? buildPackManifest(snapshot) : [];

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
      <Link className="btn-secondary" href="/invoice-approval">{c.approval}</Link>
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
      <p className="text-sm text-slate-600 sm:col-span-2">{c.period}: {week} ? {thailandWeekEnd(week)}</p>
    </section>

    <section className="surface-card space-y-3 p-5">
      {!activeDraft && <p className="text-sm text-slate-500">{c.noDraft}</p>}
      {activeDraft && <>
        <p className="text-sm"><strong>{activeDraft.draft_identifier}</strong> · {c.noNumber}</p>
        <p className="text-sm">{approvedSubmission ? c.prepared : c.needApproval}</p>
        <button className="btn-primary" disabled={!canFinance || !approvedSubmission || busy} onClick={() => void preparePack()}>{c.prepare}</button>
        {!canFinance && <p className="text-sm text-amber-800">{c.roleFinance}</p>}
        {canFinance && !approvedSubmission && <p className="text-sm text-amber-800">{c.needApproval}</p>}
      </>}
    </section>

    {!activePack && <p className="text-sm text-slate-500">{c.noPack}</p>}
    {activePack && snapshot && <>
      <section className="surface-card space-y-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold">{c.pack} #{activePack.pack_number}</h2>
          <span className="text-sm font-semibold">{statusLabel(activePack.status)}</span>
        </div>
        {activePack.hold_reasons.includes("missing_paperwork") && <p className="text-sm font-semibold text-amber-800">{c.holdMissing}</p>}
        {packDispatchBlocked(activePack) && <p className="text-sm font-semibold text-rose-800">{c.neverSend}</p>}
        <p className="border-4 border-violet-800 p-3 text-center text-sm font-black text-violet-900">{c.watermark}</p>
      </section>

      <section className="surface-card space-y-4 p-5">
        <div className="flex flex-wrap justify-between gap-4 border-b-2 border-violet-700 pb-4">
          <div>
            <h2 className="text-lg font-bold">{EES_COMPANY.nameTh}</h2>
            <p className="font-semibold">{EES_COMPANY.nameEn}</p>
            <p className="mt-1 text-xs">{EES_COMPANY.addressEn.toUpperCase()}</p>
            <p className="text-xs">เลขประจำตัวผู้เสียภาษีอากร / Tax ID {EES_COMPANY.taxId}{EES_COMPANY.phone ? ` · โทร / Tel ${EES_COMPANY.phone}` : ""}</p>
          </div>
          <div className="text-right">
            <p className="rounded bg-violet-200 px-3 py-2 text-lg font-bold">{c.invoiceHeading}</p>
            <p className="mt-2 font-bold">{c.noNumber}</p>
            <p className="text-xs">{snapshot.draft_identifier}</p>
          </div>
        </div>
        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <p><span className="block text-xs text-slate-500">{c.customer}</span><strong>{snapshot.client_name}</strong></p>
          <p><span className="block text-xs text-slate-500">{c.period}</span><strong>{snapshot.week_start} ? {snapshot.week_end}</strong></p>
        </div>
        <p className="text-xs font-semibold text-violet-800">{c.layoutNote}</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] table-fixed border-collapse text-[11px]">
            <thead>
              <tr className="border-y-2 border-black bg-violet-100 text-left">
                <th className="p-1">#</th>
                <th className="p-1">{invoiceLayoutHeadings[0]}</th>
                <th className="p-1">{invoiceLayoutHeadings[1]}</th>
                <th className="p-1">{invoiceLayoutHeadings[2]}</th>
                <th className="p-1">{invoiceLayoutHeadings[3]}</th>
                <th className="p-1">{invoiceLayoutHeadings[4]}</th>
                <th className="p-1">{invoiceLayoutHeadings[5]}</th>
                <th className="p-1">{invoiceLayoutHeadings[6]}</th>
                <th className="p-1 text-right">{invoiceLayoutHeadings[7]}</th>
              </tr>
            </thead>
            <tbody>
              {activeLines.map((line) => (
                <tr key={line.id} className="border-b border-slate-300 align-top">
                  <td className="p-1">{line.position}</td>
                  <td className="p-1">{String(line.booking_snapshot.booking_date || "")}</td>
                  <td className="break-words p-1">{String(line.booking_snapshot.pickup || "")}</td>
                  <td className="break-words p-1">{String(line.booking_snapshot.dropoff || "")}</td>
                  <td className="p-1">{line.work_order_number}</td>
                  <td className="p-1"></td>
                  <td className="p-1"></td>
                  <td className="p-1"></td>
                  <td className="p-1 text-right font-semibold">{money(line.amount_thb)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-right text-lg font-bold">{c.total}: {money(Number(snapshot.total_thb))}</p>
        <p className="text-xs text-rose-800">{c.blankSettlement} · {c.neverSend}</p>
      </section>

      <section className="surface-card space-y-4 p-5">
        <h2 className="text-lg font-bold">{c.coverHeading}</h2>
        <p className="text-sm">{c.customer}: <strong>{snapshot.client_name}</strong> · {c.period}: {snapshot.week_start} ? {snapshot.week_end}</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-[11px]">
            <thead>
              <tr className="border-y-2 border-black bg-violet-100 text-left">
                {coverLayoutHeadings.map((heading) => <th key={heading} className="p-1">{heading}</th>)}
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-slate-300">
                <td className="p-1">1</td>
                <td className="p-1">{snapshot.draft_identifier} · {c.noNumber}</td>
                <td className="p-1">{snapshot.week_start}</td>
                <td className="p-1"></td>
                <td className="p-1"></td>
                <td className="p-1"></td>
                <td className="p-1"></td>
                <td className="p-1"></td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-sm font-semibold">{c.amount}: {money(Number(snapshot.total_thb))}</p>
        <p className="text-xs font-semibold text-rose-800">{c.layoutNote} · {c.neverSend}</p>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="surface-card space-y-2 p-5">
          <h2 className="text-lg font-bold">{c.breakdown}</h2>
          {activeLines.map((line) => (
            <div key={line.id} className="border-b py-2 text-sm">
              <div className="flex justify-between gap-2">
                <span>{line.position}. {line.work_order_number}</span>
                <strong>{money(line.amount_thb)}</strong>
              </div>
              <p className="text-xs text-slate-600">{String(line.pricing_snapshot.source || "")} · {money(Number(line.pricing_snapshot.selling_price_thb || line.amount_thb))}</p>
            </div>
          ))}
          <h3 className="pt-2 font-bold">{c.supporting}</h3>
          {activeLines.flatMap((line) => (line.paperwork_refs || []).map((doc) => (
            <p key={`${line.id}-${doc.document_id}`} className="text-xs">{line.work_order_number} · {doc.kind} · {doc.original_filename} · {doc.physical_location || ""}</p>
          )))}
        </section>
        <section className="surface-card space-y-2 p-5">
          <h2 className="text-lg font-bold">{c.manifest}</h2>
          <ol className="space-y-1 text-xs">{manifest.map((item) => <li key={item.key}>{item.label}</li>)}</ol>
          <h3 className="pt-3 font-bold">{c.greenChecklist}</h3>
          {(greenChecklist?.items || []).map((item, index) => (
            <p key={index} className="text-xs">? {String(item.label || "")}</p>
          ))}
          <h3 className="pt-3 font-bold">{c.dispatchChecklist}</h3>
          {(dispatchChecklist?.items || []).map((item, index) => (
            <p key={index} className="text-xs">? {String(item.label || "")}</p>
          ))}
        </section>
      </div>

      <section className="surface-card p-5">
        <h2 className="text-lg font-bold">{c.history}</h2>
        {packs.packs.map((pack) => (
          <p key={pack.id} className="border-b py-2 text-xs">
            {pack.created_at} · #{pack.pack_number} · {statusLabel(pack.status)} · {pack.hold_reasons.join(", ") || ""}
          </p>
        ))}
      </section>
    </>}
  </main>;
}

export default function DocumentPacksPage() {
  if (usesFinanceLocalDemoScreens()) return <FinanceCentreWorkspace initialSection="trn" />;
  return <LiveDocumentPacksPage />;
}
