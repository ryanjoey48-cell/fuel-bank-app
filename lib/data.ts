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
import { getOilChangeIntervalForVehicleType } from "@/lib/oil-change-service";
import type {
  BankTransfer,
  BankTransferWithDriver,
  Driver,
  FuelLogDaySummary,
  FuelLogFilters,
  FuelLog,
  FuelLogSortDirection,
  FuelLogSortKey,
  FuelLogWithDriver,
  PaginatedFuelLogsResult,
  RouteDistanceEstimate,
  Shipment,
  ShipmentWithDriver,
  Vehicle,
  VehicleServiceLog,
  WeeklyMileageEntry
} from "@/types/database";

function stripUndefined<T extends Record<string, unknown>>(payload: T) {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined)
  ) as T;
}

const isUuid = (value: unknown) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

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

function isMissingColumnError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const record = error as Record<string, unknown>;
  return (
    record.code === "42703" ||
    String(record.message ?? "").toLowerCase().includes("does not exist")
  );
}

function isMissingTableError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const record = error as Record<string, unknown>;
  const message = String(record.message ?? "").toLowerCase();

  return (
    record.code === "PGRST205" ||
    record.code === "42P01" ||
    message.includes("could not find the table") ||
    message.includes("relation") && message.includes("does not exist")
  );
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

function normalizeServiceLogRow(log: VehicleServiceLog) {
  const odometer = Number(log.odometer ?? log.service_odometer ?? 0);
  return {
    ...log,
    vehicle_id: log.vehicle_id ?? null,
    vehicle_reg: normalizeVehicleRegistration(log.vehicle_reg),
    odometer,
    service_odometer: odometer,
    interval_km:
      log.interval_km != null && Number.isFinite(Number(log.interval_km))
        ? Number(log.interval_km)
        : null,
    vehicle_type_snapshot: log.vehicle_type_snapshot ?? null,
    notes: log.notes ?? null
  };
}

function getServiceSchemaSetupMessage(error: unknown) {
  if (isMissingTableError(error)) {
    return "Oil Change Service Management is not set up in Supabase yet. Apply migration 20260421_add_oil_change_alert_fields.sql, then refresh the page.";
  }

  if (isMissingColumnError(error)) {
    return "Oil Change Service Management database columns are out of date. Apply the latest Supabase migration, then refresh the page.";
  }

  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const message = String(record.message ?? "").toLowerCase();
    if (record.code === "42501" || message.includes("row-level security") || message.includes("permission")) {
      return "Oil Change Service Management is blocked by Supabase permissions. Apply the latest RLS policy migration for vehicles and vehicle_service_logs.";
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

const FUEL_LOG_SELECT_COLUMNS =
  "id, date, driver_id, driver, vehicle_reg, odometer, litres, total_cost, price_per_litre, mileage, location, fuel_type, payment_method, notes, created_at";

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
    station: log.location,
    price_per_litre: log.price_per_litre,
    fuel_type: normalizeFuelTypeKey(log.fuel_type) ?? log.fuel_type,
    payment_method: normalizePaymentMethodKey(log.payment_method) ?? log.payment_method
  })) as FuelLogWithDriver[];
}

function applyFuelLogFilters<TQuery extends { gte: Function; lte: Function; eq: Function; or: Function }>(
  query: TQuery,
  filters: FuelLogFilters = {}
) {
  let nextQuery = query;
  const fromDate = filters.fromDate?.trim();
  const toDate = filters.toDate?.trim();
  const driverId = filters.driverId?.trim();
  const vehicleReg = filters.vehicleReg?.trim();
  const fuelType = filters.fuelType?.trim();
  const paymentMethod = filters.paymentMethod?.trim();
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
  if (fuelType) {
    nextQuery = nextQuery.eq("fuel_type", fuelType);
  }
  if (paymentMethod) {
    nextQuery = nextQuery.eq("payment_method", paymentMethod);
  }
  if (totalCostMin) {
    nextQuery = nextQuery.gte("total_cost", Number(totalCostMin));
  }
  if (totalCostMax) {
    nextQuery = nextQuery.lte("total_cost", Number(totalCostMax));
  }

  const search = filters.search?.trim();
  if (search) {
    const normalizedNumber = Number(search);
    const orParts = [
      `driver.ilike.%${search}%`,
      `vehicle_reg.ilike.%${search}%`,
      `location.ilike.%${search}%`
    ];

    if (Number.isFinite(normalizedNumber)) {
      orParts.push(`total_cost.eq.${normalizedNumber}`, `litres.eq.${normalizedNumber}`);
    }

    nextQuery = nextQuery.or(orParts.join(","));
  }

  return nextQuery;
}

