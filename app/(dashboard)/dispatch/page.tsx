"use client";

import clsx from "clsx";
import {
  AlertTriangle,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Map,
  Route,
  Truck,
  UserRound
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createTripJourneyFromBooking,
  fetchBookingDiaryEntriesByDate,
  fetchDrivers,
  fetchTripJourneysByDate,
  fetchVehicles
} from "@/lib/data";
import { buildDispatchRows, summarizeDispatchRows, type DispatchAttentionKey, type DispatchBoardRow } from "@/lib/dispatch";
import { useLanguage } from "@/lib/language-provider";
import { supabase } from "@/lib/supabase";
import { formatDate, formatNumber } from "@/lib/utils";
import type { BookingDiaryEntry, Driver, TripJourneyWithFuel, Vehicle } from "@/types/database";

type DispatchFilter = "all" | "ready" | "unassigned" | "conflicts" | "missing_route" | "missing_trip" | "needs_review";

const DISPATCH_COPY = {
  en: {
    title: "Dispatch Board",
    description: "Run the selected day: see every job, assignment, trip status, and anything that needs attention.",
    today: "Today",
    tomorrow: "Tomorrow",
    previousDay: "Previous day",
    nextDay: "Next day",
    selectedDate: "Selected date",
    refresh: "Refresh",
    refreshing: "Refreshing...",
    lastRefresh: "Last successful refresh",
    never: "Not refreshed yet",
    totalJobs: "Total Jobs",
    ready: "Ready",
    unassigned: "Unassigned",
    potentialConflicts: "Potential Conflicts",
    missingRoute: "Missing Route",
    missingTrip: "Missing Trip Journey",
    needsReview: "Needs Review",
    allJobs: "All jobs",
    noJobsTitle: "No dispatch jobs for this date",
    noJobsDescription: "Bookings for the selected day will appear here.",
    noFilterMatchesTitle: "No jobs match this filter",
    noFilterMatchesDescription: "There are jobs on this date, but none match the selected status.",
    loadError: "Unable to load the Dispatch Board.",
    createTrip: "Create Trip",
    openTrip: "Open Trip",
    openBooking: "Open Booking",
    editBooking: "Edit Booking",
    openMaps: "Open Maps",
    assign: "Assign",
    jobReference: "Job reference",
    client: "Client",
    pickup: "Pickup",
    dropoff: "Drop-off",
    driver: "Driver",
    vehicle: "Vehicle",
    vehicleType: "Vehicle type",
    estimated: "Estimate",
    routeStatus: "Route status",
    tripStatus: "Trip status",
    attention: "Attention",
    noPickupTime: "No time",
    noDriver: "No driver",
    noVehicle: "No vehicle",
    noVehicleType: "No vehicle type",
    noEstimate: "No estimate",
    noRoute: "Missing route",
    googleRouteReady: "Google route ready",
    fallbackRoute: "Fallback route used",
    manualRoute: "Manual estimate",
    noTrip: "No Trip Journey",
    tripReady: "Trip linked",
    completedReview: "Completed trip needs review",
    conflictWith: "Conflict with",
    possibleConflict: "Possible conflict",
    durationIncomplete: "Duration information is incomplete.",
    creatingTrip: "Creating trip...",
    tripCreated: "Trip Journey opened.",
    tripCreateError: "Unable to create Trip Journey.",
    minutes: "min",
    km: "km"
  },
  th: {
    title: "กระดานจัดส่งงาน",
    description: "ควบคุมงานของวันที่เลือก ดูงาน คนขับ รถ สถานะทริป และสิ่งที่ต้องตรวจสอบในที่เดียว",
    today: "วันนี้",
    tomorrow: "พรุ่งนี้",
    previousDay: "วันก่อนหน้า",
    nextDay: "วันถัดไป",
    selectedDate: "วันที่เลือก",
    refresh: "รีเฟรช",
    refreshing: "กำลังรีเฟรช...",
    lastRefresh: "รีเฟรชล่าสุด",
    never: "ยังไม่ได้รีเฟรช",
    totalJobs: "งานทั้งหมด",
    ready: "พร้อม",
    unassigned: "ยังไม่มอบหมาย",
    potentialConflicts: "งานชนกัน",
    missingRoute: "ขาดเส้นทาง",
    missingTrip: "ขาด Trip Journey",
    needsReview: "ต้องตรวจสอบ",
    allJobs: "งานทั้งหมด",
    noJobsTitle: "ไม่มีงานจัดส่งในวันที่เลือก",
    noJobsDescription: "งานจองของวันที่เลือกจะแสดงที่นี่",
    noFilterMatchesTitle: "ไม่มีงานที่ตรงกับตัวกรองนี้",
    noFilterMatchesDescription: "วันนี้มีงาน แต่ไม่มีงานที่ตรงกับสถานะที่เลือก",
    loadError: "ไม่สามารถโหลดกระดานจัดส่งงานได้",
    createTrip: "สร้างทริป",
    openTrip: "เปิดทริป",
    openBooking: "เปิดงานจอง",
    editBooking: "แก้ไขงานจอง",
    openMaps: "เปิด Maps",
    assign: "มอบหมาย",
    jobReference: "เลขอ้างอิงงาน",
    client: "ลูกค้า",
    pickup: "จุดรับ",
    dropoff: "จุดส่ง",
    driver: "คนขับ",
    vehicle: "รถ",
    vehicleType: "ประเภทรถ",
    estimated: "ประมาณการ",
    routeStatus: "สถานะเส้นทาง",
    tripStatus: "สถานะทริป",
    attention: "ต้องดูแล",
    noPickupTime: "ไม่มีเวลา",
    noDriver: "ไม่มีคนขับ",
    noVehicle: "ไม่มีรถ",
    noVehicleType: "ไม่มีประเภทรถ",
    noEstimate: "ไม่มีประมาณการ",
    noRoute: "ขาดเส้นทาง",
    googleRouteReady: "เส้นทาง Google พร้อม",
    fallbackRoute: "ใช้เส้นทางสำรอง",
    manualRoute: "ประมาณการเอง",
    noTrip: "ไม่มี Trip Journey",
    tripReady: "เชื่อมทริปแล้ว",
    completedReview: "ทริปเสร็จแล้ว ต้องตรวจสอบ",
    conflictWith: "ชนกับ",
    possibleConflict: "อาจชนกัน",
    durationIncomplete: "ข้อมูลระยะเวลาไม่ครบ",
    creatingTrip: "กำลังสร้างทริป...",
    tripCreated: "เปิด Trip Journey แล้ว",
    tripCreateError: "ไม่สามารถสร้าง Trip Journey ได้",
    minutes: "นาที",
    km: "กม."
  }
};

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function getLocalDateKey(date: Date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function shiftDate(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day + days);
  return getLocalDateKey(date);
}

