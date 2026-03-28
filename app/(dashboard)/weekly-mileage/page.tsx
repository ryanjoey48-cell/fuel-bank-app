"use client";

import { CalendarClock, Download, Gauge, Route, Trash2, Truck, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/empty-state";
import { Header } from "@/components/header";
import { StatCard } from "@/components/stat-card";
import {
  deleteWeeklyMileage,
  fetchDrivers,
  fetchWeeklyMileage,
  saveWeeklyMileage
} from "@/lib/data";
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
  vehiclesSubmitted: number;
  driversSubmitted: number;
  highestOdometer: number | null;
  lowestOdometer: number | null;
  weeklyDistanceCovered: number | null;
  comparableVehicles: number;
};

type WeeklyDistanceByDriverRow = {
  driver: string;
  vehicleReg: string;
  latestWeekOdometer: number;
  previousWeekOdometer: number;
  weeklyDistanceCovered: number;
};

function getUniqueDriverCount(entries: WeeklyMileageEntry[]) {
  return new Set(
    entries
      .map((entry) => (entry.driver || "").trim())
      .filter(Boolean)
      .map((name) => name.toLowerCase())
  ).size;
}

function buildWeeklyTrendRows(entries: WeeklyMileageEntry[]) {
  const sortedEntries = [...entries].sort((a, b) => {
    const dateDiff = new Date(b.week_ending).getTime() - new Date(a.week_ending).getTime();
    if (dateDiff !== 0) {
      return dateDiff;
    }
    return String(b.id).localeCompare(String(a.id));
  });

  const weeks = Array.from(new Set(sortedEntries.map((entry) => entry.week_ending)));

  return weeks.map((weekEnding) => {
    const weekEntries = sortedEntries.filter((entry) => entry.week_ending === weekEnding);
    const vehiclesSubmitted = new Set(
      weekEntries.map((entry) => entry.vehicle_reg || String(entry.driver_id))
    ).size;
    const driversSubmitted = getUniqueDriverCount(weekEntries);

    const highestEntry = weekEntries.reduce<WeeklyMileageEntry | null>((highest, entry) => {
      if (!highest || Number(entry.mileage || 0) > Number(highest.mileage || 0)) {
        return entry;
      }
      return highest;
    }, null);

    const lowestEntry = weekEntries.reduce<WeeklyMileageEntry | null>((lowest, entry) => {
      if (!lowest || Number(entry.mileage || 0) < Number(lowest.mileage || 0)) {
        return entry;
      }
      return lowest;
    }, null);

    let weeklyDistanceTotal = 0;
    let comparableVehicles = 0;

    weekEntries.forEach((entry) => {
      const previousEntry = sortedEntries.find(
        (candidate) =>
          candidate.vehicle_reg === entry.vehicle_reg &&
          candidate.week_ending < entry.week_ending
      );

      if (!previousEntry) {
        return;
      }

      const difference = Number(entry.mileage || 0) - Number(previousEntry.mileage || 0);
      if (difference >= 0) {
        weeklyDistanceTotal += difference;
        comparableVehicles += 1;
      }
    });

    return {
      weekEnding,
      vehiclesSubmitted,
      driversSubmitted,
      highestOdometer: highestEntry ? Number(highestEntry.mileage || 0) : null,
      lowestOdometer: lowestEntry ? Number(lowestEntry.mileage || 0) : null,
      weeklyDistanceCovered: comparableVehicles > 0 ? weeklyDistanceTotal : null,
      comparableVehicles
    };
  });
}

