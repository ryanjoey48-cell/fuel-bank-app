import oilChangeIntervals from "@/lib/oil-change-intervals.json";
import type { DriverVehicleType } from "@/types/database";

export type OilChangeIntervalSource = "service_record" | "vehicle_baseline" | "vehicle_type" | "missing";

export const OIL_CHANGE_INTERVAL_BY_VEHICLE_TYPE: Record<DriverVehicleType, number> = {
  EIGHTEEN_WHEELER: oilChangeIntervals.EIGHTEEN_WHEELER,
  SIX_WHEEL_TRUCK: oilChangeIntervals.SIX_WHEEL_TRUCK,
  SIX_PLUS_SIX_WHEELER: oilChangeIntervals.SIX_PLUS_SIX_WHEELER,
  FOUR_WHEEL_TRUCK: oilChangeIntervals.FOUR_WHEEL_TRUCK
};

export const VEHICLE_TYPE_LABELS: Record<DriverVehicleType, string> = {
  EIGHTEEN_WHEELER: "18 wheeler",
  SIX_WHEEL_TRUCK: "6 wheeler",
  SIX_PLUS_SIX_WHEELER: "6 + 6 wheeler",
  FOUR_WHEEL_TRUCK: "4 wheeler"
};

export function getOilChangeIntervalForVehicleType(vehicleType: string | null | undefined) {
  if (!vehicleType) {
    return null;
  }

  return OIL_CHANGE_INTERVAL_BY_VEHICLE_TYPE[vehicleType as DriverVehicleType] ?? null;
}

export function getVehicleTypeLabel(vehicleType: string | null | undefined) {
  if (!vehicleType) {
    return "Missing vehicle type";
  }

  return VEHICLE_TYPE_LABELS[vehicleType as DriverVehicleType] ?? vehicleType;
}

export function normalizeVehicleRegForMatch(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[–—−]/g, "-")
    .replace(/^[^\dA-Zก-ฮ]+/, "");
}
