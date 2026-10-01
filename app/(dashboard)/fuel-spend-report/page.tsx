"use client";

import { ArrowRight, BarChart3, ChevronDown, Download, FileText, Filter, Search, X } from "lucide-react";
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { EmptyState } from "@/components/empty-state";
import { FuelStationBadge } from "@/components/fuel-station-badge";
import { fetchFuelLogsForExport } from "@/lib/data";
import { exportWorkbookToXlsx } from "@/lib/export";
import { normalizeFuelLogLocation, shouldShowFuelLogLocationOption } from "@/lib/fuel-log-location";
import { buildFuelSpendPdf, downloadReportBlob } from "@/lib/fuel-spend-pdf";
import {
  buildFuelSpendManagementReport,
  getFuelSpendReportLogCost,
  normalizeFuelSpendReportVehicleRegistration,
  type FuelSpendVehiclePerformanceRow
} from "@/lib/fuel-spend-report";
import { useLanguage } from "@/lib/language-provider";
import { formatDate, formatNumber, normalizeDisplayName, today } from "@/lib/utils";
import type { FuelLogEntrySource, FuelLogWithDriver } from "@/types/database";

type DatePreset = "today" | "this_week" | "this_month" | "last_month" | "custom";
type SortKey = "totalSpend" | "totalLitres" | "entryCount" | "lastUsedDate";
type BreakdownView = "vehicle" | "driver" | "station";
type PerformanceSortKey = "spend" | "litres" | "fuelLogs";
type SpendVehicleRow = FuelSpendVehiclePerformanceRow & {
  spendPercent: number;
  averageSpendPerFill: number;
  mainStation: string;
  mainStationFillUps: number;
};
type DriverPerformanceRow = { driver: string; spend: number; litres: number; fuelLogs: number; vehicles: Set<string> };
type ManagementStationRow = { station: "Shell" | "Bangchak" | "Other"; fillUps: number; litres: number; spend: number; weightedAveragePrice: number | null; spendPercent: number };
type OtherStationDetailRow = { name: string; fillUps: number; litres: number; spend: number; shareOfOther: number };

type ReportFilters = {
  preset: DatePreset;
  fromDate: string;
  toDate: string;
  driver: string;
  fuelType: string;
  location: string;
  vehicleReg: string;
  checkedStatus: "" | "checked" | "not_checked";
};

type GroupedFuelSpendRow = {
  id: string;
  vehicleReg: string;
  driver: string;
  drivers: string[];
  location: string;
  locations: string[];
  totalSpend: number;
  totalLitres: number;
  entryCount: number;
  checkedEntries: number;
  uncheckedEntries: number;
  uncheckedSpend: number;
  receiptCompliance: number;
  lastUsedDate: string;
  logs: FuelLogWithDriver[];
};

function toDateKey(date: Date) {
  const timezoneOffsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - timezoneOffsetMs).toISOString().slice(0, 10);
}

function getPresetRange(preset: DatePreset) {
  const now = new Date();
  const day = now.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() + mondayOffset);

  if (preset === "today") {
    return { fromDate: today(), toDate: today() };
  }

  if (preset === "this_week") {
    return { fromDate: toDateKey(startOfWeek), toDate: today() };
  }

  if (preset === "last_month") {
    const firstDay = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastDay = new Date(now.getFullYear(), now.getMonth(), 0);
    return { fromDate: toDateKey(firstDay), toDate: toDateKey(lastDay) };
  }

  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
  return { fromDate: toDateKey(firstDay), toDate: today() };
}


function getPreviousPeriodRange(fromDate: string, toDate: string) {
  if (!fromDate || !toDate) return { fromDate: "", toDate: "" };
  const from = new Date(`${fromDate}T00:00:00`);
  const to = new Date(`${toDate}T00:00:00`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) return { fromDate: "", toDate: "" };
  const dayMs = 24 * 60 * 60 * 1000;
  const days = Math.floor((to.getTime() - from.getTime()) / dayMs) + 1;
  const previousTo = new Date(from.getTime() - dayMs);
  const previousFrom = new Date(previousTo.getTime() - (days - 1) * dayMs);
  return { fromDate: toDateKey(previousFrom), toDate: toDateKey(previousTo) };
}

function percentChange(current: number, previous: number) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

function getSafeNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getPricePerLitre(log: FuelLogWithDriver) {
  const storedPrice = Number(log.price_per_litre);
  if (Number.isFinite(storedPrice) && storedPrice > 0) return storedPrice;

  const litres = getSafeNumber(log.litres);
  const totalCost = getFuelSpendReportLogCost(log);
  return litres > 0 ? totalCost / litres : null;
}

function formatBaht(value: number) {
  return `\u0e3f${new Intl.NumberFormat("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value || 0)}`;
}

function formatLitres(value: number, language: "en" | "th") {
  return `${formatNumber(value, language, 2)} L`;
}

function formatPrice(value: number | null) {
  return value == null || !Number.isFinite(value) ? "-" : `${formatBaht(value)}/L`;
}

function formatPercent(value: number | null, language: "en" | "th") {
  return value == null || !Number.isFinite(value) ? "-" : `${formatNumber(value, language, 1)}%`;
}

