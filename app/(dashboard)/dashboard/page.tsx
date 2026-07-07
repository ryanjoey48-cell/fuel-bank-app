"use client";

import {
  AlertTriangle,
  ArrowRightLeft,
  CalendarPlus,
  CheckCircle2,
  ClipboardList,
  Droplet,
  Fuel,
  Gauge,
  Plus,
  RefreshCw,
  Route,
  Ticket,
  Truck,
  UserRound,
  Wallet
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/empty-state";
import { Header } from "@/components/header";
import {
  fetchBookingDiaryEntries,
  fetchDrivers,
  fetchFuelLogs,
  fetchOilChangeBaselinesForVehicles,
  fetchSupportTicketNotificationCount,
  fetchTransfers,
  fetchTripJourneys,
  fetchVehicles,
  fetchWeeklyMileage
} from "@/lib/data";
import { useLanguage } from "@/lib/language-provider";
import { buildOilChangeAlertRows, type OilChangeAlertRow } from "@/lib/operations";
import { formatCurrency, formatDate, formatNumber, normalizeVehicleRegistration } from "@/lib/utils";
import type {
  BankTransferWithDriver,
  BookingDiaryEntry,
  Driver,
  DriverVehicleType,
  FuelLogWithDriver,
  OilChangeBaseline,
  TripJourneyWithFuel,
  Vehicle,
  WeeklyMileageEntry
} from "@/types/database";

type AttentionTone = "danger" | "warning" | "info";

type AttentionItem = {
  actionHref: string;
  actionLabel: string;
  count: number;
  detail: string;
  icon: typeof Wallet;
  key: string;
  title: string;
  tone: AttentionTone;
};

type SpotlightRow = {
  driver: string;
  vehicle: string;
  kmPerLitre: number;
} | null;

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

function getPercentChange(current: number, previous: number) {
  if (previous <= 0) {
    return current > 0 ? 100 : 0;
  }
  return ((current - previous) / previous) * 100;
}

function formatTrend(current: number, previous: number, language: string, _inverseGood = false) {
  const locale = language === "th" ? "th" : "en";
  const change = getPercentChange(current, previous);
  if (Math.abs(change) < 0.5) {
    return locale === "th" ? "ไม่เปลี่ยนแปลงจากเดือนก่อน" : "No change vs last month";
  }
  const arrow = change > 0 ? "up" : "down";
  const direction = arrow === "up" ? (locale === "th" ? "เพิ่มขึ้น" : "up") : (locale === "th" ? "ลดลง" : "down");
  return `${arrow === "up" ? "▲" : "▼"} ${formatNumber(Math.abs(change), locale, 0)}% ${direction} ${locale === "th" ? "เทียบเดือนก่อน" : "vs last month"}`;
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

function getActualTripDistance(trip: TripJourneyWithFuel) {
  if (trip.manual_actual_km != null && trip.manual_actual_km > 0) return trip.manual_actual_km;
  if (trip.start_mileage != null && trip.end_mileage != null && trip.end_mileage > trip.start_mileage) {
    return trip.end_mileage - trip.start_mileage;
  }
  if (trip.actual_distance_km != null && trip.actual_distance_km > 0) return trip.actual_distance_km;
  return null;
}

function getEstimatedTripDistance(trip: TripJourneyWithFuel) {
  if (trip.manual_estimated_distance_km != null && trip.manual_estimated_distance_km > 0) return trip.manual_estimated_distance_km;
  if (trip.google_estimated_km != null && trip.google_estimated_km > 0) return trip.google_estimated_km;
  if (trip.booking_estimated_km != null && trip.booking_estimated_km > 0) return trip.booking_estimated_km;
  if (trip.estimated_distance_km != null && trip.estimated_distance_km > 0) return trip.estimated_distance_km;
  return null;
}

function getTripFuelLitres(trip: TripJourneyWithFuel) {
  if (trip.fuel_source === "manual") return trip.manual_litres_used != null && trip.manual_litres_used > 0 ? trip.manual_litres_used : null;
  const linkedLitres = trip.linkedFuelLogs.reduce((sum, log) => sum + Number(log.litres || 0), 0);
  return linkedLitres > 0 ? linkedLitres : null;
}

function buildDriverSpotlight({
  allLogs,
  monthlyLogs,
  vehicleTypeLookup
}: {
  allLogs: FuelLogWithDriver[];
  monthlyLogs: FuelLogWithDriver[];
  vehicleTypeLookup: Map<string, string>;
}): { best: SpotlightRow; worst: SpotlightRow } {
  const monthlyIds = new Set(monthlyLogs.map((log) => String(log.id)));
  const previousByVehicle = new Map<string, FuelLogWithDriver>();
  const rows: Array<{ driver: string; vehicle: string; kmPerLitre: number }> = [];

  for (const log of [...allLogs].sort((left, right) => left.date.localeCompare(right.date) || String(left.id).localeCompare(String(right.id)))) {
    const vehicle = normalizeVehicleRegistration(log.vehicle_reg);
    const currentMileage = getFuelLogMileage(log);
    const previous = vehicle ? previousByVehicle.get(vehicle) : null;
    const previousMileage = getFuelLogMileage(previous);
    const litres = Number(log.litres || 0);

    if (vehicle && currentMileage != null) previousByVehicle.set(vehicle, log);
    if (!monthlyIds.has(String(log.id)) || !vehicle || currentMileage == null || previousMileage == null || currentMileage <= previousMileage || litres <= 0) continue;

    const kmDriven = currentMileage - previousMileage;
    if (kmDriven < 50 || kmDriven > 2000) continue;

    const kmPerLitre = kmDriven / litres;
    const thresholds = getKmPerLitreThresholds(vehicleTypeLookup.get(vehicle));
    if (!Number.isFinite(kmPerLitre) || kmPerLitre < thresholds.low || kmPerLitre > thresholds.high) continue;

    rows.push({
      driver: log.driver || "-",
      vehicle: log.vehicle_reg || "-",
      kmPerLitre
    });
  }

  const grouped = new Map<string, { driver: string; vehicle: string; total: number; count: number }>();
  for (const row of rows) {
    const key = `${row.driver}::${row.vehicle}`;
    const current = grouped.get(key) ?? { driver: row.driver, vehicle: row.vehicle, total: 0, count: 0 };
    current.total += row.kmPerLitre;
    current.count += 1;
    grouped.set(key, current);
  }

  const averaged = Array.from(grouped.values())
    .filter((row) => row.count > 0)
    .map((row) => ({ driver: row.driver, vehicle: row.vehicle, kmPerLitre: row.total / row.count }))
    .sort((left, right) => right.kmPerLitre - left.kmPerLitre);

  return {
    best: averaged[0] ?? null,
    worst: averaged.length > 1 ? averaged[averaged.length - 1] : null
  };
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
      ? "border-l-rose-500 bg-rose-50/70 text-rose-700"
      : item.tone === "warning"
        ? "border-l-amber-500 bg-amber-50/70 text-amber-700"
        : "border-l-sky-500 bg-sky-50/70 text-sky-700";

  return (
    <div className={`rounded-lg border border-slate-200 border-l-4 bg-white px-3.5 py-3 shadow-sm ${toneClass}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white shadow-sm">
            <item.icon className="h-4.5 w-4.5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-bold text-slate-950">{item.title}</p>
              <span className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-slate-700 shadow-sm">
                {formatNumber(item.count)}
              </span>
            </div>
            <p className="mt-0.5 text-xs leading-5 text-slate-600">{item.detail}</p>
          </div>
        </div>
        <a href={item.actionHref} className="btn-secondary min-h-9 shrink-0 px-3 py-1.5 text-xs">
          {item.actionLabel}
        </a>
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
  const [bookings, setBookings] = useState<BookingDiaryEntry[]>([]);
  const [tripJourneys, setTripJourneys] = useState<TripJourneyWithFuel[]>([]);
  const [supportTicketAttentionCount, setSupportTicketAttentionCount] = useState(0);
  const [selectedMonth, setSelectedMonth] = useState(() => getCurrentMonthKey());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const copy = {
    allIssues: language === "th" ? "ดูรายการทั้งหมด" : "View all issues",
    avgKmPerLitre: language === "th" ? "เฉลี่ย กม./ลิตร" : "Average km/L",
    bankTransfersNotChecked: language === "th" ? "รายการโอนเงินยังไม่ได้ตรวจสอบ" : "Bank transfers not checked",
    currentMonth: language === "th" ? "เดือนปัจจุบัน" : "Current month",
    dateRange: language === "th" ? "ช่วงวันที่" : "Date range",
    dueSoon: language === "th" ? "ใกล้ครบกำหนด" : "Due Soon",
    fuelEntries: language === "th" ? "รายการน้ำมัน" : "fuel entries",
    fuelLogsNotChecked: language === "th" ? "บันทึกน้ำมันยังไม่ได้ตรวจสอบ" : "Fuel logs not checked",
    latestFuel: language === "th" ? "บันทึกน้ำมันล่าสุด 5 รายการ" : "Latest 5 fuel entries",
    latestTransfers: language === "th" ? "รายการโอนเงินล่าสุด 5 รายการ" : "Latest 5 bank transfers",
    missingFuelDetail: language === "th" ? "ขาดเลขไมล์ ลิตร ค่าใช้จ่าย พนักงานขับรถ รถ หรือสถานี" : "Missing mileage, litres, cost, driver, vehicle, or station.",
    missingFuelTitle: language === "th" ? "ข้อมูลบันทึกน้ำมันไม่ครบ" : "Missing fuel log details",
    monthFuelSpend: language === "th" ? "ค่าน้ำมันเดือนนี้" : "This month fuel spend",
    monthTransfers: language === "th" ? "ยอดโอนเงินเดือนนี้" : "This month bank transfers",
    needsAttention: language === "th" ? "ต้องตรวจสอบ" : "Needs Attention",
    needsBaseline: language === "th" ? "ต้องตั้งค่าเริ่มต้น" : "Needs baseline",
    noAttention: language === "th" ? "ไม่พบรายการเร่งด่วนที่ต้องตรวจสอบในเดือนนี้" : "No urgent review items found for this month.",
    noFuel: language === "th" ? "ไม่มีรายการน้ำมันในเดือนนี้" : "No fuel entries for this month.",
    noTransfers: language === "th" ? "ไม่มีรายการโอนเงินในเดือนนี้" : "No bank transfers for this month.",
    notCheckedThisMonth: language === "th" ? "รายการในเดือนนี้ยังไม่ได้ตรวจสอบ" : "records in this month are still Not Checked.",
    notEnoughValidData: language === "th" ? "ข้อมูลที่ถูกต้องยังไม่เพียงพอ" : "Not enough valid data",
    oilDue: language === "th" ? "เปลี่ยนน้ำมันเครื่องครบกำหนดหรือเกินกำหนด" : "Oil changes due or overdue",
    overdue: language === "th" ? "เกินกำหนด" : "Overdue",
    previousMonth: language === "th" ? "เดือนก่อนหน้า" : "Previous month",
    remaining: language === "th" ? "กม. คงเหลือ" : "KM remaining",
    selectedMonth: language === "th" ? "เดือนที่เลือก" : "Selected month",
    totalOutflow: language === "th" ? "ยอดเงินออกทั้งหมดต่อเดือน" : "Total monthly outflow",
    transfers: language === "th" ? "รายการโอน" : "transfers",
    unchecked: language === "th" ? "รายการยังไม่ได้ตรวจสอบ" : "Unchecked records",
    validRecordsThisMonth: language === "th" ? "รายการที่ถูกต้องในเดือนนี้" : "valid records this month"
  };

  const opsCopy = {
    actions: language === "th" ? "ทางลัด" : "Quick Actions",
    addBooking: language === "th" ? "+ งานจอง" : "+ Booking",
    addFuelLog: language === "th" ? "+ น้ำมัน" : "+ Fuel Log",
    addTransfer: language === "th" ? "+ โอนเงิน" : "+ Transfer",
    addTripJourney: language === "th" ? "+ Trip Journey" : "+ Trip Journey",
    addVehicle: language === "th" ? "+ รถ" : "+ Vehicle",
    addWeeklyMileage: language === "th" ? "+ เลขไมล์รายสัปดาห์" : "+ Weekly Mileage",
    avgActualKm: language === "th" ? "กม. จริงเฉลี่ย" : "Average actual KM",
    avgEstimatedKm: language === "th" ? "กม. ประมาณการเฉลี่ย" : "Average estimated KM",
    basedOnOperationsRisk: language === "th" ? "อ้างอิงจากข้อมูลน้ำมัน การซ่อมบำรุง การตรวจสอบ และทริป" : "Based on fuel, maintenance, review, and trip record risks.",
    bestFuelEfficiency: language === "th" ? "ประหยัดน้ำมันดีที่สุด" : "Best Fuel Efficiency",
    bookingsCreatedToday: language === "th" ? "งานจองที่สร้างวันนี้" : "Bookings created today",
    driverSpotlight: language === "th" ? "พนักงานขับรถที่ควรดู" : "Driver Spotlight",
    everythingGoodToday: language === "th" ? "ทุกอย่างดูเรียบร้อยวันนี้" : "Everything looks good today.",
    fleetHealth: language === "th" ? "สุขภาพฟลีทรถ" : "Fleet Health",
    fuelLogsAddedToday: language === "th" ? "บันทึกน้ำมันวันนี้" : "Fuel logs added today",
    missingTripRecords: language === "th" ? "งานจองที่ยังไม่มีทริป" : "Trips without journey records",
    mileageUpdatesToday: language === "th" ? "เลขไมล์ที่อัปเดตวันนี้" : "Mileage updates today",
    noSpotlight: language === "th" ? "ยังไม่มีข้อมูลประสิทธิภาพพนักงานขับรถเพียงพอ" : "Not enough driver efficiency data yet.",
    noTripData: language === "th" ? "ยังไม่มีข้อมูลทริป" : "No trip data available yet.",
    oilChangesCompletedToday: language === "th" ? "เปลี่ยนน้ำมันเครื่องวันนี้" : "Oil changes completed today",
    operationsAttention: language === "th" ? "งานปฏิบัติการที่ต้องตรวจสอบ" : "Operations Requiring Attention",
    target: language === "th" ? "เป้าหมาย" : "Target",
    todayActivity: language === "th" ? "กิจกรรมวันนี้" : "Today's Activity",
    totalActualFuelLogged: language === "th" ? "น้ำมันจริงที่บันทึก" : "Total actual fuel logged",
    totalEstimatedLitres: language === "th" ? "ลิตรประมาณการรวม" : "Total estimated litres",
    tripCompletion: language === "th" ? "เปอร์เซ็นต์ทริปครบถ้วน" : "Trip completion",
    tripJourneySummary: language === "th" ? "สรุป Trip Journey" : "Trip Journey Summary",
    tripsCompletedThisMonth: language === "th" ? "ทริปที่เสร็จเดือนนี้" : "Trips completed this month",
    tripsCreatedToday: language === "th" ? "ทริปที่สร้างวันนี้" : "Trips created today",
    viewFuelLogs: language === "th" ? "ดูบันทึกน้ำมัน" : "View Fuel Logs",
    viewLogs: language === "th" ? "ตรวจบันทึก" : "Review Logs",
    viewTripJourney: language === "th" ? "ดู Trip Journey" : "View Trip Journey",
    viewVehicles: language === "th" ? "ดูรถ" : "View Vehicles",
    worstFuelEfficiency: language === "th" ? "ประหยัดน้ำมันต่ำสุด" : "Worst Fuel Efficiency"
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

        const [driverRows, vehicleRows, fuelRows, transferRows, mileageRows, bookingRows, tripRows, supportTicketsWaiting] = await Promise.all([
          fetchDrivers(),
          fetchVehicles(),
          fetchFuelLogs(),
          fetchTransfers(),
          fetchWeeklyMileage(),
          fetchBookingDiaryEntries(),
          fetchTripJourneys(),
          fetchSupportTicketNotificationCount(["Open", "In Progress", "Waiting"])
        ]);
        const baselineRows = await fetchOilChangeBaselinesForVehicles(vehicleRows);

        setDrivers(driverRows);
        setVehicles(vehicleRows);
        setOilChangeBaselines(baselineRows);
        setFuelLogs(fuelRows);
        setTransfers(transferRows);
        setWeeklyMileage(mileageRows);
        setBookings(bookingRows);
        setTripJourneys(tripRows);
        setSupportTicketAttentionCount(supportTicketsWaiting);
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
  const previousMonthRange = useMemo(() => getMonthRange(shiftMonth(monthRange.monthKey, -1)), [monthRange.monthKey]);
  const previousMonthlyFuelLogs = useMemo(
    () => fuelLogs.filter((log) => isInRange(log.date, previousMonthRange.startDate, previousMonthRange.endDate)),
    [fuelLogs, previousMonthRange.endDate, previousMonthRange.startDate]
  );
  const previousMonthlyTransfers = useMemo(
    () => transfers.filter((transfer) => isInRange(transfer.date, previousMonthRange.startDate, previousMonthRange.endDate)),
    [previousMonthRange.endDate, previousMonthRange.startDate, transfers]
  );
  const monthlyBookings = useMemo(
    () => bookings.filter((booking) => isInRange(booking.booking_date, monthRange.startDate, monthRange.endDate)),
    [bookings, monthRange.endDate, monthRange.startDate]
  );
  const monthlyTrips = useMemo(
    () => tripJourneys.filter((trip) => isInRange(trip.trip_date, monthRange.startDate, monthRange.endDate)),
    [monthRange.endDate, monthRange.startDate, tripJourneys]
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
  const previousMonthlyFuelSpend = previousMonthlyFuelLogs.reduce((sum, log) => sum + getSafeNumber(log.total_cost), 0);
  const previousMonthlyTransferTotal = previousMonthlyTransfers.reduce((sum, transfer) => sum + getSafeNumber(transfer.amount), 0);
  const efficiencyStats = useMemo(
    () => buildEfficiencyStats({ allLogs: fuelLogs, monthlyLogs: monthlyFuelLogs, vehicleTypeLookup }),
    [fuelLogs, monthlyFuelLogs, vehicleTypeLookup]
  );
  const uncheckedFuelCount = monthlyFuelLogs.filter((log) => !log.receipt_checked).length;
  const uncheckedTransferCount = monthlyTransfers.filter((transfer) => transfer.receipt_status !== "approved").length;
  const previousUncheckedFuelCount = previousMonthlyFuelLogs.filter((log) => !log.receipt_checked).length;
  const previousUncheckedTransferCount = previousMonthlyTransfers.filter((transfer) => transfer.receipt_status !== "approved").length;
  const uncheckedRecords = uncheckedFuelCount + uncheckedTransferCount;
  const previousUncheckedRecords = previousUncheckedFuelCount + previousUncheckedTransferCount;
  const missingFuelRows = monthlyFuelLogs.filter(hasMissingFuelDetails);
  const tripBookingIds = new Set(
    tripJourneys
      .flatMap((trip) => [trip.booking_diary_id, trip.booking_id])
      .filter(Boolean)
      .map(String)
  );
  const monthlyBookingsWithoutTrips = monthlyBookings.filter((booking) => !tripBookingIds.has(String(booking.id)));
  const completedMonthlyTrips = monthlyTrips.filter((trip) => trip.status === "completed");
  const estimatedTripDistances = monthlyTrips.map(getEstimatedTripDistance).filter((value): value is number => value != null && value > 0);
  const actualTripDistances = monthlyTrips.map(getActualTripDistance).filter((value): value is number => value != null && value > 0);
  const actualTripLitres = monthlyTrips.map(getTripFuelLitres).filter((value): value is number => value != null && value > 0);
  const averageEstimatedTripKm = estimatedTripDistances.length ? estimatedTripDistances.reduce((sum, value) => sum + value, 0) / estimatedTripDistances.length : null;
  const averageActualTripKm = actualTripDistances.length ? actualTripDistances.reduce((sum, value) => sum + value, 0) / actualTripDistances.length : null;
  const totalEstimatedLitres = efficiencyStats.averageKmPerLitre && efficiencyStats.averageKmPerLitre > 0
    ? estimatedTripDistances.reduce((sum, value) => sum + value, 0) / efficiencyStats.averageKmPerLitre
    : null;
  const totalActualFuelLogged = actualTripLitres.reduce((sum, value) => sum + value, 0);
  const tripCompletionPercentage = monthlyTrips.length ? (completedMonthlyTrips.length / monthlyTrips.length) * 100 : null;
  const todayKey = getLocalDateKey(new Date());
  const todayActivity = {
    fuelLogs: fuelLogs.filter((log) => log.created_at?.slice(0, 10) === todayKey || log.date === todayKey).length,
    trips: tripJourneys.filter((trip) => trip.created_at?.slice(0, 10) === todayKey).length,
    bookings: bookings.filter((booking) => booking.created_at?.slice(0, 10) === todayKey).length,
    mileage: weeklyMileage.filter((entry) => entry.created_at?.slice(0, 10) === todayKey).length,
    oilChanges: vehiclesWithOilBaselines.filter((vehicle) => vehicle.last_oil_change_date === todayKey).length
  };
  const fleetHealthDeductions =
    Math.min(30, missingFuelRows.length * 2) +
    Math.min(25, oilDueRows.filter((row) => row.status === "overdue" || row.status === "urgent").length * 5) +
    Math.min(20, uncheckedRecords * 0.5) +
    Math.min(25, monthlyBookingsWithoutTrips.length * 3);
  const fleetHealthScore = Math.max(0, Math.round(100 - fleetHealthDeductions));
  const fleetHealthClass =
    fleetHealthScore >= 85
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : fleetHealthScore >= 65
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : "border-rose-200 bg-rose-50 text-rose-800";
  const driverSpotlight = useMemo(
    () => buildDriverSpotlight({ allLogs: fuelLogs, monthlyLogs: monthlyFuelLogs, vehicleTypeLookup }),
    [fuelLogs, monthlyFuelLogs, vehicleTypeLookup]
  );

  const latestFuelLogs = useMemo(
    () =>
      [...monthlyFuelLogs]
        .sort((left, right) => right.date.localeCompare(left.date) || String(right.id).localeCompare(String(left.id)))
        .slice(0, 5),
    [monthlyFuelLogs]
  );
  const attentionItems = useMemo(() => {
    const items: AttentionItem[] = [];
    const oilOverdueCount = oilDueRows.filter((row) => row.status === "overdue").length;
    const oilDueSoonCount = oilDueRows.length - oilOverdueCount;
    const needsBaselineCount = oilAttentionRows.filter((row) => row.status === "not_set" || !hasReliableOilBaseline(row)).length;

    if (supportTicketAttentionCount) {
      items.push({
        actionHref: "/admin/support-tickets",
        actionLabel: t.support.notifications.viewTickets,
        count: supportTicketAttentionCount,
        detail: t.support.notifications.supportTicketsWaitingDetail,
        icon: Ticket,
        key: "support-tickets-waiting",
        title: t.support.notifications.supportTicketsWaiting,
        tone: "info"
      });
    }

    if (oilDueRows.length || needsBaselineCount) {
      const firstOil = oilDueRows[0] ?? oilAttentionRows[0];
      const detail = firstOil
        ? firstOil.status === "overdue" && firstOil.overdueKm != null
          ? `${firstOil.registration}: ${formatNumber(firstOil.overdueKm, language)} ${copy.overdue}`
          : firstOil.status === "not_set"
            ? `${firstOil.registration}: ${copy.needsBaseline}`
            : `${firstOil.registration}: ${formatNumber(firstOil.kmRemaining ?? 0, language)} ${copy.remaining}`
        : "";
      items.push({
        actionHref: "/weekly-mileage",
        actionLabel: opsCopy.viewVehicles,
        count: oilDueRows.length + needsBaselineCount,
        detail: [
          oilOverdueCount ? `${formatNumber(oilOverdueCount, language)} ${copy.overdue}` : "",
          oilDueSoonCount ? `${formatNumber(oilDueSoonCount, language)} ${copy.dueSoon}` : "",
          needsBaselineCount ? `${formatNumber(needsBaselineCount, language)} ${copy.needsBaseline}` : "",
          detail
        ].filter(Boolean).join(" | "),
        key: "oil",
        icon: Droplet,
        title: copy.oilDue,
        tone: oilOverdueCount ? "danger" : "warning"
      });
    }

    if (missingFuelRows.length) {
      items.push({
        actionHref: "/fuel-logs?review=missing_mileage",
        actionLabel: opsCopy.viewFuelLogs,
        count: missingFuelRows.length,
        detail: copy.missingFuelDetail,
        icon: AlertTriangle,
        key: "missing-fuel-fields",
        title: copy.missingFuelTitle,
        tone: "warning"
      });
    }

    if (uncheckedFuelCount) {
      items.push({
        actionHref: "/fuel-logs?review=not_checked",
        actionLabel: opsCopy.viewLogs,
        count: uncheckedFuelCount,
        detail: `${copy.fuelEntries} ${copy.notCheckedThisMonth}`,
        icon: ClipboardList,
        key: "unchecked-fuel",
        title: copy.fuelLogsNotChecked,
        tone: "info"
      });
    }

    if (uncheckedTransferCount) {
      items.push({
        actionHref: "/transfers",
        actionLabel: opsCopy.viewLogs,
        count: uncheckedTransferCount,
        detail: `${copy.transfers} ${copy.notCheckedThisMonth}`,
        icon: ArrowRightLeft,
        key: "unchecked-transfers",
        title: copy.bankTransfersNotChecked,
        tone: "info"
      });
    }

    if (monthlyBookingsWithoutTrips.length) {
      items.push({
        actionHref: "/booking-diary",
        actionLabel: opsCopy.viewTripJourney,
        count: monthlyBookingsWithoutTrips.length,
        detail: language === "th" ? "งานจองที่ยังไม่เชื่อมกับ Trip Journey" : "Bookings that still need a Trip Journey record.",
        icon: Route,
        key: "missing-trip-records",
        title: opsCopy.missingTripRecords,
        tone: "warning"
      });
    }

    return items;
  }, [copy.bankTransfersNotChecked, copy.dueSoon, copy.fuelEntries, copy.fuelLogsNotChecked, copy.missingFuelDetail, copy.missingFuelTitle, copy.needsBaseline, copy.notCheckedThisMonth, copy.oilDue, copy.overdue, copy.remaining, copy.transfers, language, missingFuelRows.length, monthlyBookingsWithoutTrips.length, oilAttentionRows, oilDueRows, opsCopy.missingTripRecords, opsCopy.viewFuelLogs, opsCopy.viewLogs, opsCopy.viewTripJourney, opsCopy.viewVehicles, supportTicketAttentionCount, t.support.notifications.supportTicketsWaiting, t.support.notifications.supportTicketsWaitingDetail, t.support.notifications.viewTickets, uncheckedFuelCount, uncheckedTransferCount]);

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
      helper: `${formatTrend(monthlyFuelSpend, previousMonthlyFuelSpend, language)} | ${formatNumber(monthlyFuelLogs.length, language)} ${copy.fuelEntries}`,
      icon: Fuel
    },
    {
      label: copy.monthTransfers,
      value: formatCurrency(monthlyTransferTotal, language),
      helper: `${formatTrend(monthlyTransferTotal, previousMonthlyTransferTotal, language)} | ${formatNumber(monthlyTransfers.length, language)} transfers`,
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
      helper: `${opsCopy.target} 5.50 | ${efficiencyStats.averageKmPerLitre != null ? formatNumber(5.5 - efficiencyStats.averageKmPerLitre, language, 2) : "-"} ${language === "th" ? "ต่างจากเป้าหมาย" : "from target"}`,
      icon: Gauge
    },
    {
      label: copy.oilDue,
      value: formatNumber(oilDueRows.length, language),
      helper: `${formatTrend(oilDueRows.length, 0, language, true)} | ${formatNumber(oilDueRows.filter((row) => row.status === "overdue").length, language)} ${copy.overdue}, ${formatNumber(Math.max(0, oilDueRows.length - oilDueRows.filter((row) => row.status === "overdue").length), language)} ${copy.dueSoon}`,
      icon: Droplet
    },
    {
      label: copy.unchecked,
      value: formatNumber(uncheckedRecords, language),
      helper: `${formatTrend(uncheckedRecords, previousUncheckedRecords, language, true)} | ${language === "th" ? "แตะเพื่อตรวจสอบ" : "Tap to review"}`,
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

          <section className="mt-4 surface-card p-3 sm:p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">{opsCopy.actions}</p>
              <div className="flex min-w-0 flex-wrap gap-2">
                {[
                  { href: "/fuel-logs", label: opsCopy.addFuelLog, icon: Plus },
                  { href: "/trip-journey", label: opsCopy.addTripJourney, icon: Route },
                  { href: "/weekly-mileage", label: opsCopy.addWeeklyMileage, icon: Gauge },
                  { href: "/transfers", label: opsCopy.addTransfer, icon: ArrowRightLeft },
                  { href: "/booking-diary", label: opsCopy.addBooking, icon: CalendarPlus },
                  { href: "/drivers", label: opsCopy.addVehicle, icon: Truck }
                ].map((action) => (
                  <a key={action.href} href={action.href} className="btn-secondary min-h-9 gap-1.5 px-3 py-1.5 text-xs">
                    <action.icon className="h-3.5 w-3.5" />
                    {action.label}
                  </a>
                ))}
              </div>
            </div>
          </section>

          <section className="mt-5 surface-card p-4 sm:p-5">
            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="section-title">{opsCopy.operationsAttention}</h3>
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
                {opsCopy.everythingGoodToday}
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

          <section className="mt-5 grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
            <article className={`rounded-xl border p-5 shadow-sm ${fleetHealthClass}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold uppercase tracking-[0.14em]">{opsCopy.fleetHealth}</h3>
                  <p className="mt-2 text-5xl font-black leading-none">{fleetHealthScore}%</p>
                </div>
                <Gauge className="h-8 w-8" />
              </div>
              <p className="mt-3 text-sm font-semibold opacity-85">{opsCopy.basedOnOperationsRisk}</p>
              <div className="mt-4 grid gap-2 text-sm">
                <p className="flex justify-between gap-3 rounded-lg bg-white/70 px-3 py-2"><span>{copy.missingFuelTitle}</span><strong>{formatNumber(missingFuelRows.length, language)}</strong></p>
                <p className="flex justify-between gap-3 rounded-lg bg-white/70 px-3 py-2"><span>{copy.oilDue}</span><strong>{formatNumber(oilDueRows.length, language)}</strong></p>
                <p className="flex justify-between gap-3 rounded-lg bg-white/70 px-3 py-2"><span>{copy.unchecked}</span><strong>{formatNumber(uncheckedRecords, language)}</strong></p>
                <p className="flex justify-between gap-3 rounded-lg bg-white/70 px-3 py-2"><span>{opsCopy.missingTripRecords}</span><strong>{formatNumber(monthlyBookingsWithoutTrips.length, language)}</strong></p>
              </div>
            </article>

            <article className="surface-card-soft p-5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="section-title">{opsCopy.tripJourneySummary}</h3>
                  <p className="section-subtitle">{dateRangeLabel}</p>
                </div>
                <a href="/trip-journey" className="btn-primary min-h-9 px-3 py-1.5 text-xs">{opsCopy.viewTripJourney}</a>
              </div>
              {monthlyTrips.length || monthlyBookings.length ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {[
                    [opsCopy.tripsCompletedThisMonth, formatNumber(completedMonthlyTrips.length, language)],
                    [opsCopy.missingTripRecords, formatNumber(monthlyBookingsWithoutTrips.length, language)],
                    [opsCopy.avgEstimatedKm, averageEstimatedTripKm != null ? `${formatNumber(averageEstimatedTripKm, language, 1)} km` : "-"],
                    [opsCopy.avgActualKm, averageActualTripKm != null ? `${formatNumber(averageActualTripKm, language, 1)} km` : "-"],
                    [opsCopy.totalEstimatedLitres, totalEstimatedLitres != null ? `${formatNumber(totalEstimatedLitres, language, 1)} L` : "-"],
                    [opsCopy.totalActualFuelLogged, `${formatNumber(totalActualFuelLogged, language, 1)} L`],
                    [opsCopy.tripCompletion, tripCompletionPercentage != null ? `${formatNumber(tripCompletionPercentage, language, 0)}%` : "-"]
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-lg border border-slate-200 bg-white px-3 py-3">
                      <p className="text-xs font-semibold text-slate-500">{label}</p>
                      <p className="mt-1 text-xl font-bold text-slate-950">{value}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-4 rounded-lg border border-slate-200 bg-white px-4 py-5 text-sm font-semibold text-slate-600">
                  {opsCopy.noTripData}
                </div>
              )}
            </article>
          </section>

          <section className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {summaryCards.map((card) => (
              <SummaryCard key={card.label} {...card} />
            ))}
          </section>

          <section className="mt-5 grid gap-4 xl:grid-cols-2">
            <section className="surface-card p-5 sm:p-6">
              <h3 className="section-title">{opsCopy.todayActivity}</h3>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {[
                  [opsCopy.fuelLogsAddedToday, todayActivity.fuelLogs],
                  [opsCopy.tripsCreatedToday, todayActivity.trips],
                  [opsCopy.bookingsCreatedToday, todayActivity.bookings],
                  [opsCopy.mileageUpdatesToday, todayActivity.mileage],
                  [opsCopy.oilChangesCompletedToday, todayActivity.oilChanges]
                ].map(([label, value]) => (
                  <div key={String(label)} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
                    <p className="text-xs font-semibold text-slate-500">{label}</p>
                    <p className="mt-1 text-2xl font-bold text-slate-950">{formatNumber(Number(value), language)}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className="surface-card p-5 sm:p-6">
              <h3 className="section-title">{opsCopy.driverSpotlight}</h3>
              {driverSpotlight.best || driverSpotlight.worst ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {[
                    { title: opsCopy.bestFuelEfficiency, row: driverSpotlight.best, tone: "emerald" },
                    { title: opsCopy.worstFuelEfficiency, row: driverSpotlight.worst, tone: "amber" }
                  ].map((spotlight) => (
                    <div key={spotlight.title} className={`rounded-lg border px-3 py-3 ${spotlight.tone === "emerald" ? "border-emerald-100 bg-emerald-50" : "border-amber-100 bg-amber-50"}`}>
                      <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">{spotlight.title}</p>
                      {spotlight.row ? (
                        <>
                          <p className="mt-2 flex items-center gap-2 text-sm font-bold text-slate-950"><UserRound className="h-4 w-4" />{spotlight.row.driver}</p>
                          <p className="mt-1 text-xs font-semibold text-slate-600">{spotlight.row.vehicle}</p>
                          <p className="mt-2 text-2xl font-black text-slate-950">{formatNumber(spotlight.row.kmPerLitre, language, 2)} km/L</p>
                        </>
                      ) : (
                        <p className="mt-3 text-sm font-semibold text-slate-600">{opsCopy.noSpotlight}</p>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-5 text-sm font-semibold text-slate-600">
                  {opsCopy.noSpotlight}
                </div>
              )}
            </section>
          </section>

          <section className="mt-5 grid gap-4">
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
          </section>
        </>
      )}
    </>
  );
}
