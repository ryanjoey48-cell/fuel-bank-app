"use client";

import { ArrowLeft, Check, Clock3, ExternalLink, MapPin, Phone, RefreshCw, Truck } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLanguage } from "@/lib/language-provider";
import { buildDriverDirectionsUrl, DRIVER_JOB_EVENT_TYPES, type DriverJobEvent, type DriverPortalJob, type DriverRouteLocation } from "@/lib/driver-portal";
import { getPortalVehicleTypeLabel } from "@/lib/driver-vehicle-types";

const copy = {
  en: {
    back: "Back to jobs", title: "Your job", pickup: "Pickup", dropoff: "Drop-off", timePending: "Time not set",
    vehicle: "Vehicle", trailer: "Trailer", vehicleType: "Vehicle type", jobReference: "Job order", customer: "Customer",
    notAssigned: "Not assigned", route: "Route", navigation: "Navigation", moreNav: "More navigation options", depot: "From depot", current: "From my location",
    pickupToDropoff: "Open route in Google Maps", pickupDirections: "To pickup", delivery: "To drop-off", progress: "Progress", details: "Job details", help: "Need help?", call: "Call Atip",
    actions: ["Arrived at pickup", "Leave pickup", "Arrived at delivery", "Complete job"],
    steps: ["Arrived at pickup", "Left pickup", "Arrived at delivery", "Job completed"],
    statuses: ["Ready", "At pickup", "En route", "At delivery", "Completed"],
    loading: "Loading progress…", unavailable: "Unable to load progress. Refresh to try again.", saveError: "Unable to save progress. Refresh before trying again.",
    saved: "Progress saved.", saving: "Saving…", locating: "Checking location…", locationMissing: "Saved without GPS.", gps: "GPS is optional.", completed: "Job completed", refresh: "Refresh",
    missingRoute: "Route locations are missing. Contact operations.", next: "Next action", confirm: "Complete this job?", confirmHelp: "This records the final completion time.", cancel: "Cancel"
  },
  th: {
    back: "กลับไปยังงาน", title: "งานของคุณ", pickup: "จุดรับ", dropoff: "จุดส่ง", timePending: "ยังไม่กำหนดเวลา",
    vehicle: "รถ", trailer: "หางพ่วง", vehicleType: "ประเภทรถ", jobReference: "เลขงาน", customer: "ลูกค้า",
    notAssigned: "ยังไม่ระบุ", route: "เส้นทาง", navigation: "นำทาง", moreNav: "ตัวเลือกนำทางเพิ่มเติม", depot: "จากคลัง", current: "จากตำแหน่งฉัน",
    pickupToDropoff: "เปิดเส้นทางใน Google Maps", pickupDirections: "ไปจุดรับ", delivery: "ไปจุดส่ง", progress: "ความคืบหน้า", details: "รายละเอียดงาน", help: "ต้องการความช่วยเหลือ?", call: "โทรหา Atip",
    actions: ["ถึงจุดรับ", "ออกจากจุดรับ", "ถึงจุดส่ง", "จบงาน"],
    steps: ["ถึงจุดรับ", "ออกจากจุดรับแล้ว", "ถึงจุดส่ง", "จบงานแล้ว"],
    statuses: ["พร้อม", "ถึงจุดรับ", "กำลังไปจุดส่ง", "ถึงจุดส่ง", "จบงานแล้ว"],
    loading: "กำลังโหลด…", unavailable: "โหลดความคืบหน้าไม่ได้ กรุณารีเฟรช", saveError: "บันทึกไม่สำเร็จ กรุณารีเฟรชก่อนลองอีกครั้ง",
    saved: "บันทึกแล้ว", saving: "กำลังบันทึก…", locating: "กำลังตรวจสอบตำแหน่ง…", locationMissing: "บันทึกโดยไม่มี GPS แล้ว", gps: "GPS ไม่บังคับ", completed: "จบงานแล้ว", refresh: "รีเฟรช",
    missingRoute: "ข้อมูลเส้นทางไม่ครบ กรุณาติดต่อฝ่ายปฏิบัติการ", next: "ขั้นตอนถัดไป", confirm: "ยืนยันจบงาน?", confirmHelp: "ระบบจะบันทึกเวลาจบงาน", cancel: "ยกเลิก"
  }
} as const;

function optionalLocation(): Promise<{ latitude: number | null; longitude: number | null }> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => finish(null, null), 8000);
    function finish(latitude: number | null, longitude: number | null) { clearTimeout(timer); resolve({ latitude, longitude }); }
    if (!navigator.geolocation) return finish(null, null);
    try {
      navigator.geolocation.getCurrentPosition(
        (position) => finish(position.coords.latitude, position.coords.longitude),
        () => finish(null, null),
        { enableHighAccuracy: false, timeout: 7000, maximumAge: 0 }
      );
    } catch { finish(null, null); }
  });
}

