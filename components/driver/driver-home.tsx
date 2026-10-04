"use client";

import { CalendarDays, ChevronRight, Clock3, Truck, MapPin, Check } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { useLanguage } from "@/lib/language-provider";
import type { DriverJobEvent, DriverPortalJob } from "@/lib/driver-portal";
import { jobStatus, nextDriverJob, type DriverProfile } from "@/lib/driver-operations";
import { getPortalVehicleTypeLabel } from "@/lib/driver-vehicle-types";
import { DriverStatusBadge, driverJobAction } from "./driver-ui";

const copy = {
  en: {
    hello: "Hello",
    upcoming: "Upcoming",
    vehicle: "Your vehicle",
    remaining: "job remaining",
    remainingPlural: "jobs remaining",
    noUpcoming: "No upcoming jobs",
    tomorrow: "Tomorrow",
    timePending: "Time not set",
    job: "Job",
    current: "CURRENT JOB",
    next: "NEXT JOB",
    pickup: "PICKUP",
    dropoff: "DELIVERY",
    thailand: "THAILAND",
    thailandThai: "ประเทศไทย"
  },
  th: {
    hello: "สวัสดี",
    upcoming: "งานถัดไป",
    vehicle: "รถของคุณ",
    remaining: "งานที่เหลือ",
    remainingPlural: "งานที่เหลือ",
    noUpcoming: "ยังไม่มีงานล่วงหน้า",
    tomorrow: "พรุ่งนี้",
    timePending: "ยังไม่กำหนดเวลา",
    job: "งาน",
    current: "งานปัจจุบัน",
    next: "งานถัดไป",
    pickup: "จุดรับ",
    dropoff: "จุดส่ง",
    thailand: "THAILAND",
    thailandThai: "ประเทศไทย"
  }
} as const;

function formatTime(value: string | null, fallback: string) {
  return value ? value.slice(0, 5) : fallback;
}

function addDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T12:00:00+07:00`);
  date.setUTCDate(date.getUTCDate() + days);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(date);
}

function VehiclePlate({
  registration,
  vehicleType,
  language,
  labels
}: {
  registration: string;
  vehicleType: string | null;
  language: "en" | "th";
  labels: (typeof copy)[keyof typeof copy];
}) {
  return (
    <div className="w-[158px] shrink-0 lg:w-[220px]">
      <p className="mb-1.5 text-center text-[10px] font-black uppercase tracking-[0.16em] text-[#152638] lg:mb-2 lg:text-sm">
        {labels.vehicle}
      </p>

      <div className="relative overflow-hidden rounded-[8px] border-[3px] border-[#27272a] bg-[#f1ca2c] px-2 py-1.5 text-center lg:py-2 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.35),0_2px_0_rgba(0,0,0,0.2)]">
        <span className="absolute left-2 top-2 h-1.5 w-1.5 rounded-full bg-black/30" />
        <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-black/30" />

        <div className="text-[9px] font-black lg:text-xs tracking-[0.18em] text-[#202020]">
          {labels.thailand}
        </div>

        <div className="my-0.5 truncate text-[28px] lg:text-[44px] font-black leading-none tracking-[0.025em] text-[#111]">
          {registration}
        </div>

        <div className="text-[9px] lg:text-xs font-black tracking-[0.06em] text-[#252525]">
          {labels.thailandThai}
        </div>
      </div>

      {vehicleType ? (
        <p className="mt-1.5 truncate text-center text-[11px] font-semibold text-[#152638] lg:mt-2 lg:text-base">
          {getPortalVehicleTypeLabel(vehicleType, language)}
        </p>
      ) : null}
    </div>
  );
}

function CurrentJobCard({
  job,
  events,
  language,
  labels
}: {
  job: DriverPortalJob;
  events: DriverJobEvent[];
  language: "en" | "th";
  labels: (typeof copy)[keyof typeof copy];
}) {
  const status = jobStatus(events);
  const formattedDate = new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Bangkok"
  }).format(new Date(`${job.bookingDate}T12:00:00+07:00`));

  return (
    <Link
      href={`/driver/jobs/${job.id}`}
      className="driver-next-job block overflow-hidden rounded-2xl bg-[#152638] text-white shadow-sm transition active:scale-[0.995]"
    >
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-2 sm:py-3.5 lg:px-8 lg:py-4">
        <p className="text-xs lg:text-lg font-black tracking-[0.16em] text-slate-300">
          {status === "ready" ? labels.next : labels.current}
        </p>
        <DriverStatusBadge language={language} status={status} />
      </div>

      <div className="px-4 py-2.5 sm:p-4 lg:px-8 lg:py-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white/75 sm:gap-x-4 sm:gap-y-2 lg:gap-x-6 lg:text-lg">
          <span className="inline-flex items-center gap-1.5 font-semibold">
            <CalendarDays className="h-4 w-4 text-slate-300 lg:h-5 lg:w-5" />
            {formattedDate}
          </span>
          <span className="inline-flex items-center gap-1.5 font-semibold">
            <Clock3 className="h-4 w-4 text-slate-300 lg:h-5 lg:w-5" />
            {formatTime(job.pickupTime, labels.timePending)}
          </span>
          <span className="ml-auto inline-flex items-center gap-1.5 font-bold">
            <Truck className="h-4 w-4 lg:h-5 lg:w-5" />
            {job.vehicleRegistration || "—"}
          </span>
        </div>

        <h2 className="mt-1.5 break-words text-[24px] font-black leading-tight sm:mt-4 lg:text-[40px]">
          {job.clientName || job.jobOrderNumber || labels.job}
        </h2>

        <div className="mt-1.5 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 rounded-2xl bg-[#203649] px-3.5 py-2 sm:mt-4 sm:py-3.5 lg:mt-3 lg:px-6 lg:py-4">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.13em] text-white/45 lg:text-xs">
              {labels.pickup}
            </p>
            <p className="mt-1 break-words text-[15px] font-bold text-white lg:text-xl">{job.pickupName || "—"}</p>
          </div>
          <span className="text-xl lg:text-4xl font-black text-slate-300">→</span>
          <div className="min-w-0 text-right">
            <p className="text-[10px] font-black uppercase tracking-[0.13em] text-white/45 lg:text-xs">
              {labels.dropoff}
            </p>
            <p className="mt-1 break-words text-[15px] font-bold text-white lg:text-xl">{job.dropoffName || "—"}</p>
          </div>
        </div>

        <div className="mt-1.5 flex items-center justify-end sm:mt-4">
          <span className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-xl bg-orange-600 px-5 text-sm font-black text-white shadow-sm lg:min-h-14 lg:px-8 lg:text-lg">
            {driverJobAction(language, status)}
            <ChevronRight className="h-4 w-4" />
          </span>
        </div>
      </div>
    </Link>
  );
}

function UpcomingJobRow({
  job,
  events,
  language,
  labels
}: {
  job: DriverPortalJob;
  events: DriverJobEvent[];
  language: "en" | "th";
  labels: (typeof copy)[keyof typeof copy];
}) {
  const status = jobStatus(events);

  return (
    <Link
      href={`/driver/jobs/${job.id}`}
      className="driver-upcoming-job group block border-b border-slate-200 bg-white px-4 py-2.5 sm:py-3.5 first:rounded-t-2xl last:rounded-b-2xl last:border-b-0 active:bg-slate-50"
    >
      <div className="flex items-center gap-3 lg:grid lg:grid-cols-[160px_minmax(0,1fr)_90px_auto_20px] lg:gap-5">
        <div className="hidden border-r border-slate-200 pr-5 lg:block">
          <p className="text-sm font-semibold text-[#152638]">{new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Bangkok" }).format(new Date(`${job.bookingDate}T12:00:00+07:00`))}</p>
          <p className="mt-1 text-xs text-slate-500">{new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-GB", { weekday: "short", timeZone: "Asia/Bangkok" }).format(new Date(`${job.bookingDate}T12:00:00+07:00`))} · {formatTime(job.pickupTime, labels.timePending)}</p>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm text-slate-500 lg:hidden">
            <Clock3 className="h-4 w-4 shrink-0" />
            <span className="font-semibold">{formatTime(job.pickupTime, labels.timePending)}</span>
          </div>
          <p className="mt-1.5 truncate font-black text-[#152638] lg:mt-0 lg:text-base">
            {job.clientName || job.jobOrderNumber || labels.job}
          </p>
          <p className="mt-1 line-clamp-2 break-words text-sm text-slate-600 lg:hidden">
            {job.pickupName} <span className="px-1 text-slate-400">→</span> {job.dropoffName}
          </p>
          <div className="mt-1 hidden grid-cols-[minmax(0,1fr)_24px_minmax(0,1fr)] items-start gap-3 lg:grid">
            {[job.pickupName, job.dropoffName].map((name, index) => <div key={index} className="contents">
              {index ? <span aria-hidden="true" className="pt-0.5 text-xl text-slate-400">→</span> : null}
              <div className="flex min-w-0 gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" /><div className="min-w-0"><p className="truncate text-sm text-[#152638]" title={name || undefined}>{name || "—"}</p><p className="text-[10px] tracking-wide text-slate-500">{index ? labels.dropoff : labels.pickup}</p></div></div>
            </div>)}
          </div>
        </div>
        <span className="hidden items-center gap-2 text-sm text-slate-600 lg:inline-flex"><Truck className="h-5 w-5 shrink-0" />{job.vehicleRegistration || "—"}</span>
        <div className="flex shrink-0 items-center gap-2 lg:justify-center lg:border-l lg:border-slate-200 lg:pl-5">
          <DriverStatusBadge language={language} status={status} />
          <ChevronRight className="h-5 w-5 text-slate-400 lg:hidden" />
        </div>
        <ChevronRight className="hidden h-5 w-5 text-slate-500 lg:block" />
      </div>
    </Link>
  );
}

export function DriverHome({
  driverName,
  jobs,
  today,
  eventsByJob = {}
}: {
  driverName: string;
  jobs: DriverPortalJob[];
  today: string;
  eventsByJob?: Record<string, DriverJobEvent[]>;
}) {
  const { language } = useLanguage();
  const labels = copy[language];
  const [profile, setProfile] = useState<DriverProfile | null>(null);

  useEffect(() => {
    let active = true;
    void fetch("/api/driver/profile", { cache: "no-store" })
      .then(async (r) => {
        if (r.ok && active) setProfile(await r.json());
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const todayJobs = useMemo(
    () =>
      jobs
        .filter((job) => job.bookingDate === today)
        .sort((a, b) => (a.pickupTime || "99:99").localeCompare(b.pickupTime || "99:99")),
    [jobs, today]
  );

  const remainingToday = todayJobs.filter(
    (job) => jobStatus(eventsByJob[job.id] || []) !== "completed"
  );

  const nextJob = nextDriverJob(jobs, eventsByJob);
  const vehicleRegistration =
    nextJob?.vehicleRegistration ?? profile?.vehicle ?? jobs[0]?.vehicleRegistration ?? null;
  const vehicleType =
    nextJob?.vehicleType ??
    jobs.find((job) => job.vehicleRegistration === vehicleRegistration)?.vehicleType ??
    null;

  const upcomingGroups = useMemo(() => {
    const groups = new Map<string, DriverPortalJob[]>();

    for (const job of jobs) {
      if (job.bookingDate <= today || job.id === nextJob?.id) continue;
      const entries = groups.get(job.bookingDate) ?? [];
      entries.push(job);
      groups.set(job.bookingDate, entries);
    }

    return [...groups.entries()].map(
      ([date, entries]) =>
        [
          date,
          entries.sort((a, b) =>
            (a.pickupTime || "99:99").localeCompare(b.pickupTime || "99:99")
          )
        ] as const
    );
  }, [jobs, today, nextJob?.id]);

  const formatDate = (dateKey: string) => {
    if (dateKey === addDays(today, 1)) return labels.tomorrow;
    return new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "Asia/Bangkok"
    }).format(new Date(`${dateKey}T12:00:00+07:00`));
  };

  const remainingLabel =
    remainingToday.length === 1 ? labels.remaining : labels.remainingPlural;

  return (
    <main className="driver-jobs-home mx-auto w-full max-w-3xl px-3 py-3 sm:px-6 sm:py-6 lg:max-w-[1280px]">
      <section className="driver-home-hero relative isolate overflow-hidden rounded-[22px] border border-[#d8d1c7] bg-[#f8f3e9] px-4 py-3 sm:py-4 shadow-[0_8px_24px_rgba(21,38,56,0.07)] lg:min-h-[320px] lg:px-7 lg:py-6">
        <Image
          src="/driver-hero-bg.png"
          alt=""
          aria-hidden="true"
          fill
          priority
          sizes="(min-width: 1280px) 1232px, (min-width: 1024px) calc(100vw - 48px), (min-width: 640px) 720px, calc(100vw - 24px)"
          className="pointer-events-none object-cover object-[62%_62%] sm:object-[center_52%]"
        />
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,251,243,0.96)_0%,rgba(255,251,243,0.75)_32%,rgba(255,251,243,0)_55%,rgba(255,251,243,0.12)_66%,rgba(255,251,243,0.88)_100%)] sm:bg-[linear-gradient(90deg,rgba(255,251,243,0.97)_0%,rgba(255,251,243,0.90)_24%,rgba(255,251,243,0.18)_52%,rgba(255,251,243,0.08)_70%,rgba(255,251,243,0.82)_100%)]" />

        <div className="relative z-10 flex min-h-[176px] flex-col items-start justify-between gap-3 sm:min-h-[248px] sm:flex-row sm:items-center sm:gap-4 lg:min-h-[272px] lg:gap-8">
          <div className="min-w-0 w-full sm:w-auto sm:flex-1">
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-[#152638]/10 bg-white/65 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.15em] text-[#152638]/55 lg:mb-4 lg:px-3 lg:text-xs">
              <span className="h-1.5 w-1.5 rounded-full bg-[#152638]" />
              {language === "th" ? "EES คนขับรถ" : "EES DRIVER"}
            </div>

            <p className="text-sm font-semibold text-slate-500 lg:text-2xl lg:text-[#152638]">{labels.hello},</p>
            <h1 className="mt-0.5 break-words text-2xl font-black text-[#152638] sm:truncate lg:mt-1 lg:text-[48px] lg:leading-tight">
              {profile?.displayName || driverName}
            </h1>

            <div className="mt-2 flex flex-col items-start gap-y-1 text-sm font-semibold text-[#152638] sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3 lg:mt-7 lg:gap-x-5 lg:text-lg">
              {remainingToday.length > 0 ? (
                <span className="text-[#152638]">
                  <strong>{remainingToday.length}</strong> {remainingLabel}{language === "th" ? "วันนี้" : " today"}
                </span>
              ) : (
                <span className="inline-flex items-center gap-2 text-emerald-700"><span className="hidden h-8 w-8 items-center justify-center rounded-full bg-emerald-500 text-white lg:inline-flex"><Check className="h-5 w-5" /></span>
                  {language === "th" ? "ไม่มีงานค้างวันนี้" : "No jobs remaining today"}
                </span>
              )}
              {vehicleRegistration ? (
                <span aria-hidden="true" className="hidden h-6 border-l border-slate-400/60 sm:inline" />
              ) : null}
              {vehicleRegistration ? (
                <span className="hidden items-center gap-2 text-xs sm:inline-flex sm:text-sm lg:text-base"><Truck className="h-4 w-4 shrink-0 lg:h-5 lg:w-5" />
                  {language === "th" ? "รถประจำ" : "Assigned vehicle"} {vehicleRegistration}
                </span>
              ) : null}
            </div>
          </div>

          {vehicleRegistration ? (
            <div className="hidden sm:block sm:self-auto">
            <VehiclePlate
              registration={vehicleRegistration}
              vehicleType={vehicleType}
              language={language}
              labels={labels}
            />
            </div>
          ) : null}
          {vehicleRegistration ? (
            <div className="inline-flex max-w-full items-center gap-2 rounded-full border border-[#152638]/10 bg-white/75 px-3 py-1.5 text-xs font-semibold text-[#152638] sm:hidden" aria-label={labels.vehicle}>
              <Truck className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0 break-words">
                {vehicleRegistration}{vehicleType ? ` · ${getPortalVehicleTypeLabel(vehicleType, language)}` : ""}
              </span>
            </div>
          ) : null}
        </div>
      </section>

      {nextJob ? (
        <section className="mt-3 sm:mt-4">
          <CurrentJobCard
            job={nextJob}
            events={eventsByJob[nextJob.id] || []}
            language={language}
            labels={labels}
          />
        </section>
      ) : null}

      <section className="mt-3 pb-6 sm:mt-6">
        <div className="mb-2 flex items-center gap-2 sm:mb-3">
          <CalendarDays className="h-4 w-4 text-slate-500" />
          <h2 className="text-sm font-black uppercase tracking-[0.14em] text-slate-700">
            {labels.upcoming}
          </h2>
        </div>

        {upcomingGroups.length ? (
          <div className="space-y-3 sm:space-y-5 lg:space-y-0 lg:overflow-hidden lg:rounded-2xl lg:border lg:border-slate-200">
            {upcomingGroups.map(([date, dateJobs]) => (
              <div key={date} className="lg:border-b lg:border-slate-200 lg:last:border-b-0">
                <div className="mb-1 flex items-center justify-between sm:mb-2 lg:hidden">
                  <h3 className="text-sm font-black text-[#152638]">{formatDate(date)}</h3>
                  <span className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-slate-500 shadow-sm">
                    {dateJobs.length}
                  </span>
                </div>

                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:rounded-none lg:border-0 lg:shadow-none">
                  {dateJobs.map((job) => (
                    <UpcomingJobRow
                      key={job.id}
                      job={job}
                      events={eventsByJob[job.id] || []}
                      language={language}
                      labels={labels}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-slate-300 bg-white/70 p-4 text-center text-sm text-slate-500">
            {labels.noUpcoming}
          </p>
        )}
      </section>
    </main>
  );
}
