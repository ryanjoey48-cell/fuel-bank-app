import type { InventoryData, InventoryItem, InventoryVariant } from "./inventory-types";

export type StockStatus = "out" | "low" | "ok";
export function inventoryStockStatus(quantity: number, minimum: number): StockStatus {
  if (quantity === 0) return "out";
  if (quantity <= minimum) return "low";
  return "ok";
}
export function inventorySummary(data: InventoryData) {
  const activeItems = data.items.filter((item) => item.active);
  const itemIds = new Set(activeItems.map((item) => item.id));
  const variants = data.variants.filter((variant) => itemIds.has(variant.item_id));
  return {
    totalItems: activeItems.length,
    lowStock: variants.filter((v) => inventoryStockStatus(v.current_quantity, v.minimum_stock) === "low").length,
    outOfStock: variants.filter((v) => inventoryStockStatus(v.current_quantity, v.minimum_stock) === "out").length,
    stockValue: variants.reduce((sum, v) => sum + v.current_quantity * v.average_cost, 0)
  };
}
export function inventoryDisplayName(item: InventoryItem, language: "en" | "th") {
  return language === "th" && item.name_th?.trim() ? item.name_th : item.name;
}
export function inventoryVariantLabel(variant: InventoryVariant, fallback: string) {
  return variant.is_default ? fallback : (variant.name || fallback);
}

export function previewInventoryMovement(current: number, quantity: number, type: "received" | "adjustment_plus" | "adjustment_minus" | "issued_to_driver" | "issued_to_vehicle" | "general_use") {
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("INVENTORY_QUANTITY");
  const subtracts = type === "adjustment_minus" || type === "issued_to_driver" || type === "issued_to_vehicle" || type === "general_use";
  const next = current + (subtracts ? -quantity : quantity);
  if (next < 0) throw new Error("INVENTORY_NEGATIVE_STOCK");
  return next;
}
