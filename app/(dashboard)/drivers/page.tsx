"use client";

import { CarFront, Download, Search, Trash2, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/empty-state";
import { Header } from "@/components/header";
import { deleteDriver, fetchDrivers, saveDriver } from "@/lib/data";
import { exportToXlsx } from "@/lib/export";
import { applyRequiredValidationMessage, clearValidationMessage } from "@/lib/form-validation";
import { useLanguage } from "@/lib/language-provider";
import { formatNumber } from "@/lib/utils";
import type { Driver } from "@/types/database";

const initialForm = {
  id: "",
  name: "",
  vehicle_reg: ""
};

function DriverSummaryCard({
  label,
  value,
  helper,
  icon: Icon
}: {
  label: string;
  value: string;
  helper: string;
  icon: LucideIcon;
}) {
  return (
    <article className="surface-card-soft card-metric-shell min-h-[198px] sm:min-h-[210px]">
      <div className="card-metric-header gap-3">
        <div className="min-w-0 flex-1">
          <p className="metric-label">{label}</p>
          <p className="metric-value text-[2.25rem] sm:text-[2.5rem]">{value}</p>
        </div>
        <div className="card-metric-icon">
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <p className="metric-helper">{helper}</p>
    </article>
  );
}

export default function DriversPage() {
  const { language, t } = useLanguage();
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [form, setForm] = useState(initialForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [driverFilter, setDriverFilter] = useState("");
  const actionMessages =
    language === "th"
      ? {
          saved: "บันทึกคนขับเรียบร้อยแล้ว",
          updated: "อัปเดตคนขับเรียบร้อยแล้ว",
          deleted: "ลบคนขับเรียบร้อยแล้ว"
        }
      : {
          saved: "Driver saved successfully.",
          updated: "Driver updated successfully.",
          deleted: "Driver deleted successfully."
        };

  const isEditing = Boolean(form.id);
  const labels = {
    totalDrivers: t.drivers.totalDrivers,
    totalDriversHelper: t.drivers.totalDriversHelper,
    totalVehiclesAssigned: t.drivers.totalVehiclesAssigned,
    totalVehiclesAssignedHelper: t.drivers.totalVehiclesAssignedHelper,
    searchDrivers: t.drivers.searchDrivers,
    searchPlaceholder: t.drivers.searchPlaceholder,
    filterDriver: t.drivers.filterDriver,
    allDrivers: t.drivers.allDrivers
  };

  const sortedDrivers = useMemo(
    () => [...drivers].sort((a, b) => a.name.localeCompare(b.name)),
    [drivers]
  );

  const uniqueVehiclesAssigned = useMemo(
    () => new Set(drivers.map((driver) => driver.vehicle_reg.trim()).filter(Boolean)).size,
    [drivers]
  );

  const filteredDrivers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return sortedDrivers.filter((driver) => {
      const matchesQuery =
        !query ||
        driver.name.toLowerCase().includes(query) ||
        driver.vehicle_reg.toLowerCase().includes(query);
      const matchesFilter = !driverFilter || driver.name === driverFilter;

      return matchesQuery && matchesFilter;
    });
  }, [driverFilter, searchQuery, sortedDrivers]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const driverRows = await fetchDrivers();
      console.log("Drivers page load success", { rowCount: driverRows.length });
      setDrivers(driverRows);
    } catch (err) {
      console.error("Drivers load error:", err);
      setError(t.drivers.unableToLoadDrivers);
    } finally {
      setLoading(false);
    }
  }, [t.drivers.unableToLoadDrivers]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const handleDataChanged = () => {
      void load();
    };

    window.addEventListener("fuel-bank:data-changed", handleDataChanged);
    return () => window.removeEventListener("fuel-bank:data-changed", handleDataChanged);
  }, [load]);

  const resetForm = (clearMessages = true) => {
    setForm(initialForm);
    setError(null);
    if (clearMessages) {
      setSuccessMessage(null);
    }
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSuccessMessage(null);

    try {
      await saveDriver({
        id: form.id || undefined,
        name: form.name.trim(),
        vehicle_reg: form.vehicle_reg.trim()
      });

      resetForm(false);
      setSuccessMessage(isEditing ? actionMessages.updated : actionMessages.saved);
      await load();
    } catch (err) {
      console.error("Drivers submit error:", err);
      if (err instanceof Error && err.message === "DUPLICATE_DRIVER_NAME") {
        setError(t.drivers.duplicateDriverName);
      } else if (err instanceof Error && err.message === "DUPLICATE_DRIVER_VEHICLE") {
        setError(t.drivers.duplicateVehicleAssignment);
      } else if (err instanceof Error && err.message) {
        setError(err.message);
      } else {
        setError(t.drivers.unableToSaveDriver);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleInvalid = (
    event: React.InvalidEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    applyRequiredValidationMessage(event, t.common.requiredField);
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm(t.drivers.confirmDelete)) {
      return;
    }

    try {
      setDeletingId(id);
      setError(null);
      setSuccessMessage(null);
      await deleteDriver(id);

      if (form.id === id) {
        resetForm();
      }

      setSuccessMessage(actionMessages.deleted);
      await load();
    } catch (err) {
      console.error("Drivers delete error:", err);
      setError(err instanceof Error && err.message ? err.message : t.drivers.unableToDeleteDriver);
    } finally {
      setDeletingId(null);
    }
  };

  const exportDrivers = () => {
    exportToXlsx(
      drivers.map((driver) => ({
        [t.drivers.name]: driver.name,
        [t.drivers.vehicle]: driver.vehicle_reg
      })),
      "drivers-report",
      "Drivers"
    );
  };

  return (
    <>
      <div className="mb-6 hidden md:block">
        <Header title={t.drivers.title} description={t.drivers.description} />
      </div>

      <section className="mb-4.5 grid gap-4 sm:grid-cols-2 xl:max-w-[720px]">
        <DriverSummaryCard
          label={labels.totalDrivers}
          value={formatNumber(drivers.length, language)}
          helper={labels.totalDriversHelper}
          icon={Users}
        />
        <DriverSummaryCard
          label={labels.totalVehiclesAssigned}
          value={formatNumber(uniqueVehiclesAssigned, language)}
          helper={labels.totalVehiclesAssignedHelper}
          icon={CarFront}
        />
      </section>

      <section className="grid items-start gap-4 xl:grid-cols-[minmax(360px,0.95fr)_minmax(0,1.78fr)] 2xl:grid-cols-[minmax(380px,0.92fr)_minmax(0,1.82fr)]">
        <form onSubmit={submit} className="surface-card-soft h-fit p-5 sm:p-6 lg:p-6.5">
          <div className="mb-6">
            <h3 className="section-title">
              {isEditing ? t.drivers.editDriver : t.drivers.addDriver}
            </h3>
            <p className="section-subtitle mt-1.5 max-w-md">
              {isEditing ? t.drivers.updateDriver : t.drivers.description}
            </p>
          </div>

          <div className="space-y-5">
            <div className="form-field">
              <label className="form-label form-label-required">{t.drivers.name}</label>
              <input
                required
                placeholder={t.drivers.name}
                value={form.name}
                onChange={(event) =>
                  setForm((current) => ({ ...current, name: event.target.value }))
                }
                onInvalid={handleInvalid}
                onInput={clearValidationMessage}
                className="form-input w-full"
              />
            </div>

            <div className="form-field">
              <label className="form-label form-label-required">{t.drivers.vehicle}</label>
              <input
                required
                placeholder={t.drivers.vehicle}
                value={form.vehicle_reg}
                onChange={(event) =>
                  setForm((current) => ({ ...current, vehicle_reg: event.target.value }))
                }
                onInvalid={handleInvalid}
                onInput={clearValidationMessage}
                className="form-input w-full"
              />
            </div>

            {error ? <p className="form-error">{error}</p> : null}
            {successMessage ? <p className="mt-2 text-sm text-emerald-600">{successMessage}</p> : null}

            <div className="pt-2">
              <button
                type="submit"
                disabled={saving}
                className="btn-primary w-full disabled:opacity-70"
              >
                {saving
                  ? t.common.saving
                  : isEditing
                    ? t.drivers.updateDriver
                    : t.drivers.saveDriver}
              </button>

              {isEditing ? (
                <button
                  type="button"
                  onClick={() => resetForm()}
                  className="btn-secondary mt-2 w-full"
                >
                  {t.common.cancel}
                </button>
              ) : null}
            </div>
          </div>
        </form>

        <section className="surface-card min-w-0 p-5 sm:p-6 lg:p-6.5">
          <div className="mb-5 flex flex-col gap-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 space-y-1.5">
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                  <h3 className="section-title">{t.common.drivers}</h3>
                  <span className="badge-muted px-2.5 py-1 text-[11px]">
                    {formatNumber(filteredDrivers.length, language)} {t.common.entries}
                  </span>
                </div>
                <p className="section-subtitle max-w-2xl">{t.drivers.tableDescription}</p>
              </div>

              <div className="flex w-full shrink-0 lg:w-auto lg:justify-end">
                <button
                  type="button"
                  onClick={exportDrivers}
                  disabled={!drivers.length}
                  className="btn-secondary w-full gap-2 px-3.5 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
                >
                  <Download className="h-4 w-4" />
                  {t.common.export}
                </button>
              </div>
            </div>

            <div className="rounded-[1.4rem] border border-slate-200/80 bg-slate-50/70 p-4">
              <div className="grid gap-3 xl:grid-cols-[minmax(0,1.45fr)_minmax(220px,0.55fr)] xl:items-end">
                <div className="form-field">
                  <label className="form-label">{labels.searchDrivers}</label>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder={labels.searchPlaceholder}
                      className="form-input w-full bg-white pl-9"
                    />
                  </div>
                </div>

                <div className="form-field xl:max-w-[240px] xl:justify-self-end">
                  <label className="form-label">{labels.filterDriver}</label>
                  <select
                    value={driverFilter}
                    onChange={(event) => setDriverFilter(event.target.value)}
                    className="form-input w-full bg-white"
                  >
                    <option value="">{labels.allDrivers}</option>
                    {sortedDrivers.map((driver) => (
                      <option key={driver.id} value={driver.name}>
                        {driver.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </div>

          {loading ? (
            <p className="text-sm text-slate-500">{t.drivers.loadingDrivers}</p>
          ) : filteredDrivers.length === 0 ? (
            <EmptyState
              title={drivers.length === 0 ? t.drivers.noDriversYet : labels.searchDrivers}
              description={
                drivers.length === 0
                  ? t.drivers.noDriversDescription
                  : labels.searchPlaceholder
              }
            />
          ) : (
            <>
              <div className="space-y-3.5 md:hidden">
                {filteredDrivers.map((driver) => (
                  <div key={driver.id} className="subtle-panel p-4">
                    <p className="text-sm font-semibold text-slate-900">{driver.name}</p>
                    <p className="mt-1 text-sm text-slate-500">{driver.vehicle_reg}</p>
                    <div className="mt-3 inline-flex rounded-full border border-slate-200/80 bg-slate-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                      {t.drivers.vehicle}
                    </div>
                    <div className="mt-4 flex flex-col gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setForm({
                            id: String(driver.id),
                            name: driver.name,
                            vehicle_reg: driver.vehicle_reg
                          })
                        }
                        className="btn-secondary w-full"
                      >
                        {t.common.edit}
                      </button>

                      <button
                        type="button"
                        onClick={() => void handleDelete(String(driver.id))}
                        disabled={deletingId === driver.id}
                        className="btn-danger w-full gap-2 disabled:opacity-50"
                      >
                        <Trash2 className="h-4 w-4" />
                        {deletingId === driver.id ? t.common.deleting : t.common.delete}
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
                      <col className="w-[35%]" />
                      <col className="w-[29%]" />
                      <col className="w-[36%]" />
                    </colgroup>
                    <thead>
                      <tr className="bg-slate-50/80 text-slate-600">
                        <th className="table-head-cell text-left">{t.drivers.name}</th>
                        <th className="table-head-cell text-left">{t.drivers.vehicle}</th>
                        <th className="table-head-cell text-left">{t.common.action}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredDrivers.map((driver) => (
                        <tr key={driver.id} className="enterprise-table-row">
                          <td className="table-body-cell table-driver-name">{driver.name}</td>
                          <td className="table-body-cell text-slate-700">{driver.vehicle_reg}</td>
                          <td className="table-body-cell">
                            <div className="flex h-9 flex-row items-center gap-1.5 whitespace-nowrap">
                              <button
                                type="button"
                                onClick={() =>
                                  setForm({
                                    id: String(driver.id),
                                    name: driver.name,
                                    vehicle_reg: driver.vehicle_reg
                                  })
                                }
                                className="table-action-secondary min-w-[82px]"
                              >
                                {t.common.edit}
                              </button>

                              <button
                                type="button"
                                onClick={() => void handleDelete(String(driver.id))}
                                disabled={deletingId === driver.id}
                                className="table-action-danger min-w-[92px] gap-1.5 disabled:opacity-50"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                {deletingId === driver.id ? t.common.deleting : t.common.delete}
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
            </>
          )}
        </section>
      </section>
    </>
  );
}
