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
import { Fragment, type RefObject, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { BookingBusinessInsights } from "@/components/booking-business-insights";
import { ClientDirectoryDialog } from "@/components/client-directory-dialog";
import { ClientSelector } from "@/components/client-selector";
import { EmptyState } from "@/components/empty-state";
import { GoogleMapsLoader } from "@/components/google-maps-loader";
import { Header } from "@/components/header";
import { LocationAutocomplete, type StructuredLocation } from "@/components/location-autocomplete";
import type { GoogleMapsHealthStatus } from "@/lib/google-maps";
import {
  createClient,
  createTripJourneyFromBooking,
  deleteUnusedClient,
  deleteBookingDiaryEntry,
  fetchBookingDiaryEntries,
  fetchClientDeleteEligibility,
  fetchClients,
  fetchDrivers,
  fetchSavedLocations,
  fetchTripJourneysByBookingIds,
  fetchVehicles,
  saveBookingDiaryEntry,
  updateClient
} from "@/lib/data";
import { exportToXlsx } from "@/lib/export";
import { fetchJson } from "@/lib/http";
import { useLanguage } from "@/lib/language-provider";
import type { TrafficAwareRouteEstimate } from "@/lib/route-planning";
import {
  findExactSavedLocation,
  normalizeSavedLocationName,
  rankSavedLocations
} from "@/lib/saved-locations";
import { supabase } from "@/lib/supabase";
import { formatDate } from "@/lib/utils";
import { LOCATION_SUGGESTIONS } from "@/src/data/locations";
import type { BookingDiaryEntry, Client, Driver, SavedLocation, SavedLocationType, TripJourney, TripJourneyStatus, Vehicle } from "@/types/database";

const PAGE_SIZE = 50;

type BookingForm = {
  id: string;
  client_id: string;
  booking_date: string;
  pickup_time: string;
  amount_pallets: string;
  weight: string;
  dimensions: string;
  pickup: string;
  pickup_place_id: string;
  pickup_address: string;
  pickup_lat: string;
  pickup_lng: string;
  warehouse_no: string;
  dropoff: string;
  dropoff_place_id: string;
  dropoff_address: string;
  dropoff_lat: string;
  dropoff_lng: string;
  estimated_distance_km: string;
  estimated_duration_minutes: string;
  google_maps_route_url: string;
  distance_source: string;
  route_calculated_at: string;
  route_distance_meters: string;
  route_duration_seconds: string;
  route_static_duration_seconds: string;
  route_departure_time: string;
  route_preference: string;
  route_label: string;
  route_description: string;
  route_polyline: string;
  route_traffic_aware: boolean | null;
  route_source: string;
  route_fallback_info: Record<string, unknown> | null;
  vehicle: string;
  driver: string;
  notes: string;
  job_order_number: string;
};

type BookingSortKey =
  | "date_oldest"
  | "date_newest"
  | "recent_first"
  | "recent_last"
  | "pickup_earliest"
  | "pickup_latest";

type CurrentBookingUser = {
  id: string | null;
  name: string | null;
  isAdmin: boolean;
};

const todayKey = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());

const emptyForm = (): BookingForm => ({
  id: "",
  client_id: "",
  booking_date: todayKey(),
  pickup_time: "",
  amount_pallets: "",
  weight: "",
  dimensions: "",
  pickup: "",
  pickup_place_id: "",
  pickup_address: "",
  pickup_lat: "",
  pickup_lng: "",
  warehouse_no: "",
  dropoff: "",
  dropoff_place_id: "",
  dropoff_address: "",
  dropoff_lat: "",
  dropoff_lng: "",
  estimated_distance_km: "",
  estimated_duration_minutes: "",
  google_maps_route_url: "",
  distance_source: "",
  route_calculated_at: "",
  route_distance_meters: "",
  route_duration_seconds: "",
  route_static_duration_seconds: "",
  route_departure_time: "",
  route_preference: "",
  route_label: "",
  route_description: "",
  route_polyline: "",
  route_traffic_aware: null,
  route_source: "",
  route_fallback_info: null,
  vehicle: "",
  driver: "",
  notes: "",
  job_order_number: ""
});

