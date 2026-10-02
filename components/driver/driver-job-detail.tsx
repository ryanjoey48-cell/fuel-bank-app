"use client";

import { ArrowDown, ArrowLeft, Check, Clock3, ExternalLink, MapPin, Phone, RefreshCw, Truck } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLanguage } from "@/lib/language-provider";
import { buildDriverDirectionsUrl, DRIVER_JOB_EVENT_TYPES, type DriverJobEvent, type DriverPortalJob, type DriverRouteLocation } from "@/lib/driver-portal";
import { getPortalVehicleTypeLabel } from "@/lib/driver-vehicle-types";

const copy = {
  en: {
    back: "Back to jobs", title: "Your job", pickup: "Pickup", dropoff: "Drop-off", timePending: "Time not set",
    vehicle: "Vehicle registration", trailer: "Trailer", vehicleType: "Vehicle type", jobReference: "Job order", customer: "Customer",
    notAssigned: "Not assigned", route: "Route", navigation: "Navigation", depot: "Start from depot", current: "Start from current location",
    pickupToDropoff: "Pickup → Drop-off", pickupDirections: "Directions to pickup", delivery: "Directions to drop-off", progress: "Job progress", details: "Job details", help: "Need help with this job?", call: "Call Atip",
    actions: ["Arrived at pickup", "Leaving pickup", "Arrived at delivery", "Complete job"],
    steps: ["Arrived at pickup", "Left pickup", "Arrived at delivery", "Job completed"],
    statuses: ["Ready", "Arrived at pickup", "En route to delivery", "Arrived at delivery", "Completed"],
    loading: "Loading job progress…", unavailable: "Unable to load job progress. Refresh to try again.",
    saveError: "Unable to save progress. Refresh to check the latest status before trying again.",
    saved: "Progress saved to EES.", saving: "Saving…", locating: "Checking location…", locationMissing: "Location not available. Progress was saved without GPS.",
    gps: "Location is optional. We will ask for your location when you record progress.", completed: "Job completed", refresh: "Refresh progress",
    missingRoute: "Route locations are missing. Contact operations for directions.", next: "Next step", confirm: "Confirm job completion?", confirmHelp: "This records the final completion timestamp. Only confirm when this job is finished.", cancel: "Cancel"
  },
  th: {
    back: "กลับไปยังงาน", title: "งานของคุณ", pickup: "จุดรับสินค้า", dropoff: "จุดส่งสินค้า", timePending: "ยังไม่กำหนดเวลา",
    vehicle: "ทะเบียนรถ", trailer: "หางพ่วง", vehicleType: "ประเภทรถ", jobReference: "เลขงาน", customer: "ลูกค้า",
    notAssigned: "ยังไม่ระบุ", route: "เส้นทาง", navigation: "นำทาง", depot: "เริ่มจากสำนักงาน/คลัง", current: "เริ่มจากตำแหน่งปัจจุบัน",
    pickupToDropoff: "จุดรับสินค้า → จุดส่งสินค้า", pickupDirections: "นำทางไปจุดรับสินค้า", delivery: "นำทางไปจุดส่งสินค้า", progress: "ความคืบหน้างาน", details: "รายละเอียดงาน", help: "ต้องการความช่วยเหลือเกี่ยวกับงานนี้หรือไม่?", call: "โทรหา Atip",
    actions: ["ถึงจุดรับสินค้า", "ออกจากจุดรับสินค้า", "ถึงจุดส่งสินค้า", "จบงาน"],
    steps: ["ถึงจุดรับสินค้า", "ออกจากจุดรับสินค้าแล้ว", "ถึงจุดส่งสินค้า", "จบงานแล้ว"],
    statuses: ["พร้อม", "ถึงจุดรับสินค้า", "กำลังไปจุดส่งสินค้า", "ถึงจุดส่งสินค้า", "จบงานแล้ว"],
    loading: "กำลังโหลดความคืบหน้างาน…", unavailable: "ไม่สามารถโหลดความคืบหน้าได้ กรุณารีเฟรชเพื่อลองอีกครั้ง",
    saveError: "บันทึกความคืบหน้าไม่สำเร็จ กรุณารีเฟรชเพื่อตรวจสอบสถานะล่าสุดก่อนลองอีกครั้ง",
    saved: "บันทึกความคืบหน้าใน EES แล้ว", saving: "กำลังบันทึก…", locating: "กำลังตรวจสอบตำแหน่ง…", locationMissing: "ไม่พบตำแหน่ง บันทึกความคืบหน้าโดยไม่มี GPS แล้ว",
    gps: "ตำแหน่งไม่ใช่ข้อมูลบังคับ ระบบจะขอเข้าถึงตำแหน่งเมื่อบันทึกความคืบหน้า", completed: "จบงานแล้ว", refresh: "รีเฟรชความคืบหน้า",
    missingRoute: "ข้อมูลจุดรับหรือส่งไม่ครบ กรุณาติดต่อฝ่ายปฏิบัติการ", next: "ขั้นตอนถัดไป", confirm: "ยืนยันการจบงานหรือไม่?", confirmHelp: "ระบบจะบันทึกเวลาจบงาน ยืนยันเมื่องานนี้เสร็จสิ้นแล้วเท่านั้น", cancel: "ยกเลิก"
  }
} as const;

