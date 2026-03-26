"use client";

import { Download } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/empty-state";
import { Header } from "@/components/header";
import { fetchDrivers, fetchFuelLogs, saveFuelLog } from "@/lib/data";
import { exportToXlsx } from "@/lib/export";
import { useLanguage } from "@/lib/language-provider";
import { formatCurrency, formatDate, today } from "@/lib/utils";
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

export default function FuelLogsPage() {
  const { language, t } = useLanguage();
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

  const selectedDriver = useMemo(
    () => drivers.find((driver) => String(driver.id) === String(form.driver_id)),
    [drivers, form.driver_id]
  );

  const sortedFuelLogs = useMemo(() => {
    return [...fuelLogs].sort((a, b) => {
      const dateDiff = new Date(b.date).getTime() - new Date(a.date).getTime();
      if (dateDiff !== 0) return dateDiff;
      return String(b.id).localeCompare(String(a.id));
    });
  }, [fuelLogs]);

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
      setError(err instanceof Error ? err.message : t.fuelLogs.unableToLoadFuelData);
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
      setError(err instanceof Error ? err.message : t.fuelLogs.unableToSaveFuelLog);
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
        [t.fuelLogs.fuelType]: log.fuel_type ?? "",
        [t.fuelLogs.paymentMethod]: log.payment_method ?? "",
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

      <section className="grid gap-6 xl:grid-cols-[400px_minmax(0,1fr)]">
        <form
          onSubmit={handleSubmit}
          className="rounded-3xl border border-slate-200 bg-white p-5 shadow-md sm:p-6"
        >
          <div className="mb-5">
            <h3 className="text-lg font-semibold text-slate-900">
              {isEditing ? t.fuelLogs.editFuelEntry : t.fuelLogs.addFuelEntry}
            </h3>
            <p className="mt-1 text-sm text-slate-500">{t.fuelLogs.description}</p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                {t.fuelLogs.logDate}
              </label>
              <input
                type="date"
                required
                value={form.date}
                onChange={(event) =>
                  setForm((current) => ({ ...current, date: event.target.value }))
                }
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-black"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                {t.fuelLogs.driver}
              </label>
              <select
                required
                value={form.driver_id}
                onChange={(event) =>
                  setForm((current) => ({ ...current, driver_id: event.target.value }))
                }
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-black"
              >
                <option value="">{t.fuelLogs.selectDriver}</option>
                {drivers.map((driver) => (
                  <option key={driver.id} value={String(driver.id)}>
                    {driver.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                {t.fuelLogs.vehicleReg}
              </label>
              <input
                required
                value={form.vehicle_reg}
                onChange={(event) =>
                  setForm((current) => ({ ...current, vehicle_reg: event.target.value }))
                }
                placeholder={t.fuelLogs.vehiclePlaceholder}
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-black"
              />
              <p className="mt-2 text-xs leading-5 text-slate-500">{t.fuelLogs.vehicleHelper}</p>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
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
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-black"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
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
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-black"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                {t.fuelLogs.pricePerLitre}
              </label>
              <input
                type="text"
                readOnly
                value={form.price_per_litre}
                placeholder={t.fuelLogs.pricePerLitrePlaceholder}
                className="w-full rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-600 focus:outline-none"
              />
              <p className="mt-2 text-xs leading-5 text-slate-500">
                {t.fuelLogs.pricePerLitreHelper}
              </p>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
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
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-black"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                {t.fuelLogs.fuelType}
              </label>
              <input
                value={form.fuel_type}
                onChange={(event) =>
                  setForm((current) => ({ ...current, fuel_type: event.target.value }))
                }
                placeholder={t.fuelLogs.fuelTypePlaceholder}
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-black"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                {t.fuelLogs.paymentMethod}
              </label>
              <input
                value={form.payment_method}
                onChange={(event) =>
                  setForm((current) => ({ ...current, payment_method: event.target.value }))
                }
                placeholder={t.fuelLogs.paymentMethodPlaceholder}
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-black"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                {t.fuelLogs.fuelStationLocation}
              </label>
              <input
                required
                value={form.location}
                onChange={(event) =>
                  setForm((current) => ({ ...current, location: event.target.value }))
                }
                placeholder={t.fuelLogs.stationNameOrLocation}
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-black"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                {t.fuelLogs.notes}
              </label>
              <textarea
                rows={4}
                value={form.notes}
                onChange={(event) =>
                  setForm((current) => ({ ...current, notes: event.target.value }))
                }
                placeholder={t.fuelLogs.optionalNotes}
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-black"
              />
            </div>
          </div>

          {error ? <p className="mt-4 text-sm text-rose-600">{error}</p> : null}
          {successMessage ? <p className="mt-4 text-sm text-emerald-600">{successMessage}</p> : null}

          <div className="mt-6 flex flex-col gap-3">
            {!isEditing ? (
              <button
                type="submit"
                disabled={saving}
                onClick={() => setSubmitMode("addAnother")}
                className="w-full rounded-xl bg-black px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-70"
              >
                {saving && submitMode === "addAnother"
                  ? t.common.saving
                  : t.fuelLogs.saveAndAddAnother}
              </button>
            ) : null}

            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                type="submit"
                disabled={saving}
                onClick={() => setSubmitMode("save")}
                className="flex-1 rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-70"
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
                  className="w-full rounded-xl border border-slate-300 px-5 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 sm:w-auto"
                >
                  {t.common.cancel}
                </button>
              ) : null}
            </div>
          </div>
        </form>

        <section className="min-w-0 rounded-3xl border border-slate-200 bg-white p-5 shadow-md sm:p-6">
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">{t.fuelLogs.fuelEntries}</h3>
              <p className="mt-1 text-sm text-slate-500">{t.fuelLogs.tableDescription}</p>
            </div>

            <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center">
              <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-600">
                {fuelLogs.length} {t.common.entries}
              </span>

              <button
                type="button"
                onClick={exportFuelLogs}
                disabled={!fuelLogs.length}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
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
                  <div key={log.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
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
                          {formatCurrency(log.total_cost, language)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                          {t.fuelLogs.litres}
                        </p>
                        <p className="mt-1 text-sm font-medium text-slate-900">{log.litres}</p>
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
                        <p className="mt-1 text-sm font-medium text-slate-900">{log.price_per_litre ?? "-"}</p>
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
                          fuel_type: log.fuel_type || "",
                          payment_method: log.payment_method || "",
                          notes: log.notes || ""
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
                <table className="w-full min-w-[1030px] text-sm">
                  <thead>
                    <tr className="bg-slate-100 text-slate-600">
                      <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.14em] whitespace-nowrap">
                        {t.fuelLogs.date}
                      </th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.14em] whitespace-nowrap">
                        {t.fuelLogs.driver}
                      </th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.14em] whitespace-nowrap">
                        {t.fuelLogs.vehicleReg}
                      </th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.14em] whitespace-nowrap">
                        {t.fuelLogs.litres}
                      </th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.14em] whitespace-nowrap">
                        {t.fuelLogs.totalCost}
                      </th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.14em] whitespace-nowrap">
                        {t.fuelLogs.pricePerLitre}
                      </th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.14em] whitespace-nowrap">
                        {t.fuelLogs.mileage}
                      </th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.14em] whitespace-nowrap">
                        {t.fuelLogs.location}
                      </th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.14em] whitespace-nowrap">
                        {t.fuelLogs.fuelType}
                      </th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.14em] whitespace-nowrap">
                        {t.fuelLogs.paymentMethod}
                      </th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.14em] whitespace-nowrap">
                        {t.common.action}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedFuelLogs.map((log) => (
                      <tr
                        key={log.id}
                        className="border-b border-slate-200 last:border-none hover:bg-slate-50 transition"
                      >
                        <td className="px-3 py-2.5 text-[13px] text-slate-700 whitespace-nowrap">
                          {formatDate(log.date, language)}
                        </td>
                        <td className="px-3 py-2.5 text-[13px] font-medium text-slate-900 whitespace-nowrap">
                          {log.driver}
                        </td>
                        <td className="px-3 py-2.5 text-[13px] text-slate-700 whitespace-nowrap">
                          {log.vehicle_reg}
                        </td>
                        <td className="px-3 py-2.5 text-[13px] text-slate-700 whitespace-nowrap">
                          {log.litres}
                        </td>
                        <td className="px-3 py-2.5 text-[13px] font-medium text-slate-900 whitespace-nowrap">
                          {formatCurrency(log.total_cost, language)}
                        </td>
                        <td className="px-3 py-2.5 text-[13px] text-slate-700 whitespace-nowrap">
                          {log.price_per_litre ?? "-"}
                        </td>
                        <td className="px-3 py-2.5 text-[13px] text-slate-700 whitespace-nowrap">
                          {log.mileage ?? "-"}
                        </td>
                        <td className="px-3 py-2.5 text-[13px] text-slate-700 min-w-[120px]">
                          {log.location || "-"}
                        </td>
                        <td className="px-3 py-2.5 text-[13px] text-slate-700 whitespace-nowrap">
                          {log.fuel_type || "-"}
                        </td>
                        <td className="px-3 py-2.5 text-[13px] text-slate-700 min-w-[130px]">
                          {log.payment_method || "-"}
                        </td>
                        <td className="px-3 py-2.5">
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
                                fuel_type: log.fuel_type || "",
                                payment_method: log.payment_method || "",
                                notes: log.notes || ""
                              })
                            }
                            className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
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
                    className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
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
                    className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
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
