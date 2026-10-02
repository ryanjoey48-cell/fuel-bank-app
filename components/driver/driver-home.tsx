"use client";

import {
  ArrowDown,
  CalendarDays,
  ChevronRight,
  Clock3,
  MapPin,
  PackageCheck,
  Route,
  Truck
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useLanguage } from "@/lib/language-provider";
import type { DriverJobEvent, DriverPortalJob } from "@/lib/driver-portal";
import { jobStatus, nextDriverJob, statusCopy, type DriverProfile } from "@/lib/driver-operations";

const copy = {
  en: {
    greeting: "Hello",
    intro: "Your assigned work, in pickup order.",
    today: "Today",
    upcoming: "Upcoming",
    noTodayTitle: "No jobs assigned today",
    noTodayText: "New work assigned by the office will appear here.",
    noUpcomingTitle: "Nothing upcoming yet",
    noUpcomingText: "Future bookings will appear here once they are assigned.",
    vehicle: "Vehicle",
    job: "Job",
    view: "Open job",
    timePending: "Time not set",
    tomorrow: "Tomorrow",
    jobsToday: "Jobs today",
    upcomingJobs: "Upcoming jobs",
    nextPickup: "Next pickup",
    allClear: "You're all clear for now",
    ready: "Ready",
    pickup: "Pickup",
    delivery: "Delivery"
  },
  th: {
    greeting: "สวัสดี",
    intro: "งานที่ได้รับมอบหมาย เรียงตามเวลารับสินค้า",
    today: "วันนี้",
    upcoming: "งานถัดไป",
    noTodayTitle: "วันนี้ยังไม่มีงาน",
    noTodayText: "งานใหม่ที่สำนักงานมอบหมายจะแสดงที่นี่",
    noUpcomingTitle: "ยังไม่มีงานล่วงหน้า",
    noUpcomingText: "งานในอนาคตจะแสดงที่นี่เมื่อได้รับมอบหมาย",
    vehicle: "รถ",
    job: "เลขงาน",
    view: "เปิดงาน",
    timePending: "ยังไม่กำหนดเวลา",
    tomorrow: "พรุ่งนี้",
    jobsToday: "งานวันนี้",
    upcomingJobs: "งานล่วงหน้า",
    nextPickup: "รับสินค้าถัดไป",
    allClear: "ตอนนี้ยังไม่มีงานเพิ่มเติม",
    ready: "พร้อม",
    pickup: "จุดรับ",
    delivery: "จุดส่ง"
  }
} as const;

function formatTime(value: string | null, fallback: string) {
  if (!value) return fallback;
  return value.slice(0, 5);
}

function addDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T12:00:00+07:00`);
  date.setUTCDate(date.getUTCDate() + days);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok"
  }).format(date);
}

function EmptyState({
  title,
  text
}: {
  title: string;
  text: string;
}) {
  return (
    <div className="rounded-[1.5rem] border border-dashed border-slate-300 bg-white/70 px-4 py-5 text-center shadow-sm sm:px-6 sm:py-10">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
        <PackageCheck className="h-6 w-6" />
      </div>

      <h3 className="mt-4 text-base font-black text-slate-900">
        {title}
      </h3>

      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
        {text}
      </p>
    </div>
  );
}

function JobCard({
  job,
  labels, events, language, next
}: {
  job: DriverPortalJob;
  labels: (typeof copy)[keyof typeof copy];
  events: DriverJobEvent[]; language: "en" | "th"; next?: boolean;
}) {
  const status = jobStatus(events);
  const completed = status === "completed";
  return (
    <>
    <Link href={`/driver/jobs/${job.id}`} className={`block overflow-hidden rounded-[1.25rem] border shadow-sm sm:hidden ${completed ? "border-emerald-100 bg-emerald-50/40" : next ? "border-brand-400 bg-white ring-1 ring-brand-200" : "border-slate-200 bg-white"}`}>
      {next ? <p className="bg-brand-700 px-3 py-1.5 text-xs font-bold tracking-wide text-white">{status !== "ready" ? language === "th" ? "งานที่กำลังดำเนินการ" : "CURRENT JOB" : language === "th" ? "งานถัดไป" : "NEXT JOB"}</p> : null}
      <div className="p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-sm font-black text-brand-800"><Clock3 className="h-4 w-4" />{formatTime(job.pickupTime, labels.timePending)}</span>
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-bold ${completed ? "bg-emerald-100 text-emerald-800" : "bg-brand-50 text-brand-800"}`}>{completed ? <PackageCheck className="h-3.5 w-3.5" /> : null}{statusCopy[language][status]}</span>
        </div>
        <p className="mt-1.5 break-words text-sm font-black text-slate-950">{job.clientName || job.jobOrderNumber || labels.job}</p>
        {job.clientName && job.jobOrderNumber ? <p className="mt-0.5 break-words text-xs text-slate-500">{labels.job} {job.jobOrderNumber}</p> : null}
        <p className="mt-1.5 break-words text-sm font-semibold leading-5 text-slate-700">{job.pickupName} <span className="text-brand-500">→</span> {job.dropoffName}</p>
        <div className="mt-2 flex items-center justify-between gap-2 text-xs">
          <span className="inline-flex min-w-0 items-center gap-1.5 font-semibold text-slate-500"><Truck className="h-4 w-4 shrink-0" /><span className="break-words">{job.vehicleRegistration || "—"}</span></span>
          <span className={`inline-flex min-h-7 items-center gap-1 font-bold ${completed ? "text-emerald-800" : "text-brand-800"}`}>{completed ? null : labels.view}<ChevronRight className="h-4 w-4" /></span>
        </div>
      </div>
    </Link>
    <article className={`hidden overflow-hidden rounded-[1.25rem] border shadow-sm sm:block ${completed ? "border-emerald-100 bg-slate-50 text-slate-600" : next ? "border-brand-400 bg-white ring-1 ring-brand-200" : "border-slate-200 bg-white"}`}>
      {next ? <p className="bg-brand-700 px-4 py-2 text-xs font-bold tracking-wide text-white">{status !== "ready" ? language === "th" ? "งานที่กำลังดำเนินการ" : "CURRENT JOB" : language === "th" ? "งานถัดไป" : "NEXT JOB"}</p> : null}
      <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/70 px-4 py-2">
        <div className="inline-flex items-center gap-2 rounded-xl bg-brand-50 px-3 py-1.5 text-base font-black text-brand-800">
          <Clock3 className="h-4 w-4" />
          {formatTime(job.pickupTime, labels.timePending)}
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${completed ? "bg-emerald-100 text-emerald-800" : "bg-brand-50 text-brand-800"}`}>{statusCopy[language][status]}</span>
      </div>

      <div className="p-3 sm:p-4">
        {job.clientName ? (
          <div className="mb-3">
            <p className="text-sm font-bold text-slate-900">
              {job.clientName}
            </p>

            {job.jobOrderNumber ? (
              <p className="mt-1 text-xs font-bold text-slate-500">
                {labels.job} {job.jobOrderNumber}
              </p>
            ) : null}
          </div>
        ) : job.jobOrderNumber ? (
          <p className="mb-4 text-xs font-bold text-slate-500">
            {labels.job} {job.jobOrderNumber}
          </p>
        ) : null}

        <div className="space-y-2">
          <div className="flex gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-700">
              <MapPin className="h-4 w-4" />
            </div>

            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">
                {labels.pickup}
              </p>
              <p className="mt-1 text-base font-black leading-6 text-slate-950">
                {job.pickupName}
              </p>
            </div>
          </div>

          <div className="ml-[17px] h-3 border-l-2 border-dashed border-brand-200" />

          <div className="flex gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
              <Route className="h-4 w-4" />
            </div>

            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">
                {labels.delivery}
              </p>
              <p className="mt-1 text-base font-black leading-6 text-slate-950">
                {job.dropoffName}
              </p>
            </div>
          </div>
        </div>

        {job.vehicleRegistration ? (
          <div className="mt-3 flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-600">
            <Truck className="h-4 w-4 text-brand-600" />
            {labels.vehicle}
            <span className="font-black text-slate-950">
              {job.vehicleRegistration}
            </span>
          </div>
        ) : null}

        <Link
          href={`/driver/jobs/${job.id}`}
          className={`mt-3 flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-black transition ${completed ? "border border-emerald-200 text-emerald-800 hover:bg-emerald-50" : "bg-brand-700 text-white shadow-sm hover:bg-brand-800"}`}
        >
          {labels.view}
          <ChevronRight className="h-4 w-4" />
        </Link>
      </div>
    </article>
    </>
  );
}

export function DriverHome({
  driverName,
  jobs,
  today, eventsByJob = {}
}: {
  driverName: string;
  jobs: DriverPortalJob[];
  today: string;
  eventsByJob?: Record<string, DriverJobEvent[]>;
}) {
  const { language } = useLanguage();
  const labels = copy[language];
  const [profile, setProfile] = useState<DriverProfile | null>(null);
  useEffect(() => { let active = true; void fetch("/api/driver/profile", { cache: "no-store" }).then(async (r) => { if (r.ok && active) setProfile(await r.json()); }).catch(() => undefined); return () => { active = false; }; }, []);

  const todayJobs = jobs.filter((job) => job.bookingDate === today).sort((a, b) => Number(jobStatus(eventsByJob[a.id] || []) === "completed") - Number(jobStatus(eventsByJob[b.id] || []) === "completed"));

  const upcomingGroups = useMemo(() => {
    const groups = new Map<string, DriverPortalJob[]>();

    for (const job of jobs) {
      if (job.bookingDate <= today) continue;

      const entries = groups.get(job.bookingDate) ?? [];
      entries.push(job);
      groups.set(job.bookingDate, entries);
    }

    return [...groups.entries()];
  }, [jobs, today]);

  const upcomingCount = useMemo(
    () => upcomingGroups.reduce((total, [, dateJobs]) => total + dateJobs.length, 0),
    [upcomingGroups]
  );

  const nextJob = nextDriverJob(jobs, eventsByJob);

  const vehicleRegistration =
    nextJob?.vehicleRegistration ?? profile?.vehicle ?? jobs[0]?.vehicleRegistration ?? null;

  const formatDate = (dateKey: string) => {
    if (dateKey === addDays(today, 1)) return labels.tomorrow;

    return new Intl.DateTimeFormat(
      language === "th" ? "th-TH" : "en-GB",
      {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "Asia/Bangkok"
      }
    ).format(new Date(`${dateKey}T12:00:00+07:00`));
  };

  return (
    <main className="driver-home mx-auto w-full max-w-3xl px-3 py-3 sm:px-6 sm:py-6">
      <section className="overflow-hidden rounded-[1.8rem] border border-brand-100 bg-gradient-to-br from-white via-[#fffdf9] to-brand-50/60 shadow-[0_18px_50px_rgba(57,40,24,0.08)]">
        <div className="p-3 sm:p-5">
          <div className="flex gap-3 items-start justify-between">
            <div className="min-w-0">
              <p className="text-sm font-bold text-brand-700">
                {labels.greeting},
              </p>

              <h1 className="mt-0.5 break-words text-lg font-black tracking-tight text-slate-950 sm:mt-1 sm:text-2xl">
                {profile?.displayName || driverName}
              </h1>

              <p className="mt-1 hidden max-w-xl text-xs leading-5 text-slate-600 sm:block">
                {labels.intro}
              </p>
            </div>

            {vehicleRegistration ? (
              <div className="inline-flex items-center gap-2 self-start rounded-xl border border-brand-100 bg-white px-2 py-2">
                <div className="hidden sm:flex h-8 w-8 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                  <Truck className="h-5 w-5" />
                </div>

                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">
                    {labels.vehicle}
                  </p>
                  <p className="text-sm font-black text-slate-950">
                    {vehicleRegistration}
                  </p>
                </div>
              </div>
            ) : null}
          </div>

          <div className="driver-summary-metrics mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-brand-100 pt-2 sm:grid-cols-4 sm:gap-2 sm:border-0 sm:pt-0">
            <div className="flex items-center justify-between gap-2 sm:block sm:rounded-xl sm:border sm:border-slate-200 sm:bg-white sm:p-2">
              <p className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">
                {labels.jobsToday}
              </p>
              <p className="text-lg font-black text-brand-800 sm:mt-1 sm:text-xl">
                {todayJobs.length}
              </p>
            </div>

            <div className="flex items-center justify-between gap-2 sm:block sm:rounded-xl sm:border sm:border-slate-200 sm:bg-white sm:p-2"><p className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">{language === "th" ? "งานที่เหลือวันนี้" : "Remaining today"}</p><p className="text-lg font-black text-brand-800 sm:mt-1 sm:text-xl">{todayJobs.filter((job) => jobStatus(eventsByJob[job.id] || []) !== "completed").length}</p></div>

            <div className="flex items-center justify-between gap-2 sm:block sm:rounded-xl sm:border sm:border-slate-200 sm:bg-white sm:p-2">
              <p className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">
                {labels.upcomingJobs}
              </p>
              <p className="text-lg font-black text-brand-800 sm:mt-1 sm:text-xl">
                {upcomingCount}
              </p>
            </div>

            <div className="flex items-center justify-between gap-2 sm:block sm:rounded-xl sm:border sm:border-slate-200 sm:bg-white sm:p-2">
              <p className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">
                {labels.nextPickup}
              </p>
              <p className="text-right text-xs font-black text-slate-950 sm:mt-1 sm:text-left sm:text-sm">
                {nextJob
                  ? formatTime(nextJob.pickupTime, labels.timePending)
                  : jobs.some((job) => jobStatus(eventsByJob[job.id] || []) !== "completed") ? labels.timePending : labels.allClear}
              </p>
            </div>
          </div>
        </div>
      </section>

      {nextJob ? <section className="mt-5" aria-label={language === "th" ? "งานถัดไป" : "Next job"}><p className="mb-2 text-xs font-bold text-slate-500">{nextJob.bookingDate === today ? labels.today : formatDate(nextJob.bookingDate)}</p><JobCard job={nextJob} labels={labels} events={eventsByJob[nextJob.id] || []} language={language} next /></section> : null}

      {todayJobs.length === 1 && todayJobs[0].id === nextJob?.id ? null : <section className="mt-5">
        <div className="mb-3 flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-brand-700" />
          <h2 className="text-xs font-black uppercase tracking-[0.16em] text-slate-700">
            {labels.today}
          </h2>
          <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-black text-brand-700">
            {todayJobs.length}
          </span>
        </div>

        {todayJobs.length ? (
          <div className="grid gap-2 sm:gap-4 lg:grid-cols-2">
            {todayJobs.filter((job) => job.id !== nextJob?.id).map((job) => (
              <JobCard key={job.id} job={job} labels={labels} events={eventsByJob[job.id] || []} language={language} next={job.id === nextJob?.id && jobStatus(eventsByJob[job.id] || []) !== "completed"} />
            ))}
          </div>
        ) : (
          <EmptyState
            title={labels.noTodayTitle}
            text={labels.noTodayText}
          />
        )}
      </section>

      }
      <section className="mt-6 pb-6">
        <div className="mb-3 flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-slate-500" />
          <h2 className="text-xs font-black uppercase tracking-[0.16em] text-slate-700">
            {labels.upcoming}
          </h2>
        </div>

        {upcomingGroups.length ? (
          <div className="space-y-5">
            {upcomingGroups.filter(([, dateJobs]) => dateJobs.some((job) => job.id !== nextJob?.id)).map(([date, dateJobs]) => (
              <div key={date}>
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-black text-brand-800">
                    {formatDate(date)}
                  </h3>

                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-black text-slate-600">
                    {dateJobs.length}
                  </span>
                </div>

                <div className="grid gap-2 sm:gap-4 lg:grid-cols-2">
                  {dateJobs.filter((job) => job.id !== nextJob?.id).map((job) => (
                    <JobCard key={job.id} job={job} labels={labels} events={eventsByJob[job.id] || []} language={language} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            title={labels.noUpcomingTitle}
            text={labels.noUpcomingText}
          />
        )}
      </section>
    </main>
  );
}
