"use client";

import {
  CalendarClock,
  CheckCircle2,
  Download,
  FileText,
  Fuel,
  MapPinned,
  Package,
  Plus,
  Search,
  TimerReset,
  Truck,
  X,
  Wallet
} from "lucide-react";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { EmptyState } from "@/components/empty-state";
import { GoogleMapsLoader } from "@/components/google-maps-loader";
import { Header } from "@/components/header";
import { LocationAutocomplete } from "@/components/location-autocomplete";
import { StatCard } from "@/components/stat-card";
import {
  deleteShipment,
  fetchDrivers,
  fetchRouteDistanceEstimate,
  fetchShipments,
  saveRouteDistanceEstimate,
  saveShipment
} from "@/lib/data";
import { fetchJson } from "@/lib/http";
import { useLanguage } from "@/lib/language-provider";
import { shipmentTranslations, type ShipmentTranslations } from "@/lib/shipment-translations";
import { filterShipments } from "@/lib/shipment-estimation";
import { buildNormalizedShipmentRouteLabel, normalizeShipment } from "@/lib/shipment-normalization";
import {
  formatCurrency,
  formatDate,
  formatNumber,
  normalizeLocationKey,
  normalizeVehicleRegistration,
  today
} from "@/lib/utils";
import type { Driver, ShipmentWithDriver } from "@/types/database";

const PAGE_SIZE = 8;
const DEFAULT_KM_PER_LITRE = "3.5";
const DEFAULT_FUEL_PRICE = "32";
const EMPTY_VALUE = "—";
const STORAGE_KEYS = {
  kmPerLitre: "fuel-bank:shipments:last-km-per-litre",
  fuelPrice: "fuel-bank:shipments:last-fuel-price"
} as const;

const LEGACY_STATUS_OPTIONS = [
  { value: "Draft", label: { en: "Draft", th: "ฉบับร่าง" } },
  { value: "Quoted", label: { en: "Estimated", th: "ประเมินแล้ว" } },
  { value: "Assigned", label: { en: "Assigned", th: "มอบหมายแล้ว" } },
  { value: "Accepted", label: { en: "Approved", th: "อนุมัติแล้ว" } }
] as const;

const STATUS_OPTIONS = [
  { value: "Draft" },
  { value: "Quoted" },
  { value: "Confirmed" },
  { value: "In Progress" },
  { value: "Delivered" },
  { value: "Completed" },
  { value: "Cancelled" }
] as const;

type ShipmentStatus = (typeof STATUS_OPTIONS)[number]["value"];

type FormState = {
  id: string;
  job_reference: string;
  customer_name: string;
  goods_description: string;
  shipment_date: string;
  route_start_location: string;
  start_location: string;
  end_location: string;
  include_return_to_start: boolean;
  additional_dropoffs: string[];
  estimated_distance_km: string;
  estimated_duration_minutes: string;
  vehicle_type: string;
  standard_km_per_litre: string;
  fuel_price_per_litre: string;
  toll_estimate: string;
  parking_cost: string;
  driver_allowance: string;
  margin_percent: string;
  final_quote_price: string;
  weight: string;
  pallets: string;
  width: string;
  length: string;
  height: string;
  cargo_type: string;
  driver_id: string;
  vehicle_reg: string;
  notes: string;
  status: ShipmentStatus;
  cost_estimation_status: "ready" | "pending";
  cost_estimation_note: string;
};

function createInitialForm(
  defaultKmPerLitre = DEFAULT_KM_PER_LITRE,
  defaultFuelPrice = DEFAULT_FUEL_PRICE
): FormState {
  return {
    id: "",
    job_reference: "",
    customer_name: "",
    goods_description: "",
    shipment_date: today(),
    route_start_location: "",
    start_location: "",
    end_location: "",
    include_return_to_start: false,
    additional_dropoffs: [],
    estimated_distance_km: "",
    estimated_duration_minutes: "",
    vehicle_type: "",
    standard_km_per_litre: defaultKmPerLitre,
    fuel_price_per_litre: defaultFuelPrice,
    toll_estimate: "",
    parking_cost: "",
    driver_allowance: "",
    margin_percent: "",
    final_quote_price: "",
    weight: "",
    pallets: "",
    width: "",
    length: "",
    height: "",
    cargo_type: "",
    driver_id: "",
    vehicle_reg: "",
    notes: "",
    status: "Draft",
    cost_estimation_status: "pending",
    cost_estimation_note: ""
  };
}

const copy = {
  en: {
    title: "Shipments",
    description:
      "Fast route, fuel, and job-cost workflow built around Google Maps distance and simple transport job creation.",
    summaryHelper: "Based on the shipments shown below.",
    summaryEmptyJobs: "No shipment jobs yet",
    summaryEmptyDistance: "Estimate your first route",
    summaryEmptyFuel: "Fuel cost appears after route estimate",
    summaryEmptyCost: "Total job cost appears after costing",
    summaryEmptyActive: "No active jobs yet",
    summaryJobsHelper: "Live shipment count from real records.",
    summaryDistanceHelper: "Combined distance from saved jobs.",
    summaryFuelHelper: "Combined estimated fuel cost from saved jobs.",
    summaryCostHelper: "Combined estimated total job cost from saved jobs.",
    summaryActiveHelper: "Jobs today plus jobs still in progress.",
    totalJobs: "Total Jobs",
    totalDistance: "Total Distance",
    estimatedFuelCost: "Estimated Fuel Cost",
    estimatedJobCost: "Estimated Job Cost",
    jobsToday: "Jobs Today / Active",
    createJob: "Create Transport Job",
    updateJob: "Update Transport Job",
    routeTitle: "1. Route",
    routeDescription: "Enter pickup and drop-off, then estimate the route with Google Maps.",
    pickup: "Pickup location",
    dropoff: "Drop-off location",
    routeHint: "Use autocomplete when available, or type the full address manually.",
    estimateRoute: "Estimate Route",
    estimating: "Estimating...",
    routeSummary: "Route Summary",
    routeSummaryHint: "Distance and travel time update after route estimate.",
    distance: "Distance",
    duration: "Estimated travel time",
    distanceUnavailable: "Not estimated yet",
    durationUnavailable: "Not estimated yet",
    routeReady: "Route estimate ready.",
    routeChanged: "Locations changed. Estimate route again to refresh distance and cost.",
    routeKeyMissing: "Enter both pickup and drop-off before estimating the route.",
    estimateRequired: "Estimate the route before saving, or enter distance manually if Maps is unavailable.",
    manualDistance: "Manual distance (KM)",
    costTitle: "2. Cost",
    costDescription: "Fuel usage and job cost update live from the route distance.",
    kmPerLitre: "Truck efficiency (KM per litre)",
    fuelPrice: "Fuel price per litre",
    tolls: "Tolls",
    driverCost: "Driver / helper cost",
    fuelLitres: "Estimated fuel litres",
    fuelCost: "Fuel cost",
    totalCost: "Total Job Cost",
    totalRevenue: "Total Job Revenue",
    totalProfit: "Total Profit",
    defaultsHelper: "Last used KM/L and fuel price are pre-filled automatically.",
    jobDetailsTitle: "3. Job Details",
    jobDetailsDescription: "Keep only the basic details needed to create the job quickly.",
    shipmentRef: "Job reference",
    customer: "Customer / company",
    goods: "Job description",
    notes: "Notes",
    notesPlaceholder: "Optional delivery note or handling detail.",
    assignmentTitle: "4. Assignment",
    assignmentDescription: "Assign the driver and vehicle before saving.",
    driver: "Driver",
    selectDriver: "Select driver",
    vehicle: "Vehicle registration",
    saveShipment: "Save",
    saving: "Saving...",
    cancel: "Cancel",
    edit: "Edit",
    delete: "Delete",
    deleteConfirm: "Delete this shipment?",
    duplicateShipment: "This job reference already exists.",
    loadError: "Unable to load shipment data.",
    saveError: "Unable to save shipment.",
    deleteError: "Unable to delete shipment.",
    shipmentSaved: "Shipment saved successfully.",
    shipmentUpdated: "Shipment updated successfully.",
    autocompleteUnavailable: "Google Maps not configured - autocomplete unavailable",
    autocompleteHelper: "Start typing to search, or paste the full location manually.",
    loadingSuggestions: "Loading location suggestions...",
    tableTitle: "Shipment List",
    tableDescription: "Searchable transport jobs with clean route, assignment, and estimated cost visibility.",
    searchPlaceholder: "Search by ref, customer, route, driver, vehicle, or status",
    filterStatus: "Status",
    filterDriver: "Driver",
    filterVehicle: "Vehicle",
    filterFromDate: "From date",
    filterToDate: "To date",
    allStatuses: "All statuses",
    allDrivers: "All drivers",
    allVehicles: "All vehicles",
    resetFilters: "Reset filters",
    exportCsv: "Export CSV",
    loading: "Loading shipments...",
    noShipments: "No shipment jobs yet",
    noShipmentsDescription: "Create the first job by estimating a route, reviewing cost, assigning the driver, and saving.",
    costUnavailable: "Not calculated yet",
    page: "Page",
    of: "of",
    previous: "Previous",
    next: "Next",
    table: {
      ref: "Job Ref",
      date: "Date",
      customer: "Customer",
      route: "Route",
      distance: "Distance",
      driver: "Driver",
      vehicle: "Vehicle",
      cost: "Estimated Cost",
      quote: "Quote Price",
      profit: "Profit",
      status: "Status",
      action: "Action"
    }
  },
  th: {
    title: "งานขนส่ง",
    description:
      "เวิร์กโฟลว์งานขนส่งแบบรวดเร็วสำหรับคำนวณเส้นทาง น้ำมัน และต้นทุนงาน โดยคง Google Maps และการสร้างงานที่ใช้งานง่ายไว้",
    summaryHelper: "อ้างอิงจากรายการงานขนส่งด้านล่าง",
    summaryEmptyJobs: "ยังไม่มีงานขนส่ง",
    summaryEmptyDistance: "เริ่มจากประเมินเส้นทางแรก",
    summaryEmptyFuel: "ค่าน้ำมันจะแสดงหลังประเมินเส้นทาง",
    summaryEmptyCost: "ต้นทุนรวมจะแสดงหลังคำนวณต้นทุน",
    summaryEmptyActive: "ยังไม่มีงานที่กำลังดำเนินการ",
    summaryJobsHelper: "จำนวนงานจากข้อมูลจริง",
    summaryDistanceHelper: "ระยะทางรวมจากงานที่บันทึกไว้",
    summaryFuelHelper: "ค่าน้ำมันรวมจากงานที่บันทึกไว้",
    summaryCostHelper: "ต้นทุนรวมจากงานที่บันทึกไว้",
    summaryActiveHelper: "งานวันนี้รวมกับงานที่ยังไม่ปิด",
    totalJobs: "จำนวนงานทั้งหมด",
    totalDistance: "ระยะทางรวม",
    estimatedFuelCost: "ค่าน้ำมันประมาณการ",
    estimatedJobCost: "ต้นทุนงานประมาณการ",
    jobsToday: "งานวันนี้ / งานที่ยังเปิดอยู่",
    createJob: "สร้างงานขนส่ง",
    updateJob: "อัปเดตงานขนส่ง",
    routeTitle: "1. เส้นทาง",
    routeDescription: "กรอกจุดรับและจุดส่ง แล้วประเมินเส้นทางด้วย Google Maps",
    pickup: "จุดรับ",
    dropoff: "จุดส่ง",
    routeHint: "ใช้ autocomplete เมื่อพร้อมใช้งาน หรือพิมพ์ที่อยู่เต็มได้เอง",
    estimateRoute: "ประเมินเส้นทาง",
    estimating: "กำลังประเมิน...",
    routeSummary: "สรุปเส้นทาง",
    routeSummaryHint: "ระยะทางและเวลาเดินทางจะอัปเดตหลังประเมินเส้นทาง",
    distance: "ระยะทาง",
    duration: "เวลาเดินทางประมาณการ",
    distanceUnavailable: "ยังไม่ได้ประเมิน",
    durationUnavailable: "ยังไม่ได้ประเมิน",
    routeReady: "ประเมินเส้นทางเรียบร้อยแล้ว",
    routeChanged: "มีการเปลี่ยนจุดรับหรือจุดส่ง กรุณาประเมินเส้นทางอีกครั้งเพื่ออัปเดตต้นทุน",
    routeKeyMissing: "กรอกจุดรับและจุดส่งก่อนประเมินเส้นทาง",
    estimateRequired: "กรุณาประเมินเส้นทางก่อนบันทึก หรือกรอกระยะทางเองเมื่อ Google Maps ใช้งานไม่ได้",
    manualDistance: "ระยะทางเอง (กม.)",
    costTitle: "2. ต้นทุน",
    costDescription: "ปริมาณน้ำมันและต้นทุนงานจะคำนวณสดจากระยะทางที่ประเมินได้",
    kmPerLitre: "อัตราสิ้นเปลืองรถ (กม. / ลิตร)",
    fuelPrice: "ราคาน้ำมันต่อลิตร",
    tolls: "ค่าทางด่วน",
    driverCost: "ค่าแรงคนขับ / ผู้ช่วย",
    fuelLitres: "ปริมาณน้ำมันประมาณการ",
    fuelCost: "ค่าน้ำมัน",
    totalCost: "ต้นทุนงานรวม",
    defaultsHelper: "ระบบจะเติมค่า กม./ลิตร และราคาน้ำมันล่าสุดให้อัตโนมัติ",
    jobDetailsTitle: "3. รายละเอียดงาน",
    jobDetailsDescription: "เก็บเฉพาะข้อมูลพื้นฐานที่จำเป็นต่อการสร้างงานอย่างรวดเร็ว",
    shipmentRef: "เลขงาน",
    customer: "ลูกค้า / บริษัท",
    goods: "รายละเอียดงาน",
    notes: "หมายเหตุ",
    notesPlaceholder: "หมายเหตุเพิ่มเติมหรือข้อกำชับสำหรับงานนี้",
    assignmentTitle: "4. การมอบหมาย",
    assignmentDescription: "กำหนดคนขับและรถก่อนบันทึกงาน",
    driver: "คนขับ",
    selectDriver: "เลือกคนขับ",
    vehicle: "ทะเบียนรถ",
    saveShipment: "บันทึก",
    saving: "กำลังบันทึก...",
    cancel: "ยกเลิก",
    edit: "แก้ไข",
    delete: "ลบ",
    deleteConfirm: "ต้องการลบงานขนส่งนี้หรือไม่",
    duplicateShipment: "เลขงานนี้ถูกใช้งานแล้ว",
    loadError: "ไม่สามารถโหลดข้อมูลงานขนส่งได้",
    saveError: "ไม่สามารถบันทึกงานขนส่งได้",
    deleteError: "ไม่สามารถลบงานขนส่งได้",
    shipmentSaved: "บันทึกงานขนส่งเรียบร้อยแล้ว",
    shipmentUpdated: "อัปเดตงานขนส่งเรียบร้อยแล้ว",
    autocompleteUnavailable: "ยังไม่ได้ตั้งค่า Google Maps - autocomplete ใช้งานไม่ได้",
    autocompleteHelper: "เริ่มพิมพ์เพื่อค้นหา หรือวางที่อยู่เต็มได้โดยตรง",
    loadingSuggestions: "กำลังโหลดคำแนะนำสถานที่...",
    tableTitle: "รายการงานขนส่ง",
    tableDescription: "ค้นหาและติดตามงานขนส่งพร้อมเส้นทาง การมอบหมาย และต้นทุนประมาณการอย่างชัดเจน",
    searchPlaceholder: "ค้นหาจากเลขงาน ลูกค้า เส้นทาง คนขับ รถ หรือสถานะ",
    filterStatus: "สถานะ",
    filterDriver: "คนขับ",
    filterVehicle: "รถ",
    filterFromDate: "จากวันที่",
    filterToDate: "ถึงวันที่",
    allStatuses: "ทุกสถานะ",
    allDrivers: "คนขับทั้งหมด",
    allVehicles: "รถทั้งหมด",
    resetFilters: "ล้างตัวกรอง",
    loading: "กำลังโหลดงานขนส่ง...",
    noShipments: "ยังไม่มีงานขนส่ง",
    noShipmentsDescription: "เริ่มจากประเมินเส้นทาง ตรวจสอบต้นทุน มอบหมายคนขับ แล้วบันทึกงานแรก",
    costUnavailable: "ยังไม่คำนวณ",
    page: "หน้า",
    of: "จาก",
    previous: "ก่อนหน้า",
    next: "ถัดไป",
    table: {
      ref: "เลขงาน",
      date: "วันที่",
      customer: "ลูกค้า",
      route: "เส้นทาง",
      distance: "ระยะทาง",
      driver: "คนขับ",
      vehicle: "รถ",
      cost: "ต้นทุนประมาณการ",
      status: "สถานะ",
      action: "จัดการ"
    }
  }
} as const;

