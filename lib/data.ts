"use client";

import { supabase } from "@/lib/supabase";
import {
  normalizeComparableText,
  normalizeDisplayName,
  normalizeVehicleRegistration
} from "@/lib/utils";
import {
  normalizeFuelTypeKey,
  normalizePaymentMethodKey,
  normalizeTransferTypeKey
} from "@/lib/localized-values";
import { normalizeFuelLogLocation } from "@/lib/fuel-log-location";
import { getEffectiveOilChangeIntervalForVehicleType, getOilChangeIntervalForVehicleType } from "@/lib/oil-change-service";
import type {
  BankTransfer,
  BankTransferWithDriver,
  BookingDiaryEntry,
  Client,
  Driver,
  FuelLogDaySummary,
  FuelLogFilters,
  FuelLogEntrySource,
  FuelLog,
  FuelLogReceiptSummary,
  FuelLogSortDirection,
  FuelLogSortKey,
  FuelLogWithDriver,
  OilChangeBaseline,
  OilChangeHistory,
  PaginatedFuelLogsResult,
  RouteDistanceEstimate,
  Shipment,
  ShipmentWithDriver,
  SupportTicket,
  SupportTicketPriority,
  SupportTicketStatus,
  TripFuelLogLink,
  TripFuelSource,
  TripJourney,
  TripJourneyStatus,
  TripJourneyWithFuel,
  Vehicle,
  VehicleServiceLog,
  WeeklyMileageEntry
} from "@/types/database";
import { normalizeClientName, normalizedClientKey } from "@/lib/clients";

function stripUndefined<T extends Record<string, unknown>>(payload: T) {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined)
  ) as T;
}

function omitKey<T extends Record<string, unknown>, K extends keyof T>(payload: T, key: K) {
  return Object.fromEntries(
    Object.entries(payload).filter(([entryKey]) => entryKey !== key)
  ) as Omit<T, K>;
}

const isUuid = (value: unknown) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const isMissingBookingReferenceColumnError = (error: { code?: string; message?: string } | null | undefined) =>
  Boolean(
    error &&
      (error.code === "42703" || error.code === "PGRST204") &&
      error.message?.includes("booking_reference")
  );

const isMissingTripOptionalColumnError = (error: { code?: string; message?: string } | null | undefined) =>
  Boolean(
    error &&
      (error.code === "42703" || error.code === "PGRST204") &&
      [
        "booking_reference",
        "start_location_type",
        "start_location",
        "depot_address",
        "manual_actual_km",
        "manual_estimated_distance_km",
        "estimated_distance_source",
        "estimated_duration_minutes",
        "google_maps_route_url",
        "google_estimated_km",
        "google_estimated_minutes",
        "route_source",
        "route_start_type",
        "depot_address_used",
        "custom_start_address",
        "pickup_address",
        "dropoff_address",
        "booking_estimated_km",
        "booking_estimated_minutes",
        "booking_google_maps_route_url"
      ].some((column) => error.message?.includes(column))
  );

function omitTripOptionalColumns<T extends Record<string, unknown>>(payload: T) {
  return Object.fromEntries(
    Object.entries(payload).filter(
      ([key]) =>
        ![
          "booking_reference",
          "start_location_type",
          "start_location",
          "depot_address",
          "manual_actual_km",
          "manual_estimated_distance_km",
          "estimated_distance_source",
          "estimated_duration_minutes",
          "google_maps_route_url",
          "google_estimated_km",
          "google_estimated_minutes",
          "route_source",
          "route_start_type",
          "depot_address_used",
          "custom_start_address",
          "pickup_address",
          "dropoff_address",
          "booking_estimated_km",
          "booking_estimated_minutes",
          "booking_google_maps_route_url"
        ].includes(key)
    )
  ) as Partial<T>;
}

const BOOKING_DIARY_ROUTE_COLUMNS = new Set([
  "job_order_number",
  "created_by_user_id",
  "pickup_place_id",
  "dropoff_place_id",
  "pickup_address",
  "dropoff_address",
  "pickup_lat",
  "pickup_lng",
  "dropoff_lat",
  "dropoff_lng",
  "estimated_distance_km",
  "estimated_duration_minutes",
  "google_maps_route_url",
  "distance_source",
  "route_calculated_at"
]);

async function writeBookingDiaryWithSchemaFallback({
  id,
  payload
}: {
  id?: string;
  payload: Record<string, unknown>;
}) {
  let activePayload = { ...payload };

  for (let attempt = 0; attempt < BOOKING_DIARY_ROUTE_COLUMNS.size + 2; attempt += 1) {
    const result = id
      ? await supabase.from("booking_diary").update(activePayload).eq("id", id).select().single()
      : await supabase.from("booking_diary").insert(activePayload).select().single();

    if (!result.error) {
      return result;
    }

    const missingColumn = getMissingColumnName(result.error);
    if (missingColumn && BOOKING_DIARY_ROUTE_COLUMNS.has(missingColumn) && missingColumn in activePayload) {
      logDataError("saveBookingDiaryEntry optional route column missing; retrying without it:", result.error, {
        missingColumn
      });
      const { [missingColumn]: _removed, ...nextPayload } = activePayload;
      activePayload = nextPayload;
      continue;
    }

    return result;
  }

  return id
    ? await supabase.from("booking_diary").update(activePayload).eq("id", id).select().single()
    : await supabase.from("booking_diary").insert(activePayload).select().single();
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack
    };
  }

  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    return {
      code: record.code,
      message: record.message,
      details: record.details,
      hint: record.hint,
      status: record.status,
      statusCode: record.statusCode,
      name: record.name
    };
  }

  return { message: String(error) };
}

function logDataError(scope: string, error: unknown, meta?: unknown) {
  if (meta !== undefined) {
    console.error(scope, serializeError(error), meta);
    return;
  }

  console.error(scope, serializeError(error));
}

function getMissingColumnName(error: unknown) {
  if (!error || typeof error !== "object") {
    return null;
  }

  const record = error as Record<string, unknown>;
  const message = String(record.message ?? record.details ?? record.hint ?? "");
  const match =
    message.match(/column "([^"]+)"/i) ||
    message.match(/'([^']+)' column/i) ||
    message.match(/Could not find the '([^']+)' column/i) ||
    message.match(/Could not find the "([^"]+)" column/i);

  return match?.[1] ?? null;
}

async function writeShipmentWithSchemaFallback({
  id,
  payload
}: {
  id?: string;
  payload: Record<string, unknown>;
}) {
  const optionalColumns = new Set([
    "customer_name",
    "goods_description",
    "pickup_location",
    "dropoff_location",
    "start_location_data",
    "pickup_location_data",
    "dropoff_location_data",
    "additional_dropoffs_data",
    "vehicle_type",
    "standard_km_per_litre",
    "estimated_fuel_litres",
    "fuel_price_per_litre",
    "diesel_price",
    "estimated_fuel_cost",
    "fuel_cost",
    "toll_estimate",
    "toll_cost",
    "driver_cost",
    "subtotal_cost",
    "margin_percent",
    "final_price",
    "quoted_price",
    "total_distance_km",
    "total_operational_distance_km",
    "quoted_distance_km",
    "estimated_fuel_cost_thb",
    "cost_per_km_snapshot_thb",
    "company_id",
    "vehicle_id"
  ]);

  let activePayload = { ...payload };
  const removedColumns: string[] = [];

  for (let attempt = 0; attempt < 12; attempt += 1) {
    console.log("Shipment save payload attempt:", {
      attempt: attempt + 1,
      removedColumns,
      payload: activePayload
    });

    const result = id
      ? await supabase.from("shipments").update(activePayload).eq("id", id).select().single()
      : await supabase.from("shipments").insert(activePayload).select().single();

    if (!result.error) {
      return result;
    }

    const missingColumn = getMissingColumnName(result.error);
    if (missingColumn && optionalColumns.has(missingColumn) && missingColumn in activePayload) {
      logDataError("saveShipment optional column missing; retrying without it:", result.error, {
        missingColumn
      });
      const { [missingColumn]: _removed, ...nextPayload } = activePayload;
      activePayload = nextPayload;
      removedColumns.push(missingColumn);
      continue;
    }

    const errorText = `${String(result.error.message ?? "")} ${String(
      result.error.details ?? ""
    )} ${String(result.error.hint ?? "")}`.toLowerCase();

    if (activePayload.status && errorText.includes("shipments_status_check")) {
      const legacyStatus =
        activePayload.status === "Approved"
          ? "Accepted"
          : activePayload.status === "In Progress"
            ? "Assigned"
            : activePayload.status === "Cancelled"
              ? "Draft"
              : ["Draft", "Quoted", "Accepted", "Assigned"].includes(String(activePayload.status))
                ? activePayload.status
                : "Quoted";
      logDataError("saveShipment status unsupported by DB constraint; retrying with Quoted:", result.error, {
        status: activePayload.status
      });
      activePayload = {
        ...activePayload,
        status: legacyStatus
      };
      removedColumns.push("status:new_lifecycle_value");
      continue;
    }

    return result;
  }

  return id
    ? await supabase.from("shipments").update(activePayload).eq("id", id).select().single()
    : await supabase.from("shipments").insert(activePayload).select().single();
}

const LIVE_SHIPMENT_WRITE_COLUMNS = new Set([
  "job_reference",
  "shipment_date",
  "driver_id",
  "driver",
  "vehicle_reg",
  "start_location",
  "end_location",
  "start_location_data",
  "pickup_location_data",
  "dropoff_location_data",
  "additional_dropoffs_data",
  "estimated_distance_km",
  "estimated_fuel_cost_thb",
  "estimated_fuel_cost",
  "cost_per_km_snapshot_thb",
  "cost_estimation_status",
  "cost_estimation_note",
  "notes",
  "vehicle_id"
]);

function pickLiveShipmentPayload(payload: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(payload).filter(([key]) => LIVE_SHIPMENT_WRITE_COLUMNS.has(key))
  );
}

function isMissingColumnError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const record = error as Record<string, unknown>;
  const message = String(record.message ?? record.details ?? record.hint ?? "").toLowerCase();
  return (
    record.code === "42703" ||
    record.code === "PGRST204" ||
    message.includes("does not exist") ||
    (message.includes("could not find the") && message.includes("column"))
  );
}

function isMissingTableError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const record = error as Record<string, unknown>;
  const message = String(record.message ?? record.details ?? record.hint ?? "").toLowerCase();

  return (
    record.code === "PGRST205" ||
    record.code === "42P01" ||
    message.includes("could not find the table") ||
    message.includes("relation") && message.includes("does not exist")
  );
}

async function insertVehicleServiceLogWithSchemaFallback(payload: Record<string, unknown>) {
  let activePayload = { ...payload };
  const removedColumns: string[] = [];

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const result = await supabase
      .from("vehicle_service_logs")
      .insert(activePayload)
      .select()
      .single();

    if (!result.error) {
      return result;
    }

    const missingColumn = getMissingColumnName(result.error);
    if (missingColumn && missingColumn in activePayload && isMissingColumnError(result.error)) {
      logDataError("vehicle_service_logs column missing; retrying without it:", result.error, {
        missingColumn
      });
      const { [missingColumn]: _removed, ...nextPayload } = activePayload;
      activePayload = nextPayload;
      removedColumns.push(missingColumn);
      continue;
    }

    return result;
  }

  return supabase
    .from("vehicle_service_logs")
    .insert(activePayload)
    .select()
    .single();
}

async function updateVehicleServiceLogWithSchemaFallback(id: string, payload: Record<string, unknown>) {
  let activePayload = { ...payload };

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const result = await supabase
      .from("vehicle_service_logs")
      .update(activePayload)
      .eq("id", id)
      .select()
      .single();

    if (!result.error) {
      return result;
    }

    const missingColumn = getMissingColumnName(result.error);
    if (missingColumn && missingColumn in activePayload && isMissingColumnError(result.error)) {
      logDataError("vehicle_service_logs column missing; retrying update without it:", result.error, {
        missingColumn
      });
      const { [missingColumn]: _removed, ...nextPayload } = activePayload;
      activePayload = nextPayload;
      continue;
    }

    return result;
  }

  return supabase
    .from("vehicle_service_logs")
    .update(activePayload)
    .eq("id", id)
    .select()
    .single();
}

async function updateOilChangeHistoryWithSchemaFallback(id: string, payload: Record<string, unknown>) {
  let activePayload = { ...payload };

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const result = await supabase
      .from("oil_change_history")
      .update(activePayload)
      .eq("id", id)
      .select()
      .single();

    if (!result.error) {
      return result;
    }

    const missingColumn = getMissingColumnName(result.error);
    if (missingColumn && missingColumn in activePayload && isMissingColumnError(result.error)) {
      logDataError("oil_change_history column missing; retrying update without it:", result.error, {
        missingColumn
      });
      const { [missingColumn]: _removed, ...nextPayload } = activePayload;
      activePayload = nextPayload;
      continue;
    }

    return result;
  }

  return supabase
    .from("oil_change_history")
    .update(activePayload)
    .eq("id", id)
    .select()
    .single();
}

function normalizeTransferReceiptStatus(value: unknown) {
  if (value === "pending" || value === "submitted" || value === "approved") {
    return value;
  }

  if (value === "pending_receipt") {
    return "pending" as const;
  }

  if (value === "matched_to_fuel_log") {
    return "submitted" as const;
  }

  if (value === "overpaid") {
    return "approved" as const;
  }

  return "pending" as const;
}

function findTransferFuelLogMatch(
  fuelLogs: FuelLogWithDriver[],
  payload: { id?: string; date?: string; vehicle_reg?: string; amount?: number }
) {
  const vehicleKey = normalizeComparableText(payload.vehicle_reg);
  const transferDate = payload.date ? new Date(payload.date) : null;

  if (!vehicleKey || !transferDate || !Number.isFinite(Number(payload.amount))) {
    return null;
  }

  const amount = Number(payload.amount || 0);
  const candidates = fuelLogs
    .filter((log) => normalizeComparableText(log.vehicle_reg) === vehicleKey)
    .map((log) => {
      const logDate = new Date(log.date);
      const diffDays = Math.abs(logDate.getTime() - transferDate.getTime()) / (1000 * 60 * 60 * 24);
      const amountDiff = Math.abs(Number(log.total_cost || 0) - amount);

      return { log, diffDays, amountDiff };
    })
    .filter(({ diffDays }) => diffDays <= 1)
    .sort((left, right) => {
      if (left.amountDiff !== right.amountDiff) {
        return left.amountDiff - right.amountDiff;
      }

      return left.diffDays - right.diffDays;
    });

  return candidates[0]?.log ?? null;
}

const READ_CACHE_TTL_MS = 30_000;

type CacheEntry<T> = {
  expiresAt: number;
  promise?: Promise<T>;
  value?: T;
};

const readCache = new Map<string, CacheEntry<unknown>>();

function clearReadCache() {
  readCache.clear();
}

export function clearDataReadCache() {
  clearReadCache();
}

async function readThroughCache<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs = READ_CACHE_TTL_MS
) {
  const now = Date.now();
  const cached = readCache.get(key) as CacheEntry<T> | undefined;

  if (cached?.value !== undefined && cached.expiresAt > now) {
    return cached.value;
  }

  if (cached?.promise) {
    return cached.promise;
  }

  const promise = fetcher()
    .then((value) => {
      readCache.set(key, {
        value,
        expiresAt: Date.now() + ttlMs
      });
      return value;
    })
    .catch((error) => {
      readCache.delete(key);
      throw error;
    });

  readCache.set(key, {
    expiresAt: now + ttlMs,
    promise
  });

  return promise;
}

function dispatchDataChange(resource: string) {
  clearReadCache();
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent("fuel-bank:data-changed", { detail: { resource } }));
}

function buildDriverLookup(rows: Array<{ id: string; name: string | null }>) {
  return new Map(
    rows.map((driver) => [String(driver.id), normalizeDisplayName(driver.name)])
  );
}

function normalizeDriverRow(driver: Driver) {
  return {
    ...driver,
    name: normalizeDisplayName(driver.name),
    vehicle_reg: normalizeVehicleRegistration(driver.vehicle_reg)
  };
}

