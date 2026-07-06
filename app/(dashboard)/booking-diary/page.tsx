"use client";

import clsx from "clsx";
import {
  CalendarDays,
  ChevronRight,
  Clock3,
  Copy,
  Download,
  Edit3,
  Filter,
  MapPin,
  PackagePlus,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  Truck,
  UserRound,
  X
} from "lucide-react";
import Image from "next/image";
import { Fragment, type RefObject, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { EmptyState } from "@/components/empty-state";
import { GoogleMapsLoader } from "@/components/google-maps-loader";
import { LocationAutocomplete, type StructuredLocation } from "@/components/location-autocomplete";
import type { GoogleMapsHealthStatus } from "@/lib/google-maps";
import {
  createTripJourneyFromBooking,
  deleteBookingDiaryEntry,
  fetchBookingDiaryEntries,
  fetchDrivers,
  fetchTripJourneysByBookingIds,
  fetchVehicles,
  saveBookingDiaryEntry
} from "@/lib/data";
import { exportToXlsx } from "@/lib/export";
import { fetchJson } from "@/lib/http";
import { useLanguage } from "@/lib/language-provider";
import { supabase } from "@/lib/supabase";
import { formatDate } from "@/lib/utils";
import { LOCATION_SUGGESTIONS } from "@/src/data/locations";
import type { BookingDiaryEntry, Driver, TripJourney, TripJourneyStatus, Vehicle } from "@/types/database";

const PAGE_SIZE = 50;

type BookingForm = {
  id: string;
  booking_date: string;
  pickup_time: string;
  amount_pallets: string;
  weight: string;
  dimensions: string;
  pickup: string;
  pickup_place_id: string;
  pickup_address: string;
  warehouse_no: string;
  dropoff: string;
  dropoff_place_id: string;
  dropoff_address: string;
  estimated_distance_km: string;
  estimated_duration_minutes: string;
  google_maps_route_url: string;
  distance_source: string;
  route_calculated_at: string;
  vehicle: string;
  driver: string;
  notes: string;
};

type BookingSortKey =
  | "date_oldest"
  | "date_newest"
  | "recent_first"
  | "recent_last"
  | "pickup_earliest"
  | "pickup_latest";

const todayKey = () => new Date().toISOString().slice(0, 10);

const emptyForm = (): BookingForm => ({
  id: "",
  booking_date: todayKey(),
  pickup_time: "",
  amount_pallets: "",
  weight: "",
  dimensions: "",
  pickup: "",
  pickup_place_id: "",
  pickup_address: "",
  warehouse_no: "",
  dropoff: "",
  dropoff_place_id: "",
  dropoff_address: "",
  estimated_distance_km: "",
  estimated_duration_minutes: "",
  google_maps_route_url: "",
  distance_source: "",
  route_calculated_at: "",
  vehicle: "",
  driver: "",
  notes: ""
});

const labels = {
  en: {
    title: "Booking Diary",
    description: "Fast daily booking capture for phone calls, dispatch handover, and live office updates.",
    addBooking: "Add booking",
    editBooking: "Edit booking",
    edit: "Edit",
    duplicate: "Duplicate",
    createCopy: "Create copy",
    saveDuplicatedBooking: "Save duplicated booking",
    exportExcel: "Export Excel",
    live: "Live sync",
    entries: "bookings",
    today: "Today",
    week: "This week",
    all: "All",
    search: "Search bookings",
    searchPlaceholder: "Search pickup, dropoff, vehicle, driver, notes",
    date: "Date",
    time: "Time",
    pickupTime: "Pickup time",
    pickup: "Pickup",
    dropoff: "Dropoff",
    vehicle: "Vehicle",
    driver: "Driver",
    allDates: "All dates",
    allPickups: "All pickups",
    allDropoffs: "All dropoffs",
    allVehicles: "All vehicles",
    allDrivers: "All drivers",
    sortBy: "Sort by",
    dateOldestFirst: "Date: oldest first",
    dateNewestFirst: "Date: newest first",
    recentlyAddedFirst: "Recently added first",
    recentlyAddedLast: "Recently added last",
    pickupTimeEarliestFirst: "Pickup time: earliest first",
    pickupTimeLatestFirst: "Pickup time: latest first",
    amountPallets: "Amount / pallets",
    weight: "Weight",
    dimensions: "Dimensions",
    warehouseNo: "Warehouse / NO",
    notes: "Notes",
    modifiedBy: "Modified by",
    modifiedTime: "Modified time",
    save: "Save booking",
    update: "Update Booking",
    saving: "Saving...",
    cancel: "Cancel",
    close: "Close",
    quickFilters: "Quick filters",
    loading: "Loading booking diary...",
    noBookings: "No bookings found",
    noBookingsDescription: "Add a booking or adjust the filters to see the office diary.",
    saved: "Booking saved.",
    copied: "Duplicated booking saved.",
    updated: "Booking updated.",
    deleted: "Booking deleted.",
    loadError: "Unable to load booking diary.",
    saveError: "Unable to save booking.",
    deleteError: "Unable to delete booking.",
    required: "Date, pickup, and dropoff are required.",
    clearFilters: "Clear filters",
    previous: "Previous",
    next: "Next",
    pageSummary: "Page {page} of {pages}",
    showingRange: "Showing {start}-{end} of {total} bookings",
    totalShown: "Total shown",
    todayShown: "Today",
    weekShown: "This week",
    confirmDeleteTitle: "Delete booking",
    confirmDeleteText: "Are you sure you want to delete this booking? This action cannot be undone.",
    deleteBooking: "Delete Booking",
    tableHint: "Daily operational diary",
    lastChanged: "Last changed",
    details: "Booking details",
    tapToEdit: "Tap to edit",
    updatedLabel: "Updated",
    company: "EXPERT EXPRESS SENDER CO., LTD.",
    filters: "Filters",
    job: "Job",
    load: "Load",
    assignment: "Assignment",
    extra: "Extra",
    route: "Route",
    actions: "Actions",
    notesStatus: "Notes",
    routeEstimate: "Route estimate",
    estimateHelper: "Booking estimate is pickup to drop-off only. Trip Journey can add depot start later.",
    estimatedDistance: "Estimated distance",
    estimatedTime: "Estimated time",
    calculateDistance: "Calculate distance",
    calculatingDistance: "Calculating...",
    openGoogleMaps: "Open in Google Maps",
    noEstimate: "No estimate",
    googleMapsUnavailable: "Google Maps is unavailable. Manual entry still works.",
    distanceRequired: "Enter pickup and drop-off before calculating distance."
  },
  th: {
    title: "สมุดจองงาน",
    description: "บันทึกงานจองประจำวันให้เร็ว ใช้ง่าย และอัปเดตพร้อมกันทุกเครื่อง",
    addBooking: "เพิ่มงานจอง",
    editBooking: "แก้ไขงานจอง",
    edit: "แก้ไข",
    exportExcel: "Export Excel",
    live: "ซิงก์สด",
    entries: "รายการ",
    today: "วันนี้",
    week: "สัปดาห์นี้",
    all: "ทั้งหมด",
    search: "ค้นหางานจอง",
    searchPlaceholder: "ค้นหาต้นทาง ปลายทาง รถ คนขับ หมายเหตุ",
    date: "วันที่",
    time: "เวลา",
    pickupTime: "เวลารับของ",
    pickup: "รับของ",
    dropoff: "ส่งของ",
    vehicle: "รถ",
    driver: "คนขับ",
    allDates: "ทุกวันที่",
    allPickups: "ทุกจุดรับ",
    allDropoffs: "ทุกจุดส่ง",
    allVehicles: "รถทั้งหมด",
    allDrivers: "คนขับทั้งหมด",
    amountPallets: "จำนวน / พาเลท",
    weight: "น้ำหนัก",
    dimensions: "ขนาด",
    warehouseNo: "คลัง / NO",
    notes: "หมายเหตุ",
    modifiedBy: "แก้ไขโดย",
    modifiedTime: "เวลาแก้ไข",
    save: "บันทึกงานจอง",
    update: "อัปเดตงานจอง",
    saving: "กำลังบันทึก...",
    cancel: "Cancel",
    close: "ปิด",
    quickFilters: "ตัวกรองเร็ว",
    loading: "กำลังโหลดสมุดจองงาน...",
    noBookings: "ไม่พบงานจอง",
    noBookingsDescription: "เพิ่มงานจองใหม่หรือปรับตัวกรองเพื่อดูรายการ",
    saved: "บันทึกงานจองแล้ว",
    updated: "อัปเดตงานจองแล้ว",
    deleted: "Booking deleted.",
    loadError: "โหลดสมุดจองงานไม่ได้",
    saveError: "บันทึกงานจองไม่ได้",
    deleteError: "Unable to delete booking.",
    required: "กรุณากรอกวันที่ จุดรับ และจุดส่ง",
    clearFilters: "Clear filters",
    totalShown: "Total shown",
    todayShown: "Today",
    weekShown: "This week",
    confirmDeleteTitle: "Delete booking",
    confirmDeleteText: "Are you sure you want to delete this booking? This action cannot be undone.",
    deleteBooking: "Delete Booking",
    tableHint: "สมุดงานประจำวัน",
    lastChanged: "แก้ไขล่าสุด",
    details: "รายละเอียดงานจอง",
    tapToEdit: "แตะเพื่อแก้ไข",
    updatedLabel: "อัปเดต",
    company: "EXPERT EXPRESS SENDER CO., LTD.",
    filters: "ตัวกรอง",
    job: "งาน",
    load: "สินค้า",
    assignment: "รถ / คนขับ",
    extra: "เพิ่มเติม",
    route: "เส้นทาง",
    actions: "จัดการ",
    notesStatus: "หมายเหตุ"
  }
};

const labelExtras = {
  en: {},
  th: {
    duplicate: "ทำซ้ำ",
    createCopy: "สร้างสำเนา",
    saveDuplicatedBooking: "บันทึกงานที่ทำซ้ำ",
    sortBy: "เรียงตาม",
    dateOldestFirst: "วันที่: เก่าก่อน",
    dateNewestFirst: "วันที่: ใหม่ก่อน",
    recentlyAddedFirst: "เพิ่มล่าสุดก่อน",
    recentlyAddedLast: "เพิ่มล่าสุดหลังสุด",
    pickupTimeEarliestFirst: "เวลารับของ: เร็วก่อน",
    pickupTimeLatestFirst: "เวลารับของ: ช้าก่อน",
    previous: "ก่อนหน้า",
    next: "ถัดไป",
    pageSummary: "หน้า {page} จาก {pages}",
    showingRange: "แสดง {start}-{end} จาก {total} รายการ",
    copied: "บันทึกงานที่ทำซ้ำแล้ว"
  }
};

function mapBookingToForm(booking: BookingDiaryEntry): BookingForm {
  return {
    id: booking.id,
    booking_date: booking.booking_date,
    pickup_time: booking.pickup_time ?? "",
    amount_pallets: booking.amount_pallets != null ? String(booking.amount_pallets) : "",
    weight: booking.weight != null ? String(booking.weight) : "",
    dimensions: booking.dimensions ?? "",
    pickup: booking.pickup,
    pickup_place_id: booking.pickup_place_id ?? "",
    pickup_address: booking.pickup_address ?? "",
    warehouse_no: booking.warehouse_no ?? "",
    dropoff: booking.dropoff,
    dropoff_place_id: booking.dropoff_place_id ?? "",
    dropoff_address: booking.dropoff_address ?? "",
    estimated_distance_km: booking.estimated_distance_km != null ? String(booking.estimated_distance_km) : "",
    estimated_duration_minutes: booking.estimated_duration_minutes != null ? String(booking.estimated_duration_minutes) : "",
    google_maps_route_url: booking.google_maps_route_url ?? "",
    distance_source: booking.distance_source ?? "",
    route_calculated_at: booking.route_calculated_at ?? "",
    vehicle: booking.vehicle ?? "",
    driver: booking.driver ?? "",
    notes: booking.notes ?? ""
  };
}

function formatTime(value: string, language: "en" | "th") {
  if (!value) return "-";
  return new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-US", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatPickupTime(value: string | null | undefined) {
  if (!value) return "";
  return value.slice(0, 5);
}

function parseNumericInput(value: string) {
  const parsed = Number.parseFloat(value.replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function formatDistanceKm(value: number | string | null | undefined) {
  const numeric = typeof value === "number" ? value : value ? Number.parseFloat(String(value)) : null;
  return numeric != null && Number.isFinite(numeric) && numeric > 0 ? `${numeric.toFixed(1)} km` : null;
}

function formatDurationMinutes(value: number | string | null | undefined) {
  const numeric = typeof value === "number" ? value : value ? Number.parseFloat(String(value)) : null;
  if (numeric == null || !Number.isFinite(numeric) || numeric <= 0) return null;
  const rounded = Math.round(numeric);
  if (rounded < 60) return `${rounded} min`;
  const hours = Math.floor(rounded / 60);
  const minutes = rounded % 60;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

function buildGoogleMapsRouteUrl({
  origin,
  destination,
  originPlaceId,
  destinationPlaceId
}: {
  origin: string;
  destination: string;
  originPlaceId?: string | null;
  destinationPlaceId?: string | null;
}) {
  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  url.searchParams.set("origin", origin);
  url.searchParams.set("destination", destination);
  url.searchParams.set("travelmode", "driving");
  if (originPlaceId) url.searchParams.set("origin_place_id", originPlaceId.replace(/^places\//, ""));
  if (destinationPlaceId) url.searchParams.set("destination_place_id", destinationPlaceId.replace(/^places\//, ""));
  return url.toString();
}

function getStructuredLocation(form: BookingForm, type: "pickup" | "dropoff"): StructuredLocation | null {
  const label = type === "pickup" ? form.pickup : form.dropoff;
  const formattedAddress = type === "pickup" ? form.pickup_address : form.dropoff_address;
  const placeId = type === "pickup" ? form.pickup_place_id : form.dropoff_place_id;
  if (!label.trim() && !formattedAddress.trim()) return null;

  return {
    label: label || formattedAddress,
    formatted_address: formattedAddress || label,
    place_id: placeId || null,
    lat: Number.NaN,
    lng: Number.NaN,
    manual_text: placeId ? undefined : label,
    verified: Boolean(placeId)
  };
}

function formatDateHeading(value: string, language: "en" | "th") {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const parsed = match
    ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    : new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return formatDate(value, language);
  }

  return new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-GB", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric"
  }).format(parsed);
}

function uniqueSorted(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => (value ?? "").trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b)
  );
}

function isThisWeek(dateKey: string) {
  const target = new Date(`${dateKey}T00:00:00`);
  const now = new Date();
  const day = now.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() + mondayOffset);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return target >= start && target <= end;
}

function compareTextDate(a: string | null | undefined, b: string | null | undefined) {
  return (a || "").localeCompare(b || "");
}

function comparePickupTime(a: string | null | undefined, b: string | null | undefined) {
  return (a || "99:99").localeCompare(b || "99:99");
}

function compareBookings(a: BookingDiaryEntry, b: BookingDiaryEntry, sortKey: BookingSortKey) {
  const createdAsc = compareTextDate(a.created_at, b.created_at) || a.id.localeCompare(b.id);
  const dateAsc =
    a.booking_date.localeCompare(b.booking_date) ||
    comparePickupTime(a.pickup_time, b.pickup_time) ||
    createdAsc;
  const pickupAsc =
    comparePickupTime(a.pickup_time, b.pickup_time) ||
    a.booking_date.localeCompare(b.booking_date) ||
    createdAsc;

  switch (sortKey) {
    case "date_newest":
      return (
        b.booking_date.localeCompare(a.booking_date) ||
        comparePickupTime(a.pickup_time, b.pickup_time) ||
        createdAsc
      );
    case "recent_first":
      return compareTextDate(b.created_at, a.created_at) || b.id.localeCompare(a.id);
    case "recent_last":
      return createdAsc;
    case "pickup_earliest":
      return pickupAsc;
    case "pickup_latest":
      return (
        comparePickupTime(b.pickup_time, a.pickup_time) ||
        a.booking_date.localeCompare(b.booking_date) ||
        createdAsc
      );
    case "date_oldest":
    default:
      return dateAsc;
  }
}

function highlightMatch(option: string, query: string) {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return option;

  const matchIndex = option.toLocaleLowerCase().indexOf(trimmedQuery.toLocaleLowerCase());
  if (matchIndex < 0) return option;

  const before = option.slice(0, matchIndex);
  const match = option.slice(matchIndex, matchIndex + trimmedQuery.length);
  const after = option.slice(matchIndex + trimmedQuery.length);

  return (
    <>
      {before}
      <mark className="bg-transparent font-bold text-brand-700">{match}</mark>
      {after}
    </>
  );
}

type LocationComboboxProps = {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder: string;
  className: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  required?: boolean;
};

function LocationCombobox({
  value,
  onChange,
  options,
  placeholder,
  className,
  inputRef,
  required = false
}: LocationComboboxProps) {
  const listboxId = useId();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const query = value.trim();
  const normalizedQuery = query.toLocaleLowerCase();
  const matches = useMemo(() => {
    if (!normalizedQuery) return options.slice(0, 8);
    return options
      .filter((option) => option.toLocaleLowerCase().includes(normalizedQuery))
      .slice(0, 10);
  }, [normalizedQuery, options]);

  const selectOption = (option: string) => {
    onChange(option);
    setOpen(false);
    setActiveIndex(0);
  };

  return (
    <div className="relative">
      <input
        ref={inputRef}
        required={required}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
          setActiveIndex(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onKeyDown={(event) => {
          if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            setOpen(true);
            return;
          }

          if (!matches.length) return;

          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActiveIndex((current) => (current + 1) % matches.length);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex((current) => (current - 1 + matches.length) % matches.length);
          } else if (event.key === "Enter" && open) {
            event.preventDefault();
            selectOption(matches[activeIndex]);
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
        className={className}
        placeholder={placeholder}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open && matches.length > 0}
        aria-controls={listboxId}
        aria-activedescendant={open && matches[activeIndex] ? `${listboxId}-${activeIndex}` : undefined}
      />
      {open && matches.length > 0 ? (
        <div
          id={listboxId}
          role="listbox"
          className="absolute left-0 right-0 top-[calc(100%+0.35rem)] z-[70] max-h-56 overflow-y-auto rounded-[0.85rem] border border-slate-200 bg-white p-1 shadow-[0_18px_44px_rgba(15,23,42,0.14)]"
        >
          {matches.map((option, index) => (
            <button
              key={option}
              id={`${listboxId}-${index}`}
              type="button"
              role="option"
              aria-selected={activeIndex === index}
              onMouseEnter={() => setActiveIndex(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectOption(option)}
              className={clsx(
                "flex w-full items-center rounded-[0.65rem] px-3 py-2 text-left text-[13px] font-medium text-slate-700 transition",
                activeIndex === index ? "bg-slate-100 text-slate-950" : "hover:bg-slate-50"
              )}
            >
              <span className="truncate">{highlightMatch(option, value)}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function BookingDiaryPage() {
  const { language } = useLanguage();
  const languageKey = language === "th" ? "th" : "en";
  const copy = { ...labels.en, ...labels[languageKey], ...labelExtras[languageKey] };
  const firstInputRef = useRef<HTMLInputElement | null>(null);
  const [bookings, setBookings] = useState<BookingDiaryEntry[]>([]);
  const [tripsByBookingId, setTripsByBookingId] = useState<Map<string, TripJourney>>(() => new Map());
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [form, setForm] = useState<BookingForm>(() => emptyForm());
  const [modalOpen, setModalOpen] = useState(false);
  const [quickFilter, setQuickFilter] = useState<"today" | "week" | "all">("today");
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [pickupFilter, setPickupFilter] = useState("");
  const [dropoffFilter, setDropoffFilter] = useState("");
  const [vehicleFilter, setVehicleFilter] = useState("");
  const [driverFilter, setDriverFilter] = useState("");
  const [sortBy, setSortBy] = useState<BookingSortKey>("date_newest");
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingBookingId, setEditingBookingId] = useState<string | null>(null);
  const [duplicatingBooking, setDuplicatingBooking] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BookingDiaryEntry | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [routeCalculating, setRouteCalculating] = useState(false);
  const [routeMessage, setRouteMessage] = useState<string | null>(null);
  const [googleMapsStatus, setGoogleMapsStatus] = useState<GoogleMapsHealthStatus | null>(null);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [expandedDateKeys, setExpandedDateKeys] = useState<Set<string>>(() => new Set([todayKey()]));
  const [toggledDateKeys, setToggledDateKeys] = useState<Set<string>>(() => new Set());

  const load = useCallback(async (blocking = false) => {
    try {
      if (blocking) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      setError(null);
      const [bookingRows, driverRows, vehicleRows] = await Promise.all([
        fetchBookingDiaryEntries(),
        fetchDrivers(),
        fetchVehicles()
      ]);
      const tripRows = await fetchTripJourneysByBookingIds(bookingRows.map((booking) => booking.id)).catch((tripError) => {
        console.warn("Booking diary trip status unavailable:", tripError);
        return [] as TripJourney[];
      });
      setBookings(bookingRows);
      setTripsByBookingId(new Map(tripRows.filter((trip) => trip.booking_diary_id).map((trip) => [String(trip.booking_diary_id), trip])));
      setDrivers(driverRows);
      setVehicles(vehicleRows);
    } catch (err) {
      console.error("Booking diary load error:", err);
      setError(copy.loadError);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [copy.loadError]);

  useEffect(() => {
    void load(true);
  }, [load]);

  useEffect(() => {
    const channel = supabase
      .channel("booking-diary-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "booking_diary" }, () => {
        void load(false);
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load]);

  useEffect(() => {
    if (!modalOpen) return;
    const timer = window.setTimeout(() => firstInputRef.current?.focus(), 120);
    return () => window.clearTimeout(timer);
  }, [modalOpen]);

  const pickupOptions = useMemo(() => uniqueSorted(bookings.map((booking) => booking.pickup)), [bookings]);
  const dropoffOptions = useMemo(() => uniqueSorted(bookings.map((booking) => booking.dropoff)), [bookings]);
  const vehicleOptions = useMemo(
    () => uniqueSorted([...bookings.map((booking) => booking.vehicle), ...vehicles.map((vehicle) => vehicle.vehicle_reg)]),
    [bookings, vehicles]
  );
  const driverOptions = useMemo(
    () => uniqueSorted([...bookings.map((booking) => booking.driver), ...drivers.map((driver) => driver.name)]),
    [bookings, drivers]
  );
  const locationOptions = useMemo(
    () => uniqueSorted([...LOCATION_SUGGESTIONS, ...bookings.map((booking) => booking.pickup), ...bookings.map((booking) => booking.dropoff)]),
    [bookings]
  );

  const filteredBookings = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const today = todayKey();

    return bookings.filter((booking) => {
      const quickMatch =
        quickFilter === "all" ||
        (quickFilter === "today" && booking.booking_date === today) ||
        (quickFilter === "week" && isThisWeek(booking.booking_date));
      const queryMatch =
        !query ||
        [
          booking.pickup,
          booking.dropoff,
          booking.vehicle,
          booking.driver,
          booking.warehouse_no,
          booking.notes
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(query);

      return (
        quickMatch &&
        queryMatch &&
        (!dateFilter || booking.booking_date === dateFilter) &&
        (!pickupFilter || booking.pickup === pickupFilter) &&
        (!dropoffFilter || booking.dropoff === dropoffFilter) &&
        (!vehicleFilter || booking.vehicle === vehicleFilter) &&
        (!driverFilter || booking.driver === driverFilter)
      );
    }).sort((a, b) => compareBookings(a, b, sortBy));
  }, [bookings, dateFilter, driverFilter, dropoffFilter, pickupFilter, quickFilter, searchQuery, sortBy, vehicleFilter]);

  useEffect(() => {
    setCurrentPage(1);
  }, [dateFilter, driverFilter, dropoffFilter, pickupFilter, quickFilter, searchQuery, sortBy, vehicleFilter]);

  const dateCounts = useMemo(() => {
    const counts = new Map<string, number>();
    filteredBookings.forEach((booking) => {
      counts.set(booking.booking_date, (counts.get(booking.booking_date) ?? 0) + 1);
    });
    return counts;
  }, [filteredBookings]);

  const filtersActive = Boolean(
    searchQuery ||
      dateFilter ||
      pickupFilter ||
      dropoffFilter ||
      vehicleFilter ||
      driverFilter ||
      quickFilter !== "today" ||
      sortBy !== "date_newest"
  );
  const groupedBookings = useMemo(() => {
    const groups = new Map<string, BookingDiaryEntry[]>();
    filteredBookings.forEach((booking) => {
      const entries = groups.get(booking.booking_date) ?? [];
      entries.push(booking);
      groups.set(booking.booking_date, entries);
    });
    return [...groups.entries()].map(([date, entries]) => [date, entries] as const);
  }, [filteredBookings]);
  const visibleDateKeys = useMemo(() => groupedBookings.map(([date]) => date), [groupedBookings]);
  const visibleDateKeySet = useMemo(() => new Set(visibleDateKeys), [visibleDateKeys]);
  const expandedVisibleDateCount = useMemo(
    () => visibleDateKeys.filter((date) => expandedDateKeys.has(date)).length,
    [expandedDateKeys, visibleDateKeys]
  );
  const allVisibleDateSectionsExpanded = visibleDateKeys.length > 0 && expandedVisibleDateCount === visibleDateKeys.length;
  const dateSectionControlLabel =
    allVisibleDateSectionsExpanded
      ? language === "th" ? "ย่อทั้งหมด" : "Collapse all"
      : language === "th" ? "ขยายทั้งหมด" : "Expand all";

  useEffect(() => {
    const today = todayKey();

    setExpandedDateKeys((current) => {
      const next = new Set([...current].filter((date) => visibleDateKeySet.has(date)));
      if (visibleDateKeySet.has(today) && !toggledDateKeys.has(today)) {
        next.add(today);
      }
      return next;
    });
  }, [toggledDateKeys, visibleDateKeySet]);

  const toggleDateSection = useCallback((date: string) => {
    setToggledDateKeys((current) => {
      const next = new Set(current);
      next.add(date);
      return next;
    });
    setExpandedDateKeys((current) => {
      if (current.has(date)) {
        const next = new Set(current);
        next.delete(date);
        return next;
      }
      return new Set([...current, date]);
    });
  }, []);

  const toggleAllDateSections = useCallback(() => {
    setToggledDateKeys((current) => {
      const next = new Set(current);
      visibleDateKeys.forEach((date) => next.add(date));
      return next;
    });

    setCurrentPage(1);
    if (allVisibleDateSectionsExpanded) {
      setExpandedDateKeys(new Set());
    } else {
      setExpandedDateKeys(new Set(visibleDateKeys));
    }
  }, [allVisibleDateSectionsExpanded, visibleDateKeys]);

  const diaryPages = useMemo(() => {
    type DiaryPageGroup = {
      date: string;
      entries: BookingDiaryEntry[];
      totalEntries: number;
    };

    const pages: DiaryPageGroup[][] = [];
    let page: DiaryPageGroup[] = [];
    let visibleItemsOnPage = 0;

    if (allVisibleDateSectionsExpanded) {
      return [
        groupedBookings.map(([date, entries]) => ({
          date,
          entries,
          totalEntries: entries.length
        }))
      ];
    }

    const commitPage = () => {
      if (page.length) {
        pages.push(page);
        page = [];
        visibleItemsOnPage = 0;
      }
    };

    groupedBookings.forEach(([date, entries]) => {
      const expanded = expandedDateKeys.has(date);

      if (!expanded) {
        if (visibleItemsOnPage >= PAGE_SIZE) {
          commitPage();
        }
        page.push({ date, entries: [], totalEntries: entries.length });
        visibleItemsOnPage += 1;
        return;
      }

      const visibleItemCount = 1 + entries.length;

      if (visibleItemCount <= PAGE_SIZE) {
        if (visibleItemsOnPage > 0 && visibleItemsOnPage + visibleItemCount > PAGE_SIZE) {
          commitPage();
        }
        page.push({ date, entries, totalEntries: entries.length });
        visibleItemsOnPage += visibleItemCount;
        return;
      }

      commitPage();
      let entryIndex = 0;
      while (entryIndex < entries.length) {
        const chunk = entries.slice(entryIndex, entryIndex + PAGE_SIZE - 1);
        pages.push([{ date, entries: chunk, totalEntries: entries.length }]);
        entryIndex += chunk.length;
      }
    });

    commitPage();
    return pages;
  }, [allVisibleDateSectionsExpanded, expandedDateKeys, groupedBookings]);

  const totalPages = Math.max(1, diaryPages.length);
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const paginatedGroups = useMemo(
    () => diaryPages[safeCurrentPage - 1] ?? [],
    [diaryPages, safeCurrentPage]
  );
  const paginatedBookings = useMemo(
    () => paginatedGroups.flatMap((group) => group.entries),
    [paginatedGroups]
  );
  const visiblePageDateCount = paginatedGroups.length;
  const visiblePageBookingCount = paginatedGroups.reduce((total, group) => total + group.totalEntries, 0);
  const visibleRangeText =
    language === "th"
      ? `แสดง ${visiblePageDateCount} กลุ่มวันที่ รวม ${visiblePageBookingCount} รายการ`
      : `Showing ${visiblePageDateCount} date ${visiblePageDateCount === 1 ? "group" : "groups"} containing ${visiblePageBookingCount} ${visiblePageBookingCount === 1 ? "booking" : "bookings"}`;

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const clearFilters = () => {
    setSearchQuery("");
    setDateFilter("");
    setPickupFilter("");
    setDropoffFilter("");
    setVehicleFilter("");
    setDriverFilter("");
    setQuickFilter("today");
    setSortBy("date_newest");
    setCurrentPage(1);
  };

  const openCreate = () => {
    setForm(emptyForm());
    setEditingBookingId(null);
    setDuplicatingBooking(false);
    setError(null);
    setNotice(null);
    setRouteMessage(null);
    setModalOpen(true);
  };

  const openEdit = (booking: BookingDiaryEntry) => {
    if (!booking.id) {
      setError(copy.saveError);
      console.error("Booking diary edit error: missing booking id", booking);
      return;
    }
    setForm(mapBookingToForm(booking));
    setEditingBookingId(booking.id);
    setDuplicatingBooking(false);
    setError(null);
    setNotice(null);
    setRouteMessage(null);
    setModalOpen(true);
  };

  const openDuplicate = (booking: BookingDiaryEntry) => {
    setForm({ ...mapBookingToForm(booking), id: "" });
    setEditingBookingId(null);
    setDuplicatingBooking(true);
    setError(null);
    setNotice(null);
    setRouteMessage(null);
    setModalOpen(true);
  };

  const getTripForBooking = (booking: BookingDiaryEntry) => tripsByBookingId.get(String(booking.id)) ?? null;
  const getTripStatusLabel = (status: TripJourneyStatus) => {
    if (status === "completed") return "Complete";
    if (status === "missing_mileage") return "Missing Mileage";
    if (status === "missing_estimated_distance") return "Missing Estimate";
    if (status === "missing_fuel") return "Missing Fuel";
    return "Trip created";
  };
  const getBookingTripLabel = (booking: BookingDiaryEntry) => {
    const trip = getTripForBooking(booking);
    if (!trip) return "No trip record";
    return getTripStatusLabel(trip.status);
  };
  const getBookingTripClass = (booking: BookingDiaryEntry) => {
    const trip = getTripForBooking(booking);
    if (!trip) return "border-slate-200 bg-slate-50 text-slate-600";
    if (trip.status === "completed") return "border-emerald-200 bg-emerald-50 text-emerald-700";
    return "border-amber-200 bg-amber-50 text-amber-800";
  };

  const createTripRecord = async (booking: BookingDiaryEntry) => {
    try {
      setError(null);
      setNotice(null);
      const trip = await createTripJourneyFromBooking(booking);
      setTripsByBookingId((current) => new Map(current).set(String(booking.id), trip));
      const params = new URLSearchParams({
        tripId: String(trip.id),
        bookingId: String(booking.id)
      });
      window.location.assign(`/trip-journey?${params.toString()}#trip-records`);
    } catch (err) {
      console.error("Create trip record error:", err);
      setError(err instanceof Error && err.message ? err.message : "Unable to create trip record.");
    }
  };

  const closeModal = () => {
    if (saving) return;
    setModalOpen(false);
    setEditingBookingId(null);
    setDuplicatingBooking(false);
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form.booking_date || !form.pickup.trim() || !form.dropoff.trim()) {
      setError(copy.required);
      return;
    }

    try {
      setSaving(true);
      setError(null);
      const targetId = duplicatingBooking ? undefined : (editingBookingId ?? form.id.trim()) || undefined;
      await saveBookingDiaryEntry({
        id: targetId,
        booking_date: form.booking_date,
        pickup_time: form.pickup_time,
        amount_pallets: form.amount_pallets,
        weight: form.weight,
        dimensions: form.dimensions,
        pickup: form.pickup,
        pickup_place_id: form.pickup_place_id,
        pickup_address: form.pickup_address,
        warehouse_no: form.warehouse_no,
        dropoff: form.dropoff,
        dropoff_place_id: form.dropoff_place_id,
        dropoff_address: form.dropoff_address,
        estimated_distance_km: form.estimated_distance_km,
        estimated_duration_minutes: form.estimated_duration_minutes,
        google_maps_route_url: form.google_maps_route_url,
        distance_source: form.distance_source,
        route_calculated_at: form.route_calculated_at,
        vehicle: form.vehicle,
        driver: form.driver,
        notes: form.notes
      });
      setNotice(duplicatingBooking ? copy.copied : targetId ? copy.updated : copy.saved);
      setEditingBookingId(null);
      setDuplicatingBooking(false);
      setModalOpen(false);
      await load(false);
    } catch (err) {
      console.error(editingBookingId ? "Booking diary update error:" : "Booking diary save error:", {
        id: (editingBookingId ?? form.id) || null,
        error: err
      });
      setError(err instanceof Error && err.message ? err.message : copy.saveError);
    } finally {
      setSaving(false);
    }
  };

  const setField = (field: keyof BookingForm, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleGoogleMapsStatusChange = useCallback((status: GoogleMapsHealthStatus) => {
    setGoogleMapsStatus(status);
    if (process.env.NODE_ENV !== "production") {
      console.info("[Fuel Bank] Booking Diary Google Maps status:", {
        publicKey: status.hasPublicKey,
        serverKey: status.hasServerKey,
        scriptLoaded: status.scriptLoaded,
        placesAvailable: status.placesAvailable,
        directionsAvailable: status.directionsAvailable,
        errorCode: status.errorCode
      });
    }
  }, []);

  const setPickupText = (value: string) => {
    setRouteMessage(null);
    setForm((current) => ({
      ...current,
      pickup: value,
      pickup_place_id: "",
      pickup_address: value
    }));
  };

  const setDropoffText = (value: string) => {
    setRouteMessage(null);
    setForm((current) => ({
      ...current,
      dropoff: value,
      dropoff_place_id: "",
      dropoff_address: value
    }));
  };

  const setPickupLocation = (location: StructuredLocation) => {
    setRouteMessage(null);
    setForm((current) => ({
      ...current,
      pickup: location.formatted_address || location.label,
      pickup_place_id: location.place_id ?? "",
      pickup_address: location.formatted_address || location.label
    }));
  };

  const setDropoffLocation = (location: StructuredLocation) => {
    setRouteMessage(null);
    setForm((current) => ({
      ...current,
      dropoff: location.formatted_address || location.label,
      dropoff_place_id: location.place_id ?? "",
      dropoff_address: location.formatted_address || location.label
    }));
  };

  const setManualDistance = (value: string) => {
    setRouteMessage(null);
    setForm((current) => {
      const numericDistance = parseNumericInput(value);
      const routeUrl =
        current.google_maps_route_url ||
        (current.pickup.trim() && current.dropoff.trim()
          ? buildGoogleMapsRouteUrl({
              origin: current.pickup_address || current.pickup,
              destination: current.dropoff_address || current.dropoff,
              originPlaceId: current.pickup_place_id,
              destinationPlaceId: current.dropoff_place_id
            })
          : "");

      return {
        ...current,
        estimated_distance_km: value,
        distance_source: numericDistance != null && numericDistance > 0 ? "manual" : current.distance_source,
        google_maps_route_url: routeUrl,
        route_calculated_at: numericDistance != null && numericDistance > 0 ? new Date().toISOString() : current.route_calculated_at
      };
    });
  };

  const calculateRouteDistance = async () => {
    const pickup = form.pickup_address.trim() || form.pickup.trim();
    const dropoff = form.dropoff_address.trim() || form.dropoff.trim();

    if (!pickup || !dropoff) {
      setRouteMessage(copy.distanceRequired);
      return;
    }

    try {
      setRouteCalculating(true);
      setRouteMessage(null);
      const result = await fetchJson<{
        distanceKm?: number;
        durationSeconds?: number | null;
        provider?: string;
      }>("/api/distance-estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          origin: {
            label: form.pickup,
            formatted_address: pickup,
            place_id: form.pickup_place_id || null
          },
          destination: {
            label: form.dropoff,
            formatted_address: dropoff,
            place_id: form.dropoff_place_id || null
          }
        })
      });

      const distanceKm = Number(result.data?.distanceKm);
      if (!Number.isFinite(distanceKm) || distanceKm <= 0) {
        throw new Error(copy.googleMapsUnavailable);
      }

      const durationMinutes = result.data?.durationSeconds
        ? Math.round(result.data.durationSeconds / 60)
        : null;
      const routeUrl = buildGoogleMapsRouteUrl({
        origin: pickup,
        destination: dropoff,
        originPlaceId: form.pickup_place_id,
        destinationPlaceId: form.dropoff_place_id
      });

      setForm((current) => ({
        ...current,
        pickup_address: pickup,
        dropoff_address: dropoff,
        estimated_distance_km: distanceKm.toFixed(1),
        estimated_duration_minutes: durationMinutes != null ? String(durationMinutes) : current.estimated_duration_minutes,
        google_maps_route_url: routeUrl,
        distance_source: "google_maps",
        route_calculated_at: new Date().toISOString()
      }));
      setRouteMessage(
        `Distance calculated: ${distanceKm.toFixed(1)} km${
          durationMinutes != null ? ` / ${formatDurationMinutes(durationMinutes)}` : ""
        }`
      );
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : copy.googleMapsUnavailable;
      console.warn("[Fuel Bank] Booking Diary route estimate failed:", message);
      setRouteMessage(
        `${message}. You can enter the estimated distance manually.`
      );
    } finally {
      setRouteCalculating(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) {
      return;
    }

    const targetId = deleteTarget.id;
    try {
      setDeletingId(targetId);
      setError(null);
      setNotice(null);
      await deleteBookingDiaryEntry(targetId);
      setBookings((current) => current.filter((booking) => booking.id !== targetId));
      setDeleteTarget(null);
      setNotice(copy.deleted);
    } catch (err) {
      console.error("Booking diary delete error:", err);
      setError(err instanceof Error && err.message ? err.message : copy.deleteError);
    } finally {
      setDeletingId(null);
    }
  };

  const exportFilteredBookings = () => {
    exportToXlsx(
      filteredBookings.map((booking) => ({
        Date: booking.booking_date,
        "Pickup Time": booking.pickup_time,
        "Amount / Pallets": booking.amount_pallets,
        Weight: booking.weight,
        Dimensions: booking.dimensions,
        Pickup: booking.pickup,
        "Pickup Address": booking.pickup_address,
        "Warehouse / NO": booking.warehouse_no,
        Dropoff: booking.dropoff,
        "Dropoff Address": booking.dropoff_address,
        "Estimated Distance KM": booking.estimated_distance_km,
        "Estimated Duration Minutes": booking.estimated_duration_minutes,
        "Google Maps Route": booking.google_maps_route_url,
        "Distance Source": booking.distance_source,
        Vehicle: booking.vehicle,
        Driver: booking.driver,
        Notes: booking.notes,
        "Created By": booking.created_by,
        "Created At": booking.created_at,
        "Modified By": booking.modified_by,
        "Modified Time": booking.updated_at
      })),
      `booking-diary-${todayKey()}`,
      "Booking Diary"
    );
  };

  const inputClass = "booking-form-control";
  const compactInputClass = "booking-filter-control";
  const bookingTitle = language === "th" ? "Booking Diary" : copy.title;
  const activeEditingId = editingBookingId || form.id.trim();
  const filterControls = (
    <>
      <div className="relative col-span-1 sm:col-span-3 xl:col-span-1">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder={copy.searchPlaceholder}
          className={`${compactInputClass} bg-white pl-10`}
          aria-label={copy.search}
        />
      </div>
      <input
        type="date"
        value={dateFilter}
        onChange={(event) => setDateFilter(event.target.value)}
        className={`${compactInputClass} bg-white`}
        aria-label={copy.date}
      />
      <select value={sortBy} onChange={(event) => setSortBy(event.target.value as BookingSortKey)} className={`${compactInputClass} bg-white`} aria-label={copy.sortBy}>
        <option value="date_newest">{copy.dateNewestFirst}</option>
        <option value="date_oldest">{copy.dateOldestFirst}</option>
        <option value="recent_first">{copy.recentlyAddedFirst}</option>
        <option value="recent_last">{copy.recentlyAddedLast}</option>
        <option value="pickup_earliest">{copy.pickupTimeEarliestFirst}</option>
        <option value="pickup_latest">{copy.pickupTimeLatestFirst}</option>
      </select>
      <select value={pickupFilter} onChange={(event) => setPickupFilter(event.target.value)} className={`${compactInputClass} bg-white`}>
        <option value="">{copy.allPickups}</option>
        {pickupOptions.map((pickup) => <option key={pickup} value={pickup}>{pickup}</option>)}
      </select>
      <select value={dropoffFilter} onChange={(event) => setDropoffFilter(event.target.value)} className={`${compactInputClass} bg-white`}>
        <option value="">{copy.allDropoffs}</option>
        {dropoffOptions.map((dropoff) => <option key={dropoff} value={dropoff}>{dropoff}</option>)}
      </select>
      <select value={vehicleFilter} onChange={(event) => setVehicleFilter(event.target.value)} className={`${compactInputClass} bg-white`}>
        <option value="">{copy.allVehicles}</option>
        {vehicleOptions.map((vehicle) => <option key={vehicle} value={vehicle}>{vehicle}</option>)}
      </select>
      <select value={driverFilter} onChange={(event) => setDriverFilter(event.target.value)} className={`${compactInputClass} bg-white`}>
        <option value="">{copy.allDrivers}</option>
        {driverOptions.map((driver) => <option key={driver} value={driver}>{driver}</option>)}
      </select>
    </>
  );
  const quickFilterControls = (
    <>
      {(["today", "week", "all"] as const).map((filter) => (
        <button
          key={filter}
          type="button"
          onClick={() => setQuickFilter(filter)}
          className={clsx(
            "booking-filter-chip",
            quickFilter === filter
              ? "border-brand-200 bg-brand-50 text-brand-800"
              : "border-slate-200 bg-white text-slate-600 hover:border-brand-100 hover:text-brand-700"
          )}
        >
          {filter === "today" ? copy.today : filter === "week" ? copy.week : copy.all}
        </button>
      ))}
      {filtersActive ? (
        <button
          type="button"
          onClick={clearFilters}
          className="booking-filter-chip border-slate-200 bg-white text-slate-600 hover:border-rose-100 hover:text-rose-600"
        >
          {copy.clearFilters}
        </button>
      ) : null}
    </>
  );

  return (
    <div className="booking-diary-page w-full max-w-full overflow-x-hidden">
      <GoogleMapsLoader onStatusChange={handleGoogleMapsStatusChange} />
      <section className="booking-diary-header">
        <div className="booking-diary-logo">
          <Image
            src="/logo.png"
            alt={copy.company}
            width={64}
            height={48}
            className="h-12 w-auto object-contain brightness-105"
            priority
          />
        </div>
        <div className="booking-diary-title min-w-0">
          <p className="truncate text-[10px] font-bold uppercase tracking-[0.16em] text-brand-700">{copy.company}</p>
          <h1 className="truncate text-[1.2rem] font-semibold leading-7 text-slate-950 sm:text-[1.35rem]">{bookingTitle}</h1>
        </div>
        <div className="booking-diary-header-actions">
          <button
            type="button"
            onClick={() => setMobileFiltersOpen(true)}
            className="booking-filter-toggle lg:hidden"
          >
            <Filter className="h-3.5 w-3.5" />
            {copy.filters}
          </button>
          <button
            type="button"
            onClick={exportFilteredBookings}
            disabled={!filteredBookings.length}
            className="booking-icon-button btn-secondary disabled:cursor-not-allowed disabled:opacity-50"
            aria-label={copy.exportExcel}
          >
            <Download className="h-4 w-4" />
          </button>
          <button type="button" onClick={openCreate} className="booking-icon-button btn-primary" aria-label={copy.addBooking}>
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </section>

      <section className="booking-responsive-controls hidden max-w-full md:block">
        <div className="booking-filter-panel surface-card-soft">
          <div className="booking-filter-panel-header">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-brand-700" />
              <p className="text-sm font-semibold text-slate-800">{copy.filters}</p>
            </div>
            <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              {copy.live}
            </div>
          </div>
          <div className="booking-filter-grid grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-[minmax(220px,1.4fr)_repeat(6,minmax(140px,1fr))]">
            {filterControls}
          </div>
          <div className="booking-filter-footer">
            <div className="booking-quick-filters flex flex-wrap gap-2">
              {quickFilterControls}
            </div>
            <div className="booking-controls-actions">
              <button
                type="button"
                onClick={exportFilteredBookings}
                disabled={!filteredBookings.length}
                className="booking-action-button btn-secondary gap-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Download className="h-4 w-4" />
                {copy.exportExcel}
              </button>
              <button type="button" onClick={openCreate} className="booking-action-button btn-primary gap-2">
                <PackagePlus className="h-4 w-4" />
                {copy.addBooking}
              </button>
            </div>
          </div>
        </div>
      </section>

      {mobileFiltersOpen ? (
        <div className="booking-mobile-filter-backdrop fixed inset-0 z-40 flex items-end bg-[rgba(26,16,46,0.28)] backdrop-blur-[5px] lg:hidden">
          <div className="booking-mobile-filter-sheet">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-brand-700" />
                <p className="text-sm font-semibold text-slate-900">{copy.filters}</p>
              </div>
              <button type="button" onClick={() => setMobileFiltersOpen(false)} className="btn-secondary h-9 w-9 min-h-0 rounded-[0.8rem] px-0" aria-label={copy.close}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-1 gap-2">
              {filterControls}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {quickFilterControls}
            </div>
          </div>
        </div>
      ) : null}

      {notice ? (
        <div className="rounded-[1rem] border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
          {notice}
        </div>
      ) : null}

      {error && !modalOpen ? (
        <div className="rounded-[1rem] border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
          {error}
        </div>
      ) : null}

      <section className="booking-diary-book min-w-0 max-w-full">
        <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-sm font-semibold text-slate-700">{copy.tableHint}</h2>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <button
              type="button"
              onClick={toggleAllDateSections}
              disabled={visibleDateKeys.length === 0}
              className="booking-section-toggle disabled:cursor-not-allowed disabled:opacity-50"
            >
              {dateSectionControlLabel}
            </button>
            <button type="button" onClick={() => void load(false)} disabled={refreshing} className="btn-secondary min-h-[36px] gap-2 rounded-[0.8rem] px-3 text-xs disabled:opacity-60">
              <RefreshCw className={clsx("h-4 w-4", refreshing && "animate-spin")} />
              {refreshing ? copy.loading : copy.live}
            </button>
          </div>
        </div>
        <p className="booking-visible-count">
          {visibleRangeText}
        </p>

        {loading ? (
          <p className="loading-inline">{copy.loading}</p>
        ) : filteredBookings.length === 0 ? (
          <EmptyState title={copy.noBookings} description={copy.noBookingsDescription} />
        ) : (
          <>
            <div className="booking-paper-diary md:hidden">
              {paginatedGroups.map(({ date, entries, totalEntries }) => {
                const expanded = expandedDateKeys.has(date);

                return (
                  <section key={date} className="booking-date-section">
                    <button
                      type="button"
                      onClick={() => toggleDateSection(date)}
                      className={clsx("booking-date-heading", expanded && "booking-date-heading-open")}
                      aria-expanded={expanded}
                    >
                      <span className="booking-date-heading-main">
                        <span className="booking-date-chevron">
                          <ChevronRight className={clsx("h-3.5 w-3.5 transition-transform duration-200", expanded && "rotate-90")} />
                        </span>
                        <span>{formatDateHeading(date, language)}</span>
                      </span>
                      <strong>{dateCounts.get(date) ?? totalEntries} {copy.entries}</strong>
                    </button>
                    {expanded && entries.length ? (
                      <div className="booking-date-lines">
                        {entries.map((booking) => (
                      <div key={booking.id} className="booking-diary-line">
                        <button type="button" onClick={() => openEdit(booking)} className="booking-diary-line-main">
                          <span className="booking-line-main">
                            <span className="booking-line-time-block">
                              <span className="booking-line-time-label">PICKUP</span>
                              <span className={clsx("booking-line-time", !booking.pickup_time && "booking-line-time-empty")}>
                                {formatPickupTime(booking.pickup_time) || "TBC"}
                              </span>
                            </span>
                            <span className="booking-line-route">{booking.pickup} <span>-&gt;</span> {booking.dropoff}</span>
                            <span className="mt-1 flex flex-wrap gap-1.5">
                              <span className="inline-flex w-fit rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                                {formatDistanceKm(booking.estimated_distance_km) ?? copy.noEstimate}
                              </span>
                              {formatDurationMinutes(booking.estimated_duration_minutes) ? (
                                <span className="inline-flex w-fit rounded-full border border-indigo-100 bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">
                                  {formatDurationMinutes(booking.estimated_duration_minutes)}
                                </span>
                              ) : null}
                            </span>
                          </span>
                          {(() => {
                            const meta = [
                              booking.vehicle,
                              booking.driver,
                              booking.amount_pallets ? `${booking.amount_pallets} PLT` : "",
                              booking.weight ? `${booking.weight}kg` : ""
                            ].filter(Boolean);
                            return meta.length ? (
                              <span className="booking-line-meta">
                                {meta.map((item, index) => (
                                  <span
                                    key={`${item}-${index}`}
                                    className={clsx(
                                      index === 0 && "booking-line-vehicle",
                                      index === 1 && "booking-line-driver"
                                    )}
                                  >
                                    {item}
                                  </span>
                                ))}
                              </span>
                            ) : null;
                          })()}
                          {(booking.warehouse_no || booking.notes) ? (
                            <span className="booking-line-support">
                              {booking.warehouse_no ? <span>Warehouse: {booking.warehouse_no}</span> : null}
                              {booking.notes ? <span>Notes: {booking.notes}</span> : null}
                            </span>
                          ) : null}
                        </button>
                        <div className="booking-line-actions">
                          <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${getBookingTripClass(booking)}`}>
                            {getBookingTripLabel(booking)}
                          </span>
                          <button
                            type="button"
                            onClick={() => void createTripRecord(booking)}
                            className="booking-entry-edit"
                            aria-label={getTripForBooking(booking) ? "Open Trip" : "Create Trip"}
                          >
                            <PackagePlus className="h-3.5 w-3.5" />
                            {getTripForBooking(booking) ? "Open Trip" : "Create Trip"}
                          </button>
                          <button type="button" onClick={() => openEdit(booking)} className="booking-entry-edit" aria-label={copy.editBooking}>
                            <Edit3 className="h-3.5 w-3.5" />
                            {copy.edit}
                          </button>
                          <button type="button" onClick={() => openDuplicate(booking)} className="booking-entry-edit" aria-label={copy.duplicate}>
                            <Copy className="h-3.5 w-3.5" />
                            {copy.duplicate}
                          </button>
                          <button type="button" onClick={() => setDeleteTarget(booking)} className="booking-card-delete" aria-label={copy.deleteBooking}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                        ))}
                      </div>
                    ) : null}
                  </section>
                );
              })}
            </div>

            <div className="hidden">
              {paginatedBookings.map((booking) => (
                <details
                  key={booking.id}
                  className="booking-ledger-entry"
                >
                  <summary className="booking-ledger-summary">
                    <div className="min-w-0">
                      <div className="booking-ledger-route">
                        <span>{booking.pickup}</span>
                        <span className="booking-ledger-arrow">-&gt;</span>
                        <span>{booking.dropoff}</span>
                      </div>
                      <div className="booking-ledger-row">
                        <span><Truck className="booking-ledger-icon" />{booking.vehicle || "-"}</span>
                        <span><UserRound className="booking-ledger-icon" />{booking.driver || "-"}</span>
                      </div>
                      <div className="booking-ledger-load">
                        <span>{copy.amountPallets}: <strong>{booking.amount_pallets || "-"}</strong></span>
                        <span>{copy.weight}: <strong>{booking.weight || "-"}</strong></span>
                      </div>
                    </div>
                    <div className="booking-ledger-right">
                      <span>{formatTime(booking.updated_at, language)}</span>
                      <span aria-label={copy.tapToEdit}>
                        <Edit3 className="h-3 w-3" />
                      </span>
                    </div>
                  </summary>
                  <div className="booking-ledger-extra">
                    <p><span>{copy.date}</span>{formatDate(booking.booking_date, language)}</p>
                    <p><span>{copy.dimensions}</span>{booking.dimensions || "-"}</p>
                    <p><span>{copy.warehouseNo}</span>{booking.warehouse_no || "-"}</p>
                    <p><span>{copy.notes}</span>{booking.notes || "-"}</p>
                  </div>

                  <div className="booking-ledger-bottom">
                    <p><Clock3 className="booking-ledger-icon" />{booking.modified_by || "-"} • {formatTime(booking.updated_at, language)}</p>
                    <div className="booking-ledger-actions">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          openEdit(booking);
                        }}
                        className="booking-entry-edit"
                        aria-label={copy.editBooking}
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                        {copy.tapToEdit}
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setDeleteTarget(booking);
                        }}
                        className="booking-card-delete"
                        aria-label={copy.deleteBooking}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </details>
              ))}
            </div>

            <div className="hidden">
              {paginatedBookings.map((booking) => (
                <article
                  key={booking.id}
                  className="booking-mobile-card booking-entry"
                  role="button"
                  tabIndex={0}
                  onClick={() => openEdit(booking)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      openEdit(booking);
                    }
                  }}
                >
                  <div className="booking-entry-top">
                    <div className="min-w-0">
                      <p className="booking-entry-date">
                        <CalendarDays className="booking-card-icon text-brand-600" />
                        {formatDate(booking.booking_date, language)}
                      </p>
                    </div>
                    <p className="booking-entry-status">{copy.updatedLabel} {formatTime(booking.updated_at, language)}</p>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        openEdit(booking);
                      }}
                      className="booking-entry-edit"
                      aria-label={copy.editBooking}
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                      {copy.tapToEdit}
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setDeleteTarget(booking);
                      }}
                      className="booking-card-delete"
                      aria-label={copy.deleteBooking}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      openEdit(booking);
                    }}
                    className="booking-entry-main"
                  >
                  <div className="booking-entry-route">
                    <span>{booking.pickup}</span>
                    <span className="booking-entry-arrow">→</span>
                    <span>{booking.dropoff}</span>
                  </div>
                  <div className="booking-entry-assignment">
                    <span><Truck className="booking-card-icon" />{booking.vehicle || "-"}</span>
                    <span><UserRound className="booking-card-icon" />{booking.driver || "-"}</span>
                  </div>
                  <div className="booking-card-measurements booking-entry-load">
                    <p><span>{booking.amount_pallets || "-"}</span>{copy.amountPallets}</p>
                    <p><span>{booking.weight || "-"}</span>{copy.weight}</p>
                    <p><span>{booking.dimensions || "-"}</span>{copy.dimensions}</p>
                  </div>
                  <div className="booking-card-route booking-entry-extra">
                    <p><MapPin className="booking-card-icon text-brand-600" /> <span>{booking.pickup}</span></p>
                    <p className="booking-card-warehouse">{copy.warehouseNo}: {booking.warehouse_no || "-"}</p>
                    <p><MapPin className="booking-card-icon text-orange-500" /> <span>{booking.dropoff}</span></p>
                  </div>
                  <div className="booking-card-meta">
                    <p><Truck className="booking-card-icon" />{booking.vehicle || "-"}</p>
                    <p><UserRound className="booking-card-icon" />{booking.driver || "-"}</p>
                    {booking.notes ? <p className="col-span-2 truncate">{copy.notes}: {booking.notes}</p> : null}
                    <p className="col-span-2"><Clock3 className="booking-card-icon" />{booking.modified_by || "-"} · {formatTime(booking.updated_at, language)}</p>
                  </div>
                  </button>
                </article>
              ))}
            </div>

            <div className="table-shell booking-desktop-table hidden md:block">
              <div className="table-scroll">
                <table className="min-w-[980px]">
                  <thead>
                    <tr>
                      {[copy.date, copy.pickupTime, copy.route, copy.estimatedDistance, copy.vehicle, copy.driver, copy.load, copy.warehouseNo, copy.notes, "Trip", copy.actions].map((heading) => (
                        <th key={heading || "actions"} className="booking-desktop-head-cell">{heading}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedGroups.map(({ date, entries, totalEntries }) => {
                      const expanded = expandedDateKeys.has(date);

                      return (
                        <Fragment key={date}>
                        <tr className="booking-desktop-date-row">
                          <td colSpan={11}>
                            <button
                              type="button"
                              onClick={() => toggleDateSection(date)}
                              className={clsx("booking-desktop-date-heading", expanded && "booking-desktop-date-heading-open")}
                              aria-expanded={expanded}
                            >
                              <span className="booking-desktop-date-heading-main">
                                <span className="booking-date-chevron">
                                  <ChevronRight className={clsx("h-3.5 w-3.5 transition-transform duration-200", expanded && "rotate-90")} />
                                </span>
                                <span>{formatDateHeading(date, language)}</span>
                              </span>
                              <strong>{dateCounts.get(date) ?? totalEntries} {copy.entries}</strong>
                            </button>
                          </td>
                        </tr>
                        {expanded && entries.length ? entries.map((booking) => (
                          <tr key={booking.id} className="enterprise-table-row cursor-pointer" onClick={() => openEdit(booking)}>
                            <td className="booking-desktop-cell whitespace-nowrap font-semibold text-slate-950">{formatDate(booking.booking_date, language)}</td>
                            <td className="booking-desktop-cell whitespace-nowrap"><span className="booking-desktop-time">{formatPickupTime(booking.pickup_time) || "-"}</span></td>
                            <td className="booking-desktop-cell max-w-[280px] font-semibold text-slate-900" title={`${booking.pickup} -> ${booking.dropoff}`}><span className="block truncate">{booking.pickup} <span className="text-brand-600">-&gt;</span> {booking.dropoff}</span></td>
                            <td className="booking-desktop-cell whitespace-nowrap">
                              <span className={clsx(
                                "inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold",
                                booking.estimated_distance_km ? "border-indigo-100 bg-indigo-50 text-indigo-700" : "border-slate-200 bg-slate-50 text-slate-500"
                              )}>
                                {formatDistanceKm(booking.estimated_distance_km) ?? copy.noEstimate}
                              </span>
                            </td>
                            <td className="booking-desktop-cell whitespace-nowrap"><span className="booking-desktop-vehicle">{booking.vehicle || "-"}</span></td>
                            <td className="booking-desktop-cell whitespace-nowrap"><span className="booking-desktop-driver">{booking.driver || "-"}</span></td>
                            <td className="booking-desktop-cell whitespace-nowrap">{booking.amount_pallets || "-"} PLT / {booking.weight ? `${booking.weight}kg` : "-"}</td>
                            <td className="booking-desktop-cell max-w-[130px]" title={booking.warehouse_no || ""}><span className="block truncate">{booking.warehouse_no || "-"}</span></td>
                            <td className="booking-desktop-cell max-w-[150px]" title={booking.notes || ""}><span className="block truncate">{booking.notes || "-"}</span></td>
                            <td className="booking-desktop-cell whitespace-nowrap">
                              <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${getBookingTripClass(booking)}`}>
                                {getBookingTripLabel(booking)}
                              </span>
                            </td>
                            <td className="booking-desktop-cell text-right">
                              <div className="flex flex-wrap justify-end gap-1.5">
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void createTripRecord(booking);
                                  }}
                                  className="table-action-secondary min-h-[36px] gap-1.5 px-2.5"
                                  aria-label={getTripForBooking(booking) ? "Open Trip" : "Create Trip"}
                                >
                                  <PackagePlus className="h-3.5 w-3.5" />
                                  {getTripForBooking(booking) ? "Open Trip" : "Create Trip"}
                                </button>
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    openEdit(booking);
                                  }}
                                  className="table-action-secondary min-h-[36px] gap-1.5 px-2.5"
                                  aria-label={copy.editBooking}
                                >
                                  <Edit3 className="h-3.5 w-3.5" />
                                  {copy.edit}
                                </button>
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    openDuplicate(booking);
                                  }}
                                  className="table-action-secondary min-h-[36px] gap-1.5 px-2.5"
                                  aria-label={copy.duplicate}
                                >
                                  <Copy className="h-3.5 w-3.5" />
                                  {copy.duplicate}
                                </button>
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setDeleteTarget(booking);
                                  }}
                                  className="table-action-danger min-h-[36px] gap-1.5 px-2.5"
                                  aria-label={copy.deleteBooking}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        )) : null}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="booking-pagination">
              <p>
                {visibleRangeText}
              </p>
              <div className="booking-pagination-controls">
                <button
                  type="button"
                  onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                  disabled={safeCurrentPage <= 1}
                  className="btn-secondary min-h-[38px] rounded-[0.75rem] px-3 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {copy.previous}
                </button>
                <span>
                  {copy.pageSummary
                    .replace("{page}", String(safeCurrentPage))
                    .replace("{pages}", String(totalPages))}
                </span>
                <button
                  type="button"
                  onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                  disabled={safeCurrentPage >= totalPages}
                  className="btn-secondary min-h-[38px] rounded-[0.75rem] px-3 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {copy.next}
                </button>
              </div>
            </div>
          </>
        )}
      </section>

      {!modalOpen && !deleteTarget ? (
        <button
          type="button"
          onClick={openCreate}
          className="booking-floating-add"
          aria-label={copy.addBooking}
        >
          <Plus className="h-[18px] w-[18px]" />
        </button>
      ) : null}

      {modalOpen ? (
        <div className="booking-modal-backdrop fixed inset-0 z-50 flex items-end justify-center bg-[rgba(26,16,46,0.32)] p-0 backdrop-blur-[6px] lg:items-center lg:p-6">
          <div className="booking-sheet max-h-[100dvh] w-full overflow-hidden rounded-t-[1.6rem] border border-brand-100 bg-white shadow-[0_30px_70px_rgba(38,18,78,0.24)] lg:max-h-[96vh] lg:max-w-3xl lg:rounded-[1.6rem]">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200/80 px-4 py-4 sm:px-5">
              <div className="min-w-0">
                <p className="badge-muted w-fit">{duplicatingBooking ? copy.createCopy : activeEditingId ? copy.editBooking : copy.addBooking}</p>
                <h3 className="mt-2 truncate text-lg font-semibold text-slate-950">{activeEditingId || duplicatingBooking ? formatDate(form.booking_date, language) : copy.addBooking}</h3>
              </div>
              <button type="button" onClick={closeModal} className="btn-secondary min-h-[42px] w-11 rounded-[1rem] px-0" aria-label={copy.close}>
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={submit} className="booking-sheet-form max-h-[calc(100dvh-88px)] overflow-y-auto px-4 py-4 sm:px-5 sm:py-5 lg:max-h-[calc(96vh-88px)]">
              <div className="booking-form-sections">
                <fieldset className="booking-form-section">
                  <legend>{copy.job}</legend>
                  <div className="booking-form-grid">
                    <LocationAutocomplete
                      label={copy.pickup}
                      required
                      value={form.pickup}
                      onChange={(value) => setField("pickup", value)}
                      onManualInput={setPickupText}
                      onSelectLocation={setPickupLocation}
                      selectedLocation={getStructuredLocation(form, "pickup")}
                      language={language}
                      configMissingMessage={copy.googleMapsUnavailable}
                      helperText="Type a place or enter the pickup manually."
                      placeholder={copy.pickup}
                    />
                    <LocationAutocomplete
                      label={copy.dropoff}
                      required
                      value={form.dropoff}
                      onChange={(value) => setField("dropoff", value)}
                      onManualInput={setDropoffText}
                      onSelectLocation={setDropoffLocation}
                      selectedLocation={getStructuredLocation(form, "dropoff")}
                      language={language}
                      configMissingMessage={copy.googleMapsUnavailable}
                      helperText="Type a place or enter the drop-off manually."
                      placeholder={copy.dropoff}
                    />
                    <div className="lg:col-span-4 rounded-[1rem] border border-slate-200 bg-slate-50/80 p-3">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                        <label className="form-field flex-1">
                          <span className="form-label">{copy.estimatedDistance}</span>
                          <input
                            inputMode="decimal"
                            value={form.estimated_distance_km}
                            onChange={(event) => setManualDistance(event.target.value)}
                            className={inputClass}
                            placeholder="0.0"
                          />
                        </label>
                        <label className="form-field flex-1">
                          <span className="form-label">{copy.estimatedTime}</span>
                          <input
                            inputMode="numeric"
                            value={form.estimated_duration_minutes}
                            onChange={(event) => setField("estimated_duration_minutes", event.target.value)}
                            className={inputClass}
                            placeholder="Minutes"
                          />
                        </label>
                        <div className="flex flex-wrap gap-2 sm:pb-0.5">
                          <button
                            type="button"
                            onClick={() => void calculateRouteDistance()}
                            disabled={routeCalculating}
                            className="btn-secondary min-h-[42px] gap-2 rounded-[0.9rem] px-3 text-xs disabled:opacity-60"
                          >
                            <RefreshCw className={clsx("h-3.5 w-3.5", routeCalculating && "animate-spin")} />
                            {routeCalculating ? copy.calculatingDistance : copy.calculateDistance}
                          </button>
                          {form.google_maps_route_url ? (
                            <a
                              href={form.google_maps_route_url}
                              target="_blank"
                              rel="noreferrer"
                              className="btn-secondary min-h-[42px] gap-2 rounded-[0.9rem] px-3 text-xs"
                            >
                              <MapPin className="h-3.5 w-3.5" />
                              {copy.openGoogleMaps}
                            </a>
                          ) : null}
                        </div>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-slate-500">
                        {routeMessage ?? copy.estimateHelper}
                      </p>
                    </div>
                    <label className="form-field lg:col-span-1">
                      <span className="form-label">{copy.pickupTime}</span>
                      <input type="time" value={form.pickup_time} onChange={(event) => setField("pickup_time", event.target.value)} className={inputClass} />
                    </label>
                    <label className="form-field lg:col-span-1">
                      <span className="form-label form-label-required">{copy.date}</span>
                      <input required type="date" value={form.booking_date} onChange={(event) => setField("booking_date", event.target.value)} className={inputClass} />
                    </label>
                  </div>
                </fieldset>

                <fieldset className="booking-form-section">
                  <legend>{copy.load}</legend>
                  <div className="booking-form-grid">
                    <label className="form-field lg:col-span-2">
                      <span className="form-label">{copy.vehicle}</span>
                      <input list="booking-vehicles" value={form.vehicle} onChange={(event) => setField("vehicle", event.target.value)} className={inputClass} placeholder={copy.vehicle} />
                      <datalist id="booking-vehicles">{vehicleOptions.map((vehicle) => <option key={vehicle} value={vehicle} />)}</datalist>
                    </label>
                    <label className="form-field lg:col-span-2">
                      <span className="form-label">{copy.driver}</span>
                      <input list="booking-drivers" value={form.driver} onChange={(event) => setField("driver", event.target.value)} className={inputClass} placeholder={copy.driver} />
                      <datalist id="booking-drivers">{driverOptions.map((driver) => <option key={driver} value={driver} />)}</datalist>
                    </label>
                    <label className="form-field lg:col-span-1">
                      <span className="form-label">{copy.amountPallets}</span>
                      <input inputMode="decimal" value={form.amount_pallets} onChange={(event) => setField("amount_pallets", event.target.value)} className={inputClass} placeholder="10" />
                    </label>
                    <label className="form-field lg:col-span-1">
                      <span className="form-label">{copy.weight}</span>
                      <input inputMode="decimal" value={form.weight} onChange={(event) => setField("weight", event.target.value)} className={inputClass} placeholder="100" />
                    </label>
                    <label className="form-field lg:col-span-2">
                      <span className="form-label">{copy.dimensions}</span>
                      <input value={form.dimensions} onChange={(event) => setField("dimensions", event.target.value)} className={inputClass} placeholder="L x W x H" />
                    </label>
                  </div>
                </fieldset>

                <fieldset className="booking-form-section">
                  <legend>{copy.notesStatus}</legend>
                  <div className="booking-form-grid">
                    <label className="form-field lg:col-span-2">
                      <span className="form-label">{copy.warehouseNo}</span>
                      <input value={form.warehouse_no} onChange={(event) => setField("warehouse_no", event.target.value)} className={inputClass} placeholder="WH / NO" />
                    </label>
                    <label className="form-field lg:col-span-4">
                      <span className="form-label">{copy.notes}</span>
                      <textarea value={form.notes} onChange={(event) => setField("notes", event.target.value)} className="form-textarea min-h-[86px] rounded-[0.9rem]" placeholder={copy.notes} />
                    </label>
                  </div>
                </fieldset>

                {activeEditingId ? (
                  <button
                    type="button"
                    onClick={() => {
                      const target = bookings.find((booking) => booking.id === activeEditingId);
                      if (target) {
                        setDeleteTarget(target);
                        setModalOpen(false);
                      }
                    }}
                    className="booking-delete-link"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {copy.deleteBooking}
                  </button>
                ) : null}
              </div>

              {error ? <p className="form-error mt-4">{error}</p> : null}

              <div className="booking-sheet-actions">
                <button type="button" onClick={closeModal} className="booking-action-button btn-secondary booking-cancel-action sm:w-auto">
                  {copy.cancel}
                </button>
                <button type="submit" disabled={saving} className="booking-action-button btn-primary gap-2 sm:w-auto disabled:opacity-70">
                  <Save className="h-4 w-4" />
                  {saving ? copy.saving : duplicatingBooking ? copy.saveDuplicatedBooking : activeEditingId ? copy.update : copy.save}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {deleteTarget ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(26,16,46,0.32)] p-0 backdrop-blur-[6px] lg:items-center lg:p-6">
          <div className="w-full rounded-t-[1.35rem] border border-rose-100 bg-white p-5 shadow-[0_30px_70px_rgba(38,18,78,0.22)] lg:max-w-md lg:rounded-[1.35rem]">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[1rem] border border-rose-100 bg-rose-50 text-rose-600">
                <Trash2 className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-slate-950">{copy.confirmDeleteTitle}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{copy.confirmDeleteText}</p>
              </div>
            </div>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={Boolean(deletingId)}
                className="btn-secondary min-h-[48px] rounded-[1rem] sm:w-auto"
              >
                {copy.cancel}
              </button>
              <button
                type="button"
                onClick={() => void confirmDelete()}
                disabled={Boolean(deletingId)}
                className="btn-danger min-h-[48px] rounded-[1rem] sm:w-auto disabled:opacity-70"
              >
                {deletingId ? copy.loading : copy.deleteBooking}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