function SectionCard({
  title,
  description,
  children
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[1.4rem] border border-slate-200/80 bg-white p-3.5 shadow-[0_18px_40px_-34px_rgba(15,23,42,0.45)] sm:p-4">
      <div className="mb-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{title}</p>
        <p className="mt-1 text-sm text-slate-600">{description}</p>
      </div>
      {children}
    </section>
  );
}

function parseNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function getFuelEfficiencyHelperText(
  kmPerLitre: number | null,
  labels: ShipmentTranslations
) {
  if (kmPerLitre == null) {
    return labels.validation.fuelEfficiencyMissing;
  }

  if (kmPerLitre <= 0) {
    return labels.validation.fuelEfficiencyInvalid;
  }

  return labels.validation.fuelCalculationShort;
}

function formatInputNumber(value: number | null | undefined, digits = 2) {
  if (value == null || !Number.isFinite(value)) {
    return "";
  }

  return Number(value).toFixed(digits).replace(/\.00$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
}

function formatDistance(value: number | null | undefined, language: "en" | "th", fallback: string) {
  return value == null ? fallback : `${formatNumber(value, language, 1)} km`;
}

function formatDuration(minutes: number | null | undefined, language: "en" | "th", fallback: string) {
  if (minutes == null) return fallback;
  if (minutes < 60) return `${formatNumber(minutes, language, 0)} min`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return remaining ? `${hours}h ${formatNumber(remaining, language, 0)}m` : `${hours}h`;
}

function getStatusLabel(value: string | null | undefined, labels: ShipmentTranslations) {
  const fallback = labels.statusLabels.Draft;
  if (!value) {
    return fallback;
  }

  return labels.statusLabels[value as keyof typeof labels.statusLabels] ?? value;
}

function getStatusBadgeClass(status: string | null | undefined) {
  switch (status) {
    case "Confirmed":
      return "border-sky-200 bg-sky-50 text-sky-700";
    case "In Progress":
      return "border-indigo-200 bg-indigo-50 text-indigo-700";
    case "Delivered":
      return "border-teal-200 bg-teal-50 text-teal-700";
    case "Completed":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "Cancelled":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "Quoted":
      return "border-amber-200 bg-amber-50 text-amber-700";
    default:
      return "border-slate-200 bg-slate-100 text-slate-700";
  }
}

function getEstimatedJobCost(shipment: ShipmentWithDriver) {
  return normalizeShipment(shipment).operatingCost;
}

function getShipmentQuote(shipment: ShipmentWithDriver) {
  return normalizeShipment(shipment).quotePrice;
}

function getShipmentProfit(shipment: ShipmentWithDriver) {
  return normalizeShipment(shipment).profit;
}

function getShipmentMarginPercent(shipment: ShipmentWithDriver) {
  return normalizeShipment(shipment).marginPercent;
}

function getShipmentSaveErrorMessage(error: unknown, labels: ShipmentTranslations) {
  if (!(error instanceof Error)) {
    return labels.validation.saveUnknown;
  }

  switch (error.message) {
    case "DUPLICATE_SHIPMENT_REFERENCE":
      return labels.validation.saveDuplicate;
    case "SHIPMENT_REQUIRED_FIELDS_MISSING":
      return labels.validation.saveRequiredFieldsMissing;
    case "SHIPMENT_SCHEMA_MISMATCH":
      return labels.validation.saveSchemaMismatch;
    case "SHIPMENT_PERMISSION_DENIED":
      return labels.validation.savePermissionDenied;
    case "SHIPMENT_DRIVER_NOT_FOUND":
      return labels.validation.saveDriverNotFound;
    default:
      return error.message || labels.validation.saveUnknown;
  }
}

function shortenRouteLabel(startLocation: string, endLocation: string) {
  const shorten = (value: string) => {
    const cleaned = value.trim();
    if (!cleaned) return EMPTY_VALUE;
    const parts = cleaned.split(",").map((part) => part.trim()).filter(Boolean);
    const first = parts[0] || cleaned;
    return first.length > 28 ? `${first.slice(0, 28)}...` : first;
  };

  return `${shorten(startLocation)} -> ${shorten(endLocation)}`;
}

function buildFormRouteKey(input: {
  route_start_location: string;
  start_location: string;
  end_location: string;
  additional_dropoffs: string[];
  include_return_to_start: boolean;
}) {
  return [
    normalizeLocationKey(input.start_location),
    normalizeLocationKey(input.end_location),
    ...input.additional_dropoffs.map(normalizeLocationKey),
    normalizeLocationKey(input.route_start_location),
    input.include_return_to_start ? "return" : "oneway"
  ]
    .filter(Boolean)
    .join("__");
}

type QuotePdfData = {
  jobReference: string;
  customerName: string;
  shipmentDate: string;
  pickupLocation: string;
  dropoffLocation: string;
  additionalDropoffs: string[];
  routeSummary: string;
  distanceKm: number | null;
  durationMinutes: number | null;
  vehicleType: string;
  goodsDescription: string;
  weight: string;
  pallets: string;
  dimensions: string;
  fuelEfficiencyKmPerLitre: number | null;
  fuelPricePerLitre: number | null;
  estimatedFuelLitres: number | null;
  fuelCalculationBasis: string;
  fuelCost: number | null;
  driverCost: number | null;
  tolls: number | null;
  parkingCost: number | null;
  operatingCost: number | null;
  quotePrice: number | null;
  profit: number | null;
  marginPercent: number | null;
  status: string;
  notes: string;
};

type QuotePdfVariant = "internal" | "customer";

function escapeHtml(value: string | number | null | undefined) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatPdfCurrency(
  value: number | null | undefined,
  language: keyof typeof shipmentTranslations
) {
  if (value == null || !Number.isFinite(value)) return EMPTY_VALUE;
  return new Intl.NumberFormat(shipmentTranslations[language].pdf.locale, {
    style: "currency",
    currency: "THB",
    maximumFractionDigits: 2
  }).format(value);
}

function formatPdfNumber(
  value: number | null | undefined,
  language: keyof typeof shipmentTranslations,
  digits = 1
) {
  if (value == null || !Number.isFinite(value)) return EMPTY_VALUE;
  return new Intl.NumberFormat(shipmentTranslations[language].pdf.locale, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits
  }).format(value);
}

