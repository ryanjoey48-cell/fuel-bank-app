"use client";

import {
  ArrowDown,
  ArrowLeft,
  Check,
  Clock3,
  ExternalLink,
  MapPin,
  Navigation2,
  Phone,
  RefreshCw,
  Truck
} from "lucide-react";
import Link from "next/link";
import { DriverDisclosure } from "./driver-disclosure";
import { DriverRouteOptions } from "./driver-route-options";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLanguage } from "@/lib/language-provider";
import {
  buildDriverDirectionsUrl,
  DRIVER_JOB_EVENT_TYPES,
  type DriverJobEvent,
  type DriverPortalJob,
  type DriverRouteLocation
} from "@/lib/driver-portal";
import { getPortalVehicleTypeLabel } from "@/lib/driver-vehicle-types";

const copy = {
  en: {
    back: "Back to jobs",
    title: "Job",
    pickup: "Pickup",
    dropoff: "Drop-off",
    timePending: "Time not set",
    vehicle: "Vehicle",
    trailer: "Trailer",
    vehicleType: "Vehicle type",
    jobReference: "Job order",
    customer: "Customer",
    notAssigned: "—",
    route: "Route",
    navigation: "Navigation",
    navigateTo: "Navigate to",
    moreNav: "More navigation options",
    depot: "From depot",
    current: "From my location",
    pickupToDropoff: "Open in Google Maps",
    pickupDirections: "To pickup",
    delivery: "To drop-off",
    progress: "Job progress",
    details: "Job details",
    help: "Need help?",
    call: "Call Operations",
    operations: "Operations",
    actions: ["Arrived at pickup", "Leave pickup", "Arrived at delivery", "Complete job"],
    steps: ["Arrived at pickup", "Left pickup", "Arrived at delivery", "Job completed"],
    statuses: ["Ready", "At pickup", "En route", "At delivery", "Completed"],
    loading: "Loading progress…",
    unavailable: "Unable to load progress. Refresh to try again.",
    saveError: "Unable to save progress. Refresh before trying again.",
    saved: "Progress saved.",
    saving: "Saving…",
    locating: "Checking location…",
    locationMissing: "Saved without GPS.",
    gps: "Location will be added if available.",
    completed: "Job completed",
    refresh: "Refresh",
    missingRoute: "Route locations are missing. Contact operations.",
    next: "Next step",
    focus: ["Arrive at pickup", "Leave pickup", "Arrive at delivery", "Complete job"],
    navigatePickup: "Navigate to pickup", navigateDelivery: "Navigate to delivery", fullRoute: "Full route",
    progressShort: ["Pickup", "Leave", "Delivery", "Done"],
    confirm: "Complete this job?",
    confirmHelp: "This records the final completion time.",
    cancel: "Cancel",
    nextStep: "Next",
    takeMeThere: "Take me there"
  },
  th: {
    back: "กลับไปยังงาน",
    title: "งาน",
    pickup: "จุดรับ",
    dropoff: "จุดส่ง",
    timePending: "ยังไม่กำหนดเวลา",
    vehicle: "รถ",
    trailer: "หางพ่วง",
    vehicleType: "ประเภทรถ",
    jobReference: "เลขงาน",
    customer: "ลูกค้า",
    notAssigned: "—",
    route: "เส้นทาง",
    navigation: "การนำทาง",
    navigateTo: "นำทางไป",
    moreNav: "ตัวเลือกนำทางเพิ่มเติม",
    depot: "จากคลัง",
    current: "จากตำแหน่งฉัน",
    pickupToDropoff: "เปิดใน Google Maps",
    pickupDirections: "ไปจุดรับ",
    delivery: "ไปจุดส่ง",
    progress: "สถานะงาน",
    details: "รายละเอียดงาน",
    help: "ต้องการความช่วยเหลือ?",
    call: "โทรหาฝ่ายปฏิบัติการ",
    operations: "ฝ่ายปฏิบัติการ",
    actions: ["ถึงจุดรับ", "ออกจากจุดรับ", "ถึงจุดส่ง", "จบงาน"],
    steps: ["ถึงจุดรับ", "ออกจากจุดรับแล้ว", "ถึงจุดส่ง", "จบงานแล้ว"],
    statuses: ["พร้อม", "ถึงจุดรับ", "กำลังไปจุดส่ง", "ถึงจุดส่ง", "จบงานแล้ว"],
    loading: "กำลังโหลด…",
    unavailable: "โหลดความคืบหน้าไม่ได้ กรุณารีเฟรช",
    saveError: "บันทึกไม่สำเร็จ กรุณารีเฟรชก่อนลองอีกครั้ง",
    saved: "บันทึกแล้ว",
    saving: "กำลังบันทึก…",
    locating: "กำลังตรวจสอบตำแหน่ง…",
    locationMissing: "บันทึกโดยไม่มี GPS แล้ว",
    gps: "ระบบจะบันทึกตำแหน่งถ้าสามารถใช้งานได้",
    completed: "จบงานแล้ว",
    refresh: "รีเฟรช",
    missingRoute: "ข้อมูลเส้นทางไม่ครบ กรุณาติดต่อฝ่ายปฏิบัติการ",
    next: "ขั้นตอนถัดไป",
    focus: ["ไปจุดรับสินค้า", "ออกจากจุดรับสินค้า", "ไปจุดส่งสินค้า", "จบงาน"],
    navigatePickup: "นำทางไปจุดรับ", navigateDelivery: "นำทางไปจุดส่ง", fullRoute: "เส้นทางทั้งหมด",
    progressShort: ["รับสินค้า", "ออกเดินทาง", "ส่งสินค้า", "จบงาน"],
    confirm: "ยืนยันจบงาน?",
    confirmHelp: "ระบบจะบันทึกเวลาจบงาน",
    cancel: "ยกเลิก",
    nextStep: "ถัดไป",
    takeMeThere: "นำทาง"
  }
} as const;