function formatSignedChange(value: number | null, language: "en" | "th") {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${value > 0 ? "+" : ""}${formatBaht(value)}`;
}

function getEntrySourceLabel(source: FuelLogEntrySource, labels: ReturnType<typeof useLanguage>["t"]["fuelSpendReport"]) {
  if (source === "direct_from_receipt") return labels.directFromReceipt;
  if (source === "statement_manual") return labels.directFromStatement;
  if (source === "statement_import") return labels.statementImport;
  if (source === "other") return labels.other;
  return labels.lineMessage;
}

function getCheckedStatusBadgeClass(checked: boolean) {
  return checked
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : "border-amber-200 bg-amber-100 text-amber-800";
}

export default function FuelSpendReportPage() {
  const { language, t } = useLanguage();
  const labels = t.fuelSpendReport;
  const defaultRange = useMemo(() => getPresetRange("this_month"), []);
  const [fuelLogs, setFuelLogs] = useState<FuelLogWithDriver[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>("totalSpend");
  const [exportingManagerPdf, setExportingManagerPdf] = useState(false);
  const [exportingFullPdf, setExportingFullPdf] = useState(false);
  const [breakdownView, setBreakdownView] = useState<BreakdownView>("vehicle");
  const [showAllPerformance, setShowAllPerformance] = useState(false);
  const [ledgerSearch, setLedgerSearch] = useState("");
  const [ledgerStatus, setLedgerStatus] = useState<"all" | "pending" | "checked">("all");
  const [showAllLedger, setShowAllLedger] = useState(false);
  const [visibleLogCounts, setVisibleLogCounts] = useState<Record<string, number>>({});
  const [performanceSort, setPerformanceSort] = useState<PerformanceSortKey>("spend");
  const [reportView, setReportView] = useState<"summary" | "ledger">("summary");
  const [selectedPerformanceVehicle, setSelectedPerformanceVehicle] = useState<SpendVehicleRow | null>(null);
  const [showOtherStationDetails, setShowOtherStationDetails] = useState(false);
  const [filters, setFilters] = useState<ReportFilters>({
    preset: "this_month",
    fromDate: defaultRange.fromDate,
    toDate: defaultRange.toDate,
    driver: "",
    fuelType: "",
    location: "",
    vehicleReg: "",
    checkedStatus: ""
  });

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchFuelLogsForExport()
      .then((rows) => {
        if (active) setFuelLogs(rows);
      })
      .catch((err) => {
        console.error("Fuel spend report load error:", err);
        if (active) setError(err instanceof Error ? err.message : "Unable to load fuel spend report.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const updatePreset = (preset: DatePreset) => {
    if (preset === "custom") {
      setFilters((current) => ({ ...current, preset }));
      return;
    }

    const range = getPresetRange(preset);
    setFilters((current) => ({ ...current, preset, ...range }));
  };

  const clearFilters = () => {
    const range = getPresetRange("this_month");
    setFilters({ preset: "this_month", fromDate: range.fromDate, toDate: range.toDate, driver: "", fuelType: "", location: "", vehicleReg: "", checkedStatus: "" });
    setExpandedRows(new Set());
  };

  const toggleExpandedRow = (rowId: string) => {
    setExpandedRows((current) => {
      const next = new Set(current);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  };

  const normalizedLogs = useMemo(
    () =>
      fuelLogs.map((log) => ({
        ...log,
        driver: normalizeDisplayName(log.driver) || labels.unknownDriver,
        location: normalizeFuelLogLocation(log.location) || labels.unknownLocation,
        vehicle_reg: normalizeFuelSpendReportVehicleRegistration(log.vehicle_reg)
      })),
    [fuelLogs, labels.unknownDriver, labels.unknownLocation]
  );

  const driverOptions = useMemo(
    () => Array.from(new Set(normalizedLogs.map((log) => log.driver))).sort((a, b) => a.localeCompare(b)),
    [normalizedLogs]
  );

  const locationOptions = useMemo(
    () =>
      Array.from(new Set(normalizedLogs.map((log) => log.location).filter(shouldShowFuelLogLocationOption)))
        .filter((location) => !["Bangchak", "Shell", "Best LPG", "Other"].includes(location))
        .sort((a, b) =>
        a.localeCompare(b)
      ),
    [normalizedLogs]
  );

  const vehicleOptions = useMemo(
    () => Array.from(new Set(normalizedLogs.map((log) => log.vehicle_reg).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [normalizedLogs]
  );

  const fuelTypeOptions = useMemo(
    () => Array.from(new Set(normalizedLogs.map((log) => String(log.fuel_type || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [normalizedLogs]
  );

  const reportSourceLogs = useMemo(
    () =>
      normalizedLogs.filter((log) => {
        if (filters.checkedStatus === "checked" && !log.receipt_checked) return false;
        if (filters.checkedStatus === "not_checked" && log.receipt_checked) return false;
        return true;
      }),
    [filters.checkedStatus, normalizedLogs]
  );

  const managementReport = useMemo(
    () =>
      buildFuelSpendManagementReport(reportSourceLogs, {
        fromDate: filters.fromDate,
        toDate: filters.toDate,
        driver: filters.driver,
        fuelType: filters.fuelType,
        location: filters.location,
        vehicleReg: filters.vehicleReg
      }),
    [filters.driver, filters.fromDate, filters.fuelType, filters.location, filters.toDate, filters.vehicleReg, reportSourceLogs]
  );

  const filteredLogs = managementReport.logs;
  const previousPeriodRange = useMemo(() => getPreviousPeriodRange(filters.fromDate, filters.toDate), [filters.fromDate, filters.toDate]);

  const previousManagementReport = useMemo(
    () =>
      previousPeriodRange.fromDate && previousPeriodRange.toDate
        ? buildFuelSpendManagementReport(reportSourceLogs, {
            fromDate: previousPeriodRange.fromDate,
            toDate: previousPeriodRange.toDate,
            driver: filters.driver,
            fuelType: filters.fuelType,
            location: filters.location,
            vehicleReg: filters.vehicleReg
          })
        : null,
    [filters.driver, filters.fuelType, filters.location, filters.vehicleReg, previousPeriodRange.fromDate, previousPeriodRange.toDate, reportSourceLogs]
  );

  const metricChanges = useMemo(() => {
    const previousVehicles = previousManagementReport?.vehicleRows.length ?? 0;
    return {
      spend: previousManagementReport ? percentChange(managementReport.totalSpend, previousManagementReport.totalSpend) : null,
      litres: previousManagementReport ? percentChange(managementReport.totalLitres, previousManagementReport.totalLitres) : null,
      logs: previousManagementReport ? percentChange(managementReport.totalFillUps, previousManagementReport.totalFillUps) : null,
      vehicles: previousManagementReport ? percentChange(managementReport.vehicleRows.length, previousVehicles) : null
    };
  }, [managementReport, previousManagementReport]);


  const groupedRows = useMemo(() => {
    const groups = new Map<string, GroupedFuelSpendRow>();

    for (const log of filteredLogs) {
      const key = log.vehicle_reg;
      const existing = groups.get(key);
      const totalCost = getFuelSpendReportLogCost(log);
      const litres = getSafeNumber(log.litres);
      const checkedEntries = log.receipt_checked ? 1 : 0;
      const uncheckedEntries = log.receipt_checked ? 0 : 1;
      const uncheckedSpend = log.receipt_checked ? 0 : totalCost;

      if (!existing) {
        groups.set(key, {
          id: key,
          vehicleReg: log.vehicle_reg,
          driver: log.driver,
          drivers: [log.driver].filter(Boolean),
          location: log.location,
          locations: [log.location].filter(Boolean),
          totalSpend: totalCost,
          totalLitres: litres,
          entryCount: 1,
          checkedEntries,
          uncheckedEntries,
          uncheckedSpend,
          receiptCompliance: log.receipt_checked ? 100 : 0,
          lastUsedDate: log.date,
          logs: [log]
        });
        continue;
      }

      existing.totalSpend += totalCost;
      if (log.location && !existing.locations.includes(log.location)) existing.locations.push(log.location);
      existing.totalLitres += litres;
      existing.entryCount += 1;
      if (log.driver && !existing.drivers.includes(log.driver)) existing.drivers.push(log.driver);
      existing.checkedEntries += checkedEntries;
      existing.uncheckedEntries += uncheckedEntries;
      existing.uncheckedSpend += uncheckedSpend;
      existing.lastUsedDate = log.date > existing.lastUsedDate ? log.date : existing.lastUsedDate;
      existing.logs.push(log);
    }

    const rows = Array.from(groups.values()).map((row) => ({
      ...row,
      receiptCompliance: row.entryCount > 0 ? (row.checkedEntries / row.entryCount) * 100 : 0,
      logs: row.logs.sort((left, right) => right.date.localeCompare(left.date))
    }));

    return rows.sort((left, right) => {
      if (sortKey === "lastUsedDate") return right.lastUsedDate.localeCompare(left.lastUsedDate);
      return right[sortKey] - left[sortKey];
    });
  }, [filteredLogs, sortKey]);

  const summary = useMemo(() => {
    const checkedEntries = managementReport.logs.filter((log) => log.receipt_checked).length;
    const uncheckedEntries = managementReport.logs.length - checkedEntries;
    const uncheckedSpend = managementReport.logs.reduce((sum, log) => (log.receipt_checked ? sum : sum + log.costAmount), 0);
    const driverSpend = new Map<string, number>();
    managementReport.logs.forEach((log) => driverSpend.set(log.driver, (driverSpend.get(log.driver) ?? 0) + log.costAmount));
    const topSpendingDriver = Array.from(driverSpend.entries()).sort((left, right) => right[1] - left[1])[0];

    return {
      totalSpend: managementReport.totalSpend,
      totalLitres: managementReport.totalLitres,
      averagePricePerLitre: managementReport.weightedAveragePrice,
      entryCount: managementReport.totalFillUps,
      checkedEntries,
      uncheckedEntries,
      uncheckedSpend,
      mostUsedStation: managementReport.mostUsedStation?.station ?? "-",
      topSpendingDriverName: topSpendingDriver?.[0] ?? "-",
      topSpendingDriverSpend: topSpendingDriver?.[1] ?? 0
    };
  }, [managementReport]);

  const driverPerformanceRows = useMemo(() => {
    const drivers = new Map<string, { driver: string; spend: number; litres: number; fuelLogs: number; vehicles: Set<string> }>();
    filteredLogs.forEach((log) => {
      const driver = log.driver || labels.unknownDriver;
      const row = drivers.get(driver) ?? { driver, spend: 0, litres: 0, fuelLogs: 0, vehicles: new Set<string>() };
      row.spend += getFuelSpendReportLogCost(log);
      row.litres += getSafeNumber(log.litres);
      row.fuelLogs += 1;
      if (log.vehicle_reg) row.vehicles.add(log.vehicle_reg);
      drivers.set(driver, row);
    });
    return Array.from(drivers.values()).sort((left, right) => right.spend - left.spend);
  }, [filteredLogs, labels.unknownDriver]);

  const managementStationRows = useMemo(() => {
    const groups = new Map<"Shell" | "Bangchak" | "Other", { station: "Shell" | "Bangchak" | "Other"; fillUps: number; litres: number; spend: number }>();
    filteredLogs.forEach((log) => {
      const station = log.canonicalLocationGroup === "Shell" || log.canonicalLocationGroup === "Bangchak" ? log.canonicalLocationGroup : "Other";
      const row = groups.get(station) ?? { station, fillUps: 0, litres: 0, spend: 0 };
      row.fillUps += 1;
      row.litres += log.litresAmount;
      row.spend += log.costAmount;
      groups.set(station, row);
    });
    return (["Shell", "Bangchak", "Other"] as const)
      .map((station) => groups.get(station))
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
      .map((row) => ({
        ...row,
        weightedAveragePrice: row.litres > 0 ? row.spend / row.litres : null,
        spendPercent: managementReport.totalSpend > 0 ? (row.spend / managementReport.totalSpend) * 100 : 0
      }));
  }, [filteredLogs, managementReport.totalSpend]);

  const otherStationDetails = useMemo<OtherStationDetailRow[]>(() => {
    const otherLogs = filteredLogs.filter((log) => log.canonicalLocationGroup !== "Shell" && log.canonicalLocationGroup !== "Bangchak");
    const totalOtherSpend = otherLogs.reduce((sum, log) => sum + log.costAmount, 0);
    const groups = new Map<string, { name: string; fillUps: number; litres: number; spend: number }>();

    otherLogs.forEach((log) => {
      const name = String(log.location || log.canonicalLocationGroup || labels.unknownLocation).trim() || labels.unknownLocation;
      const row = groups.get(name) ?? { name, fillUps: 0, litres: 0, spend: 0 };
      row.fillUps += 1;
      row.litres += log.litresAmount;
      row.spend += log.costAmount;
      groups.set(name, row);
    });

    return Array.from(groups.values())
      .map((row) => ({ ...row, shareOfOther: totalOtherSpend > 0 ? (row.spend / totalOtherSpend) * 100 : 0 }))
      .sort((left, right) => right.spend - left.spend);
  }, [filteredLogs, labels.unknownLocation]);

  const spendVehicleRows = useMemo<SpendVehicleRow[]>(() => {
    const stationCountsByVehicle = new Map<string, Map<string, number>>();
    filteredLogs.forEach((log) => {
      const vehicle = log.vehicle_reg;
      if (!vehicle) return;
      const station = log.canonicalLocationGroup || log.location || labels.unknownLocation;
      const vehicleStations = stationCountsByVehicle.get(vehicle) ?? new Map<string, number>();
      vehicleStations.set(station, (vehicleStations.get(station) ?? 0) + 1);
      stationCountsByVehicle.set(vehicle, vehicleStations);
    });

    return managementReport.vehicleRows.map((row) => {
      const stationCounts = stationCountsByVehicle.get(row.vehicleReg) ?? new Map<string, number>();
      const mainStationEntry = Array.from(stationCounts.entries()).sort((left, right) => right[1] - left[1])[0];
      return {
        ...row,
        spendPercent: managementReport.totalSpend > 0 ? (row.spend / managementReport.totalSpend) * 100 : 0,
        averageSpendPerFill: row.fuelLogs > 0 ? row.spend / row.fuelLogs : 0,
        mainStation: mainStationEntry?.[0] ?? "-",
        mainStationFillUps: mainStationEntry?.[1] ?? 0
      };
    });
  }, [filteredLogs, labels.unknownLocation, managementReport.totalSpend, managementReport.vehicleRows]);

  const sortedVehicleRows = useMemo(() => {
    const rows = [...spendVehicleRows];
    rows.sort((left, right) => {
      if (performanceSort === "litres") return right.litres - left.litres;
      if (performanceSort === "fuelLogs") return right.fuelLogs - left.fuelLogs;
      return right.spend - left.spend;
    });
    return rows;
  }, [performanceSort, spendVehicleRows]);

  const highestSpendVehicle = useMemo(() => spendVehicleRows.reduce<SpendVehicleRow | null>((best, row) => !best || row.spend > best.spend ? row : best, null), [spendVehicleRows]);
  const lowestSpendVehicle = useMemo(() => spendVehicleRows.filter((row) => row.spend > 0).reduce<SpendVehicleRow | null>((best, row) => !best || row.spend < best.spend ? row : best, null), [spendVehicleRows]);
  const mostUsedStationRow = useMemo(() => [...managementStationRows].sort((left, right) => right.fillUps - left.fillUps)[0] ?? null, [managementStationRows]);
  const topFiveSpendShare = useMemo(() => {
    if (managementReport.totalSpend <= 0) return 0;
    return (spendVehicleRows.slice().sort((left, right) => right.spend - left.spend).slice(0, 5).reduce((sum, row) => sum + row.spend, 0) / managementReport.totalSpend) * 100;
  }, [managementReport.totalSpend, spendVehicleRows]);
  const averageSpendPerVehicle = spendVehicleRows.length > 0 ? managementReport.totalSpend / spendVehicleRows.length : 0;

  const biggestVehicleMovement = useMemo(() => {
    if (!previousManagementReport) return null;
    const previousByVehicle = new Map(previousManagementReport.vehicleRows.map((row) => [row.vehicleReg, row.spend]));
    const movements = spendVehicleRows
      .map((row) => {
        const previousSpend = previousByVehicle.get(row.vehicleReg);
        if (previousSpend == null || previousSpend <= 0) return null;
        const amount = row.spend - previousSpend;
        return { vehicleReg: row.vehicleReg, amount, percent: (amount / previousSpend) * 100 };
      })
      .filter((row): row is { vehicleReg: string; amount: number; percent: number } => row != null);
    return movements.sort((left, right) => Math.abs(right.amount) - Math.abs(left.amount))[0] ?? null;
  }, [previousManagementReport, spendVehicleRows]);

  const performanceVehicleRows = showAllPerformance ? sortedVehicleRows : sortedVehicleRows.slice(0, 8);
  const displayedDriverRows = showAllPerformance ? driverPerformanceRows : driverPerformanceRows.slice(0, 8);

  const filteredLedgerRows = useMemo(() => {
    const query = ledgerSearch.trim().toLowerCase();
    return groupedRows.filter((row) => {
      if (ledgerStatus === "pending" && row.uncheckedEntries === 0) return false;
      if (ledgerStatus === "checked" && row.uncheckedEntries > 0) return false;
      if (!query) return true;
      return [row.vehicleReg, ...row.drivers, ...row.locations]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [groupedRows, ledgerSearch, ledgerStatus]);

  const displayedLedgerRows = showAllLedger ? filteredLedgerRows : filteredLedgerRows.slice(0, 10);

  const dateRangeLabel = filters.fromDate && filters.toDate
    ? `${formatDate(filters.fromDate, language)} - ${formatDate(filters.toDate, language)}`
    : filters.fromDate
      ? `${language === "th" ? "ตั้งแต่" : "From"} ${formatDate(filters.fromDate, language)}`
      : filters.toDate
        ? `${language === "th" ? "ถึง" : "Through"} ${formatDate(filters.toDate, language)}`
        : language === "th" ? "ช่วงเวลาปัจจุบัน" : "Current period";

  const managementInsights = useMemo(() => {
    const insights: { key: string; label: string; text: string; tone: "slate" | "amber" | "emerald" }[] = [];

    insights.push({
      key: "concentration",
      label: language === "th" ? "การกระจุกตัวของค่าใช้จ่าย" : "Spend concentration",
      text: language === "th"
        ? `รถ 5 อันดับแรกคิดเป็น ${formatNumber(topFiveSpendShare, language, 1)}% ของค่าใช้จ่ายน้ำมันทั้งหมดในช่วงนี้`
        : `The top 5 vehicles account for ${formatNumber(topFiveSpendShare, language, 1)}% of total fuel spend in this period.`,
      tone: topFiveSpendShare >= 60 ? "amber" : "slate"
    });

    if (biggestVehicleMovement) {
      const up = biggestVehicleMovement.amount > 0;
      insights.push({
        key: "movement",
        label: language === "th" ? "การเปลี่ยนแปลงที่มากที่สุด" : "Biggest vehicle movement",
        text: language === "th"
          ? `${biggestVehicleMovement.vehicleReg} ${up ? "เพิ่มขึ้น" : "ลดลง"} ${formatBaht(Math.abs(biggestVehicleMovement.amount))} (${formatNumber(Math.abs(biggestVehicleMovement.percent), language, 1)}%) เทียบกับช่วงก่อนหน้า`
          : `${biggestVehicleMovement.vehicleReg} is ${up ? "up" : "down"} ${formatBaht(Math.abs(biggestVehicleMovement.amount))} (${formatNumber(Math.abs(biggestVehicleMovement.percent), language, 1)}%) versus the comparable previous period.`,
        tone: up ? "amber" : "emerald"
      });
    }

    const shell = managementStationRows.find((row) => row.station === "Shell")?.spendPercent ?? 0;
    const bangchak = managementStationRows.find((row) => row.station === "Bangchak")?.spendPercent ?? 0;
    insights.push({
      key: "stations",
      label: language === "th" ? "การพึ่งพาสถานี" : "Station dependency",
      text: language === "th"
        ? `Shell และ Bangchak รวมกันคิดเป็น ${formatNumber(shell + bangchak, language, 1)}% ของค่าใช้จ่ายน้ำมันทั้งหมด`
        : `Shell and Bangchak together account for ${formatNumber(shell + bangchak, language, 1)}% of total fuel spend.`,
      tone: "slate"
    });

    insights.push({
      key: "average-vehicle",
      label: language === "th" ? "ค่าใช้จ่ายเฉลี่ยต่อรถ" : "Average spend per fuelled vehicle",
      text: language === "th"
        ? `${formatBaht(averageSpendPerVehicle)} ต่อรถ จาก ${formatNumber(spendVehicleRows.length, language)} คันที่มีรายการเติมน้ำมัน`
        : `${formatBaht(averageSpendPerVehicle)} per vehicle across ${formatNumber(spendVehicleRows.length, language)} vehicles with fuel activity.`,
      tone: "slate"
    });

    return insights;
  }, [averageSpendPerVehicle, biggestVehicleMovement, language, managementStationRows, spendVehicleRows.length, topFiveSpendShare]);

  const handleDownloadFuelSpendPdf = async (full: boolean) => {
    if (full) setExportingFullPdf(true);
    else setExportingManagerPdf(true);

    try {
      const blob = await buildFuelSpendPdf(managementReport, { full, language, periodLabel: dateRangeLabel });
      downloadReportBlob(blob, full ? "fuel-spend-management-report.pdf" : "fuel-spend-manager-summary.pdf");
    } finally {
      if (full) setExportingFullPdf(false);
      else setExportingManagerPdf(false);
    }
  };

  const exportReport = () => {
    exportWorkbookToXlsx(
      [
        {
          name: "Executive Summary",
          rows: [
            { Field: "Generated date", Value: new Date().toLocaleString("en-GB") },
            { Field: "Selected period", Value: dateRangeLabel },
            { Field: "Latest fuel-log date", Value: managementReport.latestFuelLogDate ?? "-" },
            { Field: "Fuel logs analysed", Value: managementReport.totalFillUps },
            { Field: "Total fuel spend", Value: managementReport.totalSpend },
            { Field: "Total litres", Value: managementReport.totalLitres },
            { Field: "Weighted average baht per litre", Value: managementReport.weightedAveragePrice },
            { Field: "Previous period spend change", Value: managementReport.spendChangeAmount },
            { Field: "Previous period spend change percent", Value: managementReport.spendChangePercent },
            { Field: "Highest spend vehicle", Value: managementReport.highestSpendVehicle?.vehicleReg ?? "-" },
            { Field: "Most-used station", Value: managementReport.mostUsedStation?.station ?? "-" },
            { Field: "Bangchak regular-fuel usage percent", Value: managementReport.bangchakRegularFuelUsagePercent },
            { Field: "Reconciliation status", Value: managementReport.reconciliationStatus }
          ]
        },
        {
          name: "Vehicle Fuel Performance",
          rows: managementReport.vehicleRows.map((row) => ({
            Vehicle: row.vehicleReg,
            Driver: row.driver,
            "Fuel Logs": row.fuelLogs,
            Litres: row.litres,
            "Fuel Spend": row.spend,
            "Share of Total Spend %": managementReport.totalSpend > 0 ? (row.spend / managementReport.totalSpend) * 100 : 0,
            "Average Spend per Fill": row.fuelLogs > 0 ? row.spend / row.fuelLogs : 0
          }))
        },
        {
          name: "Station Performance",
          rows: managementReport.stationRows.map((row) => ({
            Station: row.station,
            "Fill-ups": row.fillUps,
            Litres: row.litres,
            Spend: row.spend,
            "Weighted Avg Baht/L": row.weightedAveragePrice,
            "% of Fill-ups": row.fillUpPercent,
            "% of Spend": row.spendPercent
          }))
        },
        {
          name: "Needs Attention",
          rows: managementReport.needsAttention.map((log) => ({
            Date: log.date,
            Vehicle: log.canonicalVehicleReg,
            Driver: log.driver || "-",
            Station: log.location || log.canonicalLocationGroup,
            Litres: log.litresAmount,
            Spend: log.costAmount,
            "Price Baht/L": log.calculatedPricePerLitre,
            "Receipt Checked": log.receipt_checked ? "Yes" : "No",
            Status: log.qualityStatus,
            Issues: log.issues.join(", ")
          }))
        },
        {
          name: "Detailed Fuel Logs",
          rows: managementReport.logs.map((log) => ({
            Date: log.date,
            Driver: log.driver,
            Vehicle: log.canonicalVehicleReg,
            Station: log.location,
            "Station Group": log.canonicalLocationGroup,
            "Fuel Type": log.fuel_type ?? "",
            Mileage: Number(log.mileage ?? log.odometer) || null,
            Litres: log.litresAmount,
            "Total Cost": log.costAmount,
            "Stored Price/L": Number(log.price_per_litre) || null,
            "Calculated Price/L": log.calculatedPricePerLitre,
            "Receipt Checked": log.receipt_checked ? "Yes" : "No",
            Source: getEntrySourceLabel(log.entry_source, labels),
            Notes: log.notes ?? "",
            Issues: log.issues.join(", ")
          }))
        }
      ],
      "fuel-spend-management-report"
    );
  };

  return (
    <>
      <section className="surface-card mb-4 overflow-hidden border border-brand-100/80 shadow-[0_16px_42px_rgba(76,29,149,0.08)]">
        <div className="border-b border-brand-100/80 bg-[radial-gradient(circle_at_top_right,rgba(124,58,237,0.12),transparent_36%),linear-gradient(135deg,#ffffff_0%,#fbf9ff_60%,#f6f2ff_100%)] px-5 py-4 sm:px-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 rounded-full border border-brand-100 bg-white/90 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-700 shadow-sm">
                <BarChart3 className="h-3.5 w-3.5" />
                Management report
              </div>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950 sm:text-[1.7rem]">Fuel Spend Report</h1>
              <p className="mt-1 max-w-3xl text-sm text-slate-500">
                A management view of fuel cost, vehicle performance, station usage and data quality.
              </p>
              <div className="mt-2.5 flex flex-wrap gap-1.5 text-[11px] font-semibold">
                <span className="rounded-full border border-brand-100 bg-white px-2.5 py-1 text-brand-800">{dateRangeLabel}</span>
                <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-slate-600">{formatNumber(summary.entryCount, language)} fuel logs</span>
                <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-slate-600">{formatNumber(groupedRows.length, language)} vehicles</span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 xl:justify-end">
              <div className="inline-flex rounded-2xl border border-brand-100 bg-white/90 p-1 shadow-sm">
                <button
                  type="button"
                  onClick={() => setReportView("summary")}
                  className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${reportView === "summary" ? "bg-brand-700 text-white shadow-sm" : "text-slate-600 hover:bg-brand-50"}`}
                >
                  Summary
                </button>
                <button
                  type="button"
                  onClick={() => setReportView("ledger")}
                  className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${reportView === "ledger" ? "bg-brand-700 text-white shadow-sm" : "text-slate-600 hover:bg-brand-50"}`}
                >
                  Vehicle ledger
                </button>
              </div>
              <button
                type="button"
                onClick={() => { setFilters((current) => ({ ...current, checkedStatus: "not_checked" })); setLedgerStatus("pending"); setReportView("ledger"); }}
                className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm font-semibold text-amber-800 shadow-sm hover:bg-amber-100"
              >
                {labels.showUncheckedOnly}
              </button>
              <details className="relative">
                <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl bg-brand-700 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-brand-700/20 hover:bg-brand-800">
                  <Download className="h-4 w-4" /> Export <ChevronDown className="h-4 w-4" />
                </summary>
                <div className="absolute right-0 z-30 mt-2 w-72 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
                  <button type="button" onClick={() => handleDownloadFuelSpendPdf(false)} disabled={!filteredLogs.length || exportingManagerPdf} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                    <FileText className="h-4 w-4 text-brand-700" /> {exportingManagerPdf ? "Preparing..." : "Manager summary PDF"}
                  </button>
                  <button type="button" onClick={() => handleDownloadFuelSpendPdf(true)} disabled={!filteredLogs.length || exportingFullPdf} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                    <FileText className="h-4 w-4 text-brand-700" /> {exportingFullPdf ? "Preparing..." : "Full fuel report PDF"}
                  </button>
                  <button type="button" onClick={exportReport} disabled={!filteredLogs.length} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                    <Download className="h-4 w-4 text-brand-700" /> Export Excel
                  </button>
                </div>
              </details>
            </div>
          </div>
        </div>

        <div className="px-4 py-3 sm:px-5">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Filter className="h-4 w-4 text-brand-700" /> {labels.filters}</p>
            <button type="button" onClick={clearFilters} className="text-sm font-medium text-slate-500 hover:text-slate-900">{labels.clearFilters}</button>
          </div>
          <div className="grid gap-2 md:grid-cols-12">
            <div className="md:col-span-2"><label className="form-label">{labels.dateRangePreset}</label><select value={filters.preset} onChange={(event) => updatePreset(event.target.value as DatePreset)} className="form-input h-10 bg-white py-1.5"><option value="today">Today</option><option value="this_week">{labels.thisWeek}</option><option value="this_month">{labels.thisMonth}</option><option value="last_month">{labels.lastMonth}</option><option value="custom">{labels.customRange}</option></select></div>
            <div className="md:col-span-2"><label className="form-label">{labels.startDate}</label><input type="date" value={filters.fromDate} onChange={(event) => setFilters((current) => ({ ...current, preset: "custom", fromDate: event.target.value }))} className="form-input h-10 bg-white py-1.5" /></div>
            <div className="md:col-span-2"><label className="form-label">{labels.endDate}</label><input type="date" value={filters.toDate} onChange={(event) => setFilters((current) => ({ ...current, preset: "custom", toDate: event.target.value }))} className="form-input h-10 bg-white py-1.5" /></div>
            <div className="md:col-span-2"><label className="form-label">{labels.driver}</label><select value={filters.driver} onChange={(event) => setFilters((current) => ({ ...current, driver: event.target.value }))} className="form-input h-10 bg-white py-1.5"><option value="">{labels.allDrivers}</option>{driverOptions.map((driver) => <option key={driver} value={driver}>{driver}</option>)}</select></div>
            <div className="md:col-span-2"><label className="form-label">{labels.vehicleRegistration}</label><select value={filters.vehicleReg} onChange={(event) => setFilters((current) => ({ ...current, vehicleReg: event.target.value }))} className="form-input h-10 bg-white py-1.5"><option value="">{labels.allVehicles}</option>{vehicleOptions.map((vehicle) => <option key={vehicle} value={vehicle}>{vehicle}</option>)}</select></div>
            <div className="md:col-span-2"><label className="form-label">{labels.location}</label><select value={filters.location} onChange={(event) => setFilters((current) => ({ ...current, location: event.target.value }))} className="form-input h-10 bg-white py-1.5"><option value="">{labels.allLocations}</option><option value="Bangchak">Bangchak</option><option value="Shell">Shell</option><option value="Best LPG">Best LPG</option><option value="Other">Other</option>{locationOptions.map((location) => <option key={location} value={location}>{location}</option>)}</select></div>
          </div>
          <details className="mt-2 rounded-xl border border-slate-100 bg-slate-50/70">
            <summary className="cursor-pointer list-none px-3 py-2 text-xs font-semibold text-slate-600">More filters</summary>
            <div className="grid gap-2 border-t border-slate-100 px-3 py-3 md:grid-cols-2">
              <div><label className="form-label">Fuel type</label><select value={filters.fuelType} onChange={(event) => setFilters((current) => ({ ...current, fuelType: event.target.value }))} className="form-input h-10 bg-white py-1.5"><option value="">{labels.all}</option>{fuelTypeOptions.map((fuelType) => <option key={fuelType} value={fuelType}>{fuelType}</option>)}</select></div>
              <div><label className="form-label">{labels.checkedStatus}</label><select value={filters.checkedStatus} onChange={(event) => setFilters((current) => ({ ...current, checkedStatus: event.target.value as ReportFilters["checkedStatus"] }))} className="form-input h-10 bg-white py-1.5"><option value="">{labels.all}</option><option value="checked">{labels.checked}</option><option value="not_checked">{labels.notChecked}</option></select></div>
            </div>
          </details>
        </div>
      </section>

      {reportView === "summary" ? (
        <>
          <section className="surface-card mb-4 overflow-hidden p-0">
            <div className="grid divide-y divide-slate-100 md:grid-cols-2 md:divide-x md:divide-y-0 xl:grid-cols-4">
              <CompactMetric
                label={language === "th" ? "ค่าใช้จ่ายรวม" : "Total fuel spend"}
                value={formatBaht(summary.totalSpend)}
                hint={language === "th" ? "ค่าใช้จ่ายน้ำมันทั้งหมดในช่วงที่เลือก" : "All recorded fuel cost in the selected period"}
                change={metricChanges.spend}
              />
              <CompactMetric
                label={language === "th" ? "รถค่าใช้จ่ายสูงสุด" : "Highest spend vehicle"}
                value={highestSpendVehicle?.vehicleReg ?? "-"}
                hint={highestSpendVehicle ? `${highestSpendVehicle.driver} · ${formatBaht(highestSpendVehicle.spend)} · ${formatNumber(highestSpendVehicle.spendPercent, language, 1)}% of total` : undefined}
              />
              <CompactMetric
                label={language === "th" ? "รถค่าใช้จ่ายต่ำสุด" : "Lowest spend vehicle"}
                value={lowestSpendVehicle?.vehicleReg ?? "-"}
                hint={lowestSpendVehicle ? `${lowestSpendVehicle.driver} · ${formatBaht(lowestSpendVehicle.spend)} · active in selected period` : undefined}
              />
              <CompactMetric
                label={language === "th" ? "สถานีที่ใช้มากที่สุด" : "Most-used station"}
                value={mostUsedStationRow ? <FuelStationBadge station={mostUsedStationRow.station} compact /> : "-"}
                hint={mostUsedStationRow ? `${formatNumber(mostUsedStationRow.fillUps, language)} fills · ${formatNumber(managementReport.totalFillUps > 0 ? (mostUsedStationRow.fillUps / managementReport.totalFillUps) * 100 : 0, language, 1)}% of fills` : undefined}
              />
            </div>
          </section>

          <section className="surface-card mb-4 overflow-hidden">
            <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-700">Fuel performance</p>
                <h3 className="mt-1 text-xl font-semibold text-slate-950">Where the fuel spend is going</h3>
                <p className="mt-1 text-sm text-slate-500">Move between vehicles, drivers and stations without stacking multiple reports down the page.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex rounded-2xl bg-brand-50 p-1">
                  {([ ["vehicle", "Vehicles"], ["driver", "Drivers"], ["station", "Stations"] ] as const).map(([value, label]) => (
                    <button key={value} type="button" onClick={() => { setBreakdownView(value); setShowAllPerformance(false); }} className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${breakdownView === value ? "bg-white text-brand-700 shadow-sm" : "text-slate-500 hover:text-slate-900"}`}>{label}</button>
                  ))}
                </div>
                {((breakdownView === "vehicle" && managementReport.vehicleRows.length > 8) || (breakdownView === "driver" && driverPerformanceRows.length > 8)) ? (
                  <button type="button" onClick={() => setShowAllPerformance((current) => !current)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">{showAllPerformance ? "Show top 8" : breakdownView === "vehicle" ? "View all vehicles" : "View all drivers"}</button>
                ) : null}
              </div>
            </div>
            <div className="p-5">
              {breakdownView === "vehicle" ? (
                <VehiclePerformanceTable rows={performanceVehicleRows} language={language} emptyLabel={labels.noReportDataFound} sortKey={performanceSort} onSort={setPerformanceSort} onSelect={setSelectedPerformanceVehicle} />
              ) : breakdownView === "driver" ? (
                <DriverPerformancePanel rows={displayedDriverRows} language={language} totalSpend={summary.totalSpend} />
              ) : (
                <div className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
                  <StationSharePanel rows={managementStationRows} language={language} onOtherClick={() => setShowOtherStationDetails(true)} />
                  <ManagementTable title="Station performance" emptyLabel={labels.noReportDataFound} headers={["Station", "Fill-ups", "Litres", "Spend", "Avg ฿/L", "% Spend"]} rows={managementStationRows.map((row) => ({ key: row.station, cells: [row.station === "Other" ? <button key={row.station} type="button" onClick={() => setShowOtherStationDetails(true)} className="group inline-flex items-center gap-1.5 rounded-full focus:outline-none focus:ring-2 focus:ring-brand-200"><FuelStationBadge station={row.station} compact /><span className="text-[10px] font-semibold text-brand-700 opacity-0 transition group-hover:opacity-100">View</span></button> : <FuelStationBadge key={row.station} station={row.station} compact />, formatNumber(row.fillUps, language), formatLitres(row.litres, language), formatBaht(row.spend), formatPrice(row.weightedAveragePrice), formatPercent(row.spendPercent, language)] }))} embedded />
                </div>
              )}
            </div>
          </section>

          {breakdownView === "vehicle" ? (
          <section className="surface-card mb-4 overflow-hidden">
            <div className="grid xl:grid-cols-[1.05fr_1.35fr]">
              <div className="border-b border-slate-100 p-5 xl:border-b-0 xl:border-r">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-700">Management signals</p>
                <h3 className="mt-1 text-xl font-semibold text-slate-950">What stands out</h3>
                <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                  {managementInsights.map(({ key, ...insight }) => <InsightCard key={key} {...insight} />)}
                </div>
              </div>
              <div className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-700">Action centre</p>
                    <h3 className="mt-1 text-xl font-semibold text-slate-950">Records requiring review</h3>
                    <p className="mt-1 text-sm text-slate-500">Only issues that can affect trust in this report are shown here.</p>
                  </div>
                  <button type="button" onClick={() => setReportView("ledger")} className="shrink-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">Open ledger</button>
                </div>
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  <AttentionMetric label="Unchecked receipts" value={managementReport.qualityCounts.unchecked_receipt} tone="amber" hint={summary.uncheckedSpend > 0 ? `${formatBaht(summary.uncheckedSpend)} awaiting review` : "No unchecked spend"} onClick={() => { setFilters((current) => ({ ...current, checkedStatus: "not_checked" })); setLedgerStatus("pending"); setReportView("ledger"); }} />
                  <AttentionMetric label="Missing mileage" value={managementReport.qualityCounts.missing_mileage} tone={managementReport.qualityCounts.missing_mileage > 0 ? "amber" : "emerald"} hint="Excluded from mileage-based calculations" onClick={() => setReportView("ledger")} />
                  <AttentionMetric label="Unusual price" value={managementReport.qualityCounts.unusual_price} tone={managementReport.qualityCounts.unusual_price > 0 ? "amber" : "emerald"} hint="Outside the configured expected range" onClick={() => setReportView("ledger")} />
                  <AttentionMetric label="Possible duplicates" value={managementReport.qualityCounts.possible_duplicate} tone={managementReport.qualityCounts.possible_duplicate > 0 ? "rose" : "emerald"} hint="Potential repeated fuel entries" onClick={() => setReportView("ledger")} />
                  <AttentionMetric label="Cost / litre mismatch" value={managementReport.qualityCounts.cost_litre_mismatch} tone={managementReport.qualityCounts.cost_litre_mismatch > 0 ? "rose" : "emerald"} hint={managementReport.qualityCounts.cost_litre_mismatch > 0 ? "Stored totals need reconciliation" : "No reconciliation issues"} onClick={() => setReportView("ledger")} />
                </div>
              </div>
            </div>
          </section>
          ) : null}
        </>
      ) : null}

      {reportView === "ledger" ? (
        <section className="surface-card mb-4 overflow-hidden p-0">
          <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-700">Detailed ledger</p>
              <h3 className="mt-1 text-xl font-semibold text-slate-950">Vehicle fuel ledger</h3>
              <p className="mt-1 text-sm text-slate-500">One row per vehicle. Expand only when you need the exact fuel logs behind the totals.</p>
            </div>
            <span className="badge-muted">{formatNumber(filteredLedgerRows.length, language)} vehicles</span>
          </div>

          <div className="border-b border-slate-100 bg-slate-50/50 p-3 sm:p-4">
            <div className="grid gap-2 md:grid-cols-[1fr_220px_auto]">
              <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={ledgerSearch} onChange={(event) => setLedgerSearch(event.target.value)} placeholder="Search registration, driver or station" className="form-input h-10 bg-white py-1.5 pl-9" /></div>
              <select value={ledgerStatus} onChange={(event) => setLedgerStatus(event.target.value as "all" | "pending" | "checked")} className="form-input h-10 bg-white py-1.5"><option value="all">All receipt statuses</option><option value="pending">Needs receipt check</option><option value="checked">Fully checked</option></select>
              <button type="button" onClick={() => { setLedgerSearch(""); setLedgerStatus("all"); setShowAllLedger(false); }} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">Reset</button>
            </div>
          </div>

          <div className="p-4 sm:p-5">
            {loading ? (
              <p className="text-sm text-slate-500">{t.common.loading}</p>
            ) : error ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
            ) : filteredLedgerRows.length === 0 ? (
              <EmptyState title={labels.noReportDataFound} description={labels.noReportDataDescription} />
            ) : (
              <div className="table-shell rounded-2xl">
                <div className="table-scroll overflow-x-auto">
                  <table className="min-w-[980px] w-full text-sm">
                    <thead className="bg-slate-50/95 text-slate-600">
                      <tr>
                        <th className="table-head-cell text-left">{labels.vehicleRegistration}</th>
                        <th className="table-head-cell text-left">{labels.driver}</th>
                        <th className="table-head-cell text-left">{labels.location}</th>
                        <SortableHeader label="Fuel logs" active={sortKey === "entryCount"} onClick={() => setSortKey("entryCount")} />
                        <SortableHeader label={labels.totalLitres} active={sortKey === "totalLitres"} onClick={() => setSortKey("totalLitres")} />
                        <SortableHeader label={labels.totalSpend} active={sortKey === "totalSpend"} onClick={() => setSortKey("totalSpend")} />
                        <th className="table-head-cell text-right">Receipt control</th>
                        <SortableHeader label={labels.lastUsedDate} active={sortKey === "lastUsedDate"} onClick={() => setSortKey("lastUsedDate")} />
                      </tr>
                    </thead>
                    <tbody>
                      {displayedLedgerRows.map((row) => {
                        const expanded = expandedRows.has(row.id);
                        const visibleLogCount = visibleLogCounts[row.id] ?? 10;
                        const visibleLogs = row.logs.slice(0, visibleLogCount);
                        return (
                          <Fragment key={row.id}>
                            <tr className="enterprise-table-row cursor-pointer" role="button" tabIndex={0} aria-expanded={expanded} onClick={() => toggleExpandedRow(row.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggleExpandedRow(row.id); } }}>
                              <td className="table-body-cell table-driver-name">{row.vehicleReg}</td>
                              <td className="table-body-cell text-slate-700">{row.drivers.join(", ") || row.driver}</td>
                              <td className="table-body-cell text-slate-700"><div className="flex flex-wrap gap-1.5">{row.locations.slice(0, 2).map((station) => <FuelStationBadge key={station} station={station} compact />)}{row.locations.length > 2 ? <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-500">+{row.locations.length - 2}</span> : null}</div></td>
                              <td className="table-body-cell text-right font-medium text-slate-800">{formatNumber(row.entryCount, language)}</td>
                              <td className="table-body-cell text-right font-medium text-slate-800">{formatLitres(row.totalLitres, language)}</td>
                              <td className="table-body-cell text-right text-base font-bold text-slate-950">{formatBaht(row.totalSpend)}</td>
                              <td className="table-body-cell text-right"><ReceiptStatusCell row={row} language={language} /></td>
                              <td className="table-body-cell text-right"><span className="inline-flex items-center gap-2 font-medium text-slate-800">{formatDate(row.lastUsedDate, language)}<ChevronDown className={`h-4 w-4 transition ${expanded ? "rotate-180" : ""}`} /></span></td>
                            </tr>
                            {expanded ? (
                              <tr className="bg-slate-50/60">
                                <td colSpan={8} className="px-3 py-3">
                                  <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                                    <div className="flex flex-col gap-3 border-b border-slate-100 bg-gradient-to-r from-brand-50/70 to-white px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
                                      <div><p className="text-lg font-black text-slate-950">{row.vehicleReg}</p><p className="text-xs text-slate-500">{row.drivers.join(", ") || row.driver} · {formatNumber(row.entryCount, language)} logs · {formatLitres(row.totalLitres, language)} · {formatBaht(row.totalSpend)}</p></div>
                                      <div className="flex flex-wrap gap-1.5">{row.locations.map((station) => <FuelStationBadge key={station} station={station} compact />)}</div>
                                    </div>
                                    <div className="hidden overflow-x-auto md:block">
                                      <table className="min-w-[900px] w-full text-xs">
                                        <thead className="bg-slate-50 text-slate-500"><tr><th className="px-3 py-2 text-left font-semibold">{labels.date}</th><th className="px-3 py-2 text-left font-semibold">{labels.location}</th><th className="px-3 py-2 text-right font-semibold">{labels.litres}</th><th className="px-3 py-2 text-right font-semibold">{labels.totalCost}</th><th className="px-3 py-2 text-right font-semibold">{labels.pricePerLitre}</th><th className="px-3 py-2 text-right font-semibold">Mileage</th><th className="px-3 py-2 text-left font-semibold">{labels.checkedStatus}</th><th className="px-3 py-2 text-left font-semibold">{labels.source}</th><th className="px-3 py-2 text-left font-semibold">{labels.notes}</th></tr></thead>
                                        <tbody>{visibleLogs.map((log) => <tr key={log.id} className={`border-t border-slate-100 text-slate-700 ${log.receipt_checked ? "" : "bg-amber-50/70"}`}><td className="px-3 py-2 font-medium">{formatDate(log.date, language)}</td><td className="px-3 py-2"><FuelStationBadge station={log.location} compact /></td><td className="px-3 py-2 text-right">{formatLitres(getSafeNumber(log.litres), language)}</td><td className="px-3 py-2 text-right font-semibold text-slate-900">{formatBaht(getFuelSpendReportLogCost(log))}</td><td className="px-3 py-2 text-right">{formatPrice(getPricePerLitre(log))}</td><td className="px-3 py-2 text-right">{log.mileage ?? log.odometer ? formatNumber(Number(log.mileage ?? log.odometer), language, 0) : "Not available"}</td><td className="px-3 py-2"><span className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-semibold ${getCheckedStatusBadgeClass(log.receipt_checked)}`}>{log.receipt_checked ? labels.checked : labels.notChecked}</span></td><td className="px-3 py-2">{getEntrySourceLabel(log.entry_source, labels)}</td><td className="max-w-[220px] truncate px-3 py-2" title={log.notes || ""}>{log.notes || "-"}</td></tr>)}</tbody>
                                      </table>
                                    </div>
                                    <div className="grid gap-2 p-3 md:hidden">{visibleLogs.map((log) => <article key={log.id} className={`rounded-xl border p-3 ${log.receipt_checked ? "border-slate-200 bg-white" : "border-amber-200 bg-amber-50/70"}`}><div className="flex items-start justify-between gap-3"><div><p className="font-semibold text-slate-950">{formatDate(log.date, language)}</p><FuelStationBadge station={log.location} compact className="mt-1" /></div><span className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${getCheckedStatusBadgeClass(log.receipt_checked)}`}>{log.receipt_checked ? labels.checked : labels.notChecked}</span></div><p className="mt-2 text-xs text-slate-600">{formatLitres(getSafeNumber(log.litres), language)} · {formatBaht(getFuelSpendReportLogCost(log))} · {formatPrice(getPricePerLitre(log))}</p></article>)}</div>
                                    {visibleLogCount < row.logs.length ? <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/60 px-4 py-3"><p className="text-xs text-slate-500">Showing {formatNumber(visibleLogs.length, language)} of {formatNumber(row.logs.length, language)} fuel logs</p><button type="button" onClick={(event) => { event.stopPropagation(); setVisibleLogCounts((current) => ({ ...current, [row.id]: visibleLogCount + 10 })); }} className="text-xs font-semibold text-brand-700 hover:text-brand-900">Show more</button></div> : null}
                                  </div>
                                </td>
                              </tr>
                            ) : null}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {!loading && !error && filteredLedgerRows.length > 10 ? (
              <div className="mt-4 flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
                <p className="text-sm text-slate-500">Showing {showAllLedger ? filteredLedgerRows.length : Math.min(10, filteredLedgerRows.length)} of {filteredLedgerRows.length} vehicles</p>
                <button type="button" onClick={() => setShowAllLedger((current) => !current)} className="rounded-xl border border-brand-100 bg-brand-50 px-4 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-100">{showAllLedger ? "Show first 10" : "Show all vehicles"}</button>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {selectedPerformanceVehicle ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedPerformanceVehicle(null); }}>
          <section className="w-full max-w-4xl overflow-hidden rounded-[28px] border border-white/40 bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 bg-gradient-to-r from-brand-50 via-white to-violet-50 px-6 py-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-700">Vehicle spend explained</p>
                <h3 className="mt-1 text-2xl font-semibold text-slate-950">{selectedPerformanceVehicle.vehicleReg}</h3>
                <p className="mt-1 text-sm text-slate-500">{selectedPerformanceVehicle.driver} · selected report period</p>
              </div>
              <button type="button" onClick={() => setSelectedPerformanceVehicle(null)} className="rounded-xl border border-slate-200 bg-white p-2 text-slate-500 shadow-sm transition hover:bg-slate-50 hover:text-slate-900" aria-label="Close vehicle details"><X className="h-5 w-5" /></button>
            </div>

            <div className="grid gap-px bg-slate-100 sm:grid-cols-2 lg:grid-cols-4">
              <ExplainMetric label="Fuel spend" value={formatBaht(selectedPerformanceVehicle.spend)} explanation="Total cost of all included fuel logs for this vehicle in the selected reporting period." />
              <ExplainMetric label="Share of total spend" value={`${formatNumber(selectedPerformanceVehicle.spendPercent, language, 1)}%`} explanation="This vehicle's fuel spend divided by the total fuel spend for the selected report." />
              <ExplainMetric label="Fuel volume" value={formatLitres(selectedPerformanceVehicle.litres, language)} explanation="Total litres recorded across the included fuel logs for this vehicle." />
              <ExplainMetric label="Fuel logs" value={formatNumber(selectedPerformanceVehicle.fuelLogs, language)} explanation="Number of fuel entries included for this vehicle in the selected period." />
            </div>

            <div className="grid gap-4 p-6 md:grid-cols-2">
              <article className="rounded-2xl border border-brand-100 bg-brand-50/50 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-brand-700">Average spend per fill</p>
                <p className="mt-2 text-2xl font-semibold text-slate-950">{formatBaht(selectedPerformanceVehicle.averageSpendPerFill)}</p>
                <p className="mt-2 text-sm leading-6 text-slate-600">A simple spend measure: total fuel spend divided by the number of fuel logs for this vehicle.</p>
                <div className="mt-3 rounded-xl bg-white px-3 py-2 text-sm text-slate-700">Fuel spend ÷ fuel logs</div>
              </article>
              <article className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Main station</p>
                <div className="mt-2"><FuelStationBadge station={selectedPerformanceVehicle.mainStation} /></div>
                <p className="mt-2 text-sm leading-6 text-slate-600">The station group used most often by this vehicle during the selected period.</p>
                <div className="mt-3 rounded-xl bg-white px-3 py-2 text-sm text-slate-700">{formatNumber(selectedPerformanceVehicle.mainStationFillUps, language)} fills at this station</div>
              </article>
            </div>

            <div className="border-t border-slate-100 bg-slate-50 px-6 py-4 text-sm leading-6 text-slate-600">
              This view is intentionally spend-focused. Fuel-efficiency calculations such as KM/L and cost per KM remain on the dedicated Efficiency page where mileage and fuel-cycle logic can be reviewed properly.
            </div>
          </section>
        </div>
      ) : null}
      {showOtherStationDetails ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.currentTarget === event.target) setShowOtherStationDetails(false); }}>
          <div className="w-full max-w-2xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 bg-[linear-gradient(135deg,#ffffff_0%,#fbf9ff_100%)] px-5 py-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-700">Other fuel locations</p>
                <h3 className="mt-1 text-xl font-semibold text-slate-950">What is included in “Other”?</h3>
                <p className="mt-1 text-sm leading-5 text-slate-500">Anything that is not classified as Shell or Bangchak is grouped into Other on the management view. The exact names are shown below.</p>
              </div>
              <button type="button" onClick={() => setShowOtherStationDetails(false)} className="rounded-xl border border-slate-200 p-2 text-slate-500 transition hover:bg-slate-50 hover:text-slate-900" aria-label="Close other stations details"><X className="h-4 w-4" /></button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto p-5">
              {otherStationDetails.length ? (
                <div className="overflow-hidden rounded-2xl border border-slate-200">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-[10px] uppercase tracking-[0.1em] text-slate-500">
                      <tr><th className="px-3 py-2.5 text-left font-semibold">Recorded location</th><th className="px-3 py-2.5 text-right font-semibold">Fill-ups</th><th className="px-3 py-2.5 text-right font-semibold">Litres</th><th className="px-3 py-2.5 text-right font-semibold">Spend</th><th className="px-3 py-2.5 text-right font-semibold">% of Other</th></tr>
                    </thead>
                    <tbody>
                      {otherStationDetails.map((row) => (
                        <tr key={row.name} className="border-t border-slate-100">
                          <td className="px-3 py-3 font-semibold text-slate-900">{row.name}</td>
                          <td className="px-3 py-3 text-right text-slate-600">{formatNumber(row.fillUps, language)}</td>
                          <td className="px-3 py-3 text-right text-slate-600">{formatLitres(row.litres, language)}</td>
                          <td className="px-3 py-3 text-right font-semibold text-slate-950">{formatBaht(row.spend)}</td>
                          <td className="px-3 py-3 text-right font-semibold text-brand-700">{formatNumber(row.shareOfOther, language, 1)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <div className="rounded-2xl border border-slate-100 bg-slate-50 p-6 text-center text-sm text-slate-500">No Other fuel locations are present in the selected period.</div>}
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/60 px-5 py-3">
              <p className="text-xs text-slate-500">This is a reporting group only. The original fuel-log location names remain unchanged.</p>
              <button type="button" onClick={() => setShowOtherStationDetails(false)} className="rounded-xl bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800">Done</button>
            </div>
          </div>
        </div>
      ) : null}

    </>
  );
}

function CompactMetric({
  label,
  value,
  hint,
  tone = "default",
  change
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "default" | "emerald" | "amber";
  change?: number | null;
}) {
  const valueClass =
    tone === "emerald" ? "text-emerald-700" : tone === "amber" ? "text-amber-700" : "text-slate-950";
  const changeTone = change == null || change === 0 ? "text-slate-400 bg-slate-100" : change > 0 ? "text-amber-700 bg-amber-50" : "text-emerald-700 bg-emerald-50";

  return (
    <div className="px-4 py-3.5">
      <p className="metric-label">{label}</p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <p className={`text-lg font-semibold ${valueClass}`}>{value}</p>
        {change != null ? <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${changeTone}`}>{change > 0 ? "+" : ""}{formatNumber(change, "en", 1)}%</span> : null}
      </div>
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
      {change != null ? <p className="mt-1 text-[10px] text-slate-400">vs comparable previous period</p> : null}
    </div>
  );
}

function ExplainMetric({ label, value, explanation }: { label: string; value: ReactNode; explanation: string }) {
  return <article className="bg-white p-4"><p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">{label}</p><p className="mt-1 text-lg font-semibold text-slate-950">{value}</p><p className="mt-2 text-xs leading-5 text-slate-500">{explanation}</p></article>;
}

function InsightCard({ label, text, tone }: { label: string; text: string; tone: "slate" | "amber" | "emerald" }) {
  const toneClass = tone === "amber" ? "border-l-amber-400 bg-amber-50/35" : tone === "emerald" ? "border-l-emerald-400 bg-emerald-50/30" : "border-l-slate-300 bg-white";
  return <article className={`min-h-[112px] border-l-4 px-4 py-3.5 ${toneClass}`}><p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-slate-500">{label}</p><p className="mt-2 text-sm leading-5 text-slate-700">{text}</p></article>;
}

function VehiclePerformanceTable({ rows, language, emptyLabel, sortKey, onSort, onSelect }: { rows: SpendVehicleRow[]; language: "en" | "th"; emptyLabel: string; sortKey: PerformanceSortKey; onSort: (key: PerformanceSortKey) => void; onSelect: (row: SpendVehicleRow) => void }) {
  if (!rows.length) return <div className="flex min-h-[180px] items-center justify-center rounded-2xl border border-slate-100 bg-slate-50 text-sm text-slate-500">{emptyLabel}</div>;
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="font-semibold text-slate-950">Top vehicle spend</h4>
          <p className="mt-1 text-xs text-slate-500">Click a row for a plain-English breakdown of the figures behind that vehicle.</p>
        </div>
        <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1">
          <span className="px-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">Sort</span>
          {(["spend", "litres", "fuelLogs"] as const).map((key) => (
            <button key={key} type="button" onClick={() => onSort(key)} className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold ${sortKey === key ? "bg-white text-brand-700 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>
              {key === "spend" ? "Spend" : key === "litres" ? "Litres" : "Fuel logs"}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-slate-200">
        <table className="min-w-[940px] w-full text-sm">
          <thead className="bg-slate-50 text-[11px] uppercase tracking-[0.08em] text-slate-500">
            <tr>{["Vehicle", "Driver", "Spend", "% of total", "Litres", "Fuel logs", "Avg spend / fill", "Main station"].map((header, index) => <th key={header} className={`px-3 py-2.5 font-semibold ${index < 2 || index === 7 ? "text-left" : "text-right"}`}>{header}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.vehicleReg} onClick={() => onSelect(row)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(row); } }} role="button" tabIndex={0} className="cursor-pointer border-t border-slate-100 transition hover:bg-brand-50/45 focus:bg-brand-50/45 focus:outline-none">
                <td className="px-3 py-2.5 font-black text-slate-950">{row.vehicleReg}</td>
                <td className="px-3 py-2.5 text-slate-600">{row.driver}</td>
                <td className="px-3 py-2.5 text-right font-bold text-slate-950">{formatBaht(row.spend)}</td>
                <td className="px-3 py-2.5 text-right font-semibold text-brand-800">{formatNumber(row.spendPercent, language, 1)}%</td>
                <td className="px-3 py-2.5 text-right text-slate-700">{formatLitres(row.litres, language)}</td>
                <td className="px-3 py-2.5 text-right text-slate-600">{formatNumber(row.fuelLogs, language)}</td>
                <td className="px-3 py-2.5 text-right font-semibold text-slate-900">{formatBaht(row.averageSpendPerFill)}</td>
                <td className="px-3 py-2.5"><FuelStationBadge station={row.mainStation} compact /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-500">This report focuses on fuel spend. KM/L and cost per KM are kept on the dedicated Efficiency page.</p>
    </div>
  );
}

function DriverPerformancePanel({ rows, language, totalSpend }: { rows: DriverPerformanceRow[]; language: "en" | "th"; totalSpend: number }) {
  const maxSpend = Math.max(...rows.map((row) => row.spend), 1);
  return <div><h4 className="font-semibold text-slate-950">{language === "th" ? "ค่าใช้จ่ายตามพนักงานขับรถ" : "Driver spend concentration"}</h4><div className="mt-3 grid gap-2 lg:grid-cols-2">{rows.map((row) => { const vehicles = Array.from(row.vehicles); return <article key={row.driver} className="rounded-xl border border-slate-100 bg-slate-50/45 px-3 py-2.5"><div className="flex items-center justify-between gap-3"><p className="truncate font-semibold text-slate-900">{row.driver}</p><p className="shrink-0 font-bold text-slate-950">{formatBaht(row.spend)}</p></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-brand-600" style={{ width: `${Math.max(3, (row.spend / maxSpend) * 100)}%` }} /></div><p className="mt-1.5 text-[11px] text-slate-500">{formatNumber(row.fuelLogs, language)} fills · {formatLitres(row.litres, language)}{vehicles.length ? ` · ${vehicles.slice(0, 2).join(", ")}${vehicles.length > 2 ? ` +${vehicles.length - 2}` : ""}` : ""} · {formatNumber(totalSpend > 0 ? (row.spend / totalSpend) * 100 : 0, language, 1)}%</p></article>; })}</div></div>;
}

function StationSharePanel({ rows, language, onOtherClick }: { rows: ManagementStationRow[]; language: "en" | "th"; onOtherClick: () => void }) {
  const maxPercent = Math.max(...rows.map((row) => row.spendPercent), 1);
  return (
    <div>
      <h4 className="font-semibold text-slate-950">{language === "th" ? "สัดส่วนค่าใช้จ่ายตามสถานี" : "Station share"}</h4>
      <div className="mt-3 space-y-3">
        {rows.map((row) => {
          const content = (
            <>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <FuelStationBadge station={row.station} />
                  {row.station === "Other" ? <p className="mt-1 text-[11px] font-medium text-brand-700">Click to see which stations are included</p> : null}
                </div>
                <div className="text-right">
                  <p className="font-bold text-slate-950">{formatBaht(row.spend)}</p>
                  <p className="text-xs font-semibold text-slate-500">{formatPercent(row.spendPercent, language)}</p>
                </div>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
                <div className="h-full rounded-full bg-brand-600" style={{ width: `${Math.max(2, (row.spendPercent / maxPercent) * 100)}%` }} />
              </div>
            </>
          );

          return row.station === "Other" ? (
            <button key={row.station} type="button" onClick={onOtherClick} className="block w-full rounded-xl border border-brand-100 bg-brand-50/25 p-3 text-left transition hover:border-brand-200 hover:bg-brand-50/55 focus:outline-none focus:ring-2 focus:ring-brand-200">
              {content}
            </button>
          ) : (
            <article key={row.station} className="rounded-xl border border-slate-100 bg-slate-50/40 p-3">{content}</article>
          );
        })}
      </div>
    </div>
  );
}

function ReceiptStatusCell({ row, language }: { row: GroupedFuelSpendRow; language: "en" | "th" }) {
  return <div className="ml-auto w-28"><div className="flex items-center justify-between text-[10px] font-semibold"><span className={row.uncheckedEntries > 0 ? "text-amber-700" : "text-emerald-700"}>{formatNumber(row.receiptCompliance, language, 0)}% checked</span><span className="text-slate-400">{row.uncheckedEntries} pending</span></div><div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${row.receiptCompliance >= 100 ? "bg-emerald-500" : "bg-amber-500"}`} style={{ width: `${row.receiptCompliance}%` }} /></div></div>;
}

function VehicleSummaryMetric({ label, value }: { label: string; value: ReactNode }) {
  return <div><p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">{label}</p><p className="mt-1 text-sm font-bold text-slate-900">{value}</p></div>;
}

function AttentionMetric({
  label,
  value,
  hint,
  tone,
  onClick
}: {
  label: string;
  value: number;
  hint: string;
  tone: "emerald" | "amber" | "rose";
  onClick?: () => void;
}) {
  const toneClasses = {
    emerald: "bg-emerald-50/70 text-emerald-800",
    amber: "bg-amber-50/80 text-amber-900",
    rose: "bg-rose-50/80 text-rose-800"
  }[tone];

  const content = (
    <>
      <p className="text-xs font-semibold uppercase tracking-[0.12em] opacity-75">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{formatNumber(value, "en", 0)}</p>
      <p className="mt-1 text-xs opacity-75">{hint}</p>
      {onClick ? <span className="mt-2 inline-flex items-center gap-1 text-xs font-semibold">Review records <ArrowRight className="h-3 w-3" /></span> : null}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`rounded-xl border border-slate-100 px-4 py-3 text-left transition hover:brightness-[0.98] ${toneClasses}`}
      >
        {content}
      </button>
    );
  }

  return (
    <div className={`rounded-xl border border-slate-100 px-4 py-3 text-left ${toneClasses}`}>
      {content}
    </div>
  );
}

function ManagementTable({ emptyLabel, headers, rows, title, embedded = false }: { emptyLabel: string; headers: string[]; rows: { key: string; cells: ReactNode[] }[]; title: string; embedded?: boolean }) {
  return (
    <div className={embedded ? "" : "surface-card p-4 sm:p-5"}>
      <h3 className="section-title">{title}</h3>
      {rows.length === 0 ? (
        <div className="mt-4 flex min-h-[160px] items-center justify-center rounded-2xl border border-slate-100 bg-slate-50 text-sm text-slate-500">{emptyLabel}</div>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200">
          <table className="min-w-[720px] w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                {headers.map((header, index) => (
                  <th key={header} className={`px-3 py-2 font-semibold ${index < 2 ? "text-left" : "text-right"}`}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="border-t border-slate-100 text-slate-700">
                  {row.cells.map((cell, index) => (
                    <td key={headers[index]} className={`px-3 py-2 ${index === 0 ? "font-semibold text-slate-950" : ""} ${index < 2 ? "text-left" : "text-right"}`}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SortableHeader({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <th className="table-head-cell text-right">
      <button type="button" onClick={onClick} className={`inline-flex items-center justify-end gap-1 hover:text-slate-950 ${active ? "text-brand-700" : ""}`}>
        {label}
      </button>
    </th>
  );
}
