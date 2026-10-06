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
    noMoreToday: "No jobs remaining today",
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
    remaining: "งานที่เหลือวันนี้",
    remainingPlural: "งานที่เหลือวันนี้",
    noMoreToday: "วันนี้ไม่มีงานเหลือแล้ว",
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
      className="driver-home-next-job block overflow-hidden rounded-[26px] border border-[var(--driver-border)] bg-[var(--driver-surface)] text-white shadow-[0_10px_28px_rgba(16,42,67,0.16)] transition active:scale-[0.995]"
    >
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-1.5">
        <p className="driver-eyebrow driver-eyebrow-on-navy">
          {status === "ready" ? labels.next : labels.current}
        </p>
        <DriverStatusBadge language={language} status={status} />
      </div>

      <div className="px-4 py-[18px]">
        <h2 className="break-words text-[32px] font-black leading-none tracking-[-0.035em] text-white">
          {job.clientName || job.jobOrderNumber || labels.job}
        </h2>

        <div className="driver-home-route mt-3.5 grid grid-cols-[minmax(0,1fr)_28px_minmax(0,1fr)] items-center gap-3 rounded-2xl border border-white/10 bg-[var(--driver-surface)] px-3.5 py-3.5 shadow-inner shadow-black/5">
          <div className="min-w-0">
            <p className="driver-eyebrow driver-eyebrow-on-navy">
              {labels.pickup}
            </p>
            <p className="mt-1 break-words text-[18px] font-bold leading-6 text-white">
              {job.pickupName || "—"}
            </p>
          </div>

          <span aria-hidden="true" className="self-center text-center text-2xl font-light text-white/90">→</span>

          <div className="min-w-0 text-right">
            <p className="driver-eyebrow driver-eyebrow-on-navy">
              {labels.dropoff}
            </p>
            <p className="mt-1 break-words text-[18px] font-bold leading-6 text-white">
              {job.dropoffName || "—"}
            </p>
          </div>
        </div>

        <div className="driver-job-metadata mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-white/82">
          <span className="inline-flex items-center gap-1.5 font-medium">
            <CalendarDays className="h-4 w-4 shrink-0 text-white/85" />
            {formattedDate}
          </span>
          <span className="inline-flex items-center gap-1.5 font-medium">
            <Clock3 className="h-4 w-4 shrink-0 text-white/85" />
            {formatTime(job.pickupTime, labels.timePending)}
          </span>
          <span className="ml-auto inline-flex items-center gap-1.5 font-medium">
            <Truck className="h-4 w-4 shrink-0 text-white/85" />
            {job.vehicleRegistration || "—"}
          </span>
        </div>

        <div className="mt-3.5 flex justify-end">
          <span className="driver-primary-action inline-flex min-h-12 items-center gap-3 rounded-2xl px-6 text-base font-bold text-white shadow-[0_8px_18px_rgba(99,62,241,0.22)]">
            {driverJobAction(language, status)}
            <ChevronRight className="h-5 w-5" />
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
      className="driver-home-upcoming-job block border-b border-[var(--driver-border)] bg-[var(--driver-surface)] px-4 py-2 last:border-b-0 transition-colors active:bg-[var(--driver-surface)]"
    >
      <div className="flex items-center gap-3">
        <div className="grid min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1">
          <div className="flex items-center gap-2 text-xs text-[var(--driver-text-muted)]">
            <Clock3 className="h-3.5 w-3.5 shrink-0" />
            <span className="font-semibold">
              {formatTime(job.pickupTime, labels.timePending)}
            </span>
          </div>

          <p className="break-words font-bold leading-5 text-[var(--driver-text)]">
            {job.clientName || job.jobOrderNumber || labels.job}
          </p>

          <p className="col-span-2 break-words text-[13px] leading-5 text-[var(--driver-text-muted)]">
            {job.pickupName || "—"}
            <span className="px-1.5 text-[var(--driver-text-muted)]">→</span>
            {job.dropoffName || "—"}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <DriverStatusBadge language={language} status={status} />
          <ChevronRight className="h-5 w-5 text-[var(--driver-text-muted)]" />
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

  const nextJob = nextDriverJob(jobs, eventsByJob, today);

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

  return (
    <main className="driver-home-restored mx-auto w-full max-w-3xl px-3 pb-3 pt-2 sm:px-6 sm:py-5">
      <section className="driver-home-banner relative min-h-[112px] overflow-hidden rounded-[24px] border border-[var(--driver-border)] bg-[var(--driver-surface)] shadow-sm sm:min-h-[144px]">
        <Image
          src="/driver-hero-bg.png"
          alt=""
          aria-hidden="true"
          fill
          sizes="(max-width: 768px) 100vw, 768px"
          className="object-cover object-[left_55%]"
          style={{ width: "118%", left: "-18%", maxWidth: "none" }}
          priority
        />

        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[linear-gradient(90deg,rgba(11,15,20,0.92)_0%,rgba(11,15,20,0.80)_30%,rgba(11,15,20,0.44)_56%,rgba(11,15,20,0.20)_100%)]"
        />

        <div className="relative z-10 min-h-[110px] px-4 py-3 sm:min-h-[142px] sm:px-5">
          <div className="max-w-[calc(100%-128px)]">
            <p className="text-[15px] font-medium text-[var(--driver-text-muted)]">
              {labels.hello},
            </p>

            <h1 className="mt-1 break-words text-[28px] font-semibold leading-8 tracking-[-0.03em] text-[var(--driver-text)] sm:text-[30px]">
              {profile?.displayName || driverName}
            </h1>

            {remainingToday.length > 0 ? (
              <p className="mt-2 text-[13px] font-semibold text-[var(--driver-text-muted)]">
                <strong className="text-[var(--driver-text)]">{remainingToday.length}</strong>{" "}
                {remainingLabel}
              </p>
            ) : (
              <div className="mt-2 text-sm">
                <p className="font-medium text-[var(--driver-text-muted)]">
                  {labels.noMoreToday}
                </p>

              </div>
            )}
          </div>

          {vehicleRegistration ? (
            <div className="driver-home-vehicle-badge absolute right-4 top-4 w-[116px] rounded-xl border border-[var(--driver-border)] bg-[var(--driver-surface-soft)] px-2 py-2 shadow-sm">
              <div className="flex items-start gap-2">
                  <Truck aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-[var(--driver-text)]" />
                <div className="min-w-0">
                  <p className="break-words text-sm font-semibold leading-5 text-[var(--driver-text)]">
                    {vehicleRegistration}
                  </p>
                  {vehicleType ? (
                    <p className="mt-1 line-clamp-2 text-[11px] font-medium leading-4 text-[var(--driver-text-muted)]">
                      {getPortalVehicleTypeLabel(vehicleType, language)}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      {nextJob ? (
        <section className="mt-2">
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
          <CalendarDays className="h-5 w-5 text-[var(--driver-text-muted)]" />
          <h2 className="text-[16px] font-medium text-[var(--driver-text)]">
            {labels.upcoming}
          </h2>
        </div>

        {upcomingGroups.length ? (
          <div className="space-y-4">
            {upcomingGroups.map(([date, dateJobs]) => (
              <div key={date}>
                <div className="mb-1.5 flex items-center justify-between">
                  <h3 className="text-sm font-black text-[var(--driver-text)]">
                    {formatGroupDate(date)}
                  </h3>

                  <span className="driver-upcoming-count rounded-full border border-[var(--driver-border)] bg-[var(--driver-surface)] px-2 py-0.5 text-[11px] font-bold text-[var(--driver-text-muted)]">
                    {dateJobs.length}
                  </span>
                </div>

                <div className="driver-home-upcoming-group overflow-hidden rounded-2xl border border-[var(--driver-border)] bg-[var(--driver-surface)] shadow-[0_4px_14px_rgba(21,38,56,0.06)]">
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
          <p className="rounded-xl border border-dashed border-[var(--driver-border)] bg-[var(--driver-surface)] p-4 text-center text-sm text-[var(--driver-text-muted)]">
            {labels.noUpcoming}
          </p>
        )}
      </section>
    </main>
  );
}