function normalizeAuditName(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getAccountNameFromEmail(value: string | null) {
  if (!value) return null;
  const [localPart] = value.split("@");
  return normalizeAuditName(localPart?.replace(/[._-]+/g, " "));
}

async function getCurrentUserAudit() {
  const { data, error } = await supabase.auth.getUser();
  if (error) {
    const message = String(error.message ?? "").toLowerCase();
    if (message.includes("auth session missing") || message.includes("missing")) {
      return { id: null, name: null };
    }

    logDataError("getCurrentUserAudit error:", error);
    throw error;
  }

  const user = data.user;
  const metadata = user?.user_metadata as Record<string, unknown> | undefined;
  const displayName =
    normalizeAuditName(metadata?.full_name) ||
    normalizeAuditName(metadata?.name) ||
    null;
  const email = normalizeAuditName(user?.email);
  const name = displayName || getAccountNameFromEmail(email);

  return {
    id: user?.id ?? null,
    name
  };
}

function parseOptionalNumeric(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const normalized = String(value).replace(/,/g, "").replace(/[^0-9.-]/g, "").trim();
  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
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

function generateBookingDiaryId(date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, "0");
  const datePart = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  const timePart = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `BK-${datePart}-${timePart}`;
}

function normalizeVehicleRow(vehicle: Vehicle) {
  const vehicleReg = normalizeVehicleRegistration(vehicle.vehicle_reg ?? vehicle.registration);
  return {
    ...vehicle,
    vehicle_reg: vehicleReg,
    registration: vehicleReg,
    last_oil_change_odometer:
      vehicle.last_oil_change_odometer != null ? Number(vehicle.last_oil_change_odometer) : null,
    oil_change_interval_km:
      vehicle.oil_change_interval_km != null && Number.isFinite(Number(vehicle.oil_change_interval_km))
        ? Number(vehicle.oil_change_interval_km)
        : null
  };
}

function hasOilChangeBaseline(vehicle: Vehicle) {
  return Boolean(vehicle.last_oil_change_date) || vehicle.last_oil_change_odometer != null;
}

function mergeVehicleRowsByRegistration(vehicles: Vehicle[]) {
  const merged = new Map<string, Vehicle>();

  for (const vehicle of vehicles.map(normalizeVehicleRow)) {
    const key = normalizeComparableText(vehicle.vehicle_reg ?? vehicle.registration);
    if (!key) {
      merged.set(String(vehicle.id), vehicle);
      continue;
    }

    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, vehicle);
      continue;
    }

    const existingHasBaseline = hasOilChangeBaseline(existing);
    const currentHasBaseline = hasOilChangeBaseline(vehicle);
    const base = currentHasBaseline && !existingHasBaseline ? vehicle : existing;
    const supplement = base === vehicle ? existing : vehicle;

    merged.set(key, {
      ...supplement,
      ...base,
      vehicle_reg: base.vehicle_reg || supplement.vehicle_reg,
      registration: base.registration || supplement.registration,
      vehicle_name: base.vehicle_name || supplement.vehicle_name,
      vehicle_type: base.vehicle_type || supplement.vehicle_type,
      last_oil_change_date: base.last_oil_change_date ?? supplement.last_oil_change_date ?? null,
      last_oil_change_odometer:
        base.last_oil_change_odometer ?? supplement.last_oil_change_odometer ?? null,
      oil_change_interval_km: base.oil_change_interval_km ?? supplement.oil_change_interval_km ?? null
    });
  }

  return Array.from(merged.values());
}

function normalizeServiceLogRow(log: VehicleServiceLog) {
  const odometer = Number(log.odometer ?? log.oil_change_odometer ?? log.service_odometer ?? 0);
  const intervalKm =
    log.interval_km != null && Number.isFinite(Number(log.interval_km))
      ? Number(log.interval_km)
      : null;
  return {
    ...log,
    vehicle_id: log.vehicle_id ?? null,
    vehicle_reg: normalizeVehicleRegistration(log.vehicle_reg),
    odometer,
    oil_change_odometer:
      log.oil_change_odometer != null && Number.isFinite(Number(log.oil_change_odometer))
        ? Number(log.oil_change_odometer)
        : odometer,
    service_odometer: odometer,
    interval_km: intervalKm,
    next_service_due_odometer:
      log.next_service_due_odometer != null && Number.isFinite(Number(log.next_service_due_odometer))
        ? Number(log.next_service_due_odometer)
        : intervalKm != null
          ? Math.trunc(odometer + intervalKm)
          : null,
    vehicle_type_snapshot: log.vehicle_type_snapshot ?? null,
    notes: log.notes ?? null
  };
}

function normalizeOilChangeBaselineRow(row: OilChangeBaseline) {
  return {
    ...row,
    vehicle_reg: normalizeVehicleRegistration(row.vehicle_reg),
    last_odometer: Number(row.last_odometer),
    interval_km: Number(row.interval_km)
  };
}

function normalizeOilChangeHistoryRow(row: OilChangeHistory): VehicleServiceLog {
  const odometer = Number(row.odometer ?? 0);
  return {
    id: `oil-change-history-${row.id}`,
    vehicle_id: null,
    vehicle_reg: normalizeVehicleRegistration(row.vehicle_reg),
    service_type: "oil_change",
    service_date: row.oil_change_date,
    odometer,
    service_odometer: odometer,
    interval_km: null,
    next_service_due_odometer: null,
    vehicle_type_snapshot: null,
    notes: null,
    created_at: row.created_at
  };
}

function getServiceLogSortTime(log: VehicleServiceLog) {
  const serviceDateTime = log.service_date ? new Date(log.service_date).getTime() : Number.NEGATIVE_INFINITY;
  const createdAtTime = log.created_at ? new Date(log.created_at).getTime() : Number.NEGATIVE_INFINITY;
  return {
    serviceDateTime: Number.isNaN(serviceDateTime) ? Number.NEGATIVE_INFINITY : serviceDateTime,
    createdAtTime: Number.isNaN(createdAtTime) ? Number.NEGATIVE_INFINITY : createdAtTime
  };
}

function sortServiceLogsByLatest(logs: VehicleServiceLog[]) {
  return [...logs].sort((left, right) => {
    const leftTime = getServiceLogSortTime(left);
    const rightTime = getServiceLogSortTime(right);
    const serviceDateDiff = rightTime.serviceDateTime - leftTime.serviceDateTime;
    if (serviceDateDiff !== 0) return serviceDateDiff;
    const createdAtDiff = rightTime.createdAtTime - leftTime.createdAtTime;
    if (createdAtDiff !== 0) return createdAtDiff;
    return String(right.id).localeCompare(String(left.id));
  });
}

function normalizeOilChangeVehicleRegKey(value: unknown) {
  return normalizeVehicleRegistration(String(value ?? ""))
    .replace(/\s+/g, "")
    .replace(/-/g, "")
    .toLowerCase();
}

async function syncOilChangeOdometerToWeeklyMileage({
  vehicleReg,
  serviceDate,
  serviceOdometer
}: {
  vehicleReg: string;
  serviceDate: string;
  serviceOdometer: number;
}) {
  const normalizedVehicleReg = normalizeVehicleRegistration(vehicleReg);
  const latestResult = await supabase
    .from("weekly_mileage")
    .select("id, week_ending, driver_id, vehicle_reg, odometer_reading, mileage, created_at")
    .ilike("vehicle_reg", normalizedVehicleReg)
    .order("week_ending", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestResult.error && !isMissingColumnError(latestResult.error)) {
    logDataError("syncOilChangeOdometerToWeeklyMileage latest lookup warning:", latestResult.error, {
      vehicleReg: normalizedVehicleReg
    });
    return;
  }

  const latestRow = latestResult.data as Partial<WeeklyMileageEntry> | null;
  const latestOdometer = parseOptionalNumeric(latestRow?.odometer_reading ?? latestRow?.mileage);
  const latestWeekEnding = latestRow?.week_ending ?? null;

  if (latestOdometer != null && latestOdometer >= serviceOdometer) {
    return;
  }

  const syncWeekEnding = latestWeekEnding && latestWeekEnding > serviceDate ? latestWeekEnding : serviceDate;

  const drivers = await fetchDrivers().catch((error) => {
    logDataError("syncOilChangeOdometerToWeeklyMileage driver lookup warning:", error, {
      vehicleReg: normalizedVehicleReg
    });
    return [] as Driver[];
  });
  const matchedDriver = drivers.find(
    (driver) => normalizeComparableText(driver.vehicle_reg) === normalizeComparableText(normalizedVehicleReg)
  );

  if (!matchedDriver) {
    logDataError("syncOilChangeOdometerToWeeklyMileage skipped: no driver matched vehicle registration.", null, {
      vehicleReg: normalizedVehicleReg
    });
    return;
  }

  await saveWeeklyMileage({
    week_ending: syncWeekEnding,
    driver_id: String(matchedDriver.id),
    driver: matchedDriver.name,
    vehicle_reg: normalizedVehicleReg,
    odometer_reading: serviceOdometer,
    mileage: serviceOdometer
  });
}

export function applyOilChangeBaselinesToVehicles(
  vehicles: Vehicle[],
  baselines: OilChangeBaseline[]
) {
  const vehicleMap = new Map<string, Vehicle>();
  const baselineMap = new Map<string, ReturnType<typeof normalizeOilChangeBaselineRow>>();

  for (const rawBaseline of baselines) {
    const baseline = normalizeOilChangeBaselineRow(rawBaseline);
    const key = normalizeOilChangeVehicleRegKey(baseline.vehicle_reg);
    if (key) {
      baselineMap.set(key, baseline);
    }
  }

  for (const vehicle of vehicles.map(normalizeVehicleRow)) {
    const vehicleReg = vehicle.vehicle_reg ?? vehicle.registration;
    const key = normalizeOilChangeVehicleRegKey(vehicleReg);
    if (!key) {
      vehicleMap.set(String(vehicle.id), vehicle);
      continue;
    }

    const baseline = baselineMap.get(key) ?? null;

    if (baseline) {
      vehicleMap.set(key, {
        ...vehicle,
        vehicle_reg: baseline.vehicle_reg,
        registration: baseline.vehicle_reg,
        last_oil_change_date: baseline.last_oil_change_date,
        last_oil_change_odometer: baseline.last_odometer,
        oil_change_interval_km: baseline.interval_km
      });
      continue;
    }

    vehicleMap.set(key, vehicle);
  }

  return Array.from(vehicleMap.values()).sort((a, b) =>
    (a.vehicle_reg ?? a.registration ?? "").localeCompare(b.vehicle_reg ?? b.registration ?? "")
  );
}

function getServiceSchemaSetupMessage(error: unknown) {
  if (isMissingTableError(error)) {
    return "Oil Change Service Management is not set up in Supabase yet. Apply the oil_change_baselines and oil_change_history migration, then refresh the page.";
  }

  if (isMissingColumnError(error)) {
    return "Oil Change Service Management database columns are out of date. Apply the latest Supabase migration, then refresh the page.";
  }

  if (error && typeof error === "object") {
    const record = error as unknown as Record<string, unknown>;
    const message = String(record.message ?? "").toLowerCase();
    if (record.code === "42501" || message.includes("row-level security") || message.includes("permission")) {
      return "Oil Change Service Management is blocked by Supabase permissions. Apply the latest RLS policy migration for oil_change_baselines and oil_change_history.";
    }
  }

  return null;
}

async function getCurrentUserId() {
  const { data, error } = await supabase.auth.getUser();
  if (error) {
    const message = String(error.message ?? "").toLowerCase();
    if (message.includes("auth session missing") || message.includes("missing")) {
      console.warn("getCurrentUserId warning: no active auth session; saving with nullable user_id for legacy schema support.");
      return null;
    }

    logDataError("getCurrentUserId error:", error);
    throw error;
  }

  return data.user?.id ?? null;
}

function resolveShipmentDriverName(
  shipment: Pick<Shipment, "driver_id" | "driver">,
  driverLookup: Map<string, string>
) {
  const linkedDriverName =
    shipment.driver_id != null && String(shipment.driver_id).trim()
      ? driverLookup.get(String(shipment.driver_id)) ?? ""
      : "";
  const storedDriverValue = normalizeDisplayName(shipment.driver);

  return linkedDriverName || storedDriverValue || "Unassigned";
}

const FUEL_LOG_BASE_SELECT_COLUMNS =
  "id, date, driver_id, driver, vehicle_reg, odometer, litres, total_cost, price_per_litre, mileage, location, fuel_type, payment_method, notes, created_at";
const FUEL_LOG_RECEIPT_SELECT_COLUMNS = `${FUEL_LOG_BASE_SELECT_COLUMNS}, receipt_checked, receipt_checked_at`;
const FUEL_LOG_ENTRY_SOURCE_SELECT_COLUMNS = `${FUEL_LOG_RECEIPT_SELECT_COLUMNS}, entry_source`;

function normalizeFuelLogEntrySource(value: unknown): FuelLogEntrySource {
  if (
    value === "direct_from_receipt" ||
    value === "statement_manual" ||
    value === "other" ||
    value === "line_message" ||
    value === "statement_import"
  ) {
    return value;
  }

  if (value === "direct_receipt") {
    return "direct_from_receipt";
  }

  return "line_message";
}

function mapFuelLogRows(
  rows: Array<{
    id: string;
    date: string;
    driver_id: string | number | null;
    driver: string | null;
    vehicle_reg: string;
    odometer: number | null;
    litres: number;
    total_cost: number;
    price_per_litre: number | null;
    mileage: number | null;
    location: string;
    fuel_type: string | null;
    payment_method: string | null;
    entry_source?: string | null;
    receipt_checked?: boolean | null;
    receipt_checked_at?: string | null;
    notes: string | null;
    created_at?: string;
  }>
) {
  return rows.map((log) => ({
    ...log,
    driver_id: log.driver_id != null ? String(log.driver_id) : "",
    driver: normalizeDisplayName(log.driver) || "Unknown driver",
    vehicle_reg: normalizeVehicleRegistration(log.vehicle_reg),
    mileage:
      log.mileage != null
        ? Number(log.mileage)
        : log.odometer != null
          ? Number(log.odometer)
          : null,
    station: normalizeFuelLogLocation(log.location),
    location: normalizeFuelLogLocation(log.location),
    price_per_litre:
      Number(log.litres || 0) > 0
        ? Number(log.total_cost || 0) / Number(log.litres || 0)
        : null,
    fuel_type: normalizeFuelTypeKey(log.fuel_type) ?? log.fuel_type,
    payment_method: normalizePaymentMethodKey(log.payment_method) ?? log.payment_method,
    entry_source: normalizeFuelLogEntrySource(log.entry_source),
    receipt_checked: Boolean(log.receipt_checked),
    receipt_checked_at: log.receipt_checked_at ?? null
  })) as FuelLogWithDriver[];
}

function getFuelLogPricePerLitre(row: Pick<FuelLogWithDriver, "litres" | "total_cost">) {
  const litres = Number(row.litres || 0);
  const totalCost = Number(row.total_cost || 0);
  return litres > 0 && Number.isFinite(totalCost) ? totalCost / litres : null;
}

async function runFuelLogQueryWithOptionalColumnFallback<T>(
  queryFactory: (columns: string) => PromiseLike<{ data: T | null; error: unknown; count?: number | null }>
) {
  const preferredResult = await queryFactory(FUEL_LOG_ENTRY_SOURCE_SELECT_COLUMNS);
  if (!preferredResult.error) {
    return preferredResult;
  }

  if (!isMissingColumnError(preferredResult.error)) {
    return preferredResult;
  }

  const receiptResult = await queryFactory(FUEL_LOG_RECEIPT_SELECT_COLUMNS);
  if (!receiptResult.error || !isMissingColumnError(receiptResult.error)) {
    return receiptResult;
  }

  return queryFactory(FUEL_LOG_BASE_SELECT_COLUMNS);
}

function applyFuelLogFilters<TQuery extends { gte: Function; lte: Function; eq: Function; ilike: Function; or: Function }>(
  query: TQuery,
  filters: FuelLogFilters = {}
) {
  let nextQuery = query;
  const fromDate = filters.fromDate?.trim();
  const toDate = filters.toDate?.trim();
  const driverId = filters.driverId?.trim();
  const vehicleReg = filters.vehicleReg?.trim();
  const location = normalizeFuelLogLocation(filters.location);
  const paymentMethod = filters.paymentMethod?.trim();
  const entrySource = filters.entrySource?.trim();
  const receiptCheckedStatus = filters.receiptCheckedStatus?.trim();
  const totalCostMin = filters.totalCostMin?.trim();
  const totalCostMax = filters.totalCostMax?.trim();

  if (fromDate) {
    nextQuery = nextQuery.gte("date", fromDate);
  }
  if (toDate) {
    nextQuery = nextQuery.lte("date", toDate);
  }
  if (driverId) {
    nextQuery = nextQuery.eq("driver_id", driverId);
  }
  if (vehicleReg) {
    nextQuery = nextQuery.eq("vehicle_reg", vehicleReg);
  }
  if (location) {
    nextQuery =
      location === "Bangchak" || location === "Shell"
        ? nextQuery.ilike("location", `${location}%`)
        : nextQuery.ilike("location", location);
  }
  if (paymentMethod) {
    nextQuery = nextQuery.eq("payment_method", paymentMethod);
  }
  if (entrySource) {
    nextQuery = nextQuery.eq("entry_source", entrySource);
  }
  if (receiptCheckedStatus === "checked") {
    nextQuery = nextQuery.eq("receipt_checked", true);
  }
  if (receiptCheckedStatus === "not_checked") {
    nextQuery = nextQuery.eq("receipt_checked", false);
  }
  if (totalCostMin) {
    nextQuery = nextQuery.gte("total_cost", Number(totalCostMin));
  }
  if (totalCostMax) {
    nextQuery = nextQuery.lte("total_cost", Number(totalCostMax));
  }

  return nextQuery;
}

