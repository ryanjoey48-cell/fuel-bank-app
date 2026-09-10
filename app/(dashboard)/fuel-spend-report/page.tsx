"use client";

import { BarChart3, ChevronDown, Download, FileText, Filter } from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/empty-state";
import { Header } from "@/components/header";
import { fetchFuelLogsForExport } from "@/lib/data";
import { exportWorkbookToXlsx } from "@/lib/export";
import { normalizeFuelLogLocation, shouldShowFuelLogLocationOption } from "@/lib/fuel-log-location";
import { buildFuelSpendPdf, downloadReportBlob } from "@/lib/fuel-spend-pdf";
import {
  buildFuelSpendManagementReport,
  getFuelSpendReportLogCost,
  groupFuelSpendStation,
  normalizeFuelSpendReportVehicleRegistration,
  type FuelSpendManagementReport
} from "@/lib/fuel-spend-report";
import { useLanguage } from "@/lib/language-provider";
import { formatDate, formatNumber, normalizeDisplayName, today } from "@/lib/utils";
import type { FuelLogEntrySource, FuelLogWithDriver } from "@/types/database";

type DatePreset = "today" | "this_week" | "this_month" | "last_month" | "custom";
type SortKey = "totalSpend" | "totalLitres" | "entryCount" | "lastUsedDate";

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

