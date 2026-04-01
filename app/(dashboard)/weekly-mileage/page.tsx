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

const initialForm = {
  id: "",
  week_ending: "",
  driver_id: "",
  vehicle_reg: "",
  mileage: ""
};

function getUniqueDriverCount(entries: WeeklyMileageEntry[]) {
  return new Set(
    entries
      .map((entry) => (entry.driver || "").trim())
      .filter(Boolean)
      .map((name) => name.toLowerCase())
  ).size;
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
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [comparisonDriverId, setComparisonDriverId] = useState("");
  const [selectedWeek, setSelectedWeek] = useState("");
  const [tablePage, setTablePage] = useState(1);
  const actionMessages =
    language === "th"
      ? {
          saved: "บันทึกระยะทางรายสัปดาห์เรียบร้อยแล้ว",
          updated: "อัปเดตระยะทางรายสัปดาห์เรียบร้อยแล้ว",
          deleted: "ลบบันทึกระยะทางรายสัปดาห์เรียบร้อยแล้ว"
        }
      : {
          saved: "Weekly mileage saved successfully.",
          updated: "Weekly mileage updated successfully.",
          deleted: "Weekly mileage deleted successfully."
        };

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
  const autoFillLabel =
    language === "th"
      ? "กรอกจากคนขับโดยอัตโนมัติ (แก้ไขได้)"
      : "Auto-filled based on driver (can be changed)";
  const noVehicleAssignedLabel =
    language === "th"
      ? "ยังไม่ได้ผูกรถกับคนขับ โปรดเลือกเอง"
      : "No vehicle assigned – please select manually";

  const sortedEntries = useMemo(() => {
    return [...entries].sort((a, b) => {
      const dateDiff = new Date(b.week_ending).getTime() - new Date(a.week_ending).getTime();
      if (dateDiff !== 0) {
        return dateDiff;
      }
      return String(b.id).localeCompare(String(a.id));
    });
  }, [entries]);

  const weeklyVehicleRows = useMemo(() => computeWeeklyMileageByVehicle(sortedEntries), [sortedEntries]);
  const driverWeeklyComparisonRows = useMemo(
    () => buildDriverWeeklyComparisons(sortedEntries),
    [sortedEntries]
  );

  const allWeeklyTrendRows = useMemo(() => {
    return buildWeeklyMileageSummary(sortedEntries).map((row) => ({
      weekEnding: row.weekEnding,
      vehiclesSubmitted: row.vehiclesSubmitted,
      driversSubmitted: row.driversSubmitted,
      highestOdometer: row.highestOdometer,
      lowestOdometer: row.lowestOdometer,
      weeklyDistanceCovered: row.weeklyDistance,
      comparableVehicles: row.comparableVehicles
    }));
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
  const selectedWeekTotalPages = Math.max(1, Math.ceil(selectedWeekEntries.length / 25));
  const selectedWeekPagedEntries = useMemo(() => {
    const safePage = Math.min(tablePage, selectedWeekTotalPages);
    const startIndex = (safePage - 1) * 25;
    return selectedWeekEntries.slice(startIndex, startIndex + 25);
  }, [selectedWeekEntries, selectedWeekTotalPages, tablePage]);
  const selectedWeekVehicleRows = useMemo(
    () => weeklyVehicleRows.filter((row) => row.weekEnding === selectedWeekValue),
    [selectedWeekValue, weeklyVehicleRows]
  );
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

  const weeklyDistanceCovered = useMemo(
    () => ({
      total: latestWeekRow?.weeklyDistanceCovered ?? 0,
      comparableVehicles: latestWeekRow?.comparableVehicles ?? 0
    }),
    [latestWeekRow]
  );

  const weeklyDistanceByDriverRows = useMemo(() => {
    return driverWeeklyComparisonRows
      .filter((row) => row.latestWeekEnding === selectedWeekValue)
      .filter((row) => row.previousWeekEnding != null && row.weeklyDistance != null)
      .sort((left, right) => Number(right.weeklyDistance) - Number(left.weeklyDistance));
  }, [driverWeeklyComparisonRows, selectedWeekValue]);

  const comparisonDrivers = useMemo(() => {
    return drivers
      .filter((driver) =>
        driverWeeklyComparisonRows.some((row) => String(row.driverId) === String(driver.id))
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [driverWeeklyComparisonRows, drivers]);

  const selectedComparisonRow = useMemo(
    () =>
      comparisonDriverId
        ? driverWeeklyComparisonRows.find(
            (row) => String(row.driverId) === String(comparisonDriverId)
          ) ?? null
        : null,
    [comparisonDriverId, driverWeeklyComparisonRows]
  );
  const selectedComparisonCurrent = selectedComparisonRow
    ? {
        week_ending: selectedComparisonRow.latestWeekEnding,
        mileage: selectedComparisonRow.latestOdometer,
        vehicle_reg: selectedComparisonRow.vehicleReg
      }
    : null;
  const selectedComparisonPrevious = selectedComparisonRow
    ? {
        week_ending: selectedComparisonRow.previousWeekEnding ?? "",
        mileage: selectedComparisonRow.previousOdometer ?? 0,
        vehicle_reg: selectedComparisonRow.previousVehicleReg ?? selectedComparisonRow.vehicleReg
      }
    : null;
  const selectedComparisonDistance = selectedComparisonRow?.weeklyDistance ?? null;
  const hasSelectedComparisonWarning = Boolean(selectedComparisonRow?.unusual);
  const hasValidSelectedComparison =
    selectedComparisonRow &&
    selectedComparisonPrevious &&
    selectedComparisonRow.previousWeekEnding &&
    !hasSelectedComparisonWarning;
  const selectedComparisonHistory = useMemo(() => {
    if (!selectedComparisonRow) {
      return [];
    }

    return selectedComparisonRow.history.slice(0, 5);
  }, [selectedComparisonRow]);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const [driverRows, mileageRows] = await Promise.all([fetchDrivers(), fetchWeeklyMileage()]);
      setDrivers(driverRows);
      setEntries(mileageRows);
    } catch (err) {
      console.error("Weekly mileage loadData error:", err);
      setError(t.weeklyMileage.errorLoad);
    } finally {
      setLoading(false);
    }
  }, [t.weeklyMileage.errorLoad]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    const handleDataChanged = () => {
      void loadData();
    };

    window.addEventListener("fuel-bank:data-changed", handleDataChanged);
    return () => window.removeEventListener("fuel-bank:data-changed", handleDataChanged);
  }, [loadData]);

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

  useEffect(() => {
    setTablePage(1);
  }, [selectedWeekValue]);

  const resetForm = (clearMessages = true) => {
    setForm(initialForm);
    setError(null);
    if (clearMessages) {
      setSuccessMessage(null);
    }
  };

  const handleInvalid = (
    event: React.InvalidEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    applyRequiredValidationMessage(event, t.common.requiredField);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const numericMileage = Number(form.mileage);
      if (!form.driver_id || !form.vehicle_reg || !form.week_ending || !Number.isFinite(numericMileage)) {
        throw new Error(t.common.requiredField);
      }
      if (
        previousVehicleEntry?.mileage != null &&
        numericMileage < Number(previousVehicleEntry.mileage) &&
        !window.confirm(
          language === "th"
            ? "เลขไมล์ต่ำกว่ารายการก่อนหน้า ต้องการบันทึกต่อหรือไม่"
            : "Mileage is lower than the previous reading. Save anyway?"
        )
      ) {
        throw new Error(t.weeklyMileage.mileageValidationError);
      }

      const savedEntry = await saveWeeklyMileage({
        id: form.id || undefined,
        week_ending: form.week_ending,
        driver_id: form.driver_id,
        vehicle_reg: form.vehicle_reg,
        odometer_reading: numericMileage
      });

      setSelectedWeek(savedEntry.week_ending ?? form.week_ending);

      resetForm(false);
      setSuccessMessage(isEditing ? actionMessages.updated : actionMessages.saved);
      await loadData();
    } catch (err) {
      console.error("Weekly mileage handleSubmit error:", err);
      setError(err instanceof Error && err.message ? err.message : t.weeklyMileage.errorSave);
    } finally {
      setSaving(false);
    }
  };

  const previousVehicleEntry = useMemo(() => {
    if (!form.vehicle_reg || !form.week_ending) {
      return null;
    }

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
  const showLowerMileageWarning = weeklyDifference != null && weeklyDifference < 0;

  const exportWeeklyMileage = () => {
    exportToCsv(
      sortedEntries.map((entry) => ({
        [t.weeklyMileage.weekEnding]: formatDate(entry.week_ending, language),
        [t.weeklyMileage.driver]: entry.driver,
        [t.weeklyMileage.vehicleReg]: entry.vehicle_reg,
        [t.weeklyMileage.mileage]: entry.mileage
      })),
      "weekly-mileage-report"
    );
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm(t.weeklyMileage.deleteConfirm)) {
      return;
    }

    try {
      setDeletingId(id);
      setError(null);
      setSuccessMessage(null);
      await deleteWeeklyMileage(id);

      if (form.id === id) {
        resetForm();
      }

      setSuccessMessage(actionMessages.deleted);
      await loadData();
    } catch (err) {
      console.error("Weekly mileage handleDelete error:", err);
      setError(err instanceof Error && err.message ? err.message : t.weeklyMileage.deleteError);
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
            valueVariant={card.label === labels.latestReportingWeek ? "date" : "default"}
          />
        ))}
      </section>

      <section className="surface-card p-5 sm:p-6 lg:p-6.5">
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

            <div className="form-section">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="form-field">
                  <label className="form-label form-label-required">{t.weeklyMileage.weekEnding}</label>
                  <input
                    type="date"
                    required
                    value={form.week_ending}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, week_ending: event.target.value }))
                    }
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
                      const nextDriverId = event.target.value;
                      const nextDriver = drivers.find(
                        (driver) => String(driver.id) === String(nextDriverId)
                      );

                      setForm((current) => ({
                        ...current,
                        driver_id: nextDriverId,
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
                    onChange={(event) =>
                      setForm((current) => ({ ...current, vehicle_reg: event.target.value }))
                    }
                    className="form-input bg-white"
                  />
                  <p className="form-helper">
                    {selectedDriver?.vehicle_reg?.trim() ? autoFillLabel : noVehicleAssignedLabel}
                  </p>
                </div>
              </div>

              <div className="mt-4 form-field">
                <label className="form-label form-label-required">{t.weeklyMileage.mileage}</label>
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
                  onInvalid={handleInvalid}
                  onInput={clearValidationMessage}
                  className="form-input bg-white"
                />
                <div className="mt-2 space-y-2">
                  <p className="form-helper">
                    {previousVehicleEntry
                      ? language === "th"
                        ? `สัปดาห์ก่อน ${formatDate(previousVehicleEntry.week_ending, language)} | ${formatNumber(previousVehicleEntry.mileage, language)} | ต่าง ${weeklyDifference != null ? formatNumber(weeklyDifference, language) : "-"}`
                        : `Last week ${formatDate(previousVehicleEntry.week_ending, language)} | ${formatNumber(previousVehicleEntry.mileage, language)} | Difference ${weeklyDifference != null ? formatNumber(weeklyDifference, language) : "-"}`
                      : language === "th"
                        ? "ยังไม่มีข้อมูลสัปดาห์ก่อนสำหรับรถคันนี้"
                        : "No previous week found for this vehicle yet."}
                  </p>
                  {showLowerMileageWarning ? (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                      {language === "th"
                        ? "เลขไมล์น้อยกว่ารายการก่อนหน้า"
                        : "Mileage lower than previous entry"}
                    </div>
                  ) : null}
                </div>
              </div>

              {error ? <p className="form-error mt-3">{error}</p> : null}
              {successMessage ? (
                <p className="mt-3 text-sm text-emerald-600">{successMessage}</p>
              ) : null}

              <div className="sticky bottom-3 z-10 mt-3 flex flex-col gap-2.5 rounded-[1.5rem] border border-slate-200/80 bg-white/95 p-3 shadow-[0_10px_30px_rgba(15,23,42,0.08)] backdrop-blur sm:static sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none sm:flex-row sm:items-center">
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
                    onClick={() => resetForm()}
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
            <p className="supporting-date-strong">
              {formatDate(selectedWeekValue, language)}
            </p>
            <span className="text-sm text-slate-500">
              {formatNumber(selectedWeekEntries.length, language)} {t.common.entries}
            </span>
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
              {selectedWeekPagedEntries.map((entry) => (
                <div key={entry.id} className="subtle-panel p-4">
                  <div className="flex flex-col gap-2.5 min-[400px]:flex-row min-[400px]:items-start min-[400px]:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{entry.driver || "-"}</p>
                      <p className="mt-1 text-sm text-slate-500">{entry.vehicle_reg || "-"}</p>
                    </div>
                    <p className="supporting-date-strong">
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

            <div className="hidden md:block">
              <div className="table-shell rounded-2xl">
                <div className="table-scroll">
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
                      <th className="table-head-cell text-left">
                        {t.weeklyMileage.table.weekEnding}
                      </th>
                      <th className="table-head-cell text-left">
                        {t.weeklyMileage.table.driver}
                      </th>
                      <th className="table-head-cell text-left">
                        {t.weeklyMileage.table.vehicleReg}
                      </th>
                      <th className="table-head-cell text-right">
                        {t.weeklyMileage.table.mileage}
                      </th>
                      <th className="table-head-cell text-left">
                        {t.weeklyMileage.table.action}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedWeekPagedEntries.map((entry) => (
                      <tr key={entry.id} className="enterprise-table-row">
                        <td className="table-body-cell supporting-date-strong">
                          {formatDate(entry.week_ending, language)}
                        </td>
                        <td className="table-body-cell text-slate-700">{entry.driver || "-"}</td>
                        <td className="table-body-cell text-slate-700">{entry.vehicle_reg || "-"}</td>
                        <td className="table-body-cell text-right font-medium text-slate-800">
                          {formatNumber(entry.mileage, language)}
                        </td>
                        <td className="table-body-cell">
                          <div className="flex items-center gap-1.5 whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() =>
                                setForm({
                                  id: String(entry.id),
                                  week_ending: entry.week_ending,
                                  driver_id: String(entry.driver_id),
                                  vehicle_reg: entry.vehicle_reg,
                                  mileage: String(entry.mileage)
                                })
                              }
                              className="table-action-secondary"
                            >
                              {t.common.edit}
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDelete(String(entry.id))}
                              disabled={deletingId === String(entry.id)}
                              className="table-action-danger disabled:opacity-50"
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
            </div>
            <div className="mt-4 flex items-center justify-between gap-3">
              <p className="text-sm text-slate-500">
                {t.common.page} {formatNumber(Math.min(tablePage, selectedWeekTotalPages), language)} {t.common.of} {formatNumber(selectedWeekTotalPages, language)}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setTablePage((current) => Math.max(1, current - 1))}
                  disabled={tablePage === 1}
                  className="btn-secondary disabled:opacity-50"
                >
                  {t.common.previous}
                </button>
                <button
                  type="button"
                  onClick={() => setTablePage((current) => Math.min(selectedWeekTotalPages, current + 1))}
                  disabled={tablePage >= selectedWeekTotalPages}
                  className="btn-secondary disabled:opacity-50"
                >
                  {t.common.next}
                </button>
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
                    <p className="supporting-date-strong mt-1 text-base">
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
                  <p className="supporting-date mt-1">
                    {selectedWeekValue ? formatDate(selectedWeekValue, language) : labels.notEnoughDataYet}
                  </p>
                  {weeklyDistanceByDriverRows.length === 0 ? (
                    <p className="mt-3 text-sm text-slate-500">{labels.notEnoughDataYet}</p>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {weeklyDistanceByDriverRows.slice(0, 3).map((row) => (
                        <div
                          key={`${row.driverId}-${row.latestWeekEnding}`}
                          className="flex flex-col gap-1.5 border-b border-slate-100/70 pb-2 last:border-b-0 last:pb-0 min-[400px]:flex-row min-[400px]:items-center min-[400px]:justify-between"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-slate-800">{row.driver}</p>
                            <p className="mt-0.5 text-xs text-slate-400">
                              {row.vehicleReg} | {formatDate(row.previousWeekEnding!, language)} {"->"}{" "}
                              {formatDate(row.latestWeekEnding, language)}
                            </p>
                          </div>
                          <p className="text-sm font-semibold text-slate-950">
                            {formatNumber(row.weeklyDistance!, language)}
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
              ) : hasSelectedComparisonWarning ? (
                <div className="subtle-panel flex min-h-[260px] items-center justify-center p-5">
                  <EmptyState
                    title={labels.weeklyDistanceCovered}
                    description={
                      language === "th"
                        ? "พบเลขไมล์ล่าสุดน้อยกว่ารายการก่อนหน้า กรุณาตรวจสอบประวัติเลขไมล์ของรถคันนี้"
                        : "The latest odometer reading is lower than the previous one. Please review this vehicle's odometer history."
                    }
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
                        <p className="supporting-date-strong mt-1">
                          {formatDate(selectedComparisonCurrent!.week_ending, language)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                          {labels.currentOdometer}
                        </p>
                        <p className="mt-1 text-base font-semibold text-slate-950">
                          {formatNumber(selectedComparisonCurrent!.mileage, language)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                          {labels.selectedVehicleReg}
                        </p>
                        <p className="mt-1 text-base font-semibold text-slate-950">
                          {selectedComparisonCurrent!.vehicle_reg || "-"}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                          {labels.previousReportingWeek}
                        </p>
                        <p className="supporting-date-strong mt-1">
                          {formatDate(selectedComparisonPrevious!.week_ending, language)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                          {labels.previousOdometer}
                        </p>
                        <p className="mt-1 text-base font-semibold text-slate-950">
                          {formatNumber(selectedComparisonPrevious!.mileage, language)}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {selectedComparisonPrevious!.vehicle_reg || "-"}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                          {labels.weeklyDistanceCovered}
                        </p>
                        <p className="mt-1 text-base font-semibold text-slate-950">
                          {formatNumber(selectedComparisonDistance!, language)}
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
                      {selectedComparisonHistory.map((entry) => (
                        <div
                          key={entry.id}
                          className="flex flex-col gap-1.5 border-b border-slate-100/70 pb-2 last:border-b-0 last:pb-0 min-[400px]:flex-row min-[400px]:items-center min-[400px]:justify-between"
                        >
                          <div>
                            <p className="supporting-date-strong text-slate-800">
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