function applyFuelLogOrdering<TQuery extends { order: Function }>(
  query: TQuery,
  sortKey: FuelLogSortKey,
  sortDirection: FuelLogSortDirection
) {
  const ascending = sortDirection === "asc";
  if (sortKey === "price_per_litre") {
    return query.order("date", { ascending: false }).order("id", { ascending: false });
  }

  let nextQuery = query.order(sortKey, { ascending });

  if (sortKey === "date") {
    nextQuery = nextQuery.order("id", { ascending });
    return nextQuery;
  }

  return nextQuery.order("date", { ascending: false }).order("id", { ascending: false });
}

function findDriverNameFallback(
  drivers: Driver[],
  driverId: string | number | null | undefined,
  storedDriverName?: string | null,
  vehicleReg?: string | null
) {
  const linkedDriver =
    driverId != null && String(driverId).trim()
      ? drivers.find((driver) => String(driver.id) === String(driverId))
      : undefined;

  if (linkedDriver?.name?.trim()) {
    return normalizeDisplayName(linkedDriver.name);
  }

  if (storedDriverName?.trim()) {
    return normalizeDisplayName(storedDriverName);
  }

  const vehicleMatch = vehicleReg
    ? drivers.find(
        (driver) =>
          normalizeComparableText(driver.vehicle_reg) === normalizeComparableText(vehicleReg)
      )
    : undefined;

  if (vehicleMatch?.name?.trim()) {
    return normalizeDisplayName(vehicleMatch.name);
  }

  return "Unknown driver";
}

async function fetchDriverLookup() {
  return readThroughCache("drivers:lookup", async () => {
    const { data, error } = await supabase.from("drivers").select("id, name");

    if (error) {
      logDataError("fetchDriverLookup error:", error);
      throw error;
    }

    return buildDriverLookup((data ?? []) as Array<{ id: string; name: string | null }>);
  });
}

export async function fetchDrivers() {
  return readThroughCache("drivers:all", async () => {
    const { data, error } = await supabase
      .from("drivers")
      .select("*")
      .order("name", { ascending: true });

    if (error) {
      logDataError("fetchDrivers error:", error);
      throw error;
    }

    console.log("fetchDrivers success", { rowCount: (data ?? []).length });

    return ((data ?? []) as Driver[])
      .filter((driver) => driver.active !== false)
      .map(normalizeDriverRow);
  });
}

export async function fetchVehicles() {
  return readThroughCache("vehicles:all", async () => {
    const { data, error } = await supabase
      .from("vehicles")
      .select("*")
      .order("vehicle_reg", { ascending: true });

    if (error) {
      if (isMissingTableError(error)) {
        const message = getServiceSchemaSetupMessage(error) ?? "Vehicles table is unavailable in Supabase.";
        logDataError("fetchVehicles setup error:", error);
        throw new Error(message);
      }

      logDataError("fetchVehicles error:", error);
      throw error;
    }

    const merged = mergeVehicleRowsByRegistration((data ?? []) as Vehicle[]);
    if (merged.length !== (data ?? []).length) {
      console.warn("fetchVehicles merged duplicate vehicle registrations for shared oil-change view:", {
        rawRowCount: (data ?? []).length,
        mergedRowCount: merged.length
      });
    }

    return merged;
  });
}

export async function fetchVehicleServiceLogs() {
  return readThroughCache("vehicle_service_logs:all", async () => {
    const { data, error } = await supabase
      .from("vehicle_service_logs")
      .select("*")
      .order("service_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) {
      if (isMissingTableError(error)) {
        const message = getServiceSchemaSetupMessage(error) ?? "Vehicle service logs table is unavailable in Supabase.";
        logDataError("fetchVehicleServiceLogs setup error:", error);
        throw new Error(message);
      }

      logDataError("fetchVehicleServiceLogs error:", error);
      throw error;
    }

    return ((data ?? []) as VehicleServiceLog[]).map(normalizeServiceLogRow);
  });
}

export async function fetchOilChangeBaselinesForVehicles(_vehicles: Vehicle[]) {
  const queryDescription = "from oil_change_baselines select *";
  const { data, error } = await supabase
    .from("oil_change_baselines")
    .select("*");

  if (error) {
    logDataError("fetchOilChangeBaselinesForVehicles error:", error, {
      query: queryDescription,
      table: "public.oil_change_baselines"
    });
    const message =
      getServiceSchemaSetupMessage(error) ??
        String(error.message ?? "Unable to load oil change baselines from Supabase.");
    const record = error as unknown as Record<string, unknown>;
    throw Object.assign(new Error(message), {
      code: record.code,
      details: record.details,
      hint: record.hint,
      query: queryDescription,
      supabaseError: serializeError(error)
    });
  }

  return ((data ?? []) as OilChangeBaseline[]).map(normalizeOilChangeBaselineRow);
}

export async function fetchOilChangeHistory() {
  const serviceLogResult = await supabase
    .from("vehicle_service_logs")
    .select("*")
    .order("service_date", { ascending: false })
    .order("created_at", { ascending: false });

  const serviceLogs: VehicleServiceLog[] = [];
  let canReadServiceLogs = false;

  if (!serviceLogResult.error) {
    canReadServiceLogs = true;
    serviceLogs.push(
      ...((serviceLogResult.data ?? []) as VehicleServiceLog[])
        .filter((log) => !log.service_type || log.service_type === "oil_change")
        .map(normalizeServiceLogRow)
    );
  } else if (!isMissingTableError(serviceLogResult.error) && !isMissingColumnError(serviceLogResult.error)) {
    logDataError("fetchOilChangeHistory vehicle_service_logs error:", serviceLogResult.error);
    throw new Error(
      getServiceSchemaSetupMessage(serviceLogResult.error) ??
        String(serviceLogResult.error.message ?? "Unable to load oil change service history from Supabase.")
    );
  }

  const legacyResult = await supabase
    .from("oil_change_history")
    .select("*")
    .order("oil_change_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (legacyResult.error) {
    if (!canReadServiceLogs && !isMissingTableError(legacyResult.error) && !isMissingColumnError(legacyResult.error)) {
      logDataError("fetchOilChangeHistory fallback error:", legacyResult.error);
      throw new Error(
        getServiceSchemaSetupMessage(legacyResult.error) ??
          String(legacyResult.error.message ?? "Unable to load oil change history from Supabase.")
      );
    }

    if (!isMissingTableError(legacyResult.error) && !isMissingColumnError(legacyResult.error)) {
      logDataError("fetchOilChangeHistory legacy warning:", legacyResult.error);
    }
  }

  const legacyLogs = legacyResult.error
    ? []
    : ((legacyResult.data ?? []) as OilChangeHistory[]).map(normalizeOilChangeHistoryRow);

  return sortServiceLogsByLatest([...serviceLogs, ...legacyLogs]);
}

async function ensureVehicleForService({
  vehicleId,
  registration,
  vehicleName,
  vehicleType
}: {
  vehicleId?: string | null;
  registration: string;
  vehicleName?: string | null;
  vehicleType?: string | null;
}) {
  const normalizedRegistration = normalizeVehicleRegistration(registration);

  if (!normalizedRegistration) {
    throw new Error("Vehicle registration is required.");
  }

  if (vehicleId) {
    const { data, error } = await supabase
      .from("vehicles")
      .select("*")
      .eq("id", vehicleId)
      .maybeSingle();

    if (error) {
      logDataError("ensureVehicleForService existing vehicle error:", error, { vehicleId });
      throw new Error(getServiceSchemaSetupMessage(error) ?? String(error.message ?? "Unable to load vehicle for service."));
    }

    if (data) {
      return normalizeVehicleRow(data as Vehicle);
    }
  }

  const existing = await supabase
    .from("vehicles")
    .select("*")
    .ilike("vehicle_reg", normalizedRegistration)
    .limit(1)
    .maybeSingle();

  if (existing.error) {
    logDataError("ensureVehicleForService lookup error:", existing.error, { registration: normalizedRegistration });
    throw new Error(getServiceSchemaSetupMessage(existing.error) ?? String(existing.error.message ?? "Unable to load vehicle for service."));
  }

  if (existing.data) {
    const existingVehicle = normalizeVehicleRow(existing.data as Vehicle);
    if (vehicleType && !existingVehicle.vehicle_type) {
      const updated = await supabase
        .from("vehicles")
        .update({ vehicle_type: vehicleType })
        .eq("id", existingVehicle.id)
        .select()
        .single();
      if (!updated.error && updated.data) {
        return normalizeVehicleRow(updated.data as Vehicle);
      }
    }
    return existingVehicle;
  }

  const userId = await getCurrentUserId();
  const created = await supabase
    .from("vehicles")
    .insert({
      user_id: userId,
      vehicle_reg: normalizedRegistration,
      vehicle_name: vehicleName?.trim() || normalizedRegistration,
      vehicle_category: "SMALL_VAN",
      vehicle_type: vehicleType || null,
      fuel_type: "DIESEL",
      oil_change_interval_km: vehicleType ? getOilChangeIntervalForVehicleType(vehicleType) : null,
      active: true
    })
    .select()
    .single();

  if (created.error) {
    logDataError("ensureVehicleForService create error:", created.error, { registration: normalizedRegistration });
    if ((created.error as { code?: string }).code === "23505") {
      const recovered = await supabase
        .from("vehicles")
        .select("*")
        .ilike("vehicle_reg", normalizedRegistration)
        .limit(1)
        .maybeSingle();

      if (!recovered.error && recovered.data) {
        return normalizeVehicleRow(recovered.data as Vehicle);
      }
    }
    throw new Error(getServiceSchemaSetupMessage(created.error) ?? String(created.error.message ?? "Unable to create vehicle for service."));
  }

  return normalizeVehicleRow(created.data as Vehicle);
}

async function ensureVehicleForWeeklyMileage({
  registration,
  driverId
}: {
  registration: string;
  driverId?: string | null;
}) {
  const normalizedRegistration = normalizeVehicleRegistration(registration);
  if (!normalizedRegistration) {
    return null;
  }

  const existing = await supabase
    .from("vehicles")
    .select("*");

  if (existing.error) {
    if (!isMissingTableError(existing.error)) {
      logDataError("ensureVehicleForWeeklyMileage lookup warning:", existing.error, {
        registration: normalizedRegistration
      });
    }
    return null;
  }

  const registrationKey = normalizeOilChangeVehicleRegKey(normalizedRegistration);
  const existingVehicle = ((existing.data ?? []) as Vehicle[]).find(
    (vehicle) => normalizeOilChangeVehicleRegKey(vehicle.vehicle_reg ?? vehicle.registration) === registrationKey
  );

  const drivers = await fetchDrivers().catch(() => [] as Driver[]);
  const matchedDriver =
    (driverId ? drivers.find((driver) => String(driver.id) === String(driverId)) : null) ??
    drivers.find((driver) => normalizeComparableText(driver.vehicle_reg) === normalizeComparableText(normalizedRegistration)) ??
    null;
  const vehicleType = matchedDriver?.vehicle_type ?? null;
  const intervalKm = getOilChangeIntervalForVehicleType(vehicleType);

  if (existingVehicle) {
    const normalizedExistingVehicle = normalizeVehicleRow(existingVehicle);
    if (normalizedExistingVehicle.active === false) {
      return normalizedExistingVehicle;
    }

    const updatePayload = stripUndefined({
      vehicle_type: normalizedExistingVehicle.vehicle_type || vehicleType || undefined,
      oil_change_interval_km: normalizedExistingVehicle.oil_change_interval_km ?? intervalKm ?? undefined
    });

    if (Object.keys(updatePayload).length === 0) {
      return normalizedExistingVehicle;
    }

    const updated = await supabase
      .from("vehicles")
      .update(updatePayload)
      .eq("id", normalizedExistingVehicle.id)
      .select()
      .single();

    if (updated.error) {
      logDataError("ensureVehicleForWeeklyMileage update warning:", updated.error, {
        registration: normalizedRegistration,
        updatePayload
      });
      return normalizedExistingVehicle;
    }

    return normalizeVehicleRow(updated.data as Vehicle);
  }

  return null;
}

export async function saveOilChangeService(payload: {
  vehicleId?: string | null;
  vehicleReg: string;
  vehicleName?: string | null;
  serviceDate: string;
  serviceOdometer: number;
  intervalKm: number;
  vehicleType?: string | null;
  notes?: string | null;
  serviceLogId?: string | null;
  updateExistingLog?: boolean;
  recordHistory?: boolean;
}) {
  const serviceDate = payload.serviceDate?.trim();
  const serviceOdometer = Math.trunc(Number(payload.serviceOdometer));
  const intervalKm = Math.trunc(
    Number(getEffectiveOilChangeIntervalForVehicleType(payload.vehicleType, payload.intervalKm) || 30000)
  );

  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)) {
      throw new Error("Last oil change date must be saved in YYYY-MM-DD format.");
    }
    if (!Number.isFinite(serviceOdometer) || serviceOdometer < 0) {
      throw new Error("Oil change odometer must be a valid number.");
    }
    if (!Number.isFinite(intervalKm) || intervalKm <= 0) {
      throw new Error("Interval KM must be greater than zero.");
    }

    const vehicle = await ensureVehicleForService({
      vehicleId: payload.vehicleId,
      registration: payload.vehicleReg,
      vehicleName: payload.vehicleName,
      vehicleType: payload.vehicleType
    });
    const oilChangeBaselinePayload = {
      vehicle_reg: vehicle.vehicle_reg,
      last_oil_change_date: serviceDate,
      last_odometer: serviceOdometer,
      interval_km: intervalKm
    };

    let historyRow: VehicleServiceLog | null = null;
    const historyPayload = stripUndefined({
      vehicle_id: isUuid(vehicle.id) ? vehicle.id : undefined,
      vehicle_reg: vehicle.vehicle_reg,
      service_type: "oil_change",
      service_date: serviceDate,
      odometer: serviceOdometer,
      oil_change_odometer: serviceOdometer,
      interval_km: intervalKm,
      next_service_due_odometer: Math.trunc(serviceOdometer + intervalKm),
      vehicle_type_snapshot: payload.vehicleType ?? vehicle.vehicle_type ?? null,
      notes: payload.notes?.trim() || null
    });
    const canUpdateServiceLog =
      payload.updateExistingLog &&
      payload.serviceLogId &&
      !payload.serviceLogId.startsWith("oil-change-history-");
    const legacyHistoryId =
      payload.updateExistingLog && payload.serviceLogId?.startsWith("oil-change-history-")
        ? payload.serviceLogId.replace(/^oil-change-history-/, "")
        : null;

    if (canUpdateServiceLog) {
      const historyResult = await updateVehicleServiceLogWithSchemaFallback(payload.serviceLogId!, historyPayload);

      if (historyResult.error || !historyResult.data) {
        logDataError("saveOilChangeService history update error:", historyResult.error, historyPayload);
        throw new Error(
          getServiceSchemaSetupMessage(historyResult.error) ??
            historyResult.error?.message ??
            "Failed to update oil change history - try again."
        );
      }

      historyRow = normalizeServiceLogRow(historyResult.data as VehicleServiceLog);
    } else if (legacyHistoryId) {
      const legacyPayload = stripUndefined({
        vehicle_reg: vehicle.vehicle_reg,
        oil_change_date: serviceDate,
        odometer: serviceOdometer
      });
      const legacyResult = await updateOilChangeHistoryWithSchemaFallback(legacyHistoryId, legacyPayload);

      if (legacyResult.error || !legacyResult.data) {
        logDataError("saveOilChangeService legacy history update error:", legacyResult.error, legacyPayload);
        throw new Error(
          getServiceSchemaSetupMessage(legacyResult.error) ??
            legacyResult.error?.message ??
            "Failed to update oil change history - try again."
        );
      }

      historyRow = normalizeOilChangeHistoryRow(legacyResult.data as OilChangeHistory);
    } else if (payload.recordHistory) {
      const historyResult = await insertVehicleServiceLogWithSchemaFallback(historyPayload);

      if (historyResult.error || !historyResult.data) {
        logDataError("saveOilChangeService history error:", historyResult.error, historyPayload);
        throw new Error(
          getServiceSchemaSetupMessage(historyResult.error) ??
            historyResult.error?.message ??
            "Failed to save oil change history - try again."
        );
      }

      historyRow = normalizeServiceLogRow(historyResult.data as VehicleServiceLog);
    }

    const baselineUpsertResult = await supabase
      .from("oil_change_baselines")
      .upsert(oilChangeBaselinePayload, { onConflict: "vehicle_reg" });

    if (baselineUpsertResult.error) {
      logDataError("saveOilChangeService baseline error:", baselineUpsertResult.error, oilChangeBaselinePayload);
      throw new Error(
        getServiceSchemaSetupMessage(baselineUpsertResult.error) ??
          baselineUpsertResult.error?.message ??
          "Failed to save oil change baseline - try again."
      );
    }

    const baselineResult = await supabase
      .from("oil_change_baselines")
      .select("*")
      .eq("vehicle_reg", oilChangeBaselinePayload.vehicle_reg)
      .single();

    if (baselineResult.error || !baselineResult.data) {
      logDataError("saveOilChangeService baseline refetch error:", baselineResult.error, oilChangeBaselinePayload);
      throw new Error(
        getServiceSchemaSetupMessage(baselineResult.error) ??
          baselineResult.error?.message ??
          "Baseline saved, but Supabase did not return the saved baseline."
      );
    }

    const baseline = normalizeOilChangeBaselineRow(baselineResult.data as OilChangeBaseline);
    await syncOilChangeOdometerToWeeklyMileage({
      vehicleReg: baseline.vehicle_reg,
      serviceDate: baseline.last_oil_change_date,
      serviceOdometer: baseline.last_odometer
    });
    const updatedVehicle = normalizeVehicleRow({
      ...vehicle,
      last_oil_change_date: baseline.last_oil_change_date,
      last_oil_change_odometer: baseline.last_odometer,
      oil_change_interval_km: baseline.interval_km
    });
    const baselineServiceLog =
      historyRow ??
      normalizeOilChangeHistoryRow({
        id: baseline.id,
        vehicle_reg: baseline.vehicle_reg,
        oil_change_date: baseline.last_oil_change_date,
        odometer: baseline.last_odometer,
        created_at: baseline.updated_at ?? baseline.created_at
      });

    dispatchDataChange("oil_change_baselines");
    dispatchDataChange("oil_change_history");
    dispatchDataChange("vehicle_service_logs");
    return {
      vehicle: updatedVehicle,
      serviceLog: baselineServiceLog
    };
  } catch (error) {
    console.error("Oil change service save failed", serializeError(error));
    throw error;
  }
}

