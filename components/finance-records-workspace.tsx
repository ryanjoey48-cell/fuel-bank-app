"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { downloadCsv } from "@/components/finance-arrange-stage";
import FinanceRecordDetail, { type RecordSelection, type ReopenOutcome } from "@/components/finance-record-detail";
import { useFinanceFixture } from "@/components/finance-fixture-provider";
import { FinanceStatusChip, SimulatedTrnBadge } from "@/components/finance-status-chip";
import { satangToThb } from "@/lib/finance-demo-centre";
import { formatDocDate, formatThb } from "@/lib/finance-display";
import { isFinanceFixtureMode } from "@/lib/finance-fixture-mode";
import { canViewFinanceActivity, financeActionActor } from "@/lib/finance-intake-access";
import { useLanguage } from "@/lib/language-provider";
import {
  EMPTY_RECORD_FILTERS, RECORD_STATUSES, buildFinanceRecords, filterBatches, filterWorkOrders, monthLabel, recordFacets, summarizeRecords,
  type BatchMatch, type BatchRecord, type RecordFilters, type RecordStatus, type WorkOrderRecord
} from "@/lib/finance-records";
import { financeRecordsCopy } from "@/lib/finance-records-copy";
import {
  BATCH_COLUMNS, WORK_ORDER_COLUMNS, buildCurrentTableExport, buildCustomerHistory, buildMonthlyStatement, buildTrnRegister, buildWorkOrderReport, tableToCsvRows, tableToWorkbook,
  type BatchColumnId, type ExportContext, type ExportKind, type ExportTable, type WorkOrderColumnId
} from "@/lib/finance-records-export";
import { safeLocalStorage } from "@/lib/safe-browser-storage";
import { useAccountAccess } from "@/lib/use-account-access";

type View = "workOrders" | "batches";
type SortState = { key: string; dir: "asc" | "desc" } | null;
const PAGE = 150;
const PREFS_KEY = "ees.finance.records.prefs.v1";
const money = (satang: number | null) => formatThb(satangToThb(satang));
const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

function compareValues(a: string | number | null, b: string | number | null, dir: "asc" | "desc") {
  if (a === null && b === null) return 0;
  if (a === null) return 1; // blanks always last
  if (b === null) return -1;
  const result = typeof a === "number" && typeof b === "number" ? a - b : natural(String(a), String(b));
  return dir === "asc" ? result : -result;
}
function workOrderSortValue(record: WorkOrderRecord, id: WorkOrderColumnId): string | number | null {
  switch (id) {
    case "workOrder": return record.workOrder;
    case "customerJob": return record.customerJobNumber || null;
    case "date": return record.date;
    case "customer": return record.client;
    case "pickup": return record.pickup;
    case "delivery": return record.delivery;
    case "vehicle": return record.vehicle;
    case "driver": return record.driver;
    case "transport": return record.transportSatang;
    case "parking": return record.parkingSatang;
    case "tolls": return record.tollSatang;
    case "other": return record.otherSatang;
    case "total": return record.totalSatang;
    case "trn": return record.trn;
    case "period": return record.billingPeriod;
    case "status": return RECORD_STATUSES.indexOf(record.status);
  }
}
function batchSortValue(batch: BatchRecord, id: BatchColumnId): string | number | null {
  switch (id) {
    case "trn": return batch.trn;
    case "customer": return batch.client;
    case "period": return batch.periodStart;
    case "workOrders": return batch.workOrderCount;
    case "transport": return batch.transportSatang;
    case "parking": return batch.parkingSatang;
    case "tolls": return batch.tollSatang;
    case "other": return batch.otherSatang;
    case "total": return batch.totalSatang;
    case "status": return RECORD_STATUSES.indexOf(batch.status);
    case "created": return batch.createdAt;
  }
}
const sumOf = (rows: WorkOrderRecord[], pick: (row: WorkOrderRecord) => number | null) => rows.reduce((sum, row) => sum + (pick(row) ?? 0), 0);

type Prefs = { view?: View; woColumns?: string[]; batchColumns?: string[] };
function readPrefs(): Prefs {
  try { return JSON.parse(safeLocalStorage.getItem(PREFS_KEY) || "{}") as Prefs; } catch { return {}; }
}
function writePrefs(prefs: Prefs) {
  try { safeLocalStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* storage unavailable: preferences just are not remembered */ }
}

