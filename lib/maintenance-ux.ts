import { buildMaintenanceReminders, maintenanceAnalytics, maintenanceToday, reliableMaintenanceMileage } from "./maintenance";
import type { MaintenanceData, MaintenanceRecord } from "./maintenance-types";

export type MaintenanceHistorySort = "newestFirst" | "oldestFirst" | "highestCost" | "vehicleRegistration";
export function maintenanceHistorySummary(records: MaintenanceRecord[]) {
  const total = records.reduce((sum, record) => sum + Math.round(Number(record.calculated_total) * 100), 0) / 100;
  return { records: records.length, vehicles: new Set(records.map(record => record.vehicle_id)).size, total, average: records.length ? total / records.length : null };
}
export function sortMaintenanceHistory(records: MaintenanceRecord[], data: MaintenanceData, sort: MaintenanceHistorySort) {
  const registration = new Map(data.vehicles.map(vehicle => [vehicle.id, vehicle.vehicle_reg]));
  const newest = (a: MaintenanceRecord, b: MaintenanceRecord) => b.service_date.localeCompare(a.service_date) || b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id);
  return [...records].sort((a, b) => sort === "oldestFirst" ? -newest(a, b) : sort === "highestCost" ? Number(b.calculated_total) - Number(a.calculated_total) || newest(a, b) : sort === "vehicleRegistration" ? (registration.get(a.vehicle_id) ?? "").localeCompare(registration.get(b.vehicle_id) ?? "", undefined, { numeric: true }) || newest(a, b) : newest(a, b));
}

export function maintenanceDateRange(preset: "thisYear" | "last12Months" | "allTime", today = maintenanceToday()) {
  if (preset === "allTime") return { start: "1900-01-01", end: today };
  if (preset === "thisYear") return { start: `${today.slice(0, 4)}-01-01`, end: today };
  const [year, month, day] = today.split("-").map(Number);
  const start = new Date(Date.UTC(year - 1, month - 1, 1));
  start.setUTCDate(Math.min(day, new Date(Date.UTC(year - 1, month, 0)).getUTCDate()));
  return { start: start.toISOString().slice(0, 10), end: today };
}

export type MaintenanceDataIssue = "missingStart" | "missingEnd" | "odometerConflict" | "mileageGap" | "noDistance" | "noFuelHistory" | "noMaintenanceHistory";
export function maintenanceDataIssues(data: MaintenanceData, vehicleId: string, start: string, end: string): MaintenanceDataIssue[] {
  const issues: MaintenanceDataIssue[] = [];
  const rows = reliableMaintenanceMileage(data.mileage, vehicleId, end).dated.filter(row => row.date >= start && row.date <= end);
  if (!rows.some(row => row.date === start)) issues.push("missingStart");
  if (!rows.some(row => row.date === end)) issues.push("missingEnd");
  if (rows.some((row, i) => !row.valid || i > 0 && (row.baseline || row.value < rows[i - 1].value))) issues.push("odometerConflict");
  if (rows.some((row, i) => i > 0 && (Date.parse(row.date) - Date.parse(rows[i - 1].date)) / 86400000 > 8)) issues.push("mileageGap");
  if (!issues.length && (rows.length < 2 || rows[rows.length - 1].value <= rows[0].value)) issues.push("noDistance");
  if (!data.fuel.some(row => row.vehicle_id === vehicleId && row.date >= start && row.date <= end)) issues.push("noFuelHistory");
  if (!data.records.some(row => !row.is_deleted && row.vehicle_id === vehicleId && row.service_date >= start && row.service_date <= end)) issues.push("noMaintenanceHistory");
  return issues;
}

export function maintenanceFleetSummary(data: MaintenanceData, vehicleIds: string[], start: string, end: string, today = maintenanceToday()) {
  const ids = new Set(vehicleIds);
  const rows = vehicleIds.map(id => ({ id, ...maintenanceAnalytics(data, id, start, end, today) }));
  const reminders = buildMaintenanceReminders(data, today).filter(row => ids.has(row.vehicle_id));
  const highest = rows.filter(row => row.visits > 0).sort((a, b) => b.total - a.total || a.id.localeCompare(b.id))[0];
  return {
    total: rows.reduce((sum, row) => sum + Math.round(row.total * 100), 0) / 100,
    serviced: rows.filter(row => row.visits > 0).length,
    records: rows.reduce((sum, row) => sum + row.visits, 0),
    overdue: reminders.filter(row => row.status === "overdue" || row.status === "mileageDue").length,
    due30: reminders.filter(row => row.days !== null && row.days >= 0 && row.days <= 30 && row.status !== "overdue" && row.status !== "mileageDue").length,
    highest: highest ? { vehicleId: highest.id, total: highest.total } : null
  };
}

export function maintenanceVehicleType(value: string | null | undefined, labels: Record<string,string>) { return value ? labels[value] ?? value : "—"; }

export const maintenanceCategoryTone: Record<string, string> = {
  engine: "border-orange-200 bg-orange-50 text-orange-800", oil: "border-amber-200 bg-amber-50 text-amber-800",
  brakes: "border-rose-200 bg-rose-50 text-rose-800", steering: "border-blue-200 bg-blue-50 text-blue-800",
  electrical: "border-cyan-200 bg-cyan-50 text-cyan-800", transmission: "border-violet-200 bg-violet-50 text-violet-800",
  grease: "border-emerald-200 bg-emerald-50 text-emerald-800", tyres: "border-sky-200 bg-sky-50 text-sky-800",
  battery: "border-yellow-200 bg-yellow-50 text-yellow-800", suspension: "border-indigo-200 bg-indigo-50 text-indigo-800",
  inspection: "border-teal-200 bg-teal-50 text-teal-800", labour: "border-slate-200 bg-slate-100 text-slate-700",
  other: "border-slate-200 bg-slate-50 text-slate-700"
};

export function maintenanceHighCostThreshold(records: MaintenanceRecord[]) {
  const totals = records.filter(r => !r.is_deleted).map(r => Number(r.calculated_total)).filter(Number.isFinite).sort((a,b) => a-b);
  if (totals.length < 3) return null;
  const index = Math.ceil(totals.length * .75) - 1;
  return totals[Math.max(0, index)];
}

export function nearestMaintenanceMileage(data: MaintenanceData, vehicleId: string, serviceDate: string) {
  const rows = data.mileage.filter(row => row.vehicle_id === vehicleId).map(row => ({date: row.week_ending, value: Number(row.odometer_reading ?? row.mileage)})).filter(row => /^\d{4}-\d{2}-\d{2}$/.test(row.date) && Number.isFinite(row.value) && row.value >= 0).map(row => ({...row, distance: Math.abs((Date.parse(`${row.date}T00:00:00Z`) - Date.parse(`${serviceDate}T00:00:00Z`)) / 86400000)})).filter(row => row.distance <= 14).sort((a,b) => a.distance-b.distance || b.date.localeCompare(a.date));
  return rows[0] ?? null;
}
