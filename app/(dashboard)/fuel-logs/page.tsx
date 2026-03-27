"use client";

import { Clock3, Download, Droplets, ReceiptText, TrendingUp, Wallet } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/empty-state";
import { Header } from "@/components/header";
import { StatCard } from "@/components/stat-card";
import {
  FUEL_TYPE_KEYS,
  getFuelTypeLabel,
  getPaymentMethodLabel,
  normalizeFuelTypeKey,
  normalizePaymentMethodKey,
  PAYMENT_METHOD_KEYS
} from "@/lib/localized-values";
import { fetchDrivers, fetchFuelLogs, saveFuelLog } from "@/lib/data";
import { exportToXlsx } from "@/lib/export";
import { useLanguage } from "@/lib/language-provider";
import { formatCurrency, formatDate, formatNumber, today } from "@/lib/utils";
import type { Driver, FuelLogWithDriver } from "@/types/database";

const initialForm = {
  id: "",
  date: today(),
  driver_id: "",
  vehicle_reg: "",
  mileage: "",
  litres: "",
  total_cost: "",
  price_per_litre: "",
  location: "",
  fuel_type: "",
  payment_method: "",
  notes: ""
};

const ENTRIES_PER_PAGE = 25;

function getLogTimestamp(log: FuelLogWithDriver) {
  return log.created_at || log.date;
}

function formatTimeLabel(value: string | null | undefined, language: "en" | "th") {
  if (!value) {
    return "-";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "-";
  }

  return new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-GB", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(parsed);
}

