"use client";

import {
  ArrowRightLeft,
  CalendarRange,
  ClipboardList,
  Fuel,
  Truck,
  Wallet
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/empty-state";
import { Header } from "@/components/header";
import { fetchDrivers, fetchFuelLogs, fetchTransfers, fetchWeeklyMileage } from "@/lib/data";
import { getTransferTypeLabel } from "@/lib/localized-values";
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
  vehiclesSubmitted: number;
  driversSubmitted: number;
  highestOdometer: number | null;
  lowestOdometer: number | null;
  weeklyDistance: number | null;
  totalRecordedOdometer: number;
};

function isWithinRange(value: string, startDate: string, endDate: string) {
  if (!value) {
    return false;
  }

  if (startDate && value < startDate) {
    return false;
  }

  if (endDate && value > endDate) {
    return false;
  }

  return true;
}

function getUniqueDriverCount(entries: WeeklyMileageEntry[]) {
  return new Set(
    entries
      .map((entry) => (entry.driver || entry.driver_id || "").trim().toLowerCase())
      .filter(Boolean)
  ).size;
}

function buildWeeklySummaryRows(entries: WeeklyMileageEntry[]) {
  const sortedEntries = [...entries].sort((a, b) => {
    const dateDiff = new Date(b.week_ending).getTime() - new Date(a.week_ending).getTime();
    if (dateDiff !== 0) {
      return dateDiff;
    }

    return String(b.id).localeCompare(String(a.id));
  });

  const weeks = Array.from(new Set(sortedEntries.map((entry) => entry.week_ending)));

  return weeks.map((weekEnding) => {
    const weekEntries = sortedEntries.filter((entry) => entry.week_ending === weekEnding);
    const vehiclesSubmitted = new Set(
      weekEntries.map((entry) => entry.vehicle_reg || String(entry.driver_id))
    ).size;
    const driversSubmitted = getUniqueDriverCount(weekEntries);
    const odometers = weekEntries.map((entry) => Number(entry.mileage || 0));

    let weeklyDistanceTotal = 0;
    let comparableVehicles = 0;

    weekEntries.forEach((entry) => {
      const previousEntry = sortedEntries.find(
        (candidate) =>
          candidate.vehicle_reg === entry.vehicle_reg &&
          candidate.week_ending < entry.week_ending
      );

      if (!previousEntry) {
        return;
      }

      const distance = Number(entry.mileage || 0) - Number(previousEntry.mileage || 0);
      if (distance >= 0) {
        weeklyDistanceTotal += distance;
        comparableVehicles += 1;
      }
    });

    return {
      weekEnding,
      vehiclesSubmitted,
      driversSubmitted,
      highestOdometer: odometers.length ? Math.max(...odometers) : null,
      lowestOdometer: odometers.length ? Math.min(...odometers) : null,
      weeklyDistance: comparableVehicles > 0 ? weeklyDistanceTotal : null,
      totalRecordedOdometer: odometers.reduce((sum, value) => sum + value, 0)
    } satisfies WeeklySummaryRow;
  });
}

