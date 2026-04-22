import type { DriverVehicleType } from "@/types/database";

export const DRIVER_VEHICLE_TYPE_OPTIONS: Array<{
  value: DriverVehicleType;
  label: string;
}> = [
  { value: "EIGHTEEN_WHEELER", label: "18 Wheeler" },
  { value: "SIX_PLUS_SIX_WHEELER", label: "6 + 6 Wheeler" },
  { value: "SIX_WHEEL_TRUCK", label: "6 Wheel Truck" },
  { value: "FOUR_WHEEL_TRUCK", label: "4 Wheel Truck" }
];

const DRIVER_VEHICLE_TYPE_KM_PER_LITRE: Record<DriverVehicleType, number> = {
  EIGHTEEN_WHEELER: 3.5,
  SIX_PLUS_SIX_WHEELER: 4.5,
  SIX_WHEEL_TRUCK: 5.5,
  FOUR_WHEEL_TRUCK: 10
};

export function getLogisticsVehicleTypeLabel(vehicleType: string | null | undefined) {
  return DRIVER_VEHICLE_TYPE_OPTIONS.find((option) => option.value === vehicleType)?.label ?? "";
}

export function getDriverVehicleTypeLabel(vehicleType: DriverVehicleType | null | undefined) {
  return getLogisticsVehicleTypeLabel(vehicleType);
}

export function getKmPerLitre(vehicleType: DriverVehicleType | null | undefined) {
  return vehicleType ? DRIVER_VEHICLE_TYPE_KM_PER_LITRE[vehicleType] ?? null : null;
}

export function suggestVehicleType({
  weightKg,
  pallets
}: {
  weightKg: number | null;
  pallets: number | null;
}) {
  if (weightKg == null && pallets == null) {
    return null;
  }

  if ((weightKg ?? 0) <= 3500 && (pallets ?? 0) <= 4) {
    return "FOUR_WHEEL_TRUCK" satisfies DriverVehicleType;
  }

  if ((weightKg ?? 0) <= 7000 && (pallets ?? 0) <= 10) {
    return "SIX_WHEEL_TRUCK" satisfies DriverVehicleType;
  }

  if ((weightKg ?? 0) <= 15000 && (pallets ?? 0) <= 20) {
    return "SIX_PLUS_SIX_WHEELER" satisfies DriverVehicleType;
  }

  return "EIGHTEEN_WHEELER" satisfies DriverVehicleType;
}
