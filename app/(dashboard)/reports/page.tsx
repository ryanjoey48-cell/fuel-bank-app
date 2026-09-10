"use client";

import { ArrowLeft, BarChart3, BookOpenCheck, CalendarDays, Droplets, ExternalLink, FileText, Gauge, Loader2, Route, Wrench } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Header } from "@/components/header";
import { fetchDrivers, fetchFuelLogsForExport, fetchVehicles, fetchWeeklyMileage } from "@/lib/data";
import { normalizeFuelLogLocation, shouldShowFuelLogLocationOption } from "@/lib/fuel-log-location";
import { buildFuelSpendPdf, downloadReportBlob } from "@/lib/fuel-spend-pdf";
import { buildFuelSpendManagementReport, groupFuelSpendStation, normalizeFuelSpendReportVehicleRegistration } from "@/lib/fuel-spend-report";
import { useLanguage } from "@/lib/language-provider";
import { buildWeeklyMileageComparisonReport } from "@/lib/weekly-mileage-report";
import { buildWeeklyMileageComparisonPdf } from "@/lib/weekly-mileage-pdf";
import { formatDate, normalizeDisplayName, today } from "@/lib/utils";
import type { Driver, FuelLogWithDriver, Vehicle, WeeklyMileageEntry } from "@/types/database";

type ReportId =
  | "fuel-spend-summary"
  | "fuel-spend-full"
  | "fuel-efficiency"
  | "vehicle-performance"
  | "weekly-mileage"
  | "weekly-distance"
  | "oil-service"
  | "booking-summary"
  | "booking-full";

type DatePreset = "today" | "this_week" | "last_week" | "this_month" | "last_month" | "custom";
type BookingDatePreset = "last_7_days" | "last_30_days" | "this_month" | "last_month" | "custom";

type DateRange = {
  fromDate: string;
  preset: DatePreset;
  toDate: string;
};

type FuelSpendFilters = DateRange & {
  driver: string;
  fuelType: string;
  location: string;
  vehicleReg: string;
};

type FuelEfficiencyFilters = DateRange & {
  driver: string;
  vehicleReg: string;
};

type BookingFilters = {
  fromDate: string;
  preset: BookingDatePreset;
  toDate: string;
};

type ReportCard = {
  direct: "fuel-spend-summary" | "fuel-spend-full" | "weekly-mileage" | null;
  description: string;
  moduleHref: string;
  moduleName: string;
  name: string;
  reportId: ReportId;
};

type ReportGroup = {
  icon: typeof FileText;
  reports: ReportCard[];
  title: string;
};

function toDateKey(date: Date) {
  const timezoneOffsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - timezoneOffsetMs).toISOString().slice(0, 10);
}

function shiftDate(value: string, days: number) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  return toDateKey(date);
}

function getDateRange(preset: DatePreset): DateRange {
  const now = new Date();
  const day = now.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() + mondayOffset);

  if (preset === "today") return { preset, fromDate: today(), toDate: today() };
  if (preset === "this_week") return { preset, fromDate: toDateKey(startOfWeek), toDate: today() };
  if (preset === "last_week") {
    const from = new Date(startOfWeek);
    from.setDate(from.getDate() - 7);
    const to = new Date(startOfWeek);
    to.setDate(to.getDate() - 1);
    return { preset, fromDate: toDateKey(from), toDate: toDateKey(to) };
  }
  if (preset === "last_month") {
    const firstDay = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastDay = new Date(now.getFullYear(), now.getMonth(), 0);
    return { preset, fromDate: toDateKey(firstDay), toDate: toDateKey(lastDay) };
  }

  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
  return { preset: preset === "custom" ? "custom" : "this_month", fromDate: toDateKey(firstDay), toDate: today() };
}

