"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BarChart3, CalendarDays, ChevronRight, CircleDollarSign, Repeat2, Truck, Wrench, X } from "lucide-react";
import { MaintenancePeriodPresets } from "@/components/maintenance-period-presets";
import { MaintenanceField as Field } from "@/components/maintenance-fields";
import { useLanguage } from "@/lib/language-provider";
import {
  fetchMaintenanceData,
  MaintenanceLoadError,
} from "@/lib/maintenance-data";
import {
  maintenanceAnalytics,
  maintenanceToday,
  validMaintenanceDate,
} from "@/lib/maintenance";
import { maintenanceFleetSummary, maintenanceVehicleType } from "@/lib/maintenance-ux";
import type { MaintenanceData } from "@/lib/maintenance-types";
import { maintenanceCategoryLabels } from "@/lib/maintenance-translations";
import { formatCurrency, formatDate, formatNumber } from "@/lib/utils";

type InsightModal =
  | { type: "category"; key: string }
  | { type: "pattern"; key: string }
  | { type: "month"; key: string }
  | null;

const normalizeInsightText = (value: unknown) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[–—-]/g, " ")
    .replace(/[^a-z0-9ก-๙]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

const formatMonthLabel = (key: string, language: "en" | "th") => {
  const match = /^(\d{4})-(\d{2})$/.exec(key);
  if (!match) return key;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
  return date.toLocaleDateString(language === "th" ? "th-TH" : "en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
};

const maintenanceItemLabel = (item: unknown) => {
  const source = (item ?? {}) as Record<string, unknown>;
  const candidates = [
    source.name,
    source.item_name,
    source.description,
    source.item,
    source.part_name,
    source.title,
    source.original_name,
    source.original_text,
    source.notes,
  ];
  return String(candidates.find((value) => typeof value === "string" && value.trim()) ?? "Maintenance item").trim();
};

export default function MaintenanceAnalyticsPage() {
  const { t, language } = useLanguage();
  const c = t.maintenance;

  const [data, setData] = useState<MaintenanceData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [vehicle, setVehicle] = useState("");
  const [type, setType] = useState("");
  const [start, setStart] = useState(`${maintenanceToday().slice(0, 4)}-01-01`);
  const [end, setEnd] = useState(maintenanceToday());
  const [tab, setTab] = useState<"vehicles" | "spending" | "patterns">("vehicles");
  const [selectedVehicle, setSelectedVehicle] = useState("");
  const [showAllVehicles, setShowAllVehicles] = useState(false);
  const [insightModal, setInsightModal] = useState<InsightModal>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      setData(await fetchMaintenanceData(true));
      setError(null);
    } catch (caught) {
      setData(null);
      setError(
        caught instanceof MaintenanceLoadError
          ? `${caught.table} (${caught.status}, ${caught.code})`
          : ""
      );
      console.error("Maintenance load failed", caught);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    const p = new URL(window.location.href).searchParams;
    setVehicle(p.get("vehicle") ?? "");
    if (validMaintenanceDate(p.get("start") ?? "")) setStart(p.get("start")!);
    if (validMaintenanceDate(p.get("end") ?? "")) setEnd(p.get("end")!);
    void load();
  }, [load]);

  useEffect(() => {
    if (!insightModal && !selectedVehicle) return;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setInsightModal(null);
        setSelectedVehicle("");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = oldOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [insightModal, selectedVehicle]);

  const valid =
    validMaintenanceDate(start) &&
    validMaintenanceDate(end) &&
    start <= end;

  const rows = useMemo(() => {
    if (!data || !valid) return [];

    return data.vehicles
      .filter(
        (v) =>
          (!vehicle || v.id === vehicle) &&
          (!type || v.vehicle_type === type)
      )
      .map((v) => ({
        vehicle: v,
        ...maintenanceAnalytics(data, v.id, start, end),
      }))
      .sort((a, b) => b.total - a.total);
  }, [data, valid, vehicle, type, start, end]);

  const activeRows = useMemo(
    () => rows.filter((row) => row.total > 0 || row.visits > 0),
    [rows]
  );

  const lastServiceDateByVehicle = useMemo(() => {
    const result = new Map<string, string>();
    if (!data) return result;

    for (const record of data.records) {
      if (
        record.is_deleted ||
        record.service_date < start ||
        record.service_date > end
      ) continue;

      const current = result.get(record.vehicle_id);
      if (!current || record.service_date > current) {
        result.set(record.vehicle_id, record.service_date);
      }
    }

    return result;
  }, [data, start, end]);

  const summary = useMemo(
    () =>
      data && valid
        ? maintenanceFleetSummary(
            data,
            rows.map((row) => row.vehicle.id),
            start,
            end
          )
        : null,
    [data, valid, rows, start, end]
  );

  const totalVisits = activeRows.reduce((sum, row) => sum + row.visits, 0);
  const averageVisit =
    summary && totalVisits > 0 ? summary.total / totalVisits : null;

  const categoryTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const row of activeRows) {
      for (const [key, value] of Object.entries(row.byCategory)) {
        totals.set(key, (totals.get(key) ?? 0) + Number(value));
      }
    }
    return Array.from(totals.entries()).sort((a, b) => b[1] - a[1]);
  }, [activeRows]);

  const monthlyTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const row of activeRows) {
      for (const [key, value] of Object.entries(row.monthly)) {
        totals.set(key, (totals.get(key) ?? 0) + Number(value));
      }
    }
    return Array.from(totals.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [activeRows]);

  const repeatTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const row of activeRows) {
      for (const [key, value] of Object.entries(row.repeats)) {
        totals.set(key, (totals.get(key) ?? 0) + Number(value));
      }
    }
    return Array.from(totals.entries())
      .filter(([name, count]) => {
        const normalized = name.trim().toLowerCase();
        if (count <= 1) return false;
        if (normalized === "labour" || normalized === "labor") return false;
        if (normalized.includes("labour charge") || normalized.includes("labor charge")) return false;
        return true;
      })
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [activeRows]);

  const selectedRow = useMemo(
    () => activeRows.find((row) => row.vehicle.id === selectedVehicle) ?? null,
    [activeRows, selectedVehicle]
  );

  const visibleVehicleRows = showAllVehicles ? activeRows : activeRows.slice(0, 6);
  const highestVehicleSpend = Math.max(1, ...activeRows.map((row) => row.total));

  const modalRecords = useMemo(() => {
    if (!data || !insightModal) return [];

    const allowedVehicleIds = new Set(rows.map((row) => row.vehicle.id));
    const needle = normalizeInsightText(insightModal.key);

    return data.records
      .filter(
        (record) =>
          !record.is_deleted &&
          record.service_date >= start &&
          record.service_date <= end &&
          allowedVehicleIds.has(record.vehicle_id) &&
          (insightModal.type !== "month" || record.service_date.slice(0, 7) === insightModal.key)
      )
      .map((record) => {
        const vehicleRow = data.vehicles.find((v) => v.id === record.vehicle_id);
        const recordItems = data.items.filter((item) => item.record_id === record.id);
        const matchedItems = recordItems.filter((item) => {
          if (insightModal.type === "month") return true;
          if (insightModal.type === "category") return item.category === insightModal.key;
          const hay = normalizeInsightText(maintenanceItemLabel(item));
          return !!needle && hay === needle;
        });

        const matchedTotal = matchedItems.reduce((sum, item) => {
          const lineTotal =
            item.line_total === null || item.line_total === undefined
              ? Number(item.quantity ?? 0) * Number(item.unit_price ?? 0)
              : Number(item.line_total);
          return sum + lineTotal;
        }, 0);

        const effectiveTotal =
          insightModal.type === "month" && matchedItems.length === 0
            ? Number(record.calculated_total ?? 0)
            : matchedTotal;

        return {
          record,
          vehicle: vehicleRow,
          matchedItems,
          matchedTotal: effectiveTotal,
        };
      })
      .filter(({ matchedItems, matchedTotal }) =>
        insightModal.type === "month" ? matchedTotal > 0 : matchedItems.length > 0
      )
      .sort(
        (a, b) =>
          b.record.service_date.localeCompare(a.record.service_date) ||
          b.matchedTotal - a.matchedTotal
      );
  }, [data, insightModal, rows, start, end]);

  const modalOccurrences = modalRecords.reduce(
    (sum, entry) => sum + entry.matchedItems.length,
    0
  );

  const modalTotal = modalRecords.reduce(
    (sum, record) => sum + record.matchedTotal,
    0
  );

  const modalVehicleCount = new Set(
    modalRecords.map((entry) => entry.record.vehicle_id)
  ).size;

  const maxCategoryTotal = Math.max(
    1,
    ...categoryTotals.map(([, value]) => Number(value))
  );

  const maxMonthlyTotal = Math.max(
    1,
    ...monthlyTotals.map(([, value]) => Number(value))
  );

  const maxRepeatCount = Math.max(
    1,
    ...repeatTotals.map(([, count]) => Number(count))
  );

  const categoryName = (key: string) =>
    maintenanceCategoryLabels[language][
      key as keyof typeof maintenanceCategoryLabels.en
    ] ?? key;

  return (
    <div className="space-y-5">
      <section className="surface-card flex flex-col gap-5 px-5 py-6 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-violet-500">
            EXPERT EXPRESS SENDER CO., LTD.
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950 sm:text-[28px]">
            {c.analytics}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            See spend, costly vehicles and repeat-repair patterns without showing everything at once.
          </p>
        </div>

        <nav
          aria-label="Maintenance sections"
          className="inline-flex w-fit shrink-0 rounded-2xl border border-violet-100 bg-violet-50/70 p-1"
        >
          <Link
            href="/maintenance"
            className="rounded-xl px-4 py-2 text-sm font-medium text-slate-500 transition hover:bg-white/70 hover:text-violet-700"
          >
            {c.title}
          </Link>
          <Link
            href="/maintenance/analytics"
            className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-violet-700 shadow-sm"
          >
            {c.analytics}
          </Link>
        </nav>
      </section>

      {/* REPORT CONTROLS */}
      <section className="surface-card p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-slate-800">
              {c.period}:{" "}
              {start === "1900-01-01" ? c.allTime : formatDate(start, language)}
              {" – "}
              {formatDate(end, language)}
            </p>
            <p className="mt-1 max-w-4xl text-xs text-slate-500">
              Choose a reporting period, then inspect vehicles, spending or repeated repairs.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link className="btn-secondary" href="/maintenance">
              {c.title}
            </Link>
            <button
              className="btn-secondary"
              disabled={busy}
              onClick={() => void load()}
            >
              {c.refresh}
            </button>
          </div>
        </div>

        {busy && <p className="mt-3 text-sm text-slate-500">{t.common.loading}</p>}
        {error !== null && (
          <p role="alert" className="mt-3 text-sm text-amber-800">
            {c.loadError}
            {error && <span className="mt-1 block text-xs">{error}</span>}
          </p>
        )}
        {!valid && (
          <p role="alert" className="mt-3 text-sm text-rose-700">
            {c.noDates}
          </p>
        )}

        <div className="mt-4">
          <MaintenancePeriodPresets
            start={start}
            end={end}
            onChange={(range) => {
              setStart(range.start);
              setEnd(range.end);
              setSelectedVehicle("");
            }}
          />
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={c.start}>
            <input
              className="form-input"
              type="date"
              max={end}
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </Field>

          <Field label={c.end}>
            <input
              className="form-input"
              type="date"
              min={start}
              max={maintenanceToday()}
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </Field>

          <Field label={c.vehicle}>
            <select
              className="form-input"
              value={vehicle}
              onChange={(e) => {
                setVehicle(e.target.value);
                setSelectedVehicle("");
              }}
            >
              <option value="">{c.all}</option>
              {data?.vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.vehicle_reg}
                </option>
              ))}
            </select>
          </Field>

          <Field label={c.vehicleType}>
            <select
              className="form-input"
              value={type}
              onChange={(e) => setType(e.target.value)}
            >
              <option value="">{c.all}</option>
              {Array.from(
                new Set(data?.vehicles.map((v) => v.vehicle_type).filter(Boolean))
              ).map((value) => (
                <option key={value} value={value!}>
                  {maintenanceVehicleType(
                    value,
                    t.weeklyMileage.oil.vehicleTypes
                  )}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </section>

      {/* EXECUTIVE SUMMARY */}
      {summary && error === null && (
        <section className="surface-card overflow-hidden p-0">
          <div className="flex flex-col divide-y divide-slate-100 lg:flex-row lg:divide-x lg:divide-y-0">
            <div className="flex min-w-0 flex-1 items-center gap-4 px-5 py-4">
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-violet-50 text-violet-700">
                <CircleDollarSign className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-slate-400">Maintenance spend</p>
                <p className="mt-1 text-xl font-bold tracking-tight text-slate-950">{formatCurrency(summary.total, language)}</p>
              </div>
            </div>

            <div className="grid flex-[2] grid-cols-3 divide-x divide-slate-100">
              <div className="px-5 py-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-slate-400">Vehicles serviced</p>
                <p className="mt-1 text-lg font-semibold text-slate-950">{formatNumber(summary.serviced, language)}</p>
                <p className="mt-0.5 text-xs text-slate-400">At least one visit</p>
              </div>
              <div className="px-5 py-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-slate-400">Workshop visits</p>
                <p className="mt-1 text-lg font-semibold text-slate-950">{formatNumber(summary.records, language)}</p>
                <p className="mt-0.5 text-xs text-slate-400">In selected period</p>
              </div>
              <div className="px-5 py-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-slate-400">Average / visit</p>
                <p className="mt-1 text-lg font-semibold text-slate-950">
                  {averageVisit === null ? "—" : formatCurrency(averageVisit, language)}
                </p>
                <p className="mt-0.5 text-xs text-slate-400">Average maintenance cost</p>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ONE INSIGHT AT A TIME */}
      {data && valid && error === null && (
        <section className="surface-card overflow-hidden p-0">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 px-5 py-5 sm:px-6">
            <div>
              <h2 className="section-title">Maintenance intelligence</h2>
              <p className="mt-1 text-sm text-slate-500">
                Start with the fleet, then drill into exactly where money was spent and which repairs keep repeating.
              </p>
            </div>

            <div className="inline-flex rounded-2xl border border-violet-100 bg-violet-50/70 p-1">
              {[
                ["vehicles", "Fleet spend"],
                ["spending", "Spend breakdown"],
                ["patterns", "Repeat repairs"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setTab(value as typeof tab)}
                  className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
                    tab === value
                      ? "bg-white text-violet-700 shadow-sm"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* VEHICLES */}
          {tab === "vehicles" && (
            <div className="m-5 overflow-hidden rounded-2xl border border-slate-200 bg-white sm:m-6">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
                <div>
                  <h3 className="font-semibold text-slate-950">Top maintenance spend</h3>
                  <p className="mt-1 text-xs text-slate-500">
                    Highest-cost vehicles in the selected reporting period.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-700 ring-1 ring-violet-100">
                    {activeRows.length} vehicles active
                  </span>
                  {activeRows.length > 6 && (
                    <button
                      type="button"
                      className="btn-secondary !min-h-9"
                      onClick={() => setShowAllVehicles((value) => !value)}
                    >
                      {showAllVehicles ? "Show top 6" : "View all"}
                    </button>
                  )}
                </div>
              </div>

              <div className="divide-y divide-slate-100">
                {visibleVehicleRows.map((row, index) => {
                  const avg = row.visits ? row.total / row.visits : null;
                  const share = summary && summary.total > 0 ? Math.round((row.total / summary.total) * 100) : 0;
                  const width = Math.max(5, Math.round((row.total / highestVehicleSpend) * 100));
                  return (
                    <button
                      key={row.vehicle.id}
                      type="button"
                      onClick={() => setSelectedVehicle(row.vehicle.id)}
                      className="group grid w-full gap-4 px-5 py-4 text-left transition hover:bg-violet-50/45 lg:grid-cols-[minmax(220px,1.1fr)_minmax(260px,1.5fr)_minmax(220px,1fr)_auto] lg:items-center"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl text-xs font-bold ${
                          index < 3
                            ? "bg-violet-100 text-violet-800 ring-1 ring-violet-200"
                            : "bg-slate-50 text-slate-500 ring-1 ring-slate-100"
                        }`}>
                          {index + 1}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-slate-950">{row.vehicle.vehicle_reg}</p>
                          <p className="mt-0.5 truncate text-xs text-slate-500">
                            {maintenanceVehicleType(row.vehicle.vehicle_type, t.weeklyMileage.oil.vehicleTypes)}
                          </p>
                        </div>
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-end justify-between gap-3">
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">Maintenance spend</p>
                            <p className="mt-1 text-base font-bold text-violet-700">{formatCurrency(row.total, language)}</p>
                          </div>
                          <span className="text-xs font-medium text-slate-400">{share}% of fleet spend</span>
                        </div>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-violet-500 to-violet-400"
                            style={{ width: `${width}%` }}
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-3 text-sm">
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-[0.11em] text-slate-400">Visits</p>
                          <p className="mt-1 font-semibold text-slate-800">{row.visits}</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-[0.11em] text-slate-400">Avg / visit</p>
                          <p className="mt-1 font-semibold text-slate-800">{avg === null ? "—" : formatCurrency(avg, language)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-[0.11em] text-slate-400">Last service</p>
                          <p className="mt-1 font-semibold text-slate-800">
                            {lastServiceDateByVehicle.get(row.vehicle.id) ? formatDate(lastServiceDateByVehicle.get(row.vehicle.id)!, language) : "—"}
                          </p>
                        </div>
                      </div>

                      <span className="inline-flex items-center gap-1.5 justify-self-start rounded-xl border border-violet-100 bg-white px-3 py-2 text-sm font-medium text-violet-700 shadow-sm transition group-hover:border-violet-200 group-hover:bg-violet-50 lg:justify-self-end">
                        View
                        <ChevronRight className="h-3.5 w-3.5" />
                      </span>
                    </button>
                  );
                })}
              </div>

              {showAllVehicles && activeRows.length > 6 && (
                <div className="border-t border-slate-100 bg-slate-50/50 px-5 py-3 text-xs text-slate-500">
                  Showing all {activeRows.length} vehicles with maintenance activity.
                </div>
              )}
            </div>
          )}

          {/* SPENDING */}
          {tab === "spending" && (
            <div className="m-5 grid gap-4 lg:grid-cols-2 sm:m-6">
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-violet-200">
                <h3 className="font-semibold text-slate-900">Spending by category</h3>
                <p className="mt-1 text-xs text-slate-500">
                  Click a category to see exactly which repairs created the spend.
                </p>
                <div className="mt-3 divide-y divide-slate-100">
                  {categoryTotals.map(([key, amount]) => {
                    const percent = Math.max(4, Math.round((Number(amount) / maxCategoryTotal) * 100));
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setInsightModal({ type: "category", key })}
                        className="group relative w-full overflow-hidden rounded-xl px-3 py-3 text-left transition hover:bg-violet-50/70"
                      >
                        <span
                          className="absolute inset-y-0 left-0 rounded-xl bg-violet-50/70 transition group-hover:bg-violet-100/70"
                          style={{ width: `${percent}%` }}
                          aria-hidden="true"
                        />
                        <span className="relative flex items-center justify-between gap-4">
                          <span className="min-w-0">
                            <span className="block font-medium text-slate-800">{categoryName(key)}</span>
                            <span className="mt-0.5 block text-[11px] text-slate-400">See vehicles, visits and exact receipt lines</span>
                          </span>
                          <span className="flex shrink-0 items-center gap-2">
                            <span className="font-semibold text-slate-900">{formatCurrency(Number(amount) / 100, language)}</span>
                            <ChevronRight className="h-4 w-4 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-violet-600" />
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <h3 className="font-semibold text-slate-900">
                  Monthly maintenance spend
                </h3>
                <div className="mt-3 divide-y divide-slate-100">
                  {monthlyTotals.map(([month, amount]) => {
                    const percent = Math.max(4, Math.round((Number(amount) / maxMonthlyTotal) * 100));
                    return (
                      <button
                        key={month}
                        type="button"
                        onClick={() => setInsightModal({ type: "month", key: month })}
                        className="group relative w-full overflow-hidden rounded-xl px-3 py-3 text-left transition hover:bg-sky-50/70"
                      >
                        <span
                          className="absolute inset-y-0 left-0 rounded-xl bg-sky-50/70 transition group-hover:bg-sky-100/70"
                          style={{ width: `${percent}%` }}
                          aria-hidden="true"
                        />
                        <span className="relative flex items-center justify-between gap-4">
                          <span className="min-w-0">
                            <span className="block font-medium text-slate-700">{formatMonthLabel(month, language)}</span>
                            <span className="mt-0.5 block text-[11px] text-slate-400">See every maintenance visit in this month</span>
                          </span>
                          <span className="flex shrink-0 items-center gap-2">
                            <span className="font-semibold text-slate-900">{formatCurrency(Number(amount) / 100, language)}</span>
                            <ChevronRight className="h-4 w-4 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-violet-600" />
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* PATTERNS */}
          {tab === "patterns" && (
            <div className="m-5 rounded-2xl border border-slate-200 bg-white p-4 sm:m-6">
              <h3 className="font-semibold text-slate-900">
                Repeated repair patterns
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                Click a repeated item to see which vehicles and visits it came from.
              </p>
              <div className="mt-3 divide-y divide-slate-100">
                {repeatTotals.length ? (
                  repeatTotals.map(([key, count]) => {
                    const percent = Math.max(5, Math.round((Number(count) / maxRepeatCount) * 100));
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setInsightModal({ type: "pattern", key })}
                        className="group relative w-full overflow-hidden rounded-xl px-3 py-3 text-left transition hover:bg-violet-50/70"
                      >
                        <span
                          className="absolute inset-y-0 left-0 rounded-xl bg-violet-50/60 transition group-hover:bg-violet-100/70"
                          style={{ width: `${percent}%` }}
                          aria-hidden="true"
                        />
                        <span className="relative flex items-center justify-between gap-4">
                          <span className="min-w-0">
                            <span className="block font-medium text-slate-800">{key}</span>
                            <span className="mt-0.5 block text-[11px] text-slate-400">See which vehicles needed this repair</span>
                          </span>
                          <span className="flex shrink-0 items-center gap-2">
                            <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-violet-700 shadow-sm ring-1 ring-violet-100">
                              Repeated × {count}
                            </span>
                            <ChevronRight className="h-4 w-4 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-violet-600" />
                          </span>
                        </span>
                      </button>
                    );
                  })
                ) : (
                  <p className="py-6 text-sm text-slate-500">
                    No repeated repair patterns in this reporting period.
                  </p>
                )}
              </div>
            </div>
          )}
        </section>
      )}

      {/* VEHICLE ANALYTICS MODAL */}
      {selectedRow && (
        <div
          className="fixed inset-0 z-[115] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[2px]"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSelectedVehicle("");
          }}
        >
          <section className="flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-violet-100 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.28)]">
            <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 sm:px-6">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.13em] text-violet-600">
                  Vehicle analytics
                </p>
                <h3 className="mt-1 text-xl font-bold text-slate-950">
                  {selectedRow.vehicle.vehicle_reg} · {maintenanceVehicleType(
                    selectedRow.vehicle.vehicle_type,
                    t.weeklyMileage.oil.vehicleTypes
                  )}
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  Maintenance activity for the selected reporting period.
                </p>
              </div>

              <button
                type="button"
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-slate-500 hover:bg-violet-50 hover:text-violet-700"
                onClick={() => setSelectedVehicle("")}
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/60 p-5 sm:p-6">
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                <div className="grid gap-px bg-slate-100 sm:grid-cols-2 lg:grid-cols-4">
                  {[
                    ["Spend", formatCurrency(selectedRow.total, language), CircleDollarSign],
                    ["Visits", String(selectedRow.visits), Wrench],
                    ["Maintenance items", String(selectedRow.itemCount), Repeat2],
                    [
                      "Last service",
                      lastServiceDateByVehicle.get(selectedRow.vehicle.id)
                        ? formatDate(lastServiceDateByVehicle.get(selectedRow.vehicle.id)!, language)
                        : "—",
                      CalendarDays,
                    ],
                  ].map(([label, value, Icon]) => {
                    const MetricIcon = Icon as typeof CircleDollarSign;
                    return (
                      <div key={String(label)} className="bg-white p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">{String(label)}</p>
                            <p className="mt-1 text-lg font-semibold text-slate-950">{String(value)}</p>
                          </div>
                          <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-violet-50 text-violet-700">
                            <MetricIcon className="h-4 w-4" />
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="mt-4 grid items-start gap-4 lg:grid-cols-[1fr_1fr_1.15fr]">
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="mb-2 flex items-center gap-2"><span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-violet-50 text-violet-700"><BarChart3 className="h-4 w-4" /></span><h4 className="font-semibold text-slate-900">Category breakdown</h4></div>
                  <div className="mt-2 divide-y divide-slate-100">
                    {Object.entries(selectedRow.byCategory)
                      .sort((a, b) => Number(b[1]) - Number(a[1]))
                      .map(([key, value]) => (
                        <div key={key} className="flex justify-between gap-3 py-2.5 text-sm">
                          <span className="text-slate-700">{categoryName(key)}</span>
                          <span className="font-semibold text-slate-900">{formatCurrency(Number(value) / 100, language)}</span>
                        </div>
                      ))}
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="mb-2 flex items-center gap-2"><span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-sky-50 text-sky-700"><CalendarDays className="h-4 w-4" /></span><h4 className="font-semibold text-slate-900">Monthly maintenance spend</h4></div>
                  <div className="mt-2 divide-y divide-slate-100">
                    {Object.entries(selectedRow.monthly)
                      .sort((a, b) => b[0].localeCompare(a[0]))
                      .map(([key, value]) => (
                        <div key={key} className="flex justify-between gap-3 py-2.5 text-sm">
                          <span className="text-slate-700">{formatMonthLabel(key, language)}</span>
                          <span className="font-semibold text-slate-900">{formatCurrency(Number(value) / 100, language)}</span>
                        </div>
                      ))}
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="mb-2 flex items-center gap-2"><span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-amber-50 text-amber-700"><Repeat2 className="h-4 w-4" /></span><h4 className="font-semibold text-slate-900">Repeated repairs</h4></div>
                  <div className="mt-2 divide-y divide-slate-100">
                    {Object.entries(selectedRow.repeats)
                      .filter(([name]) => {
                        const normalized = name.trim().toLowerCase();
                        return normalized !== "labour" && normalized !== "labor";
                      })
                      .sort((a, b) => Number(b[1]) - Number(a[1]))
                      .slice(0, 10)
                      .map(([key, value]) => (
                        <div key={key} className="flex justify-between gap-3 py-2.5 text-sm">
                          <span className="break-words text-slate-700">{key}</span>
                          <span className="rounded-full bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-700">× {value}</span>
                        </div>
                      ))}
                  </div>
                </div>
              </div>
            </div>

            <footer className="flex items-center justify-end gap-2 border-t border-slate-100 bg-white px-5 py-4 sm:px-6">
              <Link
                className="btn-secondary"
                href={`/maintenance?vehicle=${selectedRow.vehicle.id}`}
              >
                Open maintenance history
              </Link>
              <button type="button" className="btn-secondary" onClick={() => setSelectedVehicle("")}>
                Close
              </button>
            </footer>
          </section>
        </div>
      )}

      {/* DRILL-DOWN MODAL */}
      {insightModal && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[2px]"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setInsightModal(null);
          }}
        >
          <section className="flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-violet-100 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.28)]">
            <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 sm:px-6">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.13em] text-violet-600">
                  {insightModal.type === "category"
                    ? "Spending breakdown"
                    : insightModal.type === "month"
                    ? "Monthly spend breakdown"
                    : "Repeated repair breakdown"}
                </p>
                <h3 className="mt-1 text-xl font-bold text-slate-950">
                  {insightModal.type === "category"
                    ? categoryName(insightModal.key)
                    : insightModal.type === "month"
                    ? formatMonthLabel(insightModal.key, language)
                    : insightModal.key}
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  {insightModal.type === "pattern"
                    ? `${modalOccurrences} matching occurrence${modalOccurrences === 1 ? "" : "s"} across ${modalRecords.length} visit${modalRecords.length === 1 ? "" : "s"}`
                    : `${modalRecords.length} maintenance visit${modalRecords.length === 1 ? "" : "s"}`}
                  {" · "}{formatCurrency(modalTotal, language)}
                </p>
              </div>

              <button
                type="button"
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-slate-500 hover:bg-violet-50 hover:text-violet-700"
                onClick={() => setInsightModal(null)}
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/60 p-5 sm:p-6">
              <div className="mb-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="grid gap-px bg-slate-100 sm:grid-cols-3">
                  <div className="bg-white p-4">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">Affected vehicles</p>
                    <p className="mt-1 text-lg font-semibold text-slate-950">{modalVehicleCount}</p>
                  </div>
                  <div className="bg-white p-4">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                      {insightModal.type === "pattern" ? "Matching occurrences" : "Maintenance visits"}
                    </p>
                    <p className="mt-1 text-lg font-semibold text-slate-950">
                      {insightModal.type === "pattern" ? modalOccurrences : modalRecords.length}
                    </p>
                  </div>
                  <div className="bg-white p-4">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">Matching spend</p>
                    <p className="mt-1 text-lg font-semibold text-violet-700">{formatCurrency(modalTotal, language)}</p>
                  </div>
                </div>
              </div>

              <div className="mb-4 rounded-2xl border border-violet-100 bg-violet-50/60 px-4 py-3 text-sm text-slate-600">
                {insightModal.type === "category" && (
                  <>This shows the exact maintenance lines currently classified as <strong className="text-slate-900">{categoryName(insightModal.key)}</strong>. If a line looks too vague, that item can be recategorised later without changing the receipt total.</>
                )}
                {insightModal.type === "month" && (
                  <>This shows the maintenance visits that created the spend for <strong className="text-slate-900">{insightModal.key}</strong>.</>
                )}
                {insightModal.type === "pattern" && (
                  <>This shows only receipt lines that match <strong className="text-slate-900">{insightModal.key}</strong>, so the repeat count and the source visits can be checked together.</>
                )}
              </div>
              <div className="space-y-3">
                {modalRecords.length ? (
                  modalRecords.map(({ record, vehicle, matchedItems, matchedTotal }) => (
                    <div
                      key={record.id}
                      className="rounded-2xl border border-slate-200 bg-white p-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h4 className="text-lg font-semibold text-slate-950">
                            {vehicle?.vehicle_reg ?? "—"}
                          </h4>
                          <p className="mt-0.5 text-sm text-slate-500">
                            {formatDate(record.service_date, language)} ·{" "}
                            {record.garage || "—"}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-slate-400">
                            Matching spend
                          </p>
                          <p className="mt-1 font-semibold text-violet-800">
                            {formatCurrency(matchedTotal, language)}
                          </p>
                        </div>
                      </div>

                      <div className="mt-3 overflow-hidden rounded-xl border border-slate-100">
                        {matchedItems.map((item) => {
                          const lineTotal =
                            item.line_total === null || item.line_total === undefined
                              ? Number(item.quantity ?? 0) * Number(item.unit_price ?? 0)
                              : Number(item.line_total);
                          return (
                            <div key={item.id} className="flex items-center justify-between gap-4 border-b border-slate-100 px-3 py-2.5 text-sm last:border-b-0">
                              <div className="min-w-0">
                                <p className="font-medium text-slate-800">{maintenanceItemLabel(item)}</p>
                                <p className="mt-0.5 text-xs text-slate-500">
                                  Qty {Number(item.quantity ?? 0).toLocaleString()}
                                  {item.unit_price !== null && item.unit_price !== undefined ? ` · ${formatCurrency(Number(item.unit_price), language)} each` : ""}
                                  {` · ${categoryName(String(item.category ?? ""))}`}
                                </p>
                              </div>
                              <span className="shrink-0 font-semibold text-slate-900">{formatCurrency(lineTotal, language)}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
                    No matching maintenance visits were found in the selected period.
                  </p>
                )}
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
