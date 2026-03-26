"use client";

import { Download, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { EmptyState } from "@/components/empty-state";
import { Header } from "@/components/header";
import { deleteDriver, fetchDrivers, saveDriver } from "@/lib/data";
import { exportToXlsx } from "@/lib/export";
import { useLanguage } from "@/lib/language-provider";
import type { Driver } from "@/types/database";

const initialForm = {
  id: "",
  name: "",
  vehicle_reg: ""
};

export default function DriversPage() {
  const { t } = useLanguage();
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [form, setForm] = useState(initialForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isEditing = Boolean(form.id);

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      setDrivers(await fetchDrivers());
    } catch (err) {
      setError(err instanceof Error ? err.message : t.drivers.unableToLoadDrivers);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [t.drivers.unableToLoadDrivers]);

  const resetForm = () => {
    setForm(initialForm);
    setError(null);
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);

    try {
      await saveDriver({
        id: form.id || undefined,
        name: form.name.trim(),
        vehicle_reg: form.vehicle_reg.trim()
      });

      resetForm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.drivers.unableToSaveDriver);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm(t.drivers.confirmDelete)) {
      return;
    }

    try {
      setDeletingId(id);
      setError(null);
      await deleteDriver(id);

      if (form.id === id) {
        resetForm();
      }

      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.drivers.unableToDeleteDriver);
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
      <div className="mb-6">
        <Header title={t.drivers.title} description={t.drivers.description} />
      </div>

      <section className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
        <form
          onSubmit={submit}
          className="rounded-3xl border border-slate-200 bg-white p-5 shadow-md sm:p-6"
        >
          <div className="mb-5">
            <h3 className="text-lg font-semibold text-slate-900">
              {isEditing ? t.drivers.editDriver : t.drivers.addDriver}
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              {isEditing ? t.drivers.updateDriver : t.drivers.description}
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                {t.drivers.name}
              </label>
              <input
                required
                placeholder={t.drivers.name}
                value={form.name}
                onChange={(event) =>
                  setForm((current) => ({ ...current, name: event.target.value }))
                }
                className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-black"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                {t.drivers.vehicle}
              </label>
              <input
                required
                placeholder={t.drivers.vehicle}
                value={form.vehicle_reg}
                onChange={(event) =>
                  setForm((current) => ({ ...current, vehicle_reg: event.target.value }))
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
                    ? t.drivers.updateDriver
                    : t.drivers.saveDriver}
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
              <h3 className="text-lg font-semibold text-slate-900">{t.common.drivers}</h3>
              <p className="mt-1 text-sm text-slate-500">{t.drivers.tableDescription}</p>
            </div>

            <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center">
              <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-600">
                {drivers.length} {t.common.entries}
              </span>

              <button
                type="button"
                onClick={exportDrivers}
                disabled={!drivers.length}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
              >
                <Download className="h-4 w-4" />
                {t.common.export}
              </button>
            </div>
          </div>

          {loading ? (
            <p className="text-sm text-slate-500">{t.drivers.loadingDrivers}</p>
          ) : drivers.length === 0 ? (
            <EmptyState
              title={t.drivers.noDriversYet}
              description={t.drivers.noDriversDescription}
            />
          ) : (
            <>
              <div className="space-y-3 md:hidden">
                {drivers.map((driver) => (
                  <div key={driver.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-sm font-semibold text-slate-900">{driver.name}</p>
                    <p className="mt-1 text-sm text-slate-500">{driver.vehicle_reg}</p>
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
                        className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                      >
                        {t.common.edit}
                      </button>

                      <button
                        type="button"
                        onClick={() => void handleDelete(String(driver.id))}
                        disabled={deletingId === driver.id}
                        className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-rose-200 px-3 py-2.5 text-sm font-medium text-rose-700 transition hover:bg-rose-50 disabled:opacity-50"
                      >
                        <Trash2 className="h-4 w-4" />
                        {deletingId === driver.id ? t.common.deleting : t.common.delete}
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="hidden -mx-5 overflow-x-auto px-5 md:block md:mx-0 md:px-0">
                <div className="rounded-2xl border border-slate-200">
                <table className="w-full min-w-[760px] text-sm">
                  <thead>
                    <tr className="bg-slate-100 text-slate-600">
                      <th className="px-4 py-3 text-left font-semibold">{t.drivers.name}</th>
                      <th className="px-4 py-3 text-left font-semibold">{t.drivers.vehicle}</th>
                      <th className="px-4 py-3 text-left font-semibold">{t.common.action}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drivers.map((driver) => (
                      <tr
                        key={driver.id}
                        className="border-b border-slate-200 last:border-none hover:bg-slate-50 transition"
                      >
                        <td className="px-4 py-3 font-medium text-slate-900">{driver.name}</td>
                        <td className="px-4 py-3 text-slate-700">{driver.vehicle_reg}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-2 sm:flex-row">
                            <button
                              type="button"
                              onClick={() =>
                                setForm({
                                  id: String(driver.id),
                                  name: driver.name,
                                  vehicle_reg: driver.vehicle_reg
                                })
                              }
                              className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                            >
                              {t.common.edit}
                            </button>

                            <button
                              type="button"
                              onClick={() => void handleDelete(String(driver.id))}
                              disabled={deletingId === driver.id}
                              className="inline-flex items-center gap-2 rounded-xl border border-rose-200 px-3 py-2 text-sm font-medium text-rose-700 transition hover:bg-rose-50 disabled:opacity-50"
                            >
                              <Trash2 className="h-4 w-4" />
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
            </>
          )}
        </section>
      </section>
    </>
  );
}
