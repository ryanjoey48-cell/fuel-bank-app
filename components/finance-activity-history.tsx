"use client";

import { useState } from "react";
import { formatBangkokDateTime } from "@/lib/finance-display";
import type { Audit } from "@/lib/finance-demo-centre";
import { financeRecordsCopy, type FinanceRecordsLanguage } from "@/lib/finance-records-copy";
import { ACTIVITY_VIEW_ACTIONS } from "@/lib/finance-records";

/**
 * Expandable Activity History. The saved audit trail is never trimmed — screen-change events are only folded away by
 * default (one click shows them) so the useful events (prices, confirmations, reopenings) stay readable.
 * Office-only accounts are told the history exists but cannot read it.
 */
export default function FinanceActivityHistory({ entries, canView, language, defaultOpen = false, popover = false }: {
  entries: Audit[];
  canView: boolean;
  language: FinanceRecordsLanguage;
  defaultOpen?: boolean;
  /** Float the list under the summary (for use inside a toolbar) instead of pushing the page down. */
  popover?: boolean;
}) {
  const copy = financeRecordsCopy[language].activity;
  const [showViews, setShowViews] = useState(false);
  const viewChanges = entries.filter((entry) => ACTIVITY_VIEW_ACTIONS.has(entry.action));
  const shown = [...entries].filter((entry) => showViews || !ACTIVITY_VIEW_ACTIONS.has(entry.action)).sort((a, b) => b.step - a.step);
  return (
    <details className={`ees-fc-activity ${popover ? "relative" : ""}`} open={defaultOpen} data-testid="activity-history">
      <summary className="text-sm">{copy.title}{canView ? <span className="ml-2 font-normal text-slate-500">{copy.count(entries.length)}</span> : null}</summary>
      <div className={popover ? "absolute right-0 top-7 z-30 max-h-[22rem] w-[min(46rem,88vw)] overflow-auto rounded-xl bg-white p-3 shadow-xl ring-1 ring-slate-200" : "mt-2"}>
        {!canView ? (
          <p className="text-sm text-slate-600">{copy.restricted}</p>
        ) : !entries.length ? (
          <p className="text-sm text-slate-600">{copy.none}</p>
        ) : (
          <>
            <ol className="divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200">
              {shown.map((entry) => (
                <li key={`${entry.step}-${entry.at}`} className="grid gap-x-3 px-3 py-2 text-sm sm:grid-cols-[9.5rem_6rem_minmax(0,1fr)]">
                  <span className="tabular-nums text-slate-600">{formatBangkokDateTime(entry.at)}</span>
                  <span className="font-semibold text-slate-700">{copy.roles[entry.actor] ?? entry.actor}</span>
                  <span className="min-w-0">
                    <span className="font-bold text-slate-900">{copy.actions[entry.action] ?? entry.action}</span>
                    <span className="block break-words text-slate-600">{entry.detail}</span>
                  </span>
                </li>
              ))}
            </ol>
            {viewChanges.length ? (
              <button type="button" className="mt-2 text-sm font-semibold text-violet-800 hover:underline" onClick={() => setShowViews((value) => !value)}>
                {showViews ? copy.hideViewChanges : copy.showViewChanges(viewChanges.length)}
              </button>
            ) : null}
          </>
        )}
      </div>
    </details>
  );
}