export default function FuelLogsPage() {
  const { language, t } = useLanguage();
  const fuelTypeOptions = FUEL_TYPE_KEYS.map((value) => ({
    value,
    label: t.fuel.type[value]
  }));
  const paymentMethodOptions = PAYMENT_METHOD_KEYS.map((value) => ({
    value,
    label: t.payment.method[value]
  }));
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [fuelLogs, setFuelLogs] = useState<FuelLogWithDriver[]>([]);
  const [form, setForm] = useState(initialForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [submitMode, setSubmitMode] = useState<"save" | "addAnother">("save");
  const [currentPage, setCurrentPage] = useState(1);

  const isEditing = Boolean(form.id);
  const todayValue = today();
  const labels = {
    fuelSpendToday: t.fuelLogs.fuelSpendToday,
    fuelSpendTodayHelper: t.fuelLogs.fuelSpendTodayHelper,
    litresToday: t.fuelLogs.litresToday,
    litresTodayHelper: t.fuelLogs.litresTodayHelper,
    entriesToday: t.fuelLogs.entriesToday,
    entriesTodayHelper: t.fuelLogs.entriesTodayHelper,
    averagePricePerLitreToday: t.fuelLogs.averagePricePerLitreToday,
    averagePricePerLitreTodayHelper: t.fuelLogs.averagePricePerLitreTodayHelper,
    todaysFuelActivity: t.fuelLogs.todaysFuelActivity,
    todaysFuelActivityDescription: t.fuelLogs.todaysFuelActivityDescription,
    todaysSnapshotHelper: t.fuelLogs.todaysSnapshotHelper,
    topSpenderToday: t.fuelLogs.topSpenderToday,
    noTodayFuelTitle: t.fuelLogs.noTodayFuelTitle,
    noTodayFuelDescription: t.fuelLogs.noTodayFuelDescription,
    spendByDayTitle: t.fuelLogs.spendByDayTitle,
    spendByDayDescription: t.fuelLogs.spendByDayDescription,
    time: t.fuelLogs.time,
    topDriversToday: t.fuelLogs.topDriversToday
  };

  const selectedDriver = useMemo(
    () => drivers.find((driver) => String(driver.id) === String(form.driver_id)),
    [drivers, form.driver_id]
  );

  const sortedFuelLogs = useMemo(() => {
    return [...fuelLogs].sort((a, b) => {
      const dateDiff = new Date(b.date).getTime() - new Date(a.date).getTime();
      if (dateDiff !== 0) return dateDiff;

      const timestampDiff =
        new Date(getLogTimestamp(b)).getTime() - new Date(getLogTimestamp(a)).getTime();
      if (timestampDiff !== 0) return timestampDiff;

      return String(b.id).localeCompare(String(a.id));
    });
  }, [fuelLogs]);

  const todaysLogs = useMemo(
    () => sortedFuelLogs.filter((log) => log.date === todayValue),
    [sortedFuelLogs, todayValue]
  );
  const todaysActivityFeed = useMemo(() => todaysLogs.slice(0, 6), [todaysLogs]);

  const fuelSpendToday = todaysLogs.reduce((sum, log) => sum + Number(log.total_cost || 0), 0);
  const litresToday = todaysLogs.reduce((sum, log) => sum + Number(log.litres || 0), 0);
  const entriesToday = todaysLogs.length;
  const averagePricePerLitreToday = litresToday > 0 ? fuelSpendToday / litresToday : 0;

  const topSpenderToday = useMemo(() => {
    const totals = new Map<string, number>();

    todaysLogs.forEach((log) => {
      const key = log.driver || "-";
      totals.set(key, (totals.get(key) || 0) + Number(log.total_cost || 0));
    });

    let topName = "";
    let topValue = 0;

    totals.forEach((value, key) => {
      if (value > topValue) {
        topName = key;
        topValue = value;
      }
    });

    return { name: topName, amount: topValue };
  }, [todaysLogs]);

  const topDriversToday = useMemo(() => {
    const totals = new Map<string, { driver: string; amount: number; litres: number }>();

    todaysLogs.forEach((log) => {
      const key = log.driver || "-";
      const current = totals.get(key) || { driver: key, amount: 0, litres: 0 };
      current.amount += Number(log.total_cost || 0);
      current.litres += Number(log.litres || 0);
      totals.set(key, current);
    });

    return Array.from(totals.values())
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);
  }, [todaysLogs]);

  const last7DayRows = useMemo(() => {
    const rows = Array.from({ length: 7 }, (_, index) => {
      const date = new Date();
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() - index);
      const dateKey = date.toISOString().slice(0, 10);

      const totals = sortedFuelLogs
        .filter((log) => log.date === dateKey)
        .reduce(
          (accumulator, log) => {
            accumulator.spend += Number(log.total_cost || 0);
            accumulator.litres += Number(log.litres || 0);
            accumulator.entries += 1;
            return accumulator;
          },
          { spend: 0, litres: 0, entries: 0 }
        );

      return {
        date: dateKey,
        spend: totals.spend,
        litres: totals.litres,
        entries: totals.entries
      };
    });

    return rows;
  }, [sortedFuelLogs]);

  const totalPages = Math.max(1, Math.ceil(sortedFuelLogs.length / ENTRIES_PER_PAGE));

  const paginatedFuelLogs = useMemo(() => {
    const startIndex = (currentPage - 1) * ENTRIES_PER_PAGE;
    return sortedFuelLogs.slice(startIndex, startIndex + ENTRIES_PER_PAGE);
  }, [sortedFuelLogs, currentPage]);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const [driverRows, fuelRows] = await Promise.all([fetchDrivers(), fetchFuelLogs()]);
      setDrivers(driverRows);
      setFuelLogs(fuelRows);
    } catch (err) {
      setError(t.fuelLogs.unableToLoadFuelData);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [t.fuelLogs.unableToLoadFuelData]);

  useEffect(() => {
    if (!selectedDriver) {
      return;
    }

    setForm((current) => ({
      ...current,
      vehicle_reg: selectedDriver.vehicle_reg
    }));
    setSuccessMessage(null);
  }, [selectedDriver]);

  useEffect(() => {
    const litres = Number(form.litres);
    const totalCost = Number(form.total_cost);

    if (Number.isFinite(litres) && Number.isFinite(totalCost) && litres > 0 && totalCost >= 0) {
      setForm((current) => ({
        ...current,
        price_per_litre: (totalCost / litres).toFixed(2)
      }));
      return;
    }

    if (form.price_per_litre !== "") {
      setForm((current) => ({
        ...current,
        price_per_litre: ""
      }));
    }
  }, [form.litres, form.total_cost]);

  useEffect(() => {
    setCurrentPage(1);
  }, [fuelLogs.length]);

  const resetForm = () => {
    setForm(initialForm);
    setError(null);
    setSuccessMessage(null);
    setSubmitMode("save");
  };

  const getNextEntryForm = (mode: "save" | "addAnother") => {
    if (mode === "addAnother") {
      return {
        ...initialForm,
        date: form.date,
        driver_id: form.driver_id,
        vehicle_reg: form.vehicle_reg,
        fuel_type: form.fuel_type,
        payment_method: form.payment_method
      };
    }

    return {
      ...initialForm,
      date: form.date
    };
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const numericMileage = form.mileage ? Number(form.mileage) : null;
      const previousVehicleLog = [...fuelLogs]
        .filter(
          (log) =>
            log.vehicle_reg === form.vehicle_reg &&
            String(log.id) !== String(form.id) &&
            log.mileage != null &&
            log.date <= form.date
        )
        .sort((a, b) => {
          const dateDiff = new Date(b.date).getTime() - new Date(a.date).getTime();
          if (dateDiff !== 0) {
            return dateDiff;
          }
          return String(b.id).localeCompare(String(a.id));
        })[0];

      if (
        numericMileage != null &&
        previousVehicleLog?.mileage != null &&
        numericMileage < Number(previousVehicleLog.mileage)
      ) {
        throw new Error(t.fuelLogs.mileageValidationError);
      }

      await saveFuelLog({
        id: form.id || undefined,
        date: form.date,
        driver_id: form.driver_id,
        driver: selectedDriver?.name ?? form.driver_id,
        vehicle_reg: form.vehicle_reg,
        mileage: numericMileage,
        litres: Number(form.litres),
        total_cost: Number(form.total_cost),
        price_per_litre: form.price_per_litre ? Number(form.price_per_litre) : null,
        location: form.location,
        fuel_type: form.fuel_type || null,
        payment_method: form.payment_method || null,
        notes: form.notes || null
      });

      setForm(getNextEntryForm(submitMode));
      setSubmitMode("save");
      setSuccessMessage(
        isEditing
          ? t.fuelLogs.updateSuccessMessage
          : submitMode === "addAnother"
            ? t.fuelLogs.saveAndAddAnotherSuccessMessage
            : t.fuelLogs.saveSuccessMessage
      );
      await loadData();
    } catch (err) {
      setError(t.fuelLogs.unableToSaveFuelLog);
    } finally {
      setSaving(false);
    }
  };

  const exportFuelLogs = () => {
    exportToXlsx(
      sortedFuelLogs.map((log) => ({
        [t.fuelLogs.date]: formatDate(log.date, language),
        [t.fuelLogs.driver]: log.driver,
        [t.fuelLogs.vehicleReg]: log.vehicle_reg,
        [t.fuelLogs.mileage]: log.mileage ?? "",
        [t.fuelLogs.litres]: log.litres,
        [t.fuelLogs.totalCost]: log.total_cost,
        [t.fuelLogs.pricePerLitre]: log.price_per_litre ?? "",
        [t.fuelLogs.location]: log.location,
        [t.fuelLogs.fuelType]: getFuelTypeLabel(t, log.fuel_type),
        [t.fuelLogs.paymentMethod]: getPaymentMethodLabel(t, log.payment_method),
        [t.fuelLogs.notes]: log.notes ?? ""
      })),
      "fuel-logs-report",
      "FuelLogs"
    );
  };

  return (
    <>
      <div className="mb-6">
        <Header title={t.fuelLogs.title} description={t.fuelLogs.description} />
      </div>

      <section className="mb-4.5 grid grid-cols-1 gap-4.5 sm:grid-cols-2 sm:gap-4.5 xl:grid-cols-4">
        <StatCard
          label={labels.fuelSpendToday}
          value={formatCurrency(fuelSpendToday, language)}
          helper={labels.fuelSpendTodayHelper}
          icon={<Wallet className="h-5 w-5" />}
        />
        <StatCard
          label={labels.litresToday}
          value={formatNumber(litresToday, language, 2)}
          helper={labels.litresTodayHelper}
          icon={<Droplets className="h-5 w-5" />}
        />
        <StatCard
          label={labels.entriesToday}
          value={formatNumber(entriesToday, language)}
          helper={labels.entriesTodayHelper}
          icon={<ReceiptText className="h-5 w-5" />}
        />
        <StatCard
          label={labels.averagePricePerLitreToday}
          value={litresToday > 0 ? formatCurrency(averagePricePerLitreToday, language) : "-"}
          helper={
            litresToday > 0
              ? labels.averagePricePerLitreTodayHelper
              : labels.noTodayFuelDescription
          }
          icon={<TrendingUp className="h-5 w-5" />}
        />
      </section>

      <section className="surface-card mb-4.5 p-2.5 sm:p-3">
        <div className="mb-2.5">
          <h3 className="section-title">{labels.todaysFuelActivity}</h3>
          <p className="section-subtitle">{labels.todaysFuelActivityDescription}</p>
        </div>

        {loading ? (
          <p className="text-sm text-slate-500">{t.fuelLogs.loadingFuelLogs}</p>
        ) : todaysLogs.length === 0 ? (
          <EmptyState
            title={labels.noTodayFuelTitle}
            description={labels.noTodayFuelDescription}
          />
        ) : (
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start">
            <div className="space-y-1.5">
              {todaysActivityFeed.map((log) => (
                <div
                  key={log.id}
                  className="rounded-xl border border-slate-100/80 bg-white/70 px-2.5 py-2 transition hover:bg-slate-50/70"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                      <span className="truncate font-medium text-slate-800">{log.driver || "-"}</span>
                      <span className="text-slate-300">-</span>
                      <span className="font-semibold text-slate-950">
                        {formatCurrency(Number(log.total_cost || 0), language)}
                      </span>
                      <span className="text-slate-400">
                        ({formatNumber(Number(log.litres || 0), language, 2)}L)
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs font-medium text-slate-400">
                      {formatDate(log.date, language)}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            <div className="subtle-panel p-3">
              <div className="mb-2.5">
                <p className="text-sm font-semibold text-slate-900">{labels.topDriversToday}</p>
                <p className="mt-1 text-xs text-slate-500">{formatDate(todayValue, language)}</p>
              </div>

              <div className="space-y-2">
                {topDriversToday.map((driver) => (
                  <div
                    key={driver.driver}
                    className="flex items-start justify-between gap-3 border-b border-slate-100/70 pb-2 last:border-b-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-800">{driver.driver}</p>
                      <p className="mt-0.5 text-xs text-slate-400">
                        {formatNumber(driver.litres, language, 2)}L
                      </p>
                    </div>
                    <p className="whitespace-nowrap text-sm font-semibold text-slate-950">
                      {formatCurrency(driver.amount, language)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>

      <section className="surface-card mb-4.5 p-3.5 sm:p-4">
        <div className="mb-3.5">
          <h3 className="text-base font-semibold text-slate-900">{labels.spendByDayTitle}</h3>
          <p className="mt-1 text-sm text-slate-500">{labels.spendByDayDescription}</p>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {last7DayRows.map((row) => (
            <div key={row.date} className="subtle-panel p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-slate-900">{formatDate(row.date, language)}</p>
                <Clock3 className="h-4 w-4 text-slate-400" />
              </div>
              <p className="mt-2.5 text-base font-semibold text-slate-950">
                {formatCurrency(row.spend, language)}
              </p>
              <div className="mt-2 flex items-center justify-between gap-3 text-sm text-slate-500">
                <span>
                  {formatNumber(row.litres, language, 2)} {t.fuelLogs.litres}
                </span>
                <span>
                  {formatNumber(row.entries, language)} {t.common.entries}
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-5">
        <form
          onSubmit={handleSubmit}
          className="surface-card-soft w-full p-3 sm:p-3.5 lg:p-4"
        >
          <div className="mb-5">
            <h3 className="section-title">
              {isEditing ? t.fuelLogs.editFuelEntry : t.fuelLogs.addFuelEntry}
            </h3>
            <p className="section-subtitle">{t.fuelLogs.description}</p>
          </div>

          <div className="grid gap-2.5 md:grid-cols-2 md:gap-x-5 lg:gap-x-6">
            <div className="space-y-2.5">
              <div className="form-field">
                <label className="form-label">
                  {t.fuelLogs.logDate}
                </label>
                <input
                  type="date"
                  required
                  value={form.date}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, date: event.target.value }))
                  }
                  className="form-input w-full bg-white"
                />
              </div>

              <div className="form-field">
                <label className="form-label">
                  {t.fuelLogs.driver}
                </label>
                <select
                  required
                  value={form.driver_id}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, driver_id: event.target.value }))
                  }
                  className="form-input w-full bg-white"
                >
                  <option value="">{t.fuelLogs.selectDriver}</option>
                  {drivers.map((driver) => (
                    <option key={driver.id} value={String(driver.id)}>
                      {driver.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-field">
                <label className="form-label">
                  {t.fuelLogs.vehicleReg}
                </label>
                <input
                  required
                  value={form.vehicle_reg}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, vehicle_reg: event.target.value }))
                  }
                  placeholder={t.fuelLogs.vehiclePlaceholder}
                  className="form-input w-full bg-white"
                />
                <p className="mt-1.5 text-xs leading-5 text-slate-500">{t.fuelLogs.vehicleHelper}</p>
              </div>

              <div className="form-field">
                <label className="form-label">
                  {t.fuelLogs.litres}
                </label>
                <input
                  type="number"
                  required
                  min="0"
                  step="0.01"
                  value={form.litres}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, litres: event.target.value }))
                  }
                  className="form-input w-full bg-white"
                />
              </div>

              <div className="form-field">
                <label className="form-label">
                  {t.fuelLogs.totalCost}
                </label>
                <input
                  type="number"
                  required
                  min="0"
                  step="0.01"
                  value={form.total_cost}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, total_cost: event.target.value }))
                  }
                  className="form-input w-full bg-white"
                />
              </div>
            </div>

            <div className="space-y-2.5">
              <div className="form-field">
                <label className="form-label">
                  {t.fuelLogs.pricePerLitre}
                </label>
                <input
                  type="text"
                  readOnly
                  value={form.price_per_litre}
                  placeholder={t.fuelLogs.pricePerLitrePlaceholder}
                  className="form-input-readonly w-full"
                />
                <p className="mt-1.5 text-xs leading-5 text-slate-500">
                  {t.fuelLogs.pricePerLitreHelper}
                </p>
              </div>

              <div className="form-field">
                <label className="form-label">
                  {t.fuelLogs.mileage}
                </label>
                <input
                  type="number"
                  min="0"
                  value={form.mileage}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, mileage: event.target.value }))
                  }
                  placeholder={t.fuelLogs.currentMileage}
                  className="form-input w-full bg-white"
                />
              </div>

              <div className="form-field">
                <label className="form-label">
                  {t.fuelLogs.fuelType}
                </label>
                <select
                  value={form.fuel_type}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, fuel_type: event.target.value }))
                  }
                  className="form-input w-full bg-white"
                >
                  <option value="">{t.fuelLogs.fuelTypeSelect}</option>
                  {fuelTypeOptions.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-field">
                <label className="form-label">
                  {t.fuelLogs.paymentMethod}
                </label>
                <select
                  value={form.payment_method}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, payment_method: event.target.value }))
                  }
                  className="form-input w-full bg-white"
                >
                  <option value="">{t.fuelLogs.paymentMethodSelect}</option>
                  {paymentMethodOptions.map((method) => (
                    <option key={method.value} value={method.value}>
                      {method.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-field">
                <label className="form-label">
                  {t.fuelLogs.fuelStationLocation}
                </label>
                <input
                  required
                  value={form.location}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, location: event.target.value }))
                  }
                  placeholder={t.fuelLogs.stationNameOrLocation}
                  className="form-input w-full bg-white"
                />
              </div>
            </div>

            <div className="form-field pt-1 md:col-span-2 md:pt-2">
              <label className="form-label">
                {t.fuelLogs.notes}
              </label>
              <textarea
                rows={3}
                value={form.notes}
                onChange={(event) =>
                  setForm((current) => ({ ...current, notes: event.target.value }))
                }
                placeholder={t.fuelLogs.optionalNotes}
                className="form-textarea w-full bg-white"
              />
            </div>
          </div>

          {error ? <p className="mt-4 text-sm text-rose-600">{error}</p> : null}
          {successMessage ? <p className="mt-4 text-sm text-emerald-600">{successMessage}</p> : null}

          <div className="mt-4.5 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            {!isEditing ? (
              <button
                type="submit"
                disabled={saving}
                onClick={() => setSubmitMode("addAnother")}
                className="btn-secondary w-full sm:w-auto disabled:opacity-70"
              >
                {saving && submitMode === "addAnother"
                  ? t.common.saving
                  : t.fuelLogs.saveAndAddAnother}
              </button>
            ) : null}

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <button
                type="submit"
                disabled={saving}
                onClick={() => setSubmitMode("save")}
                className="btn-primary min-w-[180px] flex-1 sm:flex-none disabled:opacity-70"
              >
                {saving && submitMode === "save"
                  ? t.common.saving
                  : isEditing
                    ? t.fuelLogs.updateFuelEntry
                    : t.fuelLogs.saveFuelEntry}
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
        </form>
      </section>

      <section className="mt-5">
        <section className="surface-card min-w-0 p-3 sm:p-3.5">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="section-title">{t.fuelLogs.fuelEntries}</h3>
              <p className="section-subtitle">{t.fuelLogs.tableDescription}</p>
            </div>

            <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center">
              <span className="badge-muted">
                {fuelLogs.length} {t.common.entries}
              </span>

              <button
                type="button"
                onClick={exportFuelLogs}
                disabled={!fuelLogs.length}
                className="btn-secondary w-full gap-2 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
              >
                <Download className="h-4 w-4" />
                {t.common.export}
              </button>
            </div>
          </div>

          {loading ? (
            <p className="text-sm text-slate-500">{t.fuelLogs.loadingFuelLogs}</p>
          ) : fuelLogs.length === 0 ? (
            <EmptyState
              title={t.fuelLogs.noFuelEntriesYet}
              description={t.fuelLogs.fuelEntriesEmptyDescription}
            />
          ) : (
            <>
              <div className="space-y-3 md:hidden">
                {paginatedFuelLogs.map((log) => (
                  <div key={log.id} className="subtle-panel p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{log.driver}</p>
                        <p className="mt-1 text-sm text-slate-500">{log.vehicle_reg}</p>
                      </div>
                      <p className="text-sm font-medium text-slate-900">{formatDate(log.date, language)}</p>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-3">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                          {t.fuelLogs.totalCost}
                        </p>
                        <p className="mt-1 text-sm font-semibold text-slate-950">
                          {formatCurrency(Number(log.total_cost || 0), language)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                          {t.fuelLogs.litres}
                        </p>
                        <p className="mt-1 text-sm font-medium text-slate-900">
                          {formatNumber(Number(log.litres || 0), language, 2)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                          {t.fuelLogs.mileage}
                        </p>
                        <p className="mt-1 text-sm font-medium text-slate-900">{log.mileage ?? "-"}</p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                          {t.fuelLogs.pricePerLitre}
                        </p>
                        <p className="mt-1 text-sm font-medium text-slate-900">
                          {log.price_per_litre != null
                            ? formatCurrency(Number(log.price_per_litre), language)
                            : "-"}
                        </p>
                      </div>
                    </div>

                    <p className="mt-3 text-sm leading-6 text-slate-500">{log.location || "-"}</p>
                    <button
                      type="button"
                      onClick={() =>
                        setForm({
                          id: String(log.id),
                          date: log.date,
                          driver_id: String(log.driver_id),
                          vehicle_reg: log.vehicle_reg,
                          mileage: log.mileage != null ? String(log.mileage) : "",
                          litres: log.litres != null ? String(log.litres) : "",
                          total_cost: log.total_cost != null ? String(log.total_cost) : "",
                          price_per_litre:
                            log.price_per_litre != null ? String(log.price_per_litre) : "",
                          location: log.location || "",
                          fuel_type: normalizeFuelTypeKey(log.fuel_type) ?? "",
                          payment_method: normalizePaymentMethodKey(log.payment_method) ?? "",
                          notes: log.notes || ""
                        })
                      }
                      className="btn-secondary mt-4 w-full"
                    >
                      {t.common.edit}
                    </button>
                  </div>
                ))}
              </div>

              <div className="hidden -mx-5 overflow-x-auto px-5 md:block md:mx-0 md:px-0">
                <div className="table-shell rounded-2xl">
                  <table className="w-full min-w-[1030px] text-sm">
                    <thead>
                      <tr className="bg-slate-50/70 text-slate-600">
                        <th className="whitespace-nowrap px-3 py-1.5 text-left text-[11px] font-semibold uppercase tracking-[0.14em]">
                          {t.fuelLogs.date}
                        </th>
                        <th className="whitespace-nowrap px-3 py-1.5 text-left text-[11px] font-semibold uppercase tracking-[0.14em]">
                          {t.fuelLogs.driver}
                        </th>
                        <th className="whitespace-nowrap px-3 py-1.5 text-left text-[11px] font-semibold uppercase tracking-[0.14em]">
                          {t.fuelLogs.vehicleReg}
                        </th>
                        <th className="whitespace-nowrap px-3 py-1.5 text-right text-[11px] font-semibold uppercase tracking-[0.14em]">
                          {t.fuelLogs.litres}
                        </th>
                        <th className="whitespace-nowrap px-3 py-1.5 text-right text-[11px] font-semibold uppercase tracking-[0.14em]">
                          {t.fuelLogs.totalCost}
                        </th>
                        <th className="whitespace-nowrap px-3 py-1.5 text-right text-[11px] font-semibold uppercase tracking-[0.14em]">
                          {t.fuelLogs.pricePerLitre}
                        </th>
                        <th className="whitespace-nowrap px-3 py-1.5 text-right text-[11px] font-semibold uppercase tracking-[0.14em]">
                          {t.fuelLogs.mileage}
                        </th>
                        <th className="whitespace-nowrap px-3 py-1.5 text-left text-[11px] font-semibold uppercase tracking-[0.14em]">
                          {t.fuelLogs.location}
                        </th>
                        <th className="whitespace-nowrap px-3 py-1.5 text-left text-[11px] font-semibold uppercase tracking-[0.14em]">
                          {t.fuelLogs.fuelType}
                        </th>
                        <th className="whitespace-nowrap px-3 py-1.5 text-left text-[11px] font-semibold uppercase tracking-[0.14em]">
                          {t.fuelLogs.paymentMethod}
                        </th>
                        <th className="whitespace-nowrap px-3 py-1.5 text-left text-[11px] font-semibold uppercase tracking-[0.14em]">
                          {t.common.action}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedFuelLogs.map((log) => (
                        <tr
                          key={log.id}
                          className="border-b border-slate-100/60 transition last:border-none hover:bg-slate-50/55"
                        >
                          <td className="whitespace-nowrap px-3 py-2 text-[13px] text-slate-700">
                            {formatDate(log.date, language)}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-[13px] font-medium text-slate-900">
                            {log.driver}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-[13px] text-slate-700">
                            {log.vehicle_reg}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-right text-[13px] font-medium text-slate-800">
                            {formatNumber(Number(log.litres || 0), language, 2)}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-right text-[13px] font-semibold text-slate-950">
                            {formatCurrency(Number(log.total_cost || 0), language)}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-right text-[13px] font-medium text-slate-800">
                            {log.price_per_litre != null
                              ? formatCurrency(Number(log.price_per_litre), language)
                              : "-"}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-right text-[13px] font-medium text-slate-800">
                            {log.mileage ?? "-"}
                          </td>
                          <td className="min-w-[120px] px-3 py-2 text-[13px] text-slate-700">
                            {log.location || "-"}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-[13px] text-slate-700">
                            {getFuelTypeLabel(t, log.fuel_type)}
                          </td>
                          <td className="min-w-[130px] px-3 py-2 text-[13px] text-slate-700">
                            {getPaymentMethodLabel(t, log.payment_method)}
                          </td>
                          <td className="px-3 py-2">
                            <button
                              type="button"
                              onClick={() =>
                                setForm({
                                  id: String(log.id),
                                  date: log.date,
                                  driver_id: String(log.driver_id),
                                  vehicle_reg: log.vehicle_reg,
                                  mileage: log.mileage != null ? String(log.mileage) : "",
                                  litres: log.litres != null ? String(log.litres) : "",
                                  total_cost: log.total_cost != null ? String(log.total_cost) : "",
                                  price_per_litre:
                                    log.price_per_litre != null ? String(log.price_per_litre) : "",
                                  location: log.location || "",
                                  fuel_type: normalizeFuelTypeKey(log.fuel_type) ?? "",
                                  payment_method: normalizePaymentMethodKey(log.payment_method) ?? "",
                                  notes: log.notes || ""
                                })
                              }
                              className="btn-secondary rounded-lg px-2.5 py-1.5 text-xs"
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

              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm leading-6 text-slate-500">
                  {t.common.showingEntries} {(currentPage - 1) * ENTRIES_PER_PAGE + 1} -{" "}
                  {Math.min(currentPage * ENTRIES_PER_PAGE, sortedFuelLogs.length)} {t.common.of}{" "}
                  {sortedFuelLogs.length}
                </p>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                    disabled={currentPage === 1}
                    className="btn-secondary disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {t.common.previous}
                  </button>

                  <span className="text-sm font-medium text-slate-700">
                    {t.common.page} {currentPage} {t.common.of} {totalPages}
                  </span>

                  <button
                    type="button"
                    onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                    disabled={currentPage === totalPages}
                    className="btn-secondary disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {t.common.next}
                  </button>
                </div>
              </div>
            </>
          )}
        </section>
      </section>
    </>
  );
}
