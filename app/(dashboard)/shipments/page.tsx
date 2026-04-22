"use client";

import {
  CalendarClock,
  Fuel,
  MapPinned,
  Package,
  Search,
  TimerReset,
  Truck,
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
import { buildShipmentRouteKey, filterShipments } from "@/lib/shipment-estimation";
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
const STORAGE_KEYS = {
  kmPerLitre: "fuel-bank:shipments:last-km-per-litre",
  fuelPrice: "fuel-bank:shipments:last-fuel-price"
} as const;

const STATUS_OPTIONS = [
  { value: "Draft", label: { en: "Draft", th: "ฉบับร่าง" } },
  { value: "Quoted", label: { en: "Estimated", th: "ประเมินแล้ว" } },
  { value: "Assigned", label: { en: "Assigned", th: "มอบหมายแล้ว" } },
  { value: "Accepted", label: { en: "Approved", th: "อนุมัติแล้ว" } }
] as const;

type FormState = {
  id: string;
  job_reference: string;
  customer_name: string;
  goods_description: string;
  shipment_date: string;
  start_location: string;
  end_location: string;
  estimated_distance_km: string;
  estimated_duration_minutes: string;
  standard_km_per_litre: string;
  fuel_price_per_litre: string;
  toll_estimate: string;
  other_costs: string;
  driver_cost: string;
  driver_id: string;
  vehicle_reg: string;
  notes: string;
  status: "Draft" | "Quoted" | "Assigned" | "Accepted";
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
    start_location: "",
    end_location: "",
    estimated_distance_km: "",
    estimated_duration_minutes: "",
    standard_km_per_litre: defaultKmPerLitre,
    fuel_price_per_litre: defaultFuelPrice,
    toll_estimate: "",
    other_costs: "",
    driver_cost: "",
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
    otherCosts: "Parking / other costs",
    driverCost: "Driver / helper cost",
    fuelLitres: "Estimated fuel litres",
    fuelCost: "Fuel cost",
    totalCost: "Total Job Cost",
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
    otherCosts: "ค่าจอด / ค่าใช้จ่ายอื่น",
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
    <section className="rounded-[1.6rem] border border-slate-200/80 bg-white p-4 shadow-[0_18px_40px_-34px_rgba(15,23,42,0.45)] sm:p-5">
      <div className="mb-4">
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

function getStatusLabel(value: string | null | undefined, language: "en" | "th") {
  const option = STATUS_OPTIONS.find((status) => status.value === value);
  return option ? option.label[language] : value || STATUS_OPTIONS[0].label[language];
}

function getStatusBadgeClass(status: string | null | undefined) {
  switch (status) {
    case "Assigned":
      return "border-sky-200 bg-sky-50 text-sky-700";
    case "Accepted":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "Quoted":
      return "border-amber-200 bg-amber-50 text-amber-700";
    default:
      return "border-slate-200 bg-slate-100 text-slate-700";
  }
}

function getEstimatedJobCost(shipment: ShipmentWithDriver) {
  const explicitTotal = shipment.final_price ?? shipment.quoted_price ?? shipment.subtotal_cost;
  if (explicitTotal != null) {
    return explicitTotal;
  }

  const fallbackTotal =
    Number(
      shipment.estimated_fuel_cost ?? shipment.fuel_cost ?? shipment.estimated_fuel_cost_thb ?? 0
    ) +
    Number(shipment.toll_estimate ?? shipment.toll_cost ?? 0) +
    Number(shipment.other_costs ?? 0) +
    Number(shipment.driver_cost ?? 0);

  return fallbackTotal > 0 ? fallbackTotal : null;
}

function shortenRouteLabel(startLocation: string, endLocation: string) {
  const shorten = (value: string) => {
    const cleaned = value.trim();
    if (!cleaned) return "-";
    const parts = cleaned.split(",").map((part) => part.trim()).filter(Boolean);
    const first = parts[0] || cleaned;
    return first.length > 28 ? `${first.slice(0, 28)}...` : first;
  };

  return `${shorten(startLocation)} -> ${shorten(endLocation)}`;
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
  const labels = copy[language];
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
  const otherCosts = useMemo(() => parseNumber(form.other_costs) ?? 0, [form.other_costs]);
  const driverCost = useMemo(() => parseNumber(form.driver_cost) ?? 0, [form.driver_cost]);

  const estimatedFuelLitres = useMemo(() => {
    if (estimatedDistanceKm == null || kmPerLitre == null || kmPerLitre <= 0) {
      return null;
    }

    return estimatedDistanceKm / kmPerLitre;
  }, [estimatedDistanceKm, kmPerLitre]);

  const estimatedFuelCost = useMemo(() => {
    if (estimatedFuelLitres == null || fuelPricePerLitre == null) {
      return null;
    }

    return estimatedFuelLitres * fuelPricePerLitre;
  }, [estimatedFuelLitres, fuelPricePerLitre]);

  const totalEstimatedJobCost = useMemo(() => {
    return (estimatedFuelCost ?? 0) + tollEstimate + otherCosts + driverCost;
  }, [driverCost, estimatedFuelCost, otherCosts, tollEstimate]);

  const currentRouteKey = useMemo(
    () => buildShipmentRouteKey(form.start_location, form.end_location),
    [form.end_location, form.start_location]
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
    if (selectedDriver?.vehicle_reg) {
      setForm((current) => ({
        ...current,
        vehicle_reg: current.vehicle_reg || normalizeVehicleRegistration(selectedDriver.vehicle_reg)
      }));
    }
  }, [selectedDriver]);

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
    const origin = form.start_location.trim();
    const destination = form.end_location.trim();

    if (!origin || !destination) {
      throw new Error(labels.routeKeyMissing);
    }

    const originKey = normalizeLocationKey(origin);
    const destinationKey = normalizeLocationKey(destination);
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
      body: JSON.stringify({ origin, destination })
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
  }, [currentRouteKey, form.end_location, form.start_location, labels.routeKeyMissing, labels.routeReady]);

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
    setForm({
      id: shipment.id,
      job_reference: shipment.job_reference,
      customer_name: shipment.customer_name ?? "",
      goods_description: shipment.goods_description ?? "",
      shipment_date: shipment.shipment_date,
      start_location: shipment.pickup_location ?? shipment.start_location,
      end_location: shipment.dropoff_location ?? shipment.end_location,
      estimated_distance_km: formatInputNumber(shipment.estimated_distance_km, 1),
      estimated_duration_minutes: "",
      standard_km_per_litre: formatInputNumber(shipment.standard_km_per_litre, 2),
      fuel_price_per_litre: formatInputNumber(
        shipment.fuel_price_per_litre ?? shipment.diesel_price,
        2
      ),
      toll_estimate: formatInputNumber(shipment.toll_estimate ?? shipment.toll_cost, 2),
      other_costs: formatInputNumber(shipment.other_costs, 2),
      driver_cost: formatInputNumber(shipment.driver_cost, 2),
      driver_id: shipment.driver_id ?? "",
      vehicle_reg: shipment.vehicle_reg ?? "",
      notes: shipment.notes ?? "",
      status: (shipment.status ?? "Draft") as FormState["status"],
      cost_estimation_status: shipment.cost_estimation_status ?? "pending",
      cost_estimation_note: shipment.cost_estimation_note ?? ""
    });
    setLastEstimatedRouteKey(
      buildShipmentRouteKey(
        shipment.pickup_location ?? shipment.start_location,
        shipment.dropoff_location ?? shipment.end_location
      )
    );
    setDistanceMessage(null);
    setError(null);
    setSuccessMessage(null);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

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

  const canSave =
    Boolean(form.job_reference.trim()) &&
    Boolean(form.start_location.trim()) &&
    Boolean(form.end_location.trim()) &&
    (Boolean(form.estimated_distance_km.trim()) || googleMapsConfigured === false);

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (!form.estimated_distance_km.trim() && googleMapsConfigured !== false) {
        setError(labels.estimateRequired);
        return;
      }

      try {
        setSaving(true);
        setError(null);

        await saveShipment({
          id: form.id || undefined,
          job_reference: form.job_reference.trim(),
          customer_name: form.customer_name.trim() || null,
          goods_description: form.goods_description.trim() || null,
          shipment_date: form.shipment_date,
          start_location: form.start_location.trim(),
          end_location: form.end_location.trim(),
          pickup_location: form.start_location.trim(),
          dropoff_location: form.end_location.trim(),
          estimated_distance_km: parseNumber(form.estimated_distance_km),
          standard_km_per_litre: parseNumber(form.standard_km_per_litre),
          estimated_fuel_litres: estimatedFuelLitres,
          fuel_price_per_litre: parseNumber(form.fuel_price_per_litre),
          diesel_price: parseNumber(form.fuel_price_per_litre),
          estimated_fuel_cost: estimatedFuelCost,
          fuel_cost: estimatedFuelCost,
          estimated_fuel_cost_thb: estimatedFuelCost,
          toll_estimate: parseNumber(form.toll_estimate),
          other_costs: parseNumber(form.other_costs),
          driver_cost: parseNumber(form.driver_cost),
          subtotal_cost: totalEstimatedJobCost,
          final_price: totalEstimatedJobCost,
          quoted_price: totalEstimatedJobCost,
          driver_id: form.driver_id || null,
          vehicle_reg: form.vehicle_reg.trim() || null,
          status: form.id ? form.status : (form.driver_id ? "Assigned" : "Draft"),
          notes: form.notes.trim() || null,
          cost_estimation_status: form.cost_estimation_status,
          cost_estimation_note: routeEstimateStale ? labels.routeChanged : form.cost_estimation_note
        });

        setSuccessMessage(form.id ? labels.shipmentUpdated : labels.shipmentSaved);
        resetForm();
        await loadData();
      } catch (saveError) {
        console.error(saveError);
        if (saveError instanceof Error && saveError.message === "DUPLICATE_SHIPMENT_REFERENCE") {
          setError(labels.duplicateShipment);
        } else {
          setError(labels.saveError);
        }
      } finally {
        setSaving(false);
      }
    },
    [
      estimatedFuelCost,
      estimatedFuelLitres,
      form,
      googleMapsConfigured,
      labels.duplicateShipment,
      labels.estimateRequired,
      labels.routeChanged,
      labels.saveError,
      labels.shipmentSaved,
      labels.shipmentUpdated,
      loadData,
      resetForm,
      routeEstimateStale,
      totalEstimatedJobCost
    ]
  );

  const filteredShipments = useMemo(() => {
    const searchFiltered = filterShipments(shipments, deferredSearchTerm);
    return searchFiltered.filter((shipment) => {
      if (selectedDriverFilter && String(shipment.driver_id ?? "") !== selectedDriverFilter) {
        return false;
      }

      if (
        selectedVehicleFilter &&
        normalizeVehicleRegistration(shipment.vehicle_reg) !== selectedVehicleFilter
      ) {
        return false;
      }

      if (statusFilter && String(shipment.status ?? "Draft") !== statusFilter) {
        return false;
      }

      if (startDateFilter && shipment.shipment_date < startDateFilter) {
        return false;
      }

      if (endDateFilter && shipment.shipment_date > endDateFilter) {
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
        new Set(shipments.map((shipment) => normalizeVehicleRegistration(shipment.vehicle_reg)).filter(Boolean))
      ),
    [shipments]
  );

  const summary = useMemo(() => {
    const todayKey = today();
    const activeJobs = filteredShipments.filter(
      (shipment) => shipment.shipment_date === todayKey || shipment.status !== "Accepted"
    ).length;

    return {
      totalJobs: filteredShipments.length,
      totalDistance: filteredShipments.reduce(
        (sum, shipment) => sum + Number(shipment.estimated_distance_km ?? 0),
        0
      ),
      estimatedFuelCost: filteredShipments.reduce(
        (sum, shipment) =>
          sum +
          Number(
            shipment.estimated_fuel_cost ?? shipment.fuel_cost ?? shipment.estimated_fuel_cost_thb ?? 0
          ),
        0
      ),
      estimatedJobCost: filteredShipments.reduce(
        (sum, shipment) => sum + Number(getEstimatedJobCost(shipment) ?? 0),
        0
      ),
      activeJobs
    };
  }, [filteredShipments]);

  const statCards = useMemo(() => {
    const hasJobs = filteredShipments.length > 0;
    return [
      {
        label: labels.totalJobs,
        value: hasJobs ? formatNumber(summary.totalJobs, language) : labels.summaryEmptyJobs,
        helper: hasJobs ? labels.summaryJobsHelper : labels.summaryHelper,
        icon: <Package className="h-4.5 w-4.5" />
      },
      {
        label: labels.totalDistance,
        value: hasJobs
          ? `${formatNumber(summary.totalDistance, language, 1)} km`
          : labels.summaryEmptyDistance,
        helper: hasJobs ? labels.summaryDistanceHelper : labels.summaryHelper,
        icon: <MapPinned className="h-4.5 w-4.5" />
      },
      {
        label: labels.estimatedFuelCost,
        value: hasJobs ? formatCurrency(summary.estimatedFuelCost, language) : labels.summaryEmptyFuel,
        helper: hasJobs ? labels.summaryFuelHelper : labels.summaryHelper,
        icon: <Fuel className="h-4.5 w-4.5" />
      },
      {
        label: labels.estimatedJobCost,
        value: hasJobs ? formatCurrency(summary.estimatedJobCost, language) : labels.summaryEmptyCost,
        helper: hasJobs ? labels.summaryCostHelper : labels.summaryHelper,
        icon: <Wallet className="h-4.5 w-4.5" />
      },
      {
        label: labels.jobsToday,
        value: hasJobs ? formatNumber(summary.activeJobs, language) : labels.summaryEmptyActive,
        helper: hasJobs ? labels.summaryActiveHelper : labels.summaryHelper,
        icon: <CalendarClock className="h-4.5 w-4.5" />
      }
    ];
  }, [filteredShipments.length, labels, language, summary]);

  const totalPages = Math.max(1, Math.ceil(filteredShipments.length / PAGE_SIZE));
  const pagedShipments = filteredShipments.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  );

  return (
    <>
      <GoogleMapsLoader />

      <div className="mb-6 hidden md:block">
        <Header title={labels.title} description={labels.description} />
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
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

      <section ref={formRef} className="mt-5 surface-card overflow-hidden p-5 sm:p-6">
        <div className="absolute inset-x-0 top-0 h-28 bg-[linear-gradient(135deg,rgba(15,118,110,0.08),rgba(249,115,22,0.04)_55%,transparent)]" />
        <div className="relative">
          <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h3 className="section-title">{form.id ? labels.updateJob : labels.createJob}</h3>
              <p className="section-subtitle">{labels.routeDescription}</p>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-teal-100 bg-teal-50 px-3 py-1.5 text-xs font-semibold text-teal-700">
              <Truck className="h-4 w-4" />
              {formatDate(form.shipment_date, language)}
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <SectionCard title={labels.routeTitle} description={labels.routeDescription}>
              <div className="grid gap-3 lg:grid-cols-[1fr_1fr_auto]">
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
                <div className="form-field justify-end">
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

              <div className="mt-4 rounded-[1.6rem] border border-slate-200 bg-[linear-gradient(135deg,#ffffff_0%,#f5fbfa_48%,#fff7ed_100%)] p-4 sm:p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
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

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-[1.35rem] border border-slate-200 bg-white p-4">
                    <p className="metric-label">{labels.distance}</p>
                    <p className="mt-2 text-[1.7rem] font-semibold tracking-[-0.04em] text-slate-950">
                      {formatDistance(estimatedDistanceKm, language, labels.distanceUnavailable)}
                    </p>
                  </div>
                  <div className="rounded-[1.35rem] border border-slate-200 bg-white p-4">
                    <p className="metric-label">{labels.duration}</p>
                    <p className="mt-2 text-[1.7rem] font-semibold tracking-[-0.04em] text-slate-950">
                      {formatDuration(
                        estimatedDurationMinutes,
                        language,
                        labels.durationUnavailable
                      )}
                    </p>
                  </div>
                </div>
              </div>
            </SectionCard>

            <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
              <SectionCard title={labels.costTitle} description={labels.costDescription}>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="form-field">
                    <label className="form-label">{labels.kmPerLitre}</label>
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
                    <label className="form-label">{labels.otherCosts}</label>
                    <input
                      value={form.other_costs}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, other_costs: event.target.value }))
                      }
                      className="form-input bg-white"
                      inputMode="decimal"
                    />
                  </div>
                  <div className="form-field sm:col-span-2">
                    <label className="form-label">{labels.driverCost}</label>
                    <input
                      value={form.driver_cost}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, driver_cost: event.target.value }))
                      }
                      className="form-input bg-white"
                      inputMode="decimal"
                    />
                  </div>
                </div>

                <p className="form-helper mt-3">{labels.defaultsHelper}</p>

                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <div className="subtle-panel p-4">
                    <p className="metric-label">{labels.fuelLitres}</p>
                    <p className="mt-2 text-[1.2rem] font-semibold text-slate-950">
                      {estimatedFuelLitres != null
                        ? `${formatNumber(estimatedFuelLitres, language, 2)} L`
                        : labels.costUnavailable}
                    </p>
                  </div>
                  <div className="subtle-panel p-4">
                    <p className="metric-label">{labels.fuelCost}</p>
                    <p className="mt-2 text-[1.2rem] font-semibold text-slate-950">
                      {estimatedFuelCost != null
                        ? formatCurrency(estimatedFuelCost, language)
                        : labels.costUnavailable}
                    </p>
                  </div>
                  <div className="rounded-[1.4rem] border border-teal-100 bg-[linear-gradient(135deg,#ecfeff_0%,#ffffff_45%,#fff7ed_100%)] p-4">
                    <p className="metric-label">{labels.totalCost}</p>
                    <p className="mt-2 text-[1.45rem] font-semibold tracking-[-0.04em] text-slate-950">
                      {totalEstimatedJobCost > 0
                        ? formatCurrency(totalEstimatedJobCost, language)
                        : labels.costUnavailable}
                    </p>
                  </div>
                </div>
              </SectionCard>

              <div className="space-y-4">
                <SectionCard
                  title={labels.jobDetailsTitle}
                  description={labels.jobDetailsDescription}
                >
                  <div className="grid gap-3">
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
                        className="form-input bg-white"
                      />
                    </div>
                    <div className="form-field">
                      <label className="form-label">{labels.goods}</label>
                      <textarea
                        value={form.goods_description}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            goods_description: event.target.value
                          }))
                        }
                        rows={3}
                        className="form-textarea bg-white"
                      />
                    </div>
                    <div className="form-field">
                      <label className="form-label">{labels.notes}</label>
                      <textarea
                        value={form.notes}
                        onChange={(event) =>
                          setForm((current) => ({ ...current, notes: event.target.value }))
                        }
                        rows={3}
                        placeholder={labels.notesPlaceholder}
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
                  </div>
                </SectionCard>
              </div>
            </div>

            {error ? <p className="form-error">{error}</p> : null}
            {successMessage ? <p className="text-sm text-emerald-600">{successMessage}</p> : null}

            <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
              <button
                type="submit"
                disabled={!canSave || saving || !defaultsReady}
                className="btn-primary min-w-[180px] disabled:opacity-70"
              >
                {saving ? labels.saving : labels.saveShipment}
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

      <section className="mt-5 surface-card p-5 sm:p-6">
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
        </div>

        <div className="mb-5 subtle-panel p-4">
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
                    {status.label[language]}
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
            <div className="space-y-3.5 md:hidden">
              {pagedShipments.map((shipment) => (
                <article key={shipment.id} className="subtle-panel p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">
                        {shipment.job_reference}
                      </p>
                      <p className="mt-1 text-sm text-slate-500">
                        {shipment.customer_name || "-"}
                      </p>
                    </div>
                    <span
                      className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${getStatusBadgeClass(shipment.status)}`}
                    >
                      {getStatusLabel(shipment.status, language)}
                    </span>
                  </div>

                  <div className="mt-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                      {labels.table.route}
                    </p>
                    <p className="mt-1 text-sm font-medium text-slate-900">
                      {shortenRouteLabel(
                        shipment.pickup_location ?? shipment.start_location,
                        shipment.dropoff_location ?? shipment.end_location
                      )}
                    </p>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                        {labels.table.distance}
                      </p>
                      <p className="mt-1 text-sm font-semibold text-slate-950">
                        {formatDistance(
                          shipment.estimated_distance_km,
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
                        {getEstimatedJobCost(shipment) != null
                          ? formatCurrency(Number(getEstimatedJobCost(shipment)), language)
                          : labels.costUnavailable}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                        {labels.table.driver}
                      </p>
                      <p className="mt-1 text-sm font-medium text-slate-900">
                        {shipment.driver || "-"}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                        {labels.table.vehicle}
                      </p>
                      <p className="mt-1 text-sm font-medium text-slate-900">
                        {shipment.vehicle_reg || "-"}
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
                  <table className="w-full min-w-[1100px] text-sm">
                    <thead>
                      <tr>
                        <th className="table-head-cell">{labels.table.ref}</th>
                        <th className="table-head-cell">{labels.table.date}</th>
                        <th className="table-head-cell">{labels.table.customer}</th>
                        <th className="table-head-cell">{labels.table.route}</th>
                        <th className="table-head-cell text-right">{labels.table.distance}</th>
                        <th className="table-head-cell">{labels.table.driver}</th>
                        <th className="table-head-cell">{labels.table.vehicle}</th>
                        <th className="table-head-cell text-right">{labels.table.cost}</th>
                        <th className="table-head-cell">{labels.table.status}</th>
                        <th className="table-head-cell">{labels.table.action}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedShipments.map((shipment) => (
                        <tr key={shipment.id} className="enterprise-table-row">
                          <td className="table-body-cell font-medium text-slate-900">
                            <p>{shipment.job_reference}</p>
                            <p className="mt-1 text-xs text-slate-500">
                              {shipment.goods_description || "-"}
                            </p>
                          </td>
                          <td className="table-body-cell">
                            {formatDate(shipment.shipment_date, language)}
                          </td>
                          <td className="table-body-cell">{shipment.customer_name || "-"}</td>
                          <td className="table-body-cell">
                            {shortenRouteLabel(
                              shipment.pickup_location ?? shipment.start_location,
                              shipment.dropoff_location ?? shipment.end_location
                            )}
                          </td>
                          <td className="table-body-cell text-right">
                            {formatDistance(
                              shipment.estimated_distance_km,
                              language,
                              labels.distanceUnavailable
                            )}
                          </td>
                          <td className="table-body-cell">{shipment.driver || "-"}</td>
                          <td className="table-body-cell">{shipment.vehicle_reg || "-"}</td>
                          <td className="table-body-cell text-right font-semibold text-slate-950">
                            {getEstimatedJobCost(shipment) != null
                              ? formatCurrency(Number(getEstimatedJobCost(shipment)), language)
                              : labels.costUnavailable}
                          </td>
                          <td className="table-body-cell">
                            <span
                              className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${getStatusBadgeClass(shipment.status)}`}
                            >
                              {getStatusLabel(shipment.status, language)}
                            </span>
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
