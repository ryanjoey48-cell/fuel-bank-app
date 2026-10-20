import type { OilChangeAlertRow } from "./operations";
import type { MaintenanceData, MaintenanceRecord } from "./maintenance-types";
import {
  buildServiceSchedule,
  qualifiesForService,
  scheduleEvents,
  SERVICE_CATALOG,
  type ScheduleStatus,
  type ServiceBaseline,
} from "./preventative-maintenance";
import { latestVehicleChecks, type VehicleMaintenanceCheck, type VehicleCheckResult } from "./maintenance-office";
import { maintenanceDriver, maintenanceToday } from "./maintenance";

export type MaintenanceComponentCategory = "engine" | "cooling" | "brakes" | "electrical" | "mechanical" | "custom";

export type MaintenanceComponentDefinition = {
  key: string;
  nameEn: string;
  nameTh: string;
  category: MaintenanceComponentCategory;
};

export type FleetComponentRow = {
  vehicleId: string;
  registration: string;
  driver: string;
  vehicleType: string;
  componentKey: string;
  packageScheduled: boolean;
  latestInspection: VehicleMaintenanceCheck | null;
  inspectionResult: VehicleCheckResult;
  lastReplacement: ServiceBaseline | null;
  replacementRecord: MaintenanceRecord | null;
  scheduleStatus: ScheduleStatus;
  dueDate: string | null;
  dueKm: number | null;
  issueNotes: string | null;
};

const COOLING_KEYS = new Set(["coolant", "engine_coolant", "radiator"]);
const ENGINE_KEYS = new Set(["engine_oil", "oil_filter", "air_filter", "fuel_filter", "coolant", "engine_coolant", "transmission_oil_filter"]);
const BRAKE_KEYS = new Set(["tyres", "tire", "tires", "brake_pads", "brake_discs", "brake_fluid", "brake_linings", "brake_drums", "wheel_bearings", "wheels"]);
const ELECTRICAL_KEYS = new Set(["battery", "alternator", "lights", "lighting", "charging_system", "starter_motor", "spark_plugs"]);

export function maintenanceComponentCategory(key: string, custom = false): MaintenanceComponentCategory {
  if (custom || key.startsWith("custom:")) return "custom";
  if (COOLING_KEYS.has(key)) return "cooling";
  if (ENGINE_KEYS.has(key)) return "engine";
  if (BRAKE_KEYS.has(key)) return "brakes";
  if (ELECTRICAL_KEYS.has(key)) return "electrical";
  return "mechanical";
}

export function maintenanceComponentCatalogue(data: MaintenanceData, checks: VehicleMaintenanceCheck[]): MaintenanceComponentDefinition[] {
  const definitions = new Map<string, MaintenanceComponentDefinition>();
  for (const [key, nameEn, nameTh] of SERVICE_CATALOG) {
    definitions.set(key, { key, nameEn, nameTh, category: maintenanceComponentCategory(key) });
  }
  for (const requirement of data.requirements) {
    if (!requirement.service_key || definitions.has(requirement.service_key)) continue;
    definitions.set(requirement.service_key, {
      key: requirement.service_key,
      nameEn: requirement.name,
      nameTh: requirement.name,
      category: maintenanceComponentCategory(requirement.service_key, requirement.service_key.startsWith("custom:")),
    });
  }
  for (const check of checks) {
    if (definitions.has(check.service_key)) continue;
    definitions.set(check.service_key, {
      key: check.service_key,
      nameEn: check.item_name,
      nameTh: check.item_name,
      category: maintenanceComponentCategory(check.service_key, check.service_key.startsWith("custom:")),
    });
  }
  return [...definitions.values()].sort((a, b) => a.category.localeCompare(b.category) || a.nameEn.localeCompare(b.nameEn));
}

export function buildFleetComponentRows(
  data: MaintenanceData,
  checks: VehicleMaintenanceCheck[],
  oilRows: OilChangeAlertRow[],
  componentKey: string,
  today = maintenanceToday(),
): FleetComponentRow[] {
  const checksByVehicle = new Map(data.vehicles.map(vehicle => [vehicle.id, latestVehicleChecks(checks, vehicle.id, today)]));
  return data.vehicles.filter(vehicle => vehicle.active !== false).map(vehicle => {
    const oil = oilRows.find(row => row.vehicleId === vehicle.id);
    const packageMember=["engine_oil","oil_filter","fuel_filter"].includes(componentKey);
    const oilBaseline: ServiceBaseline | null = componentKey === "engine_oil" && oil?.lastOilChangeDate
      ? { date: oil.lastOilChangeDate, odometer: oil.lastOilChangeOdometer, recordId: null, itemId: null }
      : null;
    const schedule = buildServiceSchedule({ ...data, checks }, vehicle.id, oilBaseline, today)
      .find(result => result.schedule.service_key === componentKey && result.schedule.schedule_kind === "replacement");
    const replacementEvent = scheduleEvents(data, vehicle.id, componentKey, today)
      .find(event => qualifiesForService(componentKey, event.item.service_action, "replacement"));
    const structuredBaseline: ServiceBaseline | null = replacementEvent ? {
      date: replacementEvent.record.service_date,
      odometer: replacementEvent.record.odometer,
      recordId: replacementEvent.record.id,
      itemId: replacementEvent.item.id,
    } : null;
    const lastReplacement = oilBaseline && (!structuredBaseline || oilBaseline.date > structuredBaseline.date)
      ? oilBaseline
      : structuredBaseline;
    const latestInspection = checksByVehicle.get(vehicle.id)?.get(componentKey) ?? null;
    const explicitNotApplicable = schedule?.status === "notApplicable";
    return {
      vehicleId: vehicle.id,
      registration: vehicle.vehicle_reg,
      driver: maintenanceDriver(data, vehicle.id),
      vehicleType: String(vehicle.vehicle_type ?? ""),
      componentKey,
      packageScheduled: ["engine_oil","oil_filter","fuel_filter"].includes(componentKey),
      latestInspection,
      inspectionResult: latestInspection?.result ?? "not_checked",
      lastReplacement,
      replacementRecord: lastReplacement === structuredBaseline ? replacementEvent?.record ?? null : null,
      scheduleStatus: explicitNotApplicable ? "notApplicable" : packageMember && oil
        ? (oil.status === "overdue" ? "overdue" : oil.status === "urgent" ? "urgent" : oil.status === "due_soon" ? "dueSoon" : oil.status === "ok" ? "ok" : oil.status === "not_set" ? "notConfigured" : "unknown")
        : schedule?.status ?? "notConfigured",
      dueDate: schedule?.dueDate ?? null,
      dueKm: packageMember&&oil?oil.nextOilChangeDueOdometer:schedule?.dueKm ?? null,
      issueNotes: latestInspection?.result === "attention" ? latestInspection.notes : null,
    };
  }).sort((a, b) => a.registration.localeCompare(b.registration, undefined, { numeric: true }));
}