export async function fetchFuelLogs() {
  return readThroughCache("fuel_logs:all", async () => {
    const fuelLogQuery = await runFuelLogQueryWithOptionalColumnFallback((columns) =>
      supabase
        .from("fuel_logs")
        .select(columns)
        .order("date", { ascending: false })
        .order("id", { ascending: false })
    );

    if (fuelLogQuery.error) {
      logDataError("fetchFuelLogs error:", fuelLogQuery.error);
      throw fuelLogQuery.error;
    }

    console.log("fetchFuelLogs success", { rowCount: (fuelLogQuery.data ?? []).length });

    return mapFuelLogRows((fuelLogQuery.data ?? []) as unknown as Parameters<typeof mapFuelLogRows>[0]);
  });
}

export async function fetchFuelLogsPage({
  page,
  pageSize,
  sortKey,
  sortDirection,
  filters
}: {
  page: number;
  pageSize: number;
  sortKey: FuelLogSortKey;
  sortDirection: FuelLogSortDirection;
  filters?: FuelLogFilters;
}) {
  const safePage = Math.max(1, page);
  const from = (safePage - 1) * pageSize;
  const to = from + pageSize - 1;

  if (sortKey === "price_per_litre") {
    const batchSize = 1000;
    const allRows: Parameters<typeof mapFuelLogRows>[0] = [];
    let queryTotalCount = 0;
    let batchFrom = 0;

    while (true) {
      const batchTo = batchFrom + batchSize - 1;
      const fuelLogQuery = await runFuelLogQueryWithOptionalColumnFallback((columns) =>
        applyFuelLogFilters(
          supabase
            .from("fuel_logs")
            .select(columns, { count: batchFrom === 0 ? "exact" : undefined }),
          filters
        )
          .order("date", { ascending: false })
          .order("id", { ascending: false })
          .range(batchFrom, batchTo)
      );

      if (fuelLogQuery.error) {
        logDataError("fetchFuelLogsPage error:", fuelLogQuery.error, {
          page: safePage,
          pageSize,
          sortKey,
          sortDirection,
          filters
        });
        throw fuelLogQuery.error;
      }

      const batchRows = (fuelLogQuery.data ?? []) as unknown as Parameters<typeof mapFuelLogRows>[0];
      allRows.push(...batchRows);
      if (batchFrom === 0) {
        queryTotalCount = fuelLogQuery.count ?? batchRows.length;
      }
      if (batchRows.length < batchSize) break;
      batchFrom += batchSize;
    }

    const mappedRows = mapFuelLogRows(allRows);
    const direction = sortDirection === "asc" ? 1 : -1;
    const sortedRows = mappedRows.sort((left, right) => {
      const leftPrice = getFuelLogPricePerLitre(left);
      const rightPrice = getFuelLogPricePerLitre(right);
      if (leftPrice == null && rightPrice == null) {
        return right.date.localeCompare(left.date) || String(right.id).localeCompare(String(left.id));
      }
      if (leftPrice == null) return 1;
      if (rightPrice == null) return -1;
      return (leftPrice - rightPrice) * direction;
    });

    return {
      rows: sortedRows.slice(from, to + 1),
      totalCount: queryTotalCount || mappedRows.length,
      page: safePage,
      pageSize
    } satisfies PaginatedFuelLogsResult;
  }

  const fuelLogQuery = await runFuelLogQueryWithOptionalColumnFallback((columns) =>
    applyFuelLogOrdering(
      applyFuelLogFilters(
        supabase
          .from("fuel_logs")
          .select(columns, { count: "exact" }),
        filters
      ),
      sortKey,
      sortDirection
    ).range(from, to)
  );

  if (fuelLogQuery.error) {
    logDataError("fetchFuelLogsPage error:", fuelLogQuery.error, {
      page: safePage,
      pageSize,
      sortKey,
      sortDirection,
      filters
    });
    throw fuelLogQuery.error;
  }

  return {
    rows: mapFuelLogRows((fuelLogQuery.data ?? []) as unknown as Parameters<typeof mapFuelLogRows>[0]),
    totalCount: fuelLogQuery.count ?? 0,
    page: safePage,
    pageSize
  } satisfies PaginatedFuelLogsResult;
}

export async function fetchFuelLogsForExport(filters: FuelLogFilters = {}) {
  const batchSize = 1000;
  const allRows: Parameters<typeof mapFuelLogRows>[0] = [];
  let from = 0;

  while (true) {
    const to = from + batchSize - 1;
    const fuelLogQuery = await runFuelLogQueryWithOptionalColumnFallback((columns) =>
      applyFuelLogFilters(
        supabase
          .from("fuel_logs")
          .select(columns)
          .order("date", { ascending: false })
          .order("id", { ascending: false }),
        filters
      ).range(from, to)
    );

    if (fuelLogQuery.error) {
      logDataError("fetchFuelLogsForExport error:", fuelLogQuery.error, {
        filters,
        from,
        to
      });
      throw fuelLogQuery.error;
    }

    const rows = (fuelLogQuery.data ?? []) as unknown as Parameters<typeof mapFuelLogRows>[0];
    allRows.push(...rows);

    if (rows.length < batchSize) {
      break;
    }

    from += batchSize;
  }

  return mapFuelLogRows(allRows);
}

export async function fetchFuelLogReceiptSummary(filters: FuelLogFilters = {}) {
  const baseFilters: FuelLogFilters = {
    ...filters,
    receiptCheckedStatus: ""
  };

  const totalQuery = await applyFuelLogFilters(
    supabase.from("fuel_logs").select("id", { count: "exact", head: true }),
    baseFilters
  );

  if (totalQuery.error) {
    logDataError("fetchFuelLogReceiptSummary total error:", totalQuery.error, { filters: baseFilters });
    throw totalQuery.error;
  }

  const checkedQuery = await applyFuelLogFilters(
    supabase.from("fuel_logs").select("id", { count: "exact", head: true }),
    {
      ...baseFilters,
      receiptCheckedStatus: "checked"
    }
  );

  if (checkedQuery.error) {
    logDataError("fetchFuelLogReceiptSummary checked error:", checkedQuery.error, { filters: baseFilters });
    throw checkedQuery.error;
  }

  const total = totalQuery.count ?? 0;
  const checked = checkedQuery.count ?? 0;

  return {
    total,
    checked,
    notChecked: Math.max(total - checked, 0)
  } satisfies FuelLogReceiptSummary;
}

export async function fetchFuelLogTodayRows(currentDate: string) {
  return readThroughCache(`fuel_logs:today:${currentDate}`, async () => {
    const query = await supabase
      .from("fuel_logs")
      .select("id, date, driver_id, driver, vehicle_reg, odometer, litres, total_cost, price_per_litre, mileage, location, created_at")
      .eq("date", currentDate)
      .order("date", { ascending: false })
      .order("id", { ascending: false });

    if (query.error) {
      logDataError("fetchFuelLogTodayRows error:", query.error, { currentDate });
      throw query.error;
    }

    return mapFuelLogRows((query.data ?? []) as Parameters<typeof mapFuelLogRows>[0]);
  });
}

export async function fetchFuelLogRecentDaySummaries(days: number) {
  return readThroughCache(`fuel_logs:recent:${days}`, async () => {
    const startDate = new Date();
    startDate.setHours(0, 0, 0, 0);
    startDate.setDate(startDate.getDate() - (days - 1));
    const startKey = startDate.toISOString().slice(0, 10);

    const query = await supabase
      .from("fuel_logs")
      .select("date, litres, total_cost")
      .gte("date", startKey)
      .order("date", { ascending: false });

    if (query.error) {
      logDataError("fetchFuelLogRecentDaySummaries error:", query.error, { days, startKey });
      throw query.error;
    }

    const totals = new Map<string, FuelLogDaySummary>();

    for (let index = 0; index < days; index += 1) {
      const day = new Date();
      day.setHours(0, 0, 0, 0);
      day.setDate(day.getDate() - index);
      const key = day.toISOString().slice(0, 10);
      totals.set(key, { date: key, spend: 0, litres: 0, entries: 0 });
    }

    for (const row of (query.data ?? []) as Array<{ date: string; litres: number; total_cost: number }>) {
      const bucket = totals.get(row.date);
      if (!bucket) continue;
      bucket.spend += Number(row.total_cost || 0);
      bucket.litres += Number(row.litres || 0);
      bucket.entries += 1;
    }

    return Array.from(totals.values()).sort((left, right) => right.date.localeCompare(left.date));
  });
}

export async function fetchFuelLogComparisonEntry({
  vehicleReg,
  date,
  excludeId
}: {
  vehicleReg: string;
  date: string;
  excludeId?: string;
}) {
  let query = supabase
    .from("fuel_logs")
    .select("id, date, driver_id, driver, vehicle_reg, odometer, litres, total_cost, price_per_litre, mileage, location, fuel_type, payment_method, notes, created_at")
    .ilike("vehicle_reg", vehicleReg.trim())
    .lte("date", date)
    .not("mileage", "is", null)
    .order("date", { ascending: false })
    .order("id", { ascending: false })
    .limit(1);

  if (excludeId) {
    query = query.neq("id", excludeId);
  }

  const result = await query;
  if (result.error) {
    logDataError("fetchFuelLogComparisonEntry error:", result.error, { vehicleReg, date, excludeId });
    throw result.error;
  }

  return mapFuelLogRows((result.data ?? []) as Parameters<typeof mapFuelLogRows>[0])[0] ?? null;
}

export async function fetchFuelLogDuplicateMatches({
  date,
  driverId,
  vehicleReg,
  excludeId
}: {
  date: string;
  driverId?: string;
  vehicleReg: string;
  excludeId?: string;
}) {
  let query = supabase
    .from("fuel_logs")
    .select(FUEL_LOG_RECEIPT_SELECT_COLUMNS)
    .eq("date", date)
    .order("id", { ascending: false })
    .limit(10);

  query = driverId ? query.eq("driver_id", driverId) : query.ilike("vehicle_reg", vehicleReg.trim());

  if (excludeId) {
    query = query.neq("id", excludeId);
  }

  const result = await query;
  if (result.error) {
    logDataError("fetchFuelLogDuplicateMatches error:", result.error, { date, driverId, vehicleReg, excludeId });
    throw result.error;
  }

  return mapFuelLogRows((result.data ?? []) as Parameters<typeof mapFuelLogRows>[0]);
}

export async function fetchTransfers() {
  const modernQuery = await supabase
    .from("bank_transfers")
    .select(
      "id, date, driver_id, vehicle_reg, amount, transfer_type, notes, receipt_status, created_at, user_id"
    )
    .order("date", { ascending: false })
    .order("id", { ascending: false });

  if (!modernQuery.error) {
    console.log("fetchTransfers success", { rowCount: (modernQuery.data ?? []).length });
    const driverRows = await fetchDrivers();

    return ((modernQuery.data ?? []) as Array<{
      id: string;
      date: string;
      driver_id: string;
      vehicle_reg: string;
      amount: number;
      transfer_type: string;
      notes: string | null;
      receipt_status?: string | null;
      created_at: string;
      user_id: string;
    }>).map((transfer) => ({
      ...transfer,
      driver: findDriverNameFallback(
        driverRows,
        transfer.driver_id,
        null,
        transfer.vehicle_reg
      ),
      vehicle_reg: normalizeVehicleRegistration(transfer.vehicle_reg),
      transfer_type: normalizeTransferTypeKey(transfer.transfer_type) ?? transfer.transfer_type,
      receipt_status: normalizeTransferReceiptStatus(transfer.receipt_status)
    })) as BankTransferWithDriver[];
  }

  if (!isMissingColumnError(modernQuery.error)) {
    logDataError("fetchTransfers error:", modernQuery.error);
    throw modernQuery.error;
  }

  const legacyQuery = await supabase
    .from("bank_transfers")
    .select("id, transfer_date, driver_id, driver, vehicle_reg, amount, transfer_type, notes")
    .order("transfer_date", { ascending: false })
    .order("id", { ascending: false });

  if (legacyQuery.error) {
    logDataError("fetchTransfers error:", legacyQuery.error);
    throw legacyQuery.error;
  }

  console.log("fetchTransfers legacy success", { rowCount: (legacyQuery.data ?? []).length });
  const driverRows = await fetchDrivers();

  return ((legacyQuery.data ?? []) as Array<{
    id: string;
    transfer_date: string | null;
    driver_id: string | number | null;
    driver: string | null;
    vehicle_reg: string;
    amount: number;
    transfer_type: string;
    notes: string | null;
  }>).map((transfer) => ({
    id: String(transfer.id),
    date: transfer.transfer_date ?? "",
    driver_id: transfer.driver_id != null ? String(transfer.driver_id) : "",
    driver: findDriverNameFallback(
      driverRows,
      transfer.driver_id,
      transfer.driver,
      transfer.vehicle_reg
    ),
    vehicle_reg: normalizeVehicleRegistration(transfer.vehicle_reg),
    amount: Number(transfer.amount || 0),
    transfer_type: normalizeTransferTypeKey(transfer.transfer_type) ?? transfer.transfer_type,
    notes: transfer.notes,
    receipt_status: "pending",
    created_at: "",
    user_id: ""
  })) as BankTransferWithDriver[];
}

export async function fetchWeeklyMileage() {
  const modernQuery = await supabase
    .from("weekly_mileage")
    .select("id, week_ending, driver_id, vehicle_reg, odometer_reading, created_at, user_id")
    .order("week_ending", { ascending: false })
    .order("id", { ascending: false });

  if (!modernQuery.error) {
    let driverLookup = new Map<string, string>();

    try {
      driverLookup = await fetchDriverLookup();
    } catch (lookupError) {
      logDataError("fetchWeeklyMileage driver lookup warning:", lookupError);
    }

    return ((modernQuery.data ?? []) as Array<{
      id: string;
      week_ending: string;
      driver_id: string;
      vehicle_reg: string;
      odometer_reading: number;
      created_at: string;
      user_id?: string;
    }>).map((entry) => ({
      ...entry,
      driver: driverLookup.get(String(entry.driver_id)) ?? "",
      vehicle_reg: normalizeVehicleRegistration(entry.vehicle_reg),
      mileage: Number(entry.odometer_reading || 0)
    })) as WeeklyMileageEntry[];
  }

  if (!isMissingColumnError(modernQuery.error)) {
    logDataError("fetchWeeklyMileage error:", modernQuery.error);
    throw modernQuery.error;
  }

  const [driverRows, legacyQuery] = await Promise.all([
    fetchDrivers().catch((driverError) => {
      logDataError("fetchWeeklyMileage legacy driver lookup warning:", driverError);
      return [] as Driver[];
    }),
    supabase
      .from("weekly_mileage")
      .select("id, week_ending, driver, vehicle_reg, mileage, created_at")
      .order("week_ending", { ascending: false })
      .order("id", { ascending: false })
  ]);

  if (legacyQuery.error) {
    logDataError("fetchWeeklyMileage error:", legacyQuery.error);
    throw legacyQuery.error;
  }

  return ((legacyQuery.data ?? []) as Array<{
    id: string;
    week_ending: string;
    driver: string | null;
    vehicle_reg: string;
    mileage: number;
    created_at: string;
  }>).map((entry) => {
    const matchedDriver = driverRows.find(
      (driver) =>
        normalizeComparableText(driver.name) === normalizeComparableText(entry.driver ?? "") ||
        normalizeComparableText(driver.vehicle_reg) === normalizeComparableText(entry.vehicle_reg)
    );

    return {
      ...entry,
      driver: normalizeDisplayName(entry.driver) || matchedDriver?.name || "",
      driver_id: matchedDriver ? String(matchedDriver.id) : "",
      vehicle_reg: normalizeVehicleRegistration(entry.vehicle_reg),
      odometer_reading: Number(entry.mileage || 0),
      user_id: ""
    };
  }) as WeeklyMileageEntry[];
}

