"use client";

import clsx from "clsx";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Map,
  Pencil,
  RefreshCw,
  Route,
  Truck,
  UserRound
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Header } from "@/components/header";
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
    description: "Daily control for bookings, assignments, route readiness, trip links, and scheduling warnings.",
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
    description: "ควบคุมงานจอง การมอบหมาย เส้นทาง ทริป และคำเตือนตารางงานประจำวัน",
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
    { key: "ready" as const, label: copy.ready, value: summary.ready, icon: CheckCircle2 },
    { key: "unassigned" as const, label: copy.unassigned, value: summary.unassigned, icon: UserRound },
    { key: "conflicts" as const, label: copy.potentialConflicts, value: summary.potentialConflicts, icon: AlertTriangle },
    { key: "missing_route" as const, label: copy.missingRoute, value: summary.missingRoute, icon: Map },
    { key: "missing_trip" as const, label: copy.missingTrip, value: summary.missingTrip, icon: Route },
    { key: "needs_review" as const, label: copy.needsReview, value: summary.needsReview, icon: Clock3 }
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
      <div className="hidden md:block">
        <Header title={copy.title} description={copy.description} />
      </div>

      {error ? <p className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{error}</p> : null}
      {actionMessage ? <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">{actionMessage}</p> : null}

      <section className="sticky top-[86px] z-20 rounded-lg border border-slate-200 bg-white/95 p-3 shadow-sm backdrop-blur md:top-3">
        <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setSelectedDate(shiftDate(selectedDate, -1))} className="btn-secondary min-h-10 px-3 text-sm">
              {copy.previousDay}
            </button>
            <button type="button" onClick={() => setSelectedDate(getLocalDateKey(new Date()))} className="btn-secondary min-h-10 px-3 text-sm">
              {copy.today}
            </button>
            <button type="button" onClick={() => setSelectedDate(shiftDate(getLocalDateKey(new Date()), 1))} className="btn-secondary min-h-10 px-3 text-sm">
              {copy.tomorrow}
            </button>
            <button type="button" onClick={() => setSelectedDate(shiftDate(selectedDate, 1))} className="btn-secondary min-h-10 px-3 text-sm">
              {copy.nextDay}
            </button>
          </div>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,190px)_auto] sm:items-end">
            <label>
              <span className="form-label">{copy.selectedDate}</span>
              <input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} className="form-input bg-white" />
            </label>
            <button type="button" onClick={() => void loadData(false)} className="btn-primary min-h-10 gap-2 px-3 text-sm" disabled={refreshing}>
              <RefreshCw className={clsx("h-4 w-4", refreshing && "animate-spin")} />
              {refreshing ? copy.refreshing : copy.refresh}
            </button>
          </div>
        </div>
        <p className="mt-2 text-xs font-semibold text-slate-500">
          {copy.lastRefresh}: {lastRefresh ? new Date(lastRefresh).toLocaleString(language === "th" ? "th-TH" : "en-US") : copy.never}
        </p>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-7">
        {summaryCards.map(({ key, label, value, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={clsx(
              "rounded-lg border bg-white p-4 text-left shadow-sm transition hover:border-brand-200 hover:bg-brand-50/40",
              filter === key ? "border-brand-300 ring-2 ring-brand-100" : "border-slate-200"
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">{label}</p>
              <Icon className="h-4 w-4 text-brand-700" />
            </div>
            <p className="mt-2 text-2xl font-black text-slate-950">{formatNumber(value, language)}</p>
          </button>
        ))}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
        <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 className="section-title">{filter === "all" ? copy.allJobs : summaryCards.find((card) => card.key === filter)?.label}</h3>
            <p className="section-subtitle">{formatDate(selectedDate, language)}</p>
          </div>
          <span className="text-xs font-bold text-slate-500">{formatNumber(visibleRows.length, language)} / {formatNumber(rows.length, language)}</span>
        </div>

        {loading ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm font-semibold text-slate-500">{copy.refreshing}</div>
        ) : visibleRows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center">
            <p className="font-bold text-slate-900">{copy.noJobsTitle}</p>
            <p className="mt-1 text-sm text-slate-500">{copy.noJobsDescription}</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {visibleRows.map((row) => {
              const booking = row.booking;
              const mapsUrl = getRouteUrl(booking);
              const estimateText = Number(booking.estimated_distance_km) > 0
                ? `${formatNumber(Number(booking.estimated_distance_km), language, 1)} ${copy.km}${Number(booking.estimated_duration_minutes) > 0 ? ` / ${formatNumber(Number(booking.estimated_duration_minutes), language, 0)} ${copy.minutes}` : ""}`
                : copy.noEstimate;

              return (
                <article key={booking.id} className={clsx("rounded-lg border p-3 shadow-sm sm:p-4", row.ready ? "border-emerald-200 bg-emerald-50/25" : row.conflicts.some((conflict) => conflict.severity === "confirmed") ? "border-rose-200 bg-rose-50/40" : "border-amber-200 bg-amber-50/25")}>
                  <div className="grid gap-3 xl:grid-cols-[140px_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)] xl:items-start">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">{copy.pickup}</p>
                      <p className="mt-1 flex items-center gap-2 text-lg font-black text-slate-950"><Clock3 className="h-4 w-4 text-brand-700" />{booking.pickup_time || copy.noPickupTime}</p>
                      <p className="mt-2 break-words text-xs font-semibold text-slate-500">{copy.jobReference}: {getBookingReference(booking)}</p>
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-black text-slate-950">{getClientName(booking)}</p>
                      <p className="mt-2 break-words text-sm text-slate-700"><strong>{copy.pickup}:</strong> {booking.pickup || "-"}</p>
                      <p className="mt-1 break-words text-sm text-slate-700"><strong>{copy.dropoff}:</strong> {booking.dropoff || "-"}</p>
                    </div>
                    <div className="grid gap-2 text-sm">
                      <p className="flex items-center gap-2 font-semibold text-slate-800"><UserRound className="h-4 w-4 text-slate-500" />{booking.driver || copy.noDriver}</p>
                      <p className="flex items-center gap-2 font-semibold text-slate-800"><Truck className="h-4 w-4 text-slate-500" />{booking.vehicle || copy.noVehicle}</p>
                      <p className="text-xs text-slate-500">{copy.vehicleType}: {row.vehicle?.vehicle_type || row.vehicle?.vehicle_category || copy.noVehicleType}</p>
                    </div>
                    <div className="grid gap-2 text-sm">
                      <p><strong>{copy.estimated}:</strong> {estimateText}</p>
                      <p><strong>{copy.routeStatus}:</strong> {routeStatus(row, copy)}</p>
                      <p><strong>{copy.tripStatus}:</strong> {row.trip ? row.trip.status : copy.noTrip}</p>
                    </div>
                    <div className="grid gap-2">
                      <div className="flex flex-wrap gap-1.5">
                        {row.attention.length ? row.attention.map((item, index) => (
                          <span key={`${item.key}-${index}`} className={clsx("rounded-full border px-2.5 py-1 text-xs font-bold", item.tone === "danger" ? "border-rose-200 bg-rose-50 text-rose-700" : item.tone === "warning" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-sky-200 bg-sky-50 text-sky-700")}>
                            {attentionLabel(item.key, copy)}
                          </span>
                        )) : (
                          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">{copy.ready}</span>
                        )}
                      </div>
                      {row.conflicts.length ? (
                        <div className="grid gap-1 text-xs font-semibold text-slate-600">
                          {row.conflicts.slice(0, 3).map((conflict) => (
                            <a key={`${conflict.kind}-${conflict.otherBookingId}`} href={`/booking-diary`} className="underline decoration-slate-300 underline-offset-2">
                              {conflict.severity === "possible" ? copy.possibleConflict : copy.potentialConflicts}: {copy.conflictWith} {conflict.otherBookingId}
                            </a>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-200 pt-3">
                    <a href="/booking-diary" className="btn-secondary min-h-10 gap-1.5 px-3 text-xs"><ExternalLink className="h-3.5 w-3.5" />{copy.openBooking}</a>
                    <a href="/booking-diary" className="btn-secondary min-h-10 gap-1.5 px-3 text-xs"><Pencil className="h-3.5 w-3.5" />{copy.editBooking}</a>
                    {mapsUrl ? <a href={mapsUrl} target="_blank" rel="noreferrer" className="btn-secondary min-h-10 gap-1.5 px-3 text-xs"><Map className="h-3.5 w-3.5" />{copy.openMaps}</a> : null}
                    {row.trip ? (
                      <a href="/trip-journey" className="btn-primary min-h-10 gap-1.5 px-3 text-xs"><Route className="h-3.5 w-3.5" />{copy.openTrip}</a>
                    ) : (
                      <button type="button" onClick={() => void handleCreateTrip(booking)} disabled={tripActionId === String(booking.id)} className="btn-primary min-h-10 gap-1.5 px-3 text-xs">
                        <Route className="h-3.5 w-3.5" />
                        {tripActionId === String(booking.id) ? copy.creatingTrip : copy.createTrip}
                      </button>
                    )}
                    {(!booking.driver || !booking.vehicle) ? <a href="/booking-diary" className="btn-secondary min-h-10 px-3 text-xs">{copy.assign}</a> : null}
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
