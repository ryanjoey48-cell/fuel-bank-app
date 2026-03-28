"use client";

import { Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/empty-state";
import { Header } from "@/components/header";
import {
  getTransferTypeLabel,
  normalizeTransferTypeKey,
  TRANSFER_TYPE_KEYS
} from "@/lib/localized-values";
import { deleteTransfer, fetchDrivers, fetchTransfers, saveTransfer } from "@/lib/data";
import { useLanguage } from "@/lib/language-provider";
import { formatCurrency, formatDate, today } from "@/lib/utils";
import type { BankTransferWithDriver, Driver } from "@/types/database";

function createInitialForm(defaultTransferType: string) {
  return {
    id: "",
    date: today(),
    driver_id: "",
    vehicle_reg: "",
    amount: "",
    transfer_type: defaultTransferType,
    notes: ""
  };
}

export default function TransfersPage() {
  const { language, t } = useLanguage();
  const transferTypeOptions = TRANSFER_TYPE_KEYS.map((value) => ({
    value,
    label: t.transfer.type[value]
  }));
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [transfers, setTransfers] = useState<BankTransferWithDriver[]>([]);
  const [form, setForm] = useState(() => createInitialForm(transferTypeOptions[0].value));
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

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const [driverRows, transferRows] = await Promise.all([fetchDrivers(), fetchTransfers()]);
      setDrivers(driverRows);
      setTransfers(transferRows);
    } catch (err) {
      setError(t.transfers.unableToLoadTransferData);
    } finally {
      setLoading(false);
    }
  }, [t.transfers.unableToLoadTransferData]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

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
    setForm(createInitialForm(transferTypeOptions[0].value));
    setError(null);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);

    try {
      await saveTransfer({
        id: form.id || undefined,
        transfer_date: form.date,
        driver_id: form.driver_id,
        vehicle_reg: form.vehicle_reg.trim(),
        amount: Number(form.amount),
        transfer_type: form.transfer_type,
        notes: form.notes.trim() || null
      });

      resetForm();
      await loadData();
    } catch (err) {
      setError(t.transfers.unableToSaveTransfer);
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
      setError(t.transfers.unableToDeleteTransfer);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <>
      <div className="mb-6">
        <Header title={t.transfers.title} description={t.transfers.description} />
      </div>

      <section className="mt-1">
        <form
          onSubmit={handleSubmit}
          className="surface-card-soft w-full p-4 sm:p-5 lg:p-5.5"
        >
          <div className="mb-5">
            <h3 className="section-title">
              {isEditing ? t.transfers.editTransfer : t.transfers.addTransfer}
            </h3>
            <p className="section-subtitle">{t.transfers.description}</p>
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 lg:gap-x-5">
            <div className="form-field">
              <label className="form-label">
                {t.transfers.date}
              </label>
              <input
                type="date"
                required
                value={form.date}
                onChange={(event) =>
                  setForm((current) => ({ ...current, date: event.target.value }))
                }
                className="form-input w-full"
              />
            </div>

            <div className="form-field">
              <label className="form-label">
                {t.transfers.driver}
              </label>
              <select
                required
                value={form.driver_id}
                onChange={(event) =>
                  setForm((current) => ({ ...current, driver_id: event.target.value }))
                }
                className="form-input w-full"
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
                className="form-input w-full"
                placeholder={t.transfers.vehicleRegPlaceholder}
              />
            </div>

            <div className="form-field">
              <label className="form-label">
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
                className="form-input w-full"
                placeholder={t.transfers.amountPlaceholder}
              />
            </div>

            <div className="form-field">
              <label className="form-label">
                {t.transfers.type}
              </label>
              <select
                value={form.transfer_type}
                onChange={(event) =>
                  setForm((current) => ({ ...current, transfer_type: event.target.value }))
                }
                className="form-input w-full"
              >
                <option value="">{t.transfers.typeSelect}</option>
                {transferTypeOptions.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-field md:col-span-2 lg:col-span-3">
              <label className="form-label">
                {t.transfers.notes}
              </label>
              <textarea
                rows={4}
                value={form.notes}
                onChange={(event) =>
                  setForm((current) => ({ ...current, notes: event.target.value }))
                }
                className="form-textarea w-full"
                placeholder={t.fuelLogs.optionalNotes}
              />
            </div>
          </div>

          {error ? <p className="mt-4 text-sm text-rose-600">{error}</p> : null}

          <div className="mt-4.5 flex flex-col gap-2.5 sm:flex-row sm:items-center">
            <button
              type="submit"
              disabled={saving}
              className="btn-primary w-full min-w-[180px] flex-1 sm:w-auto sm:flex-none disabled:opacity-70"
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
                className="btn-secondary w-full sm:w-auto"
              >
                {t.common.cancel}
              </button>
            ) : null}
          </div>
        </form>
      </section>

      <section className="mt-5">
        <section className="surface-card min-w-0 p-4 sm:p-5 lg:p-5">
          <div className="mb-3.5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="section-title">
                {t.transfers.transferHistory}
              </h3>
              <p className="section-subtitle">{t.transfers.tableDescription}</p>
            </div>

            <span className="badge-muted w-fit">
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
              <div className="space-y-3.5 md:hidden">
                {sortedTransfers.map((transfer) => (
                  <div key={transfer.id} className="subtle-panel p-4">
                    <div className="flex flex-col gap-2.5 min-[400px]:flex-row min-[400px]:items-start min-[400px]:justify-between">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{transfer.driver}</p>
                        <p className="mt-1 text-sm text-slate-500">{transfer.vehicle_reg}</p>
                      </div>
                      <p className="text-sm font-medium text-slate-900">
                        {formatDate(transfer.date, language)}
                      </p>
                    </div>
                    <div className="mt-3 inline-flex rounded-full border border-slate-200/80 bg-slate-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-600">
                      {getTransferTypeLabel(t, transfer.transfer_type)}
                    </div>
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
                            transfer_type:
                              normalizeTransferTypeKey(transfer.transfer_type) ??
                              transferTypeOptions[0].value,
                            notes: transfer.notes || ""
                          })
                        }
                        className="btn-secondary w-full"
                      >
                        {t.common.edit}
                      </button>

                      <button
                        type="button"
                        onClick={() => void handleDelete(String(transfer.id))}
                        disabled={deletingId === transfer.id}
                        className="btn-danger w-full gap-2 disabled:opacity-50"
                      >
                        <Trash2 className="h-4 w-4" />
                        {deletingId === transfer.id ? t.common.deleting : t.common.delete}
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="hidden -mx-5 overflow-x-auto px-5 md:block md:mx-0 md:px-0">
                <div className="table-shell rounded-2xl">
                  <table className="w-full min-w-[920px] text-sm">
                    <thead>
                      <tr className="bg-slate-50/70 text-slate-600">
                        <th className="px-4 py-2 text-left font-semibold">{t.transfers.date}</th>
                        <th className="px-4 py-2 text-left font-semibold">{t.transfers.driver}</th>
                        <th className="px-4 py-2 text-left font-semibold">{t.fuelLogs.vehicleReg}</th>
                        <th className="px-4 py-2 text-left font-semibold">{t.transfers.type}</th>
                        <th className="px-4 py-2 text-right font-semibold">{t.transfers.amount}</th>
                        <th className="px-4 py-2 text-left font-semibold">{t.transfers.notes}</th>
                        <th className="px-4 py-2 text-left font-semibold">{t.common.action}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedTransfers.map((transfer) => (
                        <tr
                          key={transfer.id}
                          className="border-b border-slate-100/60 transition last:border-none hover:bg-slate-50/55"
                        >
                          <td className="whitespace-nowrap px-4 py-2 text-slate-700">
                            {formatDate(transfer.date, language)}
                          </td>
                          <td className="whitespace-nowrap px-4 py-2 font-medium text-slate-900">
                            {transfer.driver}
                          </td>
                          <td className="whitespace-nowrap px-4 py-2 text-slate-700">
                            {transfer.vehicle_reg}
                          </td>
                          <td className="whitespace-nowrap px-4 py-2 text-slate-700">
                            {getTransferTypeLabel(t, transfer.transfer_type)}
                          </td>
                          <td className="whitespace-nowrap px-4 py-2 text-right font-semibold text-slate-950">
                            {formatCurrency(transfer.amount, language)}
                          </td>
                          <td className="min-w-[220px] px-4 py-2 text-slate-600">
                            {transfer.notes || "-"}
                          </td>
                          <td className="px-4 py-2">
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
                                    transfer_type:
                                      normalizeTransferTypeKey(transfer.transfer_type) ??
                                      transferTypeOptions[0].value,
                                    notes: transfer.notes || ""
                                  })
                                }
                                className="btn-secondary"
                              >
                                {t.common.edit}
                              </button>

                              <button
                                type="button"
                                onClick={() => void handleDelete(String(transfer.id))}
                                disabled={deletingId === transfer.id}
                                className="btn-danger gap-2 disabled:opacity-50"
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