export async function fetchShipments() {
  const { data: shipmentRows, error: shipmentError } = await supabase
    .from("shipments")
    .select("*")
    .order("shipment_date", { ascending: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });

  if (shipmentError) {
    logDataError("fetchShipments error:", shipmentError);
    throw new Error(
      shipmentError.message || shipmentError.details || shipmentError.hint || "SHIPMENTS_LOAD_FAILED"
    );
  }

  console.log("fetchShipments success", { rowCount: (shipmentRows ?? []).length });
  const driverRows = await fetchDrivers();
  const driverLookup = new Map(driverRows.map((driver) => [String(driver.id), driver.name]));

  return ((shipmentRows ?? []) as Shipment[]).map((shipment) => ({
    ...shipment,
    customer_name: shipment.customer_name ?? null,
    goods_description: shipment.goods_description ?? null,
    pickup_location: shipment.pickup_location ?? shipment.start_location,
    dropoff_location: shipment.dropoff_location ?? shipment.end_location,
    vehicle_type: shipment.vehicle_type ?? null,
    standard_km_per_litre: shipment.standard_km_per_litre ?? null,
    estimated_fuel_litres: shipment.estimated_fuel_litres ?? null,
    fuel_price_per_litre: shipment.fuel_price_per_litre ?? shipment.diesel_price ?? null,
    diesel_price: shipment.diesel_price ?? shipment.fuel_price_per_litre ?? null,
    estimated_fuel_cost:
      shipment.estimated_fuel_cost ??
      shipment.fuel_cost ??
      shipment.estimated_fuel_cost_thb ??
      null,
    fuel_cost:
      shipment.fuel_cost ??
      shipment.estimated_fuel_cost ??
      shipment.estimated_fuel_cost_thb ??
      null,
    toll_estimate: shipment.toll_estimate ?? shipment.toll_cost ?? 0,
    toll_cost: shipment.toll_cost ?? shipment.toll_estimate ?? 0,
    driver_cost: shipment.driver_cost ?? 0,
    subtotal_cost: shipment.subtotal_cost ?? null,
    margin_percent: shipment.margin_percent ?? null,
    final_price: shipment.final_price ?? shipment.quoted_price ?? shipment.subtotal_cost ?? null,
    quoted_price: shipment.quoted_price ?? shipment.final_price ?? shipment.subtotal_cost ?? null,
    total_distance_km: shipment.total_distance_km ?? shipment.estimated_distance_km ?? null,
    total_operational_distance_km:
      shipment.total_operational_distance_km ??
      shipment.total_distance_km ??
      shipment.estimated_distance_km ??
      null,
    quoted_distance_km:
      shipment.quoted_distance_km ??
      shipment.total_operational_distance_km ??
      shipment.total_distance_km ??
      shipment.estimated_distance_km ??
      null,
    status: shipment.status ?? "Draft",
    driver: resolveShipmentDriverName(shipment, driverLookup),
    vehicle_reg: normalizeVehicleRegistration(shipment.vehicle_reg)
  })) as ShipmentWithDriver[];
}

export async function fetchBookingDiaryEntries() {
  const pageSize = 1000;
  const rows: BookingDiaryEntry[] = [];

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("booking_diary")
      .select("*, client:clients(id,name,active)")
      .order("booking_date", { ascending: false })
      .order("pickup_time", { ascending: true, nullsFirst: false })
      .order("updated_at", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) {
      logDataError("fetchBookingDiaryEntries error:", error, { from, pageSize });
      const message = String(error.message ?? error.details ?? "");
      if (message.includes("clients") || message.includes("client_id")) {
        throw new Error("Booking Diary client setup is incomplete. Apply migration 20260720_add_booking_clients.sql before using this version.");
      }
      throw new Error(
        error.message || error.details || error.hint || "Unable to load booking diary."
      );
    }

    const page = (data ?? []) as BookingDiaryEntry[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }

  return rows.map((booking) => ({
    ...booking,
    client_id: booking.client_id ?? null,
    client: booking.client ?? null,
    pickup_time: booking.pickup_time ?? null,
    amount_pallets: booking.amount_pallets ?? null,
    weight: booking.weight ?? null,
    dimensions: booking.dimensions ?? null,
    warehouse_no: booking.warehouse_no ?? null,
    job_order_number: booking.job_order_number?.trim() || null,
    created_by_user_id: booking.created_by_user_id ?? null,
    vehicle: normalizeVehicleRegistration(booking.vehicle),
    driver: normalizeDisplayName(booking.driver),
    notes: booking.notes ?? null,
    pickup_place_id: booking.pickup_place_id ?? null,
    dropoff_place_id: booking.dropoff_place_id ?? null,
    pickup_address: booking.pickup_address ?? null,
    dropoff_address: booking.dropoff_address ?? null,
    pickup_lat: parseOptionalNumeric(booking.pickup_lat),
    pickup_lng: parseOptionalNumeric(booking.pickup_lng),
    dropoff_lat: parseOptionalNumeric(booking.dropoff_lat),
    dropoff_lng: parseOptionalNumeric(booking.dropoff_lng),
    estimated_distance_km: parseOptionalNumeric(booking.estimated_distance_km),
    estimated_duration_minutes: parseOptionalNumeric(booking.estimated_duration_minutes),
    google_maps_route_url: booking.google_maps_route_url ?? null,
    distance_source: booking.distance_source ?? null,
    route_calculated_at: booking.route_calculated_at ?? null,
    created_by: booking.created_by ?? null,
    modified_by: booking.modified_by ?? null
  }));
}

export async function fetchClients() {
  const { data, error } = await supabase
    .from("clients")
    .select("id,name,normalized_name,active,created_at,updated_at,created_by")
    .order("active", { ascending: false })
    .order("name", { ascending: true });

  if (error) {
    logDataError("fetchClients error:", error);
    throw new Error("Client directory is unavailable. Apply migration 20260720_add_booking_clients.sql before using this version.");
  }

  return (data ?? []) as Client[];
}

export async function createClient(name: string) {
  const cleaned = normalizeClientName(name);
  if (!cleaned) throw new Error("Client name cannot be blank.");

  const normalizedName = normalizedClientKey(cleaned);
  const existing = await supabase
    .from("clients")
    .select("id,name,normalized_name,active,created_at,updated_at,created_by")
    .eq("normalized_name", normalizedName)
    .maybeSingle();

  if (existing.error) {
    logDataError("createClient duplicate check error:", existing.error);
    throw new Error(existing.error.message || "Unable to check the client directory.");
  }
  if (existing.data) return { client: existing.data as Client, created: false };

  const result = await supabase
    .from("clients")
    .insert({ name: cleaned, normalized_name: normalizedName })
    .select("id,name,normalized_name,active,created_at,updated_at,created_by")
    .single();

  if (result.error) {
    if (result.error.code === "23505") {
      const concurrent = await supabase
        .from("clients")
        .select("id,name,normalized_name,active,created_at,updated_at,created_by")
        .eq("normalized_name", normalizedName)
        .single();
      if (!concurrent.error && concurrent.data) return { client: concurrent.data as Client, created: false };
    }
    logDataError("createClient error:", result.error, { name: cleaned });
    throw new Error(result.error.message || "Unable to create client.");
  }

  return { client: result.data as Client, created: true };
}

async function requireAdminUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw new Error(error.message);
  const user = data.user;
  const email = String(user?.email ?? "").toLowerCase();
  const role = String(user?.user_metadata?.role ?? user?.app_metadata?.role ?? "").toLowerCase();
  if (email !== "joeryan09@outlook.com" && role !== "admin") {
    throw new Error("Admin permission required to manage clients.");
  }
}

export async function updateClient(id: string, payload: { name?: string; active?: boolean }) {
  await requireAdminUser();
  const cleaned: Record<string, unknown> = {};
  if (payload.name !== undefined) {
    const name = normalizeClientName(payload.name);
    if (!name) throw new Error("Client name cannot be blank.");
    cleaned.name = name;
    cleaned.normalized_name = normalizedClientKey(name);
  }
  if (payload.active !== undefined) cleaned.active = payload.active;

  const { data, error } = await supabase
    .from("clients")
    .update(cleaned)
    .eq("id", id)
    .select("id,name,normalized_name,active,created_at,updated_at,created_by")
    .single();

  if (error) {
    logDataError("updateClient error:", error, { id, payload: cleaned });
    throw new Error(error.code === "23505" ? "A client with this name already exists." : error.message || "Unable to update client.");
  }
  return data as Client;
}

export type ClientDeleteEligibility = {
  bookingReferences: number;
  otherReferences: number;
};

export async function fetchClientDeleteEligibility() {
  await requireAdminUser();
  const { data, error } = await supabase.rpc("get_booking_client_delete_eligibility");
  if (error) {
    logDataError("fetchClientDeleteEligibility error:", error);
    throw new Error(error.message || "Unable to check whether clients can be deleted.");
  }

  return new Map<string, ClientDeleteEligibility>(
    ((data ?? []) as Array<{
      client_id: string;
      booking_references: number | string;
      other_references: number | string;
    }>).map((row) => [
      row.client_id,
      {
        bookingReferences: Number(row.booking_references) || 0,
        otherReferences: Number(row.other_references) || 0
      }
    ])
  );
}

export async function deleteUnusedClient(id: string) {
  await requireAdminUser();
  const { data, error } = await supabase
    .rpc("delete_unused_booking_client", { target_client_id: id })
    .single();

  if (error) {
    logDataError("deleteUnusedClient error:", error, { id });
    throw new Error(error.message || "Unable to delete client.");
  }

  return data as { deleted_id: string; deleted_name: string };
}

export async function saveBookingDiaryEntry(
  payload: Partial<
    Omit<
      BookingDiaryEntry,
      | "amount_pallets"
      | "weight"
      | "estimated_distance_km"
      | "estimated_duration_minutes"
      | "pickup_lat"
      | "pickup_lng"
      | "dropoff_lat"
      | "dropoff_lng"
    >
  > & {
    amount_pallets?: string | number | null;
    weight?: string | number | null;
    estimated_distance_km?: string | number | null;
    estimated_duration_minutes?: string | number | null;
    pickup_lat?: string | number | null;
    pickup_lng?: string | number | null;
    dropoff_lat?: string | number | null;
    dropoff_lng?: string | number | null;
  }
) {
  const { id, ...rest } = payload;
  if (!id && !rest.client_id) {
    throw new Error("Client name is required for new Booking Diary entries.");
  }
  const audit = await getCurrentUserAudit();
  const bookingId = id ? rest.booking_id?.trim() : rest.booking_id?.trim() || generateBookingDiaryId();
  const cleaned = stripUndefined({
    ...(!id ? { booking_id: bookingId } : {}),
    client_id: rest.client_id ?? null,
    booking_date: rest.booking_date,
    pickup_time: rest.pickup_time || null,
    amount_pallets: parseOptionalNumeric(rest.amount_pallets),
    weight: parseOptionalNumeric(rest.weight),
    dimensions: rest.dimensions?.trim() || null,
    pickup: rest.pickup?.trim(),
    warehouse_no: rest.warehouse_no?.trim() || null,
    dropoff: rest.dropoff?.trim(),
    pickup_place_id: rest.pickup_place_id?.trim() || null,
    dropoff_place_id: rest.dropoff_place_id?.trim() || null,
    pickup_address: rest.pickup_address?.trim() || null,
    dropoff_address: rest.dropoff_address?.trim() || null,
    pickup_lat: parseOptionalNumeric(rest.pickup_lat),
    pickup_lng: parseOptionalNumeric(rest.pickup_lng),
    dropoff_lat: parseOptionalNumeric(rest.dropoff_lat),
    dropoff_lng: parseOptionalNumeric(rest.dropoff_lng),
    estimated_distance_km: parseOptionalNumeric(rest.estimated_distance_km),
    estimated_duration_minutes: parseOptionalNumeric(rest.estimated_duration_minutes),
    google_maps_route_url: rest.google_maps_route_url?.trim() || null,
    distance_source: rest.distance_source?.trim() || null,
    route_calculated_at: rest.route_calculated_at || null,
    vehicle: normalizeVehicleRegistration(rest.vehicle) || null,
    driver: normalizeDisplayName(rest.driver) || null,
    job_order_number: rest.job_order_number?.trim() || null,
    notes: rest.notes?.trim() || null,
    modified_by: audit.name,
    ...(!id ? { created_by: audit.name, created_by_user_id: audit.id } : {})
  });

  const result = await writeBookingDiaryWithSchemaFallback({ id, payload: cleaned });

  if (result.error) {
    logDataError("saveBookingDiaryEntry error:", result.error, { id, payload: cleaned });
    throw new Error(
      result.error.message ||
        result.error.details ||
        result.error.hint ||
        "Unable to save booking."
    );
  }

  if (id && !result.data) {
    logDataError("saveBookingDiaryEntry update returned no row:", null, { id, payload: cleaned });
    throw new Error("Unable to update booking. Please refresh and try again.");
  }

  dispatchDataChange("booking_diary");
  return result.data as BookingDiaryEntry;
}

export async function deleteBookingDiaryEntry(id: string) {
  const { error } = await supabase.from("booking_diary").delete().eq("id", id);

  if (error) {
    logDataError("deleteBookingDiaryEntry error:", error, { id });
    throw new Error(
      error.message || error.details || error.hint || "Unable to delete booking."
    );
  }

  dispatchDataChange("booking_diary");
}

function normalizeTripStatus(value: unknown): TripJourneyStatus {
  if (
    value === "created" ||
    value === "missing_mileage" ||
    value === "missing_fuel" ||
    value === "missing_estimated_distance" ||
    value === "completed"
  ) {
    return value;
  }

  return "created";
}

function normalizeTripFuelSource(value: unknown): TripFuelSource {
  return value === "manual" ? "manual" : "linked";
}

function getEffectiveTripEstimatedKm({
  estimatedDistanceKm,
  googleEstimatedKm,
  bookingEstimatedKm,
  manualEstimatedDistanceKm
}: {
  estimatedDistanceKm: number | null;
  googleEstimatedKm?: number | null;
  bookingEstimatedKm?: number | null;
  manualEstimatedDistanceKm: number | null;
}) {
  if (manualEstimatedDistanceKm != null && manualEstimatedDistanceKm > 0) {
    return manualEstimatedDistanceKm;
  }
  if (googleEstimatedKm != null && googleEstimatedKm > 0) {
    return googleEstimatedKm;
  }
  if (bookingEstimatedKm != null && bookingEstimatedKm > 0) {
    return bookingEstimatedKm;
  }
  if (estimatedDistanceKm != null && estimatedDistanceKm > 0) {
    return estimatedDistanceKm;
  }
  return null;
}

