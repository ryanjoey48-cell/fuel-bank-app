import { supabase } from "@/lib/supabase";
import type { GreaseMaintenanceRecord, Vehicle } from "@/types/database";

async function fetchAll<T>(table: string, order: string): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await supabase.from(table).select("*").order(order).range(from, from + 499);
    if (error) throw error;
    rows.push(...(data ?? []) as T[]);
    if ((data ?? []).length < 500) return rows;
  }
}

// Preserve stable vehicle identities; the oil-page fetcher merges registration duplicates.
export const fetchGreaseVehicles = () => fetchAll<Vehicle>("vehicles", "id");
export const fetchGreaseRecords = () => fetchAll<GreaseMaintenanceRecord>("grease_maintenance_records", "id");

export type GreaseRecordInput = Pick<GreaseMaintenanceRecord, "vehicle_id" | "service_date" | "odometer" | "items" | "garage" | "notes" | "is_void">;

export async function saveGreaseRecord(input: GreaseRecordInput, existing?: Pick<GreaseMaintenanceRecord, "id" | "updated_at">) {
  const query = existing
    ? supabase.from("grease_maintenance_records").update(input).eq("id", existing.id).eq("updated_at", existing.updated_at)
    : supabase.from("grease_maintenance_records").insert(input);
  const { data, error } = await query.select("*").maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("GREASE_CONFLICT");
  window.dispatchEvent(new CustomEvent("fuel-bank:data-changed", { detail: { resource: "grease_maintenance_records" } }));
  return data as GreaseMaintenanceRecord;
}