function optionalLocation(): Promise<{ latitude: number | null; longitude: number | null }> {
  return new Promise((resolve) => {
    // Permission prompts may remain unanswered; never leave the progress button stuck.
    const timer = setTimeout(() => finish(null, null), 8000);
    function finish(latitude: number | null, longitude: number | null) {
      clearTimeout(timer);
      resolve({ latitude, longitude });
    }
    if (!navigator.geolocation) return finish(null, null);
    try {
      navigator.geolocation.getCurrentPosition(
        (position) => finish(position.coords.latitude, position.coords.longitude),
        () => finish(null, null), { enableHighAccuracy: false, timeout: 7000, maximumAge: 0 }
      );
    } catch { finish(null, null); }
  });
}

function CompletionConfirmation({ labels, onCancel, onConfirm }: {
  labels: (typeof copy)[keyof typeof copy]; onCancel: () => void; onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return (
    <dialog ref={dialog} aria-labelledby="complete-job-title" onCancel={onCancel}
      className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-2xl bg-white p-5 shadow-xl backdrop:bg-slate-950/50">
      <h2 id="complete-job-title" className="text-lg font-bold">{labels.confirm}</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">{labels.confirmHelp}</p>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button type="button" autoFocus className="btn-secondary" onClick={onCancel}>{labels.cancel}</button>
        <button type="button" className="btn-primary" onClick={onConfirm}>{labels.actions[3]}</button>
      </div>
    </dialog>
  );
}

export function DriverJobDetail({ job, depot }: { job: DriverPortalJob; depot: DriverRouteLocation }) {
  const { language } = useLanguage();
  const labels = copy[language];
  const [events, setEvents] = useState<DriverJobEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [saving, setSaving] = useState<"location" | "save" | null>(null);
  const [feedback, setFeedback] = useState<"saved" | "locationMissing" | null>(null);
  const [confirmComplete, setConfirmComplete] = useState(false);
  const busy = useRef(false);
  const generation = useRef(0);
  const endpoint = `/api/driver/jobs/${encodeURIComponent(job.id)}/events`;
  const load = useCallback(async () => {
    const id = ++generation.current;
    setLoading(true);
    setLoadError(false);
    try {
      const response = await fetch(endpoint, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || !Array.isArray(payload.events)) throw new Error("Progress unavailable");
      if (id === generation.current) setEvents(payload.events);
    } catch {
      if (id === generation.current) setLoadError(true);
    } finally {
      if (id === generation.current) setLoading(false);
    }
  }, [endpoint]);
  useEffect(() => {
    const counter = generation;
    void load();
    return () => { counter.current++; };
  }, [load]);
  const stage = Math.min(events.length, 4);
  const save = async () => {
    if (busy.current || loading || loadError || stage >= 4) return;
    busy.current = true;
    setConfirmComplete(false);
    setSaveError(false);
    setFeedback(null);
    setSaving("location");
    try {
      const location = await optionalLocation();
      setSaving("save");
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventType: DRIVER_JOB_EVENT_TYPES[stage], ...location }) });
      const payload = await response.json();
      if (!response.ok || !payload.event) throw new Error("Save failed");
      setEvents((current) => [...current, payload.event]);
      setFeedback(location.latitude === null ? "locationMissing" : "saved");
    } catch {
      setSaveError(true);
      await load();
    } finally {
      busy.current = false;
      setSaving(null);
    }
  };
  const formatTimestamp = (value: string) => new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-GB", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok"
  }).format(new Date(value));
  const formattedDate = new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-GB", {
    day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Bangkok"
  }).format(new Date(`${job.bookingDate}T12:00:00+07:00`));
  const depotUrl = buildDriverDirectionsUrl(job, "depot", depot);
  const currentUrl = buildDriverDirectionsUrl(job, "current", depot);
  const deliveryUrl = buildDriverDirectionsUrl(job, "delivery", depot);
  const pickupToDropoffUrl = buildDriverDirectionsUrl(job, "pickup-to-dropoff", depot);
  const pickupUrl = buildDriverDirectionsUrl(job, "pickup", depot);
  const panel = "rounded-[1.25rem] border border-slate-200 bg-[#fffdf8] p-3 shadow-sm sm:p-5";
  const navLink = "flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-center text-sm font-bold sm:min-h-12 sm:gap-2 sm:px-4 sm:py-3";
  const shortNavigation = language === "th"
    ? ["จากคลัง", "จากตำแหน่งฉัน", "ไปจุดรับ", "ไปจุดส่ง"]
    : ["From depot", "From my location", "To pickup", "To drop-off"];
  const navigationLabel = (full: string, index: number) => <><span className="sm:hidden">{shortNavigation[index]}</span><span className="hidden sm:inline">{full}</span><ExternalLink className="h-4 w-4 shrink-0" /></>;

  return <main className={`driver-job-detail mx-auto w-full max-w-3xl space-y-3 px-3 pt-2 ${!loading && !loadError && stage >= 4 ? "pb-4" : "pb-28"} sm:px-6 sm:pt-4 sm:pb-5`}>
    <Link href="/driver" className="inline-flex min-h-10 items-center gap-2 text-sm font-bold text-brand-700"><ArrowLeft className="h-4 w-4" />{labels.back}</Link>
    <header className="rounded-[1.25rem] bg-[#211336] p-3 text-white shadow-sm sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-bold uppercase tracking-[0.16em] text-accent-300">EES · {labels.title}</p><span className="rounded-full bg-white/15 px-3 py-1 text-xs font-bold">{loading || loadError ? "—" : labels.statuses[stage]}</span></div>
      <h1 className="mt-2 break-words text-xl font-black tracking-tight sm:mt-3 sm:text-2xl">{job.clientName || job.jobOrderNumber || labels.title}</h1>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm sm:mt-3 sm:gap-3"><span>{formattedDate}</span><span className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-2 py-1 font-bold sm:px-3 sm:py-2"><Clock3 className="h-4 w-4 text-accent-300" />{job.pickupTime?.slice(0, 5) || labels.timePending}</span></div>
      {job.jobOrderNumber ? <p className="mt-3 text-xs text-white/75">{labels.jobReference}: {job.jobOrderNumber}</p> : null}
    </header>
    <section className={panel} aria-labelledby="job-route"><h2 id="job-route" className="mb-2 font-bold text-slate-950 sm:mb-4">{labels.route}</h2>
      {[{ label: labels.pickup, name: job.pickupName, address: job.pickupAddress }, { label: labels.dropoff, name: job.dropoffName, address: job.dropoffAddress }].map((stop, index) => <div key={stop.label}>
        {index ? <ArrowDown className="my-2 ml-2 h-4 w-4 text-brand-400" /> : null}<div className="flex gap-3"><MapPin className={`mt-1 h-5 w-5 shrink-0 ${index ? "text-brand-700" : "text-accent-600"}`} /><div className="min-w-0"><p className="text-xs font-bold text-slate-500">{stop.label}</p><p className="mt-1 break-words font-bold text-slate-950">{stop.name || labels.notAssigned}</p>{stop.address && stop.address !== stop.name ? <p className="mt-1 break-words text-sm leading-5 text-slate-600">{stop.address}</p> : null}</div></div>
      </div>)}
    </section>
    <section className={panel} aria-labelledby="job-navigation"><h2 id="job-navigation" className="mb-3 font-bold text-slate-950">{labels.navigation}</h2><div className="grid grid-cols-2 gap-2">
      {pickupToDropoffUrl ? <a className={`${navLink} col-span-2 bg-brand-700 text-white hover:bg-brand-800`} href={pickupToDropoffUrl} target="_blank" rel="noreferrer">{labels.pickupToDropoff}<ExternalLink className="h-4 w-4 shrink-0" /></a> : null}
      {depotUrl ? <a aria-label={labels.depot} className={`${navLink} border border-brand-200 text-brand-800 hover:bg-brand-50`} href={depotUrl} target="_blank" rel="noreferrer">{navigationLabel(labels.depot, 0)}</a> : null}
      {currentUrl ? <a aria-label={labels.current} className={`${navLink} border border-brand-200 text-brand-800 hover:bg-brand-50`} href={currentUrl} target="_blank" rel="noreferrer">{navigationLabel(labels.current, 1)}</a> : null}
      {pickupUrl ? <a aria-label={labels.pickupDirections} className={`${navLink} border border-brand-200 text-brand-800 hover:bg-brand-50`} href={pickupUrl} target="_blank" rel="noreferrer">{navigationLabel(labels.pickupDirections, 2)}</a> : null}
      {deliveryUrl ? <a aria-label={labels.delivery} className={`${navLink} border border-brand-200 text-brand-800 hover:bg-brand-50`} href={deliveryUrl} target="_blank" rel="noreferrer">{navigationLabel(labels.delivery, 3)}</a> : null}
    </div>{!currentUrl ? <p className="mt-2 text-sm text-amber-800">{labels.missingRoute}</p> : null}</section>
    <section className={panel} aria-labelledby="job-progress"><div className="flex items-center justify-between gap-2"><h2 id="job-progress" className="font-bold text-slate-950">{labels.progress}</h2><button type="button" className="inline-flex min-h-10 items-center gap-2 text-xs font-bold text-brand-700 disabled:opacity-50" disabled={loading || !!saving} onClick={() => void load()}><RefreshCw className="h-4 w-4" />{labels.refresh}</button></div>
      {loading ? <p role="status" className="mt-3 text-sm text-slate-500">{labels.loading}</p> : loadError ? <p role="alert" className="mt-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{labels.unavailable}</p> : <>
        <div className={`${stage < 4 ? "fixed inset-x-0 bottom-[calc(52px+env(safe-area-inset-bottom))] z-30 border-t border-slate-200 bg-[#fffdf8] px-3 py-2 shadow-lg sm:static sm:border-0 sm:p-0 sm:shadow-none" : "mt-3"} sm:mt-3`}><div className="mx-auto max-w-3xl">{stage < 4 ? <><p className="mb-1 text-xs font-semibold text-slate-500">{labels.next}</p><button type="button" disabled={!!saving} onClick={() => stage === 3 ? setConfirmComplete(true) : void save()} className="flex min-h-11 w-full items-center justify-center rounded-xl bg-accent-600 px-4 py-2 font-bold text-white hover:bg-accent-700 disabled:cursor-wait disabled:opacity-60 sm:min-h-12 sm:py-3">{saving ? saving === "location" ? labels.locating : labels.saving : labels.actions[stage]}</button><p className="mt-1 text-xs leading-4 text-slate-500">{language === "th" ? "GPS ไม่บังคับ · ขอเฉพาะเมื่อบันทึก" : "GPS optional · requested only when recording"}</p></> : <p className="rounded-xl bg-emerald-50 p-3 font-bold text-emerald-800">✓ {labels.completed}</p>}</div></div>
        <ol className="mt-4">{DRIVER_JOB_EVENT_TYPES.map((type, index) => { const event = events.find((entry) => entry.eventType === type); return <li key={type} aria-current={!event && index === stage ? "step" : undefined} className="relative flex min-h-14 gap-3 pb-3 last:min-h-0 last:pb-0"><span className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${event ? "bg-emerald-100 text-emerald-700" : index === stage ? "bg-brand-700 text-white ring-4 ring-brand-50" : "bg-slate-100 text-slate-400"}`}>{event ? <Check className="h-4 w-4" /> : index + 1}</span>{index < 3 ? <span aria-hidden="true" className={`absolute bottom-0 left-[15px] top-8 w-0.5 ${event && events.some((entry) => entry.eventType === DRIVER_JOB_EVENT_TYPES[index + 1]) ? "bg-emerald-300" : "bg-slate-200"}`} /> : null}<div className="min-w-0 flex-1 pt-1"><p className={`text-sm font-bold ${event || index === stage ? "text-slate-900" : "text-slate-400"}`}>{labels.steps[index]}</p>{event ? <div className="flex flex-wrap items-center gap-x-2 text-xs text-slate-500"><time dateTime={event.eventTime}>{formatTimestamp(event.eventTime)}</time>{event.latitude !== null && event.longitude !== null && Number.isFinite(event.latitude) && Number.isFinite(event.longitude) ? <span className="inline-flex items-center gap-1 text-emerald-700"><MapPin className="h-3 w-3" />GPS</span> : null}</div> : null}</div></li>; })}</ol>
      </>}
      {saveError ? <p role="alert" className="mt-3 text-sm font-semibold text-rose-700">{labels.saveError}</p> : null}
      {feedback ? <p role="status" className="mt-3 text-sm font-semibold text-emerald-700">{labels.saved}{feedback === "locationMissing" ? ` ${labels.locationMissing}` : ""}</p> : null}
    </section>
    <section className={panel}><h2 className="flex items-center gap-2 font-bold text-slate-950"><Truck className="h-5 w-5 text-brand-700" />{labels.details}</h2><dl className="mt-2 divide-y divide-slate-100 text-sm sm:mt-3">{[[labels.vehicle, job.vehicleRegistration], [labels.vehicleType, getPortalVehicleTypeLabel(job.vehicleType, language)], [labels.trailer, job.trailerRegistration], [labels.customer, job.clientName], [labels.jobReference, job.jobOrderNumber]].map(([label, value]) => <div key={label} className="flex justify-between gap-4 py-2 sm:py-2.5"><dt className="text-slate-500">{label}</dt><dd className="max-w-[65%] break-words text-right font-semibold text-slate-900">{value || labels.notAssigned}</dd></div>)}</dl></section>
    <section className={panel}><h2 className="font-bold text-slate-950">{labels.help}</h2><div className="mt-2 flex flex-wrap items-center justify-between gap-2 sm:block"><div><p className="text-sm font-semibold text-slate-700">Atip Punpanung</p><p className="mt-1 text-sm text-slate-500">+66 6 5789 6654</p></div><a href="tel:+66657896654" className={`${navLink} border border-brand-200 text-brand-800 hover:bg-brand-50 sm:mt-3`}><Phone className="h-4 w-4" />{labels.call}</a></div></section>
    <Link href="/driver" className="inline-flex min-h-11 items-center gap-2 text-sm font-bold text-brand-700"><ArrowLeft className="h-4 w-4" />{labels.back}</Link>
    {confirmComplete ? <CompletionConfirmation labels={labels} onCancel={() => setConfirmComplete(false)} onConfirm={() => void save()} /> : null}
  </main>;
}
