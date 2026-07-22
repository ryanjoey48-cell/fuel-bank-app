"use client";

import {
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
  fetchTripJourneys,
  fetchVehicles,
  fetchWeeklyMileage
} from "@/lib/data";
import { buildDispatchRows, summarizeDispatchRows } from "@/lib/dispatch";
import { useLanguage } from "@/lib/language-provider";
import { buildOilChangeAlertRows, type OilChangeAlertRow } from "@/lib/operations";
import { formatCurrency, formatDate, formatNumber } from "@/lib/utils";
import type {
  BookingDiaryEntry,
  Driver,
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

function getWorkingTripDistance(trip: TripJourneyWithFuel) {
  return getActualTripDistance(trip) ?? getEstimatedTripDistance(trip);
}

function isTripWaitingForReview(trip: TripJourneyWithFuel) {
  if (trip.status !== "completed") return false;
  if (!String(trip.driver || "").trim()) return true;
  if (!String(trip.vehicle_reg || trip.vehicle_type || "").trim()) return true;
  const estimated = getEstimatedTripDistance(trip);
  const working = getWorkingTripDistance(trip);
  if (estimated != null && working != null && estimated > 0 && Math.abs(working - estimated) / estimated > 0.2) return true;
  return false;
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
    currentMonth: language === "th" ? "เดือนปัจจุบัน" : "Current month",
    dateRange: language === "th" ? "ช่วงวันที่" : "Date range",
    dispatchToday: language === "th" ? "งานจัดส่งวันนี้" : "Today's Dispatch",
    dispatchTodayDescription: language === "th" ? "ภาพรวมความพร้อมงานจองและทริปสำหรับวันนี้" : "Readiness snapshot for today's bookings and trips.",
    dueSoon: language === "th" ? "ใกล้ครบกำหนด" : "Due Soon",
    fuelEntries: language === "th" ? "รายการน้ำมัน" : "fuel entries",
    fuelLogsNotChecked: language === "th" ? "บันทึกน้ำมันยังไม่ได้ตรวจสอบ" : "Fuel logs not checked",
    latestFuel: language === "th" ? "บันทึกน้ำมันล่าสุด 5 รายการ" : "Latest 5 fuel entries",
    monthFuelSpend: language === "th" ? "ค่าน้ำมันเดือนนี้" : "This month fuel spend",
    needsAttention: language === "th" ? "ต้องตรวจสอบ" : "Needs Attention",
    needsBaseline: language === "th" ? "ต้องตั้งค่าเริ่มต้น" : "Needs baseline",
    noAttention: language === "th" ? "ไม่พบรายการเร่งด่วนที่ต้องตรวจสอบในเดือนนี้" : "No urgent review items found for this month.",
    noFuel: language === "th" ? "ไม่มีรายการน้ำมันในเดือนนี้" : "No fuel entries for this month.",
    notCheckedThisMonth: language === "th" ? "รายการในเดือนนี้ยังไม่ได้ตรวจสอบ" : "records in this month are still Not Checked.",
    oilDue: language === "th" ? "เปลี่ยนน้ำมันเครื่องครบกำหนดหรือเกินกำหนด" : "Oil changes due or overdue",
    overdue: language === "th" ? "เกินกำหนด" : "Overdue",
    previousMonth: language === "th" ? "เดือนก่อนหน้า" : "Previous month",
    remaining: language === "th" ? "กม. คงเหลือ" : "KM remaining",
    selectedMonth: language === "th" ? "เดือนที่เลือก" : "Selected month",
    unchecked: language === "th" ? "รายการยังไม่ได้ตรวจสอบ" : "Unchecked records"
  };

  const opsCopy = {
    actions: language === "th" ? "ทางลัด" : "Quick Actions",
    addBooking: language === "th" ? "+ งานจอง" : "+ Booking",
    addFuelLog: language === "th" ? "+ น้ำมัน" : "+ Fuel Log",
    addTripJourney: language === "th" ? "+ Trip Journey" : "+ Trip Journey",
    addVehicle: language === "th" ? "+ รถ" : "+ Vehicle",
    avgActualKm: language === "th" ? "ระยะทางใช้งานเฉลี่ย" : "Average working KM",
    avgEstimatedKm: language === "th" ? "กม. ประมาณการเฉลี่ย" : "Average estimated KM",
    basedOnOperationsRisk: language === "th" ? "อ้างอิงจากการซ่อมบำรุง รายการที่ยังไม่ตรวจ ทริปที่ต้องตรวจ และงานจองที่ยังไม่มีทริป" : "Based on maintenance, unchecked records, trip review, and bookings without trip records.",
    bookingsWithoutTripRecords: language === "th" ? "งานจองที่ยังไม่มีทริป" : "Bookings without trip records",
    bookingsWithoutTripRecordsDetail: language === "th" ? "มีงานจองแล้ว แต่ยังไม่ได้สร้างรายการ Trip Journey" : "Bookings exist but no Trip Journey record has been created.",
    everythingGoodToday: language === "th" ? "ทุกอย่างดูเรียบร้อยวันนี้" : "Everything looks good today.",
    fleetHealth: language === "th" ? "สุขภาพฟลีทรถ" : "Fleet Health",
    fuelLogsNotCheckedDetail: language === "th" ? "รายการน้ำมันยังต้องให้ผู้ดูแลตรวจสอบ" : "Fuel entries still need admin review.",
    fuelCycleDataNeeded: language === "th" ? "ต้องมีข้อมูลรอบน้ำมันที่ตรวจสอบแล้วมากกว่านี้ก่อนเปรียบเทียบประสิทธิภาพพนักงานขับรถ" : "More verified fuel cycle data is needed before driver efficiency can be compared.",
    fuelLogsReviewHelper: language === "th" ? "บันทึกน้ำมันอาจครอบคลุมหลายทริป ใช้เพื่อการตรวจสอบ ไม่ใช่น้ำมันจริงต่อทริป" : "Fuel logs may cover multiple trips and are used for review, not exact per-trip fuel use.",
    missingTripRecords: language === "th" ? "งานจองที่ยังไม่มีทริป" : "Trips without journey records",
    noTripData: language === "th" ? "ยังไม่มีข้อมูลทริป" : "No trip data available yet.",
    officeWorkQueue: language === "th" ? "คิวงานสำนักงาน" : "Office Action Queue",
    oilChangesDueDetail: language === "th" ? "รถใกล้ครบกำหนดหรือเกินกำหนดเปลี่ยนน้ำมันเครื่อง" : "Vehicles are due soon or overdue.",
    operationsAttention: language === "th" ? "งานปฏิบัติการที่ต้องตรวจสอบ" : "Operations Requiring Attention",
    target: language === "th" ? "เป้าหมาย" : "Target",
    totalActualFuelLogged: language === "th" ? "น้ำมันที่บันทึกเดือนนี้" : "Fuel logged this month",
    tripCompletion: language === "th" ? "เปอร์เซ็นต์ทริปครบถ้วน" : "Trip completion",
    tripJourneySummary: language === "th" ? "สรุป Trip Journey" : "Trip Journey Summary",
    tripsWaitingForReview: language === "th" ? "ทริปที่รอตรวจสอบ" : "Trips Waiting for Review",
    tripsWaitingForReviewDetail: language === "th" ? "ทริปที่เสร็จแล้วแต่ยังต้องยืนยัน เช่น คนขับ รถ เส้นทาง หรือการตรวจจากผู้ดูแล" : "Trips have been completed but still need driver, vehicle, route, or admin confirmation.",
    tripsCompletedThisMonth: language === "th" ? "ทริปที่เสร็จเดือนนี้" : "Trips completed this month",
    viewFuelLogs: language === "th" ? "ดูบันทึกน้ำมัน" : "View Fuel Logs",
    viewDispatch: language === "th" ? "ดูกระดานจัดส่งงาน" : "View Dispatch Board",
    viewLogs: language === "th" ? "ตรวจบันทึก" : "Review Logs",
    viewTripJourney: language === "th" ? "ดู Trip Journey" : "View Trip Journey",
    viewVehicles: language === "th" ? "ดูรถ" : "View Vehicles"
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

        const [driverRows, vehicleRows, fuelRows, mileageRows, bookingRows, tripRows, supportTicketsWaiting] = await Promise.all([
          fetchDrivers(),
          fetchVehicles(),
          fetchFuelLogs(),
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
  const previousMonthRange = useMemo(() => getMonthRange(shiftMonth(monthRange.monthKey, -1)), [monthRange.monthKey]);
  const previousMonthlyFuelLogs = useMemo(
    () => fuelLogs.filter((log) => isInRange(log.date, previousMonthRange.startDate, previousMonthRange.endDate)),
    [fuelLogs, previousMonthRange.endDate, previousMonthRange.startDate]
  );
  const monthlyBookings = useMemo(
    () => bookings.filter((booking) => isInRange(booking.booking_date, monthRange.startDate, monthRange.endDate)),
    [bookings, monthRange.endDate, monthRange.startDate]
  );
  const monthlyTrips = useMemo(
    () => tripJourneys.filter((trip) => isInRange(trip.trip_date, monthRange.startDate, monthRange.endDate)),
    [monthRange.endDate, monthRange.startDate, tripJourneys]
  );
  const todayKey = getLocalDateKey(new Date());
  const todaysBookings = useMemo(
    () => bookings.filter((booking) => booking.booking_date === todayKey),
    [bookings, todayKey]
  );
  const todaysTrips = useMemo(
    () => tripJourneys.filter((trip) => trip.trip_date === todayKey || trip.date === todayKey),
    [todayKey, tripJourneys]
  );
  const dispatchTodayRows = useMemo(
    () => buildDispatchRows({ bookings: todaysBookings, trips: todaysTrips, drivers, vehicles }),
    [drivers, todaysBookings, todaysTrips, vehicles]
  );
  const dispatchTodaySummary = useMemo(
    () => summarizeDispatchRows(dispatchTodayRows),
    [dispatchTodayRows]
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
  const previousMonthlyFuelSpend = previousMonthlyFuelLogs.reduce((sum, log) => sum + getSafeNumber(log.total_cost), 0);
  const uncheckedFuelCount = monthlyFuelLogs.filter((log) => !log.receipt_checked).length;
  const previousUncheckedFuelCount = previousMonthlyFuelLogs.filter((log) => !log.receipt_checked).length;
  const uncheckedRecords = uncheckedFuelCount;
  const previousUncheckedRecords = previousUncheckedFuelCount;
  const tripBookingIds = new Set(
    tripJourneys
      .flatMap((trip) => [trip.booking_diary_id, trip.booking_id])
      .filter(Boolean)
      .map(String)
  );
  const monthlyBookingsWithoutTrips = monthlyBookings.filter((booking) => !tripBookingIds.has(String(booking.id)));
  const completedMonthlyTrips = monthlyTrips.filter((trip) => trip.status === "completed");
  const estimatedTripDistances = monthlyTrips.map(getEstimatedTripDistance).filter((value): value is number => value != null && value > 0);
  const workingTripDistances = monthlyTrips.map(getWorkingTripDistance).filter((value): value is number => value != null && value > 0);
  const averageEstimatedTripKm = estimatedTripDistances.length ? estimatedTripDistances.reduce((sum, value) => sum + value, 0) / estimatedTripDistances.length : null;
  const averageWorkingTripKm = workingTripDistances.length ? workingTripDistances.reduce((sum, value) => sum + value, 0) / workingTripDistances.length : null;
  const totalFuelLoggedThisMonth = monthlyFuelLogs.reduce((sum, log) => sum + getSafeNumber(log.litres), 0);
  const tripsWaitingForReview = completedMonthlyTrips.filter((trip) => isTripWaitingForReview(trip));
  const tripCompletionPercentage = monthlyTrips.length ? (completedMonthlyTrips.length / monthlyTrips.length) * 100 : null;
  const fleetHealthDeductions =
    Math.min(25, oilDueRows.filter((row) => row.status === "overdue" || row.status === "urgent").length * 5) +
    Math.min(15, uncheckedFuelCount * 0.4) +
    Math.min(25, tripsWaitingForReview.length * 4) +
    Math.min(20, monthlyBookingsWithoutTrips.length * 3);
  const fleetHealthScore = Math.max(0, Math.round(100 - fleetHealthDeductions));
  const fleetHealthClass =
    fleetHealthScore >= 85
      ? "dashboard-fleet-health-good"
      : fleetHealthScore >= 65
        ? "dashboard-fleet-health-watch"
        : "dashboard-fleet-health-risk";
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

    if (tripsWaitingForReview.length) {
      items.push({
        actionHref: "/trip-journey",
        actionLabel: opsCopy.viewTripJourney,
        count: tripsWaitingForReview.length,
        detail: opsCopy.tripsWaitingForReviewDetail,
        icon: Route,
        key: "trips-waiting-review",
        title: opsCopy.tripsWaitingForReview,
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
  }, [copy.dueSoon, copy.fuelEntries, copy.fuelLogsNotChecked, copy.needsBaseline, copy.notCheckedThisMonth, copy.oilDue, copy.overdue, copy.remaining, language, monthlyBookingsWithoutTrips.length, oilAttentionRows, oilDueRows, opsCopy.missingTripRecords, opsCopy.tripsWaitingForReview, opsCopy.tripsWaitingForReviewDetail, opsCopy.viewLogs, opsCopy.viewTripJourney, opsCopy.viewVehicles, supportTicketAttentionCount, t.support.notifications.supportTicketsWaiting, t.support.notifications.supportTicketsWaitingDetail, t.support.notifications.viewTickets, tripsWaitingForReview.length, uncheckedFuelCount]);

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
      uncheckedFuelCount,
      tripsWaitingForReview: tripsWaitingForReview.length,
      oilChangeItemsCount: oilDueRows.length,
      oilBaselineCount: oilChangeBaselines.length
    });
  }, [
    fuelLogs.length,
    monthlyFuelLogs.length,
    monthlyFuelSpend,
    monthRange.endDate,
    monthRange.startDate,
    oilChangeBaselines.length,
    oilDueRows.length,
    tripsWaitingForReview.length,
    uncheckedFuelCount
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
      label: opsCopy.tripsWaitingForReview,
      value: formatNumber(tripsWaitingForReview.length, language),
      helper: opsCopy.tripsWaitingForReviewDetail,
      icon: Route
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

  const officeWorkQueue: AttentionItem[] = [
    {
      actionHref: "/fuel-logs?review=not_checked",
      actionLabel: opsCopy.viewLogs,
      count: uncheckedFuelCount,
      detail: opsCopy.fuelLogsNotCheckedDetail,
      icon: ClipboardList,
      key: "queue-fuel-not-checked",
      title: copy.fuelLogsNotChecked,
      tone: "info" as const
    },
    {
      actionHref: "/weekly-mileage",
      actionLabel: opsCopy.viewVehicles,
      count: oilDueRows.length,
      detail: opsCopy.oilChangesDueDetail,
      icon: Droplet,
      key: "queue-oil",
      title: copy.oilDue,
      tone: oilDueRows.some((row) => row.status === "overdue" || row.status === "urgent") ? "danger" as const : "warning" as const
    },
    {
      actionHref: "/trip-journey",
      actionLabel: opsCopy.viewTripJourney,
      count: tripsWaitingForReview.length,
      detail: opsCopy.tripsWaitingForReviewDetail,
      icon: Route,
      key: "queue-trips-review",
      title: opsCopy.tripsWaitingForReview,
      tone: "warning" as const
    },
    {
      actionHref: "/booking-diary",
      actionLabel: opsCopy.viewTripJourney,
      count: monthlyBookingsWithoutTrips.length,
      detail: opsCopy.bookingsWithoutTripRecordsDetail,
      icon: CalendarPlus,
      key: "queue-bookings-without-trips",
      title: opsCopy.bookingsWithoutTripRecords,
      tone: "warning" as const
    }
  ].slice(0, 4);

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

          <section className="mt-4 surface-card dashboard-quick-actions p-3 sm:p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">{opsCopy.actions}</p>
              <div className="flex min-w-0 flex-wrap gap-2">
                {[
                  { href: "/fuel-logs", label: opsCopy.addFuelLog, icon: Plus },
                  { href: "/trip-journey", label: opsCopy.addTripJourney, icon: Route },
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
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="section-title">{copy.dispatchToday}</h3>
                <p className="section-subtitle">{copy.dispatchTodayDescription}</p>
              </div>
              <a href="/dispatch" className="btn-primary min-h-9 px-3 py-1.5 text-xs">
                {opsCopy.viewDispatch}
              </a>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              {[
                [language === "th" ? "งานวันนี้" : "Jobs today", dispatchTodaySummary.totalJobs],
                [language === "th" ? "พร้อม" : "Ready", dispatchTodaySummary.ready],
                [language === "th" ? "ยังไม่มอบหมาย" : "Unassigned", dispatchTodaySummary.unassigned],
                [language === "th" ? "งานชนกัน" : "Potential conflicts", dispatchTodaySummary.potentialConflicts],
                [language === "th" ? "ขาด Trip Journey" : "Missing Trip Journey", dispatchTodaySummary.missingTrip]
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border border-slate-200 bg-white px-3 py-3">
                  <p className="text-xs font-semibold text-slate-500">{label}</p>
                  <p className="mt-1 text-xl font-bold text-slate-950">{formatNumber(Number(value), language)}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="mt-5 surface-card dashboard-attention-card p-4 sm:p-5">
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
                <p className="flex justify-between gap-3 rounded-lg bg-white/70 px-3 py-2"><span>{copy.oilDue}</span><strong>{formatNumber(oilDueRows.length, language)}</strong></p>
                <p className="flex justify-between gap-3 rounded-lg bg-white/70 px-3 py-2"><span>{copy.fuelLogsNotChecked}</span><strong>{formatNumber(uncheckedFuelCount, language)}</strong></p>
                <p className="flex justify-between gap-3 rounded-lg bg-white/70 px-3 py-2"><span>{opsCopy.tripsWaitingForReview}</span><strong>{formatNumber(tripsWaitingForReview.length, language)}</strong></p>
                <p className="flex justify-between gap-3 rounded-lg bg-white/70 px-3 py-2"><span>{opsCopy.bookingsWithoutTripRecords}</span><strong>{formatNumber(monthlyBookingsWithoutTrips.length, language)}</strong></p>
              </div>
            </article>

            <article className="surface-card-soft dashboard-trip-summary p-5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="section-title">{opsCopy.tripJourneySummary}</h3>
                  <p className="section-subtitle">{dateRangeLabel}</p>
                </div>
                <a href="/trip-journey" className="btn-primary min-h-9 px-3 py-1.5 text-xs">{opsCopy.viewTripJourney}</a>
              </div>
              {monthlyTrips.length || monthlyBookings.length ? (
                <>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    {[
                      [opsCopy.tripsCompletedThisMonth, formatNumber(completedMonthlyTrips.length, language)],
                      [opsCopy.missingTripRecords, formatNumber(monthlyBookingsWithoutTrips.length, language)],
                      [opsCopy.avgEstimatedKm, averageEstimatedTripKm != null ? `${formatNumber(averageEstimatedTripKm, language, 1)} km` : "-"],
                      [opsCopy.avgActualKm, averageWorkingTripKm != null ? `${formatNumber(averageWorkingTripKm, language, 1)} km` : "-"],
                      [opsCopy.tripsWaitingForReview, formatNumber(tripsWaitingForReview.length, language)],
                      [opsCopy.totalActualFuelLogged, `${formatNumber(totalFuelLoggedThisMonth, language, 1)} L`],
                      [opsCopy.tripCompletion, tripCompletionPercentage != null ? `${formatNumber(tripCompletionPercentage, language, 0)}%` : "-"]
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-lg border border-slate-200 bg-white px-3 py-3">
                        <p className="text-xs font-semibold text-slate-500">{label}</p>
                        <p className="mt-1 text-xl font-bold text-slate-950">{value}</p>
                      </div>
                    ))}
                  </div>
                  <p className="mt-3 rounded-lg border border-brand-100 bg-brand-50/70 px-3 py-2 text-xs font-semibold text-brand-800">{opsCopy.fuelLogsReviewHelper}</p>
                </>
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

          <section className="mt-5">
            <section className="surface-card p-5 sm:p-6">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="section-title">{opsCopy.officeWorkQueue}</h3>
                  <p className="section-subtitle">{opsCopy.fuelCycleDataNeeded}</p>
                </div>
                <ClipboardList className="h-5 w-5 text-brand-700" />
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {officeWorkQueue.map((item) => <AttentionRow key={item.key} item={item} />)}
              </div>
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
