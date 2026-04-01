"use client";

import { Download, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/empty-state";
import { Header } from "@/components/header";
import {
  getTransferTypeLabel,
  normalizeTransferTypeKey,
  TRANSFER_TYPE_KEYS
} from "@/lib/localized-values";
import { deleteTransfer, fetchDrivers, fetchFuelLogs, fetchTransfers, saveTransfer } from "@/lib/data";
import { exportToCsv } from "@/lib/export";
import { applyRequiredValidationMessage, clearValidationMessage } from "@/lib/form-validation";
import { useLanguage } from "@/lib/language-provider";
import { formatCurrency, formatDate, formatNumber, today } from "@/lib/utils";
import type { BankTransferWithDriver, Driver, FuelLogWithDriver } from "@/types/database";

const PAGE_SIZE = 25;

function createInitialForm(defaultTransferType: string) {
  return {
    id: "",
    date: today(),
    driver_id: "",
    vehicle_reg: "",
    amount: "",
    transfer_type: defaultTransferType,
    receipt_status: "pending" as "pending" | "submitted" | "approved",
    notes: ""
  };
}

export default function TransfersPage() {
  const { language, t } = useLanguage();
  const transferTypeOptions = TRANSFER_TYPE_KEYS.map((value) => ({
    value,
    label: t.transfer.type[value]
  }));
  const receiptStatusOptions = [
    { value: "pending" as const, label: language === "th" ? "Pending" : "Pending" },
    { value: "submitted" as const, label: language === "th" ? "Submitted" : "Submitted" },
    { value: "approved" as const, label: language === "th" ? "Approved" : "Approved" }
  ];

  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [transfers, setTransfers] = useState<BankTransferWithDriver[]>([]);
  const [fuelLogs, setFuelLogs] = useState<FuelLogWithDriver[]>([]);
  const [form, setForm] = useState(() => createInitialForm(transferTypeOptions[0].value));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const isEditing = Boolean(form.id);
  const selectedDriver = useMemo(
    () => drivers.find((driver) => String(driver.id) === String(form.driver_id)),
    [drivers, form.driver_id]
  );
  const fuelLogLookup = useMemo(
    () => new Map(fuelLogs.map((log) => [String(log.id), log])),
    [fuelLogs]
  );
  const sortedTransfers = useMemo(
    () =>
      [...transfers].sort(
        (left, right) => right.date.localeCompare(left.date) || String(right.id).localeCompare(String(left.id))
      ),
    [transfers]
  );
  const totalPages = Math.max(1, Math.ceil(sortedTransfers.length / PAGE_SIZE));
  const pagedTransfers = useMemo(() => {
    const safePage = Math.min(currentPage, totalPages);
    const startIndex = (safePage - 1) * PAGE_SIZE;
    return sortedTransfers.slice(startIndex, startIndex + PAGE_SIZE);
  }, [currentPage, sortedTransfers, totalPages]);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const [driverRows, transferRows, fuelRows] = await Promise.all([
        fetchDrivers(),
        fetchTransfers(),
        fetchFuelLogs()
      ]);

      setDrivers(driverRows);
      setTransfers(transferRows);
      setFuelLogs(fuelRows);
    } catch {
      setError(t.transfers.unableToLoadTransferData);
    } finally {
      setLoading(false);
    }
  }, [t.transfers.unableToLoadTransferData]);

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
    setCurrentPage(1);
  }, [sortedTransfers.length]);

  const resetForm = (clearMessages = true) => {
    setForm(createInitialForm(transferTypeOptions[0].value));
    setError(null);
    if (clearMessages) {
      setSuccessMessage(null);
    }
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
      await saveTransfer({
        id: form.id || undefined,
        transfer_date: form.date,
        driver_id: form.driver_id,
        vehicle_reg: form.vehicle_reg.trim(),
        amount: Number(form.amount),
        transfer_type: form.transfer_type,
        receipt_status: form.receipt_status,
        notes: form.notes.trim() || null
      });

      resetForm(false);
      setSuccessMessage(
        isEditing
          ? language === "th"
            ? "Transfer updated successfully."
            : "Transfer updated successfully."
          : language === "th"
            ? "Transfer saved successfully."
            : "Transfer saved successfully."
      );
      await loadData();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : t.transfers.unableToSaveTransfer);
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
      setSuccessMessage(null);
      await deleteTransfer(id);
      if (form.id === id) {
        resetForm();
      }
      setSuccessMessage(language === "th" ? "Transfer deleted successfully." : "Transfer deleted successfully.");
      await loadData();
    } catch (err) {
      setError(
        err instanceof Error && err.message ? err.message : t.transfers.unableToDeleteTransfer
      );
    } finally {
      setDeletingId(null);
    }
  };

  const exportTransfers = () =>
    exportToCsv(
      sortedTransfers.map((transfer) => ({
        Date: transfer.date,
        Driver: transfer.driver,
        Vehicle: transfer.vehicle_reg,
        Amount: transfer.amount,
        Type: getTransferTypeLabel(t, transfer.transfer_type),
        ReceiptStatus: transfer.receipt_status ?? "pending",
        Notes: transfer.notes ?? ""
      })),
      "transfers-report"
    );

  return (
    <>
      <div className="mb-6 hidden md:block">
        <Header title={t.transfers.title} description={t.transfers.description} />
      </div>

      <section className="mt-1">
        <form onSubmit={handleSubmit} className="surface-card-soft w-full p-5 sm:p-6 lg:p-6.5">
          <div className="mb-5">
            <h3 className="section-title">{isEditing ? t.transfers.editTransfer : t.transfers.addTransfer}</h3>
            <p className="section-subtitle">{t.transfers.description}</p>
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
            <div className="form-section">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="form-field">
                  <label className="form-label form-label-required">{t.transfers.date}</label>
                  <input
                    type="date"
                    required
                    value={form.date}
                    onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))}
                    onInvalid={handleInvalid}
                    onInput={clearValidationMessage}
                    className="form-input w-full"
                  />
                </div>

                <div className="form-field">
                  <label className="form-label form-label-required">{t.transfers.driver}</label>
                  <select
                    required
                    value={form.driver_id}
                    onInvalid={handleInvalid}
                    onChange={(event) => {
                      clearValidationMessage(event);
                      const nextDriver = drivers.find((driver) => String(driver.id) === event.target.value);
                      setForm((current) => ({
                        ...current,
                        driver_id: event.target.value,
                        vehicle_reg: nextDriver?.vehicle_reg ?? current.vehicle_reg
                      }));
                    }}
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
                  <label className="form-label form-label-required">{t.fuelLogs.vehicleReg}</label>
                  <input
                    required
                    value={form.vehicle_reg}
                    onChange={(event) => setForm((current) => ({ ...current, vehicle_reg: event.target.value }))}
                    onInvalid={handleInvalid}
                    onInput={clearValidationMessage}
                    className="form-input w-full"
                    placeholder={t.transfers.vehicleRegPlaceholder}
                  />
                  <p className="form-helper">
                    {selectedDriver?.vehicle_reg?.trim()
                      ? "Auto-filled based on driver and can be changed"
                      : "No vehicle assigned. Please select one manually."}
                  </p>
                </div>

                <div className="form-field">
                  <label className="form-label form-label-required">{t.transfers.amount}</label>
                  <input
                    type="number"
                    required
                    min="0"
                    step="0.01"
                    value={form.amount}
                    onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))}
                    onInvalid={handleInvalid}
                    onInput={clearValidationMessage}
                    className="form-input w-full"
                    placeholder={t.transfers.amountPlaceholder}
                  />
                </div>
              </div>
            </div>

            <div className="form-section">
              <div className="space-y-4">
                <div className="form-field">
                  <label className="form-label">{t.transfers.type}</label>
                  <select
                    value={form.transfer_type}
                    onChange={(event) => setForm((current) => ({ ...current, transfer_type: event.target.value }))}
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

                <div className="form-field">
                  <label className="form-label">{language === "th" ? "Receipt status" : "Receipt status"}</label>
                  <select
                    value={form.receipt_status}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        receipt_status: event.target.value as "pending" | "submitted" | "approved"
                      }))
                    }
                    className="form-input w-full"
                  >
                    {receiptStatusOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-field">
                  <label className="form-label">{t.transfers.notes}</label>
                  <textarea
                    rows={6}
                    value={form.notes}
                    onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                    className="form-textarea w-full"
                    placeholder={t.fuelLogs.optionalNotes}
                  />
                </div>
              </div>
            </div>
          </div>

          {error ? <p className="form-error mt-4">{error}</p> : null}
          {successMessage ? <p className="mt-4 text-sm text-emerald-600">{successMessage}</p> : null}

          <div className="sticky bottom-3 z-10 mt-4.5 flex flex-col gap-2.5 rounded-[1.5rem] border border-slate-200/80 bg-white/95 p-3 shadow-[0_10px_30px_rgba(15,23,42,0.08)] backdrop-blur sm:static sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none sm:flex-row sm:items-center">
            <button type="submit" disabled={saving} className="btn-primary w-full min-w-[180px] flex-1 sm:w-auto sm:flex-none disabled:opacity-70">
              {saving ? t.common.saving : isEditing ? t.transfers.updateTransfer : t.transfers.addTransfer}
            </button>
            {isEditing ? (
              <button type="button" onClick={() => resetForm()} className="btn-secondary w-full sm:w-auto">
                {t.common.cancel}
              </button>
            ) : null}
          </div>
        </form>
      </section>

      <section className="mt-5">
        <section className="surface-card min-w-0 p-5 sm:p-6 lg:p-6">
          <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="section-title">{t.transfers.transferHistory}</h3>
              <p className="section-subtitle">{t.transfers.tableDescription}</p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <span className="badge-muted w-fit">
                {formatNumber(sortedTransfers.length, language)} {t.common.entries}
              </span>
              <button
                type="button"
                onClick={exportTransfers}
                disabled={!sortedTransfers.length}
                className="btn-secondary w-full gap-2 disabled:opacity-50 sm:w-auto"
              >
                <Download className="h-4 w-4" />
                {t.common.export}
              </button>
            </div>
          </div>

          {loading ? (
            <p className="text-sm text-slate-500">{t.transfers.loadingTransfers}</p>
          ) : sortedTransfers.length === 0 ? (
            <EmptyState title={t.transfers.noTransfersYet} description={t.transfers.noTransfersDescription} />
          ) : (
            <>
              <div className="space-y-3.5 md:hidden">
                {pagedTransfers.map((transfer) => (
                  <div key={transfer.id} className="subtle-panel p-4">
                    <div className="flex flex-col gap-2.5 min-[400px]:flex-row min-[400px]:items-start min-[400px]:justify-between">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{transfer.driver}</p>
                        <p className="mt-1 text-sm text-slate-500">{transfer.vehicle_reg}</p>
                      </div>
                      <p className="supporting-date-strong">{formatDate(transfer.date, language)}</p>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <span className="inline-flex rounded-full border border-slate-200/80 bg-slate-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-600">
                        {getTransferTypeLabel(t, transfer.transfer_type)}
                      </span>
                      <span className="inline-flex rounded-full border border-brand-100 bg-brand-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-800">
                        {receiptStatusOptions.find((option) => option.value === (transfer.receipt_status ?? "pending"))?.label}
                      </span>
                    </div>
                    <p className="primary-value-nowrap mt-2 text-base font-semibold text-slate-950">
                      {formatCurrency(transfer.amount, language)}
                    </p>
                    <p className="mt-2 text-sm leading-6 text-slate-500">
                      {transfer.fuel_log_id && fuelLogLookup.get(String(transfer.fuel_log_id))
                        ? `Linked fuel log ${fuelLogLookup.get(String(transfer.fuel_log_id))?.vehicle_reg} | ${formatDate(fuelLogLookup.get(String(transfer.fuel_log_id))?.date ?? "", language)}`
                        : transfer.notes || "-"}
                    </p>
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
                            transfer_type: normalizeTransferTypeKey(transfer.transfer_type) ?? transferTypeOptions[0].value,
                            receipt_status: transfer.receipt_status ?? "pending",
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

              <div className="hidden md:block">
                <div className="table-shell rounded-2xl">
                  <div className="table-scroll">
                    <table className="w-full min-w-[980px] text-sm">
                      <thead>
                        <tr className="bg-slate-50/70 text-slate-600">
                          <th className="table-head-cell text-left">{t.transfers.date}</th>
                          <th className="table-head-cell text-left">{t.transfers.driver}</th>
                          <th className="table-head-cell text-left">{t.fuelLogs.vehicleReg}</th>
                          <th className="table-head-cell text-left">{t.transfers.type}</th>
                          <th className="table-head-cell text-left">Receipt status</th>
                          <th className="table-head-cell text-right">{t.transfers.amount}</th>
                          <th className="table-head-cell text-left">{t.transfers.notes}</th>
                          <th className="table-head-cell text-left">{t.common.action}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pagedTransfers.map((transfer) => (
                          <tr key={transfer.id} className="enterprise-table-row">
                            <td className="table-body-cell supporting-date-strong">{formatDate(transfer.date, language)}</td>
                            <td className="table-body-cell whitespace-nowrap font-medium text-slate-900">{transfer.driver}</td>
                            <td className="table-body-cell whitespace-nowrap text-slate-700">{transfer.vehicle_reg}</td>
                            <td className="table-body-cell whitespace-nowrap text-slate-700">
                              {getTransferTypeLabel(t, transfer.transfer_type)}
                            </td>
                            <td className="table-body-cell whitespace-nowrap text-slate-700">
                              {receiptStatusOptions.find((option) => option.value === (transfer.receipt_status ?? "pending"))?.label}
                            </td>
                            <td className="table-body-cell text-right font-semibold text-slate-950">
                              {formatCurrency(transfer.amount, language)}
                            </td>
                            <td className="table-body-cell min-w-[220px] text-slate-600">
                              {transfer.fuel_log_id && fuelLogLookup.get(String(transfer.fuel_log_id))
                                ? `Linked fuel log ${fuelLogLookup.get(String(transfer.fuel_log_id))?.vehicle_reg} | ${formatDate(fuelLogLookup.get(String(transfer.fuel_log_id))?.date ?? "", language)}`
                                : transfer.notes || "-"}
                            </td>
                            <td className="table-body-cell">
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
                                      transfer_type: normalizeTransferTypeKey(transfer.transfer_type) ?? transferTypeOptions[0].value,
                                      receipt_status: transfer.receipt_status ?? "pending",
                                      notes: transfer.notes || ""
                                    })
                                  }
                                  className="table-action-secondary"
                                >
                                  {t.common.edit}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleDelete(String(transfer.id))}
                                  disabled={deletingId === transfer.id}
                                  className="table-action-danger gap-2 disabled:opacity-50"
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
              </div>

              <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-slate-500">
                  {t.common.page} {formatNumber(Math.min(currentPage, totalPages), language)} {t.common.of} {formatNumber(totalPages, language)}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                    disabled={currentPage === 1}
                    className="btn-secondary disabled:opacity-50"
                  >
                    {t.common.previous}
                  </button>
                  <button
                    type="button"
                    onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                    disabled={currentPage >= totalPages}
                    className="btn-secondary disabled:opacity-50"
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
