import { buildMaintenanceReminders, maintenanceAnalytics, maintenanceLineTotal, maintenanceToday } from "./maintenance";
import type { MaintenanceCategory, MaintenanceData, MaintenanceItemInput } from "./maintenance-types";

const normalise = (value: string) => value.normalize("NFKC").trim().toLocaleLowerCase().replace(/[.,/\\()\-_]+/g, " ").replace(/\s+/g, " ").trim();
export function duplicateMaintenanceItem<T extends MaintenanceItemInput>(item: T, id: string): T {
  // A copied price/category must never carry another line's receipt wording or notes.
  return { ...item, id, notes: null, description_th: null };
}

export type RepeatedRepair = { vehicleId: string; name: string; category: MaintenanceCategory; visits: number; first: string; last: string; total: number; categoryFallback: boolean };
/** Informational only: three distinct visit dates in the trailing nine calendar months.
 * Routine consumables/inspections/labour are excluded; category fallback needs four dates.
 * Multiple lines on one receipt or multiple receipts on one day do not inflate counts.
 */
export function repeatedMaintenanceRepairs(data: MaintenanceData, today = maintenanceToday()): RepeatedRepair[] {
  const [year, month, day] = today.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 10, 1));
  date.setUTCDate(Math.min(day, new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()));
  const start = date.toISOString().slice(0, 10);
  const records = new Map(data.records.filter(r => !r.is_deleted && r.service_date >= start && r.service_date <= today).map(r => [r.id, r]));
  const repairs = new Set<MaintenanceCategory>(["brakes", "battery", "engine", "transmission", "suspension", "steering", "electrical"]);
  const groups = new Map<string, { vehicleId: string; name: string; category: MaintenanceCategory; dates: Set<string>; cents: number; fallback: boolean }>();
  for (const item of data.items) {
    const record = records.get(item.record_id);
    if (!record || !repairs.has(item.category)) continue;
    for (const fallback of [false, true]) {
      const key = JSON.stringify([record.vehicle_id, item.category, fallback ? "category" : normalise(item.description)]);
      const group = groups.get(key) ?? { vehicleId: record.vehicle_id, name: item.description, category: item.category, dates: new Set<string>(), cents: 0, fallback };
      group.dates.add(record.service_date); group.cents += Math.round(maintenanceLineTotal(item) * 100); groups.set(key, group);
    }
  }
  const exact = [...groups.values()].filter(g => !g.fallback && g.dates.size >= 3);
  return [...exact, ...[...groups.values()].filter(g => g.fallback && g.dates.size >= 4 && !exact.some(e => e.vehicleId === g.vehicleId && e.category === g.category))]
    .map(g => { const dates = [...g.dates].sort(); return { vehicleId: g.vehicleId, name: g.name, category: g.category, visits: dates.length, first: dates[0], last: dates[dates.length - 1], total: g.cents / 100, categoryFallback: g.fallback }; })
    .sort((a, b) => b.visits - a.visits || b.last.localeCompare(a.last));
}

/** Shared reporting projection; consumes the loaded snapshot, never makes extra requests. */
export function maintenanceCostIntelligence(data: MaintenanceData, vehicleIds: string[], start: string, end: string, today = maintenanceToday()) {
  const ids = new Set(vehicleIds), records = data.records.filter(r => !r.is_deleted && ids.has(r.vehicle_id) && r.service_date >= start && r.service_date <= end);
  const recordIds = new Set(records.map(r => r.id));
  const aggregate = new Map<string, { name: string; total: number; visits: Set<string> }>();
  const categories = new Map<string, { name: string; total: number; visits: Set<string> }>();
  const garages = new Map<string, { name: string; total: number; visits: Set<string> }>();
  const add = (map: typeof aggregate, key: string, name: string, cents: number, id: string) => {
    const row = map.get(key) ?? { name, total: 0, visits: new Set<string>() }; row.total += cents; row.visits.add(id); map.set(key, row);
  };
  for (const item of data.items.filter(i => recordIds.has(i.record_id))) {
    const cents = Math.round(maintenanceLineTotal(item) * 100);
    add(aggregate, JSON.stringify([item.category, normalise(item.description)]), item.description, cents, item.record_id);
    add(categories, item.category, item.category, cents, item.record_id);
  }
  for (const record of records) add(garages, normalise(record.garage ?? ""), record.garage ?? "", Math.round(Number(record.calculated_total) * 100), record.id);
  const finish = (map: typeof aggregate) => [...map.values()].map(r => ({ name: r.name, total: r.total / 100, visits: r.visits.size })).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  const repeats = repeatedMaintenanceRepairs(data, today).filter(r => ids.has(r.vehicleId));
  const reminders = buildMaintenanceReminders(data, today);
  const vehicles = vehicleIds.map(vehicleId => {
    const stats = maintenanceAnalytics(data, vehicleId, start, end, today, reminders);
    const own = records.filter(r => r.vehicle_id === vehicleId);
    return { vehicleId, ...stats, outstandingStatus: reminders.filter(r=>r.vehicle_id===vehicleId && (r.status!=="ok"||r.mileage_unavailable)), average: stats.visits ? stats.total / stats.visits : null, maintenancePer10000Km: stats.maintenancePerKm === null ? null : stats.maintenancePerKm * 10000, lastMaintenance: own.map(r => r.service_date).sort().at(-1) ?? null, repeatedRepairs: repeats.filter(r => r.vehicleId === vehicleId).length };
  }).sort((a, b) => b.total - a.total);
  const total = records.reduce((sum, r) => sum + Math.round(Number(r.calculated_total) * 100), 0) / 100;
  const current = data.records.filter(r => !r.is_deleted && ids.has(r.vehicle_id) && r.service_date <= today);
  const sum = (prefix: string) => current.filter(r => r.service_date.startsWith(prefix)).reduce((sum, r) => sum + Math.round(Number(r.calculated_total) * 100), 0) / 100;
  const date=new Date(`${today}T00:00:00Z`);date.setUTCMonth(date.getUTCMonth()-1);const previousPrefix=date.toISOString().slice(0,7),month=sum(today.slice(0,7)),previousMonth=sum(previousPrefix);
  return { total, average: records.length ? total / records.length : null, month, previousMonth, monthChange: previousMonth>0?(month-previousMonth)/previousMonth*100:null, year: sum(today.slice(0,4)), vehicles, categories: finish(categories), items: finish(aggregate).sort((a, b) => b.visits - a.visits || b.total - a.total), garages: finish(garages), repeats };
}
