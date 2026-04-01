"use client";

import {
  ArrowRightLeft,
  CalendarRange,
  ClipboardList,
  Fuel,
  Truck,
  Wallet
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/empty-state";
import { Header } from "@/components/header";
import { fetchDrivers, fetchFuelLogs, fetchTransfers, fetchWeeklyMileage } from "@/lib/data";
import { getTransferTypeLabel } from "@/lib/localized-values";
import { useLanguage } from "@/lib/language-provider";
import { buildWeeklyMileageSummary, getSevenDayFuelTrend } from "@/lib/operations";
import { formatCurrency, formatDate, formatNumber } from "@/lib/utils";
import type {
  BankTransferWithDriver,
  Driver,
  FuelLogWithDriver,
  WeeklyMileageEntry
} from "@/types/database";

function isWithinRange(value: string, startDate: string, endDate: string) {
  if (!value) return false;
  if (startDate && value < startDate) return false;
  if (endDate && value > endDate) return false;
  return true;
}

function KpiCard({
  label,
  value,
  helper,
  icon: Icon
}: {
  label: string;
  value: string;
  helper: string;
  icon: typeof Wallet;
}) {
  return (
    <article className="surface-card-soft card-metric-shell min-h-[214px] sm:min-h-[228px]">
      <div className="card-metric-header">
        <div className="min-w-0 flex-1">
          <p className="metric-label">{label}</p>
          <p className="metric-value overflow-hidden text-ellipsis whitespace-nowrap text-slate-900">
            {value}
          </p>
        </div>
        <div className="card-metric-icon">
          <Icon className="h-4.5 w-4.5" />
        </div>
      </div>
      <p className="metric-helper">{helper}</p>
    </article>
  );
}

export default function DashboardPage() {
  const { language, t } = useLanguage();
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [fuelLogs, setFuelLogs] = useState<FuelLogWithDriver[]>([]);
  const [transfers, setTransfers] = useState<BankTransferWithDriver[]>([]);
  const [weeklyMileage, setWeeklyMileage] = useState<WeeklyMileageEntry[]>([]);
  const [selectedDriverId, setSelectedDriverId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const [driverRows, fuelRows, transferRows, mileageRows] = await Promise.all([
        fetchDrivers(),
        fetchFuelLogs(),
        fetchTransfers(),
        fetchWeeklyMileage()
      ]);

      setDrivers(driverRows);
      setFuelLogs(fuelRows);
      setTransfers(transferRows);
      setWeeklyMileage(mileageRows);
    } catch {
      setError(t.dashboard.loadDashboardError);
    } finally {
      setLoading(false);
    }
  }, [t.dashboard.loadDashboardError]);

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

  const filteredFuelLogs = useMemo(
    () =>
      fuelLogs.filter((log) => {
        const driverMatch =
          !selectedDriverId || String(log.driver_id || "") === String(selectedDriverId);
        return driverMatch && isWithinRange(log.date, startDate, endDate);
      }),
    [endDate, fuelLogs, selectedDriverId, startDate]
  );

  const filteredTransfers = useMemo(
    () =>
      transfers.filter((transfer) => {
        const driverMatch =
          !selectedDriverId || String(transfer.driver_id || "") === String(selectedDriverId);
        return driverMatch && isWithinRange(transfer.date, startDate, endDate);
      }),
    [endDate, selectedDriverId, startDate, transfers]
  );

  const filteredWeeklyMileage = useMemo(
    () =>
      weeklyMileage.filter((entry) => {
        const driverMatch =
          !selectedDriverId || String(entry.driver_id || "") === String(selectedDriverId);
        return driverMatch && isWithinRange(entry.week_ending, startDate, endDate);
      }),
    [endDate, selectedDriverId, startDate, weeklyMileage]
  );

  const weeklySummaryRows = useMemo(
    () => buildWeeklyMileageSummary(filteredWeeklyMileage),
    [filteredWeeklyMileage]
  );
  const latestWeekRow = weeklySummaryRows[0] ?? null;
  const sevenDayFuelTrend = useMemo(() => getSevenDayFuelTrend(filteredFuelLogs), [filteredFuelLogs]);

  const totalFuelSpend = filteredFuelLogs.reduce((sum, log) => sum + Number(log.total_cost || 0), 0);
  const totalFuelLitres = filteredFuelLogs.reduce((sum, log) => sum + Number(log.litres || 0), 0);
  const totalTransfers = filteredTransfers.reduce(
    (sum, transfer) => sum + Number(transfer.amount || 0),
    0
  );
  const averagePricePerLitre = totalFuelLitres > 0 ? totalFuelSpend / totalFuelLitres : null;
  const currentWeeklyDistance = latestWeekRow?.weeklyDistance ?? 0;
  const vehiclesSubmitted = new Set(
    filteredWeeklyMileage.map((entry) => entry.vehicle_reg).filter(Boolean)
  ).size;

  const startOfCurrentWeek = useMemo(() => {
    const now = new Date();
    const day = now.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    now.setDate(now.getDate() + diff);
    now.setHours(0, 0, 0, 0);
    return now.toISOString().slice(0, 10);
  }, []);

  const topDriversThisWeek = useMemo(() => {
    const totals = new Map<string, { label: string; amount: number }>();

    filteredFuelLogs
      .filter((log) => log.date >= startOfCurrentWeek)
      .forEach((log) => {
        const key = String(log.driver_id || log.driver || log.vehicle_reg || log.id);
        const current = totals.get(key) ?? {
          label: log.driver || log.vehicle_reg || "-",
          amount: 0
        };

        current.amount += Number(log.total_cost || 0);
        totals.set(key, current);
      });

    return [...totals.values()].sort((left, right) => right.amount - left.amount).slice(0, 3);
  }, [filteredFuelLogs, startOfCurrentWeek]);

  const latestFuelLogs = useMemo(
    () =>
      [...filteredFuelLogs]
        .sort((left, right) => right.date.localeCompare(left.date) || String(right.id).localeCompare(String(left.id)))
        .slice(0, 5),
    [filteredFuelLogs]
  );

  const latestTransfers = useMemo(
    () =>
      [...filteredTransfers]
        .sort((left, right) => right.date.localeCompare(left.date) || String(right.id).localeCompare(String(left.id)))
        .slice(0, 5),
    [filteredTransfers]
  );

  const kpiCards = [
    {
      label: t.dashboard.totalFuelSpend,
      value: formatCurrency(totalFuelSpend, language),
      helper: `${formatNumber(filteredFuelLogs.length, language)} ${t.dashboard.fuelHelper}`,
      icon: Wallet
    },
    {
      label: t.dashboard.averagePricePerLitre,
      value: averagePricePerLitre != null ? formatCurrency(averagePricePerLitre, language) : "-",
      helper: t.dashboard.basedOnFilteredFuelEntries,
      icon: Fuel
    },
    {
      label: t.dashboard.totalTransfers,
      value: formatCurrency(totalTransfers, language),
      helper: `${formatNumber(filteredTransfers.length, language)} ${t.dashboard.transferHelper}`,
      icon: ArrowRightLeft
    },
    {
      label: t.dashboard.weeklyDistance,
      value: formatNumber(currentWeeklyDistance, language),
      helper: t.dashboard.weeklyMileageHelper,
      icon: Truck
    },
    {
      label: t.dashboard.vehiclesSubmitted,
      value: formatNumber(vehiclesSubmitted, language),
      helper: t.dashboard.weeklySummaryDescription,
      icon: ClipboardList
    },
    {
      label: t.weeklyMileage.lastUpdatedWeek,
      value: latestWeekRow ? formatDate(latestWeekRow.weekEnding, language) : "-",
      helper: latestWeekRow ? t.weeklyMileage.lastUpdatedWeekHelper : t.dashboard.noMileageDataDescription,
      icon: CalendarRange
    }
  ];

  return (
    <>
      <div className="mb-6 hidden md:block">
        <Header title={t.dashboard.title} description={t.dashboard.description} />
      </div>

      <section className="surface-card p-4 sm:p-5">
        <div className="mb-4 flex flex-col gap-3.5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-900">{t.dashboard.filtersTitle}</h3>
            <p className="mt-1 text-sm text-slate-500">{t.dashboard.filtersDescription}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setSelectedDriverId("");
              setStartDate("");
              setEndDate("");
            }}
            className="btn-secondary w-full sm:w-auto"
          >
            {t.dashboard.resetFilters}
          </button>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <label className="form-label">{t.dashboard.driverFilter}</label>
            <select value={selectedDriverId} onChange={(event) => setSelectedDriverId(event.target.value)}>
              <option value="">{t.dashboard.allDrivers}</option>
              {drivers.map((driver) => (
                <option key={driver.id} value={String(driver.id)}>
                  {driver.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label className="form-label">{t.dashboard.startDate}</label>
            <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
          </div>
          <div className="space-y-2">
            <label className="form-label">{t.dashboard.endDate}</label>
            <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
          </div>
        </div>
      </section>

      {error ? <p className="text-sm text-rose-600">{error}</p> : null}

      {loading ? (
        <EmptyState title={t.common.loading} description={t.dashboard.loadingData} />
      ) : (
        <>
          <section className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
            {kpiCards.map((card) => (
              <KpiCard key={card.label} {...card} />
            ))}
          </section>

          <section className="grid gap-4 xl:grid-cols-3">
            <section className="surface-card p-4 sm:p-5 xl:col-span-2">
              <div className="mb-3.5">
                <h3 className="text-base font-semibold text-slate-900">{t.dashboard.weeklySummaryTitle}</h3>
                <p className="mt-1 text-sm text-slate-500">{t.dashboard.weeklySummaryDescription}</p>
              </div>

              {weeklySummaryRows.length === 0 ? (
                <EmptyState
                  title={t.dashboard.noMileageDataTitle}
                  description={t.dashboard.noMileageDataDescription}
                />
              ) : (
                <div className="table-shell">
                  <div className="table-scroll">
                    <table className="w-full min-w-[760px]">
                      <thead>
                        <tr>
                          <th className="table-head-cell">{t.dashboard.table.weekEnding}</th>
                          <th className="table-head-cell">{t.dashboard.vehiclesSubmitted}</th>
                          <th className="table-head-cell">{t.dashboard.table.driver}</th>
                          <th className="table-head-cell text-right">{t.dashboard.highestOdometer}</th>
                          <th className="table-head-cell text-right">{t.dashboard.lowestOdometer}</th>
                          <th className="table-head-cell text-right">{t.dashboard.weeklyDistance}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {weeklySummaryRows.map((row) => (
                          <tr key={row.weekEnding} className="enterprise-table-row">
                            <td className="table-body-cell supporting-date-strong">
                              {formatDate(row.weekEnding, language)}
                            </td>
                            <td className="table-body-cell">{formatNumber(row.vehiclesSubmitted, language)}</td>
                            <td className="table-body-cell">{formatNumber(row.driversSubmitted, language)}</td>
                            <td className="table-body-cell text-right">
                              {row.highestOdometer != null ? formatNumber(row.highestOdometer, language) : "-"}
                            </td>
                            <td className="table-body-cell text-right">
                              {row.lowestOdometer != null ? formatNumber(row.lowestOdometer, language) : "-"}
                            </td>
                            <td className="table-body-cell text-right font-semibold text-slate-950">
                              {formatNumber(row.weeklyDistance, language)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </section>

            <section className="surface-card p-4 sm:p-5">
              <div className="mb-3.5">
                <h3 className="text-base font-semibold text-slate-900">
                  {language === "th" ? "7-day fuel spend trend" : "7-day fuel spend trend"}
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  {language === "th"
                    ? "Daily spend based on filtered fuel logs."
                    : "Daily spend based on filtered fuel logs."}
                </p>
              </div>
              <div className="space-y-2">
                {sevenDayFuelTrend.map((row) => (
                  <div key={row.date} className="grid grid-cols-[92px_minmax(0,1fr)_90px] items-center gap-3">
                    <span className="text-xs font-medium text-slate-500">{formatDate(row.date, language)}</span>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-brand-500"
                        style={{
                          width: `${
                            sevenDayFuelTrend.some((entry) => entry.spend > 0)
                              ? (row.spend /
                                  Math.max(...sevenDayFuelTrend.map((entry) => entry.spend || 0), 1)) *
                                100
                              : 0
                          }%`
                        }}
                      />
                    </div>
                    <span className="text-right text-xs font-semibold text-slate-900">
                      {formatCurrency(row.spend, language)}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          </section>

          <section className="grid gap-4 xl:grid-cols-[minmax(0,0.88fr)_minmax(0,1.12fr)]">
            <section className="surface-card p-4 sm:p-5">
              <div className="mb-3.5">
                <h3 className="text-base font-semibold text-slate-900">
                  {language === "th" ? "Top 3 drivers by fuel spend" : "Top 3 drivers by fuel spend"}
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  {language === "th"
                    ? "Current-week spend using filtered data."
                    : "Current-week spend using filtered data."}
                </p>
              </div>
              <div className="space-y-2">
                {topDriversThisWeek.length ? (
                  topDriversThisWeek.map((driver, index) => (
                    <div
                      key={`${driver.label}-${index}`}
                      className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200/70 bg-white/80 px-3 py-2"
                    >
                      <span className="truncate text-sm font-medium text-slate-900">
                        {index + 1}. {driver.label}
                      </span>
                      <span className="shrink-0 text-sm font-semibold text-slate-950">
                        {formatCurrency(driver.amount, language)}
                      </span>
                    </div>
                  ))
                ) : (
                  <EmptyState title={t.dashboard.noFuelTitle} description={t.dashboard.noFuelDescription} />
                )}
              </div>
            </section>

            <section className="surface-card p-4 sm:p-5">
              <div className="mb-3.5">
                <h3 className="text-base font-semibold text-slate-900">{t.dashboard.watchlistTitle}</h3>
                <p className="mt-1 text-sm text-slate-500">{t.dashboard.watchlistDescription}</p>
              </div>
              <div className="space-y-3">
                <div className="subtle-panel p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    {t.dashboard.topFuelDriver}
                  </p>
                  <p className="mt-1 text-base font-semibold text-slate-950">
                    {topDriversThisWeek[0]?.label ?? "-"}
                  </p>
                </div>
                <div className="subtle-panel p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    {t.dashboard.averagePricePerLitre}
                  </p>
                  <p className="mt-1 text-base font-semibold text-slate-950">
                    {averagePricePerLitre != null ? formatCurrency(averagePricePerLitre, language) : "-"}
                  </p>
                </div>
                <div className="subtle-panel p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    {t.dashboard.largestTransfer}
                  </p>
                  <p className="mt-1 text-base font-semibold text-slate-950">
                    {latestTransfers[0] ? formatCurrency(Number(latestTransfers[0].amount || 0), language) : "-"}
                  </p>
                </div>
              </div>
            </section>
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            <section className="surface-card p-4 sm:p-5">
              <div className="mb-3.5">
                <h3 className="text-base font-semibold text-slate-900">{t.dashboard.latestFuelActivity}</h3>
                <p className="mt-1 text-sm text-slate-500">{t.dashboard.latestFuelDescription}</p>
              </div>

              {latestFuelLogs.length === 0 ? (
                <EmptyState title={t.dashboard.noFuelTitle} description={t.dashboard.noFuelDescription} />
              ) : (
                <div className="table-shell">
                  <div className="table-scroll">
                    <table className="w-full min-w-[620px]">
                      <thead>
                        <tr>
                          <th className="table-head-cell">{t.dashboard.table.date}</th>
                          <th className="table-head-cell">{t.dashboard.table.driver}</th>
                          <th className="table-head-cell">{t.dashboard.table.vehicle}</th>
                          <th className="table-head-cell text-right">{t.dashboard.table.cost}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {latestFuelLogs.map((log) => (
                          <tr key={log.id} className="enterprise-table-row">
                            <td className="table-body-cell supporting-date-strong">{formatDate(log.date, language)}</td>
                            <td className="table-body-cell">{log.driver || "-"}</td>
                            <td className="table-body-cell">{log.vehicle_reg || "-"}</td>
                            <td className="table-body-cell text-right font-semibold text-slate-950">
                              {formatCurrency(Number(log.total_cost || 0), language)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </section>

            <section className="surface-card p-4 sm:p-5">
              <div className="mb-3.5">
                <h3 className="text-base font-semibold text-slate-900">{t.dashboard.latestTransfers}</h3>
                <p className="mt-1 text-sm text-slate-500">{t.dashboard.latestTransferDescription}</p>
              </div>

              {latestTransfers.length === 0 ? (
                <EmptyState title={t.dashboard.noTransferTitle} description={t.dashboard.noTransferDescription} />
              ) : (
                <div className="table-shell">
                  <div className="table-scroll">
                    <table className="w-full min-w-[620px]">
                      <thead>
                        <tr>
                          <th className="table-head-cell">{t.dashboard.table.date}</th>
                          <th className="table-head-cell">{t.dashboard.table.driver}</th>
                          <th className="table-head-cell">{t.dashboard.table.type}</th>
                          <th className="table-head-cell text-right">{t.dashboard.table.amount}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {latestTransfers.map((transfer) => (
                          <tr key={transfer.id} className="enterprise-table-row">
                            <td className="table-body-cell supporting-date-strong">
                              {formatDate(transfer.date, language)}
                            </td>
                            <td className="table-body-cell">{transfer.driver || "-"}</td>
                            <td className="table-body-cell">{getTransferTypeLabel(t, transfer.transfer_type)}</td>
                            <td className="table-body-cell text-right font-semibold text-slate-950">
                              {formatCurrency(Number(transfer.amount || 0), language)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </section>
          </section>
        </>
      )}
    </>
  );
}
