"use client";

import { CalendarDays, ChevronRight, Clock3, Truck } from "lucide-react";
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
    remaining: "job remaining today",
    remainingPlural: "jobs remaining today",
    noMoreToday: "No more jobs today",
    noUpcoming: "No upcoming jobs",
    tomorrow: "Tomorrow",
    nextJobDate: "Next job",
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
    remaining: "งานที่เหลือวันนี้",
    remainingPlural: "งานที่เหลือวันนี้",
    noMoreToday: "วันนี้ไม่มีงานเหลือแล้ว",
    noUpcoming: "ยังไม่มีงานล่วงหน้า",
    tomorrow: "พรุ่งนี้",
    nextJobDate: "งานถัดไป",
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
  date.setDate(date.getDate() + days);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(date);
}

function formatDateKey(dateKey: string, language: "en" | "th") {
  return new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Bangkok"
  }).format(new Date(`${dateKey}T12:00:00+07:00`));
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
  const formattedDate = formatDateKey(job.bookingDate, language);

  return (
    <Link
      href={`/driver/jobs/${job.id}`}
      className="block overflow-hidden rounded-[22px] bg-[#152638] text-white shadow-[0_10px_28px_rgba(21,38,56,0.16)] transition active:scale-[0.995]"
    >
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <p className="text-[11px] font-black tracking-[0.16em] text-orange-300">
          {status === "ready" ? labels.next : labels.current}
        </p>
        <DriverStatusBadge language={language} status={status} />
      </div>

      <div className="p-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-white/70">
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

        <h2 className="mt-3 break-words text-[24px] font-black leading-tight">
          {job.clientName || job.jobOrderNumber || labels.job}
        </h2>

        <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-start gap-3 rounded-2xl bg-white/[0.06] px-3.5 py-3">
          <div className="min-w-0">
            <p className="text-[9px] font-black uppercase tracking-[0.13em] text-white/45">
              {labels.pickup}
            </p>
            <p className="mt-1 break-words text-sm font-bold leading-5 text-white">
              {job.pickupName || "—"}
            </p>
          </div>

          <span className="pt-4 text-xl font-black text-orange-300">→</span>

          <div className="min-w-0 text-right">
            <p className="text-[9px] font-black uppercase tracking-[0.13em] text-white/45">
              {labels.dropoff}
            </p>
            <p className="mt-1 break-words text-sm font-bold leading-5 text-white">
              {job.dropoffName || "—"}
            </p>
          </div>
        </div>

        <div className="mt-3 flex justify-end">
          <span className="inline-flex min-h-10 items-center gap-1 rounded-xl bg-orange-600 px-4 text-sm font-black text-white shadow-sm">
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
      className="block border-b border-slate-100 bg-white px-4 py-3.5 last:border-b-0 active:bg-slate-50"
    >
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Clock3 className="h-3.5 w-3.5 shrink-0" />
            <span className="font-semibold">
              {formatTime(job.pickupTime, labels.timePending)}
            </span>
          </div>

          <p className="mt-1.5 break-words font-black leading-5 text-[#152638]">
            {job.clientName || job.jobOrderNumber || labels.job}
          </p>

          <p className="mt-1 break-words text-[13px] leading-5 text-slate-600">
            {job.pickupName || "—"}
            <span className="px-1.5 text-orange-500">→</span>
            {job.dropoffName || "—"}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <DriverStatusBadge language={language} status={status} />
          <ChevronRight className="h-5 w-5 text-slate-300" />
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

    const load = async () => {
      try {
        const response = await fetch(`/api/driver/profile?_=${Date.now()}`, {
          cache: "no-store",
          credentials: "same-origin",
          headers: { "Cache-Control": "no-cache", Pragma: "no-cache" }
        });

        if (response.ok && active) setProfile(await response.json());
      } catch {
        // Keep server-provided driver identity if profile is unavailable.
      }
    };

    const updated = (event: Event) => {
      setProfile((event as CustomEvent<DriverProfile>).detail);
    };

    window.addEventListener("ees-driver-profile-updated", updated);
    void load();

    return () => {
      active = false;
      window.removeEventListener("ees-driver-profile-updated", updated);
    };
  }, []);

  const todayJobs = useMemo(
    () =>
      jobs
        .filter((job) => job.bookingDate === today)
        .sort((a, b) =>
          (a.pickupTime || "99:99").localeCompare(b.pickupTime || "99:99")
        ),
    [jobs, today]
  );

  const remainingToday = todayJobs.filter(
    (job) => jobStatus(eventsByJob[job.id] || []) !== "completed"
  );

  const nextJob = nextDriverJob(jobs, eventsByJob);

  const vehicleRegistration =
    nextJob?.vehicleRegistration ??
    profile?.vehicle ??
    jobs[0]?.vehicleRegistration ??
    null;

  const vehicleType =
    nextJob?.vehicleType ??
    jobs.find((job) => job.vehicleRegistration === vehicleRegistration)?.vehicleType ??
    null;

  /*
   * Upcoming means future + unfinished only.
   * Completed test/early-completed jobs belong in History, never Upcoming.
   * The large NEXT JOB card is also removed from this list to avoid duplication.
   */
  const upcomingGroups = useMemo(() => {
    const groups = new Map<string, DriverPortalJob[]>();

    for (const job of jobs) {
      if (job.bookingDate <= today) continue;
      if (job.id === nextJob?.id) continue;
      if (jobStatus(eventsByJob[job.id] || []) === "completed") continue;

      const entries = groups.get(job.bookingDate) ?? [];
      entries.push(job);
      groups.set(job.bookingDate, entries);
    }

    return [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(
        ([date, entries]) =>
          [
            date,
            entries.sort((a, b) =>
              (a.pickupTime || "99:99").localeCompare(
                b.pickupTime || "99:99"
              )
            )
          ] as const
      );
  }, [jobs, today, nextJob?.id, eventsByJob]);

  const formatGroupDate = (dateKey: string) => {
    if (dateKey === addDays(today, 1)) return labels.tomorrow;
    return formatDateKey(dateKey, language);
  };

  const remainingLabel =
    remainingToday.length === 1 ? labels.remaining : labels.remainingPlural;

  const nextJobDate =
    nextJob && nextJob.bookingDate > today
      ? formatGroupDate(nextJob.bookingDate)
      : null;

  return (
    <main className="mx-auto w-full max-w-3xl px-3 py-3 sm:px-6 sm:py-5">
      <section className="relative h-[158px] overflow-hidden rounded-[24px] border border-[#ded5c8] bg-[#f4eee5] shadow-[0_8px_22px_rgba(21,38,56,0.10)] sm:h-[176px]">
        <Image
          src="/ees-truck.png"
          alt=""
          fill
          sizes="(max-width: 768px) 100vw, 768px"
          className="object-cover object-[62%_50%] sm:object-center"
          priority
        />

        {/* Keep the truck crisp. Only soften the left side so the greeting stays readable. */}
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[linear-gradient(90deg,rgba(255,249,239,0.96)_0%,rgba(255,249,239,0.86)_32%,rgba(255,249,239,0.38)_58%,rgba(255,249,239,0.06)_78%)]"
        />
        <div
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-[#fff9ef]/75 to-transparent"
        />

        <div className="relative z-10 h-full px-4 py-4 sm:px-5">
          {vehicleRegistration ? (
            <div className="absolute right-3 top-3 max-w-[158px] rounded-[18px] border border-white/90 bg-white/94 px-3 py-2.5 shadow-[0_6px_18px_rgba(21,38,56,0.12)] backdrop-blur-md sm:right-4 sm:top-4 sm:max-w-[178px]">
              <div className="flex items-start gap-2.5">
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#f2f5f7]">
                  <Truck className="h-4.5 w-4.5 text-[#152638]" />
                </div>

                <div className="min-w-0">
                  <p className="text-[19px] font-black leading-5 tracking-[-0.02em] text-[#152638]">
                    {vehicleRegistration}
                  </p>

                  {vehicleType ? (
                    <p className="mt-1 line-clamp-2 text-[11px] font-semibold leading-4 text-slate-500">
                      {getPortalVehicleTypeLabel(vehicleType, language)}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          <div className="absolute bottom-4 left-4 right-[150px] min-w-0 sm:bottom-5 sm:left-5 sm:right-[188px]">
            <p className="text-[13px] font-semibold text-slate-500">
              {labels.hello},
            </p>

            <h1 className="mt-0.5 truncate text-[27px] font-black leading-8 tracking-[-0.035em] text-[#152638] sm:text-[30px]">
              {profile?.displayName || driverName}
            </h1>

            {remainingToday.length > 0 ? (
              <div className="mt-2 inline-flex items-center rounded-full bg-white/88 px-2.5 py-1 text-[12px] font-bold text-[#152638] shadow-sm backdrop-blur-sm">
                <strong className="mr-1">{remainingToday.length}</strong>
                {remainingLabel}
              </div>
            ) : (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="inline-flex rounded-full bg-emerald-50/95 px-2.5 py-1 text-[12px] font-bold text-emerald-700 shadow-sm">
                  {labels.noMoreToday}
                </span>

                {nextJobDate ? (
                  <span className="inline-flex rounded-full bg-white/88 px-2.5 py-1 text-[11px] font-bold text-slate-600 shadow-sm backdrop-blur-sm">
                    {labels.nextJobDate} · {nextJobDate}
                  </span>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </section>

      {nextJob ? (
        <section className="mt-3">
          <CurrentJobCard
            job={nextJob}
            events={eventsByJob[nextJob.id] || []}
            language={language}
            labels={labels}
          />
        </section>
      ) : null}

      <section className="mt-4 pb-6">
        <div className="mb-2.5 flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-slate-500" />
          <h2 className="text-xs font-black uppercase tracking-[0.14em] text-slate-700">
            {labels.upcoming}
          </h2>
        </div>

        {upcomingGroups.length ? (
          <div className="space-y-4">
            {upcomingGroups.map(([date, dateJobs]) => (
              <div key={date}>
                <div className="mb-1.5 flex items-center justify-between">
                  <h3 className="text-sm font-black text-[#152638]">
                    {formatGroupDate(date)}
                  </h3>

                  <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold text-slate-500 shadow-sm">
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
