"use client";

import { BarChart3, ChevronDown, Download, Filter } from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/empty-state";
import { Header } from "@/components/header";
import { fetchFuelLogsForExport } from "@/lib/data";
import { exportToCsv } from "@/lib/export";
import { shouldShowFuelLogLocationOption } from "@/lib/fuel-log-location";
import { useLanguage } from "@/lib/language-provider";
import { formatDate, formatNumber, normalizeDisplayName, normalizeVehicleRegistration, today } from "@/lib/utils";
import type { FuelLogEntrySource, FuelLogWithDriver } from "@/types/database";

type DatePreset = "this_week" | "this_month" | "last_month" | "custom";
type SortKey = "totalSpend" | "totalLitres" | "entryCount" | "lastUsedDate";

type ReportFilters = {
  preset: DatePreset;
  fromDate: string;
  toDate: string;
  driver: string;
  location: string;
  vehicleReg: string;
};

type GroupedFuelSpendRow = {
  id: string;
  driver: string;
  location: string;
  totalSpend: number;
  totalLitres: number;
  entryCount: number;
  averagePricePerLitre: number | null;
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
  const totalCost = getSafeNumber(log.total_cost);
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

function getEntrySourceLabel(source: FuelLogEntrySource, labels: ReturnType<typeof useLanguage>["t"]["fuelSpendReport"]) {
  if (source === "direct_from_receipt") return labels.directFromReceipt;
  if (source === "other") return labels.other;
  return labels.lineMessage;
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
  const [filters, setFilters] = useState<ReportFilters>({
    preset: "this_month",
    fromDate: defaultRange.fromDate,
    toDate: defaultRange.toDate,
    driver: "",
    location: "",
    vehicleReg: ""
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
    setFilters({ preset: "this_month", fromDate: range.fromDate, toDate: range.toDate, driver: "", location: "", vehicleReg: "" });
    setExpandedRows(new Set());
  };

  const normalizedLogs = useMemo(
    () =>
      fuelLogs.map((log) => ({
        ...log,
        driver: normalizeDisplayName(log.driver) || labels.unknownDriver,
        location: normalizeDisplayName(log.location) || labels.unknownLocation,
        vehicle_reg: normalizeVehicleRegistration(log.vehicle_reg) || "-"
      })),
    [fuelLogs, labels.unknownDriver, labels.unknownLocation]
  );

  const driverOptions = useMemo(
    () => Array.from(new Set(normalizedLogs.map((log) => log.driver))).sort((a, b) => a.localeCompare(b)),
    [normalizedLogs]
  );

  const locationOptions = useMemo(
    () =>
      Array.from(new Set(normalizedLogs.map((log) => log.location).filter(shouldShowFuelLogLocationOption))).sort((a, b) =>
        a.localeCompare(b)
      ),
    [normalizedLogs]
  );

  const vehicleOptions = useMemo(
    () => Array.from(new Set(normalizedLogs.map((log) => log.vehicle_reg).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [normalizedLogs]
  );

  const filteredLogs = useMemo(
    () =>
      normalizedLogs.filter((log) => {
        if (filters.fromDate && log.date < filters.fromDate) return false;
        if (filters.toDate && log.date > filters.toDate) return false;
        if (filters.driver && log.driver !== filters.driver) return false;
        if (filters.location && log.location !== filters.location) return false;
        if (filters.vehicleReg && log.vehicle_reg !== filters.vehicleReg) return false;
        return true;
      }),
    [filters, normalizedLogs]
  );

  const groupedRows = useMemo(() => {
    const groups = new Map<string, GroupedFuelSpendRow>();

    for (const log of filteredLogs) {
      const key = `${log.driver}::${log.location}`;
      const existing = groups.get(key);
      const totalCost = getSafeNumber(log.total_cost);
      const litres = getSafeNumber(log.litres);

      if (!existing) {
        groups.set(key, {
          id: key,
          driver: log.driver,
          location: log.location,
          totalSpend: totalCost,
          totalLitres: litres,
          entryCount: 1,
          averagePricePerLitre: null,
          lastUsedDate: log.date,
          logs: [log]
        });
        continue;
      }

      existing.totalSpend += totalCost;
      existing.totalLitres += litres;
      existing.entryCount += 1;
      existing.lastUsedDate = log.date > existing.lastUsedDate ? log.date : existing.lastUsedDate;
      existing.logs.push(log);
    }

    const rows = Array.from(groups.values()).map((row) => ({
      ...row,
      averagePricePerLitre: row.totalLitres > 0 ? row.totalSpend / row.totalLitres : null,
      logs: row.logs.sort((left, right) => right.date.localeCompare(left.date))
    }));

    return rows.sort((left, right) => {
      if (sortKey === "lastUsedDate") return right.lastUsedDate.localeCompare(left.lastUsedDate);
      return right[sortKey] - left[sortKey];
    });
  }, [filteredLogs, sortKey]);

  const summary = useMemo(() => {
    const totalSpend = filteredLogs.reduce((sum, log) => sum + getSafeNumber(log.total_cost), 0);
    const totalLitres = filteredLogs.reduce((sum, log) => sum + getSafeNumber(log.litres), 0);
    const locationCounts = new Map<string, number>();
    filteredLogs.forEach((log) => locationCounts.set(log.location, (locationCounts.get(log.location) ?? 0) + 1));
    const mostUsedStation =
      Array.from(locationCounts.entries()).sort((left, right) => right[1] - left[1])[0]?.[0] ?? "-";

    return {
      totalSpend,
      totalLitres,
      averagePricePerLitre: totalLitres > 0 ? totalSpend / totalLitres : null,
      entryCount: filteredLogs.length,
      mostUsedStation
    };
  }, [filteredLogs]);

  const spendByDriver = useMemo(
    () => buildChartRows(filteredLogs, "driver").slice(0, 5),
    [filteredLogs]
  );

  const spendByLocation = useMemo(
    () => buildChartRows(filteredLogs, "location").slice(0, 5),
    [filteredLogs]
  );

  const dateRangeLabel = `${filters.fromDate ? formatDate(filters.fromDate, language) : "-"} - ${filters.toDate ? formatDate(filters.toDate, language) : "-"}`;

  const exportReport = () => {
    const rows: Record<string, string | number | null>[] = [
      { Section: labels.title, Field: labels.generatedDate, Value: formatDate(today(), language) },
      { Section: labels.title, Field: labels.selectedDateRange, Value: dateRangeLabel },
      { Section: labels.appliedFilters, Field: labels.driver, Value: filters.driver || labels.all },
      { Section: labels.appliedFilters, Field: labels.location, Value: filters.location || labels.all },
      { Section: labels.appliedFilters, Field: labels.vehicleRegistration, Value: filters.vehicleReg || labels.all },
      { Section: labels.summaryTotals, Field: labels.totalFuelSpend, Value: summary.totalSpend.toFixed(2) },
      { Section: labels.summaryTotals, Field: labels.totalLitres, Value: summary.totalLitres.toFixed(2) },
      { Section: labels.summaryTotals, Field: labels.averagePricePerLitre, Value: summary.averagePricePerLitre?.toFixed(2) ?? "" },
      { Section: labels.summaryTotals, Field: labels.fuelEntries, Value: summary.entryCount },
      ...groupedRows.map((row) => ({
        Section: labels.groupedTable,
        [labels.driver]: row.driver,
        [labels.location]: row.location,
        [labels.totalSpend]: row.totalSpend.toFixed(2),
        [labels.totalLitres]: row.totalLitres.toFixed(2),
        [labels.entries]: row.entryCount,
        [labels.averagePricePerLitre]: row.averagePricePerLitre?.toFixed(2) ?? "",
        [labels.lastUsedDate]: row.lastUsedDate
      })),
      ...filteredLogs.map((log) => ({
        Section: labels.individualDetails,
        [labels.date]: log.date,
        [labels.driver]: log.driver,
        [labels.vehicleRegistration]: log.vehicle_reg,
        [labels.location]: log.location,
        [labels.litres]: getSafeNumber(log.litres).toFixed(2),
        [labels.totalCost]: getSafeNumber(log.total_cost).toFixed(2),
        [labels.pricePerLitre]: getPricePerLitre(log)?.toFixed(2) ?? "",
        [labels.notes]: log.notes ?? "",
        [labels.checkedStatus]: log.receipt_checked ? labels.checked : labels.notChecked,
        [labels.source]: getEntrySourceLabel(log.entry_source, labels)
      }))
    ];

    exportToCsv(rows, "fuel-spend-report");
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
          <button type="button" onClick={exportReport} disabled={!filteredLogs.length} className="btn-secondary w-full gap-2 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto">
            <Download className="h-4 w-4" />
            {labels.export}
          </button>
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
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <SummaryCard label={labels.totalFuelSpend} value={formatBaht(summary.totalSpend)} />
        <SummaryCard label={labels.totalLitres} value={formatLitres(summary.totalLitres, language)} />
        <SummaryCard label={labels.averagePricePerLitre} value={formatPrice(summary.averagePricePerLitre)} />
        <SummaryCard label={labels.fuelEntries} value={formatNumber(summary.entryCount, language)} />
        <SummaryCard label={labels.mostUsedStation} value={summary.mostUsedStation} />
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <ChartPanel title={labels.spendByDriver} rows={spendByDriver} language={language} />
        <ChartPanel title={labels.spendByLocation} rows={spendByLocation} language={language} />
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
              <table className="min-w-[1120px] w-full text-sm">
                <thead className="bg-slate-50/95 text-slate-600">
                  <tr>
                    <th className="table-head-cell text-left">{labels.driver}</th>
                    <th className="table-head-cell text-left">{labels.location}</th>
                    <SortableHeader label={labels.totalSpend} active={sortKey === "totalSpend"} onClick={() => setSortKey("totalSpend")} />
                    <SortableHeader label={labels.totalLitres} active={sortKey === "totalLitres"} onClick={() => setSortKey("totalLitres")} />
                    <SortableHeader label={labels.entries} active={sortKey === "entryCount"} onClick={() => setSortKey("entryCount")} />
                    <th className="table-head-cell text-right">{labels.averagePricePerLitre}</th>
                    <SortableHeader label={labels.lastUsedDate} active={sortKey === "lastUsedDate"} onClick={() => setSortKey("lastUsedDate")} />
                  </tr>
                </thead>
                <tbody>
                  {groupedRows.map((row) => {
                    const expanded = expandedRows.has(row.id);
                    return (
                      <Fragment key={row.id}>
                        <tr className="enterprise-table-row cursor-pointer" onClick={() => setExpandedRows((current) => {
                          const next = new Set(current);
                          if (next.has(row.id)) next.delete(row.id);
                          else next.add(row.id);
                          return next;
                        })}>
                          <td className="table-body-cell table-driver-name">{row.driver}</td>
                          <td className="table-body-cell text-slate-700">{row.location}</td>
                          <td className="table-body-cell text-right text-base font-bold text-slate-950">{formatBaht(row.totalSpend)}</td>
                          <td className="table-body-cell text-right font-medium text-slate-800">{formatLitres(row.totalLitres, language)}</td>
                          <td className="table-body-cell text-right font-medium text-slate-800">{formatNumber(row.entryCount, language)}</td>
                          <td className="table-body-cell text-right font-medium text-slate-800">{formatPrice(row.averagePricePerLitre)}</td>
                          <td className="table-body-cell text-right">
                            <span className="inline-flex items-center gap-2 font-medium text-slate-800">
                              {formatDate(row.lastUsedDate, language)}
                              <ChevronDown className={`h-4 w-4 transition ${expanded ? "rotate-180" : ""}`} />
                            </span>
                          </td>
                        </tr>
                        {expanded ? (
                          <tr className="bg-slate-50/60">
                            <td colSpan={7} className="px-4 py-4">
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
                                      <tr key={log.id} className="border-t border-slate-100 text-slate-700">
                                        <td className="px-3 py-2 font-medium">{formatDate(log.date, language)}</td>
                                        <td className="px-3 py-2">{log.driver}</td>
                                        <td className="px-3 py-2">{log.vehicle_reg}</td>
                                        <td className="px-3 py-2">{log.location}</td>
                                        <td className="px-3 py-2 text-right">{formatLitres(getSafeNumber(log.litres), language)}</td>
                                        <td className="px-3 py-2 text-right font-semibold text-slate-900">{formatBaht(getSafeNumber(log.total_cost))}</td>
                                        <td className="px-3 py-2 text-right">{formatPrice(getPricePerLitre(log))}</td>
                                        <td className="px-3 py-2">{log.receipt_checked ? labels.checked : labels.notChecked}</td>
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
    totals.set(label, (totals.get(label) ?? 0) + getSafeNumber(log.total_cost));
  });
  return Array.from(totals.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((left, right) => right.value - left.value);
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="subtle-panel p-4">
      <p className="metric-label">{label}</p>
      <p className="mt-2 truncate text-xl font-bold text-slate-950">{value}</p>
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
