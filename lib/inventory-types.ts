export const INVENTORY_UNITS = ["piece", "bottle", "container", "litre", "set", "pair", "box", "pack", "other"] as const;
export type InventoryUnit = (typeof INVENTORY_UNITS)[number];
import type { Driver, Vehicle } from "@/types/database";

export type InventoryMovementType = "received" | "adjustment_plus" | "adjustment_minus" | "issued_to_driver" | "issued_to_vehicle" | "general_use";

export type InventoryCategory = {
  id: string; name: string; name_th: string | null; description: string | null; active: boolean;
  created_by: string; created_at: string; updated_by: string; updated_at: string;
};
export type InventoryItem = {
  id: string; category_id: string; name: string; name_th: string | null; sku: string | null;
  description: string | null; unit: InventoryUnit | string; reorder_quantity: number;
  preferred_supplier: string | null; storage_location: string | null; notes: string | null;
  active: boolean; created_by: string; created_at: string; updated_by: string; updated_at: string;
};
export type InventoryVariant = {
  id: string; item_id: string; name: string | null; sku: string | null; is_default: boolean;
  minimum_stock: number; current_quantity: number; average_cost: number;
  created_by: string; created_at: string; updated_by: string; updated_at: string;
};
export type InventoryMovement = {
  id: string; request_id: string; occurred_at: string; item_id: string; variant_id: string;
  movement_type: InventoryMovementType; quantity: number; previous_quantity: number; new_quantity: number;
  unit_cost: number | null; total_cost: number | null; supplier: string | null;
  storage_location: string | null; reference_number: string | null; notes: string | null;
  driver_id: string | null; vehicle_id: string | null; created_by: string; created_by_name: string; created_at: string;
};
export type InventoryData = { categories: InventoryCategory[]; items: InventoryItem[]; variants: InventoryVariant[]; movements: InventoryMovement[]; drivers: Driver[]; vehicles: Vehicle[] };
export type InventoryItemInput = Omit<InventoryItem, "created_by" | "created_at" | "updated_by" | "updated_at">;
export type InventoryVariantInput = Pick<InventoryVariant, "id" | "name" | "sku" | "is_default" | "minimum_stock" | "average_cost">;
