"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useFinanceFixture } from "@/components/finance-fixture-provider";
import { demoCopy } from "@/lib/finance-demo-copy";
import {
  batchIssues,
  batchTotal,
  blockers,
  bookingReference,
  confirmedWorkOrder,
  displayJobLabel,
  docsFor,
  expenseTotal,
  mismatches,
  missingDocs,
  packManifest,
  PRICE_LISTS,
  ready,
  SOURCE_WORKBOOK_SHA256,
  weekOf,
  type Batch,
  type Booking,
  type DocKind,
  type ExpenseKind,
  type Role
} from "@/lib/finance-demo-centre";
import { getAccessToken } from "@/lib/account-management";
import { useLanguage } from "@/lib/language-provider";
import { supabase, supabaseConfigError } from "@/lib/supabase";

/** Read-only hydrate: pull an original Booking Diary row into local Finance memory. */
function useDiaryBookingHydrate(paramId: string | null) {
  const { state, ensureDiaryBooking } = useFinanceFixture();
  useEffect(() => {
    if (!paramId || supabaseConfigError) return;
    if (state.bookings.some((item) => item.id === paramId)) return;
    let active = true;
    void (async () => {
      const { data, error } = await supabase
        .from("booking_diary")
        .select("id,booking_id,client_id,booking_date,pickup_time,pickup,dropoff,driver,vehicle,vehicle_registration,job_order_number,client:clients(name)")
        .eq("id", paramId)
        .maybeSingle();
      if (!active || error || !data) return;
      const row = data as {
        id: string;
        booking_id?: string | null;
        client_id?: string | null;
        booking_date: string;
        pickup_time?: string | null;
        pickup: string;
        dropoff: string;
        driver?: string | null;
        vehicle?: string | null;
        vehicle_registration?: string | null;
        job_order_number?: string | null;
        client?: { name?: string | null } | { name?: string | null }[] | null;
      };
      const clientRel = Array.isArray(row.client) ? row.client[0] : row.client;
      ensureDiaryBooking({
        id: row.id,
        booking_id: row.booking_id,
        client_id: row.client_id,
        client_name: clientRel?.name ?? null,
        booking_date: row.booking_date,
        pickup_time: row.pickup_time,
        pickup: row.pickup,
        dropoff: row.dropoff,
        driver: row.driver,
        vehicle: row.vehicle,
        vehicle_registration: row.vehicle_registration,
        job_order_number: row.job_order_number
      });
    })();
    return () => { active = false; };
  }, [paramId, state.bookings, ensureDiaryBooking]);
}

const card = "surface-card p-5";
const input = "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm";
const btn = "btn-primary";
const btnSec = "btn-secondary";

function money(value: number) {
  return `฿${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(value)}`;
}

function SimulatedTag({ th }: { th: boolean }) {
  return (
    <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-950">
      {th ? "จำลอง · SIMULATED · ไม่ออกใบแจ้งหนี้จริง" : "SIMULATED · DEMO DATA · NO REAL INVOICE ISSUANCE"}
    </p>
  );
}

function FixtureShell({ title, hint, children, nav }: { title: string; hint?: string; children: ReactNode; nav?: ReactNode }) {
  const { language } = useLanguage();
  const th = language === "th";
  return (
    <main className="mx-auto max-w-7xl space-y-5 px-4 py-6 text-slate-900">
      <header className="space-y-2">
        <SimulatedTag th={th} />
        <h1 className="text-2xl font-bold">{title}</h1>
        {hint ? <p className="text-sm text-slate-600">{hint}</p> : null}
        {nav}
      </header>
      {children}
    </main>
  );
}

function useFixtureCopy() {
  const { language } = useLanguage();
  return demoCopy[language];
}

function jobSelectLabel(job: Booking, c: (typeof demoCopy)["en"]) {
  return displayJobLabel(job, c.awaitingGreenSheet);
}

function workOrderDisplay(job: Booking, c: (typeof demoCopy)["en"]) {
  const wo = confirmedWorkOrder(job);
  return wo || c.awaitingGreenSheet;
}

function mapError(message: string, c: (typeof demoCopy)["en"]) {
  const code = message.split(":")[0];
  return c.errors[code as keyof typeof c.errors] ?? message;
}

function RoleDenied({ role, c }: { role: Role; c: (typeof demoCopy)["en"] }) {
  return <p className="mt-2 text-sm font-semibold text-amber-800">{c.requiresRole}: {c.roles[role]}</p>;
}

