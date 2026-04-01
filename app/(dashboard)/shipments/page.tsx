"use client";

import {
  Calculator,
  Download,
  MapPinned,
  Package,
  Search,
  Sparkles,
  TrendingUp,
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
  fetchFuelLogs,
  fetchRouteDistanceEstimate,
  fetchShipments,
  fetchWeeklyMileage,
  saveRouteDistanceEstimate,
  saveShipment
} from "@/lib/data";
import {
  buildHistoricalFuelCostBenchmark,
  buildShipmentRouteKey,
  buildShipmentRouteLabel,
  estimateShipmentFuelCost,
  filterShipments
} from "@/lib/shipment-estimation";
import { exportToCsv } from "@/lib/export";
import { useLanguage } from "@/lib/language-provider";
import {
  formatCurrency,
  formatDate,
  formatNumber,
  normalizeLocationKey,
  today
} from "@/lib/utils";
import type {
  Driver,
  FuelLogWithDriver,
  ShipmentWithDriver,
  WeeklyMileageEntry
} from "@/types/database";

const initialForm = {
  id: "",
  job_reference: "",
  driver_id: "",
  vehicle_reg: "",
  shipment_date: today(),
  start_location: "",
  end_location: "",
  estimated_distance_km: "",
  estimated_fuel_cost_thb: "",
  cost_estimation_status: "pending" as "ready" | "pending",
  cost_estimation_note: "",
  notes: ""
};

