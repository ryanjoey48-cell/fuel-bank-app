"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useLanguage } from "@/lib/language-provider";
import {
  maintenanceHistorySummary,
  sortMaintenanceHistory,
  type MaintenanceHistorySort,
} from "@/lib/maintenance-ux";
import { buildMaintenanceReminders } from "@/lib/maintenance";
import type {
  MaintenanceData,
  MaintenanceRecord,
  MaintenanceReminder,
} from "@/lib/maintenance-types";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { MaintenanceVisit } from "./maintenance-record-card";

export function MaintenanceRecordCollection({
  records,
  data,
  onEdit,
  onChanged,
  reminders,
  showSummary = true,
  compact = false,
  sortBy,
  onSortChange,
  pagination,
}: {
  records: MaintenanceRecord[];
  data: MaintenanceData;
  onEdit: (record: MaintenanceRecord) => void;
  onChanged: () => void;
  reminders?: MaintenanceReminder[];
  showSummary?: boolean;
  compact?: boolean;
  pagination?: ReactNode;
  sortBy?: MaintenanceHistorySort;
  onSortChange?: (sort:MaintenanceHistorySort)=>void;
}) {
  const { t, language } = useLanguage();
  const c = t.maintenance;

  const [sort, setSort] = useState<MaintenanceHistorySort>("newestFirst");

  const [group, setGroup] = useState<
    "recordsGroup" | "vehicleGroup"
  >("recordsGroup");

  const summary = useMemo(
    () => maintenanceHistorySummary(records),
    [records]
  );

  const sorted = useMemo(
    () => sortMaintenanceHistory(records, data, sortBy??sort),
    [records, data, sort, sortBy]
  );

  const statuses = useMemo(
    () => reminders ?? buildMaintenanceReminders(data),
    [reminders, data]
  );

  const groups = useMemo(() => {
    const grouped = new Map<string, MaintenanceRecord[]>();

    for (const record of sorted) {
      const key =
        group === "vehicleGroup" ? record.vehicle_id : "all";

      const existing = grouped.get(key);
      if (existing) {
        existing.push(record);
      } else {
        grouped.set(key, [record]);
      }
    }

    return Array.from(grouped.entries());
  }, [sorted, group]);

  return (
    <div className="space-y-3">
      {/* PERIOD SUMMARY */}
      {showSummary && (
        <div
          aria-label={c.periodSummary}
          className="grid overflow-hidden rounded-2xl border border-violet-100 bg-violet-100 sm:grid-cols-2 xl:grid-cols-4"
        >
          {[
            [c.visits, formatNumber(summary.records, language)],
            [
              c.vehiclesServiced,
              formatNumber(summary.vehicles, language),
            ],
            [c.spending, formatCurrency(summary.total, language)],
            [
              c.averageRecord,
              summary.average === null
                ? "—"
                : formatCurrency(summary.average, language),
            ],
          ].map(([label, value], index) => (
            <div
              key={label}
              className={[
                "min-w-0 bg-white px-4 py-3.5",
                index > 0 ? "border-l border-violet-100" : "",
              ].join(" ")}
            >
              <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-slate-400">
                {label}
              </p>

              <p className="mt-1 truncate text-lg font-semibold tracking-tight text-slate-900">
                {value}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Compact record navigation: page controls and view options share one toolbar. */}
      {!compact && (!!records.length || !!pagination) && (
        <div className="maintenance-record-controls flex flex-wrap items-end justify-between gap-x-4 gap-y-3 rounded-xl border border-slate-200/80 bg-white px-3 py-3 sm:px-4">
          {pagination && (
            <div className="min-w-0 flex-1 text-sm text-slate-600">
              {pagination}
            </div>
          )}
          <div className="flex w-full flex-wrap items-end gap-2 sm:w-auto sm:ml-auto">
            <label className="min-w-[155px] flex-1 space-y-1 sm:flex-none">
              <span className="block text-[11px] font-medium text-slate-500">
                {c.sortBy}
              </span>
              <select
                className="form-input !min-h-10 w-full rounded-lg border-slate-200 bg-slate-50 px-3 text-sm text-slate-800"
                value={sortBy ?? sort}
                onChange={(event) => {
                  const value = event.target.value as MaintenanceHistorySort;
                  setSort(value);
                  onSortChange?.(value);
                }}
              >
                {([
                  "newestFirst",
                  "oldestFirst",
                  "highestCost",
                  "vehicleRegistration",
                ] as const).map((key) => (
                  <option key={key} value={key}>{c[key]}</option>
                ))}
              </select>
            </label>
            <label className="min-w-[155px] flex-1 space-y-1 sm:flex-none">
              <span className="block text-[11px] font-medium text-slate-500">
                {c.groupBy}
              </span>
              <select
                className="form-input !min-h-10 w-full rounded-lg border-slate-200 bg-slate-50 px-3 text-sm text-slate-800"
                value={group}
                onChange={(event) => setGroup(
                  event.target.value as "recordsGroup" | "vehicleGroup"
                )}
              >
                <option value="recordsGroup">{c.recordsGroup}</option>
                <option value="vehicleGroup">{c.vehicleGroup}</option>
              </select>
            </label>
          </div>
        </div>
      )}

      {/* EMPTY STATE */}
      {!records.length && (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 px-5 py-10 text-center">
          <p className="text-sm font-medium text-slate-700">
            {c.empty}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Maintenance records added for this period will appear here.
          </p>
        </div>
      )}

      {/* RECORDS */}
      {groups.map(([key, entries]) => {
        const subtotal = maintenanceHistorySummary(entries);

        const vehicle =
          group === "vehicleGroup"
            ? data.vehicles.find((item) => item.id === key)
            : null;

        return (
          <section key={key} className="space-y-2.5">
            {group === "vehicleGroup" && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-violet-100 bg-violet-50/40 px-4 py-2.5">
                <div>
                  <h4 className="font-semibold text-slate-900">
                    {vehicle?.vehicle_reg ?? "—"}
                  </h4>

                  <p className="mt-0.5 text-xs text-slate-500">
                    {formatNumber(entries.length, language)}{" "}
                    {c.visits}
                  </p>
                </div>

                <p className="text-sm font-semibold text-violet-900">
                  {formatCurrency(subtotal.total, language)}
                </p>
              </div>
            )}

            <div className="grid items-stretch gap-3 xl:grid-cols-2">
              {entries.map((record) => (
                <MaintenanceVisit
                  key={record.id}
                  record={record}
                  data={data}
                  onEdit={onEdit}
                  onChanged={onChanged}
                  reminders={statuses}
                  detailed={false}
                  summaryDescription={compact}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}