function formatDurationFriendly(value: number | string | null | undefined, language: "en" | "th") {
  const numeric = typeof value === "number" ? value : value ? Number.parseFloat(String(value)) : 0;
  if (!Number.isFinite(numeric) || numeric <= 0) return null;

  const totalMinutes = Math.round(numeric);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (language === "th") {
    if (hours && minutes) return `${hours} ชม. ${minutes} นาที`;
    if (hours) return `${hours} ชม.`;
    return `${minutes} นาที`;
  }

  if (hours && minutes) return `${hours} hr ${minutes} min`;
  if (hours) return `${hours} hr`;
  return `${minutes} min`;
}

function getBookingReference(booking: BookingDiaryEntry) {
  return booking.job_order_number || booking.booking_id || booking.id;
}

function getClientName(booking: BookingDiaryEntry) {
  return booking.client?.name || "Unknown client";
}

function getRouteUrl(booking: BookingDiaryEntry) {
  if (booking.google_maps_route_url) return booking.google_maps_route_url;
  const origin = encodeURIComponent(booking.pickup_address || booking.pickup || "");
  const destination = encodeURIComponent(booking.dropoff_address || booking.dropoff || "");
  return origin && destination ? `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&travelmode=driving` : null;
}

function routeStatus(row: DispatchBoardRow, copy: typeof DISPATCH_COPY.en) {
  const booking = row.booking;
  if (booking.route_fallback_info || booking.route_label === "SHORTER_DISTANCE") return copy.fallbackRoute;
  if (booking.google_maps_route_url || booking.route_source === "google_routes_api" || booking.distance_source === "google_maps") return copy.googleRouteReady;
  if (Number(booking.estimated_distance_km) > 0 || Number(booking.estimated_duration_minutes) > 0) return copy.manualRoute;
  return copy.noRoute;
}

