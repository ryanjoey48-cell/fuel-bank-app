"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchBookingDiaryEntries } from "@/lib/data";
import { useLanguage } from "@/lib/language-provider";
import { supabase } from "@/lib/supabase";
import type { BookingDiaryEntry } from "@/types/database";
import { downloadBookingPaperwork, loadBookingPaperwork, paperworkMissing, PaperworkUploadError, reserveAndUploadPaperwork, reviewBookingPaperwork, uploadReservedPaperwork, type PaperworkDocument, type PaperworkEvent, type PaperworkKind } from "@/lib/finance-paperwork";
import { paperworkCopy } from "@/lib/finance-paperwork-copy";
import FinanceCentreWorkspace from "@/components/finance-centre-workspace";
import { usesFinanceLocalDemoScreens } from "@/lib/finance-fixture-mode";

const kinds: PaperworkKind[] = ["green_job_order", "parking_receipt", "toll_receipt", "other"];
function LivePaperworkInboxPage() {
  const { language } = useLanguage();
  const c = paperworkCopy[language];
  const [bookings, setBookings] = useState<BookingDiaryEntry[]>([]);
  const [selected, setSelected] = useState("");
  const [documents, setDocuments] = useState<PaperworkDocument[]>([]);
  const [events, setEvents] = useState<PaperworkEvent[]>([]);
  const [canWrite, setCanWrite] = useState(false);
  const [kind, setKind] = useState<PaperworkKind>("green_job_order");
  const [file, setFile] = useState<File | null>(null);
  const [revisionOf, setRevisionOf] = useState("");
  const [physical, setPhysical] = useState("");
  const [note, setNote] = useState("");
  const [retry, setRetry] = useState<{ document: PaperworkDocument; file: File } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const booking = useMemo(() => bookings.find((row) => row.id === selected), [bookings, selected]);
  const visibleDocuments = documents.filter((document) => document.booking_id === selected);
  const visibleEvents = events.filter((event) => event.booking_id === selected);
  const missing = paperworkMissing(visibleDocuments);

  const refresh = useCallback(async (bookingId: string) => {
    const result = await loadBookingPaperwork(supabase, bookingId);
    setDocuments(result.documents);
    setEvents(result.events);
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [rows, auth] = await Promise.all([fetchBookingDiaryEntries(), supabase.auth.getUser()]);
        if (!active) return;
        setBookings(rows);
        const requested = new URLSearchParams(window.location.search).get("booking") || "";
        setSelected(rows.some((row) => row.id === requested) ? requested : rows[0]?.id || "");
        if (auth.data.user) {
          const access = await supabase.from("account_access").select("role,status").eq("user_id", auth.data.user.id).maybeSingle();
          if (active) setCanWrite(!access.error && access.data?.status === "active" && ["admin", "office_staff"].includes(String(access.data?.role)));
        }
      } catch { if (active) setError(c.saveFailed); }
    })();
    return () => { active = false; };
  }, [c.saveFailed]);

  useEffect(() => {
    if (!booking) { setDocuments([]); setEvents([]); return; }
    let active = true;
    void loadBookingPaperwork(supabase, booking.id).then((result) => {
      if (active) { setDocuments(result.documents); setEvents(result.events); setError(""); }
    }).catch(() => { if (active) setError(c.saveFailed); });
    return () => { active = false; };
  }, [booking, c.saveFailed]);

  async function upload() {
    if (!booking || !file || !canWrite || busy) return;
    setBusy(true); setError("");
    try {
      await reserveAndUploadPaperwork(supabase, booking.id, kind, file, revisionOf || null);
      setFile(null); setRevisionOf(""); setRetry(null);
      await refresh(booking.id);
    } catch (cause) {
      if (cause instanceof PaperworkUploadError) { setRetry({ document: cause.pending, file }); setError(c.uploadFailed); }
      else setError(cause instanceof Error && /INVALID|SIZE|TYPE|MISMATCH/.test(cause.message) ? c.invalidFile : c.saveFailed);
    } finally { setBusy(false); }
  }

  async function retryUpload() {
    if (!retry || !booking || retry.document.booking_id !== booking.id || !canWrite || busy) return;
    setBusy(true); setError("");
    try { await uploadReservedPaperwork(supabase, retry.document, retry.file); setRetry(null); setFile(null); await refresh(booking.id); }
    catch { setError(c.uploadFailed); }
    finally { setBusy(false); }
  }

  async function retryPending(document: PaperworkDocument) {
    if (!booking || document.booking_id !== booking.id || !file || !canWrite || busy) return;
    setBusy(true); setError("");
    try { await uploadReservedPaperwork(supabase, document, file); setFile(null); setRetry(null); await refresh(booking.id); }
    catch { setError(c.uploadFailed); }
    finally { setBusy(false); }
  }

  async function review(document: PaperworkDocument, approved: boolean) {
    if (!booking || document.booking_id !== booking.id || !canWrite || busy) return;
    if ((approved && physical.trim().length < 3) || (!approved && note.trim().length < 8)) { setError(c.incompleteReview); return; }
    setBusy(true); setError("");
    try { await reviewBookingPaperwork(supabase, document.id, approved, physical, note); setPhysical(""); setNote(""); await refresh(booking.id); }
    catch { setError(c.saveFailed); }
    finally { setBusy(false); }
  }

  async function download(document: PaperworkDocument) {
    if (!booking || document.booking_id !== booking.id) return;
    try {
      const blob = await downloadBookingPaperwork(supabase, document);
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement("a"); anchor.href = url; anchor.download = document.original_filename; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch { setError(c.saveFailed); }
  }

  return <main className="finance-centre-workspace w-full max-w-none space-y-5 text-slate-900">
    <header className="rounded-2xl bg-violet-900 p-6 text-white"><p className="text-xs font-bold tracking-[.2em]">EES · FINANCE</p><h1 className="mt-2 text-2xl font-bold">{c.title}</h1><p className="mt-1 text-sm text-violet-100">{c.subtitle}</p></header>
    <div className="flex flex-wrap gap-2"><Link className="btn-secondary" href="/booking-diary">{c.booking}</Link><Link className="btn-secondary" href={selected ? `/job-verification?booking=${encodeURIComponent(selected)}` : "/job-verification"}>{c.verification}</Link></div>
    {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
    <div className="grid gap-5 lg:grid-cols-[18rem_1fr]">
      <aside className="surface-card max-h-[75vh] overflow-auto p-4"><h2 className="font-semibold">{c.booking}</h2>{bookings.map((row) => <button key={row.id} type="button" onClick={() => { setSelected(row.id); setDocuments([]); setEvents([]); setRetry(null); }} className={`mt-2 block w-full rounded-lg border p-3 text-left text-sm ${row.id === selected ? "border-violet-500 bg-violet-50" : "border-slate-200"}`}><strong>{row.booking_id || row.job_order_number || row.id.slice(0, 8)}</strong><span className="block text-slate-600">{row.booking_date} · {row.client?.name || ""}</span></button>)}</aside>
      <div className="space-y-5">{!booking ? <section className="surface-card p-5">{c.noBooking}</section> : <>
        <section className="surface-card space-y-2 p-5"><h2 className="text-lg font-bold">{booking.booking_id || booking.id}</h2><p className="text-sm">{c.customer}: {booking.client?.name || ""} · {c.workOrder}: {booking.job_order_number || ""}</p><p className="text-sm">{c.route}: {booking.pickup} ? {booking.dropoff}</p><p className="text-sm font-semibold text-amber-800">{c.explicit}</p><p className="text-xs text-slate-500">{c.demo}</p></section>
        <section className="surface-card space-y-3 p-5"><h2 className="text-lg font-bold">{c.upload}</h2><div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">{c.kind}<select className="mt-1 block w-full rounded border p-2" value={kind} onChange={(event) => { setKind(event.target.value as PaperworkKind); setRevisionOf(""); }}>{kinds.map((value) => <option key={value} value={value}>{c[value]}</option>)}</select></label><label className="text-sm">{c.revision}<select className="mt-1 block w-full rounded border p-2" value={revisionOf} onChange={(event) => setRevisionOf(event.target.value)}><option value="">{c.newDocument}</option>{visibleDocuments.filter((doc) => doc.kind === kind && ["reviewed","rejected","superseded"].includes(doc.status)).map((doc) => <option key={doc.id} value={doc.id}>{doc.original_filename} · {doc.id.slice(0, 8)}</option>)}</select></label></div><input aria-label={c.file} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => setFile(event.target.files?.[0] || null)} /><p className="text-xs text-slate-500">{c.file}</p><div className="flex flex-wrap gap-2"><button className="btn-primary" disabled={!canWrite || !file || busy} onClick={() => void upload()}>{c.upload}</button>{retry && <button className="btn-secondary" disabled={!canWrite || busy} onClick={() => void retryUpload()}>{c.retry}</button>}</div>{!canWrite && <p className="text-sm text-amber-800">{c.roleRequired}</p>}</section>
        <section className="surface-card p-5"><h2 className="text-lg font-bold">{c.documents}</h2><p className="mt-1 text-sm">{missing.length ? `${c.missing}: ${missing.map((value) => c[value]).join(", ")}` : c.ready}</p>{!visibleDocuments.length && <p className="mt-4 text-sm text-slate-500">{c.noDocuments}</p>}<div className="mt-4 space-y-3">{visibleDocuments.map((doc) => <article key={doc.id} className="rounded-xl border border-violet-100 bg-violet-50/40 p-4 text-sm"><div className="flex flex-wrap justify-between gap-2"><strong>{c[doc.kind]} · {doc.original_filename}</strong><span>{c[doc.status]}</span></div><p className="mt-1 text-xs text-slate-600">{doc.id} · {c.received}: {doc.created_at}</p>{doc.revision_of && <p className="text-xs">{c.revision}: {doc.revision_of}</p>}{doc.physical_location && <p className="text-xs">{c.original}: {doc.physical_location}</p>}<div className="mt-3 flex flex-wrap gap-2">{doc.status !== "pending" && <button className="btn-secondary" onClick={() => void download(doc)}>{c.download}</button>}{doc.status === "pending" && canWrite && <button className="btn-secondary" disabled={!file || busy} onClick={() => void retryPending(doc)}>{c.retry}</button>}</div>{doc.status === "uploaded" && canWrite && <div className="mt-3 space-y-2 border-t border-violet-100 pt-3"><input className="w-full rounded border p-2" aria-label={c.original} placeholder={c.original} value={physical} onChange={(event) => setPhysical(event.target.value)} /><input className="w-full rounded border p-2" aria-label={c.note} placeholder={c.note} value={note} onChange={(event) => setNote(event.target.value)} /><div className="flex gap-2"><button className="btn-primary" disabled={busy} onClick={() => void review(doc, true)}>{c.approve}</button><button className="btn-secondary" disabled={busy} onClick={() => void review(doc, false)}>{c.reject}</button></div></div>}</article>)}</div></section>
        <section className="surface-card p-5"><h2 className="text-lg font-bold">{c.history}</h2>{visibleEvents.map((event) => <p key={event.id} className="border-b py-2 text-xs">{event.occurred_at} · {c.events[event.event_type as keyof typeof c.events] || event.event_type} · {event.document_id}</p>)}</section>
      </>}</div>
    </div>
  </main>;
}

export default function PaperworkInboxPage() {
  if (usesFinanceLocalDemoScreens()) return <FinanceCentreWorkspace initialSection="reconciliation" />;
  return <LivePaperworkInboxPage />;
}
