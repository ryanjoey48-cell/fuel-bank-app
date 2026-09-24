import { maintenanceToday, validMaintenanceDate } from "./maintenance";
import { MAINTENANCE_CATEGORIES, type MaintenanceCategory } from "./maintenance-types";

export const MAINTENANCE_IMPORT_COLUMNS = [
  "vehicle", "service_date", "garage_supplier", "receipt_total", "description",
  "category", "quantity", "unit_price", "line_total", "original_thai", "notes"
] as const;

export type MaintenanceImportIssueCode =
  | "required" | "vehicle_not_found" | "invalid_date" | "future_date"
  | "invalid_number" | "invalid_quantity" | "invalid_category" | "multiple_receipts";

export type MaintenanceImportIssue = {
  code: MaintenanceImportIssueCode;
  field: string;
  row?: number;
  value?: string;
};

export type MaintenanceImportItemDraft = {
  id: string;
  position: number;
  sourceRow: number;
  description: string;
  descriptionTh: string;
  category: string;
  quantity: number | null;
  unitPrice: number | null;
  lineTotal: number | null;
  notes: string;
};

export type MaintenanceImportDraft = {
  sourceName: string;
  vehicleRegistration: string;
  vehicleId: string | null;
  serviceDate: string;
  garageSupplier: string;
  receiptTotal: number | null;
  items: MaintenanceImportItemDraft[];
};

export class MaintenanceCsvError extends Error {
  constructor(public code: "columns" | "empty" | "malformed", public details: string[] = []) {
    super(`MAINTENANCE_CSV_${code.toUpperCase()}`);
  }
}

function parseCsvRows(source: string) {
  const text = source.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") { row.push(field); field = ""; }
    else if (character === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += character;
  }
  if (quoted) throw new MaintenanceCsvError("malformed");
  row.push(field.replace(/\r$/, ""));
  if (row.some(value => value !== "")) rows.push(row);
  return rows.filter(values => values.some(value => value.trim() !== ""));
}

