"use client";

import { Download, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/empty-state";
import { Header } from "@/components/header";
import { WeeklyMileageUploadCard } from "@/components/weekly-mileage-upload-card";
import {
  deleteWeeklyMileage,
  fetchDrivers,
  fetchWeeklyMileage,
  saveWeeklyMileage
} from "@/lib/data";
import { exportToCsv } from "@/lib/export";
import { applyRequiredValidationMessage, clearValidationMessage } from "@/lib/form-validation";
import { useLanguage } from "@/lib/language-provider";
import {
  buildDriverWeeklyComparisons,
  buildWeeklyMileageSummary,
  computeWeeklyMileageByVehicle
} from "@/lib/operations";
import { formatDate, formatNumber } from "@/lib/utils";
import type { Driver, WeeklyMileageEntry } from "@/types/database";

const PAGE_SIZE = 25;
const initialForm = { id: "", week_ending: "", driver_id: "", vehicle_reg: "", mileage: "" };

export default function WeeklyMileagePage() {
  const { language, t } = useLanguage();
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [entries, setEntries] = useState<WeeklyMileageEntry[]>([]);
  const [form, setForm] = useState(initialForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [selectedWeek, setSelectedWeek] = useState("");
  const [comparisonDriverId, setComparisonDriverId] = useState("");
  const [tablePage, setTablePage] = useState(1);
  const isEditing = Boolean(form.id);

  const selectedDriver = useMemo(
    () => drivers.find((driver) => String(driver.id) === String(form.driver_id)),
    [drivers, form.driver_id]
  );

  const sortedEntries = useMemo(
    () =>
      [...entries].sort((a, b) => {
        const dateDiff = new Date(b.week_ending).getTime() - new Date(a.week_ending).getTime();
        if (dateDiff !== 0) return dateDiff;
        return String(b.id).localeCompare(String(a.id));
      }),
    [entries]
  );

  const weeklyVehicleRows = useMemo(() => computeWeeklyMileageByVehicle(sortedEntries), [sortedEntries]);
  const weeklySummaryRows = useMemo(() => buildWeeklyMileageSummary(sortedEntries), [sortedEntries]);
  const driverComparisonRows = useMemo(
    () => buildDriverWeeklyComparisons(sortedEntries),
    [sortedEntries]
  );

  const availableWeeks = useMemo(
    () => Array.from(new Set(sortedEntries.map((entry) => entry.week_ending))),
    [sortedEntries]
  );
  const selectedWeekValue = selectedWeek || availableWeeks[0] || "";
  const selectedWeekEntries = useMemo(
    () => sortedEntries.filter((entry) => entry.week_ending === selectedWeekValue),
    [selectedWeekValue, sortedEntries]
  );
  const selectedWeekSummary =
    weeklySummaryRows.find((row) => row.weekEnding === selectedWeekValue) ?? weeklySummaryRows[0] ?? null;
  const selectedWeekTotalPages = Math.max(1, Math.ceil(selectedWeekEntries.length / PAGE_SIZE));
  const pagedEntries = useMemo(() => {
    const safePage = Math.min(tablePage, selectedWeekTotalPages);
    const startIndex = (safePage - 1) * PAGE_SIZE;
    return selectedWeekEntries.slice(startIndex, startIndex + PAGE_SIZE);
  }, [selectedWeekEntries, selectedWeekTotalPages, tablePage]);
  const selectedWeekIndex = availableWeeks.findIndex((week) => week === selectedWeekValue);
  const previousWeekValue =
    selectedWeekIndex >= 0 && selectedWeekIndex < availableWeeks.length - 1
      ? availableWeeks[selectedWeekIndex + 1]
      : null;
  const nextWeekValue = selectedWeekIndex > 0 ? availableWeeks[selectedWeekIndex - 1] : null;

  const comparisonDrivers = useMemo(
    () =>
      drivers
        .filter((driver) =>
          driverComparisonRows.some((row) => String(row.driverId) === String(driver.id))
        )
        .sort((a, b) => a.name.localeCompare(b.name)),
    [driverComparisonRows, drivers]
  );
  const weeklyDistanceByDriverRows = useMemo(
    () =>
      driverComparisonRows
        .filter((row) => row.latestWeekEnding === selectedWeekValue)
        .filter((row) => row.previousWeekEnding && row.weeklyDistance != null)
        .sort((a, b) => Number(b.weeklyDistance) - Number(a.weeklyDistance)),
    [driverComparisonRows, selectedWeekValue]
  );
  const selectedComparison = useMemo(
    () =>
      comparisonDriverId
        ? driverComparisonRows.find((row) => String(row.driverId) === String(comparisonDriverId)) ?? null
        : null,
    [comparisonDriverId, driverComparisonRows]
  );
  const selectedComparisonHistory = selectedComparison?.history.slice(0, 5) ?? [];

  const previousVehicleEntry = useMemo(() => {
    if (!form.vehicle_reg || !form.week_ending) return null;
    return (
      weeklyVehicleRows.find(
        (row) => row.vehicleReg === form.vehicle_reg && row.weekEnding < form.week_ending
      )?.latestEntry ?? null
    );
  }, [form.vehicle_reg, form.week_ending, weeklyVehicleRows]);

  const weeklyDifference =
    previousVehicleEntry && form.mileage && Number.isFinite(Number(form.mileage))
      ? Number(form.mileage) - Number(previousVehicleEntry.mileage || 0)
      : null;

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [driverRows, mileageRows] = await Promise.all([
        fetchDrivers(),
        fetchWeeklyMileage()
      ]);
      console.log("Weekly mileage page load success", {
        drivers: driverRows.length,
        weeklyMileage: mileageRows.length
      });
      setDrivers(driverRows);
      setEntries(mileageRows);
    } catch (err) {
      console.error("Weekly mileage load error:", err);
      setError(t.weeklyMileage.errorLoad);
    } finally {
      setLoading(false);
    }
  }, [t.weeklyMileage.errorLoad]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    const handleDataChanged = () => void loadData();
    window.addEventListener("fuel-bank:data-changed", handleDataChanged);
    return () => window.removeEventListener("fuel-bank:data-changed", handleDataChanged);
  }, [loadData]);

  useEffect(() => {
    if (!availableWeeks.length) {
      setSelectedWeek("");
      return;
    }
    if (!selectedWeek || !availableWeeks.includes(selectedWeek)) {
      setSelectedWeek(availableWeeks[0]);
    }
  }, [availableWeeks, selectedWeek]);

  useEffect(() => {
    setTablePage(1);
  }, [selectedWeekValue]);

  const resetForm = (clearMessages = true) => {
    setForm(initialForm);
    setError(null);
    if (clearMessages) setSuccessMessage(null);
  };

  const handleInvalid = (
    event: React.InvalidEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => applyRequiredValidationMessage(event, t.common.requiredField);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const mileage = Number(form.mileage);
      if (!form.driver_id || !form.vehicle_reg || !form.week_ending || !Number.isFinite(mileage)) {
        throw new Error(t.common.requiredField);
      }
      if (
        previousVehicleEntry?.mileage != null &&
        mileage < Number(previousVehicleEntry.mileage) &&
        !window.confirm(t.weeklyMileage.mileageValidationError)
      ) {
        throw new Error(t.weeklyMileage.mileageValidationError);
      }

      const savedEntry = await saveWeeklyMileage({
        id: form.id || undefined,
        week_ending: form.week_ending,
        driver_id: form.driver_id,
        vehicle_reg: form.vehicle_reg,
        odometer_reading: mileage
      });

      setSelectedWeek(savedEntry.week_ending ?? form.week_ending);
      resetForm(false);
      setSuccessMessage(
        isEditing ? "Weekly mileage updated successfully." : "Weekly mileage saved successfully."
      );
      await loadData();
    } catch (err) {
      console.error("Weekly mileage save error:", err);
      setError(err instanceof Error && err.message ? err.message : t.weeklyMileage.errorSave);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm(t.weeklyMileage.deleteConfirm)) return;
    try {
      setDeletingId(id);
      setError(null);
      setSuccessMessage(null);
      await deleteWeeklyMileage(id);
      if (form.id === id) resetForm();
      setSuccessMessage("Weekly mileage deleted successfully.");
      await loadData();
    } catch (err) {
      console.error("Weekly mileage delete error:", err);
      setError(err instanceof Error && err.message ? err.message : t.weeklyMileage.deleteError);
    } finally {
      setDeletingId(null);
    }
  };

  const exportWeeklyMileage = () =>
    exportToCsv(
      sortedEntries.map((entry) => ({
        [t.weeklyMileage.weekEnding]: formatDate(entry.week_ending, language),
        [t.weeklyMileage.driver]: entry.driver,
        [t.weeklyMileage.vehicleReg]: entry.vehicle_reg,
        [t.weeklyMileage.mileage]: entry.mileage
      })),
      "weekly-mileage-report"
    );

  return (
    <>
      <div className="mb-6 hidden md:block">
        <Header title={t.weeklyMileage.title} description={t.weeklyMileage.description} />
      </div>

      <section className="surface-card mb-4 p-4 sm:p-5">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 className="section-title">{t.weeklyMileage.reportingWeekSummary}</h3>
            <p className="section-subtitle">{t.weeklyMileage.reportingWeekSummaryDescription}</p>
          </div>
          {selectedWeekSummary ? (
            <span className="badge-muted">{formatDate(selectedWeekSummary.weekEnding, language)}</span>
          ) : null}
        </div>

        {loading ? (
          <EmptyState title={t.common.loading} description={t.weeklyMileage.loading} />
        ) : !selectedWeekSummary ? (
          <EmptyState title={t.weeklyMileage.noDataTitle} description={t.weeklyMileage.noDataDescription} />
        ) : (
          <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-4">
            <div className="subtle-panel p-4 sm:col-span-3 xl:col-span-1">
              <p className="metric-label">{t.weeklyMileage.weeklyDistanceCovered}</p>
              <p className="mt-2 text-[2rem] font-semibold tracking-[-0.05em] text-slate-950">
                {selectedWeekSummary.comparableVehicles > 0
                  ? formatNumber(selectedWeekSummary.weeklyDistance, language)
                  : t.weeklyMileage.weeklyDistanceCoveredUnavailable}
              </p>
            </div>
            <div className="subtle-panel p-4">
              <p className="metric-label">{t.weeklyMileage.highestOdometerThisWeek}</p>
              <p className="mt-2 text-[1.45rem] font-semibold tracking-[-0.04em] text-slate-950">
                {selectedWeekSummary.highestOdometer != null
                  ? formatNumber(selectedWeekSummary.highestOdometer, language)
                  : "-"}
              </p>
            </div>
            <div className="subtle-panel p-4">
              <p className="metric-label">{t.weeklyMileage.lowestOdometerThisWeek}</p>
              <p className="mt-2 text-[1.45rem] font-semibold tracking-[-0.04em] text-slate-950">
                {selectedWeekSummary.lowestOdometer != null
                  ? formatNumber(selectedWeekSummary.lowestOdometer, language)
                  : "-"}
              </p>
            </div>
            <div className="subtle-panel p-4">
              <p className="metric-label">{t.common.entries}</p>
              <p className="mt-2 text-[1.45rem] font-semibold tracking-[-0.04em] text-slate-950">
                {formatNumber(selectedWeekEntries.length, language)}
              </p>
            </div>
          </div>
        )}
      </section>

      <WeeklyMileageUploadCard
        drivers={drivers}
        entries={entries}
        language={language}
        onSaved={loadData}
      />

      <section className="surface-card p-5 sm:p-6">
        <form onSubmit={handleSubmit} className="max-w-[780px]">
          <div className="mb-4">
            <h3 className="section-title">
              {isEditing ? t.weeklyMileage.editEntry : t.weeklyMileage.addEntry}
            </h3>
            <p className="section-subtitle">
              {isEditing ? t.weeklyMileage.helperEdit : t.weeklyMileage.helperAdd}
            </p>
          </div>

          <div className="form-section">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="form-field">
                <label className="form-label form-label-required">{t.weeklyMileage.weekEnding}</label>
                <input
                  type="date"
                  required
                  value={form.week_ending}
                  onChange={(event) => setForm((current) => ({ ...current, week_ending: event.target.value }))}
                  onInvalid={handleInvalid}
                  onInput={clearValidationMessage}
                  className="form-input bg-white"
                />
              </div>

              <div className="form-field">
                <label className="form-label form-label-required">{t.weeklyMileage.driver}</label>
                <select
                  required
                  value={form.driver_id}
                  onChange={(event) => {
                    clearValidationMessage(event);
                    const nextDriver = drivers.find((driver) => String(driver.id) === event.target.value);
                    setForm((current) => ({
                      ...current,
                      driver_id: event.target.value,
                      vehicle_reg: nextDriver?.vehicle_reg ?? ""
                    }));
                  }}
                  onInvalid={handleInvalid}
                  className="form-input bg-white"
                >
                  <option value="">{t.weeklyMileage.selectDriver}</option>
                  {drivers.map((driver) => (
                    <option key={driver.id} value={String(driver.id)}>
                      {driver.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-field">
                <label className="form-label">{t.weeklyMileage.vehicleReg}</label>
                <input
                  value={form.vehicle_reg}
                  onChange={(event) => setForm((current) => ({ ...current, vehicle_reg: event.target.value }))}
                  className="form-input bg-white"
                />
                <p className="form-helper">
                  {selectedDriver?.vehicle_reg?.trim()
                    ? "Auto-filled based on driver"
                    : "No vehicle assigned. Enter manually if needed."}
                </p>
              </div>

              <div className="form-field">
                <label className="form-label form-label-required">{t.weeklyMileage.mileage}</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  required
                  value={form.mileage}
                  onChange={(event) => setForm((current) => ({ ...current, mileage: event.target.value }))}
                  onInvalid={handleInvalid}
                  onInput={clearValidationMessage}
                  className="form-input bg-white"
                />
                <p className="form-helper">
                  {previousVehicleEntry
                    ? `${formatDate(previousVehicleEntry.week_ending, language)} | ${formatNumber(previousVehicleEntry.mileage, language)}`
                    : t.weeklyMileage.noDataDescription}
                </p>
                {weeklyDifference != null && weeklyDifference < 0 ? (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    {t.weeklyMileage.mileageValidationError}
                  </div>
                ) : null}
              </div>
            </div>

            {error ? <p className="form-error mt-3">{error}</p> : null}
            {successMessage ? <p className="mt-3 text-sm text-emerald-600">{successMessage}</p> : null}

            <div className="sticky bottom-3 z-10 mt-4 flex flex-col gap-2.5 rounded-[1.5rem] border border-slate-200/80 bg-white/95 p-3 shadow-[0_10px_30px_rgba(15,23,42,0.08)] backdrop-blur sm:static sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none sm:flex-row sm:items-center">
              <button type="submit" disabled={saving} className="btn-primary w-full sm:w-auto disabled:opacity-70">
                {saving ? t.common.saving : isEditing ? t.weeklyMileage.updateEntry : t.weeklyMileage.saveEntry}
              </button>
              {isEditing ? (
                <button type="button" onClick={() => resetForm()} className="btn-secondary w-full sm:w-auto">
                  {t.common.cancel}
                </button>
              ) : null}
            </div>
          </div>
        </form>
      </section>

      <section className="surface-card mt-4 p-4 sm:p-5">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 className="section-title">{t.weeklyMileage.recordsForWeek}</h3>
            <p className="section-subtitle">{t.weeklyMileage.recordsForWeekDescription}</p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <button type="button" onClick={() => previousWeekValue && setSelectedWeek(previousWeekValue)} disabled={!previousWeekValue} className="btn-secondary disabled:opacity-50">
              {t.weeklyMileage.previousWeek}
            </button>
            <select value={selectedWeekValue} onChange={(event) => setSelectedWeek(event.target.value)} className="form-input bg-white sm:min-w-[220px]">
              {availableWeeks.map((week) => (
                <option key={week} value={week}>
                  {formatDate(week, language)}
                </option>
              ))}
            </select>
            <button type="button" onClick={() => nextWeekValue && setSelectedWeek(nextWeekValue)} disabled={!nextWeekValue} className="btn-secondary disabled:opacity-50">
              {t.weeklyMileage.nextWeek}
            </button>
            <button type="button" onClick={exportWeeklyMileage} disabled={!sortedEntries.length} className="btn-secondary gap-2 disabled:opacity-50">
              <Download className="h-4 w-4" />
              {t.common.export}
            </button>
          </div>
        </div>

        {loading ? (
          <EmptyState title={t.common.loading} description={t.weeklyMileage.loading} />
        ) : selectedWeekEntries.length === 0 ? (
          <EmptyState title={t.weeklyMileage.noDataTitle} description={t.weeklyMileage.noDataDescription} />
        ) : (
          <>
            <div className="mb-4 flex items-center gap-3 text-sm text-slate-500">
              <span className="badge-muted">{t.weeklyMileage.showingWeek}</span>
              <span>{formatDate(selectedWeekValue, language)}</span>
              <span>{formatNumber(selectedWeekEntries.length, language)} {t.common.entries}</span>
            </div>

            <div className="space-y-3.5 md:hidden">
              {pagedEntries.map((entry) => (
                <div key={entry.id} className="subtle-panel p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="table-driver-name">{entry.driver || "-"}</p>
                      <p className="mt-1 text-sm text-slate-500">{entry.vehicle_reg || "-"}</p>
                    </div>
                    <p className="supporting-date-strong">{formatDate(entry.week_ending, language)}</p>
                  </div>
                  <p className="mt-3 text-base font-semibold text-slate-950">
                    {formatNumber(entry.mileage, language)}
                  </p>
                  <div className="mt-3 flex gap-2">
                    <button type="button" onClick={() => setForm({ id: String(entry.id), week_ending: entry.week_ending, driver_id: String(entry.driver_id), vehicle_reg: entry.vehicle_reg, mileage: String(entry.mileage) })} className="btn-secondary flex-1">
                      {t.common.edit}
                    </button>
                    <button type="button" onClick={() => void handleDelete(String(entry.id))} disabled={deletingId === String(entry.id)} className="btn-danger flex-1 gap-2 disabled:opacity-50">
                      <Trash2 className="h-4 w-4" />
                      {deletingId === String(entry.id) ? t.common.deleting : t.common.delete}
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="hidden md:block">
              <div className="table-shell rounded-2xl">
                <div className="table-scroll">
                  <table className="w-full min-w-[760px] text-sm">
                    <thead>
                      <tr className="bg-slate-50/70 text-slate-600">
                        <th className="table-head-cell text-left">{t.weeklyMileage.table.weekEnding}</th>
                        <th className="table-head-cell text-left">{t.weeklyMileage.table.driver}</th>
                        <th className="table-head-cell text-left">{t.weeklyMileage.table.vehicleReg}</th>
                        <th className="table-head-cell text-right">{t.weeklyMileage.table.mileage}</th>
                        <th className="table-head-cell text-left">{t.weeklyMileage.table.action}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedEntries.map((entry) => (
                        <tr key={entry.id} className="enterprise-table-row">
                          <td className="table-body-cell supporting-date-strong">{formatDate(entry.week_ending, language)}</td>
                          <td className="table-body-cell table-driver-name">{entry.driver || "-"}</td>
                          <td className="table-body-cell">{entry.vehicle_reg || "-"}</td>
                          <td className="table-body-cell text-right font-medium text-slate-800">{formatNumber(entry.mileage, language)}</td>
                          <td className="table-body-cell">
                            <div className="flex items-center gap-1.5 whitespace-nowrap">
                              <button type="button" onClick={() => setForm({ id: String(entry.id), week_ending: entry.week_ending, driver_id: String(entry.driver_id), vehicle_reg: entry.vehicle_reg, mileage: String(entry.mileage) })} className="table-action-secondary">
                                {t.common.edit}
                              </button>
                              <button type="button" onClick={() => void handleDelete(String(entry.id))} disabled={deletingId === String(entry.id)} className="table-action-danger disabled:opacity-50">
                                {deletingId === String(entry.id) ? t.common.deleting : t.common.delete}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between gap-3">
              <p className="text-sm text-slate-500">
                {t.common.page} {formatNumber(Math.min(tablePage, selectedWeekTotalPages), language)} {t.common.of} {formatNumber(selectedWeekTotalPages, language)}
              </p>
              <div className="flex gap-2">
                <button type="button" onClick={() => setTablePage((current) => Math.max(1, current - 1))} disabled={tablePage === 1} className="btn-secondary disabled:opacity-50">
                  {t.common.previous}
                </button>
                <button type="button" onClick={() => setTablePage((current) => Math.min(selectedWeekTotalPages, current + 1))} disabled={tablePage >= selectedWeekTotalPages} className="btn-secondary disabled:opacity-50">
                  {t.common.next}
                </button>
              </div>
            </div>
          </>
        )}
      </section>

      <section className="surface-card mt-4 p-4 sm:p-5">
        <details>
          <summary className="cursor-pointer list-none">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="section-title">{t.weeklyMileage.weeklyDistanceByDriver}</h3>
                <p className="section-subtitle">{t.weeklyMileage.weeklyDistanceByDriverDescription}</p>
              </div>
              <span className="badge-muted">{formatNumber(weeklyDistanceByDriverRows.length, language)} {t.common.entries}</span>
            </div>
          </summary>

          {loading ? (
            <div className="mt-4">
              <EmptyState title={t.common.loading} description={t.weeklyMileage.loading} />
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              <div className="grid gap-3.5 lg:grid-cols-[minmax(240px,280px)_minmax(0,1fr)]">
                <div className="form-field">
                  <label className="form-label">{t.weeklyMileage.compareDriver}</label>
                  <select value={comparisonDriverId} onChange={(event) => setComparisonDriverId(event.target.value)} className="form-input bg-white">
                    <option value="">{t.weeklyMileage.selectDriver}</option>
                    {comparisonDrivers.map((driver) => (
                      <option key={driver.id} value={String(driver.id)}>
                        {driver.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="subtle-panel p-4">
                  <p className="text-sm font-semibold text-slate-900">{t.weeklyMileage.weeklyDistanceCovered}</p>
                  {weeklyDistanceByDriverRows.length === 0 ? (
                    <p className="mt-3 text-sm text-slate-500">{t.weeklyMileage.weeklyDistanceCoveredUnavailable}</p>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {weeklyDistanceByDriverRows.slice(0, 3).map((row) => (
                        <div key={`${row.driverId}-${row.latestWeekEnding}`} className="flex items-center justify-between gap-3 border-b border-slate-100/70 pb-2 last:border-b-0 last:pb-0">
                          <div className="min-w-0">
                            <p className="table-driver-name truncate">{row.driver}</p>
                            <p className="mt-0.5 text-xs text-slate-400">{row.vehicleReg}</p>
                          </div>
                          <p className="text-sm font-semibold text-slate-950">{formatNumber(row.weeklyDistance!, language)}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {!selectedComparison ? (
                <div className="subtle-panel flex min-h-[180px] items-center justify-center p-5">
                  <EmptyState title={t.weeklyMileage.compareDriver} description={t.weeklyMileage.selectDriverToCompare} />
                </div>
              ) : selectedComparison.unusual || !selectedComparison.previousWeekEnding ? (
                <div className="subtle-panel flex min-h-[180px] items-center justify-center p-5">
                  <EmptyState title={t.weeklyMileage.weeklyDistanceCovered} description={t.weeklyMileage.weeklyComparisonHistoryDescription} />
                </div>
              ) : (
                <div className="grid gap-3.5 xl:grid-cols-[minmax(0,1.05fr)_minmax(260px,0.95fr)]">
                  <div className="subtle-panel p-4">
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      <div>
                        <p className="metric-label">{t.weeklyMileage.currentReportingWeek}</p>
                        <p className="mt-1 font-semibold text-slate-950">{formatDate(selectedComparison.latestWeekEnding, language)}</p>
                      </div>
                      <div>
                        <p className="metric-label">{t.weeklyMileage.currentOdometer}</p>
                        <p className="mt-1 font-semibold text-slate-950">{formatNumber(selectedComparison.latestOdometer, language)}</p>
                      </div>
                      <div>
                        <p className="metric-label">{t.weeklyMileage.selectedVehicleReg}</p>
                        <p className="mt-1 font-semibold text-slate-950">{selectedComparison.vehicleReg || "-"}</p>
                      </div>
                      <div>
                        <p className="metric-label">{t.weeklyMileage.previousReportingWeek}</p>
                        <p className="mt-1 font-semibold text-slate-950">{formatDate(selectedComparison.previousWeekEnding!, language)}</p>
                      </div>
                      <div>
                        <p className="metric-label">{t.weeklyMileage.previousOdometer}</p>
                        <p className="mt-1 font-semibold text-slate-950">{formatNumber(selectedComparison.previousOdometer!, language)}</p>
                      </div>
                      <div>
                        <p className="metric-label">{t.weeklyMileage.weeklyDistanceCovered}</p>
                        <p className="mt-1 font-semibold text-slate-950">{formatNumber(selectedComparison.weeklyDistance!, language)}</p>
                      </div>
                    </div>
                  </div>

                  <div className="subtle-panel p-4">
                    <p className="text-sm font-semibold text-slate-900">{t.weeklyMileage.weeklyComparisonHistory}</p>
                    <div className="mt-3 space-y-2">
                      {selectedComparisonHistory.map((entry) => (
                        <div key={entry.id} className="flex items-center justify-between gap-3 border-b border-slate-100/70 pb-2 last:border-b-0 last:pb-0">
                          <div>
                            <p className="supporting-date-strong text-slate-800">{formatDate(entry.week_ending, language)}</p>
                            <p className="mt-0.5 text-xs text-slate-400">{entry.vehicle_reg || "-"}</p>
                          </div>
                          <p className="text-sm font-semibold text-slate-950">{formatNumber(entry.mileage, language)}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </details>
      </section>
    </>
  );
}