function StatusBadge({ job, c, sourceMode }: { job: Booking; c: (typeof demoCopy)["en"]; sourceMode: boolean }) {
  const label = job.status === "verified" && sourceMode ? c.demoVerified : c.statuses[job.status];
  const tone =
    job.status === "verified" ? "bg-emerald-100 text-emerald-800"
      : job.status === "discrepancy" ? "bg-rose-100 text-rose-800"
        : job.status === "missing_paperwork" ? "bg-amber-100 text-amber-800"
          : "bg-slate-100 text-slate-700";
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${tone}`}>{label}</span>
      {job.origin === "booking_diary_local_test" ? (
        <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-900">LOCAL TEST · diary UUID</span>
      ) : null}
    </span>
  );
}

function jobFromQuery(state: { bookings: Booking[] }, param: string | null, fallback: string) {
  if (param && state.bookings.some((b) => b.id === param)) return param;
  return fallback;
}

const kinds: DocKind[] = ["green_order", "parking", "toll"];

const financeNav = (th: boolean) => (
  <nav className="flex flex-wrap gap-2 pt-1">
    <Link className={btnSec} href="/finance-centre">{th ? "ศูนย์การเงิน" : "Finance Centre"}</Link>
    <Link className={btnSec} href="/paperwork-inbox">{th ? "กล่องรับเอกสาร" : "Paperwork Inbox"}</Link>
    <Link className={btnSec} href="/job-verification">{th ? "ตรวจสอบงาน" : "Job Verification"}</Link>
    <Link className={btnSec} href="/finance-cost-pricing">{th ? "ค่าใช้จ่ายและราคา" : "Expenses & Pricing"}</Link>
    <Link className={btnSec} href="/weekly-billing">{th ? "วางบิลรายสัปดาห์" : "Weekly Billing"}</Link>
    <Link className={btnSec} href="/invoice-approval">{th ? "อนุมัติร่าง" : "Invoice Approval"}</Link>
    <Link className={btnSec} href="/document-packs">{th ? "ชุดเอกสาร" : "Document Packs"}</Link>
  </nav>
);

export function FinanceFixturePaperworkInbox() {
  const c = useFixtureCopy();
  const { language } = useLanguage();
  const th = language === "th";
  const params = useSearchParams();
  const bookingParam = params.get("booking");
  useDiaryBookingHydrate(bookingParam);
  const { state, role, dispatch, error, clearError } = useFinanceFixture();
  const [jobId, setJobId] = useState(state.bookings[0]?.id ?? "");
  const [docId, setDocId] = useState(state.documents[0]?.id ?? "");
  const [physicalRef, setPhysicalRef] = useState("Cabinet A / Folder 04");
  const [newKind, setNewKind] = useState<DocKind>("green_order");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");

  useEffect(() => {
    setJobId(jobFromQuery(state, bookingParam, jobId));
  }, [bookingParam, state.bookings]);

  const doc = state.documents.find((d) => d.id === docId) ?? state.documents[0];
  const job = state.bookings.find((b) => b.id === jobId) ?? state.bookings[0];
  const unmatched = state.documents.filter((d) => !d.confirmedBy);

  async function uploadTestAttachment(file: File) {
    if (!doc || role !== "office") return;
    setUploading(true);
    setUploadError("");
    try {
      const token = await getAccessToken().catch(() => null);
      const form = new FormData();
      form.set("documentId", doc.id);
      form.set("file", file);
      const response = await fetch("/api/finance-local-store/attachments", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: form
      });
      const payload = (await response.json()) as { storedName?: string; fileName?: string; error?: string };
      if (!response.ok || !payload.storedName) throw new Error(payload.error || "UPLOAD_FAILED");
      dispatch({
        type: "set_document_attachment",
        documentId: doc.id,
        jobId: doc.suggestedJobId,
        fileName: payload.fileName || file.name,
        storedName: payload.storedName
      });
    } catch (caught) {
      setUploadError(caught instanceof Error ? caught.message : "UPLOAD_FAILED");
    } finally {
      setUploading(false);
    }
  }

  if (!job) {
    return (
      <FixtureShell title={c.views.inbox} hint={c.viewHints.inbox} nav={financeNav(th)}>
        <p className="text-sm text-slate-600">
          {bookingParam
            ? (th ? "กำลังเชื่อมงานจากสมุดจองต้นฉบับ…" : "Linking original Booking Diary record…")
            : (th ? "ยังไม่มีงานในหน่วยความจำการเงิน" : "No jobs in local Finance memory yet.")}
        </p>
      </FixtureShell>
    );
  }

  return (
    <FixtureShell title={c.views.inbox} hint={c.viewHints.inbox} nav={financeNav(th)}>
      {error ? (
        <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          {mapError(error, c)}
          <button type="button" className="ml-2 font-bold underline" onClick={clearError}>{th ? "ปิด" : "Dismiss"}</button>
        </p>
      ) : null}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,.9fr)]">
        <section className={card}>
          <h2 className="font-bold">{c.inboxQueue} · {unmatched.length} {c.unmatched}</h2>
          <div className="mt-3 max-h-[520px] space-y-2 overflow-auto">
            {state.documents.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => { setDocId(item.id); setJobId(item.suggestedJobId); }}
                className={`w-full rounded-xl border p-3 text-left text-sm ${doc?.id === item.id ? "border-violet-500 bg-violet-50" : "border-slate-200"}`}
              >
                <strong>{c.kinds[item.kind]}</strong>
                <p className="text-xs text-slate-500">{item.title}</p>
                <p className="text-xs">{item.confirmedBy ? c.matched : c.unmatched}</p>
              </button>
            ))}
          </div>
        </section>
        <div className="space-y-5">
          <section className={card}>
            <h2 className="font-bold">{c.preview}</h2>
            <p className="mt-3 rounded-xl border border-dashed border-violet-200 p-6 text-center text-sm">{doc?.preview}</p>
            <label className="mt-4 block text-xs font-semibold">{c.physical}
              <input className={input} value={doc?.confirmedBy ? doc.physicalRef : physicalRef} disabled={!!doc?.confirmedBy} onChange={(e) => setPhysicalRef(e.target.value)} />
            </label>
            <label className="mt-3 block text-xs font-semibold">
              {th ? "ไฟล์ทดสอบในเครื่อง (ไม่ใช่เอกสารลูกค้าจริง)" : "Local test attachment (not a production customer document)"}
              <input
                className={`${input} mt-1`}
                type="file"
                accept="application/pdf,image/jpeg,image/png,image/webp"
                disabled={role !== "office" || uploading || !doc}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void uploadTestAttachment(file);
                }}
              />
            </label>
            {doc?.attachmentFileName ? (
              <p className="mt-2 text-xs text-emerald-800">
                {th ? "แนบแล้ว" : "Attached"}: {doc.attachmentFileName}
                {doc.attachmentStoredName ? (
                  <>
                    {" · "}
                    <button
                      type="button"
                      className="font-semibold underline"
                      onClick={() => {
                        void (async () => {
                          const token = await getAccessToken().catch(() => null);
                          const response = await fetch(`/api/finance-local-store/attachments?storedName=${encodeURIComponent(doc.attachmentStoredName!)}`, {
                            headers: token ? { Authorization: `Bearer ${token}` } : undefined
                          });
                          if (!response.ok) {
                            setUploadError(th ? "เปิดไฟล์ทดสอบไม่สำเร็จ" : "Unable to open test attachment");
                            return;
                          }
                          const blob = await response.blob();
                          const url = URL.createObjectURL(blob);
                          window.open(url, "_blank", "noopener,noreferrer");
                          window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
                        })();
                      }}
                    >
                      {th ? "เปิดไฟล์ทดสอบ" : "Open test file"}
                    </button>
                  </>
                ) : null}
              </p>
            ) : null}
            {uploadError ? <p role="alert" className="mt-2 text-xs text-rose-700">{uploadError}</p> : null}
            <button
              type="button"
              className={`${btn} mt-3`}
              disabled={role !== "office" || !!doc?.confirmedBy}
              onClick={() => doc && dispatch({ type: "confirm_document", documentId: doc.id, jobId: doc.suggestedJobId, physicalRef })}
            >
              {c.confirm}
            </button>
            {role !== "office" ? <RoleDenied role="office" c={c} /> : null}
            {error === "DEMO_ROLE_REQUIRED" && role !== "office" ? <RoleDenied role="office" c={c} /> : null}
          </section>
          <section className={card}>
            <h2 className="font-bold">{c.newDoc}</h2>
            <div className="grid gap-2 sm:grid-cols-2">
              <select className={input} value={jobId} onChange={(e) => setJobId(e.target.value)} aria-label={c.selectJob}>
                {state.bookings.map((b) => <option key={b.id} value={b.id}>{jobSelectLabel(b, c)}</option>)}
              </select>
              <select className={input} value={newKind} onChange={(e) => setNewKind(e.target.value as DocKind)}>
                {kinds.map((k) => <option key={k} value={k}>{c.kinds[k]}</option>)}
              </select>
            </div>
            <button type="button" className={`${btnSec} mt-3`} disabled={role !== "office"} onClick={() => dispatch({ type: "add_document", jobId, kind: newKind })}>
              {c.addDocument}
            </button>
            {role !== "office" ? <RoleDenied role="office" c={c} /> : null}
            <p className="mt-2 text-xs text-slate-500">{jobSelectLabel(job, c)} · {c.multi}</p>
          </section>
        </div>
      </div>
    </FixtureShell>
  );
}

export function FinanceFixtureJobVerification() {
  const c = useFixtureCopy();
  const { language } = useLanguage();
  const th = language === "th";
  const params = useSearchParams();
  const bookingParam = params.get("booking");
  useDiaryBookingHydrate(bookingParam);
  const { state, role, dispatch, error, clearError } = useFinanceFixture();
  const [jobId, setJobId] = useState(state.bookings[0]?.id ?? "");
  const [decision, setDecision] = useState("");
  const [greenSheetWo, setGreenSheetWo] = useState("");
  const [expenseKind, setExpenseKind] = useState<ExpenseKind>("parking");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseRef, setExpenseRef] = useState("");

  useEffect(() => {
    setJobId(jobFromQuery(state, bookingParam, jobId));
  }, [bookingParam, state.bookings]);

  const job = state.bookings.find((b) => b.id === jobId);
  const missing = job ? missingDocs(state, jobId) : [];
  const holdJobs = state.bookings.filter((b) => b.status === "discrepancy" || b.status === "needs_recheck");

  useEffect(() => {
    if (!job) return;
    setGreenSheetWo(confirmedWorkOrder(job) || job.returned.workOrder || "");
  }, [jobId, job]);

  if (!job) {
    return (
      <FixtureShell title={c.views.verification} hint={c.viewHints.verification} nav={financeNav(th)}>
        <p className="text-sm text-slate-600">
          {bookingParam
            ? (th ? "กำลังเชื่อมงานจากสมุดจองต้นฉบับ…" : "Linking original Booking Diary record…")
            : (th ? "เลือกงานจากสมุดจอง หรือเปิดผ่านปุ่มกระทบยอดงาน" : "Select a job, or open Reconcile Job from the Booking Diary.")}
        </p>
      </FixtureShell>
    );
  }

  return (
    <FixtureShell title={c.views.verification} hint={c.viewHints.verification} nav={financeNav(th)}>
      {error ? (
        <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          {mapError(error, c)}
          <button type="button" className="ml-2 font-bold underline" onClick={clearError}>{th ? "ปิด" : "Dismiss"}</button>
        </p>
      ) : null}
      <div className="grid gap-5 lg:grid-cols-[16rem_1fr]">
        <aside className={`${card} max-h-[75vh] overflow-auto`}>
          <h2 className="font-bold">{c.selectJob}</h2>
          {state.bookings.map((item) => (
            <button key={item.id} type="button" onClick={() => setJobId(item.id)} className={`mt-2 block w-full rounded-lg border p-3 text-left text-sm ${jobId === item.id ? "border-violet-500 bg-violet-50" : "border-slate-200"}`}>
              <strong>{bookingReference(item)}</strong>
              <span className="block text-xs text-slate-600">{workOrderDisplay(item, c)} · {item.client}</span>
              <StatusBadge job={item} c={c} sourceMode={state.mode === "source"} />
            </button>
          ))}
        </aside>
        <div className="space-y-5">
          <section className={card}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-lg font-bold">{bookingReference(job)}</h2>
                <p className="text-sm text-slate-600">{c.workOrder}: {workOrderDisplay(job, c)}</p>
                {job.source ? <p className="text-xs text-amber-800">{c.workOrderConfirmed} · {c.sourceFacts}</p> : null}
              </div>
              <StatusBadge job={job} c={c} sourceMode={state.mode === "source"} />
            </div>
            {!job.workOrderConfirmed ? (
              <section className="mt-4 rounded-xl border border-violet-200 bg-violet-50 p-4">
                <h3 className="font-bold">{c.nextActions.enter_work_order}</h3>
                <p className="mt-1 text-sm text-slate-600">{th ? "กรอกเลขจากใบสั่งงานสีเขียวที่คืน — ไม่ใช่ตอนจอง" : "Enter the number from the returned green sheet — not assigned at booking creation."}</p>
                <label className="mt-3 block text-xs font-semibold">{c.workOrder}
                  <input className={input} value={greenSheetWo} onChange={(e) => setGreenSheetWo(e.target.value)} placeholder={th ? "เช่น 219" : "e.g. 219"} />
                </label>
                <button
                  type="button"
                  className={`${btn} mt-3`}
                  disabled={role !== "office" || greenSheetWo.trim().length < 3}
                  onClick={() => dispatch({ type: "set_returned_work_order", jobId, workOrder: greenSheetWo })}
                >
                  {c.save}
                </button>
                {role !== "office" ? <RoleDenied role="office" c={c} /> : null}
              </section>
            ) : (
              <p className="mt-3 text-sm font-semibold text-emerald-800">{c.workOrderConfirmed}: {confirmedWorkOrder(job)}</p>
            )}
            {job.workOrderConfirmed ? (
              <section className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
                <h3 className="font-bold">{th ? "ค่าใช้จ่ายตอนกระทบยอดใบเขียว (สำนักงาน)" : "Green-sheet matching expenses (Office)"}</h3>
                <p className="mt-1 text-xs text-slate-600">
                  {th
                    ? "บันทึกที่จอด/ค่าทางด่วนตอนจับคู่ใบเขียว — ไม่ใช่ตอนตั้งราคาขาย"
                    : "Record parking/toll while matching the green sheet — not during customer pricing."}
                </p>
                <ul className="mt-2 space-y-1 text-sm">{job.expenses.map((e) => <li key={e.id}>{c.expenses[e.kind]} · {money(e.amount)} · {e.reference}</li>)}</ul>
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  <select className={input} value={expenseKind} onChange={(e) => setExpenseKind(e.target.value as ExpenseKind)}>
                    {(["parking", "toll", "driver_trip", "overtime", "other"] as ExpenseKind[]).map((k) => <option key={k} value={k}>{c.expenses[k]}</option>)}
                  </select>
                  <input className={input} type="number" min="0.01" step="0.01" value={expenseAmount} onChange={(e) => setExpenseAmount(e.target.value)} aria-label={c.amount} />
                  <input className={input} value={expenseRef} onChange={(e) => setExpenseRef(e.target.value)} aria-label={c.reference} placeholder={th ? "เลขอ้างอิงใบเสร็จ" : "Receipt reference"} />
                </div>
                <button
                  type="button"
                  className={`${btn} mt-3`}
                  disabled={role !== "office" || !expenseRef.trim() || Number(expenseAmount) <= 0}
                  onClick={() => {
                    dispatch({ type: "add_expense", jobId, kind: expenseKind, amount: Number(expenseAmount), reference: expenseRef });
                    setExpenseAmount("");
                    setExpenseRef("");
                  }}
                >
                  {c.addExpense}
                </button>
                {role !== "office" ? <RoleDenied role="office" c={c} /> : null}
              </section>
            ) : null}
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-[560px] w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs text-slate-500">
                  <tr><th className="p-2">{c.source}</th><th className="p-2">{state.mode === "source" ? c.workbookBookingFields : c.diary}</th><th className="p-2">{c.returned}</th></tr>
                </thead>
                <tbody>
                  {(["date", "pickup", "delivery", "driver", "vehicle", "workOrder"] as const).map((field) => {
                    const differs = job[field] !== job.returned[field];
                    return (
                      <tr key={field} className={differs ? "bg-rose-50" : ""}>
                        <td className="p-2 font-semibold">{c.fields[field]}</td>
                        <td className="p-2">{field === "workOrder" && !job.workOrderConfirmed ? c.awaitingGreenSheet : job[field]}</td>
                        <td className="p-2">{field === "workOrder" && !job.workOrderConfirmed ? c.awaitingGreenSheet : job.returned[field]}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <h3 className="mt-4 font-bold">{c.documentChecklist}</h3>
            <p className="text-sm text-amber-800">{missing.length ? `${c.missing}: ${missing.map((k) => c.kinds[k]).join(", ")}` : c.ready}</p>
            {job.status === "discrepancy" ? <p className="mt-2 text-sm font-semibold text-rose-800">{c.managerHold}</p> : null}
            {job.status === "needs_recheck" ? <p className="mt-2 text-sm font-semibold text-amber-800">{c.needsReverify}</p> : null}
            <button
              type="button"
              className={`${btn} mt-4`}
              disabled={role !== "office" || job.status === "discrepancy" || job.status === "verified"}
              onClick={() => dispatch({ type: "verify_job", jobId })}
            >
              {c.compare}
            </button>
            {role !== "office" ? <RoleDenied role="office" c={c} /> : null}
          </section>

          {(job.status === "discrepancy" || holdJobs.some((h) => h.id === jobId)) && (
            <section className={card}>
              <h2 className="font-bold">{c.views.management}</h2>
              <p className="text-sm text-slate-600">{mismatches(job).map((f) => c.fields[f]).join(", ") || "—"}</p>
              {job.decision ? <p className="mt-2 rounded-lg bg-emerald-50 p-3 text-sm">{job.decision}</p> : null}
              <textarea className={`${input} min-h-24`} value={decision} onChange={(e) => setDecision(e.target.value)} placeholder={c.decisionExample} />
              <button
                type="button"
                className={`${btn} mt-3`}
                disabled={role !== "management" || job.status !== "discrepancy" || decision.trim().length < 10}
                onClick={() => { dispatch({ type: "resolve_discrepancy", jobId, reason: decision }); setDecision(""); }}
              >
                {c.resolve}
              </button>
              {role !== "management" ? <RoleDenied role="management" c={c} /> : null}
            </section>
          )}

          {holdJobs.length > 1 ? (
            <section className={card}>
              <h2 className="font-bold">{c.kpiHolds}</h2>
              <ul className="mt-2 space-y-2 text-sm">
                {holdJobs.filter((h) => h.id !== jobId).map((h) => (
                  <li key={h.id}>
                    <button type="button" className="font-semibold text-violet-800 underline" onClick={() => setJobId(h.id)}>{jobSelectLabel(h, c)}</button>
                    · <StatusBadge job={h} c={c} sourceMode={state.mode === "source"} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </div>
    </FixtureShell>
  );
}

export function FinanceFixtureExpensesPricing() {
  const c = useFixtureCopy();
  const { language } = useLanguage();
  const th = language === "th";
  const params = useSearchParams();
  const bookingParam = params.get("booking");
  useDiaryBookingHydrate(bookingParam);
  const { state, role, dispatch, error, clearError } = useFinanceFixture();
  const [jobId, setJobId] = useState(state.bookings[0]?.id ?? "");
  const [manualPrice, setManualPrice] = useState("");
  const [priceReason, setPriceReason] = useState("");

  useEffect(() => {
    setJobId(jobFromQuery(state, bookingParam, jobId));
  }, [bookingParam, state.bookings]);

  const job = state.bookings.find((b) => b.id === jobId) ?? state.bookings[0];
  const list = job ? PRICE_LISTS[job.clientId] : undefined;
  if (!job) {
    return (
      <FixtureShell title={c.views.expenses} hint={c.viewHints.expenses} nav={financeNav(th)}>
        <p className="text-sm text-slate-600">{th ? "ยังไม่มีงานในหน่วยความจำการเงิน" : "No jobs in local Finance memory yet."}</p>
      </FixtureShell>
    );
  }

  return (
    <FixtureShell title={c.views.expenses} hint={c.viewHints.expenses} nav={financeNav(th)}>
      {error ? (
        <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          {mapError(error, c)}
          <button type="button" className="ml-2 font-bold underline" onClick={clearError}>{th ? "ปิด" : "Dismiss"}</button>
        </p>
      ) : null}
      <label className="block text-sm font-semibold">{c.selectJob}
        <select className={input} value={jobId} onChange={(e) => setJobId(e.target.value)}>
          {state.bookings.map((b) => <option key={b.id} value={b.id}>{jobSelectLabel(b, c)}</option>)}
        </select>
      </label>
      {job.source ? (
        <section className={card}>
          <p className="text-xs text-slate-500">{c.sourceFacts} · {job.source.sheet}!{job.source.row} · SHA {SOURCE_WORKBOOK_SHA256.slice(0, 12)}…</p>
          <p className="mt-2 text-sm">{c.workbookAmount}: <strong>{money(job.source.totalCollected)}</strong></p>
        </section>
      ) : null}
      <div className="grid gap-5 lg:grid-cols-2">
        <section className={card}>
          <h2 className="font-bold">{c.expenseLedger}</h2>
          <p className="text-xs text-amber-800">
            {th
              ? "สำนักงานบันทึกค่าใช้จ่ายตอนกระทบยอดใบเขียว หน้านี้เน้นราคาขายของฝ่ายการเงิน"
              : "Office records expenses during green-sheet matching. This screen focuses on Finance customer pricing."}
          </p>
          <p className="mt-2 text-sm">{c.total}: {money(expenseTotal(job))}</p>
          <ul className="mt-2 space-y-1 text-sm">{job.expenses.map((e) => <li key={e.id}>{c.expenses[e.kind]} · {money(e.amount)} · {e.reference}</li>)}</ul>
          {!job.expenses.length ? <p className="mt-2 text-sm text-slate-500">{th ? "ยังไม่มีรายการจาก Job Verification" : "No expenses yet — add them on Job Verification after WO entry."}</p> : null}
        </section>
        <section className={card}>
          <h2 className="font-bold">{c.customerCharge}</h2>
          {list ? (
            <>
              <p className="text-sm">{c.priceList}: {list.name} · {money(list.amount)}</p>
              <button type="button" className={`${btnSec} mt-2`} disabled={role !== "finance" || !ready(state, jobId)} onClick={() => dispatch({ type: "set_price", jobId, source: "list", amount: list.amount })}>{c.applyList}</button>
            </>
          ) : job.price?.source === "workbook" && !job.price.confirmed ? (
            <button type="button" className={`${btn} mt-2`} disabled={role !== "finance" || !ready(state, jobId)} onClick={() => dispatch({ type: "confirm_source_amount", jobId })}>{c.confirmSourceAmount}</button>
          ) : (
            <p className="text-sm text-amber-800">{c.noSourcePriceList}</p>
          )}
          <div className="mt-4 border-t pt-4">
            <h3 className="text-sm font-bold">{c.manualPrice}</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              <input className={input} type="number" value={manualPrice} onChange={(e) => setManualPrice(e.target.value)} aria-label={c.amount} />
              <input className={input} value={priceReason} onChange={(e) => setPriceReason(e.target.value)} placeholder={c.overrideExample} aria-label={c.override} />
            </div>
            <button type="button" className={`${btn} mt-2`} disabled={role !== "finance" || priceReason.trim().length < 10} onClick={() => dispatch({ type: "set_price", jobId, source: "manual", amount: Number(manualPrice), reason: priceReason })}>{c.setManual}</button>
          </div>
          {job.price ? <p className="mt-3 text-sm">{money(job.price.amount)} · {job.price.confirmed ? c.ready : c.awaitingConfirmation}</p> : null}
          {role !== "finance" ? <RoleDenied role="finance" c={c} /> : null}
          <p className="mt-2 text-xs text-slate-500">{c.noAutoAdd}</p>
        </section>
      </div>
    </FixtureShell>
  );
}

export function FinanceFixtureWeeklyBilling() {
  const c = useFixtureCopy();
  const { language } = useLanguage();
  const th = language === "th";
  const { state, role, dispatch, error, clearError } = useFinanceFixture();
  const customers = useMemo(() => [...new Map(state.bookings.map((b) => [b.clientId, b.client])).entries()].map(([id, name]) => ({ id, name })), [state.bookings]);
  const [customerId, setCustomerId] = useState(customers[0]?.id ?? "");
  const [week, setWeek] = useState("2026-01-05");
  const [batchId, setBatchId] = useState(state.batches[0]?.id ?? "");

  const batch = state.batches.find((b) => b.id === batchId) ?? state.batches[0];
  const weeksForCustomer = [...new Set(state.bookings.filter((b) => b.clientId === customerId).map((b) => weekOf(b.date)).filter(Boolean))] as string[];

  useEffect(() => {
    if (batch) setBatchId(batch.id);
  }, [state.batches.length]);

  return (
    <FixtureShell title={c.views.billing} hint={c.viewHints.billing} nav={financeNav(th)}>
      {error ? (
        <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          {mapError(error, c)}
          <button type="button" className="ml-2 font-bold underline" onClick={clearError}>{th ? "ปิด" : "Dismiss"}</button>
        </p>
      ) : null}
      <section className={`${card} grid gap-3 sm:grid-cols-[1fr_1fr_auto]`}>
        <label className="text-xs font-semibold">{c.customer}
          <select className={input} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            {customers.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
        </label>
        <label className="text-xs font-semibold">{c.week}
          <select className={input} value={week} onChange={(e) => setWeek(e.target.value)}>
            {weeksForCustomer.map((w) => <option key={w} value={w}>{w}</option>)}
          </select>
        </label>
        <button type="button" className={`${btn} self-end`} disabled={role !== "finance"} onClick={() => dispatch({ type: "create_batch", clientId: customerId, week })}>{c.createBatch}</button>
        {role !== "finance" ? <RoleDenied role="finance" c={c} /> : null}
      </section>
      {batch ? (
        <>
          <section className={card}>
            <h2 className="font-bold">{c.eligible} · {batch.id}</h2>
            <div className="overflow-x-auto">
              <table className="min-w-[640px] w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="p-2">{c.bookingReference}</th><th className="p-2">{c.workOrder}</th><th className="p-2">{c.blockers}</th><th className="p-2">{c.actions}</th></tr></thead>
                <tbody>
                  {state.bookings.filter((b) => b.clientId === batch.clientId && weekOf(b.date) === batch.week).map((item) => {
                    const reasons = blockers(state, batch, item.id);
                    return (
                      <tr key={item.id} className="border-b">
                        <td className="p-2 font-semibold">{bookingReference(item)}</td>
                        <td className="p-2 text-xs">{workOrderDisplay(item, c)}</td>
                        <td className="p-2 text-xs text-amber-800">{reasons.join(", ") || c.ready}</td>
                        <td className="p-2">
                          <button type="button" className={btnSec} disabled={role !== "finance" || batch.draft || reasons.length > 0} onClick={() => dispatch({ type: "allocate_job", batchId: batch.id, jobId: item.id })}>{c.allocate}</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
          <section className={card}>
            <h2 className="font-bold">{c.sequence}</h2>
            {batch.jobIds.map((id, index) => {
              const item = state.bookings.find((b) => b.id === id)!;
              return (
                <div key={id} className="flex flex-wrap items-center justify-between gap-2 border-b py-2 text-sm">
                  <span><strong>{index + 1}.</strong> {jobSelectLabel(item, c)} · {money(item.price?.amount ?? 0)}</span>
                  <span className="flex gap-2">
                    <button type="button" className={btnSec} disabled={role !== "finance" || batch.draft || index === 0} onClick={() => dispatch({ type: "move_job", batchId: batch.id, jobId: id, direction: -1 })}>{c.moveUp}</button>
                    <button type="button" className={btnSec} disabled={role !== "finance" || batch.draft || index === batch.jobIds.length - 1} onClick={() => dispatch({ type: "move_job", batchId: batch.id, jobId: id, direction: 1 })}>{c.moveDown}</button>
                  </span>
                </div>
              );
            })}
            <p className="mt-3 text-lg font-bold">{c.batchTotal}: {money(batchTotal(state, batch))}</p>
            <button type="button" className={`${btn} mt-3`} disabled={role !== "finance" || batch.draft || batchIssues(state, batch).length > 0} onClick={() => dispatch({ type: "create_draft", batchId: batch.id })}>{c.draftAction}</button>
            <p className="mt-2 text-xs">{c.batchValidation}: {batchIssues(state, batch).length ? batchIssues(state, batch).join(", ") : c.batchValid}</p>
            {batch.draft ? <p className="text-xs text-amber-800">{c.frozen} · <Link className="underline" href="/invoice-approval">{c.views.drafts}</Link></p> : null}
            {role !== "finance" ? <RoleDenied role="finance" c={c} /> : null}
          </section>
        </>
      ) : (
        <p className="text-sm text-slate-500">{c.noBatch}</p>
      )}
    </FixtureShell>
  );
}

export function FinanceFixtureInvoiceApproval() {
  const c = useFixtureCopy();
  const { language } = useLanguage();
  const th = language === "th";
  const { state, role, dispatch, error, clearError } = useFinanceFixture();
  const draftBatches = state.batches.filter((b) => b.draft);
  const draftKey = draftBatches.map((b) => b.id).join("|");
  const [batchId, setBatchId] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  useEffect(() => {
    if (!draftKey) { setBatchId(""); return; }
    const first = draftKey.split("|")[0];
    setBatchId((current) => (draftKey.split("|").includes(current) ? current : first));
  }, [draftKey]);
  const batch = state.batches.find((b) => b.id === batchId) as Batch | undefined;

  return (
    <FixtureShell title={c.views.drafts} hint={c.viewHints.drafts} nav={financeNav(th)}>
      {error ? (
        <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          {mapError(error, c)}
          <button type="button" className="ml-2 font-bold underline" onClick={clearError}>{th ? "ปิด" : "Dismiss"}</button>
        </p>
      ) : null}
      <p className="text-xs font-bold text-amber-800">{c.noIssuance}</p>
      {!draftBatches.length ? <p className="text-sm">{c.noBatch} · <Link href="/weekly-billing" className="underline">{c.views.billing}</Link></p> : (
        <section className={card}>
          <label className="text-sm font-semibold">{c.selectBatch}
            <select className={input} value={batchId} onChange={(e) => setBatchId(e.target.value)}>
              {draftBatches.map((b) => <option key={b.id} value={b.id}>{b.id} · {b.week}</option>)}
            </select>
          </label>
          {batch ? (
            <>
              <p className="mt-2 text-sm font-bold">{c.draftNumber}</p>
              <table className="mt-3 w-full text-sm">
                <thead className="bg-slate-50 text-xs"><tr><th className="p-2">{c.bookingReference}</th><th className="p-2">{c.workOrder}</th><th className="p-2">{c.amount}</th></tr></thead>
                <tbody>
                  {batch.jobIds.map((id, i) => {
                    const job = state.bookings.find((b) => b.id === id)!;
                    return <tr key={id} className="border-b"><td className="p-2">{i + 1}. {bookingReference(job)}</td><td className="p-2">{workOrderDisplay(job, c)}</td><td className="p-2">{money(job.price!.amount)}</td></tr>;
                  })}
                </tbody>
              </table>
              <p className="mt-2 text-right font-bold">{c.total}: {money(batchTotal(state, batch))}</p>
              {batch.rejectedReason ? <p className="mt-2 text-sm text-rose-800">{batch.rejectedReason}</p> : null}
              <div className="mt-4 flex flex-wrap gap-3">
                <button type="button" className={btn} disabled={role !== "approver" || !batch.draft || !!batch.approvedBy} onClick={() => dispatch({ type: "approve_draft", batchId: batch.id })}>{c.approve}</button>
              </div>
              {role !== "approver" ? <RoleDenied role="approver" c={c} /> : null}
              <div className="mt-4 border-t pt-4">
                <label className="text-sm font-semibold">{c.reason}
                  <textarea className={`${input} min-h-20`} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder={c.decisionExample} />
                </label>
                <button type="button" className={`${btnSec} mt-2`} disabled={role !== "approver" || !batch.draft || !!batch.approvedBy || rejectReason.trim().length < 10} onClick={() => { dispatch({ type: "reject_draft", batchId: batch.id, reason: rejectReason }); setRejectReason(""); }}>
                  {th ? "ปฏิเสธร่าง (จำลอง)" : "Reject draft (simulated)"}
                </button>
              </div>
            </>
          ) : null}
        </section>
      )}
    </FixtureShell>
  );
}

export function FinanceFixtureDocumentPacks() {
  const c = useFixtureCopy();
  const { language } = useLanguage();
  const th = language === "th";
  const { state, role, dispatch, error, clearError } = useFinanceFixture();
  const approved = state.batches.filter((b) => b.approvedBy);
  const approvedKey = approved.map((b) => b.id).join("|");
  const [batchId, setBatchId] = useState("");
  useEffect(() => {
    if (!approvedKey) { setBatchId(""); return; }
    const first = approvedKey.split("|")[0];
    setBatchId((current) => (approvedKey.split("|").includes(current) ? current : first));
  }, [approvedKey]);
  const batch = state.batches.find((b) => b.id === batchId);

  return (
    <FixtureShell title={c.views.packs} hint={c.viewHints.packs} nav={financeNav(th)}>
      {error ? (
        <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          {mapError(error, c)}
          <button type="button" className="ml-2 font-bold underline" onClick={clearError}>{th ? "ปิด" : "Dismiss"}</button>
        </p>
      ) : null}
      <p className="text-xs font-bold text-rose-800">{c.neverSend}</p>
      {!approved.length ? <p className="text-sm">{c.approvalRequired} · <Link href="/invoice-approval" className="underline">{c.views.drafts}</Link></p> : (
        <section className={card}>
          <label className="text-sm font-semibold">{c.selectBatch}
            <select className={input} value={batchId} onChange={(e) => setBatchId(e.target.value)}>
              {approved.map((b) => <option key={b.id} value={b.id}>{b.id} · {b.packReady ? c.packReady : c.pending}</option>)}
            </select>
          </label>
          {batch ? (
            <>
              <button type="button" className={`${btn} mt-3`} disabled={role !== "finance" || !batch.approvedBy || batch.packReady} onClick={() => dispatch({ type: "prepare_pack", batchId: batch.id })}>{c.packAction}</button>
              {role !== "finance" ? <RoleDenied role="finance" c={c} /> : null}
              <p className="mt-2 text-xs text-amber-800">{c.layoutNote}</p>
              <ol className="mt-4 space-y-2">
                {packManifest(state, batch).map((item, index) => (
                  <li key={item.key} className="rounded-lg border p-3 text-sm">
                    <span className="mr-2 font-bold text-violet-700">{index + 1}.</span>
                    {item.kind === "draft" ? c.draftNumber : item.label}
                  </li>
                ))}
              </ol>
            </>
          ) : null}
        </section>
      )}
    </FixtureShell>
  );
}
