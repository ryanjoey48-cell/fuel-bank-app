"use client";

import { ArrowRightLeft, Fuel, Truck, Wallet } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/empty-state";
import { Header } from "@/components/header";
import { fetchDrivers, fetchFuelLogs, fetchTransfers, fetchWeeklyMileage } from "@/lib/data";
import { getTransferTypeLabel } from "@/lib/localized-values";
import { useLanguage } from "@/lib/language-provider";
import { buildWeeklyMileageSummary } from "@/lib/operations";
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

const KpiCard = memo(function KpiCard({
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
    <article className="surface-card-soft card-metric-shell">
      <div className="card-metric-header">
        <div className="min-w-0 flex-1">
          <p className="metric-label">{label}</p>
          <p className="metric-value text-slate-950">{value}</p>
        </div>
        <div className="card-metric-icon">
          <Icon className="h-4.5 w-4.5" />
        </div>
      </div>
      <p className="metric-helper">{helper}</p>
    </article>
  );
});

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
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(
    async (showBlockingLoader = false) => {
      try {
        if (showBlockingLoader) {
          setLoading(true);
        } else {
          setRefreshing(true);
        }
        setError(null);

        const [driverRows, fuelRows, transferRows, mileageRows] = await Promise.all([
          fetchDrivers(),
          fetchFuelLogs(),
          fetchTransfers(),
          fetchWeeklyMileage()
        ]);

        console.log("Dashboard load success", {
          drivers: driverRows.length,
          fuelLogs: fuelRows.length,
          transfers: transferRows.length,
          weeklyMileage: mileageRows.length
        });

        setDrivers(driverRows);
        setFuelLogs(fuelRows);
        setTransfers(transferRows);
        setWeeklyMileage(mileageRows);
      } catch (error) {
        console.error("Dashboard load error:", error);
        setError(t.dashboard.loadDashboardError);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [t.dashboard.loadDashboardError]
  );

  useEffect(() => {
    void loadData(true);
  }, [loadData]);

  useEffect(() => {
    const handleDataChanged = () => {
      void loadData(false);
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
  const totalFuelSpend = filteredFuelLogs.reduce((sum, log) => sum + Number(log.total_cost || 0), 0);
  const totalFuelLitres = filteredFuelLogs.reduce((sum, log) => sum + Number(log.litres || 0), 0);
  const totalTransfers = filteredTransfers.reduce(
    (sum, transfer) => sum + Number(transfer.amount || 0),
    0
  );
  const averagePricePerLitre = totalFuelLitres > 0 ? totalFuelSpend / totalFuelLitres : null;
  const currentWeeklyDistance = latestWeekRow?.weeklyDistance ?? 0;

  const latestFuelLogs = useMemo(
    () =>
      [...filteredFuelLogs]
        .sort(
          (left, right) =>
            right.date.localeCompare(left.date) || String(right.id).localeCompare(String(left.id))
        )
        .slice(0, 5),
    [filteredFuelLogs]
  );

  const latestTransfers = useMemo(
    () =>
      [...filteredTransfers]
        .sort(
          (left, right) =>
            right.date.localeCompare(left.date) || String(right.id).localeCompare(String(left.id))
        )
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
      label: t.dashboard.weeklyDistance,
      value: formatNumber(currentWeeklyDistance, language),
      helper: latestWeekRow ? formatDate(latestWeekRow.weekEnding, language) : t.dashboard.noMileageDataDescription,
      icon: Truck
    },
    {
      label: t.dashboard.totalTransfers,
      value: formatCurrency(totalTransfers, language),
      helper: `${formatNumber(filteredTransfers.length, language)} ${t.dashboard.transferHelper}`,
      icon: ArrowRightLeft
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
          <div className="flex items-center gap-3">
            {refreshing ? <span className="loading-inline">{t.common.loading}</span> : null}
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
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {kpiCards.map((card) => (
              <KpiCard key={card.label} {...card} />
            ))}
          </section>

          <section className="surface-card p-5 sm:p-6">
              <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h3 className="section-title">{t.dashboard.weeklySummaryTitle}</h3>
                  <p className="section-subtitle">{t.dashboard.weeklySummaryDescription}</p>
                </div>
                {latestWeekRow ? (
                  <span className="badge-muted">{formatDate(latestWeekRow.weekEnding, language)}</span>
                ) : null}
              </div>

              {latestWeekRow ? (
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="subtle-panel p-4">
                    <p className="metric-label">{t.dashboard.weeklyDistance}</p>
                    <p className="mt-2 text-[2rem] font-semibold tracking-[-0.05em] text-slate-950">
                      {formatNumber(latestWeekRow.weeklyDistance, language)}
                    </p>
                  </div>
                  <div className="subtle-panel p-4">
                    <p className="metric-label">{t.dashboard.highestOdometer}</p>
                    <p className="mt-2 text-[1.55rem] font-semibold tracking-[-0.04em] text-slate-950">
                      {latestWeekRow.highestOdometer != null
                        ? formatNumber(latestWeekRow.highestOdometer, language)
                        : "-"}
                    </p>
                  </div>
                  <div className="subtle-panel p-4">
                    <p className="metric-label">{t.dashboard.lowestOdometer}</p>
                    <p className="mt-2 text-[1.55rem] font-semibold tracking-[-0.04em] text-slate-950">
                      {latestWeekRow.lowestOdometer != null
                        ? formatNumber(latestWeekRow.lowestOdometer, language)
                        : "-"}
                    </p>
                  </div>
                </div>
              ) : (
                <EmptyState
                  title={t.dashboard.noMileageDataTitle}
                  description={t.dashboard.noMileageDataDescription}
                />
              )}

              {weeklySummaryRows.length > 0 ? (
                <div className="mt-4 table-shell">
                  <div className="table-scroll">
                    <table className="w-full min-w-[620px]">
                      <thead>
                        <tr>
                          <th className="table-head-cell">{t.dashboard.table.weekEnding}</th>
                          <th className="table-head-cell text-right">{t.dashboard.highestOdometer}</th>
                          <th className="table-head-cell text-right">{t.dashboard.lowestOdometer}</th>
                          <th className="table-head-cell text-right">{t.dashboard.weeklyDistance}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {weeklySummaryRows.slice(0, 4).map((row) => (
                          <tr key={row.weekEnding} className="enterprise-table-row">
                            <td className="table-body-cell supporting-date-strong">
                              {formatDate(row.weekEnding, language)}
                            </td>
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
              ) : null}
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            <section className="surface-card p-5 sm:p-6">
              <div className="mb-4">
                <h3 className="section-title">{t.dashboard.latestFuelActivity}</h3>
                <p className="section-subtitle">{t.dashboard.latestFuelDescription}</p>
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
                            <td className="table-body-cell table-driver-name">{log.driver || "-"}</td>
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

            <section className="surface-card p-5 sm:p-6">
              <div className="mb-4">
                <h3 className="section-title">{t.dashboard.latestTransfers}</h3>
                <p className="section-subtitle">{t.dashboard.latestTransferDescription}</p>
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
                            <td className="table-body-cell table-driver-name">{transfer.driver || "-"}</td>
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