function applyFuelLogOrdering<TQuery extends { order: Function }>(
  query: TQuery,
  sortKey: FuelLogSortKey,
  sortDirection: FuelLogSortDirection
) {
  const ascending = sortDirection === "asc";
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
        console.warn("fetchVehicles optional table unavailable:", serializeError(error));
        return [] as Vehicle[];
      }

      logDataError("fetchVehicles error:", error);
      throw error;
    }

    console.log("fetchVehicles success", { rowCount: (data ?? []).length });

    return ((data ?? []) as Vehicle[]).map(normalizeVehicleRow);
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
        console.warn("fetchVehicleServiceLogs optional table unavailable:", serializeError(error));
        return [] as VehicleServiceLog[];
      }

      logDataError("fetchVehicleServiceLogs error:", error);
      throw error;
    }

    return ((data ?? []) as VehicleServiceLog[]).map(normalizeServiceLogRow);
  });
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
}) {
  console.groupCollapsed("Oil change service save");
  console.log("incoming payload", payload);
  const serviceDate = payload.serviceDate?.trim();
  const serviceOdometer = Math.trunc(Number(payload.serviceOdometer));
  const intervalKm = Math.trunc(
    Number(payload.intervalKm || getOilChangeIntervalForVehicleType(payload.vehicleType) || 30000)
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

    console.log("step", "ensure vehicle", {
      table: "vehicles",
      vehicleId: payload.vehicleId,
      registration: payload.vehicleReg
    });
    const vehicle = await ensureVehicleForService({
      vehicleId: payload.vehicleId,
      registration: payload.vehicleReg,
      vehicleName: payload.vehicleName,
      vehicleType: payload.vehicleType
    });
    const userId = await getCurrentUserId();
    const servicePayload = {
      user_id: userId,
      vehicle_id: vehicle.id,
      vehicle_reg: vehicle.vehicle_reg,
      service_type: "oil_change",
      service_date: serviceDate,
      odometer: serviceOdometer,
      interval_km: intervalKm,
      vehicle_type_snapshot: payload.vehicleType ?? null,
      notes: payload.notes?.trim() || null
    };
    const serviceOperation = payload.updateExistingLog && payload.serviceLogId ? "update" : "insert";
    console.log("step", "write service log", {
      table: "vehicle_service_logs",
      operation: serviceOperation,
      payload: servicePayload,
      serviceLogId: payload.serviceLogId
    });

    let serviceResult =
      serviceOperation === "update"
        ? await supabase
            .from("vehicle_service_logs")
            .update(servicePayload)
            .eq("id", payload.serviceLogId!)
            .select()
            .single()
        : await supabase
            .from("vehicle_service_logs")
            .select("*")
            .eq("vehicle_id", vehicle.id)
            .eq("service_type", "oil_change")
            .eq("service_date", serviceDate)
            .eq("odometer", serviceOdometer)
            .limit(1)
            .maybeSingle();

    if (serviceOperation === "insert" && !serviceResult.error && !serviceResult.data) {
      serviceResult = await supabase
        .from("vehicle_service_logs")
        .insert(servicePayload)
        .select()
        .single();
    }

    if (serviceResult.error) {
      if (serviceOperation === "insert" && (serviceResult.error as { code?: string }).code === "23505") {
        const recovered = await supabase
          .from("vehicle_service_logs")
          .select("*")
          .eq("vehicle_id", vehicle.id)
          .eq("service_type", "oil_change")
          .eq("service_date", serviceDate)
          .eq("odometer", serviceOdometer)
          .limit(1)
          .maybeSingle();

        if (!recovered.error && recovered.data) {
          serviceResult = recovered;
        }
      }
    }

    if (serviceResult.error || !serviceResult.data) {
      logDataError("saveOilChangeService log error:", serviceResult.error, servicePayload);
      throw new Error(getServiceSchemaSetupMessage(serviceResult.error) ?? serviceResult.error?.message ?? "Failed to save service record - try again.");
    }

    const baselinePayload = {
      last_oil_change_date: serviceDate,
      last_oil_change_odometer: serviceOdometer,
      oil_change_interval_km: intervalKm,
      ...(payload.vehicleType ? { vehicle_type: payload.vehicleType } : {})
    };
    console.log("step", "update active baseline", {
      table: "vehicles",
      operation: "update",
      vehicleId: vehicle.id,
      payload: baselinePayload
    });
    const vehicleResult = await supabase
      .from("vehicles")
      .update(baselinePayload)
      .eq("id", vehicle.id)
      .select()
      .single();

    if (vehicleResult.error) {
      logDataError("saveOilChangeService vehicle baseline error:", vehicleResult.error, { vehicleId: vehicle.id });
      throw new Error(getServiceSchemaSetupMessage(vehicleResult.error) ?? vehicleResult.error.message ?? "Service saved, but baseline update failed.");
    }

    dispatchDataChange("vehicle_service_logs");
    console.log("success", {
      vehicle: vehicleResult.data,
      serviceLog: serviceResult.data
    });
    return {
      vehicle: normalizeVehicleRow(vehicleResult.data as Vehicle),
      serviceLog: normalizeServiceLogRow(serviceResult.data as VehicleServiceLog)
    };
  } catch (error) {
    console.error("Oil change service save failed", serializeError(error));
    throw error;
  } finally {
    console.groupEnd();
  }
}