function getReceiptComplianceBadgeClass(compliance: number) {
  if (compliance >= 100) return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (compliance > 0) return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-rose-200 bg-rose-50 text-rose-700";
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

  const groupedRows = useMemo(() => {
    const groups = new Map<string, GroupedFuelSpendRow>();

    for (const log of filteredLogs) {
      const key = `${log.vehicle_reg}::${log.location}`;
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

  const spendByDriver = useMemo(
    () => buildChartRows(filteredLogs, "driver").slice(0, 5),
    [filteredLogs]
  );

  const spendByLocation = useMemo(
    () => buildChartRows(filteredLogs, "location").slice(0, 5),
    [filteredLogs]
  );

  const dateRangeLabel = `${filters.fromDate ? formatDate(filters.fromDate, language) : "-"} - ${filters.toDate ? formatDate(filters.toDate, language) : "-"}`;

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
            "Weighted Avg Baht/L": row.weightedAveragePrice,
            "Distance Travelled": row.distanceTravelled,
            "km/L": row.kmPerLitre,
            "Fuel Cost/km": row.fuelCostPerKm
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
      <div className="mb-6 hidden md:block">
        <Header title={labels.title} description={labels.subtitle} />
      </div>

      <section className="surface-card p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-brand-100 bg-brand-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-brand-700">
              <BarChart3 className="h-3.5 w-3.5" />
              {labels.title}
            </div>
            <h2 className="mt-3 text-xl font-semibold text-slate-950">{labels.title}</h2>
            <p className="mt-1 max-w-3xl text-sm text-slate-500">{labels.subtitle}</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button type="button" onClick={() => setFilters((current) => ({ ...current, checkedStatus: "not_checked" }))} className="btn-secondary w-full sm:w-auto">
              {labels.showUncheckedOnly}
            </button>
            <button type="button" onClick={() => handleDownloadFuelSpendPdf(false)} disabled={!filteredLogs.length || exportingManagerPdf} className="btn-secondary w-full gap-2 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto">
              <FileText className="h-4 w-4" />
              {exportingManagerPdf ? "Preparing..." : "Download Manager Summary PDF"}
            </button>
            <button type="button" onClick={() => handleDownloadFuelSpendPdf(true)} disabled={!filteredLogs.length || exportingFullPdf} className="btn-secondary w-full gap-2 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto">
              <FileText className="h-4 w-4" />
              {exportingFullPdf ? "Preparing..." : "Download Full Fuel Report PDF"}
            </button>
            <button type="button" onClick={exportReport} disabled={!filteredLogs.length} className="btn-secondary w-full gap-2 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto">
              <Download className="h-4 w-4" />
              Export Excel
            </button>
          </div>
        </div>

        <div className="mt-5 rounded-[1.5rem] border border-slate-200/80 bg-white/95 p-4 shadow-[0_10px_30px_rgba(15,23,42,0.04)] sm:p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Filter className="h-4 w-4 text-brand-700" />{labels.filters}</p>
            <button type="button" onClick={clearFilters} className="text-sm font-medium text-slate-500 hover:text-slate-900">{labels.clearFilters}</button>
          </div>
          <div className="grid gap-3 md:grid-cols-12">
            <div className="md:col-span-3">
              <label className="form-label">{labels.dateRangePreset}</label>
              <select value={filters.preset} onChange={(event) => updatePreset(event.target.value as DatePreset)} className="form-input bg-white">
                <option value="today">Today</option>
                <option value="this_week">{labels.thisWeek}</option>
                <option value="this_month">{labels.thisMonth}</option>
                <option value="last_month">{labels.lastMonth}</option>
                <option value="custom">{labels.customRange}</option>
              </select>
            </div>
            <div className="md:col-span-3">
              <label className="form-label">{labels.startDate}</label>
              <input type="date" value={filters.fromDate} onChange={(event) => setFilters((current) => ({ ...current, preset: "custom", fromDate: event.target.value }))} className="form-input bg-white" />
            </div>
            <div className="md:col-span-3">
              <label className="form-label">{labels.endDate}</label>
              <input type="date" value={filters.toDate} onChange={(event) => setFilters((current) => ({ ...current, preset: "custom", toDate: event.target.value }))} className="form-input bg-white" />
            </div>
            <div className="md:col-span-3">
              <label className="form-label">{labels.driver}</label>
              <select value={filters.driver} onChange={(event) => setFilters((current) => ({ ...current, driver: event.target.value }))} className="form-input bg-white">
                <option value="">{labels.allDrivers}</option>
                {driverOptions.map((driver) => <option key={driver} value={driver}>{driver}</option>)}
              </select>
            </div>
            <div className="md:col-span-6">
              <label className="form-label">{labels.location}</label>
              <select value={filters.location} onChange={(event) => setFilters((current) => ({ ...current, location: event.target.value }))} className="form-input bg-white">
                <option value="">{labels.allLocations}</option>
                <option value="Bangchak">Bangchak</option>
                <option value="Shell">Shell</option>
                <option value="Best LPG">Best LPG</option>
                <option value="Other">Other</option>
                {locationOptions.map((location) => <option key={location} value={location}>{location}</option>)}
              </select>
            </div>
            <div className="md:col-span-3">
              <label className="form-label">{labels.vehicleRegistration}</label>
              <select value={filters.vehicleReg} onChange={(event) => setFilters((current) => ({ ...current, vehicleReg: event.target.value }))} className="form-input bg-white">
                <option value="">{labels.allVehicles}</option>
                {vehicleOptions.map((vehicle) => <option key={vehicle} value={vehicle}>{vehicle}</option>)}
              </select>
            </div>
            <div className="md:col-span-3">
              <label className="form-label">Fuel type</label>
              <select value={filters.fuelType} onChange={(event) => setFilters((current) => ({ ...current, fuelType: event.target.value }))} className="form-input bg-white">
                <option value="">{labels.all}</option>
                {fuelTypeOptions.map((fuelType) => <option key={fuelType} value={fuelType}>{fuelType}</option>)}
              </select>
            </div>
            <div className="md:col-span-3">
              <label className="form-label">{labels.checkedStatus}</label>
              <select value={filters.checkedStatus} onChange={(event) => setFilters((current) => ({ ...current, checkedStatus: event.target.value as ReportFilters["checkedStatus"] }))} className="form-input bg-white">
                <option value="">{labels.all}</option>
                <option value="checked">{labels.checked}</option>
                <option value="not_checked">{labels.notChecked}</option>
              </select>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <SummaryCard label={labels.totalFuelSpend} value={formatBaht(summary.totalSpend)} />
        <SummaryCard label="Highest spend vehicle" value={managementReport.highestSpendVehicle?.vehicleReg ?? "-"} secondaryValue={managementReport.highestSpendVehicle ? formatBaht(managementReport.highestSpendVehicle.spend) : "-"} />
        <SummaryCard label={labels.totalLitres} value={formatLitres(summary.totalLitres, language)} />
        <SummaryCard label={labels.averagePricePerLitre} value={formatPrice(summary.averagePricePerLitre)} />
        <SummaryCard label={labels.fuelEntries} value={formatNumber(summary.entryCount, language)} />
        <SummaryCard label="Previous period change" value={formatSignedChange(managementReport.spendChangeAmount, language)} secondaryValue={formatPercent(managementReport.spendChangePercent, language)} />
        <SummaryCard label="Bangchak regular fuel" value={formatPercent(managementReport.bangchakRegularFuelUsagePercent, language)} />
        <SummaryCard label={labels.uncheckedSpend} value={formatBaht(summary.uncheckedSpend)} secondaryValue={`${formatNumber(summary.uncheckedEntries, language)} unchecked`} />
        <SummaryCard label={labels.mostUsedStation} value={summary.mostUsedStation} />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="surface-card p-4 sm:p-5">
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <h3 className="section-title">What We Should Know</h3>
              <div className="mt-3 space-y-2">
                {managementReport.whatWeShouldKnow.map((item) => (
                  <p key={item} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-sm text-slate-700">{item}</p>
                ))}
              </div>
            </div>
            <div>
              <h3 className="section-title">What We Should Review</h3>
              <div className="mt-3 space-y-2">
                {managementReport.whatWeShouldReview.map((item) => (
                  <p key={item} className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">{item}</p>
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="surface-card p-4 sm:p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="section-title">Fuel Health</h3>
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${managementReport.reconciliationStatus === "Passed" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>
              {managementReport.reconciliationStatus}
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <StatusCard label="Clean Records" value={managementReport.statusCounts.normal} className="border-emerald-100 bg-emerald-50 text-emerald-800" />
            <StatusCard label="Needs Checking" value={managementReport.statusCounts.monitor} className="border-amber-100 bg-amber-50 text-amber-800" />
            <StatusCard label="Needs Correction" value={managementReport.statusCounts.attention} className="border-rose-100 bg-rose-50 text-rose-800" />
          </div>
          <p className="mt-3 text-xs text-slate-500">Statuses are based on fuel-record completeness, receipt checks, mileage validity, duplicate risk, price anomalies, and cost/litre reconciliation.</p>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <ChartPanel title={labels.spendByDriver} rows={spendByDriver} language={language} />
        <ChartPanel title={labels.spendByLocation} rows={spendByLocation} language={language} />
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <ManagementTable
          title="Station Performance"
          emptyLabel={labels.noReportDataFound}
          headers={["Station", "Fill-ups", "Litres", "Spend", "Avg ฿/L", "% Spend"]}
          rows={managementReport.stationRows.map((row) => [
            row.station,
            formatNumber(row.fillUps, language),
            formatLitres(row.litres, language),
            formatBaht(row.spend),
            formatPrice(row.weightedAveragePrice),
            formatPercent(row.spendPercent, language)
          ])}
        />
        <ManagementTable
          title="Vehicle Fuel Performance"
          emptyLabel={labels.noReportDataFound}
          headers={["Vehicle", "Driver", "Logs", "Spend", "Distance", "km/L", "Cost/km"]}
          rows={managementReport.vehicleRows.map((row) => [
            row.vehicleReg,
            row.driver,
            formatNumber(row.fuelLogs, language),
            formatBaht(row.spend),
            row.distanceTravelled == null ? "Insufficient mileage data" : `${formatNumber(row.distanceTravelled, language, 0)} km`,
            row.kmPerLitre == null ? "-" : formatNumber(row.kmPerLitre, language, 2),
            row.fuelCostPerKm == null ? "-" : formatBaht(row.fuelCostPerKm)
          ])}
        />
      </section>

      <section className="surface-card p-4 sm:p-5">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 className="section-title">Data Quality</h3>
            <p className="section-subtitle">Fuel log checks for the selected report filters.</p>
          </div>
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${managementReport.reconciliationStatus === "Passed" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>
            {managementReport.reconciliationStatus}
          </span>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Eligible fuel logs", managementReport.totalFillUps],
            ["Included fuel logs", managementReport.totalFillUps],
            ["Missing mileage", managementReport.qualityCounts.missing_mileage],
            ["Unchecked receipts", managementReport.qualityCounts.unchecked_receipt],
            ["Missing registration", managementReport.qualityCounts.missing_registration],
            ["Missing driver", managementReport.qualityCounts.missing_driver],
            ["Missing litres", managementReport.qualityCounts.missing_litres],
            ["Missing total cost", managementReport.qualityCounts.missing_total_cost],
            ["Missing price/litre", managementReport.qualityCounts.missing_price_per_litre],
            ["Cost/litre mismatches", managementReport.qualityCounts.cost_litre_mismatch],
            ["Possible duplicates", managementReport.qualityCounts.possible_duplicate],
            ["Unusual price entries", managementReport.qualityCounts.unusual_price],
            ["Non-Bangchak exceptions", managementReport.qualityCounts.non_bangchak_regular_fuel]
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
              <p className="text-xs font-semibold uppercase text-slate-500">{label}</p>
              <p className="mt-1 text-lg font-bold text-slate-950">{formatNumber(Number(value), language, 0)}</p>
            </div>
          ))}
        </div>
      </section>


      <section className="surface-card p-4 sm:p-5">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 className="section-title">{labels.groupedReport}</h3>
            <p className="section-subtitle">{labels.groupedReportDescription}</p>
          </div>
          <span className="badge-muted">{formatNumber(groupedRows.length, language)} {t.common.entries}</span>
        </div>

        {loading ? (
          <p className="text-sm text-slate-500">{t.common.loading}</p>
        ) : error ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
        ) : groupedRows.length === 0 ? (
          <EmptyState title={labels.noReportDataFound} description={labels.noReportDataDescription} />
        ) : (
          <div className="table-shell rounded-2xl">
            <div className="table-scroll overflow-x-auto">
              <table className="min-w-[1360px] w-full text-sm">
                <thead className="bg-slate-50/95 text-slate-600">
                  <tr>
                    <th className="table-head-cell text-left">{labels.vehicleRegistration}</th>
                    <th className="table-head-cell text-left">{labels.driver}</th>
                    <th className="table-head-cell text-left">{labels.location}</th>
                    <SortableHeader label={labels.totalSpend} active={sortKey === "totalSpend"} onClick={() => setSortKey("totalSpend")} />
                    <SortableHeader label={labels.totalLitres} active={sortKey === "totalLitres"} onClick={() => setSortKey("totalLitres")} />
                    <SortableHeader label={labels.entries} active={sortKey === "entryCount"} onClick={() => setSortKey("entryCount")} />
                    <th className="table-head-cell text-right">{labels.checkedEntries}</th>
                    <th className="table-head-cell text-right">{labels.uncheckedEntries}</th>
                    <th className="table-head-cell text-right">{labels.uncheckedSpend}</th>
                    <th className="table-head-cell text-right">{labels.receiptCompliance}</th>
                    <SortableHeader label={labels.lastUsedDate} active={sortKey === "lastUsedDate"} onClick={() => setSortKey("lastUsedDate")} />
                  </tr>
                </thead>
                <tbody>
                  {groupedRows.map((row) => {
                    const expanded = expandedRows.has(row.id);
                    return (
                      <Fragment key={row.id}>
                        <tr
                          className="enterprise-table-row cursor-pointer"
                          role="button"
                          tabIndex={0}
                          aria-expanded={expanded}
                          onClick={() => toggleExpandedRow(row.id)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              toggleExpandedRow(row.id);
                            }
                          }}
                        >
                          <td className="table-body-cell table-driver-name">{row.vehicleReg}</td>
                          <td className="table-body-cell text-slate-700">{row.drivers.join(", ") || row.driver}</td>
                          <td className="table-body-cell text-slate-700">{row.location}</td>
                          <td className="table-body-cell text-right text-base font-bold text-slate-950">{formatBaht(row.totalSpend)}</td>
                          <td className="table-body-cell text-right font-medium text-slate-800">{formatLitres(row.totalLitres, language)}</td>
                          <td className="table-body-cell text-right font-medium text-slate-800">{formatNumber(row.entryCount, language)}</td>
                          <td className="table-body-cell text-right font-medium text-emerald-700">{formatNumber(row.checkedEntries, language)}</td>
                          <td className="table-body-cell text-right font-semibold text-amber-700">{formatNumber(row.uncheckedEntries, language)}</td>
                          <td className="table-body-cell text-right font-semibold text-amber-700">{formatBaht(row.uncheckedSpend)}</td>
                          <td className="table-body-cell text-right">
                            <span className={`inline-flex min-w-14 items-center justify-center rounded-full border px-2.5 py-1 text-xs font-semibold ${getReceiptComplianceBadgeClass(row.receiptCompliance)}`}>
                              {formatNumber(row.receiptCompliance, language, 0)}%
                            </span>
                          </td>
                          <td className="table-body-cell text-right">
                            <span className="inline-flex items-center gap-2 font-medium text-slate-800">
                              {formatDate(row.lastUsedDate, language)}
                              <ChevronDown className={`h-4 w-4 transition ${expanded ? "rotate-180" : ""}`} />
                            </span>
                          </td>
                        </tr>
                        {expanded ? (
                          <tr className="bg-slate-50/60">
                            <td colSpan={11} className="px-4 py-4">
                              <div className="rounded-2xl border border-slate-200 bg-white">
                                <table className="min-w-full text-xs">
                                  <thead className="bg-slate-50 text-slate-500">
                                    <tr>
                                      <th className="px-3 py-2 text-left font-semibold">{labels.date}</th>
                                      <th className="px-3 py-2 text-left font-semibold">{labels.driver}</th>
                                      <th className="px-3 py-2 text-left font-semibold">{labels.vehicleRegistration}</th>
                                      <th className="px-3 py-2 text-left font-semibold">{labels.location}</th>
                                      <th className="px-3 py-2 text-right font-semibold">{labels.litres}</th>
                                      <th className="px-3 py-2 text-right font-semibold">{labels.totalCost}</th>
                                      <th className="px-3 py-2 text-right font-semibold">{labels.pricePerLitre}</th>
                                      <th className="px-3 py-2 text-left font-semibold">{labels.checkedStatus}</th>
                                      <th className="px-3 py-2 text-left font-semibold">{labels.source}</th>
                                      <th className="px-3 py-2 text-left font-semibold">{labels.notes}</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {row.logs.map((log) => (
                                      <tr key={log.id} className={`border-t border-slate-100 text-slate-700 ${log.receipt_checked ? "" : "bg-amber-50/70"}`}>
                                        <td className="px-3 py-2 font-medium">{formatDate(log.date, language)}</td>
                                        <td className="px-3 py-2">{log.driver}</td>
                                        <td className="px-3 py-2">{log.vehicle_reg}</td>
                                        <td className="px-3 py-2">{log.location}</td>
                                        <td className="px-3 py-2 text-right">{formatLitres(getSafeNumber(log.litres), language)}</td>
                                        <td className="px-3 py-2 text-right font-semibold text-slate-900">{formatBaht(getFuelSpendReportLogCost(log))}</td>
                                        <td className="px-3 py-2 text-right">{formatPrice(getPricePerLitre(log))}</td>
                                        <td className="px-3 py-2">
                                          <span className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-semibold ${getCheckedStatusBadgeClass(log.receipt_checked)}`}>
                                            {log.receipt_checked ? labels.checked : labels.notChecked}
                                          </span>
                                        </td>
                                        <td className="px-3 py-2">{getEntrySourceLabel(log.entry_source, labels)}</td>
                                        <td className="max-w-[240px] truncate px-3 py-2" title={log.notes || ""}>{log.notes || "-"}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
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
      </section>
    </>
  );
}

function buildChartRows(logs: FuelLogWithDriver[], key: "driver" | "location") {
  const totals = new Map<string, number>();
  logs.forEach((log) => {
    const label = String(log[key] || "-");
    totals.set(label, (totals.get(label) ?? 0) + getFuelSpendReportLogCost(log));
  });
  return Array.from(totals.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((left, right) => right.value - left.value);
}

function SummaryCard({ label, value, secondaryValue }: { label: string; value: string; secondaryValue?: string }) {
  return (
    <div className="subtle-panel p-4">
      <p className="metric-label">{label}</p>
      <p className="mt-2 truncate text-xl font-bold text-slate-950">{value}</p>
      {secondaryValue ? <p className="mt-1 text-sm font-semibold text-brand-700">{secondaryValue}</p> : null}
    </div>
  );
}

function StatusCard({ className, label, value }: { className: string; label: string; value: number }) {
  return (
    <div className={`rounded-xl border px-3 py-3 ${className}`}>
      <p className="text-xs font-semibold uppercase">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
    </div>
  );
}

function ManagementTable({ emptyLabel, headers, rows, title }: { emptyLabel: string; headers: string[]; rows: string[][]; title: string }) {
  return (
    <div className="surface-card p-4 sm:p-5">
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
                <tr key={row.join("|")} className="border-t border-slate-100 text-slate-700">
                  {row.map((cell, index) => (
                    <td key={`${cell}-${index}`} className={`px-3 py-2 ${index === 0 ? "font-semibold text-slate-950" : ""} ${index < 2 ? "text-left" : "text-right"}`}>{cell}</td>
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

function ChartPanel({ title, rows, language }: { title: string; rows: { label: string; value: number }[]; language: "en" | "th" }) {
  const maxValue = Math.max(...rows.map((row) => row.value), 1);
  return (
    <div className="surface-card p-4 sm:p-5">
      <h3 className="text-base font-semibold text-slate-950">{title}</h3>
      {rows.length === 0 ? (
        <div className="mt-4 flex min-h-[160px] items-center justify-center rounded-2xl border border-slate-100 bg-slate-50 text-sm text-slate-500">-</div>
      ) : (
        <div className="mt-4 space-y-3">
          {rows.map((row) => (
            <div key={row.label}>
              <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
                <span className="truncate font-medium text-slate-700">{row.label}</span>
                <span className="font-semibold text-slate-950">{formatBaht(row.value)}</span>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-brand-700" style={{ width: `${Math.max(4, (row.value / maxValue) * 100)}%` }} />
              </div>
            </div>
          ))}
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
