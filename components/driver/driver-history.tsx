"use client";

import Link from "next/link";
import { CheckCircle2, ChevronRight } from "lucide-react";
import { useLanguage } from "@/lib/language-provider";
import type { DriverWork } from "@/lib/driver-operations";

export function DriverHistory({ rows, page, hasMore }: { rows: DriverWork[]; page: number; hasMore: boolean }) {
  const { language } = useLanguage();
  const th = language === "th";
  const format = (value: string) => new Intl.DateTimeFormat(th ? "th-TH" : "en-GB", {
    dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok"
  }).format(new Date(value));

  return (
    <main className="driver-history mx-auto max-w-3xl px-3 py-3 sm:px-4 sm:py-5">
      <header className="mb-3 px-1">
        <h1 className="driver-page-title">{th ? "ประวัติงาน" : "History"}</h1>
        <div className="mt-1 flex items-center gap-2 text-sm text-[var(--driver-text-muted)]"><p>{th ? "งานที่จบแล้ว" : "Completed jobs"}</p><span className="rounded-full bg-[var(--driver-surface-soft)] px-2 py-0.5 text-xs font-bold text-[var(--driver-text)]" aria-label={th ? "จำนวนงานในหน้านี้" : "Jobs on this page"}>{rows.length}</span></div>
      </header>

      {!rows.length ? (
        <p className="rounded-xl border border-dashed border-[var(--driver-border)] bg-[var(--driver-surface-soft)] p-5 text-center text-sm text-[var(--driver-text-muted)]">{th ? "ยังไม่มีงานที่จบแล้ว" : "No completed jobs yet"}</p>
      ) : (
        <div className="space-y-2">
          {rows.map(({ job, events }) => {
            const completed = events.find((e) => e.eventType === "job_completed");
            if (!completed) return null;
            return (
              <Link href={`/driver/jobs/${job.id}`} key={job.id} className="driver-surface block px-4 py-2.5 sm:py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="min-w-0 text-xs text-[var(--driver-text-muted)]">{format(completed.eventTime)}</p>
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--driver-surface-soft)] px-2 py-0.5 text-[11px] font-semibold text-[var(--driver-text-muted)]">
                    <CheckCircle2 aria-hidden="true" className="h-3 w-3" />{th ? "จบแล้ว" : "Done"}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h2 className="mt-1 break-words font-bold text-[var(--driver-text)]">{job.clientName || (th ? "งาน" : "Job")}</h2>
                    <p className="mt-1 line-clamp-2 break-words text-sm text-[var(--driver-text-muted)]">{job.pickupName} <span className="text-[var(--driver-text-muted)]">→</span> {job.dropoffName}</p>
                  </div>
                  <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-[var(--driver-text-muted)]" />
                </div>
              </Link>
            );
          })}
        </div>
      )}

      <div className="mt-4 flex justify-between">
        {page > 0 ? <Link className="btn-secondary" href={`/driver/history?page=${page - 1}`}>{th ? "ก่อนหน้า" : "Previous"}</Link> : <span />}
        {hasMore ? <Link className="btn-secondary" href={`/driver/history?page=${page + 1}`}>{th ? "ถัดไป" : "Next"}</Link> : null}
      </div>
    </main>
  );
}