function CompletionConfirmation({ labels, onCancel, onConfirm }: {
  labels: (typeof copy)[keyof typeof copy]; onCancel: () => void; onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  return (
    <dialog ref={dialog} aria-labelledby="complete-job-title" onCancel={onCancel} className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-2xl bg-white p-5 shadow-xl backdrop:bg-slate-950/50">
      <h2 id="complete-job-title" className="text-lg font-bold">{labels.confirm}</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">{labels.confirmHelp}</p>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button type="button" autoFocus className="btn-secondary" onClick={onCancel}>{labels.cancel}</button>
        <button type="button" className="min-h-11 rounded-xl bg-orange-600 px-4 font-bold text-white" onClick={onConfirm}>{labels.actions[3]}</button>
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
    const id = ++generation.current; setLoading(true); setLoadError(false);
    try {
      const response = await fetch(endpoint, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || !Array.isArray(payload.events)) throw new Error("Progress unavailable");
      if (id === generation.current) setEvents(payload.events);
    } catch { if (id === generation.current) setLoadError(true); }
    finally { if (id === generation.current) setLoading(false); }
  }, [endpoint]);

  useEffect(() => { const counter = generation; void load(); return () => { counter.current++; }; }, [load]);

  const stage = Math.min(events.length, 4);
  const save = async () => {
    if (busy.current || loading || loadError || stage >= 4) return;
    busy.current = true; setConfirmComplete(false); setSaveError(false); setFeedback(null); setSaving("location");
    try {
      const location = await optionalLocation();
      setSaving("save");
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ eventType: DRIVER_JOB_EVENT_TYPES[stage], ...location }) });
      const payload = await response.json();
      if (!response.ok || !payload.event) throw new Error("Save failed");
      setEvents((current) => [...current, payload.event]);
      setFeedback(location.latitude === null ? "locationMissing" : "saved");
    } catch { setSaveError(true); await load(); }
    finally { busy.current = false; setSaving(null); }
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
  const panel = "rounded-2xl border border-slate-200 bg-white p-4 shadow-sm";

  return (
    <main className={`mx-auto w-full max-w-3xl space-y-3 px-3 pt-3 ${!loading && !loadError && stage >= 4 ? "pb-6" : "pb-28"} sm:px-6 sm:py-5`}>
      <Link href="/driver" className="inline-flex min-h-10 items-center gap-2 text-sm font-bold text-[#152638]"><ArrowLeft className="h-4 w-4" />{labels.back}</Link>

      <header className="rounded-2xl bg-[#152638] p-4 text-white shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-orange-300">EES · {labels.title}</p>
            <h1 className="mt-2 break-words text-2xl font-black">{job.clientName || job.jobOrderNumber || labels.title}</h1>
            <p className="mt-2 break-words text-base font-semibold text-white/90">{job.pickupName} <span className="text-orange-300">→</span> {job.dropoffName}</p>
          </div>
          <span className="shrink-0 rounded-full bg-white/15 px-3 py-1 text-xs font-bold">{loading || loadError ? "—" : labels.statuses[stage]}</span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-white/75">
          <span>{formattedDate}</span>
          <span className="inline-flex items-center gap-1.5"><Clock3 className="h-4 w-4 text-orange-300" />{job.pickupTime?.slice(0, 5) || labels.timePending}</span>
          <span className="inline-flex items-center gap-1.5"><Truck className="h-4 w-4" />{job.vehicleRegistration || "—"}</span>
        </div>
      </header>

      <section className="rounded-2xl border border-orange-200 bg-orange-50 p-4">
        <p className="text-xs font-black uppercase tracking-[0.15em] text-orange-700">{labels.next}</p>
        {loading ? <p className="mt-2 text-sm text-slate-500">{labels.loading}</p> : loadError ? <p className="mt-2 text-sm text-rose-700">{labels.unavailable}</p> : stage >= 4 ? (
          <p className="mt-2 rounded-xl bg-emerald-50 p-3 font-bold text-emerald-800">✓ {labels.completed}</p>
        ) : (
          <>
            <button type="button" disabled={!!saving} onClick={() => stage === 3 ? setConfirmComplete(true) : void save()} className="mt-3 min-h-12 w-full rounded-xl bg-orange-600 px-4 text-base font-black text-white disabled:opacity-60">
              {saving ? (saving === "location" ? labels.locating : labels.saving) : labels.actions[stage]}
            </button>
            <p className="mt-2 text-xs text-slate-500">{labels.gps}</p>
          </>
        )}
      </section>

      <section className={panel} aria-labelledby="job-route">
        <h2 id="job-route" className="font-bold text-[#152638]">{labels.route}</h2>
        <div className="mt-3 space-y-3">
          {[{ label: labels.pickup, name: job.pickupName, address: job.pickupAddress, color: "text-orange-600" }, { label: labels.dropoff, name: job.dropoffName, address: job.dropoffAddress, color: "text-[#152638]" }].map((stop) => (
            <div key={stop.label} className="flex gap-3">
              <MapPin className={`mt-0.5 h-5 w-5 shrink-0 ${stop.color}`} />
              <div className="min-w-0">
                <p className="text-xs font-bold text-slate-400">{stop.label}</p>
                <p className="mt-0.5 font-black text-slate-900">{stop.name || labels.notAssigned}</p>
                {stop.address && stop.address !== stop.name ? <p className="mt-1 break-words text-sm leading-5 text-slate-500">{stop.address}</p> : null}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className={panel} aria-labelledby="job-navigation">
        <h2 id="job-navigation" className="font-bold text-[#152638]">{labels.navigation}</h2>
        {pickupToDropoffUrl ? <a className="mt-3 flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#152638] px-4 font-black text-white" href={pickupToDropoffUrl} target="_blank" rel="noreferrer">{labels.pickupToDropoff}<ExternalLink className="h-4 w-4" /></a> : <p className="mt-2 text-sm text-amber-800">{labels.missingRoute}</p>}
        <details className="mt-2 rounded-xl border border-slate-200 px-3">
          <summary className="cursor-pointer py-3 text-sm font-bold text-[#152638]">{labels.moreNav}</summary>
          <div className="grid grid-cols-2 gap-2 pb-3">
            {depotUrl ? <a className="min-h-10 rounded-lg border border-slate-200 px-2 py-2 text-center text-sm font-semibold" href={depotUrl} target="_blank" rel="noreferrer">{labels.depot}</a> : null}
            {currentUrl ? <a className="min-h-10 rounded-lg border border-slate-200 px-2 py-2 text-center text-sm font-semibold" href={currentUrl} target="_blank" rel="noreferrer">{labels.current}</a> : null}
            {pickupUrl ? <a className="min-h-10 rounded-lg border border-slate-200 px-2 py-2 text-center text-sm font-semibold" href={pickupUrl} target="_blank" rel="noreferrer">{labels.pickupDirections}</a> : null}
            {deliveryUrl ? <a className="min-h-10 rounded-lg border border-slate-200 px-2 py-2 text-center text-sm font-semibold" href={deliveryUrl} target="_blank" rel="noreferrer">{labels.delivery}</a> : null}
          </div>
        </details>
      </section>

      <section className={panel} aria-labelledby="job-progress">
        <div className="flex items-center justify-between gap-2">
          <h2 id="job-progress" className="font-bold text-[#152638]">{labels.progress}</h2>
          <button type="button" className="inline-flex min-h-10 items-center gap-1 text-xs font-bold text-[#152638] disabled:opacity-50" disabled={loading || !!saving} onClick={() => void load()}><RefreshCw className="h-4 w-4" />{labels.refresh}</button>
        </div>
        {!loading && !loadError ? <ol className="mt-3 space-y-2">{DRIVER_JOB_EVENT_TYPES.map((type, index) => {
          const event = events.find((entry) => entry.eventType === type);
          const current = !event && index === stage;
          return <li key={type} className="flex items-start gap-3">
            <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${event ? "bg-emerald-100 text-emerald-700" : current ? "bg-orange-600 text-white" : "bg-slate-100 text-slate-400"}`}>{event ? <Check className="h-4 w-4" /> : index + 1}</span>
            <div className="min-w-0 flex-1"><p className={`text-sm font-bold ${event || current ? "text-slate-900" : "text-slate-400"}`}>{labels.steps[index]}</p>{event ? <p className="text-xs text-slate-500">{formatTimestamp(event.eventTime)}{event.latitude !== null && event.longitude !== null ? " · GPS" : ""}</p> : null}</div>
          </li>;
        })}</ol> : null}
        {saveError ? <p className="mt-3 text-sm font-semibold text-rose-700">{labels.saveError}</p> : null}
        {feedback ? <p className="mt-3 text-sm font-semibold text-emerald-700">{labels.saved}{feedback === "locationMissing" ? ` ${labels.locationMissing}` : ""}</p> : null}
      </section>

      <details className={`${panel} p-0`}>
        <summary className="cursor-pointer px-4 py-4 font-bold text-[#152638]">{labels.details}</summary>
        <dl className="border-t border-slate-100 px-4 pb-3 text-sm">
          {[[labels.vehicle, job.vehicleRegistration], [labels.vehicleType, getPortalVehicleTypeLabel(job.vehicleType, language)], [labels.trailer, job.trailerRegistration], [labels.customer, job.clientName], [labels.jobReference, job.jobOrderNumber]].map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4 border-b border-slate-100 py-2 last:border-0"><dt className="text-slate-500">{label}</dt><dd className="max-w-[65%] break-words text-right font-semibold text-slate-900">{value || labels.notAssigned}</dd></div>
          ))}
        </dl>
      </details>

      <section className={panel}>
        <div className="flex items-center justify-between gap-3">
          <div><h2 className="font-bold text-[#152638]">{labels.help}</h2><p className="mt-1 text-sm text-slate-600">Atip Punpanung · +66 6 5789 6654</p></div>
          <a href="tel:+66657896654" className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-bold text-[#152638]"><Phone className="h-4 w-4" />{labels.call}</a>
        </div>
      </section>

      <Link href="/driver" className="inline-flex min-h-11 items-center gap-2 text-sm font-bold text-[#152638]"><ArrowLeft className="h-4 w-4" />{labels.back}</Link>

      {confirmComplete ? <CompletionConfirmation labels={labels} onCancel={() => setConfirmComplete(false)} onConfirm={() => void save()} /> : null}
    </main>
  );
}
