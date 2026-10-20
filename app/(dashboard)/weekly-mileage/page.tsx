"use client";

import {
  AlertTriangle,
  CheckCircle2,
  CircleCheck,
  Copy,
  Download,
  FileSpreadsheet,
  History,
  Pencil,
  Plus,
  Trash2,
  X
} from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {centreCopy} from '@/lib/maintenance-centre-copy';
import { buildOilServiceSnapshot, historyDistanceSinceService, recordedServiceDate } from "@/lib/oil-service-snapshot";
import { createServiceRefreshCoordinator } from "@/lib/oil-service-mutations";
import { withRequestDeadline } from "@/lib/request-deadline";
import { EmptyState } from "@/components/empty-state";
import {
  deleteWeeklyMileage,
  fetchDrivers,
  fetchOilChangeBaselinesForVehicles,
  fetchOilChangeHistory,
  deleteOilChangeService,
  clearDataReadCache,
  fetchVehicles,
  fetchWeeklyMileage,
  saveOilChangeService,
  saveWeeklyMileage
} from "@/lib/data";
import { exportToCsv, exportToXlsx, exportWorkbookToXlsx } from "@/lib/export";
import { applyRequiredValidationMessage, clearValidationMessage } from "@/lib/form-validation";
import { useLanguage } from "@/lib/language-provider";
import { getEffectiveOilChangeIntervalForVehicleType, getOilChangeIntervalForVehicleType } from "@/lib/oil-change-service";
import { safeLocalStorage } from "@/lib/safe-browser-storage";
import { supabase } from "@/lib/supabase";
import {
  buildDriverWeeklyComparisons,
  buildWeeklyDistanceHistoryRows,
  buildWeeklyDistanceHistorySummary,
  buildWeeklyMileageSummary,
  computeWeeklyMileageByVehicle
} from "@/lib/operations";
import { formatDate, formatNumber } from "@/lib/utils";
import { buildWeeklyMileageComparisonReport } from "@/lib/weekly-mileage-report";
import { buildWeeklyMileageComparisonPdf } from "@/lib/weekly-mileage-pdf";
import type { Driver, OilChangeBaseline, Vehicle, VehicleServiceLog, WeeklyMileageEntry } from "@/types/database";
import type { OilChangeAlertRow, OilChangeStatus, WeeklyDistanceHistoryRow } from "@/lib/operations";
import type { Language } from "@/lib/translations";