const labels = {
  en: {
    title: "Booking Diary",
    description: "Fast daily booking capture for phone calls, dispatch handover, and live office updates.",
    dailyDiaryTab: "Daily diary",
    businessInsightsTab: "Business insights",
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
    searchPlaceholder: "Search client, pickup, dropoff, vehicle, driver, notes, job order",
    clientName: "Client name",
    clientSection: "Client",
    clientPlaceholder: "Search or select client",
    clientRequired: "Client name is required for new bookings.",
    clientNotRecorded: "Client not recorded",
    clientLegacyHelp: "This historical booking has no client recorded. Add one if known; other corrections can still be saved.",
    allClients: "All clients",
    inactiveClient: "Inactive client",
    clientCreated: "Client created and selected.",
    clientDeleted: "Client deleted successfully",
    clientDeletedReselect: "The selected client was deleted. Please select another client.",
    date: "Date",
    time: "Time",
    pickupTime: "Pickup time",
    pickup: "Pickup",
    dropoff: "Dropoff",
    pickupNameShownInDiary: "Pickup name shown in diary",
    pickupGoogleMapsLocation: "Pickup Google Maps location",
    dropoffNameShownInDiary: "Drop-off name shown in diary",
    dropoffGoogleMapsLocation: "Drop-off Google Maps location",
    displayName: "Display name",
    googleMapsLocation: "Google Maps location",
    displayNameHelper: "Display name is shown in Booking Diary.",
    googleMapsLocationHelper: "Google Maps location is used for distance and route calculation.",
    locationSplitHelper: "Display name is shown in Booking Diary. Google Maps location is used for distance and route calculation.",
    googleVerified: "Google verified",
    manualUnverified: "Manual/unverified",
    manualEntryStillAllowed: "Manual entry still allowed.",
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
    jobCompletionInvoicing: "Job completion / invoicing",
    jobOrderNumber: "Job Order Number",
    jobOrderNumberPlaceholder: "Enter job order number",
    jobOrderNumberHelper: "Optional — this can be added after the job is completed to help with invoicing.",
    jobOrderLabel: "Job Order",
    addedBy: "Added by",
    allUsers: "All users",
    creatorUnavailable: "Creator unavailable",
    routeEstimate: "Route estimate",
    estimateHelper: "Booking estimate is pickup to drop-off only. Trip Journey can add depot start later.",
    estimatedDistance: "Estimated distance",
    estimatedTime: "Estimated time",
    calculateDistance: "Calculate route",
    refreshRoute: "Refresh route",
    fastestRoute: "Fastest route",
    trafficAwareEstimate: "Traffic-aware estimate",
    googleRecommendedRoute: "Google recommended route",
    trafficDataUnavailable: "Traffic data unavailable",
    currentTrafficEstimate: "Current-traffic estimate",
    plannedTrafficEstimate: "Planned departure traffic",
    routeNeedsRefresh: "Route inputs changed. Refresh the traffic-aware estimate.",
    standardDriveWarning: "Standard driving route; truck restrictions are not checked.",
    calculated: "Calculated",
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

const locationLabelExtras = {
  en: {
    savedLocationApplied: "Saved location applied",
    previouslyUsedLocation: "Previously used location",
    changeGoogleMapsLocation: "Change Google Maps location",
    noSavedLocationFound: "No saved location found"
  },
  th: {
    savedLocationApplied: "ใช้สถานที่ที่บันทึกไว้แล้ว",
    previouslyUsedLocation: "สถานที่ที่เคยใช้",
    changeGoogleMapsLocation: "เปลี่ยนตำแหน่ง Google Maps",
    noSavedLocationFound: "ไม่พบสถานที่ที่บันทึกไว้",
    pickupNameShownInDiary: "ชื่อจุดรับที่แสดงในสมุดงาน",
    pickupGoogleMapsLocation: "ตำแหน่ง Google Maps จุดรับ",
    dropoffNameShownInDiary: "ชื่อจุดส่งที่แสดงในสมุดงาน",
    dropoffGoogleMapsLocation: "ตำแหน่ง Google Maps จุดส่ง",
    displayName: "ชื่อที่แสดง",
    googleMapsLocation: "ตำแหน่ง Google Maps",
    displayNameHelper: "ชื่อนี้จะแสดงใน Booking Diary",
    googleMapsLocationHelper: "ใช้ตำแหน่ง Google Maps สำหรับคำนวณระยะทางและเปิดเส้นทาง",
    locationSplitHelper: "ชื่อที่แสดงใช้ใน Booking Diary ส่วนตำแหน่ง Google Maps ใช้คำนวณระยะทางและเส้นทาง",
    googleVerified: "ยืนยันด้วย Google",
    manualUnverified: "กรอกเอง / ยังไม่ยืนยัน",
    manualEntryStillAllowed: "ยังสามารถกรอกเองได้"
  }
};

const jobOrderLabelExtras = {
  en: {},
  th: {
    searchPlaceholder: "ค้นหาต้นทาง ปลายทาง รถ คนขับ หมายเหตุ เลขใบงาน",
    jobCompletionInvoicing: "จบงาน / ออกใบแจ้งหนี้",
    jobOrderNumber: "เลขใบงาน",
    jobOrderNumberPlaceholder: "กรอกเลขใบงาน",
    jobOrderNumberHelper: "ไม่บังคับ - สามารถเพิ่มหลังจบงานเพื่อช่วยในการออกใบแจ้งหนี้",
    jobOrderLabel: "เลขใบงาน",
    addedBy: "เพิ่มโดย",
    allUsers: "ผู้ใช้ทั้งหมด",
    creatorUnavailable: "ไม่พบข้อมูลผู้เพิ่ม"
  }
};

const clientLabelExtras = {
  en: {},
  th: {
    clientName: "ชื่อลูกค้า",
    clientSection: "ลูกค้า",
    clientPlaceholder: "ค้นหาหรือเลือกลูกค้า",
    clientRequired: "กรุณาเลือกลูกค้าสำหรับงานจองใหม่",
    clientNotRecorded: "ไม่ได้บันทึกลูกค้า",
    clientLegacyHelp: "งานย้อนหลังนี้ไม่มีข้อมูลลูกค้า หากทราบสามารถเพิ่มได้ และยังบันทึกการแก้ไขอื่นได้ตามปกติ",
    allClients: "ลูกค้าทั้งหมด",
    inactiveClient: "ลูกค้าที่ไม่ได้ใช้งาน",
    clientCreated: "สร้างและเลือกลูกค้าแล้ว",
    clientDeleted: "ลบลูกค้าสำเร็จ",
    clientDeletedReselect: "ลูกค้าที่เลือกถูกลบแล้ว โปรดเลือกลูกค้ารายอื่น"
  }
};

function mapBookingToForm(booking: BookingDiaryEntry): BookingForm {
  return {
    id: booking.id,
    client_id: booking.client_id ?? "",
    booking_date: booking.booking_date,
    pickup_time: booking.pickup_time ?? "",
    amount_pallets: booking.amount_pallets != null ? String(booking.amount_pallets) : "",
    weight: booking.weight != null ? String(booking.weight) : "",
    dimensions: booking.dimensions ?? "",
    pickup: getDiaryDisplayName(booking.pickup, booking.pickup_address),
    pickup_place_id: booking.pickup_place_id ?? "",
    pickup_address: getGoogleAddressValue(booking.pickup_address, booking.pickup),
    pickup_lat: formatCoordinate(booking.pickup_lat),
    pickup_lng: formatCoordinate(booking.pickup_lng),
    warehouse_no: booking.warehouse_no ?? "",
    dropoff: getDiaryDisplayName(booking.dropoff, booking.dropoff_address),
    dropoff_place_id: booking.dropoff_place_id ?? "",
    dropoff_address: getGoogleAddressValue(booking.dropoff_address, booking.dropoff),
    dropoff_lat: formatCoordinate(booking.dropoff_lat),
    dropoff_lng: formatCoordinate(booking.dropoff_lng),
    estimated_distance_km: booking.estimated_distance_km != null ? String(booking.estimated_distance_km) : "",
    estimated_duration_minutes: booking.estimated_duration_minutes != null ? String(booking.estimated_duration_minutes) : "",
    google_maps_route_url: booking.google_maps_route_url ?? "",
    distance_source: booking.distance_source ?? "",
    route_calculated_at: booking.route_calculated_at ?? "",
    route_distance_meters: booking.route_distance_meters?.toString() ?? "",
    route_duration_seconds: booking.route_duration_seconds?.toString() ?? "",
    route_static_duration_seconds: booking.route_static_duration_seconds?.toString() ?? "",
    route_departure_time: booking.route_departure_time ?? "",
    route_preference: booking.route_preference ?? "",
    route_label: booking.route_label ?? "",
    route_description: booking.route_description ?? "",
    route_polyline: booking.route_polyline ?? "",
    route_traffic_aware: booking.route_traffic_aware ?? null,
    route_source: booking.route_source ?? "",
    route_fallback_info: booking.route_fallback_info ?? null,
    vehicle: booking.vehicle ?? "",
    driver: booking.driver ?? "",
    notes: booking.notes ?? "",
    job_order_number: booking.job_order_number ?? ""
  };
}

function clearBookingRouteSnapshot(form: BookingForm): BookingForm {
  return {
    ...form,
    estimated_distance_km: "",
    estimated_duration_minutes: "",
    google_maps_route_url: "",
    distance_source: "",
    route_calculated_at: "",
    route_distance_meters: "",
    route_duration_seconds: "",
    route_static_duration_seconds: "",
    route_departure_time: "",
    route_preference: "",
    route_label: "",
    route_description: "",
    route_polyline: "",
    route_traffic_aware: null,
    route_source: "",
    route_fallback_info: null
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

function formatCoordinate(value: number | string | null | undefined) {
  const numeric = typeof value === "number" ? value : value ? Number.parseFloat(String(value)) : null;
  return numeric != null && Number.isFinite(numeric) ? String(numeric) : "";
}

function normalizeLocationText(value: string | null | undefined) {
  return (value ?? "").trim();
}

function isLikelyGoogleAddress(value: string | null | undefined, googleAddress?: string | null) {
  const text = normalizeLocationText(value);
  const address = normalizeLocationText(googleAddress);
  if (!text) return false;
  if (address && text.toLocaleLowerCase() === address.toLocaleLowerCase()) return true;
  return text.length > 42 && (text.includes(",") || /\bThailand\b/i.test(text) || /\bTambon\b/i.test(text));
}

function getShortLocationName(value: string | null | undefined) {
  const text = normalizeLocationText(value);
  if (!text) return "";
  const [firstPart] = text.split(",");
  const cleaned = normalizeLocationText(firstPart);
  if (cleaned) return cleaned;
  return text.length > 42 ? text.slice(0, 42).trim() : text;
}

function getDiaryDisplayName(displayName: string | null | undefined, googleAddress?: string | null) {
  const display = normalizeLocationText(displayName);
  const google = normalizeLocationText(googleAddress);
  if (display && !isLikelyGoogleAddress(display, google)) return display;
  return getShortLocationName(display || google);
}

function getGoogleAddressValue(googleAddress: string | null | undefined, fallbackDisplayName?: string | null) {
  return normalizeLocationText(googleAddress) || normalizeLocationText(fallbackDisplayName);
}

function getBookingPickupDisplay(booking: Pick<BookingDiaryEntry, "pickup" | "pickup_address">) {
  return getDiaryDisplayName(booking.pickup, booking.pickup_address) || booking.pickup || "-";
}

function getBookingDropoffDisplay(booking: Pick<BookingDiaryEntry, "dropoff" | "dropoff_address">) {
  return getDiaryDisplayName(booking.dropoff, booking.dropoff_address) || booking.dropoff || "-";
}

function getAccountNameFromEmail(value: string | null | undefined) {
  if (!value) return "";
  const [localPart] = value.split("@");
  return localPart?.replace(/[._-]+/g, " ").trim() ?? "";
}

function getUserDisplayNameFromMetadata(user: { email?: string | null; user_metadata?: Record<string, unknown> } | null | undefined) {
  const metadata = user?.user_metadata;
  const fullName = typeof metadata?.full_name === "string" ? metadata.full_name.trim() : "";
  const name = typeof metadata?.name === "string" ? metadata.name.trim() : "";
  const email = typeof user?.email === "string" ? user.email.trim() : "";
  return fullName || name || getAccountNameFromEmail(email) || null;
}

function getCreatorDisplayName(booking: BookingDiaryEntry, currentUser: CurrentBookingUser | null) {
  if (booking.created_by_user_id && currentUser?.id === booking.created_by_user_id && currentUser.name) {
    return currentUser.name;
  }

  const snapshot = (booking.created_by ?? "").trim();
  if (!snapshot) return "";

  const nameWithEmail = snapshot.match(/^(.+?)\s*\([^@\s]+@[^)]+\)$/);
  if (nameWithEmail?.[1]?.trim()) return nameWithEmail[1].trim();

  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(snapshot)) {
    return getAccountNameFromEmail(snapshot);
  }

  return snapshot;
}

function getCoordinateText(lat: string, lng: string) {
  const latitude = parseNumericInput(lat);
  const longitude = parseNumericInput(lng);
  return latitude != null && longitude != null ? `${latitude},${longitude}` : "";
}

function getRouteInput(form: BookingForm, type: "pickup" | "dropoff") {
  const displayName = type === "pickup" ? form.pickup.trim() : form.dropoff.trim();
  const googleAddress = type === "pickup" ? form.pickup_address.trim() : form.dropoff_address.trim();
  const coordinates =
    type === "pickup"
      ? getCoordinateText(form.pickup_lat, form.pickup_lng)
      : getCoordinateText(form.dropoff_lat, form.dropoff_lng);
  return coordinates || googleAddress || displayName;
}

function hasVerifiedGoogleLocation(booking: Pick<BookingDiaryEntry, "pickup_place_id" | "dropoff_place_id" | "pickup_lat" | "pickup_lng" | "dropoff_lat" | "dropoff_lng">) {
  const hasPickupCoordinates = booking.pickup_lat != null && booking.pickup_lng != null;
  const hasDropoffCoordinates = booking.dropoff_lat != null && booking.dropoff_lng != null;
  return Boolean(
    (booking.pickup_place_id || hasPickupCoordinates) &&
      (booking.dropoff_place_id || hasDropoffCoordinates)
  );
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
  const lat = parseNumericInput(type === "pickup" ? form.pickup_lat : form.dropoff_lat);
  const lng = parseNumericInput(type === "pickup" ? form.pickup_lng : form.dropoff_lng);
  if (!label.trim() && !formattedAddress.trim()) return null;

  return {
    label: label || formattedAddress,
    formatted_address: formattedAddress || label,
    place_id: placeId || null,
    lat: lat ?? Number.NaN,
    lng: lng ?? Number.NaN,
    manual_text: placeId ? undefined : formattedAddress || label,
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

type LocationNameOption = {
  value: string;
  savedLocation: SavedLocation | null;
};

const routeLabelExtras = {
  en: {},
  th: {
    calculateDistance: "คำนวณเส้นทาง",
    refreshRoute: "รีเฟรชเส้นทาง",
    fastestRoute: "เส้นทางที่เร็วที่สุด",
    trafficAwareEstimate: "ประมาณการตามสภาพการจราจร",
    googleRecommendedRoute: "เส้นทางที่ Google แนะนำ",
    trafficDataUnavailable: "ไม่มีข้อมูลการจราจร",
    currentTrafficEstimate: "ประมาณการจากการจราจรปัจจุบัน",
    plannedTrafficEstimate: "การจราจรตามเวลาออกเดินทาง",
    routeNeedsRefresh: "ข้อมูลเส้นทางเปลี่ยนแล้ว โปรดรีเฟรชประมาณการการจราจร",
    standardDriveWarning: "เส้นทางขับรถมาตรฐาน ไม่ได้ตรวจข้อจำกัดรถบรรทุก",
    calculated: "คำนวณแล้ว"
  }
};

function buildLocationNameOptions(
  savedLocations: SavedLocation[],
  locationType: SavedLocationType,
  fallbackNames: Array<string | null | undefined>
) {
  const seen = new Set<string>();
  const options: LocationNameOption[] = [];

  rankSavedLocations(savedLocations, locationType).forEach((savedLocation) => {
    seen.add(savedLocation.normalized_name);
    options.push({ value: savedLocation.display_name, savedLocation });
  });

  uniqueSorted(fallbackNames).forEach((value) => {
    const normalizedName = normalizeSavedLocationName(value);
    if (!normalizedName || seen.has(normalizedName)) return;
    seen.add(normalizedName);
    options.push({ value, savedLocation: null });
  });

  return options;
}

type LocationComboboxProps = {
  value: string;
  onChange: (value: string) => void;
  onSelectOption?: (option: LocationNameOption) => void;
  options: LocationNameOption[];
  placeholder: string;
  className: string;
  savedLabel: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  required?: boolean;
};

function LocationCombobox({
  value,
  onChange,
  onSelectOption,
  options,
  placeholder,
  className,
  savedLabel,
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
      .filter((option) => option.value.toLocaleLowerCase().includes(normalizedQuery))
      .slice(0, 10);
  }, [normalizedQuery, options]);

  const selectOption = (option: LocationNameOption) => {
    onChange(option.value);
    onSelectOption?.(option);
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
              key={`${option.savedLocation?.location_type ?? "other"}:${normalizeSavedLocationName(option.value)}`}
              id={`${listboxId}-${index}`}
              type="button"
              role="option"
              aria-selected={activeIndex === index}
              onMouseEnter={() => setActiveIndex(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectOption(option)}
              className={clsx(
                "flex w-full items-center justify-between gap-3 rounded-[0.65rem] px-3 py-2 text-left text-[13px] font-medium text-slate-700 transition",
                activeIndex === index ? "bg-slate-100 text-slate-950" : "hover:bg-slate-50"
              )}
            >
              <span className="truncate">{highlightMatch(option.value, value)}</span>
              {option.savedLocation ? (
                <span className="shrink-0 rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-bold text-brand-700">
                  {savedLabel}
                </span>
              ) : null}
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
  const copy = useMemo(
    () => ({
      ...labels.en,
      ...labels[languageKey],
      ...labelExtras[languageKey],
      ...locationLabelExtras[languageKey],
      ...routeLabelExtras[languageKey],
      ...jobOrderLabelExtras[languageKey],
      ...clientLabelExtras[languageKey]
    }),
    [languageKey]
  );
  const firstInputRef = useRef<HTMLInputElement | null>(null);
  const [bookings, setBookings] = useState<BookingDiaryEntry[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [savedLocations, setSavedLocations] = useState<SavedLocation[]>([]);
  const [tripsByBookingId, setTripsByBookingId] = useState<Map<string, TripJourney>>(() => new Map());
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [form, setForm] = useState<BookingForm>(() => emptyForm());
  const [activeTab, setActiveTab] = useState<"daily" | "insights">("daily");
  const [modalOpen, setModalOpen] = useState(false);
  const [quickFilter, setQuickFilter] = useState<"today" | "week" | "all">("today");
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [pickupFilter, setPickupFilter] = useState("");
  const [dropoffFilter, setDropoffFilter] = useState("");
  const [vehicleFilter, setVehicleFilter] = useState("");
  const [driverFilter, setDriverFilter] = useState("");
  const [creatorFilter, setCreatorFilter] = useState("");
  const [clientFilter, setClientFilter] = useState("");
  const [sortBy, setSortBy] = useState<BookingSortKey>("date_newest");
  const [currentUser, setCurrentUser] = useState<CurrentBookingUser | null>(null);
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
  const [savedLocationApplied, setSavedLocationApplied] = useState({ pickup: false, dropoff: false });
  const [googleMapsStatus, setGoogleMapsStatus] = useState<GoogleMapsHealthStatus | null>(null);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [clientManagerOpen, setClientManagerOpen] = useState(false);
  const [clientDeleteEligibility, setClientDeleteEligibility] = useState<Awaited<ReturnType<typeof fetchClientDeleteEligibility>>>(() => new Map());
  const [clientEligibilityLoading, setClientEligibilityLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [expandedDateKeys, setExpandedDateKeys] = useState<Set<string>>(() => new Set([todayKey()]));
  const [toggledDateKeys, setToggledDateKeys] = useState<Set<string>>(() => new Set());
  const autoAppliedLocationRef = useRef<{ pickup: string | null; dropoff: string | null }>({ pickup: null, dropoff: null });
  const initialLocationNameRef = useRef({ pickup: "", dropoff: "" });
  const savedLookupRequestRef = useRef({ pickup: 0, dropoff: 0 });
  const manualLocationEditRef = useRef({ pickup: false, dropoff: false });
  const automaticRouteInputRef = useRef<string | null>(null);

  const load = useCallback(async (blocking = false) => {
    try {
      if (blocking) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      setError(null);
      const [bookingRows, clientRows, savedLocationRows, driverRows, vehicleRows] = await Promise.all([
        fetchBookingDiaryEntries(),
        fetchClients(),
        fetchSavedLocations(),
        fetchDrivers(),
        fetchVehicles()
      ]);
      const tripRows = await fetchTripJourneysByBookingIds(bookingRows.map((booking) => booking.id)).catch((tripError) => {
        console.warn("Booking diary trip status unavailable:", tripError);
        return [] as TripJourney[];
      });
      setBookings(bookingRows);
      setClients(clientRows);
      setSavedLocations(savedLocationRows);
      setTripsByBookingId(new Map(tripRows.filter((trip) => trip.booking_diary_id).map((trip) => [String(trip.booking_diary_id), trip])));
      setDrivers(driverRows);
      setVehicles(vehicleRows);
    } catch (err) {
      console.error("Booking diary load error:", err);
      setError(err instanceof Error && err.message ? err.message : copy.loadError);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [copy.loadError]);

  useEffect(() => {
    void load(true);
  }, [load]);

  useEffect(() => {
    const syncCurrentUser = () => {
      void supabase.auth.getUser().then(({ data }) => {
        const user = data.user;
        setCurrentUser({
          id: user?.id ?? null,
          name: getUserDisplayNameFromMetadata(user ?? null),
          isAdmin:
            user?.email?.toLowerCase() === "joeryan09@outlook.com" ||
            String(user?.user_metadata?.role ?? user?.app_metadata?.role ?? "").toLowerCase() === "admin"
        });
      });
    };

    syncCurrentUser();
    window.addEventListener("fuel-bank:user-updated", syncCurrentUser);
    return () => window.removeEventListener("fuel-bank:user-updated", syncCurrentUser);
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel("booking-diary-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "booking_diary" }, () => {
        void load(false);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "clients" }, () => {
        void load(false);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "saved_locations" }, () => {
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

  const pickupOptions = useMemo(() => uniqueSorted(bookings.map(getBookingPickupDisplay)), [bookings]);
  const dropoffOptions = useMemo(() => uniqueSorted(bookings.map(getBookingDropoffDisplay)), [bookings]);
  const vehicleOptions = useMemo(
    () => uniqueSorted([...bookings.map((booking) => booking.vehicle), ...vehicles.map((vehicle) => vehicle.vehicle_reg)]),
    [bookings, vehicles]
  );
  const driverOptions = useMemo(
    () => uniqueSorted([...bookings.map((booking) => booking.driver), ...drivers.map((driver) => driver.name)]),
    [bookings, drivers]
  );
  const creatorOptions = useMemo(
    () => uniqueSorted(bookings.map((booking) => getCreatorDisplayName(booking, currentUser))),
    [bookings, currentUser]
  );
  const clientById = useMemo(() => new Map(clients.map((client) => [client.id, client])), [clients]);
  const bookingClientName = useCallback(
    (booking: BookingDiaryEntry) => clientById.get(booking.client_id ?? "")?.name ?? booking.client?.name ?? "",
    [clientById]
  );
  const clientFilterOptions = useMemo(
    () => [...clients].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name)),
    [clients]
  );
  const pickupLocationOptions = useMemo(
    () => buildLocationNameOptions(
      savedLocations,
      "pickup",
      [...LOCATION_SUGGESTIONS, ...bookings.map(getBookingPickupDisplay)]
    ),
    [bookings, savedLocations]
  );
  const dropoffLocationOptions = useMemo(
    () => buildLocationNameOptions(
      savedLocations,
      "dropoff",
      [...LOCATION_SUGGESTIONS, ...bookings.map(getBookingDropoffDisplay)]
    ),
    [bookings, savedLocations]
  );

  const applySavedLocation = useCallback((locationType: SavedLocationType, location: SavedLocation) => {
    savedLookupRequestRef.current[locationType] += 1;
    autoAppliedLocationRef.current[locationType] = location.normalized_name;
    manualLocationEditRef.current[locationType] = false;
    setRouteMessage(copy.routeNeedsRefresh);
    setSavedLocationApplied((current) => ({ ...current, [locationType]: true }));
    setForm((current) => {
      const cleared = clearBookingRouteSnapshot(current);
      return locationType === "pickup"
      ? {
          ...cleared,
          pickup: location.display_name,
          pickup_place_id: location.google_place_id ?? "",
          pickup_address: location.formatted_address,
          pickup_lat: location.latitude?.toString() ?? "",
          pickup_lng: location.longitude?.toString() ?? ""
        }
      : {
          ...cleared,
          dropoff: location.display_name,
          dropoff_place_id: location.google_place_id ?? "",
          dropoff_address: location.formatted_address,
          dropoff_lat: location.latitude?.toString() ?? "",
          dropoff_lng: location.longitude?.toString() ?? ""
        };
    });
  }, [copy.routeNeedsRefresh]);

  useEffect(() => {
    if (!modalOpen) return;
    const requestId = savedLookupRequestRef.current.pickup + 1;
    savedLookupRequestRef.current.pickup = requestId;
    const timeoutId = window.setTimeout(() => {
      if (savedLookupRequestRef.current.pickup !== requestId) return;
      const match = findExactSavedLocation(savedLocations, "pickup", form.pickup);
      if (!match) {
        setSavedLocationApplied((current) => ({ ...current, pickup: false }));
        return;
      }
      if (
        normalizeSavedLocationName(form.pickup) === initialLocationNameRef.current.pickup &&
        autoAppliedLocationRef.current.pickup === null
      ) return;
      if (manualLocationEditRef.current.pickup) return;
      if (
        form.pickup_place_id === (match.google_place_id ?? "") &&
        form.pickup_address === match.formatted_address &&
        form.pickup_lat === (match.latitude?.toString() ?? "") &&
        form.pickup_lng === (match.longitude?.toString() ?? "")
      ) return;
      applySavedLocation("pickup", match);
    }, 160);
    return () => window.clearTimeout(timeoutId);
  }, [
    applySavedLocation,
    form.pickup,
    form.pickup_address,
    form.pickup_lat,
    form.pickup_lng,
    form.pickup_place_id,
    modalOpen,
    savedLocations
  ]);

  useEffect(() => {
    if (!modalOpen) return;
    const requestId = savedLookupRequestRef.current.dropoff + 1;
    savedLookupRequestRef.current.dropoff = requestId;
    const timeoutId = window.setTimeout(() => {
      if (savedLookupRequestRef.current.dropoff !== requestId) return;
      const match = findExactSavedLocation(savedLocations, "dropoff", form.dropoff);
      if (!match) {
        setSavedLocationApplied((current) => ({ ...current, dropoff: false }));
        return;
      }
      if (
        normalizeSavedLocationName(form.dropoff) === initialLocationNameRef.current.dropoff &&
        autoAppliedLocationRef.current.dropoff === null
      ) return;
      if (manualLocationEditRef.current.dropoff) return;
      if (
        form.dropoff_place_id === (match.google_place_id ?? "") &&
        form.dropoff_address === match.formatted_address &&
        form.dropoff_lat === (match.latitude?.toString() ?? "") &&
        form.dropoff_lng === (match.longitude?.toString() ?? "")
      ) return;
      applySavedLocation("dropoff", match);
    }, 160);
    return () => window.clearTimeout(timeoutId);
  }, [
    applySavedLocation,
    form.dropoff,
    form.dropoff_address,
    form.dropoff_lat,
    form.dropoff_lng,
    form.dropoff_place_id,
    modalOpen,
    savedLocations
  ]);

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
          getBookingPickupDisplay(booking),
          getBookingDropoffDisplay(booking),
          booking.pickup_address,
          booking.dropoff_address,
          booking.vehicle,
          booking.driver,
          booking.warehouse_no,
          booking.job_order_number,
          bookingClientName(booking),
          getCreatorDisplayName(booking, currentUser),
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
        (!pickupFilter || getBookingPickupDisplay(booking) === pickupFilter) &&
        (!dropoffFilter || getBookingDropoffDisplay(booking) === dropoffFilter) &&
        (!vehicleFilter || booking.vehicle === vehicleFilter) &&
        (!driverFilter || booking.driver === driverFilter) &&
        (!clientFilter ||
          (clientFilter === "__missing__" ? !booking.client_id : booking.client_id === clientFilter)) &&
        (!creatorFilter || getCreatorDisplayName(booking, currentUser) === creatorFilter)
      );
    }).sort((a, b) => compareBookings(a, b, sortBy));
  }, [bookingClientName, bookings, clientFilter, creatorFilter, currentUser, dateFilter, driverFilter, dropoffFilter, pickupFilter, quickFilter, searchQuery, sortBy, vehicleFilter]);

  useEffect(() => {
    setCurrentPage(1);
  }, [clientFilter, creatorFilter, dateFilter, driverFilter, dropoffFilter, pickupFilter, quickFilter, searchQuery, sortBy, vehicleFilter]);

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
      clientFilter ||
      creatorFilter ||
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
    setClientFilter("");
    setCreatorFilter("");
    setQuickFilter("today");
    setSortBy("date_newest");
    setCurrentPage(1);
  };

  const resetSavedLocationTracking = (pickup = "", dropoff = "") => {
    savedLookupRequestRef.current.pickup += 1;
    savedLookupRequestRef.current.dropoff += 1;
    autoAppliedLocationRef.current = { pickup: null, dropoff: null };
    initialLocationNameRef.current = {
      pickup: normalizeSavedLocationName(pickup),
      dropoff: normalizeSavedLocationName(dropoff)
    };
    manualLocationEditRef.current = { pickup: false, dropoff: false };
    automaticRouteInputRef.current = null;
    setSavedLocationApplied({ pickup: false, dropoff: false });
  };

  const openCreate = () => {
    resetSavedLocationTracking();
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
    resetSavedLocationTracking(getBookingPickupDisplay(booking), getBookingDropoffDisplay(booking));
    setForm(mapBookingToForm(booking));
    setEditingBookingId(booking.id);
    setDuplicatingBooking(false);
    setError(null);
    setNotice(null);
    setRouteMessage(null);
    setModalOpen(true);
  };

  const openDuplicate = (booking: BookingDiaryEntry) => {
    resetSavedLocationTracking(getBookingPickupDisplay(booking), getBookingDropoffDisplay(booking));
    setForm({ ...mapBookingToForm(booking), id: "", job_order_number: "" });
    setEditingBookingId(null);
    setDuplicatingBooking(true);
    setError(null);
    setNotice(null);
    setRouteMessage(null);
    setModalOpen(true);
  };

  const getTripForBooking = (booking: BookingDiaryEntry) => tripsByBookingId.get(String(booking.id)) ?? null;
  const getTripStatusLabel = (status: TripJourneyStatus) => {
    if (status === "completed") return language === "th" ? "ทริปเสร็จสิ้น" : "Completed";
    if (status === "missing_mileage") return language === "th" ? "ขาดเลขไมล์" : "Mileage missing";
    if (status === "missing_estimated_distance") return language === "th" ? "ขาดระยะทางประมาณการ" : "Missing estimate";
    if (status === "missing_fuel") return language === "th" ? "ต้องตรวจสอบน้ำมัน" : "Fuel check needed";
    return language === "th" ? "สร้างทริปแล้ว" : "Trip created";
  };
  const getBookingTripLabel = (booking: BookingDiaryEntry) => {
    const trip = getTripForBooking(booking);
    if (!trip) return language === "th" ? "ยังไม่มีทริป" : "No trip record";
    return getTripStatusLabel(trip.status);
  };
  const getBookingTripClass = (booking: BookingDiaryEntry) => {
    const trip = getTripForBooking(booking);
    if (!trip) return "border-slate-200 bg-slate-50 text-slate-600";
    if (trip.status === "completed") return "border-emerald-200 bg-emerald-50 text-emerald-700";
    return "border-amber-200 bg-amber-50 text-amber-800";
  };
  const getTripButtonLabel = (booking: BookingDiaryEntry) =>
    getTripForBooking(booking)
      ? language === "th" ? "เปิดทริป" : "Open Trip"
      : language === "th" ? "สร้างทริป" : "Create Trip";

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

    const targetId = duplicatingBooking ? undefined : (editingBookingId ?? form.id.trim()) || undefined;
    const isNewBooking = !targetId;
    const selectedClient = clientById.get(form.client_id);
    if (isNewBooking && (!selectedClient || !selectedClient.active)) {
      setError(copy.clientRequired);
      return;
    }

    try {
      setSaving(true);
      setError(null);
      await saveBookingDiaryEntry({
        id: targetId,
        client_id: form.client_id || null,
        booking_date: form.booking_date,
        pickup_time: form.pickup_time,
        amount_pallets: form.amount_pallets,
        weight: form.weight,
        dimensions: form.dimensions,
        pickup: form.pickup,
        pickup_place_id: form.pickup_place_id,
        pickup_address: form.pickup_address,
        pickup_lat: form.pickup_lat,
        pickup_lng: form.pickup_lng,
        warehouse_no: form.warehouse_no,
        dropoff: form.dropoff,
        dropoff_place_id: form.dropoff_place_id,
        dropoff_address: form.dropoff_address,
        dropoff_lat: form.dropoff_lat,
        dropoff_lng: form.dropoff_lng,
        estimated_distance_km: form.estimated_distance_km,
        estimated_duration_minutes: form.estimated_duration_minutes,
        google_maps_route_url: form.google_maps_route_url,
        distance_source: form.distance_source,
        route_calculated_at: form.route_calculated_at,
        route_distance_meters: parseNumericInput(form.route_distance_meters),
        route_duration_seconds: parseNumericInput(form.route_duration_seconds),
        route_static_duration_seconds: parseNumericInput(form.route_static_duration_seconds),
        route_departure_time: form.route_departure_time,
        route_preference: form.route_preference,
        route_label: form.route_label,
        route_description: form.route_description,
        route_polyline: form.route_polyline,
        route_traffic_aware: form.route_traffic_aware,
        route_source: form.route_source,
        route_fallback_info: form.route_fallback_info,
        vehicle: form.vehicle,
        driver: form.driver,
        job_order_number: form.job_order_number,
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
    setForm((current) => {
      const routeInputChanged = field === "booking_date" || field === "pickup_time";
      if (routeInputChanged) setRouteMessage(copy.routeNeedsRefresh);
      return { ...(routeInputChanged ? clearBookingRouteSnapshot(current) : current), [field]: value };
    });
  };

  const handleCreateClient = async (name: string) => {
    const result = await createClient(name);
    setClients((current) => {
      const withoutClient = current.filter((client) => client.id !== result.client.id);
      return [...withoutClient, result.client].sort((a, b) => a.name.localeCompare(b.name));
    });
    if (result.created) setNotice(copy.clientCreated);
    return result.client;
  };

  const handleUpdateClient = async (id: string, payload: { name?: string; active?: boolean }) => {
    const updated = await updateClient(id, payload);
    setClients((current) => current.map((client) => client.id === id ? updated : client));
    setBookings((current) => current.map((booking) =>
      booking.client_id === id ? { ...booking, client: { id: updated.id, name: updated.name, active: updated.active } } : booking
    ));
  };

  const refreshClientDeleteEligibility = async () => {
    setClientEligibilityLoading(true);
    try {
      const eligibility = await fetchClientDeleteEligibility();
      setClientDeleteEligibility(eligibility);
      return eligibility;
    } finally {
      setClientEligibilityLoading(false);
    }
  };

  const openClientManager = () => {
    setClientManagerOpen(true);
    void refreshClientDeleteEligibility().catch((caught) => {
      console.error("Client delete eligibility error:", caught);
    });
  };

  const handleDeleteClient = async (id: string) => {
    try {
      await deleteUnusedClient(id);
      setClients((current) => current.filter((client) => client.id !== id));
      setClientDeleteEligibility((current) => {
        const next = new Map(current);
        next.delete(id);
        return next;
      });
      if (clientFilter === id) setClientFilter("");
      if (form.client_id === id) {
        setForm((current) => ({
          ...current,
          client_id: ""
        }));
        setError(copy.clientDeletedReselect);
      }
      setNotice(copy.clientDeleted);
    } catch (caught) {
      const [freshClients, freshEligibility] = await Promise.allSettled([
        fetchClients(),
        fetchClientDeleteEligibility()
      ]);
      if (freshClients.status === "fulfilled") setClients(freshClients.value);
      if (freshEligibility.status === "fulfilled") setClientDeleteEligibility(freshEligibility.value);
      throw caught;
    }
  };

  const clientBookingCounts = useMemo(() => {
    const counts = new Map<string, number>();
    bookings.forEach((booking) => {
      if (booking.client_id) counts.set(booking.client_id, (counts.get(booking.client_id) ?? 0) + 1);
    });
    return counts;
  }, [bookings]);

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
    savedLookupRequestRef.current.pickup += 1;
    if (normalizeSavedLocationName(value) !== autoAppliedLocationRef.current.pickup) {
      setSavedLocationApplied((current) => ({ ...current, pickup: false }));
    }
    setRouteMessage(null);
    setForm((current) => ({
      ...current,
      pickup: value
    }));
  };

  const setPickupGoogleText = (value: string) => {
    savedLookupRequestRef.current.pickup += 1;
    autoAppliedLocationRef.current.pickup = null;
    manualLocationEditRef.current.pickup = true;
    setSavedLocationApplied((current) => ({ ...current, pickup: false }));
    setRouteMessage(copy.routeNeedsRefresh);
    setForm((current) => ({
      ...clearBookingRouteSnapshot(current),
      pickup_place_id: "",
      pickup_address: value,
      pickup_lat: "",
      pickup_lng: ""
    }));
  };

  const setDropoffText = (value: string) => {
    savedLookupRequestRef.current.dropoff += 1;
    if (normalizeSavedLocationName(value) !== autoAppliedLocationRef.current.dropoff) {
      setSavedLocationApplied((current) => ({ ...current, dropoff: false }));
    }
    setRouteMessage(null);
    setForm((current) => ({
      ...current,
      dropoff: value
    }));
  };

  const setDropoffGoogleText = (value: string) => {
    savedLookupRequestRef.current.dropoff += 1;
    autoAppliedLocationRef.current.dropoff = null;
    manualLocationEditRef.current.dropoff = true;
    setSavedLocationApplied((current) => ({ ...current, dropoff: false }));
    setRouteMessage(copy.routeNeedsRefresh);
    setForm((current) => ({
      ...clearBookingRouteSnapshot(current),
      dropoff_place_id: "",
      dropoff_address: value,
      dropoff_lat: "",
      dropoff_lng: ""
    }));
  };

  const setPickupLocation = (location: StructuredLocation) => {
    savedLookupRequestRef.current.pickup += 1;
    autoAppliedLocationRef.current.pickup = null;
    manualLocationEditRef.current.pickup = true;
    setSavedLocationApplied((current) => ({ ...current, pickup: false }));
    setRouteMessage(copy.routeNeedsRefresh);
    setForm((current) => ({
      ...clearBookingRouteSnapshot(current),
      pickup: current.pickup.trim() || getShortLocationName(location.label || location.formatted_address),
      pickup_place_id: location.place_id ?? "",
      pickup_address: location.formatted_address || location.label,
      pickup_lat: Number.isFinite(location.lat) ? String(location.lat) : "",
      pickup_lng: Number.isFinite(location.lng) ? String(location.lng) : ""
    }));
  };

  const setDropoffLocation = (location: StructuredLocation) => {
    savedLookupRequestRef.current.dropoff += 1;
    autoAppliedLocationRef.current.dropoff = null;
    manualLocationEditRef.current.dropoff = true;
    setSavedLocationApplied((current) => ({ ...current, dropoff: false }));
    setRouteMessage(copy.routeNeedsRefresh);
    setForm((current) => ({
      ...clearBookingRouteSnapshot(current),
      dropoff: current.dropoff.trim() || getShortLocationName(location.label || location.formatted_address),
      dropoff_place_id: location.place_id ?? "",
      dropoff_address: location.formatted_address || location.label,
      dropoff_lat: Number.isFinite(location.lat) ? String(location.lat) : "",
      dropoff_lng: Number.isFinite(location.lng) ? String(location.lng) : ""
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
              origin: getRouteInput(current, "pickup"),
              destination: getRouteInput(current, "dropoff"),
              originPlaceId: current.pickup_place_id,
              destinationPlaceId: current.dropoff_place_id
            })
          : "");

      return {
        ...clearBookingRouteSnapshot(current),
        estimated_distance_km: value,
        distance_source: numericDistance != null && numericDistance > 0 ? "manual" : "",
        google_maps_route_url: routeUrl,
        route_calculated_at: numericDistance != null && numericDistance > 0 ? new Date().toISOString() : "",
        route_distance_meters: numericDistance != null && numericDistance > 0 ? String(numericDistance * 1000) : "",
        route_traffic_aware: false,
        route_source: numericDistance != null && numericDistance > 0 ? "manual" : ""
      };
    });
  };

  const calculateRouteDistance = useCallback(async () => {
    const pickup = getRouteInput(form, "pickup");
    const dropoff = getRouteInput(form, "dropoff");

    if (!pickup || !dropoff) {
      setRouteMessage(copy.distanceRequired);
      return;
    }

    try {
      setRouteCalculating(true);
      setRouteMessage(null);
      const result = await fetchJson<TrafficAwareRouteEstimate>("/api/distance-estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          origin: {
            label: form.pickup,
            formatted_address: pickup,
            place_id: form.pickup_place_id || null,
            lat: parseNumericInput(form.pickup_lat),
            lng: parseNumericInput(form.pickup_lng)
          },
          destination: {
            label: form.dropoff,
            formatted_address: dropoff,
            place_id: form.dropoff_place_id || null,
            lat: parseNumericInput(form.dropoff_lat),
            lng: parseNumericInput(form.dropoff_lng)
          },
          bookingDate: form.booking_date,
          pickupTime: form.pickup_time
        })
      });

      const estimate = result.data;
      const distanceMeters = Number(estimate?.distanceMeters);
      if (!estimate || !Number.isFinite(distanceMeters) || distanceMeters <= 0) {
        throw new Error(copy.googleMapsUnavailable);
      }

      const distanceKm = distanceMeters / 1000;
      const durationMinutes = estimate.durationSeconds
        ? Math.round(estimate.durationSeconds / 60)
        : null;
      const routeUrl = buildGoogleMapsRouteUrl({
        origin: pickup,
        destination: dropoff,
        originPlaceId: form.pickup_place_id,
        destinationPlaceId: form.dropoff_place_id
      });

      setForm((current) => ({
        ...current,
        pickup_address: current.pickup_address.trim() || current.pickup.trim(),
        dropoff_address: current.dropoff_address.trim() || current.dropoff.trim(),
        estimated_distance_km: distanceKm.toFixed(1),
        estimated_duration_minutes: durationMinutes != null ? String(durationMinutes) : current.estimated_duration_minutes,
        google_maps_route_url: routeUrl,
        distance_source: "google_maps",
        route_calculated_at: estimate.calculatedAt,
        route_distance_meters: String(estimate.distanceMeters),
        route_duration_seconds: estimate.durationSeconds?.toString() ?? "",
        route_static_duration_seconds: estimate.staticDurationSeconds?.toString() ?? "",
        route_departure_time: estimate.departureTime ?? "",
        route_preference: estimate.routePreference,
        route_label: estimate.routeLabel,
        route_description: estimate.routeDescription ?? "",
        route_polyline: estimate.encodedPolyline ?? "",
        route_traffic_aware: estimate.trafficAware,
        route_source: estimate.provider,
        route_fallback_info: estimate.fallbackInfo
      }));
      setRouteMessage(
        `${copy.calculated}: ${distanceKm.toFixed(1)} km${
          durationMinutes != null ? ` / ${formatDurationMinutes(durationMinutes)}` : ""
        } · ${estimate.trafficAware ? copy.trafficAwareEstimate : copy.trafficDataUnavailable}`
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
  }, [copy, form]);

  const automaticRouteInputKey = useMemo(
    () => JSON.stringify([
      form.pickup_place_id,
      form.pickup_address,
      form.pickup_lat,
      form.pickup_lng,
      form.dropoff_place_id,
      form.dropoff_address,
      form.dropoff_lat,
      form.dropoff_lng,
      form.booking_date,
      form.pickup_time
    ]),
    [
      form.booking_date,
      form.dropoff_address,
      form.dropoff_lat,
      form.dropoff_lng,
      form.dropoff_place_id,
      form.pickup_address,
      form.pickup_lat,
      form.pickup_lng,
      form.pickup_place_id,
      form.pickup_time
    ]
  );

  useEffect(() => {
    if (!modalOpen) return;
    if (automaticRouteInputRef.current === null) {
      automaticRouteInputRef.current = automaticRouteInputKey;
      return;
    }
    if (automaticRouteInputRef.current === automaticRouteInputKey) return;
    automaticRouteInputRef.current = automaticRouteInputKey;
    if (!getRouteInput(form, "pickup") || !getRouteInput(form, "dropoff")) return;

    const timeoutId = window.setTimeout(() => {
      void calculateRouteDistance();
    }, 900);
    return () => window.clearTimeout(timeoutId);
  }, [automaticRouteInputKey, calculateRouteDistance, form, modalOpen]);

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
        [copy.clientName]: bookingClientName(booking) || copy.clientNotRecorded,
        "Pickup Time": booking.pickup_time,
        "Amount / Pallets": booking.amount_pallets,
        Weight: booking.weight,
        Dimensions: booking.dimensions,
        "Pickup Display Name": getBookingPickupDisplay(booking),
        "Pickup Google Maps Address": booking.pickup_address,
        "Pickup Latitude": booking.pickup_lat,
        "Pickup Longitude": booking.pickup_lng,
        "Warehouse / NO": booking.warehouse_no,
        "Dropoff Display Name": getBookingDropoffDisplay(booking),
        "Dropoff Google Maps Address": booking.dropoff_address,
        "Dropoff Latitude": booking.dropoff_lat,
        "Dropoff Longitude": booking.dropoff_lng,
        "Estimated Distance KM": booking.estimated_distance_km,
        "Estimated Duration Minutes": booking.estimated_duration_minutes,
        "Google Maps Route": booking.google_maps_route_url,
        "Distance Source": booking.distance_source,
        Vehicle: booking.vehicle,
        Driver: booking.driver,
        "Job Order Number": booking.job_order_number,
        Notes: booking.notes,
        "Created By": getCreatorDisplayName(booking, currentUser) || copy.creatorUnavailable,
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
      <select value={clientFilter} onChange={(event) => setClientFilter(event.target.value)} className={`${compactInputClass} bg-white`} aria-label={copy.clientName}>
        <option value="">{copy.allClients}</option>
        <option value="__missing__">{copy.clientNotRecorded}</option>
        {clientFilterOptions.map((client) => <option key={client.id} value={client.id}>{client.name}{client.active ? "" : ` (${copy.inactiveClient})`}</option>)}
      </select>
      <select value={creatorFilter} onChange={(event) => setCreatorFilter(event.target.value)} className={`${compactInputClass} bg-white`} aria-label={copy.addedBy}>
        <option value="">{copy.allUsers}</option>
        {creatorOptions.map((creator) => <option key={creator} value={creator}>{creator}</option>)}
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
  const currentRouteUrl =
    getRouteInput(form, "pickup") && getRouteInput(form, "dropoff")
      ? buildGoogleMapsRouteUrl({
          origin: getRouteInput(form, "pickup"),
          destination: getRouteInput(form, "dropoff"),
          originPlaceId: form.pickup_place_id,
          destinationPlaceId: form.dropoff_place_id
        })
      : form.google_maps_route_url;
  const dailyDiaryTabLabel = language === "th" ? "สมุดงานประจำวัน" : copy.dailyDiaryTab;
  const businessInsightsTabLabel = language === "th" ? "ข้อมูลธุรกิจ" : copy.businessInsightsTab;
  const pickupShortLabel = language === "th" ? "รับของ" : "Pickup";
  const timeMissingLabel = language === "th" ? "รอยืนยัน" : "TBC";
  const tripJourneyColumnLabel = language === "th" ? "Trip Journey" : "Trip";
  const minutesPlaceholder = language === "th" ? "นาที" : "Minutes";

  return (
    <div className="booking-diary-page w-full max-w-full overflow-x-hidden">
      <GoogleMapsLoader onStatusChange={handleGoogleMapsStatusChange} />
      <div className="mb-4 hidden md:block">
        <Header title={copy.title} description={copy.description} />
      </div>
      {activeTab === "daily" ? <section className="booking-diary-header">
        <div className="booking-diary-title min-w-0 md:hidden">
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
      </section> : null}

      <nav className="booking-diary-tabs" aria-label={copy.title}>
        <button
          type="button"
          onClick={() => setActiveTab("daily")}
          className={clsx("booking-diary-tab", activeTab === "daily" && "booking-diary-tab-active")}
          aria-current={activeTab === "daily" ? "page" : undefined}
        >
          {dailyDiaryTabLabel}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("insights")}
          className={clsx("booking-diary-tab", activeTab === "insights" && "booking-diary-tab-active")}
          aria-current={activeTab === "insights" ? "page" : undefined}
        >
          {businessInsightsTabLabel}
        </button>
      </nav>

      {activeTab === "daily" ? (
      <>
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
          <div className="booking-filter-grid grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-[minmax(220px,1.4fr)_repeat(8,minmax(132px,1fr))]">
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
            <div className="booking-paper-diary lg:hidden">
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
                              <span className="booking-line-time-label">{pickupShortLabel}</span>
                              <span className={clsx("booking-line-time", !booking.pickup_time && "booking-line-time-empty")}>
                                {formatPickupTime(booking.pickup_time) || timeMissingLabel}
                              </span>
                            </span>
                            <span className="booking-line-route">{getBookingPickupDisplay(booking)} <span>-&gt;</span> {getBookingDropoffDisplay(booking)}</span>
                            <span className="mt-1 flex flex-wrap gap-1.5">
                              <span className={clsx("booking-client-badge", !booking.client_id && "is-missing")}>
                                {bookingClientName(booking) || copy.clientNotRecorded}
                              </span>
                              <span className="inline-flex w-fit rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                                {formatDistanceKm(booking.estimated_distance_km) ?? copy.noEstimate}
                              </span>
                              {formatDurationMinutes(booking.estimated_duration_minutes) ? (
                                <span className="inline-flex w-fit rounded-full border border-indigo-100 bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">
                                  {formatDurationMinutes(booking.estimated_duration_minutes)}
                                </span>
                              ) : null}
                              <span
                                className={clsx(
                                  "inline-flex w-fit rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                                  hasVerifiedGoogleLocation(booking)
                                    ? "border-emerald-100 bg-emerald-50 text-emerald-700"
                                    : "border-amber-100 bg-amber-50 text-amber-700"
                                )}
                                title={[booking.pickup_address, booking.dropoff_address].filter(Boolean).join(" -> ")}
                              >
                                {hasVerifiedGoogleLocation(booking) ? copy.googleVerified : copy.manualUnverified}
                              </span>
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
                          {(booking.warehouse_no || booking.job_order_number || booking.notes) ? (
                            <span className="booking-line-support">
                              {booking.warehouse_no ? <span>{copy.warehouseNo}: {booking.warehouse_no}</span> : null}
                              {booking.job_order_number ? <span>{copy.jobOrderLabel}: {booking.job_order_number}</span> : null}
                              {booking.notes ? <span>{copy.notes}: {booking.notes}</span> : null}
                            </span>
                          ) : null}
                          <span className="booking-line-support">
                            <span className="inline-flex items-center gap-1">
                              <UserRound className="h-3 w-3" />
                              {copy.addedBy} {getCreatorDisplayName(booking, currentUser) || copy.creatorUnavailable}
                            </span>
                          </span>
                        </button>
                        <div className="booking-line-actions">
                          <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${getBookingTripClass(booking)}`}>
                            {getBookingTripLabel(booking)}
                          </span>
                          <button
                            type="button"
                            onClick={() => void createTripRecord(booking)}
                            className="booking-entry-edit"
                            aria-label={getTripButtonLabel(booking)}
                          >
                            <PackagePlus className="h-3.5 w-3.5" />
                            {getTripButtonLabel(booking)}
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
                        <span>{getBookingPickupDisplay(booking)}</span>
                        <span className="booking-ledger-arrow">-&gt;</span>
                        <span>{getBookingDropoffDisplay(booking)}</span>
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
                    <p><span>{copy.addedBy}</span>{getCreatorDisplayName(booking, currentUser) || copy.creatorUnavailable}</p>
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
                    <span>{getBookingPickupDisplay(booking)}</span>
                    <span className="booking-entry-arrow">→</span>
                    <span>{getBookingDropoffDisplay(booking)}</span>
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
                    <p><MapPin className="booking-card-icon text-brand-600" /> <span>{getBookingPickupDisplay(booking)}</span></p>
                    <p className="booking-card-warehouse">{copy.warehouseNo}: {booking.warehouse_no || "-"}</p>
                    <p><MapPin className="booking-card-icon text-orange-500" /> <span>{getBookingDropoffDisplay(booking)}</span></p>
                  </div>
                  <div className="booking-card-meta">
                    <p><Truck className="booking-card-icon" />{booking.vehicle || "-"}</p>
                    <p><UserRound className="booking-card-icon" />{booking.driver || "-"}</p>
                    <p className="col-span-2"><UserRound className="booking-card-icon" />{copy.addedBy} {getCreatorDisplayName(booking, currentUser) || copy.creatorUnavailable}</p>
                    {booking.notes ? <p className="col-span-2 truncate">{copy.notes}: {booking.notes}</p> : null}
                    <p className="col-span-2"><Clock3 className="booking-card-icon" />{booking.modified_by || "-"} · {formatTime(booking.updated_at, language)}</p>
                  </div>
                  </button>
                </article>
              ))}
            </div>

            <div className="table-shell booking-desktop-table hidden lg:block">
              <div className="table-scroll">
                <table className="min-w-[980px]">
                  <thead>
                    <tr>
                      {[copy.date, copy.clientName, copy.pickupTime, copy.route, copy.estimatedDistance, copy.vehicle, copy.driver, copy.load, copy.warehouseNo, copy.notes, tripJourneyColumnLabel, copy.actions].map((heading) => (
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
                          <td colSpan={12}>
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
                            <td className="booking-desktop-cell whitespace-nowrap font-semibold text-slate-950">
                              <span className="block">{formatDate(booking.booking_date, language)}</span>
                              <span className="mt-1 inline-flex max-w-[150px] items-center gap-1 truncate text-[10px] font-medium text-slate-500">
                                <UserRound className="h-3 w-3 flex-shrink-0" />
                                {copy.addedBy} {getCreatorDisplayName(booking, currentUser) || copy.creatorUnavailable}
                              </span>
                            </td>
                            <td className="booking-desktop-cell max-w-[170px]">
                              <span className={clsx("booking-client-badge", !booking.client_id && "is-missing")}>
                                {bookingClientName(booking) || copy.clientNotRecorded}
                              </span>
                            </td>
                            <td className="booking-desktop-cell whitespace-nowrap"><span className="booking-desktop-time">{formatPickupTime(booking.pickup_time) || "-"}</span></td>
                            <td
                              className="booking-desktop-cell max-w-[280px] font-semibold text-slate-900"
                              title={[booking.pickup_address || booking.pickup, booking.dropoff_address || booking.dropoff].filter(Boolean).join(" -> ")}
                            >
                              <span className="block truncate">{getBookingPickupDisplay(booking)} <span className="text-brand-600">-&gt;</span> {getBookingDropoffDisplay(booking)}</span>
                              <span
                                className={clsx(
                                  "mt-1 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                                  hasVerifiedGoogleLocation(booking)
                                    ? "border-emerald-100 bg-emerald-50 text-emerald-700"
                                    : "border-amber-100 bg-amber-50 text-amber-700"
                                )}
                              >
                                {hasVerifiedGoogleLocation(booking) ? copy.googleVerified : copy.manualUnverified}
                              </span>
                            </td>
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
                            <td
                              className="booking-desktop-cell max-w-[170px]"
                              title={[booking.job_order_number ? `${copy.jobOrderLabel}: ${booking.job_order_number}` : "", booking.notes || ""].filter(Boolean).join(" | ")}
                            >
                              {booking.job_order_number ? (
                                <span className="mb-1 block truncate rounded-full border border-brand-100 bg-brand-50 px-2 py-0.5 text-[10px] font-semibold text-brand-700">
                                  {copy.jobOrderLabel}: {booking.job_order_number}
                                </span>
                              ) : null}
                              <span className="block truncate">{booking.notes || "-"}</span>
                            </td>
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
                                  aria-label={getTripButtonLabel(booking)}
                                >
                                  <PackagePlus className="h-3.5 w-3.5" />
                                  {getTripButtonLabel(booking)}
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
      </>
      ) : (
        <BookingBusinessInsights
          bookings={bookings}
          tripsByBookingId={tripsByBookingId}
          vehicles={vehicles}
          drivers={drivers}
          language={language}
          loading={loading}
          refreshing={refreshing}
          onRefresh={() => void load(false)}
        />
      )}

      {activeTab === "daily" && !modalOpen && !deleteTarget ? (
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
                  <legend>{copy.clientSection}</legend>
                  <ClientSelector
                    clients={clients}
                    selectedId={form.client_id}
                    onSelect={(clientId) => setField("client_id", clientId)}
                    onCreate={handleCreateClient}
                    onManage={openClientManager}
                    canManage={Boolean(currentUser?.isAdmin)}
                    required={duplicatingBooking || !activeEditingId}
                    language={languageKey}
                    inputRef={firstInputRef}
                    disabled={saving}
                  />
                  {activeEditingId && !form.client_id ? <p className="client-legacy-warning">{copy.clientLegacyHelp}</p> : null}
                </fieldset>
                <fieldset className="booking-form-section">
                  <legend>{copy.job}</legend>
                  <p className="mb-3 text-sm leading-5 text-slate-500">{copy.locationSplitHelper}</p>
                  <div className="booking-form-grid">
                    <div className="form-field md:col-span-2">
                      <label className="form-label form-label-required">{copy.pickupNameShownInDiary}</label>
                      <LocationCombobox
                        required
                        value={form.pickup}
                        onChange={setPickupText}
                        onSelectOption={(option) => {
                          if (option.savedLocation) applySavedLocation("pickup", option.savedLocation);
                        }}
                        options={pickupLocationOptions}
                        placeholder={copy.pickup}
                        className={inputClass}
                        savedLabel={copy.previouslyUsedLocation}
                      />
                      <p className="mt-2 text-sm text-slate-500">
                        {form.pickup.trim() && !findExactSavedLocation(savedLocations, "pickup", form.pickup)
                          ? copy.noSavedLocationFound
                          : copy.displayNameHelper}
                      </p>
                    </div>
                    <LocationAutocomplete
                      label={copy.pickupGoogleMapsLocation}
                      value={form.pickup_address}
                      onChange={setPickupGoogleText}
                      onManualInput={setPickupGoogleText}
                      onSelectLocation={setPickupLocation}
                      selectedLocation={getStructuredLocation(form, "pickup")}
                      savedLocationApplied={savedLocationApplied.pickup}
                      savedLocationAppliedText={copy.savedLocationApplied}
                      changeLocationText={copy.changeGoogleMapsLocation}
                      language={language}
                      configMissingMessage={copy.googleMapsUnavailable}
                      helperText={copy.googleMapsLocationHelper}
                      verifiedText={copy.googleVerified}
                      manualUnverifiedText={copy.manualUnverified}
                      manualEntryText={copy.manualEntryStillAllowed}
                      placeholder={copy.pickupGoogleMapsLocation}
                    />
                    <div className="form-field md:col-span-2">
                      <label className="form-label form-label-required">{copy.dropoffNameShownInDiary}</label>
                      <LocationCombobox
                        required
                        value={form.dropoff}
                        onChange={setDropoffText}
                        onSelectOption={(option) => {
                          if (option.savedLocation) applySavedLocation("dropoff", option.savedLocation);
                        }}
                        options={dropoffLocationOptions}
                        placeholder={copy.dropoff}
                        className={inputClass}
                        savedLabel={copy.previouslyUsedLocation}
                      />
                      <p className="mt-2 text-sm text-slate-500">
                        {form.dropoff.trim() && !findExactSavedLocation(savedLocations, "dropoff", form.dropoff)
                          ? copy.noSavedLocationFound
                          : copy.displayNameHelper}
                      </p>
                    </div>
                    <LocationAutocomplete
                      label={copy.dropoffGoogleMapsLocation}
                      value={form.dropoff_address}
                      onChange={setDropoffGoogleText}
                      onManualInput={setDropoffGoogleText}
                      onSelectLocation={setDropoffLocation}
                      selectedLocation={getStructuredLocation(form, "dropoff")}
                      savedLocationApplied={savedLocationApplied.dropoff}
                      savedLocationAppliedText={copy.savedLocationApplied}
                      changeLocationText={copy.changeGoogleMapsLocation}
                      language={language}
                      configMissingMessage={copy.googleMapsUnavailable}
                      helperText={copy.googleMapsLocationHelper}
                      verifiedText={copy.googleVerified}
                      manualUnverifiedText={copy.manualUnverified}
                      manualEntryText={copy.manualEntryStillAllowed}
                      placeholder={copy.dropoffGoogleMapsLocation}
                    />
                    <div className="lg:col-span-4 rounded-[1rem] border border-slate-200 bg-slate-50/80 p-3">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                        <label className="form-field flex-1">
                          <span className="form-label">{copy.fastestRoute}</span>
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
                            placeholder={minutesPlaceholder}
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
                            {routeCalculating ? copy.calculatingDistance : form.route_calculated_at ? copy.refreshRoute : copy.calculateDistance}
                          </button>
                          {currentRouteUrl ? (
                            <a
                              href={currentRouteUrl}
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
                      {form.route_calculated_at ? (
                        <div className="mt-2 flex flex-wrap gap-2 text-xs font-semibold">
                          <span className="rounded-full bg-emerald-50 px-2 py-1 text-emerald-700">
                            {form.route_label === "DEFAULT_ROUTE" ? copy.googleRecommendedRoute : copy.fastestRoute}
                          </span>
                          <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-600">
                            {form.route_departure_time ? copy.plannedTrafficEstimate : copy.currentTrafficEstimate}
                          </span>
                          {!form.route_traffic_aware ? (
                            <span className="rounded-full bg-amber-50 px-2 py-1 text-amber-800">{copy.trafficDataUnavailable}</span>
                          ) : null}
                        </div>
                      ) : null}
                      <p className="mt-2 text-xs text-slate-500">{copy.standardDriveWarning}</p>
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

                <fieldset className="booking-form-section">
                  <legend>{copy.jobCompletionInvoicing}</legend>
                  <div className="booking-form-grid">
                    <label className="form-field lg:col-span-2">
                      <span className="form-label">{copy.jobOrderNumber}</span>
                      <input
                        value={form.job_order_number}
                        onChange={(event) => setField("job_order_number", event.target.value)}
                        className={inputClass}
                        placeholder={copy.jobOrderNumberPlaceholder}
                      />
                      <span className="mt-2 block text-sm leading-5 text-slate-500">{copy.jobOrderNumberHelper}</span>
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

      {clientManagerOpen ? (
        <ClientDirectoryDialog
          clients={clients}
          bookingCounts={clientBookingCounts}
          deleteEligibility={clientDeleteEligibility}
          eligibilityLoading={clientEligibilityLoading}
          language={languageKey}
          onClose={() => setClientManagerOpen(false)}
          onUpdate={handleUpdateClient}
          onDelete={handleDeleteClient}
        />
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