function formatCompactNumber(
  value: number | null,
  language: "en" | "th",
  suffix = ""
) {
  if (value == null) {
    return "-";
  }

  return `${formatNumber(value, language)}${suffix}`;
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
    <article className="surface-card-soft flex h-full min-h-[164px] min-w-0 flex-col overflow-hidden p-4 sm:min-h-[170px] sm:p-4.5">
      <div className="absolute inset-x-0 top-0 h-16 bg-[linear-gradient(135deg,rgba(63,60,187,0.07),rgba(249,115,22,0.04)_72%,transparent)]" />
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase leading-5 tracking-[0.16em] text-slate-400">{label}</p>
          <p className="mt-2 overflow-hidden text-ellipsis whitespace-nowrap text-[1.55rem] font-semibold tracking-[-0.045em] text-slate-900 sm:text-[1.85rem]">
            {value}
          </p>
        </div>
        <div className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/80 bg-white text-brand-700 shadow-[0_12px_24px_rgba(63,60,187,0.08)]">
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <p className="mt-auto pt-4 text-[13px] leading-6 text-slate-500">{helper}</p>
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

  useEffect(() => {
    const loadData = async () => {
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
      } catch (err) {
        setError(t.dashboard.loadDashboardError);
      } finally {
        setLoading(false);
      }
    };

    void loadData();
  }, [t.dashboard.loadDashboardError]);

  const filteredFuelLogs = useMemo(() => {
    return fuelLogs.filter((log) => {
      const driverMatch =
        !selectedDriverId || String(log.driver_id || "") === String(selectedDriverId);
      return driverMatch && isWithinRange(log.date, startDate, endDate);
    });
  }, [fuelLogs, selectedDriverId, startDate, endDate]);

  const filteredTransfers = useMemo(() => {
    return transfers.filter((transfer) => {
      const driverMatch =
        !selectedDriverId || String(transfer.driver_id || "") === String(selectedDriverId);
      return driverMatch && isWithinRange(transfer.date, startDate, endDate);
    });
  }, [transfers, selectedDriverId, startDate, endDate]);

  const filteredWeeklyMileage = useMemo(() => {
    return weeklyMileage.filter((entry) => {
      const driverMatch =
        !selectedDriverId || String(entry.driver_id || "") === String(selectedDriverId);
      return driverMatch && isWithinRange(entry.week_ending, startDate, endDate);
    });
  }, [weeklyMileage, selectedDriverId, startDate, endDate]);

  const weeklySummaryRows = useMemo(() => {
    return buildWeeklySummaryRows(filteredWeeklyMileage);
  }, [filteredWeeklyMileage]);

  const latestWeekRow = weeklySummaryRows[0] ?? null;

  const totalFuelSpend = filteredFuelLogs.reduce(
    (sum, log) => sum + Number(log.total_cost || 0),
    0
  );
  const totalTransferValue = filteredTransfers.reduce(
    (sum, transfer) => sum + Number(transfer.amount || 0),
    0
  );
  const totalFuelLitres = filteredFuelLogs.reduce((sum, log) => sum + Number(log.litres || 0), 0);
  const averagePricePerLitre = totalFuelLitres > 0 ? totalFuelSpend / totalFuelLitres : null;
  const weeklyReportsEntered = weeklySummaryRows.length;
  const latestReportingWeek = latestWeekRow?.weekEnding ?? null;

  const vehiclesSubmittedThisWeek = latestWeekRow?.vehiclesSubmitted ?? 0;
  const weeklyDistanceThisWeek = latestWeekRow?.weeklyDistance ?? null;

  const topFuelDriver = useMemo(() => {
    if (!filteredFuelLogs.length) {
      return null;
    }

    const totals = new Map<string, { label: string; amount: number }>();

    filteredFuelLogs.forEach((log) => {
      const key = String(log.driver_id || log.driver || log.vehicle_reg || log.id);
      const current = totals.get(key) ?? {
        label: log.driver || log.vehicle_reg || "-",
        amount: 0
      };

      current.amount += Number(log.total_cost || 0);
      totals.set(key, current);
    });

    return [...totals.values()].sort((a, b) => b.amount - a.amount)[0] ?? null;
  }, [filteredFuelLogs]);

  const largestTransfer = useMemo(() => {
    return [...filteredTransfers].sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0))[0] ?? null;
  }, [filteredTransfers]);

  const latestFuelLogs = useMemo(() => {
    return [...filteredFuelLogs]
      .sort((a, b) => {
        const dateDiff = new Date(b.date).getTime() - new Date(a.date).getTime();
        if (dateDiff !== 0) {
          return dateDiff;
        }

        return String(b.id).localeCompare(String(a.id));
      })
      .slice(0, 5);
  }, [filteredFuelLogs]);

  const latestTransfers = useMemo(() => {
    return [...filteredTransfers]
      .sort((a, b) => {
        const dateDiff = new Date(b.date).getTime() - new Date(a.date).getTime();
        if (dateDiff !== 0) {
          return dateDiff;
        }

        return String(b.id).localeCompare(String(a.id));
      })
      .slice(0, 5);
  }, [filteredTransfers]);

  const kpiCards = [
    {
      label: t.dashboard.totalFuelSpend,
      value: formatCurrency(totalFuelSpend, language),
      helper: `${formatNumber(filteredFuelLogs.length, language)} ${t.dashboard.fuelHelper}`,
      icon: Wallet
    },
    {
      label: t.dashboard.totalTransfers,
      value: formatCurrency(totalTransferValue, language),
      helper: `${formatNumber(filteredTransfers.length, language)} ${t.dashboard.transferHelper}`,
      icon: ArrowRightLeft
    },
    {
      label: t.dashboard.averagePricePerLitre,
      value: averagePricePerLitre != null ? formatCurrency(averagePricePerLitre, language) : "-",
      helper: t.dashboard.basedOnFilteredFuelEntries,
      icon: Fuel
    },
    {
      label: t.dashboard.weeklyReportsEntered,
      value: formatNumber(weeklyReportsEntered, language),
      helper: t.dashboard.weeklyReportsEnteredHelper,
      icon: ClipboardList
    },
    {
      label: t.weeklyMileage.vehiclesSubmittedThisWeek,
      value: formatNumber(vehiclesSubmittedThisWeek, language),
      helper: t.weeklyMileage.vehiclesSubmittedThisWeekHelper,
      icon: Truck
    },
    {
      label: t.weeklyMileage.lastUpdatedWeek,
      value: latestReportingWeek ? formatDate(latestReportingWeek, language) : "-",
      helper: latestReportingWeek
        ? `${t.weeklyMileage.lastUpdatedWeekHelper} ${formatDate(
            latestReportingWeek,
            language
          )}`
        : t.dashboard.noMileageDataDescription,
      icon: CalendarRange
    }
  ];

  const resetFilters = () => {
    setSelectedDriverId("");
    setStartDate("");
    setEndDate("");
  };

  return (
    <>
      <div className="mb-6">
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
            onClick={resetFilters}
            className="btn-secondary w-full sm:w-auto"
          >
            {t.dashboard.resetFilters}
          </button>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <label className="mb-2 block text-sm font-medium text-slate-500">
              {t.dashboard.driverFilter}
            </label>
            <select
              value={selectedDriverId}
              onChange={(event) => setSelectedDriverId(event.target.value)}
            >
              <option value="">{t.dashboard.allDrivers}</option>
              {drivers.map((driver) => (
                <option key={driver.id} value={String(driver.id)}>
                  {driver.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="mb-2 block text-sm font-medium text-slate-500">
              {t.dashboard.startDate}
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <label className="mb-2 block text-sm font-medium text-slate-500">
              {t.dashboard.endDate}
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
            />
          </div>
        </div>
      </section>

      {error ? <p className="text-sm text-rose-600">{error}</p> : null}

      {loading ? (
        <EmptyState title={t.common.loading} description={t.dashboard.loadingData} />
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {kpiCards.map((card) => (
              <KpiCard key={card.label} {...card} />
            ))}
          </section>

          <section className="surface-card p-4 sm:p-5">
            <div className="mb-3.5">
              <h3 className="text-base font-semibold text-slate-900">
                {t.dashboard.weeklySummaryTitle}
              </h3>
              <p className="mt-1 text-sm text-slate-500">
                {t.dashboard.weeklySummaryDescription}
              </p>
            </div>

            {weeklySummaryRows.length === 0 ? (
              <EmptyState
                title={t.dashboard.noMileageDataTitle}
                description={t.dashboard.noMileageDataDescription}
              />
            ) : (
              <div className="table-shell">
                <div className="grid divide-y divide-slate-200/80 bg-slate-50/80 md:grid-cols-3 md:divide-x md:divide-y-0">
                  <div className="px-4 py-3.5">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                      {t.dashboard.latestWeek}
                    </p>
                    <p className="mt-1.5 whitespace-nowrap text-lg font-semibold text-slate-950">
                      {latestReportingWeek ? formatDate(latestReportingWeek, language) : "-"}
                    </p>
                  </div>
                  <div className="px-4 py-3.5">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                      {t.dashboard.vehiclesSubmitted}
                    </p>
                    <p className="mt-1.5 whitespace-nowrap text-lg font-semibold text-slate-950">
                      {formatNumber(vehiclesSubmittedThisWeek, language)}
                    </p>
                  </div>
                  <div className="px-4 py-3.5">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                      {t.dashboard.weeklyDistance}
                    </p>
                    <p className="mt-1.5 whitespace-nowrap text-lg font-semibold text-slate-950">
                      {formatCompactNumber(weeklyDistanceThisWeek, language, "")}
                    </p>
                  </div>
                </div>

                <div className="space-y-3.5 p-3 md:hidden">
                  {weeklySummaryRows.map((row) => (
                    <article key={row.weekEnding} className="subtle-panel p-4">
                      <div className="flex flex-col gap-2.5 min-[400px]:flex-row min-[400px]:items-start min-[400px]:justify-between">
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                            {t.dashboard.table.weekEnding}
                          </p>
                          <p className="mt-1 text-sm font-semibold text-slate-950">
                            {formatDate(row.weekEnding, language)}
                          </p>
                        </div>
                        <span className="badge-muted px-2.5 py-1">
                          {formatNumber(row.vehiclesSubmitted, language)} {t.dashboard.vehiclesSubmitted}
                        </span>
                      </div>
                      <div className="mt-3 grid grid-cols-1 gap-3 min-[400px]:grid-cols-2">
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                            {t.dashboard.table.driver}
                          </p>
                          <p className="mt-1 text-sm text-slate-700">
                            {formatNumber(row.driversSubmitted, language)}
                          </p>
                        </div>
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                            {t.dashboard.weeklyDistance}
                          </p>
                          <p className="mt-1 text-sm font-semibold text-slate-950">
                            {formatCompactNumber(row.weeklyDistance, language)}
                          </p>
                        </div>
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                            {t.dashboard.highestOdometer}
                          </p>
                          <p className="mt-1 text-sm text-slate-700">
                            {formatCompactNumber(row.highestOdometer, language)}
                          </p>
                        </div>
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                            {t.dashboard.lowestOdometer}
                          </p>
                          <p className="mt-1 text-sm text-slate-700">
                            {formatCompactNumber(row.lowestOdometer, language)}
                          </p>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>

                <div className="hidden overflow-x-auto md:block md:overflow-x-visible">
                  <table className="w-full min-w-[720px] table-fixed md:min-w-0">
                    <thead>
                      <tr>
                        <th className="px-3.5 py-2.5 font-semibold">{t.dashboard.table.weekEnding}</th>
                        <th className="px-3.5 py-2.5 font-semibold">{t.dashboard.vehiclesSubmitted}</th>
                        <th className="px-3.5 py-2.5 font-semibold">{t.dashboard.table.driver}</th>
                        <th className="px-3.5 py-2.5 text-right font-semibold">{t.dashboard.highestOdometer}</th>
                        <th className="px-3.5 py-2.5 text-right font-semibold">{t.dashboard.lowestOdometer}</th>
                        <th className="px-3.5 py-2.5 text-right font-semibold">{t.dashboard.weeklyDistance}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {weeklySummaryRows.map((row) => (
                        <tr
                          key={row.weekEnding}
                          className="border-b border-slate-100 transition hover:bg-slate-50"
                        >
                          <td className="px-3.5 py-2.5 font-medium text-slate-900">
                            {formatDate(row.weekEnding, language)}
                          </td>
                          <td className="px-3.5 py-2.5 text-slate-700">
                            {formatNumber(row.vehiclesSubmitted, language)}
                          </td>
                          <td className="px-3.5 py-2.5 text-slate-700">
                            {formatNumber(row.driversSubmitted, language)}
                          </td>
                          <td className="px-3.5 py-2.5 text-right text-slate-700">
                            {formatCompactNumber(row.highestOdometer, language)}
                          </td>
                          <td className="px-3.5 py-2.5 text-right text-slate-700">
                            {formatCompactNumber(row.lowestOdometer, language)}
                          </td>
                          <td className="px-3.5 py-2.5 text-right font-semibold text-slate-950">
                            {formatCompactNumber(row.weeklyDistance, language)}
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
                {t.dashboard.watchlistTitle}
              </h3>
              <p className="mt-1 text-sm text-slate-500">
                {t.dashboard.watchlistDescription}
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="subtle-panel px-4 py-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    {t.dashboard.topFuelDriver}
                  </p>
                  <p className="mt-2.5 text-base font-semibold text-slate-950">
                    {topFuelDriver?.label ?? "-"}
                  </p>
                  <p className="mt-1.5 whitespace-nowrap text-sm font-semibold text-slate-950">
                    {topFuelDriver
                      ? formatCurrency(topFuelDriver.amount, language)
                      : t.dashboard.noFuelDescription}
                  </p>
              </div>

              <div className="subtle-panel px-4 py-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    {t.dashboard.averagePricePerLitre}
                  </p>
                  <p className="mt-2.5 whitespace-nowrap text-base font-semibold text-slate-950">
                    {averagePricePerLitre != null
                      ? formatCurrency(averagePricePerLitre, language)
                      : "-"}
                  </p>
                  <p className="mt-2 text-sm text-slate-500">
                    {t.dashboard.basedOnFilteredFuelEntries}
                  </p>
              </div>

              <div className="subtle-panel px-4 py-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    {t.dashboard.largestTransfer}
                  </p>
                  <p className="mt-2.5 whitespace-nowrap text-base font-semibold text-slate-950">
                    {largestTransfer
                      ? formatCurrency(Number(largestTransfer.amount || 0), language)
                      : "-"}
                  </p>
                  <p className="mt-2 text-sm text-slate-500">
                    {largestTransfer
                      ? `${largestTransfer.driver || "-"} | ${formatDate(
                          largestTransfer.date,
                          language
                        )}`
                      : t.dashboard.noTransferData}
                  </p>
              </div>
            </div>
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            <section className="surface-card p-4 sm:p-5">
              <div className="mb-3.5">
                <h3 className="text-base font-semibold text-slate-900">
                  {t.dashboard.latestFuelActivity}
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  {t.dashboard.latestFuelDescription}
                </p>
              </div>

              {latestFuelLogs.length === 0 ? (
                <EmptyState
                  title={t.dashboard.noFuelTitle}
                  description={t.dashboard.noFuelDescription}
                />
              ) : (
                <>
                  <div className="space-y-3.5 md:hidden">
                    {latestFuelLogs.map((log) => (
                      <article key={log.id} className="subtle-panel p-4">
                        <div className="flex flex-col gap-2.5 min-[400px]:flex-row min-[400px]:items-start min-[400px]:justify-between">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-slate-900">{log.driver || "-"}</p>
                            <p className="mt-1 text-sm text-slate-500">{log.vehicle_reg || "-"}</p>
                          </div>
                          <p className="shrink-0 text-sm font-medium text-slate-900">
                            {formatDate(log.date, language)}
                          </p>
                        </div>
                        <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                          {t.dashboard.table.cost}
                        </p>
                        <p className="mt-1 text-base font-semibold text-slate-950">
                          {formatCurrency(Number(log.total_cost || 0), language)}
                        </p>
                      </article>
                    ))}
                  </div>

                  <div className="hidden md:block">
                    <div className="table-shell">
                      <table className="w-full">
                        <thead>
                          <tr>
                            <th className="px-3.5 py-2.5">{t.dashboard.table.date}</th>
                            <th className="px-3.5 py-2.5">{t.dashboard.table.driver}</th>
                            <th className="px-3.5 py-2.5">{t.dashboard.table.vehicle}</th>
                            <th className="px-3.5 py-2.5 text-right">{t.dashboard.table.cost}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {latestFuelLogs.map((log) => (
                            <tr
                              key={log.id}
                              className="border-b border-slate-100 transition hover:bg-slate-50"
                            >
                              <td className="px-3.5 py-2.5 text-slate-700">
                                {formatDate(log.date, language)}
                              </td>
                              <td className="px-3.5 py-2.5 font-medium text-slate-900">
                                {log.driver || "-"}
                              </td>
                              <td className="px-3.5 py-2.5 text-slate-700">{log.vehicle_reg || "-"}</td>
                              <td className="px-3.5 py-2.5 text-right whitespace-nowrap font-medium text-slate-950">
                                {formatCurrency(Number(log.total_cost || 0), language)}
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

            <section className="surface-card p-4 sm:p-5">
              <div className="mb-3.5">
                <h3 className="text-base font-semibold text-slate-900">
                  {t.dashboard.latestTransfers}
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  {t.dashboard.latestTransferDescription}
                </p>
              </div>

              {latestTransfers.length === 0 ? (
                <EmptyState
                  title={t.dashboard.noTransferTitle}
                  description={t.dashboard.noTransferDescription}
                />
              ) : (
                <>
                  <div className="space-y-3.5 md:hidden">
                    {latestTransfers.map((transfer) => (
                      <article key={transfer.id} className="subtle-panel p-4">
                        <div className="flex flex-col gap-2.5 min-[400px]:flex-row min-[400px]:items-start min-[400px]:justify-between">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-slate-900">{transfer.driver || "-"}</p>
                            <p className="mt-1 text-sm text-slate-500">
                              {getTransferTypeLabel(t, transfer.transfer_type)}
                            </p>
                          </div>
                          <p className="shrink-0 text-sm font-medium text-slate-900">
                            {formatDate(transfer.date, language)}
                          </p>
                        </div>
                        <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                          {t.dashboard.table.amount}
                        </p>
                        <p className="mt-1 text-base font-semibold text-slate-950">
                          {formatCurrency(Number(transfer.amount || 0), language)}
                        </p>
                      </article>
                    ))}
                  </div>

                  <div className="hidden md:block">
                    <div className="table-shell">
                      <table className="w-full">
                        <thead>
                          <tr>
                            <th className="px-3.5 py-2.5">{t.dashboard.table.date}</th>
                            <th className="px-3.5 py-2.5">{t.dashboard.table.driver}</th>
                            <th className="px-3.5 py-2.5">{t.dashboard.table.type}</th>
                            <th className="px-3.5 py-2.5 text-right">{t.dashboard.table.amount}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {latestTransfers.map((transfer) => (
                            <tr
                              key={transfer.id}
                              className="border-b border-slate-100 transition hover:bg-slate-50"
                            >
                              <td className="px-3.5 py-2.5 text-slate-700">
                                {formatDate(transfer.date, language)}
                              </td>
                              <td className="px-3.5 py-2.5 font-medium text-slate-900">
                                {transfer.driver || "-"}
                              </td>
                              <td className="px-3.5 py-2.5 text-slate-700">
                                {getTransferTypeLabel(t, transfer.transfer_type)}
                              </td>
                              <td className="px-3.5 py-2.5 text-right whitespace-nowrap font-medium text-slate-950">
                                {formatCurrency(Number(transfer.amount || 0), language)}
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
      )}
    </>
  );
}