function getBookingDateRange(preset: BookingDatePreset): BookingFilters {
  if (preset === "last_7_days") return { preset, fromDate: shiftDate(today(), -6), toDate: today() };
  if (preset === "last_30_days") return { preset, fromDate: shiftDate(today(), -29), toDate: today() };
  const range = getDateRange(preset === "custom" ? "custom" : preset);
  return { preset, fromDate: range.fromDate, toDate: range.toDate };
}

function periodLabel(fromDate: string, toDate: string, language: "en" | "th") {
  return `${fromDate ? formatDate(fromDate, language) : "-"} - ${toDate ? formatDate(toDate, language) : "-"}`;
}

function fuelLogMileage(log: FuelLogWithDriver) {
  const raw = log.mileage ?? log.odometer;
  if (raw == null || String(raw).trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

const reportGroups: ReportGroup[] = [
  {
    title: "Fuel & Vehicle",
    icon: Droplets,
    reports: [
      {
        reportId: "fuel-spend-summary",
        name: "Fuel Spend Manager Summary",
        description: "Quick management view of fuel spend, litres, pricing, station usage and issues requiring review.",
        moduleName: "Fuel Spend Report",
        moduleHref: "/fuel-spend-report",
        direct: "fuel-spend-summary"
      },
      {
        reportId: "fuel-spend-full",
        name: "Full Fuel Spend Management Report",
        description: "Detailed fuel spend, vehicle performance, station usage and data-quality report.",
        moduleName: "Fuel Spend Report",
        moduleHref: "/fuel-spend-report",
        direct: "fuel-spend-full"
      },
      {
        reportId: "fuel-efficiency",
        name: "Fuel Efficiency Analysis",
        description: "Driver, vehicle and date-range fuel efficiency drill-down using the existing Fuel Logs workflow.",
        moduleName: "Fuel Logs / Fuel Spend",
        moduleHref: "/fuel-logs",
        direct: null
      },
      {
        reportId: "vehicle-performance",
        name: "Vehicle Performance Management Report",
        description: "Fleet revenue, fuel spend, balance, rankings, highlights and data-quality management report.",
        moduleName: "Vehicle Performance",
        moduleHref: "/vehicle-performance",
        direct: null
      }
    ]
  },
  {
    title: "Mileage & Maintenance",
    icon: Route,
    reports: [
      {
        reportId: "weekly-mileage",
        name: "Weekly Fleet Mileage Overview",
        description: "Current week versus previous week mileage comparison across the fleet.",
        moduleName: "Weekly Mileage",
        moduleHref: "/weekly-mileage",
        direct: "weekly-mileage"
      },
      {
        reportId: "weekly-distance",
        name: "Weekly Distance History Report",
        description: "Historical weekly distance trend and current versus history comparison.",
        moduleName: "Weekly Mileage",
        moduleHref: "/weekly-mileage",
        direct: null
      },
      {
        reportId: "oil-service",
        name: "Oil Change Service Report",
        description: "Action-first oil service status covering overdue, due soon and OK vehicles.",
        moduleName: "Weekly Mileage / Maintenance",
        moduleHref: "/weekly-mileage",
        direct: null
      }
    ]
  },
  {
    title: "Booking & Operations",
    icon: CalendarDays,
    reports: [
      {
        reportId: "booking-summary",
        name: "Booking Diary Manager Summary",
        description: "Concise operational summary, KPI cards, period movement and management actions.",
        moduleName: "Booking Diary",
        moduleHref: "/booking-diary",
        direct: null
      },
      {
        reportId: "booking-full",
        name: "Booking Diary Full Business Insights Report",
        description: "Detailed booking trends, repeat work, route quality, workload and data-quality insights.",
        moduleName: "Booking Diary",
        moduleHref: "/booking-diary",
        direct: null
      }
    ]
  }
];

export default function ReportsPage() {
  const { language } = useLanguage();
  const languageKey = language === "th" ? "th" : "en";
  const [expandedReport, setExpandedReport] = useState<ReportId | null>(null);
  const [fuelLogs, setFuelLogs] = useState<FuelLogWithDriver[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [weeklyMileage, setWeeklyMileage] = useState<WeeklyMileageEntry[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [generatingReport, setGeneratingReport] = useState<ReportId | null>(null);
  const [cardErrors, setCardErrors] = useState<Record<string, string>>({});
  const [fuelSpendFiltersByReport, setFuelSpendFiltersByReport] = useState<Record<string, FuelSpendFilters>>({
    "fuel-spend-summary": { ...getDateRange("this_month"), driver: "", fuelType: "", location: "", vehicleReg: "" },
    "fuel-spend-full": { ...getDateRange("this_month"), driver: "", fuelType: "", location: "", vehicleReg: "" }
  });
  const [fuelEfficiencyFilters, setFuelEfficiencyFilters] = useState<FuelEfficiencyFilters>({ ...getDateRange("this_month"), driver: "", vehicleReg: "" });
  const [bookingFiltersByReport, setBookingFiltersByReport] = useState<Record<string, BookingFilters>>({
    "booking-summary": getBookingDateRange("last_30_days"),
    "booking-full": getBookingDateRange("last_30_days")
  });
  const [weeklyMileageWeek, setWeeklyMileageWeek] = useState("");
  const [weeklyDistancePeriod, setWeeklyDistancePeriod] = useState("12");

  useEffect(() => {
    let active = true;
    setLoadingData(true);
    Promise.all([fetchFuelLogsForExport(), fetchDrivers(), fetchVehicles(), fetchWeeklyMileage()])
      .then(([fuelRows, driverRows, vehicleRows, mileageRows]) => {
        if (!active) return;
        setFuelLogs(fuelRows);
        setDrivers(driverRows);
        setVehicles(vehicleRows);
        setWeeklyMileage(mileageRows);
        const latestWeek = Array.from(new Set(mileageRows.map((row) => row.week_ending).filter(Boolean))).sort().at(-1) ?? "";
        setWeeklyMileageWeek((current) => current || latestWeek);
      })
      .catch((error) => {
        console.error("Reports Centre data load failed:", error);
        if (active) setCardErrors((current) => ({ ...current, page: "Unable to load report data. Please try again." }));
      })
      .finally(() => {
        if (active) setLoadingData(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const normalizedFuelLogs = useMemo(
    () =>
      fuelLogs.map((log) => ({
        ...log,
        driver: normalizeDisplayName(log.driver) || "Unknown driver",
        location: normalizeFuelLogLocation(log.location) || "Unknown station",
        vehicle_reg: normalizeFuelSpendReportVehicleRegistration(log.vehicle_reg)
      })),
    [fuelLogs]
  );

  const driverOptions = useMemo(
    () => Array.from(new Set(normalizedFuelLogs.map((log) => log.driver).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [normalizedFuelLogs]
  );

  const vehicleOptions = useMemo(
    () => Array.from(new Set(normalizedFuelLogs.map((log) => log.vehicle_reg).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [normalizedFuelLogs]
  );

  const fuelTypeOptions = useMemo(
    () => Array.from(new Set(normalizedFuelLogs.map((log) => String(log.fuel_type || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [normalizedFuelLogs]
  );

  const stationOptions = useMemo(
    () =>
      Array.from(new Set(normalizedFuelLogs.map((log) => log.location).filter(shouldShowFuelLogLocationOption)))
        .filter((location) => !["Bangchak", "Shell", "Best LPG", "Other"].includes(location))
        .sort((a, b) => a.localeCompare(b)),
    [normalizedFuelLogs]
  );

  const weekOptions = useMemo(
    () => Array.from(new Set(weeklyMileage.map((row) => row.week_ending).filter(Boolean))).sort((left, right) => right.localeCompare(left)),
    [weeklyMileage]
  );

  const generateFuelSpend = async (report: ReportCard) => {
    const filters = fuelSpendFiltersByReport[report.reportId];
    const reportData = buildFuelSpendManagementReport(normalizedFuelLogs, filters);
    if (!reportData.logs.length) throw new Error("No fuel logs are available for the selected period.");
    const pdf = await buildFuelSpendPdf(reportData, {
      full: report.direct === "fuel-spend-full",
      language: languageKey,
      periodLabel: periodLabel(filters.fromDate, filters.toDate, languageKey)
    });
    downloadReportBlob(pdf, report.direct === "fuel-spend-full" ? "fuel-spend-management-report.pdf" : "fuel-spend-manager-summary.pdf");
  };

  const generateWeeklyMileage = async () => {
    if (!weeklyMileageWeek) throw new Error("No weekly mileage reports are available.");
    const report = buildWeeklyMileageComparisonReport({ entries: weeklyMileage, vehicles, drivers, selectedWeek: weeklyMileageWeek });
    if (!report.rows.length) throw new Error("No weekly mileage data is available for the selected week.");
    const pdf = await buildWeeklyMileageComparisonPdf(report, languageKey);
    downloadReportBlob(pdf, `weekly-fleet-mileage-overview-${weeklyMileageWeek}.pdf`);
  };

  const handleGenerate = async (report: ReportCard) => {
    setGeneratingReport(report.reportId);
    setCardErrors((current) => ({ ...current, [report.reportId]: "" }));
    try {
      if (report.direct === "fuel-spend-summary" || report.direct === "fuel-spend-full") await generateFuelSpend(report);
      else if (report.direct === "weekly-mileage") await generateWeeklyMileage();
      else throw new Error(directUnavailableReason(report.reportId));
    } catch (error) {
      setCardErrors((current) => ({
        ...current,
        [report.reportId]: error instanceof Error && error.message ? error.message : "Unable to generate report. Please try again."
      }));
    } finally {
      setGeneratingReport(null);
    }
  };

  return (
    <>
      <div className="mb-6 hidden md:block">
        <Header title="Reports Centre" description="Configure and download management reports without leaving this page." />
      </div>

      <section className="surface-card p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm font-semibold text-brand-700 hover:text-brand-900">
              <ArrowLeft className="h-4 w-4" />
              Back to Dashboard
            </Link>
            <h2 className="mt-3 text-xl font-semibold text-slate-950">Reports Centre</h2>
            <p className="mt-1 max-w-3xl text-sm text-slate-500">
              Choose a report, adjust its filters, then download directly. Open Module remains available for full record review.
            </p>
            {cardErrors.page ? <p className="mt-3 text-sm font-semibold text-rose-600">{cardErrors.page}</p> : null}
          </div>
          <div className="hidden rounded-2xl border border-brand-100 bg-brand-50 p-3 text-brand-700 sm:block">
            <FileText className="h-5 w-5" />
          </div>
        </div>
      </section>

      <div className="mt-5 space-y-5">
        {reportGroups.map((group) => (
          <section key={group.title} className="surface-card p-4 sm:p-5">
            <div className="mb-4 flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-brand-100 bg-brand-50 text-brand-700">
                <group.icon className="h-4.5 w-4.5" />
              </div>
              <h3 className="section-title">{group.title}</h3>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {group.reports.map((report) => {
                const expanded = expandedReport === report.reportId;
                const generating = generatingReport === report.reportId;
                return (
                  <article key={report.reportId} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h4 className="text-sm font-bold text-slate-950">{report.name}</h4>
                        <p className="mt-2 text-sm leading-6 text-slate-600">{report.description}</p>
                      </div>
                      <ReportIcon reportName={report.name} />
                    </div>
                    <p className="mt-4 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Source module</p>
                    <p className="mt-1 text-sm font-semibold text-slate-800">{report.moduleName}</p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button type="button" onClick={() => setExpandedReport(expanded ? null : report.reportId)} className="btn-primary min-h-9 gap-2 px-3 py-1.5 text-xs">
                        <FileText className="h-3.5 w-3.5" />
                        Generate Report
                      </button>
                      <Link href={report.moduleHref} className="btn-secondary min-h-9 gap-2 px-3 py-1.5 text-xs">
                        <ExternalLink className="h-3.5 w-3.5" />
                        Open Module
                      </Link>
                    </div>

                    {expanded ? (
                      <div className="mt-4 border-t border-slate-100 bg-slate-50/80 px-3 py-4">
                        {renderFilters(report.reportId, {
                          bookingFilters: bookingFiltersByReport[report.reportId],
                          driverOptions,
                          fuelEfficiencyFilters,
                          fuelSpendFilters: fuelSpendFiltersByReport[report.reportId],
                          fuelTypeOptions,
                          loadingData,
                          setBookingFilters: (next) => setBookingFiltersByReport((current) => ({ ...current, [report.reportId]: next })),
                          setFuelEfficiencyFilters,
                          setFuelSpendFilters: (next) => setFuelSpendFiltersByReport((current) => ({ ...current, [report.reportId]: next })),
                          setWeeklyDistancePeriod,
                          setWeeklyMileageWeek,
                          stationOptions,
                          vehicleOptions,
                          weekOptions,
                          weeklyDistancePeriod,
                          weeklyMileageWeek
                        })}
                        {cardErrors[report.reportId] ? (
                          <p className="mt-3 rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{cardErrors[report.reportId]}</p>
                        ) : null}
                        <div className="mt-4 flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={loadingData || generating}
                            onClick={() => void handleGenerate(report)}
                            className="btn-primary min-h-9 gap-2 px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
                            {generating ? "Generating report..." : downloadLabel(report.reportId)}
                          </button>
                          <button type="button" onClick={() => setExpandedReport(null)} className="btn-secondary min-h-9 px-3 py-1.5 text-xs">Cancel</button>
                        </div>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

function renderFilters(reportId: ReportId, context: {
  bookingFilters?: BookingFilters;
  driverOptions: string[];
  fuelEfficiencyFilters: FuelEfficiencyFilters;
  fuelSpendFilters?: FuelSpendFilters;
  fuelTypeOptions: string[];
  loadingData: boolean;
  setBookingFilters: (filters: BookingFilters) => void;
  setFuelEfficiencyFilters: (filters: FuelEfficiencyFilters) => void;
  setFuelSpendFilters: (filters: FuelSpendFilters) => void;
  setWeeklyDistancePeriod: (value: string) => void;
  setWeeklyMileageWeek: (value: string) => void;
  stationOptions: string[];
  vehicleOptions: string[];
  weekOptions: string[];
  weeklyDistancePeriod: string;
  weeklyMileageWeek: string;
}) {
  if (reportId === "fuel-spend-summary" || reportId === "fuel-spend-full") {
    const filters = context.fuelSpendFilters!;
    return (
      <div className="grid gap-3 lg:grid-cols-5">
        <DateRangeFields filters={filters} onChange={context.setFuelSpendFilters} />
        <SelectField label="Vehicle" value={filters.vehicleReg} onChange={(vehicleReg) => context.setFuelSpendFilters({ ...filters, vehicleReg })} options={context.vehicleOptions} allLabel="All Vehicles" />
        <SelectField label="Driver" value={filters.driver} onChange={(driver) => context.setFuelSpendFilters({ ...filters, driver })} options={context.driverOptions} allLabel="All Drivers" />
        <SelectField label="Fuel Type" value={filters.fuelType} onChange={(fuelType) => context.setFuelSpendFilters({ ...filters, fuelType })} options={context.fuelTypeOptions} allLabel="All Fuel Types" />
        <SelectField label="Station" value={filters.location} onChange={(location) => context.setFuelSpendFilters({ ...filters, location })} options={["Bangchak", "Shell", "Best LPG", "Other", ...context.stationOptions]} allLabel="All Stations" />
      </div>
    );
  }

  if (reportId === "weekly-mileage") {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <label>
          <span className="form-label">Week ending</span>
          <select value={context.weeklyMileageWeek} onChange={(event) => context.setWeeklyMileageWeek(event.target.value)} className="form-input bg-white">
            {context.weekOptions.map((week) => <option key={week} value={week}>{week}</option>)}
          </select>
        </label>
      </div>
    );
  }

  if (reportId === "fuel-efficiency") {
    const filters = context.fuelEfficiencyFilters;
    return (
      <div className="space-y-3">
        <div className="grid gap-3 lg:grid-cols-4">
          <DateRangeFields filters={filters} onChange={context.setFuelEfficiencyFilters} />
          <SelectField label="Driver" value={filters.driver} onChange={(driver) => context.setFuelEfficiencyFilters({ ...filters, driver })} options={context.driverOptions} allLabel="All Drivers" />
          <SelectField label="Vehicle" value={filters.vehicleReg} onChange={(vehicleReg) => context.setFuelEfficiencyFilters({ ...filters, vehicleReg })} options={context.vehicleOptions} allLabel="All Vehicles" />
        </div>
        <UnavailableNotice reason={directUnavailableReason(reportId)} />
      </div>
    );
  }

  if (reportId === "booking-summary" || reportId === "booking-full") {
    const filters = context.bookingFilters!;
    return (
      <div className="space-y-3">
        <BookingDateRangeFields filters={filters} onChange={context.setBookingFilters} />
        <UnavailableNotice reason={directUnavailableReason(reportId)} />
      </div>
    );
  }

  if (reportId === "weekly-distance") {
    return (
      <div className="space-y-3">
        <label className="block max-w-xs">
          <span className="form-label">Period</span>
          <select value={context.weeklyDistancePeriod} onChange={(event) => context.setWeeklyDistancePeriod(event.target.value)} className="form-input bg-white">
            <option value="4">Last 4 weeks</option>
            <option value="8">Last 8 weeks</option>
            <option value="12">Last 12 weeks</option>
          </select>
        </label>
        <UnavailableNotice reason={directUnavailableReason(reportId)} />
      </div>
    );
  }

  if (reportId === "oil-service") {
    return (
      <div className="space-y-3">
        <p className="text-sm font-medium text-slate-700">Report as of: latest available mileage and current oil-service baseline.</p>
        <UnavailableNotice reason={directUnavailableReason(reportId)} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-slate-700">Use the source module filters currently supported by this report.</p>
      <UnavailableNotice reason={directUnavailableReason(reportId)} />
    </div>
  );
}

function DateRangeFields<T extends DateRange>({ filters, onChange }: { filters: T; onChange: (filters: T) => void }) {
  const updatePreset = (preset: DatePreset) => {
    if (preset === "custom") onChange({ ...filters, preset });
    else onChange({ ...filters, ...getDateRange(preset) });
  };
  return (
    <>
      <label>
        <span className="form-label">Date Range</span>
        <select value={filters.preset} onChange={(event) => updatePreset(event.target.value as DatePreset)} className="form-input bg-white">
          <option value="today">Today</option>
          <option value="this_week">This Week</option>
          <option value="last_week">Last Week</option>
          <option value="this_month">This Month</option>
          <option value="last_month">Last Month</option>
          <option value="custom">Custom</option>
        </select>
      </label>
      {filters.preset === "custom" ? (
        <>
          <label>
            <span className="form-label">From</span>
            <input type="date" value={filters.fromDate} onChange={(event) => onChange({ ...filters, fromDate: event.target.value })} className="form-input bg-white" />
          </label>
          <label>
            <span className="form-label">To</span>
            <input type="date" value={filters.toDate} onChange={(event) => onChange({ ...filters, toDate: event.target.value })} className="form-input bg-white" />
          </label>
        </>
      ) : null}
    </>
  );
}

function BookingDateRangeFields({ filters, onChange }: { filters: BookingFilters; onChange: (filters: BookingFilters) => void }) {
  const updatePreset = (preset: BookingDatePreset) => {
    if (preset === "custom") onChange({ ...filters, preset });
    else onChange(getBookingDateRange(preset));
  };
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <label>
        <span className="form-label">Date Range</span>
        <select value={filters.preset} onChange={(event) => updatePreset(event.target.value as BookingDatePreset)} className="form-input bg-white">
          <option value="last_7_days">Last 7 Days</option>
          <option value="last_30_days">Last 30 Days</option>
          <option value="this_month">This Month</option>
          <option value="last_month">Last Month</option>
          <option value="custom">Custom</option>
        </select>
      </label>
      {filters.preset === "custom" ? (
        <>
          <label>
            <span className="form-label">From</span>
            <input type="date" value={filters.fromDate} onChange={(event) => onChange({ ...filters, fromDate: event.target.value })} className="form-input bg-white" />
          </label>
          <label>
            <span className="form-label">To</span>
            <input type="date" value={filters.toDate} onChange={(event) => onChange({ ...filters, toDate: event.target.value })} className="form-input bg-white" />
          </label>
        </>
      ) : null}
    </div>
  );
}

function SelectField({ allLabel, label, onChange, options, value }: { allLabel: string; label: string; onChange: (value: string) => void; options: string[]; value: string }) {
  return (
    <label>
      <span className="form-label">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="form-input bg-white">
        <option value="">{allLabel}</option>
        {options.map((option) => <option key={`${label}-${option}`} value={option}>{option}</option>)}
      </select>
    </label>
  );
}

function UnavailableNotice({ reason }: { reason: string }) {
  return <p className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">{reason}</p>;
}

function directUnavailableReason(reportId: ReportId) {
  if (reportId === "fuel-efficiency") return "Direct generation is not available yet because the Fuel Efficiency PDF generator and its dependency rules are still page-local inside Fuel Logs.";
  if (reportId === "vehicle-performance") return "Direct generation is not available yet because the Vehicle Performance PDF data builder and renderer are still page-local inside Vehicle Performance.";
  if (reportId === "weekly-distance") return "Direct generation is not available yet because the Weekly Distance PDF builder is still page-local inside Weekly Mileage.";
  if (reportId === "oil-service") return "Direct generation is not available yet because the Oil Service PDF builder depends on page-local maintenance summary state inside Weekly Mileage.";
  if (reportId === "booking-summary" || reportId === "booking-full") return "Direct generation is not available yet because Booking Diary reports use the existing page-local print component rather than an exported PDF generator.";
  return "Unable to generate report. Please try again.";
}

function downloadLabel(reportId: ReportId) {
  if (reportId === "fuel-spend-summary") return "Download Manager Summary PDF";
  if (reportId === "fuel-spend-full") return "Download Full Fuel Report PDF";
  if (reportId === "fuel-efficiency") return "Download Fuel Efficiency PDF";
  if (reportId === "vehicle-performance") return "Download Vehicle Performance PDF";
  if (reportId === "weekly-mileage") return "Download Weekly Mileage PDF";
  if (reportId === "weekly-distance") return "Download Distance History PDF";
  if (reportId === "oil-service") return "Download Oil Service PDF";
  return "Download PDF";
}

function ReportIcon({ reportName }: { reportName: string }) {
  const Icon =
    reportName.includes("Fuel Spend") || reportName.includes("Fuel Efficiency")
      ? Droplets
      : reportName.includes("Vehicle")
        ? Gauge
        : reportName.includes("Oil")
          ? Wrench
          : reportName.includes("Booking")
            ? BookOpenCheck
            : reportName.includes("Mileage") || reportName.includes("Distance")
              ? Route
              : BarChart3;

  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-600">
      <Icon className="h-4.5 w-4.5" />
    </div>
  );
}
