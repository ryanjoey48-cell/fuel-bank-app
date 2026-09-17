"use client";

import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Boxes,
  CircleDollarSign,
  PackageOpen,
  Pencil,
  Plus,
  RefreshCw,
  Settings2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Header } from "@/components/header";
import {
  CategoryDialog,
  ItemDialog,
  MovementDialog,
} from "@/components/inventory-dialogs";
import { InventoryIssueDialog } from "@/components/inventory-issue-dialog";
import { InventoryMovementHistory } from "@/components/inventory-history";
import {
  fetchInventoryData,
  saveInventoryCategory,
  saveInventoryItem,
} from "@/lib/inventory-data";
import {
  inventoryDisplayName,
  inventoryStockStatus,
  inventorySummary,
} from "@/lib/inventory";
import type {
  InventoryCategory,
  InventoryData,
  InventoryItem,
} from "@/lib/inventory-types";
import { useLanguage } from "@/lib/language-provider";
import { useAccountAccess } from "@/lib/use-account-access";

const empty: InventoryData = {
  categories: [],
  items: [],
  variants: [],
  movements: [],
  drivers: [],
  vehicles: [],
};

function getInventoryImage(item: InventoryItem) {
  const itemName = item.name.toLowerCase();
  const sku = item.sku?.trim().toLowerCase() ?? "";

  if (
    itemName.includes("reflective safety vest") ||
    itemName.includes("safety vest") ||
    itemName.includes("reflective vest") ||
    sku === "hs716"
  ) {
    return "/inventory/reflective-safety-vest-hs716.png";
  }

  if (itemName.includes("polo") || itemName.includes("shirt")) {
    return "/inventory/polo-shirt-clean.png";
  }

  return null;
}

function getInventoryImageClass(item: InventoryItem) {
  const itemName = item.name.toLowerCase();
  const sku = item.sku?.trim().toLowerCase() ?? "";

  if (
    itemName.includes("reflective safety vest") ||
    itemName.includes("safety vest") ||
    itemName.includes("reflective vest") ||
    sku === "hs716"
  ) {
    // The vest asset already contains its own soft studio/lavender treatment.
    // Scale it slightly larger and blend the pale background into the showcase.
    return "relative z-10 h-[255px] w-[calc(100%+18px)] max-w-none object-cover mix-blend-multiply drop-shadow-[0_22px_28px_rgba(76,29,149,0.16)] transition duration-300 hover:scale-[1.02]";
  }

  return "relative z-10 h-[245px] w-auto max-w-full object-contain drop-shadow-[0_22px_28px_rgba(76,29,149,0.22)] transition duration-300 hover:scale-[1.02]";
}


