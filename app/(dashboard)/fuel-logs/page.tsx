"use client";

import {
  AlertTriangle,
  ArrowUpDown,
  Clock3,
  Download,
  Droplets,
  ReceiptText,
  Search,
  TrendingUp,
  Wallet
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/empty-state";
import { Header } from "@/components/header";
import { StatCard } from "@/components/stat-card";
import {
  FUEL_TYPE_KEYS,
  getFuelTypeLabel,
  getPaymentMethodLabel,
  normalizeFuelTypeKey,
  normalizePaymentMethodKey,
  PAYMENT_METHOD_KEYS
} from "@/lib/localized-values";
import {
  deleteFuelLog,
  fetchDrivers,
  fetchFuelLogComparisonEntry,
  fetchFuelLogDuplicateMatches,
  fetchFuelLogRecentDaySummaries,
  fetchFuelLogTodayRows,
  fetchFuelLogsPage,
  saveFuelLog
} from "@/lib/data";
import { exportToCsv } from "@/lib/export";
import { applyRequiredValidationMessage, clearValidationMessage } from "@/lib/form-validation";
import { useLanguage } from "@/lib/language-provider";
import { calculateFuelFields } from "@/lib/operations";
import { formatCurrency, formatDate, formatNumber, today } from "@/lib/utils";
import type {
  Driver,
  FuelLogDaySummary,
  FuelLogFilters,
  FuelLogSortDirection,
  FuelLogSortKey,
  FuelLogWithDriver
} from "@/types/database";

const PAGE_SIZE = 25;

const initialForm = {
  id: "",
  date: today(),
  driver_id: "",
  vehicle_reg: "",
  mileage: "",
  litres: "",
  total_cost: "",
  price_per_litre: "",
  location: "",
  fuel_type: "",
  payment_method: "",
  notes: ""
};

const initialFilters: FuelLogFilters = {
  search: "",
  fromDate: "",
  toDate: "",
  driverId: "",
  vehicleReg: "",
  fuelType: "",
  paymentMethod: "",
  totalCostMin: "",
  totalCostMax: ""
};

type FuelDraft = {
  id?: string;
  date: string;
  driver_id?: string;
  driver?: string;
  vehicle_reg: string;
  odometer: number | null;
  litres: number;
  total_cost: number;
  price_per_litre: number | null;
  station: string;
  fuel_type: string | null;
  payment_method: string | null;
  notes: string | null;
};

const normalize = (value: string | number | null | undefined) =>
  String(value ?? "").trim().toLowerCase();

function getLogTimestamp(log: FuelLogWithDriver) {
  return log.created_at || log.date;
}

function formatTimeLabel(value: string | null | undefined, language: "en" | "th") {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-GB", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(parsed);
}

function findDuplicates(logs: FuelLogWithDriver[], draft: FuelDraft, excludeId?: string) {
  if (!draft.date || !draft.vehicle_reg.trim()) return [];
  const vehicleKey = normalize(draft.vehicle_reg);
  return logs.filter((log) => {
    if (excludeId && String(log.id) === String(excludeId)) return false;
    if (log.date !== draft.date) return false;
    if (normalize(log.vehicle_reg) !== vehicleKey) return false;
    if (Math.abs(Number(log.total_cost || 0) - Number(draft.total_cost || 0)) > 5) return false;
    if (Math.abs(Number(log.litres || 0) - Number(draft.litres || 0)) > 1) return false;
    return true;
  });
}

function Highlight({ text, query }: { text: string | number | null | undefined; query: string }) {
  const value = String(text ?? "");
  const search = query.trim();
  if (!search) return <>{value || "-"}</>;
  const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = value.split(new RegExp(`(${escapedSearch})`, "gi"));
  return (
    <>
      {parts.map((part, index) =>
        part.toLowerCase() === search.toLowerCase() ? (
          <mark key={`${part}-${index}`} className="rounded bg-amber-200 px-1 text-slate-950">
            {part}
          </mark>
        ) : (
          <span key={`${part}-${index}`}>{part}</span>
        )
      )}
    </>
  );
}

function SortButton({
  label,
  active,
  direction,
  onClick,
  align = "left"
}: {
  label: string;
  active: boolean;
  direction: FuelLogSortDirection;
  onClick: () => void;
  align?: "left" | "right";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 font-semibold ${align === "right" ? "justify-end" : "justify-start"}`}
    >
      <span>{label}</span>
      <ArrowUpDown className={`h-3.5 w-3.5 ${active ? "text-brand-700" : "text-slate-400"}`} />
      {active ? <span className="text-[11px] uppercase">{direction}</span> : null}
    </button>
  );
}

export default function FuelLogsPage() {
  const { language, t } = useLanguage();
  const copy = {
    searchLabel: language === "th" ? "ค้นหา" : "Search",
    searchPlaceholder:
      language === "th"
        ? "ค้นหาคนขับ ทะเบียน สถานที่ ยอดเงิน หรือลิตร"
        : "Search driver, vehicle, location, total cost, or litres",
    dateRange: language === "th" ? "ช่วงวันที่" : "Date range",
    driver: language === "th" ? "คนขับ" : "Driver",
    vehicle: language === "th" ? "ทะเบียนรถ" : "Vehicle reg",
    fuelType: language === "th" ? "ประเภทน้ำมัน" : "Fuel type",
    payment: language === "th" ? "วิธีชำระเงิน" : "Payment method",
    totalCostRange: language === "th" ? "ช่วงยอดเงิน" : "Total cost range",
    min: language === "th" ? "ต่ำสุด" : "Min",
    max: language === "th" ? "สูงสุด" : "Max",
    clear: language === "th" ? "ล้างตัวกรอง" : "Clear filters",
    matches: language === "th" ? "รายการ" : "entries",
    duplicateTitle: language === "th" ? "พบรายการที่อาจซ้ำกัน" : "Possible duplicate found",
    duplicateHint:
      language === "th"
        ? "วันที่ ทะเบียนรถ ยอดเงิน และลิตรใกล้เคียงกับรายการที่มีอยู่แล้ว"
        : "This entry is close to an existing record on the same date and vehicle.",
    saveAnyway: language === "th" ? "บันทึกต่อ" : "Save anyway",
    cancel: language === "th" ? "ยกเลิก" : "Cancel",
    deleteConfirm: language === "th" ? "ลบรายการนี้ใช่หรือไม่" : "Delete this fuel entry?",
    filters: language === "th" ? "ค้นหาและตัวกรอง" : "Search & filters",
    all: language === "th" ? "ทั้งหมด" : "All",
    noResultsTitle: language === "th" ? "ไม่พบผลลัพธ์" : "No results",
    noResultsDescription:
      language === "th"
        ? "ไม่พบรายการที่ตรงกับตัวกรองนี้"
        : "No fuel entries match the current filters.",
    deleteError:
      language === "th" ? "ไม่สามารถลบบันทึกรายการน้ำมันได้" : "Unable to delete fuel log.",
    deleteSuccess:
      language === "th" ? "ลบบันทึกรายการน้ำมันเรียบร้อยแล้ว" : "Fuel entry deleted successfully.",
    autoFillLabel:
      language === "th"
        ? "กรอกจากคนขับอัตโนมัติ และยังแก้ไขได้"
        : "Auto-filled based on driver and can still be changed",
    noVehicleAssignedLabel:
      language === "th"
        ? "คนขับยังไม่มีรถที่ผูกไว้ โปรดเลือกเอง"
        : "No vehicle assigned. Please select one manually.",
    previousEntryHelper:
      language === "th"
        ? "ยังไม่มีรายการก่อนหน้านี้สำหรับรถคันนี้ในวันที่เลือกหรือน้อยกว่า"
        : "No earlier entry for this vehicle on or before this date.",
    entrySeparator: " - ",
    previousPage: language === "th" ? "ก่อนหน้า" : "Previous",
    nextPage: language === "th" ? "ถัดไป" : "Next",
    pageLabel: language === "th" ? "หน้า" : "Page",
    ofLabel: language === "th" ? "จาก" : "of"
  };

  const fuelTypeOptions = FUEL_TYPE_KEYS.map((value) => ({ value, label: t.fuel.type[value] }));
  const paymentMethodOptions = PAYMENT_METHOD_KEYS.map((value) => ({
    value,
    label: t.payment.method[value]
  }));

  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [fuelLogs, setFuelLogs] = useState<FuelLogWithDriver[]>([]);
  const [todayLogs, setTodayLogs] = useState<FuelLogWithDriver[]>([]);
  const [last7DayRows, setLast7DayRows] = useState<FuelLogDaySummary[]>([]);
  const [form, setForm] = useState(initialForm);
  const [filters, setFilters] = useState<FuelLogFilters>(initialFilters);
  const [sortKey, setSortKey] = useState<FuelLogSortKey>("date");
  const [sortDirection, setSortDirection] = useState<FuelLogSortDirection>("desc");
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [submitMode, setSubmitMode] = useState<"save" | "addAnother">("save");
  const [lastEditedFuelField, setLastEditedFuelField] = useState<"litres" | "total_cost" | "price_per_litre">("total_cost");
  const [pendingDraft, setPendingDraft] = useState<FuelDraft | null>(null);
  const [duplicateMatches, setDuplicateMatches] = useState<FuelLogWithDriver[]>([]);
  const [highlightedFuelLogId, setHighlightedFuelLogId] = useState<string | null>(null);
  const [comparisonEntry, setComparisonEntry] = useState<FuelLogWithDriver | null>(null);

  const isEditing = Boolean(form.id);
  const todayValue = today();
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const selectedDriver = useMemo(
    () => drivers.find((driver) => String(driver.id) === String(form.driver_id)),
    [drivers, form.driver_id]
  );

  const stats = {
    fuelSpendToday: todayLogs.reduce((sum, log) => sum + Number(log.total_cost || 0), 0),
    litresToday: todayLogs.reduce((sum, log) => sum + Number(log.litres || 0), 0),
    entriesToday: todayLogs.length
  };

  const topDriversToday = useMemo(() => {
    const totals = new Map<string, { driver: string; amount: number; litres: number }>();
    todayLogs.forEach((log) => {
      const key = log.driver || "-";
      const current = totals.get(key) || { driver: key, amount: 0, litres: 0 };
      current.amount += Number(log.total_cost || 0);
      current.litres += Number(log.litres || 0);
      totals.set(key, current);
    });
    return Array.from(totals.values()).sort((a, b) => b.amount - a.amount).slice(0, 5);
  }, [todayLogs]);

  const vehicleOptions = useMemo(
    () =>
      Array.from(
        new Set(
          [...fuelLogs.map((log) => log.vehicle_reg), ...drivers.map((driver) => driver.vehicle_reg)]
            .filter(Boolean)
            .map((value) => value.trim())
        )
      ).sort(),
    [drivers, fuelLogs]
  );

  const loadDrivers = useCallback(async () => {
    try {
      setDrivers(await fetchDrivers());
    } catch (err) {
      console.error("Fuel logs loadDrivers error:", err);
      setError(t.fuelLogs.unableToLoadFuelData);
    }
  }, [t.fuelLogs.unableToLoadFuelData]);

  const loadSummaryData = useCallback(async () => {
    const [todayRows, recentDayRows] = await Promise.all([
      fetchFuelLogTodayRows(todayValue),
      fetchFuelLogRecentDaySummaries(7)
    ]);
    setTodayLogs(todayRows);
    setLast7DayRows(recentDayRows);
  }, [todayValue]);

  const loadFuelLogPage = useCallback(
    async (page = currentPage) => {
      setLoading(true);
      setError(null);
      try {
        const [{ rows, totalCount: nextTotalCount }] = await Promise.all([
          fetchFuelLogsPage({
            page,
            pageSize: PAGE_SIZE,
            sortKey,
            sortDirection,
            filters
          }),
          loadSummaryData()
        ]);

        const nextTotalPages = Math.max(1, Math.ceil(nextTotalCount / PAGE_SIZE));
        if (page > nextTotalPages) {
          setCurrentPage(nextTotalPages);
          return;
        }

        setFuelLogs(rows);
        setTotalCount(nextTotalCount);
      } catch (err) {
        console.error("Fuel logs loadFuelLogPage error:", err);
        setError(t.fuelLogs.unableToLoadFuelData);
      } finally {
        setLoading(false);
      }
    },
    [currentPage, filters, loadSummaryData, sortDirection, sortKey, t.fuelLogs.unableToLoadFuelData]
  );

  useEffect(() => {
    void loadDrivers();
  }, [loadDrivers]);

  useEffect(() => {
    void loadFuelLogPage(currentPage);
  }, [currentPage, loadFuelLogPage]);

  useEffect(() => {
    const handleDataChanged = () => {
      void loadFuelLogPage(currentPage);
    };
    window.addEventListener("fuel-bank:data-changed", handleDataChanged);
    return () => window.removeEventListener("fuel-bank:data-changed", handleDataChanged);
  }, [currentPage, loadFuelLogPage]);

  useEffect(() => {
    const nextCalculated = calculateFuelFields({
      litres: form.litres,
      total_cost: form.total_cost,
      price_per_litre: form.price_per_litre,
      lastEditedField: lastEditedFuelField
    });

    setForm((current) =>
      current.total_cost === nextCalculated.total_cost &&
      current.price_per_litre === nextCalculated.price_per_litre
        ? current
        : {
            ...current,
            total_cost: nextCalculated.total_cost,
            price_per_litre: nextCalculated.price_per_litre
          }
    );
  }, [form.litres, form.price_per_litre, form.total_cost, lastEditedFuelField]);

  useEffect(() => {
    setPendingDraft(null);
    setDuplicateMatches([]);
  }, [form.date, form.vehicle_reg, form.litres, form.total_cost, form.id]);

  useEffect(() => {
    if (!form.vehicle_reg.trim() || !form.date) {
      setComparisonEntry(null);
      return;
    }

    let active = true;
    const loadComparisonEntry = async () => {
      try {
        const entry = await fetchFuelLogComparisonEntry({
          vehicleReg: form.vehicle_reg,
          date: form.date,
          excludeId: form.id || undefined
        });
        if (active) setComparisonEntry(entry);
      } catch (err) {
        console.error("Fuel logs comparison entry error:", err);
        if (active) setComparisonEntry(null);
      }
    };

    void loadComparisonEntry();
    return () => {
      active = false;
    };
  }, [form.date, form.id, form.vehicle_reg]);

  const resetForm = () => {
    setForm(initialForm);
    setLastEditedFuelField("total_cost");
    setError(null);
    setSuccessMessage(null);
    setSubmitMode("save");
    setPendingDraft(null);
    setDuplicateMatches([]);
    setHighlightedFuelLogId(null);
  };

  const populateForm = (log: FuelLogWithDriver) => {
    setForm({
      id: String(log.id),
      date: log.date,
      driver_id: log.driver_id != null ? String(log.driver_id) : "",
      vehicle_reg: log.vehicle_reg,
      mileage: log.mileage != null ? String(log.mileage) : "",
      litres: log.litres != null ? String(log.litres) : "",
      total_cost: log.total_cost != null ? String(log.total_cost) : "",
      price_per_litre: log.price_per_litre != null ? String(log.price_per_litre) : "",
      location: log.location || "",
      fuel_type: normalizeFuelTypeKey(log.fuel_type) ?? "",
      payment_method: normalizePaymentMethodKey(log.payment_method) ?? "",
      notes: log.notes || ""
    });
    setLastEditedFuelField("total_cost");
    setError(null);
    setSuccessMessage(null);
    setPendingDraft(null);
    setDuplicateMatches([]);
    setHighlightedFuelLogId(String(log.id));
  };

  const handleDriverChange = (driverId: string) => {
    const nextDriver = drivers.find((driver) => String(driver.id) === String(driverId));
    setForm((current) => ({
      ...current,
      driver_id: driverId,
      vehicle_reg: nextDriver?.vehicle_reg?.trim() ? nextDriver.vehicle_reg : current.vehicle_reg
    }));
  };

  const updateFuelField = (field: "litres" | "total_cost" | "price_per_litre", value: string) => {
    setLastEditedFuelField(field);
    setForm((current) => ({ ...current, [field]: value }));
  };

  const updateFilters = (updater: FuelLogFilters | ((current: FuelLogFilters) => FuelLogFilters)) => {
    setFilters((current) => (typeof updater === "function" ? updater(current) : updater));
    setCurrentPage(1);
  };

  const handleSortChange = (nextKey: FuelLogSortKey) => {
    setSortDirection((current) =>
      sortKey === nextKey ? (current === "desc" ? "asc" : "desc") : "desc"
    );
    setSortKey(nextKey);
    setCurrentPage(1);
  };

  const handleInvalid = (
    event: React.InvalidEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => applyRequiredValidationMessage(event, t.common.requiredField);

  const nextForm = useCallback(
    (mode: "save" | "addAnother") =>
      mode === "addAnother"
        ? {
            ...initialForm,
            date: form.date,
            driver_id: form.driver_id,
            vehicle_reg: form.vehicle_reg,
            fuel_type: form.fuel_type,
            payment_method: form.payment_method
          }
        : { ...initialForm, date: form.date },
    [form.date, form.driver_id, form.fuel_type, form.payment_method, form.vehicle_reg]
  );

  const buildDraft = useCallback(
    (): FuelDraft => ({
      id: form.id || undefined,
      date: form.date,
      driver_id: form.driver_id || undefined,
      driver: selectedDriver?.name ?? "",
      vehicle_reg: form.vehicle_reg.trim(),
      odometer: form.mileage ? Number(form.mileage) : null,
      litres: Number(form.litres),
      total_cost: Number(form.total_cost),
      price_per_litre: form.price_per_litre ? Number(form.price_per_litre) : null,
      station: form.location.trim(),
      fuel_type: form.fuel_type || null,
      payment_method: form.payment_method || null,
      notes: form.notes.trim() || null
    }),
    [form, selectedDriver]
  );

  const refreshCurrentPage = useCallback(
    async (targetPage = currentPage) => {
      await loadFuelLogPage(targetPage);
    },
    [currentPage, loadFuelLogPage]
  );

  const saveDraft = useCallback(
    async (draft: FuelDraft, mode: "save" | "addAnother") => {
      await saveFuelLog(draft);
      setForm(nextForm(mode));
      setSubmitMode("save");
      setPendingDraft(null);
      setDuplicateMatches([]);
      setSuccessMessage(
        isEditing
          ? t.fuelLogs.updateSuccessMessage
          : mode === "addAnother"
            ? t.fuelLogs.saveAndAddAnotherSuccessMessage
            : t.fuelLogs.saveSuccessMessage
      );
      await refreshCurrentPage(mode === "addAnother" ? 1 : currentPage);
    },
    [
      currentPage,
      isEditing,
      nextForm,
      refreshCurrentPage,
      t.fuelLogs.saveAndAddAnotherSuccessMessage,
      t.fuelLogs.saveSuccessMessage,
      t.fuelLogs.updateSuccessMessage
    ]
  );

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSuccessMessage(null);
    try {
      if (
        form.mileage &&
        comparisonEntry?.mileage != null &&
        Number(form.mileage) < Number(comparisonEntry.mileage) &&
        !window.confirm(
          language === "th"
            ? "เลขไมล์ต่ำกว่ารายการก่อนหน้า ต้องการบันทึกต่อหรือไม่"
            : "Mileage is lower than the previous reading. Save anyway?"
        )
      ) {
        setError(t.fuelLogs.mileageValidationError);
        return;
      }

      const draft = buildDraft();

      if (!isEditing) {
        const nearbyRows = await fetchFuelLogDuplicateMatches({
          date: draft.date,
          vehicleReg: draft.vehicle_reg
        });
        const matches = findDuplicates(nearbyRows, draft);
        if (matches.length > 0) {
          setPendingDraft(draft);
          setDuplicateMatches(matches);
          return;
        }
      }

      await saveDraft(draft, submitMode);
    } catch (err) {
      console.error("Fuel logs handleSubmit error:", err);
      setError(err instanceof Error && err.message ? err.message : t.fuelLogs.unableToSaveFuelLog);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm(copy.deleteConfirm)) return;
    try {
      setDeletingId(id);
      setError(null);
      setSuccessMessage(null);
      await deleteFuelLog(id);
      if (form.id === id) resetForm();

      const targetPage = fuelLogs.length === 1 && currentPage > 1 ? currentPage - 1 : currentPage;
      if (targetPage !== currentPage) {
        setCurrentPage(targetPage);
      } else {
        await refreshCurrentPage(targetPage);
      }

      setSuccessMessage(copy.deleteSuccess);
    } catch (err) {
      console.error("Fuel logs handleDelete error:", err);
      setError(err instanceof Error && err.message ? err.message : copy.deleteError);
    } finally {
      setDeletingId(null);
    }
  };

  const exportFuelLogs = () =>
    exportToCsv(
      fuelLogs.map((log) => ({
        [t.fuelLogs.date]: formatDate(log.date, language),
        [t.fuelLogs.driver]: log.driver,
        [t.fuelLogs.vehicleReg]: log.vehicle_reg,
        [t.fuelLogs.mileage]: log.mileage ?? "",
        [t.fuelLogs.litres]: log.litres,
        [t.fuelLogs.totalCost]: log.total_cost,
        [t.fuelLogs.pricePerLitre]: log.price_per_litre ?? "",
        [t.fuelLogs.location]: log.location,
        [t.fuelLogs.fuelType]: getFuelTypeLabel(t, log.fuel_type),
        [t.fuelLogs.paymentMethod]: getPaymentMethodLabel(t, log.payment_method),
        [t.fuelLogs.notes]: log.notes ?? ""
      })),
      "fuel-logs-report"
    );

  const avgPriceToday = stats.litresToday > 0 ? stats.fuelSpendToday / stats.litresToday : 0;

  return (
    <>
      <div className="mb-6 hidden md:block">
        <Header title={t.fuelLogs.title} description={t.fuelLogs.description} />
      </div>

      <section className="mb-4.5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t.fuelLogs.fuelSpendToday} value={formatCurrency(stats.fuelSpendToday, language)} helper={t.fuelLogs.fuelSpendTodayHelper} icon={<Wallet className="h-5 w-5" />} />
        <StatCard label={t.fuelLogs.litresToday} value={formatNumber(stats.litresToday, language, 2)} helper={t.fuelLogs.litresTodayHelper} icon={<Droplets className="h-5 w-5" />} />
        <StatCard label={t.fuelLogs.entriesToday} value={formatNumber(stats.entriesToday, language)} helper={t.fuelLogs.entriesTodayHelper} icon={<ReceiptText className="h-5 w-5" />} />
        <StatCard label={t.fuelLogs.averagePricePerLitreToday} value={stats.litresToday > 0 ? formatCurrency(avgPriceToday, language) : "-"} helper={stats.litresToday > 0 ? t.fuelLogs.averagePricePerLitreTodayHelper : t.fuelLogs.noTodayFuelDescription} icon={<TrendingUp className="h-5 w-5" />} />
      </section>

      <section className="surface-card mb-4.5 p-4 sm:p-5">
        <div className="mb-2.5">
          <h3 className="section-title">{t.fuelLogs.todaysFuelActivity}</h3>
          <p className="section-subtitle">{t.fuelLogs.todaysFuelActivityDescription}</p>
        </div>
        {loading ? (
          <p className="text-sm text-slate-500">{t.fuelLogs.loadingFuelLogs}</p>
        ) : todayLogs.length === 0 ? (
          <EmptyState title={t.fuelLogs.noTodayFuelTitle} description={t.fuelLogs.noTodayFuelDescription} />
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start">
            <div className="space-y-3">
              {todayLogs.slice(0, 6).map((log) => (
                <div key={log.id} className="subtle-panel px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">{log.driver || "-"}</p>
                      <p className="mt-1 text-sm text-slate-500">{log.vehicle_reg || "-"}</p>
                    </div>
                    <span className="shrink-0 text-sm font-semibold text-slate-950">{formatCurrency(Number(log.total_cost || 0), language)}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400">
                    <span>{formatNumber(Number(log.litres || 0), language, 2)}L</span>
                    <span className="text-slate-300">-</span>
                    <span>{formatTimeLabel(getLogTimestamp(log), language)}</span>
                    <span className="text-slate-300">-</span>
                    <span>{formatDate(log.date, language)}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="subtle-panel p-4">
              <div className="mb-2.5">
                <p className="text-sm font-semibold text-slate-900">{t.fuelLogs.topDriversToday}</p>
                <p className="mt-1 text-xs text-slate-400">{formatDate(todayValue, language)}</p>
              </div>
              <div className="space-y-2">
                {topDriversToday.map((driver) => (
                  <div key={driver.driver} className="flex items-start justify-between gap-3 border-b border-slate-100/70 pb-2 last:border-b-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-800">{driver.driver}</p>
                      <p className="mt-0.5 text-xs text-slate-400">{formatNumber(driver.litres, language, 2)}L</p>
                    </div>
                    <p className="text-sm font-semibold text-slate-950">{formatCurrency(driver.amount, language)}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>

      <section className="surface-card mb-4.5 p-4 sm:p-5">
        <div className="mb-3.5">
          <h3 className="text-base font-semibold text-slate-900">{t.fuelLogs.spendByDayTitle}</h3>
          <p className="mt-1 text-sm text-slate-500">{t.fuelLogs.spendByDayDescription}</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {last7DayRows.map((row) => (
            <div key={row.date} className="subtle-panel p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-slate-700">{formatDate(row.date, language)}</p>
                <Clock3 className="h-4 w-4 text-slate-400" />
              </div>
              <p className="mt-2.5 text-base font-semibold text-slate-950">{formatCurrency(row.spend, language)}</p>
              <div className="mt-2 flex items-center justify-between gap-3 text-sm text-slate-500">
                <span>{formatNumber(row.litres, language, 2)} {t.fuelLogs.litres}</span>
                <span>{formatNumber(row.entries, language)} {t.common.entries}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-5 grid gap-5">
        <section className="surface-card p-4 sm:p-5">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <h3 className="section-title">{isEditing ? t.fuelLogs.editFuelEntry : t.fuelLogs.addFuelEntry}</h3>
              <p className="section-subtitle">{t.fuelLogs.description}</p>
            </div>
            {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
            {successMessage ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{successMessage}</div> : null}
            {duplicateMatches.length > 0 && pendingDraft ? (
              <div className="rounded-3xl border border-amber-300 bg-amber-50/90 p-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-amber-900">{copy.duplicateTitle}</p>
                    <p className="mt-1 text-sm text-amber-800">{copy.duplicateHint}</p>
                  </div>
                </div>
                <div className="mt-4 space-y-3">
                  {duplicateMatches.map((log) => (
                    <div key={log.id} className="rounded-2xl border border-amber-200 bg-white/85 px-4 py-3 text-sm text-slate-700">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="font-semibold text-slate-900">{log.vehicle_reg}</p>
                          <p className="mt-1 text-slate-500">{formatDate(log.date, language)}{copy.entrySeparator}{log.driver || "-"}{copy.entrySeparator}{log.location || "-"}</p>
                        </div>
                        <div className="text-left sm:text-right">
                          <p className="font-semibold text-slate-950">{formatCurrency(Number(log.total_cost || 0), language)}</p>
                          <p className="text-slate-500">{formatNumber(Number(log.litres || 0), language, 2)}L</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex flex-col gap-2.5 sm:flex-row">
                  <button type="button" onClick={() => void saveDraft(pendingDraft, submitMode)} disabled={saving} className="btn-primary w-full sm:w-auto">{copy.saveAnyway}</button>
                  <button type="button" onClick={() => { setPendingDraft(null); setDuplicateMatches([]); }} className="btn-secondary w-full sm:w-auto">{copy.cancel}</button>
                </div>
              </div>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="form-field"><label className="form-label form-label-required">{t.fuelLogs.logDate}</label><input type="date" required max={todayValue} value={form.date} onInvalid={handleInvalid} onInput={clearValidationMessage} onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))} className="form-input bg-white" /></div>
              <div className="form-field"><label className="form-label form-label-required">{t.fuelLogs.driver}</label><select required value={form.driver_id} onInvalid={handleInvalid} onInput={clearValidationMessage} onChange={(event) => handleDriverChange(event.target.value)} className="form-input bg-white"><option value="">{t.fuelLogs.selectDriver}</option>{drivers.map((driver) => <option key={driver.id} value={String(driver.id)}>{driver.name}</option>)}</select></div>
              <div className="form-field"><label className="form-label form-label-required">{t.fuelLogs.vehicleReg}</label><input required list="fuel-log-vehicle-options" value={form.vehicle_reg} onInvalid={handleInvalid} onInput={clearValidationMessage} onChange={(event) => setForm((current) => ({ ...current, vehicle_reg: event.target.value }))} placeholder={t.fuelLogs.vehiclePlaceholder} className="form-input bg-white" /><p className="form-helper">{selectedDriver?.vehicle_reg?.trim() ? copy.autoFillLabel : copy.noVehicleAssignedLabel}</p></div>
              <div className="form-field"><label className="form-label">{t.fuelLogs.mileage}</label><input type="number" min="0" step="1" value={form.mileage} onChange={(event) => setForm((current) => ({ ...current, mileage: event.target.value }))} placeholder={t.fuelLogs.currentMileage} className="form-input bg-white" /><p className="form-helper">{comparisonEntry ? `${comparisonEntry.vehicle_reg} | ${formatDate(comparisonEntry.date, language)} | ${comparisonEntry.mileage ?? "-"}` : copy.previousEntryHelper}</p>{form.mileage && comparisonEntry?.mileage != null && Number(form.mileage) < Number(comparisonEntry.mileage) ? <div className="mt-2 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{t.fuelLogs.mileageValidationError}</div> : null}</div>
              <div className="form-field"><label className="form-label form-label-required">{t.fuelLogs.fuelStationLocation}</label><input required value={form.location} onInvalid={handleInvalid} onInput={clearValidationMessage} onChange={(event) => setForm((current) => ({ ...current, location: event.target.value }))} placeholder={t.fuelLogs.stationNameOrLocation} className="form-input bg-white" /></div>
              <div className="form-field"><label className="form-label form-label-required">{t.fuelLogs.litres}</label><input type="number" min="0" step="0.01" required value={form.litres} onInvalid={handleInvalid} onInput={clearValidationMessage} onChange={(event) => updateFuelField("litres", event.target.value)} className="form-input bg-white" /></div>
              <div className="form-field"><label className="form-label form-label-required">{t.fuelLogs.totalCost}</label><input type="number" min="0" step="0.01" required value={form.total_cost} onInvalid={handleInvalid} onInput={clearValidationMessage} onChange={(event) => updateFuelField("total_cost", event.target.value)} className="form-input bg-white" /></div>
              <div className="form-field"><label className="form-label">{t.fuelLogs.pricePerLitre}</label><input type="number" min="0" step="0.01" value={form.price_per_litre} onChange={(event) => updateFuelField("price_per_litre", event.target.value)} placeholder={t.fuelLogs.pricePerLitrePlaceholder} className="form-input bg-white" /><p className="form-helper">{t.fuelLogs.pricePerLitreHelper}</p></div>
              <div className="form-field"><label className="form-label">{t.fuelLogs.fuelType}</label><select value={form.fuel_type} onChange={(event) => setForm((current) => ({ ...current, fuel_type: event.target.value }))} className="form-input bg-white"><option value="">{t.fuelLogs.fuelTypeSelect}</option>{fuelTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>
              <div className="form-field"><label className="form-label">{t.fuelLogs.paymentMethod}</label><select value={form.payment_method} onChange={(event) => setForm((current) => ({ ...current, payment_method: event.target.value }))} className="form-input bg-white"><option value="">{t.fuelLogs.paymentMethodSelect}</option>{paymentMethodOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>
            </div>

            <div className="form-field">
              <label className="form-label">{t.fuelLogs.notes}</label>
              <textarea rows={4} value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} placeholder={t.fuelLogs.optionalNotes} className="form-textarea bg-white" />
            </div>

            <datalist id="fuel-log-vehicle-options">
              {vehicleOptions.map((vehicleReg) => (
                <option key={vehicleReg} value={vehicleReg} />
              ))}
            </datalist>

            <div className="sticky bottom-3 z-10 flex flex-col gap-2.5 rounded-[1.5rem] border border-slate-200/80 bg-white/95 p-3 shadow-[0_10px_30px_rgba(15,23,42,0.08)] backdrop-blur sm:static sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none sm:flex-row sm:items-center">
              {!isEditing ? <button type="submit" disabled={saving} onClick={() => setSubmitMode("addAnother")} className="btn-secondary min-w-[180px] flex-1 sm:flex-none disabled:opacity-70">{saving && submitMode === "addAnother" ? t.common.saving : t.fuelLogs.saveAndAddAnother}</button> : null}
              <button type="submit" disabled={saving} onClick={() => setSubmitMode("save")} className="btn-primary min-w-[180px] flex-1 sm:flex-none disabled:opacity-70">{saving && submitMode === "save" ? t.common.saving : isEditing ? t.fuelLogs.updateFuelEntry : t.fuelLogs.saveFuelEntry}</button>
              {isEditing ? <button type="button" onClick={resetForm} className="btn-secondary w-full sm:w-auto">{t.common.cancel}</button> : null}
            </div>
          </form>
        </section>
      </section>

      <section className="mt-5">
        <section className="surface-card min-w-0 p-5 sm:p-6">
          <div className="mb-4 flex flex-col gap-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h3 className="section-title">{t.fuelLogs.fuelEntries}</h3>
                <p className="section-subtitle">{t.fuelLogs.tableDescription}</p>
              </div>
              <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
                <div className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-slate-600">{formatNumber(totalCount, language)} {copy.matches}</div>
                <button type="button" onClick={exportFuelLogs} disabled={!fuelLogs.length} className="btn-secondary w-full gap-2 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"><Download className="h-4 w-4" />{t.common.export}</button>
              </div>
            </div>
          </div>
          <div className="mb-6 rounded-[1.75rem] border border-slate-200/80 bg-white/95 p-4 shadow-[0_10px_30px_rgba(15,23,42,0.04)] backdrop-blur sm:p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-slate-900">{copy.filters}</p>
              <button type="button" onClick={() => updateFilters(initialFilters)} className="text-sm font-medium text-slate-500 hover:text-slate-900">{copy.clear}</button>
            </div>
            <div className="grid gap-3 md:grid-cols-12">
              <div className="md:col-span-5 lg:col-span-4"><label className="form-label">{copy.searchLabel}</label><div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={filters.search ?? ""} onChange={(event) => updateFilters((current) => ({ ...current, search: event.target.value }))} placeholder={copy.searchPlaceholder} className="form-input bg-white pl-10" /></div></div>
              <div className="md:col-span-4 lg:col-span-3"><label className="form-label">{copy.dateRange}</label><div className="grid grid-cols-2 gap-2"><input type="date" value={filters.fromDate ?? ""} onChange={(event) => updateFilters((current) => ({ ...current, fromDate: event.target.value }))} className="form-input bg-white" /><input type="date" value={filters.toDate ?? ""} onChange={(event) => updateFilters((current) => ({ ...current, toDate: event.target.value }))} className="form-input bg-white" /></div></div>
              <div className="md:col-span-3 lg:col-span-2"><label className="form-label">{copy.driver}</label><select value={filters.driverId ?? ""} onChange={(event) => updateFilters((current) => ({ ...current, driverId: event.target.value }))} className="form-input bg-white"><option value="">{copy.all}</option>{drivers.map((driver) => <option key={driver.id} value={String(driver.id)}>{driver.name}</option>)}</select></div>
              <div className="md:col-span-3 lg:col-span-2"><label className="form-label">{copy.vehicle}</label><select value={filters.vehicleReg ?? ""} onChange={(event) => updateFilters((current) => ({ ...current, vehicleReg: event.target.value }))} className="form-input bg-white"><option value="">{copy.all}</option>{vehicleOptions.map((vehicleReg) => <option key={vehicleReg} value={vehicleReg}>{vehicleReg}</option>)}</select></div>
              <div className="md:col-span-3 lg:col-span-2"><label className="form-label">{copy.fuelType}</label><select value={filters.fuelType ?? ""} onChange={(event) => updateFilters((current) => ({ ...current, fuelType: event.target.value }))} className="form-input bg-white"><option value="">{copy.all}</option>{fuelTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>
              <div className="md:col-span-3 lg:col-span-2"><label className="form-label">{copy.payment}</label><select value={filters.paymentMethod ?? ""} onChange={(event) => updateFilters((current) => ({ ...current, paymentMethod: event.target.value }))} className="form-input bg-white"><option value="">{copy.all}</option>{paymentMethodOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>
              <div className="md:col-span-6 lg:col-span-3"><label className="form-label">{copy.totalCostRange}</label><div className="grid grid-cols-2 gap-2"><input type="number" min="0" step="0.01" value={filters.totalCostMin ?? ""} onChange={(event) => updateFilters((current) => ({ ...current, totalCostMin: event.target.value }))} placeholder={copy.min} className="form-input bg-white" /><input type="number" min="0" step="0.01" value={filters.totalCostMax ?? ""} onChange={(event) => updateFilters((current) => ({ ...current, totalCostMax: event.target.value }))} placeholder={copy.max} className="form-input bg-white" /></div></div>
            </div>
          </div>

          {loading ? (
            <p className="text-sm text-slate-500">{t.fuelLogs.loadingFuelLogs}</p>
          ) : totalCount === 0 ? (
            <EmptyState title={copy.noResultsTitle} description={copy.noResultsDescription} />
          ) : (
            <>
              <div className="space-y-3.5 md:hidden">
                {fuelLogs.map((log) => (
                  <div key={log.id} className="subtle-panel border-slate-200/80 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{formatDate(log.date, language)}</p>
                        <p className="mt-2 text-sm font-semibold text-slate-900">{log.driver}</p>
                        <p className="mt-1 text-sm text-slate-500">{log.vehicle_reg}</p>
                      </div>
                      <p className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">{formatCurrency(Number(log.total_cost || 0), language)}</p>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-3">
                      <div><p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{t.fuelLogs.litres}</p><p className="mt-1 text-sm font-medium text-slate-900">{formatNumber(Number(log.litres || 0), language, 2)}</p></div>
                      <div><p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{t.fuelLogs.pricePerLitre}</p><p className="mt-1 text-sm font-medium text-slate-900">{log.price_per_litre != null ? formatCurrency(Number(log.price_per_litre), language) : "-"}</p></div>
                      <div><p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{t.fuelLogs.mileage}</p><p className="mt-1 text-sm font-medium text-slate-900">{log.mileage ?? "-"}</p></div>
                      <div><p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{t.fuelLogs.location}</p><p className="mt-1 text-sm font-medium text-slate-900">{log.location || "-"}</p></div>
                    </div>
                    <div className="mt-4 flex gap-2">
                      <button type="button" onClick={() => populateForm(log)} className="btn-secondary min-h-[46px] flex-1 px-4 py-2.5">{t.common.edit}</button>
                      <button type="button" onClick={() => void handleDelete(String(log.id))} disabled={deletingId === String(log.id)} className="btn-danger min-h-[46px] flex-1 px-4 py-2.5 disabled:opacity-50">{deletingId === String(log.id) ? t.common.deleting : t.common.delete}</button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="hidden md:block">
                <div className="table-shell rounded-2xl">
                  <div className="table-scroll overflow-x-auto overflow-y-auto">
                    <table className="min-w-[1120px] w-full text-sm">
                      <thead className="sticky top-0 z-10 bg-slate-50/95 text-slate-600 backdrop-blur">
                        <tr>
                          <th className="table-head-cell text-left"><SortButton label={t.fuelLogs.date} active={sortKey === "date"} direction={sortDirection} onClick={() => handleSortChange("date")} /></th>
                          <th className="table-head-cell text-left">{t.fuelLogs.driver}</th>
                          <th className="table-head-cell text-left">{t.fuelLogs.vehicleReg}</th>
                          <th className="table-head-cell text-right"><SortButton label={t.fuelLogs.litres} active={sortKey === "litres"} direction={sortDirection} align="right" onClick={() => handleSortChange("litres")} /></th>
                          <th className="table-head-cell text-right"><SortButton label={t.fuelLogs.totalCost} active={sortKey === "total_cost"} direction={sortDirection} align="right" onClick={() => handleSortChange("total_cost")} /></th>
                          <th className="table-head-cell text-right">{t.fuelLogs.pricePerLitre}</th>
                          <th className="table-head-cell text-right">{t.fuelLogs.mileage}</th>
                          <th className="table-head-cell text-left">{t.fuelLogs.location}</th>
                          <th className="table-head-cell text-left">{t.common.action}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {fuelLogs.map((log) => (
                          <tr key={log.id} className={`enterprise-table-row ${highlightedFuelLogId === String(log.id) ? "bg-amber-50/70" : ""}`}>
                            <td className="table-body-cell font-medium text-slate-700"><Highlight text={formatDate(log.date, language)} query={filters.search ?? ""} /></td>
                            <td className="table-body-cell whitespace-nowrap font-medium text-slate-900"><Highlight text={log.driver} query={filters.search ?? ""} /></td>
                            <td className="table-body-cell whitespace-nowrap text-slate-700"><Highlight text={log.vehicle_reg} query={filters.search ?? ""} /></td>
                            <td className="table-body-cell whitespace-nowrap text-right font-medium text-slate-800"><Highlight text={formatNumber(Number(log.litres || 0), language, 2)} query={filters.search ?? ""} /></td>
                            <td className="table-body-cell whitespace-nowrap text-right font-semibold text-slate-950"><Highlight text={formatCurrency(Number(log.total_cost || 0), language)} query={filters.search ?? ""} /></td>
                            <td className="table-body-cell whitespace-nowrap text-right font-medium text-slate-800">{log.price_per_litre != null ? formatCurrency(Number(log.price_per_litre), language) : "-"}</td>
                            <td className="table-body-cell whitespace-nowrap text-right font-medium text-slate-800">{log.mileage ?? "-"}</td>
                            <td className="table-body-cell min-w-[140px] text-slate-700"><Highlight text={log.location || "-"} query={filters.search ?? ""} /></td>
                            <td className="table-body-cell"><div className="flex gap-2"><button type="button" onClick={() => populateForm(log)} className="table-action-secondary min-w-[78px]">{t.common.edit}</button><button type="button" onClick={() => void handleDelete(String(log.id))} disabled={deletingId === String(log.id)} className="table-action-danger min-w-[78px] disabled:opacity-50">{deletingId === String(log.id) ? t.common.deleting : t.common.delete}</button></div></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
              <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-slate-500">{copy.pageLabel} {formatNumber(currentPage, language)} {copy.ofLabel} {formatNumber(totalPages, language)}</p>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setCurrentPage((page) => Math.max(1, page - 1))} disabled={currentPage === 1 || loading} className="btn-secondary disabled:opacity-50">{copy.previousPage}</button>
                  <button type="button" onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))} disabled={currentPage === totalPages || loading} className="btn-secondary disabled:opacity-50">{copy.nextPage}</button>
                </div>
              </div>
            </>
          )}
        </section>
      </section>
    </>
  );
}