export async function fetchFuelLogs() {
  return readThroughCache("fuel_logs:all", async () => {
    const fuelLogQuery = await supabase
      .from("fuel_logs")
      .select(FUEL_LOG_SELECT_COLUMNS)
      .order("date", { ascending: false })
      .order("id", { ascending: false });

    if (fuelLogQuery.error) {
      logDataError("fetchFuelLogs error:", fuelLogQuery.error);
      throw fuelLogQuery.error;
    }

    console.log("fetchFuelLogs success", { rowCount: (fuelLogQuery.data ?? []).length });

    return mapFuelLogRows(
      (fuelLogQuery.data ?? []) as Parameters<typeof mapFuelLogRows>[0]
    );
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

  const fuelLogQuery = await applyFuelLogOrdering(
    applyFuelLogFilters(
      supabase
        .from("fuel_logs")
        .select(FUEL_LOG_SELECT_COLUMNS, { count: "exact" }),
      filters
    ),
    sortKey,
    sortDirection
  ).range(from, to);

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
    rows: mapFuelLogRows((fuelLogQuery.data ?? []) as Parameters<typeof mapFuelLogRows>[0]),
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
    const fuelLogQuery = await applyFuelLogFilters(
      supabase
        .from("fuel_logs")
        .select(FUEL_LOG_SELECT_COLUMNS)
        .order("date", { ascending: false })
        .order("id", { ascending: false }),
      filters
    ).range(from, to);

    if (fuelLogQuery.error) {
      logDataError("fetchFuelLogsForExport error:", fuelLogQuery.error, {
        filters,
        from,
        to
      });
      throw fuelLogQuery.error;
    }

    const rows = (fuelLogQuery.data ?? []) as Parameters<typeof mapFuelLogRows>[0];
    allRows.push(...rows);

    if (rows.length < batchSize) {
      break;
    }

    from += batchSize;
  }

  return mapFuelLogRows(allRows);
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
  vehicleReg,
  excludeId
}: {
  date: string;
  vehicleReg: string;
  excludeId?: string;
}) {
  let query = supabase
    .from("fuel_logs")
    .select(FUEL_LOG_SELECT_COLUMNS)
    .eq("date", date)
    .ilike("vehicle_reg", vehicleReg.trim())
    .order("id", { ascending: false })
    .limit(10);

  if (excludeId) {
    query = query.neq("id", excludeId);
  }

  const result = await query;
  if (result.error) {
    logDataError("fetchFuelLogDuplicateMatches error:", result.error, { date, vehicleReg, excludeId });
    throw result.error;
  }

  return mapFuelLogRows((result.data ?? []) as Parameters<typeof mapFuelLogRows>[0]);
}