function optionalLocation(): Promise<{ latitude: number | null; longitude: number | null }> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => finish(null, null), 8000);

    function finish(latitude: number | null, longitude: number | null) {
      clearTimeout(timer);
      resolve({ latitude, longitude });
    }

    if (!navigator.geolocation) return finish(null, null);

    try {
      navigator.geolocation.getCurrentPosition(
        (position) => finish(position.coords.latitude, position.coords.longitude),
        () => finish(null, null),
        { enableHighAccuracy: false, timeout: 7000, maximumAge: 0 }
      );
    } catch {
      finish(null, null);
    }
  });
}

function CompletionConfirmation({
  labels,
  onCancel,
  onConfirm
}: {
  labels: (typeof copy)[keyof typeof copy];
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  return (
    <dialog
      ref={dialog}
      aria-labelledby="complete-job-title"
      onCancel={onCancel}
      className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-2xl bg-white p-5 shadow-xl backdrop:bg-slate-950/50"
    >
      <h2 id="complete-job-title" className="text-lg font-bold">{labels.confirm}</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">{labels.confirmHelp}</p>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button type="button" autoFocus className="btn-secondary" onClick={onCancel}>
          {labels.cancel}
        </button>
        <button
          type="button"
          className="min-h-11 rounded-xl driver-primary-action px-4 font-bold text-white"
          onClick={onConfirm}
        >
          {labels.actions[3]}
        </button>
      </div>
    </dialog>
  );
}

export function DriverJobDetail({
  job,
  depot
}: {
  job: DriverPortalJob;
  depot: DriverRouteLocation;
}) {
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
    return () => {
      counter.current++;
    };
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
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventType: DRIVER_JOB_EVENT_TYPES[stage],
          ...location
        })
      });
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

  const formatTimestamp = (value: string) =>
    new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-GB", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Bangkok"
    }).format(new Date(value));

  const formattedDate = new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Bangkok"
  }).format(new Date(`${job.bookingDate}T12:00:00+07:00`));

  const depotUrl = buildDriverDirectionsUrl(job, "depot", depot);
  const currentUrl = buildDriverDirectionsUrl(job, "current", depot);
  const deliveryUrl = buildDriverDirectionsUrl(job, "delivery", depot);
  const pickupToDropoffUrl = buildDriverDirectionsUrl(job, "pickup-to-dropoff", depot);
  const pickupUrl = buildDriverDirectionsUrl(job, "pickup", depot);

  const panel = "driver-surface";
  const destinationIsPickup = stage < 2;
  const destinationName = destinationIsPickup ? job.pickupName : job.dropoffName;
  const destinationAddress = destinationIsPickup ? job.pickupAddress : job.dropoffAddress;
  const navigationUrl = destinationIsPickup ? pickupUrl : deliveryUrl;

  return (
    <main className="driver-active-job mx-auto w-full max-w-3xl space-y-1.5 px-3 pb-4 pt-1 sm:px-6 sm:py-5">
      <Link href="/driver" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-[#152638]"><ArrowLeft className="h-4 w-4" />{labels.back}</Link>
      <header className="driver-job-summary rounded-2xl bg-[#152638] px-4 py-2 text-white shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <h1 className="min-w-0 break-words text-xl font-bold leading-6">{job.clientName || job.jobOrderNumber || labels.title}</h1>
          <span className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-semibold ${!loading && !loadError && stage >= 4 ? "bg-emerald-100 text-emerald-800" : "bg-white/10 text-white"}`}>{loading || loadError ? "—" : labels.statuses[stage]}</span>
        </div>
        <div className="mt-2 grid grid-cols-[minmax(0,1fr)_24px_minmax(0,1fr)] items-center gap-2 text-[15px] font-semibold"><p className="min-w-0 break-words">{job.pickupName || labels.notAssigned}</p><span aria-hidden="true" className="text-center text-slate-400">→</span><p className="min-w-0 break-words text-right">{job.dropoffName || labels.notAssigned}</p></div>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-white/10 pt-2 text-xs text-slate-300"><span>{formattedDate}</span><span className="inline-flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" />{job.pickupTime?.slice(0, 5) || labels.timePending}</span><span className="ml-auto inline-flex items-center gap-1 font-semibold"><Truck className="h-3.5 w-3.5" />{job.vehicleRegistration || "—"}</span></div>
      </header>
      <section className={`${panel} p-3 sm:p-4`} aria-labelledby="job-next-action">
        <h2 id="job-next-action" className="driver-eyebrow driver-accent">{labels.next}</h2>
        {!loading && !loadError && stage < 4 ? <p className="mt-1 text-[15px] font-semibold leading-5 text-[#152638]">{labels.focus[stage]}</p> : null}
        {loading ? <p role="status" className="py-3 text-sm text-slate-500">{labels.loading}</p> : loadError ? <p role="alert" className="py-3 text-sm text-rose-700">{labels.unavailable}</p> : stage >= 4 ? <p role="status" className="mt-2 flex items-center gap-2 rounded-xl bg-emerald-50 p-3 font-bold text-emerald-800"><Check className="h-5 w-5" />{labels.completed}</p> : <>
          <div className="mt-2 flex gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" /><div className="min-w-0"><p className="break-words text-base font-bold leading-5 text-[#152638]">{destinationName || labels.notAssigned}</p>{destinationAddress && destinationAddress !== destinationName ? <p className="mt-1 break-words text-xs leading-4 text-slate-500">{destinationAddress}</p> : null}</div></div>
          <div className="mt-3 border-t border-[var(--driver-border)] pt-3">
            <p className="driver-eyebrow mb-1.5">{labels.takeMeThere}</p>
            {navigationUrl ? <a className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#152638] px-3 py-2.5 text-center text-sm font-bold text-white transition-opacity active:opacity-90" href={navigationUrl} target="_blank" rel="noreferrer"><Navigation2 aria-hidden="true" className="h-4 w-4 shrink-0" /><span className="min-w-0 break-words">{labels.navigateTo} {destinationName || (destinationIsPickup ? labels.pickup : labels.dropoff)}</span><ExternalLink aria-hidden="true" className="h-3.5 w-3.5 shrink-0 opacity-70" /></a> : <p className="text-sm text-amber-800">{labels.missingRoute}</p>}
          </div>
          <button type="button" disabled={!!saving} onClick={() => (stage === 3 ? setConfirmComplete(true) : void save())} className="driver-primary-action mt-2 min-h-12 w-full rounded-xl px-3 text-base font-bold text-white disabled:opacity-60">{saving ? (saving === "location" ? labels.locating : labels.saving) : labels.actions[stage]}</button>
          <p className="mt-1 text-center text-[10px] leading-4 text-slate-500">{labels.gps}</p>
        </>}
        <DriverRouteOptions key={destinationIsPickup ? "pickup" : "delivery"} language={language} pickupName={job.pickupName} deliveryName={job.dropoffName} defaultDestination={destinationIsPickup ? "pickup" : "delivery"} urls={{ depot: depotUrl, current: currentUrl, pickup: pickupUrl, delivery: deliveryUrl, pickupToDropoff: pickupToDropoffUrl }} />
        {saveError ? <p role="alert" className="mt-2 text-sm font-semibold text-rose-700">{labels.saveError}</p> : null}
        {feedback ? <p role="status" className="mt-2 text-xs font-semibold text-emerald-700">{labels.saved}{feedback === "locationMissing" ? ` ${labels.locationMissing}` : ""}</p> : null}
      </section>
      <section className="driver-job-progress px-3 pb-2" aria-labelledby="job-progress">
        <div className="flex items-center justify-between gap-2"><h2 id="job-progress" className="text-xs font-bold text-[#152638]">{labels.progress}</h2><button type="button" disabled={loading || !!saving} onClick={() => void load()} aria-label={labels.refresh} title={labels.refresh} className="inline-flex h-11 w-11 shrink-0 items-center justify-center text-slate-400 disabled:opacity-50"><RefreshCw className="h-3.5 w-3.5" /></button></div>
        {!loading && !loadError ? <ol className="grid grid-cols-4">{DRIVER_JOB_EVENT_TYPES.map((type, index) => {
          const event = events.find((entry) => entry.eventType === type);
          const current = !event && index === stage;
          const complete = !!event;
          return <li key={type} aria-current={current ? "step" : undefined} className="relative min-w-0 px-1 text-center" aria-label={labels.steps[index]}>
            {index < 3 ? <span aria-hidden="true" className={`absolute left-1/2 top-3 h-px w-full ${complete ? "bg-emerald-200" : "bg-slate-200"}`} /> : null}
            <span className={`relative z-10 mx-auto flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ${complete ? "bg-emerald-100 text-emerald-700" : current ? "driver-primary-action text-white" : "bg-slate-100 text-slate-400"}`}>{complete ? <Check className="h-3.5 w-3.5" /> : index + 1}</span>
            <p className={`mt-1 break-words text-[11px] font-semibold ${current ? "driver-accent" : complete ? "text-[#152638]" : "text-slate-400"}`}>{labels.progressShort[index]}</p>
            {event ? <time dateTime={event.eventTime} className="mt-1 block break-words text-[10px] leading-3 text-slate-500">{formatTimestamp(event.eventTime)}{event.latitude !== null && event.longitude !== null ? " · GPS" : ""}</time> : null}
          </li>;
        })}</ol> : null}
      </section>
      <div className="driver-information-group driver-surface">
      <DriverDisclosure title={labels.fullRoute} id="job-route"><div className="driver-route-timeline border-t border-[var(--driver-border)] px-4 py-3">{[[labels.pickup, job.pickupName, job.pickupAddress], [labels.dropoff, job.dropoffName, job.dropoffAddress]].map(([label, name, address], index) => <div key={label} className={`relative pl-5 ${index ? "pt-4" : "pb-2"}`}><span aria-hidden="true" className="absolute left-0 top-[5px] h-2 w-2 rounded-full border border-slate-400 bg-white" style={index ? { top: 21 } : undefined} />{index ? <ArrowDown aria-hidden="true" className="absolute -left-1 -top-1 h-4 w-4 text-slate-400" /> : <span aria-hidden="true" className="absolute left-[3px] top-4 h-full w-px bg-slate-200" />}<p className="driver-eyebrow">{label}</p><p className="mt-1 break-words text-sm font-bold">{name || labels.notAssigned}</p>{address && address !== name ? <p className="mt-0.5 break-words text-xs leading-5 text-slate-500">{address}</p> : null}</div>)}</div></DriverDisclosure>
      <DriverDisclosure title={labels.details}><dl className="border-t border-slate-100 px-4 pb-3 text-sm">{[[labels.vehicle, job.vehicleRegistration], [labels.vehicleType, getPortalVehicleTypeLabel(job.vehicleType, language)], [labels.customer, job.clientName], [labels.jobReference, job.jobOrderNumber], [labels.trailer, job.trailerRegistration]].map(([label, value]) => <div key={label} className="flex justify-between gap-4 border-b border-slate-100 py-2 last:border-0"><dt className="text-slate-500">{label}</dt><dd className="max-w-[65%] break-words text-right font-semibold">{value || labels.notAssigned}</dd></div>)}</dl></DriverDisclosure>
      <DriverDisclosure title={labels.help}><div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--driver-border)] px-4 py-2"><div><p className="text-sm font-semibold text-[#152638]">Atip Punpanung</p><p className="text-xs text-slate-500">{labels.operations}</p></div><a href="tel:+66657896654" className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-slate-50 px-3 text-sm font-semibold text-[#152638]"><Phone className="driver-accent h-4 w-4" />{labels.call}</a></div></DriverDisclosure>
      </div>
      {confirmComplete ? <CompletionConfirmation labels={labels} onCancel={() => setConfirmComplete(false)} onConfirm={() => void save()} /> : null}
    </main>
  );
}