const copy = {
  en: {
    title: "Shipments",
    description:
      "Estimate likely fuel cost by shipment using Google Maps route distance and your own historical fleet cost per kilometre.",
    benchmark: "Historical Fuel Cost / KM",
    benchmarkHelperReady:
      "Based on the last 90 days of fuel spend and comparable weekly mileage history.",
    benchmarkHelperPending:
      "Distance can still be captured now. Cost estimates appear once enough fuel and mileage history exists.",
    totalWeek: "Estimated Shipment Fuel Cost This Week",
    totalMonth: "Estimated Shipment Fuel Cost This Month",
    averageMonth: "Average Estimated Cost / Shipment",
    mostExpensive: "Most Expensive Shipment",
    shipmentsMonth: "Shipments This Month",
    selectedPeriodSummary: "Shipment cost summary",
    selectedPeriodDescription:
      "A fast management view of estimated fuel cost, shipment volume, and the jobs driving spend this month.",
    selectedPeriodLabel: "Selected period",
    selectedPeriodValue: "This month",
    totalEstimatedLabel: "Total estimated shipment fuel cost",
    shipmentCountLabel: "Number of shipments",
    averageCostLabel: "Average fuel cost per shipment",
    mostExpensiveLabel: "Most expensive shipment",
    benchmarkPanelTitle: "Estimation method",
    benchmarkPanelDescription:
      "A practical management estimate using Google Maps route distance and recent internal operating data.",
    benchmarkPanelDistance: "Comparable mileage distance",
    benchmarkPanelSpend: "Fuel spend in benchmark",
    benchmarkPanelEntries: "Mileage comparisons",
    topDriverTitle: "Top driver this month",
    topRouteTitle: "Highest-cost route this month",
    simpleInsightsTitle: "Management insights",
    simpleInsightsDescription:
      "Simple signals that help management see where shipment fuel cost is concentrated.",
    mostExpensiveInsight: "Most expensive shipment",
    averageShipmentInsight: "Average shipment cost",
    highestCostDriverInsight: "Highest cost driver this period",
    topCostDriver: "Top cost driver",
    lowestCostDriver: "Lowest cost driver",
    driverComparisonTitle: "Driver comparison",
    driverComparisonDescription:
      "Compare total estimated shipment fuel cost by driver for the selected period.",
    topDriverEmpty: "No estimated shipment cost yet this month.",
    topRouteEmpty: "Route trends will appear once shipments are saved.",
    formTitleAdd: "Create shipment",
    formTitleEdit: "Edit shipment",
    editingHint: "You are editing an existing shipment. Update the details below or cancel to add a new shipment.",
    formDescription:
      "Save the shipment once the route distance has been estimated. The fuel cost estimate uses the current fleet benchmark when available.",
    routeSection: "Shipment details",
    routeSectionDescription:
      "Use clear typed locations so Google Maps can return a reliable driving estimate.",
    estimateSection: "Route estimate",
    estimateSectionDescription:
      "The app reuses saved route estimates first to avoid unnecessary Google Maps calls.",
    shipmentId: "Shipment ID / Job reference",
    shipmentDate: "Date",
    driver: "Driver",
    selectDriver: "Select driver",
    vehicle: "Assigned vehicle",
    startLocation: "Start location",
    endLocation: "End location",
    notes: "Notes",
    notesPlaceholder: "Optional delivery context, cargo notes, or route remarks",
    estimateButton: "Estimate distance & cost",
    estimating: "Estimating...",
    distance: "Estimated distance",
    fuelCost: "Estimated fuel cost",
    saveShipment: "Save shipment",
    updateShipment: "Update shipment",
    searchPlaceholder: "Search by shipment ID, driver, or route",
    tableTitle: "Shipment summary",
    tableDescription:
      "Latest shipments first, with route distance and practical estimated fuel cost for management review.",
    noShipments: "No shipments yet",
    noShipmentsDescription:
      "Add your first shipment to start estimating fuel cost by job.",
    distancePending:
      "Distance available. Estimated fuel cost will appear once enough fuel and mileage history has been recorded.",
    distanceSuccess: "Distance estimated successfully.",
    distanceCached: "Saved route distance loaded successfully.",
    costCalculated: "Estimated fuel cost calculated.",
    shipmentSaved: "Shipment saved successfully.",
    shipmentUpdated: "Shipment updated successfully.",
    shipmentDeleted: "Shipment deleted successfully.",
    duplicateShipment: "This shipment ID / job reference already exists.",
    loadError: "Unable to load shipment data.",
    saveError: "Unable to save shipment.",
    deleteError: "Unable to delete shipment.",
    driverRequired: "Select a driver before saving this shipment.",
    noDriversAvailable: "No drivers available — add drivers first",
    driverLoadError: "Unable to load drivers right now.",
    shipmentPermissionError:
      "You do not have permission to change this shipment. Please sign in again and retry.",
    shipmentDriverMissingError:
      "The selected driver is no longer available. Please choose another driver.",
    shipmentRequiredFieldsError:
      "Some required shipment details are missing. Please review the form and try again.",
    shipmentSchemaError:
      "Shipment setup is incomplete in Supabase. Please apply the latest shipments migration.",
    routeKeyMissing: "Enter both start and end locations to estimate the route.",
    routeRefreshNeeded:
      "Locations changed. Re-estimate the route before saving for the most accurate result.",
    googleKeyMissing:
      "Google Maps distance estimation is not configured yet. Add a Google Maps API key to enable route estimation.",
    autocompleteUnavailable: "Google Maps not configured — autocomplete unavailable",
    autocompleteHelper:
      "Start typing to search for a route. You can still type the full address manually.",
    loadingSuggestions: "Loading location suggestions...",
    estimateComplete: "Estimate complete. Distance and shipment cost are ready.",
    estimateRequired: "Enter the route details and run the estimate to calculate distance.",
    costAwaitingEstimate: "Estimate the route first to calculate shipment cost.",
    tableShipment: "Shipment",
    tableDriver: "Driver",
    tableDate: "Date",
    tableStart: "Start",
    tableEnd: "End",
    tableDistance: "Distance",
    tableCost: "Est. fuel cost",
    tableAction: "Action",
    routeLabel: "Route",
    costPerKm: "Cost / km",
    aboveAverageCost: "Above average cost",
    highCostRoute: "High cost route",
    driverPerformingAboveAverage: "Driver performing above average",
    driverHigherCostThanAverage: "Driver higher cost than average",
    filtersTitle: "Filters",
    filtersDescription: "Keep the view focused by driver and shipment date.",
    filterDriver: "Filter by driver",
    allDrivers: "All drivers",
    filterStartDate: "Start date",
    filterEndDate: "End date",
    resetFilters: "Reset",
    exportCsv: "Export CSV",
    routeInsightsTitle: "Route frequency & cost",
    routeInsightsDescription:
      "See which repeated routes are being used most often and how much they cost on average.",
    usedTimes: "used",
    averageRouteCost: "Average route cost",
    noRouteInsights: "Route patterns will appear once repeated shipment routes are recorded.",
    pending: "Pending",
    unavailable: "Unavailable",
    edit: "Edit",
    delete: "Delete",
    deleteConfirm: "Are you sure you want to delete this shipment?",
    routeEstimateReady: "Route estimate ready",
    countShipments: "shipments",
    countComparisons: "comparable periods",
    searchResults: "results",
    saving: "Saving...",
    cancel: "Cancel",
    loading: "Loading...",
    noShipmentsDemo:
      "No shipments yet — add your first shipment to see estimated fuel costs by job.",
    lowDataMessage:
      "Distance calculated. Fuel cost will appear once enough historical data is available."
  },
  th: {
    title: "งานขนส่ง",
    description:
      "ประเมินต้นทุนน้ำมันรายงานขนส่งจากระยะทาง Google Maps และต้นทุนน้ำมันต่อกิโลเมตรจากข้อมูลจริงในระบบ",
    benchmark: "ต้นทุนน้ำมันย้อนหลัง / กม.",
    benchmarkHelperReady:
      "อ้างอิงข้อมูลค่าน้ำมันและระยะทางจากประวัติ 90 วันล่าสุดของบริษัท",
    benchmarkHelperPending:
      "ยังบันทึกระยะทางงานได้ตามปกติ และต้นทุนจะปรากฏเมื่อมีข้อมูลน้ำมันและเลขไมล์เพียงพอ",
    totalWeek: "ต้นทุนน้ำมันงานขนส่งประมาณการสัปดาห์นี้",
    totalMonth: "ต้นทุนน้ำมันงานขนส่งประมาณการเดือนนี้",
    averageMonth: "ต้นทุนประมาณการเฉลี่ย / งาน",
    mostExpensive: "งานที่ต้นทุนสูงสุด",
    shipmentsMonth: "จำนวนงานเดือนนี้",
    selectedPeriodSummary: "สรุปต้นทุนงานขนส่ง",
    selectedPeriodDescription:
      "มุมมองสำหรับผู้บริหารเพื่อดูต้นทุนน้ำมันประมาณการ ปริมาณงาน และงานที่ใช้ต้นทุนสูงในเดือนนี้",
    selectedPeriodLabel: "ช่วงเวลาที่เลือก",
    selectedPeriodValue: "เดือนนี้",
    totalEstimatedLabel: "ต้นทุนน้ำมันงานขนส่งประมาณการรวม",
    shipmentCountLabel: "จำนวนงานขนส่ง",
    averageCostLabel: "ต้นทุนน้ำมันเฉลี่ยต่อหนึ่งงาน",
    mostExpensiveLabel: "งานที่ต้นทุนสูงสุด",
    benchmarkPanelTitle: "วิธีประเมิน",
    benchmarkPanelDescription:
      "ใช้ระยะทางขับรถจาก Google Maps ร่วมกับต้นทุนน้ำมันต่อกิโลเมตรจากข้อมูลปฏิบัติการจริง",
    benchmarkPanelDistance: "ระยะทางที่ใช้เทียบ",
    benchmarkPanelSpend: "ค่าน้ำมันที่ใช้คำนวณ",
    benchmarkPanelEntries: "จำนวนช่วงข้อมูลที่เทียบได้",
    topDriverTitle: "คนขับที่ต้นทุนสูงสุดเดือนนี้",
    topRouteTitle: "เส้นทางที่ต้นทุนสูงสุดเดือนนี้",
    simpleInsightsTitle: "มุมมองผู้บริหาร",
    simpleInsightsDescription:
      "สัญญาณสำคัญแบบสั้น ๆ เพื่อดูว่าต้นทุนงานขนส่งกระจุกอยู่ที่งานหรือคนขับใด",
    mostExpensiveInsight: "งานที่ต้นทุนสูงสุด",
    averageShipmentInsight: "ต้นทุนงานเฉลี่ย",
    highestCostDriverInsight: "คนขับที่ต้นทุนสูงสุดในช่วงนี้",
    topCostDriver: "คนขับต้นทุนสูงสุด",
    lowestCostDriver: "คนขับต้นทุนต่ำสุด",
    driverComparisonTitle: "เปรียบเทียบตามคนขับ",
    driverComparisonDescription:
      "เปรียบเทียบต้นทุนน้ำมันงานขนส่งประมาณการรวมของแต่ละคนขับในช่วงเวลาที่เลือก",
    topDriverEmpty: "ยังไม่มีต้นทุนงานขนส่งประมาณการในเดือนนี้",
    topRouteEmpty: "เมื่อบันทึกงานขนส่งแล้ว แนวโน้มเส้นทางจะแสดงที่นี่",
    formTitleAdd: "เพิ่มงานขนส่ง",
    formTitleEdit: "แก้ไขงานขนส่ง",
    editingHint: "กำลังแก้ไขงานขนส่งที่บันทึกไว้ สามารถอัปเดตข้อมูลหรือกดยกเลิกเพื่อกลับไปเพิ่มงานใหม่ได้",
    formDescription:
      "บันทึกงานหลังจากประเมินระยะทางเสร็จแล้ว ระบบจะคำนวณต้นทุนน้ำมันจากค่าเฉลี่ยของกองรถเมื่อมีข้อมูลเพียงพอ",
    routeSection: "รายละเอียดงาน",
    routeSectionDescription:
      "กรอกจุดเริ่มต้นและปลายทางให้ชัดเจนเพื่อให้ Google Maps ประเมินเส้นทางได้แม่นยำ",
    estimateSection: "ผลการประเมินเส้นทาง",
    estimateSectionDescription:
      "ระบบจะใช้ระยะทางที่เคยประเมินไว้ก่อน เพื่อลดการเรียก Google Maps ซ้ำโดยไม่จำเป็น",
    shipmentId: "รหัสงาน / Job reference",
    shipmentDate: "วันที่",
    driver: "คนขับ",
    selectDriver: "เลือกคนขับ",
    vehicle: "รถที่ผูกกับคนขับ",
    startLocation: "จุดเริ่มต้น",
    endLocation: "ปลายทาง",
    notes: "หมายเหตุ",
    notesPlaceholder: "หมายเหตุงาน รายละเอียดสินค้า หรือข้อสังเกตของเส้นทาง",
    estimateButton: "ประเมินระยะทางและต้นทุน",
    estimating: "กำลังประเมิน...",
    distance: "ระยะทางประมาณการ",
    fuelCost: "ต้นทุนน้ำมันประมาณการ",
    saveShipment: "บันทึกงานขนส่ง",
    updateShipment: "อัปเดตงานขนส่ง",
    searchPlaceholder: "ค้นหาด้วยรหัสงาน คนขับ หรือเส้นทาง",
    tableTitle: "สรุปรายการงานขนส่ง",
    tableDescription:
      "เรียงจากรายการล่าสุด พร้อมระยะทางและต้นทุนน้ำมันประมาณการสำหรับผู้บริหาร",
    noShipments: "ยังไม่มีงานขนส่ง",
    noShipmentsDescription:
      "เพิ่มงานขนส่งรายการแรกเพื่อเริ่มประเมินต้นทุนน้ำมันรายงาน",
    distancePending:
      "มีข้อมูลระยะทางแล้ว ต้นทุนน้ำมันประมาณการจะแสดงเมื่อมีข้อมูลน้ำมันและเลขไมล์ย้อนหลังเพียงพอ",
    distanceSuccess: "ประเมินระยะทางสำเร็จ",
    distanceCached: "โหลดระยะทางที่เคยประเมินไว้สำเร็จ",
    costCalculated: "คำนวณต้นทุนน้ำมันประมาณการแล้ว",
    shipmentSaved: "บันทึกงานขนส่งสำเร็จ",
    shipmentUpdated: "อัปเดตงานขนส่งสำเร็จ",
    duplicateShipment: "รหัสงานนี้ถูกใช้แล้ว",
    loadError: "ไม่สามารถโหลดข้อมูลงานขนส่งได้",
    saveError: "ไม่สามารถบันทึกงานขนส่งได้",
    routeKeyMissing: "กรอกจุดเริ่มต้นและปลายทางก่อนประเมินเส้นทาง",
    routeRefreshNeeded:
      "มีการเปลี่ยนสถานที่ กรุณาประเมินเส้นทางใหม่ก่อนบันทึกเพื่อให้ผลล่าสุด",
    googleKeyMissing:
      "ยังไม่ได้ตั้งค่า Google Maps API key จึงยังประเมินระยะทางไม่ได้",
    tableShipment: "งาน",
    tableDriver: "คนขับ",
    tableDate: "วันที่",
    tableStart: "ต้นทาง",
    tableEnd: "ปลายทาง",
    tableDistance: "ระยะทาง",
    tableCost: "ต้นทุนน้ำมันประมาณการ",
    tableAction: "จัดการ",
    routeLabel: "เส้นทาง",
    costPerKm: "ต้นทุน / กม.",
    aboveAverageCost: "ต้นทุนสูงกว่าค่าเฉลี่ย",
    highCostRoute: "เส้นทางต้นทุนสูง",
    driverPerformingAboveAverage: "คนขับมีต้นทุนดีกว่าค่าเฉลี่ย",
    driverHigherCostThanAverage: "คนขับมีต้นทุนสูงกว่าค่าเฉลี่ย",
    filtersTitle: "ตัวกรอง",
    filtersDescription: "คัดมุมมองตามคนขับและช่วงวันที่ของงานขนส่ง",
    filterDriver: "กรองตามคนขับ",
    allDrivers: "คนขับทั้งหมด",
    filterStartDate: "วันที่เริ่มต้น",
    filterEndDate: "วันที่สิ้นสุด",
    resetFilters: "ล้างตัวกรอง",
    exportCsv: "ส่งออก CSV",
    routeInsightsTitle: "ความถี่และต้นทุนของเส้นทาง",
    routeInsightsDescription:
      "ดูว่าเส้นทางใดถูกใช้งานบ่อย และมีต้นทุนเฉลี่ยเท่าใด",
    usedTimes: "ครั้ง",
    averageRouteCost: "ต้นทุนเฉลี่ยของเส้นทาง",
    noRouteInsights: "เมื่อมีเส้นทางที่ใช้ซ้ำ ข้อมูลรูปแบบเส้นทางจะแสดงที่นี่",
    pending: "รอข้อมูล",
    unavailable: "ยังไม่พร้อม",
    edit: "แก้ไข",
    routeEstimateReady: "พร้อมใช้งาน",
    countShipments: "งาน",
    countComparisons: "ช่วงเปรียบเทียบ",
    searchResults: "ผลลัพธ์",
    saving: "กำลังบันทึก...",
    cancel: "ยกเลิก",
    loading: "กำลังโหลด...",
    noShipmentsDemo:
      "ยังไม่มีงานขนส่ง — เพิ่มงานแรกเพื่อดูต้นทุนน้ำมันประมาณการแยกตามงาน",
    lowDataMessage:
      "คำนวณระยะทางแล้ว ต้นทุนน้ำมันจะแสดงเมื่อมีข้อมูลย้อนหลังเพียงพอ"
  }
} as const;

