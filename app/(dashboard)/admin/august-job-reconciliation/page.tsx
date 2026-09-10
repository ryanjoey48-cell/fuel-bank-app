"use client";

import clsx from "clsx";
import { CheckCircle2, FileSpreadsheet, RefreshCw, ShieldCheck, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { Header } from "@/components/header";
import { supabase } from "@/lib/supabase";

type Status = "exact_match" | "probable_match" | "new_job" | "duplicate" | "missing_registration" | "conflict";
type PreviewItem = {
  id: string;
  sourceRowNumber: number;
  sourceFingerprint: string;
  status: Status;
  confidence: number;
  reason: string;
  evidence: string[];
  bossRow: {
    date: string;
    client?: string | null;
    pickup: string;
    dropoff: string;
    vehicleType?: string | null;
    driver?: string | null;
    jobOrderNumber?: string | null;
    mainRegistration: string | null;
    trailerRegistration: string | null;
  };
  existingBooking: {
    id: string;
    booking_date: string;
    client?: { name: string } | null;
    pickup: string;
    dropoff: string;
    vehicle: string | null;
    vehicle_registration?: string | null;
    trailer_registration?: string | null;
    driver: string | null;
    job_order_number: string | null;
  } | null;
  candidateBookings: Array<{ id: string; booking_date: string; pickup: string; dropoff: string; driver: string | null; job_order_number: string | null }>;
  proposedValues: {
    vehicle_registration: string | null;
    trailer_registration: string | null;
  };
};

type Approval = {
  approved: boolean;
  mode: "update_existing" | "new_job" | "reject";
  existingBookingId?: string | null;
  vehicleRegistration?: string | null;
  trailerRegistration?: string | null;
};

const statusClass: Record<Status, string> = {
  exact_match: "border-emerald-200 bg-emerald-50 text-emerald-700",
  probable_match: "border-amber-200 bg-amber-50 text-amber-800",
  new_job: "border-sky-200 bg-sky-50 text-sky-700",
  duplicate: "border-slate-200 bg-slate-50 text-slate-600",
  missing_registration: "border-rose-200 bg-rose-50 text-rose-700",
  conflict: "border-red-200 bg-red-50 text-red-700"
};

async function adminRequest<T>(init: RequestInit) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Authentication required.");
  const response = await fetch("/api/admin/august-job-reconciliation", {
    ...init,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(init.headers ?? {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "August reconciliation request failed.");
  return payload as T;
}

function FileInput({ label, file, onChange }: { label: string; file: File | null; onChange: (file: File | null) => void }) {
  return (
    <label className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      <span className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-800">
        <FileSpreadsheet className="h-4 w-4 text-brand-700" />
        {label}
      </span>
      <input type="file" accept=".xlsx,.xls,.csv" onChange={(event) => onChange(event.target.files?.[0] ?? null)} className="block w-full text-sm text-slate-600" />
      <span className="mt-2 block truncate text-xs font-semibold text-slate-500">{file?.name ?? "No file selected"}</span>
    </label>
  );
}

export default function AugustJobReconciliationPage() {
  const [bossFile, setBossFile] = useState<File | null>(null);
  const [bookingFile, setBookingFile] = useState<File | null>(null);
  const [driversFile, setDriversFile] = useState<File | null>(null);
  const [items, setItems] = useState<PreviewItem[]>([]);
  const [batchId, setBatchId] = useState("");
  const [summary, setSummary] = useState<Record<string, number> | null>(null);
  const [approvals, setApprovals] = useState<Record<string, Approval>>({});
  const [dateFilter, setDateFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<Status | "">("");
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  const approvedCount = useMemo(() => Object.values(approvals).filter((approval) => approval.approved).length, [approvals]);
  const dailyTotals = useMemo(() => {
    const totals = new Map<string, Record<Status | "total", number>>();
    for (const item of items) {
      const existing = totals.get(item.bossRow.date) ?? {
        total: 0,
        exact_match: 0,
        probable_match: 0,
        new_job: 0,
        duplicate: 0,
        missing_registration: 0,
        conflict: 0
      };
      existing.total += 1;
      existing[item.status] += 1;
      totals.set(item.bossRow.date, existing);
    }
    return [...totals.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [items]);
  const filteredItems = useMemo(
    () => items
      .filter((item) => !dateFilter || item.bossRow.date === dateFilter)
      .filter((item) => !statusFilter || item.status === statusFilter),
    [dateFilter, items, statusFilter]
  );

  const preview = async () => {
    if (!bossFile || !bookingFile || !driversFile) {
      setError("Please select all three Excel files.");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const formData = new FormData();
      formData.set("bossFile", bossFile);
      formData.set("bookingFile", bookingFile);
      formData.set("driversFile", driversFile);
      const response = await adminRequest<{ batch: { id: string }; summary: Record<string, number>; items: PreviewItem[] }>({
        method: "POST",
        body: formData
      });
      setBatchId(response.batch.id);
      setItems(response.items);
      setSummary(response.summary);
      setApprovals({});
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create preview.");
    } finally {
      setLoading(false);
    }
  };

  const updateApproval = (item: PreviewItem, patch: Partial<Approval>) => {
    setApprovals((current) => ({
      ...current,
      [item.sourceFingerprint]: (() => {
        const previous = current[item.sourceFingerprint];
        return {
          approved: patch.approved ?? previous?.approved ?? false,
          mode: patch.mode ?? previous?.mode ?? (item.status === "new_job" ? "new_job" : "update_existing"),
          existingBookingId: patch.existingBookingId ?? previous?.existingBookingId ?? item.existingBooking?.id ?? null,
          vehicleRegistration: patch.vehicleRegistration ?? previous?.vehicleRegistration ?? item.proposedValues.vehicle_registration,
          trailerRegistration: patch.trailerRegistration ?? previous?.trailerRegistration ?? item.proposedValues.trailer_registration
        };
      })()
    }));
  };

  const bulkApproveExact = () => {
    const next: Record<string, Approval> = {};
    for (const item of items) {
      if (item.status !== "exact_match" || !item.existingBooking) continue;
      next[item.sourceFingerprint] = {
        approved: true,
        mode: "update_existing",
        existingBookingId: item.existingBooking.id,
        vehicleRegistration: item.proposedValues.vehicle_registration,
        trailerRegistration: item.proposedValues.trailer_registration
      };
    }
    setApprovals((current) => ({ ...current, ...next }));
  };

  const apply = async () => {
    setApplying(true);
    setError(null);
    try {
      const response = await adminRequest<{ summary: Record<string, unknown> }>({
        method: "POST",
        body: JSON.stringify({
          action: "apply",
          batchId,
          approvals: Object.entries(approvals).map(([rowFingerprint, approval]) => ({ rowFingerprint, ...approval }))
        })
      });
      setResult(response.summary);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to apply approvals.");
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="space-y-5">
      <Header title="August Job Reconciliation" description="Preview, review, and safely apply 1-7 August 2026 Booking Diary registration/job updates." />

      <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
        <div className="flex gap-2">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <p>Preview first. Bulk approval is restricted to exact matches. Existing jobs only update main/trailer registration and modified-by audit fields; Google Maps, route, creator, and notes are preserved.</p>
        </div>
      </section>

      <section className="grid gap-3 lg:grid-cols-3">
        <FileInput label="Jobs August.xlsx" file={bossFile} onChange={setBossFile} />
        <FileInput label="Booking diary 1-08 to 7-08.xlsx" file={bookingFile} onChange={setBookingFile} />
        <FileInput label="drivers-report (8).xlsx" file={driversFile} onChange={setDriversFile} />
      </section>

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={preview} disabled={loading} className="btn-primary gap-2 disabled:opacity-60">
          <RefreshCw className={clsx("h-4 w-4", loading && "animate-spin")} />
          {loading ? "Creating preview..." : "Create preview"}
        </button>
        <button type="button" onClick={bulkApproveExact} disabled={!items.some((item) => item.status === "exact_match")} className="btn-secondary gap-2 disabled:opacity-50">
          <CheckCircle2 className="h-4 w-4" />
          Bulk approve exact matches
        </button>
        <button type="button" onClick={apply} disabled={!batchId || approvedCount === 0 || applying} className="btn-primary gap-2 disabled:opacity-60">
          Apply {approvedCount} approved rows
        </button>
      </div>

      {error ? <p className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{error}</p> : null}
      {result ? <pre className="overflow-auto rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-xs text-emerald-900">{JSON.stringify(result, null, 2)}</pre> : null}

      {summary ? (
        <>
          <section className="grid gap-2 sm:grid-cols-3 xl:grid-cols-7">
            {Object.entries(summary).map(([key, value]) => (
              <div key={key} className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
                <p className="text-[11px] font-bold uppercase text-slate-500">{key.replaceAll("_", " ")}</p>
                <p className="text-2xl font-black text-slate-900">{Number(value).toLocaleString()}</p>
              </div>
            ))}
          </section>
          <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-xs font-bold text-slate-600">
                Date
                <select value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} className="mt-1 block rounded-lg border border-slate-200 px-3 py-2 text-sm">
                  <option value="">All dates</option>
                  {dailyTotals.map(([date]) => <option key={date} value={date}>{date}</option>)}
                </select>
              </label>
              <label className="text-xs font-bold text-slate-600">
                Status
                <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as Status | "")} className="mt-1 block rounded-lg border border-slate-200 px-3 py-2 text-sm">
                  <option value="">All statuses</option>
                  {(["exact_match", "probable_match", "new_job", "missing_registration", "conflict", "duplicate"] as Status[]).map((status) => (
                    <option key={status} value={status}>{status.replaceAll("_", " ")}</option>
                  ))}
                </select>
              </label>
              <p className="pb-2 text-sm font-semibold text-slate-600">{filteredItems.length.toLocaleString()} rows shown</p>
            </div>
            <div className="mt-3 grid gap-2 lg:grid-cols-7">
              {dailyTotals.map(([date, totals]) => (
                <button
                  type="button"
                  key={date}
                  onClick={() => setDateFilter(dateFilter === date ? "" : date)}
                  className={clsx("rounded-lg border px-3 py-2 text-left text-xs shadow-sm", dateFilter === date ? "border-brand-300 bg-brand-50" : "border-slate-200 bg-slate-50")}
                >
                  <p className="font-black text-slate-900">{date}</p>
                  <p className="mt-1 text-slate-600">Total {totals.total} | Exact {totals.exact_match}</p>
                  <p className="text-slate-600">Prob {totals.probable_match} | New {totals.new_job}</p>
                  <p className="text-slate-600">Missing {totals.missing_registration} | Conflict {totals.conflict}</p>
                </button>
              ))}
            </div>
          </section>
        </>
      ) : null}

      {filteredItems.length ? (
        <section className="space-y-3">
          {filteredItems.map((item) => {
            const approval = approvals[item.sourceFingerprint];
            return (
              <article key={item.sourceFingerprint} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <span className={clsx("inline-flex rounded-full border px-2 py-1 text-xs font-bold", statusClass[item.status])}>{item.status.replaceAll("_", " ")}</span>
                    <p className="mt-2 text-sm font-semibold text-slate-900">Boss row {item.sourceRowNumber}: {item.bossRow.date} | {item.bossRow.pickup} to {item.bossRow.dropoff}</p>
                    <p className="text-xs text-slate-500">{item.reason} ({Math.round(item.confidence * 100)}%)</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => updateApproval(item, { approved: true })} disabled={["duplicate", "missing_registration", "conflict"].includes(item.status)} className="btn-secondary min-h-[36px] gap-1 px-3 text-xs disabled:opacity-40">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Approve
                    </button>
                    <button type="button" onClick={() => updateApproval(item, { approved: false, mode: "reject" })} className="btn-secondary min-h-[36px] gap-1 px-3 text-xs">
                      <XCircle className="h-3.5 w-3.5" />
                      Reject
                    </button>
                  </div>
                </div>
                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  <div className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-sm">
                    <p className="font-bold text-slate-800">Boss spreadsheet</p>
                    <p>Client: {item.bossRow.client || "-"}</p>
                    <p>Driver: {item.bossRow.driver || "-"}</p>
                    <p>Vehicle type: {item.bossRow.vehicleType || "-"}</p>
                    <p>Main registration: {item.bossRow.mainRegistration || "-"}</p>
                    <p>Trailer registration: {item.bossRow.trailerRegistration || "-"}</p>
                    <p>Job/reference: {item.bossRow.jobOrderNumber || "-"}</p>
                  </div>
                  <div className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-sm">
                    <p className="font-bold text-slate-800">Existing Booking Diary</p>
                    {item.existingBooking ? (
                      <>
                        <p>Client: {item.existingBooking.client?.name || "-"}</p>
                        <p>Route: {item.existingBooking.pickup} to {item.existingBooking.dropoff}</p>
                        <p>Driver: {item.existingBooking.driver || "-"}</p>
                        <p>Vehicle: {item.existingBooking.vehicle || "-"}</p>
                        <p>Main registration: {item.existingBooking.vehicle_registration || "-"}</p>
                        <p>Trailer registration: {item.existingBooking.trailer_registration || "-"}</p>
                        <p>Job/reference: {item.existingBooking.job_order_number || "-"}</p>
                      </>
                    ) : <p>No safe existing match selected.</p>}
                  </div>
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-[1fr_1fr_1fr]">
                  <label className="text-xs font-semibold text-slate-600">
                    Correct existing entry
                    <select
                      value={approval?.existingBookingId ?? item.existingBooking?.id ?? ""}
                      onChange={(event) => updateApproval(item, { existingBookingId: event.target.value, mode: "update_existing" })}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    >
                      <option value="">No existing entry</option>
                      {item.existingBooking ? <option value={item.existingBooking.id}>{item.existingBooking.pickup} to {item.existingBooking.dropoff}</option> : null}
                      {item.candidateBookings.map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>{candidate.booking_date} | {candidate.pickup} to {candidate.dropoff} | {candidate.driver || "-"}</option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs font-semibold text-slate-600">
                    Proposed main registration
                    <input value={approval?.vehicleRegistration ?? item.proposedValues.vehicle_registration ?? ""} onChange={(event) => updateApproval(item, { vehicleRegistration: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                  </label>
                  <label className="text-xs font-semibold text-slate-600">
                    Proposed trailer registration
                    <input value={approval?.trailerRegistration ?? item.proposedValues.trailer_registration ?? ""} onChange={(event) => updateApproval(item, { trailerRegistration: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                  </label>
                </div>
                <p className="mt-2 text-xs text-slate-500">Evidence: {item.evidence.join(", ") || "-"}</p>
                {item.candidateBookings.length ? (
                  <div className="mt-3 rounded-lg border border-slate-100 bg-white p-3">
                    <p className="text-xs font-bold uppercase text-slate-500">Best candidates and why review is needed</p>
                    <div className="mt-2 grid gap-2">
                      {item.candidateBookings.slice(0, 5).map((candidate) => (
                        <div key={candidate.id} className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700">
                          <p className="font-bold">{candidate.booking_date} | {candidate.pickup} to {candidate.dropoff}</p>
                          <p>Driver: {candidate.driver || "-"} | Ref: {candidate.job_order_number || "-"}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}
        </section>
      ) : null}
    </div>
  );
}
