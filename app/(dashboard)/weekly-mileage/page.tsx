"use client";

import { CheckCircle2, Download, History, Pencil, Plus, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/empty-state";
import { Header } from "@/components/header";
import { WeeklyMileageUploadCard } from "@/components/weekly-mileage-upload-card";
import {
  deleteWeeklyMileage,
  fetchDrivers,
  fetchVehicleServiceLogs,
  fetchVehicles,
  fetchWeeklyMileage,
  saveOilChangeService,
  saveWeeklyMileage
} from "@/lib/data";
import { exportToCsv } from "@/lib/export";
import { applyRequiredValidationMessage, clearValidationMessage } from "@/lib/form-validation";
import { useLanguage } from "@/lib/language-provider";
import { getOilChangeIntervalForVehicleType } from "@/lib/oil-change-service";
import {
  buildDriverWeeklyComparisons,
  buildOilChangeAlertRows,
  buildWeeklyMileageSummary,
  computeWeeklyMileageByVehicle
} from "@/lib/operations";
import { formatDate, formatNumber } from "@/lib/utils";
import type { Driver, Vehicle, VehicleServiceLog, WeeklyMileageEntry } from "@/types/database";

const PAGE_SIZE = 25;
const initialForm = { id: "", week_ending: "", driver_id: "", vehicle_reg: "", mileage: "" };
type OilActionMode = "set" | "edit" | "mark";
type OilFilter = "all" | "overdue" | "urgent" | "due_soon" | "review_required" | "not_set" | "ok";

export default function WeeklyMileagePage() {
  const { language, t } = useLanguage();
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [serviceLogs, setServiceLogs] = useState<VehicleServiceLog[]>([]);
  const [entries, setEntries] = useState<WeeklyMileageEntry[]>([]);
  const [form, setForm] = useState(initialForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [savingService, setSavingService] = useState(false);
  const [oilFilter, setOilFilter] = useState<OilFilter>("all");
  const [serviceModal, setServiceModal] = useState<{
    mode: OilActionMode;
    vehicleId: string | null;
    registration: string;
    vehicleName: string;
    vehicleType: string | null;
    serviceLogId?: string | null;
  } | null>(null);
  const [serviceForm, setServiceForm] = useState({
    serviceDate: "",
    serviceOdometer: "",
    intervalKm: "",
    notes: ""
  });
  const [historyVehicleReg, setHistoryVehicleReg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
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
  const oilChangeRows = useMemo(
    () => buildOilChangeAlertRows({ vehicles, weeklyMileage: sortedEntries, drivers }),
    [drivers, sortedEntries, vehicles]
  );
  const oilSummary = useMemo(
    () => ({
      overdue: oilChangeRows.filter((row) => row.status === "overdue").length,
      urgent: oilChangeRows.filter((row) => row.status === "urgent").length,
      due_soon: oilChangeRows.filter((row) => row.status === "due_soon").length,
      ok: oilChangeRows.filter((row) => row.status === "ok").length,
      not_set: oilChangeRows.filter((row) => row.status === "not_set").length,
      review_required: oilChangeRows.filter((row) => row.status === "review_required").length
    }),
    [oilChangeRows]
  );
  const filteredOilChangeRows = useMemo(
    () =>
      oilFilter === "all"
        ? oilChangeRows
        : oilChangeRows.filter((row) => row.status === oilFilter),
    [oilChangeRows, oilFilter]
  );
  const serviceLogsByVehicle = useMemo(() => {
    const map = new Map<string, VehicleServiceLog[]>();
    for (const log of serviceLogs) {
      const key = log.vehicle_reg.trim().toLowerCase();
      if (!key) continue;
      map.set(key, [...(map.get(key) ?? []), log]);
    }
    return map;
  }, [serviceLogs]);

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
    setLoading(true);
    setError(null);
    setLoadError(null);

    const [driverResult, vehicleResult, mileageResult, serviceLogResult] = await Promise.allSettled([
      fetchDrivers(),
      fetchVehicles(),
      fetchWeeklyMileage(),
      fetchVehicleServiceLogs()
    ]);

    console.groupCollapsed("Weekly mileage page data load");
    console.log("drivers", driverResult);
    console.log("vehicles", vehicleResult);
    console.log("weekly_mileage", mileageResult);
    console.log("vehicle_service_logs", serviceLogResult);
    console.groupEnd();

    if (driverResult.status === "fulfilled") {
      setDrivers(driverResult.value);
    } else {
      console.error("Weekly mileage drivers query failed:", driverResult.reason);
      setDrivers([]);
    }

    if (vehicleResult.status === "fulfilled") {
      setVehicles(vehicleResult.value);
    } else {
      console.error("Weekly mileage vehicles query failed:", vehicleResult.reason);
      setVehicles([]);
    }

    if (mileageResult.status === "fulfilled") {
      setEntries(mileageResult.value);
    } else {
      console.error("Weekly mileage records query failed:", mileageResult.reason);
      setEntries([]);
    }

    if (serviceLogResult.status === "fulfilled") {
      setServiceLogs(serviceLogResult.value);
    } else {
      console.error("Weekly mileage service logs query failed:", serviceLogResult.reason);
      setServiceLogs([]);
    }

    const criticalFailures = [
      driverResult.status === "rejected" ? "drivers" : "",
      mileageResult.status === "rejected" ? "weekly mileage records" : ""
    ].filter(Boolean);

    if (criticalFailures.length) {
      setLoadError(`Unable to load ${criticalFailures.join(" and ")}. Check the console for the Supabase error details.`);
    }

    console.log("Weekly mileage page load result", {
      drivers: driverResult.status === "fulfilled" ? driverResult.value.length : "failed",
      vehicles: vehicleResult.status === "fulfilled" ? vehicleResult.value.length : "failed",
      weeklyMileage: mileageResult.status === "fulfilled" ? mileageResult.value.length : "failed",
      serviceLogs: serviceLogResult.status === "fulfilled" ? serviceLogResult.value.length : "failed"
    });

    setLoading(false);
  }, []);

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

  const oilStatusLabel = (status: string) => {
    if (status === "ok") return "OK";
    if (status === "due_soon") return "Due Soon";
    if (status === "urgent") return "Urgent";
    if (status === "overdue") return "Overdue";
    if (status === "review_required") return "Review Required";
    if (status === "no_odometer") return "No odometer data";
    return "Not set";
  };

  const oilStatusIcon = (status: string) =>
    status === "ok" ? "✅" : status === "overdue" || status === "urgent" || status === "due_soon" ? "⚠" : "•";

  const oilStatusClass = (status: string) => {
    if (status === "ok") return "border-emerald-200 bg-emerald-50 text-emerald-700";
    if (status === "due_soon") return "border-amber-200 bg-amber-50 text-amber-800";
    if (status === "urgent") return "border-orange-200 bg-orange-50 text-orange-800";
    if (status === "overdue") return "border-rose-200 bg-rose-50 text-rose-700";
    if (status === "review_required") return "border-sky-200 bg-sky-50 text-sky-800";
    return "border-slate-200 bg-slate-50 text-slate-600";
  };

  const oilCardClass = (status: string) => {
    if (status === "overdue") return "border-rose-400 bg-rose-50/80 shadow-[0_16px_45px_rgba(225,29,72,0.12)]";
    if (status === "urgent") return "border-orange-300 bg-orange-50/80 shadow-[0_14px_38px_rgba(234,88,12,0.10)]";
    if (status === "due_soon") return "border-amber-300 bg-amber-50/70";
    if (status === "ok") return "border-emerald-100 bg-white";
    return "border-slate-200 bg-white";
  };

  const progressBarClass = (status: string) => {
    if (status === "overdue") return "bg-rose-600";
    if (status === "urgent") return "bg-orange-500";
    if (status === "due_soon") return "bg-amber-400";
    if (status === "ok") return "bg-emerald-500";
    return "bg-slate-300";
  };

  const kmRemainingClass = (kmRemaining: number | null) => {
    if (kmRemaining == null) return "text-slate-400";
    if (kmRemaining < 0) return "text-rose-700";
    if (kmRemaining <= 1000) return "text-orange-700";
    return "text-slate-950";
  };

  const getServiceProgress = (row: (typeof oilChangeRows)[number]) => {
    if (
      row.lastOilChangeOdometer == null ||
      row.currentOdometer == null ||
      row.nextOilChangeDueOdometer == null ||
      row.oilChangeIntervalKm == null ||
      row.oilChangeIntervalKm <= 0
    ) {
      return null;
    }

    const usedKm = row.currentOdometer - row.lastOilChangeOdometer;
    return Math.max(0, Math.min(100, Math.round((usedKm / row.oilChangeIntervalKm) * 100)));
  };

  const actionLine = (row: (typeof oilChangeRows)[number]) => {
    if (row.status === "overdue" && row.overdueKm != null) {
      return `⚠ OVERDUE BY ${formatKmValue(row.overdueKm)} KM`;
    }
    if (row.status === "urgent" && row.kmRemaining != null) {
      return `⚠ DUE IN ${formatKmValue(row.kmRemaining)} KM`;
    }
    if (row.status === "due_soon" && row.kmRemaining != null) {
      return `⚠ DUE SOON: ${formatKmValue(row.kmRemaining)} KM`;
    }
    if (row.status === "ok") {
      return "✅ OK";
    }
    return oilStatusLabel(row.status);
  };

  const formatKmValue = (value: number | null) =>
    value != null && Number.isFinite(value) ? formatNumber(value, language) : "-";

  const todayKey = () => new Date().toISOString().slice(0, 10);
  const getLatestServiceLog = (registration: string) =>
    serviceLogsByVehicle.get(registration.trim().toLowerCase())?.[0] ?? null;
  const openServiceModal = (mode: OilActionMode, row: (typeof oilChangeRows)[number]) => {
    const latestLog = getLatestServiceLog(row.registration);
    const defaultInterval =
      mode === "edit"
        ? latestLog?.interval_km ?? row.oilChangeIntervalKm ?? getOilChangeIntervalForVehicleType(row.vehicleType)
        : row.oilChangeIntervalKm ?? latestLog?.interval_km ?? getOilChangeIntervalForVehicleType(row.vehicleType);
    const defaultDate =
      mode === "mark" ? todayKey() : row.lastOilChangeDate ?? latestLog?.service_date ?? todayKey();
    const defaultOdometer =
      mode === "mark"
        ? row.currentOdometer ?? row.lastOilChangeOdometer ?? ""
        : row.lastOilChangeOdometer ?? latestLog?.odometer ?? row.currentOdometer ?? "";

    setError(null);
    setSuccessMessage(null);
    setServiceForm({
      serviceDate: defaultDate,
      serviceOdometer: defaultOdometer === "" ? "" : String(defaultOdometer),
      intervalKm: defaultInterval != null ? String(defaultInterval) : "",
      notes: mode === "mark" ? "Oil changed" : ""
    });
    setServiceModal({
      mode,
      vehicleId: row.vehicleId,
      registration: row.registration,
      vehicleName: row.vehicleName,
      vehicleType: row.vehicleType,
      serviceLogId: mode === "edit" ? latestLog?.id ?? null : null
    });
  };

  const closeServiceModal = () => {
    if (savingService) return;
    setServiceModal(null);
    setServiceForm({ serviceDate: "", serviceOdometer: "", intervalKm: "", notes: "" });
  };

  const handleSaveService = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!serviceModal) return;

    try {
      setSavingService(true);
      setError(null);
      setSuccessMessage(null);
      const result = await saveOilChangeService({
        vehicleId: serviceModal.vehicleId,
        vehicleReg: serviceModal.registration,
        vehicleName: serviceModal.vehicleName,
        vehicleType: serviceModal.vehicleType,
        serviceDate: serviceForm.serviceDate,
        serviceOdometer: Number(serviceForm.serviceOdometer),
        intervalKm: Number(serviceForm.intervalKm),
        notes: serviceForm.notes,
        serviceLogId: serviceModal.serviceLogId,
        updateExistingLog: serviceModal.mode === "edit"
      });

      setVehicles((current) => {
        const withoutSaved = current.filter((vehicle) => String(vehicle.id) !== String(result.vehicle.id));
        return [...withoutSaved, result.vehicle].sort((a, b) =>
          (a.vehicle_reg ?? a.registration ?? "").localeCompare(b.vehicle_reg ?? b.registration ?? "")
        );
      });
      setServiceLogs((current) => {
        const withoutSaved = current.filter((log) => String(log.id) !== String(result.serviceLog.id));
        return [result.serviceLog, ...withoutSaved].sort((a, b) =>
          b.service_date.localeCompare(a.service_date) ||
          b.created_at.localeCompare(a.created_at)
        );
      });
      setSuccessMessage(
        serviceModal.mode === "mark"
          ? "Oil change saved."
          : serviceModal.mode === "edit"
            ? "Service updated."
            : "Oil change baseline saved."
      );
      setServiceModal(null);
      setServiceForm({ serviceDate: "", serviceOdometer: "", intervalKm: "", notes: "" });
    } catch (err) {
      console.error("Oil service save error:", err);
      setError(err instanceof Error && err.message ? err.message : "Failed to save - try again.");
    } finally {
      setSavingService(false);
    }
  };

  const selectedHistoryLogs = historyVehicleReg
    ? serviceLogsByVehicle.get(historyVehicleReg.trim().toLowerCase()) ?? []
    : [];

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

      {loadError ? (
        <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {loadError}
        </div>
      ) : null}

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
        ) : loadError ? (
          <EmptyState title={t.weeklyMileage.errorLoad} description={loadError} />
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

      <section className="surface-card mb-4 p-4 sm:p-5">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 className="section-title">Oil Change Service Management</h3>
            <p className="section-subtitle">Manage baselines, oil changes, and service history using the latest Weekly Mileage odometer.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {(["all", "overdue", "urgent", "due_soon", "review_required", "not_set", "ok"] as OilFilter[]).map((filter) => (
              <button
                key={filter}
                type="button"
                onClick={() => setOilFilter(filter)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                  oilFilter === filter
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                }`}
              >
                {filter === "all" ? "All" : oilStatusLabel(filter)}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <EmptyState title={t.common.loading} description={t.weeklyMileage.loading} />
        ) : loadError ? (
          <EmptyState title={t.weeklyMileage.errorLoad} description={loadError} />
        ) : oilChangeRows.length === 0 ? (
          <EmptyState title="No vehicles to review" description="Add vehicles or weekly mileage records to start service tracking." />
        ) : (
          <>
            <div className="mb-5 grid gap-3 md:grid-cols-3">
              {[
                {
                  key: "overdue",
                  label: "Overdue Vehicles",
                  value: oilSummary.overdue,
                  helper: "Requires immediate service",
                  className: "border-rose-300 bg-rose-50 text-rose-800 hover:border-rose-400"
                },
                {
                  key: "urgent",
                  label: "Urgent Vehicles",
                  value: oilSummary.urgent,
                  helper: "Due within 1,000 KM",
                  className: "border-orange-300 bg-orange-50 text-orange-800 hover:border-orange-400"
                },
                {
                  key: "due_soon",
                  label: "Due Soon Vehicles",
                  value: oilSummary.due_soon,
                  helper: "Due within 3,000 KM",
                  className: "border-amber-300 bg-amber-50 text-amber-800 hover:border-amber-400"
                }
              ].map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setOilFilter(item.key as OilFilter)}
                  className={`rounded-lg border px-4 py-4 text-left transition duration-200 hover:-translate-y-0.5 hover:shadow-lg ${item.className}`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-bold uppercase text-current/70">{item.label}</p>
                      <p className="mt-1 text-sm font-medium text-current/75">{item.helper}</p>
                    </div>
                    <span className="text-xl">⚠</span>
                  </div>
                  <p className="mt-4 text-4xl font-bold tracking-normal text-current">{formatNumber(item.value, language)}</p>
                </button>
              ))}
            </div>

            {filteredOilChangeRows.length === 0 ? (
              <EmptyState title="No vehicles in this status" description="Choose another filter to review service needs." />
            ) : (
              <div className="space-y-4">
                {filteredOilChangeRows.map((row) => {
                  const vehicleLogs = serviceLogsByVehicle.get(row.registration.trim().toLowerCase()) ?? [];
                  const primaryAction = row.status === "not_set" ? "Set Baseline" : "Mark Oil Changed";
                  const progress = getServiceProgress(row);

                  return (
                    <article
                      key={row.registration}
                      className={`rounded-lg border p-4 transition duration-200 hover:-translate-y-0.5 hover:shadow-xl sm:p-5 ${oilCardClass(row.status)}`}
                    >
                      <div className="grid gap-4 xl:grid-cols-[minmax(190px,0.75fr)_minmax(0,1.35fr)_minmax(190px,0.55fr)] xl:items-start">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="text-2xl font-bold tracking-normal text-slate-950">{row.registration}</h4>
                            <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${oilStatusClass(row.status)}`}>
                              {oilStatusIcon(row.status)} {oilStatusLabel(row.status)}
                            </span>
                          </div>
                          <p className="mt-2 text-sm font-medium text-slate-600">
                            {row.driverName || "No driver assigned"} · {row.vehicleTypeLabel}
                          </p>
                          <p className="mt-3 text-base font-bold uppercase text-slate-900">
                            {actionLine(row)}
                          </p>
                          {row.reviewReasons.length ? (
                            <p className="mt-2 text-xs font-semibold text-sky-700">{row.reviewReasons.join("; ")}</p>
                          ) : null}
                        </div>

                        <div className="grid gap-3 sm:grid-cols-3">
                          <div className="rounded-lg border border-white/80 bg-white/70 p-3">
                            <p className="metric-label">Current Odometer</p>
                            <p className="mt-1 text-lg font-bold text-slate-950">{row.currentOdometer == null ? "No data" : formatKmValue(row.currentOdometer)}</p>
                          </div>
                          <div className="rounded-lg border border-white/80 bg-white/70 p-3">
                            <p className="metric-label">Next Service Due</p>
                            <p className="mt-1 text-lg font-bold text-slate-950">{formatKmValue(row.nextOilChangeDueOdometer)}</p>
                          </div>
                          <div className="rounded-lg border border-white/80 bg-white/70 p-3">
                            <p className="metric-label">KM Remaining</p>
                            <p className={`mt-1 text-2xl font-bold tracking-normal ${kmRemainingClass(row.kmRemaining)}`}>
                              {row.kmRemaining == null ? "-" : formatKmValue(row.kmRemaining)}
                            </p>
                          </div>
                        </div>

                        <div className="flex flex-col gap-2 sm:flex-row xl:flex-col">
                          <button type="button" onClick={() => openServiceModal(row.status === "not_set" ? "set" : "mark", row)} className="btn-primary w-full justify-center gap-2 shadow-lg shadow-slate-900/10">
                            {row.status === "not_set" ? <Plus className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                            {primaryAction}
                          </button>
                          <button type="button" onClick={() => openServiceModal(row.status === "not_set" ? "set" : "edit", row)} className="btn-secondary w-full justify-center gap-2">
                            <Pencil className="h-4 w-4" />
                            {row.status === "not_set" ? "Set Baseline" : "Edit"}
                          </button>
                          <button type="button" onClick={() => setHistoryVehicleReg(row.registration)} className="btn-secondary w-full justify-center gap-2">
                            <History className="h-4 w-4" />
                            Service History
                          </button>
                        </div>
                      </div>

                      <div className="mt-4">
                        <div className="mb-2 flex items-center justify-between gap-3 text-xs font-semibold text-slate-500">
                          <span>Oil service usage</span>
                          <span>{progress == null ? "Waiting for baseline" : `${progress}% used`}</span>
                        </div>
                        <div className="h-2.5 overflow-hidden rounded-full bg-white/80 ring-1 ring-slate-200/70">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${progressBarClass(row.status)}`}
                            style={{ width: `${progress ?? 0}%` }}
                          />
                        </div>
                      </div>

                      <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-5">
                        <div>
                          <p className="metric-label">Last Oil Change</p>
                          <p className="mt-1 font-semibold text-slate-900">{row.lastOilChangeDate ? formatDate(row.lastOilChangeDate, language) : "Not set"}</p>
                        </div>
                        <div>
                          <p className="metric-label">Last Odometer</p>
                          <p className="mt-1 font-semibold text-slate-900">{formatKmValue(row.lastOilChangeOdometer)}</p>
                        </div>
                        <div>
                          <p className="metric-label">Interval</p>
                          <p className="mt-1 font-semibold text-slate-900">{formatKmValue(row.oilChangeIntervalKm)} KM</p>
                        </div>
                        <div>
                          <p className="metric-label">Overdue By</p>
                          <p className="mt-1 font-semibold text-rose-700">{row.overdueKm == null ? "-" : formatKmValue(row.overdueKm)}</p>
                        </div>
                        <div>
                          <p className="metric-label">History</p>
                          <p className="mt-1 font-semibold text-slate-900">{vehicleLogs.length ? `${formatNumber(vehicleLogs.length, language)} records` : "No records"}</p>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </>
        )}
      </section>

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
        ) : loadError ? (
          <EmptyState title={t.weeklyMileage.errorLoad} description={loadError} />
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

      {serviceModal ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/45 p-3 sm:items-center">
          <div className="max-h-[92vh] w-full max-w-[620px] overflow-y-auto rounded-lg bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-950">
                  {serviceModal.mode === "mark"
                    ? "Mark Oil Changed"
                    : serviceModal.mode === "edit"
                      ? "Edit Oil Change Baseline"
                      : "Set Oil Change Baseline"}
                </h3>
                <p className="mt-1 text-sm text-slate-500">{serviceModal.registration} | {serviceModal.vehicleName}</p>
              </div>
              <button type="button" onClick={closeServiceModal} className="table-action-secondary" aria-label="Close service form">
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveService} className="p-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="form-field">
                  <label className="form-label form-label-required">Last Oil Change Date</label>
                  <input
                    type="date"
                    required
                    value={serviceForm.serviceDate}
                    onChange={(event) => setServiceForm((current) => ({ ...current, serviceDate: event.target.value }))}
                    className="form-input bg-white"
                  />
                </div>
                <div className="form-field">
                  <label className="form-label form-label-required">Last Oil Change Odometer</label>
                  <input
                    type="number"
                    required
                    min="0"
                    step="1"
                    value={serviceForm.serviceOdometer}
                    onChange={(event) => setServiceForm((current) => ({ ...current, serviceOdometer: event.target.value }))}
                    className="form-input bg-white"
                  />
                </div>
                <div className="form-field">
                  <label className="form-label form-label-required">Interval KM</label>
                  <input
                    type="number"
                    required
                    min="1"
                    step="1"
                    value={serviceForm.intervalKm}
                    onChange={(event) => setServiceForm((current) => ({ ...current, intervalKm: event.target.value }))}
                    className="form-input bg-white"
                  />
                </div>
                <div className="form-field">
                  <label className="form-label">Notes</label>
                  <input
                    value={serviceForm.notes}
                    onChange={(event) => setServiceForm((current) => ({ ...current, notes: event.target.value }))}
                    placeholder="Optional service note"
                    className="form-input bg-white"
                  />
                </div>
              </div>

              {error ? <p className="form-error mt-4">{error}</p> : null}

              <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button type="button" onClick={closeServiceModal} disabled={savingService} className="btn-secondary disabled:opacity-50">
                  Cancel
                </button>
                <button type="submit" disabled={savingService} className="btn-primary disabled:opacity-60">
                  {savingService ? "Saving..." : "Save"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {historyVehicleReg ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/45 p-3 sm:items-center">
          <div className="max-h-[92vh] w-full max-w-[720px] overflow-y-auto rounded-lg bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-950">Service History</h3>
                <p className="mt-1 text-sm text-slate-500">{historyVehicleReg}</p>
              </div>
              <button type="button" onClick={() => setHistoryVehicleReg(null)} className="table-action-secondary" aria-label="Close service history">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5">
              {selectedHistoryLogs.length === 0 ? (
                <EmptyState title="No service history" description="Oil change records will appear here after service is saved." />
              ) : (
                <div className="space-y-3">
                  {selectedHistoryLogs.map((log) => (
                    <div key={log.id} className="subtle-panel p-4">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="font-semibold text-slate-950">{formatDate(log.service_date, language)}</p>
                          <p className="mt-1 text-sm text-slate-500">{log.notes || "Oil change"}</p>
                        </div>
                        <span className="badge-muted">{log.service_type === "oil_change" ? "Oil Change" : log.service_type}</span>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <p className="metric-label">Service Odometer</p>
                          <p className="mt-1 font-semibold text-slate-900">{formatKmValue(log.odometer)}</p>
                        </div>
                        <div>
                          <p className="metric-label">Interval KM</p>
                          <p className="mt-1 font-semibold text-slate-900">{formatKmValue(log.interval_km)}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
