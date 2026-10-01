"use client";

import { useMemo, useState } from "react";
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
import { MaintenanceField as Field } from "./maintenance-fields";

export function MaintenanceRecordCollection({
  records,
  data,
  onEdit,
  onChanged,
  reminders,
  showSummary = true,
}: {
  records: MaintenanceRecord[];
  data: MaintenanceData;
  onEdit: (record: MaintenanceRecord) => void;
  onChanged: () => void;
  reminders?: MaintenanceReminder[];
  showSummary?: boolean;
}) {
  const { t, language } = useLanguage();
  const c = t.maintenance;

  const [sort, setSort] =
    useState<MaintenanceHistorySort>("newestFirst");

  const [group, setGroup] = useState<
    "recordsGroup" | "vehicleGroup"
  >("recordsGroup");

  const summary = useMemo(
    () => maintenanceHistorySummary(records),
    [records]
  );

  const sorted = useMemo(
    () => sortMaintenanceHistory(records, data, sort),
    [records, data, sort]
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

      grouped.set(key, [
        ...(grouped.get(key) ?? []),
        record,
      ]);
    }

    return Array.from(grouped.entries());
  }, [sorted, group]);

  return (
    <div className="space-y-4">
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

      {/* HISTORY CONTROLS */}
      {!!records.length && (
        <div className="flex flex-col gap-3 rounded-2xl border border-slate-100 bg-slate-50/70 px-4 py-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold text-slate-800">
              Maintenance records
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              {formatNumber(records.length, language)} records in the
              selected period.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:w-[520px]">
            <Field label={c.sortBy}>
              <select
                className="form-input !min-h-10"
                value={sort}
                onChange={(event) =>
                  setSort(
                    event.target.value as MaintenanceHistorySort
                  )
                }
              >
                {(
                  [
                    "newestFirst",
                    "oldestFirst",
                    "highestCost",
                    "vehicleRegistration",
                  ] as const
                ).map((key) => (
                  <option key={key} value={key}>
                    {c[key]}
                  </option>
                ))}
              </select>
            </Field>

            <Field label={c.groupBy}>
              <select
                className="form-input !min-h-10"
                value={group}
                onChange={(event) =>
                  setGroup(
                    event.target.value as
                      | "recordsGroup"
                      | "vehicleGroup"
                  )
                }
              >
                <option value="recordsGroup">
                  {c.recordsGroup}
                </option>
                <option value="vehicleGroup">
                  {c.vehicleGroup}
                </option>
              </select>
            </Field>
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
          <section key={key} className="space-y-3">
            {group === "vehicleGroup" && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-violet-100 bg-violet-50/50 px-4 py-3">
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

            <div className="grid items-start gap-3 xl:grid-cols-2">
              {entries.map((record) => (
                <MaintenanceVisit
                  key={record.id}
                  record={record}
                  data={data}
                  onEdit={onEdit}
                  onChanged={onChanged}
                  reminders={statuses}
                  detailed={false}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}