function toDateInputValue(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return "";
  }

  const isoDateMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoDateMatch) {
    return `${isoDateMatch[1]}-${isoDateMatch[2]}-${isoDateMatch[3]}`;
  }

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatPdfDate(value: string | null | undefined, language: keyof typeof shipmentTranslations) {
  const normalizedValue = toDateInputValue(value);
  if (!normalizedValue) {
    return EMPTY_VALUE;
  }

  return new Intl.DateTimeFormat(shipmentTranslations[language].pdf.locale, {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(new Date(`${normalizedValue}T00:00:00`));
}

function addDaysToDateInput(value: string | null | undefined, days: number) {
  const normalizedValue = toDateInputValue(value);
  const fallback = normalizedValue || today();
  const parsed = new Date(`${fallback}T00:00:00`);
  parsed.setDate(parsed.getDate() + days);

  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatPdfDuration(
  value: number | null | undefined,
  language: keyof typeof shipmentTranslations
) {
  if (value == null || !Number.isFinite(value) || value <= 0) return EMPTY_VALUE;
  const totalMinutes = Math.round(value);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  const hourLabel = language === "th" ? "ชม." : "hr";
  const minuteLabel = language === "th" ? "นาที" : "min";

  if (hours > 0 && minutes > 0) {
    return `${hours} ${hourLabel} ${minutes} ${minuteLabel}`;
  }

  if (hours > 0) {
    return `${hours} ${hourLabel}`;
  }

  return `${minutes} ${minuteLabel}`;
}

function buildFuelCalculationBasis({
  distanceKm,
  fuelEfficiencyKmPerLitre,
  fuelPricePerLitre,
  estimatedFuelLitres,
  fuelCost,
  language
}: {
  distanceKm: number | null;
  fuelEfficiencyKmPerLitre: number | null;
  fuelPricePerLitre: number | null;
  estimatedFuelLitres: number | null;
  fuelCost: number | null;
  language: keyof typeof shipmentTranslations;
}) {
  const labels = shipmentTranslations[language];
  if (
    distanceKm == null ||
    fuelEfficiencyKmPerLitre == null ||
    fuelEfficiencyKmPerLitre <= 0 ||
    fuelPricePerLitre == null ||
    fuelPricePerLitre <= 0 ||
    estimatedFuelLitres == null ||
    fuelCost == null
  ) {
    return labels.validation.fuelCalculationShort;
  }

  return `${formatPdfNumber(distanceKm, language, 1)} km ÷ ${formatPdfNumber(
    fuelEfficiencyKmPerLitre,
    language,
    2
  )} KM/L × ${formatPdfCurrency(fuelPricePerLitre, language)} = ${formatPdfCurrency(
    fuelCost,
    language
  )}`;
}

function formatCargoSummary(data: QuotePdfData, language: keyof typeof shipmentTranslations) {
  const weightLabel = language === "th" ? "กก." : "kg";
  const palletsLabel = language === "th" ? "พาเลท" : "pallets";
  return [
    data.goodsDescription.trim(),
    data.weight.trim() ? `${data.weight.trim()} ${weightLabel}` : "",
    data.pallets.trim() ? `${data.pallets.trim()} ${palletsLabel}` : "",
    data.dimensions.trim() ? data.dimensions.trim() : ""
  ]
    .filter(Boolean)
    .join(language === "th" ? " | " : " • ");
}

function buildCustomerChargeRows(data: QuotePdfData, language: keyof typeof shipmentTranslations) {
  const labels = shipmentTranslations[language];
  const rows: Array<[string, number]> = [];
  const quotePrice = data.quotePrice ?? null;
  if (quotePrice == null || quotePrice <= 0) {
    return rows;
  }

  const tolls = data.tolls != null && data.tolls > 0 ? data.tolls : 0;
  const parking = data.parkingCost != null && data.parkingCost > 0 ? data.parkingCost : 0;
  const extras = tolls + parking;

  if (extras > 0 && extras < quotePrice) {
    rows.push([labels.pdf.transportServiceCharge, quotePrice - extras]);
    if (tolls > 0) {
      rows.push([labels.pdf.tolls, tolls]);
    }
    if (parking > 0) {
      rows.push([labels.pdf.parking, parking]);
    }
    return rows;
  }

  rows.push([labels.pdf.transportServiceCharge, quotePrice]);
  return rows;
}

function shouldRenderPdfField(value: string | null | undefined) {
  return Boolean(String(value ?? "").trim());
}

function buildCustomerFieldMarkup(label: string, value: string | null | undefined) {
  if (!shouldRenderPdfField(value)) {
    return "";
  }

  return `<div class="detail-row"><span class="detail-label">${escapeHtml(label)}</span><span class="detail-value">${escapeHtml(value)}</span></div>`;
}

function buildCustomerSummaryChips(data: QuotePdfData, language: keyof typeof shipmentTranslations) {
  const labels = shipmentTranslations[language];
  const chips: string[] = [];

  if (data.distanceKm != null && Number.isFinite(data.distanceKm) && data.distanceKm > 0) {
    chips.push(`${formatPdfNumber(data.distanceKm, language, 1)} ${labels.pdf.chipRouteSuffix}`);
  }

  if (data.durationMinutes != null && Number.isFinite(data.durationMinutes) && data.durationMinutes > 0) {
    chips.push(`${formatPdfDuration(data.durationMinutes, language)} ${labels.pdf.chipTransitSuffix}`);
  }

  if (shouldRenderPdfField(data.vehicleType)) {
    chips.push(`${data.vehicleType.trim()} ${labels.pdf.chipVehicleSuffix}`);
  }

  if (data.additionalDropoffs.length > 0) {
    chips.push(`${data.additionalDropoffs.length + 2} ${labels.pdf.chipDeliveryPointsSuffix}`);
  }

  return chips;
}

function buildCustomerServiceHighlights(
  data: QuotePdfData,
  language: keyof typeof shipmentTranslations
) {
  const labels = shipmentTranslations[language];
  const highlights: string[] = [
    labels.pdf.highlightDedicated,
    labels.pdf.highlightRouteAligned,
    labels.pdf.highlightOperatedBy
  ];

  if (shouldRenderPdfField(data.vehicleType)) {
    highlights.splice(1, 0, `${labels.pdf.highlightVehiclePrefix}${data.vehicleType.trim()}`);
  }

  if (data.tolls != null && data.tolls > 0) {
    highlights.push(labels.pdf.highlightTolls);
  }

  if (data.parkingCost != null && data.parkingCost > 0) {
    highlights.push(labels.pdf.highlightParking);
  }

  return highlights;
}

function buildCustomerClosingNote(data: QuotePdfData, language: keyof typeof shipmentTranslations) {
  const labels = shipmentTranslations[language];
  if (data.notes.trim()) {
    return data.notes.trim();
  }

  if (shouldRenderPdfField(data.customerName)) {
    return `${labels.pdf.thankYouPrefix}${data.customerName.trim()}${labels.pdf.thankYouSuffix}`;
  }

  return labels.pdf.thankYouDefault;
}

function openQuotePdfWindow(
  data: QuotePdfData,
  variant: QuotePdfVariant,
  language: keyof typeof shipmentTranslations
) {
  const labels = shipmentTranslations[language];
  const quoteDate = toDateInputValue(data.shipmentDate) || today();
  const generatedDate = new Intl.DateTimeFormat(labels.pdf.locale, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date());
  const validityDate = formatPdfDate(addDaysToDateInput(quoteDate, 7), language);
  const logoUrl = `${window.location.origin}/logo.png`;
  const printable = window.open("", "_blank", "width=920,height=1200");

  if (!printable) {
    throw new Error(labels.validation.pdfPopupBlocked);
  }

  const routeStops = [data.pickupLocation, ...data.additionalDropoffs, data.dropoffLocation].filter(Boolean);
  const routeStopsMarkup = routeStops.length
    ? routeStops
        .map(
          (stop, index) =>
            `<div class="route-stop"><span class="route-index">${index + 1}</span><span>${escapeHtml(stop)}</span></div>`
        )
        .join("")
    : `<div class="route-stop"><span>${escapeHtml(EMPTY_VALUE)}</span></div>`;
  const cargoSummary = formatCargoSummary(data, language) || labels.pdf.customerFallbackCargo;
  const internalCostRows = [
    [
      labels.pdf.distance,
      data.distanceKm != null ? `${formatPdfNumber(data.distanceKm, language, 1)} km` : EMPTY_VALUE
    ],
    [
      labels.pdf.fuelEfficiency,
      data.fuelEfficiencyKmPerLitre != null
        ? `${formatPdfNumber(data.fuelEfficiencyKmPerLitre, language, 2)} KM/L`
        : EMPTY_VALUE
    ],
    [labels.pdf.fuelPrice, formatPdfCurrency(data.fuelPricePerLitre, language)],
    [
      labels.pdf.estimatedFuelLitres,
      data.estimatedFuelLitres != null
        ? `${formatPdfNumber(data.estimatedFuelLitres, language, 2)} L`
        : EMPTY_VALUE
    ],
    [labels.pdf.fuelCost, formatPdfCurrency(data.fuelCost, language)],
    [labels.pdf.driverCost, formatPdfCurrency(data.driverCost, language)],
    [labels.pdf.tolls, formatPdfCurrency(data.tolls, language)],
    [labels.pdf.parking, formatPdfCurrency(data.parkingCost, language)],
    [labels.pdf.operatingCost, formatPdfCurrency(data.operatingCost, language)],
    [labels.pdf.quotePrice, formatPdfCurrency(data.quotePrice, language)],
    [labels.pdf.profit, formatPdfCurrency(data.profit, language)],
    [
      labels.pdf.margin,
      data.marginPercent != null ? `${formatPdfNumber(data.marginPercent, language, 1)}%` : EMPTY_VALUE
    ]
  ];
  const customerChargeRows = buildCustomerChargeRows(data, language);
  const customerTotal = formatPdfCurrency(data.quotePrice, language);
  const titleText = variant === "internal" ? labels.pdf.internalTitle : labels.pdf.customerTitle;
  const subtitleText =
    variant === "internal"
      ? labels.pdf.internalSubtitle
      : labels.pdf.customerSubtitle;
  const notesText =
    data.notes.trim() ||
    (variant === "customer"
      ? labels.pdf.customerFallbackNote
      : labels.pdf.internalFallbackNote);
  const footerLeft =
    variant === "internal"
      ? labels.pdf.internalFooter
      : labels.pdf.customerFooter;
  const footerRight =
    variant === "internal"
      ? `${labels.pdf.status}: ${escapeHtml(getStatusLabel(data.status || "Draft", labels))}`
      : `${labels.pdf.internalRef}: ${escapeHtml(data.jobReference || EMPTY_VALUE)}`;
  const customerSummaryChips = buildCustomerSummaryChips(data, language);
  const customerServiceHighlights = buildCustomerServiceHighlights(data, language);
  const customerPickupMarkup = buildCustomerFieldMarkup(labels.pdf.pickupLocation, data.pickupLocation);
  const customerDropoffMarkup = buildCustomerFieldMarkup(labels.pdf.deliveryLocation, data.dropoffLocation);
  const customerRouteMarkup = buildCustomerFieldMarkup(labels.pdf.routeSummary, data.routeSummary);
  const customerDistanceMarkup =
    data.distanceKm != null && Number.isFinite(data.distanceKm) && data.distanceKm > 0
      ? buildCustomerFieldMarkup(labels.pdf.distance, `${formatPdfNumber(data.distanceKm, language, 1)} km`)
      : "";
  const customerDurationMarkup =
    data.durationMinutes != null && Number.isFinite(data.durationMinutes) && data.durationMinutes > 0
      ? buildCustomerFieldMarkup(
          labels.pdf.estimatedTransitTime,
          formatPdfDuration(data.durationMinutes, language)
        )
      : "";
  const customerVehicleMarkup = buildCustomerFieldMarkup(labels.pdf.vehicleType, data.vehicleType);
  const customerCargoMarkup = buildCustomerFieldMarkup(labels.pdf.cargoScope, formatCargoSummary(data, language));
  const customerNameMarkup = buildCustomerFieldMarkup(labels.pdf.customerName, data.customerName);
  const customerQuoteStatusMarkup = buildCustomerFieldMarkup(
    labels.pdf.quotationStatus,
    getStatusLabel(data.status || "Quoted", labels)
  );
  const customerClosingNote = buildCustomerClosingNote(data, language);
  const costSummaryMarkup =
    variant === "internal"
      ? `
      <section class="section">
        <p class="section-title">${escapeHtml(labels.pdf.internalCostSummary)}</p>
        <div class="box" style="margin-bottom: 12px;">
          <p class="label">${escapeHtml(labels.pdf.fuelCalculationBasis)}</p>
          <p class="value">${escapeHtml(data.fuelCalculationBasis || labels.validation.fuelCalculationShort)}</p>
        </div>
        <table>
          <thead><tr><th>${escapeHtml(labels.pdf.item)}</th><th>${escapeHtml(labels.pdf.amount)}</th></tr></thead>
          <tbody>
            ${internalCostRows
              .map(
                ([label, value]) =>
                  `<tr class="${
                    label === labels.pdf.operatingCost ||
                    label === labels.pdf.quotePrice ||
                    label === labels.pdf.profit
                      ? "total"
                      : ""
                  }"><td>${escapeHtml(label)}</td><td>${escapeHtml(value)}</td></tr>`
              )
              .join("")}
          </tbody>
        </table>
      </section>`
      : `
      <section class="quote-focus section avoid-break">
        <div class="focus-copy">
          <p class="focus-kicker">${escapeHtml(labels.pdf.totalCustomerQuotation)}</p>
          <h2>${escapeHtml(customerTotal)}</h2>
          <p class="focus-helper">${escapeHtml(labels.pdf.professionalQuoteHelper)}</p>
        </div>
        <div class="focus-badge">${escapeHtml(labels.pdf.readyForApproval)}</div>
      </section>

      <section class="customer-commercial section avoid-break">
        <div class="section-heading">
          <p class="section-title">${escapeHtml(labels.pdf.commercialSummary)}</p>
          <p class="section-helper">${escapeHtml(labels.pdf.customerFacingOnly)}</p>
        </div>
        <div class="commercial-grid">
          <div class="commercial-table">
            <table>
              <thead><tr><th>${escapeHtml(labels.pdf.item)}</th><th>${escapeHtml(labels.pdf.amount)}</th></tr></thead>
              <tbody>
                ${customerChargeRows
                  .map(
                    ([label, value]) =>
                      `<tr><td>${escapeHtml(label)}</td><td>${escapeHtml(formatPdfCurrency(value, language))}</td></tr>`
                  )
                  .join("")}
                <tr class="grand-total"><td>${escapeHtml(labels.pdf.totalCustomerQuotation)}</td><td>${escapeHtml(customerTotal)}</td></tr>
              </tbody>
            </table>
          </div>
          <div class="commercial-note">
            <p class="panel-kicker">${escapeHtml(labels.pdf.commercialNotes)}</p>
            <p class="commercial-note-title">${escapeHtml(labels.pdf.commercialNotesTitle)}</p>
            <p class="commercial-note-copy">${escapeHtml(labels.pdf.commercialNotesCopy)}</p>
            <div class="trust-list">
              <div class="trust-item"><span class="trust-dot"></span><span>${escapeHtml(labels.pdf.validityStatementPrefix)} ${escapeHtml(validityDate)}</span></div>
              <div class="trust-item"><span class="trust-dot"></span><span>${escapeHtml(labels.pdf.paymentTerms)}</span></div>
              <div class="trust-item"><span class="trust-dot"></span><span>${escapeHtml(labels.pdf.operationalScope)}</span></div>
            </div>
          </div>
        </div>
      </section>`;

  printable.document.write(`<!doctype html>
<html>
<head>
  <title>${escapeHtml(titleText)} ${escapeHtml(data.jobReference || labels.title)}</title>
  <style>
    @page { size: A4; margin: 14mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #0f172a; font-family: Arial, Helvetica, sans-serif; background: #edf2f7; }
    .page { min-height: 100vh; background: #fff; padding: 24px; }
    .header { position: relative; display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; padding: 20px 22px; border-radius: 20px; background: linear-gradient(135deg, #0f766e 0%, #0f172a 100%); color: #fff; overflow: hidden; }
    .header::after { content: ""; position: absolute; inset: auto -60px -80px auto; width: 180px; height: 180px; background: radial-gradient(circle, rgba(255,255,255,0.16), rgba(255,255,255,0)); }
    .brand-wrap { display: flex; gap: 16px; align-items: flex-start; position: relative; z-index: 1; }
    .logo { width: 72px; height: 72px; object-fit: contain; border-radius: 16px; background: rgba(255,255,255,0.96); padding: 10px; box-shadow: 0 18px 36px rgba(15, 23, 42, 0.18); }
    .brand-kicker { margin: 0 0 6px; font-size: 11px; font-weight: 700; letter-spacing: .18em; text-transform: uppercase; color: rgba(255,255,255,0.75); }
    .brand { font-size: 22px; font-weight: 800; letter-spacing: .02em; color: #fff; line-height: 1.15; }
    .brand-subtitle { margin: 8px 0 0; max-width: 420px; color: rgba(255,255,255,0.82); font-size: 12px; line-height: 1.55; }
    .muted { color: #64748b; font-size: 12px; line-height: 1.5; }
    .title { text-align: right; }
    .title h1 { margin: 0; font-size: 26px; letter-spacing: .08em; color: #fff; text-transform: uppercase; }
    .title p { margin: 8px 0 0; color: rgba(255,255,255,0.82); font-size: 12px; line-height: 1.55; }
    .meta-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-top: 16px; }
    .section { margin-top: 22px; }
    .section-heading { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; margin-bottom: 10px; }
    .section-title { margin: 0; font-size: 11px; font-weight: 800; letter-spacing: .16em; text-transform: uppercase; color: #64748b; }
    .section-helper { margin: 0; color: #64748b; font-size: 12px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .box { border: 1px solid #e2e8f0; border-radius: 14px; padding: 14px; background: #fff; }
    .label { margin: 0 0 5px; color: #64748b; font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: .12em; }
    .value { margin: 0; font-size: 14px; font-weight: 700; color: #0f172a; line-height: 1.35; }
    .meta-grid .box, .hero .box { background: #f8fafc; }
    .hero { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-top: 18px; }
    .hero .value { font-size: 18px; }
    .route-card { border: 1px solid #dbe7f2; border-radius: 18px; padding: 16px; background: linear-gradient(180deg, #f8fbff 0%, #ffffff 100%); }
    .route-stops { display: grid; gap: 10px; margin-top: 14px; }
    .route-stop { display: flex; gap: 10px; align-items: flex-start; font-size: 13px; color: #0f172a; }
    .route-index { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 999px; background: #0f766e; color: #fff; font-size: 11px; font-weight: 800; flex: 0 0 24px; }
    table { width: 100%; border-collapse: collapse; overflow: hidden; border-radius: 10px; }
    th { background: #0f172a; color: #fff; text-align: left; padding: 10px 12px; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; }
    td { border-bottom: 1px solid #e2e8f0; padding: 10px 12px; font-size: 13px; }
    td:last-child { text-align: right; font-weight: 800; }
    .total td { background: #ecfeff; color: #0f172a; font-weight: 800; }
    .notes { min-height: 78px; white-space: pre-wrap; line-height: 1.6; }
    .quote-total-card { display: flex; justify-content: space-between; align-items: center; gap: 20px; margin-top: 16px; padding: 18px 20px; border-radius: 18px; background: linear-gradient(135deg, #0f172a 0%, #0f766e 100%); color: #fff; }
    .quote-total-card .label { color: rgba(255,255,255,0.7); margin-bottom: 8px; }
    .total-value { margin: 0; font-size: 30px; font-weight: 800; letter-spacing: -.03em; }
    .total-badge { display: inline-flex; align-items: center; justify-content: center; border-radius: 999px; border: 1px solid rgba(255,255,255,0.2); padding: 10px 14px; font-size: 11px; font-weight: 800; letter-spacing: .16em; text-transform: uppercase; color: #dcfce7; background: rgba(255,255,255,0.06); }
    .footer { margin-top: 28px; padding-top: 16px; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; gap: 20px; }
    .footer p { margin: 0; }
    .avoid-break { break-inside: avoid; page-break-inside: avoid; }
    .customer-page { padding: 26px 26px 20px; }
    .customer-header { position: relative; border-radius: 24px; padding: 24px 26px; background: linear-gradient(135deg, #0f172a 0%, #0f766e 58%, #0f766e 100%); color: #fff; overflow: hidden; }
    .customer-header::before { content: ""; position: absolute; inset: -80px auto auto -60px; width: 220px; height: 220px; border-radius: 50%; background: rgba(255,255,255,0.08); }
    .customer-header::after { content: ""; position: absolute; inset: auto -55px -85px auto; width: 220px; height: 220px; border-radius: 50%; background: rgba(255,255,255,0.08); }
    .customer-header-top { position: relative; z-index: 1; display: flex; justify-content: space-between; gap: 22px; align-items: flex-start; }
    .customer-brand { display: flex; gap: 16px; align-items: flex-start; max-width: 70%; }
    .customer-brand .logo { width: 76px; height: 76px; }
    .customer-eyebrow { margin: 0 0 6px; font-size: 11px; font-weight: 700; letter-spacing: .18em; text-transform: uppercase; color: rgba(255,255,255,0.72); }
    .customer-brand h1 { margin: 0; font-size: 24px; line-height: 1.08; letter-spacing: .01em; }
    .customer-brand p { margin: 8px 0 0; font-size: 12px; line-height: 1.6; color: rgba(255,255,255,0.82); }
    .doc-title { text-align: right; min-width: 230px; }
    .doc-title .title-kicker { margin: 0; font-size: 11px; letter-spacing: .16em; text-transform: uppercase; color: rgba(255,255,255,0.7); }
    .doc-title h2 { margin: 8px 0 0; font-size: 30px; line-height: 1; letter-spacing: .05em; text-transform: uppercase; }
    .doc-title p { margin: 10px 0 0; font-size: 12px; line-height: 1.5; color: rgba(255,255,255,0.84); }
    .customer-header-bottom { position: relative; z-index: 1; margin-top: 18px; display: grid; grid-template-columns: 1.2fr .8fr; gap: 16px; align-items: end; }
    .header-summary { padding: 16px 18px; border-radius: 18px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.12); backdrop-filter: blur(6px); }
    .header-summary p { margin: 0; }
    .header-summary .summary-title { font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: rgba(255,255,255,0.7); }
    .header-summary .summary-copy { margin-top: 10px; font-size: 15px; line-height: 1.55; color: #fff; font-weight: 600; }
    .header-summary .summary-chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
    .header-summary .summary-chip { display: inline-flex; align-items: center; border-radius: 999px; padding: 7px 10px; font-size: 11px; font-weight: 700; color: #ecfeff; border: 1px solid rgba(255,255,255,0.12); background: rgba(15,23,42,0.18); }
    .header-total { padding: 18px 20px; border-radius: 18px; background: linear-gradient(180deg, rgba(255,255,255,0.98), rgba(240,253,250,0.96)); color: #0f172a; box-shadow: 0 18px 40px rgba(15,23,42,0.18); }
    .header-total .label { color: #0f766e; margin-bottom: 8px; }
    .header-total .hero-total { margin: 0; font-size: 34px; line-height: 1; letter-spacing: -.03em; font-weight: 800; }
    .header-total .hero-caption { margin: 10px 0 0; font-size: 12px; line-height: 1.5; color: #475569; }
    .meta-strip { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-top: 18px; }
    .meta-pill { border: 1px solid #dbe7f2; border-radius: 16px; padding: 14px 14px 13px; background: linear-gradient(180deg, #ffffff, #f8fbfd); }
    .meta-pill .label { margin-bottom: 6px; }
    .meta-pill .value { font-size: 15px; }
    .customer-section { margin-top: 18px; padding: 18px 18px 16px; border: 1px solid #e2e8f0; border-radius: 20px; background: #fff; }
    .customer-section .section-title { color: #334155; }
    .customer-section-header { display: flex; justify-content: space-between; gap: 18px; align-items: baseline; margin-bottom: 12px; }
    .customer-section-header .section-title { margin: 0; }
    .customer-section-header .section-helper { margin: 0; color: #64748b; font-size: 12px; }
    .detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 18px; }
    .detail-row { display: grid; grid-template-columns: 160px 1fr; gap: 12px; padding: 9px 0; border-bottom: 1px solid #edf2f7; }
    .detail-row:last-child { border-bottom: 0; }
    .detail-label { font-size: 11px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; color: #64748b; }
    .detail-value { font-size: 14px; font-weight: 600; line-height: 1.55; color: #0f172a; }
    .scope-grid { display: grid; grid-template-columns: 1.1fr .9fr; gap: 16px; }
    .scope-panel { border: 1px solid #e2e8f0; border-radius: 18px; padding: 16px; background: linear-gradient(180deg, #ffffff, #fbfdff); }
    .panel-kicker { margin: 0 0 8px; font-size: 11px; font-weight: 800; letter-spacing: .15em; text-transform: uppercase; color: #64748b; }
    .scope-copy { margin: 0; font-size: 15px; line-height: 1.7; color: #334155; }
    .route-flow { display: grid; gap: 12px; margin-top: 14px; }
    .route-node { position: relative; padding-left: 22px; }
    .route-node::before { content: ""; position: absolute; left: 4px; top: 9px; width: 9px; height: 9px; border-radius: 50%; background: #0f766e; }
    .route-node::after { content: ""; position: absolute; left: 8px; top: 18px; bottom: -14px; width: 1px; background: #cbd5e1; }
    .route-node:last-child::after { display: none; }
    .route-node .node-label { margin: 0; font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: #64748b; font-weight: 800; }
    .route-node .node-value { margin: 4px 0 0; font-size: 14px; line-height: 1.55; font-weight: 600; color: #0f172a; }
    .highlight-list { display: grid; gap: 10px; }
    .highlight-item { display: flex; gap: 10px; align-items: flex-start; font-size: 13px; line-height: 1.6; color: #334155; }
    .highlight-icon { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 999px; background: #dcfce7; color: #166534; font-size: 11px; font-weight: 800; flex: 0 0 18px; margin-top: 2px; }
    .quote-focus { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 22px 24px; border-radius: 22px; background: linear-gradient(135deg, #0f172a 0%, #0f766e 100%); color: #fff; box-shadow: 0 24px 50px rgba(15,23,42,0.14); }
    .focus-kicker { margin: 0; font-size: 11px; font-weight: 800; letter-spacing: .18em; text-transform: uppercase; color: rgba(255,255,255,0.72); }
    .focus-copy h2 { margin: 10px 0 0; font-size: 42px; line-height: 1; letter-spacing: -.04em; }
    .focus-helper { margin: 10px 0 0; font-size: 13px; line-height: 1.6; color: rgba(255,255,255,0.84); }
    .focus-badge { display: inline-flex; align-items: center; justify-content: center; border-radius: 999px; padding: 12px 16px; border: 1px solid rgba(255,255,255,0.18); background: rgba(255,255,255,0.08); color: #dcfce7; font-size: 11px; font-weight: 800; letter-spacing: .16em; text-transform: uppercase; white-space: nowrap; }
    .customer-commercial { border: 1px solid #e2e8f0; border-radius: 22px; padding: 18px; background: linear-gradient(180deg, #ffffff, #f8fbfd); }
    .commercial-grid { display: grid; grid-template-columns: 1.05fr .95fr; gap: 16px; align-items: stretch; }
    .commercial-table { border: 1px solid #dbe7f2; border-radius: 16px; overflow: hidden; background: #fff; }
    .grand-total td { background: #0f172a; color: #fff; font-weight: 800; }
    .commercial-note { border: 1px solid #dbe7f2; border-radius: 16px; padding: 18px; background: linear-gradient(180deg, #effcf7, #ffffff); }
    .commercial-note-title { margin: 0; font-size: 18px; line-height: 1.3; color: #0f172a; font-weight: 800; }
    .commercial-note-copy { margin: 10px 0 0; font-size: 13px; line-height: 1.65; color: #334155; }
    .trust-list { display: grid; gap: 10px; margin-top: 16px; }
    .trust-item { display: flex; gap: 10px; align-items: flex-start; font-size: 13px; line-height: 1.6; color: #0f172a; }
    .trust-dot { width: 10px; height: 10px; border-radius: 50%; background: #0f766e; flex: 0 0 10px; margin-top: 5px; }
    .closing-panel { border: 1px solid #e2e8f0; border-radius: 20px; padding: 18px 18px 16px; background: linear-gradient(180deg, #ffffff, #fbfdff); }
    .closing-title { margin: 0; font-size: 18px; line-height: 1.3; color: #0f172a; font-weight: 800; }
    .closing-copy { margin: 10px 0 0; font-size: 13px; line-height: 1.7; color: #334155; white-space: pre-wrap; }
    .closing-footer { margin-top: 14px; font-size: 12px; line-height: 1.6; color: #64748b; }
    @media print { body { background: #fff; } .page { padding: 0; } }
    @media (max-width: 720px) {
      .header, .footer, .grid, .hero, .meta-grid { grid-template-columns: 1fr; display: grid; }
      .brand-wrap { flex-direction: column; }
      .title { text-align: left; }
      .quote-total-card { align-items: flex-start; flex-direction: column; }
      .customer-header-top, .customer-header-bottom, .scope-grid, .commercial-grid, .detail-grid, .meta-strip { display: grid; grid-template-columns: 1fr; }
      .customer-brand { max-width: none; }
      .doc-title { text-align: left; }
      .detail-row { grid-template-columns: 1fr; gap: 6px; }
      .quote-focus { flex-direction: column; align-items: flex-start; }
    }
  </style>
</head>
<body>
  <main class="${variant === "customer" ? "page customer-page" : "page"}">
    ${
      variant === "customer"
        ? `<header class="customer-header avoid-break">
      <div class="customer-header-top">
        <div class="customer-brand">
          <img src="${escapeHtml(logoUrl)}" alt="Expert Express Sender Co., Ltd. logo" class="logo" />
          <div>
            <p class="customer-eyebrow">${escapeHtml(labels.pdf.companyTagline)}</p>
            <h1>${escapeHtml(labels.pdf.companyName)}</h1>
            <p>${escapeHtml(labels.pdf.customerSubtitle)}</p>
          </div>
        </div>
        <div class="doc-title">
          <p class="title-kicker">${escapeHtml(labels.pdf.quoteReference)}</p>
          <h2>${escapeHtml(labels.pdf.customerTitle)}</h2>
          <p>${escapeHtml(labels.pdf.generatedDate)} ${escapeHtml(generatedDate)}<br />${escapeHtml(labels.pdf.quoteReference)} ${escapeHtml(data.jobReference || EMPTY_VALUE)}</p>
        </div>
      </div>
      <div class="customer-header-bottom">
        <div class="header-summary">
          <p class="summary-title">${escapeHtml(labels.pdf.quoteSummaryTitle)}</p>
          <p class="summary-copy">${escapeHtml(data.routeSummary || labels.pdf.quoteSummaryCopy)}</p>
          ${
            customerSummaryChips.length
              ? `<div class="summary-chips">${customerSummaryChips
                  .map((chip) => `<span class="summary-chip">${escapeHtml(chip)}</span>`)
                  .join("")}</div>`
              : ""
          }
        </div>
        <div class="header-total">
          <p class="label">${escapeHtml(labels.pdf.totalCustomerQuotation)}</p>
          <p class="hero-total">${escapeHtml(customerTotal)}</p>
          <p class="hero-caption">${escapeHtml(labels.pdf.quoteReadyCaption)}</p>
        </div>
      </div>
    </header>`
        : `<header class="header">
      <div class="brand-wrap">
        <img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(labels.pdf.companyName)} logo" class="logo" />
        <div>
          <p class="brand-kicker">${escapeHtml(labels.pdf.companyTagline)}</p>
          <div class="brand">${escapeHtml(labels.pdf.companyName)}</div>
          <p class="brand-subtitle">${escapeHtml(subtitleText)}</p>
        </div>
      </div>
      <div class="title">
        <h1>${escapeHtml(titleText)}</h1>
        <p>${escapeHtml(labels.pdf.generatedDate)} ${escapeHtml(generatedDate)}</p>
      </div>
    </header>`
    }

    ${
      variant === "customer"
        ? `<section class="section avoid-break">
      <div class="meta-strip">
        <div class="meta-pill"><p class="label">${escapeHtml(labels.pdf.quoteReference)}</p><p class="value">${escapeHtml(data.jobReference || EMPTY_VALUE)}</p></div>
        <div class="meta-pill"><p class="label">${escapeHtml(labels.pdf.quoteDate)}</p><p class="value">${escapeHtml(formatPdfDate(quoteDate, language))}</p></div>
        <div class="meta-pill"><p class="label">${escapeHtml(labels.pdf.validUntil)}</p><p class="value">${escapeHtml(validityDate)}</p></div>
        <div class="meta-pill"><p class="label">${escapeHtml(labels.pdf.status)}</p><p class="value">${escapeHtml(getStatusLabel(data.status || "Quoted", labels))}</p></div>
      </div>
    </section>`
        : `<section class="section">
      <div class="meta-grid">
        <div class="box"><p class="label">${escapeHtml(labels.pdf.quoteReference)}</p><p class="value">${escapeHtml(data.jobReference || EMPTY_VALUE)}</p></div>
        <div class="box"><p class="label">${escapeHtml(labels.pdf.quoteDate)}</p><p class="value">${escapeHtml(formatPdfDate(quoteDate, language))}</p></div>
        <div class="box"><p class="label">${escapeHtml(labels.pdf.validUntil)}</p><p class="value">${escapeHtml(validityDate)}</p></div>
        <div class="box"><p class="label">${escapeHtml(labels.pdf.status)}</p><p class="value">${escapeHtml(getStatusLabel(data.status || "Quoted", labels))}</p></div>
      </div>
    </section>`
    }

    ${
      variant === "customer"
        ? `<section class="customer-section section avoid-break">
      <div class="customer-section-header">
        <p class="section-title">${escapeHtml(labels.pdf.customerSection)}</p>
        <p class="section-helper">${escapeHtml(labels.pdf.customerSubtitle)}</p>
      </div>
      <div class="detail-grid">
        <div>${customerNameMarkup}</div>
        <div>${customerQuoteStatusMarkup}</div>
      </div>
    </section>

    <section class="customer-section section">
      <div class="customer-section-header">
        <p class="section-title">${escapeHtml(labels.pdf.shipmentSection)}</p>
        <p class="section-helper">${escapeHtml(labels.pdf.professionalQuoteHelper)}</p>
      </div>
      <div class="scope-grid">
        <div class="scope-panel">
          <p class="panel-kicker">${escapeHtml(labels.pdf.shipmentSection)}</p>
          <div>
            ${customerPickupMarkup}
            ${customerDropoffMarkup}
            ${customerRouteMarkup}
            ${customerDistanceMarkup}
            ${customerDurationMarkup}
            ${customerVehicleMarkup}
            ${customerCargoMarkup}
          </div>
        </div>
        <div class="scope-panel">
          <p class="panel-kicker">${escapeHtml(labels.pdf.serviceHighlights)}</p>
          <div class="highlight-list">
            ${customerServiceHighlights
              .map(
                (item) =>
                  `<div class="highlight-item"><span class="highlight-icon">+</span><span>${escapeHtml(item)}</span></div>`
              )
              .join("")}
          </div>
        </div>
      </div>
      <div class="scope-panel" style="margin-top: 16px;">
        <p class="panel-kicker">${escapeHtml(labels.pdf.routePlan)}</p>
        <div class="route-flow">
          ${routeStops
            .map((stop, index) => {
              const stopLabel =
                index === 0
                  ? labels.pdf.pickupLocation
                  : index === routeStops.length - 1
                    ? labels.pdf.deliveryLocation
                    : `${labels.stops} ${index + 1}`;

              return `<div class="route-node"><p class="node-label">${escapeHtml(stopLabel)}</p><p class="node-value">${escapeHtml(stop)}</p></div>`;
            })
            .join("")}
        </div>
      </div>
    </section>`
        : `<section class="section">
      <p class="section-title">${escapeHtml(labels.pdf.customerSection)}</p>
      <div class="grid">
        <div class="box"><p class="label">${escapeHtml(labels.customer)}</p><p class="value">${escapeHtml(data.customerName || EMPTY_VALUE)}</p></div>
        <div class="box"><p class="label">${escapeHtml(labels.pdf.cargoScope)}</p><p class="value">${escapeHtml(cargoSummary)}</p></div>
      </div>
    </section>

    <section class="section">
      <p class="section-title">${escapeHtml(labels.jobDetailsTitle)}</p>
      <div class="grid">
        <div class="box"><p class="label">${escapeHtml(labels.pdf.pickupLocation)}</p><p class="value">${escapeHtml(data.pickupLocation || EMPTY_VALUE)}</p></div>
        <div class="box"><p class="label">${escapeHtml(labels.dropoff)}</p><p class="value">${escapeHtml(data.dropoffLocation || EMPTY_VALUE)}</p></div>
        <div class="box"><p class="label">${escapeHtml(labels.pdf.vehicleType)}</p><p class="value">${escapeHtml(data.vehicleType || EMPTY_VALUE)}</p></div>
        <div class="box"><p class="label">${escapeHtml(labels.pdf.cargoScope)}</p><p class="value">${escapeHtml(cargoSummary)}</p></div>
      </div>
      <div class="hero">
        <div class="box"><p class="label">${escapeHtml(labels.pdf.routeSummary)}</p><p class="value">${escapeHtml(data.routeSummary || EMPTY_VALUE)}</p></div>
        <div class="box"><p class="label">${escapeHtml(labels.pdf.distance)}</p><p class="value">${data.distanceKm != null ? `${formatPdfNumber(data.distanceKm, language, 1)} km` : EMPTY_VALUE}</p></div>
        <div class="box"><p class="label">${escapeHtml(labels.duration)}</p><p class="value">${escapeHtml(formatPdfDuration(data.durationMinutes, language))}</p></div>
        <div class="box"><p class="label">${escapeHtml(labels.pdf.quoteDate)}</p><p class="value">${escapeHtml(formatPdfDate(quoteDate, language))}</p></div>
      </div>
      <div class="route-card">
        <p class="label">${escapeHtml(labels.pdf.routePlan)}</p>
        <div class="route-stops">${routeStopsMarkup}</div>
      </div>
    </section>`
    }

    ${costSummaryMarkup}

    ${
      variant === "customer"
        ? `<section class="closing-panel section avoid-break">
      <p class="panel-kicker">${escapeHtml(labels.pdf.serviceNotesTitle)}</p>
      <h3 class="closing-title">${escapeHtml(labels.pdf.readyForApproval)}</h3>
      <p class="closing-copy">${escapeHtml(customerClosingNote)}</p>
      <p class="closing-footer">${escapeHtml(labels.pdf.thankYouDefault)}</p>
    </section>`
        : `<section class="section">
      <p class="section-title">${escapeHtml(labels.pdf.notes)}</p>
      <div class="box notes">${escapeHtml(notesText)}</div>
    </section>`
    }

    ${
      variant === "customer"
        ? `<section class="section">
      <div class="grid avoid-break">
        <div class="box"><p class="label">${escapeHtml(labels.pdf.paymentTermsTitle)}</p><p class="value">${escapeHtml(labels.pdf.paymentTerms)}</p></div>
        <div class="box"><p class="label">${escapeHtml(labels.pdf.validityTitle)}</p><p class="value">${escapeHtml(labels.pdf.validityStatementPrefix)} ${escapeHtml(validityDate)}</p></div>
      </div>
    </section>`
        : ""
    }

    <footer class="footer">
      <p class="muted">${footerLeft}</p>
      <p class="muted">${footerRight}</p>
    </footer>
  </main>
  <script>
    window.addEventListener("load", () => {
      window.focus();
      window.print();
    });
  </script>
</body>
</html>`);
  printable.document.close();
}

function getStoredValue(key: string) {
  if (typeof window === "undefined") {
    return null;
  }

  const value = window.localStorage.getItem(key);
  return value && value.trim() ? value : null;
}

function getRouteDefaults(shipments: ShipmentWithDriver[]) {
  const storedKmPerLitre = getStoredValue(STORAGE_KEYS.kmPerLitre);
  const storedFuelPrice = getStoredValue(STORAGE_KEYS.fuelPrice);

  const latestWithDefaults = shipments.find(
    (shipment) =>
      shipment.standard_km_per_litre != null ||
      shipment.fuel_price_per_litre != null ||
      shipment.diesel_price != null
  );

  return {
    kmPerLitre:
      storedKmPerLitre ||
      formatInputNumber(latestWithDefaults?.standard_km_per_litre, 2) ||
      DEFAULT_KM_PER_LITRE,
    fuelPrice:
      storedFuelPrice ||
      formatInputNumber(
        latestWithDefaults?.fuel_price_per_litre ?? latestWithDefaults?.diesel_price,
        2
      ) ||
      DEFAULT_FUEL_PRICE
  };
}

export default function ShipmentsPage() {
  const { language } = useLanguage();
  const labels = shipmentTranslations[language] as ShipmentTranslations;
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [shipments, setShipments] = useState<ShipmentWithDriver[]>([]);
  const [form, setForm] = useState<FormState>(() => createInitialForm());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [estimating, setEstimating] = useState(false);
  const [googleMapsConfigured, setGoogleMapsConfigured] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [distanceMessage, setDistanceMessage] = useState<string | null>(null);
  const [lastEstimatedRouteKey, setLastEstimatedRouteKey] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [selectedDriverFilter, setSelectedDriverFilter] = useState("");
  const [selectedVehicleFilter, setSelectedVehicleFilter] = useState("");
  const [startDateFilter, setStartDateFilter] = useState("");
  const [endDateFilter, setEndDateFilter] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [defaultsReady, setDefaultsReady] = useState(false);
  const formRef = useRef<HTMLFormElement | null>(null);
  const deferredSearchTerm = useDeferredValue(searchTerm);

  const selectedDriver = useMemo(
    () => drivers.find((driver) => String(driver.id) === String(form.driver_id)) ?? null,
    [drivers, form.driver_id]
  );

  const estimatedDistanceKm = useMemo(() => parseNumber(form.estimated_distance_km), [form.estimated_distance_km]);
  const estimatedDurationMinutes = useMemo(
    () => parseNumber(form.estimated_duration_minutes),
    [form.estimated_duration_minutes]
  );
  const kmPerLitre = useMemo(() => parseNumber(form.standard_km_per_litre), [form.standard_km_per_litre]);
  const fuelPricePerLitre = useMemo(
    () => parseNumber(form.fuel_price_per_litre),
    [form.fuel_price_per_litre]
  );
  const tollEstimate = useMemo(() => parseNumber(form.toll_estimate) ?? 0, [form.toll_estimate]);
  const parkingCost = useMemo(() => parseNumber(form.parking_cost) ?? 0, [form.parking_cost]);
  const driverCost = useMemo(() => parseNumber(form.driver_allowance) ?? 0, [form.driver_allowance]);
  const marginPercent = useMemo(() => parseNumber(form.margin_percent) ?? 0, [form.margin_percent]);
  const estimatedFuelLitres = useMemo(() => {
    if (estimatedDistanceKm == null || kmPerLitre == null || kmPerLitre <= 0) {
      return null;
    }

    return estimatedDistanceKm / kmPerLitre;
  }, [estimatedDistanceKm, kmPerLitre]);

  const estimatedFuelCost = useMemo(() => {
    if (estimatedFuelLitres == null || fuelPricePerLitre == null || fuelPricePerLitre <= 0) {
      return null;
    }

    return estimatedFuelLitres * fuelPricePerLitre;
  }, [estimatedFuelLitres, fuelPricePerLitre]);
  const fuelCalculationBasis = useMemo(
    () =>
      buildFuelCalculationBasis({
        distanceKm: estimatedDistanceKm,
        fuelEfficiencyKmPerLitre: kmPerLitre,
        fuelPricePerLitre,
        estimatedFuelLitres,
        fuelCost: estimatedFuelCost,
        language
      }),
    [estimatedDistanceKm, estimatedFuelCost, estimatedFuelLitres, fuelPricePerLitre, kmPerLitre, language]
  );
  const fuelCalculationHelperText = useMemo(
    () => getFuelEfficiencyHelperText(kmPerLitre, labels),
    [kmPerLitre, labels]
  );

  const totalEstimatedJobCost = useMemo(() => {
    return (estimatedFuelCost ?? 0) + tollEstimate + parkingCost + driverCost;
  }, [driverCost, estimatedFuelCost, parkingCost, tollEstimate]);

  const recommendedQuotePrice = useMemo(
    () => (totalEstimatedJobCost > 0 ? totalEstimatedJobCost * (1 + marginPercent / 100) : 0),
    [marginPercent, totalEstimatedJobCost]
  );
  const finalQuotePrice = useMemo(
    () => parseNumber(form.final_quote_price) ?? recommendedQuotePrice,
    [form.final_quote_price, recommendedQuotePrice]
  );
  const expectedProfit = useMemo(
    () => (finalQuotePrice > 0 ? finalQuotePrice - totalEstimatedJobCost : null),
    [finalQuotePrice, totalEstimatedJobCost]
  );
  const expectedMarginPercent = useMemo(
    () =>
      finalQuotePrice > 0 && expectedProfit != null
        ? (expectedProfit / finalQuotePrice) * 100
        : null,
    [expectedProfit, finalQuotePrice]
  );
  const customerOptions = useMemo(
    () =>
      Array.from(
        new Set(
          shipments
            .map((shipment) => normalizeShipment(shipment).customerName.trim())
            .filter((customer): customer is string => Boolean(customer))
        )
      ).slice(0, 40),
    [shipments]
  );

  const recentCustomerQuotes = useMemo(() => {
    const customerKey = normalizeLocationKey(form.customer_name);
    if (!customerKey) return [];

    return shipments
      .filter((shipment) => normalizeLocationKey(normalizeShipment(shipment).customerName) === customerKey)
      .slice(0, 3)
      .map((shipment) => ({
        ref: shipment.job_reference,
        quote: getShipmentQuote(shipment),
        margin: getShipmentMarginPercent(shipment)
      }));
  }, [form.customer_name, shipments]);

  const currentRouteKey = useMemo(
    () =>
      buildFormRouteKey({
        route_start_location: form.route_start_location,
        start_location: form.start_location,
        end_location: form.end_location,
        additional_dropoffs: form.additional_dropoffs,
        include_return_to_start: form.include_return_to_start
      }),
    [
      form.additional_dropoffs,
      form.end_location,
      form.include_return_to_start,
      form.route_start_location,
      form.start_location
    ]
  );

  const routeEstimateStale =
    Boolean(form.estimated_distance_km) &&
    Boolean(lastEstimatedRouteKey) &&
    currentRouteKey !== lastEstimatedRouteKey;

  const applyDefaultsToFreshForm = useCallback((shipmentRows: ShipmentWithDriver[]) => {
    const defaults = getRouteDefaults(shipmentRows);
    setForm((current) => {
      if (current.id || current.standard_km_per_litre.trim() || current.fuel_price_per_litre.trim()) {
        return current;
      }

      return {
        ...current,
        standard_km_per_litre: defaults.kmPerLitre,
        fuel_price_per_litre: defaults.fuelPrice
      };
    });
    setDefaultsReady(true);
    return defaults;
  }, []);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [driverRows, shipmentRows] = await Promise.all([fetchDrivers(), fetchShipments()]);
      setDrivers(driverRows);
      setShipments(shipmentRows);
      applyDefaultsToFreshForm(shipmentRows);
    } catch (loadError) {
      console.error(loadError);
      setError(labels.loadError);
    } finally {
      setLoading(false);
    }
  }, [applyDefaultsToFreshForm, labels.loadError]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    const handleDataChanged = () => {
      void loadData();
    };

    window.addEventListener("fuel-bank:data-changed", handleDataChanged);
    return () => window.removeEventListener("fuel-bank:data-changed", handleDataChanged);
  }, [loadData]);

  useEffect(() => {
    if (!selectedDriver) return;
    setForm((current) => ({
      ...current,
      vehicle_reg: normalizeVehicleRegistration(selectedDriver.vehicle_reg) || current.vehicle_reg,
      vehicle_type: selectedDriver.vehicle_type || current.vehicle_type,
      standard_km_per_litre:
        formatInputNumber(
          shipments.find(
            (shipment) =>
              normalizeVehicleRegistration(shipment.vehicle_reg) ===
                normalizeVehicleRegistration(selectedDriver.vehicle_reg) &&
              shipment.standard_km_per_litre != null
          )?.standard_km_per_litre,
          2
        ) || current.standard_km_per_litre
    }));
  }, [selectedDriver, shipments]);

  useEffect(() => {
    setCurrentPage(1);
  }, [deferredSearchTerm, endDateFilter, selectedDriverFilter, selectedVehicleFilter, startDateFilter, statusFilter]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (form.standard_km_per_litre.trim()) {
      window.localStorage.setItem(STORAGE_KEYS.kmPerLitre, form.standard_km_per_litre.trim());
    }
  }, [form.standard_km_per_litre]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (form.fuel_price_per_litre.trim()) {
      window.localStorage.setItem(STORAGE_KEYS.fuelPrice, form.fuel_price_per_litre.trim());
    }
  }, [form.fuel_price_per_litre]);

  const resetForm = useCallback(() => {
    const defaults = getRouteDefaults(shipments);
    setForm(createInitialForm(defaults.kmPerLitre, defaults.fuelPrice));
    setError(null);
    setSuccessMessage(null);
    setDistanceMessage(null);
    setLastEstimatedRouteKey("");
  }, [shipments]);

  const estimateRoute = useCallback(async () => {
    const origin = form.route_start_location.trim();
    const pickup = form.start_location.trim();
    const mainDropoff = form.end_location.trim();
    const routeStops = [
      pickup,
      mainDropoff,
      ...form.additional_dropoffs.map((stop) => stop.trim()).filter(Boolean)
    ];
    const destination = form.include_return_to_start ? origin : routeStops[routeStops.length - 1];
    const waypoints = form.include_return_to_start ? routeStops : routeStops.slice(0, -1);

    if (!origin || !pickup || !mainDropoff) {
      throw new Error(labels.routeKeyMissing);
    }

    const originKey = normalizeLocationKey(origin);
    const destinationKey = normalizeLocationKey(
      [...waypoints, destination, form.include_return_to_start ? "return" : "oneway"].join(" | ")
    );
    const cached = await fetchRouteDistanceEstimate(originKey, destinationKey).catch(() => null);

    if (cached?.distance_km != null) {
      const durationMinutes =
        cached.duration_seconds != null ? Math.max(1, Math.round(cached.duration_seconds / 60)) : null;

      setForm((current) => ({
        ...current,
        estimated_distance_km: formatInputNumber(Number(cached.distance_km), 1),
        estimated_duration_minutes:
          durationMinutes != null ? String(durationMinutes) : current.estimated_duration_minutes,
        cost_estimation_status: "ready",
        cost_estimation_note: labels.routeReady
      }));
      setLastEstimatedRouteKey(currentRouteKey);
      setDistanceMessage(labels.routeReady);
      return;
    }

    const result = await fetchJson<{
      distanceKm?: number;
      durationSeconds?: number | null;
      provider?: string;
      distanceMeters?: number | null;
    }>("/api/distance-estimate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ origin, destination, waypoints })
    });

    if (result.data?.distanceKm == null) {
      throw new Error(labels.routeKeyMissing);
    }

    const distanceKm = result.data.distanceKm;
    const durationMinutes =
      result.data.durationSeconds != null
        ? Math.max(1, Math.round(result.data.durationSeconds / 60))
        : null;

    setForm((current) => ({
      ...current,
      estimated_distance_km: formatInputNumber(distanceKm, 1),
      estimated_duration_minutes:
        durationMinutes != null ? String(durationMinutes) : current.estimated_duration_minutes,
      cost_estimation_status: "ready",
      cost_estimation_note: labels.routeReady
    }));
    setLastEstimatedRouteKey(currentRouteKey);
    setDistanceMessage(labels.routeReady);

    await saveRouteDistanceEstimate({
      origin_location: origin,
      destination_location: destination,
      origin_key: originKey,
      destination_key: destinationKey,
      distance_km: distanceKm,
      duration_seconds: result.data.durationSeconds ?? null,
      distance_meters: result.data.distanceMeters ?? null,
      provider: result.data.provider ?? "routes_api"
    }).catch(() => undefined);
  }, [
    currentRouteKey,
    form.additional_dropoffs,
    form.end_location,
    form.include_return_to_start,
    form.route_start_location,
    form.start_location,
    labels.routeKeyMissing,
    labels.routeReady
  ]);

  const handleEstimateRoute = useCallback(async () => {
    try {
      setEstimating(true);
      setError(null);
      await estimateRoute();
    } catch (estimateError) {
      console.error(estimateError);
      setError(estimateError instanceof Error ? estimateError.message : labels.routeKeyMissing);
    } finally {
      setEstimating(false);
    }
  }, [estimateRoute, labels.routeKeyMissing]);

  const startEditingShipment = useCallback((shipment: ShipmentWithDriver) => {
    const normalized = normalizeShipment(shipment);
    const defaults = getRouteDefaults(shipments);
    const status = STATUS_OPTIONS.some((option) => option.value === normalized.status)
      ? normalized.status
      : "Draft";
    const nextForm: FormState = {
      id: normalized.id,
      job_reference: normalized.jobReference,
      customer_name: normalized.customerName,
      goods_description: normalized.jobDescription,
      shipment_date: toDateInputValue(normalized.shipmentDate) || today(),
      route_start_location: normalized.startRoute,
      start_location: normalized.pickupLocation,
      end_location: normalized.dropoffLocation,
      include_return_to_start: normalized.returnToStart,
      additional_dropoffs: normalized.additionalDropoffs,
      estimated_distance_km: formatInputNumber(normalized.distanceKm, 1),
      estimated_duration_minutes: formatInputNumber(normalized.durationMinutes, 0),
      vehicle_type: normalized.vehicleType,
      standard_km_per_litre:
        formatInputNumber(shipment.standard_km_per_litre, 2) || defaults.kmPerLitre,
      fuel_price_per_litre:
        formatInputNumber(normalized.fuelPricePerLitre, 2) || defaults.fuelPrice,
      toll_estimate: formatInputNumber(normalized.tolls, 2),
      parking_cost: formatInputNumber(normalized.parkingCost, 2),
      driver_allowance: formatInputNumber(normalized.driverCost, 2),
      margin_percent: formatInputNumber(normalized.markupPercent, 2),
      final_quote_price: formatInputNumber(normalized.finalQuote, 2),
      weight: normalized.cargo.weight,
      pallets: normalized.cargo.pallets,
      width: normalized.cargo.width,
      length: normalized.cargo.length,
      height: normalized.cargo.height,
      cargo_type: normalized.cargo.cargoType,
      driver_id: normalized.driverId,
      vehicle_reg: normalized.vehicleReg,
      notes: normalized.notes,
      status: status as FormState["status"],
      cost_estimation_status: normalized.costEstimationStatus,
      cost_estimation_note: normalized.costEstimationNote
    };

    setForm(nextForm);
    setLastEstimatedRouteKey(buildFormRouteKey(nextForm));
    setDistanceMessage(null);
    setError(null);
    setSuccessMessage(null);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [shipments]);

  const handleDeleteShipment = useCallback(
    async (id: string) => {
      if (!window.confirm(labels.deleteConfirm)) {
        return;
      }

      try {
        await deleteShipment(id);
        setSuccessMessage(labels.shipmentUpdated);
        await loadData();
      } catch (deleteError) {
        console.error(deleteError);
        setError(labels.deleteError);
      }
    },
    [labels.deleteConfirm, labels.deleteError, labels.shipmentUpdated, loadData]
  );

  const generateQuotePdfFromForm = useCallback((variant: QuotePdfVariant) => {
    const routeSummary = shortenRouteLabel(form.start_location, form.end_location);
    openQuotePdfWindow(
      {
        jobReference: form.job_reference.trim(),
        customerName: form.customer_name.trim(),
        shipmentDate: toDateInputValue(form.shipment_date) || today(),
        pickupLocation: form.start_location.trim(),
        dropoffLocation: form.end_location.trim(),
        additionalDropoffs: form.additional_dropoffs.map((stop) => stop.trim()).filter(Boolean),
        routeSummary,
        distanceKm: estimatedDistanceKm,
        durationMinutes: estimatedDurationMinutes,
        vehicleType: form.vehicle_type.trim(),
        goodsDescription: form.goods_description.trim() || form.cargo_type.trim(),
        weight: form.weight.trim(),
        pallets: form.pallets.trim(),
        dimensions:
          [form.width.trim(), form.length.trim(), form.height.trim()].filter(Boolean).length === 3
            ? `${form.width.trim()} x ${form.length.trim()} x ${form.height.trim()} cm`
            : "",
        fuelEfficiencyKmPerLitre: kmPerLitre,
        fuelPricePerLitre,
        estimatedFuelLitres,
        fuelCalculationBasis,
        fuelCost: estimatedFuelCost,
        driverCost,
        tolls: tollEstimate,
        parkingCost,
        operatingCost: totalEstimatedJobCost > 0 ? totalEstimatedJobCost : null,
        quotePrice: finalQuotePrice > 0 ? finalQuotePrice : null,
        profit: expectedProfit,
        marginPercent: expectedMarginPercent,
        status: form.status,
        notes: form.notes.trim()
      },
      variant,
      language
    );
  }, [
    driverCost,
    estimatedDistanceKm,
    estimatedDurationMinutes,
    estimatedFuelCost,
    expectedMarginPercent,
    expectedProfit,
    finalQuotePrice,
    fuelCalculationBasis,
    fuelPricePerLitre,
    form.additional_dropoffs,
    form.cargo_type,
    form.customer_name,
    form.end_location,
    form.goods_description,
    form.height,
    form.job_reference,
    form.length,
    form.notes,
    form.pallets,
    form.shipment_date,
    form.start_location,
    form.status,
    form.vehicle_type,
    form.weight,
    form.width,
    kmPerLitre,
    parkingCost,
    tollEstimate,
    totalEstimatedJobCost,
    estimatedFuelLitres,
    language
  ]);

  const generateQuotePdfFromShipment = useCallback((shipment: ShipmentWithDriver, variant: QuotePdfVariant) => {
    const normalized = normalizeShipment(shipment);
    const route = buildNormalizedShipmentRouteLabel(normalized);
    openQuotePdfWindow(
      {
        jobReference: normalized.jobReference,
        customerName: normalized.customerName,
        shipmentDate: toDateInputValue(normalized.shipmentDate) || today(),
        pickupLocation: normalized.pickupLocation,
        dropoffLocation: normalized.dropoffLocation,
        additionalDropoffs: normalized.additionalDropoffs,
        routeSummary: shortenRouteLabel(route.start, route.end),
        distanceKm: normalized.distanceKm,
        durationMinutes: normalized.durationMinutes,
        vehicleType: normalized.vehicleType,
        goodsDescription: normalized.jobDescription,
        weight: normalized.cargo.weight,
        pallets: normalized.cargo.pallets,
        dimensions:
          [normalized.cargo.width, normalized.cargo.length, normalized.cargo.height].filter(Boolean)
            .length === 3
            ? `${normalized.cargo.width} x ${normalized.cargo.length} x ${normalized.cargo.height} cm`
            : "",
        fuelEfficiencyKmPerLitre:
          shipment.standard_km_per_litre != null ? Number(shipment.standard_km_per_litre) : null,
        fuelPricePerLitre:
          shipment.fuel_price_per_litre != null
            ? Number(shipment.fuel_price_per_litre)
            : shipment.diesel_price != null
              ? Number(shipment.diesel_price)
              : null,
        estimatedFuelLitres: normalized.estimatedFuelLitres,
        fuelCalculationBasis: buildFuelCalculationBasis({
          distanceKm: normalized.distanceKm,
          fuelEfficiencyKmPerLitre:
            shipment.standard_km_per_litre != null ? Number(shipment.standard_km_per_litre) : null,
          fuelPricePerLitre:
            shipment.fuel_price_per_litre != null
              ? Number(shipment.fuel_price_per_litre)
              : shipment.diesel_price != null
                ? Number(shipment.diesel_price)
                : null,
          estimatedFuelLitres: normalized.estimatedFuelLitres,
          fuelCost: normalized.fuelCost,
          language
        }),
        fuelCost: normalized.fuelCost,
        driverCost: normalized.driverCost,
        tolls: normalized.tolls,
        parkingCost: normalized.parkingCost,
        operatingCost: normalized.operatingCost,
        quotePrice: normalized.quotePrice,
        profit: normalized.profit,
        marginPercent: normalized.marginPercent,
        status: normalized.status,
        notes: normalized.notes
      },
      variant,
      language
    );
  }, [language]);

  const handleGenerateFormPdf = useCallback(
    (variant: QuotePdfVariant) => {
      try {
        setError(null);
        generateQuotePdfFromForm(variant);
      } catch (pdfError) {
        console.error("PDF generation failed:", pdfError);
        setError(pdfError instanceof Error ? pdfError.message : labels.validation.pdfGenerationError);
      }
    },
    [generateQuotePdfFromForm, labels.validation.pdfGenerationError]
  );

  const handleGenerateShipmentPdf = useCallback(
    (shipment: ShipmentWithDriver, variant: QuotePdfVariant) => {
      try {
        setError(null);
        generateQuotePdfFromShipment(shipment, variant);
      } catch (pdfError) {
        console.error("PDF generation failed:", pdfError);
        setError(pdfError instanceof Error ? pdfError.message : labels.validation.pdfGenerationError);
      }
    },
    [generateQuotePdfFromShipment, labels.validation.pdfGenerationError]
  );

  const canSave =
    Boolean(form.job_reference.trim()) &&
    Boolean(form.route_start_location.trim()) &&
    Boolean(form.start_location.trim()) &&
    Boolean(form.end_location.trim()) &&
    (Boolean(form.estimated_distance_km.trim()) || googleMapsConfigured === false);

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
      const requestedStatus = submitter?.dataset.status as ShipmentStatus | undefined;

      const distanceValue = parseNumber(form.estimated_distance_km);
      const durationValue = parseNumber(form.estimated_duration_minutes);
      const kmPerLitreValue = parseNumber(form.standard_km_per_litre);
      const fuelPriceValue = parseNumber(form.fuel_price_per_litre);

      if (!form.job_reference.trim()) {
        setError(labels.validation.jobReferenceRequired);
        return;
      }

      if (!form.route_start_location.trim()) {
        setError(labels.validation.startRouteRequired);
        return;
      }

      if (!form.start_location.trim() || !form.end_location.trim()) {
        setError(labels.validation.pickupDropoffRequired);
        return;
      }

      if (!toDateInputValue(form.shipment_date)) {
        setError(labels.validation.quoteDateRequired);
        return;
      }

      if (distanceValue == null || distanceValue <= 0) {
        setError(labels.validation.routeEstimateRequired);
        return;
      }

      if (durationValue == null || durationValue <= 0) {
        setError(labels.validation.routeEstimateRequired);
        return;
      }

      if (kmPerLitreValue == null) {
        setError(labels.validation.enterFuelEfficiencyToCalculate);
        return;
      }

      if (kmPerLitreValue <= 0) {
        setError(labels.validation.fuelEfficiencyInvalid);
        return;
      }

      if (fuelPriceValue == null || fuelPriceValue <= 0) {
        setError(labels.validation.fuelPriceRequired);
        return;
      }

      try {
        setSaving(true);
        setError(null);
        const additionalDropoffs = form.additional_dropoffs.map((stop) => stop.trim()).filter(Boolean);
        const statusToSave =
          requestedStatus === "Draft"
            ? "Draft"
            : form.id
              ? form.status
              : requestedStatus ?? "Quoted";

        const cargoDetails = [
          form.weight.trim() ? `${labels.weight}: ${form.weight.trim()}` : "",
          form.pallets.trim() ? `${labels.pallets}: ${form.pallets.trim()}` : "",
          form.width.trim() ? `${labels.width}: ${form.width.trim()}` : "",
          form.length.trim() ? `${labels.length}: ${form.length.trim()}` : "",
          form.height.trim() ? `${labels.height}: ${form.height.trim()}` : "",
          form.cargo_type.trim() ? `${labels.cargoType}: ${form.cargo_type.trim()}` : ""
        ].filter(Boolean);

        await saveShipment({
          id: form.id || undefined,
          job_reference: form.job_reference.trim(),
          customer_name: form.customer_name.trim() || null,
          goods_description: form.goods_description.trim() || form.cargo_type.trim() || null,
          shipment_date: toDateInputValue(form.shipment_date) || today(),
          start_location: form.route_start_location.trim(),
          end_location: form.route_start_location.trim(),
          pickup_location: form.start_location.trim(),
          dropoff_location: form.end_location.trim(),
          estimated_distance_km: distanceValue,
          total_distance_km: distanceValue,
          total_operational_distance_km: distanceValue,
          quoted_distance_km: distanceValue,
          vehicle_type: form.vehicle_type.trim() || null,
          standard_km_per_litre: parseNumber(form.standard_km_per_litre),
          estimated_fuel_litres: estimatedFuelLitres,
          fuel_price_per_litre: fuelPriceValue,
          diesel_price: fuelPriceValue,
          estimated_fuel_cost: estimatedFuelCost,
          fuel_cost: estimatedFuelCost,
          estimated_fuel_cost_thb: estimatedFuelCost,
          toll_estimate: parseNumber(form.toll_estimate),
          toll_cost: parseNumber(form.toll_estimate),
          driver_cost: parseNumber(form.driver_allowance),
          subtotal_cost: totalEstimatedJobCost,
          margin_percent: marginPercent,
          quoted_price: recommendedQuotePrice,
          final_price: finalQuotePrice,
          driver_id: form.driver_id || null,
          vehicle_reg: form.vehicle_reg.trim() || null,
          status: statusToSave,
          notes:
            [
              form.notes.trim(),
              additionalDropoffs.length
                ? `${labels.additionalDropoffs}: ${additionalDropoffs.join(" | ")}`
                : "",
              cargoDetails.length ? `${labels.cargoType}: ${cargoDetails.join("; ")}` : "",
              `${labels.startRoute}: ${form.route_start_location.trim()}`,
              `${labels.totalTravelTime}: ${durationValue}`,
              `${labels.parking}: ${parkingCost}`,
              `${labels.returnToStart}: ${
                form.include_return_to_start ? (language === "th" ? "ใช่" : "Yes") : language === "th" ? "ไม่" : "No"
              }`
            ]
              .filter(Boolean)
              .join("\n") || null,
          cost_estimation_status: form.cost_estimation_status,
          cost_estimation_note: routeEstimateStale ? labels.routeChanged : form.cost_estimation_note
        });

        setSuccessMessage(form.id ? labels.shipmentUpdated : labels.shipmentSaved);
        resetForm();
        await loadData();
      } catch (saveError) {
        console.error("Shipment save failed:", saveError);
        setError(getShipmentSaveErrorMessage(saveError, labels));
      } finally {
        setSaving(false);
      }
    },
    [
      estimatedFuelCost,
      estimatedFuelLitres,
      finalQuotePrice,
      form,
      labels,
      language,
      loadData,
      marginPercent,
      parkingCost,
      recommendedQuotePrice,
      resetForm,
      routeEstimateStale,
      totalEstimatedJobCost
    ]
  );

  const filteredShipments = useMemo(() => {
    const searchFiltered = filterShipments(shipments, deferredSearchTerm);
    return searchFiltered.filter((shipment) => {
      const normalized = normalizeShipment(shipment);
      const shipmentDateValue = toDateInputValue(normalized.shipmentDate);
      if (selectedDriverFilter && String(shipment.driver_id ?? "") !== selectedDriverFilter) {
        return false;
      }

      if (
        selectedVehicleFilter &&
        normalizeVehicleRegistration(normalized.vehicleReg) !== selectedVehicleFilter
      ) {
        return false;
      }

      if (statusFilter && normalized.status !== statusFilter) {
        return false;
      }

      if (startDateFilter && shipmentDateValue < startDateFilter) {
        return false;
      }

      if (endDateFilter && shipmentDateValue > endDateFilter) {
        return false;
      }

      return true;
    });
  }, [
    deferredSearchTerm,
    endDateFilter,
    selectedDriverFilter,
    selectedVehicleFilter,
    shipments,
    startDateFilter,
    statusFilter
  ]);

  const vehicleOptions = useMemo(
    () =>
      Array.from(
        new Set(
          shipments
            .map((shipment) => normalizeVehicleRegistration(normalizeShipment(shipment).vehicleReg))
            .filter(Boolean)
        )
      ),
    [shipments]
  );

  const summary = useMemo(() => {
    const todayKey = today();
    const activeJobs = filteredShipments.filter(
      (shipment) => {
        const normalized = normalizeShipment(shipment);
        const shipmentDateValue = toDateInputValue(normalized.shipmentDate);
        return (
          shipmentDateValue === todayKey ||
          ["Draft", "Quoted", "Confirmed", "In Progress", "Delivered"].includes(
            normalized.status
          )
        );
      }
    ).length;

    return {
      totalJobs: filteredShipments.length,
      totalDistance: filteredShipments.reduce(
        (sum, shipment) => sum + Number(normalizeShipment(shipment).distanceKm ?? 0),
        0
      ),
      estimatedFuelCost: filteredShipments.reduce(
        (sum, shipment) => sum + Number(normalizeShipment(shipment).fuelCost ?? 0),
        0
      ),
      estimatedJobCost: filteredShipments.reduce(
        (sum, shipment) => sum + Number(getEstimatedJobCost(shipment) ?? 0),
        0
      ),
      totalRevenue: filteredShipments.reduce(
        (sum, shipment) => sum + Number(getShipmentQuote(shipment) ?? 0),
        0
      ),
      totalProfit: filteredShipments.reduce(
        (sum, shipment) => sum + Number(getShipmentProfit(shipment) ?? 0),
        0
      ),
      averageMargin:
        filteredShipments.reduce((sum, shipment) => {
          const margin = normalizeShipment(shipment).marginPercent;
          return margin != null ? sum + margin : sum;
        }, 0) /
        Math.max(
          1,
          filteredShipments.filter((shipment) => normalizeShipment(shipment).marginPercent != null)
            .length
        ),
      activeJobs
    };
  }, [filteredShipments]);

  const statCards = useMemo(() => {
    const hasJobs = filteredShipments.length > 0;
    return [
      {
        label: labels.totalJobs,
        value: formatNumber(summary.totalJobs, language),
        helper: hasJobs ? labels.summaryJobsHelper : labels.summaryHelper,
        icon: <Package className="h-4.5 w-4.5" />
      },
      {
        label: labels.totalDistance,
        value: `${formatNumber(summary.totalDistance, language, 1)} km`,
        helper: hasJobs ? labels.summaryDistanceHelper : labels.summaryHelper,
        icon: <MapPinned className="h-4.5 w-4.5" />
      },
      {
        label: labels.totalOperatingCost,
        value: formatCurrency(summary.estimatedJobCost, language),
        helper: hasJobs ? labels.summaryOperatingCostHelper : labels.summaryHelper,
        icon: <Fuel className="h-4.5 w-4.5" />
      },
      {
        label: labels.totalQuoteValue,
        value: formatCurrency(summary.totalRevenue, language),
        helper: hasJobs ? labels.summaryQuoteValueHelper : labels.summaryHelper,
        icon: <Wallet className="h-4.5 w-4.5" />
      },
      {
        label: labels.totalProfit,
        value: formatCurrency(summary.totalProfit, language),
        helper: hasJobs ? labels.summaryProfitHelper : labels.summaryHelper,
        icon: <CheckCircle2 className="h-4.5 w-4.5" />
      },
      {
        label: labels.averageMargin,
        value: `${formatNumber(summary.averageMargin, language, 1)}%`,
        helper: hasJobs ? labels.summaryAverageMarginHelper : labels.summaryHelper,
        icon: <CalendarClock className="h-4.5 w-4.5" />
      }
    ];
  }, [filteredShipments.length, labels, language, summary]);

  const totalPages = Math.max(1, Math.ceil(filteredShipments.length / PAGE_SIZE));
  const pagedShipments = filteredShipments.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  );
  const pagedShipmentRows = useMemo(
    () =>
      pagedShipments.map((shipment) => {
        const normalized = normalizeShipment(shipment);
        return {
          shipment,
          normalized,
          route: buildNormalizedShipmentRouteLabel(normalized)
        };
      }),
    [pagedShipments]
  );

  const exportCsv = useCallback(() => {
    const headers = [
      labels.export.headers.jobReference,
      labels.export.headers.customer,
      labels.export.headers.pickup,
      labels.export.headers.destination,
      labels.export.headers.distanceKm,
      labels.export.headers.driver,
      labels.export.headers.vehicle,
      labels.export.headers.totalCost,
      labels.export.headers.quotePrice,
      labels.export.headers.profit,
      labels.export.headers.marginPercent,
      labels.export.headers.status,
      labels.export.headers.date
    ];
    const rows = filteredShipments.map((shipment) => {
      const normalized = normalizeShipment(shipment);
      return [
        normalized.jobReference,
        normalized.customerName,
        normalized.pickupLocation,
        normalized.dropoffLocation,
        String(normalized.distanceKm ?? ""),
        normalized.driverName,
        normalized.vehicleReg,
        String(normalized.operatingCost ?? ""),
        String(normalized.quotePrice ?? ""),
        String(normalized.profit ?? ""),
        String(normalized.marginPercent ?? ""),
        normalized.status,
        normalized.shipmentDate
      ];
    });
    const csv = [headers, ...rows]
      .map((row) =>
        row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")
      )
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `shipments-${today()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }, [filteredShipments, labels]);

  return (
    <>
      <GoogleMapsLoader />

      <div className="mb-6 hidden md:block">
        <Header title={labels.title} description={labels.description} />
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {statCards.map((card) => (
          <StatCard
            key={card.label}
            label={card.label}
            value={card.value}
            helper={card.helper}
            icon={card.icon}
          />
        ))}
      </div>

      <section ref={formRef} className="mt-4 surface-card overflow-hidden p-4 sm:p-5">
        <div className="absolute inset-x-0 top-0 h-28 bg-[linear-gradient(135deg,rgba(15,118,110,0.08),rgba(249,115,22,0.04)_55%,transparent)]" />
        <div className="relative">
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h3 className="section-title">{form.id ? labels.updateJob : labels.createJob}</h3>
              <p className="section-subtitle">{labels.routeDescription}</p>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-teal-100 bg-teal-50 px-3 py-1.5 text-xs font-semibold text-teal-700">
              <Truck className="h-4 w-4" />
              {formatDate(form.shipment_date, language)}
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            <SectionCard title={labels.routeTitle} description={labels.routeDescription}>
              <div className="grid gap-3 lg:grid-cols-[1fr_1fr_auto]">
                <LocationAutocomplete
                  label={labels.startRoute}
                  value={form.route_start_location}
                  onChange={(value) => {
                    setForm((current) => ({ ...current, route_start_location: value }));
                    setDistanceMessage(null);
                  }}
                  required
                  language={language}
                  configMissingMessage={labels.autocompleteUnavailable}
                  helperText={labels.startRouteHelper}
                  loadingText={labels.loadingSuggestions}
                  onConfigurationChange={setGoogleMapsConfigured}
                />
                <LocationAutocomplete
                  label={labels.pickup}
                  value={form.start_location}
                  onChange={(value) => {
                    setForm((current) => ({ ...current, start_location: value }));
                    setDistanceMessage(null);
                  }}
                  required
                  language={language}
                  configMissingMessage={labels.autocompleteUnavailable}
                  helperText={labels.autocompleteHelper}
                  loadingText={labels.loadingSuggestions}
                  onConfigurationChange={setGoogleMapsConfigured}
                />
                <LocationAutocomplete
                  label={labels.dropoff}
                  value={form.end_location}
                  onChange={(value) => {
                    setForm((current) => ({ ...current, end_location: value }));
                    setDistanceMessage(null);
                  }}
                  required
                  language={language}
                  configMissingMessage={labels.autocompleteUnavailable}
                  helperText={labels.autocompleteHelper}
                  loadingText={labels.loadingSuggestions}
                  onConfigurationChange={setGoogleMapsConfigured}
                />
                <div className="form-field justify-end lg:col-span-3">
                  <label className="form-label opacity-0">{labels.estimateRoute}</label>
                  <button
                    type="button"
                    onClick={() => void handleEstimateRoute()}
                    disabled={estimating}
                    className="btn-primary w-full gap-2 lg:min-w-[220px]"
                  >
                    <MapPinned className="h-4 w-4" />
                    {estimating ? labels.estimating : labels.estimateRoute}
                  </button>
                </div>
              </div>

              <div className="mt-3 rounded-[1.25rem] border border-slate-200 bg-white/90 p-3.5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-slate-950">{labels.additionalDropoffs}</p>
                    <p className="text-xs leading-5 text-slate-500">
                      {labels.additionalDropoffsHelper}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setForm((current) => ({
                        ...current,
                        additional_dropoffs: [...current.additional_dropoffs, ""]
                      }))
                    }
                    className="btn-secondary min-h-[44px] gap-2 rounded-[1rem] px-4"
                  >
                    <Plus className="h-4 w-4" />
                    {labels.addDropoff}
                  </button>
                </div>

                {form.additional_dropoffs.length ? (
                  <div className="mt-3 grid gap-3">
                    {form.additional_dropoffs.map((stop, index) => (
                      <div key={index} className="grid gap-2 sm:grid-cols-[1fr_auto]">
                        <LocationAutocomplete
                          label={`Drop-off ${index + 2}`}
                          value={stop}
                          onChange={(value) => {
                            setForm((current) => ({
                              ...current,
                              additional_dropoffs: current.additional_dropoffs.map((item, itemIndex) =>
                                itemIndex === index ? value : item
                              )
                            }));
                            setDistanceMessage(null);
                          }}
                          language={language}
                          configMissingMessage={labels.autocompleteUnavailable}
                          helperText={labels.autocompleteHelper}
                          loadingText={labels.loadingSuggestions}
                          onConfigurationChange={setGoogleMapsConfigured}
                        />
                        <div className="flex items-end">
                          <button
                            type="button"
                            onClick={() =>
                              setForm((current) => ({
                                ...current,
                                additional_dropoffs: current.additional_dropoffs.filter(
                                  (_, itemIndex) => itemIndex !== index
                                )
                              }))
                            }
                            className="btn-secondary min-h-[56px] w-full gap-2 rounded-[1rem] px-4 sm:w-auto"
                          >
                            <X className="h-4 w-4" />
                            {labels.remove}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>

              <label className="mt-3 flex cursor-pointer items-center justify-between gap-4 rounded-[1.15rem] border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-800 shadow-[0_8px_20px_rgba(15,23,42,0.04)]">
                <span>
                  {labels.returnToStart}
                  <span className="mt-0.5 block text-xs font-medium text-slate-500">
                    {labels.returnToStartHelper}
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={form.include_return_to_start}
                  onChange={(event) => {
                    setForm((current) => ({
                      ...current,
                      include_return_to_start: event.target.checked
                    }));
                    setDistanceMessage(null);
                  }}
                  className="h-5 w-5 rounded border-slate-300 p-0"
                />
              </label>

              <div className="mt-3 rounded-[1.35rem] border border-slate-200 bg-[linear-gradient(135deg,#ffffff_0%,#f5fbfa_48%,#fff7ed_100%)] p-3.5 sm:p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                      {labels.routeSummary}
                    </p>
                    <p className="mt-2 text-sm text-slate-600">
                      {routeEstimateStale
                        ? labels.routeChanged
                        : distanceMessage ?? labels.routeSummaryHint}
                    </p>
                  </div>
                  {googleMapsConfigured === false ? (
                    <div className="w-full max-w-[220px]">
                      <label className="form-label">{labels.manualDistance}</label>
                      <input
                        value={form.estimated_distance_km}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            estimated_distance_km: event.target.value,
                            cost_estimation_status: "ready"
                          }))
                        }
                        className="form-input bg-white"
                        inputMode="decimal"
                      />
                    </div>
                  ) : null}
                </div>

                <div className="mt-3 grid gap-3 lg:grid-cols-3">
                  <div className="rounded-[1.15rem] border border-teal-100 bg-white p-4 shadow-[0_12px_28px_rgba(15,118,110,0.08)]">
                    <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-teal-700">{labels.totalDistance}</p>
                    <p className="mt-1.5 text-2xl font-semibold tracking-normal text-slate-950">
                      {formatDistance(estimatedDistanceKm, language, labels.distanceUnavailable)}
                    </p>
                  </div>
                  <div className="rounded-[1.15rem] border border-sky-100 bg-white p-4 shadow-[0_12px_28px_rgba(14,165,233,0.08)]">
                    <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-sky-700">{labels.totalTravelTime}</p>
                    <p className="mt-1.5 text-2xl font-semibold tracking-normal text-slate-950">
                      {formatDuration(
                        estimatedDurationMinutes,
                        language,
                        labels.durationUnavailable
                      )}
                    </p>
                  </div>
                  <div className="rounded-[1.15rem] border border-amber-100 bg-white p-4 shadow-[0_12px_28px_rgba(245,158,11,0.1)]">
                    <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-amber-700">{labels.estimatedFuelCost}</p>
                    <p className="mt-1.5 text-2xl font-semibold tracking-normal text-slate-950">
                      {estimatedFuelCost != null
                        ? formatCurrency(estimatedFuelCost, language)
                        : labels.costUnavailable}
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold text-slate-600">
                  <span className="rounded-full border border-slate-200 bg-white px-3 py-1">
                    {labels.stops}: {formatNumber(2 + form.additional_dropoffs.filter(Boolean).length, language)}
                  </span>
                  {form.include_return_to_start ? (
                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-700">
                      {labels.returnToStartIncluded}
                    </span>
                  ) : null}
                </div>
              </div>
            </SectionCard>

            <div className="grid gap-3 xl:grid-cols-[1.15fr_0.85fr]">
              <SectionCard title={labels.costTitle} description={labels.costDescription}>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="form-field">
                    <label className="form-label">{labels.fuelEfficiency}</label>
                    <input
                      value={form.standard_km_per_litre}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          standard_km_per_litre: event.target.value
                        }))
                      }
                      className="form-input bg-white"
                      inputMode="decimal"
                    />
                    <p className="form-helper">{fuelCalculationHelperText}</p>
                  </div>
                  <div className="form-field">
                    <label className="form-label">{labels.fuelPrice}</label>
                    <input
                      value={form.fuel_price_per_litre}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          fuel_price_per_litre: event.target.value
                        }))
                      }
                      className="form-input bg-white"
                      inputMode="decimal"
                    />
                  </div>
                  <div className="form-field">
                    <label className="form-label">{labels.tolls}</label>
                    <input
                      value={form.toll_estimate}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, toll_estimate: event.target.value }))
                      }
                      className="form-input bg-white"
                      inputMode="decimal"
                    />
                  </div>
                  <div className="form-field">
                    <label className="form-label">{labels.parking}</label>
                    <input
                      value={form.parking_cost}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, parking_cost: event.target.value }))
                      }
                      className="form-input bg-white"
                      inputMode="decimal"
                    />
                  </div>
                  <div className="form-field">
                    <label className="form-label">{labels.driverCost}</label>
                    <input
                      value={form.driver_allowance}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, driver_allowance: event.target.value }))
                      }
                      className="form-input bg-white"
                      inputMode="decimal"
                    />
                  </div>
                  <div className="form-field">
                    <label className="form-label">{labels.optionalMarkup}</label>
                    <input
                      value={form.margin_percent}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, margin_percent: event.target.value }))
                      }
                      className="form-input bg-white"
                      inputMode="decimal"
                    />
                  </div>
                </div>

                <p className="form-helper mt-3">
                  {labels.fuelAutoFillHelper}
                </p>

                <div className="mt-3 rounded-[1.15rem] border border-slate-200 bg-slate-50/80 p-3.5">
                  <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                    {labels.fuelCalculationBasis}
                  </p>
                  <p className="mt-2 text-sm font-semibold text-slate-900">{fuelCalculationBasis}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {labels.fuelCalculationExplanation}
                  </p>
                </div>

                <div className="mt-3 grid gap-3 sm:grid-cols-3 xl:grid-cols-4">
                  <div className="subtle-panel p-3.5">
                    <p className="metric-label">{labels.fuelEfficiency}</p>
                    <p className="mt-2 text-[1.2rem] font-semibold text-slate-950">
                      {kmPerLitre != null && kmPerLitre > 0
                        ? `${formatNumber(kmPerLitre, language, 2)} KM/L`
                        : labels.validation.enterFuelEfficiencyToCalculate}
                    </p>
                  </div>
                  <div className="subtle-panel p-3.5">
                    <p className="metric-label">{labels.fuelLitres}</p>
                    <p className="mt-2 text-[1.2rem] font-semibold text-slate-950">
                      {estimatedFuelLitres != null
                        ? `${formatNumber(estimatedFuelLitres, language, 2)} L`
                        : labels.validation.enterFuelEfficiencyToCalculate}
                    </p>
                  </div>
                  <div className="subtle-panel p-3.5">
                    <p className="metric-label">{labels.fuelCost}</p>
                    <p className="mt-2 text-[1.2rem] font-semibold text-slate-950">
                      {estimatedFuelCost != null
                        ? formatCurrency(estimatedFuelCost, language)
                        : labels.validation.enterFuelEfficiencyToCalculate}
                    </p>
                  </div>
                  <div className="rounded-[1.2rem] border border-teal-100 bg-[linear-gradient(135deg,#ecfeff_0%,#ffffff_45%,#fff7ed_100%)] p-3.5">
                    <p className="metric-label">{labels.totalCost}</p>
                    <p className="mt-2 text-[1.45rem] font-semibold tracking-[-0.04em] text-slate-950">
                      {totalEstimatedJobCost > 0
                        ? formatCurrency(totalEstimatedJobCost, language)
                        : labels.costUnavailable}
                    </p>
                  </div>
                </div>

                <div className="mt-3 rounded-[1.35rem] border border-slate-900/10 bg-slate-950 p-3.5 text-white shadow-[0_22px_48px_rgba(15,23,42,0.18)] transition duration-300 hover:-translate-y-0.5 sm:p-4 xl:sticky xl:top-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-300">
                        {labels.operatingCostSummary}
                      </p>
                      <p className="mt-1 text-sm text-slate-300">
                        {labels.operatingCostSummaryDescription}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                    {[
                      { label: labels.totalDistance, value: estimatedDistanceKm, valueClass: "text-white", type: "distance" },
                      { label: labels.fuelEfficiency, value: kmPerLitre, valueClass: "text-sky-100", type: "efficiency" },
                      { label: labels.fuelPrice, value: fuelPricePerLitre, valueClass: "text-amber-200", type: "money" },
                      { label: labels.fuelLitres, value: estimatedFuelLitres, valueClass: "text-sky-100", type: "litres" },
                      { label: labels.totalTravelTime, value: estimatedDurationMinutes, valueClass: "text-white", type: "duration" },
                      { label: labels.fuelCost, value: estimatedFuelCost, valueClass: "text-amber-200", type: "money" },
                      { label: labels.totalCost, value: totalEstimatedJobCost > 0 ? totalEstimatedJobCost : null, valueClass: "text-white", type: "money" },
                      { label: labels.finalCustomerQuote, value: finalQuotePrice > 0 ? finalQuotePrice : null, valueClass: "text-emerald-200", type: "money" },
                      { label: labels.expectedProfit, value: expectedProfit, valueClass: "text-emerald-200", type: "money" },
                      { label: labels.expectedMargin, value: expectedMarginPercent, valueClass: "text-emerald-100", type: "percent" }
                    ].map(({ label, value, valueClass, type }) => {
                      const numericValue = typeof value === "number" ? value : null;

                      return (
                        <div key={label} className="rounded-[1rem] border border-white/10 bg-white/[0.06] p-3">
                          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
                            {label}
                          </p>
                          <p className={`mt-1.5 truncate text-xl font-semibold tracking-normal ${valueClass}`}>
                            {type === "distance"
                              ? formatDistance(numericValue, language, labels.distanceUnavailable)
                              : type === "efficiency"
                                ? numericValue != null && numericValue > 0
                                  ? `${formatNumber(numericValue, language, 2)} KM/L`
                                  : labels.validation.enterFuelEfficiencyToCalculate
                              : type === "litres"
                                ? numericValue != null
                                  ? `${formatNumber(numericValue, language, 2)} L`
                                  : labels.validation.enterFuelEfficiencyToCalculate
                              : type === "duration"
                                ? formatDuration(numericValue, language, labels.durationUnavailable)
                                : type === "percent"
                                  ? numericValue != null
                                    ? `${formatNumber(numericValue, language, 1)}%`
                                    : EMPTY_VALUE
                                : numericValue != null
                                  ? formatCurrency(numericValue, language)
                                  : EMPTY_VALUE}
                          </p>
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-4 rounded-[1rem] border border-white/10 bg-white/[0.04] p-3">
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
                      {labels.fuelCalculationBasis}
                    </p>
                    <p className="mt-2 text-sm font-semibold text-slate-100">{fuelCalculationBasis}</p>
                  </div>

                  <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
                    <div className="rounded-[1rem] border border-white/10 bg-white/[0.04] p-3">
                      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
                        {labels.systemRecommendedQuote}
                      </p>
                      <p className="mt-2 text-xl font-semibold text-slate-100">
                        {formatCurrency(recommendedQuotePrice, language)}
                      </p>
                    </div>
                    <div className="rounded-[1rem] border border-emerald-300/30 bg-emerald-400/10 p-3">
                      <label className="text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-100">
                        {labels.finalQuoteSentToCustomer}
                      </label>
                      <input
                        value={form.final_quote_price}
                        onChange={(event) =>
                          setForm((current) => ({ ...current, final_quote_price: event.target.value }))
                        }
                        placeholder={formatInputNumber(recommendedQuotePrice, 2)}
                        className="mt-2 min-h-[48px] rounded-[0.95rem] border-white/10 bg-white text-lg font-semibold text-slate-950"
                        inputMode="decimal"
                      />
                    </div>
                  </div>
                </div>
              </SectionCard>

              <div className="space-y-3">
                <SectionCard
                  title={labels.jobDetailsTitle}
                  description={labels.jobDetailsDescription}
                >
                  <div className="grid gap-3">
                    <div className="form-field">
                      <label className="form-label form-label-required">{labels.shipmentDate}</label>
                      <input
                        type="date"
                        value={form.shipment_date}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            shipment_date: event.target.value
                          }))
                        }
                        className="form-input bg-white"
                        required
                      />
                      <p className="form-helper">
                        {labels.shipmentDateHelper}
                      </p>
                    </div>
                    <div className="form-field">
                      <label className="form-label form-label-required">{labels.shipmentRef}</label>
                      <input
                        value={form.job_reference}
                        onChange={(event) =>
                          setForm((current) => ({ ...current, job_reference: event.target.value }))
                        }
                        className="form-input bg-white"
                        required
                      />
                    </div>
                    <div className="form-field">
                      <label className="form-label">{labels.customer}</label>
                      <input
                        value={form.customer_name}
                        onChange={(event) =>
                          setForm((current) => ({ ...current, customer_name: event.target.value }))
                        }
                        list="shipment-customer-memory"
                        className="form-input bg-white"
                      />
                      <datalist id="shipment-customer-memory">
                        {customerOptions.map((customer) => (
                          <option key={customer} value={customer} />
                        ))}
                      </datalist>
                      {recentCustomerQuotes.length ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {recentCustomerQuotes.map((quote) => (
                            <span
                              key={quote.ref}
                              className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold text-slate-600"
                            >
                              {quote.ref}:{" "}
                              {quote.quote != null ? formatCurrency(quote.quote, language) : EMPTY_VALUE}
                              {quote.margin != null
                                ? ` / ${formatNumber(quote.margin, language, 1)}%`
                                : ""}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <div className="form-field">
                      <label className="form-label">{labels.goods}</label>
                      <textarea
                        value={form.goods_description}
                        onChange={(event) =>
                          setForm((current) => ({ ...current, goods_description: event.target.value }))
                        }
                        rows={3}
                        className="form-textarea bg-white"
                      />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="form-field">
                      <label className="form-label">{labels.weight}</label>
                        <input
                          value={form.weight}
                          onChange={(event) =>
                            setForm((current) => ({ ...current, weight: event.target.value }))
                          }
                          className="form-input bg-white"
                          inputMode="decimal"
                        />
                      </div>
                      <div className="form-field">
                      <label className="form-label">{labels.pallets}</label>
                        <input
                          value={form.pallets}
                          onChange={(event) =>
                            setForm((current) => ({ ...current, pallets: event.target.value }))
                          }
                          className="form-input bg-white"
                          inputMode="numeric"
                        />
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="form-field">
                      <label className="form-label">{labels.width}</label>
                        <input
                          value={form.width}
                          onChange={(event) =>
                            setForm((current) => ({ ...current, width: event.target.value }))
                          }
                          className="form-input bg-white"
                          inputMode="decimal"
                        />
                      </div>
                      <div className="form-field">
                      <label className="form-label">{labels.length}</label>
                        <input
                          value={form.length}
                          onChange={(event) =>
                            setForm((current) => ({ ...current, length: event.target.value }))
                          }
                          className="form-input bg-white"
                          inputMode="decimal"
                        />
                      </div>
                      <div className="form-field">
                      <label className="form-label">{labels.height}</label>
                        <input
                          value={form.height}
                          onChange={(event) =>
                            setForm((current) => ({ ...current, height: event.target.value }))
                          }
                          className="form-input bg-white"
                          inputMode="decimal"
                        />
                      </div>
                    </div>
                    <div className="form-field">
                      <label className="form-label">{labels.cargoType}</label>
                      <input
                        value={form.cargo_type}
                        onChange={(event) =>
                          setForm((current) => ({ ...current, cargo_type: event.target.value }))
                        }
                        className="form-input bg-white"
                      />
                    </div>
                    <div className="form-field">
                      <label className="form-label">{labels.status}</label>
                      <select
                        value={form.status}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            status: event.target.value as ShipmentStatus
                          }))
                        }
                        className="form-input bg-white"
                      >
                        {STATUS_OPTIONS.map((status) => (
                          <option key={status.value} value={status.value}>
                            {getStatusLabel(status.value, labels)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="form-field">
                      <label className="form-label">{labels.notes}</label>
                      <textarea
                        value={form.notes}
                        onChange={(event) =>
                          setForm((current) => ({ ...current, notes: event.target.value }))
                        }
                        rows={3}
                        className="form-textarea bg-white"
                      />
                    </div>
                  </div>
                </SectionCard>

                <SectionCard
                  title={labels.assignmentTitle}
                  description={labels.assignmentDescription}
                >
                  <div className="grid gap-3">
                    <div className="form-field">
                      <label className="form-label">{labels.driver}</label>
                      <select
                        value={form.driver_id}
                        onChange={(event) =>
                          setForm((current) => ({ ...current, driver_id: event.target.value }))
                        }
                        className="form-input bg-white"
                      >
                        <option value="">{labels.selectDriver}</option>
                        {drivers.map((driver) => (
                          <option key={driver.id} value={String(driver.id)}>
                            {driver.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="form-field">
                      <label className="form-label">{labels.vehicle}</label>
                      <input
                        value={form.vehicle_reg}
                        onChange={(event) =>
                          setForm((current) => ({ ...current, vehicle_reg: event.target.value }))
                        }
                        className="form-input bg-white"
                      />
                    </div>
                    <div className="form-field">
                      <label className="form-label">{labels.vehicleType}</label>
                      <input
                        value={form.vehicle_type}
                        onChange={(event) =>
                          setForm((current) => ({ ...current, vehicle_type: event.target.value }))
                        }
                        className="form-input bg-white"
                      />
                    </div>
                  </div>
                </SectionCard>
              </div>
            </div>

            {error ? <p className="form-error">{error}</p> : null}
            {successMessage ? <p className="text-sm text-emerald-600">{successMessage}</p> : null}

            <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
              <button
                type="submit"
                data-status="Quoted"
                disabled={!canSave || saving || !defaultsReady}
                className="btn-primary min-w-[180px] disabled:opacity-70"
              >
                {saving ? labels.saving : labels.saveShipment}
              </button>
              <button
                type="submit"
                data-status="Draft"
                disabled={!canSave || saving || !defaultsReady}
                className="btn-secondary min-w-[160px] disabled:opacity-70"
              >
                {labels.saveAsDraft}
              </button>
              <button
                type="button"
                className="btn-secondary min-w-[180px] gap-2 disabled:opacity-70"
                onClick={() => handleGenerateFormPdf("customer")}
                disabled={!form.job_reference.trim()}
                title={labels.customerPdf}
              >
                <FileText className="h-4 w-4" />
                {labels.customerPdf}
              </button>
              <button
                type="button"
                className="btn-secondary min-w-[180px] gap-2 disabled:opacity-70"
                onClick={() => handleGenerateFormPdf("internal")}
                disabled={!form.job_reference.trim()}
                title={labels.internalPdf}
              >
                <FileText className="h-4 w-4" />
                {labels.internalPdf}
              </button>
              {form.id ? (
                <button type="button" onClick={resetForm} className="btn-secondary">
                  {labels.cancel}
                </button>
              ) : null}
            </div>
          </form>
        </div>
      </section>

      <section className="mt-4 surface-card p-4 sm:p-5">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="section-title">{labels.tableTitle}</h3>
            <p className="section-subtitle">{labels.tableDescription}</p>
          </div>
          <div className="relative w-full lg:max-w-[360px]">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder={labels.searchPlaceholder}
              className="form-input bg-white pl-11"
            />
          </div>
          <button type="button" onClick={exportCsv} className="btn-secondary gap-2">
            <Download className="h-4 w-4" />
            {labels.exportCsv}
          </button>
        </div>

        <div className="mb-4 subtle-panel p-3.5">
          <div className="grid gap-3 md:grid-cols-5">
            <div className="form-field">
              <label className="form-label">{labels.filterStatus}</label>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className="form-input bg-white"
              >
                <option value="">{labels.allStatuses}</option>
                {STATUS_OPTIONS.map((status) => (
                  <option key={status.value} value={status.value}>
                    {getStatusLabel(status.value, labels)}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-field">
              <label className="form-label">{labels.filterDriver}</label>
              <select
                value={selectedDriverFilter}
                onChange={(event) => setSelectedDriverFilter(event.target.value)}
                className="form-input bg-white"
              >
                <option value="">{labels.allDrivers}</option>
                {drivers.map((driver) => (
                  <option key={driver.id} value={String(driver.id)}>
                    {driver.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-field">
              <label className="form-label">{labels.filterVehicle}</label>
              <select
                value={selectedVehicleFilter}
                onChange={(event) => setSelectedVehicleFilter(event.target.value)}
                className="form-input bg-white"
              >
                <option value="">{labels.allVehicles}</option>
                {vehicleOptions.map((vehicle) => (
                  <option key={vehicle} value={vehicle}>
                    {vehicle}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-field">
              <label className="form-label">{labels.filterFromDate}</label>
              <input
                type="date"
                value={startDateFilter}
                onChange={(event) => setStartDateFilter(event.target.value)}
                className="form-input bg-white"
              />
            </div>
            <div className="form-field">
              <label className="form-label">{labels.filterToDate}</label>
              <input
                type="date"
                value={endDateFilter}
                onChange={(event) => setEndDateFilter(event.target.value)}
                className="form-input bg-white"
              />
            </div>
          </div>

          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={() => {
                setStatusFilter("");
                setSelectedDriverFilter("");
                setSelectedVehicleFilter("");
                setStartDateFilter("");
                setEndDateFilter("");
              }}
              className="btn-secondary gap-2"
            >
              <TimerReset className="h-4 w-4" />
              {labels.resetFilters}
            </button>
          </div>
        </div>

        {loading ? (
          <EmptyState title={labels.loading} description={labels.tableDescription} />
        ) : filteredShipments.length === 0 ? (
          <EmptyState title={labels.noShipments} description={labels.noShipmentsDescription} />
        ) : (
          <>
            <div className="space-y-3 md:hidden">
              {pagedShipmentRows.map(({ shipment, normalized, route }) => (
                <article key={shipment.id} className="subtle-panel p-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">
                        {normalized.jobReference}
                      </p>
                      <p className="mt-1 text-sm text-slate-500">
                        {normalized.customerName || EMPTY_VALUE}
                      </p>
                    </div>
                    <span
                      className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${getStatusBadgeClass(normalized.status)}`}
                    >
                      {getStatusLabel(normalized.status, labels)}
                    </span>
                  </div>

                  <div className="mt-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                      {labels.table.route}
                    </p>
                    <p className="mt-1 text-sm font-medium text-slate-900">
                      {shortenRouteLabel(route.start, route.end)}
                    </p>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                        {labels.table.distance}
                      </p>
                      <p className="mt-1 text-sm font-semibold text-slate-950">
                        {formatDistance(
                          normalized.distanceKm,
                          language,
                          labels.distanceUnavailable
                        )}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                        {labels.table.cost}
                      </p>
                      <p className="mt-1 text-sm font-semibold text-slate-950">
                        {normalized.operatingCost != null
                          ? formatCurrency(normalized.operatingCost, language)
                          : EMPTY_VALUE}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                        {labels.table.driver}
                      </p>
                      <p className="mt-1 text-sm font-medium text-slate-900">
                        {normalized.driverName || EMPTY_VALUE}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                        {labels.table.vehicle}
                      </p>
                      <p className="mt-1 text-sm font-medium text-slate-900">
                        {normalized.vehicleReg || EMPTY_VALUE}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                      {labels.table.quote}
                      </p>
                      <p className="mt-1 text-sm font-semibold text-slate-950">
                        {normalized.quotePrice != null
                          ? formatCurrency(normalized.quotePrice, language)
                          : EMPTY_VALUE}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                      {labels.table.profit}
                      </p>
                      <p className="mt-1 text-sm font-semibold text-emerald-700">
                        {normalized.profit != null
                          ? formatCurrency(normalized.profit, language)
                          : EMPTY_VALUE}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                        {labels.table.margin}
                      </p>
                      <p className="mt-1 text-sm font-semibold text-slate-950">
                        {normalized.marginPercent != null
                          ? `${formatNumber(normalized.marginPercent, language, 1)}%`
                          : EMPTY_VALUE}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 flex gap-2">
                    <button
                      type="button"
                      className="btn-secondary w-full"
                      onClick={() => startEditingShipment(shipment)}
                    >
                      {labels.edit}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary w-full"
                      onClick={() => handleGenerateShipmentPdf(shipment, "customer")}
                    >
                      {labels.customerPdf}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary w-full"
                      onClick={() => handleGenerateShipmentPdf(shipment, "internal")}
                    >
                      {labels.internalPdf}
                    </button>
                    <button
                      type="button"
                      className="btn-danger w-full"
                      onClick={() => void handleDeleteShipment(shipment.id)}
                    >
                      {labels.delete}
                    </button>
                  </div>
                </article>
              ))}
            </div>

            <div className="hidden md:block">
              <div className="table-shell rounded-2xl">
                <div className="table-scroll">
                  <table className="w-full min-w-[1420px] text-sm">
                    <thead>
                      <tr>
                        <th className="table-head-cell">{labels.table.ref}</th>
                        <th className="table-head-cell">{labels.table.customer}</th>
                        <th className="table-head-cell">{labels.table.route}</th>
                        <th className="table-head-cell text-right">{labels.table.distance}</th>
                        <th className="table-head-cell">{labels.table.driver}</th>
                        <th className="table-head-cell">{labels.table.vehicle}</th>
                        <th className="table-head-cell text-right">{labels.table.cost}</th>
                        <th className="table-head-cell text-right">{labels.table.quote}</th>
                        <th className="table-head-cell text-right">{labels.table.profit}</th>
                        <th className="table-head-cell text-right">{labels.table.margin}</th>
                        <th className="table-head-cell">{labels.table.status}</th>
                        <th className="table-head-cell">{labels.table.date}</th>
                        <th className="table-head-cell">{labels.table.action}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedShipmentRows.map(({ shipment, normalized, route }) => (
                        <tr key={shipment.id} className="enterprise-table-row">
                          <td className="table-body-cell font-medium text-slate-900">
                            <p>{normalized.jobReference}</p>
                            <p className="mt-1 text-xs text-slate-500">
                              {normalized.jobDescription || EMPTY_VALUE}
                            </p>
                          </td>
                          <td className="table-body-cell">{normalized.customerName || EMPTY_VALUE}</td>
                          <td className="table-body-cell">
                            {shortenRouteLabel(route.start, route.end)}
                          </td>
                          <td className="table-body-cell text-right">
                            <span className="inline-flex rounded-full border border-teal-100 bg-teal-50 px-2.5 py-1 text-xs font-bold text-teal-800">
                              {formatDistance(normalized.distanceKm, language, EMPTY_VALUE)}
                            </span>
                          </td>
                          <td className="table-body-cell">{normalized.driverName || EMPTY_VALUE}</td>
                          <td className="table-body-cell">{normalized.vehicleReg || EMPTY_VALUE}</td>
                          <td className="table-body-cell text-right text-base font-bold text-slate-950">
                            {normalized.operatingCost != null
                              ? formatCurrency(normalized.operatingCost, language)
                              : EMPTY_VALUE}
                          </td>
                          <td className="table-body-cell text-right text-base font-bold text-slate-950">
                            {normalized.quotePrice != null
                              ? formatCurrency(normalized.quotePrice, language)
                              : EMPTY_VALUE}
                          </td>
                          <td className="table-body-cell text-right text-base font-bold text-emerald-700">
                            {normalized.profit != null
                              ? formatCurrency(normalized.profit, language)
                              : EMPTY_VALUE}
                          </td>
                          <td className="table-body-cell text-right text-base font-bold text-slate-950">
                            {normalized.marginPercent != null
                              ? `${formatNumber(normalized.marginPercent, language, 1)}%`
                              : EMPTY_VALUE}
                          </td>
                          <td className="table-body-cell">
                            <span
                              className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${getStatusBadgeClass(normalized.status)}`}
                            >
                              {getStatusLabel(normalized.status, labels)}
                            </span>
                          </td>
                          <td className="table-body-cell">
                            {formatDate(normalized.shipmentDate, language)}
                          </td>
                          <td className="table-body-cell">
                            <div className="flex gap-2">
                              <button
                                type="button"
                                className="table-action-secondary"
                                onClick={() => startEditingShipment(shipment)}
                              >
                                {labels.edit}
                              </button>
                              <button
                                type="button"
                                className="table-action-secondary"
                                onClick={() => handleGenerateShipmentPdf(shipment, "customer")}
                              >
                                {labels.customerPdf}
                              </button>
                              <button
                                type="button"
                                className="table-action-secondary"
                                onClick={() => handleGenerateShipmentPdf(shipment, "internal")}
                              >
                                {labels.internalPdf}
                              </button>
                              <button
                                type="button"
                                className="table-action-danger"
                                onClick={() => void handleDeleteShipment(shipment.id)}
                              >
                                {labels.delete}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="mt-5 flex items-center justify-between">
              <p className="text-sm text-slate-500">
                {labels.page} {formatNumber(Math.min(currentPage, totalPages), language)} {labels.of}{" "}
                {formatNumber(totalPages, language)}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                  disabled={currentPage === 1}
                  className="btn-secondary disabled:opacity-50"
                >
                  {labels.previous}
                </button>
                <button
                  type="button"
                  onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                  disabled={currentPage >= totalPages}
                  className="btn-secondary disabled:opacity-50"
                >
                  {labels.next}
                </button>
              </div>
            </div>
          </>
        )}
      </section>
    </>
  );
}
