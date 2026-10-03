"use client";

import { CalendarDays, ChevronRight, Clock3, Truck } from "lucide-react";
import Link from "next/link";
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
    <div className="w-[158px] shrink-0">
      <p className="mb-1.5 text-center text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">
        {labels.vehicle}
      </p>

      <div className="relative overflow-hidden rounded-[8px] border-[3px] border-[#27272a] bg-[#f1ca2c] px-2 py-1.5 text-center shadow-[inset_0_0_0_1px_rgba(255,255,255,0.35),0_2px_0_rgba(0,0,0,0.2)]">
        <span className="absolute left-2 top-2 h-1.5 w-1.5 rounded-full bg-black/30" />
        <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-black/30" />

        <div className="text-[9px] font-black tracking-[0.18em] text-[#202020]">
          {labels.thailand}
        </div>

        <div className="my-0.5 truncate text-[28px] font-black leading-none tracking-[0.025em] text-[#111]">
          {registration}
        </div>

        <div className="text-[9px] font-black tracking-[0.06em] text-[#252525]">
          {labels.thailandThai}
        </div>
      </div>

      {vehicleType ? (
        <p className="mt-1.5 truncate text-center text-[11px] font-semibold text-slate-500">
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
      className="block overflow-hidden rounded-[24px] bg-[#152638] text-white shadow-[0_10px_28px_rgba(21,38,56,0.16)] transition active:scale-[0.995]"
    >
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3.5">
        <p className="text-xs font-black tracking-[0.16em] text-orange-300">
          {status === "ready" ? labels.next : labels.current}
        </p>
        <DriverStatusBadge language={language} status={status} />
      </div>

      <div className="p-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-white/75">
          <span className="inline-flex items-center gap-1.5 font-semibold">
            <CalendarDays className="h-4 w-4 text-orange-300" />
            {formattedDate}
          </span>
          <span className="inline-flex items-center gap-1.5 font-semibold">
            <Clock3 className="h-4 w-4 text-orange-300" />
            {formatTime(job.pickupTime, labels.timePending)}
          </span>
          <span className="ml-auto inline-flex items-center gap-1.5 font-bold">
            <Truck className="h-4 w-4" />
            {job.vehicleRegistration || "—"}
          </span>
        </div>

        <h2 className="mt-4 text-[26px] font-black leading-tight">
          {job.clientName || job.jobOrderNumber || labels.job}
        </h2>

        <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-2xl bg-white/[0.06] px-3.5 py-3.5">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.13em] text-white/45">
              {labels.pickup}
            </p>
            <p className="mt-1 truncate text-[15px] font-bold text-white">{job.pickupName || "—"}</p>
          </div>
          <span className="text-xl font-black text-orange-300">→</span>
          <div className="min-w-0 text-right">
            <p className="text-[10px] font-black uppercase tracking-[0.13em] text-white/45">
              {labels.dropoff}
            </p>
            <p className="mt-1 truncate text-[15px] font-bold text-white">{job.dropoffName || "—"}</p>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-end">
          <span className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-xl bg-orange-600 px-5 text-sm font-black text-white shadow-sm">
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
      className="group block border-b border-slate-200 bg-white px-4 py-3.5 first:rounded-t-2xl last:rounded-b-2xl last:border-b-0 active:bg-slate-50"
    >
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Clock3 className="h-4 w-4 shrink-0" />
            <span className="font-semibold">{formatTime(job.pickupTime, labels.timePending)}</span>
          </div>
          <p className="mt-1.5 truncate font-black text-[#152638]">
            {job.clientName || job.jobOrderNumber || labels.job}
          </p>
          <p className="mt-1 truncate text-sm text-slate-600">
            {job.pickupName} <span className="px-1 text-orange-500">→</span> {job.dropoffName}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <DriverStatusBadge language={language} status={status} />
          <ChevronRight className="h-5 w-5 text-slate-400" />
        </div>
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
    <main className="mx-auto w-full max-w-3xl px-3 py-3 sm:px-6 sm:py-6">
      <section className="rounded-[22px] border border-slate-200 bg-white px-4 py-4 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-slate-500">{labels.hello},</p>
            <h1 className="mt-0.5 truncate text-2xl font-black text-[#152638]">
              {profile?.displayName || driverName}
            </h1>
            {remainingToday.length > 0 ? (
              <p className="mt-2 text-sm font-semibold text-slate-600">
                <strong className="text-[#152638]">{remainingToday.length}</strong> {remainingLabel}
              </p>
            ) : null}
          </div>

          {vehicleRegistration ? (
            <VehiclePlate
              registration={vehicleRegistration}
              vehicleType={vehicleType}
              language={language}
              labels={labels}
            />
          ) : null}
        </div>
      </section>

      {nextJob ? (
        <section className="mt-4">
          <CurrentJobCard
            job={nextJob}
            events={eventsByJob[nextJob.id] || []}
            language={language}
            labels={labels}
          />
        </section>
      ) : null}

      <section className="mt-6 pb-6">
        <div className="mb-3 flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-slate-500" />
          <h2 className="text-sm font-black uppercase tracking-[0.14em] text-slate-700">
            {labels.upcoming}
          </h2>
        </div>

        {upcomingGroups.length ? (
          <div className="space-y-5">
            {upcomingGroups.map(([date, dateJobs]) => (
              <div key={date}>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-black text-[#152638]">{formatDate(date)}</h3>
                  <span className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-slate-500 shadow-sm">
                    {dateJobs.length}
                  </span>
                </div>

                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
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
