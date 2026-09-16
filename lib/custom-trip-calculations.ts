import type { FuelEfficiencyTripCalculationWithLogs, FuelLogWithDriver } from "@/types/database";

export type CustomTripCalculationSnapshot = {
  calculationId: string | null;
  driverId: string | null;
  driver: string;
  vehicleReg: string;
  startLog: FuelLogWithDriver;
  endLog: FuelLogWithDriver;
  selectedLogs: FuelLogWithDriver[];
  excludedLogs: FuelLogWithDriver[];
  startMileage: number;
  endMileage: number;
  distanceKm: number;
  totalLitres: number;
  totalFuelCost: number;
  kmPerLitre: number;
  notes: string;
};

export function getFuelLogMileage(log: Pick<FuelLogWithDriver, "mileage" | "odometer">) {
  const value = Number(log.mileage ?? log.odometer);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function calculateCustomTripSnapshot(input: {
  calculationId?: string | null;
  driverId?: string | null;
  driver?: string;
  vehicleReg?: string;
  startLog: FuelLogWithDriver | null;
  endLog: FuelLogWithDriver | null;
  selectedLogs: FuelLogWithDriver[];
  excludedLogs?: FuelLogWithDriver[];
  notes?: string;
}): CustomTripCalculationSnapshot | null {
  if (!input.startLog || !input.endLog || input.selectedLogs.length === 0) return null;
  const startMileage = getFuelLogMileage(input.startLog);
  const endMileage = getFuelLogMileage(input.endLog);
  if (startMileage == null || endMileage == null || endMileage <= startMileage || input.endLog.date < input.startLog.date) return null;
  const totalLitres = input.selectedLogs.reduce((sum, log) => sum + Math.max(0, Number(log.litres) || 0), 0);
  if (totalLitres <= 0) return null;
  const distanceKm = endMileage - startMileage;
  return {
    calculationId: input.calculationId ?? null,
    driverId: input.driverId ?? null,
    driver: input.driver ?? input.startLog.driver ?? "",
    vehicleReg: input.vehicleReg ?? input.startLog.vehicle_reg ?? "",
    startLog: input.startLog,
    endLog: input.endLog,
    selectedLogs: input.selectedLogs,
    excludedLogs: input.excludedLogs ?? [],
    startMileage,
    endMileage,
    distanceKm,
    totalLitres,
    totalFuelCost: input.selectedLogs.reduce((sum, log) => sum + Math.max(0, Number(log.total_cost) || 0), 0),
    kmPerLitre: distanceKm / totalLitres,
    notes: input.notes?.trim() ?? ""
  };
}

export function getActiveFuelAllocationConflicts(
  fuelLogIds: Iterable<string>,
  calculations: FuelEfficiencyTripCalculationWithLogs[],
  currentCalculationId?: string | null
) {
  const selected = new Set(Array.from(fuelLogIds, String));
  const conflicts = new Map<string, FuelEfficiencyTripCalculationWithLogs[]>();
  for (const calculation of calculations) {
    if (calculation.status !== "active" || calculation.id === currentCalculationId) continue;
    for (const allocation of calculation.allocations) {
      if (allocation.allocation_status !== "included" || !selected.has(allocation.fuel_log_id)) continue;
      const rows = conflicts.get(allocation.fuel_log_id) ?? [];
      rows.push(calculation);
      conflicts.set(allocation.fuel_log_id, rows);
    }
  }
  return conflicts;
}