function normalizeTripJourneyRow(row: TripJourney): TripJourney {
  const raw = row as TripJourney & {
    booking_diary_id?: string | null;
    booking_reference?: string | null;
    date?: string | null;
    load_text?: string | null;
    notes?: string | null;
    manual_litres?: number | null;
  };
  const bookingDiaryId = isUuid(raw.booking_diary_id)
    ? raw.booking_diary_id
    : isUuid(row.booking_id)
      ? row.booking_id
      : null;

  return {
    ...row,
    booking_diary_id: bookingDiaryId,
    booking_id: bookingDiaryId,
    booking_reference: raw.booking_reference ?? (!isUuid(row.booking_id) ? row.booking_id : null),
    trip_date: row.trip_date ?? raw.date ?? "",
    pickup_time: row.pickup_time ?? null,
    start_location_type:
      row.route_start_type === "pickup_only" || row.start_location_type === "pickup_only"
        ? "pickup_only"
        : row.route_start_type === "custom" || row.start_location_type === "custom"
          ? "custom"
          : "depot",
    start_location: row.start_location ?? row.depot_address ?? null,
    depot_address: row.depot_address ?? null,
    route_start_type:
      row.route_start_type === "pickup_only" || row.start_location_type === "pickup_only"
        ? "pickup_only"
        : row.route_start_type === "custom" || row.start_location_type === "custom"
          ? "custom"
          : "depot",
    depot_address_used: row.depot_address_used ?? row.depot_address ?? null,
    custom_start_address: row.custom_start_address ?? (row.start_location_type === "custom" ? row.start_location : null),
    pickup_address: row.pickup_address ?? row.pickup_location ?? null,
    dropoff_address: row.dropoff_address ?? row.dropoff_location ?? null,
    pickup_location: row.pickup_location ?? null,
    dropoff_location: row.dropoff_location ?? null,
    route: row.route ?? null,
    vehicle_type: row.vehicle_type ?? null,
    vehicle_reg: normalizeVehicleRegistration(row.vehicle_reg),
    driver: normalizeDisplayName(row.driver),
    load_details: row.load_details ?? raw.load_text ?? null,
    warehouse_no: row.warehouse_no ?? null,
    booking_notes: row.booking_notes ?? raw.notes ?? null,
    start_mileage: parseOptionalNumeric(row.start_mileage),
    end_mileage: parseOptionalNumeric(row.end_mileage),
    manual_actual_km: parseOptionalNumeric(row.manual_actual_km ?? row.actual_distance_km),
    actual_distance_km: parseOptionalNumeric(row.actual_distance_km),
    return_to_depot: Boolean(row.return_to_depot),
    estimated_distance_km: parseOptionalNumeric(row.estimated_distance_km),
    estimated_duration_minutes: parseOptionalNumeric(row.estimated_duration_minutes),
    google_maps_route_url: row.google_maps_route_url ?? null,
    estimated_distance_source: row.estimated_distance_source ?? null,
    google_estimated_km: parseOptionalNumeric(row.google_estimated_km),
    google_estimated_minutes: parseOptionalNumeric(row.google_estimated_minutes),
    route_source: row.route_source ?? row.estimated_distance_source ?? null,
    booking_estimated_km: parseOptionalNumeric(row.booking_estimated_km),
    booking_estimated_minutes: parseOptionalNumeric(row.booking_estimated_minutes),
    booking_google_maps_route_url: row.booking_google_maps_route_url ?? null,
    manual_estimated_distance_km: parseOptionalNumeric(row.manual_estimated_distance_km),
    manual_litres_used: parseOptionalNumeric(row.manual_litres_used ?? raw.manual_litres),
    manual_fuel_cost: parseOptionalNumeric(row.manual_fuel_cost),
    fuel_source: normalizeTripFuelSource(row.fuel_source),
    waiting_idle_notes: row.waiting_idle_notes ?? null,
    extra_route_notes: row.extra_route_notes ?? null,
    status: normalizeTripStatus(row.status)
  };
}

function calculateTripStatusFromValues({
  startMileage,
  endMileage,
  manualActualKm,
  estimatedDistanceKm,
  googleEstimatedKm,
  bookingEstimatedKm,
  manualEstimatedDistanceKm,
  manualLitresUsed,
  manualFuelCost,
  fuelSource,
  linkedFuelLogs
}: {
  startMileage: number | null;
  endMileage: number | null;
  manualActualKm: number | null;
  estimatedDistanceKm: number | null;
  googleEstimatedKm?: number | null;
  bookingEstimatedKm?: number | null;
  manualEstimatedDistanceKm: number | null;
  manualLitresUsed: number | null;
  manualFuelCost: number | null;
  fuelSource: TripFuelSource;
  linkedFuelLogs?: FuelLogWithDriver[];
}): TripJourneyStatus {
  const mileageDistance =
    startMileage != null && endMileage != null && endMileage > startMileage
      ? endMileage - startMileage
      : null;
  const actualDistanceKm = mileageDistance;
  const estimatedKm = getEffectiveTripEstimatedKm({
    estimatedDistanceKm,
    googleEstimatedKm,
    bookingEstimatedKm,
    manualEstimatedDistanceKm
  });
  const workingDistanceKm = (manualActualKm != null && manualActualKm > 0 ? manualActualKm : actualDistanceKm) ?? estimatedKm;

  if (workingDistanceKm == null || workingDistanceKm <= 0) return "missing_mileage";

  return "completed";
}

function mapBookingToTripPayload(booking: BookingDiaryEntry) {
  const loadParts = [
    booking.amount_pallets != null ? `${booking.amount_pallets} pallets` : "",
    booking.weight != null ? `${booking.weight} kg` : "",
    booking.dimensions ?? ""
  ].filter(Boolean);

  const bookingEstimatedKm = parseOptionalNumeric(booking.estimated_distance_km);
  const bookingEstimatedMinutes = parseOptionalNumeric(booking.estimated_duration_minutes);
  const pickupDisplay = getDiaryDisplayName(booking.pickup, booking.pickup_address) || booking.pickup || "";
  const dropoffDisplay = getDiaryDisplayName(booking.dropoff, booking.dropoff_address) || booking.dropoff || "";
  const pickupAddress = booking.pickup_address || booking.pickup;
  const dropoffAddress = booking.dropoff_address || booking.dropoff;

  return {
    booking_id: booking.id,
    booking_reference: booking.booking_id ?? null,
    start_location: "Expert Express Sender Co., Ltd. 88 Happy Place, Khwaeng Khlong Sam Prawet, Khet Lat Krabang, Bangkok 10520, Thailand",
    start_location_type: "depot",
    depot_address: "Expert Express Sender Co., Ltd. 88 Happy Place, Khwaeng Khlong Sam Prawet, Khet Lat Krabang, Bangkok 10520, Thailand",
    route_start_type: "depot",
    depot_address_used: "Expert Express Sender Co., Ltd. 88 Happy Place, Khwaeng Khlong Sam Prawet, Khet Lat Krabang, Bangkok 10520, Thailand",
    custom_start_address: null,
    pickup_address: pickupAddress,
    dropoff_address: dropoffAddress,
    date: booking.booking_date,
    pickup_time: booking.pickup_time ?? null,
    pickup_location: pickupDisplay || pickupAddress,
    dropoff_location: dropoffDisplay || dropoffAddress,
    route: [pickupDisplay, dropoffDisplay].filter(Boolean).join(" -> "),
    vehicle_reg: normalizeVehicleRegistration(booking.vehicle) || null,
    driver: normalizeDisplayName(booking.driver) || null,
    load_text: loadParts.join(" | ") || null,
    warehouse_no: booking.warehouse_no ?? null,
    notes: booking.notes ?? null,
    estimated_distance_km: bookingEstimatedKm,
    estimated_duration_minutes: bookingEstimatedMinutes,
    google_maps_route_url: null,
    estimated_distance_source: booking.distance_source ?? null,
    booking_estimated_km: bookingEstimatedKm,
    booking_estimated_minutes: bookingEstimatedMinutes,
    booking_google_maps_route_url: booking.google_maps_route_url ?? null,
    google_estimated_km: null,
    google_estimated_minutes: null,
    route_source: "booking_diary",
    return_to_depot: false,
    fuel_source: "manual" as TripFuelSource,
    status: "created" as TripJourneyStatus
  };
}

export async function fetchTripJourneys(): Promise<TripJourneyWithFuel[]> {
  const tripResult = await supabase
    .from("trip_journeys")
    .select("*")
    .order("date", { ascending: false })
    .order("created_at", { ascending: false });

  if (tripResult.error) {
    if (isMissingTableError(tripResult.error)) {
      return [];
    }
    logDataError("fetchTripJourneys error:", tripResult.error);
    throw new Error(tripResult.error.message || "Unable to load trip journeys.");
  }

  const trips = ((tripResult.data ?? []) as TripJourney[]).map(normalizeTripJourneyRow);
  const linkResult = await supabase.from("trip_fuel_logs").select("*");
  const links = linkResult.error
    ? []
    : ((linkResult.data ?? []) as TripFuelLogLink[]);

  if (linkResult.error && !isMissingTableError(linkResult.error)) {
    logDataError("fetchTripJourneys trip_fuel_logs warning:", linkResult.error);
  }

  const fuelLogs = await fetchFuelLogs().catch((error) => {
    logDataError("fetchTripJourneys fuel log warning:", error);
    return [] as FuelLogWithDriver[];
  });
  const fuelById = new Map(fuelLogs.map((log) => [String(log.id), log]));
  const linksByTrip = new Map<string, FuelLogWithDriver[]>();

  for (const link of links) {
    const log = fuelById.get(String(link.fuel_log_id));
    if (!log) continue;
    linksByTrip.set(String(link.trip_journey_id), [...(linksByTrip.get(String(link.trip_journey_id)) ?? []), log]);
  }

  return trips.map((trip) => ({
    ...trip,
    status: calculateTripStatusFromValues({
      startMileage: trip.start_mileage,
      endMileage: trip.end_mileage,
      manualActualKm: trip.manual_actual_km ?? null,
      estimatedDistanceKm: trip.estimated_distance_km,
      googleEstimatedKm: trip.google_estimated_km,
      bookingEstimatedKm: trip.booking_estimated_km,
      manualEstimatedDistanceKm: trip.manual_estimated_distance_km,
      manualLitresUsed: trip.manual_litres_used,
      manualFuelCost: trip.manual_fuel_cost,
      fuelSource: trip.fuel_source,
      linkedFuelLogs: linksByTrip.get(String(trip.id)) ?? []
    }),
    linkedFuelLogs: linksByTrip.get(String(trip.id)) ?? []
  }));
}

export async function fetchTripJourneyById(id: string) {
  const trips = await fetchTripJourneys();
  return trips.find((trip) => String(trip.id) === String(id)) ?? null;
}

export async function createTripJourneyFromBooking(booking: BookingDiaryEntry) {
  const existing = await supabase
    .from("trip_journeys")
    .select("*")
    .eq("booking_id", booking.id)
    .limit(1)
    .maybeSingle();

  if (!existing.error && existing.data) {
    return normalizeTripJourneyRow(existing.data as TripJourney);
  }

  if (existing.error && isMissingTableError(existing.error)) {
    throw new Error("Trip Journey database tables are not set up yet. Apply the trip_journeys migration in Supabase, then try again.");
  }

  if (existing.error && !isMissingTableError(existing.error)) {
    logDataError("createTripJourneyFromBooking existing lookup error:", existing.error, { bookingId: booking.id });
    throw new Error(existing.error.message || "Unable to check existing trip record.");
  }

  const payload = stripUndefined(mapBookingToTripPayload(booking));
  let result = await supabase.from("trip_journeys").insert(payload).select().single();

  if (isMissingTripOptionalColumnError(result.error) || isMissingBookingReferenceColumnError(result.error)) {
    const fallbackPayload = omitTripOptionalColumns(payload);
    result = await supabase.from("trip_journeys").insert(fallbackPayload).select().single();
  }

  if (result.error) {
    logDataError("createTripJourneyFromBooking error:", result.error, payload);
    throw new Error(
      result.error.message ||
        result.error.details ||
        result.error.hint ||
        "Unable to create trip record. Apply the Trip Journey migration first."
    );
  }

  dispatchDataChange("trip_journeys");
  return normalizeTripJourneyRow(result.data as TripJourney);
}

export async function saveTripJourney(
  payload: Partial<TripJourney> & {
    id?: string | null;
    linkedFuelLogs?: FuelLogWithDriver[];
  }
) {
  const fuelSource = normalizeTripFuelSource(payload.fuel_source);
  const startMileage = parseOptionalNumeric(payload.start_mileage);
  const endMileage = parseOptionalNumeric(payload.end_mileage);
  const estimatedDistanceKm = parseOptionalNumeric(payload.estimated_distance_km);
  const googleEstimatedKm = parseOptionalNumeric(payload.google_estimated_km);
  const bookingEstimatedKm = parseOptionalNumeric(payload.booking_estimated_km);
  const manualEstimatedDistanceKm = parseOptionalNumeric(payload.manual_estimated_distance_km);
  const manualActualKm = parseOptionalNumeric(payload.manual_actual_km);
  const manualLitresUsed = parseOptionalNumeric(payload.manual_litres_used);
  const manualFuelCost = parseOptionalNumeric(payload.manual_fuel_cost);
  const actualDistanceKm =
    startMileage != null && endMileage != null && endMileage > startMileage
      ? endMileage - startMileage
      : null;
  const effectiveEstimatedDistanceKm = getEffectiveTripEstimatedKm({
    estimatedDistanceKm,
    googleEstimatedKm,
    bookingEstimatedKm,
    manualEstimatedDistanceKm
  });
  const distanceDifferenceKm =
    (manualActualKm ?? actualDistanceKm) != null && effectiveEstimatedDistanceKm != null
      ? (manualActualKm ?? actualDistanceKm ?? 0) - effectiveEstimatedDistanceKm
      : null;
  const distanceDifferencePercent =
    distanceDifferenceKm != null && effectiveEstimatedDistanceKm != null && effectiveEstimatedDistanceKm > 0
      ? (distanceDifferenceKm / effectiveEstimatedDistanceKm) * 100
      : null;
  const status = calculateTripStatusFromValues({
    startMileage,
    endMileage,
    manualActualKm,
    estimatedDistanceKm,
    googleEstimatedKm,
    bookingEstimatedKm,
    manualEstimatedDistanceKm,
    manualLitresUsed,
    manualFuelCost,
    fuelSource,
    linkedFuelLogs: payload.linkedFuelLogs
  });
  const bookingDiaryId = payload.booking_diary_id ?? payload.booking_id ?? null;
  const cleaned = stripUndefined({
    booking_id: isUuid(bookingDiaryId) ? bookingDiaryId : undefined,
    booking_reference: payload.booking_reference?.trim() || (!isUuid(bookingDiaryId) && bookingDiaryId ? String(bookingDiaryId) : undefined),
    date: payload.trip_date,
    start_location_type:
      payload.start_location_type === "pickup_only"
        ? "pickup_only"
        : payload.start_location_type === "custom"
          ? "custom"
          : "depot",
    start_location: payload.start_location?.trim() || null,
    depot_address: payload.depot_address?.trim() || null,
    route_start_type:
      payload.route_start_type === "pickup_only" || payload.start_location_type === "pickup_only"
        ? "pickup_only"
        : payload.route_start_type === "custom" || payload.start_location_type === "custom"
          ? "custom"
          : "depot",
    depot_address_used: payload.depot_address_used?.trim() || payload.depot_address?.trim() || null,
    custom_start_address: payload.custom_start_address?.trim() || (payload.start_location_type === "custom" ? payload.start_location?.trim() || null : null),
    pickup_address: payload.pickup_address?.trim() || payload.pickup_location?.trim() || null,
    dropoff_address: payload.dropoff_address?.trim() || payload.dropoff_location?.trim() || null,
    pickup_time: payload.pickup_time || null,
    pickup_location: payload.pickup_location?.trim() || null,
    dropoff_location: payload.dropoff_location?.trim() || null,
    route: payload.route?.trim() || null,
    vehicle_type: payload.vehicle_type?.trim() || null,
    vehicle_reg: normalizeVehicleRegistration(payload.vehicle_reg) || null,
    driver: normalizeDisplayName(payload.driver) || null,
    load_text: payload.load_details?.trim() || null,
    warehouse_no: payload.warehouse_no?.trim() || null,
    notes: payload.booking_notes?.trim() || null,
    start_mileage: startMileage,
    end_mileage: endMileage,
    actual_distance_km: actualDistanceKm,
    manual_actual_km: manualActualKm,
    return_to_depot: Boolean(payload.return_to_depot),
    estimated_distance_km: googleEstimatedKm ?? bookingEstimatedKm ?? estimatedDistanceKm,
    estimated_duration_minutes: parseOptionalNumeric(payload.google_estimated_minutes ?? payload.estimated_duration_minutes ?? payload.booking_estimated_minutes),
    google_maps_route_url: payload.google_maps_route_url?.trim() || null,
    estimated_distance_source: payload.estimated_distance_source?.trim() || payload.route_source?.trim() || null,
    google_estimated_km: googleEstimatedKm,
    google_estimated_minutes: parseOptionalNumeric(payload.google_estimated_minutes),
    route_source: payload.route_source?.trim() || payload.estimated_distance_source?.trim() || null,
    booking_estimated_km: bookingEstimatedKm,
    booking_estimated_minutes: parseOptionalNumeric(payload.booking_estimated_minutes),
    booking_google_maps_route_url: payload.booking_google_maps_route_url?.trim() || null,
    manual_estimated_distance_km: manualEstimatedDistanceKm,
    distance_difference_km: distanceDifferenceKm,
    distance_difference_percent: distanceDifferencePercent,
    manual_litres: manualLitresUsed,
    manual_fuel_cost: manualFuelCost,
    fuel_source: fuelSource,
    waiting_idle_notes: payload.waiting_idle_notes?.trim() || null,
    extra_route_notes: payload.extra_route_notes?.trim() || null,
    status
  });

  let result = payload.id
    ? await supabase.from("trip_journeys").update(cleaned).eq("id", payload.id).select().single()
    : await supabase.from("trip_journeys").insert(cleaned).select().single();

  if (isMissingTripOptionalColumnError(result.error) || isMissingBookingReferenceColumnError(result.error)) {
    const fallbackPayload = {
      ...omitTripOptionalColumns(cleaned),
      estimated_distance_km: effectiveEstimatedDistanceKm
    };
    result = payload.id
      ? await supabase.from("trip_journeys").update(fallbackPayload).eq("id", payload.id).select().single()
      : await supabase.from("trip_journeys").insert(fallbackPayload).select().single();
  }

  if (result.error) {
    logDataError("saveTripJourney error:", result.error, cleaned);
    throw new Error(result.error.message || "Unable to save trip journey.");
  }

  dispatchDataChange("trip_journeys");
  return normalizeTripJourneyRow(result.data as TripJourney);
}

