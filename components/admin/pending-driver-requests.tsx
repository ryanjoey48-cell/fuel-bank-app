"use client";

import { CheckCircle2, Clock3, RefreshCw, XCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  fetchDriverAccessRequests,
  fetchAccessRequestDrivers,
  reviewDriverAccessRequest,
  type DriverAccessDriverOption,
  type DriverAccessRequest
} from "@/lib/account-management";
import { useLanguage } from "@/lib/language-provider";

export function PendingDriverRequests() {
  const { language } = useLanguage();
  const [requests, setRequests] = useState<DriverAccessRequest[]>([]);
  const [drivers, setDrivers] = useState<DriverAccessDriverOption[]>([]);
  const [canReview, setCanReview] = useState(false);
  const [driverByRequest, setDriverByRequest] = useState<Record<string, string>>({});
  const [rejectionReason, setRejectionReason] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [driverError, setDriverError] = useState<string | null>(null);
  const [driversLoading, setDriversLoading] = useState(true);
  const [success, setSuccess] = useState<string | null>(null);
  const copy = language === "th"
    ? { eyebrow: "คำขอสิทธิ์เข้าใช้งาน", title: "คำขอสิทธิ์ที่รออนุมัติ", empty: "ไม่มีคำขอที่รออนุมัติ", driver: "คนขับ", office: "พนักงานสำนักงาน", role: "ประเภทที่ขอ", status: "รออนุมัติ", link: "เชื่อมกับข้อมูลคนขับเดิม", choose: "เลือกคนขับ", approve: "อนุมัติ", reject: "ปฏิเสธ", reason: "เหตุผลในการปฏิเสธ (ไม่บังคับ)", refresh: "รีเฟรช", restricted: "เฉพาะ Joey Ryan เท่านั้นที่สามารถอนุมัติหรือปฏิเสธคำขอได้" }
    : { eyebrow: "Access requests", title: "Pending access requests", empty: "No pending access requests", driver: "Driver", office: "Office Staff", role: "Requested type", status: "Pending", link: "Link to existing driver", choose: "Select driver", approve: "Approve", reject: "Reject", reason: "Rejection reason (optional)", refresh: "Refresh", restricted: "Only Joey Ryan can approve or reject access requests." };

  const load = useCallback(async () => {
    setLoading(true);
    setRequestError(null);
    try {
      const result = await fetchDriverAccessRequests();
      setRequests(result.requests);
      setCanReview(result.canReview);
    } catch (caught) {
      setRequestError(caught instanceof Error ? caught.message : "Unable to load access requests.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDrivers = useCallback(async () => {
    setDriversLoading(true);
    setDriverError(null);
    setDrivers([]);
    try {
      const result = await fetchAccessRequestDrivers();
      setDrivers(result.drivers);
    } catch (caught) {
      setDriverError(caught instanceof Error ? caught.message : "Unable to load active drivers.");
    } finally {
      setDriversLoading(false);
    }
  }, []);

  useEffect(() => { void load(); void loadDrivers(); }, [load, loadDrivers]);

  const review = async (request: DriverAccessRequest, decision: "approved" | "rejected") => {
    const driverId = driverByRequest[request.id];
    if (!canReview) {
      setError(copy.restricted);
      return;
    }
    if (decision === "approved" && request.requestedAccountType === "driver" && (driversLoading || driverError || !drivers.some((driver) => driver.id === driverId))) {
      setError(language === "th" ? "กรุณาเลือกข้อมูลคนขับเดิม" : "Select an existing driver before approval.");
      return;
    }
    setSavingId(request.id);
    setError(null);
    setSuccess(null);
    try {
      await reviewDriverAccessRequest(request.id, {
        decision,
        driverId,
        rejectionReason: rejectionReason[request.id]
      });
      setRequests((current) => current.filter((item) => item.id !== request.id));
      setSuccess(language === "th" ? `${request.fullName}: ${decision === "approved" ? "อนุมัติแล้ว" : "ปฏิเสธแล้ว"}` : `${request.fullName}: request ${decision}.`);
      window.dispatchEvent(new Event("fuel-bank:user-updated"));
      void load();
      void loadDrivers();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to review driver request.");
    } finally {
      setSavingId(null);
    }
  };

  return (
    <section className="mb-4 overflow-hidden rounded-[1.4rem] border border-amber-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-100 bg-amber-50/60 px-4 py-4 sm:px-5">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-amber-700">{copy.eyebrow}</p>
          <h2 className="mt-1 text-xl font-semibold text-slate-950">{copy.title}</h2>
        </div>
        <button type="button" onClick={() => { void load(); void loadDrivers(); }} className="btn-secondary gap-2">
          <RefreshCw className="h-4 w-4" /> {copy.refresh}
        </button>
      </div>
      {!loading && !canReview ? <p className="mx-4 mt-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700 sm:mx-5">{copy.restricted}</p> : null}
      {error ? <p className="mx-4 mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-800 sm:mx-5">{error}</p> : null}
      {requestError ? <p role="alert" className="mx-4 mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 sm:mx-5">{language === "th" ? "โหลดคำขอไม่สำเร็จ กรุณารีเฟรช" : "Could not load access requests. Please refresh."} {requestError}</p> : null}
      {success ? <p role="status" className="mx-4 mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 sm:mx-5">{success}</p> : null}
      <div className="grid gap-3 p-4 sm:p-5 xl:grid-cols-2">
        {loading ? <p className="text-sm text-slate-500">Loading…</p> : null}
        {!loading && !requestError && requests.length === 0 ? (
          <div className="xl:col-span-2 rounded-xl border border-dashed border-slate-200 px-4 py-7 text-center text-sm font-semibold text-slate-500">{copy.empty}</div>
        ) : null}
        {requests.map((request) => (
          <article key={request.id} className="rounded-2xl border border-slate-200 p-4">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-700"><Clock3 className="h-5 w-5" /></span>
              <div className="min-w-0">
                <h3 className="font-bold text-slate-950">{request.fullName}</h3>
                <p className="mt-1 break-all text-xs text-slate-500">{request.email}</p>
                <p className="mt-1 text-xs text-slate-500">{request.phone}</p>
                <p className="mt-2 text-xs font-bold text-brand-700">{copy.role}: {request.requestedAccountType === "driver" ? copy.driver : copy.office}</p>
                <span className="mt-2 inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-black uppercase tracking-[0.1em] text-amber-700">{copy.status}</span>
                <p className="mt-1 text-[11px] text-slate-400">{new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(request.requestedAt))}</p>
              </div>
            </div>
            {request.requestedAccountType === "driver" ? (
              <label className="mt-4 block">
                <span className="form-label">{copy.link}</span>
                {driverError ? <span role="alert" className="block text-sm text-rose-700">{driverError}</span> : null}
                {driversLoading ? <span className="block text-sm text-slate-500">{language === "th" ? "กำลังโหลดคนขับ…" : "Loading active drivers…"}</span> : null}
                <select disabled={!canReview || driversLoading || Boolean(driverError)} className="form-input bg-white disabled:cursor-not-allowed disabled:opacity-60" value={driverByRequest[request.id] ?? ""} onChange={(event) => setDriverByRequest((current) => ({ ...current, [request.id]: event.target.value }))}>
                  <option value="">{copy.choose}</option>
                  {drivers.map((driver) => <option key={driver.id} value={driver.id}>{driver.name} — ID {driver.id}{driver.vehicleRegistration ? ` — ${driver.vehicleRegistration}` : ""}</option>)}
                </select>
              </label>
            ) : null}
            <input aria-label={copy.reason} className="form-input mt-3 bg-white" maxLength={500} placeholder={copy.reason} value={rejectionReason[request.id] ?? ""} onChange={(event) => setRejectionReason((current) => ({ ...current, [request.id]: event.target.value }))} />
            <div className="mt-4 flex gap-2">
              <button type="button" disabled={!canReview || savingId === request.id} onClick={() => void review(request, "approved")} className="btn-primary flex-1 gap-2 disabled:cursor-not-allowed disabled:opacity-50"><CheckCircle2 className="h-4 w-4" />{copy.approve}</button>
              <button type="button" disabled={!canReview || savingId === request.id} onClick={() => void review(request, "rejected")} className="btn-secondary flex-1 gap-2 text-rose-700 disabled:cursor-not-allowed disabled:opacity-50"><XCircle className="h-4 w-4" />{copy.reject}</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