function attentionLabel(key: DispatchAttentionKey, copy: typeof DISPATCH_COPY.en) {
  if (key === "unassigned_driver") return copy.noDriver;
  if (key === "unassigned_vehicle") return copy.noVehicle;
  if (key === "missing_pickup_time") return copy.noPickupTime;
  if (key === "missing_route") return copy.noRoute;
  if (key === "missing_trip") return copy.noTrip;
  if (key === "trip_needs_review") return copy.completedReview;
  if (key === "possible_driver_conflict" || key === "possible_vehicle_conflict") return copy.possibleConflict;
  return copy.potentialConflicts;
}

function rowMatchesFilter(row: DispatchBoardRow, filter: DispatchFilter) {
  if (filter === "all") return true;
  if (filter === "ready") return row.ready;
  if (filter === "unassigned") return row.attention.some((item) => item.key === "unassigned_driver" || item.key === "unassigned_vehicle");
  if (filter === "conflicts") return row.conflicts.length > 0;
  if (filter === "missing_route") return row.attention.some((item) => item.key === "missing_route");
  if (filter === "missing_trip") return row.attention.some((item) => item.key === "missing_trip");
  if (filter === "needs_review") return row.attention.some((item) => item.key === "trip_needs_review");
  return true;
}

export default function DispatchPage() {
  const { language } = useLanguage();
  const copy = DISPATCH_COPY[language === "th" ? "th" : "en"];
  const [selectedDate, setSelectedDate] = useState(() => getLocalDateKey(new Date()));
  const [bookings, setBookings] = useState<BookingDiaryEntry[]>([]);
  const [trips, setTrips] = useState<TripJourneyWithFuel[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [filter, setFilter] = useState<DispatchFilter>("all");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tripActionId, setTripActionId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const loadData = useCallback(async (blocking = false) => {
    try {
      if (blocking) setLoading(true);
      setRefreshing(true);
      setError(null);
      const [bookingRows, tripRows, driverRows, vehicleRows] = await Promise.all([
        fetchBookingDiaryEntriesByDate(selectedDate),
        fetchTripJourneysByDate(selectedDate),
        fetchDrivers(),
        fetchVehicles()
      ]);
      setBookings(bookingRows);
      setTrips(tripRows);
      setDrivers(driverRows);
      setVehicles(vehicleRows);
      setLastRefresh(new Date().toISOString());
    } catch (err) {
      console.error("Dispatch load error:", err);
      setError(copy.loadError);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [copy.loadError, selectedDate]);

  useEffect(() => {
    void loadData(true);
  }, [loadData]);

  useEffect(() => {
    const handleDataChanged = () => void loadData(false);
    window.addEventListener("fuel-bank:data-changed", handleDataChanged);
    const bookingChannel = supabase
      .channel("dispatch-booking-diary")
      .on("postgres_changes", { event: "*", schema: "public", table: "booking_diary" }, handleDataChanged)
      .on("postgres_changes", { event: "*", schema: "public", table: "trip_journeys" }, handleDataChanged)
      .subscribe();
    return () => {
      window.removeEventListener("fuel-bank:data-changed", handleDataChanged);
      void supabase.removeChannel(bookingChannel);
    };
  }, [loadData]);

  const rows = useMemo(
    () => buildDispatchRows({ bookings, trips, drivers, vehicles }),
    [bookings, drivers, trips, vehicles]
  );
  const summary = useMemo(() => summarizeDispatchRows(rows), [rows]);
  const visibleRows = useMemo(() => rows.filter((row) => rowMatchesFilter(row, filter)), [filter, rows]);

  const summaryCards = [
    { key: "all" as const, label: copy.totalJobs, value: summary.totalJobs, icon: CalendarDays },
    { key: "unassigned" as const, label: copy.unassigned, value: summary.unassigned, icon: UserRound },
    { key: "conflicts" as const, label: copy.potentialConflicts, value: summary.potentialConflicts, icon: AlertTriangle },
    { key: "missing_trip" as const, label: copy.missingTrip, value: summary.missingTrip, icon: Route }
  ];

  const handleCreateTrip = async (booking: BookingDiaryEntry) => {
    try {
      setTripActionId(String(booking.id));
      setActionMessage(null);
      await createTripJourneyFromBooking(booking);
      setActionMessage(copy.tripCreated);
      await loadData(false);
      window.location.href = "/trip-journey";
    } catch (err) {
      console.error("Create Trip from Dispatch failed:", err);
      setActionMessage(copy.tripCreateError);
    } finally {
      setTripActionId(null);
    }
  };

  return (
    <>
      <section className="rounded-[1.35rem] border border-slate-200/90 bg-white px-5 py-5 shadow-[0_12px_32px_rgba(15,23,42,0.055)] sm:px-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <p className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-violet-700">
              EXPERT EXPRESS SENDER CO., LTD.
            </p>
            <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-950">{copy.title}</h1>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">{copy.description}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setSelectedDate(shiftDate(selectedDate, -1))}
              className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 shadow-sm transition hover:border-violet-200 hover:bg-violet-50 hover:text-violet-800"
            >
              <ChevronLeft className="h-4 w-4" />
              {copy.previousDay}
            </button>
            <button
              type="button"
              onClick={() => setSelectedDate(getLocalDateKey(new Date()))}
              className="inline-flex h-10 items-center rounded-xl border border-violet-200 bg-violet-50 px-3 text-sm font-bold text-violet-800 shadow-sm transition hover:bg-violet-100"
            >
              {copy.today}
            </button>
            <button
              type="button"
              onClick={() => setSelectedDate(shiftDate(selectedDate, 1))}
              className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 shadow-sm transition hover:border-violet-200 hover:bg-violet-50 hover:text-violet-800"
            >
              {copy.nextDay}
              <ChevronRight className="h-4 w-4" />
            </button>

            <label className="ml-0 sm:ml-2">
              <span className="sr-only">{copy.selectedDate}</span>
              <input
                type="date"
                value={selectedDate}
                onChange={(event) => setSelectedDate(event.target.value)}
                className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 shadow-sm outline-none transition focus:border-violet-300 focus:ring-2 focus:ring-violet-100"
              />
            </label>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2 text-[11px] font-semibold text-slate-400">
          <span className={clsx("h-2 w-2 rounded-full", refreshing ? "bg-amber-400" : "bg-emerald-500")} />
          <span>
            {refreshing
              ? copy.refreshing
              : `${copy.lastRefresh}: ${lastRefresh ? new Date(lastRefresh).toLocaleTimeString(language === "th" ? "th-TH" : "en-GB", { hour: "2-digit", minute: "2-digit" }) : copy.never}`}
          </span>
        </div>
      </section>

      {error ? <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{error}</p> : null}
      {actionMessage ? <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">{actionMessage}</p> : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {summaryCards.map(({ key, label, value, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={clsx(
              "rounded-2xl border bg-white p-4 text-left shadow-[0_8px_24px_rgba(15,23,42,0.05)] transition hover:-translate-y-px hover:border-violet-200 hover:shadow-md",
              filter === key ? "border-violet-300 bg-violet-50/45 ring-2 ring-violet-100" : "border-slate-200"
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-slate-500">{label}</p>
                <p className="mt-1.5 text-3xl font-black tracking-tight text-slate-950">{formatNumber(value, language)}</p>
              </div>
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-violet-700">
                <Icon className="h-5 w-5" />
              </span>
            </div>
          </button>
        ))}
      </section>

      <section className="overflow-hidden rounded-[1.35rem] border border-slate-200/90 bg-white shadow-[0_10px_28px_rgba(15,23,42,0.05)]">
        <div className="flex flex-col gap-2 border-b border-slate-200 px-4 py-4 sm:flex-row sm:items-end sm:justify-between sm:px-5">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-black text-slate-950">
                {filter === "all" ? copy.allJobs : summaryCards.find((card) => card.key === filter)?.label}
              </h2>
              {filter !== "all" ? (
                <button
                  type="button"
                  onClick={() => setFilter("all")}
                  className="rounded-full border border-violet-100 bg-violet-50 px-2.5 py-1 text-[10px] font-bold text-violet-700 transition hover:bg-violet-100"
                >
                  {copy.allJobs}
                </button>
              ) : null}
            </div>
            <p className="mt-1 text-xs font-semibold text-slate-500">{formatDate(selectedDate, language)}</p>
          </div>
          <span className="text-xs font-bold text-slate-500">
            {formatNumber(visibleRows.length, language)} / {formatNumber(rows.length, language)}
          </span>
        </div>

        {loading ? (
          <div className="px-6 py-12 text-center text-sm font-semibold text-slate-500">{copy.refreshing}</div>
        ) : visibleRows.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="font-bold text-slate-900">{rows.length ? copy.noFilterMatchesTitle : copy.noJobsTitle}</p>
            <p className="mt-1 text-sm text-slate-500">{rows.length ? copy.noFilterMatchesDescription : copy.noJobsDescription}</p>
            {rows.length && filter !== "all" ? (
              <button
                type="button"
                onClick={() => setFilter("all")}
                className="mt-4 rounded-xl border border-violet-200 bg-violet-50 px-4 py-2 text-sm font-bold text-violet-800 transition hover:bg-violet-100"
              >
                {copy.allJobs}
              </button>
            ) : null}
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {visibleRows.map((row) => {
              const booking = row.booking;
              const mapsUrl = getRouteUrl(booking);
              const friendlyDuration = formatDurationFriendly(booking.estimated_duration_minutes, language === "th" ? "th" : "en");
              const estimateText = Number(booking.estimated_distance_km) > 0
                ? `${formatNumber(Number(booking.estimated_distance_km), language, 1)} ${copy.km}${friendlyDuration ? ` / ${friendlyDuration}` : ""}`
                : copy.noEstimate;

              return (
                <article
                  key={booking.id}
                  className={clsx(
                    "grid gap-4 px-4 py-4 transition sm:px-5 xl:grid-cols-[110px_minmax(260px,1.7fr)_minmax(210px,1.15fr)_minmax(190px,1fr)_minmax(220px,1.15fr)_auto] xl:items-center",
                    row.conflicts.some((conflict) => conflict.severity === "confirmed")
                      ? "bg-rose-50/35"
                      : row.attention.length
                        ? "bg-amber-50/20"
                        : "bg-white hover:bg-violet-50/20"
                  )}
                >
                  <div>
                    <p className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-slate-400">{copy.pickup}</p>
                    <p className="mt-1 text-lg font-black text-violet-700">{booking.pickup_time ? booking.pickup_time.slice(0, 5) : "TBC"}</p>
                    <p className="mt-1 truncate text-[9px] font-medium text-slate-300">
                      {getBookingReference(booking)}
                    </p>
                  </div>

                  <div className="min-w-0">
                    <p className="truncate text-sm font-black text-slate-950">{getClientName(booking)}</p>
                    <p className="mt-1 truncate text-sm font-bold text-slate-800">
                      {booking.pickup || "-"}
                      <span className="px-2 text-violet-400">→</span>
                      {booking.dropoff || "-"}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[10px] font-semibold text-slate-500">
                      <span>{estimateText}</span>
                      <span className="text-slate-300">•</span>
                      <span>{routeStatus(row, copy)}</span>
                      {mapsUrl ? (
                        <a
                          href={mapsUrl}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(event) => event.stopPropagation()}
                          className="inline-flex items-center gap-1 text-violet-700 hover:text-violet-900"
                        >
                          <Map className="h-3 w-3" />
                          {copy.openMaps}
                        </a>
                      ) : null}
                    </div>
                  </div>

                  <div className="min-w-0">
                    <p className="flex items-center gap-2 truncate text-[13px] font-black text-slate-950">
                      <UserRound className="h-4 w-4 shrink-0 text-slate-400" />
                      {booking.driver || copy.noDriver}
                    </p>
                    <p className="mt-1 flex items-center gap-2 truncate text-[12px] font-bold text-slate-800">
                      <Truck className="h-4 w-4 shrink-0 text-slate-400" />
                      {booking.vehicle || copy.noVehicle}
                    </p>
                    <p className="mt-1 truncate text-[10px] font-medium text-slate-400">
                      {row.vehicle?.vehicle_type || row.vehicle?.vehicle_category || copy.noVehicleType}
                    </p>
                  </div>

                  <div className="min-w-0">
                    <p className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-slate-400">{copy.tripStatus}</p>
                    <p className={clsx("mt-1 text-sm font-bold", row.trip ? "text-emerald-700" : "text-slate-600")}>
                      {row.trip ? row.trip.status : copy.noTrip}
                    </p>
                    {row.trip ? (
                      <p className="mt-1 text-[10px] font-medium text-emerald-600">{copy.tripReady}</p>
                    ) : null}
                  </div>

                  <div className="min-w-0">
                    {row.attention.some((item) => item.key !== "missing_trip") ? (
                      <div className="flex flex-wrap gap-1.5">
                        {row.attention
                          .filter((item) => item.key !== "missing_trip")
                          .slice(0, 3)
                          .map((item, index) => (
                            <span
                              key={`${item.key}-${index}`}
                              className={clsx(
                                "rounded-full border px-2.5 py-1 text-[10px] font-bold",
                                item.tone === "danger"
                                  ? "border-rose-200 bg-rose-50 text-rose-700"
                                  : item.tone === "warning"
                                    ? "border-amber-200 bg-amber-50 text-amber-800"
                                    : "border-sky-200 bg-sky-50 text-sky-700"
                              )}
                            >
                              {attentionLabel(item.key, copy)}
                            </span>
                          ))}
                      </div>
                    ) : row.attention.length === 0 ? (
                      <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700">
                        {copy.ready}
                      </span>
                    ) : null}

                    {row.conflicts.length ? (
                      <div className="mt-2 grid gap-1 text-[10px] font-semibold text-rose-700">
                        {row.conflicts.slice(0, 2).map((conflict) => (
                          <span key={`${conflict.kind}-${conflict.otherBookingId}`}>
                            {copy.possibleConflict}: {copy.conflictWith} {conflict.otherBookingId}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap justify-end gap-1.5">
                    {row.trip ? (
                      <a href="/trip-journey" className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-3 text-xs font-bold text-violet-800 transition hover:bg-violet-100">
                        <Route className="h-3.5 w-3.5" />
                        {copy.openTrip}
                      </a>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void handleCreateTrip(booking)}
                        disabled={tripActionId === String(booking.id)}
                        className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-3 text-xs font-bold text-violet-800 transition hover:bg-violet-100 disabled:opacity-60"
                      >
                        <Route className="h-3.5 w-3.5" />
                        {tripActionId === String(booking.id) ? copy.creatingTrip : copy.createTrip}
                      </button>
                    )}
                    <a href="/booking-diary" className="inline-flex min-h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 transition hover:border-violet-200 hover:bg-violet-50 hover:text-violet-800">
                      {copy.openBooking}
                    </a>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
