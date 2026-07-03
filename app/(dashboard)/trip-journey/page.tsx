"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Link2,
  RefreshCw,
  Save,
  Trash2,
  Unlink
} from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import {
  createTripJourneyFromBooking,
  deleteTripJourney,
  fetchBookingDiaryEntries,
  fetchFuelLogs,
  fetchDrivers,
  fetchTripJourneys,
  fetchVehicles,
  linkFuelLogToTrip,
  saveTripJourney,
  unlinkFuelLogFromTrip
} from "@/lib/data";
import type { Driver, FuelLogWithDriver, TripFuelSource, TripJourneyWithFuel, Vehicle } from "@/types/database";

const DEPOT_ADDRESS =
  "Expert Express Sender Co., Ltd. 88 Happy Place, Khwaeng Khlong Sam Prawet, Khet Lat Krabang, Bangkok 10520, Thailand";

type TripFilter = {
  fromDate: string;
  toDate: string;
  driver: string;
  vehicle: string;
  route: string;
  dataStatus: "all" | "missing" | "completed";
  fuelLink: "all" | "linked" | "not_linked";
};

type TripForm = {
  id: string;
  booking_diary_id: string;
  booking_reference: string;
  trip_date: string;
  pickup_time: string;
  start_location_type: "depot" | "custom";
  start_location: string;
  depot_address: string;
  pickup_location: string;
  dropoff_location: string;
  route: string;
  vehicle_type: string;
  vehicle_reg: string;
  driver: string;
  load_details: string;
  warehouse_no: string;
  booking_notes: string;
  start_mileage: string;
  end_mileage: string;
  manual_actual_km: string;
  return_to_depot: boolean;
  estimated_distance_km: string;
  manual_estimated_distance_km: string;
  manual_litres_used: string;
  manual_fuel_cost: string;
  fuel_source: TripFuelSource;
  waiting_idle_notes: string;
  extra_route_notes: string;
};

type SelectedTripTab = "overview" | "journey" | "fuel" | "notes";
type AttentionFilter = "all" | "missing_mileage" | "missing_estimate" | "missing_fuel";
type DerivedTripStatus = "completed" | "missing_mileage" | "missing_estimated_distance" | "missing_fuel";
type ComparisonTab = "drivers" | "vehicles" | "routes" | "trips";
type ComparisonSort = "best_kml" | "lowest_cost_per_km" | "highest_fuel_cost" | "most_actual_km" | "most_completed_trips";

type PerformanceRow = {
  name: string;
  trips: TripJourneyWithFuel[];
  completedTrips: number;
  actualKm: number;
  estimatedKm: number;
  litres: number;
  cost: number;
  kmPerLitre: number | null;
  costPerKm: number | null;
  averageDifferenceKm: number | null;
  performanceLabel: string;
};

type RoutePerformanceRow = PerformanceRow & {
  route: string;
  averageActualKm: number | null;
  averageEstimatedKm: number | null;
  averageFuelCost: number | null;
};

type TripComparisonRow = {
  trip: TripJourneyWithFuel;
  metrics: ReturnType<typeof getTripMetrics>;
  status: DerivedTripStatus;
  label: string;
};

type DistanceEstimateResponse = {
  distanceKm?: number;
  durationSeconds?: number | null;
  provider?: string;
};

type DeleteTarget = {
  id: string;
  label: string;
} | null;

const emptyFilters: TripFilter = {
  fromDate: "",
  toDate: "",
  driver: "",
  vehicle: "",
  route: "",
  dataStatus: "all",
  fuelLink: "all"
};

function toNumber(value: unknown) {
  if (typeof value === "string" && value.trim() === "") return null;
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatNumber(value: number | null | undefined, decimals = 0) {
  if (value == null || !Number.isFinite(value)) return "-";
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals
  }).format(value);
}

function formatCurrency(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "-";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "THB",
    maximumFractionDigits: 0
  }).format(value);
}

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function normalizeLookup(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

function formatDuration(seconds: number | null | undefined) {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return "-";
  const minutes = Math.max(1, Math.round(seconds / 60));
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours <= 0) return `${minutes} min`;
  return remainingMinutes ? `${hours} hr ${remainingMinutes} min` : `${hours} hr`;
}

function getEstimateSourceLabel(values: {
  estimated_distance_km?: number | string | null;
  manual_estimated_distance_km?: number | string | null;
}) {
  const manual = toNumber(values.manual_estimated_distance_km);
  const google = toNumber(values.estimated_distance_km);
  if (manual != null && manual > 0) return "Manual override";
  if (google != null && google > 0) return "Google Maps estimate";
  return "Not calculated";
}

function getStartLocationType(trip: Pick<TripJourneyWithFuel, "start_location" | "depot_address" | "start_location_type">) {
  if (trip.start_location_type === "custom") return "custom";
  if (trip.start_location && !isDepotLocation(trip.start_location)) return "custom";
  return "depot";
}

function getEffectiveEstimatedKm(values: {
  estimated_distance_km?: number | string | null;
  manual_estimated_distance_km?: number | string | null;
}) {
  const manual = toNumber(values.manual_estimated_distance_km);
  if (manual != null && manual > 0) return manual;
  const google = toNumber(values.estimated_distance_km);
  if (google != null && google > 0) return google;
  return null;
}

function tripToForm(trip: TripJourneyWithFuel): TripForm {
  return {
    id: trip.id,
    booking_diary_id: trip.booking_diary_id ?? trip.booking_id ?? "",
    booking_reference: trip.booking_reference ?? "",
    trip_date: trip.trip_date,
    pickup_time: trip.pickup_time ?? "",
    start_location_type: getStartLocationType(trip),
    start_location: trip.start_location ?? DEPOT_ADDRESS,
    depot_address: trip.depot_address ?? DEPOT_ADDRESS,
    pickup_location: trip.pickup_location ?? "",
    dropoff_location: trip.dropoff_location ?? "",
    route: trip.route ?? "",
    vehicle_type: trip.vehicle_type ?? "",
    vehicle_reg: trip.vehicle_reg ?? "",
    driver: trip.driver ?? "",
    load_details: trip.load_details ?? "",
    warehouse_no: trip.warehouse_no ?? "",
    booking_notes: trip.booking_notes ?? "",
    start_mileage: trip.start_mileage?.toString() ?? "",
    end_mileage: trip.end_mileage?.toString() ?? "",
    manual_actual_km: trip.manual_actual_km?.toString() ?? "",
    return_to_depot: trip.return_to_depot,
    estimated_distance_km: trip.estimated_distance_km?.toString() ?? "",
    manual_estimated_distance_km: trip.manual_estimated_distance_km?.toString() ?? "",
    manual_litres_used: trip.manual_litres_used?.toString() ?? "",
    manual_fuel_cost: trip.manual_fuel_cost?.toString() ?? "",
    fuel_source: trip.fuel_source,
    waiting_idle_notes: trip.waiting_idle_notes ?? "",
    extra_route_notes: trip.extra_route_notes ?? ""
  };
}

function getActualDistance(trip: Pick<TripJourneyWithFuel, "start_mileage" | "end_mileage" | "manual_actual_km" | "actual_distance_km">) {
  if (trip.manual_actual_km != null && trip.manual_actual_km > 0) return trip.manual_actual_km;
  if (trip.start_mileage != null && trip.end_mileage != null && trip.end_mileage > trip.start_mileage) {
    return trip.end_mileage - trip.start_mileage;
  }
  if (trip.actual_distance_km != null && trip.actual_distance_km > 0) return trip.actual_distance_km;
  return null;
}

function getEstimatedDistance(trip: Pick<TripJourneyWithFuel, "estimated_distance_km" | "manual_estimated_distance_km">) {
  return getEffectiveEstimatedKm(trip);
}

function getFuelTotals(trip: TripJourneyWithFuel) {
  const linkedLitres = trip.linkedFuelLogs.reduce((sum, log) => sum + Number(log.litres || 0), 0);
  const linkedCost = trip.linkedFuelLogs.reduce((sum, log) => sum + Number(log.total_cost || 0), 0);
  const manualLitres = trip.manual_litres_used ?? null;
  const manualCost = trip.manual_fuel_cost ?? null;

  return {
    linkedLitres,
    linkedCost,
    litres: trip.fuel_source === "manual" ? manualLitres : linkedLitres || null,
    cost: trip.fuel_source === "manual" ? manualCost : linkedCost || null,
    isUsingLinked: trip.fuel_source !== "manual",
    hasDoubleCountRisk:
      trip.linkedFuelLogs.length > 0 &&
      ((manualLitres != null && manualLitres > 0) || (manualCost != null && manualCost > 0))
  };
}

function getTripMetrics(trip: TripJourneyWithFuel) {
  const actualDistance = getActualDistance(trip);
  const estimatedDistance = getEstimatedDistance(trip);
  const fuel = getFuelTotals(trip);
  const differenceKm =
    actualDistance != null && estimatedDistance != null ? actualDistance - estimatedDistance : null;
  const differencePercent =
    differenceKm != null && estimatedDistance != null && estimatedDistance > 0
      ? (differenceKm / estimatedDistance) * 100
      : null;
  const kmPerLitre =
    actualDistance != null && fuel.litres != null && fuel.litres > 0 ? actualDistance / fuel.litres : null;
  const costPerKm =
    fuel.cost != null && actualDistance != null && actualDistance > 0 ? fuel.cost / actualDistance : null;

  return { actualDistance, estimatedDistance, fuel, differenceKm, differencePercent, kmPerLitre, costPerKm };
}

function hasValidActiveFuel(trip: TripJourneyWithFuel, metrics = getTripMetrics(trip)) {
  if (trip.fuel_source === "manual") {
    return (trip.manual_litres_used ?? 0) > 0 && (trip.manual_fuel_cost ?? 0) > 0;
  }
  return metrics.fuel.linkedLitres > 0 && metrics.fuel.linkedCost > 0;
}

function getDerivedTripStatus(trip: TripJourneyWithFuel): DerivedTripStatus {
  const metrics = getTripMetrics(trip);
  if ((metrics.actualDistance ?? 0) <= 0) return "missing_mileage";
  if ((metrics.estimatedDistance ?? 0) <= 0) return "missing_estimated_distance";
  if (!hasValidActiveFuel(trip, metrics)) return "missing_fuel";
  return "completed";
}

function isCompletedTrip(trip: TripJourneyWithFuel) {
  return getDerivedTripStatus(trip) === "completed";
}

function getHealthBadgeClass(label: string) {
  if (["Good", "Best KM/L", "Lowest cost/km"].includes(label)) return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (["Needs more data", "Limited data"].includes(label)) return "border-slate-200 bg-slate-50 text-slate-600";
  return "border-amber-200 bg-amber-50 text-amber-800";
}

function getTripHealthLabel(
  metrics: ReturnType<typeof getTripMetrics>,
  comparison: { averageKmPerLitre: number | null; averageCostPerKm: number | null; completedTrips: number }
) {
  if (comparison.completedTrips < 2) return "Needs more data";
  if (metrics.differencePercent != null && metrics.differencePercent > 15) return "Over estimate";
  if (comparison.averageCostPerKm != null && metrics.costPerKm != null && metrics.costPerKm > comparison.averageCostPerKm * 1.2) {
    return "High cost/km";
  }
  if (comparison.averageKmPerLitre != null && metrics.kmPerLitre != null && metrics.kmPerLitre < comparison.averageKmPerLitre * 0.8) {
    return "Low efficiency";
  }
  return "Good";
}

