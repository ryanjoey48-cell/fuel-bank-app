import type { DriverVehicleType } from "@/types/database";

export type OilChangeIntervalSource = "service_record" | "vehicle_baseline" | "vehicle_type" | "missing";

export const OIL_CHANGE_INTERVAL_BY_VEHICLE_TYPE: Record<DriverVehicleType, number> = {
  EIGHTEEN_WHEELER: 30000,
  SIX_WHEEL_TRUCK: 30000,
  SIX_PLUS_SIX_WHEELER: 30000,
  FOUR_WHEEL_TRUCK: 8000
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

  return vehicleType === "FOUR_WHEEL_TRUCK" ? 8000 : 30000;
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