import {getOilServicePdfCopy,getLastOilChangesPdfCopy,loadOilServicePdfLogo,buildOilServicePdf,buildLastOilChangesPdf,buildWeeklyDistanceHistoryPdf,downloadBlob,type OilServicePdfLanguage,type OilServicePdfLogo,type OilServicePdfRow,type OilServicePdfData,type LastOilChangesPdfRow,type LastOilChangesPdfData,type WeeklyDistanceHistoryPdfData,type WeeklyDistanceHistoryPdfRow} from '@/lib/oil-service-pdf';
const PAGE_SIZE = 25;
const WEEKLY_MILEAGE_SELECTED_WEEK_KEY = "weekly-mileage-selected-week";
const isValidDateKey = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
const getStoredWeekEnding = () => {
  if (typeof window === "undefined") return "";
  const stored = safeLocalStorage.getItem(WEEKLY_MILEAGE_SELECTED_WEEK_KEY) ?? "";
  return isValidDateKey(stored) ? stored : "";
};
const createInitialForm = (weekEnding = "") => ({
  id: "",
  week_ending: weekEnding,
  driver_id: "",
  vehicle_reg: "",
  mileage: "",
  is_odometer_baseline: false,
  odometer_note: ""
});
const normalizeReg = (value: unknown) =>
  String(value ?? "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/-/g, "")
    .toUpperCase();
const CURRENT_ODOMETER_BELOW_SERVICE_REASON =
  "Current odometer is lower than the last oil change mileage. Please check mileage data.";
const odometerBaselineCopy = {
  en: {
    action: "Start a new odometer baseline",
    helper: "Use when a vehicle changes to a different odometer source. This reading will not be compared with the previous week.",
    badge: "New baseline",
    note: "Odometer note",
    legacy: "Legacy reading"
  },
  th: {
    action: "เริ่มค่าเลขไมล์ใหม่",
    helper: "ใช้เมื่อรถเปลี่ยนแหล่งเลขไมล์ ระบบจะไม่เปรียบเทียบรายการนี้กับสัปดาห์ก่อนหน้า",
    badge: "ค่าเริ่มใหม่",
    note: "หมายเหตุเลขไมล์",
    legacy: "เลขไมล์เดิม"
  }
} as const;

const getServiceLogSortTime = (log: VehicleServiceLog) => {
  const serviceDateTime = log.service_date ? new Date(log.service_date).getTime() : Number.NEGATIVE_INFINITY;
  return {
    serviceDateTime: Number.isNaN(serviceDateTime) ? Number.NEGATIVE_INFINITY : serviceDateTime
  };
};

const compareServiceLogsByLatest = (left: VehicleServiceLog, right: VehicleServiceLog) => {
  const leftTime = getServiceLogSortTime(left);
  const rightTime = getServiceLogSortTime(right);
  const serviceDateDiff = rightTime.serviceDateTime - leftTime.serviceDateTime;
  if (serviceDateDiff !== 0) return serviceDateDiff;
  return String(right.id).localeCompare(String(left.id));
};

type OilActionMode = "set" | "edit" | "mark";
type OilFilter = "all" | "overdue" | "urgent" | "due_soon" | "review_required" | "not_set" | "ok";
type WeeklyMileageUpdateFilter = "all" | "updated_this_week" | "not_updated_this_week";
type OilReportScope = "all" | "overdue" | "urgent_overdue" | "due_soon" | "review_required";
type WeeklyDistanceHistoryFilter = "all" | "last4" | "last8" | "last12" | "year" | "custom";
type WeeklyMileageDebugInfo = {
  userEmail: string | null;
  userId: string | null;
  supabaseUrl: string;
  tables: {
    vehicles: string;
    weeklyMileage: string;
    oilChangeBaselines: string;
    serviceHistory: string;
  };
  filters: Record<string, string>;
  rowCounts: Record<string, number | "failed" | null>;
  errors: Record<string, string | null>;
};
function describeLoadError(error: unknown) {
  if (!error || typeof error !== "object") {
    return error == null ? null : String(error);
  }

  const record = error as Record<string, unknown>;
  const parts = [
    record.message,
    record.code ? `code=${record.code}` : "",
    record.details ? `details=${record.details}` : "",
    record.hint ? `hint=${record.hint}` : "",
    record.query ? `query=${record.query}` : "",
    record.supabaseError ? `supabase=${JSON.stringify(record.supabaseError)}` : ""
  ]
    .map((part) => String(part ?? "").trim())
    .filter(Boolean);

  return parts.length ? parts.join(" | ") : String(error);
}

export default function WeeklyMileagePage() {
  const { language, t } = useLanguage();
  const driverSelectRef = useRef<HTMLSelectElement | null>(null);
  const odometerInputRef = useRef<HTMLInputElement | null>(null);
  const vehicleInputRef = useRef<HTMLInputElement | null>(null);
  const submitActionRef = useRef<"save" | "next">("save");
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [oilChangeBaselines, setOilChangeBaselines] = useState<OilChangeBaseline[]>([]);
  const [serviceLogs, setServiceLogs] = useState<VehicleServiceLog[]>([]);
  const [entries, setEntries] = useState<WeeklyMileageEntry[]>([]);
  const [form, setForm] = useState(() => createInitialForm());
  const [multiEntryMode, setMultiEntryMode] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generatingOilServicePdf, setGeneratingOilServicePdf] = useState(false);
  const [generatingLastOilChangesPdf, setGeneratingLastOilChangesPdf] = useState(false);
  const [generatingWeeklyMileagePdf, setGeneratingWeeklyMileagePdf] = useState(false);
  const [generatingWeeklyDistanceHistoryPdf, setGeneratingWeeklyDistanceHistoryPdf] = useState(false);
  const [weeklyDistanceHistoryOpen, setWeeklyDistanceHistoryOpen] = useState(true);
  const [pageMode, setPageMode] = useState<"mileage" | "results" | "oil">("mileage");
  const [mileageModalOpen, setMileageModalOpen] = useState(false);
  const [expandedOilRows, setExpandedOilRows] = useState<Record<string, boolean>>({});
  const [weeklyDistanceHistoryFilter, setWeeklyDistanceHistoryFilter] = useState<WeeklyDistanceHistoryFilter>("last12");
  const [weeklyDistanceHistoryFrom, setWeeklyDistanceHistoryFrom] = useState("");
  const [weeklyDistanceHistoryTo, setWeeklyDistanceHistoryTo] = useState("");
  const [expandedWeeklyDistanceWeek, setExpandedWeeklyDistanceWeek] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [savingService, setSavingService] = useState(false);
  const serviceMutationRef = useRef(false);
  const refreshCoordinator = useRef(createServiceRefreshCoordinator());
  const [oilFilter, setOilFilter] = useState<OilFilter>("all");
  const [weeklyMileageUpdateFilter, setWeeklyMileageUpdateFilter] = useState<WeeklyMileageUpdateFilter>("all");
  const [serviceModal, setServiceModal] = useState<{
    mode: OilActionMode;
    vehicleId: string | null;
    registration: string;
    vehicleName: string;
    vehicleType: string | null;
    currentOdometer: number | null;
    currentOdometerDate?: string | null;
    serviceLogId?: string | null;
  } | null>(null);
  const [serviceForm, setServiceForm] = useState({
    vehicleReg: "",
    serviceType: "oil_change",
    serviceDate: "",
    serviceOdometer: "",
    intervalKm: "",
    notes: ""
  });
  const [deletingServiceLogId, setDeletingServiceLogId] = useState<string | null>(null);
  const [historyVehicleReg, setHistoryVehicleReg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [assignmentLoadError, setAssignmentLoadError] = useState<string | null>(null);
  const [oilBaselineError, setOilBaselineError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [selectedWeek, setSelectedWeek] = useState("");
  const [comparisonDriverId, setComparisonDriverId] = useState("");
  const [tablePage, setTablePage] = useState(1);
  const [debugInfo, setDebugInfo] = useState<WeeklyMileageDebugInfo | null>(null);
  const isEditing = Boolean(form.id);
  const showWeeklyMileageDebug = process.env.NEXT_PUBLIC_SHOW_DEBUG === "true";
  const fastEntryCopy = language === "th"
    ? {
        multiEntryMode: "กรอกหลายคนขับสำหรับสัปดาห์นี้",
        dateWillRemain: "วันที่จะคงเป็น {date} สำหรับรายการถัดไป",
        saveAndAddNext: "บันทึกและเพิ่มคนขับถัดไป",
        duplicateWarning: "มีรายการระยะทางรายสัปดาห์ของ {driver} วันที่ {date} แล้ว กรุณาแก้ไขรายการเดิมแทนการสร้างซ้ำ",
        saveSuccessForDriver: "บันทึกระยะทางรายสัปดาห์ของ {driver} - {date} แล้ว"
      }
    : {
        multiEntryMode: "Enter multiple drivers for this week",
        dateWillRemain: "Date will remain as {date} for the next entry.",
        saveAndAddNext: "Save & add next driver",
        duplicateWarning: "A weekly mileage entry already exists for {driver} on {date}. Edit the existing record instead of creating a duplicate.",
        saveSuccessForDriver: "Weekly mileage saved for {driver} - {date}."
      };
  const assignmentCopy = useMemo(
    () =>
      language === "th"
        ? {
            selectVehicle: "เลือกรถ",
            searchRegistration: "ค้นหาทะเบียนรถ",
            noDriverAssigned: "ยังไม่มีคนขับที่ผูกกับรถคันนี้",
            assignmentMismatch: "คนขับและรถไม่ตรงกับการผูกประจำ",
            multipleDriversAssigned: "มีคนขับหลายคนผูกกับรถคันนี้ กรุณาเลือกคนขับ",
            unableToLoadAssignments: "ไม่สามารถโหลดข้อมูลการผูกคนขับและรถได้",
            manualVehicleEntry: "พิมพ์ทะเบียนรถเองได้ หากรถยังไม่มีในรายการ",
            vehicleType: "ประเภทรถ"
          }
        : {
            selectVehicle: "Select vehicle",
            searchRegistration: "Search registration",
            noDriverAssigned: "No driver is currently assigned to this vehicle.",
            assignmentMismatch: "Driver and vehicle differ from the normal assignment.",
            multipleDriversAssigned: "Multiple drivers are assigned to this vehicle. Please select one.",
            unableToLoadAssignments: "Unable to load driver and vehicle assignments.",
            manualVehicleEntry: "Manual registration entry is still available when needed.",
            vehicleType: "Vehicle type"
          },
    [language]
  );

  const selectedDriver = useMemo(
    () => drivers.find((driver) => String(driver.id) === String(form.driver_id)),
    [drivers, form.driver_id]
  );

  const activeVehicles = useMemo(
    () =>
      vehicles
        .filter((vehicle) => vehicle.active !== false)
        .filter((vehicle) => normalizeReg(vehicle.vehicle_reg || vehicle.registration))
        .sort((left, right) =>
          String(left.vehicle_reg || left.registration || "").localeCompare(String(right.vehicle_reg || right.registration || ""))
        ),
    [vehicles]
  );
  const vehiclesById = useMemo(
    () => new Map(activeVehicles.map((vehicle) => [String(vehicle.id), vehicle])),
    [activeVehicles]
  );
  const vehiclesByReg = useMemo(() => {
    const map = new Map<string, Vehicle>();
    for (const vehicle of activeVehicles) {
      const key = normalizeReg(vehicle.vehicle_reg || vehicle.registration);
      if (key && !map.has(key)) {
        map.set(key, vehicle);
      }
    }
    return map;
  }, [activeVehicles]);
  const getAssignedVehicleForDriver = useCallback(
    (driver: Driver | undefined) => {
      if (!driver) return null;
      if (driver.assigned_vehicle_id) {
        const assignedVehicle = vehiclesById.get(String(driver.assigned_vehicle_id));
        if (assignedVehicle) return assignedVehicle;
      }
      const fallbackKey = normalizeReg(driver.vehicle_reg);
      return fallbackKey ? vehiclesByReg.get(fallbackKey) ?? null : null;
    },
    [vehiclesById, vehiclesByReg]
  );
  const getAssignedVehicleRegForDriver = useCallback(
    (driver: Driver | undefined) => {
      const assignedVehicle = getAssignedVehicleForDriver(driver);
      return assignedVehicle?.vehicle_reg || assignedVehicle?.registration || driver?.vehicle_reg || "";
    },
    [getAssignedVehicleForDriver]
  );
  const selectedVehicle = useMemo(
    () => vehiclesByReg.get(normalizeReg(form.vehicle_reg)) ?? null,
    [form.vehicle_reg, vehiclesByReg]
  );
  const assignedDriversForSelectedVehicle = useMemo(() => {
    const vehicleKey = normalizeReg(form.vehicle_reg);
    if (!vehicleKey) return [];
    return drivers.filter((driver) => {
      if (driver.active === false) return false;
      if (selectedVehicle?.id && driver.assigned_vehicle_id) {
        return String(driver.assigned_vehicle_id) === String(selectedVehicle.id);
      }
      if (driver.assigned_vehicle_id) return false;
      return normalizeReg(driver.vehicle_reg) === vehicleKey;
    });
  }, [drivers, form.vehicle_reg, selectedVehicle]);
  const selectedDriverAssignedVehicleReg = getAssignedVehicleRegForDriver(selectedDriver);
  const hasManualAssignmentMismatch =
    Boolean(selectedDriver && form.vehicle_reg && selectedDriverAssignedVehicleReg) &&
    normalizeReg(selectedDriverAssignedVehicleReg) !== normalizeReg(form.vehicle_reg);
  const showNoAssignedDriver =
    Boolean(form.vehicle_reg && selectedVehicle && !form.driver_id && assignedDriversForSelectedVehicle.length === 0);
  const showMultipleAssignedDrivers =
    Boolean(form.vehicle_reg && !form.driver_id && assignedDriversForSelectedVehicle.length > 1);

  useEffect(() => {
    const storedWeekEnding = getStoredWeekEnding();
    if (storedWeekEnding) {
      setForm((current) => (current.week_ending ? current : { ...current, week_ending: storedWeekEnding }));
    }
  }, []);

  const sortedEntries = useMemo(
    () =>
      [...entries].sort((a, b) => {
        const dateDiff = new Date(b.week_ending).getTime() - new Date(a.week_ending).getTime();
        if (dateDiff !== 0) return dateDiff;
        return String(b.id).localeCompare(String(a.id));
      }),
    [entries]
  );

  const weeklyVehicleRows = useMemo(() => computeWeeklyMileageByVehicle(sortedEntries), [sortedEntries]);
  const weeklySummaryRows = useMemo(
    () => buildWeeklyMileageSummary(sortedEntries, vehicles, drivers),
    [drivers, sortedEntries, vehicles]
  );
  const weeklyDistanceHistoryRows = useMemo(
    () => buildWeeklyDistanceHistoryRows(sortedEntries, vehicles, drivers),
    [drivers, sortedEntries, vehicles]
  );
  const activeWeeklyDistanceHistoryFilter =
    weeklyDistanceHistoryRows.length <= 12 && weeklyDistanceHistoryFilter === "last12"
      ? "all"
      : weeklyDistanceHistoryFilter;
  const filteredWeeklyDistanceHistoryRows = useMemo(() => {
    if (activeWeeklyDistanceHistoryFilter === "last4") {
      return weeklyDistanceHistoryRows.slice(0, 4);
    }
    if (activeWeeklyDistanceHistoryFilter === "last8") {
      return weeklyDistanceHistoryRows.slice(0, 8);
    }
    if (activeWeeklyDistanceHistoryFilter === "last12") {
      return weeklyDistanceHistoryRows.slice(0, 12);
    }
    if (activeWeeklyDistanceHistoryFilter === "year") {
      const currentYear = String(new Date().getFullYear());
      return weeklyDistanceHistoryRows.filter((row) => row.weekEnding.slice(0, 4) === currentYear);
    }
    if (activeWeeklyDistanceHistoryFilter === "custom") {
      return weeklyDistanceHistoryRows.filter((row) => {
        const afterStart = weeklyDistanceHistoryFrom ? row.weekEnding >= weeklyDistanceHistoryFrom : true;
        const beforeEnd = weeklyDistanceHistoryTo ? row.weekEnding <= weeklyDistanceHistoryTo : true;
        return afterStart && beforeEnd;
      });
    }
    return weeklyDistanceHistoryRows;
  }, [
    activeWeeklyDistanceHistoryFilter,
    weeklyDistanceHistoryFrom,
    weeklyDistanceHistoryRows,
    weeklyDistanceHistoryTo
  ]);
  const weeklyDistanceHistorySummary = useMemo(
    () => buildWeeklyDistanceHistorySummary(filteredWeeklyDistanceHistoryRows),
    [filteredWeeklyDistanceHistoryRows]
  );
  const rankedWeeklyDistanceHistoryRows = useMemo(
    () =>
      [...filteredWeeklyDistanceHistoryRows].sort((a, b) => {
        const distanceDiff = Number(b.weeklyDistance || 0) - Number(a.weeklyDistance || 0);
        if (distanceDiff !== 0) return distanceDiff;
        return String(b.weekEnding).localeCompare(String(a.weekEnding));
      }),
    [filteredWeeklyDistanceHistoryRows]
  );
  const driverComparisonRows = useMemo(
    () => buildDriverWeeklyComparisons(sortedEntries),
    [sortedEntries]
  );
  const oilChangeRows = useMemo(() => buildOilServiceSnapshot({ vehicles, baselines: oilChangeBaselines, logs: serviceLogs, mileage: sortedEntries, drivers }),
    [drivers, oilChangeBaselines, serviceLogs, sortedEntries, vehicles]);
  const oilSummary = useMemo(
    () => ({
      overdue: oilChangeRows.filter((row) => row.status === "overdue").length,
      urgent: oilChangeRows.filter((row) => row.status === "urgent").length,
      due_soon: oilChangeRows.filter((row) => row.status === "due_soon").length,
      ok: oilChangeRows.filter((row) => row.status === "ok").length,
      not_set: oilChangeRows.filter((row) => row.status === "not_set").length,
      review_required: oilChangeRows.filter((row) => row.status === "review_required").length
    }),
    [oilChangeRows]
  );
  const oilReportSummary = useMemo(
    () => ({
      overdue: oilChangeRows.filter((row) => row.status === "overdue").length,
      urgent: oilChangeRows.filter((row) => row.status === "urgent").length,
      dueSoon: oilChangeRows.filter((row) => row.status === "due_soon").length,
      reviewRequired: oilChangeRows.filter((row) => row.status === "review_required" || row.status === "not_set" || row.status === "no_odometer").length,
      ok: oilChangeRows.filter((row) => row.status === "ok").length
    }),
    [oilChangeRows]
  );
  const weeklyMileageUpdateSummary = useMemo(
    () => ({
      total: oilChangeRows.length,
      updatedThisWeek: oilChangeRows.filter(
        (row) => row.lastWeeklyMileageDate && row.weeklyMileageUpdatedThisWeek
      ).length,
      notUpdatedThisWeek: oilChangeRows.filter(
        (row) => row.lastWeeklyMileageDate && !row.weeklyMileageUpdatedThisWeek
      ).length
    }),
    [oilChangeRows]
  );
  const filteredOilChangeRows = useMemo(
    () => {
      const statusFilteredRows =
        oilFilter === "all"
          ? oilChangeRows
          : oilChangeRows.filter((row) => row.status === oilFilter);

      if (weeklyMileageUpdateFilter === "updated_this_week") {
        return statusFilteredRows.filter(
          (row) => row.lastWeeklyMileageDate && row.weeklyMileageUpdatedThisWeek
        );
      }

      if (weeklyMileageUpdateFilter === "not_updated_this_week") {
        return statusFilteredRows.filter(
          (row) => row.lastWeeklyMileageDate && !row.weeklyMileageUpdatedThisWeek
        );
      }

      return statusFilteredRows;
    },
    [oilChangeRows, oilFilter, weeklyMileageUpdateFilter]
  );
  const serviceLogsByVehicle = useMemo(() => {
    const map = new Map<string, VehicleServiceLog[]>();
    for (const log of serviceLogs) {
      const key = normalizeReg(log.vehicle_reg);
      if (!key) continue;
      map.set(key, [...(map.get(key) ?? []), log]);
    }
    for (const [key, logs] of map.entries()) {
      map.set(key, [...logs].sort(compareServiceLogsByLatest));
    }
    return map;
  }, [serviceLogs]);

  const availableWeeks = useMemo(
    () => Array.from(new Set(sortedEntries.map((entry) => entry.week_ending))),
    [sortedEntries]
  );
  const selectedWeekValue = selectedWeek || availableWeeks[0] || "";
  const selectedWeekEntries = useMemo(
    () => sortedEntries.filter((entry) => entry.week_ending === selectedWeekValue),
    [selectedWeekValue, sortedEntries]
  );
  const selectedWeekVehicleKeys = useMemo(
    () => new Set(selectedWeekEntries.map((entry) => normalizeReg(entry.vehicle_reg)).filter(Boolean)),
    [selectedWeekEntries]
  );

  const missingVehiclesForSelectedWeek = useMemo(
    () =>
      activeVehicles
        .map((vehicle) => {
          const registration = String(vehicle.vehicle_reg || vehicle.registration || "").trim();
          if (!registration || selectedWeekVehicleKeys.has(normalizeReg(registration))) return null;

          const assignedDriver =
            drivers.find((driver) => {
              if (driver.active === false) return false;
              if (vehicle.id && driver.assigned_vehicle_id) {
                return String(driver.assigned_vehicle_id) === String(vehicle.id);
              }
              return normalizeReg(driver.vehicle_reg) === normalizeReg(registration);
            }) ?? null;

          return { vehicle, registration, driver: assignedDriver };
        })
        .filter(Boolean) as Array<{ vehicle: Vehicle; registration: string; driver: Driver | null }>,
    [activeVehicles, drivers, selectedWeekVehicleKeys]
  );

  const selectedWeekOperationalRows = useMemo(() => {
    const result = new Map<
      string,
      { previousEntry: WeeklyMileageEntry | null; weeklyKm: number | null; status: "ready" | "baseline" | "review" | "no_previous" }
    >();

    for (const entry of selectedWeekEntries) {
      const vehicleKey = normalizeReg(entry.vehicle_reg);
      const previousEntry =
        sortedEntries.find(
          (candidate) =>
            candidate.week_ending < entry.week_ending &&
            normalizeReg(candidate.vehicle_reg) === vehicleKey
        ) ?? null;

      const currentMileage = Number(entry.mileage);
      const previousMileage = previousEntry?.mileage == null ? null : Number(previousEntry.mileage);
      const weeklyKm =
        entry.is_odometer_baseline ||
        previousMileage == null ||
        !Number.isFinite(currentMileage) ||
        !Number.isFinite(previousMileage)
          ? null
          : currentMileage - previousMileage;

      result.set(String(entry.id), {
        previousEntry,
        weeklyKm,
        status: entry.is_odometer_baseline
          ? "baseline"
          : previousEntry == null
            ? "no_previous"
            : weeklyKm != null && weeklyKm < 0
              ? "review"
              : "ready"
      });
    }

    return result;
  }, [selectedWeekEntries, sortedEntries]);

  const openMileageEntry = (weekEnding = selectedWeekValue) => {
    setForm(createInitialForm(weekEnding));
    setError(null);
    setSuccessMessage(null);
    setMileageModalOpen(true);
  };

  const openMileageEdit = (entry: WeeklyMileageEntry) => {
    setForm({
      id: String(entry.id),
      week_ending: entry.week_ending,
      driver_id: String(entry.driver_id),
      vehicle_reg: entry.vehicle_reg,
      mileage: String(entry.mileage),
      is_odometer_baseline: entry.is_odometer_baseline === true,
      odometer_note: entry.odometer_note ?? ""
    });
    setError(null);
    setSuccessMessage(null);
    setMileageModalOpen(true);
  };
  const selectedWeekSummary =
    weeklySummaryRows.find((row) => row.weekEnding === selectedWeekValue) ?? weeklySummaryRows[0] ?? null;
  const selectedWeekHistoryRow = weeklyDistanceHistoryRows.find((row) => row.weekEnding === selectedWeekValue) ?? null;
  const selectedWeekHistoryMatchesSummary =
    !selectedWeekSummary ||
    !selectedWeekHistoryRow ||
    selectedWeekHistoryRow.weeklyDistance === selectedWeekSummary.weeklyDistance;
  const selectedWeekEntriesRanked = useMemo(
    () =>
      [...selectedWeekEntries].sort((a, b) => {
        const aDistance = selectedWeekOperationalRows.get(String(a.id))?.weeklyKm;
        const bDistance = selectedWeekOperationalRows.get(String(b.id))?.weeklyKm;
        const aValue = aDistance == null || !Number.isFinite(aDistance) ? Number.NEGATIVE_INFINITY : aDistance;
        const bValue = bDistance == null || !Number.isFinite(bDistance) ? Number.NEGATIVE_INFINITY : bDistance;
        if (bValue !== aValue) return bValue - aValue;
        return String(a.vehicle_reg || "").localeCompare(String(b.vehicle_reg || ""));
      }),
    [selectedWeekEntries, selectedWeekOperationalRows]
  );
  const selectedWeekTotalPages = Math.max(1, Math.ceil(selectedWeekEntriesRanked.length / PAGE_SIZE));
  const pagedEntries = useMemo(() => {
    const safePage = Math.min(tablePage, selectedWeekTotalPages);
    const startIndex = (safePage - 1) * PAGE_SIZE;
    return selectedWeekEntriesRanked.slice(startIndex, startIndex + PAGE_SIZE);
  }, [selectedWeekEntriesRanked, selectedWeekTotalPages, tablePage]);
  const selectedWeekIndex = availableWeeks.findIndex((week) => week === selectedWeekValue);
  const previousWeekValue =
    selectedWeekIndex >= 0 && selectedWeekIndex < availableWeeks.length - 1
      ? availableWeeks[selectedWeekIndex + 1]
      : null;
  const nextWeekValue = selectedWeekIndex > 0 ? availableWeeks[selectedWeekIndex - 1] : null;

  const comparisonDrivers = useMemo(
    () =>
      drivers
        .filter((driver) =>
          driverComparisonRows.some((row) => String(row.driverId) === String(driver.id))
        )
        .sort((a, b) => a.name.localeCompare(b.name)),
    [driverComparisonRows, drivers]
  );
  const weeklyDistanceByDriverRows = useMemo(
    () =>
      driverComparisonRows
        .filter((row) => row.latestWeekEnding === selectedWeekValue)
        .filter((row) => row.previousWeekEnding && row.weeklyDistance != null)
        .sort((a, b) => Number(b.weeklyDistance) - Number(a.weeklyDistance)),
    [driverComparisonRows, selectedWeekValue]
  );
  const selectedComparison = useMemo(
    () =>
      comparisonDriverId
        ? driverComparisonRows.find((row) => String(row.driverId) === String(comparisonDriverId)) ?? null
        : null,
    [comparisonDriverId, driverComparisonRows]
  );
  const selectedComparisonHistory = selectedComparison?.history.slice(0, 5) ?? [];

  const previousVehicleEntry = useMemo(() => {
    if (!form.vehicle_reg || !form.week_ending) return null;
    return (
      weeklyVehicleRows.find(
        (row) => row.vehicleReg === form.vehicle_reg && row.weekEnding < form.week_ending
      )?.latestEntry ?? null
    );
  }, [form.vehicle_reg, form.week_ending, weeklyVehicleRows]);

  const weeklyDifference =
    !form.is_odometer_baseline && previousVehicleEntry && form.mileage && Number.isFinite(Number(form.mileage))
      ? Number(form.mileage) - Number(previousVehicleEntry.mileage || 0)
      : null;
  const baselineCopy = odometerBaselineCopy[language === "th" ? "th" : "en"];

  const loadData = useCallback(() => refreshCoordinator.current.run(async () => {
    setLoading(true);
    setError(null);
    setLoadError(null);
    setAssignmentLoadError(null);
    setOilBaselineError(null);
    setDebugInfo(null);
    const authResult = showWeeklyMileageDebug ? await withRequestDeadline(() => supabase.auth.getUser()).catch(error => ({ data: { user: null }, error: { message: describeLoadError(error) } })) : null;
    const queryFilters = {
      vehicles: "select * from vehicles order by vehicle_reg; no client user_id/company_id filter",
      weeklyMileage:
        "select id, week_ending, driver_id, vehicle_reg, odometer_reading, created_at, user_id from weekly_mileage; no client user_id/company_id filter",
      oilChangeBaselines: "select * from oil_change_baselines; merged into cards by normalizeReg(vehicle_reg); no client user_id/company_id filter",
      serviceHistory: "select * from vehicle_service_logs where service_type is null or service_type = oil_change, plus legacy oil_change_history; newest service_date wins; no client user_id/company_id filter"
    };

    const [driverResult, vehicleResult, mileageResult, serviceLogResult] = await Promise.allSettled([
      fetchDrivers(),
      fetchVehicles(),
      fetchWeeklyMileage(),
      fetchOilChangeHistory()
    ]);
    const baselineResult =
      vehicleResult.status === "fulfilled"
        ? await fetchOilChangeBaselinesForVehicles(vehicleResult.value)
            .then((value) => ({ status: "fulfilled" as const, value }))
            .catch((reason) => ({ status: "rejected" as const, reason }))
        : ({ status: "rejected" as const, reason: new Error("Skipped oil baseline lookup because vehicles failed to load.") });

    if (driverResult.status === "fulfilled") {
      setDrivers(driverResult.value);
    } else {
      console.error("Weekly mileage drivers query failed:", driverResult.reason);
      setDrivers([]);
    }

    if (vehicleResult.status === "fulfilled") {
      setVehicles(vehicleResult.value);
    } else {
      console.error("Weekly mileage vehicles query failed:", vehicleResult.reason);
      setVehicles([]);
      setAssignmentLoadError(assignmentCopy.unableToLoadAssignments);
    }

    if (baselineResult.status === "fulfilled") {
      setOilChangeBaselines(baselineResult.value);
    } else {
      setOilChangeBaselines([]);
    }

    if (baselineResult.status === "rejected") {
      console.error("Weekly mileage oil baselines query failed:", baselineResult.reason);
      setOilBaselineError(
        t.weeklyMileage.notifications.loadFailed.replace(
          "{items}",
          language === "th" ? "ข้อมูลพื้นฐานการเปลี่ยนน้ำมัน" : "oil baselines"
        )
      );
    }

    if (mileageResult.status === "fulfilled") {
      setEntries(mileageResult.value);
    } else {
      console.error("Weekly mileage records query failed:", mileageResult.reason);
      setEntries([]);
    }

    if (serviceLogResult.status === "fulfilled") {
      setServiceLogs(serviceLogResult.value);
    } else {
      console.error("Weekly mileage service logs query failed:", serviceLogResult.reason);
      setServiceLogs([]);
    }

    const criticalFailures = [
      driverResult.status === "rejected" ? t.nav.drivers : "",
      mileageResult.status === "rejected" ? t.weeklyMileage.title : "",
      serviceLogResult.status === "rejected" ? (language === "th" ? "ประวัติการบริการ" : "service history") : ""
    ].filter(Boolean);

    if (criticalFailures.length) {
      setLoadError(t.weeklyMileage.notifications.loadFailed.replace("{items}", criticalFailures.join(language === "th" ? " และ " : " and ")));
    }

    if (showWeeklyMileageDebug) {
      setDebugInfo({
        userEmail: authResult?.data.user?.email ?? null,
        userId: authResult?.data.user?.id ?? null,
        supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "missing",
        tables: {
          vehicles: "public.vehicles",
          weeklyMileage: "public.weekly_mileage",
          oilChangeBaselines: "public.oil_change_baselines",
          serviceHistory: "public.vehicle_service_logs + public.oil_change_history"
        },
        filters: queryFilters,
        rowCounts: {
          drivers: driverResult.status === "fulfilled" ? driverResult.value.length : "failed",
          vehicles: vehicleResult.status === "fulfilled" ? vehicleResult.value.length : "failed",
          weeklyMileage: mileageResult.status === "fulfilled" ? mileageResult.value.length : "failed",
          oilChangeBaselines: baselineResult.status === "fulfilled" ? baselineResult.value.length : "failed",
          serviceHistory: serviceLogResult.status === "fulfilled" ? serviceLogResult.value.length : "failed"
        },
        errors: {
          auth: authResult?.error?.message ?? null,
          drivers: driverResult.status === "rejected" ? describeLoadError(driverResult.reason) : null,
          vehicles: vehicleResult.status === "rejected" ? describeLoadError(vehicleResult.reason) : null,
          weeklyMileage: mileageResult.status === "rejected" ? describeLoadError(mileageResult.reason) : null,
          oilChangeBaselines: baselineResult.status === "rejected" ? describeLoadError(baselineResult.reason) : null,
          serviceHistory: serviceLogResult.status === "rejected" ? describeLoadError(serviceLogResult.reason) : null
        }
      });
    }

    setLoading(false);
  }), [assignmentCopy.unableToLoadAssignments, language, showWeeklyMileageDebug, t.nav.drivers, t.weeklyMileage.notifications.loadFailed, t.weeklyMileage.title]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    const handleDataChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ resource?: string; resources?: string[] }>).detail;
      const resources = detail?.resources ?? [detail?.resource];
      if (detail?.resource && !resources.some(resource => ["drivers", "vehicles", "weekly_mileage", "vehicle_service_logs", "oil_change_history", "oil_change_baselines"].includes(resource ?? ""))) return;
      refreshCoordinator.current.invalidate();
      void loadData();
    };
    window.addEventListener("fuel-bank:data-changed", handleDataChanged);
    return () => window.removeEventListener("fuel-bank:data-changed", handleDataChanged);
  }, [loadData]);

  useEffect(() => {
    if (!availableWeeks.length) {
      setSelectedWeek("");
      return;
    }
    if (!selectedWeek || !availableWeeks.includes(selectedWeek)) {
      setSelectedWeek(availableWeeks[0]);
    }
  }, [availableWeeks, selectedWeek]);

  useEffect(() => {
    setTablePage(1);
  }, [selectedWeekValue]);

  const rememberWeekEnding = (weekEnding: string) => {
    if (typeof window === "undefined") return;
    if (isValidDateKey(weekEnding)) {
      safeLocalStorage.setItem(WEEKLY_MILEAGE_SELECTED_WEEK_KEY, weekEnding);
    }
  };

  const focusDriverSelect = () => {
    window.setTimeout(() => driverSelectRef.current?.focus(), 0);
  };

  const resetForm = (clearMessages = true, options?: { keepWeekEnding?: boolean; weekEnding?: string; focusDriver?: boolean }) => {
    const nextWeekEnding = options?.keepWeekEnding ? options.weekEnding ?? form.week_ending : "";
    setForm(createInitialForm(nextWeekEnding));
    setError(null);
    if (clearMessages) setSuccessMessage(null);
    if (options?.focusDriver) {
      focusDriverSelect();
    }
  };

  const handleInvalid = (
    event: React.InvalidEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => applyRequiredValidationMessage(event, t.common.requiredField);

  const getDriversAssignedToVehicle = useCallback(
    (vehicleReg: string) => {
      const selectedKey = normalizeReg(vehicleReg);
      if (!selectedKey) return [];
      const matchedVehicle = vehiclesByReg.get(selectedKey) ?? null;

      return drivers.filter((driver) => {
        if (driver.active === false) return false;
        if (matchedVehicle?.id && driver.assigned_vehicle_id) {
          return String(driver.assigned_vehicle_id) === String(matchedVehicle.id);
        }
        if (driver.assigned_vehicle_id) return false;
        return normalizeReg(driver.vehicle_reg) === selectedKey;
      });
    },
    [drivers, vehiclesByReg]
  );

  const handleDriverChange = (driverId: string) => {
    const nextDriver = drivers.find((driver) => String(driver.id) === String(driverId));
    const assignedVehicleReg = getAssignedVehicleRegForDriver(nextDriver);

    setForm((current) => ({
      ...current,
      driver_id: driverId,
      vehicle_reg: driverId ? assignedVehicleReg : current.vehicle_reg
    }));

    window.setTimeout(() => {
      if (driverId && assignedVehicleReg) {
        odometerInputRef.current?.focus();
      } else if (driverId) {
        vehicleInputRef.current?.focus();
      }
    }, 0);
  };

  const handleVehicleRegChange = (vehicleReg: string) => {
    const assignedDrivers = getDriversAssignedToVehicle(vehicleReg);

    setForm((current) => {
      if (!normalizeReg(vehicleReg)) {
        return { ...current, vehicle_reg: vehicleReg };
      }

      if (current.driver_id) {
        return { ...current, vehicle_reg: vehicleReg };
      }

      return {
        ...current,
        vehicle_reg: vehicleReg,
        driver_id: assignedDrivers.length === 1 ? String(assignedDrivers[0].id) : ""
      };
    });
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    const shouldAddNext = !isEditing && (submitActionRef.current === "next" || multiEntryMode);
    setSaving(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const mileage = Number(form.mileage);
      if (!form.driver_id || !form.vehicle_reg || !form.week_ending || !Number.isFinite(mileage)) {
        throw new Error(t.common.requiredField);
      }
      if (
        !form.is_odometer_baseline &&
        previousVehicleEntry?.mileage != null &&
        mileage < Number(previousVehicleEntry.mileage) &&
        !window.confirm(t.weeklyMileage.mileageValidationError)
      ) {
        throw new Error(t.weeklyMileage.mileageValidationError);
      }
      const duplicateEntry = entries.find((entry) => {
        if (form.id && String(entry.id) === String(form.id)) return false;
        if (entry.week_ending !== form.week_ending) return false;
        const sameDriver = String(entry.driver_id) === String(form.driver_id);
        const sameVehicle = normalizeReg(entry.vehicle_reg) === normalizeReg(form.vehicle_reg);
        return sameDriver || sameVehicle;
      });

      if (duplicateEntry) {
        const duplicateDriver = drivers.find((driver) => String(driver.id) === String(duplicateEntry.driver_id));
        const duplicateName = duplicateDriver?.name || duplicateEntry.driver || selectedDriver?.name || t.weeklyMileage.driver;
        throw new Error(
          fastEntryCopy.duplicateWarning
            .replace("{driver}", duplicateName)
            .replace("{date}", formatDate(form.week_ending, language))
        );
      }

      const savedEntry = await saveWeeklyMileage({
        id: form.id || undefined,
        week_ending: form.week_ending,
        driver_id: form.driver_id,
        vehicle_reg: form.vehicle_reg,
        odometer_reading: mileage,
        is_odometer_baseline: form.is_odometer_baseline,
        odometer_note: form.odometer_note
      });

      setSelectedWeek(savedEntry.week_ending ?? form.week_ending);
      rememberWeekEnding(savedEntry.week_ending ?? form.week_ending);
      resetForm(false, {
        keepWeekEnding: shouldAddNext,
        weekEnding: savedEntry.week_ending ?? form.week_ending,
        focusDriver: shouldAddNext && !isEditing
      });
      setSuccessMessage(
        isEditing
          ? t.weeklyMileage.notifications.updateSuccess
          : fastEntryCopy.saveSuccessForDriver
              .replace("{driver}", savedEntry.driver || selectedDriver?.name || "")
              .replace("{date}", formatDate(savedEntry.week_ending ?? form.week_ending, language))
      );
      if (!shouldAddNext || isEditing) {
        setMileageModalOpen(false);
      }
      await loadData();
    } catch (err) {
      console.error("Weekly mileage save error:", err);
      setError(err instanceof Error && err.message ? err.message : t.weeklyMileage.errorSave);
    } finally {
      submitActionRef.current = "save";
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm(t.weeklyMileage.deleteConfirm)) return;
    try {
      setDeletingId(id);
      setError(null);
      setSuccessMessage(null);
      await deleteWeeklyMileage(id);
      if (form.id === id) resetForm();
      setSuccessMessage(t.weeklyMileage.notifications.deleteSuccess);
      await loadData();
    } catch (err) {
      console.error("Weekly mileage delete error:", err);
      setError(err instanceof Error && err.message ? err.message : t.weeklyMileage.deleteError);
    } finally {
      setDeletingId(null);
    }
  };

  const oilStatusLabel = (status: string) => {
    if(status==='not_applicable')return centreCopy[language].notApplicable;
    if(status==='condition_based')return centreCopy[language].condition;
    if (status === "ok") return oilReportCopy.ok;
    if (status === "due_soon") return oilReportCopy.dueSoon;
    if (status === "urgent") return oilReportCopy.urgent;
    if (status === "overdue") return oilReportCopy.overdue;
    if (status === "review_required" || status === "no_odometer") return oilReportCopy.reviewRequired;
    return oilReportCopy.notSet;
  };

  const hasMileageDataIssue = (row: OilChangeAlertRow) =>
    row.reviewReasons.includes(CURRENT_ODOMETER_BELOW_SERVICE_REASON);

  const oilStatusLabelForRow = (row: OilChangeAlertRow) =>
    hasMileageDataIssue(row) ? oilReportCopy.mileageDataIssue : oilStatusLabel(row.status);

  const OilStatusIcon = ({ status, className = "h-3.5 w-3.5" }: { status: string; className?: string }) =>
    status === "ok" ? (
      <CircleCheck aria-hidden="true" className={className} />
    ) : status === "overdue" || status === "urgent" || status === "due_soon" ? (
      <AlertTriangle aria-hidden="true" className={className} />
    ) : (
      <span aria-hidden="true" className={`inline-block rounded-full bg-current ${className}`} />
    );

  const oilStatusClass = (status: string) => {
    if (status === "ok") return "border-emerald-200 bg-emerald-50 text-emerald-700";
    if (status === "due_soon") return "border-amber-200 bg-amber-50 text-amber-800";
    if (status === "urgent") return "border-orange-200 bg-orange-50 text-orange-800";
    if (status === "overdue") return "border-rose-200 bg-rose-50 text-rose-700";
    if (status === "review_required") return "border-sky-200 bg-sky-50 text-sky-800";
    return "border-slate-200 bg-slate-50 text-slate-600";
  };

  const oilCardClass = (status: string) => {
    if (status === "overdue") return "border-rose-400 bg-rose-50/80 shadow-[0_16px_45px_rgba(225,29,72,0.12)]";
    if (status === "urgent") return "border-orange-300 bg-orange-50/80 shadow-[0_14px_38px_rgba(234,88,12,0.10)]";
    if (status === "due_soon") return "border-amber-300 bg-amber-50/70";
    if (status === "ok") return "border-emerald-100 bg-white";
    return "border-slate-200 bg-white";
  };

  const progressBarClass = (status: string) => {
    if (status === "overdue") return "bg-rose-600";
    if (status === "urgent") return "bg-orange-500";
    if (status === "due_soon") return "bg-amber-400";
    if (status === "ok") return "bg-emerald-500";
    return "bg-slate-300";
  };

  const kmRemainingClass = (kmRemaining: number | null) => {
    if (kmRemaining == null) return "text-slate-400";
    if (kmRemaining < 0) return "text-rose-700";
    if (kmRemaining <= 1000) return "text-orange-700";
    return "text-slate-950";
  };

  const getServiceProgress = (row: (typeof oilChangeRows)[number]) => {
    if (
      row.lastOilChangeOdometer == null ||
      row.currentOdometer == null ||
      row.nextOilChangeDueOdometer == null ||
      row.oilChangeIntervalKm == null ||
      row.oilChangeIntervalKm <= 0
    ) {
      return null;
    }

    const usedKm = row.kmUsedSinceOilChange ?? row.currentOdometer - row.lastOilChangeOdometer;
    const safeUsedKm = Math.max(0, usedKm);
    const realPercent = (safeUsedKm / row.oilChangeIntervalKm) * 100;
    const displayPercent =
      safeUsedKm === 0
        ? "0"
        : realPercent < 1
          ? (Math.ceil(realPercent * 10) / 10).toFixed(1)
          : (Math.round(realPercent * 10) / 10).toFixed(realPercent >= 10 && Number.isInteger(Math.round(realPercent * 10) / 10) ? 0 : 1);
    const barPercent = safeUsedKm > 0 ? Math.max(Math.min(realPercent, 100), 1) : 0;

    return {
      realPercent,
      displayPercent,
      barPercent,
      usedKm: safeUsedKm
    };
  };

  const actionLine = (row: (typeof oilChangeRows)[number]) => {
    if (row.status === "overdue" && row.overdueKm != null) {
      return `${oilReportCopy.overdueBy} ${formatKmValue(row.overdueKm)}`;
    }
    if (row.kmRemaining === 0) {
      return t.weeklyMileage.oil.actionDueNow;
    }
    if (row.status === "urgent" && row.kmRemaining != null) {
      return oilReportCopy.actionDueIn.replace("{km}", formatKmValue(row.kmRemaining));
    }
    if (row.status === "due_soon" && row.kmRemaining != null) {
      return oilReportCopy.actionDueIn.replace("{km}", formatKmValue(row.kmRemaining));
    }
    if (row.status === "ok") {
      return oilReportCopy.ok;
    }
    return oilStatusLabelForRow(row);
  };

  const reviewReasonLabel = (reason: string) => {
    if (reason === "Missing vehicle type") return t.weeklyMileage.oil.missingVehicleType;
    if (reason === "Missing oil change interval") return t.weeklyMileage.oil.missingOilChangeInterval;
    if (reason === CURRENT_ODOMETER_BELOW_SERVICE_REASON) {
      return t.weeklyMileage.oil.currentLowerThanLastOilChange;
    }
    return reason;
  };

  const vehicleTypeLabel = (vehicleType: string | null) => {
    if (!vehicleType) return t.weeklyMileage.oil.missingVehicleType;
    return (
      t.weeklyMileage.oil.vehicleTypes[
        vehicleType as keyof typeof t.weeklyMileage.oil.vehicleTypes
      ] ?? vehicleType
    );
  };

  const formatKmValue = (value: number | null) =>
    value != null && Number.isFinite(value) ? formatNumber(value, language) : "-";

  const formatSignedKm = (value: number | null) =>
    value == null || !Number.isFinite(value)
      ? "-"
      : `${value > 0 ? "+" : ""}${formatNumber(value, language, 0)} KM`;

  const formatPercentValue = (value: number | null) =>
    value == null || !Number.isFinite(value)
      ? "-"
      : `${value > 0 ? "+" : ""}${formatNumber(value, language, 1)}%`;

  const formatWeekChangeLabel = (row: { previousWeekEnding: string | null; weekOnWeekChangePercent: number | null }) => {
    if (!row.previousWeekEnding || row.weekOnWeekChangePercent == null) {
      return weeklyDistanceHistoryCopy.noPreviousWeek;
    }
    const direction = row.weekOnWeekChangePercent > 0 ? "up" : row.weekOnWeekChangePercent < 0 ? "down" : "flat";
    const arrow = direction === "up" ? "↑" : direction === "down" ? "↓" : "→";
    return `${arrow} ${formatNumber(Math.abs(row.weekOnWeekChangePercent), language, 1)}% vs ${formatDate(row.previousWeekEnding, language)}`;
  };

  const changeToneClass = (value: number | null) =>
    value == null || value === 0
      ? "text-slate-500"
      : value > 0
        ? "text-emerald-700"
        : "text-rose-700";

  const formatCompleteness = (valid: number, expected: number) =>
    `${formatNumber(valid, language, 0)} / ${formatNumber(expected, language, 0)}`;

  const parseDateValue = (value: string | null | undefined) => {
    if (!value) return null;
    const isoDateMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const parsed = isoDateMatch
      ? new Date(Number(isoDateMatch[1]), Number(isoDateMatch[2]) - 1, Number(isoDateMatch[3]))
      : new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };

  const getDaysSinceWeeklyMileageAdded = (addedAt: string | null) => {
    const parsed = parseDateValue(addedAt);
    if (!parsed) return null;
    const now = new Date();
    const diff = now.getTime() - parsed.getTime();
    return Math.max(0, Math.floor(diff / (24 * 60 * 60 * 1000)));
  };

  const formatWeeklyMileageAddedAge = (addedAt: string | null) => {
    const days = getDaysSinceWeeklyMileageAdded(addedAt);
    if (days == null) return "";
    if (days === 0) return t.weeklyMileage.oil.addedToday;
    if (days === 1) return t.weeklyMileage.oil.addedOneDayAgo;
    return t.weeklyMileage.oil.addedDaysAgo.replace("{days}", formatNumber(days, language));
  };

  const todayKey = () =>
    new Intl.DateTimeFormat("en-CA", {
      day: "2-digit",
      month: "2-digit",
      timeZone: "Asia/Bangkok",
      year: "numeric"
    }).format(new Date());
  const getLatestServiceLog = (registration: string) =>
    serviceLogsByVehicle.get(normalizeReg(registration))?.[0] ?? null;
  const getVehicleBaselineHistoryLog = (registration: string): VehicleServiceLog | null => {
    const key = normalizeReg(registration);
    const vehicle = vehicles.find((item) => normalizeReg(item.vehicle_reg || item.registration) === key);
    if (!vehicle?.last_oil_change_date || vehicle.last_oil_change_odometer == null) {
      return null;
    }

    const odometer = Number(vehicle.last_oil_change_odometer);
    const intervalKm =
      vehicle.oil_change_interval_km != null && Number.isFinite(Number(vehicle.oil_change_interval_km))
        ? Number(vehicle.oil_change_interval_km)
        : null;

    return {
      id: `vehicle-baseline-${key}-${vehicle.last_oil_change_date}`,
      vehicle_id: vehicle.id,
      vehicle_reg: vehicle.vehicle_reg || registration,
      service_type: "oil_change",
      service_date: vehicle.last_oil_change_date,
      odometer,
      oil_change_odometer: odometer,
      service_odometer: odometer,
      interval_km: intervalKm,
      next_service_due_odometer: intervalKm != null ? Math.trunc(odometer + intervalKm) : null,
      vehicle_type_snapshot: vehicle.vehicle_type ?? null,
      notes: t.weeklyMileage.oil.oilChangedNote,
      created_at: vehicle.last_oil_change_date
    };
  };

  const appendBaselineHistoryLog = (registration: string, logs: VehicleServiceLog[]) => {
    const baselineLog = getVehicleBaselineHistoryLog(registration);
    if (!baselineLog) {
      return logs;
    }

    const baselineOdometer = Number(baselineLog.oil_change_odometer ?? baselineLog.odometer);
    const alreadyIncluded = logs.some((log) => {
      const logOdometer = Number(log.oil_change_odometer ?? log.odometer);
      return log.service_date === baselineLog.service_date && logOdometer === baselineOdometer;
    });

    return alreadyIncluded
      ? logs
      : [...logs, baselineLog].sort(compareServiceLogsByLatest);
  };

  const openServiceModal = (mode: OilActionMode, row: (typeof oilChangeRows)[number]) => {
    if(mode==='mark'&&row.vehicleId){window.location.assign('/maintenance?tab=vehicles&vehicle='+encodeURIComponent(row.vehicleId)+'&package=engine_oil');return;}
    const latestLog = getLatestServiceLog(row.registration);
    const defaultInterval =
      getEffectiveOilChangeIntervalForVehicleType(
        row.vehicleType,
        row.oilChangeIntervalKm ?? latestLog?.interval_km ?? getOilChangeIntervalForVehicleType(row.vehicleType)
      );
    const defaultDate =
      mode === "edit"
        ? row.lastOilChangeDate ?? latestLog?.service_date ?? row.lastWeeklyMileageDate ?? todayKey()
        : row.lastWeeklyMileageDate ?? todayKey();
    const defaultOdometer =
      mode === "mark"
        ? row.currentOdometer ?? row.lastOilChangeOdometer ?? ""
        : row.lastOilChangeOdometer ?? latestLog?.odometer ?? row.currentOdometer ?? "";

    setError(null);
    setSuccessMessage(null);
    setServiceForm({
      vehicleReg: row.registration,
      serviceType: latestLog?.service_type ?? "oil_change",
      serviceDate: defaultDate,
      serviceOdometer: defaultOdometer === "" ? "" : String(defaultOdometer),
      intervalKm: defaultInterval != null ? String(defaultInterval) : "",
      notes: mode === "edit" ? latestLog?.notes ?? "" : ""
    });
    setServiceModal({
      mode,
      vehicleId: row.vehicleId,
      registration: row.registration,
      vehicleName: row.vehicleName,
      vehicleType: row.vehicleType,
      currentOdometer: row.currentOdometer,
      currentOdometerDate: row.currentOdometerDate,
      serviceLogId: mode === "edit" ? latestLog?.id ?? null : null
    });
  };

  const openServiceLogModal = (log: VehicleServiceLog) => {
    if(log.maintenance_record_id){window.location.href='/maintenance?tab=history&vehicle='+encodeURIComponent(log.vehicle_id??'');return;}
    const matchingRow = oilChangeRows.find((row) => normalizeReg(row.registration) === normalizeReg(log.vehicle_reg)) ?? null;
    const odometer = Number(log.oil_change_odometer ?? log.odometer ?? log.service_odometer);
    const intervalKm =
      log.interval_km ??
      matchingRow?.oilChangeIntervalKm ??
      getOilChangeIntervalForVehicleType(log.vehicle_type_snapshot ?? matchingRow?.vehicleType);

    setError(null);
    setSuccessMessage(null);
    setServiceForm({
      vehicleReg: log.vehicle_reg,
      serviceType: log.service_type || "oil_change",
      serviceDate: log.service_date,
      serviceOdometer: Number.isFinite(odometer) ? String(Math.trunc(odometer)) : "",
      intervalKm: intervalKm != null ? String(Math.trunc(Number(intervalKm))) : "",
      notes: log.notes ?? ""
    });
    setServiceModal({
      mode: "edit",
      vehicleId: log.vehicle_id ?? matchingRow?.vehicleId ?? null,
      registration: log.vehicle_reg,
      vehicleName: matchingRow?.vehicleName ?? log.vehicle_reg,
      vehicleType: log.vehicle_type_snapshot ?? matchingRow?.vehicleType ?? null,
      currentOdometer: matchingRow?.currentOdometer ?? null,
      currentOdometerDate: matchingRow?.currentOdometerDate ?? null,
      serviceLogId: log.id
    });
  };

  const closeServiceModal = () => {
    if (savingService) return;
    setServiceModal(null);
    setServiceForm({ vehicleReg: "", serviceType: "oil_change", serviceDate: "", serviceOdometer: "", intervalKm: "", notes: "" });
  };

  const handleSaveService = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!serviceModal || serviceMutationRef.current) return;
    serviceMutationRef.current = true;

    try {
      setSavingService(true);
      setError(null);
      setSuccessMessage(null);
      const serviceOdometer = Number(serviceForm.serviceOdometer);
      const targetRegistration = serviceForm.vehicleReg.trim() || serviceModal.registration;
      const matchingOilRow = oilChangeRows.find((row) => normalizeReg(row.registration) === normalizeReg(targetRegistration)) ?? null;
      const latestKnownOdometer = matchingOilRow?.currentOdometer ?? serviceModal.currentOdometer;
      const latestKnownDate = matchingOilRow?.currentOdometerDate ?? serviceModal.currentOdometerDate ?? null;
      const isHigherThanCurrent =
        latestKnownOdometer != null &&
        Number.isFinite(serviceOdometer) &&
        serviceOdometer > latestKnownOdometer;
      if (isHigherThanCurrent) {
        const diff = Math.trunc(serviceOdometer - Number(latestKnownOdometer));
        const confirmed = window.confirm(
          `Oil change mileage is ${formatNumber(diff, language)} km higher than the latest recorded odometer of ${formatKmValue(latestKnownOdometer)}${latestKnownDate ? ` on ${formatDate(latestKnownDate, language)}` : ""}. Please confirm this is correct.`
        );
        if (!confirmed) {
          return;
        }
      }
      const previousOilChangeLog = (serviceLogsByVehicle.get(normalizeReg(targetRegistration)) ?? [])
        .filter((log) => log.id !== serviceModal.serviceLogId)
        .filter((log) => log.service_type === "oil_change" || !log.service_type)
        .filter((log) => !serviceForm.serviceDate || log.service_date <= serviceForm.serviceDate)
        .sort(compareServiceLogsByLatest)[0] ?? null;
      const previousOilChangeOdometer = previousOilChangeLog
        ? Number(previousOilChangeLog.oil_change_odometer ?? previousOilChangeLog.odometer ?? previousOilChangeLog.service_odometer)
        : null;
      if (
        previousOilChangeOdometer != null &&
        Number.isFinite(previousOilChangeOdometer) &&
        Number.isFinite(serviceOdometer) &&
        serviceOdometer < previousOilChangeOdometer
      ) {
        const confirmed = window.confirm(
          `Oil change mileage is lower than the previous oil-change odometer of ${formatKmValue(previousOilChangeOdometer)} on ${formatDate(previousOilChangeLog!.service_date, language)}. Please confirm this is correct.`
        );
        if (!confirmed) {
          return;
        }
      }
      const serviceDateAfterLatestMileage =
        latestKnownOdometer != null &&
        latestKnownDate &&
        serviceForm.serviceDate &&
        serviceForm.serviceDate > latestKnownDate;
      const newerOilChangeLog =
        serviceModal.mode === "edit"
          ? (serviceLogsByVehicle.get(normalizeReg(targetRegistration)) ?? []).find(
              (log) =>
                log.id !== serviceModal.serviceLogId &&
                (!log.service_type || log.service_type === "oil_change") &&
                log.service_date > serviceForm.serviceDate
            ) ?? null
          : null;
      if (serviceDateAfterLatestMileage) {
        const confirmed = window.confirm(
          `Oil change date ${formatDate(serviceForm.serviceDate, language)} is after the latest weekly mileage date ${formatDate(latestKnownDate, language)}. Add a newer mileage reading or confirm this service record is correct.`
        );
        if (!confirmed) {
          return;
        }
      }
      if (newerOilChangeLog) {
        const newerOdometer = Number(newerOilChangeLog.oil_change_odometer ?? newerOilChangeLog.odometer ?? newerOilChangeLog.service_odometer);
        const confirmed = window.confirm(
          `A newer oil-change record still exists for ${targetRegistration}: ${formatDate(newerOilChangeLog.service_date, language)} at ${Number.isFinite(newerOdometer) ? formatKmValue(newerOdometer) : "-"} km. The summary card uses the most recent service date, so that newer row will still control the card until it is edited or deleted. Continue saving this older record?`
        );
        if (!confirmed) {
          return;
        }
      }
      const notes = [
        serviceForm.notes.trim(),
        isHigherThanCurrent ? "Admin confirmed oil-change mileage is above the latest weekly mileage." : "",
        previousOilChangeOdometer != null && serviceOdometer < previousOilChangeOdometer
          ? "Admin confirmed oil-change mileage is lower than the previous service record."
          : "",
        serviceDateAfterLatestMileage ? "Admin confirmed service date is after the latest weekly mileage date." : "",
        newerOilChangeLog
          ? "Admin confirmed a newer oil-change service record still exists and will continue to control the summary card."
          : ""
      ].filter(Boolean).join(" | ");
      const servicePayload = {
        vehicleId:
          normalizeReg(targetRegistration) === normalizeReg(serviceModal.registration)
            ? serviceModal.vehicleId
            : null,
        vehicleReg: targetRegistration,
        vehicleName: serviceModal.vehicleName,
        serviceType: serviceForm.serviceType,
        vehicleType: serviceModal.vehicleType,
        serviceDate: serviceForm.serviceDate,
        serviceOdometer,
        intervalKm: Number(serviceForm.intervalKm),
        notes,
        serviceLogId: serviceModal.serviceLogId,
        updateExistingLog: serviceModal.mode === "edit",
        recordHistory: serviceModal.mode === "mark"
      };
      await saveOilChangeService(servicePayload);

      await loadData();
      setSuccessMessage(
        serviceModal.mode === "mark"
          ? t.weeklyMileage.notifications.oilChangeSaved
          : serviceModal.mode === "edit"
            ? t.weeklyMileage.notifications.serviceUpdated
            : t.weeklyMileage.notifications.oilBaselineSaved
      );
      setServiceModal(null);
      setServiceForm({ vehicleReg: "", serviceType: "oil_change", serviceDate: "", serviceOdometer: "", intervalKm: "", notes: "" });
    } catch (err) {
      console.error("Oil service save error:", err);
      setError(err instanceof Error && err.message ? err.message : t.weeklyMileage.notifications.serviceSaveFailed);
    } finally {
      serviceMutationRef.current = false;
      setSavingService(false);
    }
  };

  const openServiceHistory = async (registration: string) => {
    setHistoryVehicleReg(registration);
    await loadData();
  };

  const handleDeleteServiceLog = async (log: VehicleServiceLog) => {
    if(log.maintenance_record_id){window.location.href='/maintenance?tab=history&vehicle='+encodeURIComponent(log.vehicle_id??'');return;}
    if (serviceMutationRef.current) return;
    if (log.id.startsWith("vehicle-baseline-") || log.id.startsWith("baseline-")) {
      setError(t.weeklyMileage.oil.vehicleBaselineReadOnly);
      return;
    }
    const confirmed = window.confirm(`${t.weeklyMileage.oil.deleteOilChangeConfirm}\n${log.vehicle_reg} · ${log.service_date} · ${formatKmValue(log.odometer)}\nID: ${log.id}`);
    if (!confirmed) return;
    serviceMutationRef.current = true;

    try {
      setDeletingServiceLogId(log.id);
      setError(null);
      setSuccessMessage(null);
      const matchingRow = oilChangeRows.find((row) => normalizeReg(row.registration) === normalizeReg(log.vehicle_reg)) ?? null;
      await deleteOilChangeService({
        serviceLogId: log.id,
        vehicleId: log.vehicle_id ?? matchingRow?.vehicleId ?? null,
        vehicleReg: log.vehicle_reg,
        vehicleName: matchingRow?.vehicleName ?? log.vehicle_reg,
        vehicleType: log.vehicle_type_snapshot ?? matchingRow?.vehicleType ?? null
      });
      await loadData();
      setSuccessMessage("Oil change deleted successfully.");
    } catch (err) {
      console.error("Oil service delete error:", err);
      setError(err instanceof Error && err.message ? err.message : "Unable to delete oil change service record.");
    } finally {
      serviceMutationRef.current = false;
      setDeletingServiceLogId(null);
    }
  };

  const selectedHistoryRow = historyVehicleReg
    ? oilChangeRows.find((row) => normalizeReg(row.registration) === normalizeReg(historyVehicleReg)) ?? null
    : null;
  const selectedHistoryLogs = (() => {
    const logs = historyVehicleReg
      ? appendBaselineHistoryLog(historyVehicleReg, serviceLogsByVehicle.get(normalizeReg(historyVehicleReg)) ?? [])
      : [];
    if (logs.length || !selectedHistoryRow?.lastOilChangeDate || selectedHistoryRow.lastOilChangeOdometer == null) {
      return logs;
    }

    return [
      {
        id: `baseline-${normalizeReg(selectedHistoryRow.registration)}`,
        vehicle_id: selectedHistoryRow.vehicleId,
        vehicle_reg: selectedHistoryRow.registration,
        service_type: "oil_change",
        service_date: selectedHistoryRow.lastOilChangeDate,
        odometer: selectedHistoryRow.lastOilChangeOdometer,
        oil_change_odometer: selectedHistoryRow.lastOilChangeOdometer,
        service_odometer: selectedHistoryRow.lastOilChangeOdometer,
        interval_km: selectedHistoryRow.oilChangeIntervalKm,
        next_service_due_odometer: selectedHistoryRow.nextOilChangeDueOdometer,
        vehicle_type_snapshot: selectedHistoryRow.vehicleType,
        notes: t.weeklyMileage.oil.oilChangedNote,
        created_at: selectedHistoryRow.lastOilChangeDate
      } satisfies VehicleServiceLog
    ];
  })();

  const exportWeeklyMileage = () =>
    exportToCsv(
      sortedEntries.map((entry) => ({
        [t.weeklyMileage.weekEnding]: formatDate(entry.week_ending, language),
        [t.weeklyMileage.driver]: entry.driver,
        [t.weeklyMileage.vehicleReg]: entry.vehicle_reg,
        [t.weeklyMileage.mileage]: entry.mileage
      })),
      "weekly-mileage-report"
    );

  const oilReportStatusLabel = (status: OilChangeStatus) => {
    if(status==='not_applicable')return centreCopy[language].notApplicable;
    if(status==='condition_based')return centreCopy[language].condition;
    if (status === "overdue") return oilReportCopy.overdue;
    if (status === "urgent") return oilReportCopy.urgent;
    if (status === "due_soon") return oilReportCopy.dueSoon;
    if (status === "review_required" || status === "no_odometer") return oilReportCopy.reviewRequired;
    if (status === "not_set") return oilReportCopy.notSet;
    return oilReportCopy.ok;
  };

  const oilReportPriority = (row: OilChangeAlertRow) => {
    if (row.status === "overdue") return "Immediate service required";
    if (row.status === "urgent") return "Book service soon";
    if (row.status === "due_soon") return "Monitor";
    if (row.status === "review_required" || row.status === "not_set" || row.status === "no_odometer") {
      return "Missing service baseline";
    }
    return "No action needed";
  };

  const oilReportRank = (status: OilChangeStatus) => {
    if (status === "overdue") return 1;
    if (status === "urgent") return 2;
    if (status === "due_soon") return 3;
    if (status === "review_required" || status === "not_set" || status === "no_odometer") return 4;
    return 5;
  };

  const sortOilReportRows = (rows: OilChangeAlertRow[]) =>
    [...rows].sort((left, right) => {
      const rankDiff = oilReportRank(left.status) - oilReportRank(right.status);
      if (rankDiff !== 0) return rankDiff;

      const leftRemaining = left.kmRemaining ?? Number.POSITIVE_INFINITY;
      const rightRemaining = right.kmRemaining ?? Number.POSITIVE_INFINITY;
      if (leftRemaining !== rightRemaining) return leftRemaining - rightRemaining;

      return left.registration.localeCompare(right.registration);
    });

  const getOilReportRows = (scope: OilReportScope) => {
    if (scope === "overdue") {
      return sortOilReportRows(oilChangeRows.filter((row) => row.status === "overdue"));
    }
    if (scope === "urgent_overdue") {
      return sortOilReportRows(oilChangeRows.filter((row) => row.status === "overdue" || row.status === "urgent"));
    }
    if (scope === "due_soon") {
      return sortOilReportRows(oilChangeRows.filter((row) => row.status === "due_soon"));
    }
    if (scope === "review_required") {
      return sortOilReportRows(
        oilChangeRows.filter((row) => row.status === "review_required" || row.status === "not_set" || row.status === "no_odometer")
      );
    }
    return sortOilReportRows(oilChangeRows);
  };

  const buildOilReportExportRows = (rows: OilChangeAlertRow[]) =>
    rows.map((row) => ({
      "Vehicle Registration": row.registration,
      "Driver Name": row.driverName ?? "",
      "Vehicle Type": row.vehicleType ? vehicleTypeLabel(row.vehicleType) : "",
      "Current Odometer": row.currentOdometer ?? "",
      "Last Weekly Mileage Date": row.lastWeeklyMileageDate ?? "",
      "Last Weekly Mileage Odometer": row.lastWeeklyMileageOdometer ?? "",
      "Days Since Weekly Mileage Added": row.daysSinceWeeklyMileage ?? "",
      "Weekly Mileage Updated This Week": row.weeklyMileageUpdatedThisWeek ? "Yes" : "No",
      "Last Oil Change Date": row.lastOilChangeDate ?? "",
      "Last Oil Change Odometer": row.lastOilChangeOdometer ?? "",
      "Service Interval KM": row.oilChangeIntervalKm ?? "",
      "Next Service Due KM": row.nextOilChangeDueOdometer ?? "",
      "KM Remaining": row.kmRemaining ?? "",
      Status: oilReportStatusLabel(row.status),
      Priority: oilReportPriority(row),
      Notes: row.reviewReasons.length ? row.reviewReasons.map(reviewReasonLabel).join("; ") : actionLine(row)
    }));

  const exportOilServiceReport = (scope: OilReportScope, fileSuffix: string) => {
    exportToCsv(buildOilReportExportRows(getOilReportRows(scope)), `oil-change-service-report-${fileSuffix}`);
  };

  const oilReportCopy = t.weeklyMileage.oil.report;

  const oilServicePdfButtonCopy = language === "th"
    ? {
        download: "ดาวน์โหลด PDF รายงานบริการน้ำมันเครื่อง",
        error: "ไม่สามารถสร้าง PDF รายงานบริการน้ำมันเครื่องได้",
        generated: "ดาวน์โหลด PDF รายงานบริการน้ำมันเครื่องแล้ว",
        generating: "กำลังสร้าง PDF...",
        okFallbackWeek: "ไม่ระบุ",
        unassigned: "ยังไม่ระบุคนขับ"
      }
    : {
        download: "Download Oil Service PDF",
        error: "Unable to generate oil service PDF.",
        generated: "Oil service PDF downloaded.",
        generating: "Generating PDF...",
        okFallbackWeek: "Not available",
        unassigned: "Unassigned"
      };

  const lastOilChangesPdfButtonCopy = language === "th"
    ? {
        download: "ดาวน์โหลด PDF รายงานการเปลี่ยนน้ำมันเครื่องล่าสุด",
        error: "ไม่สามารถสร้าง PDF รายงานการเปลี่ยนน้ำมันล่าสุดได้",
        generated: "ดาวน์โหลด PDF รายงานการเปลี่ยนน้ำมันล่าสุดแล้ว"
      }
    : {
        download: "Download Last Oil Changes PDF",
        error: "Unable to generate last oil changes PDF.",
        generated: "Last oil changes PDF downloaded."
      };

  const weeklyMileagePdfCopy = language === "th"
    ? {
        download: "ดาวน์โหลดรายงานระยะทางประจำสัปดาห์",
        error: "ไม่สามารถสร้างรายงานระยะทางประจำสัปดาห์ได้",
        generated: "ดาวน์โหลดรายงานระยะทางประจำสัปดาห์แล้ว",
        generating: "กำลังสร้าง PDF...",
        insufficient: "ไม่มีรายการเลขไมล์สำหรับรอบรายงานที่เลือก จึงยังสร้างรายงานเปรียบเทียบไม่ได้"
      }
    : {
        download: "Download Weekly Mileage PDF",
        error: "Unable to generate the weekly mileage comparison PDF.",
        generated: "Weekly mileage comparison PDF downloaded.",
        generating: "Generating PDF...",
        insufficient: "There are no mileage entries for the selected reporting week, so a comparison report cannot be generated yet."
      };

  const weeklyDistanceHistoryCopy = language === "th"
    ? {
        all: "ทั้งหมด",
        averageWeeklyDistance: "ระยะทางเฉลี่ยต่อสัปดาห์",
        averageLine: "ค่าเฉลี่ยช่วงที่เลือก",
        changeKm: "เปลี่ยนแปลง (กม.)",
        changePercent: "เปลี่ยนแปลง %",
        complete: "ครบ",
        custom: "กำหนดช่วงเอง",
        customRange: "ช่วงวันที่กำหนด",
        description: "ประวัติ Weekly Distance Covered จากข้อมูล Weekly Mileage ทุกสัปดาห์",
        distance: "ระยะทาง",
        downloadPdf: "ดาวน์โหลด PDF ประวัติระยะทาง",
        error: "ไม่สามารถสร้างรายงานประวัติระยะทางได้",
        excluded: "รายการที่ไม่รวม",
        excelGenerated: "ส่งออก Excel ประวัติระยะทางแล้ว",
        exportExcel: "ส่งออก Excel",
        fromDate: "จากวันที่",
        generated: "ดาวน์โหลด PDF ประวัติระยะทางแล้ว",
        generating: "กำลังสร้าง PDF...",
        highestWeek: "สัปดาห์สูงสุด",
        last12: "12 สัปดาห์ล่าสุด",
        last4: "4 สัปดาห์ล่าสุด",
        last8: "8 สัปดาห์ล่าสุด",
        lowestWeek: "สัปดาห์ต่ำสุด",
        missing: "ขาด",
        missingEntries: "รายการที่ขาด",
        noPreviousWeek: "ไม่มีสัปดาห์ก่อนหน้าให้เปรียบเทียบ",
        noHistory: "ยังไม่มีประวัติระยะทางรายสัปดาห์",
        open: "ประวัติระยะทางรายสัปดาห์",
        previousOdometer: "เลขไมล์ก่อนหน้า",
        currentOdometer: "เลขไมล์ปัจจุบัน",
        range: "ช่วงรายงาน",
        reportingWeek: "สัปดาห์รายงาน",
        reviewVehicles: "ต้องตรวจสอบ",
        status: "สถานะ",
        tableTitle: "ตารางประวัติระยะทาง",
        thisYear: "ปีนี้",
        title: "Weekly Distance History Report",
        toDate: "ถึงวันที่",
        totalDistance: "ระยะทางรวม",
        trendTitle: "แนวโน้ม Weekly Distance Covered",
        validVehicleDistanceTotal: "ระยะทางรถที่ใช้คำนวณได้",
        validVehicleEntries: "Vehicle Entries",
        vehicleBreakdown: "รายละเอียดรายคัน",
        validationMatch: "ตัวเลขสัปดาห์ที่เลือกตรงกับการ์ด Weekly Distance Covered",
        weeklyDistanceCovered: "Weekly Distance Covered (KM)"
      }
    : {
        all: "All History",
        averageWeeklyDistance: "Average Weekly Distance",
        averageLine: "Range average",
        changeKm: "Change KM",
        changePercent: "Change %",
        complete: "Complete",
        custom: "Custom Range",
        customRange: "Custom date range",
        description: "Weekly Distance Covered history from every reporting week entered in Weekly Mileage.",
        distance: "Distance",
        downloadPdf: "Download Distance History PDF",
        error: "Unable to generate the weekly distance history report.",
        excluded: "Excluded",
        excelGenerated: "Weekly distance history Excel exported.",
        exportExcel: "Export Excel",
        fromDate: "From",
        generated: "Weekly distance history PDF downloaded.",
        generating: "Generating PDF...",
        highestWeek: "Highest Week",
        last12: "Last 12 Weeks",
        last4: "Last 4 Weeks",
        last8: "Last 8 Weeks",
        lowestWeek: "Lowest Week",
        missing: "Missing",
        missingEntries: "Missing Entries",
        noPreviousWeek: "No previous week to compare",
        noHistory: "No weekly distance history is available yet.",
        open: "Weekly Distance History",
        previousOdometer: "Previous Odometer",
        currentOdometer: "Current Odometer",
        range: "Report Range",
        reportingWeek: "Reporting Week",
        reviewVehicles: "Review Vehicles",
        status: "Status",
        tableTitle: "Distance History Table",
        thisYear: "This Year",
        title: "Weekly Distance History Report",
        toDate: "To",
        totalDistance: "Total Distance",
        trendTitle: "Weekly Distance Covered Trend",
        validVehicleDistanceTotal: "Valid vehicle distance total",
        validVehicleEntries: "Vehicle Entries",
        vehicleBreakdown: "Vehicle Breakdown",
        validationMatch: "Selected week matches the Weekly Distance Covered summary card.",
        weeklyDistanceCovered: "Weekly Distance Covered (KM)"
      };

  const getWeeklyDistanceHistoryRangeLabel = () => {
    if (activeWeeklyDistanceHistoryFilter === "last4") return weeklyDistanceHistoryCopy.last4;
    if (activeWeeklyDistanceHistoryFilter === "last8") return weeklyDistanceHistoryCopy.last8;
    if (activeWeeklyDistanceHistoryFilter === "last12") return weeklyDistanceHistoryCopy.last12;
    if (activeWeeklyDistanceHistoryFilter === "year") return `${weeklyDistanceHistoryCopy.thisYear} ${new Date().getFullYear()}`;
    if (activeWeeklyDistanceHistoryFilter === "custom") {
      const start = weeklyDistanceHistoryFrom ? formatDate(weeklyDistanceHistoryFrom, language) : weeklyDistanceHistoryCopy.fromDate;
      const end = weeklyDistanceHistoryTo ? formatDate(weeklyDistanceHistoryTo, language) : weeklyDistanceHistoryCopy.toDate;
      return `${weeklyDistanceHistoryCopy.customRange}: ${start} - ${end}`;
    }
    return weeklyDistanceHistoryCopy.all;
  };

  const exportWeeklyDistanceHistoryExcel = () => {
    const rangeLabel = getWeeklyDistanceHistoryRangeLabel();
    exportWorkbookToXlsx(
      [
        {
          name: "Summary",
          rows: [
            { Metric: "Selected report range", Value: rangeLabel },
            { Metric: "Total distance", Value: weeklyDistanceHistorySummary.totalDistance },
            { Metric: "Average weekly distance", Value: Math.round(weeklyDistanceHistorySummary.averageWeeklyDistance) },
            {
              Metric: "Highest week",
              Value: weeklyDistanceHistorySummary.highestWeek
                ? `${weeklyDistanceHistorySummary.highestWeek.weekEnding} - ${weeklyDistanceHistorySummary.highestWeek.weeklyDistance} KM`
                : "-"
            },
            {
              Metric: "Lowest week",
              Value: weeklyDistanceHistorySummary.lowestWeek
                ? `${weeklyDistanceHistorySummary.lowestWeek.weekEnding} - ${weeklyDistanceHistorySummary.lowestWeek.weeklyDistance} KM`
                : "-"
            },
            { Metric: "Reporting weeks", Value: filteredWeeklyDistanceHistoryRows.length }
          ]
        },
        {
          name: "Weekly History",
          rows: filteredWeeklyDistanceHistoryRows.map((row) => ({
            "Reporting week": row.weekEnding,
            "Valid vehicle entries": row.validVehicleEntries,
            "Expected vehicle entries": row.expectedVehicleEntries,
            "Missing entries": row.missingVehicleCount,
            "Weekly distance covered": row.weeklyDistance,
            "Week-on-week change KM": row.weekOnWeekChangeKm,
            "Week-on-week change %": row.weekOnWeekChangePercent == null ? null : Number(row.weekOnWeekChangePercent.toFixed(1))
          }))
        },
        {
          name: "Vehicle Breakdown",
          rows: filteredWeeklyDistanceHistoryRows.flatMap((row) =>
            row.vehicleBreakdown.map((vehicleRow) => ({
              "Reporting week": row.weekEnding,
              "Vehicle reg": vehicleRow.vehicleReg,
              Driver: vehicleRow.driverName ?? "",
              "Previous odometer": vehicleRow.previousOdometer,
              "Current odometer": vehicleRow.currentOdometer,
              "Distance covered": vehicleRow.distance,
              Status: vehicleRow.statusLabel,
              Detail: vehicleRow.statusDetail
            }))
          )
        }
      ],
      "weekly-distance-history-report"
    );
    setError(null);
    setSuccessMessage(weeklyDistanceHistoryCopy.excelGenerated);
  };

  const buildWeeklyDistanceHistoryPdfData = (): WeeklyDistanceHistoryPdfData => {
    const generatedAt = new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Bangkok"
    }).format(new Date());
    const formatHistoryKm = (value: number) => `${formatNumber(value, language, 0)} KM`;

    return {
      generatedAt,
      rangeLabel: getWeeklyDistanceHistoryRangeLabel(),
      rows: filteredWeeklyDistanceHistoryRows.map((row) => ({
        changePercent: row.weekOnWeekChangePercent == null ? "-" : formatPercentValue(row.weekOnWeekChangePercent),
        distance: formatHistoryKm(row.weeklyDistance),
        missing: row.missingVehicleCount ? String(row.missingVehicleCount) : "-",
        rawDistance: row.weeklyDistance,
        vehicleEntries: `${formatNumber(row.validVehicleEntries, language, 0)} / ${formatNumber(row.expectedVehicleEntries, language, 0)}`,
        weekEnding: formatDate(row.weekEnding, language)
      })),
      summary: {
        averageWeeklyDistance: formatHistoryKm(weeklyDistanceHistorySummary.averageWeeklyDistance),
        highestWeek: weeklyDistanceHistorySummary.highestWeek
          ? `${formatDate(weeklyDistanceHistorySummary.highestWeek.weekEnding, language)} (${formatHistoryKm(weeklyDistanceHistorySummary.highestWeek.weeklyDistance)})`
          : "-",
        lowestWeek: weeklyDistanceHistorySummary.lowestWeek
          ? `${formatDate(weeklyDistanceHistorySummary.lowestWeek.weekEnding, language)} (${formatHistoryKm(weeklyDistanceHistorySummary.lowestWeek.weeklyDistance)})`
          : "-",
        totalDistance: formatHistoryKm(weeklyDistanceHistorySummary.totalDistance)
      },
      title: weeklyDistanceHistoryCopy.title
    };
  };

  const formatOilPdfKm = (value: number | null | undefined) =>
    value == null || !Number.isFinite(Number(value)) ? "-" : `${formatNumber(Number(value), language, 0)} KM`;

  const formatLastOilReportKm = (value: number | null | undefined) =>
    value == null || !Number.isFinite(Number(value)) ? getLastOilChangesPdfCopy(language === "th" ? "th" : "en").notAvailable : `${formatNumber(Number(value), language, 0)} KM`;

  const toOilServicePdfRow = (row: OilChangeAlertRow, serviceDelta: number | null | undefined): OilServicePdfRow => ({
    currentOdometer: formatOilPdfKm(row.currentOdometer),
    driverName: row.driverName?.trim() || oilServicePdfButtonCopy.unassigned,
    lastOilChangeDate: row.lastOilChangeDate ? formatDate(row.lastOilChangeDate, language) : "-",
    nextServiceDue: formatOilPdfKm(row.nextOilChangeDueOdometer),
    priorityKm: Number(serviceDelta ?? Number.POSITIVE_INFINITY),
    serviceDelta: formatOilPdfKm(serviceDelta),
    vehicleReg: row.registration || "-",
    vehicleType: row.vehicleType ? vehicleTypeLabel(row.vehicleType) : row.vehicleTypeLabel || "-"
  });

  const buildOilServicePdfData = (oilChangeRows: OilChangeAlertRow[]): OilServicePdfData => {
    const oilReportSummary = { ok: oilChangeRows.filter(row => row.status === "ok").length, urgent: oilChangeRows.filter(row => row.status === "urgent").length, dueSoon: oilChangeRows.filter(row => row.status === "due_soon").length, overdue: oilChangeRows.filter(row => row.status === "overdue").length };
    const overdueRows = oilChangeRows
      .filter((row) => row.status === "overdue")
      .map((row) => toOilServicePdfRow(row, row.overdueKm))
      .sort((left, right) => {
        const priorityDiff =
          (Number.isFinite(right.priorityKm) ? right.priorityKm : -1) -
          (Number.isFinite(left.priorityKm) ? left.priorityKm : -1);
        return priorityDiff !== 0 ? priorityDiff : left.vehicleReg.localeCompare(right.vehicleReg);
      });
    const dueSoonRows = oilChangeRows
      .filter((row) => row.status === "urgent" || row.status === "due_soon")
      .map((row) => toOilServicePdfRow(row, row.kmRemaining))
      .sort((left, right) => {
        const priorityDiff =
          (Number.isFinite(left.priorityKm) ? left.priorityKm : Number.POSITIVE_INFINITY) -
          (Number.isFinite(right.priorityKm) ? right.priorityKm : Number.POSITIVE_INFINITY);
        return priorityDiff !== 0 ? priorityDiff : left.vehicleReg.localeCompare(right.vehicleReg);
      });
    const pdfLanguage = language === "th" ? "th" : "en";
    const generatedAt = new Intl.DateTimeFormat(pdfLanguage === "th" ? "th-TH" : "en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Bangkok"
    }).format(new Date());

    return {
      dueSoonRows,
      generatedAt,
      okCount: formatNumber(oilReportSummary.ok, language, 0),
      overdueRows,
      summary: {
        dueSoon: formatNumber(oilReportSummary.urgent + oilReportSummary.dueSoon, language, 0),
        ok: formatNumber(oilReportSummary.ok, language, 0),
        overdue: formatNumber(oilReportSummary.overdue, language, 0)
      },
      weekEnding: selectedWeekSummary?.weekEnding ? formatDate(selectedWeekSummary.weekEnding, language) : oilServicePdfButtonCopy.okFallbackWeek
    };
  };

  const lastOilChangeReportRank = (row: LastOilChangesPdfRow) => {
    if (!row.hasServiceRecord) return 0;
    if (row.status === "overdue") return 1;
    if (row.status === "urgent") return 2;
    if (row.status === "due_soon") return 3;
    if (row.status === "review_required" || row.status === "no_odometer") return 4;
    if (row.status === "not_set") return 5;
    return 6;
  };

  const toLastOilChangesPdfRow = (row: OilChangeAlertRow): LastOilChangesPdfRow => {
    const latestLog = row.lastOilChangeDate && row.lastOilChangeOdometer != null ? { service_date: row.lastOilChangeDate, odometer: row.lastOilChangeOdometer, oil_change_odometer: row.lastOilChangeOdometer, service_odometer: row.lastOilChangeOdometer } : null;
    const copy = getLastOilChangesPdfCopy(language === "th" ? "th" : "en");
    const serviceOdometer = latestLog
      ? Number(latestLog.oil_change_odometer ?? latestLog.odometer ?? latestLog.service_odometer)
      : null;
    const normalizedServiceOdometer =
      serviceOdometer != null && Number.isFinite(serviceOdometer) ? Math.trunc(serviceOdometer) : null;
    const kmDriven =
      row.currentOdometer != null && normalizedServiceOdometer != null
        ? Math.trunc(row.currentOdometer - normalizedServiceOdometer)
        : null;
    const hasServiceRecord = Boolean(latestLog);
    const hasNegativeKmUsed = kmDriven != null && kmDriven < 0;
    const kmRemaining =
      hasServiceRecord && row.nextOilChangeDueOdometer != null && row.currentOdometer != null
        ? Math.trunc(row.nextOilChangeDueOdometer - row.currentOdometer)
        : null;
    const hasCurrentMileage = row.currentOdometer != null && row.lastWeeklyMileageDate != null;
    const displayStatus: OilChangeStatus = !hasCurrentMileage || hasNegativeKmUsed ? "review_required" : row.status;
    const statusLabel = !hasCurrentMileage
      ? oilReportStatusLabel("review_required")
      : !hasServiceRecord
        ? copy.noServiceRecord
        : oilReportStatusLabel(displayStatus);
    const currentOdometerDate = row.lastWeeklyMileageDate
      ? copy.asOf(formatDate(row.lastWeeklyMileageDate, language))
      : copy.notAvailable;
    const staleMileage = Boolean(row.lastWeeklyMileageDate && !row.weeklyMileageUpdatedThisWeek);

    return {
      currentOdometer: row.currentOdometer == null ? copy.noMileage : formatOilPdfKm(row.currentOdometer),
      currentOdometerDate,
      currentOdometerDateTone: staleMileage ? "stale" : "muted",
      currentOdometerWarning: staleMileage ? copy.notUpdatedThisWeek : null,
      driverName: row.driverName?.trim() || oilServicePdfButtonCopy.unassigned,
      hasServiceRecord,
      kmDrivenSinceOilChange: !hasCurrentMileage || !hasServiceRecord
        ? copy.notAvailable
        : hasNegativeKmUsed
          ? oilReportStatusLabel("review_required")
          : formatLastOilReportKm(kmDriven),
      kmRemaining: !hasCurrentMileage || kmRemaining == null
        ? copy.notAvailable
        : kmRemaining < 0
          ? `${formatNumber(Math.abs(kmRemaining), language, 0)} ${copy.overdueSuffix}`
          : formatLastOilReportKm(kmRemaining),
      kmRemainingSort: kmRemaining ?? Number.POSITIVE_INFINITY,
      lastOilChangeDate: hasServiceRecord && latestLog?.service_date
        ? formatDate(latestLog.service_date, language)
        : copy.noServiceRecord,
      lastOilChangeOdometer: hasServiceRecord ? formatLastOilReportKm(normalizedServiceOdometer) : copy.notAvailable,
      lastOilChangeTime: latestLog?.service_date ? parseDateValue(latestLog.service_date)?.getTime() ?? Number.POSITIVE_INFINITY : Number.POSITIVE_INFINITY,
      status: displayStatus,
      statusLabel,
      vehicleReg: row.registration || "-",
      vehicleType: row.vehicleType ? vehicleTypeLabel(row.vehicleType) : row.vehicleTypeLabel || "-"
    };
  };

  const buildLastOilChangesPdfData = (oilChangeRows: OilChangeAlertRow[]): LastOilChangesPdfData => {
    const pdfLanguage = language === "th" ? "th" : "en";
    const generatedAt = new Intl.DateTimeFormat(pdfLanguage === "th" ? "th-TH" : "en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Bangkok"
    }).format(new Date());
    const rows = oilChangeRows
      .map(toLastOilChangesPdfRow)
      .sort((left, right) => {
        const rankDiff = lastOilChangeReportRank(left) - lastOilChangeReportRank(right);
        if (rankDiff !== 0) return rankDiff;

        if (left.kmRemainingSort !== right.kmRemainingSort) return left.kmRemainingSort - right.kmRemainingSort;

        if (left.lastOilChangeTime !== right.lastOilChangeTime) return left.lastOilChangeTime - right.lastOilChangeTime;

        return left.vehicleReg.localeCompare(right.vehicleReg);
      });
    const noRecord = rows.filter((row) => !row.hasServiceRecord).length;
    const countStatus = (status: OilChangeStatus) =>
      rows.filter((row) => row.hasServiceRecord && row.status === status).length;

    return {
      generatedAt,
      rows,
      summary: {
        dueSoon: formatNumber(countStatus("due_soon"), language, 0),
        noRecord: formatNumber(noRecord, language, 0),
        ok: formatNumber(countStatus("ok"), language, 0),
        overdue: formatNumber(countStatus("overdue"), language, 0),
        total: formatNumber(rows.length, language, 0),
        urgent: formatNumber(countStatus("urgent"), language, 0)
      }
    };
  };

  const fetchFreshOilPdfRows = async () => {
    clearDataReadCache();
    const [vehicles, drivers, mileage, logs] = await Promise.all([fetchVehicles(), fetchDrivers(), fetchWeeklyMileage(), fetchOilChangeHistory()]);
    const baselines = await fetchOilChangeBaselinesForVehicles(vehicles);
    return buildOilServiceSnapshot({ vehicles, drivers, mileage, logs, baselines });
  };

  const downloadOilServicePdf = async () => {
    if (generatingOilServicePdf) return;
    setGeneratingOilServicePdf(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const pdfLanguage = language === "th" ? "th" : "en";
      const pdfData = buildOilServicePdfData(await fetchFreshOilPdfRows());
      const logo = await loadOilServicePdfLogo();
      const pdf = await buildOilServicePdf(pdfData, logo, pdfLanguage);
      const datePart = new Date().toISOString().slice(0, 10);
      downloadBlob(pdf, `Expert-Express-Oil-Service-Report-${datePart}.pdf`);
      setSuccessMessage(oilServicePdfButtonCopy.generated);
    } catch (err) {
      console.error("Oil service PDF generation failed:", err);
      setError(err instanceof Error && err.message ? err.message : oilServicePdfButtonCopy.error);
    } finally {
      setGeneratingOilServicePdf(false);
    }
  };

  const downloadLastOilChangesPdf = async () => {
    if (generatingLastOilChangesPdf) return;
    setGeneratingLastOilChangesPdf(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const pdfLanguage = language === "th" ? "th" : "en";
      const pdfData = buildLastOilChangesPdfData(await fetchFreshOilPdfRows());
      const logo = await loadOilServicePdfLogo();
      const pdf = await buildLastOilChangesPdf(pdfData, logo, pdfLanguage);
      const datePart = new Date().toISOString().slice(0, 10);
      downloadBlob(pdf, `Expert-Express-Last-Oil-Changes-${datePart}.pdf`);
      setSuccessMessage(lastOilChangesPdfButtonCopy.generated);
    } catch (err) {
      console.error("Last oil changes PDF generation failed:", err);
      setError(err instanceof Error && err.message ? err.message : lastOilChangesPdfButtonCopy.error);
    } finally {
      setGeneratingLastOilChangesPdf(false);
    }
  };

  const downloadWeeklyMileagePdf = async () => {
    if (generatingWeeklyMileagePdf) return;
    setGeneratingWeeklyMileagePdf(true);
    setError(null);
    setSuccessMessage(null);

    try {
      if (!selectedWeekValue) {
        throw new Error(weeklyMileagePdfCopy.insufficient);
      }
      clearDataReadCache();
      const [freshDrivers, freshVehicles, freshEntries] = await Promise.all([
        fetchDrivers(),
        fetchVehicles(),
        fetchWeeklyMileage()
      ]);
      if (!freshEntries.some((entry) => entry.week_ending === selectedWeekValue)) {
        throw new Error(weeklyMileagePdfCopy.insufficient);
      }
      const report = buildWeeklyMileageComparisonReport({
        entries: freshEntries,
        vehicles: freshVehicles,
        drivers: freshDrivers,
        selectedWeek: selectedWeekValue
      });
      setDrivers(freshDrivers);
      setVehicles(freshVehicles);
      setEntries(freshEntries);
      const pdf = await buildWeeklyMileageComparisonPdf(report, language === "th" ? "th" : "en");
      downloadBlob(pdf, `Expert-Express-Weekly-Mileage-Comparison-${selectedWeekValue}.pdf`);
      setSuccessMessage(weeklyMileagePdfCopy.generated);
    } catch (err) {
      console.error("Weekly mileage comparison PDF generation failed:", err);
      setError(err instanceof Error && err.message ? err.message : weeklyMileagePdfCopy.error);
    } finally {
      setGeneratingWeeklyMileagePdf(false);
    }
  };

  const downloadWeeklyDistanceHistoryPdf = async () => {
    if (generatingWeeklyDistanceHistoryPdf) return;
    setGeneratingWeeklyDistanceHistoryPdf(true);
    setError(null);
    setSuccessMessage(null);

    try {
      if (!filteredWeeklyDistanceHistoryRows.length) {
        throw new Error(weeklyDistanceHistoryCopy.noHistory);
      }
      const pdfLanguage = language === "th" ? "th" : "en";
      const logo = await loadOilServicePdfLogo();
      const pdf = await buildWeeklyDistanceHistoryPdf(buildWeeklyDistanceHistoryPdfData(), logo, pdfLanguage);
      const datePart = new Date().toISOString().slice(0, 10);
      downloadBlob(pdf, `Expert-Express-Weekly-Distance-History-${datePart}.pdf`);
      setSuccessMessage(weeklyDistanceHistoryCopy.generated);
    } catch (err) {
      console.error("Weekly distance history PDF generation failed:", err);
      setError(err instanceof Error && err.message ? err.message : weeklyDistanceHistoryCopy.error);
    } finally {
      setGeneratingWeeklyDistanceHistoryPdf(false);
    }
  };

  const copyOilReportSummary = async () => {
    const immediateRows = sortOilReportRows(
      oilChangeRows.filter((row) => row.status === "overdue" || row.status === "urgent")
    ).slice(0, 8);
    const message = [
      oilReportCopy.title,
      "",
      `${oilReportCopy.overdueVehicles}: ${oilReportSummary.overdue}`,
      `${oilReportCopy.urgentVehicles}: ${oilReportSummary.urgent}`,
      `${oilReportCopy.dueSoonVehicles}: ${oilReportSummary.dueSoon}`,
      `${oilReportCopy.reviewRequired}: ${oilReportSummary.reviewRequired}`,
      `${oilReportCopy.okVehicles}: ${oilReportSummary.ok}`,
      "",
      `${oilReportCopy.requiresImmediateService}:`,
      ...(immediateRows.length
        ? immediateRows.map((row) => {
            const detail =
              row.status === "overdue" && row.overdueKm != null
                ? `${oilReportCopy.overdueBy} ${formatNumber(row.overdueKm, language)} KM`
                : row.kmRemaining != null
                  ? oilReportCopy.actionDueIn.replace("{km}", `${formatNumber(row.kmRemaining, language)} KM`)
                  : oilReportStatusLabel(row.status);
            return `- ${row.registration} - ${detail}`;
          })
        : [`- ${language === "th" ? "ไม่มี" : "None"}`])
    ].join("\n");

    try {
      await navigator.clipboard.writeText(message);
      setError(null);
      setSuccessMessage(oilReportCopy.copiedSummary);
    } catch (err) {
      console.error("Oil change report copy failed:", err);
      setError(oilReportCopy.copySummaryError);
    }
  };

  return (
    <>
      <section className="surface-card mb-5 p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.14em] text-violet-600">
              EXPERT EXPRESS SENDER CO., LTD.
            </p>
            <h1 className="mt-1 text-2xl font-black text-slate-950">{t.weeklyMileage.title}</h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-500">
              {language === "th"
                ? "บันทึกเลขไมล์รายสัปดาห์ ดูผลระยะทาง และจัดการรอบเปลี่ยนน้ำมันจากข้อมูลเดียวกัน"
                : "Record weekly odometers, review distance results and manage oil-service status from the same mileage data."}
            </p>
          </div>

          <div className="inline-flex w-full rounded-xl border border-violet-100 bg-violet-50/60 p-1 sm:w-auto">
            <button
              type="button"
              onClick={() => setPageMode("mileage")}
              className={`flex-1 rounded-lg px-4 py-2 text-sm font-black transition sm:flex-none ${
                pageMode === "mileage" ? "bg-white text-violet-800 shadow-sm" : "text-slate-500 hover:text-violet-700"
              }`}
            >
              {language === "th" ? "เลขไมล์รายสัปดาห์" : "Weekly Mileage"}
            </button>
            <button
              type="button"
              onClick={() => {
                setPageMode("results");
                setWeeklyDistanceHistoryOpen(true);
              }}
              className={`flex-1 rounded-lg px-4 py-2 text-sm font-black transition sm:flex-none ${
                pageMode === "results" ? "bg-white text-violet-800 shadow-sm" : "text-slate-500 hover:text-violet-700"
              }`}
            >
              {language === "th" ? "ผลระยะทาง" : "Distance Results"}
            </button>
            <button
              type="button"
              onClick={() => setPageMode("oil")}
              className={`flex-1 rounded-lg px-4 py-2 text-sm font-black transition sm:flex-none ${
                pageMode === "oil" ? "bg-white text-violet-800 shadow-sm" : "text-slate-500 hover:text-violet-700"
              }`}
            >
              {language === "th" ? "บริการน้ำมันเครื่อง" : "Oil Service"}
            </button>
          </div>
        </div>
      </section>

      {loadError ? (
        <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {loadError}
        </div>
      ) : null}

      {showWeeklyMileageDebug && debugInfo ? (
        <section className="mb-4 rounded-2xl border border-amber-200 bg-amber-50/80 p-4 text-xs text-amber-950">
          <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <h3 className="text-sm font-bold text-amber-950">Weekly Mileage Debug</h3>
            <span className="rounded-full border border-amber-300 bg-white/70 px-2.5 py-1 font-semibold">
              development/admin diagnostics
            </span>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div>
              <p className="font-bold uppercase tracking-[0.12em] text-amber-700">User</p>
              <p className="mt-1 break-all">Email: {debugInfo.userEmail ?? "missing"}</p>
              <p className="break-all">ID: {debugInfo.userId ?? "missing"}</p>
              <p className="mt-1 break-all">Supabase: {debugInfo.supabaseUrl}</p>
            </div>
            <div>
              <p className="font-bold uppercase tracking-[0.12em] text-amber-700">Tables</p>
              {Object.entries(debugInfo.tables).map(([label, table]) => (
                <p key={label} className="break-all">{label}: {table}</p>
              ))}
            </div>
            <div>
              <p className="font-bold uppercase tracking-[0.12em] text-amber-700">Row Counts</p>
              {Object.entries(debugInfo.rowCounts).map(([label, count]) => (
                <p key={label}>{label}: {count ?? "not loaded"}</p>
              ))}
            </div>
            <div>
              <p className="font-bold uppercase tracking-[0.12em] text-amber-700">Errors</p>
              {Object.entries(debugInfo.errors).map(([label, message]) => (
                <p key={label} className="break-words">{label}: {message ?? "none"}</p>
              ))}
            </div>
          </div>
          <div className="mt-3 rounded-xl border border-amber-200 bg-white/65 p-3">
            <p className="font-bold uppercase tracking-[0.12em] text-amber-700">Exact Query Filters</p>
            {Object.entries(debugInfo.filters).map(([label, filter]) => (
              <p key={label} className="mt-1 break-words">{label}: {filter}</p>
            ))}
          </div>
        </section>
      ) : null}

      {pageMode === "mileage" ? (
        <>
<section className="surface-card mb-4 p-4 sm:p-5">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 className="section-title">{t.weeklyMileage.reportingWeekSummary}</h3>
            <p className="section-subtitle">{language === "th"
              ? "ดูความครบถ้วนของสัปดาห์และเพิ่มเลขไมล์ที่ยังขาด"
              : "Check this week's completion and add any missing odometer readings."}</p>
          </div>
          <div className="flex flex-col gap-2 sm:items-end">
            {selectedWeekSummary ? (
              <span className="badge-muted self-start sm:self-auto">{formatDate(selectedWeekSummary.weekEnding, language)}</span>
            ) : null}
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={() => openMileageEntry()}
                className="btn-primary w-full gap-2 sm:w-auto"
              >
                <Plus className="h-4 w-4" />
                {language === "th" ? "เพิ่มเลขไมล์" : "Add Mileage"}
              </button>
              <button
                type="button"
                onClick={() => void downloadWeeklyMileagePdf()}
                disabled={generatingWeeklyMileagePdf || loading || !selectedWeekValue}
                className="btn-secondary w-full gap-2 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
              >
                <Download className="h-4 w-4" />
                {generatingWeeklyMileagePdf ? weeklyMileagePdfCopy.generating : weeklyMileagePdfCopy.download}
              </button>
            </div>
          </div>
        </div>

        {loading ? (
          <EmptyState title={t.common.loading} description={t.weeklyMileage.loading} />
        ) : loadError ? (
          <EmptyState title={t.weeklyMileage.errorLoad} description={loadError} />
        ) : !selectedWeekSummary ? (
          <EmptyState title={t.weeklyMileage.noDataTitle} description={t.weeklyMileage.noDataDescription} />
        ) : (
          <>
          <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
            <div className="subtle-panel p-3.5">
              <p className="metric-label">{t.weeklyMileage.weeklyDistanceCovered}</p>
              <p className="mt-2 text-[1.75rem] font-semibold tracking-[-0.05em] text-slate-950">
                {selectedWeekSummary.comparableVehicles > 0
                  ? `${formatNumber(selectedWeekSummary.weeklyDistance, language)} KM`
                  : t.weeklyMileage.weeklyDistanceCoveredUnavailable}
              </p>
              <p className="mt-1 text-xs font-semibold text-slate-500">
                {language === "th" ? "ระยะทางรวมจากเลขไมล์ที่เปรียบเทียบได้" : "Total from comparable odometer readings"}
              </p>
            </div>

            <div className="subtle-panel p-3.5">
              <p className="metric-label">{language === "th" ? "รถที่อัปเดตแล้ว" : "Vehicles Entered"}</p>
              <p className="mt-2 text-[1.55rem] font-semibold text-slate-950">
                {formatCompleteness(selectedWeekSummary.validVehicleEntries, selectedWeekSummary.expectedVehicleEntries)}
              </p>
              <p className="mt-1 text-xs font-semibold text-emerald-700">
                {formatNumber(selectedWeekEntries.length, language, 0)} {language === "th" ? "รายการในสัปดาห์นี้" : "entries this week"}
              </p>
            </div>

            <div className={`subtle-panel p-3.5 ${missingVehiclesForSelectedWeek.length ? "border-amber-200 bg-amber-50/60" : ""}`}>
              <p className="metric-label">{language === "th" ? "รายการที่ยังขาด" : "Missing Entries"}</p>
              <p className={`mt-2 text-[1.55rem] font-semibold ${missingVehiclesForSelectedWeek.length ? "text-amber-800" : "text-emerald-700"}`}>
                {formatNumber(missingVehiclesForSelectedWeek.length, language, 0)}
              </p>
              <p className="mt-1 text-xs font-semibold text-slate-500">
                {missingVehiclesForSelectedWeek.length
                  ? (language === "th" ? "ยังต้องเพิ่มเลขไมล์" : "Still needs a weekly odometer")
                  : (language === "th" ? "ครบทุกคัน" : "All vehicles complete")}
              </p>
            </div>

            <div className="subtle-panel p-3.5">
              <p className="metric-label">{language === "th" ? "เปลี่ยนจากสัปดาห์ก่อน" : "Change vs Previous Week"}</p>
              <p className={`mt-2 text-[1.55rem] font-semibold ${changeToneClass(selectedWeekSummary.weekOnWeekChangeKm)}`}>
                {formatWeekChangeLabel(selectedWeekSummary)}
              </p>
              <p className="mt-1 text-xs font-semibold text-slate-500">
                {selectedWeekSummary.weekOnWeekChangeKm != null
                  ? formatSignedKm(selectedWeekSummary.weekOnWeekChangeKm)
                  : (language === "th" ? "ยังไม่มีข้อมูลเปรียบเทียบ" : "No previous-week comparison")}
              </p>
            </div>
          </div>

          {missingVehiclesForSelectedWeek.length ? (
            <div className="mt-2.5 flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50/70 px-3.5 py-2.5 text-sm">
              <span className="inline-flex h-2 w-2 rounded-full bg-amber-500" />
              <span className="font-black text-amber-950">
                {language === "th" ? "ยังขาด:" : "Missing:"}
              </span>
              {missingVehiclesForSelectedWeek.slice(0, 8).map(({ vehicle, registration, driver }) => (
                <button
                  key={String(vehicle.id || registration)}
                  type="button"
                  onClick={() => {
                    setForm({
                      ...createInitialForm(selectedWeekValue),
                      vehicle_reg: registration,
                      driver_id: driver ? String(driver.id) : ""
                    });
                    setMileageModalOpen(true);
                  }}
                  className="rounded-full border border-amber-300 bg-white px-2.5 py-1 text-xs font-black text-amber-900 transition hover:bg-amber-100"
                >
                  {registration}{driver?.name ? ` · ${driver.name}` : ""}
                </button>
              ))}
              {missingVehiclesForSelectedWeek.length > 8 ? (
                <span className="text-xs font-bold text-amber-800">+{missingVehiclesForSelectedWeek.length - 8}</span>
              ) : null}
            </div>
          ) : null}
          </>
        )}
      </section>
        </>
      ) : null}


      {pageMode === "results" ? (
        <>


      {selectedWeekSummary ? (
        <section className="mb-3 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <p className="metric-label">{language === "th" ? "ระยะทางสัปดาห์ที่เลือก" : "Selected Week Distance"}</p>
            <p className="mt-2 text-2xl font-black text-slate-950">{formatNumber(selectedWeekSummary.weeklyDistance, language)} KM</p>
            <p className="mt-1 text-xs text-slate-500">{formatDate(selectedWeekSummary.weekEnding, language)}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <p className="metric-label">{language === "th" ? "เฉลี่ยต่อรถ" : "Average per Vehicle"}</p>
            <p className="mt-2 text-2xl font-black text-slate-950">
              {selectedWeekSummary.comparableVehicles > 0
                ? `${formatNumber(Math.round(selectedWeekSummary.weeklyDistance / selectedWeekSummary.comparableVehicles), language)} KM`
                : "-"}
            </p>
            <p className="mt-1 text-xs text-slate-500">{formatNumber(selectedWeekSummary.comparableVehicles, language)} {language === "th" ? "คันที่เปรียบเทียบได้" : "comparable vehicles"}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <p className="metric-label">{language === "th" ? "ระยะทางสูงสุด" : "Highest This Week"}</p>
            <div className="mt-2 flex items-end justify-between gap-3">
              <div>
                <p className="text-xl font-black text-slate-950">{selectedWeekSummary.highestDistanceVehicle?.vehicleReg ?? "-"}</p>
                <p className="text-xs text-slate-500">{selectedWeekSummary.highestDistanceVehicle?.driverName ?? "-"}</p>
              </div>
              <p className="text-sm font-black text-sky-700">{selectedWeekSummary.highestDistanceVehicle ? `${formatKmValue(selectedWeekSummary.highestDistanceVehicle.distance)} KM` : "-"}</p>
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <p className="metric-label">{language === "th" ? "ระยะทางต่ำสุด" : "Lowest This Week"}</p>
            <div className="mt-2 flex items-end justify-between gap-3">
              <div>
                <p className="text-xl font-black text-slate-950">{selectedWeekSummary.lowestDistanceVehicle?.vehicleReg ?? "-"}</p>
                <p className="text-xs text-slate-500">{selectedWeekSummary.lowestDistanceVehicle?.driverName ?? "-"}</p>
              </div>
              <p className="text-sm font-black text-sky-700">{selectedWeekSummary.lowestDistanceVehicle ? `${formatKmValue(selectedWeekSummary.lowestDistanceVehicle.distance)} KM` : "-"}</p>
            </div>
          </div>
        </section>
      ) : null}
{weeklyDistanceHistoryOpen ? (
        <section id="weekly-distance-history" className="surface-card mb-3 p-4">
          <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="section-title">{weeklyDistanceHistoryCopy.title}</h3>
              </div>
              <p className="section-subtitle">{weeklyDistanceHistoryCopy.description}</p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={() => exportWeeklyDistanceHistoryExcel()}
                disabled={!filteredWeeklyDistanceHistoryRows.length}
                className="btn-secondary w-full gap-2 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
              >
                <FileSpreadsheet className="h-4 w-4" />
                {weeklyDistanceHistoryCopy.exportExcel}
              </button>
              <button
                type="button"
                onClick={() => void downloadWeeklyDistanceHistoryPdf()}
                disabled={generatingWeeklyDistanceHistoryPdf || !filteredWeeklyDistanceHistoryRows.length}
                className="btn-primary w-full gap-2 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
              >
                <Download className="h-4 w-4" />
                {generatingWeeklyDistanceHistoryPdf ? weeklyDistanceHistoryCopy.generating : weeklyDistanceHistoryCopy.downloadPdf}
              </button>
            </div>
          </div>

          <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <p className="metric-label">{weeklyDistanceHistoryCopy.range}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {([
                  ["all", weeklyDistanceHistoryCopy.all],
                  ["last4", weeklyDistanceHistoryCopy.last4],
                  ["last8", weeklyDistanceHistoryCopy.last8],
                  ["last12", weeklyDistanceHistoryCopy.last12],
                  ["year", weeklyDistanceHistoryCopy.thisYear],
                  ["custom", weeklyDistanceHistoryCopy.custom]
                ] as Array<[WeeklyDistanceHistoryFilter, string]>).map(([filter, label]) => (
                  <button
                    key={filter}
                    type="button"
                    onClick={() => setWeeklyDistanceHistoryFilter(filter)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                      activeWeeklyDistanceHistoryFilter === filter
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {activeWeeklyDistanceHistoryFilter === "custom" ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <label className="form-label">{weeklyDistanceHistoryCopy.fromDate}</label>
                  <input
                    type="date"
                    value={weeklyDistanceHistoryFrom}
                    onChange={(event) => setWeeklyDistanceHistoryFrom(event.target.value)}
                    className="form-input bg-white"
                  />
                </div>
                <div>
                  <label className="form-label">{weeklyDistanceHistoryCopy.toDate}</label>
                  <input
                    type="date"
                    value={weeklyDistanceHistoryTo}
                    onChange={(event) => setWeeklyDistanceHistoryTo(event.target.value)}
                    className="form-input bg-white"
                  />
                </div>
              </div>
            ) : null}
          </div>

          {filteredWeeklyDistanceHistoryRows.length ? (
            <>
              <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <WeeklyDistanceHistoryMetric
                  label={weeklyDistanceHistoryCopy.totalDistance}
                  value={`${formatNumber(weeklyDistanceHistorySummary.totalDistance, language, 0)} KM`}
                  emphasis
                />
                <WeeklyDistanceHistoryMetric
                  label={weeklyDistanceHistoryCopy.averageWeeklyDistance}
                  value={`${formatNumber(weeklyDistanceHistorySummary.averageWeeklyDistance, language, 0)} KM`}
                />
                <WeeklyDistanceHistoryMetric
                  label={weeklyDistanceHistoryCopy.highestWeek}
                  value={
                    weeklyDistanceHistorySummary.highestWeek
                      ? `${formatDate(weeklyDistanceHistorySummary.highestWeek.weekEnding, language)} · ${formatNumber(weeklyDistanceHistorySummary.highestWeek.weeklyDistance, language, 0)} KM`
                      : "-"
                  }
                  detail={
                    weeklyDistanceHistorySummary.highestWeek
                      ? `${formatCompleteness(weeklyDistanceHistorySummary.highestWeek.validVehicleEntries, weeklyDistanceHistorySummary.highestWeek.expectedVehicleEntries)}${
                          weeklyDistanceHistorySummary.highestWeek.missingVehicleCount
                            ? ` · ${formatNumber(weeklyDistanceHistorySummary.highestWeek.missingVehicleCount, language, 0)} ${weeklyDistanceHistoryCopy.missing}`
                            : ""
                        }`
                      : undefined
                  }
                />
                <WeeklyDistanceHistoryMetric
                  label={weeklyDistanceHistoryCopy.lowestWeek}
                  value={
                    weeklyDistanceHistorySummary.lowestWeek
                      ? `${formatDate(weeklyDistanceHistorySummary.lowestWeek.weekEnding, language)} · ${formatNumber(weeklyDistanceHistorySummary.lowestWeek.weeklyDistance, language, 0)} KM`
                      : "-"
                  }
                  detail={
                    weeklyDistanceHistorySummary.lowestWeek
                      ? `${formatCompleteness(weeklyDistanceHistorySummary.lowestWeek.validVehicleEntries, weeklyDistanceHistorySummary.lowestWeek.expectedVehicleEntries)}${
                          weeklyDistanceHistorySummary.lowestWeek.missingVehicleCount
                            ? ` · ${formatNumber(weeklyDistanceHistorySummary.lowestWeek.missingVehicleCount, language, 0)} ${weeklyDistanceHistoryCopy.missing}`
                            : ""
                        }`
                      : undefined
                  }
                />
              </div>

              <div className="mb-4 rounded-lg border border-slate-200 bg-white p-4">
                <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <h4 className="text-sm font-bold text-slate-950">{weeklyDistanceHistoryCopy.trendTitle}</h4>
                    <p className="text-xs font-medium text-slate-500">{getWeeklyDistanceHistoryRangeLabel()}</p>
                  </div>
                  <span className="badge-muted self-start sm:self-auto">
                    {formatNumber(filteredWeeklyDistanceHistoryRows.length, language, 0)} {weeklyDistanceHistoryCopy.reportingWeek}
                  </span>
                </div>
                <WeeklyDistanceHistoryChart rows={filteredWeeklyDistanceHistoryRows} language={language} />
              </div>

              <div>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-sm font-bold text-slate-950">{weeklyDistanceHistoryCopy.tableTitle}</h4>
                  <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">
                    {language === "th" ? "เรียง: ระยะทางสูงสุด → ต่ำสุด" : "Ranked: highest distance → lowest"}
                  </span>
                </div>
                <div className="table-shell">
                  <div className="table-scroll">
                    <table className="enterprise-table">
                      <thead>
                        <tr>
                          <th className="table-head-cell w-[72px]">{language === "th" ? "อันดับ" : "Rank"}</th>
                          <th className="table-head-cell">{weeklyDistanceHistoryCopy.reportingWeek}</th>
                          <th className="table-head-cell">{weeklyDistanceHistoryCopy.validVehicleEntries}</th>
                          <th className="table-head-cell">{weeklyDistanceHistoryCopy.missingEntries}</th>
                          <th className="table-head-cell">{weeklyDistanceHistoryCopy.changePercent}</th>
                          <th className="table-head-cell text-right">{weeklyDistanceHistoryCopy.weeklyDistanceCovered}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rankedWeeklyDistanceHistoryRows.map((row, rankIndex) => {
                          const expanded = expandedWeeklyDistanceWeek === row.weekEnding;
                          const excludedCount = row.vehicleBreakdown.filter((vehicleRow) => !vehicleRow.valid).length;
                          return (
                            <Fragment key={row.weekEnding}>
                              <tr
                                className="enterprise-table-row cursor-pointer"
                                onClick={() => setExpandedWeeklyDistanceWeek(expanded ? null : row.weekEnding)}
                              >
                                <td className="table-body-cell">
                                  <span className={`inline-flex h-7 min-w-7 items-center justify-center rounded-full px-2 text-xs font-black ${
                                    rankIndex < 3 ? "bg-violet-100 text-violet-800" : "bg-slate-100 text-slate-500"
                                  }`}>
                                    {rankIndex + 1}
                                  </span>
                                </td>
                                <td className="table-body-cell font-semibold text-slate-950">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span>{formatDate(row.weekEnding, language)}</span>
                                    {row.missingVehicleCount ? (
                                      <span className="badge-muted border-amber-200 bg-amber-50 text-amber-700">
                                        {formatNumber(row.missingVehicleCount, language, 0)} {weeklyDistanceHistoryCopy.missing}
                                      </span>
                                    ) : null}
                                  </div>
                                </td>
                                <td className="table-body-cell">
                                  <div className="font-semibold text-slate-900">
                                    {formatCompleteness(row.validVehicleEntries, row.expectedVehicleEntries)}
                                  </div>
                                  <div className={`text-xs font-semibold ${row.missingVehicleCount ? "text-amber-700" : "text-emerald-700"}`}>
                                    {row.missingVehicleCount
                                      ? `${formatNumber(row.missingVehicleCount, language, 0)} ${weeklyDistanceHistoryCopy.missing}`
                                      : weeklyDistanceHistoryCopy.complete}
                                  </div>
                                </td>
                                <td className="table-body-cell">{formatNumber(row.missingVehicleCount, language, 0)}</td>
                                <td className="table-body-cell">
                                  <span className={`text-xs font-semibold ${changeToneClass(row.weekOnWeekChangeKm)}`}>
                                    {row.weekOnWeekChangePercent == null ? "-" : formatPercentValue(row.weekOnWeekChangePercent)}
                                  </span>
                                </td>
                                <td className="table-body-cell text-right text-base font-black tabular-nums text-violet-800">
                                  {formatNumber(row.weeklyDistance, language, 0)}
                                </td>
                              </tr>
                              {expanded ? (
                                <tr key={`${row.weekEnding}-breakdown`}>
                                  <td className="table-body-cell bg-slate-50" colSpan={6}>
                                    <div className="rounded-lg border border-slate-200 bg-white p-3">
                                      <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                                        <h5 className="text-sm font-bold text-slate-950">{weeklyDistanceHistoryCopy.vehicleBreakdown}</h5>
                                        <div className="text-xs font-semibold text-slate-500">
                                          {weeklyDistanceHistoryCopy.validVehicleDistanceTotal}: {formatNumber(row.weeklyDistance, language, 0)} KM · {weeklyDistanceHistoryCopy.excluded}: {formatNumber(excludedCount, language, 0)}
                                        </div>
                                      </div>
                                      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                                        {row.vehicleBreakdown.map((vehicleRow) => (
                                          <div key={`${row.weekEnding}-${vehicleRow.vehicleReg}`} className="rounded-lg border border-slate-100 bg-slate-50/70 p-3">
                                            <div className="flex items-start justify-between gap-2">
                                              <div>
                                                <p className="font-bold text-slate-950">{vehicleRow.vehicleReg}</p>
                                                {vehicleRow.driverName ? (
                                                  <p className="text-xs font-semibold text-slate-500">{vehicleRow.driverName}</p>
                                                ) : null}
                                              </div>
                                              <span className={`badge-muted ${vehicleRow.valid ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
                                                {vehicleRow.statusLabel}
                                              </span>
                                            </div>
                                            <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                                              <div>
                                                <p className="metric-label">{weeklyDistanceHistoryCopy.previousOdometer}</p>
                                                <p className="font-semibold text-slate-900">{formatKmValue(vehicleRow.previousOdometer)}</p>
                                              </div>
                                              <div>
                                                <p className="metric-label">{weeklyDistanceHistoryCopy.currentOdometer}</p>
                                                <p className="font-semibold text-slate-900">{formatKmValue(vehicleRow.currentOdometer)}</p>
                                              </div>
                                              <div>
                                                <p className="metric-label">{weeklyDistanceHistoryCopy.distance}</p>
                                                <p className="font-semibold text-slate-900">{vehicleRow.distance == null ? "-" : `${formatKmValue(vehicleRow.distance)} KM`}</p>
                                              </div>
                                            </div>
                                            {!vehicleRow.valid ? (
                                              <p className="mt-2 text-xs font-semibold text-amber-700">{vehicleRow.statusDetail}</p>
                                            ) : null}
                                          </div>
                                        ))}
                                      </div>
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
              </div>
            </>
          ) : (
            <EmptyState title={weeklyDistanceHistoryCopy.title} description={weeklyDistanceHistoryCopy.noHistory} />
          )}
        </section>
      ) : null}


        </>
      ) : null}
{pageMode === "oil" ? (
        <>
          <section className="mb-3 rounded-2xl border border-violet-100 bg-[linear-gradient(135deg,#faf8ff_0%,#ffffff_70%)] px-4 py-3.5 shadow-sm">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.14em] text-violet-600">{language === "th" ? "การบริการจากเลขไมล์" : "Mileage-driven maintenance"}</p>
                <h2 className="mt-1 text-xl font-black text-slate-950">{language === "th" ? "สถานะเปลี่ยนน้ำมันเครื่อง" : "Oil Service"}</h2>
                <p className="mt-1 text-sm text-slate-500">{language === "th" ? "ใช้เลขไมล์ล่าสุดจาก Weekly Mileage เพื่อคำนวณสถานะบริการโดยอัตโนมัติ" : "Uses the latest Weekly Mileage readings to calculate service status automatically."}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => void downloadOilServicePdf()} disabled={generatingOilServicePdf} className="btn-primary gap-2 disabled:opacity-50"><Download className="h-4 w-4" />{generatingOilServicePdf ? oilServicePdfButtonCopy.generating : oilServicePdfButtonCopy.download}</button>
                <details className="relative">
                  <summary className="btn-secondary cursor-pointer list-none gap-2">••• {language === "th" ? "เพิ่มเติม" : "More"}</summary>
                  <div className="absolute right-0 top-12 z-30 w-64 rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
                    <button type="button" onClick={() => void downloadLastOilChangesPdf()} disabled={generatingLastOilChangesPdf || !oilChangeRows.length} className="w-full rounded-lg px-3 py-2 text-left text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">{lastOilChangesPdfButtonCopy.download}</button>
                    <button type="button" onClick={() => void copyOilReportSummary()} disabled={!oilChangeRows.length} className="w-full rounded-lg px-3 py-2 text-left text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">{oilReportCopy.copyReportSummary}</button>
                    <div className="my-1 border-t border-slate-100" />
                    <button type="button" onClick={() => exportOilServiceReport("all", "all")} className="w-full rounded-lg px-3 py-2 text-left text-xs font-bold text-slate-700 hover:bg-slate-50">{oilReportCopy.exportAll}</button>
                    <button type="button" onClick={() => exportOilServiceReport("overdue", "overdue")} disabled={!getOilReportRows("overdue").length} className="w-full rounded-lg px-3 py-2 text-left text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">{oilReportCopy.exportOverdue}</button>
                    <button type="button" onClick={() => exportOilServiceReport("urgent_overdue", "urgent-overdue")} disabled={!getOilReportRows("urgent_overdue").length} className="w-full rounded-lg px-3 py-2 text-left text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">{oilReportCopy.exportUrgentOverdue}</button>
                    <button type="button" onClick={() => exportOilServiceReport("due_soon", "due-soon")} disabled={!getOilReportRows("due_soon").length} className="w-full rounded-lg px-3 py-2 text-left text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">{oilReportCopy.exportDueSoon}</button>
                  </div>
                </details>
              </div>
            </div>
          </section>

          <section className="surface-card p-3.5 sm:p-4">
            {oilBaselineError ? (
              <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{oilBaselineError}</div>
            ) : null}

            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              {[
                { key: "overdue", label: oilReportCopy.overdueVehicles, value: oilReportSummary.overdue, tone: "text-rose-700", box: "border-rose-200 bg-rose-50/70" },
                { key: "urgent", label: oilReportCopy.urgentVehicles, value: oilReportSummary.urgent, tone: "text-orange-700", box: "border-orange-200 bg-orange-50/70" },
                { key: "due_soon", label: oilReportCopy.dueSoonVehicles, value: oilReportSummary.dueSoon, tone: "text-amber-700", box: "border-amber-200 bg-amber-50/70" },
                { key: "review_required", label: oilReportCopy.reviewRequired, value: oilReportSummary.reviewRequired, tone: "text-sky-700", box: "border-sky-200 bg-sky-50/70" },
                { key: "ok", label: oilReportCopy.okVehicles, value: oilReportSummary.ok, tone: "text-emerald-700", box: "border-emerald-200 bg-emerald-50/70" }
              ].map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setOilFilter(item.key as OilFilter)}
                  aria-pressed={oilFilter === item.key}
                  className={`rounded-xl border px-3 py-2.5 text-left transition hover:shadow-sm ${item.box} ${
                    oilFilter === item.key ? "ring-2 ring-violet-500/30 shadow-md" : ""
                  }`}
                >
                  <p className="metric-label">{item.label}</p>
                  <p className={`mt-0.5 text-xl font-black ${item.tone}`}>{formatNumber(item.value, language)}</p>
                </button>
              ))}
            </div>

            <div className="mt-3 flex flex-col gap-2 rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2.5 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-600">
                <span>{oilReportCopy.weeklyMileageUpdateStatus}</span>
                <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-emerald-700">{oilReportCopy.updatedThisWeek}: {formatNumber(weeklyMileageUpdateSummary.updatedThisWeek, language)}</span>
                <span className="rounded-full bg-amber-100 px-2.5 py-1 text-amber-800">{oilReportCopy.notUpdatedThisWeek}: {formatNumber(weeklyMileageUpdateSummary.notUpdatedThisWeek, language)}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {(["all", "overdue", "urgent", "due_soon", "review_required", "not_set", "ok"] as OilFilter[]).map((filter) => (
                  <button key={filter} type="button" onClick={() => setOilFilter(filter)} className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${oilFilter === filter ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"}`}>
                    {filter === "all" ? oilReportCopy.all : oilStatusLabel(filter)}
                  </button>
                ))}
              </div>
            </div>

            {loading ? (
              <div className="mt-4"><EmptyState title={t.common.loading} description={t.weeklyMileage.loading} /></div>
            ) : loadError ? (
              <div className="mt-4"><EmptyState title={t.weeklyMileage.errorLoad} description={loadError} /></div>
            ) : filteredOilChangeRows.length === 0 ? (
              <div className="mt-4"><EmptyState title={t.weeklyMileage.oil.noVehiclesInStatusTitle} description={t.weeklyMileage.oil.noVehiclesInStatusDescription} /></div>
            ) : (
              <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white">
                <div className="hidden grid-cols-[1.35fr_0.75fr_0.8fr_0.8fr_0.7fr_0.82fr_0.68fr] gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.08em] text-slate-400 xl:grid">
                  <span>{language === "th" ? "รถ / คนขับ" : "Vehicle / Driver"}</span>
                  <span>{language === "th" ? "เลขไมล์" : "Current KM"}</span>
                  <span>{language === "th" ? "ตั้งแต่เปลี่ยนน้ำมัน" : "Since Oil"}</span>
                  <span>{language === "th" ? "กำหนดถัดไป" : "Next Due"}</span>
                  <span>{language === "th" ? "คงเหลือ" : "Remaining"}</span>
                  <span>{language === "th" ? "อัปเดตล่าสุด" : "Updated"}</span>
                  <span className="text-right">{t.common.action}</span>
                </div>
                {filteredOilChangeRows.map((row) => {
                  const vehicleLogs = appendBaselineHistoryLog(row.registration, serviceLogsByVehicle.get(normalizeReg(row.registration)) ?? []);
                  const serviceHistoryCount = vehicleLogs.length || (row.lastOilChangeDate && row.lastOilChangeOdometer != null ? 1 : 0);
                  const progress = getServiceProgress(row);
                  const expanded = expandedOilRows[row.registration] === true;
                  const primaryAction = row.status === "not_set" ? oilReportCopy.setBaseline : oilReportCopy.markOilChanged;
                  return (
                    <article
                      key={row.registration}
                      className={`border-b border-slate-100 last:border-b-0 transition-colors hover:bg-slate-50/60 ${
                        row.status === "overdue"
                          ? "bg-rose-50/25"
                          : row.status === "urgent"
                            ? "bg-orange-50/20"
                            : row.status === "due_soon"
                              ? "bg-amber-50/20"
                              : "bg-white"
                      }`}
                    >
                      <div className="grid gap-2 px-4 py-2 xl:grid-cols-[1.35fr_0.75fr_0.8fr_0.8fr_0.7fr_0.82fr_0.68fr] xl:items-center">
                        <button type="button" onClick={() => setExpandedOilRows((current) => ({ ...current, [row.registration]: !expanded }))} className="min-w-0 text-left">
                          <div className="flex flex-wrap items-center gap-2"><span className="text-lg font-black text-slate-950">{row.registration}</span><span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.08em] ${oilStatusClass(row.status)}`}><OilStatusIcon status={row.status} />{oilStatusLabelForRow(row)}</span></div>
                          <p className="mt-1 truncate text-xs font-semibold text-slate-500">{row.driverName || oilReportCopy.noDriverAssigned} · {vehicleTypeLabel(row.vehicleType)}</p>
                        </button>
                        <div><p className="metric-label xl:hidden">{oilReportCopy.currentOdometer}</p><p className="font-bold text-slate-950">{row.currentOdometer == null ? "-" : formatKmValue(row.currentOdometer)}</p></div>
                        <div><p className="metric-label xl:hidden">{t.weeklyMileage.oil.kmUsedSinceOilChange}</p><p className="font-bold text-slate-950">{row.kmUsedSinceOilChange == null ? "-" : formatKmValue(row.kmUsedSinceOilChange)}</p></div>
                        <div><p className="metric-label xl:hidden">{oilReportCopy.nextServiceDue}</p><p className="font-bold text-slate-950">{formatKmValue(row.nextOilChangeDueOdometer)}</p></div>
                        <div><p className="metric-label xl:hidden">{oilReportCopy.kmRemaining}</p><p className={`text-base font-black tabular-nums ${kmRemainingClass(row.kmRemaining)}`}>{row.kmRemaining == null ? "-" : `${formatKmValue(row.kmRemaining)} km`}</p></div>
                        <div>
                          <p className="metric-label xl:hidden">{oilReportCopy.lastWeeklyMileageAdded}</p>
                          <p className="text-sm font-bold text-slate-950">{row.lastWeeklyMileageDate ? formatDate(row.lastWeeklyMileageDate, language) : "-"}</p>
                          <p className={`mt-0.5 inline-flex items-center gap-1 text-[10px] font-bold ${row.weeklyMileageUpdatedThisWeek ? "text-emerald-700" : "text-amber-700"}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${row.weeklyMileageUpdatedThisWeek ? "bg-emerald-500" : "bg-amber-500"}`} />
                            {row.weeklyMileageUpdatedThisWeek
                              ? (language === "th" ? "ล่าสุด" : "Current")
                              : (language === "th" ? "ต้องอัปเดต" : "Needs update")}
                          </p>
                        </div>
                        <div className="flex items-center justify-end gap-2">
                          {row.status === "overdue" || row.status === "urgent" || row.status === "due_soon" || row.status === "not_set" || row.status === "review_required" ? (
                            <button
                              type="button"
                              onClick={() => openServiceModal(row.status === "not_set" ? "set" : "mark", row)}
                              className="min-h-8 rounded-lg border border-violet-700 bg-violet-700 px-2.5 py-1.5 text-[11px] font-black text-white shadow-sm transition hover:bg-violet-800"
                            >
                              {row.status === "not_set"
                                ? (language === "th" ? "ตั้งค่า" : "Set Baseline")
                                : (language === "th" ? "บันทึกเปลี่ยน" : "Service")}
                            </button>
                          ) : null}
                          <details className="relative">
                            <summary className="flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50">•••</summary>
                            <div className="absolute right-0 top-10 z-30 min-w-[175px] rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
                              {row.status === "ok" ? (
                                <button
                                  type="button"
                                  onClick={() => openServiceModal("mark", row)}
                                  className="w-full rounded-lg px-3 py-2 text-left text-xs font-bold text-violet-700 hover:bg-violet-50"
                                >
                                  {language === "th" ? "บันทึกเปลี่ยนน้ำมัน" : "Mark Oil Changed"}
                                </button>
                              ) : null}
                              <button type="button" onClick={() => openServiceModal(row.status === "not_set" ? "set" : "edit", row)} className="w-full rounded-lg px-3 py-2 text-left text-xs font-bold text-slate-700 hover:bg-slate-50">{row.status === "not_set" ? oilReportCopy.setBaseline : oilReportCopy.edit}</button>
                              <button type="button" onClick={() => void openServiceHistory(row.registration)} className="w-full rounded-lg px-3 py-2 text-left text-xs font-bold text-slate-700 hover:bg-slate-50">{oilReportCopy.serviceHistory}</button>
                              <button type="button" onClick={() => setExpandedOilRows((current) => ({ ...current, [row.registration]: !expanded }))} className="w-full rounded-lg px-3 py-2 text-left text-xs font-bold text-slate-700 hover:bg-slate-50">{expanded ? (language === "th" ? "ซ่อนรายละเอียด" : "Hide details") : (language === "th" ? "ดูรายละเอียด" : "View details")}</button>
                            </div>
                          </details>
                        </div>
                      </div>
                      {expanded ? (
                        <div className="border-t border-slate-200 bg-slate-50/60 px-4 py-3">
                          <div className="mb-3 flex items-center justify-between gap-3 text-xs font-semibold text-slate-500"><span>{oilReportCopy.oilServiceUsage}</span><span>{progress == null ? oilReportCopy.waitingForBaseline : `${formatKmValue(progress.usedKm)} / ${formatKmValue(row.oilChangeIntervalKm)} KM (${oilReportCopy.percentUsed.replace("{percent}", progress.displayPercent)})`}</span></div>
                          <div className="h-2 overflow-hidden rounded-full bg-white ring-1 ring-slate-200"><div className={`h-full rounded-full ${progressBarClass(row.status)}`} style={{ width: `${progress?.barPercent ?? 0}%` }} /></div>
                          <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-5">
                            <div><p className="metric-label">{oilReportCopy.lastOilChange}</p><p className="mt-1 font-semibold text-slate-900">{row.lastOilChangeDate ? formatDate(row.lastOilChangeDate, language) : oilReportCopy.notSet}</p></div>
                            <div><p className="metric-label">{oilReportCopy.lastOdometer}</p><p className="mt-1 font-semibold text-slate-900">{formatKmValue(row.lastOilChangeOdometer)}</p></div>
                            <div><p className="metric-label">{oilReportCopy.interval}</p><p className="mt-1 font-semibold text-slate-900">{formatKmValue(row.oilChangeIntervalKm)} KM</p></div>
                            <div><p className="metric-label">{oilReportCopy.history}</p><p className="mt-1 font-semibold text-slate-900">{serviceHistoryCount ? `${formatNumber(serviceHistoryCount, language)} ${oilReportCopy.records}` : oilReportCopy.noRecords}</p></div>
                            <div><p className="metric-label">{language === "th" ? "การดำเนินการ" : "Action"}</p><p className="mt-1 font-semibold text-slate-900">{actionLine(row)}</p></div>
                          </div>
                          {row.reviewReasons.length ? <p className="mt-3 text-xs font-semibold text-sky-700">{row.reviewReasons.map(reviewReasonLabel).join("; ")}</p> : null}
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </>
      ) : null}


      {pageMode === "mileage" && mileageModalOpen ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-sm">
          <section className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-3xl border border-white/60 bg-white p-5 shadow-2xl sm:p-6">
            <form onSubmit={handleSubmit}>
              <div className="mb-5 flex items-start justify-between gap-4">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.14em] text-violet-600">
                    {language === "th" ? "เลขไมล์รายสัปดาห์" : "Weekly Mileage"}
                  </p>
                  <h3 className="mt-1 text-xl font-black text-slate-950">
                    {isEditing ? t.weeklyMileage.editEntry : t.weeklyMileage.addEntry}
                  </h3>
                  <p className="mt-1 text-sm text-slate-500">
                    {isEditing ? t.weeklyMileage.helperEdit : t.weeklyMileage.helperAdd}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setMileageModalOpen(false);
                    resetForm();
                  }}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50"
                  aria-label={language === "th" ? "ปิด" : "Close"}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

          <div className="form-section">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="form-field">
                <label className="form-label form-label-required">{t.weeklyMileage.weekEnding}</label>
                <input
                  type="date"
                  required
                  value={form.week_ending}
                  onChange={(event) => {
                    const nextWeekEnding = event.target.value;
                    setForm((current) => ({ ...current, week_ending: nextWeekEnding }));
                    rememberWeekEnding(nextWeekEnding);
                  }}
                  onInvalid={handleInvalid}
                  onInput={clearValidationMessage}
                  className="form-input bg-white"
                />
                <label className="mt-3 flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={multiEntryMode}
                    onChange={(event) => setMultiEntryMode(event.target.checked)}
                    className="mt-1 h-4 w-4 rounded border-slate-300 text-brand-600"
                  />
                  <span>
                    <span className="block">{fastEntryCopy.multiEntryMode}</span>
                    {multiEntryMode && form.week_ending ? (
                      <span className="mt-1 block text-xs font-normal text-slate-500">
                        {fastEntryCopy.dateWillRemain.replace("{date}", formatDate(form.week_ending, language))}
                      </span>
                    ) : null}
                  </span>
                </label>
              </div>

              <div className="form-field">
                <label className="form-label form-label-required">{t.weeklyMileage.driver}</label>
                <select
                  ref={driverSelectRef}
                  required
                  value={form.driver_id}
                  onChange={(event) => {
                    clearValidationMessage(event);
                    handleDriverChange(event.target.value);
                  }}
                  onInvalid={handleInvalid}
                  className="form-input bg-white"
                >
                  <option value="">{t.weeklyMileage.selectDriver}</option>
                  {drivers.map((driver) => (
                    <option key={driver.id} value={String(driver.id)}>
                      {driver.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-field">
                <label className="form-label form-label-required">{t.weeklyMileage.vehicleReg}</label>
                <input
                  ref={vehicleInputRef}
                  list="weekly-mileage-vehicle-options"
                  required
                  placeholder={assignmentCopy.searchRegistration}
                  value={form.vehicle_reg}
                  onChange={(event) => handleVehicleRegChange(event.target.value)}
                  onInvalid={handleInvalid}
                  onInput={clearValidationMessage}
                  className="form-input bg-white"
                />
                <datalist id="weekly-mileage-vehicle-options">
                  {activeVehicles.map((vehicle) => {
                    const registration = vehicle.vehicle_reg || vehicle.registration || "";
                    const vehicleType = vehicle.vehicle_type ? ` - ${vehicle.vehicle_type}` : "";
                    return (
                      <option key={vehicle.id || registration} value={registration}>
                        {registration}{vehicleType}
                      </option>
                    );
                  })}
                </datalist>
                <p className="form-helper">
                  {assignmentLoadError
                    ? assignmentLoadError
                    : showMultipleAssignedDrivers
                      ? assignmentCopy.multipleDriversAssigned
                      : showNoAssignedDriver
                        ? assignmentCopy.noDriverAssigned
                        : hasManualAssignmentMismatch
                          ? assignmentCopy.assignmentMismatch
                          : selectedDriverAssignedVehicleReg?.trim()
                    ? t.weeklyMileage.autoFilledVehicle
                    : t.weeklyMileage.noVehicleAssigned}
                </p>
                {selectedVehicle?.vehicle_type ? (
                  <p className="mt-1 text-xs text-slate-500">
                    {assignmentCopy.vehicleType}: {selectedVehicle.vehicle_type}
                  </p>
                ) : null}
                {!selectedVehicle && form.vehicle_reg ? (
                  <p className="mt-1 text-xs text-slate-500">{assignmentCopy.manualVehicleEntry}</p>
                ) : null}
              </div>

              <div className="form-field">
                <label className="form-label form-label-required">{t.weeklyMileage.mileage}</label>
                <input
                  ref={odometerInputRef}
                  type="number"
                  min="0"
                  step="1"
                  required
                  value={form.mileage}
                  onChange={(event) => setForm((current) => ({ ...current, mileage: event.target.value }))}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && multiEntryMode) {
                      submitActionRef.current = "next";
                    }
                  }}
                  onInvalid={handleInvalid}
                  onInput={clearValidationMessage}
                  className="form-input bg-white"
                />
                <p className="form-helper">
                  {previousVehicleEntry
                    ? `${formatDate(previousVehicleEntry.week_ending, language)} | ${formatNumber(previousVehicleEntry.mileage, language)}`
                    : t.weeklyMileage.noDataDescription}
                </p>
                {weeklyDifference != null && weeklyDifference < 0 ? (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    {t.weeklyMileage.mileageValidationError}
                  </div>
                ) : null}
              </div>

              <div className="form-field sm:col-span-2">
                <label className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.is_odometer_baseline}
                    onChange={(event) => setForm((current) => ({ ...current, is_odometer_baseline: event.target.checked }))}
                    className="mt-1 h-4 w-4 rounded border-slate-300 text-violet-700"
                  />
                  <span>
                    <span className="block font-semibold text-slate-950">{baselineCopy.action}</span>
                    <span className="mt-0.5 block text-xs text-slate-500">{baselineCopy.helper}</span>
                  </span>
                </label>
              </div>

              <div className="form-field sm:col-span-2">
                <label className="form-label">{baselineCopy.note}</label>
                <input
                  value={form.odometer_note}
                  onChange={(event) => setForm((current) => ({ ...current, odometer_note: event.target.value }))}
                  className="form-input bg-white"
                />
              </div>
            </div>

            {error ? <p className="form-error mt-3">{error}</p> : null}
            {successMessage ? <p className="mt-3 text-sm text-emerald-600">{successMessage}</p> : null}

            <div className="sticky bottom-3 z-10 mt-4 flex flex-col gap-2.5 rounded-[1.5rem] border border-slate-200/80 bg-white/95 p-3 shadow-[0_10px_30px_rgba(15,23,42,0.08)] backdrop-blur sm:static sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none sm:flex-row sm:items-center">
              <button type="submit" onClick={() => { submitActionRef.current = "save"; }} disabled={saving} className="btn-primary w-full sm:w-auto disabled:opacity-70">
                {saving ? t.common.saving : isEditing ? t.weeklyMileage.updateEntry : t.weeklyMileage.saveEntry}
              </button>
              {!isEditing ? (
                <button
                  type="submit"
                  onClick={() => {
                    submitActionRef.current = "next";
                  }}
                  disabled={saving}
                  className="btn-secondary w-full sm:w-auto disabled:opacity-70"
                >
                  {saving ? t.common.saving : fastEntryCopy.saveAndAddNext}
                </button>
              ) : null}
              {isEditing ? (
                <button type="button" onClick={() => { resetForm(); setMileageModalOpen(false); }} className="btn-secondary w-full sm:w-auto">
                  {t.common.cancel}
                </button>
              ) : null}
            </div>
          </div>
            </form>
          </section>
        </div>
      ) : null}


      {pageMode === "mileage" ? (
        <>
<section className="surface-card mt-3 p-4 sm:p-5">
        <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="section-title">{t.weeklyMileage.recordsForWeek}</h3>
              <span className="badge-muted">
                {formatDate(selectedWeekValue, language)} · {formatNumber(selectedWeekEntries.length, language)} {t.common.entries}
              </span>
            </div>
            <p className="section-subtitle">{t.weeklyMileage.recordsForWeekDescription}</p>
            <p className="mt-1 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">
              {language === "th" ? "เรียงตามระยะทางสัปดาห์: มาก → น้อย" : "Sorted by weekly distance: highest → lowest"}
            </p>
          </div>

          <div className="flex w-full items-center gap-1 rounded-xl border border-slate-200 bg-slate-50/70 p-1.5 lg:w-auto">
            <button
              type="button"
              onClick={() => previousWeekValue && setSelectedWeek(previousWeekValue)}
              disabled={!previousWeekValue}
              title={language === "th" ? "สัปดาห์ก่อน" : "Previous week"}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-sm font-black text-slate-700 shadow-sm transition hover:bg-slate-100 disabled:opacity-35"
            >
              ←
            </button>
            <select
              value={selectedWeekValue}
              onChange={(event) => setSelectedWeek(event.target.value)}
              className="h-9 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-800 lg:w-[180px] lg:flex-none"
            >
              {availableWeeks.map((week) => (
                <option key={week} value={week}>
                  {formatDate(week, language)}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => nextWeekValue && setSelectedWeek(nextWeekValue)}
              disabled={!nextWeekValue}
              title={language === "th" ? "สัปดาห์ถัดไป" : "Next week"}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-sm font-black text-slate-700 shadow-sm transition hover:bg-slate-100 disabled:opacity-35"
            >
              →
            </button>
            <button
              type="button"
              onClick={exportWeeklyMileage}
              disabled={!sortedEntries.length}
              className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-white px-3 text-xs font-bold text-slate-700 shadow-sm transition hover:bg-slate-100 disabled:opacity-40"
            >
              <Download className="h-3.5 w-3.5" />
              {t.common.export}
            </button>
          </div>
        </div>

        {loading ? (
          <EmptyState title={t.common.loading} description={t.weeklyMileage.loading} />
        ) : loadError ? (
          <EmptyState title={t.weeklyMileage.errorLoad} description={loadError} />
        ) : selectedWeekEntries.length === 0 ? (
          <EmptyState title={t.weeklyMileage.noDataTitle} description={t.weeklyMileage.noDataDescription} />
        ) : (
          <>
            <div className="space-y-3.5 md:hidden">
              {pagedEntries.map((entry) => (
                <div key={entry.id} className="subtle-panel p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="table-driver-name">{entry.driver || "-"}</p>
                      <p className="mt-1 text-sm text-slate-500">{entry.vehicle_reg || "-"}</p>
                    </div>
                    <p className="supporting-date-strong">{formatDate(entry.week_ending, language)}</p>
                  </div>
                  {(() => {
                    const operational = selectedWeekOperationalRows.get(String(entry.id));
                    return (
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <div className="rounded-xl bg-slate-50 p-3">
                          <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400">
                            {language === "th" ? "เลขไมล์ปัจจุบัน" : "Current Odo."}
                          </p>
                          <p className="mt-1 font-black text-slate-950">{formatNumber(entry.mileage, language)}</p>
                        </div>
                        <div className="rounded-xl bg-slate-50 p-3">
                          <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400">
                            {language === "th" ? "ระยะทางสัปดาห์" : "Weekly KM"}
                          </p>
                          <p className="mt-1 font-black text-slate-950">
                            {operational?.weeklyKm == null ? "-" : `${formatNumber(operational.weeklyKm, language)} km`}
                          </p>
                        </div>
                      </div>
                    );
                  })()}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {entry.is_odometer_baseline ? <span className="badge-muted">{baselineCopy.badge}</span> : null}
                    {!entry.is_odometer_baseline && entry.week_ending < "2026-06-07" ? <span className="badge-muted">{baselineCopy.legacy}</span> : null}
                    {entry.odometer_note ? <span className="text-xs text-slate-500">{entry.odometer_note}</span> : null}
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button type="button" onClick={() => openMileageEdit(entry)} className="btn-secondary flex-1">
                      {t.common.edit}
                    </button>
                    <button type="button" onClick={() => void handleDelete(String(entry.id))} disabled={deletingId === String(entry.id)} className="btn-danger flex-1 gap-2 disabled:opacity-50">
                      <Trash2 className="h-4 w-4" />
                      {deletingId === String(entry.id) ? t.common.deleting : t.common.delete}
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="hidden md:block">
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <div className="table-scroll">
                  <table className="w-full min-w-[1080px] text-sm">
                    <thead>
                      <tr className="bg-slate-50 text-slate-500">
                        <th className="table-head-cell text-left">{t.weeklyMileage.table.driver}</th>
                        <th className="table-head-cell text-left">{t.weeklyMileage.table.vehicleReg}</th>
                        <th className="table-head-cell text-right">{language === "th" ? "เลขไมล์ก่อนหน้า" : "Previous Odometer"}</th>
                        <th className="table-head-cell text-right">{language === "th" ? "เลขไมล์ปัจจุบัน" : "Current Odometer"}</th>
                        <th className="table-head-cell text-right">{language === "th" ? "ระยะทางสัปดาห์" : "Weekly KM"}</th>
                        <th className="table-head-cell text-right">{t.weeklyMileage.table.action}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedEntries.map((entry) => {
                        const operational = selectedWeekOperationalRows.get(String(entry.id));
                        const status = operational?.status ?? "no_previous";
                        return (
                          <tr key={entry.id} className="enterprise-table-row">
                            <td className="table-body-cell py-3 table-driver-name">{entry.driver || "-"}</td>
                            <td className="table-body-cell py-3 font-black text-slate-900">
                              <div>{entry.vehicle_reg || "-"}</div>
                              {status === "baseline" ? (
                                <span className="mt-1 inline-flex rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] text-sky-700">
                                  {baselineCopy.badge}
                                </span>
                              ) : status === "review" ? (
                                <span className="mt-1 inline-flex rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] text-rose-700">
                                  {language === "th" ? "ตรวจสอบ" : "Review"}
                                </span>
                              ) : status === "no_previous" ? (
                                <span className="mt-1 inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] text-amber-700">
                                  {language === "th" ? "ไม่มีสัปดาห์ก่อน" : "No previous week"}
                                </span>
                              ) : null}
                            </td>
                            <td className="table-body-cell py-3 text-right tabular-nums text-slate-500">
                              {operational?.previousEntry
                                ? formatNumber(operational.previousEntry.mileage, language)
                                : "-"}
                            </td>
                            <td className="table-body-cell py-3 text-right font-semibold tabular-nums text-slate-900">
                              {formatNumber(entry.mileage, language)}
                            </td>
                            <td className="table-body-cell py-3 text-right text-base font-black tabular-nums text-violet-800">
                              {operational?.weeklyKm == null ? "-" : `${formatNumber(operational.weeklyKm, language)} km`}
                            </td>
                            <td className="table-body-cell">
                              <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                                <button type="button" onClick={() => openMileageEdit(entry)} className="table-action-secondary">
                                  {t.common.edit}
                                </button>
                                <details className="relative">
                                  <summary className="flex h-9 w-10 cursor-pointer list-none items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50">
                                    •••
                                  </summary>
                                  <div className="absolute right-0 top-10 z-30 min-w-[145px] rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
                                    <button
                                      type="button"
                                      onClick={() => void handleDelete(String(entry.id))}
                                      disabled={deletingId === String(entry.id)}
                                      className="w-full rounded-lg px-3 py-2 text-left text-xs font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                                    >
                                      {deletingId === String(entry.id) ? t.common.deleting : t.common.delete}
                                    </button>
                                  </div>
                                </details>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between gap-3">
              <p className="text-sm text-slate-500">
                {t.common.page} {formatNumber(Math.min(tablePage, selectedWeekTotalPages), language)} {t.common.of} {formatNumber(selectedWeekTotalPages, language)}
              </p>
              <div className="flex gap-2">
                <button type="button" onClick={() => setTablePage((current) => Math.max(1, current - 1))} disabled={tablePage === 1} className="btn-secondary disabled:opacity-50">
                  {t.common.previous}
                </button>
                <button type="button" onClick={() => setTablePage((current) => Math.min(selectedWeekTotalPages, current + 1))} disabled={tablePage >= selectedWeekTotalPages} className="btn-secondary disabled:opacity-50">
                  {t.common.next}
                </button>
              </div>
            </div>
          </>
        )}
      </section>
        </>
      ) : null}


      {pageMode === "results" ? (
        <>
<section className="surface-card mt-3 p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 className="section-title">{language === "th" ? "ระยะทางคนขับสัปดาห์นี้" : "This Week - Driver Distance"}</h3>
            <p className="section-subtitle">{language === "th" ? "ดูระยะทางสูงสุดของสัปดาห์ และเลือกคนขับเพื่อดูประวัติ" : "See this week's leading distances, then select a driver to inspect their history."}</p>
          </div>
          <span className="badge-muted">{formatNumber(weeklyDistanceByDriverRows.length, language)} {t.common.entries}</span>
        </div>

        {loading ? (
          <div className="mt-4"><EmptyState title={t.common.loading} description={t.weeklyMileage.loading} /></div>
        ) : (
          <div className="mt-3 space-y-3">
            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5">
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-sm font-black text-slate-950">{language === "th" ? "ระยะทางสูงสุด 5 อันดับในสัปดาห์" : "Top 5 this week"}</p>
                <span className="text-xs font-semibold text-slate-500">{formatDate(selectedWeekValue, language)}</span>
              </div>
              {weeklyDistanceByDriverRows.length === 0 ? (
                <p className="text-sm text-slate-500">{t.weeklyMileage.weeklyDistanceCoveredUnavailable}</p>
              ) : (
                <div className="grid gap-2 lg:grid-cols-5">
                  {weeklyDistanceByDriverRows.slice(0, 5).map((row, index) => (
                    <button
                      key={`${row.driverId}-${row.latestWeekEnding}`}
                      type="button"
                      onClick={() => setComparisonDriverId(String(row.driverId))}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-left transition hover:border-violet-200 hover:bg-violet-50/30"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">#{index + 1}</span>
                        <span className="text-sm font-black text-slate-950">{formatNumber(row.weeklyDistance!, language)} km</span>
                      </div>
                      <p className="mt-1.5 truncate font-black text-slate-900">{row.driver}</p>
                      <p className="mt-0.5 truncate text-xs text-slate-400">{row.vehicleReg}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-3.5">
              <div className="grid gap-2.5 lg:grid-cols-[215px_minmax(0,1fr)]">
                <div className="form-field">
                  <label className="form-label">{language === "th" ? "ประวัติคนขับ" : "Driver History"}</label>
                  <select value={comparisonDriverId} onChange={(event) => setComparisonDriverId(event.target.value)} className="form-input bg-white">
                    <option value="">{t.weeklyMileage.selectDriver}</option>
                    {comparisonDrivers.map((driver) => (
                      <option key={driver.id} value={String(driver.id)}>{driver.name}</option>
                    ))}
                  </select>
                  {!selectedComparison ? (
                    <p className="mt-2 text-xs text-slate-500">{language === "th" ? "เลือกคนขับเพื่อดูเลขไมล์และประวัติ 5 สัปดาห์ล่าสุด" : "Select a driver to view odometers, weekly KM and the latest 5 weeks."}</p>
                  ) : null}
                </div>

                {!selectedComparison ? (
                  <div className="flex min-h-[88px] items-center rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-4 text-sm text-slate-500">
                    {language === "th" ? "เลือกคนขับทางซ้ายเพื่อดูประวัติ" : "Select a driver to view their recent mileage history."}
                  </div>
                ) : selectedComparison.unusual || !selectedComparison.previousWeekEnding ? (
                  <div className="flex min-h-[88px] items-center rounded-xl border border-amber-200 bg-amber-50 px-4 text-sm font-semibold text-amber-800">
                    {t.weeklyMileage.weeklyComparisonHistoryDescription}
                  </div>
                ) : (
                  <div className="grid gap-3 xl:grid-cols-[1.05fr_0.95fr]">
                    <div className="rounded-xl bg-slate-50/70 p-3">
                      <div className="grid gap-x-4 gap-y-2.5 sm:grid-cols-3">
                        <div><p className="metric-label">{t.weeklyMileage.currentOdometer}</p><p className="mt-1 font-black text-slate-950">{formatNumber(selectedComparison.latestOdometer, language)}</p></div>
                        <div><p className="metric-label">{t.weeklyMileage.previousOdometer}</p><p className="mt-1 font-black text-slate-950">{formatNumber(selectedComparison.previousOdometer!, language)}</p></div>
                        <div><p className="metric-label">{t.weeklyMileage.weeklyDistanceCovered}</p><p className="mt-1 font-black text-slate-950">{formatNumber(selectedComparison.weeklyDistance!, language)} km</p></div>
                        <div><p className="metric-label">{t.weeklyMileage.selectedVehicleReg}</p><p className="mt-1 font-semibold text-slate-900">{selectedComparison.vehicleReg || "-"}</p></div>
                        <div><p className="metric-label">{t.weeklyMileage.currentReportingWeek}</p><p className="mt-1 font-semibold text-slate-900">{formatDate(selectedComparison.latestWeekEnding, language)}</p></div>
                        <div><p className="metric-label">{t.weeklyMileage.previousReportingWeek}</p><p className="mt-1 font-semibold text-slate-900">{formatDate(selectedComparison.previousWeekEnding!, language)}</p></div>
                      </div>
                    </div>
                    <div className="rounded-xl bg-slate-50/70 p-3">
                      <p className="text-sm font-black text-slate-900">{t.weeklyMileage.weeklyComparisonHistory}</p>
                      <div className="mt-1.5 space-y-1">
                        {selectedComparisonHistory.map((entry) => (
                          <div key={entry.id} className="flex items-center justify-between gap-3 border-b border-slate-200/70 pb-2 last:border-b-0 last:pb-0">
                            <div><p className="text-xs font-bold text-slate-800">{formatDate(entry.week_ending, language)}</p><p className="text-[11px] text-slate-400">{entry.vehicle_reg || "-"}</p></div>
                            <p className="text-sm font-black text-slate-950">{formatNumber(entry.mileage, language)}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </section>
        </>
      ) : null}


      {serviceModal ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/45 p-3 sm:items-center">
          <div className="max-h-[92vh] w-full max-w-[620px] overflow-y-auto rounded-lg bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-950">
                  {serviceModal.mode === "mark"
                    ? t.weeklyMileage.oil.markOilChanged
                    : serviceModal.mode === "edit"
                      ? t.weeklyMileage.oil.editBaseline
                      : t.weeklyMileage.oil.setOilChangeBaseline}
                </h3>
                <p className="mt-1 text-sm text-slate-500">{serviceModal.registration} | {serviceModal.vehicleName}</p>
              </div>
              <button type="button" onClick={closeServiceModal} className="table-action-secondary" aria-label={t.weeklyMileage.oil.closeServiceForm}>
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveService} className="p-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="form-field">
                  <label className="form-label form-label-required">{t.weeklyMileage.oil.vehicleRegistration}</label>
                  <input
                    required
                    value={serviceForm.vehicleReg}
                    onChange={(event) => setServiceForm((current) => ({ ...current, vehicleReg: event.target.value }))}
                    className="form-input bg-white"
                  />
                </div>
                <div className="form-field">
                  <label className="form-label form-label-required">{t.weeklyMileage.oil.serviceType}</label>
                  <select
                    required
                    value={serviceForm.serviceType}
                    onChange={(event) => setServiceForm((current) => ({ ...current, serviceType: event.target.value }))}
                    className="form-input bg-white"
                  >
                    <option value="oil_change">{t.weeklyMileage.oil.oilChange}</option>
                  </select>
                </div>
                <div className="form-field">
                  <label className="form-label form-label-required">{t.weeklyMileage.oil.lastOilChangeDate}</label>
                  <input
                    type="date"
                    required
                    value={serviceForm.serviceDate}
                    onChange={(event) => setServiceForm((current) => ({ ...current, serviceDate: event.target.value }))}
                    className="form-input bg-white"
                  />
                </div>
                <div className="form-field">
                  <label className="form-label form-label-required">{t.weeklyMileage.oil.lastOilChangeOdometer}</label>
                  <input
                    type="number"
                    required
                    min="0"
                    step="1"
                    value={serviceForm.serviceOdometer}
                    onChange={(event) => setServiceForm((current) => ({ ...current, serviceOdometer: event.target.value }))}
                    className="form-input bg-white"
                  />
                  <p className="form-helper">{t.weeklyMileage.oil.oilChangeOdometerHelper}</p>
                </div>
                <div className="form-field">
                  <label className="form-label form-label-required">{t.weeklyMileage.oil.intervalKm}</label>
                  <input
                    type="number"
                    required
                    min="1"
                    step="1"
                    value={serviceForm.intervalKm}
                    onChange={(event) => setServiceForm((current) => ({ ...current, intervalKm: event.target.value }))}
                    className="form-input bg-white"
                  />
                </div>
                <div className="form-field">
                  <label className="form-label">{t.weeklyMileage.notes}</label>
                  <input
                    value={serviceForm.notes}
                    onChange={(event) => setServiceForm((current) => ({ ...current, notes: event.target.value }))}
                    placeholder={t.weeklyMileage.oil.optionalServiceNote}
                    className="form-input bg-white"
                  />
                </div>
              </div>

              {error ? <p className="form-error mt-4">{error}</p> : null}

              <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button type="button" onClick={closeServiceModal} disabled={savingService} className="btn-secondary disabled:opacity-50">
                  {t.common.cancel}
                </button>
                <button type="submit" disabled={savingService} className="btn-primary disabled:opacity-60">
                  {savingService ? t.common.saving : serviceModal.mode === "mark" ? t.weeklyMileage.oil.saveOilChange : t.common.save}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {historyVehicleReg ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/45 p-3 sm:items-center">
          <div className="max-h-[92vh] w-full max-w-[720px] overflow-y-auto rounded-lg bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-950">{t.weeklyMileage.oil.serviceHistory}</h3>
                <p className="mt-1 text-sm text-slate-500">{historyVehicleReg}</p>
              </div>
              <button type="button" onClick={() => setHistoryVehicleReg(null)} className="table-action-secondary" aria-label={t.weeklyMileage.oil.closeServiceHistory}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5">
              {error ? <p role="alert" className="form-error mb-3">{error}</p> : null}
              {successMessage ? <p role="status" className="mb-3 text-sm text-purple-700">{successMessage}</p> : null}
              {loading ? <p role="status" className="mb-3 text-sm text-slate-500">{t.common.loading}</p> : null}
              {selectedHistoryLogs.length === 0 ? (
                <EmptyState title={t.weeklyMileage.oil.noServiceHistoryTitle} description={t.weeklyMileage.oil.noServiceHistoryDescription} />
              ) : (
                <div className="space-y-3">
                  {selectedHistoryLogs.map((log) => {
                    const kmSincePrevious = historyDistanceSinceService(log, entries);
                    const isSyntheticBaseline = log.id.startsWith("vehicle-baseline-") || log.id.startsWith("baseline-");

                    return (
                    <div key={log.id} className="subtle-panel p-4">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="font-semibold text-slate-950">{formatDate(log.service_date, language)}</p>
                          <p className="mt-1 text-sm text-slate-500">{log.notes || t.weeklyMileage.oil.oilChangedNote}</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <span className="badge-muted">{log.service_type === "oil_change" ? t.weeklyMileage.oil.oilChange : log.service_type}</span>
                          <button
                            type="button"
                            onClick={() => openServiceLogModal(log)}
                            disabled={isSyntheticBaseline || savingService || deletingServiceLogId != null}
                            className="table-action-secondary gap-1.5 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            {t.weeklyMileage.oil.editOilChange}
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDeleteServiceLog(log)}
                            disabled={isSyntheticBaseline || savingService || deletingServiceLogId != null}
                            className="table-action-danger gap-1.5 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            {deletingServiceLogId === log.id ? t.common.deleting : t.weeklyMileage.oil.deleteOilChange}
                          </button>
                        </div>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-3 text-sm md:grid-cols-5">
                        <div>
                          <p className="metric-label">{t.weeklyMileage.oil.serviceOdometer}</p>
                          <p className="mt-1 font-semibold text-slate-900">{formatKmValue(log.odometer)}</p>
                        </div>
                        <div>
                          <p className="metric-label">{t.weeklyMileage.oil.intervalKm}</p>
                          <p className="mt-1 font-semibold text-slate-900">{formatKmValue(log.interval_km)}</p>
                        </div>
                        <div>
                          <p className="metric-label">{t.weeklyMileage.nextServiceDue}</p>
                          <p className="mt-1 font-semibold text-slate-900">{formatKmValue(log.interval_km != null ? log.odometer + log.interval_km : null)}</p>
                        </div>
                        <div>
                          <p className="metric-label">{t.weeklyMileage.oil.kmUsedSinceOilChange}</p>
                          <p className={`mt-1 font-semibold ${kmSincePrevious != null && kmSincePrevious < 0 ? "text-rose-700" : "text-slate-900"}`}>
                            {kmSincePrevious == null || kmSincePrevious < 0 ? oilReportStatusLabel("review_required") : formatKmValue(kmSincePrevious)}
                          </p>
                        </div>
                        <div>
                          <p className="metric-label">{t.weeklyMileage.oil.recordedAt}</p>
                          <p className="mt-1 font-semibold text-slate-900">{recordedServiceDate(log.created_at) ? formatDate(recordedServiceDate(log.created_at)!, language) : "-"}</p>
                        </div>
                      </div>
                    </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function WeeklyDistanceHistoryMetric({
  detail,
  emphasis = false,
  label,
  value
}: {
  detail?: string;
  emphasis?: boolean;
  label: string;
  value: string;
}) {
  return (
    <div className={`subtle-panel p-4 ${emphasis ? "border-sky-200 bg-sky-50/70" : ""}`}>
      <p className="metric-label">{label}</p>
      <p className={`mt-2 text-lg font-bold tracking-normal ${emphasis ? "text-sky-900" : "text-slate-950"}`}>
        {value}
      </p>
      {detail ? <p className="mt-1 text-xs font-semibold text-slate-500">{detail}</p> : null}
    </div>
  );
}

function WeeklyDistanceHistoryChart({ language, rows }: { language: Language; rows: WeeklyDistanceHistoryRow[] }) {
  const chartRows = [...rows].reverse();
  const width = 720;
  const height = 240;
  const padding = { bottom: 42, left: 54, right: 24, top: 18 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const averageDistance = chartRows.length
    ? chartRows.reduce((sum, row) => sum + row.weeklyDistance, 0) / chartRows.length
    : 0;
  const maxDistance = Math.max(...chartRows.map((row) => row.weeklyDistance), averageDistance, 1);
  const averageY = padding.top + plotHeight - (averageDistance / maxDistance) * plotHeight;
  const points = chartRows.map((row, index) => {
    const x = chartRows.length === 1 ? padding.left + plotWidth / 2 : padding.left + (index / (chartRows.length - 1)) * plotWidth;
    const y = padding.top + plotHeight - (row.weeklyDistance / maxDistance) * plotHeight;
    return { ...row, x, y };
  });
  const pathData = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  const yTicks = [0, 0.5, 1].map((ratio) => Math.round(maxDistance * ratio));
  const visibleLabels = points.filter((_, index) => {
    if (points.length <= 6) return true;
    return index === 0 || index === points.length - 1 || index % Math.ceil(points.length / 5) === 0;
  });

  return (
    <div className="w-full overflow-hidden rounded-lg border border-slate-100 bg-slate-50/70">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Weekly Distance Covered trend" className="h-[240px] w-full">
        <rect x="0" y="0" width={width} height={height} fill="#f8fafc" />
        {yTicks.map((tick) => {
          const y = padding.top + plotHeight - (tick / maxDistance) * plotHeight;
          return (
            <g key={tick}>
              <line x1={padding.left} x2={width - padding.right} y1={y} y2={y} stroke="#e2e8f0" strokeWidth="1" />
              <text x={padding.left - 10} y={y + 4} textAnchor="end" className="fill-slate-500 text-[11px] font-semibold">
                {formatNumber(tick, language, 0)}
              </text>
            </g>
          );
        })}
        <line x1={padding.left} x2={padding.left} y1={padding.top} y2={height - padding.bottom} stroke="#cbd5e1" strokeWidth="1" />
        <line x1={padding.left} x2={width - padding.right} y1={height - padding.bottom} y2={height - padding.bottom} stroke="#cbd5e1" strokeWidth="1" />
        <line
          x1={padding.left}
          x2={width - padding.right}
          y1={averageY}
          y2={averageY}
          stroke="#94a3b8"
          strokeDasharray="5 5"
          strokeWidth="1.2"
        />
        <text x={width - padding.right - 6} y={averageY - 7} textAnchor="end" className="fill-slate-500 text-[11px] font-semibold">
          12-week average {formatNumber(averageDistance, language, 0)}
        </text>
        <path d={pathData} fill="none" stroke="#2563eb" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" />
        {points.map((point) => (
          <g key={point.weekEnding}>
            <title>
              {`${formatDate(point.weekEnding, language)}
${formatNumber(point.weeklyDistance, language, 0)} km
${formatNumber(point.validVehicleEntries, language, 0)} / ${formatNumber(point.expectedVehicleEntries, language, 0)} vehicles
${point.weekOnWeekChangePercent == null ? "No previous week to compare" : `${point.weekOnWeekChangePercent > 0 ? "+" : ""}${formatNumber(point.weekOnWeekChangePercent, language, 1)}% vs previous week`}${point.missingVehicleCount ? `\n${formatNumber(point.missingVehicleCount, language, 0)} missing` : ""}`}
            </title>
            <circle cx={point.x} cy={point.y} r={point.missingVehicleCount ? "5.5" : "4.5"} fill={point.missingVehicleCount ? "#f59e0b" : "#2563eb"} />
            <circle cx={point.x} cy={point.y} r="8" fill={point.missingVehicleCount ? "#f59e0b" : "#2563eb"} opacity="0.12" />
          </g>
        ))}
        {visibleLabels.map((point) => (
          <text
            key={`label-${point.weekEnding}`}
            x={point.x}
            y={height - 17}
            textAnchor="middle"
            className="fill-slate-500 text-[11px] font-semibold"
          >
            {formatDate(point.weekEnding, language)}
          </text>
        ))}
      </svg>
    </div>
  );
}
