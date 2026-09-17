import { supabase } from "@/lib/supabase";
import type { InventoryCategory, InventoryData, InventoryItem, InventoryItemInput, InventoryMovement, InventoryVariant, InventoryVariantInput } from "./inventory-types";
import type { Driver, Vehicle } from "@/types/database";

async function rows<T>(table: string, order: string, ascending = true): Promise<T[]> {
  const { data, error } = await supabase.from(table).select("*").order(order, { ascending }).limit(1000).abortSignal(AbortSignal.timeout(30000));
  if (error) throw new Error(`${table}: ${error.message}`);
  return (data ?? []) as T[];
}
export async function fetchInventoryData(): Promise<InventoryData> {
  const [categories, items, variants, movements, drivers, vehicles] = await Promise.all([
    rows<InventoryCategory>("inventory_categories", "name"),
    rows<InventoryItem>("inventory_items", "name"),
    rows<InventoryVariant>("inventory_variants", "created_at"),
    rows<InventoryMovement>("inventory_movements", "occurred_at", false),
    rows<Driver>("drivers", "name"),
    rows<Vehicle>("vehicles", "vehicle_reg")
  ]);
  return { categories, items, variants, movements: movements.slice(0, 1000), drivers, vehicles };
}
function changed() { window.dispatchEvent(new CustomEvent("fuel-bank:data-changed", { detail: { resource: "inventory" } })); }
export async function saveInventoryCategory(payload: Partial<InventoryCategory>, expectedUpdatedAt: string | null) {
  const { error } = await supabase.rpc("save_inventory_category", { payload, expected_updated_at: expectedUpdatedAt });
  if (error) throw error; changed();
}
export async function saveInventoryItem(payload: InventoryItemInput, variants: InventoryVariantInput[], expectedUpdatedAt: string | null) {
  const { error } = await supabase.rpc("save_inventory_item", { payload, variant_rows: variants, expected_updated_at: expectedUpdatedAt });
  if (error) throw error; changed();
}
export async function receiveInventoryStock(payload: Record<string, unknown>) {
  const { data, error } = await supabase.rpc("post_inventory_movement", { payload: { ...payload, movement_type: "received" } });
  if (error) throw error; changed(); return data as string;
}
export async function adjustInventoryStock(payload: Record<string, unknown>) {
  const { data, error } = await supabase.rpc("post_inventory_movement", { payload });
  if (error) throw error; changed(); return data as string;
}
export async function issueInventoryStock(payload: Record<string, unknown>) {
  const { data, error } = await supabase.rpc("post_inventory_movement", { payload });
  if (error) throw error; changed(); return data as string;
}
