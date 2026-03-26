"use client";

import { Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/empty-state";
import { Header } from "@/components/header";
import { deleteTransfer, fetchDrivers, fetchTransfers, saveTransfer } from "@/lib/data";
import { useLanguage } from "@/lib/language-provider";
import { formatCurrency, formatDate, today } from "@/lib/utils";
import type { BankTransferWithDriver, Driver } from "@/types/database";

const transferTypes = ["Driver Advance", "Fuel Reimbursement", "Maintenance", "Other"];

const initialForm = {
  id: "",
  date: today(),
  driver_id: "",
  vehicle_reg: "",
  amount: "",
  transfer_type: transferTypes[0],
  notes: ""
};

export default function TransfersPage() {
  const { language, t } = useLanguage();
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [transfers, setTransfers] = useState<BankTransferWithDriver[]>([]);
  const [form, setForm] = useState(initialForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isEditing = Boolean(form.id);

  const selectedDriver = useMemo(
    () => drivers.find((driver) => String(driver.id) === String(form.driver_id)),
    [drivers, form.driver_id]
  );

  const sortedTransfers = useMemo(() => {
    return [...transfers].sort((a, b) => {
      const dateDiff = new Date(b.date).getTime() - new Date(a.date).getTime();
      if (dateDiff !== 0) return dateDiff;
      return String(b.id).localeCompare(String(a.id));
    });
  }, [transfers]);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);

      const [driverRows, transferRows] = await Promise.all([fetchDrivers(), fetchTransfers()]);
      setDrivers(driverRows);
      setTransfers(transferRows);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.transfers.unableToLoadTransferData);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [t.transfers.unableToLoadTransferData]);

  useEffect(() => {
    if (!selectedDriver) {
      return;
    }

    setForm((current) => ({
      ...current,
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
      await saveTransfer({
        id: form.id || undefined,
        date: form.date,
        driver_id: form.driver_id,
        driver: selectedDriver?.name ?? form.driver_id,
        vehicle_reg: form.vehicle_reg,
        amount: Number(form.amount),
        transfer_type: form.transfer_type,
        notes: form.notes || null
      });

      resetForm();
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.transfers.unableToSaveTransfer);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm(t.transfers.confirmDelete)) {
      return;
    }

    try {
      setDeletingId(id);
      setError(null);
      await deleteTransfer(id);

      if (form.id === id) {
        resetForm();
      }

      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.transfers.unableToDeleteTransfer);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <>
      <div className="mb-6">
        <Header title={t.transfers.title} description={t.transfers.description} />
      </div>

      <section className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
        <form
          onSubmit={handleSubmit}
          className="rounded-3xl border border-slate-200 bg-white p-5 shadow-md sm:p-6"
        >
          <div className="mb-5">
            <h3 className="text-lg font-semibold text-slate-900">
              {isEditing ? t.transfers.editTransfer : t.transfers.addTransfer}
            </h3>
            <p className="mt-1 text-sm text-slate-500">{t.transfers.description}</p>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-1">
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                {t.transfers.date}
              </label>
              <input
                type="date"
                required
                value={form.date}
                onChange={(event) =>
                  setForm((current) => ({ ...current, date: event.target.value }))
                }
                className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-black"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                {t.transfers.driver}
              </label>
              <select
                required
                value={form.driver_id}
                onChange={(event) =>
                  setForm((current) => ({ ...current, driver_id: event.target.value }))
                }
                className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-black"
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
                className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-black"
                placeholder="ABC-1234"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                {t.transfers.amount}
              </label>
              <input
                type="number"
                required
                min="0"
                step="0.01"
                value={form.amount}
                onChange={(event) =>
                  setForm((current) => ({ ...current, amount: event.target.value }))
                }
                className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-black"
                placeholder="0.00"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                {t.transfers.type}
              </label>
              <select
                value={form.transfer_type}
                onChange={(event) =>
                  setForm((current) => ({ ...current, transfer_type: event.target.value }))
                }
                className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-black"
              >
                {transferTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-2 xl:col-span-1">
              <label className="mb-2 block text-sm font-medium text-slate-700">
                {t.transfers.notes}
              </label>
              <textarea
                rows={4}
                value={form.notes}
                onChange={(event) =>
                  setForm((current) => ({ ...current, notes: event.target.value }))
                }
                className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-black"
                placeholder={t.fuelLogs.optionalNotes}
              />
            </div>
          </div>

          {error ? <p className="mt-4 text-sm text-rose-600">{error}</p> : null}

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <button
              type="submit"
              disabled={saving}
              className="flex-1 rounded-xl bg-black px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-70"
            >
              {saving
                ? t.common.saving
                : isEditing
                  ? t.transfers.updateTransfer
                  : t.transfers.addTransfer}
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
        </form>

        <section className="min-w-0 rounded-3xl border border-slate-200 bg-white p-5 shadow-md sm:p-6">
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">
                {t.transfers.transferHistory}
              </h3>
              <p className="mt-1 text-sm text-slate-500">{t.transfers.tableDescription}</p>
            </div>

            <span className="inline-flex w-fit rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-600">
              {transfers.length} {t.common.entries}
            </span>
          </div>

          {loading ? (
            <p className="text-sm text-slate-500">{t.transfers.loadingTransfers}</p>
          ) : transfers.length === 0 ? (
            <EmptyState
              title={t.transfers.noTransfersYet}
              description={t.transfers.noTransfersDescription}
            />
          ) : (
            <>
              <div className="space-y-3 md:hidden">
                {sortedTransfers.map((transfer) => (
                  <div key={transfer.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{transfer.driver}</p>
                        <p className="mt-1 text-sm text-slate-500">{transfer.vehicle_reg}</p>
                      </div>
                      <p className="text-sm font-medium text-slate-900">
                        {formatDate(transfer.date, language)}
                      </p>
                    </div>
                    <p className="mt-3 text-sm text-slate-600">{transfer.transfer_type}</p>
                    <p className="mt-1 text-base font-semibold text-slate-950">
                      {formatCurrency(transfer.amount, language)}
                    </p>
                    <p className="mt-2 text-sm leading-6 text-slate-500">{transfer.notes || "-"}</p>
                    <div className="mt-4 flex flex-col gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setForm({
                            id: String(transfer.id),
                            date: transfer.date,
                            driver_id: String(transfer.driver_id),
                            vehicle_reg: transfer.vehicle_reg,
                            amount: String(transfer.amount),
                            transfer_type: transfer.transfer_type,
                            notes: transfer.notes || ""
                          })
                        }
                        className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                      >
                        {t.common.edit}
                      </button>

                      <button
                        type="button"
                        onClick={() => void handleDelete(String(transfer.id))}
                        disabled={deletingId === transfer.id}
                        className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-rose-200 px-3 py-2.5 text-sm font-medium text-rose-700 transition hover:bg-rose-50 disabled:opacity-50"
                      >
                        <Trash2 className="h-4 w-4" />
                        {deletingId === transfer.id ? t.common.deleting : t.common.delete}
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="hidden -mx-5 overflow-x-auto px-5 md:block md:mx-0 md:px-0">
                <div className="rounded-2xl border border-slate-200">
                <table className="w-full min-w-[980px] text-sm">
                  <thead>
                    <tr className="bg-slate-100 text-slate-600">
                      <th className="px-4 py-3 text-left font-semibold">{t.transfers.date}</th>
                      <th className="px-4 py-3 text-left font-semibold">{t.transfers.driver}</th>
                      <th className="px-4 py-3 text-left font-semibold">{t.fuelLogs.vehicleReg}</th>
                      <th className="px-4 py-3 text-left font-semibold">{t.transfers.type}</th>
                      <th className="px-4 py-3 text-left font-semibold">{t.transfers.amount}</th>
                      <th className="px-4 py-3 text-left font-semibold">{t.transfers.notes}</th>
                      <th className="px-4 py-3 text-left font-semibold">{t.common.action}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedTransfers.map((transfer) => (
                      <tr
                        key={transfer.id}
                        className="border-b border-slate-200 last:border-none hover:bg-slate-50 transition"
                      >
                        <td className="px-4 py-3 text-slate-700 whitespace-nowrap">
                          {formatDate(transfer.date, language)}
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-900 whitespace-nowrap">
                          {transfer.driver}
                        </td>
                        <td className="px-4 py-3 text-slate-700 whitespace-nowrap">
                          {transfer.vehicle_reg}
                        </td>
                        <td className="px-4 py-3 text-slate-700 whitespace-nowrap">
                          {transfer.transfer_type}
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-900 whitespace-nowrap">
                          {formatCurrency(transfer.amount, language)}
                        </td>
                        <td className="px-4 py-3 text-slate-600 min-w-[180px]">
                          {transfer.notes || "-"}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-2 sm:flex-row">
                            <button
                              type="button"
                              onClick={() =>
                                setForm({
                                  id: String(transfer.id),
                                  date: transfer.date,
                                  driver_id: String(transfer.driver_id),
                                  vehicle_reg: transfer.vehicle_reg,
                                  amount: String(transfer.amount),
                                  transfer_type: transfer.transfer_type,
                                  notes: transfer.notes || ""
                                })
                              }
                              className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                            >
                              {t.common.edit}
                            </button>

                            <button
                              type="button"
                              onClick={() => void handleDelete(String(transfer.id))}
                              disabled={deletingId === transfer.id}
                              className="inline-flex items-center gap-2 rounded-xl border border-rose-200 px-3 py-2 text-sm font-medium text-rose-700 transition hover:bg-rose-50 disabled:opacity-50"
                            >
                              <Trash2 className="h-4 w-4" />
                              {deletingId === transfer.id ? t.common.deleting : t.common.delete}
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