export async function deleteTripJourney(id: string) {
  const linkResult = await supabase
    .from("trip_fuel_logs")
    .delete()
    .eq("trip_journey_id", id);

  if (linkResult.error && !isMissingTableError(linkResult.error)) {
    logDataError("deleteTripJourney link cleanup error:", linkResult.error, { id });
    throw new Error("Unable to remove linked fuel log relationships for this trip.");
  }

  const tripResult = await supabase
    .from("trip_journeys")
    .delete()
    .eq("id", id);

  if (tripResult.error) {
    logDataError("deleteTripJourney trip delete error:", tripResult.error, { id });
    throw new Error("Unable to delete this trip. Please try again.");
  }

  dispatchDataChange("trip_fuel_logs");
  dispatchDataChange("trip_journeys");
}

export async function linkFuelLogToTrip(tripJourneyId: string, fuelLogId: string) {
  const { error } = await supabase
    .from("trip_fuel_logs")
    .insert({ trip_journey_id: tripJourneyId, fuel_log_id: String(fuelLogId) });

  if (error) {
    logDataError("linkFuelLogToTrip error:", error, { tripJourneyId, fuelLogId });
    if (error.code === "22P02" || error.message?.includes("invalid input syntax for type uuid")) {
      throw new Error(
        "Fuel log linking needs the Trip Fuel Logs migration that changes fuel_log_id to text. Run the migration, then try linking again."
      );
    }
    if (error.code === "23505") {
      const details = `${error.message ?? ""} ${error.details ?? ""}`.toLowerCase();
      if (details.includes("trip_fuel_logs_trip_fuel_unique_idx") || details.includes("trip_journey_id") || details.includes("duplicate key")) {
        throw new Error("This fuel log is already linked to this trip.");
      }
      throw new Error("Could not link fuel log. Please refresh and try again.");
    }
    throw new Error("Could not link fuel log. Please refresh and try again.");
  }

  dispatchDataChange("trip_fuel_logs");
}

export async function unlinkFuelLogFromTrip(tripJourneyId: string, fuelLogId: string) {
  const { error } = await supabase
    .from("trip_fuel_logs")
    .delete()
    .eq("trip_journey_id", tripJourneyId)
    .eq("fuel_log_id", fuelLogId);

  if (error) {
    logDataError("unlinkFuelLogFromTrip error:", error, { tripJourneyId, fuelLogId });
    if (error.code === "22P02" || error.message?.includes("invalid input syntax for type uuid")) {
      throw new Error(
        "Fuel log unlinking needs the Trip Fuel Logs migration that changes fuel_log_id to text. Run the migration, then try again."
      );
    }
    throw new Error(error.message || "Unable to unlink fuel log from trip.");
  }

  dispatchDataChange("trip_fuel_logs");
}

export async function fetchTripFuelLogLinks(): Promise<TripFuelLogLink[]> {
  const { data, error } = await supabase.from("trip_fuel_logs").select("*");

  if (error) {
    if (isMissingTableError(error)) {
      return [];
    }
    logDataError("fetchTripFuelLogLinks error:", error);
    throw new Error(error.message || "Unable to load trip fuel links.");
  }

  return (data ?? []) as TripFuelLogLink[];
}

export async function fetchTripJourneysByBookingIds(bookingIds: string[]) {
  if (!bookingIds.length) return [] as TripJourney[];
  const bookingIdSet = new Set(bookingIds.map((id) => String(id)));
  const trips = await fetchTripJourneys();
  return trips.filter(
    (trip) =>
      bookingIdSet.has(String(trip.booking_id ?? "")) ||
      bookingIdSet.has(String(trip.booking_diary_id ?? ""))
  );
}

export async function fetchRouteDistanceEstimate(
  originKey: string,
  destinationKey: string
) {
  return readThroughCache(`route_estimate:${originKey}:${destinationKey}`, async () => {
    const { data, error } = await supabase
      .from("route_distance_estimates")
      .select("*")
      .eq("origin_key", originKey)
      .eq("destination_key", destinationKey)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      logDataError("fetchRouteDistanceEstimate error:", error);
      throw error;
    }

    return (data ?? null) as RouteDistanceEstimate | null;
  });
}

export async function saveDriver(payload: Partial<Driver>) {
  const { id, ...rest } = payload;
  const cleaned = stripUndefined(rest);
  const driverName = normalizeComparableText(String(cleaned.name ?? ""));
  const vehicleReg = normalizeComparableText(String(cleaned.vehicle_reg ?? ""));

  const { data: existingDrivers, error: existingDriversError } = await supabase
    .from("drivers")
    .select("id, name, vehicle_reg");

  if (existingDriversError) {
    logDataError("saveDriver existingDrivers error:", existingDriversError);
    throw existingDriversError;
  }

  const conflict = ((existingDrivers ?? []) as Array<Pick<Driver, "id" | "name" | "vehicle_reg">>)
    .filter((driver) => String(driver.id) !== String(id ?? ""))
    .find(
      (driver) =>
        normalizeComparableText(driver.name) === driverName ||
        normalizeComparableText(driver.vehicle_reg) === vehicleReg
    );

  if (conflict) {
    const sameName = normalizeComparableText(conflict.name) === driverName;
    throw new Error(sameName ? "DUPLICATE_DRIVER_NAME" : "DUPLICATE_DRIVER_VEHICLE");
  }

  const { data, error } = id
    ? await supabase.from("drivers").update(cleaned).eq("id", id).select().single()
    : await supabase.from("drivers").insert(cleaned).select().single();

  if (error) {
    logDataError("saveDriver error:", error, cleaned);
    throw error;
  }

  dispatchDataChange("drivers");
  return data as Driver;
}

export async function deleteDriver(id: string) {
  const { error } = await supabase.from("drivers").delete().eq("id", id);

  if (error) {
    logDataError("deleteDriver error:", error, { id });
    throw error;
  }

  dispatchDataChange("drivers");
}

export async function saveFuelLog(payload: Partial<FuelLog>) {
  const { id, ...rest } = payload;
  const locationValue = rest.location ?? rest.station;
  const driverName =
    rest.driver && String(rest.driver).trim()
      ? String(rest.driver).trim()
      : rest.driver_id
        ? (await fetchDrivers()).find((driver) => String(driver.id) === String(rest.driver_id))?.name ?? ""
        : "";

  const schemaPayload = stripUndefined({
    date: rest.date,
    driver_id: rest.driver_id,
    driver: driverName || undefined,
    vehicle_reg: rest.vehicle_reg,
    odometer: rest.odometer ?? rest.mileage ?? null,
    litres: rest.litres,
    total_cost: rest.total_cost,
    price_per_litre: rest.price_per_litre ?? null,
    mileage: rest.odometer ?? rest.mileage ?? null,
    location: locationValue == null ? undefined : String(locationValue).trim(),
    fuel_type: normalizeFuelTypeKey(rest.fuel_type) ?? rest.fuel_type,
    payment_method: normalizePaymentMethodKey(rest.payment_method) ?? rest.payment_method,
    entry_source: normalizeFuelLogEntrySource(rest.entry_source),
    receipt_checked: rest.receipt_checked,
    receipt_checked_at: rest.receipt_checked_at ?? null,
    notes: rest.notes ?? null
  });

  const result = id
    ? await supabase.from("fuel_logs").update(schemaPayload).eq("id", id).select().single()
    : await supabase.from("fuel_logs").insert(schemaPayload).select().single();

  if (result.error) {
    logDataError("saveFuelLog error:", result.error, schemaPayload);
    throw new Error(
      result.error.message ||
        result.error.details ||
        result.error.hint ||
        "Unable to save fuel log."
    );
  }

  dispatchDataChange("fuel_logs");
  return {
    ...(result.data as FuelLog),
    driver: driverName,
    mileage:
      Number((result.data as { mileage?: number | null }).mileage) ||
      Number((result.data as FuelLog).odometer || 0),
    station: normalizeFuelLogLocation((result.data as { location?: string }).location),
    location: normalizeFuelLogLocation((result.data as { location?: string }).location),
    price_per_litre: (result.data as { price_per_litre?: number | null }).price_per_litre ?? null,
    entry_source: normalizeFuelLogEntrySource((result.data as { entry_source?: string | null }).entry_source),
    receipt_checked: Boolean((result.data as { receipt_checked?: boolean | null }).receipt_checked),
    receipt_checked_at: (result.data as { receipt_checked_at?: string | null }).receipt_checked_at ?? null
  } as FuelLog;
}

export async function updateFuelLogReceiptCheck(id: string, checked: boolean) {
  const payload = {
    receipt_checked: checked,
    receipt_checked_at: checked ? new Date().toISOString() : null
  };

  const result = await supabase.from("fuel_logs").update(payload).eq("id", id).select().single();

  if (result.error) {
    logDataError("updateFuelLogReceiptCheck error:", result.error, { id, checked });
    throw new Error(
      result.error.message ||
        result.error.details ||
        result.error.hint ||
        "Unable to update receipt check status."
    );
  }

  dispatchDataChange("fuel_logs");
  return {
    receipt_checked: Boolean((result.data as { receipt_checked?: boolean | null }).receipt_checked),
    receipt_checked_at: (result.data as { receipt_checked_at?: string | null }).receipt_checked_at ?? null
  };
}

export async function deleteFuelLog(id: string) {
  const { error } = await supabase.from("fuel_logs").delete().eq("id", id);

  if (error) {
    logDataError("deleteFuelLog error:", error, { id });
    throw error;
  }

  dispatchDataChange("fuel_logs");
}

export async function updateTransferReceiptStatus(
  id: string,
  status: NonNullable<BankTransfer["receipt_status"]>
) {
  const receiptStatus = normalizeTransferReceiptStatus(status);
  const result = await supabase
    .from("bank_transfers")
    .update({ receipt_status: receiptStatus })
    .eq("id", id)
    .select()
    .single();

  if (result.error) {
    logDataError("updateTransferReceiptStatus error:", result.error, { id, receiptStatus });
    throw new Error(
      result.error.message ||
        result.error.details ||
        result.error.hint ||
        "Unable to update transfer check status."
    );
  }

  dispatchDataChange("bank_transfers");
  return {
    receipt_status: normalizeTransferReceiptStatus(
      (result.data as { receipt_status?: string | null }).receipt_status
    )
  };
}

export async function saveTransfer(
  payload: Partial<BankTransfer> & { transfer_date?: string }
) {
  const { id, ...rest } = payload;
  const receiptStatus = normalizeTransferReceiptStatus(rest.receipt_status ?? "pending");
  const modernPayload = stripUndefined({
    date: rest.transfer_date ?? rest.date,
    driver_id: rest.driver_id,
    vehicle_reg: rest.vehicle_reg,
    amount: rest.amount,
    transfer_type: normalizeTransferTypeKey(rest.transfer_type) ?? rest.transfer_type,
    notes: rest.notes ?? null,
    receipt_status: receiptStatus
  });

  const modernResult = id
    ? await supabase.from("bank_transfers").update(modernPayload).eq("id", id).select().single()
    : await supabase.from("bank_transfers").insert(modernPayload).select().single();

  if (!modernResult.error) {
    dispatchDataChange("bank_transfers");
    return {
      ...(modernResult.data as BankTransfer),
      driver: "",
      receipt_status: normalizeTransferReceiptStatus(
        (modernResult.data as { receipt_status?: string | null }).receipt_status ?? receiptStatus
      )
    } as BankTransfer;
  }

  if (!isMissingColumnError(modernResult.error)) {
    logDataError("saveTransfer error:", modernResult.error, modernPayload);
    throw new Error(
      modernResult.error.message ||
        modernResult.error.details ||
        modernResult.error.hint ||
        "Unable to save transfer."
    );
  }

  const driverName = rest.driver_id
    ? (await fetchDrivers()).find((driver) => String(driver.id) === String(rest.driver_id))?.name ?? ""
    : "";

  const legacyPayload = stripUndefined({
    transfer_date: rest.transfer_date ?? rest.date,
    driver_id: rest.driver_id,
    driver: driverName || undefined,
    vehicle_reg: rest.vehicle_reg,
    amount: rest.amount,
    transfer_type: normalizeTransferTypeKey(rest.transfer_type) ?? rest.transfer_type,
    notes: rest.notes ?? null
  });

  const legacyResult = id
    ? await supabase.from("bank_transfers").update(legacyPayload).eq("id", id).select().single()
    : await supabase.from("bank_transfers").insert(legacyPayload).select().single();

  if (legacyResult.error) {
    logDataError("saveTransfer error:", legacyResult.error, legacyPayload);
    throw new Error(
      legacyResult.error.message ||
        legacyResult.error.details ||
        legacyResult.error.hint ||
        "Unable to save transfer."
    );
  }

  dispatchDataChange("bank_transfers");
  return {
    ...(legacyResult.data as BankTransfer),
    driver: driverName,
    date: String((legacyResult.data as { transfer_date?: string }).transfer_date ?? rest.transfer_date ?? rest.date ?? ""),
    receipt_status: receiptStatus
  } as BankTransfer;
}

export async function deleteTransfer(id: string) {
  const { error } = await supabase.from("bank_transfers").delete().eq("id", id);

  if (error) {
    logDataError("deleteTransfer error:", error, { id });
    throw error;
  }

  dispatchDataChange("bank_transfers");
}

export async function saveWeeklyMileage(payload: Partial<WeeklyMileageEntry>) {
  const { id, ...rest } = payload;
  const odometerReading = rest.odometer_reading ?? rest.mileage;
  const normalizedVehicleReg = normalizeVehicleRegistration(rest.vehicle_reg);
  const normalizedOdometerReading =
    odometerReading != null && Number.isFinite(Number(odometerReading))
      ? Math.trunc(Number(odometerReading))
      : undefined;
  const modernPayload = stripUndefined({
    week_ending: rest.week_ending,
    driver_id: rest.driver_id,
    vehicle_reg: normalizedVehicleReg,
    odometer_reading: normalizedOdometerReading,
    mileage: normalizedOdometerReading
  });

  if (modernPayload.odometer_reading == null) {
    throw new Error("Odometer reading must be a valid number.");
  }
  if (!modernPayload.vehicle_reg) {
    throw new Error("Vehicle registration is required.");
  }

  const modernResult = id
    ? await supabase
        .from("weekly_mileage")
        .update(modernPayload)
        .eq("id", id)
        .select()
        .single()
    : await supabase.from("weekly_mileage").insert(modernPayload).select().single();

  if (!modernResult.error) {
    await ensureVehicleForWeeklyMileage({
      registration: normalizedVehicleReg,
      driverId: rest.driver_id
    });
    dispatchDataChange("weekly_mileage");
    dispatchDataChange("vehicles");
    return {
      ...(modernResult.data as WeeklyMileageEntry),
      driver: "",
      vehicle_reg: normalizeVehicleRegistration((modernResult.data as WeeklyMileageEntry).vehicle_reg),
      mileage: Number(
        (modernResult.data as WeeklyMileageEntry).odometer_reading ??
          (modernResult.data as WeeklyMileageEntry).mileage ??
          0
      )
    } as WeeklyMileageEntry;
  }

  if (!isMissingColumnError(modernResult.error)) {
    logDataError("saveWeeklyMileage error:", modernResult.error, modernPayload);
    throw new Error(
      modernResult.error.message ||
        modernResult.error.details ||
        modernResult.error.hint ||
        "Unable to save weekly mileage."
    );
  }

  const driverName = rest.driver_id
    ? (await fetchDrivers()).find((driver) => String(driver.id) === String(rest.driver_id))?.name ?? ""
    : rest.driver ?? "";

  const legacyPayload = stripUndefined({
    week_ending: rest.week_ending,
    driver: driverName || undefined,
    vehicle_reg: normalizedVehicleReg,
    mileage: normalizedOdometerReading
  });

  const legacyResult = id
    ? await supabase
        .from("weekly_mileage")
        .update(legacyPayload)
        .eq("id", id)
        .select()
        .single()
    : await supabase.from("weekly_mileage").insert(legacyPayload).select().single();

  if (legacyResult.error) {
    logDataError("saveWeeklyMileage error:", legacyResult.error, legacyPayload);
    throw new Error(
      legacyResult.error.message ||
        legacyResult.error.details ||
        legacyResult.error.hint ||
        "Unable to save weekly mileage."
    );
  }

  await ensureVehicleForWeeklyMileage({
    registration: normalizedVehicleReg,
    driverId: rest.driver_id
  });
  dispatchDataChange("weekly_mileage");
  dispatchDataChange("vehicles");
  return {
    ...(legacyResult.data as WeeklyMileageEntry),
    driver: driverName,
    driver_id: rest.driver_id ?? "",
    vehicle_reg: normalizeVehicleRegistration((legacyResult.data as { vehicle_reg?: string }).vehicle_reg ?? normalizedVehicleReg),
    mileage: Number((legacyResult.data as { mileage?: number }).mileage || modernPayload.odometer_reading || 0),
    odometer_reading: Number((legacyResult.data as { mileage?: number }).mileage || modernPayload.odometer_reading || 0),
    user_id: ""
  } as WeeklyMileageEntry;
}

