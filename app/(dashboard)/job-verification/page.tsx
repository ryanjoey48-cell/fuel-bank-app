"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import FinanceCentreWorkspace from "@/components/finance-centre-workspace";
import { fetchBookingDiaryEntries } from "@/lib/data";
import { useLanguage } from "@/lib/language-provider";
import { supabase } from "@/lib/supabase";
import type { BookingDiaryEntry } from "@/types/database";
import { DOCUMENT_KEYS, VERIFICATION_FIELDS, evaluateVerification, verificationCopy, verificationErrorMessage, type DocumentCheck, type DocumentKey, type VerificationField } from "@/lib/job-verification";
import { DEMO_VERIFICATIONS } from "@/lib/job-verification-demo";
import { historicalDemoRecords, historicalWorkbook } from "@/lib/job-verification-historical-demo";
import type { PaperworkDocument } from "@/lib/finance-paperwork";
import { usesFinanceLocalDemoScreens } from "@/lib/finance-fixture-mode";

type VerificationRow = { booking_id: string; status: string; handover_status: string; checked_at: string; checked_by: string; revision: number };
type DiscrepancyRow = { id: string; booking_id: string; field_key: string; expected_value: string; observed_value: string; status: string; resolution: string | null };
type AuditRow = { id: number; booking_id: string; actor_name: string; event_type: string; occurred_at: string; details: Record<string, unknown> };
type Observed = Record<VerificationField, string>;
type Checklist = Record<DocumentKey, DocumentCheck>;
const blankChecklist = (): Checklist => ({ green_job_order: { required: true, received: false, reference: "", not_applicable_reason: "" }, parking_receipt: { required: true, received: false, reference: "", not_applicable_reason: "" }, toll_receipt: { required: true, received: false, reference: "", not_applicable_reason: "" } });
function bookingValues(booking: BookingDiaryEntry): Observed {
  return { booking_date: booking.booking_date || "", client_id: booking.client_id || "", pickup: booking.pickup || "", dropoff: booking.dropoff || "", driver: booking.driver || "", vehicle_registration: booking.vehicle_registration || "", job_order_number: booking.job_order_number || "" };
}
const fieldLabels = { booking_date: "date", client_id: "client", pickup: "pickup", dropoff: "dropoff", driver: "driver", vehicle_registration: "vehicle", job_order_number: "order" } as const;
const documentLabels = { green_job_order: "green", parking_receipt: "parking", toll_receipt: "toll" } as const;