type ShipmentLabels = {
  [Key in keyof (typeof copy)["en"]]: string;
};

function startOfWeek(value: Date) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return date;
}

function toDateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function formatDistance(value: number | null, language: "en" | "th") {
  if (value == null) {
    return "-";
  }

  return `${formatNumber(value, language, 1)} km`;
}

function getShipmentCostPerKm(shipment: ShipmentWithDriver) {
  const cost = Number(shipment.estimated_fuel_cost_thb || 0);
  const distance = Number(shipment.estimated_distance_km || 0);

  if (cost <= 0 || distance <= 0) {
    return null;
  }

  return cost / distance;
}

function getShipmentCostFlag(
  shipment: ShipmentWithDriver,
  overallAverage: number | null,
  labels: ShipmentLabels
) {
  const cost = Number(shipment.estimated_fuel_cost_thb || 0);

  if (!overallAverage || cost <= 0) {
    return null;
  }

  if (cost >= overallAverage * 1.35) {
    return labels.highCostRoute;
  }

  if (cost > overallAverage) {
    return labels.aboveAverageCost;
  }

  return null;
}

function getDriverEfficiencyLabel(
  shipment: ShipmentWithDriver,
  overallAverage: number | null,
  driverAverageLookup: Map<string, number | null>,
  labels: ShipmentLabels
) {
  const driverAverage = driverAverageLookup.get(shipment.driver || "");

  if (!overallAverage || driverAverage == null) {
    return null;
  }

  if (driverAverage > overallAverage) {
    return labels.driverHigherCostThanAverage;
  }

  if (driverAverage < overallAverage) {
    return labels.driverPerformingAboveAverage;
  }

  return null;
}

