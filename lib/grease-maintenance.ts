import type { Driver, GreaseMaintenanceItem, GreaseMaintenanceRecord, Vehicle } from "@/types/database";

export type GreaseStatus = "ok" | "dueSoon" | "overdue" | "noRecord";

export function greaseToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function isGreaseDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < "1900-01-01") return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function greaseNextDue(serviceDate: string) {
  if (!isGreaseDate(serviceDate)) return null;
  const [year, month, day] = serviceDate.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year + 1, month, 0)).getUTCDate();
  return `${year + 1}-${String(month).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

export function greaseStatus(serviceDate: string | null, today = greaseToday()): { status: GreaseStatus; dueDate: string | null; days: number | null } {
  const dueDate = serviceDate && serviceDate <= today ? greaseNextDue(serviceDate) : null;
  if (!dueDate) return { status: "noRecord", dueDate: null, days: null };
  const days = Math.round((Date.parse(`${dueDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
  return { status: days < 0 ? "overdue" : days <= 30 ? "dueSoon" : "ok", dueDate, days };
}

export function greaseItemTotal(item: GreaseMaintenanceItem) {
  // Integer hundredths avoid binary floating-point errors on half-cent rounding.
  return Math.round(Math.round((item.quantity ?? 1) * 100) * Math.round((item.unit_cost ?? 0) * 100) / 100) / 100;
}

export function greaseTotal(items: GreaseMaintenanceItem[]) {
  return items.reduce((cents, item) => cents + Math.round(greaseItemTotal(item) * 100), 0) / 100;
}

export function buildGreaseRows(vehicles: Vehicle[], drivers: Driver[], records: GreaseMaintenanceRecord[], today = greaseToday()) {
  const latest = new Map<string, GreaseMaintenanceRecord>();
  for (const record of records) {
    if (record.is_void || !isGreaseDate(record.service_date) || record.service_date > today) continue;
    const previous = latest.get(record.vehicle_id);
    const key = `${record.service_date}|${record.created_at}|${record.id}`;
    if (!previous || key > `${previous.service_date}|${previous.created_at}|${previous.id}`) latest.set(record.vehicle_id, record);
  }
  return vehicles.map(vehicle => {
    const record = latest.get(vehicle.id) ?? null;
    const assigned = drivers.filter(driver => driver.active !== false && driver.assigned_vehicle_id === vehicle.id);
    return { vehicle, driver: assigned.map(driver => driver.name).join(", "), latest: record, ...greaseStatus(record?.service_date ?? null, today) };
  });
}