function LiveJobVerificationPage() {
  const { language } = useLanguage();
  const copy = verificationCopy[language];
  const [demo, setDemo] = useState(false);
  const [historicalDemo, setHistoricalDemo] = useState(false);
  const [bookings, setBookings] = useState<BookingDiaryEntry[]>([]);
  const [rows, setRows] = useState<VerificationRow[]>([]);
  const [discrepancies, setDiscrepancies] = useState<DiscrepancyRow[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [canResolve, setCanResolve] = useState(false);
  const [canSubmit, setCanSubmit] = useState(false);
  const [selected, setSelected] = useState("");
  const [observed, setObserved] = useState<Observed | null>(null);
  const [documents, setDocuments] = useState<Checklist>(blankChecklist);
  const [reviewedDocuments, setReviewedDocuments] = useState<Pick<PaperworkDocument, "id" | "kind" | "original_filename">[]>([]);
  const [note, setNote] = useState("");
  const [resolution, setResolution] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [bookingRows, verificationResult, discrepancyResult, auditResult, userResult] = await Promise.all([
        fetchBookingDiaryEntries(),
        supabase.from("finance_job_verifications").select("booking_id,status,handover_status,checked_at,checked_by,revision"),
        supabase.from("finance_discrepancies").select("id,booking_id,field_key,expected_value,observed_value,status,resolution").order("raised_at", { ascending: false }),
        supabase.from("finance_audit_events").select("id,booking_id,actor_name,event_type,occurred_at,details").order("id", { ascending: false }).limit(100),
        supabase.auth.getUser()
      ]);
      setBookings(bookingRows);
      if (verificationResult.error) throw verificationResult.error;
      if (discrepancyResult.error) throw discrepancyResult.error;
      if (auditResult.error) throw auditResult.error;
      setRows((verificationResult.data || []) as VerificationRow[]);
      setDiscrepancies((discrepancyResult.data || []) as DiscrepancyRow[]);
      setAudit((auditResult.data || []) as AuditRow[]);
      const userId = userResult.data.user?.id;
      if (userId) {
        const [grant, access] = await Promise.all([
          supabase.from("finance_role_grants").select("capability").eq("user_id", userId).eq("capability", "management_reviewer").maybeSingle(),
          supabase.from("account_access").select("role,status").eq("user_id", userId).maybeSingle()
        ]);
        const officeWriter = !access.error && access.data?.status === "active" && ["admin","office_staff"].includes(String(access.data?.role));
        setCanSubmit(officeWriter);
        setCanResolve(officeWriter && !grant.error && !!grant.data);
      }
      setMessage("");
    } catch (error) { setMessage(verificationErrorMessage(error instanceof Error ? error.message : "", language)); }
    finally { setLoading(false); }
  }, [language]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("demo") === "1") { setDemo(true); setLoading(false); return; }
    if (params.get("demo") === "historical" || process.env.NEXT_PUBLIC_EES_FINANCE_PREVIEW === "1") { setHistoricalDemo(true); setLoading(false); return; }
    setSelected(params.get("booking") || "");
    void load();
  }, [load]);
  const booking = useMemo(() => bookings.find((item) => item.id === selected) || null, [bookings, selected]);
  const current = rows.find((item) => item.booking_id === selected);
  const openDiscrepancies = discrepancies.filter((item) => item.booking_id === selected && item.status === "open");
  useEffect(() => { if (booking) { setObserved(bookingValues(booking)); setDocuments(blankChecklist()); setNote(""); } }, [booking]);
  useEffect(() => {
    if (!selected || demo || historicalDemo) { setReviewedDocuments([]); return; }
    let active = true;
    void supabase.from("finance_paperwork_documents").select("id,kind,original_filename").eq("booking_id", selected).eq("status", "reviewed").then(({ data, error }) => {
      if (active) setReviewedDocuments(error ? [] : (data || []) as Pick<PaperworkDocument, "id" | "kind" | "original_filename">[]);
    });
    return () => { active = false; };
  }, [selected, demo, historicalDemo]);
  const preview = booking && observed ? evaluateVerification({ expected: bookingValues(booking), observed, documents }) : null;
  async function submit() {
    if (!booking || !observed || !canSubmit || saving) return;
    setSaving(true);
    const result = await supabase.rpc("finance_submit_verification", { p_booking_id: booking.id, p_observed: observed, p_documents: documents, p_note: note });
    setSaving(false);
    if (result.error) { setMessage(verificationErrorMessage(result.error.message, language)); return; }
    await load();
  }
  async function resolve(id: string) {
    if (!canResolve || resolution.trim().length < 10 || saving) return;
    setSaving(true);
    const result = await supabase.rpc("finance_resolve_discrepancy", { p_discrepancy_id: id, p_resolution: resolution });
    setSaving(false);
    if (result.error) { setMessage(verificationErrorMessage(result.error.message, language)); return; }
    setResolution("");
    await load();
  }
  const statusLabel = (status: string) => status === "verified" ? copy.verified : status === "missing_paperwork" ? copy.missing : status === "incomplete_booking" ? copy.incomplete : status === "discrepancy" ? copy.mismatch : status === "needs_recheck" ? copy.resolved : copy.pending;
  const eventLabel = (event: string) => event === "verification_submitted" ? copy.compare : event === "discrepancy_resolved" ? copy.resolved : language === "th" ? "Booking changed" : "Booking changed";
  const fieldLabel = (field: string) => field in fieldLabels ? copy[fieldLabels[field as VerificationField]] : field;
  return <main className="finance-centre-workspace w-full max-w-none space-y-6">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-bold text-slate-900">{copy.title}</h1><p className="text-sm text-slate-600">{language === "th" ? "Check completed work and paperwork before finance handover." : "Check completed work and paperwork before finance handover."}</p></div><div className="flex gap-3"><Link className="btn-secondary" href="/booking-diary">{language === "th" ? "Booking Diary" : "Booking Diary"}</Link><Link className="btn-secondary" href={selected ? `/paperwork-inbox?booking=${encodeURIComponent(selected)}` : "/paperwork-inbox"}>{language === "th" ? "Paperwork Inbox" : "Paperwork Inbox"}</Link><Link className="btn-secondary" href="/finance-centre">{copy.overview}</Link></div></header>
    {historicalDemo ? <section className="surface-card p-5"><strong className="text-amber-700">{language === "th" ? "SOURCE WORKBOOK FACTS + SIMULATED WORKFLOW (read only)" : "SOURCE WORKBOOK FACTS + SIMULATED WORKFLOW (read only)"}</strong><p className="mt-1 text-xs text-slate-600">{historicalWorkbook.file} · SHA-256 {historicalWorkbook.sha256}</p><p className="mt-2 text-sm">{language === "th" ? "The workbook has no customer column or returned-paperwork images. Shown TRN values are existing workbook references." : "The workbook has no customer column or returned-paperwork images. Shown TRN values are existing workbook references."}</p><div className="mt-4 grid gap-3 md:grid-cols-2">{historicalDemoRecords.map((item) => <article key={`${item.source.sheet}-${item.source.row}`} className="rounded-lg border p-4"><p className="font-bold">{item.source.sheet}!{item.source.row} · {String(item.source.cells.G)}</p><p className="text-sm">{String(item.source.cells.A).slice(0,10)} · {item.source.cells.B} → {item.source.cells.C}</p><p className="text-sm">{copy.vehicle}: {item.source.cells.E} · {copy.driver}: {item.source.cells.F}</p><p className="text-sm">{language === "th" ? "Existing source TRN" : "Existing source TRN"}: {item.source.cells.H}</p><p className="text-sm">{language === "th" ? "Customer" : "Customer"}: {language === "th" ? "not recorded in workbook" : "not recorded in workbook"}</p><p className="mt-2 text-xs text-slate-600">{Object.entries(item.source.cells).filter(([column]) => ["I","J","K","L","M","N","O"].includes(column)).map(([column,value]) => `${column}=${value}`).join(" · ")}</p><p className="mt-2 font-semibold text-amber-800">{language === "th" ? "Simulated status: " : "Simulated status: "}{statusLabel(item.simulation.status)}</p><p className="mt-1 text-sm">{item.simulation[language]}</p></article>)}</div></section> : demo ? <section className="surface-card p-5"><strong className="text-amber-700">{copy.demo}</strong><div className="mt-4 grid gap-3 md:grid-cols-2">{DEMO_VERIFICATIONS.map((item) => <article key={item.id} className="rounded-lg border p-4"><p className="font-bold">{item.booking_id} · {item.client}</p><p className="text-sm">{item.route}</p><p className="mt-2 text-sm font-semibold">{statusLabel(item.status)}</p><p className="text-xs">{item.handover_status === "ready" ? copy.ready : copy.pending}</p><p className="mt-2 text-sm">{item.detail[language]}</p></article>)}</div></section> : <div className="grid gap-5 lg:grid-cols-[18rem_1fr]">
      <aside className="surface-card max-h-[75vh] overflow-auto p-4"><h2 className="font-bold">{copy.booking}</h2>{loading ? <p>{copy.loading}</p> : null}{bookings.map((item) => <button key={item.id} type="button" onClick={() => setSelected(item.id)} className={`mt-2 block w-full rounded-lg border p-3 text-left text-sm ${selected === item.id ? "border-indigo-500 bg-indigo-50" : "border-slate-200"}`}><strong>{item.booking_id || item.job_order_number || item.id.slice(0, 8)}</strong><span className="block text-slate-600">{item.booking_date} · {item.client?.name || item.client_id || "—"}</span><span className="block text-xs">{statusLabel(rows.find((row) => row.booking_id === item.id)?.status || "pending")}</span></button>)}</aside>
      <section className="surface-card space-y-5 p-5">{!booking || !observed ? <p>{copy.booking}: {copy.pending}</p> : <>
        <div><h2 className="text-lg font-bold">{booking.booking_id || booking.id}</h2><p className="text-sm text-slate-600">{booking.client?.name || booking.client_id || "—"} · {booking.pickup} → {booking.dropoff}</p><p className="mt-1 text-sm">{statusLabel(current?.status || "pending")}</p></div>
        <fieldset className="grid gap-3 md:grid-cols-2"><legend className="mb-2 font-bold">{copy.observed}</legend>{VERIFICATION_FIELDS.map((field) => <label key={field} className="text-sm"><span className="block font-semibold">{copy[fieldLabels[field]]}</span><small className="block text-slate-500">{language === "th" ? "Diary: " : "Diary: "}{bookingValues(booking)[field] || "—"}</small><input className="mt-1 w-full rounded border border-slate-300 p-2" value={observed[field]} onChange={(event) => setObserved({ ...observed, [field]: event.target.value })} /></label>)}</fieldset>
        <fieldset className="space-y-3"><legend className="font-bold">{copy.documents}</legend>{DOCUMENT_KEYS.map((key) => <div key={key} className="grid items-center gap-2 rounded border p-3 sm:grid-cols-[1fr_auto_auto_12rem]"><strong className="text-sm">{copy[documentLabels[key]]}</strong><label className="text-sm"><input type="checkbox" checked={documents[key].required} disabled={key === "green_job_order"} onChange={(event) => setDocuments({ ...documents, [key]: { ...documents[key], required: event.target.checked, received: event.target.checked ? documents[key].received : false, reference: event.target.checked ? documents[key].reference : "" } })} /> {copy.required}</label><span className="text-xs text-slate-600">{documents[key].received ? copy.received : copy.missing}</span>{documents[key].required ? <select aria-label={`${copy[documentLabels[key]]} ${copy.reference}`} className="rounded border p-2 text-sm" value={documents[key].reference} onChange={(event) => setDocuments({ ...documents, [key]: { ...documents[key], received: !!event.target.value, reference: event.target.value } })}><option value="">{copy.reference}</option>{reviewedDocuments.filter((doc) => doc.kind === key).map((doc) => <option key={doc.id} value={doc.id}>{doc.original_filename} · {doc.id.slice(0, 8)}</option>)}</select> : <input aria-label={`${copy[documentLabels[key]]} ${copy.notApplicable}`} className="rounded border p-2 text-sm" placeholder={copy.notApplicable} value={documents[key].not_applicable_reason} onChange={(event) => setDocuments({ ...documents, [key]: { ...documents[key], not_applicable_reason: event.target.value } })} />}</div>)}</fieldset>
        <label className="block text-sm"><span className="font-semibold">{copy.note}</span><textarea className="mt-1 block w-full rounded border p-2" value={note} onChange={(event) => setNote(event.target.value)} /></label>
        <p className="text-sm font-semibold">{preview ? statusLabel(preview.status) : ""}{preview?.mismatches.length ? ` · ${preview.mismatches.map(fieldLabel).join(", ")}` : ""}{preview?.missingDocuments.length ? ` · ${preview.missingDocuments.map((key) => copy[documentLabels[key]]).join(", ")}` : ""}{preview?.incompleteFields.length ? ` · ${preview.incompleteFields.map(fieldLabel).join(", ")}` : ""}</p><button type="button" className="btn-primary" disabled={saving || !canSubmit || openDiscrepancies.length > 0} onClick={() => void submit()}>{copy.compare}</button>{!canSubmit ? <p className="text-sm text-amber-800">{copy.permissionError}</p> : null}{openDiscrepancies.length ? <p className="text-sm text-amber-800">{copy.openDiscrepancyError}</p> : null}
        {openDiscrepancies.length ? <section className="space-y-2"><h3 className="font-bold">{copy.mismatch}</h3>{openDiscrepancies.map((item) => <div key={item.id} className="rounded border border-amber-300 bg-amber-50 p-3 text-sm"><strong>{fieldLabel(item.field_key)}</strong><p>{item.expected_value} → {item.observed_value}</p>{canResolve ? <div className="mt-2 flex gap-2"><input className="min-w-0 flex-1 rounded border p-2" placeholder={copy.decision} value={resolution} onChange={(event) => setResolution(event.target.value)} /><button className="btn-secondary" disabled={saving || resolution.trim().length < 10} onClick={() => void resolve(item.id)}>{copy.resolve}</button></div> : null}</div>)}</section> : null}
        <section><h3 className="font-bold">{copy.history}</h3>{audit.filter((item) => item.booking_id === booking.id).map((item) => <article key={item.id} className="border-b py-2 text-xs"><strong>{item.occurred_at} · {item.actor_name} · {eventLabel(item.event_type)}</strong>{item.event_type === "verification_submitted" ? <p>{language === "th" ? "Checked: " : "Checked: "}{VERIFICATION_FIELDS.map((field) => copy[fieldLabels[field]]).join(", ")} · {statusLabel(String(item.details.status || "pending"))}</p> : null}{item.event_type === "discrepancy_resolved" ? <p>{fieldLabel(String(item.details.field_key || ""))}: {String(item.details.resolution || "")}</p> : null}</article>)}</section>
      </>}</section>
    </div>}{message ? <p role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">{message}</p> : null}
  </main>;
}

export default function JobVerificationPage() {
  if (usesFinanceLocalDemoScreens()) {
    return <FinanceCentreWorkspace initialSection="reconciliation" />;
  }
  return <LiveJobVerificationPage />;
}