export async function fetchTransfers() {
  const modernQuery = await supabase
    .from("bank_transfers")
    .select(
      "id, date, driver_id, vehicle_reg, amount, transfer_type, notes, fuel_log_id, receipt_status, created_at, user_id"
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
      fuel_log_id?: string | null;
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
      fuel_log_id: transfer.fuel_log_id ?? null,
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
    fuel_log_id: null,
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
    console.log("fetchWeeklyMileage success", { rowCount: (modernQuery.data ?? []).length });
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

  console.log("fetchWeeklyMileage legacy success", { rowCount: (legacyQuery.data ?? []).length });
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
    other_costs: shipment.other_costs ?? 0,
    driver_cost: shipment.driver_cost ?? 0,
    subtotal_cost: shipment.subtotal_cost ?? null,
    final_price: shipment.final_price ?? shipment.quoted_price ?? shipment.subtotal_cost ?? null,
    quoted_price: shipment.quoted_price ?? shipment.final_price ?? shipment.subtotal_cost ?? null,
    status: shipment.status ?? "Draft",
    driver: resolveShipmentDriverName(shipment, driverLookup),
    vehicle_reg: normalizeVehicleRegistration(shipment.vehicle_reg)
  })) as ShipmentWithDriver[];
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
    location: rest.location ?? rest.station,
    fuel_type: normalizeFuelTypeKey(rest.fuel_type) ?? rest.fuel_type,
    payment_method: normalizePaymentMethodKey(rest.payment_method) ?? rest.payment_method,
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
    station: (result.data as { location?: string }).location,
    location: (result.data as { location?: string }).location,
    price_per_litre: (result.data as { price_per_litre?: number | null }).price_per_litre ?? null
  } as FuelLog;
}

export async function deleteFuelLog(id: string) {
  const { error } = await supabase.from("fuel_logs").delete().eq("id", id);

  if (error) {
    logDataError("deleteFuelLog error:", error, { id });
    throw error;
  }

  dispatchDataChange("fuel_logs");
}