export async function saveShipment(payload: Partial<Shipment>) {
  const { id, ...rest } = payload;
  const shipmentRecord = stripUndefined(rest as Record<string, unknown>);
  const jobReferenceValue =
    typeof shipmentRecord.job_reference === "string" ? shipmentRecord.job_reference.trim() : "";
  const driverIdValue =
    typeof shipmentRecord.driver_id === "string" ? shipmentRecord.driver_id.trim() : "";
  const vehicleIdValue =
    typeof shipmentRecord.vehicle_id === "string" ? shipmentRecord.vehicle_id.trim() : "";
  const driverText = typeof shipmentRecord.driver === "string" ? shipmentRecord.driver.trim() : "";
  const vehicleRegText =
    typeof shipmentRecord.vehicle_reg === "string" ? shipmentRecord.vehicle_reg.trim() : "";
  const notesText =
    typeof shipmentRecord.notes === "string" ? shipmentRecord.notes.trim() : shipmentRecord.notes;
  const driverName = driverIdValue
    ? (await fetchDrivers()).find((driver) => String(driver.id) === driverIdValue)?.name ?? ""
    : driverText;
  const unsupportedDetails = [
    typeof shipmentRecord.customer_name === "string" && shipmentRecord.customer_name.trim()
      ? `Customer: ${shipmentRecord.customer_name.trim()}`
      : "",
    typeof shipmentRecord.goods_description === "string" && shipmentRecord.goods_description.trim()
      ? `Job description: ${shipmentRecord.goods_description.trim()}`
      : "",
    typeof shipmentRecord.pickup_location === "string" && shipmentRecord.pickup_location.trim()
      ? `Pickup: ${shipmentRecord.pickup_location.trim()}`
      : "",
    typeof shipmentRecord.dropoff_location === "string" && shipmentRecord.dropoff_location.trim()
      ? `Main drop-off: ${shipmentRecord.dropoff_location.trim()}`
      : "",
    shipmentRecord.fuel_price_per_litre != null
      ? `Fuel price per litre: ${shipmentRecord.fuel_price_per_litre}`
      : "",
    shipmentRecord.toll_estimate != null ? `Tolls: ${shipmentRecord.toll_estimate}` : "",
    shipmentRecord.driver_cost != null ? `Driver cost: ${shipmentRecord.driver_cost}` : "",
    shipmentRecord.quoted_price != null
      ? `System recommended quote: ${shipmentRecord.quoted_price}`
      : "",
    shipmentRecord.final_price != null ? `Final quote: ${shipmentRecord.final_price}` : "",
    shipmentRecord.status != null ? `Requested status: ${shipmentRecord.status}` : "",
    shipmentRecord.vehicle_type != null ? `Vehicle type: ${shipmentRecord.vehicle_type}` : ""
  ].filter(Boolean);

  const shipmentPayload = stripUndefined(pickLiveShipmentPayload({
    job_reference: jobReferenceValue || undefined,
    shipment_date: shipmentRecord.shipment_date,
    driver: driverName || "Unassigned",
    vehicle_reg: vehicleRegText || null,
    start_location:
      typeof shipmentRecord.start_location === "string"
        ? shipmentRecord.start_location.trim()
        : shipmentRecord.start_location,
    end_location:
      typeof shipmentRecord.end_location === "string"
        ? shipmentRecord.end_location.trim()
        : shipmentRecord.end_location,
    estimated_fuel_cost:
      shipmentRecord.estimated_fuel_cost ??
      shipmentRecord.estimated_fuel_cost_thb,
    notes:
      [notesText, unsupportedDetails.length ? unsupportedDetails.join("\n") : ""]
        .filter(Boolean)
        .join("\n") || null,
    estimated_distance_km: shipmentRecord.estimated_distance_km,
    estimated_fuel_cost_thb: shipmentRecord.estimated_fuel_cost_thb,
    cost_per_km_snapshot_thb: shipmentRecord.cost_per_km_snapshot_thb,
    cost_estimation_status: shipmentRecord.cost_estimation_status,
    cost_estimation_note: shipmentRecord.cost_estimation_note,
    ...(isUuid(driverIdValue) ? { driver_id: driverIdValue } : {}),
    ...(isUuid(vehicleIdValue) ? { vehicle_id: vehicleIdValue } : {})
  }));

  if (jobReferenceValue) {
    const duplicateQuery = await supabase
      .from("shipments")
      .select("*")
      .eq("job_reference", jobReferenceValue)
      .maybeSingle();

    if (duplicateQuery.error) {
      logDataError("saveShipment duplicate check error:", duplicateQuery.error, {
        column: "job_reference",
        value: jobReferenceValue
      });

      throw new Error(
        duplicateQuery.error.message ||
          duplicateQuery.error.details ||
          duplicateQuery.error.hint ||
          "Unable to validate shipment reference."
      );
    }

    const existingShipment = duplicateQuery.data as Shipment | null;
    console.log("Duplicate check result:", existingShipment);

    if (existingShipment && (!id || String(existingShipment.id) !== String(id))) {
      throw new Error("DUPLICATE_SHIPMENT_REFERENCE");
    }
  }

  const { data, error } = await writeShipmentWithSchemaFallback({
    id,
    payload: shipmentPayload
  });

  if (error) {
    logDataError("saveShipment error:", error, shipmentPayload);
    const errorMessage = error.message || error.details || error.hint || "";

    if (
      errorMessage.toLowerCase().includes("row-level security") ||
      errorMessage.toLowerCase().includes("permission denied")
    ) {
      throw new Error("SHIPMENT_PERMISSION_DENIED");
    }

    if (
      errorMessage.toLowerCase().includes("foreign key") &&
      errorMessage.toLowerCase().includes("driver_id")
    ) {
      throw new Error("SHIPMENT_DRIVER_NOT_FOUND");
    }

    if (
      errorMessage.toLowerCase().includes("null value") ||
      errorMessage.toLowerCase().includes("violates not-null constraint")
    ) {
      throw new Error("SHIPMENT_REQUIRED_FIELDS_MISSING");
    }

    if (
      errorMessage.toLowerCase().includes("column") &&
      errorMessage.toLowerCase().includes("does not exist")
    ) {
      throw new Error("SHIPMENT_SCHEMA_MISMATCH");
    }

    throw new Error(errorMessage || "Unable to save shipment.");
  }

  dispatchDataChange("shipments");
  return data as Shipment;
}

export async function deleteShipment(id: string) {
  const { error } = await supabase.from("shipments").delete().eq("id", id);

  if (error) {
    logDataError("deleteShipment error:", error, { id });
    const errorMessage = error.message || error.details || error.hint || "";
    if (
      errorMessage.toLowerCase().includes("row-level security") ||
      errorMessage.toLowerCase().includes("permission denied")
    ) {
      throw new Error("SHIPMENT_PERMISSION_DENIED");
    }

    throw new Error(errorMessage || "Unable to delete shipment.");
  }

  dispatchDataChange("shipments");
}

export async function saveRouteDistanceEstimate(payload: Partial<RouteDistanceEstimate>) {
  const { id, ...rest } = payload;
  const cleaned = stripUndefined(rest);
  const { data, error } = id
    ? await supabase
        .from("route_distance_estimates")
        .update(cleaned)
        .eq("id", id)
        .select()
        .single()
    : await supabase
        .from("route_distance_estimates")
        .insert(cleaned)
        .select()
        .single();

  if (error) {
    logDataError("saveRouteDistanceEstimate error:", error, cleaned);
    throw error;
  }

  dispatchDataChange("route_distance_estimates");
  return data as RouteDistanceEstimate;
}

export async function deleteWeeklyMileage(id: string) {
  const { error } = await supabase.from("weekly_mileage").delete().eq("id", id);

  if (error) {
    logDataError("deleteWeeklyMileage error:", error, { id });
    throw error;
  }

  dispatchDataChange("weekly_mileage");
}

export async function markVehicleOilChanged({
  vehicleId,
  odometer,
  date
}: {
  vehicleId: string;
  odometer: number;
  date?: string;
}) {
  if (!vehicleId) {
    throw new Error("Vehicle record is required.");
  }

  if (!Number.isFinite(Number(odometer))) {
    throw new Error("Current odometer is required before marking oil changed.");
  }

  const serviceDate = date ?? new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("vehicles")
    .update({
      last_oil_change_date: serviceDate,
      last_oil_change_odometer: Math.trunc(Number(odometer))
    })
    .eq("id", vehicleId)
    .select()
    .single();

  if (error) {
    logDataError("markVehicleOilChanged error:", error, { vehicleId, odometer, serviceDate });
    throw new Error(
      error.message ||
        error.details ||
        error.hint ||
        "Unable to mark oil changed."
    );
  }

  dispatchDataChange("vehicles");
  return normalizeVehicleRow(data as Vehicle);
}

export async function createSupportTicket(payload: {
  user_id: string | null;
  user_email: string;
  user_role?: string | null;
  category: string;
  priority: string;
  subject: string;
  description: string;
  page_path?: string | null;
  current_url?: string | null;
  browser_info?: string | null;
  screen_size?: string | null;
  screenshot_url?: string | null;
}) {
  const subject = payload.subject.trim();
  const description = payload.description.trim();
  const category = payload.category.trim();
  const priority = payload.priority.trim();

  if (!category || !priority || !subject || !description) {
    throw new Error("Invalid request: category, priority, subject, and description are required.");
  }

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    logDataError("createSupportTicket auth error:", authError ?? new Error("No authenticated user."), payload);
    throw new Error("Authentication required: please sign in again before submitting a support ticket.");
  }

  const authenticatedUser = authData.user;
  const userId = authenticatedUser.id;
  const userEmail = authenticatedUser.email || payload.user_email.trim();

  if (!userEmail || userEmail === "unknown") {
    throw new Error("Invalid request: authenticated user email is missing.");
  }

  const { data, error } = await supabase
    .from("support_tickets")
    .insert({
      user_id: userId,
      user_email: userEmail,
      user_role: payload.user_role ?? null,
      category,
      priority,
      subject,
      description,
      page_path: payload.page_path ?? null,
      current_url: payload.current_url ?? null,
      browser_info: payload.browser_info ?? null,
      screen_size: payload.screen_size ?? null,
      screenshot_url: payload.screenshot_url ?? null
    })
    .select()
    .single();

  if (error) {
    const serialized = serializeError(error);
    logDataError("createSupportTicket error:", error, { ...payload, user_id: userId, user_email: userEmail });
    throw new Error(
      [
        "Support ticket submission failed.",
        serialized.message,
        serialized.code ? `Code: ${serialized.code}` : "",
        serialized.details ? `Details: ${serialized.details}` : "",
        serialized.hint ? `Hint: ${serialized.hint}` : ""
      ].filter(Boolean).join(" ")
    );
  }

  dispatchDataChange("support_tickets");
  return data as SupportTicket;
}

export async function fetchSupportTickets(filters?: {
  status?: "" | SupportTicketStatus;
  priority?: "" | SupportTicketPriority;
}) {
  let query = supabase
    .from("support_tickets")
    .select("*")
    .order("created_at", { ascending: false });

  if (filters?.status) {
    query = query.eq("status", filters.status);
  }

  if (filters?.priority) {
    query = query.eq("priority", filters.priority);
  }

  const { data, error } = await query;
  if (error) {
    logDataError("fetchSupportTickets error:", error, filters ?? {});
    throw error;
  }

  return (data ?? []) as SupportTicket[];
}

export async function updateSupportTicketStatus(id: string, status: SupportTicketStatus) {
  const { data, error } = await supabase
    .from("support_tickets")
    .update({ status })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    logDataError("updateSupportTicketStatus error:", error, { id, status });
    throw error;
  }

  dispatchDataChange("support_tickets");
  return data as SupportTicket;
}

export async function updateSupportTicketAdminFields(id: string, payload: {
  status?: SupportTicketStatus;
  admin_note?: string | null;
}) {
  const { data: authData, error: authError } = await supabase.auth.getUser();
  const user = authData.user;
  const role = String(user?.user_metadata?.role ?? user?.app_metadata?.role ?? "").toLowerCase();
  const email = String(user?.email ?? "").toLowerCase();

  if (authError || !user) {
    logDataError("updateSupportTicketAdminFields auth error:", authError ?? new Error("No authenticated user."), { id, payload });
    throw new Error("Authentication required: please sign in again before updating support tickets.");
  }

  if (email !== "joeryan09@outlook.com" && role !== "admin") {
    throw new Error("Admin permission required to update support tickets.");
  }

  const updatePayload: Record<string, unknown> = {};
  if (payload.status) updatePayload.status = payload.status;
  if ("admin_note" in payload) updatePayload.admin_note = payload.admin_note;

  const { data, error } = await supabase
    .from("support_tickets")
    .update(updatePayload)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    logDataError("updateSupportTicketAdminFields error:", error, { id, payload });
    const serialized = serializeError(error);
    throw new Error(
      [
        "Support ticket update failed.",
        serialized.message,
        serialized.code ? `Code: ${serialized.code}` : "",
        serialized.details ? `Details: ${serialized.details}` : "",
        serialized.hint ? `Hint: ${serialized.hint}` : ""
      ].filter(Boolean).join(" ")
    );
  }

  dispatchDataChange("support_tickets");
  return data as SupportTicket;
}

export async function deleteSupportTicket(id: string) {
  const { data: authData, error: authError } = await supabase.auth.getUser();
  const user = authData.user;
  const role = String(user?.user_metadata?.role ?? user?.app_metadata?.role ?? "").toLowerCase();
  const email = String(user?.email ?? "").toLowerCase();

  if (authError || !user) {
    logDataError("deleteSupportTicket auth error:", authError ?? new Error("No authenticated user."), { id });
    throw new Error("Authentication required: please sign in again before deleting support tickets.");
  }

  if (email !== "joeryan09@outlook.com" && role !== "admin") {
    throw new Error("Admin permission required to delete support tickets.");
  }

  const { error } = await supabase
    .from("support_tickets")
    .delete()
    .eq("id", id);

  if (error) {
    logDataError("deleteSupportTicket error:", error, { id });
    const serialized = serializeError(error);
    throw new Error(
      [
        "Support ticket delete failed.",
        serialized.message,
        serialized.code ? `Code: ${serialized.code}` : "",
        serialized.details ? `Details: ${serialized.details}` : "",
        serialized.hint ? `Hint: ${serialized.hint}` : ""
      ].filter(Boolean).join(" ")
    );
  }

  dispatchDataChange("support_tickets");
}

export async function fetchSupportTicketNotificationCount(statuses: SupportTicketStatus[] = ["Open", "In Progress"]) {
  const { count, error } = await supabase
    .from("support_tickets")
    .select("id", { count: "exact", head: true })
    .in("status", statuses);

  if (error) {
    logDataError("fetchSupportTicketNotificationCount error:", error, {});
    return 0;
  }

  return count ?? 0;
}

export async function fetchUncheckedFuelLogCount() {
  const { count, error } = await supabase
    .from("fuel_logs")
    .select("id", { count: "exact", head: true })
    .eq("receipt_checked", false);

  if (error) {
    logDataError("fetchUncheckedFuelLogCount error:", error, {});
    return 0;
  }

  return count ?? 0;
}

export async function fetchMissingMileageFuelLogCount() {
  const { count, error } = await supabase
    .from("fuel_logs")
    .select("id", { count: "exact", head: true })
    .or("mileage.is.null,mileage.lte.0");

  if (error) {
    logDataError("fetchMissingMileageFuelLogCount error:", error, {});
    return 0;
  }

  return count ?? 0;
}
