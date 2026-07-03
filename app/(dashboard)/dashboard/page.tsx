"use client";

import {
  ArrowRightLeft,
  CheckCircle2,
  Droplet,
  Fuel,
  Gauge,
  RefreshCw,
  Wallet
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/empty-state";
import { Header } from "@/components/header";
import {
  fetchDrivers,
  fetchFuelLogs,
  fetchOilChangeBaselinesForVehicles,
  fetchTransfers,
  fetchVehicles,
  fetchWeeklyMileage
} from "@/lib/data";
import { getTransferTypeLabel } from "@/lib/localized-values";
import { useLanguage } from "@/lib/language-provider";
import { buildOilChangeAlertRows, type OilChangeAlertRow } from "@/lib/operations";
import { formatCurrency, formatDate, formatNumber, normalizeVehicleRegistration } from "@/lib/utils";
import type {
  BankTransferWithDriver,
  Driver,
  DriverVehicleType,
  FuelLogWithDriver,
  OilChangeBaseline,
  Vehicle,
  WeeklyMileageEntry
} from "@/types/database";

type AttentionTone = "danger" | "warning" | "info";

type AttentionItem = {
  count: number;
  detail: string;
  key: string;
  title: string;
  tone: AttentionTone;
};

type EfficiencyStats = {
  averageKmPerLitre: number | null;
  validRecordCount: number;
  warnings: Array<{
    log: FuelLogWithDriver;
    kmDriven: number;
    kmPerLitre: number;
  }>;
};

type MonthRange = {
  endDate: string;
  monthKey: string;
  startDate: string;
};

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function getLocalDateKey(value: Date) {
  return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
}

function getLocalMonthKey(value: Date) {
  return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}`;
}

function getCurrentMonthKey() {
  return getLocalMonthKey(new Date());
}

function getMonthRange(monthKey: string): MonthRange {
  const [yearText, monthText] = monthKey.split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  const safeDate =
    Number.isFinite(year) && Number.isFinite(monthIndex)
      ? new Date(year, monthIndex, 1)
      : new Date();
  const start = new Date(safeDate.getFullYear(), safeDate.getMonth(), 1);
  const end = new Date(safeDate.getFullYear(), safeDate.getMonth() + 1, 0);

  return {
    monthKey: getLocalMonthKey(start),
    startDate: getLocalDateKey(start),
    endDate: getLocalDateKey(end)
  };
}

function shiftMonth(monthKey: string, offset: number) {
  const range = getMonthRange(monthKey);
  const [yearText, monthText] = range.monthKey.split("-");
  const date = new Date(Number(yearText), Number(monthText) - 1 + offset, 1);
  return getLocalMonthKey(date);
}

function isInRange(date: string | null | undefined, startDate: string, endDate: string) {
  return Boolean(date) && date! >= startDate && date! <= endDate;
}

function getSafeNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

const normalizeOilReg = (value: unknown) =>
  String(value ?? "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/-/g, "")
    .toUpperCase();

function getMileageValue(value: number | null | undefined) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function getFuelLogMileage(log: FuelLogWithDriver | null | undefined) {
  if (!log) return null;
  return getMileageValue(log.mileage ?? log.odometer);
}

function getFuelLogDuplicateKey(log: FuelLogWithDriver) {
  return [
    log.date,
    normalizeVehicleRegistration(log.vehicle_reg),
    Number(log.litres || 0).toFixed(2),
    Number(log.total_cost || 0).toFixed(2),
    String(log.driver_id || "")
  ].join("::");
}

function buildVehicleTypeLookup(vehicles: Vehicle[], drivers: Driver[]) {
  const lookup = new Map<string, string>();

  for (const vehicle of vehicles) {
    const key = normalizeVehicleRegistration(vehicle.vehicle_reg || vehicle.registration);
    if (key && vehicle.vehicle_type) {
      lookup.set(key, String(vehicle.vehicle_type));
    }
  }

  for (const driver of drivers) {
    const key = normalizeVehicleRegistration(driver.vehicle_reg);
    if (key && driver.vehicle_type && !lookup.has(key)) {
      lookup.set(key, String(driver.vehicle_type));
    }
  }

  return lookup;
}

function getKmPerLitreThresholds(vehicleType: string | null | undefined) {
  const type = String(vehicleType ?? "").toUpperCase() as DriverVehicleType | string;
  if (type === "FOUR_WHEEL_TRUCK") return { low: 3, high: 14 };
  if (type === "EIGHTEEN_WHEELER") return { low: 1.2, high: 5.5 };
  if (type === "SIX_WHEEL_TRUCK" || type === "SIX_PLUS_SIX_WHEELER") return { low: 1.5, high: 8 };
  return { low: 1.5, high: 8 };
}

function buildEfficiencyStats({
  allLogs,
  monthlyLogs,
  vehicleTypeLookup
}: {
  allLogs: FuelLogWithDriver[];
  monthlyLogs: FuelLogWithDriver[];
  vehicleTypeLookup: Map<string, string>;
}): EfficiencyStats {
  const monthlyIds = new Set(monthlyLogs.map((log) => String(log.id)));
  const duplicateCounts = new Map<string, number>();
  for (const log of allLogs) {
    const key = getFuelLogDuplicateKey(log);
    duplicateCounts.set(key, (duplicateCounts.get(key) ?? 0) + 1);
  }

  const previousByVehicle = new Map<string, FuelLogWithDriver>();
  const warnings: EfficiencyStats["warnings"] = [];
  const validValues: number[] = [];

  for (const log of [...allLogs].sort((left, right) => {
    const dateDiff = left.date.localeCompare(right.date);
    if (dateDiff !== 0) return dateDiff;
    return String(left.id).localeCompare(String(right.id));
  })) {
    const vehicleKey = normalizeVehicleRegistration(log.vehicle_reg);
    const currentMileage = getFuelLogMileage(log);
    const litres = Number(log.litres || 0);
    const previous = vehicleKey ? previousByVehicle.get(vehicleKey) : null;
    const previousMileage = getFuelLogMileage(previous);

    if (vehicleKey && currentMileage != null) {
      previousByVehicle.set(vehicleKey, log);
    }

    if (!monthlyIds.has(String(log.id))) {
      continue;
    }

    if (
      !vehicleKey ||
      currentMileage == null ||
      previousMileage == null ||
      litres <= 0 ||
      currentMileage <= previousMileage ||
      (duplicateCounts.get(getFuelLogDuplicateKey(log)) ?? 0) > 1
    ) {
      continue;
    }

    const kmDriven = currentMileage - previousMileage;
    if (kmDriven < 50 || kmDriven > 2000) {
      continue;
    }

    const kmPerLitre = kmDriven / litres;
    if (!Number.isFinite(kmPerLitre)) {
      continue;
    }

    const thresholds = getKmPerLitreThresholds(vehicleTypeLookup.get(vehicleKey));
    if (kmPerLitre < thresholds.low || kmPerLitre > thresholds.high) {
      warnings.push({ log, kmDriven, kmPerLitre });
      continue;
    }

    validValues.push(kmPerLitre);
  }

  return {
    averageKmPerLitre:
      validValues.length >= 3
        ? validValues.reduce((sum, value) => sum + value, 0) / validValues.length
        : null,
    validRecordCount: validValues.length,
    warnings: warnings.sort((left, right) => right.log.date.localeCompare(left.log.date)).slice(0, 20)
  };
}

function hasMissingFuelDetails(log: FuelLogWithDriver) {
  return (
    !String(log.date || "").trim() ||
    !String(log.vehicle_reg || "").trim() ||
    !String(log.location || log.station || "").trim() ||
    getSafeNumber(log.litres) <= 0 ||
    getSafeNumber(log.total_cost) <= 0 ||
    getFuelLogMileage(log) == null
  );
}

function applyOilBaselinesLikeOilPage(vehicles: Vehicle[], baselines: OilChangeBaseline[]) {
  return vehicles.map((vehicle) => {
    const baselineForVehicle = baselines.find(
      (baseline) => normalizeOilReg(baseline.vehicle_reg) === normalizeOilReg(vehicle.vehicle_reg)
    );

    if (!baselineForVehicle) {
      return vehicle;
    }

    return {
      ...vehicle,
      last_oil_change_date: baselineForVehicle.last_oil_change_date,
      last_oil_change_odometer: Number(baselineForVehicle.last_odometer),
      oil_change_interval_km: Number(baselineForVehicle.interval_km)
    };
  });
}

function hasReliableOilBaseline(row: OilChangeAlertRow) {
  return (
    row.lastOilChangeOdometer != null &&
    row.oilChangeIntervalKm != null &&
    row.currentOdometer != null &&
    row.currentOdometer >= row.lastOilChangeOdometer &&
    row.nextOilChangeDueOdometer != null
  );
}

function getOilAttentionRows(rows: OilChangeAlertRow[]) {
  return rows.filter((row) => {
    if (row.status === "not_set") return true;
    if (row.status === "review_required") return true;
    if (!hasReliableOilBaseline(row)) return false;
    return row.status === "overdue" || row.status === "urgent" || row.status === "due_soon";
  });
}

function StatusBadge({ checked }: { checked: boolean }) {
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${checked ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-100 text-slate-600"}`}>
      {checked ? "Checked" : "Not Checked"}
    </span>
  );
}

