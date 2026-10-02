"use client";

import { CalendarDays, ChevronRight, Clock3, Truck } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useLanguage } from "@/lib/language-provider";
import type { DriverJobEvent, DriverPortalJob } from "@/lib/driver-portal";
import { jobStatus, nextDriverJob, type DriverProfile } from "@/lib/driver-operations";
import { DriverStatusBadge, driverJobAction } from "./driver-ui";

const copy = {
  en: {
    hello: "Hello",
    today: "Today",
    upcoming: "Upcoming",
    vehicle: "Vehicle",
    jobsToday: "jobs today",
    remaining: "remaining",
    noToday: "No jobs today",
    noUpcoming: "No upcoming jobs",
    tomorrow: "Tomorrow",
    timePending: "Time not set",
    job: "Job",
    current: "CURRENT JOB",
    next: "NEXT JOB"
  },
  th: {
    hello: "สวัสดี",
    today: "วันนี้",
    upcoming: "งานถัดไป",
    vehicle: "รถ",
    jobsToday: "งานวันนี้",
    remaining: "งานที่เหลือ",
    noToday: "วันนี้ไม่มีงาน",
    noUpcoming: "ยังไม่มีงานล่วงหน้า",
    tomorrow: "พรุ่งนี้",
    timePending: "ยังไม่กำหนดเวลา",
    job: "งาน",
    current: "งานปัจจุบัน",
    next: "งานถัดไป"
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

function CurrentJobCard({ job, events, language, labels }: {
  job: DriverPortalJob;
  events: DriverJobEvent[];
  language: "en" | "th";
  labels: (typeof copy)[keyof typeof copy];
}) {
  const status = jobStatus(events);
  return (
    <Link href={`/driver/jobs/${job.id}`} className="block overflow-hidden rounded-2xl bg-[#152638] text-white shadow-md transition active:scale-[0.995]">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
        <p className="text-xs font-black tracking-[0.14em] text-orange-300">{status === "ready" ? labels.next : labels.current}</p>
        <DriverStatusBadge language={language} status={status} />
      </div>
      <div className="p-4">
        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-2 text-base font-bold text-white/90">
            <Clock3 className="h-5 w-5" />
            {formatTime(job.pickupTime, labels.timePending)}
          </span>
          <span className="inline-flex items-center gap-1.5 text-sm text-white/70">
            <Truck className="h-4 w-4" />{job.vehicleRegistration || "—"}
          </span>
        </div>
        <h2 className="mt-4 text-xl font-black">{job.clientName || job.jobOrderNumber || labels.job}</h2>
        <p className="mt-2 text-base font-semibold leading-6 text-white/90">
          {job.pickupName} <span className="px-1 text-orange-300">→</span> {job.dropoffName}
        </p>
        <div className="mt-4 flex justify-end">
          <span className="inline-flex min-h-11 items-center gap-1 rounded-xl bg-orange-600 px-4 text-sm font-black text-white">
            {driverJobAction(language, status)} <ChevronRight className="h-4 w-4" />
          </span>
        </div>
      </div>
    </Link>
  );
}

function CompactJobRow({ job, events, language, labels }: {
  job: DriverPortalJob;
  events: DriverJobEvent[];
  language: "en" | "th";
  labels: (typeof copy)[keyof typeof copy];
}) {
  const status = jobStatus(events);
  const completed = status === "completed";
  return (
    <Link href={`/driver/jobs/${job.id}`} className={`block rounded-2xl border px-4 py-3 shadow-sm transition active:scale-[0.995] ${completed ? "border-emerald-100 bg-emerald-50/40" : "border-slate-200 bg-white"}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Clock3 className="h-4 w-4 shrink-0" />
            <span className="font-semibold">{formatTime(job.pickupTime, labels.timePending)}</span>
          </div>
          <p className="mt-1 truncate font-black text-[#152638]">{job.clientName || job.jobOrderNumber || labels.job}</p>
          <p className="mt-1 truncate text-sm text-slate-700">{job.pickupName} <span className="text-orange-500">→</span> {job.dropoffName}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <DriverStatusBadge language={language} status={status} />
          <ChevronRight className="h-4 w-4 text-slate-400" />
        </div>
      </div>
    </Link>
  );
}

export function DriverHome({ driverName, jobs, today, eventsByJob = {} }: {
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
      .then(async (r) => { if (r.ok && active) setProfile(await r.json()); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  const todayJobs = useMemo(() => jobs
    .filter((job) => job.bookingDate === today)
    .sort((a, b) => (a.pickupTime || "99:99").localeCompare(b.pickupTime || "99:99")), [jobs, today]);

  const remainingToday = todayJobs.filter((job) => jobStatus(eventsByJob[job.id] || []) !== "completed");
  const nextJob = nextDriverJob(jobs, eventsByJob);
  const vehicleRegistration = nextJob?.vehicleRegistration ?? profile?.vehicle ?? jobs[0]?.vehicleRegistration ?? null;

  const upcomingGroups = useMemo(() => {
    const groups = new Map<string, DriverPortalJob[]>();
    for (const job of jobs) {
      if (job.bookingDate <= today || job.id === nextJob?.id) continue;
      const entries = groups.get(job.bookingDate) ?? [];
      entries.push(job);
      groups.set(job.bookingDate, entries);
    }
    return [...groups.entries()].map(([date, entries]) => [date, entries.sort((a, b) => (a.pickupTime || "99:99").localeCompare(b.pickupTime || "99:99"))] as const);
  }, [jobs, today, nextJob?.id]);

  const formatDate = (dateKey: string) => {
    if (dateKey === addDays(today, 1)) return labels.tomorrow;
    return new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-GB", {
      day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Bangkok"
    }).format(new Date(`${dateKey}T12:00:00+07:00`));
  };

  return (
    <main className="mx-auto w-full max-w-3xl px-3 py-3 sm:px-6 sm:py-6">
      <section className="rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-500">{labels.hello},</p>
            <h1 className="mt-0.5 truncate text-xl font-black text-[#152638]">{profile?.displayName || driverName}</h1>
            <p className="mt-2 text-sm text-slate-600">
              <strong className="text-[#152638]">{todayJobs.length}</strong> {labels.jobsToday}
              <span className="mx-2 text-slate-300">•</span>
              <strong className="text-[#152638]">{remainingToday.length}</strong> {labels.remaining}
            </p>
          </div>
          {vehicleRegistration ? (
            <div className="shrink-0 rounded-xl bg-slate-50 px-3 py-2 text-right">
              <p className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">{labels.vehicle}</p>
              <p className="text-base font-black text-[#152638]">{vehicleRegistration}</p>
            </div>
          ) : null}
        </div>
      </section>

      {nextJob ? (
        <section className="mt-4">
          <CurrentJobCard job={nextJob} events={eventsByJob[nextJob.id] || []} language={language} labels={labels} />
        </section>
      ) : null}

      <section className="mt-5">
        <div className="mb-2 flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-slate-500" />
          <h2 className="text-sm font-black uppercase tracking-[0.14em] text-slate-700">{labels.today}</h2>
        </div>
        <div className="space-y-2">
          {todayJobs.filter((job) => job.id !== nextJob?.id).map((job) => (
            <CompactJobRow key={job.id} job={job} events={eventsByJob[job.id] || []} language={language} labels={labels} />
          ))}
          {!todayJobs.length ? <p className="rounded-xl border border-dashed border-slate-300 bg-white/70 p-4 text-center text-sm text-slate-500">{labels.noToday}</p> : null}
        </div>
      </section>

      <section className="mt-6 pb-6">
        <div className="mb-3 flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-slate-500" />
          <h2 className="text-sm font-black uppercase tracking-[0.14em] text-slate-700">{labels.upcoming}</h2>
        </div>

        {upcomingGroups.length ? (
          <div className="space-y-5">
            {upcomingGroups.map(([date, dateJobs]) => (
              <div key={date}>
                <h3 className="mb-2 text-sm font-black text-[#152638]">{formatDate(date)}</h3>
                <div className="space-y-2">
                  {dateJobs.map((job) => (
                    <CompactJobRow key={job.id} job={job} events={eventsByJob[job.id] || []} language={language} labels={labels} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : <p className="rounded-xl border border-dashed border-slate-300 bg-white/70 p-4 text-center text-sm text-slate-500">{labels.noUpcoming}</p>}
      </section>
    </main>
  );
}