export default function InventoryPage() {
  const { t, language } = useLanguage();
  const c = t.inventory;
  const { can } = useAccountAccess();

  const [data, setData] = useState<InventoryData>(empty);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<
    "item" | "receive" | "adjust" | "issue" | "category" | null
  >(null);
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [selectedCategory, setSelectedCategory] =
    useState<InventoryCategory | null>(null);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [stockFilter, setStockFilter] = useState<"all" | "healthy" | "low" | "out">("all");

  const load = useCallback(async () => {
    setBusy(true);
    setError("");

    try {
      setData(await fetchInventoryData());
    } catch (e) {
      setError(`${c.errorLoad} ${String((e as Error).message ?? "")}`);
    } finally {
      setBusy(false);
    }
  }, [c.errorLoad]);

  useEffect(() => {
    void load();
  }, [load]);

  const summary = useMemo(() => inventorySummary(data), [data]);

  const inventoryMetrics = useMemo(() => {
    const activeItems = data.items.filter((item) => item.active);
    const activeItemIds = new Set(activeItems.map((item) => item.id));
    const activeVariants = data.variants.filter((variant) =>
      activeItemIds.has(variant.item_id)
    );

    const totalUnits = activeVariants.reduce(
      (total, variant) => total + Number(variant.current_quantity || 0),
      0
    );

    const reorderRequired = activeVariants.reduce((total, variant) => {
      const current = Number(variant.current_quantity || 0);
      const minimum = Number(variant.minimum_stock || 0);
      return total + Math.max(minimum - current, 0);
    }, 0);

    return {
      totalUnits,
      reorderRequired,
      totalVariants: activeVariants.length,
    };
  }, [data]);

  const driverById = useMemo(
    () => new Map(data.drivers.map((driver) => [String(driver.id), driver])),
    [data.drivers]
  );

  const vehicleById = useMemo(
    () =>
      new Map(
        data.vehicles.map((vehicle) => [String(vehicle.id), vehicle])
      ),
    [data.vehicles]
  );

  const shown = data.items.filter((item) => {
    const q = search.trim().toLowerCase();
    const itemVariants = data.variants.filter((variant) => variant.item_id === item.id);
    const statuses = itemVariants.map((variant) =>
      inventoryStockStatus(variant.current_quantity, variant.minimum_stock)
    );

    const matchesSearch =
      !q ||
      item.name.toLowerCase().includes(q) ||
      item.name_th?.toLowerCase().includes(q) ||
      item.sku?.toLowerCase().includes(q);

    const matchesCategory = !categoryFilter || item.category_id === categoryFilter;

    const matchesStock =
      stockFilter === "all" ||
      (stockFilter === "out" && statuses.includes("out")) ||
      (stockFilter === "low" && statuses.includes("low")) ||
      (stockFilter === "healthy" && statuses.length > 0 && statuses.every((status) => status === "ok"));

    return item.active && matchesSearch && matchesCategory && matchesStock;
  });

  const attention = data.variants
    .filter((variant) => {
      const item = data.items.find((i) => i.id === variant.item_id);

      return (
        item?.active &&
        inventoryStockStatus(
          variant.current_quantity,
          variant.minimum_stock
        ) !== "ok"
      );
    })
    .sort((a, b) => a.current_quantity - b.current_quantity);

  const money = (n: number) =>
    new Intl.NumberFormat(language === "th" ? "th-TH" : "en-GB", {
      style: "currency",
      currency: "THB",
      maximumFractionDigits: 2,
    }).format(n);

  const date = (value: string) =>
    new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));

  const issueTypes = new Set([
    "issued_to_driver",
    "issued_to_vehicle",
    "general_use",
  ]);

  const movementLabel = (type: string) =>
    type === "received"
      ? c.received
      : type === "issued_to_driver"
      ? (language === "th" ? "จ่ายให้คนขับ" : "Given to Driver")
      : type === "issued_to_vehicle"
      ? (language === "th" ? "จ่ายให้รถ" : "Given to Vehicle")
      : type === "general_use"
      ? c.generalUse
      : type === "adjustment_plus"
      ? (language === "th" ? "เพิ่มสต็อก" : "Stock Added")
      : (language === "th" ? "ลดสต็อก" : "Stock Removed");

  const movementTarget = (
    movement: InventoryData["movements"][number]
  ) =>
    movement.driver_id
      ? driverById.get(String(movement.driver_id))?.name
      : movement.vehicle_id
      ? vehicleById.get(String(movement.vehicle_id))?.vehicle_reg ||
        vehicleById.get(String(movement.vehicle_id))?.registration
      : movement.movement_type === "general_use"
      ? c.generalUse
      : null;

  const movementIsNegative = (
    movement: InventoryData["movements"][number]
  ) =>
    issueTypes.has(movement.movement_type) ||
    movement.movement_type === "adjustment_minus";

  async function saved() {
    setDialog(null);
    setSelectedItem(null);
    setSelectedCategory(null);
    await load();
  }

  async function archiveCategory(category: InventoryCategory) {
    if (!confirm(c.confirmArchive)) return;

    await saveInventoryCategory(
      { ...category, active: false },
      category.updated_at
    );

    await load();
  }

  async function archiveItem(item: InventoryItem) {
    if (!confirm(`${c.archive}?`)) return;

    const variants = data.variants
      .filter((v) => v.item_id === item.id)
      .map((v) => ({
        id: v.id,
        name: v.name,
        sku: v.sku,
        is_default: v.is_default,
        minimum_stock: v.minimum_stock,
        average_cost: v.average_cost,
      }));

    await saveInventoryItem(
      { ...item, active: false },
      variants,
      item.updated_at
    );

    await load();
  }

  return (
    <div className="space-y-5">
      <Header title={c.title} description={c.description} />

      <section className="rounded-[22px] border border-violet-100 bg-white/90 p-3 shadow-sm backdrop-blur">
        <div className="flex flex-wrap items-center gap-2">
          <button
            className="btn-primary gap-2"
            disabled={!can("inventory.receive")}
            onClick={() => setDialog("receive")}
          >
            <ArrowDownToLine className="h-4 w-4" />
            {c.receiveStock}
          </button>

          {can("inventory.issue") && (
            <button
              className="btn-primary gap-2 bg-[linear-gradient(135deg,#4f46e5,#7c3aed)] shadow-[0_8px_20px_rgba(79,70,229,0.18)]"
              onClick={() => setDialog("issue")}
            >
              <ArrowUpFromLine className="h-4 w-4" />
              {language === "th" ? "จ่ายสต็อก" : "Give Out Stock"}
            </button>
          )}

          {can("inventory.adjust") && (
            <button
              className="btn-secondary gap-2"
              onClick={() => setDialog("adjust")}
            >
              <Settings2 className="h-4 w-4" />
              {c.adjustStock}
            </button>
          )}

          {can("inventory.manage") && (
            <>
              <button
                className="btn-secondary gap-2"
                onClick={() => {
                  setSelectedItem(null);
                  setDialog("item");
                }}
              >
                <Plus className="h-4 w-4" />
                {c.addItem}
              </button>

              <button
                className="btn-secondary gap-2"
                onClick={() => {
                  setSelectedCategory(null);
                  setDialog("category");
                }}
              >
                <Boxes className="h-4 w-4" />
                {c.addCategory}
              </button>
            </>
          )}

          <button
            className="btn-secondary ml-auto gap-2"
            disabled={busy}
            onClick={() => void load()}
          >
            <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
            {c.refresh}
          </button>
        </div>
      </section>

      {error && (
        <div
          role="alert"
          className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"
        >
          {error}
        </div>
      )}

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <div className="relative overflow-hidden rounded-[22px] border border-violet-100 bg-gradient-to-br from-white via-violet-50/60 to-indigo-50 p-4 shadow-[0_8px_30px_rgba(76,29,149,0.06)]">
          <div className="absolute -right-5 -top-5 h-24 w-24 rounded-full bg-violet-200/20 blur-2xl" />
          <div className="relative flex items-start justify-between gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-violet-100 text-violet-700">
              <Boxes className="h-5 w-5" />
            </div>
            <span className="rounded-full bg-white/80 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-violet-600 shadow-sm">
              Catalogue
            </span>
          </div>
          <div className="relative mt-4">
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
              {language === "th" ? "รายการสินค้า" : (language === "th" ? "รายการสินค้า" : "Inventory Items")}
            </p>
            <div className="mt-1 flex items-end gap-2">
              <p className="text-3xl font-black tracking-tight text-slate-950">
                {summary.totalItems}
              </p>
              <p className="pb-1 text-xs font-medium text-slate-500">
                {summary.totalItems === 1 ? "item" : "items"}
              </p>
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-violet-100 pt-3">
              <span className="text-xs text-slate-500">
                {language === "th" ? "จำนวนคงเหลือทั้งหมด" : (language === "th" ? "จำนวนคงเหลือทั้งหมด" : "Total pieces in stock")}
              </span>
              <span className="text-sm font-black text-violet-700">
                {inventoryMetrics.totalUnits}
              </span>
            </div>
          </div>
        </div>

        <div className="rounded-[22px] border border-amber-100 bg-gradient-to-br from-white via-amber-50/70 to-orange-50 p-4 shadow-[0_8px_30px_rgba(217,119,6,0.06)]">
          <div className="flex items-start justify-between gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <span className="rounded-full bg-amber-100/80 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-700">
              Attention
            </span>
          </div>
          <div className="mt-4">
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
              {c.lowStock}
            </p>
            <p className="mt-1 text-3xl font-black tracking-tight text-amber-700">
              {summary.lowStock}
            </p>
            <div className="mt-3 flex items-center justify-between border-t border-amber-100 pt-3">
              <span className="text-xs text-slate-500">
                {language === "th" ? "จำนวนที่ควรสั่งเพิ่ม" : (language === "th" ? "ต้องสั่งเพิ่ม" : "Need to order")}
              </span>
              <span className="text-sm font-black text-amber-700">
                {inventoryMetrics.reorderRequired}
              </span>
            </div>
          </div>
        </div>

        <div className="rounded-[22px] border border-rose-100 bg-gradient-to-br from-white via-rose-50/70 to-red-50 p-4 shadow-[0_8px_30px_rgba(225,29,72,0.05)]">
          <div className="flex items-start justify-between gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-rose-100 text-rose-700">
              <PackageOpen className="h-5 w-5" />
            </div>
            <span className="rounded-full bg-rose-100/80 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-rose-700">
              Critical
            </span>
          </div>
          <div className="mt-4">
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
              {c.outOfStock}
            </p>
            <p className="mt-1 text-3xl font-black tracking-tight text-rose-700">
              {summary.outOfStock}
            </p>
            <p className="mt-3 border-t border-rose-100 pt-3 text-xs text-slate-500">
              {summary.outOfStock === 0
                ? language === "th"
                  ? "ไม่มีสินค้าหมด"
                  : "No unavailable stock"
                : language === "th"
                ? "ต้องดำเนินการ"
                : "Requires immediate action"}
            </p>
          </div>
        </div>

        <div className="rounded-[22px] border border-emerald-100 bg-gradient-to-br from-white via-emerald-50/70 to-teal-50 p-4 shadow-[0_8px_30px_rgba(5,150,105,0.05)]">
          <div className="flex items-start justify-between gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
              <CircleDollarSign className="h-5 w-5" />
            </div>
            <span className="rounded-full bg-emerald-100/80 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-700">
              Value
            </span>
          </div>
          <div className="mt-4">
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
              {c.stockValue}
            </p>
            <p className="mt-1 text-2xl font-black tracking-tight text-emerald-700 sm:text-3xl">
              {money(summary.stockValue)}
            </p>
            <div className="mt-3 flex items-center justify-between border-t border-emerald-100 pt-3">
              <span className="text-xs text-slate-500">
                {language === "th" ? "ตัวเลือกสินค้า" : (language === "th" ? "ขนาด / ตัวเลือก" : "Sizes / Options")}
              </span>
              <span className="text-sm font-black text-emerald-700">
                {inventoryMetrics.totalVariants}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ATTENTION + RECENT STOCK MOVEMENTS */}
      <section className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="surface-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3.5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-700">
                <AlertTriangle className="h-5 w-5" />
              </div>

              <div>
                <h2 className="section-title">{c.requiringAttention}</h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  {attention.length}{" "}
                  {language === "th" ? `${attention.length} ขนาด / ตัวเลือกต้องตรวจสอบ` : `${attention.length} ${attention.length === 1 ? "size / option needs" : "sizes / options need"} attention`}
                </p>
              </div>
            </div>

            {inventoryMetrics.reorderRequired > 0 && (
              <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-amber-700">
                Need {inventoryMetrics.reorderRequired}
              </span>
            )}
          </div>

          <div className="p-3">
            {attention.length === 0 ? (
              <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4 text-sm font-medium text-emerald-700">
                {c.noAttention}
              </div>
            ) : (
              <div className="space-y-2">
                {attention.slice(0, 6).map((variant) => {
                  const item = data.items.find((i) => i.id === variant.item_id)!;
                  const status = inventoryStockStatus(
                    variant.current_quantity,
                    variant.minimum_stock
                  );

                  const current = Number(variant.current_quantity || 0);
                  const minimum = Number(variant.minimum_stock || 0);
                  const reorder = Math.max(minimum - current, 0);
                  const percentage =
                    minimum > 0 ? Math.min((current / minimum) * 100, 100) : 100;

                  const inventoryImage = getInventoryImage(item);

                  return (
                    <div
                      key={variant.id}
                      className="group rounded-2xl border border-slate-100 bg-white p-3 transition hover:border-violet-200 hover:shadow-sm"
                    >
                      <div className="flex items-center gap-3">
                        <div className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-violet-100 bg-gradient-to-br from-violet-50 to-indigo-50">
                          {inventoryImage ? (
                            <img
                              src={inventoryImage}
                              alt={inventoryDisplayName(item, language)}
                              className="h-12 w-12 object-contain mix-blend-multiply"
                            />
                          ) : (
                            <Boxes className="h-6 w-6 text-violet-500" />
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <p className="truncate font-bold text-slate-950">
                                {inventoryDisplayName(item, language)}
                                {!variant.is_default ? ` · ${variant.name}` : ""}
                              </p>

                              <p className="mt-0.5 text-xs text-slate-500">
                                {current} {item.unit} in stock · {language === "th" ? `ขั้นต่ำ ${minimum}` : `minimum ${minimum}`}
                              </p>
                            </div>

                            <div className="text-right">
                              <span
                                className={`inline-flex rounded-full px-2 py-1 text-[9px] font-black uppercase tracking-wide ${
                                  status === "out"
                                    ? "bg-rose-100 text-rose-700"
                                    : "bg-amber-100 text-amber-700"
                                }`}
                              >
                                {status === "out" ? c.statusOut : c.statusLow}
                              </span>

                              {reorder > 0 && (
                                <div className="mt-1 flex items-center justify-end gap-2">
                                  <p className="text-xs font-black text-amber-700">
                                    {language === "th" ? `ต้องสั่งเพิ่ม ${reorder}` : `Need to order ${reorder}`}
                                  </p>
                                  {can("inventory.receive") && (
                                    <button
                                      type="button"
                                      className="rounded-lg border border-violet-200 bg-violet-50 px-2 py-1 text-[10px] font-black text-violet-700 transition hover:bg-violet-100"
                                      onClick={() => setDialog("receive")}
                                    >
                                      Receive
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                            <div
                              className={`h-full rounded-full ${
                                status === "out" ? "bg-rose-500" : "bg-amber-500"
                              }`}
                              style={{ width: `${percentage}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="surface-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3.5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-violet-700">
                <RefreshCw className="h-5 w-5" />
              </div>

              <div>
                <h2 className="section-title">{c.recentMovements}</h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Latest inventory activity across all items
                </p>
              </div>
            </div>

            <span className="rounded-full bg-violet-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-violet-700">
              {Math.min(data.movements.length, 6)} latest
            </span>
          </div>

          <div className="divide-y divide-slate-100">
            {data.movements.length === 0 ? (
              <p className="p-4 text-sm text-slate-500">{c.noMovements}</p>
            ) : (
              data.movements.slice(0, 6).map((movement) => {
                const item = data.items.find((i) => i.id === movement.item_id);
                const variant = data.variants.find(
                  (v) => v.id === movement.variant_id
                );

                const negative = movementIsNegative(movement);
                const issued = issueTypes.has(movement.movement_type);
                const adjustmentMinus = movement.movement_type === "adjustment_minus";
                const target = movementTarget(movement);

                return (
                  <div
                    key={movement.id}
                    className="grid grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-3 transition hover:bg-slate-50/70"
                  >
                    <div
                      className={`flex h-9 w-9 items-center justify-center rounded-xl ${
                        issued
                          ? "bg-violet-50 text-violet-700"
                          : adjustmentMinus
                          ? "bg-amber-50 text-amber-700"
                          : "bg-emerald-50 text-emerald-600"
                      }`}
                    >
                      {negative ? (
                        <ArrowUpFromLine className="h-4 w-4" />
                      ) : (
                        <ArrowDownToLine className="h-4 w-4" />
                      )}
                    </div>

                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate font-bold text-slate-950">
                          {item
                            ? inventoryDisplayName(item, language)
                            : "Unknown item"}
                          {variant && !variant.is_default
                            ? ` · ${variant.name}`
                            : ""}
                        </p>

                        <span
                          className={`rounded-full px-2 py-0.5 text-[9px] font-black ${
                            issued
                              ? "bg-violet-100 text-violet-700"
                              : adjustmentMinus
                              ? "bg-amber-100 text-amber-700"
                              : "bg-emerald-100 text-emerald-700"
                          }`}
                        >
                          {movementLabel(movement.movement_type)}
                        </span>
                      </div>

                      <p className="mt-1 truncate text-xs text-slate-500">
                        {date(movement.occurred_at)}
                        {target ? ` · ${target}` : ""}
                      </p>
                    </div>

                    <div className="min-w-[88px] text-right">
                      <p
                        className={`text-lg font-black ${
                          issued
                            ? "text-violet-700"
                            : adjustmentMinus
                            ? "text-amber-700"
                            : "text-emerald-700"
                        }`}
                      >
                        {negative ? "−" : "+"}
                        {movement.quantity}
                      </p>

                      <p className="text-[11px] font-medium text-slate-500">
                        {movement.previous_quantity} → {movement.new_quantity}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </section>

      {/* PREMIUM STOCK ITEMS */}
      <section className="surface-card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-violet-700">
              <Boxes className="h-5 w-5" />
            </div>

            <div>
              <h2 className="section-title">{c.stockItems}</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                {summary.totalItems}{" "}
                {summary.totalItems === 1 ? "stock item" : "stock items"} ·{" "}
                {inventoryMetrics.totalUnits} units on hand
              </p>
            </div>
          </div>

          <div className="grid w-full gap-2 sm:w-auto sm:grid-cols-3">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={c.searchItems}
              className="form-input w-full sm:w-64"
            />
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="form-input border bg-white"
              aria-label={language === "th" ? "หมวดหมู่" : "Category"}
            >
              <option value="">{language === "th" ? "ทุกหมวดหมู่" : "All categories"}</option>
              {data.categories.filter((category) => category.active).map((category) => (
                <option key={category.id} value={category.id}>
                  {language === "th" && category.name_th ? category.name_th : category.name}
                </option>
              ))}
            </select>
            <select
              value={stockFilter}
              onChange={(e) => setStockFilter(e.target.value as "all" | "healthy" | "low" | "out")}
              className="form-input border bg-white"
              aria-label={language === "th" ? "สถานะสต็อก" : "Stock status"}
            >
              <option value="all">{language === "th" ? "ทุกสถานะสต็อก" : "All stock status"}</option>
              <option value="healthy">{language === "th" ? "สต็อกปกติ" : "Healthy stock"}</option>
              <option value="low">{language === "th" ? "สต็อกต่ำ" : "Low stock"}</option>
              <option value="out">{language === "th" ? "สินค้าหมด" : "Out of stock"}</option>
            </select>
          </div>
        </div>

        <div className="space-y-4 p-4">
          {shown.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
              <p className="text-sm text-slate-500">{c.noItems}</p>
            </div>
          ) : (
            shown.map((item) => {
              const variants = data.variants.filter(
                (variant) => variant.item_id === item.id
              );

              const category = data.categories.find(
                (category) => category.id === item.category_id
              );

              const totalQuantity = variants.reduce(
                (total, variant) =>
                  total + Number(variant.current_quantity || 0),
                0
              );

              const reorderQuantity = variants.reduce((total, variant) => {
                const current = Number(variant.current_quantity || 0);
                const minimum = Number(variant.minimum_stock || 0);
                return total + Math.max(minimum - current, 0);
              }, 0);

              const lowVariantCount = variants.filter(
                (variant) =>
                  inventoryStockStatus(
                    variant.current_quantity,
                    variant.minimum_stock
                  ) !== "ok"
              ).length;

              const inventoryImage = getInventoryImage(item);

              return (
                <article
                  key={item.id}
                  className="overflow-hidden rounded-[26px] border border-slate-200 bg-white shadow-[0_12px_40px_rgba(15,23,42,0.05)]"
                >
                  <div className="grid lg:grid-cols-[300px_1fr]">
                    {/* PRODUCT SHOWCASE */}
                    <div className="relative overflow-hidden border-b border-violet-100 bg-[linear-gradient(145deg,#faf9ff_0%,#f3efff_45%,#eef2ff_100%)] p-4 lg:border-b-0 lg:border-r">
                      <div className="absolute -left-16 -top-16 h-48 w-48 rounded-full bg-violet-300/20 blur-3xl" />
                      <div className="absolute -bottom-20 -right-16 h-56 w-56 rounded-full bg-indigo-300/20 blur-3xl" />
                      <div className="absolute inset-x-7 bottom-24 h-16 rounded-full bg-violet-900/10 blur-2xl" />

                      <div className="relative flex min-h-[330px] flex-col">
                        <div className="flex items-center justify-between">
                          <span className="rounded-full border border-white/80 bg-white/80 px-3 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-violet-700 shadow-sm backdrop-blur">
                            {category?.name ?? "Inventory"}
                          </span>

                          {lowVariantCount > 0 ? (
                            <span className="rounded-full border border-amber-200 bg-amber-50/90 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-amber-700">
                              {lowVariantCount} Low
                            </span>
                          ) : (
                            <span className="rounded-full border border-emerald-200 bg-emerald-50/90 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-emerald-700">
                              Healthy
                            </span>
                          )}
                        </div>

                        <div className="relative flex flex-1 items-center justify-center py-4">
                          {inventoryImage ? (
                            <div className="relative flex h-[265px] w-full items-center justify-center overflow-hidden rounded-[30px] bg-gradient-to-br from-violet-50 via-violet-100/70 to-indigo-100/80 px-3">
                              <div className="absolute inset-x-12 bottom-4 h-10 rounded-full bg-violet-950/10 blur-2xl" />

                              <img
                                src={inventoryImage}
                                alt={inventoryDisplayName(item, language)}
                                className={getInventoryImageClass(item)}
                              />
                            </div>
                          ) : (
                            <div className="flex h-36 w-36 items-center justify-center rounded-[32px] border border-violet-100 bg-white/70 text-violet-700 shadow-sm">
                              <Boxes className="h-14 w-14" />
                            </div>
                          )}
                        </div>

                        <div className="relative rounded-2xl border border-white/80 bg-white/70 p-3 shadow-sm backdrop-blur">
                          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-violet-500">
                            Inventory Item
                          </p>

                          <p className="mt-1 text-base font-black text-slate-950">
                            {inventoryDisplayName(item, language)}
                          </p>

                          <p className="mt-0.5 text-xs text-slate-500">
                            {totalQuantity} {item.unit} currently in stock
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* PRODUCT DETAILS */}
                    <div className="min-w-0 p-4 sm:p-5">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-xl font-black tracking-tight text-slate-950">
                              {inventoryDisplayName(item, language)}
                            </h3>

                            {lowVariantCount > 0 ? (
                              <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-amber-700">
                                {lowVariantCount} Low Stock
                              </span>
                            ) : (
                              <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-emerald-700">
                                Healthy Stock
                              </span>
                            )}
                          </div>

                          <p className="mt-1 text-sm text-slate-500">
                            {category?.name ?? "Uncategorised"}
                            {item.sku ? ` · ${item.sku}` : ""}
                          </p>

                          <p className="mt-2 max-w-2xl text-xs leading-5 text-slate-500">
                            {language === "th"
  ? "ติดตามสต็อกพร้อมระดับขั้นต่ำ จำนวนที่ต้องเติม และประวัติการเคลื่อนไหว"
  : "Stock is tracked with minimum levels, replenishment needs and inventory history."}
                          </p>
                        </div>

                        {can("inventory.manage") && (
                          <div className="flex shrink-0 gap-2">
                            <button
                              className="btn-secondary gap-2"
                              onClick={() => {
                                setSelectedItem(item);
                                setDialog("item");
                              }}
                            >
                              <Pencil className="h-4 w-4" />
                              {c.edit}
                            </button>

                            <button
                              className="btn-action text-rose-700"
                              onClick={() => void archiveItem(item)}
                            >
                              {c.archive}
                            </button>
                          </div>
                        )}
                      </div>

                      {/* SUMMARY */}
                      <div className="mt-5 grid grid-cols-3 gap-2">
                        <div className="rounded-2xl border border-violet-100 bg-gradient-to-br from-violet-50 to-indigo-50/60 px-3 py-3">
                          <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-slate-500">
                            In Stock
                          </p>
                          <p className="mt-1 text-2xl font-black text-violet-700">
                            {totalQuantity}
                          </p>
                          <p className="text-[10px] text-slate-500">
                            {item.unit}
                          </p>
                        </div>

                        <div
                          className={`rounded-2xl border px-3 py-3 ${
                            reorderQuantity > 0
                              ? "border-amber-100 bg-gradient-to-br from-amber-50 to-orange-50/60"
                              : "border-emerald-100 bg-gradient-to-br from-emerald-50 to-teal-50/60"
                          }`}
                        >
                          <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-slate-500">
                            Need to Order
                          </p>
                          <p
                            className={`mt-1 text-2xl font-black ${
                              reorderQuantity > 0
                                ? "text-amber-700"
                                : "text-emerald-700"
                            }`}
                          >
                            {reorderQuantity}
                          </p>
                          <p className="text-[10px] text-slate-500">
                            {language === "th" ? "ชิ้นที่ต้องสั่งเพิ่ม" : "items needed"}
                          </p>
                        </div>

                        <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white px-3 py-3">
                          <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-slate-500">
                            Sizes / Options
                          </p>
                          <p className="mt-1 text-2xl font-black text-slate-900">
                            {variants.length}
                          </p>
                          <p className="text-[10px] text-slate-500">
                            available
                          </p>
                        </div>
                      </div>

                      {/* VARIANTS */}
                      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                        {variants.map((variant) => {
                          const status = inventoryStockStatus(
                            variant.current_quantity,
                            variant.minimum_stock
                          );

                          const current = Number(
                            variant.current_quantity || 0
                          );
                          const minimum = Number(variant.minimum_stock || 0);
                          const reorder = Math.max(minimum - current, 0);
                          const percentage =
                            minimum > 0
                              ? Math.min((current / minimum) * 100, 100)
                              : 100;

                          return (
                            <div
                              key={variant.id}
                              className={`rounded-2xl border p-3.5 transition hover:-translate-y-0.5 hover:shadow-sm ${
                                status === "out"
                                  ? "border-rose-200 bg-rose-50/50"
                                  : status === "low"
                                  ? "border-amber-200 bg-amber-50/40"
                                  : "border-emerald-100 bg-emerald-50/30"
                              }`}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <p className="text-sm font-black text-slate-950">
                                    {variant.is_default
                                      ? (language === "th" ? "มาตรฐาน" : "Standard")
                                      : variant.name}
                                  </p>
                                  <p className="mt-0.5 text-[10px] uppercase tracking-wide text-slate-400">
                                    {language === "th" ? "ขนาด" : (language === "th" ? "ขนาด" : "Size")}
                                  </p>
                                </div>

                                <div className="text-right">
                                  <p className="text-2xl font-black tracking-tight text-slate-950">
                                    {current}
                                  </p>
                                  <p className="text-[10px] text-slate-500">
                                    {item.unit}
                                  </p>
                                </div>
                              </div>

                              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-200/70">
                                <div
                                  className={`h-full rounded-full ${
                                    status === "out"
                                      ? "bg-rose-500"
                                      : status === "low"
                                      ? "bg-amber-500"
                                      : "bg-emerald-500"
                                  }`}
                                  style={{ width: `${percentage}%` }}
                                />
                              </div>

                              <div className="mt-3 flex items-end justify-between gap-2">
                                <div>
                                  <p className="text-[10px] text-slate-500">
                                    {language === "th" ? "ขั้นต่ำ" : "Minimum"}
                                  </p>
                                  <p className="text-xs font-bold text-slate-700">
                                    {minimum}
                                  </p>
                                </div>

                                <div className="text-right">
                                  {status === "ok" ? (
                                    <span className="inline-flex rounded-full bg-emerald-100 px-2 py-1 text-[9px] font-black uppercase tracking-wide text-emerald-700">
                                      In Stock
                                    </span>
                                  ) : status === "out" ? (
                                    <span className="inline-flex rounded-full bg-rose-100 px-2 py-1 text-[9px] font-black uppercase tracking-wide text-rose-700">
                                      {c.statusOut}
                                    </span>
                                  ) : (
                                    <span className="inline-flex rounded-full bg-amber-100 px-2 py-1 text-[9px] font-black uppercase tracking-wide text-amber-700">
                                      {c.statusLow}
                                    </span>
                                  )}

                                  {reorder > 0 && (
                                    <p className="mt-1 text-[10px] font-semibold text-amber-700">
                                      {language === "th" ? `ต้องเพิ่มอีก ${reorder}` : `Need ${reorder} more`}
                                    </p>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* FOOTER */}
                      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
                        <p className="text-xs text-slate-500">
                          {lowVariantCount === 0
                            ? "Stock is at or above the minimum level."
                            : `${lowVariantCount} ${
                                lowVariantCount === 1
                                  ? "size is"
                                  : "sizes are"
                              } below minimum stock.`}
                        </p>

                        {reorderQuantity > 0 && (
                          <span className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-700">
                            {language === "th" ? `ต้องสั่งเพิ่ม ${reorderQuantity} ชิ้น` : `Need to order ${reorderQuantity} ${item.unit}${reorderQuantity === 1 ? "" : "s"}`}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </article>
              );
            })
          )}
        </div>
      </section>

      {can("inventory.manage") && (
        <section className="surface-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3.5">
            <div>
              <h2 className="section-title">{c.categories}</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Organise stock items into clear company inventory groups
              </p>
            </div>

            <button
              className="btn-secondary gap-2"
              onClick={() => {
                setSelectedCategory(null);
                setDialog("category");
              }}
            >
              <Plus className="h-4 w-4" />
              {c.addCategory}
            </button>
          </div>

          <div className="grid gap-2 p-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {data.categories.map((category) => {
              const itemCount = data.items.filter(
                (item) => item.category_id === category.id && item.active
              ).length;

              return (
                <div
                  key={category.id}
                  className={`group rounded-xl border px-3 py-2.5 transition hover:-translate-y-0.5 hover:shadow-sm ${
                    category.active
                      ? "border-violet-100 bg-gradient-to-br from-white to-violet-50/50"
                      : "border-slate-200 bg-slate-50 text-slate-400"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-100 text-violet-700">
                      <Boxes className="h-4 w-4" />
                    </div>

                    <button
                      className="rounded-lg p-1.5 text-slate-400 transition hover:bg-white hover:text-violet-700"
                      onClick={() => {
                        setSelectedCategory(category);
                        setDialog("category");
                      }}
                      aria-label={c.edit}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <p className="mt-2 truncate text-sm font-bold text-slate-900">
                    {language === "th" && category.name_th
                      ? category.name_th
                      : category.name}
                  </p>

                  <div className="mt-1 flex items-center justify-between gap-2">
                    <p className="text-xs text-slate-500">
                      {itemCount} {itemCount === 1 ? "item" : "items"}
                    </p>

                    {category.active && (
                      <button
                        className="text-[10px] font-semibold text-rose-500 opacity-0 transition group-hover:opacity-100"
                        onClick={() => void archiveCategory(category)}
                      >
                        {c.archive}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <InventoryMovementHistory data={data} />

      {dialog === "item" && (
        <ItemDialog
          data={data}
          selected={selectedItem}
          onClose={() => setDialog(null)}
          onSaved={() => void saved()}
        />
      )}

      {dialog === "category" && (
        <CategoryDialog
          data={data}
          selected={selectedCategory}
          onClose={() => setDialog(null)}
          onSaved={() => void saved()}
        />
      )}

      {dialog === "issue" && (
        <InventoryIssueDialog
          data={data}
          onClose={() => setDialog(null)}
          onSaved={() => void saved()}
        />
      )}

      {(dialog === "receive" || dialog === "adjust") && (
        <MovementDialog
          data={data}
          mode={dialog}
          onClose={() => setDialog(null)}
          onSaved={() => void saved()}
        />
      )}
    </div>
  );
}