export default function ShipmentsPage() {
  const { language } = useLanguage();
  const labels = { ...copy.en, ...copy[language] };
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [shipments, setShipments] = useState<ShipmentWithDriver[]>([]);
  const [fuelLogs, setFuelLogs] = useState<FuelLogWithDriver[]>([]);
  const [weeklyMileage, setWeeklyMileage] = useState<WeeklyMileageEntry[]>([]);
  const [form, setForm] = useState(initialForm);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedDriverFilter, setSelectedDriverFilter] = useState("");
  const [startDateFilter, setStartDateFilter] = useState("");
  const [endDateFilter, setEndDateFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [estimating, setEstimating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [distanceMessage, setDistanceMessage] = useState<string | null>(null);
  const [costMessage, setCostMessage] = useState<string | null>(null);
  const [lastEstimatedRouteKey, setLastEstimatedRouteKey] = useState("");
  const [driversLoadError, setDriversLoadError] = useState<string | null>(null);
  const [googleMapsConfigured, setGoogleMapsConfigured] = useState<boolean | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const deferredSearchTerm = useDeferredValue(searchTerm);

  const isEditing = Boolean(form.id);
  const selectedDriver = useMemo(
    () => drivers.find((driver) => String(driver.id) === String(form.driver_id)),
    [drivers, form.driver_id]
  );
  const autoFillVehicleLabel =
    language === "th"
      ? "กรอกจากคนขับโดยอัตโนมัติ (แก้ไขได้)"
      : "Auto-filled based on driver (can be changed)";
  const noVehicleAssignedLabel =
    language === "th"
      ? "ยังไม่ได้ผูกรถกับคนขับ โปรดเลือกเอง"
      : "No vehicle assigned – please select manually";
  const benchmark = useMemo(
    () => buildHistoricalFuelCostBenchmark(fuelLogs, weeklyMileage),
    [fuelLogs, weeklyMileage]
  );

  const currentRouteKey = useMemo(
    () => buildShipmentRouteKey(form.start_location, form.end_location),
    [form.start_location, form.end_location]
  );
  const hasRouteInputs = Boolean(
    normalizeLocationKey(form.start_location) && normalizeLocationKey(form.end_location)
  );
  const routeEstimateStale =
    Boolean(form.estimated_distance_km) &&
    Boolean(lastEstimatedRouteKey) &&
    hasRouteInputs &&
    currentRouteKey !== lastEstimatedRouteKey;
  const noDriversAvailable = !loading && !driversLoadError && drivers.length === 0;
  const canSave =
    !saving &&
    !estimating &&
    Boolean(form.job_reference.trim()) &&
    Boolean(form.shipment_date) &&
    Boolean(form.start_location.trim()) &&
    Boolean(form.end_location.trim()) &&
    Boolean(selectedDriver);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setDriversLoadError(null);

      const [driverRows, shipmentRows, fuelRows, mileageRows] = await Promise.allSettled([
        fetchDrivers(),
        fetchShipments(),
        fetchFuelLogs(),
        fetchWeeklyMileage()
      ]);

      if (driverRows.status === "fulfilled") {
        setDrivers(driverRows.value);
      } else {
        setDrivers([]);
        setDriversLoadError(labels.driverLoadError);
      }

      if (shipmentRows.status === "fulfilled") {
        setShipments(shipmentRows.value);
      } else {
        setShipments([]);
        setError(labels.loadError);
      }

      setFuelLogs(fuelRows.status === "fulfilled" ? fuelRows.value : []);
      setWeeklyMileage(mileageRows.status === "fulfilled" ? mileageRows.value : []);
    } finally {
      setLoading(false);
    }
  }, [labels.driverLoadError, labels.loadError]);

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
    if (!benchmark.available || !form.estimated_distance_km || routeEstimateStale) {
      return;
    }

    const estimatedFuelCost = estimateShipmentFuelCost(
      Number(form.estimated_distance_km),
      benchmark
    );

    if (estimatedFuelCost == null) {
      return;
    }

    setForm((current) => ({
      ...current,
      estimated_fuel_cost_thb: estimatedFuelCost.toFixed(2),
      cost_estimation_status: "ready",
      cost_estimation_note: ""
    }));
  }, [benchmark, form.estimated_distance_km, routeEstimateStale]);

  const resetForm = () => {
    setForm({ ...initialForm, shipment_date: today() });
    setSuccessMessage(null);
    setDistanceMessage(null);
    setCostMessage(null);
    setError(null);
    setLastEstimatedRouteKey("");
  };

  const startEditingShipment = (shipment: ShipmentWithDriver) => {
    setForm({
      id: shipment.id,
      job_reference: shipment.job_reference,
      driver_id: shipment.driver_id ?? "",
      vehicle_reg: shipment.vehicle_reg ?? "",
      shipment_date: shipment.shipment_date,
      start_location: shipment.start_location,
      end_location: shipment.end_location,
      estimated_distance_km:
        shipment.estimated_distance_km != null ? String(shipment.estimated_distance_km) : "",
      estimated_fuel_cost_thb:
        shipment.estimated_fuel_cost_thb != null ? String(shipment.estimated_fuel_cost_thb) : "",
      cost_estimation_status: shipment.cost_estimation_status,
      cost_estimation_note: shipment.cost_estimation_note ?? "",
      notes: shipment.notes ?? ""
    });
    setLastEstimatedRouteKey(
      buildShipmentRouteKey(shipment.start_location, shipment.end_location)
    );
    setSuccessMessage(null);
    setDistanceMessage(null);
    setCostMessage(null);
    setError(null);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const persistRouteEstimate = async ({
    existingId,
    originLocation,
    destinationLocation,
    originKey,
    destinationKey,
    distanceKm,
    distanceMeters,
    durationSeconds,
    provider
  }: {
    existingId?: string;
    originLocation: string;
    destinationLocation: string;
    originKey: string;
    destinationKey: string;
    distanceKm: number;
    distanceMeters: number | null;
    durationSeconds: number | null;
    provider: string;
  }) => {
    try {
      await saveRouteDistanceEstimate({
        id: existingId,
        origin_location: originLocation,
        destination_location: destinationLocation,
        origin_key: originKey,
        destination_key: destinationKey,
        distance_km: distanceKm,
        distance_meters: distanceMeters,
        duration_seconds: durationSeconds,
        provider
      });
    } catch {
      // Route caching should never block shipment work.
    }
  };

  const estimateRouteAndCost = useCallback(async () => {
    if (!hasRouteInputs) {
      throw new Error(labels.routeKeyMissing);
    }

    setEstimating(true);
    setError(null);
    setSuccessMessage(null);

    const originKey = normalizeLocationKey(form.start_location);
    const destinationKey = normalizeLocationKey(form.end_location);

    try {
      let cached = null;
      try {
        cached = await fetchRouteDistanceEstimate(originKey, destinationKey);
      } catch {
        cached = null;
      }

      let distanceKm = cached?.distance_km ?? null;
      let distanceMeters = cached?.distance_meters ?? null;
      let durationSeconds = cached?.duration_seconds ?? null;
      let provider = cached?.provider ?? "routes_api";

      if (distanceKm == null) {
        const response = await fetch("/api/distance-estimate", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            origin: form.start_location.trim(),
            destination: form.end_location.trim()
          })
        });

        const result = (await response.json()) as {
          error?: string;
          distanceKm?: number;
          distanceMeters?: number | null;
          durationSeconds?: number | null;
          provider?: string;
        };

        if (!response.ok || result.distanceKm == null) {
          throw new Error(
            result.error || (response.status === 503 ? labels.googleKeyMissing : labels.saveError)
          );
        }

        distanceKm = result.distanceKm;
        distanceMeters = result.distanceMeters ?? null;
        durationSeconds = result.durationSeconds ?? null;
        provider = result.provider ?? "routes_api";

        await persistRouteEstimate({
          originLocation: form.start_location.trim(),
          destinationLocation: form.end_location.trim(),
          originKey,
          destinationKey,
          distanceKm,
          distanceMeters,
          durationSeconds,
          provider
        });
      }

      const estimatedFuelCost = estimateShipmentFuelCost(distanceKm, benchmark);
      const costStatus: "ready" | "pending" =
        estimatedFuelCost != null ? "ready" : "pending";
      const costNote = estimatedFuelCost == null ? labels.distancePending : "";

      setForm((current) => ({
        ...current,
        estimated_distance_km: distanceKm.toFixed(2),
        estimated_fuel_cost_thb:
          estimatedFuelCost != null ? estimatedFuelCost.toFixed(2) : "",
        cost_estimation_status: costStatus,
        cost_estimation_note: costNote
      }));
      setLastEstimatedRouteKey(currentRouteKey);
      setDistanceMessage(cached ? labels.distanceCached : labels.estimateComplete);
      setCostMessage(estimatedFuelCost != null ? labels.costCalculated : labels.distancePending);

      return {
        distanceKm,
        estimatedFuelCost,
        costStatus,
        costNote
      };
    } finally {
      setEstimating(false);
    }
  }, [
    benchmark,
    currentRouteKey,
    form.end_location,
    form.start_location,
    hasRouteInputs,
    labels.costCalculated,
    labels.distanceCached,
    labels.distancePending,
      labels.estimateComplete,
      labels.googleKeyMissing,
      labels.routeKeyMissing,
      labels.saveError
    ]);

  const handleDeleteShipment = async (shipmentId: string) => {
    if (!window.confirm(labels.deleteConfirm)) {
      return;
    }

    try {
      setError(null);
      setSuccessMessage(null);
      await deleteShipment(shipmentId);
      setShipments((current) => current.filter((shipment) => shipment.id !== shipmentId));
      if (form.id === shipmentId) {
        resetForm();
      }
      setSuccessMessage(labels.shipmentDeleted);
      await loadData();
    } catch (err) {
      console.error("handleDeleteShipment error:", err);
      const message =
        err instanceof Error && err.message === "SHIPMENT_PERMISSION_DENIED"
          ? labels.shipmentPermissionError
          : err instanceof Error && err.message
            ? err.message
            : labels.deleteError;
      setError(message);
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSuccessMessage(null);

    try {
      if (!selectedDriver) {
        throw new Error("SHIPMENT_DRIVER_REQUIRED");
      }

      let estimatedDistanceKm =
        form.estimated_distance_km && !routeEstimateStale
          ? Number(form.estimated_distance_km)
          : null;
      let estimatedFuelCostThb =
        form.estimated_fuel_cost_thb && !routeEstimateStale
          ? Number(form.estimated_fuel_cost_thb)
          : null;
      let costEstimationStatus = form.cost_estimation_status;
      let costEstimationNote = form.cost_estimation_note;

      if (hasRouteInputs && googleMapsConfigured === false && estimatedDistanceKm == null) {
        costEstimationStatus = "pending";
        costEstimationNote = labels.googleKeyMissing;
      }

      if (
        hasRouteInputs &&
        googleMapsConfigured !== false &&
        (estimatedDistanceKm == null || routeEstimateStale)
      ) {
        const result = await estimateRouteAndCost();
        estimatedDistanceKm = result.distanceKm;
        estimatedFuelCostThb = result.estimatedFuelCost;
        costEstimationStatus = result.costStatus;
        costEstimationNote = result.costNote;
      }

      const savedShipment = await saveShipment({
        id: form.id || undefined,
        job_reference: form.job_reference.trim(),
        driver_id: form.driver_id || null,
        driver: selectedDriver?.name ?? "",
        vehicle_reg: form.vehicle_reg.trim() || selectedDriver?.vehicle_reg || null,
        shipment_date: form.shipment_date,
        start_location: form.start_location.trim(),
        end_location: form.end_location.trim(),
        estimated_distance_km: estimatedDistanceKm,
        estimated_fuel_cost_thb: estimatedFuelCostThb,
        cost_per_km_snapshot_thb: benchmark.costPerKm,
        cost_estimation_status: costEstimationStatus,
        cost_estimation_note: costEstimationNote || null,
        notes: form.notes.trim() || null
      });

      const nextShipment: ShipmentWithDriver = {
        ...savedShipment,
        driver: selectedDriver?.name ?? savedShipment.driver ?? "",
        vehicle_reg:
          form.vehicle_reg.trim() || savedShipment.vehicle_reg || selectedDriver?.vehicle_reg || null
      };

      setShipments((current) => {
        const withoutCurrent = current.filter((shipment) => shipment.id !== nextShipment.id);
        return [nextShipment, ...withoutCurrent].sort((left, right) => {
          if (left.shipment_date !== right.shipment_date) {
            return right.shipment_date.localeCompare(left.shipment_date);
          }

          return right.created_at.localeCompare(left.created_at);
        });
      });

      resetForm();
      setSuccessMessage(isEditing ? labels.shipmentUpdated : labels.shipmentSaved);
      await loadData();
    } catch (err) {
      console.error("handleSubmit shipment error:", err);
      const message =
        err instanceof Error && err.message === "DUPLICATE_SHIPMENT_REFERENCE"
          ? labels.duplicateShipment
          : err instanceof Error && err.message === "SHIPMENT_DRIVER_REQUIRED"
            ? labels.driverRequired
            : err instanceof Error && err.message === "SHIPMENT_PERMISSION_DENIED"
              ? labels.shipmentPermissionError
              : err instanceof Error && err.message === "SHIPMENT_DRIVER_NOT_FOUND"
                ? labels.shipmentDriverMissingError
                : err instanceof Error && err.message === "SHIPMENT_REQUIRED_FIELDS_MISSING"
                  ? labels.shipmentRequiredFieldsError
                  : err instanceof Error && err.message === "SHIPMENT_SCHEMA_MISMATCH"
                    ? labels.shipmentSchemaError
          : err instanceof Error && err.message
            ? err.message
            : labels.saveError;
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  const baseFilteredShipments = useMemo(() => {
    return shipments.filter((shipment) => {
      const driverMatch =
        !selectedDriverFilter ||
        String(shipment.driver_id || "") === String(selectedDriverFilter);

      if (!driverMatch) {
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
  }, [endDateFilter, selectedDriverFilter, shipments, startDateFilter]);

  const filteredShipments = useMemo(
    () => filterShipments(baseFilteredShipments, deferredSearchTerm),
    [baseFilteredShipments, deferredSearchTerm]
  );

  const now = useMemo(() => new Date(), []);
  const weekStartKey = toDateKey(startOfWeek(now));
  const thisWeekShipments = useMemo(
    () => baseFilteredShipments.filter((shipment) => shipment.shipment_date >= weekStartKey),
    [baseFilteredShipments, weekStartKey]
  );

  const totalEstimatedWeek = thisWeekShipments.reduce(
    (sum, shipment) => sum + Number(shipment.estimated_fuel_cost_thb || 0),
    0
  );
  const totalEstimatedMonth = baseFilteredShipments.reduce(
    (sum, shipment) => sum + Number(shipment.estimated_fuel_cost_thb || 0),
    0
  );
  const estimatedMonthShipments = baseFilteredShipments.filter(
    (shipment) => shipment.estimated_fuel_cost_thb != null
  );
  const averageEstimatedMonth =
    estimatedMonthShipments.length > 0
      ? totalEstimatedMonth / estimatedMonthShipments.length
      : null;
  const mostExpensiveShipment =
    [...estimatedMonthShipments].sort(
      (a, b) =>
        Number(b.estimated_fuel_cost_thb || 0) - Number(a.estimated_fuel_cost_thb || 0)
    )[0] ?? null;

  const topRouteThisMonth = useMemo(() => {
    const totals = new Map<string, { route: string; amount: number }>();

    estimatedMonthShipments.forEach((shipment) => {
      const route = buildShipmentRouteLabel(
        shipment.start_location,
        shipment.end_location
      );
      const key = buildShipmentRouteKey(shipment.start_location, shipment.end_location);
      const current = totals.get(key) ?? { route, amount: 0 };
      current.amount += Number(shipment.estimated_fuel_cost_thb || 0);
      totals.set(key, current);
    });

    return [...totals.values()].sort((a, b) => b.amount - a.amount)[0] ?? null;
  }, [estimatedMonthShipments]);

  const driverTotalsThisMonth = useMemo(() => {
    const totals = new Map<string, { driver: string; amount: number; shipments: number }>();

    estimatedMonthShipments.forEach((shipment) => {
      const key = shipment.driver || shipment.driver_id || shipment.id;
      const current = totals.get(key) ?? {
        driver: shipment.driver || "-",
        amount: 0,
        shipments: 0
      };
      current.amount += Number(shipment.estimated_fuel_cost_thb || 0);
      current.shipments += 1;
      totals.set(key, current);
    });

    return [...totals.values()].sort((a, b) => b.amount - a.amount);
  }, [estimatedMonthShipments]);

  const highestCostDriver = driverTotalsThisMonth[0] ?? null;
  const lowestCostDriver = driverTotalsThisMonth[driverTotalsThisMonth.length - 1] ?? null;
  const overallAverageShipmentCost =
    estimatedMonthShipments.length > 0 ? totalEstimatedMonth / estimatedMonthShipments.length : null;

  const driverAverageLookup = useMemo(() => {
    return new Map(
      driverTotalsThisMonth.map((entry) => [
        entry.driver,
        entry.shipments > 0 ? entry.amount / entry.shipments : null
      ])
    );
  }, [driverTotalsThisMonth]);

  const routeInsights = useMemo(() => {
    const totals = new Map<
      string,
      { route: string; count: number; totalCost: number; averageCost: number | null }
    >();

    estimatedMonthShipments.forEach((shipment) => {
      const key = buildShipmentRouteKey(shipment.start_location, shipment.end_location);
      const route = buildShipmentRouteLabel(shipment.start_location, shipment.end_location);
      const current = totals.get(key) ?? {
        route,
        count: 0,
        totalCost: 0,
        averageCost: null
      };
      current.count += 1;
      current.totalCost += Number(shipment.estimated_fuel_cost_thb || 0);
      totals.set(key, current);
    });

    return [...totals.values()]
      .map((entry) => ({
        ...entry,
        averageCost: entry.count > 0 ? entry.totalCost / entry.count : null
      }))
      .sort((a, b) => b.totalCost - a.totalCost);
  }, [estimatedMonthShipments]);

  const summaryCards = [
    {
      label: labels.benchmark,
      value:
        benchmark.costPerKm != null ? formatCurrency(benchmark.costPerKm, language) : labels.pending,
      helper: benchmark.available ? labels.benchmarkHelperReady : labels.benchmarkHelperPending,
      icon: <Calculator className="h-5 w-5" />
    },
    {
      label: labels.totalWeek,
      value: formatCurrency(totalEstimatedWeek, language),
      helper: `${formatNumber(thisWeekShipments.length, language)} ${labels.countShipments}`,
      icon: <Wallet className="h-5 w-5" />
    },
    {
      label: labels.totalMonth,
      value: formatCurrency(totalEstimatedMonth, language),
      helper: `${formatNumber(baseFilteredShipments.length, language)} ${labels.countShipments}`,
      icon: <TrendingUp className="h-5 w-5" />
    },
    {
      label: labels.averageMonth,
      value:
        averageEstimatedMonth != null
          ? formatCurrency(averageEstimatedMonth, language)
          : labels.unavailable,
      helper:
        estimatedMonthShipments.length > 0
          ? `${formatNumber(estimatedMonthShipments.length, language)} ${labels.countShipments}`
          : labels.benchmarkHelperPending,
      icon: <Sparkles className="h-5 w-5" />
    },
    {
      label: labels.mostExpensive,
      value:
        mostExpensiveShipment?.estimated_fuel_cost_thb != null
          ? formatCurrency(Number(mostExpensiveShipment.estimated_fuel_cost_thb), language)
          : labels.unavailable,
      helper:
        mostExpensiveShipment != null
          ? mostExpensiveShipment.job_reference
          : labels.topDriverEmpty,
      icon: <Package className="h-5 w-5" />
    },
    {
      label: labels.shipmentsMonth,
      value: formatNumber(baseFilteredShipments.length, language),
      helper: `${formatNumber(filteredShipments.length, language)} ${labels.searchResults}`,
      icon: <Truck className="h-5 w-5" />
    }
  ];

  const summaryHighlights = [
    {
      label: labels.totalEstimatedLabel,
      value: formatCurrency(totalEstimatedMonth, language),
      helper: labels.selectedPeriodValue
    },
    {
      label: labels.shipmentCountLabel,
      value: formatNumber(baseFilteredShipments.length, language),
      helper: labels.countShipments
    },
    {
      label: labels.averageCostLabel,
      value:
        averageEstimatedMonth != null
          ? formatCurrency(averageEstimatedMonth, language)
          : labels.unavailable,
      helper:
        estimatedMonthShipments.length > 0
          ? `${formatNumber(estimatedMonthShipments.length, language)} ${labels.countShipments}`
          : labels.lowDataMessage
    },
    {
      label: labels.mostExpensiveLabel,
      value:
        mostExpensiveShipment?.estimated_fuel_cost_thb != null
          ? formatCurrency(Number(mostExpensiveShipment.estimated_fuel_cost_thb), language)
          : labels.unavailable,
      helper: mostExpensiveShipment?.job_reference ?? labels.topDriverEmpty
    }
  ];

  return (
    <>
      <GoogleMapsLoader />
      <div className="mb-6 hidden md:block">
        <Header title={labels.title} description={labels.description} />
      </div>

      <section className="mb-4.5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {summaryCards.map((card) => (
          <StatCard
            key={card.label}
            label={card.label}
            value={card.value}
            helper={card.helper}
            icon={card.icon}
          />
        ))}
      </section>

      <section className="surface-card mb-5 overflow-hidden p-5 sm:p-6">
        <div className="absolute inset-x-0 top-0 h-24 bg-[linear-gradient(135deg,rgba(95,51,183,0.08),rgba(242,138,47,0.04)_65%,transparent)]" />
        <div className="relative">
          <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="badge-muted">{labels.selectedPeriodSummary}</div>
              <h3 className="mt-3 text-[1.72rem] font-semibold tracking-[-0.05em] text-slate-950">
                {labels.selectedPeriodValue}
              </h3>
              <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-500">
                {labels.selectedPeriodDescription}
              </p>
            </div>
            <div className="subtle-panel min-w-[220px] p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                {labels.selectedPeriodLabel}
              </p>
              <p className="mt-1 text-lg font-semibold text-slate-950">
                {labels.selectedPeriodValue}
              </p>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {summaryHighlights.map((item) => (
              <div key={item.label} className="subtle-panel p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                  {item.label}
                </p>
                <p className="mt-2 text-[1.55rem] font-semibold tracking-[-0.04em] text-slate-950">
                  {item.value}
                </p>
                <p className="mt-2 text-sm text-slate-500">{item.helper}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]">
        <section className="surface-card p-5 sm:p-6">
          <div className="mb-4">
            <h3 className="section-title">{labels.benchmarkPanelTitle}</h3>
            <p className="section-subtitle">{labels.benchmarkPanelDescription}</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="subtle-panel p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                {labels.benchmarkPanelSpend}
              </p>
              <p className="mt-1 text-lg font-semibold text-slate-950">
                {formatCurrency(benchmark.totalFuelSpend, language)}
              </p>
            </div>

            <div className="subtle-panel p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                {labels.benchmarkPanelDistance}
              </p>
              <p className="mt-1 text-lg font-semibold text-slate-950">
                {formatDistance(benchmark.totalDistanceKm, language)}
              </p>
            </div>

            <div className="subtle-panel p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                {labels.benchmarkPanelEntries}
              </p>
              <p className="mt-1 text-lg font-semibold text-slate-950">
                {formatNumber(benchmark.comparableMileageEntries, language)}
              </p>
              <p className="mt-1 text-xs text-slate-500">{labels.countComparisons}</p>
            </div>
          </div>
        </section>

        <section className="surface-card p-5 sm:p-6">
          <div className="mb-4">
            <h3 className="section-title">{labels.simpleInsightsTitle}</h3>
            <p className="section-subtitle">{labels.simpleInsightsDescription}</p>
          </div>

          <div className="grid gap-3">
            <div className="subtle-panel p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                {labels.mostExpensiveInsight}
              </p>
              <p className="mt-1 text-base font-semibold text-slate-950">
                {mostExpensiveShipment?.job_reference ?? "-"}
              </p>
              <p className="mt-2 text-sm text-slate-500">
                {mostExpensiveShipment?.estimated_fuel_cost_thb != null
                  ? formatCurrency(Number(mostExpensiveShipment.estimated_fuel_cost_thb), language)
                  : labels.topDriverEmpty}
              </p>
            </div>

            <div className="subtle-panel p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                {labels.averageShipmentInsight}
              </p>
              <p className="mt-1 text-base font-semibold text-slate-950">
                {averageEstimatedMonth != null
                  ? formatCurrency(averageEstimatedMonth, language)
                  : labels.unavailable}
              </p>
              <p className="mt-2 text-sm text-slate-500">
                {estimatedMonthShipments.length > 0
                  ? labels.selectedPeriodValue
                  : labels.lowDataMessage}
              </p>
            </div>

            <div className="subtle-panel p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                {labels.highestCostDriverInsight}
              </p>
              <p className="mt-1 text-base font-semibold text-slate-950">
                {highestCostDriver?.driver ?? "-"}
              </p>
              <p className="mt-2 text-sm text-slate-500">
                {highestCostDriver
                  ? formatCurrency(highestCostDriver.amount, language)
                  : labels.topDriverEmpty}
              </p>
            </div>

            <div className="subtle-panel p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                {labels.topRouteTitle}
              </p>
              <p className="mt-1 text-base font-semibold text-slate-950">
                {topRouteThisMonth?.route ?? "-"}
              </p>
              <p className="mt-2 text-sm text-slate-500">
                {topRouteThisMonth
                  ? formatCurrency(topRouteThisMonth.amount, language)
                  : labels.topRouteEmpty}
              </p>
            </div>
          </div>
        </section>
      </section>

      <section className="mt-5 surface-card p-5 sm:p-6">
        <div className="mb-4">
          <h3 className="section-title">{labels.driverComparisonTitle}</h3>
          <p className="section-subtitle">{labels.driverComparisonDescription}</p>
        </div>

        {driverTotalsThisMonth.length === 0 ? (
          <div className="subtle-panel p-4 text-sm text-slate-500">{labels.topDriverEmpty}</div>
        ) : (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="subtle-panel p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                  {labels.topCostDriver}
                </p>
                <p className="mt-1 text-lg font-semibold text-slate-950">
                  {highestCostDriver?.driver ?? "-"}
                </p>
                <p className="mt-2 text-sm text-slate-500">
                  {highestCostDriver
                    ? formatCurrency(highestCostDriver.amount, language)
                    : labels.topDriverEmpty}
                </p>
              </div>

              <div className="subtle-panel p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                  {labels.lowestCostDriver}
                </p>
                <p className="mt-1 text-lg font-semibold text-slate-950">
                  {lowestCostDriver?.driver ?? "-"}
                </p>
                <p className="mt-2 text-sm text-slate-500">
                  {lowestCostDriver
                    ? formatCurrency(lowestCostDriver.amount, language)
                    : labels.topDriverEmpty}
                </p>
              </div>
            </div>

            <div className="grid gap-3">
              {driverTotalsThisMonth.slice(0, 4).map((driverRow) => (
                <div
                  key={driverRow.driver}
                  className="subtle-panel flex flex-col gap-2 p-4 min-[520px]:flex-row min-[520px]:items-center min-[520px]:justify-between"
                >
                  <div>
                    <p className="text-sm font-semibold text-slate-950">{driverRow.driver}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {formatNumber(driverRow.shipments, language)} {labels.countShipments}
                    </p>
                  </div>
                  <p className="text-base font-semibold text-slate-950">
                    {formatCurrency(driverRow.amount, language)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="mt-5 surface-card p-5 sm:p-6">
        <div className="mb-4">
          <h3 className="section-title">{labels.routeInsightsTitle}</h3>
          <p className="section-subtitle">{labels.routeInsightsDescription}</p>
        </div>

        {routeInsights.length === 0 ? (
          <div className="subtle-panel p-4 text-sm text-slate-500">{labels.noRouteInsights}</div>
        ) : (
          <div className="grid gap-3">
            {routeInsights.slice(0, 5).map((route) => (
              <div
                key={route.route}
                className="subtle-panel flex flex-col gap-2 p-4 min-[560px]:flex-row min-[560px]:items-center min-[560px]:justify-between"
              >
                <div>
                  <p className="text-sm font-semibold text-slate-950">{route.route}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {route.count} {labels.usedTimes}
                  </p>
                </div>
                <div className="min-[560px]:text-right">
                  <p className="text-base font-semibold text-slate-950">
                    {formatCurrency(route.totalCost, language)}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {labels.averageRouteCost}:{" "}
                    {route.averageCost != null
                      ? formatCurrency(route.averageCost, language)
                      : labels.unavailable}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mt-5">
        <form
          ref={formRef}
          onSubmit={handleSubmit}
          className="surface-card-soft p-5 sm:p-6 lg:p-6.5"
        >
          <div className="mb-5">
            <h3 className="section-title">
              {isEditing ? labels.formTitleEdit : labels.formTitleAdd}
            </h3>
            <p className="section-subtitle">{labels.formDescription}</p>
            {isEditing ? (
              <p className="mt-2 text-sm font-medium text-brand-700">{labels.editingHint}</p>
            ) : null}
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]">
            <section className="form-section">
              <div className="mb-4">
                <h4 className="text-sm font-semibold text-slate-900">{labels.routeSection}</h4>
                <p className="mt-1 text-sm text-slate-500">
                  {labels.routeSectionDescription}
                </p>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="form-field">
                  <label className="form-label form-label-required">{labels.shipmentId}</label>
                  <input
                    required
                    value={form.job_reference}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, job_reference: event.target.value }))
                    }
                    className="form-input bg-white"
                  />
                </div>

                <div className="form-field">
                  <label className="form-label form-label-required">{labels.shipmentDate}</label>
                  <input
                    type="date"
                    required
                    value={form.shipment_date}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, shipment_date: event.target.value }))
                    }
                    className="form-input bg-white"
                  />
                </div>

                <div className="form-field">
                  <label className="form-label form-label-required">{labels.driver}</label>
                  <select
                    required
                    value={form.driver_id}
                    disabled={noDriversAvailable || Boolean(driversLoadError)}
                    onChange={(event) => {
                      const nextDriverId = event.target.value;
                      const nextDriver = drivers.find(
                        (driver) => String(driver.id) === String(nextDriverId)
                      );

                      setForm((current) => ({
                        ...current,
                        driver_id: nextDriverId,
                        vehicle_reg: nextDriver?.vehicle_reg ?? ""
                      }));
                    }}
                    className="form-input bg-white"
                  >
                    <option value="">
                      {noDriversAvailable ? labels.noDriversAvailable : labels.selectDriver}
                    </option>
                    {drivers.map((driver) => (
                      <option key={driver.id} value={String(driver.id)}>
                        {driver.name}
                      </option>
                    ))}
                  </select>
                  {driversLoadError ? (
                    <p className="mt-2 text-sm text-rose-600">{driversLoadError}</p>
                  ) : noDriversAvailable ? (
                    <p className="mt-2 text-sm text-amber-700">{labels.noDriversAvailable}</p>
                  ) : !selectedDriver && form.driver_id ? (
                    <p className="mt-2 text-sm text-rose-600">
                      {labels.shipmentDriverMissingError}
                    </p>
                  ) : null}
                </div>

                <div className="form-field">
                  <label className="form-label">{labels.vehicle}</label>
                  <input
                    value={form.vehicle_reg}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, vehicle_reg: event.target.value }))
                    }
                    placeholder="-"
                    className="form-input bg-white"
                  />
                  <p className="form-helper">
                    {selectedDriver?.vehicle_reg?.trim()
                      ? autoFillVehicleLabel
                      : noVehicleAssignedLabel}
                  </p>
                </div>

                <LocationAutocomplete
                  label={labels.startLocation}
                  value={form.start_location}
                  required
                  language={language}
                  helperText={labels.autocompleteHelper}
                  loadingText={labels.loadingSuggestions}
                  configMissingMessage={labels.autocompleteUnavailable}
                  onConfigurationChange={setGoogleMapsConfigured}
                  onChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      start_location: value
                    }))
                  }
                />

                <LocationAutocomplete
                  label={labels.endLocation}
                  value={form.end_location}
                  required
                  language={language}
                  helperText={labels.autocompleteHelper}
                  loadingText={labels.loadingSuggestions}
                  configMissingMessage={labels.autocompleteUnavailable}
                  onConfigurationChange={setGoogleMapsConfigured}
                  onChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      end_location: value
                    }))
                  }
                />

                <div className="form-field md:col-span-2">
                  <label className="form-label">{labels.notes}</label>
                  <textarea
                    rows={4}
                    value={form.notes}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, notes: event.target.value }))
                    }
                    placeholder={labels.notesPlaceholder}
                    className="form-textarea bg-white"
                  />
                </div>
              </div>
            </section>

            <section className="form-section">
              <div className="mb-4">
                <h4 className="text-sm font-semibold text-slate-900">{labels.estimateSection}</h4>
                <p className="mt-1 text-sm text-slate-500">
                  {labels.estimateSectionDescription}
                </p>
              </div>

              <div className="space-y-4">
                <button
                  type="button"
                  onClick={() => void estimateRouteAndCost().catch((err) => setError(err.message))}
                  disabled={estimating || googleMapsConfigured === false}
                  className="btn-secondary w-full gap-2 disabled:opacity-60"
                >
                  <MapPinned className="h-4 w-4" />
                  {estimating ? labels.estimating : labels.estimateButton}
                </button>

                {googleMapsConfigured === false ? (
                  <p className="text-sm text-amber-700">
                    {labels.autocompleteUnavailable}. {labels.googleKeyMissing}
                  </p>
                ) : null}

                <div className="subtle-panel p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                    {labels.distance}
                  </p>
                  <p className="mt-1 text-lg font-semibold text-slate-950">
                    {form.estimated_distance_km
                      ? formatDistance(Number(form.estimated_distance_km), language)
                      : "-"}
                  </p>
                  <p className="mt-2 text-sm text-slate-500">
                    {routeEstimateStale
                      ? labels.routeRefreshNeeded
                      : distanceMessage ??
                        (form.estimated_distance_km ? labels.routeEstimateReady : labels.estimateRequired)}
                  </p>
                </div>

                <div className="subtle-panel p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                    {labels.fuelCost}
                  </p>
                  <p className="mt-1 text-lg font-semibold text-slate-950">
                    {form.estimated_fuel_cost_thb
                      ? formatCurrency(Number(form.estimated_fuel_cost_thb), language)
                      : labels.unavailable}
                  </p>
                  <p className="mt-2 text-sm text-slate-500">
                    {routeEstimateStale
                      ? labels.routeRefreshNeeded
                      : costMessage ??
                        (form.estimated_distance_km
                          ? benchmark.available
                            ? labels.distancePending
                            : labels.lowDataMessage
                          : labels.costAwaitingEstimate)}
                  </p>
                </div>

                <div className="rounded-[1.4rem] border border-brand-100/80 bg-brand-50/70 px-4 py-3 text-sm text-brand-900">
                  {benchmark.available
                    ? labels.benchmarkHelperReady
                    : labels.benchmarkHelperPending}
                </div>
              </div>
            </section>
          </div>

          {error ? <p className="form-error mt-4">{error}</p> : null}
          {successMessage ? <p className="mt-4 text-sm text-emerald-600">{successMessage}</p> : null}

          <div className="mt-4.5 flex flex-col gap-2.5 sm:flex-row sm:items-center">
            <button
              type="submit"
              disabled={!canSave}
              className="btn-primary min-w-[190px] disabled:opacity-70 sm:flex-none"
            >
              {saving
                ? labels.saving
                : isEditing
                  ? labels.updateShipment
                  : labels.saveShipment}
            </button>

            {isEditing ? (
              <button
                type="button"
                onClick={resetForm}
                className="btn-secondary sm:flex-none"
              >
                {labels.cancel}
              </button>
            ) : null}
          </div>
        </form>
      </section>

      <section className="mt-5 surface-card p-5 sm:p-6">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="section-title">{labels.tableTitle}</h3>
            <p className="section-subtitle">{labels.tableDescription}</p>
          </div>

          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center">
            <div className="relative w-full sm:w-[320px]">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder={labels.searchPlaceholder}
                className="form-input bg-white pl-11"
              />
            </div>
            <button
              type="button"
              onClick={() =>
                exportToCsv(
                  filteredShipments.map((shipment) => ({
                    Shipment: shipment.job_reference,
                    Driver: shipment.driver || "-",
                    Date: shipment.shipment_date,
                    Route: buildShipmentRouteLabel(
                      shipment.start_location,
                      shipment.end_location
                    ),
                    DistanceKm: shipment.estimated_distance_km ?? "",
                    EstimatedFuelCostThb: shipment.estimated_fuel_cost_thb ?? "",
                    CostPerKm:
                      getShipmentCostPerKm(shipment) != null
                        ? Number(getShipmentCostPerKm(shipment)?.toFixed(2))
                        : "",
                    Notes: shipment.notes ?? ""
                  })),
                  "shipments-report"
                )
              }
              disabled={!filteredShipments.length}
              className="btn-secondary w-full gap-2 disabled:opacity-50 sm:w-auto"
            >
              <Download className="h-4 w-4" />
              {labels.exportCsv}
            </button>
            <span className="badge-muted">
              {formatNumber(filteredShipments.length, language)} {labels.searchResults}
            </span>
          </div>
        </div>

        <div className="mb-5 subtle-panel p-4">
          <div className="mb-3 flex flex-col gap-1">
            <h4 className="text-sm font-semibold text-slate-900">{labels.filtersTitle}</h4>
            <p className="text-sm text-slate-500">{labels.filtersDescription}</p>
          </div>

          <div className="grid gap-3 md:grid-cols-4">
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
              <label className="form-label">{labels.filterStartDate}</label>
              <input
                type="date"
                value={startDateFilter}
                onChange={(event) => setStartDateFilter(event.target.value)}
                className="form-input bg-white"
              />
            </div>

            <div className="form-field">
              <label className="form-label">{labels.filterEndDate}</label>
              <input
                type="date"
                value={endDateFilter}
                onChange={(event) => setEndDateFilter(event.target.value)}
                className="form-input bg-white"
              />
            </div>

            <div className="flex items-end">
              <button
                type="button"
                onClick={() => {
                  setSelectedDriverFilter("");
                  setStartDateFilter("");
                  setEndDateFilter("");
                }}
                className="btn-secondary w-full"
              >
                {labels.resetFilters}
              </button>
            </div>
          </div>
        </div>

        {loading ? (
          <EmptyState title={labels.loading} description={labels.tableDescription} />
        ) : filteredShipments.length === 0 ? (
          <EmptyState title={labels.noShipments} description={labels.noShipmentsDescription} />
        ) : (
          <>
            <div className="space-y-3.5 md:hidden">
              {filteredShipments.map((shipment) => {
                const shipmentCostFlag = getShipmentCostFlag(
                  shipment,
                  overallAverageShipmentCost,
                  labels
                );
                const driverEfficiencyLabel = getDriverEfficiencyLabel(
                  shipment,
                  overallAverageShipmentCost,
                  driverAverageLookup,
                  labels
                );
                const costPerKm = getShipmentCostPerKm(shipment);

                return (
                  <article key={shipment.id} className="subtle-panel p-4">
                    <div className="flex flex-col gap-2 min-[400px]:flex-row min-[400px]:items-start min-[400px]:justify-between">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900">
                          {shipment.job_reference}
                        </p>
                        <p className="mt-1 text-sm text-slate-500">
                          {shipment.driver || "-"}{shipment.vehicle_reg ? ` | ${shipment.vehicle_reg}` : ""}
                        </p>
                      </div>
                      <p className="supporting-date-strong shrink-0">
                        {formatDate(shipment.shipment_date, language)}
                      </p>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      {shipmentCostFlag ? (
                        <span className="badge-muted">{shipmentCostFlag}</span>
                      ) : null}
                      {driverEfficiencyLabel ? (
                        <span className="badge-muted">{driverEfficiencyLabel}</span>
                      ) : null}
                    </div>

                    <div className="mt-3 grid gap-3">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                          {labels.routeLabel}
                        </p>
                        <p className="mt-1 text-sm font-medium text-slate-900">
                          {buildShipmentRouteLabel(
                            shipment.start_location,
                            shipment.end_location
                          )}
                        </p>
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-3 gap-3">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                          {labels.tableDistance}
                        </p>
                        <p className="mt-1 text-sm font-semibold text-slate-950">
                          {formatDistance(shipment.estimated_distance_km, language)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                          {labels.costPerKm}
                        </p>
                        <p className="mt-1 text-sm font-semibold text-slate-950">
                          {costPerKm != null
                            ? formatCurrency(costPerKm, language)
                            : labels.unavailable}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                          {labels.tableCost}
                        </p>
                        <p className="mt-1 text-base font-semibold tracking-[-0.03em] text-slate-950">
                          {shipment.estimated_fuel_cost_thb != null
                            ? formatCurrency(Number(shipment.estimated_fuel_cost_thb), language)
                            : labels.unavailable}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {shipment.estimated_fuel_cost_thb != null
                            ? labels.routeEstimateReady
                            : labels.lowDataMessage}
                        </p>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                      <button
                        type="button"
                        className="btn-secondary w-full sm:min-h-[44px]"
                        onClick={() => startEditingShipment(shipment)}
                      >
                        {labels.edit}
                      </button>
                      <button
                        type="button"
                        className="btn-danger w-full sm:min-h-[44px]"
                        onClick={() => void handleDeleteShipment(shipment.id)}
                      >
                        {labels.delete}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>

            <div className="hidden md:block">
              <div className="table-shell rounded-2xl">
                <div className="table-scroll">
                  <table className="w-full min-w-[1180px] text-sm">
                    <thead>
                      <tr>
                        <th className="table-head-cell">{labels.tableShipment}</th>
                        <th className="table-head-cell">{labels.tableDriver}</th>
                        <th className="table-head-cell">{labels.tableDate}</th>
                        <th className="table-head-cell">{labels.routeLabel}</th>
                        <th className="table-head-cell text-right">{labels.tableDistance}</th>
                        <th className="table-head-cell text-right">{labels.costPerKm}</th>
                        <th className="table-head-cell text-right">{labels.tableCost}</th>
                        <th className="table-head-cell">{labels.tableAction}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredShipments.map((shipment) => {
                        const shipmentCostFlag = getShipmentCostFlag(
                          shipment,
                          overallAverageShipmentCost,
                          labels
                        );
                        const driverEfficiencyLabel = getDriverEfficiencyLabel(
                          shipment,
                          overallAverageShipmentCost,
                          driverAverageLookup,
                          labels
                        );
                        const costPerKm = getShipmentCostPerKm(shipment);

                        return (
                          <tr key={shipment.id} className="enterprise-table-row">
                            <td className="table-body-cell font-medium text-slate-900">
                              <p>{shipment.job_reference}</p>
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {shipmentCostFlag ? (
                                  <span className="badge-muted">{shipmentCostFlag}</span>
                                ) : null}
                                {driverEfficiencyLabel ? (
                                  <span className="badge-muted">{driverEfficiencyLabel}</span>
                                ) : null}
                              </div>
                            </td>
                            <td className="table-body-cell text-slate-700">
                              <div>
                                <p>{shipment.driver || "-"}</p>
                                <p className="mt-0.5 text-xs text-slate-400">
                                  {shipment.vehicle_reg || "-"}
                                </p>
                              </div>
                            </td>
                            <td className="table-body-cell supporting-date-strong">
                              {formatDate(shipment.shipment_date, language)}
                            </td>
                            <td className="table-body-cell text-slate-700">
                              <p className="font-medium text-slate-900">
                                {buildShipmentRouteLabel(
                                  shipment.start_location,
                                  shipment.end_location
                                )}
                              </p>
                            </td>
                            <td className="table-body-cell text-right font-medium text-slate-800">
                              {formatDistance(shipment.estimated_distance_km, language)}
                            </td>
                            <td className="table-body-cell text-right font-medium text-slate-800">
                              {costPerKm != null
                                ? formatCurrency(costPerKm, language)
                                : labels.unavailable}
                            </td>
                            <td className="table-body-cell text-right">
                              <p className="text-[1.02rem] font-semibold tracking-[-0.03em] text-slate-950">
                                {shipment.estimated_fuel_cost_thb != null
                                  ? formatCurrency(Number(shipment.estimated_fuel_cost_thb), language)
                                  : labels.unavailable}
                              </p>
                              <p className="mt-1 text-xs text-slate-500">
                                {shipment.estimated_fuel_cost_thb != null
                                  ? labels.routeEstimateReady
                                  : labels.lowDataMessage}
                              </p>
                            </td>
                            <td className="table-body-cell">
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  className="table-action-secondary min-w-[84px]"
                                  onClick={() => startEditingShipment(shipment)}
                                >
                                  {labels.edit}
                                </button>
                                <button
                                  type="button"
                                  className="table-action-danger min-w-[84px]"
                                  onClick={() => void handleDeleteShipment(shipment.id)}
                                >
                                  {labels.delete}
                                </button>
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
          </>
        )}
      </section>
    </>
  );
}
