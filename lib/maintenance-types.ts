import type { Driver, FuelLog, Vehicle, WeeklyMileageEntry } from "@/types/database";

export const MAINTENANCE_CATEGORIES = ["grease", "oil", "brakes", "tyres", "battery", "engine", "transmission", "suspension", "steering", "electrical", "inspection", "labour", "other"] as const;
export type MaintenanceCategory = typeof MAINTENANCE_CATEGORIES[number];
export type MaintenanceStatus = "overdue" | "mileageDue" | "dueSoon" | "noHistory" | "ok";
export type MaintenanceAudit = { created_by: string; created_at: string; updated_by: string; updated_at: string };
export type MaintenanceRecord = MaintenanceAudit & {
  id: string; vehicle_id: string; service_date: string; odometer: number | null;
  garage: string | null; receipt_reference: string | null; receipt_total: number | null;
  calculated_total: number; mismatch_confirmed: boolean; notes: string | null;
  off_road_at: string | null; returned_at: string | null; is_deleted: boolean;
};
export type MaintenanceItem = MaintenanceAudit & {
  id: string; record_id: string; position: number; description: string; description_th: string | null;
  category: MaintenanceCategory; quantity: number; unit_price: number; notes: string | null;
  requirement_id: string | null; reminder_months: number | null; reminder_km: number | null;
  warning_days: number; warning_km: number; override_date: string | null; override_km: number | null;
};
export type MaintenanceRequirement = MaintenanceAudit & {
  id: string; name: string; category: MaintenanceCategory; vehicle_type: string | null;
  frequency_months: number | null; mileage_interval: number | null;
  warning_days: number; warning_km: number; active: boolean; notes: string | null;
};
export type MaintenanceApplicability = { requirement_id: string; vehicle_id: string };
export type MaintenanceAttachment = {
  id: string; record_id: string; file_path: string; original_filename: string;
  mime_type: string; size_bytes: number; uploaded_by: string; uploaded_at: string;
};
export type MaintenanceData = {
  vehicles: Vehicle[]; drivers: Driver[]; mileage: WeeklyMileageEntry[]; fuel: FuelLog[];
  records: MaintenanceRecord[]; items: MaintenanceItem[]; requirements: MaintenanceRequirement[];
  applicability: MaintenanceApplicability[]; attachments: MaintenanceAttachment[];
};
export type MaintenanceItemInput = Omit<MaintenanceItem, keyof MaintenanceAudit | "record_id" | "position">;
export type MaintenanceRecordInput = Pick<MaintenanceRecord, "id" | "vehicle_id" | "service_date" | "odometer" | "garage" | "receipt_reference" | "receipt_total" | "mismatch_confirmed" | "notes" | "off_road_at" | "returned_at">;
export type MaintenanceReminder = {
  key: string; vehicle_id: string; name: string; category: MaintenanceCategory; status: MaintenanceStatus;
  record_id: string | null; item_id: string | null; due_date: string | null; due_km: number | null;
  days: number | null; km: number | null; mileage_date: string | null; mileage_unavailable: boolean;
};