function buildWeeklyDistanceByDriverRows(
  latestWeekEntries: WeeklyMileageEntry[],
  allEntries: WeeklyMileageEntry[]
) {
  const sortedEntries = [...allEntries].sort((a, b) => {
    const dateDiff = new Date(b.week_ending).getTime() - new Date(a.week_ending).getTime();
    if (dateDiff !== 0) {
      return dateDiff;
    }
    return String(b.id).localeCompare(String(a.id));
  });

  return latestWeekEntries
    .map((entry) => {
      const previousEntry = sortedEntries.find(
        (candidate) =>
          candidate.vehicle_reg === entry.vehicle_reg &&
          candidate.week_ending < entry.week_ending
      );

      if (!previousEntry) {
        return null;
      }

      const latestWeekOdometer = Number(entry.mileage || 0);
      const previousWeekOdometer = Number(previousEntry.mileage || 0);
      const weeklyDistanceCovered = latestWeekOdometer - previousWeekOdometer;

      if (weeklyDistanceCovered < 0) {
        return null;
      }

      return {
        driver: entry.driver || "-",
        vehicleReg: entry.vehicle_reg || "-",
        latestWeekOdometer,
        previousWeekOdometer,
        weeklyDistanceCovered
      };
    })
    .filter((row): row is WeeklyDistanceByDriverRow => row != null)
    .sort((a, b) => b.weeklyDistanceCovered - a.weeklyDistanceCovered);
}

