"use client";

import { CalendarClock, Download, FileText, Route, TrendingUp } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/empty-state";
import { Header } from "@/components/header";
import { StatCard } from "@/components/stat-card";
import { fetchDrivers, fetchWeeklyMileage, saveWeeklyMileage } from "@/lib/data";
import { exportToXlsx } from "@/lib/export";
import { useLanguage } from "@/lib/language-provider";
import { formatDate, formatNumber } from "@/lib/utils";
import type { Driver, WeeklyMileageEntry } from "@/types/database";

const initialForm = {
  id: "",
  week_ending: "",
  driver_id: "",
  driver: "",
  vehicle_reg: "",
  mileage: ""
};

type WeeklyTrendRow = {
  weekEnding: string;
  mileage: number;
  submitted: number;
};

export default function WeeklyMileagePage() {
  const { language, t } = useLanguage();
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [entries, setEntries] = useState<WeeklyMileageEntry[]>([]);
  const [form, setForm] = useState(initialForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEditing = Boolean(form.id);

  const selectedDriver = useMemo(
    () => drivers.find((driver) => String(driver.id) === String(form.driver_id)),
    [drivers, form.driver_id]
  );

  const sortedEntries = useMemo(() => {
    return [...entries].sort((a, b) => {
      const dateDiff = new Date(b.week_ending).getTime() - new Date(a.week_ending).getTime();
      if (dateDiff !== 0) {
        return dateDiff;
      }
      return String(b.id).localeCompare(String(a.id));
    });
  }, [entries]);

  const weeklyTrendRows = useMemo(() => {
    return Array.from(
      sortedEntries.reduce((map, entry) => {
        const current = map.get(entry.week_ending) ?? {
          weekEnding: entry.week_ending,
          mileage: 0,
          submittedVehicles: new Set<string>()
        };
        current.mileage += Number(entry.mileage || 0);
        current.submittedVehicles.add(entry.vehicle_reg || String(entry.driver_id));
        map.set(entry.week_ending, current);
        return map;
      }, new Map<string, { weekEnding: string; mileage: number; submittedVehicles: Set<string> }>())
    )
      .map(([, value]) => ({
        weekEnding: value.weekEnding,
        mileage: value.mileage,
        submitted: value.submittedVehicles.size
      }))
      .sort((a, b) => new Date(b.weekEnding).getTime() - new Date(a.weekEnding).getTime())
      .slice(0, 8);
  }, [sortedEntries]);

  const latestWeekRow = weeklyTrendRows[0] ?? null;
  const latestWeekEntries = latestWeekRow
    ? sortedEntries.filter((entry) => entry.week_ending === latestWeekRow.weekEnding)
    : [];

  const totalMileageThisWeek = latestWeekRow?.mileage ?? 0;
  const totalReportingWeeks = new Set(sortedEntries.map((entry) => entry.week_ending)).size;
  const vehiclesSubmittedThisWeek = new Set(
    latestWeekEntries.map((entry) => entry.vehicle_reg || String(entry.driver_id))
  ).size;
  const lastUpdatedWeekLabel = latestWeekRow ? formatDate(latestWeekRow.weekEnding, language) : "-";

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);

      const [driverRows, mileageRows] = await Promise.all([fetchDrivers(), fetchWeeklyMileage()]);
      setDrivers(driverRows);
      setEntries(mileageRows);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.weeklyMileage.errorLoad);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [t.weeklyMileage.errorLoad]);

  useEffect(() => {
    if (!selectedDriver) {
      return;
    }

    setForm((current) => ({
      ...current,
      driver: selectedDriver.name,
      vehicle_reg: selectedDriver.vehicle_reg
    }));
  }, [selectedDriver]);

  const resetForm = () => {
    setForm(initialForm);
    setError(null);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const numericMileage = Number(form.mileage);
      const previousVehicleEntry = [...entries]
        .filter(
          (entry) =>
            entry.vehicle_reg === form.vehicle_reg &&
            String(entry.id) !== String(form.id) &&
            entry.week_ending <= form.week_ending
        )
        .sort((a, b) => {
          const dateDiff = new Date(b.week_ending).getTime() - new Date(a.week_ending).getTime();
          if (dateDiff !== 0) {
            return dateDiff;
          }
          return String(b.id).localeCompare(String(a.id));
        })[0];

      if (
        previousVehicleEntry?.mileage != null &&
        numericMileage < Number(previousVehicleEntry.mileage)
      ) {
        throw new Error(t.weeklyMileage.mileageValidationError);
      }

      await saveWeeklyMileage({
        id: form.id || undefined,
        week_ending: form.week_ending,
        driver_id: form.driver_id,
        driver: form.driver,
        vehicle_reg: form.vehicle_reg,
        mileage: numericMileage
      });

      resetForm();
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.weeklyMileage.errorSave);
    } finally {
      setSaving(false);
    }
  };

  const exportWeeklyMileage = () => {
    exportToXlsx(
      sortedEntries.map((entry) => ({
        [t.weeklyMileage.weekEnding]: formatDate(entry.week_ending, language),
        [t.weeklyMileage.driver]: entry.driver,
        [t.weeklyMileage.vehicleReg]: entry.vehicle_reg,
        [t.weeklyMileage.mileage]: entry.mileage
      })),
      "weekly-mileage-report",
      "WeeklyMileage"
    );
  };

  const summaryCards = [
    {
      label: t.weeklyMileage.totalMileageThisWeek,
      value: latestWeekRow ? formatNumber(totalMileageThisWeek, language) : "-",
      helper: latestWeekRow
        ? `${t.weeklyMileage.totalMileageThisWeekHelper} ${lastUpdatedWeekLabel}`
        : t.weeklyMileage.noDataDescription,
      icon: <Route className="h-5 w-5" />
    },
    {
      label: t.weeklyMileage.reportsInSystem,
      value: formatNumber(totalReportingWeeks, language),
      helper:
        totalReportingWeeks > 0
          ? t.weeklyMileage.reportsInSystemHelper
          : t.weeklyMileage.noDataDescription,
      icon: <TrendingUp className="h-5 w-5" />
    },
    {
      label: t.weeklyMileage.vehiclesSubmittedThisWeek,
      value: latestWeekRow ? formatNumber(vehiclesSubmittedThisWeek, language) : "-",
      helper:
        latestWeekRow
          ? t.weeklyMileage.vehiclesSubmittedThisWeekHelper
          : t.weeklyMileage.noDataDescription,
      icon: <FileText className="h-5 w-5" />
    },
    {
      label: t.weeklyMileage.lastUpdatedWeek,
      value: lastUpdatedWeekLabel,
      helper:
        latestWeekRow
          ? t.weeklyMileage.lastUpdatedWeekHelper
          : t.weeklyMileage.noDataDescription,
      icon: <CalendarClock className="h-5 w-5" />
    }
  ];

  return (
    <>
      <div className="mb-6">
        <Header title={t.weeklyMileage.title} description={t.weeklyMileage.description} />
      </div>

      <section className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {summaryCards.map((card) => (
          <StatCard
            key={card.label}
            label={card.label}
            value={card.value}
            helper={card.helper}
            icon={card.icon}
          />
        ))}
      </section>

      <section className="grid gap-6 xl:grid-cols-[390px_minmax(0,1fr)]">
        <form
          onSubmit={handleSubmit}
          className="h-fit rounded-3xl border border-slate-200 bg-white p-5 shadow-md sm:p-6"
        >
          <div className="mb-5">
            <h3 className="text-lg font-semibold text-slate-900">
              {isEditing ? t.weeklyMileage.editEntry : t.weeklyMileage.addEntry}
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              {isEditing ? t.weeklyMileage.helperEdit : t.weeklyMileage.helperAdd}
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                {t.weeklyMileage.weekEnding}
              </label>
              <input
                type="date"
                required
                value={form.week_ending}
                onChange={(event) =>
                  setForm((current) => ({ ...current, week_ending: event.target.value }))
                }
                className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-black"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                {t.weeklyMileage.driver}
              </label>
              <select
                required
                value={form.driver_id}
                onChange={(event) =>
                  setForm((current) => ({ ...current, driver_id: event.target.value }))
                }
                className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-black"
              >
                <option value="">{t.weeklyMileage.selectDriver}</option>
                {drivers.map((driver) => (
                  <option key={driver.id} value={String(driver.id)}>
                    {driver.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                {t.weeklyMileage.driverName}
              </label>
              <input
                readOnly
                value={form.driver}
                className="w-full rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-600 focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                {t.weeklyMileage.vehicleReg}
              </label>
              <input
                readOnly
                value={form.vehicle_reg}
                className="w-full rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-600 focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                {t.weeklyMileage.mileage}
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                required
                placeholder={t.weeklyMileage.mileagePlaceholder}
                value={form.mileage}
                onChange={(event) =>
                  setForm((current) => ({ ...current, mileage: event.target.value }))
                }
                className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-black"
              />
            </div>

            {error ? <p className="text-sm text-rose-600">{error}</p> : null}

            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                type="submit"
                disabled={saving}
                className="flex-1 rounded-xl bg-black px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-70"
              >
                {saving
                  ? t.common.saving
                  : isEditing
                    ? t.weeklyMileage.updateEntry
                    : t.weeklyMileage.saveEntry}
              </button>

              {isEditing ? (
                <button
                  type="button"
                  onClick={resetForm}
                  className="w-full rounded-xl border border-slate-300 px-5 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 sm:w-auto"
                >
                  {t.common.cancel}
                </button>
              ) : null}
            </div>
          </div>
        </form>

        <section className="min-w-0 rounded-3xl border border-slate-200 bg-white p-5 shadow-md sm:p-6">
          <div>
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">
                  {t.weeklyMileage.reportingTableTitle}
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  {t.weeklyMileage.reportingTableDescription}
                </p>
              </div>

              <button
                type="button"
                onClick={exportWeeklyMileage}
                disabled={!sortedEntries.length}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
              >
                <Download className="h-4 w-4" />
                {t.common.export}
              </button>
            </div>

            {loading ? (
              <EmptyState title={t.common.loading} description={t.weeklyMileage.loading} />
            ) : sortedEntries.length === 0 ? (
              <EmptyState
                title={t.weeklyMileage.noDataTitle}
                description={t.weeklyMileage.noDataDescription}
              />
            ) : (
              <>
                <div className="space-y-3 md:hidden">
                  {sortedEntries.map((entry) => (
                    <div key={entry.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">{entry.driver || "-"}</p>
                          <p className="mt-1 text-sm text-slate-500">{entry.vehicle_reg || "-"}</p>
                        </div>
                        <p className="text-sm font-medium text-slate-900">
                          {formatDate(entry.week_ending, language)}
                        </p>
                      </div>
                      <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                        {t.weeklyMileage.table.mileage}
                      </p>
                      <p className="mt-1 text-base font-semibold text-slate-950">
                        {formatNumber(entry.mileage, language)}
                      </p>
                      <button
                        type="button"
                        onClick={() =>
                          setForm({
                            id: String(entry.id),
                            week_ending: entry.week_ending,
                            driver_id: String(entry.driver_id),
                            driver: entry.driver,
                            vehicle_reg: entry.vehicle_reg,
                            mileage: String(entry.mileage)
                          })
                        }
                        className="mt-4 inline-flex w-full items-center justify-center rounded-xl border border-slate-300 px-3 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                      >
                        {t.common.edit}
                      </button>
                    </div>
                  ))}
                </div>

                <div className="hidden -mx-5 overflow-x-auto px-5 md:block md:mx-0 md:px-0">
                  <div className="rounded-2xl border border-slate-200">
                  <table className="w-full min-w-[720px] text-sm">
                    <thead>
                      <tr className="bg-slate-100 text-slate-600">
                        <th className="px-4 py-3 text-left font-semibold">
                          {t.weeklyMileage.table.weekEnding}
                        </th>
                        <th className="px-4 py-3 text-left font-semibold">
                          {t.weeklyMileage.table.driver}
                        </th>
                        <th className="px-4 py-3 text-left font-semibold">
                          {t.weeklyMileage.table.vehicleReg}
                        </th>
                        <th className="px-4 py-3 text-left font-semibold">
                          {t.weeklyMileage.table.mileage}
                        </th>
                        <th className="px-4 py-3 text-left font-semibold">
                          {t.weeklyMileage.table.action}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedEntries.map((entry) => (
                        <tr
                          key={entry.id}
                          className="border-b border-slate-200 transition last:border-none hover:bg-slate-50"
                        >
                          <td className="px-4 py-3 font-medium text-slate-900">
                            {formatDate(entry.week_ending, language)}
                          </td>
                          <td className="px-4 py-3 text-slate-700">{entry.driver || "-"}</td>
                          <td className="px-4 py-3 text-slate-700">{entry.vehicle_reg || "-"}</td>
                          <td className="px-4 py-3 text-slate-700">
                            {formatNumber(entry.mileage, language)}
                          </td>
                          <td className="px-4 py-3">
                            <button
                              type="button"
                              onClick={() =>
                                setForm({
                                  id: String(entry.id),
                                  week_ending: entry.week_ending,
                                  driver_id: String(entry.driver_id),
                                  driver: entry.driver,
                                  vehicle_reg: entry.vehicle_reg,
                                  mileage: String(entry.mileage)
                                })
                              }
                              className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                            >
                              {t.common.edit}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="mt-6 border-t border-slate-200 pt-6">
            <div className="mb-4">
              <h3 className="text-lg font-semibold text-slate-900">
                {t.weeklyMileage.trendTableTitle}
              </h3>
              <p className="mt-1 text-sm text-slate-500">{t.weeklyMileage.trendTableDescription}</p>
            </div>

            {loading ? (
              <EmptyState title={t.common.loading} description={t.weeklyMileage.loading} />
            ) : weeklyTrendRows.length === 0 ? (
              <EmptyState
                title={t.weeklyMileage.noDataTitle}
                description={t.weeklyMileage.noDataDescription}
              />
            ) : (
              <>
                <div className="space-y-3 md:hidden">
                  {weeklyTrendRows.map((row) => (
                    <div key={row.weekEnding} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <p className="text-sm font-semibold text-slate-900">
                        {formatDate(row.weekEnding, language)}
                      </p>
                      <div className="mt-3 grid grid-cols-2 gap-3">
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                            {t.dashboard.table.mileage}
                          </p>
                          <p className="mt-1 text-sm font-medium text-slate-900">
                            {formatNumber(row.mileage, language)}
                          </p>
                        </div>
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                            {t.weeklyMileage.vehiclesSubmittedThisWeek}
                          </p>
                          <p className="mt-1 text-sm font-medium text-slate-900">
                            {formatNumber(row.submitted, language)}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="hidden -mx-5 overflow-x-auto px-5 md:block md:mx-0 md:px-0">
                  <div className="rounded-2xl border border-slate-200">
                  <table className="w-full min-w-[520px] text-sm">
                    <thead>
                      <tr className="bg-slate-100 text-slate-600">
                        <th className="px-4 py-3 text-left font-semibold">
                          {t.dashboard.table.weekEnding}
                        </th>
                        <th className="px-4 py-3 text-left font-semibold">
                          {t.dashboard.table.mileage}
                        </th>
                        <th className="px-4 py-3 text-left font-semibold">
                          {t.weeklyMileage.vehiclesSubmittedThisWeek}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {weeklyTrendRows.map((row) => (
                        <tr
                          key={row.weekEnding}
                          className="border-b border-slate-200 transition last:border-none hover:bg-slate-50"
                        >
                          <td className="px-4 py-3 font-medium text-slate-900">
                            {formatDate(row.weekEnding, language)}
                          </td>
                          <td className="px-4 py-3 text-slate-700">
                            {formatNumber(row.mileage, language)}
                          </td>
                          <td className="px-4 py-3 text-slate-700">
                            {formatNumber(row.submitted, language)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
                </div>
              </>
            )}
          </div>
        </section>
      </section>
    </>
  );
}