const SummaryCard = memo(function SummaryCard({
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

function AttentionRow({ item }: { item: AttentionItem }) {
  const toneClass =
    item.tone === "danger"
      ? "border-l-rose-500 bg-rose-50/70"
      : item.tone === "warning"
        ? "border-l-amber-500 bg-amber-50/70"
        : "border-l-sky-500 bg-sky-50/70";

  return (
    <div className={`rounded-lg border border-slate-200 border-l-4 px-3.5 py-2.5 ${toneClass}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-950">{item.title}</p>
          <p className="mt-0.5 text-xs leading-5 text-slate-600">{item.detail}</p>
        </div>
        <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-sm">
          {item.count}
        </span>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { language, t } = useLanguage();
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [oilChangeBaselines, setOilChangeBaselines] = useState<OilChangeBaseline[]>([]);
  const [fuelLogs, setFuelLogs] = useState<FuelLogWithDriver[]>([]);
  const [transfers, setTransfers] = useState<BankTransferWithDriver[]>([]);
  const [weeklyMileage, setWeeklyMileage] = useState<WeeklyMileageEntry[]>([]);
  const [selectedMonth, setSelectedMonth] = useState(() => getCurrentMonthKey());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const copy = {
    allIssues: language === "th" ? "View all issues" : "View all issues",
    avgKmPerLitre: language === "th" ? "Average km/L" : "Average km/L",
    currentMonth: language === "th" ? "Current month" : "Current month",
    dateRange: language === "th" ? "Date range" : "Date range",
    dueSoon: language === "th" ? "Due Soon" : "Due Soon",
    latestFuel: language === "th" ? "Latest 5 fuel entries" : "Latest 5 fuel entries",
    latestTransfers: language === "th" ? "Latest 5 bank transfers" : "Latest 5 bank transfers",
    monthFuelSpend: language === "th" ? "This month fuel spend" : "This month fuel spend",
    monthTransfers: language === "th" ? "This month bank transfers" : "This month bank transfers",
    needsAttention: language === "th" ? "Needs Attention" : "Needs Attention",
    needsBaseline: language === "th" ? "Needs baseline" : "Needs baseline",
    noAttention: language === "th" ? "No urgent review items found for this month." : "No urgent review items found for this month.",
    noFuel: language === "th" ? "No fuel entries for this month." : "No fuel entries for this month.",
    noTransfers: language === "th" ? "No bank transfers for this month." : "No bank transfers for this month.",
    notEnoughValidData: language === "th" ? "Not enough valid data" : "Not enough valid data",
    oilDue: language === "th" ? "Oil changes due or overdue" : "Oil changes due or overdue",
    overdue: language === "th" ? "Overdue" : "Overdue",
    previousMonth: language === "th" ? "Previous month" : "Previous month",
    selectedMonth: language === "th" ? "Selected month" : "Selected month",
    totalOutflow: language === "th" ? "Total monthly outflow" : "Total monthly outflow",
    unchecked: language === "th" ? "Unchecked records" : "Unchecked records"
  };

  const loadData = useCallback(
    async (showBlockingLoader = false) => {
      try {
        if (showBlockingLoader) {
          setLoading(true);
        } else {
          setRefreshing(true);
        }
        setError(null);

        const [driverRows, vehicleRows, fuelRows, transferRows, mileageRows] = await Promise.all([
          fetchDrivers(),
          fetchVehicles(),
          fetchFuelLogs(),
          fetchTransfers(),
          fetchWeeklyMileage()
        ]);
        const baselineRows = await fetchOilChangeBaselinesForVehicles(vehicleRows);

        setDrivers(driverRows);
        setVehicles(vehicleRows);
        setOilChangeBaselines(baselineRows);
        setFuelLogs(fuelRows);
        setTransfers(transferRows);
        setWeeklyMileage(mileageRows);
      } catch (err) {
        console.error("Dashboard load error:", err);
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

  const monthRange = useMemo(() => getMonthRange(selectedMonth), [selectedMonth]);
  const dateRangeLabel = `${formatDate(monthRange.startDate, language)} - ${formatDate(monthRange.endDate, language)}`;
  const monthlyFuelLogs = useMemo(
    () => fuelLogs.filter((log) => isInRange(log.date, monthRange.startDate, monthRange.endDate)),
    [fuelLogs, monthRange.endDate, monthRange.startDate]
  );
  const monthlyTransfers = useMemo(
    () => transfers.filter((transfer) => isInRange(transfer.date, monthRange.startDate, monthRange.endDate)),
    [monthRange.endDate, monthRange.startDate, transfers]
  );
  const vehicleTypeLookup = useMemo(
    () => buildVehicleTypeLookup(vehicles, drivers),
    [drivers, vehicles]
  );
  const vehiclesWithOilBaselines = useMemo(
    () => applyOilBaselinesLikeOilPage(vehicles, oilChangeBaselines),
    [oilChangeBaselines, vehicles]
  );

  const oilRows = useMemo(
    () => buildOilChangeAlertRows({ vehicles: vehiclesWithOilBaselines, weeklyMileage, drivers }),
    [drivers, vehiclesWithOilBaselines, weeklyMileage]
  );
  const oilAttentionRows = useMemo(() => getOilAttentionRows(oilRows), [oilRows]);
  const oilDueRows = oilAttentionRows.filter((row) =>
    hasReliableOilBaseline(row) &&
    (row.status === "overdue" || row.status === "urgent" || row.status === "due_soon")
  );

  const monthlyFuelSpend = monthlyFuelLogs.reduce((sum, log) => sum + getSafeNumber(log.total_cost), 0);
  const monthlyTransferTotal = monthlyTransfers.reduce((sum, transfer) => sum + getSafeNumber(transfer.amount), 0);
  const efficiencyStats = useMemo(
    () => buildEfficiencyStats({ allLogs: fuelLogs, monthlyLogs: monthlyFuelLogs, vehicleTypeLookup }),
    [fuelLogs, monthlyFuelLogs, vehicleTypeLookup]
  );
  const uncheckedFuelCount = monthlyFuelLogs.filter((log) => !log.receipt_checked).length;
  const uncheckedTransferCount = monthlyTransfers.filter((transfer) => transfer.receipt_status !== "approved").length;
  const uncheckedRecords = uncheckedFuelCount + uncheckedTransferCount;
  const missingFuelRows = monthlyFuelLogs.filter(hasMissingFuelDetails);

  const latestFuelLogs = useMemo(
    () =>
      [...monthlyFuelLogs]
        .sort((left, right) => right.date.localeCompare(left.date) || String(right.id).localeCompare(String(left.id)))
        .slice(0, 5),
    [monthlyFuelLogs]
  );
  const latestTransfers = useMemo(
    () =>
      [...monthlyTransfers]
        .sort((left, right) => right.date.localeCompare(left.date) || String(right.id).localeCompare(String(left.id)))
        .slice(0, 5),
    [monthlyTransfers]
  );

  const attentionItems = useMemo(() => {
    const items: AttentionItem[] = [];
    const oilOverdueCount = oilDueRows.filter((row) => row.status === "overdue").length;
    const oilDueSoonCount = oilDueRows.length - oilOverdueCount;
    const needsBaselineCount = oilAttentionRows.filter((row) => row.status === "not_set" || !hasReliableOilBaseline(row)).length;

    if (oilDueRows.length || needsBaselineCount) {
      const firstOil = oilDueRows[0] ?? oilAttentionRows[0];
      const detail = firstOil
        ? firstOil.status === "overdue" && firstOil.overdueKm != null
          ? `${firstOil.registration}: ${formatNumber(firstOil.overdueKm, language)} KM overdue`
          : firstOil.status === "not_set"
            ? `${firstOil.registration}: ${copy.needsBaseline}`
            : `${firstOil.registration}: ${formatNumber(firstOil.kmRemaining ?? 0, language)} KM remaining`
        : "";
      items.push({
        count: oilDueRows.length + needsBaselineCount,
        detail: [
          oilOverdueCount ? `${formatNumber(oilOverdueCount, language)} ${copy.overdue}` : "",
          oilDueSoonCount ? `${formatNumber(oilDueSoonCount, language)} ${copy.dueSoon}` : "",
          needsBaselineCount ? `${formatNumber(needsBaselineCount, language)} ${copy.needsBaseline}` : "",
          detail
        ].filter(Boolean).join(" | "),
        key: "oil",
        title: copy.oilDue,
        tone: oilOverdueCount ? "danger" : "warning"
      });
    }

    if (missingFuelRows.length) {
      items.push({
        count: missingFuelRows.length,
        detail: "Missing mileage, litres, cost, driver, vehicle, or station.",
        key: "missing-fuel-fields",
        title: "Missing fuel log details",
        tone: "warning"
      });
    }

    if (uncheckedFuelCount) {
      items.push({
        count: uncheckedFuelCount,
        detail: "Fuel records in this month are still Not Checked.",
        key: "unchecked-fuel",
        title: "Fuel logs not checked",
        tone: "info"
      });
    }

    if (uncheckedTransferCount) {
      items.push({
        count: uncheckedTransferCount,
        detail: "Bank transfers in this month are still Not Checked.",
        key: "unchecked-transfers",
        title: "Bank transfers not checked",
        tone: "info"
      });
    }

    return items;
  }, [copy.dueSoon, copy.needsBaseline, copy.oilDue, copy.overdue, language, missingFuelRows.length, oilAttentionRows, oilDueRows, uncheckedFuelCount, uncheckedTransferCount]);

  useEffect(() => {
    if (process.env.NODE_ENV === "production") {
      return;
    }

    console.info("Dashboard calculation debug", {
      selectedMonthStart: monthRange.startDate,
      selectedMonthEnd: monthRange.endDate,
      fuelLogsLoaded: fuelLogs.length,
      monthlyFuelLogs: monthlyFuelLogs.length,
      fuelSpendCalculated: monthlyFuelSpend,
      bankTransfersLoaded: transfers.length,
      monthlyBankTransfers: monthlyTransfers.length,
      bankTransferTotalCalculated: monthlyTransferTotal,
      uncheckedFuelCount,
      uncheckedTransferCount,
      averageKmPerLitreValidRecordCount: efficiencyStats.validRecordCount,
      suspiciousKmPerLitreCountHidden: efficiencyStats.warnings.length,
      oilChangeItemsCount: oilDueRows.length,
      oilBaselineCount: oilChangeBaselines.length
    });
  }, [
    efficiencyStats.validRecordCount,
    efficiencyStats.warnings.length,
    fuelLogs.length,
    monthlyFuelLogs.length,
    monthlyFuelSpend,
    monthlyTransferTotal,
    monthlyTransfers.length,
    monthRange.endDate,
    monthRange.startDate,
    oilChangeBaselines.length,
    oilDueRows.length,
    transfers.length,
    uncheckedFuelCount,
    uncheckedTransferCount
  ]);

  const visibleAttentionItems = attentionItems.slice(0, 5);
  const hiddenAttentionItems = attentionItems.slice(5);

  const summaryCards = [
    {
      label: copy.monthFuelSpend,
      value: formatCurrency(monthlyFuelSpend, language),
      helper: `${formatNumber(monthlyFuelLogs.length, language)} fuel entries | ${dateRangeLabel}`,
      icon: Fuel
    },
    {
      label: copy.monthTransfers,
      value: formatCurrency(monthlyTransferTotal, language),
      helper: `${formatNumber(monthlyTransfers.length, language)} transfers | ${dateRangeLabel}`,
      icon: ArrowRightLeft
    },
    {
      label: copy.totalOutflow,
      value: formatCurrency(monthlyFuelSpend + monthlyTransferTotal, language),
      helper: dateRangeLabel,
      icon: Wallet
    },
    {
      label: copy.avgKmPerLitre,
      value:
        efficiencyStats.averageKmPerLitre != null
          ? formatNumber(efficiencyStats.averageKmPerLitre, language, 2)
          : copy.notEnoughValidData,
      helper: `${formatNumber(efficiencyStats.validRecordCount, language)} valid records this month`,
      icon: Gauge
    },
    {
      label: copy.oilDue,
      value: formatNumber(oilDueRows.length, language),
      helper: `${formatNumber(oilAttentionRows.filter((row) => row.status === "not_set").length, language)} need baseline`,
      icon: Droplet
    },
    {
      label: copy.unchecked,
      value: formatNumber(uncheckedRecords, language),
      helper: `${formatNumber(uncheckedFuelCount, language)} fuel, ${formatNumber(uncheckedTransferCount, language)} transfers | ${monthRange.monthKey}`,
      icon: CheckCircle2
    }
  ];

  return (
    <>
      <div className="mb-6 hidden md:block">
        <Header title={t.dashboard.title} description={t.dashboard.description} />
      </div>

      {error ? <p className="mb-4 text-sm text-rose-600">{error}</p> : null}

      {loading ? (
        <section className="surface-card p-5 text-sm text-slate-500">{t.common.loading}</section>
      ) : (
        <>
          <section className="surface-card p-4 sm:p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h3 className="section-title">{copy.selectedMonth}</h3>
                <p className="section-subtitle">{copy.dateRange}: {dateRangeLabel}</p>
              </div>
              <div className="grid gap-2 sm:grid-cols-[auto_auto_auto] sm:items-end">
                <button type="button" onClick={() => setSelectedMonth(getCurrentMonthKey())} className="btn-secondary">
                  {copy.currentMonth}
                </button>
                <button type="button" onClick={() => setSelectedMonth((month) => shiftMonth(month, -1))} className="btn-secondary">
                  {copy.previousMonth}
                </button>
                <label className="min-w-[170px]">
                  <span className="form-label">{copy.selectedMonth}</span>
                  <input
                    type="month"
                    value={monthRange.monthKey}
                    onChange={(event) => setSelectedMonth(event.target.value || getCurrentMonthKey())}
                    className="form-input bg-white"
                  />
                </label>
              </div>
            </div>
          </section>

          <section className="mt-5 surface-card p-4 sm:p-5">
            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="section-title">{copy.needsAttention}</h3>
                <p className="section-subtitle">{dateRangeLabel}</p>
              </div>
              {refreshing ? (
                <span className="inline-flex items-center gap-2 text-xs font-semibold text-slate-500">
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  {t.common.loading}
                </span>
              ) : null}
            </div>
            {visibleAttentionItems.length ? (
              <div className="grid gap-2 lg:grid-cols-2">
                {visibleAttentionItems.map((item) => <AttentionRow key={item.key} item={item} />)}
              </div>
            ) : (
              <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
                {copy.noAttention}
              </div>
            )}
            {hiddenAttentionItems.length ? (
              <details className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <summary className="cursor-pointer text-sm font-semibold text-slate-700">
                  {copy.allIssues} ({formatNumber(hiddenAttentionItems.length, language)})
                </summary>
                <div className="mt-2 grid gap-2 lg:grid-cols-2">
                  {hiddenAttentionItems.map((item) => <AttentionRow key={item.key} item={item} />)}
                </div>
              </details>
            ) : null}
          </section>

          <section className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {summaryCards.map((card) => (
              <SummaryCard key={card.label} {...card} />
            ))}
          </section>

          <section className="mt-5 grid gap-4 xl:grid-cols-2">
            <section className="surface-card p-5 sm:p-6">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h3 className="section-title">{copy.latestFuel}</h3>
                  <p className="section-subtitle">{dateRangeLabel}</p>
                </div>
                <Fuel className="h-5 w-5 text-brand-700" />
              </div>

              {latestFuelLogs.length === 0 ? (
                <EmptyState title={copy.noFuel} description="" />
              ) : (
                <div className="table-shell">
                  <div className="table-scroll">
                    <table className="w-full min-w-[720px]">
                      <thead>
                        <tr>
                          <th className="table-head-cell">{t.dashboard.table.date}</th>
                          <th className="table-head-cell">{t.dashboard.table.driver}</th>
                          <th className="table-head-cell">{t.dashboard.table.vehicle}</th>
                          <th className="table-head-cell text-right">{t.dashboard.table.cost}</th>
                          <th className="table-head-cell">{copy.unchecked}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {latestFuelLogs.map((log) => (
                          <tr key={log.id} className="enterprise-table-row">
                            <td className="table-body-cell supporting-date-strong">{formatDate(log.date, language)}</td>
                            <td className="table-body-cell table-driver-name">{log.driver || "-"}</td>
                            <td className="table-body-cell">{log.vehicle_reg || "-"}</td>
                            <td className="table-body-cell text-right font-semibold text-slate-950">{formatCurrency(Number(log.total_cost || 0), language)}</td>
                            <td className="table-body-cell"><StatusBadge checked={log.receipt_checked} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </section>

            <section className="surface-card p-5 sm:p-6">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h3 className="section-title">{copy.latestTransfers}</h3>
                  <p className="section-subtitle">{dateRangeLabel}</p>
                </div>
                <ArrowRightLeft className="h-5 w-5 text-brand-700" />
              </div>

              {latestTransfers.length === 0 ? (
                <EmptyState title={copy.noTransfers} description="" />
              ) : (
                <div className="table-shell">
                  <div className="table-scroll">
                    <table className="w-full min-w-[720px]">
                      <thead>
                        <tr>
                          <th className="table-head-cell">{t.dashboard.table.date}</th>
                          <th className="table-head-cell">{t.dashboard.table.driver}</th>
                          <th className="table-head-cell">{t.dashboard.table.type}</th>
                          <th className="table-head-cell text-right">{t.dashboard.table.amount}</th>
                          <th className="table-head-cell">{copy.unchecked}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {latestTransfers.map((transfer) => (
                          <tr key={transfer.id} className="enterprise-table-row">
                            <td className="table-body-cell supporting-date-strong">{formatDate(transfer.date, language)}</td>
                            <td className="table-body-cell table-driver-name">{transfer.driver || "-"}</td>
                            <td className="table-body-cell">{getTransferTypeLabel(t, transfer.transfer_type)}</td>
                            <td className="table-body-cell text-right font-semibold text-slate-950">{formatCurrency(Number(transfer.amount || 0), language)}</td>
                            <td className="table-body-cell"><StatusBadge checked={transfer.receipt_status === "approved"} /></td>
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