export default function WeeklyMileagePage() {
  const { language, t } = useLanguage();
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [entries, setEntries] = useState<WeeklyMileageEntry[]>([]);
  const [form, setForm] = useState(initialForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [comparisonDriverId, setComparisonDriverId] = useState("");
  const [selectedWeek, setSelectedWeek] = useState("");

  const isEditing = Boolean(form.id);
  const labels = {
    latestReportingWeek: t.weeklyMileage.latestReportingWeek,
    latestReportingWeekHelper: t.weeklyMileage.latestReportingWeekHelper,
    vehiclesSubmittedThisWeek: t.weeklyMileage.vehiclesSubmittedThisWeek,
    vehiclesSubmittedThisWeekHelper: t.weeklyMileage.vehiclesSubmittedThisWeekHelper,
    driversSubmittedThisWeek: t.weeklyMileage.driversSubmittedThisWeek,
    driversSubmittedThisWeekHelper: t.weeklyMileage.driversSubmittedThisWeekHelper,
    highestOdometerThisWeek: t.weeklyMileage.highestOdometerThisWeek,
    highestOdometerThisWeekHelper: t.weeklyMileage.highestOdometerThisWeekHelper,
    lowestOdometerThisWeek: t.weeklyMileage.lowestOdometerThisWeek,
    lowestOdometerThisWeekHelper: t.weeklyMileage.lowestOdometerThisWeekHelper,
    weeklyDistanceCovered: t.weeklyMileage.weeklyDistanceCovered,
    weeklyDistanceCoveredHelper: t.weeklyMileage.weeklyDistanceCoveredHelper,
    weeklyDistanceCoveredUnavailable: t.weeklyMileage.weeklyDistanceCoveredUnavailable,
    reportingWeekSummary: t.weeklyMileage.reportingWeekSummary,
    reportingWeekSummaryDescription: t.weeklyMileage.reportingWeekSummaryDescription,
    weeklyDistanceByDriver: t.weeklyMileage.weeklyDistanceByDriver,
    weeklyDistanceByDriverDescription: t.weeklyMileage.weeklyDistanceByDriverDescription,
    notEnoughDataYet: t.weeklyMileage.weeklyDistanceCoveredUnavailable,
    noWeeklyRecordsForDriver: t.weeklyMileage.noWeeklyRecordsForDriver,
    compareDriver: t.weeklyMileage.compareDriver,
    selectDriverToCompare: t.weeklyMileage.selectDriverToCompare,
    currentReportingWeek: t.weeklyMileage.currentReportingWeek,
    previousReportingWeek: t.weeklyMileage.previousReportingWeek,
    currentOdometer: t.weeklyMileage.currentOdometer,
    previousOdometer: t.weeklyMileage.previousOdometer,
    selectedVehicleReg: t.weeklyMileage.selectedVehicleReg,
    recordsForWeek: t.weeklyMileage.recordsForWeek,
    recordsForWeekDescription: t.weeklyMileage.recordsForWeekDescription,
    selectWeek: t.weeklyMileage.selectWeek,
    previousWeek: t.weeklyMileage.previousWeek,
    nextWeek: t.weeklyMileage.nextWeek,
    showingWeek: t.weeklyMileage.showingWeek,
    weeklyComparisonHistory: t.weeklyMileage.weeklyComparisonHistory,
    weeklyComparisonHistoryDescription: t.weeklyMileage.weeklyComparisonHistoryDescription,
    notEnoughHistoricalData: t.weeklyMileage.notEnoughHistoricalData,
    comparableVehicles: t.weeklyMileage.comparableVehicles
  };

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

  const allWeeklyTrendRows = useMemo(() => {
    return buildWeeklyTrendRows(sortedEntries);
  }, [sortedEntries]);

  const availableWeeks = useMemo(() => {
    return Array.from(new Set(sortedEntries.map((entry) => entry.week_ending)));
  }, [sortedEntries]);

  const latestWeekRow = allWeeklyTrendRows[0] ?? null;
  const latestWeekEntries = useMemo(() => {
    return latestWeekRow
      ? sortedEntries.filter((entry) => entry.week_ending === latestWeekRow.weekEnding)
      : [];
  }, [latestWeekRow, sortedEntries]);
  const selectedWeekValue = selectedWeek || availableWeeks[0] || "";
  const selectedWeekEntries = useMemo(() => {
    return selectedWeekValue
      ? sortedEntries.filter((entry) => entry.week_ending === selectedWeekValue)
      : [];
  }, [selectedWeekValue, sortedEntries]);
  const selectedWeekSummaryRow =
    allWeeklyTrendRows.find((row) => row.weekEnding === selectedWeekValue) ?? latestWeekRow;
  const selectedWeekIndex = availableWeeks.findIndex((week) => week === selectedWeekValue);
  const previousWeekValue =
    selectedWeekIndex >= 0 && selectedWeekIndex < availableWeeks.length - 1
      ? availableWeeks[selectedWeekIndex + 1]
      : null;
  const nextWeekValue = selectedWeekIndex > 0 ? availableWeeks[selectedWeekIndex - 1] : null;

  const vehiclesSubmittedThisWeek = new Set(
    latestWeekEntries.map((entry) => entry.vehicle_reg || String(entry.driver_id))
  ).size;
  const driversSubmittedThisWeek = getUniqueDriverCount(latestWeekEntries);
  const lastUpdatedWeekLabel = latestWeekRow ? formatDate(latestWeekRow.weekEnding, language) : "-";
  const highestOdometerEntry = latestWeekEntries.reduce<WeeklyMileageEntry | null>((highest, entry) => {
    if (!highest || Number(entry.mileage) > Number(highest.mileage)) {
      return entry;
    }
    return highest;
  }, null);

  const weeklyDistanceCovered = useMemo(() => {
    if (!latestWeekEntries.length) {
      return { total: 0, comparableVehicles: 0 };
    }

    let total = 0;
    let comparableVehicles = 0;

    latestWeekEntries.forEach((entry) => {
      const previousEntry = sortedEntries.find(
        (candidate) =>
          candidate.vehicle_reg === entry.vehicle_reg &&
          candidate.week_ending < entry.week_ending
      );

      if (!previousEntry) {
        return;
      }

      const difference = Number(entry.mileage || 0) - Number(previousEntry.mileage || 0);
      if (difference >= 0) {
        total += difference;
        comparableVehicles += 1;
      }
    });

    return { total, comparableVehicles };
  }, [latestWeekEntries, sortedEntries]);

  const weeklyDistanceByDriverRows = useMemo(() => {
    return buildWeeklyDistanceByDriverRows(selectedWeekEntries, sortedEntries);
  }, [selectedWeekEntries, sortedEntries]);

  const comparisonDrivers = useMemo(() => {
    return drivers
      .filter((driver) =>
        sortedEntries.some((entry) => String(entry.driver_id) === String(driver.id))
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [drivers, sortedEntries]);

  const selectedComparisonEntries = useMemo(() => {
    if (!comparisonDriverId) {
      return [];
    }

    return sortedEntries.filter(
      (entry) => String(entry.driver_id) === String(comparisonDriverId)
    );
  }, [comparisonDriverId, sortedEntries]);

  const selectedComparisonCurrent = selectedComparisonEntries[0] ?? null;
  const selectedComparisonPrevious = selectedComparisonEntries[1] ?? null;
  const selectedComparisonDistance =
    selectedComparisonCurrent && selectedComparisonPrevious
      ? Number(selectedComparisonCurrent.mileage || 0) -
        Number(selectedComparisonPrevious.mileage || 0)
      : null;
  const hasValidSelectedComparison =
    selectedComparisonCurrent &&
    selectedComparisonPrevious &&
    selectedComparisonDistance != null &&
    selectedComparisonDistance >= 0;

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const [driverRows, mileageRows] = await Promise.all([fetchDrivers(), fetchWeeklyMileage()]);
      setDrivers(driverRows);
      setEntries(mileageRows);
    } catch (err) {
      setError(t.weeklyMileage.errorLoad);
    } finally {
      setLoading(false);
    }
  }, [t.weeklyMileage.errorLoad]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

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

  useEffect(() => {
    if (!availableWeeks.length) {
      if (selectedWeek) {
        setSelectedWeek("");
      }
      return;
    }

    if (!selectedWeek || !availableWeeks.includes(selectedWeek)) {
      setSelectedWeek(availableWeeks[0]);
    }
  }, [availableWeeks, selectedWeek]);

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
      setError(t.weeklyMileage.errorSave);
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

  const handleDelete = async (id: string) => {
    if (!window.confirm(t.weeklyMileage.deleteConfirm)) {
      return;
    }

    try {
      setDeletingId(id);
      setError(null);
      await deleteWeeklyMileage(id);

      if (form.id === id) {
        resetForm();
      }

      await loadData();
    } catch (err) {
      setError(t.weeklyMileage.deleteError);
    } finally {
      setDeletingId(null);
    }
  };

  const summaryCards = [
    {
      label: labels.latestReportingWeek,
      value: lastUpdatedWeekLabel,
      helper: latestWeekRow
        ? labels.latestReportingWeekHelper
        : t.weeklyMileage.noDataDescription,
      icon: <CalendarClock className="h-5 w-5" />
    },
    {
      label: labels.vehiclesSubmittedThisWeek,
      value: latestWeekRow ? formatNumber(vehiclesSubmittedThisWeek, language) : "-",
      helper:
        latestWeekRow
          ? labels.vehiclesSubmittedThisWeekHelper
          : t.weeklyMileage.noDataDescription,
      icon: <Truck className="h-5 w-5" />
    },
    {
      label: labels.driversSubmittedThisWeek,
      value: latestWeekRow ? formatNumber(driversSubmittedThisWeek, language) : "-",
      helper:
        latestWeekRow
          ? labels.driversSubmittedThisWeekHelper
          : t.weeklyMileage.noDataDescription,
      icon: <Users className="h-5 w-5" />
    },
    {
      label: labels.highestOdometerThisWeek,
      value: highestOdometerEntry ? formatNumber(highestOdometerEntry.mileage, language) : "-",
      helper:
        latestWeekRow
          ? highestOdometerEntry?.vehicle_reg
            ? `${labels.highestOdometerThisWeekHelper} ${highestOdometerEntry.vehicle_reg}`
            : labels.highestOdometerThisWeekHelper
          : t.weeklyMileage.noDataDescription,
      icon: <Gauge className="h-5 w-5" />
    },
    {
      label: labels.weeklyDistanceCovered,
      value:
        weeklyDistanceCovered.comparableVehicles > 0
          ? formatNumber(weeklyDistanceCovered.total, language)
          : labels.weeklyDistanceCoveredUnavailable,
      helper:
        weeklyDistanceCovered.comparableVehicles > 0
          ? `${labels.weeklyDistanceCoveredHelper} ${formatNumber(
              weeklyDistanceCovered.comparableVehicles,
              language
            )}`
          : labels.weeklyDistanceCoveredUnavailable,
      icon: <Route className="h-5 w-5" />
    }
  ];

  return (
    <>
      <div className="mb-6 hidden md:block">
        <Header title={t.weeklyMileage.title} description={t.weeklyMileage.description} />
      </div>

      <section className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
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

      <section className="surface-card p-4 sm:p-5 lg:p-5.5">
        <form onSubmit={handleSubmit} className="w-full">
          <div className="w-full max-w-[780px]">
            <div className="mb-4">
              <h3 className="section-title">
                {isEditing ? t.weeklyMileage.editEntry : t.weeklyMileage.addEntry}
              </h3>
              <p className="section-subtitle">
                {isEditing ? t.weeklyMileage.helperEdit : t.weeklyMileage.helperAdd}
              </p>
            </div>

            <div className="subtle-panel p-4 sm:p-4.5">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="form-field">
                  <label className="form-label">{t.weeklyMileage.weekEnding}</label>
                  <input
                    type="date"
                    required
                    value={form.week_ending}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, week_ending: event.target.value }))
                    }
                    className="form-input bg-white"
                  />
                </div>

                <div className="form-field">
                  <label className="form-label">{t.weeklyMileage.driver}</label>
                  <select
                    required
                    value={form.driver_id}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, driver_id: event.target.value }))
                    }
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
                  <label className="form-label">{t.weeklyMileage.driverName}</label>
                  <input
                    readOnly
                    value={form.driver}
                    className="form-input-readonly bg-slate-50/90"
                  />
                </div>

                <div className="form-field">
                  <label className="form-label">{t.weeklyMileage.vehicleReg}</label>
                  <input
                    readOnly
                    value={form.vehicle_reg}
                    className="form-input-readonly bg-slate-50/90"
                  />
                </div>
              </div>

              <div className="mt-4 form-field">
                <label className="form-label">{t.weeklyMileage.mileage}</label>
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
                  className="form-input bg-white"
                />
              </div>

              {error ? <p className="mt-3 text-sm text-rose-600">{error}</p> : null}

              <div className="mt-3 flex flex-col gap-2.5 sm:flex-row sm:items-center">
                <button
                  type="submit"
                  disabled={saving}
                  className="btn-primary w-full min-w-[240px] justify-center sm:w-auto disabled:opacity-70"
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
                    className="btn-secondary w-full sm:w-auto"
                  >
                    {t.common.cancel}
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </form>
      </section>

      <section className="surface-card mt-4 min-w-0 p-4 sm:p-5 lg:p-5.5">
        <div className="mb-4 flex flex-col gap-3.5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h3 className="section-title">{labels.recordsForWeek}</h3>
            <p className="section-subtitle">{labels.recordsForWeekDescription}</p>
          </div>

          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center">
            <div className="grid gap-2.5 sm:flex sm:items-center">
              <button
                type="button"
                onClick={() => previousWeekValue && setSelectedWeek(previousWeekValue)}
                disabled={!previousWeekValue}
                className="btn-secondary w-full px-3 py-2 sm:w-auto disabled:cursor-not-allowed disabled:opacity-50"
              >
                {labels.previousWeek}
              </button>

              <div className="form-field w-full sm:min-w-[220px]">
                <label className="sr-only">{labels.selectWeek}</label>
                <select
                  value={selectedWeekValue}
                  onChange={(event) => setSelectedWeek(event.target.value)}
                  className="form-input bg-white"
                >
                  {availableWeeks.map((week) => (
                    <option key={week} value={week}>
                      {formatDate(week, language)}
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="button"
                onClick={() => nextWeekValue && setSelectedWeek(nextWeekValue)}
                disabled={!nextWeekValue}
                className="btn-secondary w-full px-3 py-2 sm:w-auto disabled:cursor-not-allowed disabled:opacity-50"
              >
                {labels.nextWeek}
              </button>
            </div>

            <button
              type="button"
              onClick={exportWeeklyMileage}
              disabled={!sortedEntries.length}
              className="btn-secondary w-full gap-2 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
            >
              <Download className="h-4 w-4" />
              {t.common.export}
            </button>
          </div>
        </div>

        {selectedWeekValue ? (
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
            <span className="badge-muted">{labels.showingWeek}</span>
            <p className="text-sm font-medium text-slate-700">
              {formatDate(selectedWeekValue, language)}
            </p>
          </div>
        ) : null}

        {loading ? (
          <EmptyState title={t.common.loading} description={t.weeklyMileage.loading} />
        ) : selectedWeekEntries.length === 0 ? (
          <EmptyState
            title={t.weeklyMileage.noDataTitle}
            description={t.weeklyMileage.noDataDescription}
          />
        ) : (
          <>
            <div className="space-y-3.5 md:hidden">
              {selectedWeekEntries.map((entry) => (
                <div key={entry.id} className="subtle-panel p-4">
                  <div className="flex flex-col gap-2.5 min-[400px]:flex-row min-[400px]:items-start min-[400px]:justify-between">
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
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
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
                      className="btn-secondary flex-1"
                    >
                      {t.common.edit}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete(String(entry.id))}
                      disabled={deletingId === String(entry.id)}
                      className="btn-danger flex-1 gap-2 disabled:opacity-50"
                    >
                      <Trash2 className="h-4 w-4" />
                      {deletingId === String(entry.id) ? t.common.deleting : t.common.delete}
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="hidden overflow-x-auto md:block">
              <div className="table-shell rounded-2xl">
                <table className="w-full min-w-[760px] text-sm">
                  <colgroup>
                    <col className="w-[19%]" />
                    <col className="w-[28%]" />
                    <col className="w-[21%]" />
                    <col className="w-[16%]" />
                    <col className="w-[16%]" />
                  </colgroup>
                  <thead>
                    <tr className="bg-slate-50/70 text-slate-600">
                      <th className="px-4 py-2 text-left font-semibold">
                        {t.weeklyMileage.table.weekEnding}
                      </th>
                      <th className="px-4 py-2 text-left font-semibold">
                        {t.weeklyMileage.table.driver}
                      </th>
                      <th className="px-4 py-2 text-left font-semibold">
                        {t.weeklyMileage.table.vehicleReg}
                      </th>
                      <th className="px-3 py-2 text-right font-semibold">
                        {t.weeklyMileage.table.mileage}
                      </th>
                      <th className="px-3 py-2 text-left font-semibold">
                        {t.weeklyMileage.table.action}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedWeekEntries.map((entry) => (
                      <tr
                        key={entry.id}
                        className="border-b border-slate-100/60 transition last:border-none hover:bg-slate-50/55"
                      >
                        <td className="px-4 py-2 font-medium text-slate-900">
                          {formatDate(entry.week_ending, language)}
                        </td>
                        <td className="px-4 py-2 text-slate-700">{entry.driver || "-"}</td>
                        <td className="px-4 py-2 text-slate-700">{entry.vehicle_reg || "-"}</td>
                        <td className="px-3 py-2 text-right font-medium text-slate-800">
                          {formatNumber(entry.mileage, language)}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1.5 whitespace-nowrap">
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
                              className="btn-secondary px-3 py-1.5 text-xs"
                            >
                              {t.common.edit}
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDelete(String(entry.id))}
                              disabled={deletingId === String(entry.id)}
                              className="btn-danger px-3 py-1.5 text-xs disabled:opacity-50"
                            >
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
          </>
        )}

      </section>

      <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <section className="surface-card min-w-0 p-4 sm:p-5">
          <div className="mb-4">
            <h3 className="section-title">{labels.reportingWeekSummary}</h3>
            <p className="section-subtitle">{labels.reportingWeekSummaryDescription}</p>
          </div>

          {loading ? (
            <EmptyState title={t.common.loading} description={t.weeklyMileage.loading} />
          ) : !selectedWeekSummaryRow ? (
            <EmptyState
              title={labels.noWeeklyRecordsForDriver}
              description={t.weeklyMileage.noDataDescription}
            />
          ) : (
            <div className="space-y-3">
              <div className="subtle-panel p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                      {labels.currentReportingWeek}
                    </p>
                    <p className="mt-1 text-lg font-semibold text-slate-950">
                      {formatDate(selectedWeekSummaryRow.weekEnding, language)}
                    </p>
                  </div>
                  <span className="badge-muted">
                    {formatNumber(selectedWeekEntries.length, language)} {t.common.entries}
                  </span>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="subtle-panel p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                    {labels.vehiclesSubmittedThisWeek}
                  </p>
                  <p className="mt-1 text-lg font-semibold text-slate-950">
                    {formatNumber(selectedWeekSummaryRow.vehiclesSubmitted, language)}
                  </p>
                </div>

                <div className="subtle-panel p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                    {labels.driversSubmittedThisWeek}
                  </p>
                  <p className="mt-1 text-lg font-semibold text-slate-950">
                    {formatNumber(selectedWeekSummaryRow.driversSubmitted, language)}
                  </p>
                </div>

                <div className="subtle-panel p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                    {labels.highestOdometerThisWeek}
                  </p>
                  <p className="mt-1 text-lg font-semibold text-slate-950">
                    {selectedWeekSummaryRow.highestOdometer != null
                      ? formatNumber(selectedWeekSummaryRow.highestOdometer, language)
                      : "-"}
                  </p>
                </div>

                <div className="subtle-panel p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                    {labels.lowestOdometerThisWeek}
                  </p>
                  <p className="mt-1 text-lg font-semibold text-slate-950">
                    {selectedWeekSummaryRow.lowestOdometer != null
                      ? formatNumber(selectedWeekSummaryRow.lowestOdometer, language)
                      : "-"}
                  </p>
                </div>

                <div className="subtle-panel p-4 sm:col-span-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                    {labels.weeklyDistanceCovered}
                  </p>
                  <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                    <p className="text-lg font-semibold text-slate-950">
                      {selectedWeekSummaryRow.weeklyDistanceCovered != null
                        ? formatNumber(selectedWeekSummaryRow.weeklyDistanceCovered, language)
                        : labels.notEnoughDataYet}
                    </p>
                    <p className="text-sm text-slate-500">
                      {selectedWeekSummaryRow.comparableVehicles > 0
                        ? `${formatNumber(selectedWeekSummaryRow.comparableVehicles, language)} ${labels.comparableVehicles}`
                        : labels.notEnoughDataYet}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>

        <section className="surface-card min-w-0 p-4 sm:p-5">
          <div className="mb-4">
            <h3 className="section-title">{labels.weeklyDistanceByDriver}</h3>
            <p className="section-subtitle">{labels.weeklyDistanceByDriverDescription}</p>
          </div>

          {loading ? (
            <EmptyState title={t.common.loading} description={t.weeklyMileage.loading} />
          ) : (
            <div className="space-y-3">
              <div className="grid gap-3.5 lg:grid-cols-[minmax(240px,280px)_minmax(0,1fr)]">
                <div className="form-field">
                  <label className="form-label">{labels.compareDriver}</label>
                  <select
                    value={comparisonDriverId}
                    onChange={(event) => setComparisonDriverId(event.target.value)}
                    className="form-input bg-white"
                  >
                    <option value="">{t.weeklyMileage.selectDriver}</option>
                    {comparisonDrivers.map((driver) => (
                      <option key={driver.id} value={String(driver.id)}>
                        {driver.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="subtle-panel p-4">
                  <p className="text-sm font-semibold text-slate-900">{labels.weeklyDistanceCovered}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {selectedWeekValue ? formatDate(selectedWeekValue, language) : labels.notEnoughDataYet}
                  </p>
                  {weeklyDistanceByDriverRows.length === 0 ? (
                    <p className="mt-3 text-sm text-slate-500">{labels.notEnoughDataYet}</p>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {weeklyDistanceByDriverRows.slice(0, 3).map((row) => (
                        <div
                          key={`${row.driver}-${row.vehicleReg}`}
                          className="flex flex-col gap-1.5 border-b border-slate-100/70 pb-2 last:border-b-0 last:pb-0 min-[400px]:flex-row min-[400px]:items-center min-[400px]:justify-between"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-slate-800">{row.driver}</p>
                            <p className="mt-0.5 text-xs text-slate-400">{row.vehicleReg}</p>
                          </div>
                          <p className="text-sm font-semibold text-slate-950">
                            {formatNumber(row.weeklyDistanceCovered, language)}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {!comparisonDriverId ? (
                  <div className="subtle-panel flex min-h-[260px] items-center justify-center p-5">
                  <EmptyState
                    title={labels.compareDriver}
                    description={labels.selectDriverToCompare}
                  />
                </div>
              ) : !hasValidSelectedComparison ? (
                <div className="subtle-panel flex min-h-[260px] items-center justify-center p-5">
                  <EmptyState
                    title={labels.notEnoughHistoricalData}
                    description={labels.weeklyComparisonHistoryDescription}
                  />
                </div>
              ) : (
                <div className="grid gap-3.5 xl:grid-cols-[minmax(0,1.05fr)_minmax(260px,0.95fr)]">
                  <div className="subtle-panel p-4">
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                          {labels.currentReportingWeek}
                        </p>
                        <p className="mt-1 text-base font-semibold text-slate-950">
                          {formatDate(selectedComparisonCurrent.week_ending, language)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                          {labels.currentOdometer}
                        </p>
                        <p className="mt-1 text-base font-semibold text-slate-950">
                          {formatNumber(selectedComparisonCurrent.mileage, language)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                          {labels.selectedVehicleReg}
                        </p>
                        <p className="mt-1 text-base font-semibold text-slate-950">
                          {selectedComparisonCurrent.vehicle_reg || "-"}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                          {labels.previousReportingWeek}
                        </p>
                        <p className="mt-1 text-base font-semibold text-slate-950">
                          {formatDate(selectedComparisonPrevious.week_ending, language)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                          {labels.previousOdometer}
                        </p>
                        <p className="mt-1 text-base font-semibold text-slate-950">
                          {formatNumber(selectedComparisonPrevious.mileage, language)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                          {labels.weeklyDistanceCovered}
                        </p>
                        <p className="mt-1 text-base font-semibold text-slate-950">
                          {formatNumber(selectedComparisonDistance, language)}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="subtle-panel p-4">
                    <p className="text-sm font-semibold text-slate-900">
                      {labels.weeklyComparisonHistory}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {labels.weeklyComparisonHistoryDescription}
                    </p>
                    <div className="mt-3 space-y-2">
                      {selectedComparisonEntries.slice(0, 5).map((entry) => (
                        <div
                          key={entry.id}
                          className="flex flex-col gap-1.5 border-b border-slate-100/70 pb-2 last:border-b-0 last:pb-0 min-[400px]:flex-row min-[400px]:items-center min-[400px]:justify-between"
                        >
                          <div>
                            <p className="text-sm font-medium text-slate-800">
                              {formatDate(entry.week_ending, language)}
                            </p>
                            <p className="mt-0.5 text-xs text-slate-400">
                              {entry.vehicle_reg || "-"}
                            </p>
                          </div>
                          <p className="text-sm font-semibold text-slate-950">
                            {formatNumber(entry.mileage, language)}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      </section>
    </>
  );
}
