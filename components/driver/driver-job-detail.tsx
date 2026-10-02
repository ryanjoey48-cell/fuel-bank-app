"use client";

import {
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
    title: "Your job",
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
    navigation: "Google Maps",
    moreNav: "More navigation options",
    depot: "From depot",
    current: "From my location",
    pickupToDropoff: "Open full route",
    pickupDirections: "To pickup",
    delivery: "To drop-off",
    progress: "Progress",
    details: "Job details",
    help: "Need help?",
    call: "Call Atip",
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
    gps: "GPS optional",
    completed: "Job completed",
    refresh: "Refresh",
    missingRoute: "Route locations are missing. Contact operations.",
    next: "Next step",
    confirm: "Complete this job?",
    confirmHelp: "This records the final completion time.",
    cancel: "Cancel",
    nextStep: "Next"
  },
  th: {
    back: "กลับไปยังงาน",
    title: "งานของคุณ",
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
    navigation: "Google Maps",
    moreNav: "ตัวเลือกนำทางเพิ่มเติม",
    depot: "จากคลัง",
    current: "จากตำแหน่งฉัน",
    pickupToDropoff: "เปิดเส้นทางทั้งหมด",
    pickupDirections: "ไปจุดรับ",
    delivery: "ไปจุดส่ง",
    progress: "ความคืบหน้า",
    details: "รายละเอียดงาน",
    help: "ต้องการความช่วยเหลือ?",
    call: "โทรหา Atip",
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
    gps: "GPS ไม่บังคับ",
    completed: "จบงานแล้ว",
    refresh: "รีเฟรช",
    missingRoute: "ข้อมูลเส้นทางไม่ครบ กรุณาติดต่อฝ่ายปฏิบัติการ",
    next: "ขั้นตอนถัดไป",
    confirm: "ยืนยันจบงาน?",
    confirmHelp: "ระบบจะบันทึกเวลาจบงาน",
    cancel: "ยกเลิก",
    nextStep: "ถัดไป"
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
          className="min-h-11 rounded-xl bg-orange-600 px-4 font-bold text-white"
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

  const panel = "rounded-[22px] border border-slate-200 bg-white p-4 shadow-sm";

  return (
    <main
      className={`mx-auto w-full max-w-3xl space-y-3 px-3 pt-3 ${
        !loading && !loadError && stage >= 4 ? "pb-6" : "pb-28"
      } sm:px-6 sm:py-5`}
    >
      <Link
        href="/driver"
        className="inline-flex min-h-10 items-center gap-2 text-sm font-bold text-[#152638]"
      >
        <ArrowLeft className="h-4 w-4" />
        {labels.back}
      </Link>

      <header className="rounded-[22px] bg-[#152638] p-4 text-white shadow-md">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-orange-300">
              EES · {labels.title}
            </p>
            <h1 className="mt-2 break-words text-2xl font-black">
              {job.clientName || job.jobOrderNumber || labels.title}
            </h1>
          </div>
          <span className="shrink-0 rounded-full bg-white/15 px-3 py-1 text-xs font-bold">
            {loading || loadError ? "—" : labels.statuses[stage]}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-xl bg-white/5 px-3 py-3">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.12em] text-white/45">{labels.pickup}</p>
            <p className="mt-1 truncate text-sm font-bold">{job.pickupName || labels.notAssigned}</p>
          </div>
          <span className="text-lg font-black text-orange-300">→</span>
          <div className="min-w-0 text-right">
            <p className="text-[10px] font-black uppercase tracking-[0.12em] text-white/45">{labels.dropoff}</p>
            <p className="mt-1 truncate text-sm font-bold">{job.dropoffName || labels.notAssigned}</p>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-white/75">
          <span>{formattedDate}</span>
          <span className="inline-flex items-center gap-1.5">
            <Clock3 className="h-4 w-4 text-orange-300" />
            {job.pickupTime?.slice(0, 5) || labels.timePending}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Truck className="h-4 w-4" />
            {job.vehicleRegistration || "—"}
          </span>
        </div>
      </header>

      <section className={panel} aria-labelledby="job-route">
        <div className="flex items-center justify-between gap-2">
          <h2 id="job-route" className="text-lg font-black text-[#152638]">{labels.route}</h2>
          <Navigation2 className="h-5 w-5 text-slate-300" />
        </div>

        <div className="mt-4 grid grid-cols-[32px_1fr]">
          <div className="relative flex flex-col items-center">
            <span className="z-10 flex h-8 w-8 items-center justify-center rounded-full bg-orange-50 text-orange-600">
              <MapPin className="h-5 w-5" />
            </span>
            <span className="my-1 h-full min-h-12 w-px bg-slate-200" />
            <span className="z-10 flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-[#152638]">
              <MapPin className="h-5 w-5" />
            </span>
          </div>

          <div className="min-w-0 pl-3">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.12em] text-orange-600">{labels.pickup}</p>
              <p className="mt-0.5 font-black text-slate-900">{job.pickupName || labels.notAssigned}</p>
              {job.pickupAddress && job.pickupAddress !== job.pickupName ? (
                <p className="mt-1 break-words text-sm leading-5 text-slate-500">{job.pickupAddress}</p>
              ) : null}
            </div>

            <div className="mt-5">
              <p className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">{labels.dropoff}</p>
              <p className="mt-0.5 font-black text-slate-900">{job.dropoffName || labels.notAssigned}</p>
              {job.dropoffAddress && job.dropoffAddress !== job.dropoffName ? (
                <p className="mt-1 break-words text-sm leading-5 text-slate-500">{job.dropoffAddress}</p>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-[22px] border border-orange-200 bg-orange-50 p-4">
        <p className="text-xs font-black uppercase tracking-[0.15em] text-orange-700">{labels.next}</p>

        {loading ? (
          <p className="mt-2 text-sm text-slate-500">{labels.loading}</p>
        ) : loadError ? (
          <p className="mt-2 text-sm text-rose-700">{labels.unavailable}</p>
        ) : stage >= 4 ? (
          <p className="mt-3 flex items-center gap-2 rounded-xl bg-emerald-50 p-3 font-bold text-emerald-800">
            <Check className="h-5 w-5" />
            {labels.completed}
          </p>
        ) : (
          <>
            <button
              type="button"
              disabled={!!saving}
              onClick={() => (stage === 3 ? setConfirmComplete(true) : void save())}
              className="mt-3 min-h-12 w-full rounded-xl bg-orange-600 px-4 text-base font-black text-white shadow-sm disabled:opacity-60"
            >
              {saving ? (saving === "location" ? labels.locating : labels.saving) : labels.actions[stage]}
            </button>
            <p className="mt-2 text-xs text-slate-500">{labels.gps}</p>
          </>
        )}
      </section>

      <section className={panel} aria-labelledby="job-navigation">
        <div className="flex items-center gap-2">
          <Navigation2 className="h-5 w-5 text-orange-500" />
          <h2 id="job-navigation" className="text-lg font-black text-[#152638]">{labels.navigation}</h2>
        </div>

        {pickupToDropoffUrl ? (
          <a
            className="mt-3 flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#152638] px-4 font-black text-white shadow-sm"
            href={pickupToDropoffUrl}
            target="_blank"
            rel="noreferrer"
          >
            {labels.pickupToDropoff}
            <ExternalLink className="h-4 w-4" />
          </a>
        ) : (
          <p className="mt-2 text-sm text-amber-800">{labels.missingRoute}</p>
        )}

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
          <h2 id="job-progress" className="text-lg font-black text-[#152638]">{labels.progress}</h2>
          <button
            type="button"
            className="inline-flex min-h-10 items-center gap-1 text-xs font-bold text-[#152638] disabled:opacity-50"
            disabled={loading || !!saving}
            onClick={() => void load()}
          >
            <RefreshCw className="h-4 w-4" />
            {labels.refresh}
          </button>
        </div>

        {!loading && !loadError ? (
          <ol className="mt-4">
            {DRIVER_JOB_EVENT_TYPES.map((type, index) => {
              const event = events.find((entry) => entry.eventType === type);
              const current = !event && index === stage;
              const complete = !!event;

              return (
                <li key={type} className="relative flex gap-3 pb-4 last:pb-0">
                  {index < DRIVER_JOB_EVENT_TYPES.length - 1 ? (
                    <span
                      className={`absolute left-[15px] top-8 h-[calc(100%-1rem)] w-px ${
                        complete ? "bg-emerald-200" : "bg-slate-200"
                      }`}
                    />
                  ) : null}

                  <span
                    className={`relative z-10 mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                      complete
                        ? "bg-emerald-100 text-emerald-700"
                        : current
                          ? "bg-orange-600 text-white"
                          : "bg-slate-100 text-slate-400"
                    }`}
                  >
                    {complete ? <Check className="h-4 w-4" /> : index + 1}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className={`text-sm font-bold ${complete || current ? "text-slate-900" : "text-slate-400"}`}>
                        {labels.steps[index]}
                      </p>
                      {current ? (
                        <span className="rounded-full bg-orange-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.08em] text-orange-700">
                          {labels.nextStep}
                        </span>
                      ) : null}
                    </div>

                    {event ? (
                      <p className="mt-0.5 text-xs text-slate-500">
                        {formatTimestamp(event.eventTime)}
                        {event.latitude !== null && event.longitude !== null ? " · GPS" : ""}
                      </p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        ) : null}

        {saveError ? <p className="mt-3 text-sm font-semibold text-rose-700">{labels.saveError}</p> : null}
        {feedback ? (
          <p className="mt-3 text-sm font-semibold text-emerald-700">
            {labels.saved}
            {feedback === "locationMissing" ? ` ${labels.locationMissing}` : ""}
          </p>
        ) : null}
      </section>

      <section className="rounded-[22px] border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-black text-[#152638]">{labels.help}</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Atip Punpanung · {labels.operations}
            </p>
          </div>
          <a
            href="tel:+66657896654"
            className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-bold text-[#152638]"
          >
            <Phone className="h-4 w-4" />
            {labels.call}
          </a>
        </div>
      </section>

      <details className={`${panel} p-0`}>
        <summary className="cursor-pointer px-4 py-4 font-bold text-[#152638]">{labels.details}</summary>
        <dl className="border-t border-slate-100 px-4 pb-3 text-sm">
          {[
            [labels.vehicle, job.vehicleRegistration],
            [labels.vehicleType, getPortalVehicleTypeLabel(job.vehicleType, language)],
            [labels.customer, job.clientName],
            [labels.jobReference, job.jobOrderNumber],
            [labels.trailer, job.trailerRegistration]
          ].map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4 border-b border-slate-100 py-2 last:border-0">
              <dt className="text-slate-500">{label}</dt>
              <dd className="max-w-[65%] break-words text-right font-semibold text-slate-900">
                {value || labels.notAssigned}
              </dd>
            </div>
          ))}
        </dl>
      </details>

      {confirmComplete ? (
        <CompletionConfirmation
          labels={labels}
          onCancel={() => setConfirmComplete(false)}
          onConfirm={() => void save()}
        />
      ) : null}
    </main>
  );
}
