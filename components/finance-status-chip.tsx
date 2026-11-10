"use client";

import { financeRecordsCopy, type FinanceRecordsLanguage } from "@/lib/finance-records-copy";
import type { RecordStatus } from "@/lib/finance-records";

/** One status vocabulary for every Finance screen. A draft is never styled or worded like an issued document. */
export function FinanceStatusChip({ status, language, className = "" }: { status: RecordStatus; language: FinanceRecordsLanguage; className?: string }) {
  const copy = financeRecordsCopy[language];
  return <span className={`ees-fc-chip ees-fc-chip--${status} ${className}`} data-status={status} title={copy.statusHint[status]}>{copy.status[status]}</span>;
}

/** Marks a simulated TRN (local test numbering) wherever the number itself is shown in a table. */
export function SimulatedTrnBadge({ language }: { language: FinanceRecordsLanguage }) {
  const copy = financeRecordsCopy[language];
  return <span className="ees-fc-test-badge" title={copy.sim.tooltip}>{copy.sim.badge}</span>;
}
