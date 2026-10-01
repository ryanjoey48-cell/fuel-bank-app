"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, FileCheck2, FileText, X } from "lucide-react";
import { useLanguage } from "@/lib/language-provider";
import { useAccountAccess } from "@/lib/use-account-access";
import {
  deleteMaintenanceRecord,
  viewMaintenanceAttachment,
} from "@/lib/maintenance-data";
import {
  buildMaintenanceReminders,
  maintenanceDowntime,
  receiptDifference,
  maintenanceDriver,
} from "@/lib/maintenance";
import {
  maintenanceCategoryTone,
  maintenanceHighCostThreshold,
  maintenanceVehicleType,
  nearestMaintenanceMileage,
} from "@/lib/maintenance-ux";
import { maintenanceCategoryShortLabels } from "@/lib/maintenance-translations";
import type {
  MaintenanceData,
  MaintenanceRecord,
  MaintenanceReminder,
} from "@/lib/maintenance-types";
import { formatCurrency, formatDate, formatNumber } from "@/lib/utils";
import { MaintenanceItemTable } from "./maintenance-item-table";
import { MaintenanceAttachmentList } from "./maintenance-attachments";

export function MaintenanceVisit({
  record,
  data,
  onEdit,
  onChanged,
  reminders,
  detailed = false,
}: {
  record: MaintenanceRecord;
  data: MaintenanceData;
  onEdit: (record: MaintenanceRecord) => void;
  onChanged: () => void;
  reminders?: MaintenanceReminder[];
  detailed?: boolean;
}) {
  const { t, language } = useLanguage();
  const c = t.maintenance;
  const { can } = useAccountAccess();

  const [expanded, setExpanded] = useState(detailed);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const receiptsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setExpanded(detailed);
  }, [detailed]);

  useEffect(() => {
    if (!expanded) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false);
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [expanded]);

  const items = data.items
    .filter((item) => item.record_id === record.id)
    .sort((a, b) => a.position - b.position);

  const categories = Array.from(new Set(items.map((item) => item.category)));
  const attachments = data.attachments.filter(
    (attachment) => attachment.record_id === record.id
  );

  const currentReminders = (
    reminders ?? buildMaintenanceReminders(data)
  ).filter((reminder) => reminder.record_id === record.id);

  const difference = receiptDifference(
    Number(record.calculated_total),
    record.receipt_total === null ? null : Number(record.receipt_total)
  );

  const vehicle = data.vehicles.find(
    (item) => item.id === record.vehicle_id
  );

  const driver =
    maintenanceDriver(data, record.vehicle_id) || c.unassigned;

  const vehicleType = maintenanceVehicleType(
    vehicle?.vehicle_type,
    t.weeklyMileage.oil.vehicleTypes
  );

  const inferredMileage =
    record.odometer === null
      ? nearestMaintenanceMileage(
          data,
          record.vehicle_id,
          record.service_date
        )
      : null;

  const highCostThreshold = maintenanceHighCostThreshold(data.records);
  const highCost =
    highCostThreshold !== null &&
    Number(record.calculated_total) >= highCostThreshold;

  const mileageValue =
    record.odometer !== null
      ? formatNumber(record.odometer, language)
      : inferredMileage
      ? `${formatNumber(inferredMileage.value, language)}`
      : "—";

  const openReceipt = async () => {
    setError(null);

    if (attachments.length > 1) {
      setExpanded(true);
      window.setTimeout(
        () =>
          receiptsRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "center",
          }),
        0
      );
      return;
    }

    if (!attachments.length) return;

    const tab = window.open("about:blank", "_blank");
    if (tab) tab.opener = null;

    setBusy(true);

    try {
      const url = await viewMaintenanceAttachment(attachments[0]);

      if (tab) {
        tab.location.href = url;
      } else {
        window.location.assign(url);
      }
    } catch {
      tab?.close();
      setError(c.receiptOpenError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <article
      className="min-w-0 overflow-hidden rounded-2xl border border-slate-200/80 bg-white transition-shadow duration-200 hover:border-violet-200 hover:shadow-[0_8px_22px_rgba(67,56,202,0.07)]"
    >
      {/* COMPACT RECORD */}
      <div className="p-4">
        <div className="grid gap-4 lg:grid-cols-[1.15fr_1.35fr_1.55fr_1fr_auto] lg:items-center">
          {/* VEHICLE */}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-lg font-bold tracking-tight text-slate-950">
                {vehicle?.vehicle_reg ?? "—"}
              </h4>

              {highCost && (
                <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800">
                  {c.highCostRepair}
                </span>
              )}

              {record.is_deleted && (
                <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-700">
                  {c.deleted}
                </span>
              )}
            </div>

            <p className="mt-1 truncate text-xs text-slate-500">
              {driver} · {vehicleType}
            </p>
          </div>

          {/* SERVICE */}
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
              {c.serviceDate}
            </p>
            <p className="mt-1 text-sm font-semibold text-slate-900">
              {formatDate(record.service_date, language)}
            </p>
            <p
              className="mt-0.5 truncate text-xs text-slate-500"
              title={record.garage || "—"}
            >
              {record.garage || "—"}
            </p>
          </div>

          {/* WORK */}
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                {items.length === 1 ? c.maintenanceItem : c.maintenanceItemsCount}
              </p>
              <span className="text-sm font-semibold text-slate-900">
                {formatNumber(items.length, language)}
              </span>
            </div>

            <div className="mt-1.5 flex min-w-0 flex-wrap gap-1">
              {categories.slice(0, 2).map((category) => (
                <span
                  key={category}
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${maintenanceCategoryTone[category]}`}
                >
                  {maintenanceCategoryShortLabels[language][category]}
                </span>
              ))}

              {categories.length > 2 && (
                <span
                  title={categories
                    .slice(2)
                    .map(
                      (category) =>
                        maintenanceCategoryShortLabels[language][category]
                    )
                    .join(", ")}
                  className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600"
                >
                  +{categories.length - 2}
                </span>
              )}

              {attachments.length > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                  <FileCheck2 className="h-3 w-3" />
                  {attachments.length === 1 ? c.receiptAttached : `${attachments.length}`}
                </span>
              )}

              {difference === 0 && (
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                  ✓ {c.matched}
                </span>
              )}
            </div>
          </div>

          {/* COST */}
          <div className="min-w-0 lg:text-right">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
              {c.recordTotal}
            </p>
            <p className="mt-1 whitespace-nowrap text-base font-bold tracking-tight text-violet-950">
              {formatCurrency(Number(record.calculated_total), language)}
            </p>
            {difference !== null && difference !== 0 && (
              <p className="mt-1 text-[11px] font-semibold text-amber-700">
                ⚠ {c.difference}: {formatCurrency(difference, language)}
              </p>
            )}
          </div>

          {/* ACTIONS */}
          <div className="flex items-center justify-end gap-2">
            {attachments.length > 0 && (
              <button
                type="button"
                disabled={busy}
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:border-violet-200 hover:text-violet-700 disabled:opacity-50"
                onClick={() => void openReceipt()}
                title={attachments.length > 1 ? c.viewReceipts : c.viewReceipt}
                aria-label={attachments.length > 1 ? c.viewReceipts : c.viewReceipt}
              >
                <FileText className="h-4 w-4" aria-hidden="true" />
              </button>
            )}

            <button
              type="button"
              className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-violet-100 bg-violet-50/70 px-3 text-sm font-semibold text-violet-800 transition hover:bg-violet-100"
              aria-haspopup="dialog"
              onClick={() => setExpanded(true)}
            >
              {c.viewRecord}
              <ChevronDown className="h-4 w-4" />
            </button>
          </div>
        </div>

        {(record.odometer !== null ||
          inferredMileage ||
          record.receipt_reference) && (
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-slate-100 pt-2.5 text-[11px] text-slate-500">
            {(record.odometer !== null || inferredMileage) && (
              <span>
                {record.odometer !== null ? c.mileage : c.inferredMileage}:{" "}
                <strong className="font-semibold text-slate-700">
                  {mileageValue}
                </strong>
                {inferredMileage && (
                  <span> · {formatDate(inferredMileage.date, language)}</span>
                )}
              </span>
            )}

            {record.receipt_reference && (
              <span>
                {c.receiptReference}:{" "}
                <strong className="font-semibold text-slate-700">
                  {record.receipt_reference}
                </strong>
              </span>
            )}
          </div>
        )}

        {error && (
          <p
            role="alert"
            className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700"
          >
            {error}
          </p>
        )}
      </div>

      {expanded && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/45 p-3 backdrop-blur-[2px] sm:p-5"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setExpanded(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-label={`${vehicle?.vehicle_reg ?? ""} ${c.viewRecord}`}
            className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-violet-100 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.28)]"
          >
            {/* MODAL HEADER */}
            <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-100 bg-white px-5 py-4 sm:px-6">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-xl font-bold tracking-tight text-slate-950 sm:text-2xl">
                    {vehicle?.vehicle_reg ?? "—"}
                  </h3>

                  {highCost && (
                    <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800">
                      {c.highCostRepair}
                    </span>
                  )}

                  {record.is_deleted && (
                    <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-700">
                      {c.deleted}
                    </span>
                  )}
                </div>

                <p className="mt-1 text-sm text-slate-500">
                  {formatDate(record.service_date, language)} · {record.garage || "—"}
                </p>
              </div>

              <button
                type="button"
                aria-label="Close"
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700"
                onClick={() => setExpanded(false)}
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </header>

            {/* MODAL CONTENT */}
            <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/60 px-5 py-5 sm:px-6">
              <div className="space-y-5">
                {/* ESSENTIAL RECORD SNAPSHOT */}
                <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {[
                    [c.driver, driver],
                    [c.vehicleType, vehicleType],
                    [c.mileage, mileageValue],
                    [c.recordTotal, formatCurrency(Number(record.calculated_total), language)],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-2xl border border-slate-200 bg-white p-4">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                        {label}
                      </p>
                      <p className="mt-1.5 break-words text-sm font-semibold text-slate-900">
                        {value}
                      </p>
                    </div>
                  ))}
                </section>

                {/* RECEIPT CHECK */}
                {(record.receipt_total !== null || record.receipt_reference || difference !== null) && (
                  <section
                    className={[
                      "rounded-2xl border px-4 py-3",
                      difference !== null && difference !== 0
                        ? "border-amber-300 bg-amber-50 text-amber-900"
                        : "border-emerald-200 bg-emerald-50/70 text-emerald-950",
                    ].join(" ")}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-[0.14em]">
                          {c.receiptCheck}
                        </p>
                        <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-sm">
                          <span>
                            {c.enteredTotal}: <strong>{formatCurrency(Number(record.calculated_total), language)}</strong>
                          </span>
                          <span>
                            {c.receiptTotal}: <strong>{record.receipt_total === null ? "—" : formatCurrency(Number(record.receipt_total), language)}</strong>
                          </span>
                          {record.receipt_reference && (
                            <span>
                              {c.receiptReference}: <strong>{record.receipt_reference}</strong>
                            </span>
                          )}
                        </div>
                      </div>

                      {difference !== null && (
                        <span className="text-sm font-semibold">
                          {difference === 0
                            ? `✓ ${c.matched}`
                            : `⚠ ${c.difference}: ${formatCurrency(difference, language)}`}
                        </span>
                      )}
                    </div>
                  </section>
                )}

                {/* MAINTENANCE ITEMS */}
                <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                  <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
                    <div>
                      <h4 className="text-sm font-semibold text-slate-900">{c.maintenanceItemsCount}</h4>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {formatNumber(items.length, language)}
                      </p>
                    </div>
                    <div className="flex flex-wrap justify-end gap-1">
                      {categories.slice(0, 4).map((category) => (
                        <span
                          key={category}
                          className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${maintenanceCategoryTone[category]}`}
                        >
                          {maintenanceCategoryShortLabels[language][category]}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="max-h-[38vh] overflow-y-auto">
                    <MaintenanceItemTable items={items} record={record} />
                  </div>
                </section>

                {/* OPTIONAL INFORMATION */}
                {(currentReminders.length > 0 || record.notes || record.off_road_at) && (
                  <section className="grid gap-3 lg:grid-cols-2">
                    {currentReminders.length > 0 && (
                      <div className="rounded-2xl border border-violet-100 bg-white p-4">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                          {c.remindersToday}
                        </p>
                        <div className="mt-2 space-y-2">
                          {currentReminders.map((reminder) => (
                            <p key={reminder.key} className="text-sm text-slate-700">
                              <strong>{reminder.name}</strong>
                              <span className="text-slate-500">
                                {" "}· {reminder.mileage_unavailable && reminder.status === "ok" ? c.unassessed : c[reminder.status]}
                              </span>
                            </p>
                          ))}
                        </div>
                      </div>
                    )}

                    {(record.notes || record.off_road_at) && (
                      <div className="rounded-2xl border border-slate-200 bg-white p-4">
                        {record.notes && (
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                              {c.generalNotes}
                            </p>
                            <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-700">
                              {record.notes}
                            </p>
                          </div>
                        )}

                        {record.off_road_at && (
                          <div className={record.notes ? "mt-4 border-t border-slate-100 pt-4" : ""}>
                            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                              {c.downtime}
                            </p>
                            <p className="mt-1 text-sm font-semibold text-slate-800">
                              {formatNumber(maintenanceDowntime(record), language, 1)} {c.hours}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                              {new Date(record.off_road_at).toLocaleString(language, { timeZone: "Asia/Bangkok" })}
                              {" → "}
                              {record.returned_at
                                ? new Date(record.returned_at).toLocaleString(language, { timeZone: "Asia/Bangkok" })
                                : c.ongoing}
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </section>
                )}

                {/* RECEIPTS */}
                <section ref={receiptsRef} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h4 className="text-sm font-semibold text-slate-900">{c.attachments}</h4>
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-500">
                      {attachments.length}
                    </span>
                  </div>

                  {attachments.length ? (
                    <MaintenanceAttachmentList attachments={attachments} onChange={onChanged} />
                  ) : (
                    <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                      {c.noReceipt}
                    </p>
                  )}
                </section>

                {/* AUDIT */}
                <details className="rounded-2xl border border-slate-200 bg-white p-4 text-xs text-slate-500">
                  <summary className="cursor-pointer font-medium text-slate-700">
                    {c.auditDetails}
                  </summary>
                  <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                    {[
                      [c.createdBy, record.created_by],
                      [c.updatedBy, record.updated_by],
                      [c.createdAt, new Date(record.created_at).toLocaleString(language)],
                      [c.updatedAt, new Date(record.updated_at).toLocaleString(language)],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <dt>{label}</dt>
                        <dd className="mt-0.5 break-all text-slate-700">{value}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
              </div>
            </div>

            {/* MODAL FOOTER */}
            <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-white px-5 py-4 sm:px-6">
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span>{formatDate(record.service_date, language)}</span>
                <span>·</span>
                <span>{record.garage || "—"}</span>
              </div>

              {!record.is_deleted && (
                <div className="flex flex-wrap gap-2">
                  {attachments.length > 0 && (
                    <button
                      type="button"
                      className="btn-secondary min-h-10"
                      disabled={busy}
                      onClick={() => void openReceipt()}
                    >
                      <FileText className="mr-2 h-4 w-4" aria-hidden="true" />
                      {attachments.length > 1 ? c.viewReceipts : c.viewReceipt}
                    </button>
                  )}

                  {can("business:write") && (
                    <button
                      type="button"
                      className="btn-secondary min-h-10"
                      disabled={busy}
                      onClick={() => {
                        setExpanded(false);
                        onEdit(record);
                      }}
                    >
                      {c.edit}
                    </button>
                  )}

                  {can("business:delete") && (
                    <button
                      type="button"
                      className="btn-secondary min-h-10 text-rose-700"
                      disabled={busy}
                      onClick={async () => {
                        if (!window.confirm(c.confirmDelete)) return;
                        setBusy(true);
                        setError(null);
                        try {
                          await deleteMaintenanceRecord(record);
                          setExpanded(false);
                          onChanged();
                        } catch {
                          setError(c.saveError);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      {c.delete}
                    </button>
                  )}
                </div>
              )}
            </footer>
          </section>
        </div>
      )}
    </article>
  );
}