function getPerformanceLabel(row: Pick<PerformanceRow, "completedTrips" | "kmPerLitre" | "costPerKm">, bestKmPerLitre: number | null, lowestCostPerKm: number | null) {
  if (row.completedTrips === 0) return "Needs more data";
  if (bestKmPerLitre != null && row.kmPerLitre === bestKmPerLitre) return "Best KM/L";
  if (lowestCostPerKm != null && row.costPerKm === lowestCostPerKm) return "Lowest cost/km";
  return "Average";
}

function sortPerformanceRows<T extends PerformanceRow>(rows: T[], sort: ComparisonSort) {
  const valueOrNullBottom = (value: number | null) => value == null ? Number.POSITIVE_INFINITY : value;
  const sorted = [...rows];
  if (sort === "lowest_cost_per_km") {
    return sorted.sort((a, b) => valueOrNullBottom(a.costPerKm) - valueOrNullBottom(b.costPerKm));
  }
  if (sort === "highest_fuel_cost") {
    return sorted.sort((a, b) => b.cost - a.cost);
  }
  if (sort === "most_actual_km") {
    return sorted.sort((a, b) => b.actualKm - a.actualKm);
  }
  if (sort === "most_completed_trips") {
    return sorted.sort((a, b) => b.completedTrips - a.completedTrips);
  }
  return sorted.sort((a, b) => (b.kmPerLitre ?? -1) - (a.kmPerLitre ?? -1));
}

function getRoutePreview(trip: Pick<TripJourneyWithFuel, "start_location" | "pickup_location" | "dropoff_location" | "return_to_depot" | "depot_address" | "start_location_type">) {
  const start = getStartLocationType(trip) === "depot" ? trip.depot_address || DEPOT_ADDRESS : trip.start_location || "";
  const parts = [start, trip.pickup_location, trip.dropoff_location].filter(Boolean);
  if (trip.return_to_depot) parts.push(trip.depot_address || DEPOT_ADDRESS);
  return parts.join(" -> ");
}

function isDepotLocation(value: string | null | undefined) {
  const normalized = String(value ?? "").toLowerCase();
  return normalized.includes("expert express sender") || normalized.includes("happy place");
}

function shortenLocation(value: string | null | undefined) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (isDepotLocation(text)) return "Depot";
  return text
    .replace(/,?\s*Thailand$/i, "")
    .replace(/,?\s*Bangkok\s*\d*$/i, "")
    .split(",")[0]
    .trim();
}

function getShortRoutePreview(trip: Pick<TripJourneyWithFuel, "start_location" | "pickup_location" | "dropoff_location" | "return_to_depot" | "depot_address" | "start_location_type">) {
  const parts = [
    getStartLocationType(trip) === "depot" ? "Depot" : shortenLocation(trip.start_location) || "Custom start",
    shortenLocation(trip.pickup_location),
    shortenLocation(trip.dropoff_location)
  ].filter(Boolean);
  if (trip.return_to_depot) parts.push("Depot");
  return parts.join(" -> ");
}

function statusActionText(status: string) {
  if (status === "completed") return "Review performance";
  if (status === "missing_mileage") return "Add actual km";
  if (status === "missing_estimated_distance") return "Add estimate";
  if (status === "missing_fuel") return "Manage fuel logs";
  return "Review details";
}

function getNextActionHelper(status: string) {
  if (status === "missing_mileage") return "Actual KM is required before efficiency can be calculated.";
  if (status === "missing_estimated_distance") return "Estimated KM lets you compare planned vs actual distance.";
  if (status === "missing_fuel") return "Link fuel logs or enter manual fuel to complete this trip.";
  if (status === "completed") return "This trip is complete and included in performance comparison.";
  return "Review trip details and complete the missing fields.";
}

function actionTabForStatus(status: string): SelectedTripTab {
  if (status === "missing_fuel") return "fuel";
  if (status === "missing_mileage" || status === "missing_estimated_distance") return "journey";
  return "overview";
}

function getFormMetrics(form: TripForm, linkedFuelLogs: FuelLogWithDriver[]) {
  const startMileage = toNumber(form.start_mileage);
  const endMileage = toNumber(form.end_mileage);
  const manualActualKm = toNumber(form.manual_actual_km);
  const actualDistance =
    manualActualKm != null && manualActualKm > 0
      ? manualActualKm
      : startMileage != null && endMileage != null && endMileage > startMileage
        ? endMileage - startMileage
        : null;
  const estimatedDistance = getEffectiveEstimatedKm(form);
  const linkedLitres = linkedFuelLogs.reduce((sum, log) => sum + Number(log.litres || 0), 0);
  const linkedCost = linkedFuelLogs.reduce((sum, log) => sum + Number(log.total_cost || 0), 0);
  const fuelLitres = form.fuel_source === "manual" ? toNumber(form.manual_litres_used) : linkedLitres || null;
  const fuelCost = form.fuel_source === "manual" ? toNumber(form.manual_fuel_cost) : linkedCost || null;
  return {
    actualDistance,
    estimatedDistance,
    differenceKm: actualDistance != null && estimatedDistance != null ? actualDistance - estimatedDistance : null,
    fuelLitres,
    fuelCost,
    kmPerLitre: actualDistance != null && fuelLitres != null && fuelLitres > 0 ? actualDistance / fuelLitres : null,
    costPerKm: actualDistance != null && actualDistance > 0 && fuelCost != null ? fuelCost / actualDistance : null,
    actualSource: manualActualKm != null && manualActualKm > 0 ? "Using manual actual km" : startMileage != null && endMileage != null && endMileage > startMileage ? "Using mileage calculation" : "Actual km missing"
  };
}

function statusLabel(status: string) {
  if (status === "completed") return "Complete";
  if (status === "missing_mileage") return "Missing Mileage";
  if (status === "missing_fuel") return "Missing Fuel";
  if (status === "missing_estimated_distance") return "Missing Estimate";
  return "Created";
}

function statusClass(status: string) {
  if (status === "completed") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "created") return "border-slate-200 bg-slate-50 text-slate-700";
  return "border-amber-200 bg-amber-50 text-amber-800";
}

function isSuggestedFuelLog(trip: TripJourneyWithFuel, log: FuelLogWithDriver, linkedFuelLogIds: Set<string>) {
  if (linkedFuelLogIds.has(String(log.id))) return false;
  const sameVehicle = trip.vehicle_reg && log.vehicle_reg && trip.vehicle_reg === log.vehicle_reg;
  const sameDriver = trip.driver && log.driver && trip.driver.toLowerCase() === log.driver.toLowerCase();
  const tripDate = new Date(`${trip.trip_date}T00:00:00`).getTime();
  const fuelDate = new Date(`${log.date}T00:00:00`).getTime();
  if (!Number.isFinite(tripDate) || !Number.isFinite(fuelDate)) return false;
  const daysApart = Math.abs(tripDate - fuelDate) / (24 * 60 * 60 * 1000);
  return Boolean(daysApart <= 3 && (sameVehicle || (!trip.vehicle_reg && sameDriver)));
}

function getFuelLogMatchScore(trip: TripJourneyWithFuel, log: FuelLogWithDriver) {
  const sameVehicle = trip.vehicle_reg && log.vehicle_reg && trip.vehicle_reg === log.vehicle_reg ? 100 : 0;
  const sameDriver = trip.driver && log.driver && trip.driver.toLowerCase() === log.driver.toLowerCase() ? 20 : 0;
  const tripDate = new Date(`${trip.trip_date}T00:00:00`).getTime();
  const fuelDate = new Date(`${log.date}T00:00:00`).getTime();
  const daysApart = Number.isFinite(tripDate) && Number.isFinite(fuelDate)
    ? Math.abs(tripDate - fuelDate) / (24 * 60 * 60 * 1000)
    : 999;
  return sameVehicle + sameDriver - daysApart;
}

function getFriendlyTripError(err: unknown) {
  const message = err instanceof Error ? err.message : "";
  if (message.includes("invalid input syntax for type uuid")) {
    return "A numeric booking or fuel-log reference was sent to a UUID database field. Apply the Trip Journey reference migration, then try again.";
  }
  return message || "Unable to complete this Trip Journey action.";
}

