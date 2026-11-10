"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchBookingDiaryEntries } from "@/lib/data";
import { supabase } from "@/lib/supabase";
import { useLanguage } from "@/lib/language-provider";
import type { BookingDiaryEntry } from "@/types/database";
import { costPricingCopy } from "@/lib/finance-cost-pricing-copy";
import { formatThb } from "@/lib/finance-format";
import { effectivePriceList, expenseCategories, expenseTotal, financeRpc, loadCostPricing, parseThb, type ExpenseCategory, type ExpenseEvent, type PriceListVersion } from "@/lib/finance-cost-pricing";
import FinanceCentreWorkspace from "@/components/finance-centre-workspace";
import { usesFinanceLocalDemoScreens } from "@/lib/finance-fixture-mode";

type Data = Awaited<ReturnType<typeof loadCostPricing>>;
const emptyData: Data = { expenses: [], expenseDecisions: [], revisions: [], priceDecisions: [], priceLists: [], paperwork: [], verified: false, managementHold: false, capabilities: [], serverReady: false };
const field = "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm";

function LiveFinanceCostPricingPage() {
  const { language } = useLanguage();
  const c = costPricingCopy[language];
  const [bookings, setBookings] = useState<BookingDiaryEntry[]>([]);
  const [selected, setSelected] = useState("");
  const [data, setData] = useState<Data>(emptyData);
  const [category, setCategory] = useState<ExpenseCategory>("driver_trip");
  const [amount, setAmount] = useState("");
  const [incurred, setIncurred] = useState(new Date().toISOString().slice(0, 10));
  const [evidenceId, setEvidenceId] = useState("");
  const [receiptReference, setReceiptReference] = useState("");
  const [missingReason, setMissingReason] = useState("");
  const [note, setNote] = useState("");
  const [corrects, setCorrects] = useState("");
  const [reversal, setReversal] = useState(false);
  const [source, setSource] = useState<"price_list" | "manual">("price_list");
  const [sellingPrice, setSellingPrice] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [listAmount, setListAmount] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().slice(0, 10));
  const [terms, setTerms] = useState("");
  const [included, setIncluded] = useState<ExpenseCategory[]>([]);
  const [decisionReason, setDecisionReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const booking = useMemo(() => bookings.find((row) => row.id === selected), [bookings, selected]);
  const routeKey = booking ? `${booking.pickup.trim()} → ${booking.dropoff.trim()}` : "";
  const effective = booking?.client_id ? effectivePriceList(data.priceLists, booking.client_id, routeKey, booking.booking_date) : null;
  const canFinance = data.capabilities.includes("finance_reviewer");
  const canExpenseApprove = data.capabilities.includes("expense_approver");
  const canPricingApprove = data.capabilities.includes("pricing_approver");
  const ready = data.serverReady;
  const approvedTotal = expenseTotal(data.expenses, data.expenseDecisions);

  const refresh = useCallback(async (row: BookingDiaryEntry) => setData(await loadCostPricing(supabase, row.id, row.client_id)), []);
  useEffect(() => { let active = true; void fetchBookingDiaryEntries().then((rows) => { if (!active) return; setBookings(rows); const requested = new URLSearchParams(window.location.search).get("booking"); setSelected(rows.find((row) => row.id === requested)?.id || rows[0]?.id || ""); }).catch(() => { if (active) setError(c.saveFailed); }); return () => { active = false; }; }, [c.saveFailed]);
  useEffect(() => { if (!booking) { setData(emptyData); return; } let active = true; void loadCostPricing(supabase, booking.id, booking.client_id).then((result) => { if (active) { setData(result); setError(""); } }).catch(() => { if (active) setError(c.saveFailed); }); return () => { active = false; }; }, [booking, c.saveFailed]);
  useEffect(() => { if (booking) setIncurred(booking.booking_date); }, [booking]);
  useEffect(() => { const prior = data.expenses.find((row) => row.id === corrects); if (prior) { setCategory(prior.category); setEvidenceId(prior.evidence_id || ""); setReceiptReference(prior.receipt_reference || ""); setMissingReason(prior.missing_receipt_reason || ""); } }, [corrects, data.expenses]);

  async function save(action: () => Promise<unknown>, row = booking) {
    if (!row || busy) return;
    setBusy(true); setError("");
    try { await action(); await refresh(row); setDecisionReason(""); }
    catch (cause) { setError(cause instanceof Error && /INVALID_THB/.test(cause.message) ? c.invalidAmount : cause instanceof Error && /REASON_REQUIRED/.test(cause.message) ? c.reasonRequired : c.saveFailed); }
    finally { setBusy(false); }
  }
  function recordExpense() {
    if (!booking || !canFinance || !data.verified || data.managementHold) return;
    void save(async () => {
      const delta = reversal ? -(data.expenses.find((row) => row.id === corrects)?.amount_delta || 0)
        : corrects && amount.trim().startsWith("-") ? -parseThb(amount.trim().slice(1)) : parseThb(amount);
      if (delta === 0) throw new Error("INVALID_THB_AMOUNT");
      await financeRpc<ExpenseEvent>(supabase, "finance_record_expense", { p_booking_id: booking.id, p_category: category, p_amount: delta, p_incurred_on: incurred, p_evidence_id: evidenceId || null, p_receipt_reference: receiptReference, p_missing_reason: missingReason, p_note: note, p_corrects_event_id: corrects || null, p_reversal: reversal });
      setAmount(""); setReceiptReference(""); setMissingReason(""); setNote(""); setCorrects(""); setReversal(false);
    });
  }
  function proposePrice() {
    if (!booking || !canFinance || !data.verified || data.managementHold) return;
    void save(async () => { await financeRpc(supabase, "finance_propose_job_price", { p_booking_id: booking.id, p_price_list_version_id: source === "price_list" ? effective?.id || null : null, p_manual_amount: source === "manual" ? parseThb(sellingPrice) : null, p_reason: source === "manual" ? overrideReason : "" }); setSellingPrice(""); setOverrideReason(""); });
  }
  function addList() {
    if (!booking?.client_id || !canPricingApprove) return;
    void save(async () => { await financeRpc<PriceListVersion>(supabase, "finance_add_price_list_version", { p_client_id: booking.client_id, p_route_key: routeKey, p_effective_from: effectiveFrom, p_amount: parseThb(listAmount), p_included: included, p_terms: terms }); setListAmount(""); setTerms(""); setIncluded([]); });
  }
  const decision = (id: string, type: "expense" | "price", approved: boolean) => void save(() => financeRpc(supabase, type === "expense" ? "finance_decide_expense" : "finance_decide_job_price", type === "expense" ? { p_event_id: id, p_approved: approved, p_reason: decisionReason } : { p_revision_id: id, p_approved: approved, p_reason: decisionReason }));
  return <main className="finance-centre-workspace w-full max-w-none space-y-5 text-slate-900">
    <header className="rounded-2xl bg-violet-900 p-6 text-white"><p className="text-xs font-bold tracking-[.2em]">EES · FINANCE</p><h1 className="mt-2 text-2xl font-bold">{c.title}</h1><p className="mt-1 text-sm text-violet-100">{c.subtitle}</p></header>
    <nav className="flex flex-wrap gap-2"><Link className="btn-secondary" href="/booking-diary">{c.booking}</Link><Link className="btn-secondary" href={selected ? `/paperwork-inbox?booking=${encodeURIComponent(selected)}` : "/paperwork-inbox"}>{c.paperwork}</Link><Link className="btn-secondary" href={selected ? `/job-verification?booking=${encodeURIComponent(selected)}` : "/job-verification"}>{c.verification}</Link><Link className="btn-secondary" href="/finance-centre">{c.centre}</Link><Link className="btn-secondary" href="/weekly-billing">{language === "th" ? "วางบิลรายสัปดาห์" : "Weekly Billing"}</Link></nav>
    {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-rose-800">{error}</p>}
    <div className="grid gap-5 lg:grid-cols-[18rem_1fr]"><aside className="surface-card max-h-[78vh] overflow-auto p-4"><h2 className="font-semibold">{c.selectJob}</h2>{bookings.map((row) => <button key={row.id} type="button" onClick={() => setSelected(row.id)} className={`mt-2 block w-full rounded-lg border p-3 text-left text-sm ${row.id === selected ? "border-violet-500 bg-violet-50" : "border-slate-200"}`}><strong>{row.job_order_number || row.booking_id || row.id.slice(0, 8)}</strong><span className="block text-slate-600">{row.booking_date} · {row.client?.name || "—"}</span></button>)}</aside>
    <div className="space-y-5">{!booking ? <section className="surface-card p-5">{c.noBooking}</section> : <>
      <section className="surface-card space-y-1 p-5"><h2 className="text-xl font-bold">{booking.job_order_number || booking.booking_id || booking.id}</h2><p className="text-sm">{c.customer}: {booking.client?.name || "—"} · {booking.booking_date}</p><p className="text-sm">{c.route}: {routeKey}</p><div className="mt-3 flex flex-wrap gap-2"><span className={`rounded-full px-3 py-1 text-xs font-semibold ${data.verified ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{data.verified ? c.verified : c.needsVerification}</span>{data.managementHold && <span className="rounded-full bg-rose-100 px-3 py-1 text-xs font-semibold text-rose-800">{c.managementHold}</span>}<span className={`rounded-full px-3 py-1 text-xs font-semibold ${ready ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700"}`}>{ready ? c.ready : c.blocked}</span></div></section>
      <section className="surface-card space-y-4 p-5"><div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-lg font-bold">{c.expenses}</h2><strong className="text-xl tabular-nums">{c.total}: {formatThb(approvedTotal)}</strong></div><p className="text-sm text-slate-600">{c.evidenceHelp}</p><div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">{c.category}<select className={field} value={category} onChange={(event) => setCategory(event.target.value as ExpenseCategory)}>{expenseCategories.map((value) => <option key={value} value={value}>{c.categories[value]}</option>)}</select></label><label className="text-sm">{c.incurred}<input className={field} type="date" value={incurred} onChange={(event) => setIncurred(event.target.value)} /></label><label className="text-sm">{c.correction}<select className={field} value={corrects} onChange={(event) => { setCorrects(event.target.value); setReversal(false); }}><option value="">{c.newCharge}</option>{data.expenses.map((row) => <option key={row.id} value={row.id}>{c.categories[row.category]} · {formatThb(row.amount_delta)} · {row.id.slice(0, 8)}</option>)}</select></label><label className="text-sm">{c.amount}<input className={field} inputMode="decimal" disabled={reversal} value={reversal ? String(Math.abs(data.expenses.find((row) => row.id === corrects)?.amount_delta || 0)) : amount} onChange={(event) => setAmount(event.target.value)} /></label><label className="text-sm">{c.receipt}<select className={field} value={evidenceId} onChange={(event) => setEvidenceId(event.target.value)}><option value="">{c.chooseReceipt}</option>{data.paperwork.map((row) => <option key={row.id} value={row.id}>{row.original_filename} · {row.id.slice(0, 8)}</option>)}</select></label><label className="text-sm">{c.receiptReference}<input className={field} value={receiptReference} onChange={(event) => setReceiptReference(event.target.value)} /></label><label className="text-sm">{c.missingReason}<input className={field} value={missingReason} onChange={(event) => setMissingReason(event.target.value)} /></label><label className="text-sm">{c.note}<input className={field} value={note} onChange={(event) => setNote(event.target.value)} /></label></div><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={reversal} disabled={!corrects} onChange={(event) => setReversal(event.target.checked)} />{c.reversal}</label><button className="btn-primary" disabled={!canFinance || !data.verified || data.managementHold || busy} onClick={recordExpense}>{c.addExpense}</button>{!canFinance && <p className="text-sm text-amber-800">{c.roleRequired}</p>}
      <div className="space-y-2">{!data.expenses.length && <p className="text-sm text-slate-500">{c.noExpenses}</p>}{data.expenses.map((row) => { const decisionRow = data.expenseDecisions.find((item) => item.event_id === row.id); return <article key={row.id} className="rounded-lg border border-slate-200 p-3 text-sm"><strong>{c.categories[row.category]} · {c.kinds[row.event_kind]} · {formatThb(Number(row.amount_delta))}</strong><p>{row.incurred_on} · {c.actor}: {row.created_by} · {decisionRow ? c[decisionRow.decision] : c.pending}</p><p className="text-xs text-slate-600">{row.evidence_id || row.receipt_reference || row.missing_receipt_reason || c.none}{row.corrects_event_id ? ` · ${c.correction}: ${row.corrects_event_id}` : ""}</p>{!decisionRow && canExpenseApprove && <div className="mt-2 flex flex-wrap gap-2"><button className="btn-secondary" disabled={busy} onClick={() => decision(row.id, "expense", true)}>{c.approve}</button><button className="btn-secondary" disabled={busy} onClick={() => decision(row.id, "expense", false)}>{c.reject}</button></div>}</article>; })}</div></section>
      <section className="surface-card space-y-4 p-5"><h2 className="text-lg font-bold">{c.pricing}</h2><p className="text-sm text-slate-600">{c.separate}</p><div className="rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm"><strong>{c.sourcePrice}: {effective ? formatThb(Number(effective.amount_thb)) : c.listUnavailable}</strong>{effective && <p>{c.effective}: {effective.effective_from} · {c.priceListVersion}: {effective.id.slice(0, 8)}</p>}</div><div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">{c.source}<select className={field} value={source} onChange={(event) => setSource(event.target.value as "price_list" | "manual")}><option value="price_list">{c.priceList}</option><option value="manual">{c.manual}</option></select></label>{source === "manual" && <><label className="text-sm">{c.proposedPrice}<input className={field} inputMode="decimal" value={sellingPrice} onChange={(event) => setSellingPrice(event.target.value)} /></label><label className="text-sm sm:col-span-2">{c.overrideReason}<input className={field} value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} /></label></>}</div><button className="btn-primary" disabled={!canFinance || !data.verified || data.managementHold || (source === "price_list" && !effective) || busy} onClick={proposePrice}>{c.propose}</button>
      <div className="space-y-2">{!data.revisions.length && <p className="text-sm text-slate-500">{c.noPrice}</p>}{data.revisions.map((row) => { const decisionRow = data.priceDecisions.find((item) => item.revision_id === row.id); return <article key={row.id} className="rounded-lg border border-slate-200 p-3 text-sm"><strong>{row.source === "price_list" ? c.priceList : c.manual} · {formatThb(Number(row.selling_price_thb))}</strong><p>{c.sourcePrice}: {row.original_price_thb == null ? c.none : formatThb(Number(row.original_price_thb))} · {decisionRow ? c[decisionRow.decision] : c.pending}</p><p className="text-xs text-slate-600">{row.override_reason || ""} · {c.actor}: {row.created_by} · {row.created_at}</p>{!decisionRow && canPricingApprove && <div className="mt-2 flex gap-2"><button className="btn-secondary" disabled={busy} onClick={() => decision(row.id, "price", true)}>{c.approve}</button><button className="btn-secondary" disabled={busy} onClick={() => decision(row.id, "price", false)}>{c.reject}</button></div>}</article>; })}</div></section>
      <section className="surface-card space-y-3 p-5"><h2 className="text-lg font-bold">{c.approval}</h2><label className="text-sm">{c.decisionReason}<input className={field} value={decisionReason} onChange={(event) => setDecisionReason(event.target.value)} /></label><p className="text-xs text-slate-600">{c.roleRequired}</p></section>
      {canPricingApprove && booking.client_id && <section className="surface-card space-y-3 p-5"><h2 className="text-lg font-bold">{c.addList}</h2><p className="text-sm">{c.customer}: {booking.client?.name} · {c.routeKey}: {routeKey}</p><div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">{c.effective}<input className={field} type="date" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} /></label><label className="text-sm">{c.amount}<input className={field} inputMode="decimal" value={listAmount} onChange={(event) => setListAmount(event.target.value)} /></label><label className="text-sm sm:col-span-2">{c.terms}<input className={field} value={terms} onChange={(event) => setTerms(event.target.value)} /></label></div><fieldset><legend className="text-sm">{c.includedCosts}</legend><div className="mt-2 flex flex-wrap gap-3">{expenseCategories.map((value) => <label key={value} className="text-xs"><input type="checkbox" checked={included.includes(value)} onChange={(event) => setIncluded(event.target.checked ? [...included, value] : included.filter((item) => item !== value))} /> {c.categories[value]}</label>)}</div></fieldset><button className="btn-primary" disabled={busy} onClick={addList}>{c.addList}</button></section>}
    </>}</div></div>
  </main>;
}

export default function FinanceCostPricingPage() {
  if (usesFinanceLocalDemoScreens()) return <FinanceCentreWorkspace initialSection="billing" />;
  return <LiveFinanceCostPricingPage />;
}