function numberValue(value: string) {
  const normalized = value.trim().replace(/,/g, "");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function exceedsPrecision(value: number, places: number) {
  const scale = 10 ** places;
  return Math.abs(value * scale - Math.round(value * scale)) > 1e-7;
}

export function normalizeMaintenanceVehicleRegistration(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

export function matchMaintenanceImportVehicle<T extends { id: string; vehicle_reg: string }>(registration: string, vehicles: T[]) {
  const normalized = normalizeMaintenanceVehicleRegistration(registration);
  return vehicles.find(vehicle => normalizeMaintenanceVehicleRegistration(vehicle.vehicle_reg) === normalized) ?? null;
}

export function parseMaintenanceReceiptCsv(source: string, sourceName = "receipt.csv"): MaintenanceImportDraft[] {
  const rows = parseCsvRows(source);
  if (rows.length < 2) throw new MaintenanceCsvError("empty");
  const headers = rows[0].map(value => value.trim().toLocaleLowerCase());
  const missing = MAINTENANCE_IMPORT_COLUMNS.filter(column => !headers.includes(column));
  if (missing.length) throw new MaintenanceCsvError("columns", [...missing]);
  const indexes = Object.fromEntries(MAINTENANCE_IMPORT_COLUMNS.map(column => [column, headers.indexOf(column)])) as Record<typeof MAINTENANCE_IMPORT_COLUMNS[number], number>;
  const groups = new Map<string, MaintenanceImportDraft>();
  rows.slice(1).forEach((values, rowIndex) => {
    const get = (column: typeof MAINTENANCE_IMPORT_COLUMNS[number]) => (values[indexes[column]] ?? "").trim();
    const vehicleRegistration = get("vehicle");
    const serviceDate = get("service_date");
    const garageSupplier = get("garage_supplier");
    const receiptRaw = get("receipt_total");
    const receiptTotal = numberValue(receiptRaw);
    const key = [normalizeMaintenanceVehicleRegistration(vehicleRegistration), serviceDate, garageSupplier.trim().toLocaleLowerCase(), receiptRaw.replace(/,/g, "")].join("\u001f");
    const draft = groups.get(key) ?? { sourceName, vehicleRegistration, vehicleId: null, serviceDate, garageSupplier, receiptTotal, items: [] };
    draft.items.push({
      id: crypto.randomUUID(), position: draft.items.length, sourceRow: rowIndex + 2,
      description: get("description"), descriptionTh: get("original_thai"), category: get("category").toLocaleLowerCase(),
      quantity: numberValue(get("quantity")), unitPrice: numberValue(get("unit_price")), lineTotal: numberValue(get("line_total")), notes: get("notes")
    });
    groups.set(key, draft);
  });
  return [...groups.values()];
}

export function maintenanceImportCalculatedTotal(draft: MaintenanceImportDraft) {
  if (draft.items.some(item => item.lineTotal === null)) return null;
  return draft.items.reduce((sum, item) => sum + Math.round((item.lineTotal ?? 0) * 100), 0) / 100;
}

export function maintenanceImportDifference(draft: MaintenanceImportDraft) {
  const calculated = maintenanceImportCalculatedTotal(draft);
  return calculated === null || draft.receiptTotal === null ? null : (Math.round(calculated * 100) - Math.round(draft.receiptTotal * 100)) / 100;
}

export function maintenanceImportItemCalculationDiffers(item: MaintenanceImportItemDraft) {
  if (item.quantity === null || item.unitPrice === null || item.lineTotal === null) return false;
  return Math.round(item.quantity * item.unitPrice * 100) !== Math.round(item.lineTotal * 100);
}

export function validateMaintenanceImportDraft<T extends { id: string; vehicle_reg: string }>(
  draft: MaintenanceImportDraft,
  vehicles: T[],
  today = maintenanceToday()
) {
  const issues: MaintenanceImportIssue[] = [];
  const required = (value: string, field: string) => { if (!value.trim()) issues.push({ code: "required", field }); };
  required(draft.vehicleRegistration, "vehicle"); required(draft.serviceDate, "service_date");
  if (draft.receiptTotal === null || draft.receiptTotal < 0 || draft.receiptTotal > 9999999999.99 || exceedsPrecision(draft.receiptTotal, 2)) issues.push({ code: "invalid_number", field: "receipt_total" });
  if (!validMaintenanceDate(draft.serviceDate)) issues.push({ code: "invalid_date", field: "service_date" });
  else if (draft.serviceDate > today) issues.push({ code: "future_date", field: "service_date" });
  const matched = draft.vehicleId ? vehicles.find(vehicle => vehicle.id === draft.vehicleId) ?? null : matchMaintenanceImportVehicle(draft.vehicleRegistration, vehicles);
  if (!matched) issues.push({ code: "vehicle_not_found", field: "vehicle", value: draft.vehicleRegistration });
  draft.items.forEach(item => {
    if (!item.description.trim()) issues.push({ code: "required", field: "description", row: item.sourceRow });
    if (!MAINTENANCE_CATEGORIES.includes(item.category as MaintenanceCategory)) issues.push({ code: "invalid_category", field: "category", row: item.sourceRow, value: item.category });
    if (item.quantity === null || item.quantity <= 0 || item.quantity > 1000000 || exceedsPrecision(item.quantity, 2)) issues.push({ code: "invalid_quantity", field: "quantity", row: item.sourceRow });
    if (item.unitPrice === null || item.unitPrice < 0 || item.unitPrice > 100000000 || exceedsPrecision(item.unitPrice, 4)) issues.push({ code: "invalid_number", field: "unit_price", row: item.sourceRow });
    if (item.lineTotal === null || item.lineTotal < 0 || item.lineTotal > 9999999999.99 || exceedsPrecision(item.lineTotal, 2)) issues.push({ code: "invalid_number", field: "line_total", row: item.sourceRow });
  });
  return { issues, vehicle: matched, valid: issues.length === 0 };
}