export default function TripJourneyPage() {
  const manualActualKmRef = useRef<HTMLInputElement | null>(null);
  const manualEstimatedKmRef = useRef<HTMLInputElement | null>(null);
  const [trips, setTrips] = useState<TripJourneyWithFuel[]>([]);
  const [fuelLogs, setFuelLogs] = useState<FuelLogWithDriver[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [filters, setFilters] = useState<TripFilter>(emptyFilters);
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [form, setForm] = useState<TripForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [calculatingDistance, setCalculatingDistance] = useState(false);
  const [distanceMessage, setDistanceMessage] = useState<string | null>(null);
  const [distanceDurationText, setDistanceDurationText] = useState<string | null>(null);
  const [driverVehicleMessage, setDriverVehicleMessage] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [requestedTripId, setRequestedTripId] = useState<string | null>(null);
  const [requestedBookingId, setRequestedBookingId] = useState<string | null>(null);
  const [manualFuelSearch, setManualFuelSearch] = useState("");
  const [manualFuelDate, setManualFuelDate] = useState("");
  const [manualFuelExpanded, setManualFuelExpanded] = useState(false);
  const [visibleManualFuelLogCount, setVisibleManualFuelLogCount] = useState(10);
  const [selectedTripTab, setSelectedTripTab] = useState<SelectedTripTab>("overview");
  const [attentionFilter, setAttentionFilter] = useState<AttentionFilter>("all");
  const [visibleTripCount, setVisibleTripCount] = useState(10);
  const [comparisonTab, setComparisonTab] = useState<ComparisonTab>("drivers");
  const [comparisonSort, setComparisonSort] = useState<ComparisonSort>("best_kml");
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setRequestedTripId(params.get("tripId") ?? params.get("trip"));
    setRequestedBookingId(params.get("bookingId") ?? params.get("booking"));
  }, []);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [tripRows, fuelRows, driverRows, vehicleRows] = await Promise.all([
        fetchTripJourneys(),
        fetchFuelLogs(),
        fetchDrivers().catch((driverError) => {
          console.warn("Trip Journey driver lookup warning:", driverError);
          return [] as Driver[];
        }),
        fetchVehicles().catch((vehicleError) => {
          console.warn("Trip Journey vehicle lookup warning:", vehicleError);
          return [] as Vehicle[];
        })
      ]);
      let nextTripRows = tripRows;
      let targetTripId = selectedTripId ?? requestedTripId;

      if (!targetTripId && requestedBookingId) {
        const existingTrip = nextTripRows.find(
          (trip) =>
            String(trip.booking_diary_id ?? "") === String(requestedBookingId) ||
            String(trip.booking_id ?? "") === String(requestedBookingId)
        );

        if (existingTrip) {
          targetTripId = existingTrip.id;
        } else {
          const bookingRows = await fetchBookingDiaryEntries();
          const booking = bookingRows.find((row) => String(row.id) === String(requestedBookingId)) ?? null;
          if (booking) {
            const createdTrip = await createTripJourneyFromBooking(booking);
            targetTripId = createdTrip.id;
            nextTripRows = await fetchTripJourneys();
          }
        }
      }

      setTrips(nextTripRows);
      setFuelLogs(fuelRows);
      setDrivers(driverRows);
      setVehicles(vehicleRows);
      if (targetTripId) {
        const nextSelected = nextTripRows.find((trip) => trip.id === targetTripId) ?? null;
        if (nextSelected && !selectedTripId) {
          setSelectedTripId(nextSelected.id);
          const params = new URLSearchParams(window.location.search);
          if (params.get("tripId") !== nextSelected.id) {
            params.set("tripId", nextSelected.id);
            params.delete("trip");
            window.history.replaceState(null, "", `/trip-journey?${params.toString()}`);
          }
        }
        setForm(nextSelected ? tripToForm(nextSelected) : null);
      }
    } catch (err) {
      console.error("Trip Journey load error:", err);
      setError(err instanceof Error ? err.message : "Unable to load Trip Journey records.");
    } finally {
      setLoading(false);
    }
  }, [requestedBookingId, requestedTripId, selectedTripId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setVisibleManualFuelLogCount(10);
  }, [manualFuelDate, manualFuelSearch, selectedTripId]);

  useEffect(() => {
    setVisibleTripCount(10);
  }, [attentionFilter, filters]);

  const linkedFuelLogIds = useMemo(
    () => new Set(trips.flatMap((trip) => trip.linkedFuelLogs.map((log) => String(log.id)))),
    [trips]
  );
  const selectedTrip = useMemo(
    () => trips.find((trip) => trip.id === selectedTripId) ?? null,
    [selectedTripId, trips]
  );
  const suggestedFuelLogs = useMemo(
    () =>
      selectedTrip
        ? fuelLogs
            .filter((log) => isSuggestedFuelLog(selectedTrip, log, linkedFuelLogIds))
            .sort((a, b) => getFuelLogMatchScore(selectedTrip, b) - getFuelLogMatchScore(selectedTrip, a))
        : [],
    [fuelLogs, linkedFuelLogIds, selectedTrip]
  );
  const manualFuelLogMatches = useMemo(() => {
    const query = manualFuelSearch.trim().toLowerCase();
    return fuelLogs
      .filter((log) => !linkedFuelLogIds.has(String(log.id)))
      .filter((log) => !suggestedFuelLogs.some((suggested) => String(suggested.id) === String(log.id)))
      .filter((log) => !manualFuelDate || log.date === manualFuelDate)
      .filter((log) => {
        if (!query) return true;
        return [log.vehicle_reg, log.driver, log.date, log.station, log.location]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(query);
      })
      .sort((a, b) => selectedTrip ? getFuelLogMatchScore(selectedTrip, b) - getFuelLogMatchScore(selectedTrip, a) : 0);
  }, [fuelLogs, linkedFuelLogIds, manualFuelDate, manualFuelSearch, selectedTrip, suggestedFuelLogs]);
  const manualFuelLogOptions = useMemo(
    () => manualFuelLogMatches.slice(0, visibleManualFuelLogCount),
    [manualFuelLogMatches, visibleManualFuelLogCount]
  );

  const baseFilteredTrips = useMemo(() => {
    return trips.filter((trip) => {
      const derivedStatus = getDerivedTripStatus(trip);
      const missing = derivedStatus !== "completed";
      return (
        (!filters.fromDate || trip.trip_date >= filters.fromDate) &&
        (!filters.toDate || trip.trip_date <= filters.toDate) &&
        (!filters.driver || trip.driver === filters.driver) &&
        (!filters.vehicle || trip.vehicle_reg === filters.vehicle) &&
        (!filters.route || (trip.route ?? "").toLowerCase().includes(filters.route.toLowerCase())) &&
        (filters.dataStatus === "all" || (filters.dataStatus === "missing" ? missing : derivedStatus === "completed")) &&
        (filters.fuelLink === "all" ||
          (filters.fuelLink === "linked" ? trip.linkedFuelLogs.length > 0 : trip.linkedFuelLogs.length === 0))
      );
    }).sort((a, b) => (b.trip_date || "").localeCompare(a.trip_date || ""));
  }, [filters, trips]);

  const filteredTrips = useMemo(() => {
    return baseFilteredTrips.filter((trip) => {
      const metrics = getTripMetrics(trip);
      if (attentionFilter === "missing_mileage") return (metrics.actualDistance ?? 0) <= 0;
      if (attentionFilter === "missing_estimate") return (metrics.estimatedDistance ?? 0) <= 0;
      if (attentionFilter === "missing_fuel") return !hasValidActiveFuel(trip, metrics);
      return true;
    });
  }, [attentionFilter, baseFilteredTrips]);

  const visibleTrips = useMemo(
    () => filteredTrips.slice(0, visibleTripCount),
    [filteredTrips, visibleTripCount]
  );

  const summary = useMemo(() => {
    const completed = baseFilteredTrips.filter(isCompletedTrip);
    const totalActual = baseFilteredTrips.reduce((sum, trip) => sum + (getTripMetrics(trip).actualDistance ?? 0), 0);
    const totalEstimated = baseFilteredTrips.reduce((sum, trip) => sum + (getTripMetrics(trip).estimatedDistance ?? 0), 0);
    const totalLitres = completed.reduce((sum, trip) => sum + (getTripMetrics(trip).fuel.litres ?? 0), 0);
    const totalCost = completed.reduce((sum, trip) => sum + (getTripMetrics(trip).fuel.cost ?? 0), 0);
    const completeMetrics = completed.map(getTripMetrics);
    const averageKmPerLitre =
      completeMetrics.length > 0
        ? completeMetrics.reduce((sum, metrics) => sum + (metrics.kmPerLitre ?? 0), 0) / completeMetrics.length
        : null;
    const completedActual = completed.reduce((sum, trip) => sum + (getTripMetrics(trip).actualDistance ?? 0), 0);
    const completedCost = completed.reduce((sum, trip) => sum + (getTripMetrics(trip).fuel.cost ?? 0), 0);
    const averageCostPerKm = completedActual > 0 && completedCost > 0 ? completedCost / completedActual : null;
    const averageDifference =
      completed.length > 0
        ? completed.reduce((sum, trip) => sum + (getTripMetrics(trip).differenceKm ?? 0), 0) / completed.length
        : null;

    const buildRows = (getName: (trip: TripJourneyWithFuel) => string): PerformanceRow[] => {
      const rows = Array.from(
        baseFilteredTrips.reduce((map, trip) => {
          const key = getName(trip);
          const current = map.get(key) ?? { name: key, trips: [] as TripJourneyWithFuel[] };
          current.trips.push(trip);
          map.set(key, current);
          return map;
        }, new Map<string, { name: string; trips: TripJourneyWithFuel[] }>())
      ).map(([, row]) => {
        const completedTrips = row.trips.filter(isCompletedTrip);
        const actualKm = completedTrips.reduce((sum, trip) => sum + (getTripMetrics(trip).actualDistance ?? 0), 0);
        const estimatedKm = completedTrips.reduce((sum, trip) => sum + (getTripMetrics(trip).estimatedDistance ?? 0), 0);
        const litres = completedTrips.reduce((sum, trip) => sum + (getTripMetrics(trip).fuel.litres ?? 0), 0);
        const cost = completedTrips.reduce((sum, trip) => sum + (getTripMetrics(trip).fuel.cost ?? 0), 0);
        const diff = completedTrips.reduce((sum, trip) => sum + (getTripMetrics(trip).differenceKm ?? 0), 0);
        return {
          ...row,
          completedTrips: completedTrips.length,
          actualKm,
          estimatedKm,
          litres,
          cost,
          kmPerLitre: litres > 0 ? actualKm / litres : null,
          costPerKm: actualKm > 0 ? cost / actualKm : null,
          averageDifferenceKm: completedTrips.length ? diff / completedTrips.length : null,
          performanceLabel: "Average"
        };
      });
      const bestKmPerLitre = rows.filter((row) => row.kmPerLitre != null).sort((a, b) => (b.kmPerLitre ?? 0) - (a.kmPerLitre ?? 0))[0]?.kmPerLitre ?? null;
      const lowestCostPerKm = rows.filter((row) => row.costPerKm != null).sort((a, b) => (a.costPerKm ?? 0) - (b.costPerKm ?? 0))[0]?.costPerKm ?? null;
      return rows.map((row) => ({ ...row, performanceLabel: getPerformanceLabel(row, bestKmPerLitre, lowestCostPerKm) }));
    };

    const driverRows = buildRows((trip) => trip.driver || "Unassigned");
    const vehicleRows = buildRows((trip) => trip.vehicle_reg || trip.vehicle_type || "Unassigned");
    const routeRows: RoutePerformanceRow[] = buildRows((trip) => getShortRoutePreview(trip) || trip.route || "Unknown route").map((row) => ({
      ...row,
      route: row.name,
      averageActualKm: row.completedTrips ? row.actualKm / row.completedTrips : null,
      averageEstimatedKm: row.completedTrips ? row.estimatedKm / row.completedTrips : null,
      averageFuelCost: row.completedTrips ? row.cost / row.completedTrips : null,
      performanceLabel: row.completedTrips <= 1 ? "Limited data" : row.performanceLabel
    }));
    const tripRows: TripComparisonRow[] = baseFilteredTrips.map((trip) => {
      const metrics = getTripMetrics(trip);
      const status = getDerivedTripStatus(trip);
      return {
        trip,
        metrics,
        status,
        label: status === "completed"
          ? getTripHealthLabel(metrics, { averageKmPerLitre, averageCostPerKm, completedTrips: completed.length })
          : statusLabel(status)
      };
    });

    const bestDriverByKmPerLitre = [...driverRows].filter((row) => row.kmPerLitre != null).sort((a, b) => (b.kmPerLitre ?? 0) - (a.kmPerLitre ?? 0))[0] ?? null;
    const lowestCostDriver = [...driverRows].filter((row) => row.costPerKm != null).sort((a, b) => (a.costPerKm ?? 0) - (b.costPerKm ?? 0))[0] ?? null;
    const bestVehicleByKmPerLitre = [...vehicleRows].filter((row) => row.kmPerLitre != null).sort((a, b) => (b.kmPerLitre ?? 0) - (a.kmPerLitre ?? 0))[0] ?? null;
    const lowestCostVehicle = [...vehicleRows].filter((row) => row.costPerKm != null).sort((a, b) => (a.costPerKm ?? 0) - (b.costPerKm ?? 0))[0] ?? null;
    const mostExpensiveTrip = [...tripRows].filter((row) => row.status === "completed" && row.metrics.costPerKm != null).sort((a, b) => (b.metrics.costPerKm ?? 0) - (a.metrics.costPerKm ?? 0))[0] ?? null;
    const biggestDistanceDifference = [...tripRows].filter((row) => row.metrics.differenceKm != null).sort((a, b) => Math.abs(b.metrics.differenceKm ?? 0) - Math.abs(a.metrics.differenceKm ?? 0))[0] ?? null;
    const dataQualityNotes = [
      baseFilteredTrips.some((trip) => (getTripMetrics(trip).fuel.cost ?? 0) <= 0) ? "Some trips have no valid fuel cost." : "",
      baseFilteredTrips.some((trip) => trip.linkedFuelLogs.length > 0 && getTripMetrics(trip).fuel.linkedCost <= 0) ? "Some linked fuel logs have no fuel cost." : "",
      baseFilteredTrips.some((trip) => (getTripMetrics(trip).estimatedDistance ?? 0) > 0 && (getTripMetrics(trip).actualDistance ?? 0) <= 0) ? "Some trips have estimates but no actual km." : "",
      baseFilteredTrips.some((trip) => (getTripMetrics(trip).actualDistance ?? 0) > 0 && !hasValidActiveFuel(trip)) ? "Some trips have actual km but no active fuel data." : ""
    ].filter(Boolean);

    return {
      totalTrips: baseFilteredTrips.length,
      completedTrips: completed.length,
      missingDataTrips: baseFilteredTrips.filter((trip) => !isCompletedTrip(trip)).length,
      missingMileage: baseFilteredTrips.filter((trip) => (getTripMetrics(trip).actualDistance ?? 0) <= 0).length,
      missingEstimate: baseFilteredTrips.filter((trip) => (getTripMetrics(trip).estimatedDistance ?? 0) <= 0).length,
      missingFuel: baseFilteredTrips.filter((trip) => !hasValidActiveFuel(trip)).length,
      totalActual,
      totalEstimated,
      totalLitres,
      totalCost,
      averageKmPerLitre,
      averageCostPerKm,
      averageDifference,
      bestDriver: bestDriverByKmPerLitre?.name ?? "-",
      worstDriver: [...driverRows].filter((row) => row.kmPerLitre != null).sort((a, b) => (a.kmPerLitre ?? 0) - (b.kmPerLitre ?? 0))[0]?.name ?? "-",
      driverRows,
      vehicleRows,
      routeRows,
      tripRows,
      bestDriverByKmPerLitre,
      lowestCostDriver,
      bestVehicleByKmPerLitre,
      lowestCostVehicle,
      mostExpensiveTrip,
      biggestDistanceDifference,
      dataQualityNotes
    };
  }, [baseFilteredTrips]);

  const sortedDriverRows = useMemo(() => sortPerformanceRows(summary.driverRows, comparisonSort), [comparisonSort, summary.driverRows]);
  const sortedVehicleRows = useMemo(() => sortPerformanceRows(summary.vehicleRows, comparisonSort), [comparisonSort, summary.vehicleRows]);
  const sortedRouteRows = useMemo(() => sortPerformanceRows(summary.routeRows, comparisonSort), [comparisonSort, summary.routeRows]);
  const sortedTripRows = useMemo(() => {
    return [...summary.tripRows].sort((a, b) => {
      if (comparisonSort === "lowest_cost_per_km") return (a.metrics.costPerKm ?? Number.POSITIVE_INFINITY) - (b.metrics.costPerKm ?? Number.POSITIVE_INFINITY);
      if (comparisonSort === "highest_fuel_cost") return (b.metrics.fuel.cost ?? 0) - (a.metrics.fuel.cost ?? 0);
      if (comparisonSort === "most_actual_km") return (b.metrics.actualDistance ?? 0) - (a.metrics.actualDistance ?? 0);
      if (comparisonSort === "most_completed_trips") return a.status === b.status ? 0 : a.status === "completed" ? -1 : 1;
      return (b.metrics.kmPerLitre ?? -1) - (a.metrics.kmPerLitre ?? -1);
    });
  }, [comparisonSort, summary.tripRows]);

  const driverOptions = useMemo(
    () => Array.from(new Set(trips.map((trip) => trip.driver).filter(Boolean))).sort() as string[],
    [trips]
  );
  const vehicleOptions = useMemo(
    () => Array.from(new Set(trips.map((trip) => trip.vehicle_reg).filter(Boolean))).sort() as string[],
    [trips]
  );
  const selectedFormMetrics = form ? getFormMetrics(form, selectedTrip?.linkedFuelLogs ?? []) : null;
  const selectedTripStatus = selectedTrip ? getDerivedTripStatus(selectedTrip) : null;
  const selectedTripHealth =
    selectedTrip && selectedTripStatus === "completed"
      ? getTripHealthLabel(getTripMetrics(selectedTrip), {
          averageKmPerLitre: summary.averageKmPerLitre,
          averageCostPerKm: summary.averageCostPerKm,
          completedTrips: summary.completedTrips
        })
      : null;
  const driverDatalistOptions = useMemo(() => {
    const values = new Set<string>();
    drivers.forEach((driver) => {
      if (driver.name) values.add(driver.name);
    });
    trips.forEach((trip) => {
      if (trip.driver) values.add(trip.driver);
    });
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [drivers, trips]);
  const vehicleDatalistOptions = useMemo(() => {
    const values = new Set<string>();
    vehicles.forEach((vehicle) => {
      const registration = vehicle.vehicle_reg || vehicle.registration;
      if (registration) values.add(registration);
    });
    drivers.forEach((driver) => {
      if (driver.vehicle_reg) values.add(driver.vehicle_reg);
    });
    trips.forEach((trip) => {
      if (trip.vehicle_reg) values.add(trip.vehicle_reg);
    });
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [drivers, trips, vehicles]);
  const selectedEstimateSource = form
    ? getEstimateSourceLabel({
        estimated_distance_km: form.estimated_distance_km,
        manual_estimated_distance_km: form.manual_estimated_distance_km
      })
    : "Not calculated";

  const openTrip = (trip: TripJourneyWithFuel) => {
    setSelectedTripId(trip.id);
    setForm(tripToForm(trip));
    setHasUnsavedChanges(false);
    setSelectedTripTab("overview");
    setManualFuelExpanded(false);
    setDistanceMessage(null);
    setDistanceDurationText(null);
    setDriverVehicleMessage(null);
    setNotice(null);
    setError(null);
    const params = new URLSearchParams(window.location.search);
    params.set("tripId", trip.id);
    params.delete("trip");
    window.history.replaceState(null, "", `/trip-journey?${params.toString()}`);
  };

  const updateForm = (field: keyof TripForm, value: string | boolean) => {
    setHasUnsavedChanges(true);
    setForm((current) => (current ? { ...current, [field]: value } : current));
  };

  const handleDriverChange = (value: string) => {
    setHasUnsavedChanges(true);
    setForm((current) => {
      if (!current) return current;
      const matchedDriver = drivers.find((driver) => normalizeLookup(driver.name) === normalizeLookup(value));
      if (!matchedDriver?.vehicle_reg) {
        setDriverVehicleMessage(value.trim() ? "Manual driver entry. Vehicle can still be selected or typed." : null);
        return { ...current, driver: value };
      }

      if (normalizeLookup(current.vehicle_reg) === normalizeLookup(matchedDriver.vehicle_reg)) {
        setDriverVehicleMessage("Driver matched from Drivers page.");
        return { ...current, driver: value };
      }

      setDriverVehicleMessage("Vehicle updated from selected driver. You can still change it.");
      return {
        ...current,
        driver: value,
        vehicle_reg: matchedDriver.vehicle_reg,
        vehicle_type: matchedDriver.vehicle_type ?? current.vehicle_type
      };
    });
  };

  const handleVehicleChange = (value: string) => {
    setDriverVehicleMessage(value.trim() ? "Vehicle can come from the list or be typed manually." : null);
    updateForm("vehicle_reg", value);
  };

  const handleStartLocationTypeChange = (value: "depot" | "custom") => {
    setHasUnsavedChanges(true);
    setDistanceMessage(null);
    setDistanceDurationText(null);
    setForm((current) => {
      if (!current) return current;
      if (value === "depot") {
        return {
          ...current,
          start_location_type: "depot",
          depot_address: current.depot_address || DEPOT_ADDRESS,
          start_location: current.depot_address || DEPOT_ADDRESS
        };
      }
      return {
        ...current,
        start_location_type: "custom",
        start_location: isDepotLocation(current.start_location) ? "" : current.start_location
      };
    });
  };

  const focusJourneyField = (target: "actual" | "estimate") => {
    setSelectedTripTab("journey");
    window.setTimeout(() => {
      const field = target === "actual" ? manualActualKmRef.current : manualEstimatedKmRef.current;
      field?.focus();
      field?.select();
    }, 80);
  };

  const handlePrimaryTripAction = (status: string) => {
    if (status === "missing_mileage") {
      focusJourneyField("actual");
      return;
    }
    if (status === "missing_estimated_distance") {
      focusJourneyField("estimate");
      return;
    }
    if (status === "missing_fuel") {
      setSelectedTripTab("fuel");
      return;
    }
    setSelectedTripTab(status === "completed" ? "overview" : actionTabForStatus(status));
  };

  const getCurrentRoutePreview = () => {
    if (!form) return "";
    const start = form.start_location_type === "depot" ? "Depot" : shortenLocation(form.start_location) || "Custom start";
    const parts = [start, shortenLocation(form.pickup_location), shortenLocation(form.dropoff_location)].filter(Boolean);
    if (form.return_to_depot) parts.push("Depot");
    return parts.join(" -> ");
  };

  const handleCalculateRouteDistance = async () => {
    if (!form) return;
    const start = form.start_location_type === "depot" ? DEPOT_ADDRESS : form.start_location.trim();
    const pickup = form.pickup_location.trim();
    const dropoff = form.dropoff_location.trim();

    if (!start) {
      setDistanceMessage("Please enter a start location before calculating distance.");
      return;
    }

    if (!pickup || !dropoff) {
      setDistanceMessage("Please enter pickup and drop-off locations before calculating distance.");
      return;
    }

    const destination = form.return_to_depot ? (form.depot_address.trim() || DEPOT_ADDRESS) : dropoff;
    const waypoints = form.return_to_depot ? [pickup, dropoff] : [pickup];

    try {
      setCalculatingDistance(true);
      setDistanceMessage(null);
      setDistanceDurationText(null);
      const response = await fetch("/api/distance-estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          origin: start,
          destination,
          waypoints
        })
      });
      const result = (await response.json()) as {
        success?: boolean;
        data?: DistanceEstimateResponse | null;
        error?: string | null;
      };

      if (!response.ok || !result.success || result.data?.distanceKm == null) {
        throw new Error(result.error || "Google Maps could not calculate this route.");
      }

      const distanceKm = Number(result.data.distanceKm);
      const durationText = result.data.durationSeconds ? formatDuration(result.data.durationSeconds) : null;
      setHasUnsavedChanges(true);
      setForm((current) =>
        current
          ? {
              ...current,
              start_location_type: form.start_location_type,
              start_location: start,
              depot_address: current.depot_address || DEPOT_ADDRESS,
              estimated_distance_km: distanceKm.toFixed(2)
            }
          : current
      );
      setDistanceMessage(`Route distance calculated. Save trip to store it.`);
      setDistanceDurationText(durationText);
    } catch (err) {
      console.warn("Route distance calculation warning:", err);
      setDistanceMessage("Could not calculate route distance. You can enter manual estimated KM instead.");
    } finally {
      setCalculatingDistance(false);
    }
  };

  const requestDeleteTrip = (trip: TripJourneyWithFuel) => {
    setDeleteTarget({
      id: trip.id,
      label: `${formatDate(trip.trip_date)} | ${getShortRoutePreview(trip)}`
    });
  };

  const handleConfirmDeleteTrip = async () => {
    if (!deleteTarget) return;
    try {
      setDeleting(true);
      setError(null);
      await deleteTripJourney(deleteTarget.id);
      if (selectedTripId === deleteTarget.id) {
        setSelectedTripId(null);
        setForm(null);
        setHasUnsavedChanges(false);
      }
      setDeleteTarget(null);
      setNotice("Trip deleted successfully.");
      await load();
    } catch {
      setError("Unable to delete this trip. Please try again.");
    } finally {
      setDeleting(false);
    }
  };

  const handleSaveTrip = async () => {
    if (!form) return;
    const linkedFuelLogs = selectedTrip?.linkedFuelLogs ?? [];
    const start = toNumber(form.start_mileage);
    const end = toNumber(form.end_mileage);
    if (start != null && end != null && end < start) {
      setError("End mileage is lower than start mileage. Please check the readings.");
      return;
    }

    try {
      setSaving(true);
      setError(null);
      const saved = await saveTripJourney({
        ...form,
        booking_diary_id: form.booking_diary_id || selectedTrip?.booking_diary_id || selectedTrip?.booking_id || null,
        booking_reference: form.booking_reference || selectedTrip?.booking_reference || null,
        start_location_type: form.start_location_type,
        start_location: form.start_location_type === "depot" ? form.depot_address || DEPOT_ADDRESS : form.start_location,
        depot_address: form.depot_address || DEPOT_ADDRESS,
        start_mileage: toNumber(form.start_mileage),
        end_mileage: toNumber(form.end_mileage),
        manual_actual_km: toNumber(form.manual_actual_km),
        estimated_distance_km: toNumber(form.estimated_distance_km),
        manual_estimated_distance_km: toNumber(form.manual_estimated_distance_km),
        manual_litres_used: toNumber(form.manual_litres_used),
        manual_fuel_cost: toNumber(form.manual_fuel_cost),
        linkedFuelLogs
      });
      setSelectedTripId(saved.id);
      setHasUnsavedChanges(false);
      setNotice("Trip saved successfully.");
      await load();
    } catch (err) {
      console.error("Trip save error:", err);
      setError(getFriendlyTripError(err));
    } finally {
      setSaving(false);
    }
  };

  const handleLinkFuelLog = async (fuelLogId: string) => {
    if (!selectedTripId) return;
    try {
      setError(null);
      await linkFuelLogToTrip(selectedTripId, fuelLogId);
      setNotice("Fuel log linked to trip.");
      await load();
    } catch (err) {
      setError(getFriendlyTripError(err));
    }
  };

  const handleUnlinkFuelLog = async (fuelLogId: string) => {
    if (!selectedTripId) return;
    try {
      setError(null);
      await unlinkFuelLogFromTrip(selectedTripId, fuelLogId);
      setNotice("Fuel log unlinked from trip.");
      await load();
    } catch (err) {
      setError(getFriendlyTripError(err));
    }
  };

  return (
    <div className="space-y-5">
      <section className="surface-card p-4 sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-semibold text-brand-700">Trip Journey</p>
            <h2 className="mt-1 text-2xl font-bold tracking-normal text-slate-950">Trip Performance</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
              Compare booking routes against actual mileage and fuel usage by driver, vehicle, and route.
            </p>
          </div>
          <button type="button" onClick={() => void load()} className="btn-secondary gap-2">
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
        </div>
        {error ? <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{error}</div> : null}
        {notice ? <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">{notice}</div> : null}
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-500">Trip Status</p>
              <p className="mt-1 text-3xl font-bold text-slate-950">{summary.totalTrips}</p>
            </div>
            <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-bold text-brand-700">Trips</span>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div><p className="text-slate-500">Completed</p><p className="font-bold text-emerald-700">{summary.completedTrips}</p></div>
            <div><p className="text-slate-500">Missing mileage</p><p className="font-bold text-amber-700">{summary.missingMileage}</p></div>
            <div><p className="text-slate-500">Missing estimate</p><p className="font-bold text-amber-700">{summary.missingEstimate}</p></div>
            <div><p className="text-slate-500">Missing fuel</p><p className="font-bold text-amber-700">{summary.missingFuel}</p></div>
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm font-semibold text-slate-500">Distance & Fuel</p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div><p className="text-xs text-slate-500">Actual KM</p><p className="text-xl font-bold text-slate-950">{formatNumber(summary.totalActual)}</p></div>
            <div><p className="text-xs text-slate-500">Estimated KM</p><p className="text-xl font-bold text-slate-950">{formatNumber(summary.totalEstimated)}</p></div>
            <div><p className="text-xs text-slate-500">Difference</p><p className="text-xl font-bold text-slate-950">{formatNumber(summary.averageDifference)} km</p></div>
            <div><p className="text-xs text-slate-500">Litres</p><p className="text-xl font-bold text-slate-950">{formatNumber(summary.totalLitres, 2)}</p></div>
            <div className="col-span-2"><p className="text-xs text-slate-500">Fuel Cost</p><p className="text-xl font-bold text-slate-950">{formatCurrency(summary.totalCost)}</p></div>
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm font-semibold text-slate-500">Efficiency</p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div><p className="text-xs text-slate-500">Avg KM/L</p><p className="text-xl font-bold text-slate-950">{formatNumber(summary.averageKmPerLitre, 2)}</p></div>
            <div><p className="text-xs text-slate-500">Avg Cost/KM</p><p className="text-xl font-bold text-slate-950">{formatCurrency(summary.averageCostPerKm)}</p></div>
            <div className="col-span-2 rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">Best Driver</p><p className="truncate font-bold text-slate-950">{summary.bestDriver}</p></div>
            <div className="col-span-2 rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">Worst Driver</p><p className="truncate font-bold text-slate-950">{summary.worstDriver}</p></div>
          </div>
        </div>
      </section>

      <section className="surface-card p-4">
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-[repeat(7,minmax(0,1fr))_auto]">
          <input type="date" value={filters.fromDate} onChange={(event) => setFilters((current) => ({ ...current, fromDate: event.target.value }))} className="form-input bg-white" />
          <input type="date" value={filters.toDate} onChange={(event) => setFilters((current) => ({ ...current, toDate: event.target.value }))} className="form-input bg-white" />
          <select value={filters.driver} onChange={(event) => setFilters((current) => ({ ...current, driver: event.target.value }))} className="form-input bg-white">
            <option value="">All drivers</option>
            {driverOptions.map((driver) => <option key={driver} value={driver}>{driver}</option>)}
          </select>
          <select value={filters.vehicle} onChange={(event) => setFilters((current) => ({ ...current, vehicle: event.target.value }))} className="form-input bg-white">
            <option value="">All vehicles</option>
            {vehicleOptions.map((vehicle) => <option key={vehicle} value={vehicle}>{vehicle}</option>)}
          </select>
          <input value={filters.route} onChange={(event) => setFilters((current) => ({ ...current, route: event.target.value }))} placeholder="Route" className="form-input bg-white" />
          <select value={filters.dataStatus} onChange={(event) => setFilters((current) => ({ ...current, dataStatus: event.target.value as TripFilter["dataStatus"] }))} className="form-input bg-white">
            <option value="all">All data</option>
            <option value="missing">Missing data only</option>
            <option value="completed">Completed only</option>
          </select>
          <select value={filters.fuelLink} onChange={(event) => setFilters((current) => ({ ...current, fuelLink: event.target.value as TripFilter["fuelLink"] }))} className="form-input bg-white">
            <option value="all">All fuel links</option>
            <option value="linked">Fuel logs linked</option>
            <option value="not_linked">Fuel logs not linked</option>
          </select>
          <button type="button" onClick={() => { setFilters(emptyFilters); setAttentionFilter("all"); }} className="btn-secondary min-h-11 whitespace-nowrap px-4 py-2 text-sm">
            Reset filters
          </button>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="section-title">Needs Attention</h3>
            <p className="section-subtitle">Select a missing item to focus the trip list.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3 lg:min-w-[640px]">
            <button type="button" onClick={() => setAttentionFilter("missing_mileage")} className={`rounded-lg px-4 py-3 text-left transition ${attentionFilter === "missing_mileage" ? "bg-amber-100 ring-2 ring-amber-200" : "bg-amber-50 hover:bg-amber-100"}`}>
              <p className="text-xs font-semibold text-amber-700">Missing mileage</p>
              <p className="mt-1 text-lg font-bold text-amber-900">{summary.missingMileage} {summary.missingMileage === 1 ? "trip" : "trips"}</p>
              <p className="mt-1 text-xs text-amber-700">Actual KM is needed for efficiency.</p>
            </button>
            <button type="button" onClick={() => setAttentionFilter("missing_estimate")} className={`rounded-lg px-4 py-3 text-left transition ${attentionFilter === "missing_estimate" ? "bg-amber-100 ring-2 ring-amber-200" : "bg-amber-50 hover:bg-amber-100"}`}>
              <p className="text-xs font-semibold text-amber-700">Missing estimate</p>
              <p className="mt-1 text-lg font-bold text-amber-900">{summary.missingEstimate} {summary.missingEstimate === 1 ? "trip" : "trips"}</p>
              <p className="mt-1 text-xs text-amber-700">Compare planned vs actual route.</p>
            </button>
            <button type="button" onClick={() => setAttentionFilter("missing_fuel")} className={`rounded-lg px-4 py-3 text-left transition ${attentionFilter === "missing_fuel" ? "bg-slate-100 ring-2 ring-slate-200" : "bg-slate-50 hover:bg-slate-100"}`}>
              <p className="text-xs font-semibold text-slate-600">Missing fuel</p>
              <p className="mt-1 text-lg font-bold text-slate-900">{summary.missingFuel} {summary.missingFuel === 1 ? "trip" : "trips"}</p>
              <p className="mt-1 text-xs text-slate-500">Link fuel logs or enter manually.</p>
            </button>
          </div>
        </div>
        {attentionFilter !== "all" ? (
          <button type="button" onClick={() => setAttentionFilter("all")} className="btn-secondary mt-3 min-h-9 px-3 py-1.5 text-xs">
            Show all trips
          </button>
        ) : null}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="section-title">Trip Records</h3>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">{filteredTrips.length} {filteredTrips.length === 1 ? "trip" : "trips"}</span>
            </div>
            <p className="section-subtitle">Compact list of booking journeys. Review one trip to edit details.</p>
          </div>
          <p className="text-xs font-semibold text-slate-500">Newest trips first.</p>
        </div>
        {loading ? (
          <p className="mt-4 text-sm text-slate-500">Loading trip journeys...</p>
        ) : filteredTrips.length === 0 ? (
          <div className="mt-4"><EmptyState title="No trip records yet" description="Create a trip from the Booking Diary to start tracking performance." /></div>
        ) : (
          <div className="mt-4 space-y-3">
            {visibleTrips.map((trip) => {
              const metrics = getTripMetrics(trip);
              const derivedStatus = getDerivedTripStatus(trip);
              const healthLabel = derivedStatus === "completed"
                ? getTripHealthLabel(metrics, {
                    averageKmPerLitre: summary.averageKmPerLitre,
                    averageCostPerKm: summary.averageCostPerKm,
                    completedTrips: summary.completedTrips
                  })
                : statusLabel(derivedStatus);
              return (
                <article key={trip.id} className={`rounded-lg border bg-white px-4 py-3 shadow-sm transition ${selectedTripId === trip.id ? "border-brand-300 ring-2 ring-brand-100" : "border-slate-200 hover:border-brand-200"}`}>
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-bold text-slate-950">{formatDate(trip.trip_date)}</p>
                        <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${statusClass(derivedStatus)}`}>{statusLabel(derivedStatus)}</span>
                        <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${getHealthBadgeClass(healthLabel)}`}>{healthLabel}</span>
                      </div>
                      <p className="mt-1 truncate text-base font-bold leading-6 text-slate-900" title={getRoutePreview(trip)}>{getShortRoutePreview(trip)}</p>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs font-semibold text-slate-600">
                        <span>Driver: {trip.driver || "-"}</span>
                        <span>Vehicle: {trip.vehicle_reg || trip.vehicle_type || "-"}</span>
                        <span>Fuel logs: {trip.linkedFuelLogs.length ? `${trip.linkedFuelLogs.length} linked` : "none"}</span>
                      </div>
                      {trip.fuel_source === "manual" && trip.linkedFuelLogs.length > 0 ? (
                        <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">Linked fuel logs exist, but this trip is using manual fuel entry.</p>
                      ) : null}
                    </div>
                    <div className="grid gap-2 text-xs sm:grid-cols-4 lg:w-[680px]">
                      <div className="rounded-lg bg-slate-50 px-3 py-2"><p className="font-semibold text-slate-500">Est. KM</p><p className="font-bold text-slate-950">{metrics.estimatedDistance == null ? "Missing" : `${formatNumber(metrics.estimatedDistance)} km`}</p><p className="text-[11px] text-slate-500">{getEstimateSourceLabel(trip)}</p></div>
                      <div className="rounded-lg bg-slate-50 px-3 py-2"><p className="font-semibold text-slate-500">Actual KM</p><p className="font-bold text-slate-950">{metrics.actualDistance == null ? "Missing" : `${formatNumber(metrics.actualDistance)} km`}</p></div>
                      <div className="rounded-lg bg-slate-50 px-3 py-2"><p className="font-semibold text-slate-500">Difference</p><p className="font-bold text-slate-950">{metrics.differenceKm == null ? "-" : `${formatNumber(metrics.differenceKm)} km`}</p></div>
                      <div className="rounded-lg bg-slate-50 px-3 py-2"><p className="font-semibold text-slate-500">Fuel</p><p className="font-bold text-slate-950">{metrics.fuel.litres != null && metrics.fuel.litres > 0 ? `${formatNumber(metrics.fuel.litres, 2)} L` : "No fuel"}</p></div>
                      <div className="rounded-lg bg-slate-50 px-3 py-2"><p className="font-semibold text-slate-500">Cost</p><p className="font-bold text-slate-950">{metrics.fuel.cost != null && metrics.fuel.cost > 0 ? formatCurrency(metrics.fuel.cost) : "No fuel cost"}</p></div>
                      <div className="rounded-lg bg-slate-50 px-3 py-2"><p className="font-semibold text-slate-500">KM/L</p><p className="font-bold text-slate-950">{formatNumber(metrics.kmPerLitre, 2)}</p></div>
                      <div className="rounded-lg bg-slate-50 px-3 py-2"><p className="font-semibold text-slate-500">Cost/KM</p><p className="font-bold text-slate-950">{formatCurrency(metrics.costPerKm)}</p></div>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2 lg:flex-col lg:items-end">
                      {derivedStatus !== "completed" ? (
                        <span className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                          Needs attention: {statusActionText(derivedStatus)}
                        </span>
                      ) : null}
                      <button type="button" onClick={() => openTrip(trip)} className="btn-secondary min-h-8 px-3 py-1 text-xs">Review / Edit</button>
                      <button type="button" onClick={() => requestDeleteTrip(trip)} className="min-h-8 rounded-lg border border-rose-200 bg-white px-3 py-1 text-xs font-semibold text-rose-700 transition hover:bg-rose-50">Delete</button>
                    </div>
                  </div>
                </article>
              );
            })}
            {visibleTrips.length < filteredTrips.length ? (
              <button type="button" onClick={() => setVisibleTripCount((count) => count + 10)} className="btn-secondary w-full min-h-10 px-4 py-2 text-sm">
                Load more trips
              </button>
            ) : null}
          </div>
        )}
      </section>

      {form && selectedTrip ? (
        <section className="surface-card overflow-hidden p-0">
          <div className="border-b border-slate-200 bg-white p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-lg font-bold text-slate-950">Selected Trip Overview</h3>
                  {selectedTripStatus ? <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${statusClass(selectedTripStatus)}`}>{statusLabel(selectedTripStatus)}</span> : null}
                  {selectedTripHealth ? <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${getHealthBadgeClass(selectedTripHealth)}`}>{selectedTripHealth}</span> : null}
                </div>
                <p className="mt-1 max-w-4xl text-sm font-semibold leading-6 text-slate-700" title={getRoutePreview(selectedTrip)}>{getShortRoutePreview(selectedTrip)}</p>
              </div>
              <div className="flex min-w-[240px] flex-wrap gap-2 text-sm">
                <div className="rounded-lg bg-slate-50 px-3 py-2"><p className="text-[11px] font-semibold text-slate-500">Driver</p><p className="font-bold text-slate-950">{selectedTrip.driver || "-"}</p></div>
                <div className="rounded-lg bg-slate-50 px-3 py-2"><p className="text-[11px] font-semibold text-slate-500">Vehicle</p><p className="font-bold text-slate-950">{selectedTrip.vehicle_reg || "-"}</p></div>
              </div>
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"><p className="text-xs text-slate-500">Distance</p><p className="font-bold text-slate-950">Est. {formatNumber(selectedFormMetrics?.estimatedDistance)} km / Actual {formatNumber(selectedFormMetrics?.actualDistance)} km</p><p className="text-xs font-semibold text-slate-500">{selectedEstimateSource}</p></div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"><p className="text-xs text-slate-500">Fuel</p><p className="font-bold text-slate-950">{formatNumber(selectedFormMetrics?.fuelLitres, 2)} L / {formatCurrency(selectedFormMetrics?.fuelCost)}</p></div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"><p className="text-xs text-slate-500">Efficiency</p><p className="font-bold text-slate-950">{formatNumber(selectedFormMetrics?.kmPerLitre, 2)} KM/L / {formatCurrency(selectedFormMetrics?.costPerKm)}</p></div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"><p className="text-xs text-slate-500">Fuel Logs</p><p className="font-bold text-slate-950">{selectedTrip.linkedFuelLogs.length ? `${selectedTrip.linkedFuelLogs.length} linked` : "None linked"}</p></div>
            </div>
            <div className="mt-3 flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-semibold text-slate-500">Next action</p>
                <p className="text-sm font-bold text-slate-950">{statusActionText(selectedTripStatus ?? "created")}</p>
                <p className="text-xs text-slate-500">{getNextActionHelper(selectedTripStatus ?? "created")}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => handlePrimaryTripAction(selectedTripStatus ?? "created")} className="btn-primary min-h-9 px-3 py-1.5 text-sm">
                  {statusActionText(selectedTripStatus ?? "created")}
                </button>
                <button type="button" onClick={() => setSelectedTripTab("fuel")} className="btn-secondary min-h-9 px-3 py-1.5 text-sm">Manage fuel logs</button>
                <button type="button" onClick={() => requestDeleteTrip(selectedTrip)} className="min-h-9 rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-sm font-semibold text-rose-700 transition hover:bg-rose-50">Delete trip</button>
                <button type="button" onClick={() => { setSelectedTripId(null); setHasUnsavedChanges(false); }} className="btn-secondary min-h-9 px-3 py-1.5 text-sm">Back to trip list</button>
              </div>
            </div>
          </div>

          <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
            <div className="flex flex-wrap gap-2">
              {[
                ["overview", "Overview"],
                ["journey", "Journey Details"],
                ["fuel", "Fuel Logs"],
                ["notes", "Notes"]
              ].map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelectedTripTab(key as SelectedTripTab)}
                  className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${selectedTripTab === key ? "bg-white text-brand-700 shadow-sm ring-1 ring-brand-100" : "text-slate-600 hover:bg-white hover:text-slate-900"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="p-4">
            {selectedTripTab === "overview" ? (
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                  <h4 className="font-bold text-slate-950">Route</h4>
                  <p className="mt-2 text-sm font-semibold leading-6 text-slate-700" title={getRoutePreview(selectedTrip)}>{getShortRoutePreview(selectedTrip)}</p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    <div><p className="text-xs text-slate-500">Date</p><p className="font-bold text-slate-950">{formatDate(selectedTrip.trip_date)}</p></div>
                    <div><p className="text-xs text-slate-500">Pickup time</p><p className="font-bold text-slate-950">{selectedTrip.pickup_time || "-"}</p></div>
                    <div><p className="text-xs text-slate-500">Booking ref</p><p className="font-bold text-slate-950">{selectedTrip.booking_reference || "-"}</p></div>
                  </div>
              </div>
            ) : null}

            {selectedTripTab === "journey" ? (
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
                <div className="space-y-3">
                  <section className="rounded-lg border border-slate-200 bg-white p-3">
                    <h4 className="font-bold text-slate-950">Booking Info</h4>
                    <div className="mt-2 grid gap-3 sm:grid-cols-3">
                      <div className="form-field"><label className="form-label">Booking reference</label><input value={form.booking_reference} onChange={(event) => updateForm("booking_reference", event.target.value)} className="form-input bg-white" /></div>
                      <div className="form-field"><label className="form-label">Date</label><input type="date" value={form.trip_date} onChange={(event) => updateForm("trip_date", event.target.value)} className="form-input bg-white" /></div>
                      <div className="form-field"><label className="form-label">Pickup time</label><input value={form.pickup_time} onChange={(event) => updateForm("pickup_time", event.target.value)} className="form-input bg-white" /></div>
                    </div>
                  </section>

                  <section className="rounded-lg border border-slate-200 bg-white p-3">
                    <h4 className="font-bold text-slate-950">Driver & Vehicle</h4>
                    <p className="mt-1 text-xs text-slate-500">Pulled from the Drivers and Vehicles pages. Manual typing is still allowed.</p>
                    <div className="mt-2 grid gap-3 sm:grid-cols-2">
                      <div className="form-field">
                        <label className="form-label">Driver</label>
                        <input list="trip-driver-options" value={form.driver} onChange={(event) => handleDriverChange(event.target.value)} placeholder="Select or type driver" className="form-input bg-white" />
                        <datalist id="trip-driver-options">
                          {driverDatalistOptions.map((driver) => <option key={driver} value={driver} />)}
                          <option value="Manual driver entry" />
                        </datalist>
                      </div>
                      <div className="form-field">
                        <label className="form-label">Vehicle reg</label>
                        <input list="trip-vehicle-options" value={form.vehicle_reg} onChange={(event) => handleVehicleChange(event.target.value)} placeholder="Select or type vehicle" className="form-input bg-white" />
                        <datalist id="trip-vehicle-options">
                          {vehicleDatalistOptions.map((vehicle) => <option key={vehicle} value={vehicle} />)}
                          <option value="Manual vehicle entry" />
                        </datalist>
                      </div>
                    </div>
                    {driverVehicleMessage ? <p className="mt-2 text-xs font-semibold text-slate-500">{driverVehicleMessage}</p> : null}
                  </section>

                  <section className="rounded-lg border border-slate-200 bg-white p-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <h4 className="font-bold text-slate-950">Route & Google Maps</h4>
                        <p className="mt-1 text-xs text-slate-500">Choose the start point, then calculate or manually override the estimated distance.</p>
                      </div>
                      <button type="button" onClick={() => void handleCalculateRouteDistance()} disabled={calculatingDistance} className="btn-secondary min-h-9 px-3 py-1.5 text-sm">
                        {calculatingDistance ? "Calculating..." : "Calculate route distance"}
                      </button>
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <div className="sm:col-span-2">
                        <p className="form-label">Start location type</p>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <label className={`flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm font-semibold ${form.start_location_type === "depot" ? "border-brand-200 bg-brand-50 text-brand-800" : "border-slate-200 bg-white text-slate-700"}`}>
                            <input type="radio" name="trip-start-location-type" checked={form.start_location_type === "depot"} onChange={() => handleStartLocationTypeChange("depot")} className="h-4 w-4" />
                            Starts from depot
                          </label>
                          <label className={`flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm font-semibold ${form.start_location_type === "custom" ? "border-brand-200 bg-brand-50 text-brand-800" : "border-slate-200 bg-white text-slate-700"}`}>
                            <input type="radio" name="trip-start-location-type" checked={form.start_location_type === "custom"} onChange={() => handleStartLocationTypeChange("custom")} className="h-4 w-4" />
                            Starts from custom location
                          </label>
                        </div>
                      </div>
                      <div className="form-field sm:col-span-2">
                        <label className="form-label">{form.start_location_type === "depot" ? "Depot address" : "Start location"}</label>
                        <input value={form.start_location_type === "depot" ? form.depot_address || DEPOT_ADDRESS : form.start_location} onChange={(event) => updateForm("start_location", event.target.value)} disabled={form.start_location_type === "depot"} placeholder={form.start_location_type === "custom" ? "Enter start location" : "Depot address"} className="form-input bg-white disabled:bg-slate-100 disabled:text-slate-500" />
                      </div>
                      <div className="form-field"><label className="form-label">Pickup location</label><input value={form.pickup_location} onChange={(event) => updateForm("pickup_location", event.target.value)} className="form-input bg-white" /></div>
                      <div className="form-field"><label className="form-label">Drop-off location</label><input value={form.dropoff_location} onChange={(event) => updateForm("dropoff_location", event.target.value)} className="form-input bg-white" /></div>
                      <label className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700"><input type="checkbox" checked={form.return_to_depot} onChange={(event) => updateForm("return_to_depot", event.target.checked)} className="h-4 w-4" />Return to depot</label>
                      <div className="rounded-lg border border-brand-100 bg-brand-50 px-3 py-2 text-sm sm:col-span-2">
                        <p className="text-xs font-semibold text-slate-500">Route preview</p>
                        <p className="font-bold text-slate-950">{getCurrentRoutePreview() || "-"}</p>
                      </div>
                      <div className="grid gap-2 rounded-lg bg-slate-50 p-2 text-sm sm:col-span-2 md:grid-cols-3">
                        <div className="px-1"><p className="text-xs font-semibold text-slate-500">Google estimated KM</p><p className="font-bold text-slate-950">{toNumber(form.estimated_distance_km) != null && toNumber(form.estimated_distance_km)! > 0 ? `${formatNumber(toNumber(form.estimated_distance_km), 2)} km` : "Not calculated"}</p></div>
                        <div className="px-1"><p className="text-xs font-semibold text-slate-500">Google estimated time</p><p className="font-bold text-slate-950">{distanceDurationText ?? "-"}</p></div>
                        <div className="px-1"><p className="text-xs font-semibold text-slate-500">Route source</p><p className="font-bold text-slate-950">{selectedEstimateSource}</p></div>
                      </div>
                      <div className="form-field">
                        <label className="form-label">Manual estimated KM override</label>
                        <input ref={manualEstimatedKmRef} type="number" min="0" step="0.01" value={form.manual_estimated_distance_km} onChange={(event) => updateForm("manual_estimated_distance_km", event.target.value)} className="form-input bg-white" />
                        <p className="text-xs text-slate-500">Use this if Google Maps is not available or the estimate needs correcting.</p>
                      </div>
                    </div>
                    {distanceMessage ? <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-600">{distanceMessage}</p> : null}
                  </section>

                  <section className="rounded-lg border border-slate-200 bg-white p-3">
                    <h4 className="font-bold text-slate-950">Actual Distance</h4>
                    <div className="mt-2 grid gap-3 sm:grid-cols-3">
                      <div className="form-field"><label className="form-label">Manual actual KM</label><input ref={manualActualKmRef} type="number" min="0" step="0.01" value={form.manual_actual_km} onChange={(event) => updateForm("manual_actual_km", event.target.value)} className="form-input bg-white" /></div>
                      <div className="form-field"><label className="form-label">Start mileage</label><input type="number" min="0" value={form.start_mileage} onChange={(event) => updateForm("start_mileage", event.target.value)} className="form-input bg-white" /></div>
                      <div className="form-field"><label className="form-label">End mileage</label><input type="number" min="0" value={form.end_mileage} onChange={(event) => updateForm("end_mileage", event.target.value)} className="form-input bg-white" /></div>
                    </div>
                  </section>
                </div>
                <div className="self-start rounded-lg border border-slate-200 bg-slate-50 p-3 xl:sticky xl:top-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-xs font-semibold text-slate-500">{selectedFormMetrics?.actualSource}</p>
                      <p className="text-xl font-bold text-slate-950">{formatNumber(selectedFormMetrics?.actualDistance)} km</p>
                    </div>
                    {selectedTripStatus ? <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${statusClass(selectedTripStatus)}`}>{statusLabel(selectedTripStatus)}</span> : null}
                  </div>
                  <div className="mt-3 grid gap-2 text-sm">
                    <div className="rounded-lg bg-white px-3 py-2"><p className="text-xs text-slate-500">Estimated KM</p><p className="font-bold text-slate-950">{formatNumber(selectedFormMetrics?.estimatedDistance)} km</p><p className="text-xs font-semibold text-slate-500">{selectedEstimateSource}</p></div>
                    <div className="rounded-lg bg-white px-3 py-2"><p className="text-xs text-slate-500">Difference</p><p className="font-bold text-slate-950">{formatNumber(selectedFormMetrics?.differenceKm)} km</p></div>
                    <div className="rounded-lg bg-white px-3 py-2"><p className="text-xs text-slate-500">Fuel status</p><p className="font-bold text-slate-950">{selectedFormMetrics?.fuelLitres && selectedFormMetrics?.fuelCost ? `${formatNumber(selectedFormMetrics.fuelLitres, 2)} L / ${formatCurrency(selectedFormMetrics.fuelCost)}` : "No fuel"}</p></div>
                  </div>
                  <button type="button" onClick={() => void handleSaveTrip()} disabled={saving} className="btn-primary mt-3 w-full gap-2"><Save className="h-4 w-4" />{saving ? "Saving..." : "Save trip"}</button>
                  <p className={`mt-2 text-xs font-semibold ${hasUnsavedChanges ? "text-amber-700" : "text-emerald-700"}`}>{hasUnsavedChanges ? "Unsaved changes" : notice === "Trip saved successfully." ? "Trip saved successfully" : "No unsaved changes"}</p>
                  <p className="mt-1 text-xs text-slate-500">Editing here will not change the original Booking Diary entry.</p>
                </div>
              </div>
            ) : null}

            {selectedTripTab === "fuel" ? (
              <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                  <h4 className="font-bold text-slate-950">Fuel Summary</h4>
                  <div className="mt-3 grid gap-3">
                    <div className="form-field"><label className="form-label">Fuel source</label><select value={form.fuel_source} onChange={(event) => updateForm("fuel_source", event.target.value as TripFuelSource)} className="form-input bg-white"><option value="linked">Use linked fuel logs</option><option value="manual">Use manual fuel entry</option></select></div>
                    {form.fuel_source === "manual" ? <><div className="form-field"><label className="form-label">Manual litres used</label><input type="number" min="0" step="0.01" value={form.manual_litres_used} onChange={(event) => updateForm("manual_litres_used", event.target.value)} className="form-input bg-white" /></div><div className="form-field"><label className="form-label">Manual fuel cost</label><input type="number" min="0" step="0.01" value={form.manual_fuel_cost} onChange={(event) => updateForm("manual_fuel_cost", event.target.value)} className="form-input bg-white" /></div></> : null}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">Litres</p><p className="font-bold text-slate-950">{formatNumber(selectedFormMetrics?.fuelLitres, 2)}</p></div>
                      <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">Cost</p><p className="font-bold text-slate-950">{formatCurrency(selectedFormMetrics?.fuelCost)}</p></div>
                      <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">KM/L</p><p className="font-bold text-slate-950">{formatNumber(selectedFormMetrics?.kmPerLitre, 2)}</p></div>
                      <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">Cost/KM</p><p className="font-bold text-slate-950">{formatCurrency(selectedFormMetrics?.costPerKm)}</p></div>
                    </div>
                    <button type="button" onClick={() => void handleSaveTrip()} disabled={saving} className="btn-primary w-full gap-2"><Save className="h-4 w-4" />{saving ? "Saving..." : "Save trip"}</button>
                  </div>
                </div>
                <div className="space-y-4">
                  <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <h4 className="font-bold text-slate-950">Linked Fuel Logs</h4>
                    <div className="mt-3 space-y-2">
                      {selectedTrip.linkedFuelLogs.length === 0 ? <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-500">No fuel logs linked yet.</p> : null}
                      {selectedTrip.linkedFuelLogs.map((log) => <div key={log.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3"><div className="min-w-0"><p className="truncate text-sm font-bold text-slate-900">{formatDate(log.date)} | {log.vehicle_reg} | {log.driver}</p><p className="text-xs text-slate-500">{formatNumber(Number(log.litres || 0), 2)} L | {formatCurrency(Number(log.total_cost || 0))} | {log.station || log.location}</p></div><button type="button" onClick={() => void handleUnlinkFuelLog(String(log.id))} className="btn-secondary min-h-8 gap-2 px-3 py-1 text-xs"><Unlink className="h-3.5 w-3.5" /> Unlink</button></div>)}
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <div className="flex items-center justify-between gap-3"><h4 className="font-bold text-slate-950">Add / Search Fuel Logs</h4><button type="button" onClick={() => setManualFuelExpanded((current) => !current)} className="btn-secondary min-h-9 px-3 py-1.5 text-xs">{manualFuelExpanded ? "Hide" : "Add fuel log"}</button></div>
                    {manualFuelExpanded ? <div className="mt-4 space-y-4"><div><p className="text-sm font-semibold text-slate-800">Suggested logs</p><div className="mt-2 space-y-2">{suggestedFuelLogs.length === 0 ? <p className="text-sm text-slate-500">No suggested fuel logs found.</p> : null}{suggestedFuelLogs.slice(0, 5).map((log) => <div key={log.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3"><div className="min-w-0"><p className="truncate text-sm font-bold text-slate-900">{formatDate(log.date)} | {log.vehicle_reg} | {log.driver}</p><p className="text-xs text-slate-500">{formatNumber(Number(log.litres || 0), 2)} L | {formatCurrency(Number(log.total_cost || 0))}</p></div><button type="button" onClick={() => void handleLinkFuelLog(String(log.id))} className="btn-primary min-h-8 gap-2 px-3 py-1 text-xs"><Link2 className="h-3.5 w-3.5" /> Link</button></div>)}</div></div><div className="grid gap-2 sm:grid-cols-2"><input value={manualFuelSearch} onChange={(event) => setManualFuelSearch(event.target.value)} placeholder="Search vehicle, driver, station, date" className="form-input bg-white" /><input type="date" value={manualFuelDate} onChange={(event) => setManualFuelDate(event.target.value)} className="form-input bg-white" /></div><div className="max-h-[320px] space-y-2 overflow-y-auto pr-1">{manualFuelLogOptions.length === 0 ? <p className="text-sm text-slate-500">No other unlinked fuel logs match.</p> : null}{manualFuelLogOptions.map((log) => <div key={log.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3"><div className="min-w-0"><p className="truncate text-sm font-bold text-slate-900">{formatDate(log.date)} | {log.vehicle_reg} | {log.driver}</p><p className="text-xs text-slate-500">{formatNumber(Number(log.litres || 0), 2)} L | {formatCurrency(Number(log.total_cost || 0))} | {log.station || log.location}</p></div><button type="button" onClick={() => void handleLinkFuelLog(String(log.id))} className="btn-secondary min-h-8 gap-2 px-3 py-1 text-xs"><Link2 className="h-3.5 w-3.5" /> Link</button></div>)}</div>{manualFuelLogOptions.length < manualFuelLogMatches.length ? <button type="button" onClick={() => setVisibleManualFuelLogCount((count) => count + 10)} className="btn-secondary w-full min-h-9 px-3 py-1.5 text-xs">Load more</button> : null}</div> : null}
                  </div>
                </div>
              </div>
            ) : null}

            {selectedTripTab === "notes" ? (
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="form-field"><label className="form-label">Waiting / idle notes</label><textarea rows={5} value={form.waiting_idle_notes} onChange={(event) => updateForm("waiting_idle_notes", event.target.value)} className="form-textarea bg-white" /></div>
                <div className="form-field"><label className="form-label">Extra route notes</label><textarea rows={5} value={form.extra_route_notes} onChange={(event) => updateForm("extra_route_notes", event.target.value)} className="form-textarea bg-white" /></div>
                <button type="button" onClick={() => void handleSaveTrip()} disabled={saving} className="btn-primary gap-2 lg:col-span-2"><Save className="h-4 w-4" />{saving ? "Saving..." : "Save trip"}</button>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 className="section-title">Performance Comparison</h3>
            <p className="section-subtitle">Completed trips only are used for efficiency averages. Completed = actual km, estimated km, fuel litres and fuel cost are all present.</p>
          </div>
          <select value={comparisonSort} onChange={(event) => setComparisonSort(event.target.value as ComparisonSort)} className="form-input w-full bg-white sm:w-56">
            <option value="best_kml">Sort: Best KM/L</option>
            <option value="lowest_cost_per_km">Sort: Lowest cost/km</option>
            <option value="highest_fuel_cost">Sort: Highest fuel cost</option>
            <option value="most_actual_km">Sort: Most actual km</option>
            <option value="most_completed_trips">Sort: Most completed trips</option>
          </select>
        </div>

        {summary.completedTrips < 2 ? <p className="mt-4 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-600">More completed trips are needed for reliable comparison.</p> : null}

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><p className="text-xs font-semibold text-slate-500">Best KM/L driver</p><p className="mt-1 truncate font-bold text-slate-950">{summary.bestDriverByKmPerLitre?.name ?? "-"}</p><p className="text-xs text-slate-500">{formatNumber(summary.bestDriverByKmPerLitre?.kmPerLitre, 2)} KM/L</p></div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><p className="text-xs font-semibold text-slate-500">Lowest cost/km driver</p><p className="mt-1 truncate font-bold text-slate-950">{summary.lowestCostDriver?.name ?? "-"}</p><p className="text-xs text-slate-500">{formatCurrency(summary.lowestCostDriver?.costPerKm)}</p></div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><p className="text-xs font-semibold text-slate-500">Best vehicle</p><p className="mt-1 truncate font-bold text-slate-950">{summary.bestVehicleByKmPerLitre?.name ?? "-"}</p><p className="text-xs text-slate-500">{formatNumber(summary.bestVehicleByKmPerLitre?.kmPerLitre, 2)} KM/L</p></div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><p className="text-xs font-semibold text-slate-500">Lowest vehicle cost/km</p><p className="mt-1 truncate font-bold text-slate-950">{summary.lowestCostVehicle?.name ?? "-"}</p><p className="text-xs text-slate-500">{formatCurrency(summary.lowestCostVehicle?.costPerKm)}</p></div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><p className="text-xs font-semibold text-slate-500">Most expensive trip</p><p className="mt-1 truncate font-bold text-slate-950">{summary.mostExpensiveTrip ? getShortRoutePreview(summary.mostExpensiveTrip.trip) : "-"}</p><p className="text-xs text-slate-500">{formatCurrency(summary.mostExpensiveTrip?.metrics.costPerKm)}</p></div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><p className="text-xs font-semibold text-slate-500">Biggest distance difference</p><p className="mt-1 truncate font-bold text-slate-950">{summary.biggestDistanceDifference ? getShortRoutePreview(summary.biggestDistanceDifference.trip) : "-"}</p><p className="text-xs text-slate-500">{formatNumber(summary.biggestDistanceDifference?.metrics.differenceKm)} km</p></div>
        </div>

        {summary.dataQualityNotes.length > 0 ? (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-sm font-bold text-amber-900">Data Quality</p>
            <div className="mt-2 flex flex-wrap gap-2">{summary.dataQualityNotes.map((note) => <span key={note} className="rounded-full bg-white/70 px-2.5 py-1 text-xs font-semibold text-amber-800">{note}</span>)}</div>
          </div>
        ) : null}

        <div className="mt-5 flex flex-wrap gap-2">
          {[
            ["drivers", "Drivers"],
            ["vehicles", "Vehicles"],
            ["routes", "Routes"],
            ["trips", "Trips"]
          ].map(([key, label]) => (
            <button key={key} type="button" onClick={() => setComparisonTab(key as ComparisonTab)} className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${comparisonTab === key ? "bg-brand-50 text-brand-700 ring-1 ring-brand-100" : "bg-slate-50 text-slate-600 hover:bg-slate-100"}`}>{label}</button>
          ))}
        </div>

        {(comparisonTab === "drivers" || comparisonTab === "vehicles") ? (
          <div className="mt-4">
            <div className="hidden overflow-x-auto lg:block">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-3 py-3 text-left">Rank</th><th className="px-3 py-3 text-left">{comparisonTab === "drivers" ? "Driver" : "Vehicle"}</th><th className="px-3 py-3 text-right">Completed</th><th className="px-3 py-3 text-right">Actual KM</th><th className="px-3 py-3 text-right">Litres</th><th className="px-3 py-3 text-right">Fuel Cost</th><th className="px-3 py-3 text-right">Avg KM/L</th><th className="px-3 py-3 text-right">Avg Cost/KM</th><th className="px-3 py-3 text-left">Label</th></tr></thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {(comparisonTab === "drivers" ? sortedDriverRows : sortedVehicleRows).map((row, index) => <tr key={row.name}><td className="px-3 py-3 font-bold text-slate-950">#{index + 1}</td><td className="px-3 py-3 font-bold text-slate-950">{row.name}</td><td className="px-3 py-3 text-right font-semibold">{row.completedTrips}</td><td className="px-3 py-3 text-right">{formatNumber(row.actualKm)}</td><td className="px-3 py-3 text-right">{formatNumber(row.litres, 2)}</td><td className="px-3 py-3 text-right">{formatCurrency(row.cost)}</td><td className="px-3 py-3 text-right font-semibold">{formatNumber(row.kmPerLitre, 2)}</td><td className="px-3 py-3 text-right font-semibold">{formatCurrency(row.costPerKm)}</td><td className="px-3 py-3"><span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${getHealthBadgeClass(row.performanceLabel)}`}>{row.performanceLabel}</span></td></tr>)}
                </tbody>
              </table>
            </div>
            <div className="grid gap-3 lg:hidden">
              {(comparisonTab === "drivers" ? sortedDriverRows : sortedVehicleRows).map((row, index) => <article key={row.name} className="rounded-lg border border-slate-200 bg-slate-50 p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold text-slate-500">#{index + 1}</p><h4 className="mt-1 font-bold text-slate-950">{row.name}</h4></div><span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${getHealthBadgeClass(row.performanceLabel)}`}>{row.performanceLabel}</span></div><div className="mt-3 grid grid-cols-2 gap-3 text-sm"><div><p className="text-xs text-slate-500">Completed</p><p className="font-bold">{row.completedTrips}</p></div><div><p className="text-xs text-slate-500">Actual KM</p><p className="font-bold">{formatNumber(row.actualKm)}</p></div><div><p className="text-xs text-slate-500">Litres</p><p className="font-bold">{formatNumber(row.litres, 2)}</p></div><div><p className="text-xs text-slate-500">Fuel Cost</p><p className="font-bold">{formatCurrency(row.cost)}</p></div><div><p className="text-xs text-slate-500">Avg KM/L</p><p className="font-bold">{formatNumber(row.kmPerLitre, 2)}</p></div><div><p className="text-xs text-slate-500">Avg Cost/KM</p><p className="font-bold">{formatCurrency(row.costPerKm)}</p></div></div></article>)}
            </div>
          </div>
        ) : null}

        {comparisonTab === "routes" ? (
          <div className="mt-4 overflow-x-auto"><table className="min-w-full divide-y divide-slate-200 text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-3 py-3 text-left">Route</th><th className="px-3 py-3 text-right">Trips</th><th className="px-3 py-3 text-right">Avg est. km</th><th className="px-3 py-3 text-right">Avg actual km</th><th className="px-3 py-3 text-right">Avg difference</th><th className="px-3 py-3 text-right">Avg fuel cost</th><th className="px-3 py-3 text-right">Avg cost/km</th><th className="px-3 py-3 text-right">Avg KM/L</th><th className="px-3 py-3 text-left">Label</th></tr></thead><tbody className="divide-y divide-slate-100 bg-white">{sortedRouteRows.map((row) => <tr key={row.route}><td className="max-w-[280px] px-3 py-3 font-bold text-slate-950"><span className="line-clamp-2">{row.route}</span></td><td className="px-3 py-3 text-right">{row.completedTrips}</td><td className="px-3 py-3 text-right">{formatNumber(row.averageEstimatedKm)}</td><td className="px-3 py-3 text-right">{formatNumber(row.averageActualKm)}</td><td className="px-3 py-3 text-right">{formatNumber(row.averageDifferenceKm)}</td><td className="px-3 py-3 text-right">{formatCurrency(row.averageFuelCost)}</td><td className="px-3 py-3 text-right">{formatCurrency(row.costPerKm)}</td><td className="px-3 py-3 text-right">{formatNumber(row.kmPerLitre, 2)}</td><td className="px-3 py-3"><span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${getHealthBadgeClass(row.performanceLabel)}`}>{row.performanceLabel}</span></td></tr>)}</tbody></table></div>
        ) : null}

        {comparisonTab === "trips" ? (
          <div className="mt-4 overflow-x-auto"><table className="min-w-full divide-y divide-slate-200 text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-3 py-3 text-left">Date</th><th className="px-3 py-3 text-left">Route</th><th className="px-3 py-3 text-left">Driver</th><th className="px-3 py-3 text-left">Vehicle</th><th className="px-3 py-3 text-right">Actual KM</th><th className="px-3 py-3 text-right">Estimated KM</th><th className="px-3 py-3 text-right">Difference</th><th className="px-3 py-3 text-right">Litres</th><th className="px-3 py-3 text-right">Fuel Cost</th><th className="px-3 py-3 text-right">KM/L</th><th className="px-3 py-3 text-right">Cost/KM</th><th className="px-3 py-3 text-left">Label</th></tr></thead><tbody className="divide-y divide-slate-100 bg-white">{sortedTripRows.map((row) => <tr key={row.trip.id}><td className="px-3 py-3">{formatDate(row.trip.trip_date)}</td><td className="max-w-[260px] px-3 py-3 font-bold text-slate-950"><span className="line-clamp-2">{getShortRoutePreview(row.trip)}</span></td><td className="px-3 py-3">{row.trip.driver || "-"}</td><td className="px-3 py-3">{row.trip.vehicle_reg || row.trip.vehicle_type || "-"}</td><td className="px-3 py-3 text-right">{formatNumber(row.metrics.actualDistance)}</td><td className="px-3 py-3 text-right">{formatNumber(row.metrics.estimatedDistance)}</td><td className="px-3 py-3 text-right">{formatNumber(row.metrics.differenceKm)}</td><td className="px-3 py-3 text-right">{formatNumber(row.metrics.fuel.litres, 2)}</td><td className="px-3 py-3 text-right">{formatCurrency(row.metrics.fuel.cost)}</td><td className="px-3 py-3 text-right">{formatNumber(row.metrics.kmPerLitre, 2)}</td><td className="px-3 py-3 text-right">{formatCurrency(row.metrics.costPerKm)}</td><td className="px-3 py-3"><span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${getHealthBadgeClass(row.label)}`}>{row.label}</span></td></tr>)}</tbody></table></div>
        ) : null}
      </section>

      {deleteTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4">
          <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-rose-50 p-2 text-rose-700">
                <Trash2 className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-950">Delete trip?</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  This will delete the trip journey record only. It will not delete the original Booking Diary entry or any Fuel Logs.
                </p>
                <p className="mt-2 text-xs font-semibold text-slate-500">{deleteTarget.label}</p>
              </div>
            </div>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setDeleteTarget(null)} disabled={deleting} className="btn-secondary justify-center">
                Cancel
              </button>
              <button type="button" onClick={() => void handleConfirmDeleteTrip()} disabled={deleting} className="min-h-10 rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60">
                {deleting ? "Deleting..." : "Delete trip"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
