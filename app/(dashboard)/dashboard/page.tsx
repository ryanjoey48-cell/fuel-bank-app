"use client";

import { CreditCard, Droplets, FileText, Route, TrendingDown, TrendingUp, Truck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/empty-state";
import { Header } from "@/components/header";
import { StatCard } from "@/components/stat-card";
import { fetchDrivers, fetchFuelLogs, fetchTransfers, fetchWeeklyMileage } from "@/lib/data";
import { useLanguage } from "@/lib/language-provider";
import { formatCurrency, formatDate, formatNumber } from "@/lib/utils";
import type {
  BankTransferWithDriver,
  Driver,
  FuelLogWithDriver,
  WeeklyMileageEntry
} from "@/types/database";

type WeeklySummaryRow = {
  weekEnding: string;
  mileage: number;
  submitted: number;
};

function getWeekEnding(dateValue: string) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const date = new Date(year, (month || 1) - 1, day || 1);
  const daysUntilSunday = (7 - date.getDay()) % 7;
  date.setDate(date.getDate() + daysUntilSunday);
  return date.toISOString().slice(0, 10);
}

export default function DashboardPage() {
  const { language, t } = useLanguage();
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [fuelLogs, setFuelLogs] = useState<FuelLogWithDriver[]>([]);
  const [transfers, setTransfers] = useState<BankTransferWithDriver[]>([]);
  const [weeklyMileage, setWeeklyMileage] = useState<WeeklyMileageEntry[]>([]);
  const [driverFilter, setDriverFilter] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadDashboard = async () => {
      try {
        setLoading(true);
        setError(null);

        const [driverRows, fuelRows, transferRows, weeklyRows] = await Promise.all([
          fetchDrivers(),
          fetchFuelLogs(),
          fetchTransfers(),
          fetchWeeklyMileage()
        ]);

        setDrivers(driverRows);
        setFuelLogs(fuelRows);
        setTransfers(transferRows);
        setWeeklyMileage(weeklyRows);
      } catch (err) {
        setError(err instanceof Error ? err.message : t.dashboard.loadDashboardError);
      } finally {
        setLoading(false);
      }
    };

    void loadDashboard();
  }, [t.dashboard.loadDashboardError]);

  const matchesFilter = (date: string, driverId: string | number) => {
    const afterStart = !startDate || date >= startDate;
    const beforeEnd = !endDate || date <= endDate;
    const matchesDriver = driverFilter === "all" || String(driverId) === String(driverFilter);
    return afterStart && beforeEnd && matchesDriver;
  };

  const filteredFuelLogs = useMemo(
    () => fuelLogs.filter((item) => matchesFilter(item.date, item.driver_id)),
    [fuelLogs, driverFilter, startDate, endDate]
  );

  const filteredTransfers = useMemo(
    () => transfers.filter((item) => matchesFilter(item.date, item.driver_id)),
    [transfers, driverFilter, startDate, endDate]
  );

  const filteredWeeklyMileage = useMemo(
    () => weeklyMileage.filter((item) => matchesFilter(item.week_ending, item.driver_id)),
    [weeklyMileage, driverFilter, startDate, endDate]
  );

  const totalFuelSpend = filteredFuelLogs.reduce((sum, item) => sum + Number(item.total_cost || 0), 0);
  const totalTransfers = filteredTransfers.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const totalWeeklyMileage = filteredWeeklyMileage.reduce(
    (sum, item) => sum + Number(item.mileage || 0),
    0
  );
  const totalLitres = filteredFuelLogs.reduce((sum, item) => sum + Number(item.litres || 0), 0);
  const uniqueReportingWeeks = new Set(filteredWeeklyMileage.map((item) => item.week_ending)).size;

  const activeDrivers = new Set(
    [
      ...filteredFuelLogs.map((item) => item.driver_id),
      ...filteredTransfers.map((item) => item.driver_id),
      ...filteredWeeklyMileage.map((item) => item.driver_id)
    ]
      .filter(Boolean)
      .map(String)
  ).size;

  const weeklySummaryRows = useMemo(() => {
    return Array.from(
      filteredWeeklyMileage.reduce((map, entry) => {
        const current = map.get(entry.week_ending) ?? {
          weekEnding: entry.week_ending,
          mileage: 0,
          submittedVehicles: new Set<string>()
        };

        current.mileage += Number(entry.mileage || 0);
        current.submittedVehicles.add(entry.vehicle_reg || String(entry.driver_id));
        map.set(entry.week_ending, current);
        return map;
      }, new Map<string, { weekEnding: string; mileage: number; submittedVehicles: Set<string> }>())
    )
      .map(([, value]) => ({
        weekEnding: value.weekEnding,
        mileage: value.mileage,
        submitted: value.submittedVehicles.size
      }))
      .sort((a, b) => new Date(b.weekEnding).getTime() - new Date(a.weekEnding).getTime())
      .slice(0, 6);
  }, [filteredWeeklyMileage]);

  const latestWeekRow = weeklySummaryRows[0] ?? null;
  const previousWeekRow = weeklySummaryRows[1] ?? null;
  const weeklyChange = latestWeekRow ? latestWeekRow.mileage - (previousWeekRow?.mileage ?? 0) : 0;

  const weeklyFuelSpendRows = useMemo(() => {
    return Array.from(
      filteredFuelLogs.reduce((map, log) => {
        const weekEnding = getWeekEnding(log.date);
        map.set(weekEnding, (map.get(weekEnding) || 0) + Number(log.total_cost || 0));
        return map;
      }, new Map<string, number>())
    )
      .map(([weekEnding, amount]) => ({ weekEnding, amount }))
      .sort((a, b) => new Date(b.weekEnding).getTime() - new Date(a.weekEnding).getTime());
  }, [filteredFuelLogs]);

  const currentFuelWeekRow = latestWeekRow
    ? weeklyFuelSpendRows.find((row) => row.weekEnding === latestWeekRow.weekEnding) ?? null
    : weeklyFuelSpendRows[0] ?? null;
  const previousFuelWeekRow =
    currentFuelWeekRow
      ? weeklyFuelSpendRows.find((row) => row.weekEnding !== currentFuelWeekRow.weekEnding) ?? null
      : null;

  const driverCostPerKmRows = useMemo(() => {
    const mileageTotals = filteredWeeklyMileage.reduce((map, entry) => {
      const key = String(entry.driver_id);
      map.set(key, (map.get(key) || 0) + Number(entry.mileage || 0));
      return map;
    }, new Map<string, number>());

    const fuelTotals = filteredFuelLogs.reduce((map, log) => {
      const key = String(log.driver_id);
      const current = map.get(key) ?? { driver: log.driver || "-", amount: 0 };
      current.amount += Number(log.total_cost || 0);
      current.driver = log.driver || current.driver;
      map.set(key, current);
      return map;
    }, new Map<string, { driver: string; amount: number }>());

    return Array.from(fuelTotals.entries())
      .map(([driverId, fuel]) => {
        const mileage = mileageTotals.get(driverId) || 0;
        return {
          driverId,
          driver: fuel.driver,
          costPerKm: mileage > 0 ? fuel.amount / mileage : null
        };
      })
      .filter((row) => row.costPerKm != null)
      .sort((a, b) => Number(b.costPerKm) - Number(a.costPerKm))
      .slice(0, 5);
  }, [filteredFuelLogs, filteredWeeklyMileage]);

  const anomalies = useMemo(() => {
    const items: Array<{ title: string; value: string }> = [];
    const currentFuelAmount = currentFuelWeekRow?.amount ?? 0;
    const previousFuelAmount = previousFuelWeekRow?.amount ?? 0;

    if (currentFuelAmount > 0 && previousFuelAmount > 0) {
      const fuelChange = (currentFuelAmount - previousFuelAmount) / previousFuelAmount;
      if (fuelChange > 0.25) {
        items.push({
          title: t.dashboard.fuelCostIncreased,
          value: `${formatNumber(fuelChange * 100, language, 0)}%`
        });
      }
    }

    if (latestWeekRow?.mileage && previousWeekRow?.mileage) {
      const mileageChange = (latestWeekRow.mileage - previousWeekRow.mileage) / previousWeekRow.mileage;
      if (mileageChange < -0.25) {
        items.push({
          title: t.dashboard.mileageDropped,
          value: `${formatNumber(Math.abs(mileageChange) * 100, language, 0)}%`
        });
      }
    }

    return items;
  }, [currentFuelWeekRow, previousFuelWeekRow, latestWeekRow, previousWeekRow, t, language]);

  const topFuelDriver = useMemo(() => {
    const totals = new Map<string, number>();
    filteredFuelLogs.forEach((item) => {
      const key = item.driver || "-";
      totals.set(key, (totals.get(key) || 0) + Number(item.total_cost || 0));
    });

    let topName = "-";
    let topValue = 0;

    totals.forEach((value, key) => {
      if (value > topValue) {
        topName = key;
        topValue = value;
      }
    });

    return { name: topName, amount: topValue };
  }, [filteredFuelLogs]);

  const averagePricePerLitre = totalLitres > 0 ? totalFuelSpend / totalLitres : 0;

  const biggestTransfer = filteredTransfers.reduce<BankTransferWithDriver | null>((max, item) => {
    if (!max || Number(item.amount) > Number(max.amount)) {
      return item;
    }
    return max;
  }, null);

  const recentFuelLogs = filteredFuelLogs.slice(0, 8);
  const recentTransfers = filteredTransfers.slice(0, 8);

  const latestWeekLabel = latestWeekRow ? formatDate(latestWeekRow.weekEnding, language) : "-";
  const previousWeekLabel = previousWeekRow ? formatDate(previousWeekRow.weekEnding, language) : "-";

  const insightCards = [
    {
      title: t.dashboard.latestWeek,
      value: latestWeekRow ? formatNumber(latestWeekRow.mileage, language) : "-",
      helper: latestWeekRow
        ? `${t.dashboard.latestWeekHelper} ${latestWeekLabel}`
        : t.dashboard.noMileageDataDescription
    },
    {
      title: t.dashboard.previousWeek,
      value: previousWeekRow ? formatNumber(previousWeekRow.mileage, language) : "-",
      helper: previousWeekRow
        ? `${t.dashboard.previousWeekHelper} ${previousWeekLabel}`
        : t.dashboard.noPreviousWeek
    },
    {
      title: t.dashboard.weekOverWeek,
      value: latestWeekRow && previousWeekRow ? formatNumber(weeklyChange, language) : "-",
      helper:
        latestWeekRow && previousWeekRow
          ? t.dashboard.weeklyChangeHelper
          : t.dashboard.noPreviousWeek
    }
  ];

  const watchlistCards = [
    {
      title: t.dashboard.topFuelDriver,
      value: topFuelDriver.name || "-",
      helper:
        topFuelDriver.amount > 0
          ? `${formatCurrency(topFuelDriver.amount, language)}`
          : t.dashboard.noFuelDescription
    },
    {
      title: t.dashboard.averagePricePerLitre,
      value: totalLitres > 0 ? formatCurrency(averagePricePerLitre, language) : "-",
      helper: totalLitres > 0 ? t.dashboard.bestEfficiencyDescription : t.dashboard.noFuelDescription
    },
    {
      title: t.dashboard.largestTransfer,
      value: biggestTransfer ? formatCurrency(biggestTransfer.amount, language) : "-",
      helper: biggestTransfer?.driver || t.dashboard.noTransferData
    }
  ];

  const renderSummaryTable = (rows: WeeklySummaryRow[]) => {
    if (loading) {
      return <p className="text-sm text-slate-500">{t.dashboard.loadingData}</p>;
    }

    if (!rows.length) {
      return (
        <EmptyState
          title={t.dashboard.noMileageDataTitle}
          description={t.dashboard.noMileageDataDescription}
        />
      );
    }

    return (
      <>
        <div className="space-y-3 md:hidden">
          {rows.map((row) => (
            <div key={row.weekEnding} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-semibold text-slate-900">{formatDate(row.weekEnding, language)}</p>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                    {t.dashboard.table.mileage}
                  </p>
                  <p className="mt-1 text-sm font-medium text-slate-900">
                    {formatNumber(row.mileage, language)}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                    {t.dashboard.vehiclesSubmitted}
                  </p>
                  <p className="mt-1 text-sm font-medium text-slate-900">
                    {formatNumber(row.submitted, language)}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="hidden -mx-5 overflow-x-auto px-5 md:block md:mx-0 md:px-0">
          <div className="rounded-2xl border border-slate-200">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="bg-slate-100 text-slate-600">
                <th className="px-4 py-3 text-left font-semibold">{t.dashboard.table.weekEnding}</th>
                <th className="px-4 py-3 text-left font-semibold">{t.dashboard.table.mileage}</th>
                <th className="px-4 py-3 text-left font-semibold">{t.dashboard.vehiclesSubmitted}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.weekEnding}
                  className="border-b border-slate-200 transition last:border-none hover:bg-slate-50"
                >
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {formatDate(row.weekEnding, language)}
                  </td>
                  <td className="px-4 py-3 text-slate-700">{formatNumber(row.mileage, language)}</td>
                  <td className="px-4 py-3 text-slate-700">{formatNumber(row.submitted, language)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      </>
    );
  };

  return (
    <>
      <div className="mb-6">
        <Header title={t.dashboard.title} description={t.dashboard.description} showSignOut />
      </div>

      <section className="mb-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-md sm:p-6">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">{t.dashboard.filtersTitle}</h3>
            <p className="mt-1 text-sm text-slate-500">{t.dashboard.filtersDescription}</p>
          </div>

          <button
            type="button"
            onClick={() => {
              setDriverFilter("all");
              setStartDate("");
              setEndDate("");
            }}
            className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 sm:w-auto"
          >
            {t.dashboard.resetFilters}
          </button>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">
              {t.dashboard.driverFilter}
            </label>
            <select
              value={driverFilter}
              onChange={(event) => setDriverFilter(event.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-black"
            >
              <option value="all">{t.dashboard.allDrivers}</option>
              {drivers.map((driver) => (
                <option key={driver.id} value={String(driver.id)}>
                  {driver.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">
              {t.dashboard.startDate}
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-black"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">
              {t.dashboard.endDate}
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-black"
            />
          </div>
        </div>
      </section>

      {error ? <p className="mb-6 text-sm text-rose-600">{error}</p> : null}

      <section className="mb-6 grid grid-cols-1 gap-3 sm:mb-8 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4 2xl:grid-cols-5">
        <StatCard
          label={t.dashboard.totalFuelSpend}
          value={formatCurrency(totalFuelSpend, language)}
          helper={t.dashboard.fuelSpendHelper}
          icon={<Droplets className="h-5 w-5" />}
        />
        <StatCard
          label={t.dashboard.totalTransfers}
          value={formatCurrency(totalTransfers, language)}
          helper={t.dashboard.transferSpendHelper}
          icon={<CreditCard className="h-5 w-5" />}
        />
        <StatCard
          label={t.dashboard.totalWeeklyMileage}
          value={formatNumber(totalWeeklyMileage, language)}
          helper={t.dashboard.weeklyMileageHelper}
          icon={<Route className="h-5 w-5" />}
        />
        <StatCard
          label={t.dashboard.activeDrivers}
          value={formatNumber(activeDrivers, language)}
          helper={t.dashboard.activeDriversHelper}
          icon={<Truck className="h-5 w-5" />}
        />
        <StatCard
          label={t.dashboard.weeklyReportsEntered}
          value={formatNumber(uniqueReportingWeeks, language)}
          helper={t.dashboard.weeklyReportsEnteredHelper}
          icon={<FileText className="h-5 w-5" />}
        />
      </section>

      <section className="mb-8 grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-md sm:p-6">
          <div className="mb-5">
            <h3 className="text-lg font-semibold text-slate-900">{t.dashboard.weeklySummaryTitle}</h3>
            <p className="mt-1 text-sm text-slate-500">{t.dashboard.weeklySummaryDescription}</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {insightCards.map((card) => (
              <div key={card.title} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm font-medium text-slate-500">{card.title}</p>
                <p className="mt-3 text-2xl font-semibold text-slate-950">{card.value}</p>
                <p className="mt-2 text-sm leading-6 text-slate-500">{card.helper}</p>
              </div>
            ))}
          </div>

          <div className="mt-5">{renderSummaryTable(weeklySummaryRows)}</div>
        </div>

        <div className="space-y-6">
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-md sm:p-6">
            <div className="mb-5">
              <h3 className="text-lg font-semibold text-slate-900">
                {t.dashboard.costPerKmByDriverTitle}
              </h3>
              <p className="mt-1 text-sm text-slate-500">
                {t.dashboard.costPerKmByDriverDescription}
              </p>
            </div>

            {!driverCostPerKmRows.length ? (
              <EmptyState
                title={t.dashboard.noCostPerKmDataTitle}
                description={t.dashboard.noCostPerKmDataDescription}
              />
            ) : (
              <>
                <div className="space-y-3 md:hidden">
                  {driverCostPerKmRows.map((row) => (
                    <div key={row.driverId} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <p className="text-sm font-semibold text-slate-900">{row.driver || "-"}</p>
                      <p className="mt-2 text-sm text-slate-500">{t.dashboard.fuelCostPerKm}</p>
                      <p className="mt-1 text-base font-semibold text-slate-950">
                        {row.costPerKm != null ? formatCurrency(row.costPerKm, language) : "-"}
                      </p>
                    </div>
                  ))}
                </div>

                <div className="hidden -mx-5 overflow-x-auto px-5 md:block md:mx-0 md:px-0">
                  <div className="rounded-2xl border border-slate-200">
                  <table className="w-full min-w-[420px] text-sm">
                    <thead>
                      <tr className="bg-slate-100 text-slate-600">
                        <th className="px-4 py-3 text-left font-semibold">{t.dashboard.table.driver}</th>
                        <th className="px-4 py-3 text-left font-semibold">{t.dashboard.fuelCostPerKm}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {driverCostPerKmRows.map((row) => (
                        <tr
                          key={row.driverId}
                          className="border-b border-slate-200 transition last:border-none hover:bg-slate-50"
                        >
                          <td className="px-4 py-3 font-medium text-slate-900">{row.driver || "-"}</td>
                          <td className="px-4 py-3 text-slate-700">
                            {row.costPerKm != null ? formatCurrency(row.costPerKm, language) : "-"}
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

          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-md sm:p-6">
            <div className="mb-5">
              <h3 className="text-lg font-semibold text-slate-900">{t.dashboard.anomalyTitle}</h3>
              <p className="mt-1 text-sm text-slate-500">{t.dashboard.anomalyDescription}</p>
            </div>

            {!anomalies.length ? (
              <EmptyState
                title={t.dashboard.noAnomaliesTitle}
                description={t.dashboard.noAnomaliesDescription}
              />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {anomalies.map((item) => (
                  <div key={item.title} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-center gap-3">
                      {item.title === t.dashboard.fuelCostIncreased ? (
                        <TrendingUp className="h-5 w-5 text-rose-500" />
                      ) : (
                        <TrendingDown className="h-5 w-5 text-amber-600" />
                      )}
                      <div>
                        <p className="font-medium text-slate-900">{item.title}</p>
                        <p className="mt-1 text-sm text-slate-600">{item.value}</p>
                      </div>
                    </div>
                    <p className="mt-3 text-sm text-slate-500">
                      {t.dashboard.comparedWithPreviousWeek}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </section>

      <section className="mb-8 rounded-3xl border border-slate-200 bg-white p-5 shadow-md sm:p-6">
        <div className="mb-5">
          <h3 className="text-lg font-semibold text-slate-900">{t.dashboard.watchlistTitle}</h3>
          <p className="mt-1 text-sm text-slate-500">{t.dashboard.watchlistDescription}</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {watchlistCards.map((card) => (
            <div key={card.title} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-medium text-slate-500">{card.title}</p>
              <p className="mt-2 text-xl font-semibold text-slate-950">{card.value}</p>
              <p className="mt-2 text-sm leading-6 text-slate-500">{card.helper}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-md sm:p-6">
          <div className="mb-4">
            <h3 className="text-lg font-semibold text-slate-900">{t.dashboard.latestFuelActivity}</h3>
            <p className="mt-1 text-sm text-slate-500">{t.dashboard.latestFuelDescription}</p>
          </div>

          {loading ? (
            <p className="mt-4 text-sm text-slate-500">{t.dashboard.loadingData}</p>
          ) : recentFuelLogs.length === 0 ? (
            <div className="mt-4">
              <EmptyState title={t.dashboard.noFuelTitle} description={t.dashboard.noFuelDescription} />
            </div>
          ) : (
            <>
              <div className="space-y-3 md:hidden">
                {recentFuelLogs.map((item) => (
                  <div key={item.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{item.driver || "-"}</p>
                        <p className="mt-1 text-sm text-slate-500">{item.vehicle_reg || "-"}</p>
                      </div>
                      <p className="text-sm font-medium text-slate-900">{formatDate(item.date, language)}</p>
                    </div>
                    <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                      {t.dashboard.table.cost}
                    </p>
                    <p className="mt-1 text-base font-semibold text-slate-950">
                      {formatCurrency(item.total_cost, language)}
                    </p>
                  </div>
                ))}
              </div>

              <div className="hidden -mx-5 overflow-x-auto px-5 md:block md:mx-0 md:px-0">
                <div className="rounded-2xl border border-slate-200">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="bg-slate-100 text-slate-600">
                      <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.14em]">
                        {t.dashboard.table.date}
                      </th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.14em]">
                        {t.dashboard.table.driver}
                      </th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.14em]">
                        {t.dashboard.table.vehicle}
                      </th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.14em]">
                        {t.dashboard.table.cost}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentFuelLogs.map((item) => (
                      <tr
                        key={item.id}
                        className="border-b border-slate-200 transition last:border-none hover:bg-slate-50"
                      >
                        <td className="whitespace-nowrap px-3 py-2.5 text-[13px] text-slate-700">
                          {formatDate(item.date, language)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-[13px] font-medium text-slate-900">
                          {item.driver || "-"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-[13px] text-slate-700">
                          {item.vehicle_reg || "-"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-[13px] font-medium text-slate-900">
                          {formatCurrency(item.total_cost, language)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-md sm:p-6">
          <div className="mb-4">
            <h3 className="text-lg font-semibold text-slate-900">{t.dashboard.latestTransfers}</h3>
            <p className="mt-1 text-sm text-slate-500">{t.dashboard.latestTransferDescription}</p>
          </div>

          {loading ? (
            <p className="mt-4 text-sm text-slate-500">{t.dashboard.loadingData}</p>
          ) : recentTransfers.length === 0 ? (
            <div className="mt-4">
              <EmptyState
                title={t.dashboard.noTransferTitle}
                description={t.dashboard.noTransferDescription}
              />
            </div>
          ) : (
            <>
              <div className="space-y-3 md:hidden">
                {recentTransfers.map((item) => (
                  <div key={item.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{item.driver || "-"}</p>
                        <p className="mt-1 text-sm text-slate-500">{item.transfer_type || "-"}</p>
                      </div>
                      <p className="text-sm font-medium text-slate-900">{formatDate(item.date, language)}</p>
                    </div>
                    <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                      {t.dashboard.table.amount}
                    </p>
                    <p className="mt-1 text-base font-semibold text-slate-950">
                      {formatCurrency(item.amount, language)}
                    </p>
                  </div>
                ))}
              </div>

              <div className="hidden -mx-5 overflow-x-auto px-5 md:block md:mx-0 md:px-0">
                <div className="rounded-2xl border border-slate-200">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="bg-slate-100 text-slate-600">
                      <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.14em]">
                        {t.dashboard.table.date}
                      </th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.14em]">
                        {t.dashboard.table.driver}
                      </th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.14em]">
                        {t.dashboard.table.type}
                      </th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.14em]">
                        {t.dashboard.table.amount}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentTransfers.map((item) => (
                      <tr
                        key={item.id}
                        className="border-b border-slate-200 transition last:border-none hover:bg-slate-50"
                      >
                        <td className="whitespace-nowrap px-3 py-2.5 text-[13px] text-slate-700">
                          {formatDate(item.date, language)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-[13px] font-medium text-slate-900">
                          {item.driver || "-"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-[13px] text-slate-700">
                          {item.transfer_type || "-"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-[13px] font-medium text-slate-900">
                          {formatCurrency(item.amount, language)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </div>
            </>
          )}
        </div>
      </section>
    </>
  );
}
