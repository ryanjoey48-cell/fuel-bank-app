"use client";

import { ArrowDown, CalendarDays, ChevronRight, Clock3, Truck } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { useLanguage } from "@/lib/language-provider";
import type { DriverPortalJob } from "@/lib/driver-portal";

const copy = {
  en: {
    greeting: "Hello",
    intro: "Your assigned work, in pickup order.",
    today: "Today",
    upcoming: "Upcoming",
    noToday: "No jobs assigned for today.",
    noUpcoming: "No upcoming jobs assigned.",
    vehicle: "Vehicle",
    job: "Job",
    view: "View job",
    timePending: "Time not set",
    tomorrow: "Tomorrow"
  },
  th: {
    greeting: "สวัสดี",
    intro: "งานที่ได้รับมอบหมาย เรียงตามเวลารับสินค้า",
    today: "วันนี้",
    upcoming: "งานถัดไป",
    noToday: "วันนี้ยังไม่มีงานที่ได้รับมอบหมาย",
    noUpcoming: "ยังไม่มีงานล่วงหน้าที่ได้รับมอบหมาย",
    vehicle: "รถ",
    job: "เลขงาน",
    view: "ดูงาน",
    timePending: "ยังไม่กำหนดเวลา",
    tomorrow: "พรุ่งนี้"
  }
} as const;

function formatTime(value: string | null, fallback: string) {
  if (!value) return fallback;
  return value.slice(0, 5);
}

function addDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T12:00:00+07:00`);
  date.setUTCDate(date.getUTCDate() + days);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(date);
}

function JobCard({ job, labels }: { job: DriverPortalJob; labels: (typeof copy)[keyof typeof copy] }) {
  return (
    <article className="rounded-[1.25rem] border border-slate-200 bg-[#fffdf8] p-4 shadow-[0_10px_28px_rgba(57,40,24,0.07)]">
      <div className="flex items-start justify-between gap-3">
        <div className="inline-flex items-center gap-2 rounded-lg bg-brand-50 px-2.5 py-1.5 text-sm font-black text-brand-800">
          <Clock3 className="h-4 w-4" />
          {formatTime(job.pickupTime, labels.timePending)}
        </div>
        {job.jobOrderNumber ? (
          <span className="max-w-[45%] truncate text-[11px] font-bold text-slate-500">{labels.job} {job.jobOrderNumber}</span>
        ) : null}
      </div>

      {job.clientName ? <p className="mt-4 text-xs font-black uppercase tracking-[0.1em] text-slate-500">{job.clientName}</p> : null}
      <div className="mt-2 grid grid-cols-[18px_minmax(0,1fr)] gap-x-2 gap-y-1">
        <span className="mt-1 h-2 w-2 rounded-full bg-accent-500" aria-hidden="true" />
        <p className="text-base font-bold leading-6 text-slate-950">{job.pickupName}</p>
        <ArrowDown className="h-4 w-4 text-brand-500" aria-hidden="true" />
        <p className="text-base font-bold leading-6 text-slate-950">{job.dropoffName}</p>
      </div>

      {job.vehicleRegistration ? (
        <p className="mt-4 flex items-center gap-2 text-sm font-semibold text-slate-600">
          <Truck className="h-4 w-4 text-brand-600" />
          {labels.vehicle}: <span className="font-black text-slate-900">{job.vehicleRegistration}</span>
        </p>
      ) : null}

      <Link href={`/driver/jobs/${job.id}`} className="mt-4 flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand-700 px-4 text-sm font-bold text-white shadow-[0_8px_18px_rgba(91,35,142,0.18)] hover:bg-brand-800">
        {labels.view}
        <ChevronRight className="h-4 w-4" />
      </Link>
    </article>
  );
}

export function DriverHome({ driverName, jobs, today }: { driverName: string; jobs: DriverPortalJob[]; today: string }) {
  const { language } = useLanguage();
  const labels = copy[language];
  const todayJobs = jobs.filter((job) => job.bookingDate === today);
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

  const formatDate = (dateKey: string) => {
    if (dateKey === addDays(today, 1)) return labels.tomorrow;
    return new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "Asia/Bangkok"
    }).format(new Date(`${dateKey}T12:00:00+07:00`));
  };

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <section>
        <p className="text-sm font-semibold text-brand-700">{labels.greeting},</p>
        <h1 className="mt-1 text-[2rem] font-black tracking-[-0.045em] text-slate-950">{driverName}</h1>
        <p className="mt-2 text-sm text-slate-600">{labels.intro}</p>
      </section>

      <section className="mt-8">
        <div className="mb-3 flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-brand-700" />
          <h2 className="text-xs font-black uppercase tracking-[0.16em] text-slate-700">{labels.today}</h2>
          <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-black text-brand-700">{todayJobs.length}</span>
        </div>
        {todayJobs.length ? (
          <div className="grid gap-3 sm:grid-cols-2">{todayJobs.map((job) => <JobCard key={job.id} job={job} labels={labels} />)}</div>
        ) : (
          <div className="rounded-[1.25rem] border border-dashed border-slate-300 bg-[#fffdf8]/75 px-5 py-8 text-center text-sm font-semibold text-slate-500">{labels.noToday}</div>
        )}
      </section>

      <section className="mt-9 pb-8">
        <h2 className="text-xs font-black uppercase tracking-[0.16em] text-slate-700">{labels.upcoming}</h2>
        {upcomingGroups.length ? (
          <div className="mt-4 space-y-7">
            {upcomingGroups.map(([date, dateJobs]) => (
              <div key={date}>
                <h3 className="mb-3 text-sm font-black text-brand-800">{formatDate(date)}</h3>
                <div className="grid gap-3 sm:grid-cols-2">{dateJobs.map((job) => <JobCard key={job.id} job={job} labels={labels} />)}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-3 rounded-[1.25rem] border border-dashed border-slate-300 bg-[#fffdf8]/75 px-5 py-8 text-center text-sm font-semibold text-slate-500">{labels.noUpcoming}</div>
        )}
      </section>
    </main>
  );
}

