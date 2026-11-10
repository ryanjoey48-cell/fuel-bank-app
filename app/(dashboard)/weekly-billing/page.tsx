"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchBookingDiaryEntries } from "@/lib/data";
import { supabase } from "@/lib/supabase";
import { useLanguage } from "@/lib/language-provider";
import type { BookingDiaryEntry } from "@/types/database";
import { financeRpc } from "@/lib/finance-cost-pricing";
import { weeklyBillingCopy } from "@/lib/finance-weekly-billing-copy";
import { formatThb } from "@/lib/finance-format";
import { customerWeekBookings, draftTotalCents, loadBillingCandidates, loadWeeklyDrafts, thailandWeekEnd, thailandWeekStart, type BillingCandidate, type DraftTrn } from "@/lib/finance-weekly-billing";
import FinanceCentreWorkspace from "@/components/finance-centre-workspace";
import { usesFinanceLocalDemoScreens } from "@/lib/finance-fixture-mode";

type DraftData = Awaited<ReturnType<typeof loadWeeklyDrafts>>;
const emptyDrafts: DraftData = { batches: [], drafts: [], revisions: [], lines: [], events: [] };
const input = "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm";

function LiveWeeklyBillingPage() {
  const { language } = useLanguage();
  const c = weeklyBillingCopy[language];
  const [bookings, setBookings] = useState<BookingDiaryEntry[]>([]);
  const [customer, setCustomer] = useState("");
  const [week, setWeek] = useState(() => thailandWeekStart());
  const [candidates, setCandidates] = useState<BillingCandidate[]>([]);
  const [drafts, setDrafts] = useState<DraftData>(emptyDrafts);
  const [orderedIds, setOrderedIds] = useState<string[]>([]);
  const [canFinance, setCanFinance] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const activeDraft = drafts.drafts.find((row) => row.status === "draft") || null;
  const activeRevision = drafts.revisions.find((row) => row.id === activeDraft?.current_revision_id) || null;
  const activeLines = drafts.lines.filter((row) => row.revision_id === activeDraft?.current_revision_id).sort((a, b) => a.position - b.position);
  const byId = useMemo(() => new Map(candidates.map((row) => [row.booking.id, row])), [candidates]);
  const customers = useMemo(() => [...new Map(bookings.filter((row) => row.client_id).map((row) => [row.client_id!, { id: row.client_id!, name: row.client?.name || row.client_id! }])).values()].sort((a, b) => a.name.localeCompare(b.name)), [bookings]);
  const jobs = useMemo(() => customer ? customerWeekBookings(bookings, customer, week) : [], [bookings, customer, week]);
  let totalCents = 0;
  let selectionValid = false;
  try { totalCents = draftTotalCents(candidates, orderedIds); selectionValid = true; } catch { /* A held job is shown but cannot be saved. */ }
  const unchanged = !!activeDraft && activeDraft.validation_status === "current" && orderedIds.length === activeLines.length
    && orderedIds.every((id, index) => id === activeLines[index].booking_id);

  const refresh = useCallback(async (clientId: string, monday: string, rows: BookingDiaryEntry[]) => {
    const loaded = await loadWeeklyDrafts(supabase, clientId, monday);
    const active = loaded.drafts.find((row) => row.status === "draft") || null;
    const filtered = customerWeekBookings(rows, clientId, monday);
    const candidateRows = await loadBillingCandidates(supabase, filtered, active?.id || null);
    setDrafts(loaded);
    setCandidates(candidateRows);
    setOrderedIds(active ? loaded.lines.filter((row) => row.revision_id === active.current_revision_id).sort((a, b) => a.position - b.position).map((row) => row.booking_id) : []);
  }, []);
  useEffect(() => { let active = true; void (async () => {
    try {
      const [rows, user] = await Promise.all([fetchBookingDiaryEntries(), supabase.auth.getUser()]);
      if (!active) return;
      setBookings(rows);
      const initial = rows.find((row) => row.client_id);
      if (initial?.client_id) { setCustomer(initial.client_id); setWeek(thailandWeekStart(initial.booking_date)); }
      if (user.data.user) {
        const grant = await supabase.from("finance_role_grants").select("capability").eq("user_id", user.data.user.id).eq("capability", "finance_reviewer").maybeSingle();
        if (active) setCanFinance(!grant.error && !!grant.data);
      }
    } catch { if (active) setError(c.saveError); }
  })(); return () => { active = false; }; }, [c.saveError]);
  useEffect(() => { if (!customer) return; let active = true; setCandidates([]); setDrafts(emptyDrafts); setOrderedIds([]);
    void (async () => { try { const loaded = await loadWeeklyDrafts(supabase, customer, week); const current = loaded.drafts.find((row) => row.status === "draft") || null;
      const candidateRows = await loadBillingCandidates(supabase, customerWeekBookings(bookings, customer, week), current?.id || null);
      if (active) { setDrafts(loaded); setCandidates(candidateRows); setOrderedIds(current ? loaded.lines.filter((row) => row.revision_id === current.current_revision_id).sort((a, b) => a.position - b.position).map((row) => row.booking_id) : []); setError(""); }
    } catch { if (active) setError(c.saveError); } })(); return () => { active = false; }; }, [bookings, customer, week, c.saveError]);

  const move = (id: string, direction: -1 | 1) => setOrderedIds((ids) => { const next = [...ids]; const index = next.indexOf(id); const target = index + direction; if (index < 0 || target < 0 || target >= next.length) return ids; [next[index], next[target]] = [next[target], next[index]]; return next; });
  async function saveDraft() {
    if (!customer || !canFinance || !selectionValid || busy) return;
    setBusy(true); setError("");
    try {
      if (activeDraft) await financeRpc(supabase, "finance_amend_weekly_draft", { p_draft_id: activeDraft.id, p_booking_ids: orderedIds, p_expected_revision: activeDraft.revision_number });
      else await financeRpc<DraftTrn>(supabase, "finance_create_weekly_draft", { p_client_id: customer, p_week_start: week, p_booking_ids: orderedIds });
      await refresh(customer, week, bookings);
    } catch (cause) { const message = cause instanceof Error ? cause.message : ""; setError(/DRAFT_UNCHANGED/.test(message) ? c.unchanged : /CONFLICT|ALLOCATED|duplicate|23505|40001/.test(message) ? c.conflict : /TOTAL|SELECTION/.test(message) ? c.invalidTotal : c.saveError); }
    finally { setBusy(false); }
  }
  async function cancelDraft() {
    if (!activeDraft || !canFinance || cancelReason.trim().length < 10 || busy) return;
    setBusy(true); setError("");
    try { await financeRpc(supabase, "finance_cancel_weekly_draft", { p_draft_id: activeDraft.id, p_expected_revision: activeDraft.revision_number, p_reason: cancelReason }); setCancelReason(""); await refresh(customer, week, bookings); }
    catch { setError(c.saveError); } finally { setBusy(false); }
  }
  return <main className="finance-centre-workspace w-full max-w-none space-y-5 text-slate-900">
    <header className="rounded-2xl bg-violet-900 p-6 text-white"><p className="text-xs font-bold tracking-[.2em]">EES · FINANCE</p><h1 className="mt-2 text-2xl font-bold">{c.title}</h1><p className="mt-1 text-sm text-violet-100">{c.subtitle}</p></header>
    <nav className="flex flex-wrap gap-2"><Link className="btn-secondary" href="/booking-diary">{c.diary}</Link><Link className="btn-secondary" href="/finance-centre">{c.finance}</Link><Link className="btn-secondary" href="/finance-cost-pricing">{c.pricing}</Link><Link className="btn-secondary" href="/invoice-approval">{language === "th" ? "อนุมัติใบแจ้งหนี้" : "Invoice Approval"}</Link><Link className="btn-secondary" href="/document-packs">{language === "th" ? "ชุดเอกสาร" : "Document Packs"}</Link></nav>
    <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900">{c.demoWarning}</p>
    {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
    <section className="surface-card grid gap-4 p-5 sm:grid-cols-2"><label className="text-sm font-medium">{c.customer}<select className={input} value={customer} onChange={(event) => setCustomer(event.target.value)}><option value="">{c.noCustomer}</option>{customers.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label><label className="text-sm font-medium">{c.week}<input className={input} type="date" value={week} onChange={(event) => { try { setWeek(thailandWeekStart(event.target.value)); } catch { setError(c.invalidWeek); } }} /></label><p className="text-sm text-slate-600 sm:col-span-2">{c.period}: {week} – {thailandWeekEnd(week)} · {c.internalExcluded}</p></section>
    <div className="grid gap-5 lg:grid-cols-[1.15fr_.85fr]"><section className="surface-card p-5"><h2 className="text-lg font-bold">{c.eligible}</h2>{!jobs.length && <p className="mt-3 text-sm text-slate-500">{c.noJobs}</p>}<div className="mt-3 space-y-3">{candidates.map((row) => { const booking = row.booking; const chosen = orderedIds.includes(booking.id); return <article key={booking.id} className={`rounded-xl border p-4 text-sm ${row.ready ? "border-violet-200 bg-violet-50/40" : "border-amber-200 bg-amber-50/50"}`}><div className="flex flex-wrap items-start justify-between gap-2"><strong>{booking.job_order_number || booking.booking_id || booking.id.slice(0, 8)}</strong><span className="font-semibold">{row.ready && row.selling_price_thb != null ? formatThb(Number(row.selling_price_thb)) : row.hold ? c.holds[row.hold] : c.noJobs}</span></div><p className="mt-1">{booking.booking_date} · {booking.client?.name || "—"}</p><p>{booking.pickup} → {booking.dropoff}</p><p className="text-slate-600">{c.driver}: {booking.driver || "—"} · {c.vehicle}: {booking.vehicle_registration || booking.vehicle || "—"}</p><div className="mt-2 flex flex-wrap gap-3"><button className="text-sm font-semibold text-violet-800 underline disabled:text-slate-400" disabled={!row.ready || chosen || !canFinance} onClick={() => setOrderedIds((ids) => [...ids, booking.id])}>{c.select}</button><Link className="text-sm text-violet-800 underline" href={`/paperwork-inbox?booking=${encodeURIComponent(booking.id)}`}>{c.paperwork}</Link><Link className="text-sm text-violet-800 underline" href={`/job-verification?booking=${encodeURIComponent(booking.id)}`}>{c.verification}</Link><Link className="text-sm text-violet-800 underline" href={`/finance-cost-pricing?booking=${encodeURIComponent(booking.id)}`}>{c.pricing}</Link></div></article>; })}</div></section>
    <div className="space-y-5"><section className="surface-card space-y-3 p-5"><h2 className="text-lg font-bold">{c.selected}</h2>{activeDraft && <div className="rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm"><strong>{c.draft}: {activeDraft.draft_identifier}</strong><p>{c.noNumber} · {c.revision} {activeDraft.revision_number} · {activeDraft.validation_status === "stale" ? c.stale : c.current}</p></div>}{!activeDraft && <p className="text-sm text-slate-500">{c.noDraft}</p>}{!orderedIds.length && <p className="text-sm text-slate-500">{c.noSelection}</p>}{orderedIds.map((id, index) => { const row = byId.get(id); const prior = activeLines.find((line) => line.booking_id === id); return <div key={id} className="rounded-lg border border-slate-200 p-3 text-sm"><div className="flex justify-between gap-2"><strong>{index + 1}. {row?.booking.job_order_number || prior?.work_order_number || id.slice(0, 8)}</strong><span>{row?.selling_price_thb != null ? formatThb(Number(row.selling_price_thb)) : "—"}</span></div>{row?.hold && <p className="text-amber-800">{c.holds[row.hold]}</p>}<div className="mt-2 flex gap-3 text-xs"><button disabled={index === 0 || !canFinance} onClick={() => move(id, -1)}>{c.up}</button><button disabled={index === orderedIds.length - 1 || !canFinance} onClick={() => move(id, 1)}>{c.down}</button><button disabled={!canFinance} onClick={() => setOrderedIds((ids) => ids.filter((value) => value !== id))}>{c.remove}</button></div></div>; })}<p className="border-t pt-3 text-lg font-bold">{c.total}: <span className="text-2xl tabular-nums">{formatThb(totalCents / 100)}</span></p><button className="btn-primary" disabled={!canFinance || !selectionValid || unchanged || busy} onClick={() => void saveDraft()}>{activeDraft ? c.revise : c.create}</button>{unchanged && <p className="text-xs text-slate-600">{c.unchanged}</p>}{!canFinance && <p className="text-sm text-amber-800">{c.roleRequired}</p>}</section>
    {activeDraft && <section className="surface-card space-y-3 p-5"><h2 className="text-lg font-bold">{c.breakdown}</h2>{activeLines.map((line) => <div key={line.id} className="border-b py-2 text-sm"><div className="flex justify-between gap-3"><span>{line.position}. {line.work_order_number} · {String(line.booking_snapshot.pickup || "")} → {String(line.booking_snapshot.dropoff || "")}</span><strong>{formatThb(Number(line.amount_thb))}</strong></div><p className="text-xs text-slate-600">{c.priceSource}: {line.pricing_snapshot.source === "manual" ? c.manual : c.priceList}{line.pricing_snapshot.original_price_thb != null ? ` · ${c.sourcePrice}: ${formatThb(Number(line.pricing_snapshot.original_price_thb))}` : ""}{line.pricing_snapshot.override_reason ? ` · ${c.overrideReason}: ${String(line.pricing_snapshot.override_reason)}` : ""}</p></div>)}<p className="text-sm font-semibold">{c.total}: {formatThb(Number(activeRevision?.total_thb || 0))}</p><p className="text-xs text-slate-600">{c.internalExcluded}</p></section>}
    {activeDraft && <section className="surface-card space-y-2 p-5"><h2 className="text-lg font-bold">{c.cancel}</h2><label className="text-sm">{c.cancelReason}<input className={input} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} /></label><button className="btn-secondary" disabled={!canFinance || busy || cancelReason.trim().length < 10} onClick={() => void cancelDraft()}>{c.cancel}</button></section>}
    <section className="surface-card p-5"><h2 className="text-lg font-bold">{c.history}</h2>{drafts.events.map((event) => <p key={event.id} className="border-b py-2 text-xs">{event.occurred_at} · {event.event_type === "created" ? c.created : event.event_type === "amended" ? c.amended : event.event_type === "cancelled" ? c.cancelled : c.staled} · {event.actor_id || c.system}</p>)}</section></div></div>
  </main>;
}

export default function WeeklyBillingPage() {
  if (usesFinanceLocalDemoScreens()) return <FinanceCentreWorkspace initialSection="sheet" />;
  return <LiveWeeklyBillingPage />;
}