async function downloadXlsx(table: ExportTable) {
  const XLSX = await import("xlsx");
  const workbook = tableToWorkbook(XLSX as unknown as Parameters<typeof tableToWorkbook>[0], table);
  const data = XLSX.write(workbook as import("xlsx").WorkBook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  const url = URL.createObjectURL(new Blob([data], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${table.fileBase}.xlsx`;
  link.click();
  URL.revokeObjectURL(url);
}

export default function FinanceRecordsWorkspace() {
  const { language } = useLanguage();
  const copy = financeRecordsCopy[language];
  const { access } = useAccountAccess();
  const { workspaces, activeWorkspace, role, dispatch, hydrateReady, persistStatus } = useFinanceFixture();
  const params = useSearchParams();
  const owner = workspaces.owner;

  const [view, setView] = useState<View>(() => (params.get("view") === "batches" ? "batches" : "workOrders"));
  const [filters, setFilters] = useState<RecordFilters>(() => ({
    ...EMPTY_RECORD_FILTERS,
    search: params.get("q") ?? "", client: params.get("customer") ?? "", month: params.get("month") ?? "",
    dateFrom: params.get("from") ?? "", dateTo: params.get("to") ?? "", status: (params.get("status") as RecordFilters["status"]) ?? ""
  }));
  const [sort, setSort] = useState<SortState>(null);
  const [woColumns, setWoColumns] = useState<WorkOrderColumnId[]>(() => WORK_ORDER_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.id));
  const [batchColumns, setBatchColumns] = useState<BatchColumnId[]>(() => BATCH_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.id));
  const [limit, setLimit] = useState(PAGE);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selection, setSelection] = useState<RecordSelection | null>(null);
  const [menu, setMenu] = useState<"export" | "columns" | null>(null);
  const [statementMonth, setStatementMonth] = useState("");
  const [notice, setNotice] = useState("");
  const openerRef = useRef<HTMLElement | null>(null);
  const prefsLoaded = useRef(false);

  // Remembered view + visible columns (per browser); URL parameters win for the view.
  useEffect(() => {
    const prefs = readPrefs();
    if (!params.get("view") && prefs.view) setView(prefs.view);
    const keep = <T extends string>(saved: string[] | undefined, all: { id: T }[], fallback: T[]) => {
      const ids = (saved ?? []).filter((id): id is T => all.some((c) => c.id === id));
      return ids.length ? ids : fallback;
    };
    setWoColumns((current) => keep(prefs.woColumns, WORK_ORDER_COLUMNS, current));
    setBatchColumns((current) => keep(prefs.batchColumns, BATCH_COLUMNS, current));
    prefsLoaded.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read once on mount
  }, []);
  useEffect(() => { if (prefsLoaded.current) writePrefs({ view, woColumns, batchColumns }); }, [view, woColumns, batchColumns]);

  // Deep links: ?batch=SHEET-3 or ?job=<id> open that record's detail once the saved records are loaded.
  const deepLinked = useRef(false);
  useEffect(() => {
    if (!hydrateReady || deepLinked.current) return;
    const batch = params.get("batch");
    const job = params.get("job");
    if (batch && (owner.billingSheets || []).some((sheet) => sheet.id === batch)) setSelection({ type: "batch", id: batch });
    else if (job && owner.bookings.some((item) => item.id === job)) setSelection({ type: "work_order", id: job });
    deepLinked.current = true;
  }, [hydrateReady, owner, params]);

  const records = useMemo(() => buildFinanceRecords(owner), [owner]);
  const baseWorkOrders = useMemo(() => [...records.workOrders].sort((a, b) => b.date.localeCompare(a.date) || natural(a.workOrder, b.workOrder)), [records.workOrders]);
  const baseBatches = useMemo(() => [...records.batches].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [records.batches]);
  const facets = useMemo(() => recordFacets(records.workOrders), [records.workOrders]);

  const filteredWorkOrders = useMemo(() => {
    const list = filterWorkOrders(baseWorkOrders, filters);
    if (view !== "workOrders" || !sort) return list;
    const id = sort.key as WorkOrderColumnId;
    return [...list].sort((a, b) => compareValues(workOrderSortValue(a, id), workOrderSortValue(b, id), sort.dir));
  }, [baseWorkOrders, filters, sort, view]);
  const matches = useMemo(() => {
    const list = filterBatches(baseBatches, filters);
    if (view !== "batches" || !sort) return list;
    const id = sort.key as BatchColumnId;
    return [...list].sort((a, b) => compareValues(batchSortValue(a.batch, id), batchSortValue(b.batch, id), sort.dir));
  }, [baseBatches, filters, sort, view]);
  const kpis = useMemo(() => summarizeRecords(filterWorkOrders(baseWorkOrders, filters), filterBatches(baseBatches, filters)), [baseWorkOrders, baseBatches, filters]);

  const nothingAtAll = !records.workOrders.length && !records.batches.length;
  const rowCount = view === "workOrders" ? filteredWorkOrders.length : matches.length;
  const totalCount = view === "workOrders" ? records.workOrders.length : records.batches.length;
  const filtersActive = JSON.stringify(filters) !== JSON.stringify(EMPTY_RECORD_FILTERS);
  const setFilter = <K extends keyof RecordFilters>(key: K, value: RecordFilters[K]) => { setFilters((current) => ({ ...current, [key]: value })); setLimit(PAGE); };
  const switchView = (next: View) => { setView(next); setSort(null); setLimit(PAGE); setMenu(null); if (next === "batches" && filters.status === "not_batched") setFilter("status", ""); };
  const toggleSort = (key: string) => setSort((current) => (current?.key === key ? (current.dir === "asc" ? { key, dir: "desc" } : null) : { key, dir: "asc" }));
  const sortMark = (key: string) => (sort?.key === key ? (sort.dir === "asc" ? "▲" : "▼") : "");
  const ariaSort = (key: string) => (sort?.key === key ? (sort.dir === "asc" ? "ascending" : "descending") : "none") as "ascending" | "descending" | "none";

  const open = useCallback((next: RecordSelection, opener?: HTMLElement | null) => { openerRef.current = opener ?? (document.activeElement as HTMLElement | null); setSelection(next); }, []);
  const close = useCallback(() => { setSelection(null); window.setTimeout(() => openerRef.current?.focus?.(), 0); }, []);

  const actor = financeActionActor(access, role, isFinanceFixtureMode(), "sheet_reopen");
  const canReopen = actor === "admin" || actor === "finance" || actor === "super_admin";
  const canViewActivity = canViewFinanceActivity(access, role, isFinanceFixtureMode());
  const onReopen = (sheetId: string, reason: string): ReopenOutcome => {
    if (activeWorkspace !== "owner") return "workspace";
    if (reason.trim().length < 3) return "reason";
    return dispatch({ type: "sheet_reopen", sheetId, reason }) ? "ok" : "blocked";
  };

  // ───────────── exports ─────────────
  const exportContext = (): ExportContext => ({
    copy, language, filters, view, workOrderColumns: woColumns, batchColumns,
    clientName: (id) => facets.clients.find((item) => item.id === id)?.name ?? id
  });
  const monthsInView = useMemo(() => recordFacets(filteredWorkOrders).months, [filteredWorkOrders]);
  const effectiveStatementMonth = statementMonth || filters.month || (filters.dateFrom ? filters.dateFrom.slice(0, 7) : monthsInView[0] ?? "");
  const buildExport = (kind: ExportKind): ExportTable | null => {
    const ctx = exportContext();
    const workOrders = filterWorkOrders(baseWorkOrders, filters);
    switch (kind) {
      case "current": return buildCurrentTableExport(ctx, view === "workOrders" ? filteredWorkOrders : [], matches);
      case "work_orders": return buildWorkOrderReport(ctx, workOrders);
      case "trn_register": return buildTrnRegister(ctx, filterBatches(baseBatches, filters));
      case "customer_history": return buildCustomerHistory(ctx, workOrders);
      case "monthly_statement": return effectiveStatementMonth ? buildMonthlyStatement(ctx, workOrders, effectiveStatementMonth) : null;
    }
  };
  const runExport = async (kind: ExportKind, format: "csv" | "xlsx") => {
    const table = buildExport(kind);
    if (!table || !table.rows.length) { setNotice(copy.export.empty); return; }
    setNotice("");
    if (format === "csv") downloadCsv(tableToCsvRows(table).map((row) => row.map(String)), `${table.fileBase}.csv`);
    else await downloadXlsx(table);
    setMenu(null);
  };
  const downloadBatchCsv = (batch: BatchRecord) => {
    const ctx: ExportContext = { ...exportContext(), filters: EMPTY_RECORD_FILTERS };
    const table = buildWorkOrderReport(ctx, batch.workOrders);
    downloadCsv(tableToCsvRows(table).map((row) => row.map(String)), `${table.hasDraft ? "DRAFT-" : ""}EES-batch-${batch.trn.replace(/[^A-Za-z0-9._-]+/g, "-")}.csv`);
  };

  // ───────────── view pieces ─────────────
  const visibleWoColumns = WORK_ORDER_COLUMNS.filter((column) => woColumns.includes(column.id));
  const visibleBatchColumns = BATCH_COLUMNS.filter((column) => batchColumns.includes(column.id));
  const toggleColumn = (id: string) => {
    if (view === "workOrders") setWoColumns((current) => (id === "workOrder" ? current : current.includes(id as WorkOrderColumnId) ? current.filter((item) => item !== id) : [...current, id as WorkOrderColumnId]));
    else setBatchColumns((current) => (id === "trn" ? current : current.includes(id as BatchColumnId) ? current.filter((item) => item !== id) : [...current, id as BatchColumnId]));
  };
  const resetColumns = () => {
    setWoColumns(WORK_ORDER_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.id));
    setBatchColumns(BATCH_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.id));
  };

  const trnCell = (trn: string | null, simulated: boolean) => (trn ? <span className="font-bold tabular-nums">{trn}{simulated ? <SimulatedTrnBadge language={language} /> : null}</span> : <span className="text-slate-400">—</span>);
  const workOrderCellNode = (record: WorkOrderRecord, id: WorkOrderColumnId) => {
    switch (id) {
      case "workOrder": return <span className="text-base font-black text-slate-950">{record.workOrder}</span>;
      case "customerJob": return record.customerJobNumber || <span className="text-slate-400">—</span>;
      case "date": return <span className="tabular-nums">{formatDocDate(record.date)}</span>;
      case "customer": return <span className="font-semibold">{record.client}</span>;
      case "pickup": return <span className="block max-w-[6.5rem] truncate" title={record.pickup}>{record.pickup || "—"}</span>;
      case "delivery": return <span className="block max-w-[6.5rem] truncate" title={record.delivery}>{record.delivery || "—"}</span>;
      case "vehicle": return <span className="whitespace-nowrap font-bold">{record.vehicle || "—"}</span>;
      case "driver": return record.driver || "—";
      case "transport": return money(record.transportSatang);
      case "parking": return money(record.parkingSatang);
      case "tolls": return money(record.tollSatang);
      case "other": return money(record.otherSatang);
      case "total": return <strong>{money(record.totalSatang)}</strong>;
      case "trn": return trnCell(record.trn, record.trnSimulated);
      case "period": return <span className="whitespace-nowrap">{record.billingPeriod ?? "—"}</span>;
      case "status": return <FinanceStatusChip status={record.status} language={language} />;
    }
  };
  const batchCellNode = (batch: BatchRecord, id: BatchColumnId) => {
    switch (id) {
      case "trn": return <span className="text-base">{trnCell(batch.trn, batch.trnSimulated)}</span>;
      case "customer": return <span className="font-semibold">{batch.client}</span>;
      case "period": return <span className="whitespace-nowrap">{batch.billingPeriod}</span>;
      case "workOrders": return batch.workOrderCount;
      case "transport": return money(batch.transportSatang);
      case "parking": return money(batch.parkingSatang);
      case "tolls": return money(batch.tollSatang);
      case "other": return money(batch.otherSatang);
      case "total": return <strong>{money(batch.totalSatang)}</strong>;
      case "status": return <FinanceStatusChip status={batch.status} language={language} />;
      case "created": return <span className="tabular-nums">{formatDocDate(batch.createdAt.slice(0, 10))}</span>;
    }
  };
  const headLabel = (id: string) => copy.columns[id as keyof typeof copy.columns] ?? id;
  const headShort = (id: string) => copy.columnsShort[id as keyof typeof copy.columnsShort] ?? headLabel(id);
  const isMoney = (id: string) => ["transport", "parking", "tolls", "other", "total"].includes(id);

  const toolbarField = "min-w-0";
  const selectedId = selection ? selection.id : "";

  return (
    <main className="finance-records-workspace ees-fc ees-fc-shell w-full min-w-0 max-w-full space-y-3 text-slate-900" data-testid="finance-records">
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;500;600;700;800&display=swap" precedence="default" />
      <header className="ees-fc-header">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-slate-950">{copy.title}</h1>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <p className="max-w-[36rem] rounded-xl bg-orange-50 px-3 py-1 text-xs font-semibold leading-snug text-orange-900 ring-1 ring-orange-200" data-testid="records-local-banner" data-persist={persistStatus}>{copy.localBanner}</p>
          <Link className="ees-fc-btn-secondary !py-1.5" href="/finance-centre">← {copy.backToFinance}</Link>
        </div>
      </header>

      <section className="ees-fc-card space-y-2 p-3">
        <div className="flex flex-wrap items-end gap-2">
          <div role="tablist" aria-label={copy.views.label} className="inline-flex rounded-xl bg-slate-100 p-1">
            {(["workOrders", "batches"] as View[]).map((id) => (
              <button key={id} role="tab" type="button" aria-selected={view === id} data-testid={`view-${id}`} onClick={() => switchView(id)}
                className={`rounded-lg px-3 py-1.5 text-sm font-bold transition ${view === id ? "bg-white text-violet-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}>{copy.views[id]}</button>
            ))}
          </div>
          <label className="min-w-[14rem] flex-1">
            <span className="ees-fc-label">{copy.search.label}</span>
            <input type="search" className="ees-fc-input mt-0.5" data-testid="records-search" value={filters.search} placeholder={copy.search.placeholder} onChange={(event) => setFilter("search", event.target.value)} />
          </label>
          <div className="relative">
            <button type="button" className="ees-fc-btn-secondary !py-2" aria-haspopup="menu" aria-expanded={menu === "columns"} onClick={() => setMenu(menu === "columns" ? null : "columns")}>{copy.columnsMenu.label} ▾</button>
            {menu === "columns" ? (
              <div role="menu" className="absolute right-0 z-40 mt-1 w-60 rounded-xl bg-white p-2 shadow-xl ring-1 ring-slate-200">
                {(view === "workOrders" ? WORK_ORDER_COLUMNS : BATCH_COLUMNS).map((column, index) => {
                  const locked = index === 0;
                  const checked = view === "workOrders" ? woColumns.includes(column.id as WorkOrderColumnId) : batchColumns.includes(column.id as BatchColumnId);
                  return (
                    <label key={column.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50">
                      <input type="checkbox" checked={checked} disabled={locked} onChange={() => toggleColumn(column.id)} className="h-4 w-4 accent-violet-700" />
                      {headLabel(column.id)}
                    </label>
                  );
                })}
                <button type="button" className="mt-1 w-full rounded-lg px-2 py-1.5 text-left text-sm font-semibold text-violet-800 hover:bg-slate-50" onClick={resetColumns}>{copy.columnsMenu.reset}</button>
              </div>
            ) : null}
          </div>
          <div className="relative">
            <button type="button" className="ees-fc-btn-primary !py-2" data-testid="export-button" aria-haspopup="menu" aria-expanded={menu === "export"} onClick={() => setMenu(menu === "export" ? null : "export")}>{copy.export.button} ▾</button>
            {menu === "export" ? (
              <div role="menu" className="absolute right-0 z-40 mt-1 w-[22rem] rounded-xl bg-white p-3 shadow-xl ring-1 ring-slate-200" data-testid="export-menu">
                <p className="mb-2 text-xs font-bold text-slate-500">{copy.export.title}</p>
                <ul className="space-y-1">
                  {([["current", copy.export.currentTable], ["work_orders", copy.export.workOrderReport], ["trn_register", copy.export.trnRegister], ["customer_history", copy.export.customerHistory], ["monthly_statement", copy.export.monthlyStatement]] as [ExportKind, string][]).map(([kind, label]) => (
                    <li key={kind} className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-slate-800">{label}</span>
                      <span className="flex gap-1">
                        <button type="button" className="ees-fc-btn-secondary !px-2.5 !py-1 !text-sm" data-testid={`export-${kind}-csv`} onClick={() => void runExport(kind, "csv")}>{copy.export.csv}</button>
                        <button type="button" className="ees-fc-btn-secondary !px-2.5 !py-1 !text-sm" data-testid={`export-${kind}-xlsx`} onClick={() => void runExport(kind, "xlsx")}>{copy.export.excel}</button>
                      </span>
                    </li>
                  ))}
                </ul>
                <label className="mt-2 block text-xs font-bold text-slate-500">{copy.export.month}
                  <select className="ees-fc-input mt-0.5" value={effectiveStatementMonth} onChange={(event) => setStatementMonth(event.target.value)} data-testid="statement-month">
                    <option value="">{copy.export.noMonth}</option>
                    {facets.months.map((month) => <option key={month} value={month}>{monthLabel(month, language)}</option>)}
                  </select>
                </label>
              </div>
            ) : null}
          </div>
        </div>

        <div className="grid grid-cols-2 items-end gap-2 sm:grid-cols-4 lg:grid-cols-[repeat(7,minmax(0,1fr))_auto]">
          <label className={toolbarField}><span className="ees-fc-label">{copy.filters.dateFrom}</span>
            <input type="date" className="ees-fc-input mt-0.5" data-testid="filter-from" value={filters.dateFrom} max={filters.dateTo || undefined} onChange={(event) => setFilter("dateFrom", event.target.value)} /></label>
          <label className={toolbarField}><span className="ees-fc-label">{copy.filters.dateTo}</span>
            <input type="date" className="ees-fc-input mt-0.5" data-testid="filter-to" value={filters.dateTo} min={filters.dateFrom || undefined} onChange={(event) => setFilter("dateTo", event.target.value)} /></label>
          <label className={toolbarField}><span className="ees-fc-label">{copy.filters.customer}</span>
            <select className="ees-fc-input mt-0.5" data-testid="filter-customer" value={filters.client} onChange={(event) => setFilter("client", event.target.value)}>
              <option value="">{copy.filters.allCustomers}</option>
              {facets.clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
            </select></label>
          <label className={toolbarField}><span className="ees-fc-label">{copy.filters.month}</span>
            <select className="ees-fc-input mt-0.5" data-testid="filter-month" value={filters.month} onChange={(event) => setFilter("month", event.target.value)}>
              <option value="">{copy.filters.allMonths}</option>
              {facets.months.map((month) => <option key={month} value={month}>{monthLabel(month, language)}</option>)}
            </select></label>
          <label className={toolbarField}><span className="ees-fc-label">{copy.filters.vehicle}</span>
            <select className="ees-fc-input mt-0.5" data-testid="filter-vehicle" value={filters.vehicle} onChange={(event) => setFilter("vehicle", event.target.value)}>
              <option value="">{copy.filters.allVehicles}</option>
              {facets.vehicles.map((plate) => <option key={plate} value={plate}>{plate}</option>)}
            </select></label>
          <label className={toolbarField}><span className="ees-fc-label">{copy.filters.driver}</span>
            <select className="ees-fc-input mt-0.5" data-testid="filter-driver" value={filters.driver} onChange={(event) => setFilter("driver", event.target.value)}>
              <option value="">{copy.filters.allDrivers}</option>
              {facets.drivers.map((name) => <option key={name} value={name}>{name}</option>)}
            </select></label>
          <label className={toolbarField}><span className="ees-fc-label">{copy.filters.status}</span>
            <select className="ees-fc-input mt-0.5" data-testid="filter-status" value={filters.status} onChange={(event) => setFilter("status", event.target.value as RecordFilters["status"])}>
              <option value="">{copy.filters.allStatuses}</option>
              {RECORD_STATUSES.filter((status) => status !== "awaiting_approval" && status !== "approved" && (view === "workOrders" || status !== "not_batched")).map((status: RecordStatus) => <option key={status} value={status}>{copy.status[status]}</option>)}
            </select></label>
          <button type="button" className="ees-fc-btn-secondary col-span-2 whitespace-nowrap !py-2 sm:col-span-1" data-testid="filter-clear" disabled={!filtersActive} onClick={() => { setFilters(EMPTY_RECORD_FILTERS); setLimit(PAGE); }}>{copy.filters.clear}</button>
        </div>
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-t border-slate-100 pt-2">
        <p className="flex flex-wrap items-center gap-x-3 text-xs text-slate-500" aria-live="polite">
          <span data-testid="records-count" className="font-semibold text-slate-700">{view === "workOrders" ? copy.count(rowCount, totalCount) : copy.countBatches(rowCount, totalCount)}</span>
          {view === "batches" && (filters.dateFrom || filters.dateTo || filters.month) ? <span>{copy.filters.batchDateHint}</span> : null}
          {notice ? <span role="alert" className="font-semibold text-rose-700">{notice}</span> : null}
        </p>
          <dl aria-label={copy.kpi.workOrders} className="ees-fc-kpis" data-testid="records-kpis">
          <div className="flex items-baseline gap-2"><dt>{copy.kpi.workOrders}</dt><dd data-testid="kpi-work-orders">{kpis.workOrders}</dd></div>
          <div className="flex items-baseline gap-2"><dt>{copy.kpi.draftBatches}</dt><dd data-testid="kpi-draft-batches">{kpis.draftBatches}</dd></div>
          <div className="flex items-baseline gap-2"><dt>{copy.kpi.awaitingApproval}</dt><dd data-testid="kpi-awaiting">{kpis.awaitingApproval}</dd></div>
          <div className="flex items-baseline gap-2"><dt>{copy.kpi.issuedTrns}</dt><dd data-testid="kpi-issued">{kpis.issuedTrns}</dd></div>
          <div className="flex items-baseline gap-2" title={copy.kpi.billedHint}><dt>{copy.kpi.billed}</dt><dd data-testid="kpi-billed">{money(kpis.billedSatang)}</dd></div>
          <div className="flex items-baseline gap-2" title={copy.kpi.billedHint}><dt>{copy.kpi.draftValue}</dt><dd data-testid="kpi-draft-value">{money(kpis.draftValueSatang)}</dd></div>
          <div className="flex items-baseline gap-2"><dt>{copy.kpi.attention}</dt><dd data-testid="kpi-attention" className={kpis.needsAttention ? "text-amber-700" : ""}>{kpis.needsAttention}</dd></div>
        </dl>
        </div>
      </section>

      {!hydrateReady ? (
        <div className="ees-fc-card space-y-2 p-4" aria-busy="true"><p className="text-sm text-slate-500">{copy.loading}</p>{[0, 1, 2, 3].map((i) => <div key={i} className="h-9 animate-pulse rounded-lg bg-slate-100" />)}</div>
      ) : nothingAtAll ? (
        <div className="ees-fc-card"><div className="ees-fc-empty" data-testid="records-empty">
          <p className="text-lg font-bold text-slate-900">{copy.empty.noneTitle}</p>
          <p className="max-w-md text-sm">{copy.empty.noneBody}</p>
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            <Link className="ees-fc-btn-primary !py-1.5" href="/finance-centre?section=reconciliation">{copy.empty.goIntake}</Link>
            <Link className="ees-fc-btn-secondary !py-1.5" href="/finance-centre?section=arrange">{copy.empty.goArrange}</Link>
          </div>
        </div></div>
      ) : rowCount === 0 ? (
        <div className="ees-fc-card"><div className="ees-fc-empty" data-testid="records-no-match">
          <p className="text-lg font-bold text-slate-900">{copy.empty.noMatchTitle}</p>
          <p className="max-w-md text-sm">{copy.empty.noMatchBody}</p>
          <button type="button" className="ees-fc-btn-secondary mt-2 !py-1.5" onClick={() => { setFilters(EMPTY_RECORD_FILTERS); setLimit(PAGE); }}>{copy.filters.clear}</button>
        </div></div>
      ) : view === "workOrders" ? (
        <div className="ees-fc-card max-h-[calc(100dvh-24.5rem)] min-h-[11rem] overflow-auto p-0" data-testid="records-table-wrap">
          <table className="ees-fc-table ees-fc-table--stick-first" data-testid="records-table">
            <thead><tr>{visibleWoColumns.map((column) => (
              <th key={column.id} scope="col" aria-sort={ariaSort(column.id)} className={column.money ? "num" : ""}>
                <button type="button" title={headLabel(column.id)} onClick={() => toggleSort(column.id)}>{headShort(column.id)} <span aria-hidden="true" className="text-[0.65rem]">{sortMark(column.id)}</span></button>
              </th>))}</tr></thead>
            <tbody>
              {filteredWorkOrders.slice(0, limit).map((record) => (
                <tr key={record.jobId} data-testid="records-row" data-wo={record.workOrder} data-clickable="" data-selected={selectedId === record.jobId ? "true" : "false"} tabIndex={0}
                  onClick={(event) => open({ type: "work_order", id: record.jobId }, event.currentTarget)}
                  onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open({ type: "work_order", id: record.jobId }, event.currentTarget); } }}>
                  {visibleWoColumns.map((column) => <td key={column.id} className={column.money ? "num" : ""}>{workOrderCellNode(record, column.id)}</td>)}
                </tr>
              ))}
            </tbody>
            <tfoot><tr>
              {visibleWoColumns.map((column, index) => {
                const pick = column.id === "transport" ? (r: WorkOrderRecord) => r.transportSatang : column.id === "parking" ? (r: WorkOrderRecord) => r.parkingSatang
                  : column.id === "tolls" ? (r: WorkOrderRecord) => r.tollSatang : column.id === "other" ? (r: WorkOrderRecord) => r.otherSatang : column.id === "total" ? (r: WorkOrderRecord) => r.totalSatang : null;
                return <td key={column.id} className={column.money ? "num" : ""} data-testid={pick ? `foot-${column.id}` : undefined}>{index === 0 ? `${copy.export.grandTotal} (${filteredWorkOrders.length})` : pick ? money(sumOf(filteredWorkOrders, pick)) : ""}</td>;
              })}
            </tr></tfoot>
          </table>
          {filteredWorkOrders.length > limit ? <button type="button" className="w-full py-2 text-sm font-semibold text-violet-800" onClick={() => setLimit((value) => value + PAGE)}>{copy.pageSize.more(filteredWorkOrders.length - limit)}</button> : null}
        </div>
      ) : (
        <div className="ees-fc-card max-h-[calc(100dvh-24.5rem)] min-h-[11rem] overflow-auto p-0" data-testid="records-table-wrap">
          <table className="ees-fc-table" data-testid="records-table">
            <thead><tr>
              <th scope="col" className="w-8"><span className="sr-only">{copy.columns.workOrders}</span></th>
              {visibleBatchColumns.map((column) => (
                <th key={column.id} scope="col" aria-sort={ariaSort(column.id)} className={column.money ? "num" : ""}>
                  <button type="button" title={headLabel(column.id)} onClick={() => toggleSort(column.id)}>{headShort(column.id)} <span aria-hidden="true" className="text-[0.65rem]">{sortMark(column.id)}</span></button>
                </th>))}
              <th scope="col"><span className="sr-only">{copy.columns.open}</span></th>
            </tr></thead>
            <tbody>
              {matches.slice(0, limit).map(({ batch, matched }: BatchMatch) => {
                const isOpen = expanded.has(batch.sheetId);
                return (
                  <Fragment key={batch.sheetId}>
                    <tr data-testid="records-row" data-trn={batch.trn} data-clickable="" data-selected={selectedId === batch.sheetId ? "true" : "false"} tabIndex={0}
                      onClick={(event) => open({ type: "batch", id: batch.sheetId }, event.currentTarget)}
                      onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); open({ type: "batch", id: batch.sheetId }, event.currentTarget); } }}>
                      <td>
                        <button type="button" aria-expanded={isOpen} aria-label={copy.columns.workOrders} data-testid="batch-expand" className="ees-fc-icon-btn !h-7 !w-7"
                          onClick={(event) => { event.stopPropagation(); setExpanded((current) => { const next = new Set(current); if (next.has(batch.sheetId)) next.delete(batch.sheetId); else next.add(batch.sheetId); return next; }); }}>{isOpen ? "▾" : "▸"}</button>
                      </td>
                      {visibleBatchColumns.map((column) => <td key={column.id} className={column.money ? "num" : ""}>{batchCellNode(batch, column.id)}</td>)}
                      <td className="num"><button type="button" className="ees-fc-btn-quiet !px-2 !py-1" onClick={(event) => { event.stopPropagation(); open({ type: "batch", id: batch.sheetId }, event.currentTarget); }}>{copy.columns.open} →</button></td>
                    </tr>
                    {isOpen ? (
                      <tr data-testid="batch-children"><td colSpan={visibleBatchColumns.length + 2} className="!bg-white !p-0">
                        <div className="border-l-4 border-violet-200 bg-violet-50/30 px-4 py-2">
                          {matched.length !== batch.workOrders.length ? <p className="mb-1 text-xs text-slate-500">{matched.length} / {batch.workOrders.length}</p> : null}
                          <table className="w-full text-sm">
                            <tbody>
                              {matched.map((record) => (
                                <tr key={record.jobId} className="cursor-pointer hover:bg-violet-50" data-testid="batch-child-row" data-wo={record.workOrder} onClick={(event) => open({ type: "work_order", id: record.jobId }, event.currentTarget)}>
                                  <td className="w-8 py-1 text-slate-500">{record.position}</td>
                                  <td className="py-1 pr-3 text-base font-black text-slate-950">{record.workOrder}</td>
                                  <td className="py-1 pr-3 tabular-nums">{formatDocDate(record.date)}</td>
                                  <td className="py-1 pr-3 font-bold">{record.vehicle}</td>
                                  <td className="max-w-[18rem] truncate py-1 pr-3 text-slate-600" title={`${record.pickup} → ${record.delivery}`}>{record.pickup} → {record.delivery}</td>
                                  <td className="num py-1 pr-3">{money(record.transportSatang)}</td>
                                  <td className="num py-1 pr-3">{money(record.parkingSatang)}</td>
                                  <td className="num py-1 pr-3">{money(record.tollSatang)}</td>
                                  <td className="num py-1 pr-3">{money(record.otherSatang)}</td>
                                  <td className="num py-1 font-bold">{money(record.totalSatang)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </td></tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
            <tfoot><tr>
              <td />
              {visibleBatchColumns.map((column, index) => {
                const value = column.id === "workOrders" ? matches.reduce((n, { batch }) => n + batch.workOrderCount, 0)
                  : column.id === "transport" ? money(matches.reduce((n, { batch }) => n + batch.transportSatang, 0))
                    : column.id === "parking" ? money(matches.reduce((n, { batch }) => n + batch.parkingSatang, 0))
                      : column.id === "tolls" ? money(matches.reduce((n, { batch }) => n + batch.tollSatang, 0))
                        : column.id === "other" ? money(matches.reduce((n, { batch }) => n + batch.otherSatang, 0))
                          : column.id === "total" ? money(matches.reduce((n, { batch }) => n + batch.totalSatang, 0)) : "";
                return <td key={column.id} className={column.money || column.id === "workOrders" ? "num" : ""} data-testid={`foot-${column.id}`}>{index === 0 ? `${copy.export.grandTotal} (${matches.length})` : value}</td>;
              })}
              <td />
            </tr></tfoot>
          </table>
          {matches.length > limit ? <button type="button" className="w-full py-2 text-sm font-semibold text-violet-800" onClick={() => setLimit((value) => value + PAGE)}>{copy.pageSize.more(matches.length - limit)}</button> : null}
        </div>
      )}

      {selection ? (
        <FinanceRecordDetail state={owner} selection={selection} language={language} canViewActivity={canViewActivity} canReopen={canReopen} workspaceOk={activeWorkspace === "owner"}
          onClose={close} onSelect={(next) => setSelection(next)} onReopen={onReopen} onDownloadBatchCsv={downloadBatchCsv} />
      ) : null}
    </main>
  );
}