export async function saveTransfer(
  payload: Partial<BankTransfer> & { transfer_date?: string }
) {
  const { id, ...rest } = payload;
  const fuelLogs = await fetchFuelLogs();
  const matchedFuelLog =
    rest.fuel_log_id != null
      ? fuelLogs.find((log) => String(log.id) === String(rest.fuel_log_id)) ?? null
      : findTransferFuelLogMatch(fuelLogs, {
          id,
          date: rest.transfer_date ?? rest.date,
          vehicle_reg: rest.vehicle_reg,
          amount: rest.amount
        });
  const matchedFuelAmount = Number(matchedFuelLog?.total_cost || 0);
  const transferAmount = Number(rest.amount || 0);
  const inferredReceiptStatus =
    rest.receipt_status ??
    (matchedFuelLog
      ? transferAmount > 0 && transferAmount >= matchedFuelAmount
        ? "approved"
        : "submitted"
      : "pending");
  const modernPayload = stripUndefined({
    date: rest.transfer_date ?? rest.date,
    driver_id: rest.driver_id,
    vehicle_reg: rest.vehicle_reg,
    amount: rest.amount,
    transfer_type: normalizeTransferTypeKey(rest.transfer_type) ?? rest.transfer_type,
    notes: rest.notes ?? null,
    fuel_log_id: matchedFuelLog?.id ?? rest.fuel_log_id ?? null,
    receipt_status: normalizeTransferReceiptStatus(inferredReceiptStatus)
  });

  const modernResult = id
    ? await supabase.from("bank_transfers").update(modernPayload).eq("id", id).select().single()
    : await supabase.from("bank_transfers").insert(modernPayload).select().single();

  if (!modernResult.error) {
    dispatchDataChange("bank_transfers");
    return {
      ...(modernResult.data as BankTransfer),
      driver: "",
      fuel_log_id:
        (modernResult.data as { fuel_log_id?: string | null }).fuel_log_id ??
        matchedFuelLog?.id ??
        null,
      receipt_status: normalizeTransferReceiptStatus(
        (modernResult.data as { receipt_status?: string | null }).receipt_status ??
          inferredReceiptStatus
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
    fuel_log_id: matchedFuelLog?.id ?? null,
    receipt_status: normalizeTransferReceiptStatus(inferredReceiptStatus)
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
  const normalizedOdometerReading =
    odometerReading != null && Number.isFinite(Number(odometerReading))
      ? Math.trunc(Number(odometerReading))
      : undefined;
  const modernPayload = stripUndefined({
    week_ending: rest.week_ending,
    driver_id: rest.driver_id,
    vehicle_reg: rest.vehicle_reg,
    odometer_reading: normalizedOdometerReading,
    mileage: normalizedOdometerReading
  });

  if (modernPayload.odometer_reading == null) {
    throw new Error("Odometer reading must be a valid number.");
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
    dispatchDataChange("weekly_mileage");
    return {
      ...(modernResult.data as WeeklyMileageEntry),
      driver: "",
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
    vehicle_reg: rest.vehicle_reg,
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

  dispatchDataChange("weekly_mileage");
  return {
    ...(legacyResult.data as WeeklyMileageEntry),
    driver: driverName,
    driver_id: rest.driver_id ?? "",
    mileage: Number((legacyResult.data as { mileage?: number }).mileage || modernPayload.odometer_reading || 0),
    odometer_reading: Number((legacyResult.data as { mileage?: number }).mileage || modernPayload.odometer_reading || 0),
    user_id: ""
  } as WeeklyMileageEntry;
}

export async function saveShipment(payload: Partial<Shipment>) {
  const { id, ...rest } = payload;
  const shipmentRecord = stripUndefined(rest as Record<string, unknown>);
  const shipmentIdValue =
    typeof shipmentRecord.shipment_id === "string" ? shipmentRecord.shipment_id.trim() : "";
  const jobReferenceValue =
    typeof shipmentRecord.job_reference === "string" ? shipmentRecord.job_reference.trim() : "";
  const driverIdValue =
    typeof shipmentRecord.driver_id === "string" ? shipmentRecord.driver_id.trim() : "";
  const vehicleIdValue =
    typeof shipmentRecord.vehicle_id === "string" ? shipmentRecord.vehicle_id.trim() : "";
  const driverText = typeof shipmentRecord.driver === "string" ? shipmentRecord.driver.trim() : "";
  const vehicleText =
    typeof shipmentRecord.vehicle === "string" ? shipmentRecord.vehicle.trim() : "";
  const assignedVehicleText =
    typeof shipmentRecord.assigned_vehicle === "string"
      ? shipmentRecord.assigned_vehicle.trim()
      : "";
  const vehicleRegText =
    typeof shipmentRecord.vehicle_reg === "string" ? shipmentRecord.vehicle_reg.trim() : "";
  const notesText =
    typeof shipmentRecord.notes === "string" ? shipmentRecord.notes.trim() : shipmentRecord.notes;
  const shipmentPayload = stripUndefined({
    shipment_id: shipmentIdValue || undefined,
    job_reference: jobReferenceValue || shipmentIdValue || undefined,
    customer_name:
      typeof shipmentRecord.customer_name === "string"
        ? shipmentRecord.customer_name.trim() || null
        : shipmentRecord.customer_name,
    goods_description:
      typeof shipmentRecord.goods_description === "string"
        ? shipmentRecord.goods_description.trim() || null
        : shipmentRecord.goods_description,
    shipment_date: shipmentRecord.shipment_date,
    driver: driverText || undefined,
    vehicle: vehicleText || assignedVehicleText || vehicleRegText || undefined,
    assigned_vehicle: assignedVehicleText || vehicleText || vehicleRegText || undefined,
    vehicle_reg: vehicleRegText || assignedVehicleText || vehicleText || undefined,
    pickup_location:
      typeof shipmentRecord.pickup_location === "string"
        ? shipmentRecord.pickup_location.trim()
        : shipmentRecord.pickup_location,
    dropoff_location:
      typeof shipmentRecord.dropoff_location === "string"
        ? shipmentRecord.dropoff_location.trim()
        : shipmentRecord.dropoff_location,
    start_location:
      typeof shipmentRecord.start_location === "string"
        ? shipmentRecord.start_location.trim()
        : shipmentRecord.start_location,
    end_location:
      typeof shipmentRecord.end_location === "string"
        ? shipmentRecord.end_location.trim()
        : shipmentRecord.end_location,
    standard_km_per_litre: shipmentRecord.standard_km_per_litre,
    estimated_fuel_litres: shipmentRecord.estimated_fuel_litres,
    fuel_price_per_litre:
      shipmentRecord.fuel_price_per_litre ?? shipmentRecord.diesel_price,
    diesel_price:
      shipmentRecord.diesel_price ?? shipmentRecord.fuel_price_per_litre,
    estimated_fuel_cost:
      shipmentRecord.estimated_fuel_cost ??
      shipmentRecord.fuel_cost ??
      shipmentRecord.estimated_fuel_cost_thb,
    fuel_cost:
      shipmentRecord.fuel_cost ??
      shipmentRecord.estimated_fuel_cost ??
      shipmentRecord.estimated_fuel_cost_thb,
    toll_estimate: shipmentRecord.toll_estimate ?? shipmentRecord.toll_cost,
    toll_cost: shipmentRecord.toll_cost ?? shipmentRecord.toll_estimate,
    other_costs: shipmentRecord.other_costs,
    driver_cost: shipmentRecord.driver_cost,
    subtotal_cost: shipmentRecord.subtotal_cost,
    final_price: shipmentRecord.final_price ?? shipmentRecord.quoted_price,
    quoted_price: shipmentRecord.quoted_price ?? shipmentRecord.final_price,
    status: shipmentRecord.status,
    notes: notesText || null,
    estimated_distance_km: shipmentRecord.estimated_distance_km,
    estimated_fuel_cost_thb: shipmentRecord.estimated_fuel_cost_thb,
    cost_per_km_snapshot_thb: shipmentRecord.cost_per_km_snapshot_thb,
    cost_estimation_status: shipmentRecord.cost_estimation_status,
    cost_estimation_note: shipmentRecord.cost_estimation_note,
    company_id: shipmentRecord.company_id,
    ...(isUuid(driverIdValue) ? { driver_id: driverIdValue } : {}),
    ...(isUuid(vehicleIdValue) ? { vehicle_id: vehicleIdValue } : {})
  });

  if (shipmentIdValue) {
    const duplicateQuery = await supabase
      .from("shipments")
      .select("*")
      .eq("shipment_id", shipmentIdValue)
      .maybeSingle();

    if (duplicateQuery.error) {
      logDataError("saveShipment duplicate check error:", duplicateQuery.error, {
        column: "shipment_id",
        value: shipmentIdValue
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
  } else if (jobReferenceValue) {
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

  console.log("Shipment insert payload:", shipmentPayload);

  const { data, error } = id
    ? await supabase.from("shipments").update(shipmentPayload).eq("id", id).select().single()
    : await supabase.from("shipments").insert(shipmentPayload).select().single();

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
