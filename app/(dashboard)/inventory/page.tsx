"use client";

import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Boxes,
  ChevronDown,
  Pencil,
  Plus,
  RefreshCw,
  Settings2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
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

type InventoryTab = "overview" | "stock" | "movements" | "categories";
type StockFilter = "all" | "healthy" | "low" | "out";
type StockSort = "attention" | "name" | "quantity";

const VARIANT_ORDER = [
  "xxs",
  "xs",
  "s",
  "m",
  "l",
  "xl",
  "2xl",
  "xxl",
  "3xl",
  "xxxl",
  "4xl",
  "xxxxl",
  "free-size",
  "free size",
];

function inventoryVariantRank(name: string) {
  const normalized = name.trim().toLowerCase();
  const index = VARIANT_ORDER.indexOf(normalized);
  return index === -1 ? VARIANT_ORDER.length : index;
}

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

export default function InventoryPage() {
  const { t, language } = useLanguage();
  const c = t.inventory;
  const { can } = useAccountAccess();

  const [data, setData] = useState<InventoryData>(empty);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<InventoryTab>("overview");
  const [dialog, setDialog] = useState<
    "item" | "receive" | "adjust" | "issue" | "category" | null
  >(null);
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [viewItem, setViewItem] = useState<InventoryItem | null>(null);
  const [selectedCategory, setSelectedCategory] =
    useState<InventoryCategory | null>(null);

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [stockFilter, setStockFilter] = useState<StockFilter>("all");
  const [stockSort, setStockSort] = useState<StockSort>("attention");

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

  const activeItems = useMemo(
    () => data.items.filter((item) => item.active),
    [data.items]
  );

  const itemMetrics = useCallback(
    (item: InventoryItem) => {
      const variants = data.variants
        .filter((variant) => variant.item_id === item.id)
        .sort((a, b) => {
          if (a.is_default && !b.is_default) return -1;
          if (!a.is_default && b.is_default) return 1;

          const rankDifference =
            inventoryVariantRank(a.name ?? "") - inventoryVariantRank(b.name ?? "");

          return rankDifference !== 0
            ? rankDifference
            : (a.name ?? "").localeCompare(b.name ?? "");
        });
      const totalQuantity = variants.reduce(
        (total, variant) => total + Number(variant.current_quantity || 0),
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
      const outVariantCount = variants.filter(
        (variant) =>
          inventoryStockStatus(
            variant.current_quantity,
            variant.minimum_stock
          ) === "out"
      ).length;

      return {
        variants,
        totalQuantity,
        reorderQuantity,
        lowVariantCount,
        outVariantCount,
      };
    },
    [data.variants]
  );

  const inventoryMetrics = useMemo(() => {
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

    const costedVariants = activeVariants.filter(
      (variant) => Number(variant.average_cost || 0) > 0
    );

    const stockValue = costedVariants.reduce(
      (total, variant) =>
        total +
        Number(variant.current_quantity || 0) *
          Number(variant.average_cost || 0),
      0
    );

    return {
      totalUnits,
      reorderRequired,
      totalVariants: activeVariants.length,
      costedVariants: costedVariants.length,
      stockValue,
    };
  }, [activeItems, data.variants]);

  const attention = useMemo(
    () =>
      data.variants
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
        .sort((a, b) => {
          const aGap = Number(a.minimum_stock || 0) - Number(a.current_quantity || 0);
          const bGap = Number(b.minimum_stock || 0) - Number(b.current_quantity || 0);
          return bGap - aGap;
        }),
    [data.items, data.variants]
  );

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
      ? language === "th"
        ? "รับสต็อก"
        : "Stock received"
      : type === "issued_to_driver"
      ? language === "th"
        ? "จ่ายให้คนขับ"
        : "Issued to driver"
      : type === "issued_to_vehicle"
      ? language === "th"
        ? "จ่ายให้รถ"
        : "Issued to vehicle"
      : type === "general_use"
      ? c.generalUse
      : type === "adjustment_plus"
      ? language === "th"
        ? "ปรับเพิ่มสต็อก"
        : "Stock adjustment"
      : language === "th"
      ? "ปรับลดสต็อก"
      : "Stock adjustment";

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

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();

    return activeItems
      .filter((item) => {
        const metrics = itemMetrics(item);
        const statuses = metrics.variants.map((variant) =>
          inventoryStockStatus(variant.current_quantity, variant.minimum_stock)
        );

        const matchesSearch =
          !q ||
          item.name.toLowerCase().includes(q) ||
          item.name_th?.toLowerCase().includes(q) ||
          item.sku?.toLowerCase().includes(q);

        const matchesCategory =
          !categoryFilter || item.category_id === categoryFilter;

        const matchesStock =
          stockFilter === "all" ||
          (stockFilter === "out" && statuses.includes("out")) ||
          (stockFilter === "low" && statuses.includes("low")) ||
          (stockFilter === "healthy" &&
            statuses.length > 0 &&
            statuses.every((status) => status === "ok"));

        return matchesSearch && matchesCategory && matchesStock;
      })
      .sort((a, b) => {
        const aMetrics = itemMetrics(a);
        const bMetrics = itemMetrics(b);

        if (stockSort === "name") {
          return inventoryDisplayName(a, language).localeCompare(
            inventoryDisplayName(b, language)
          );
        }

        if (stockSort === "quantity") {
          return bMetrics.totalQuantity - aMetrics.totalQuantity;
        }

        if (aMetrics.lowVariantCount !== bMetrics.lowVariantCount) {
          return bMetrics.lowVariantCount - aMetrics.lowVariantCount;
        }

        return aMetrics.totalQuantity - bMetrics.totalQuantity;
      });
  }, [
    activeItems,
    categoryFilter,
    itemMetrics,
    language,
    search,
    stockFilter,
    stockSort,
  ]);

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

    setViewItem(null);
    await load();
  }

  const tabs: Array<{ key: InventoryTab; label: string }> = [
    { key: "overview", label: language === "th" ? "ภาพรวม" : "Overview" },
    { key: "stock", label: language === "th" ? "สต็อก" : "Stock" },
    { key: "movements", label: language === "th" ? "การเคลื่อนไหว" : "Movements" },
    { key: "categories", label: language === "th" ? "หมวดหมู่" : "Categories" },
  ];

  return (
    <div className="space-y-5">
      <section className="rounded-[28px] border border-violet-100 bg-white/95 px-6 py-5 shadow-[0_10px_36px_rgba(76,29,149,0.06)]">
        <div className="flex flex-wrap items-center justify-between gap-5">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.17em] text-violet-600">
              EXPERT EXPRESS SENDER CO., LTD.
            </p>
            <h1 className="mt-1 text-3xl font-black tracking-tight text-slate-950">
              {language === "th" ? "สินค้าคงคลังและสต็อก" : "Inventory & Stock"}
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              {language === "th"
                ? "ควบคุมระดับสต็อก การเบิกจ่าย การเติมสินค้า และประวัติการเคลื่อนไหว"
                : "Control stock levels, issues, replenishment and movement history."}
            </p>
          </div>

          <div className="rounded-2xl border border-violet-100 bg-violet-50/60 p-1">
            <div className="flex flex-wrap gap-1">
              {tabs.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setTab(item.key)}
                  className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                    tab === item.key
                      ? "bg-white text-violet-700 shadow-sm"
                      : "text-slate-500 hover:text-slate-900"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
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

      {tab === "overview" && (
        <>
          <section className="surface-card overflow-hidden">
            <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-100 px-5 py-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-violet-600">
                  {language === "th" ? "ควบคุมสต็อก" : "INVENTORY CONTROL"}
                </p>
                <h2 className="mt-1 text-xl font-black text-slate-950">
                  {language === "th" ? "ภาพรวมสต็อก" : "Stock overview"}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {language === "th"
                    ? "ดูสิ่งที่ต้องเติมก่อน จากนั้นตรวจสอบการเคลื่อนไหวล่าสุด"
                    : "See what needs replenishing first, then review recent stock activity."}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-xl bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-500">
                  {summary.totalItems} {summary.totalItems === 1 ? "item" : "items"} ·{" "}
                  {inventoryMetrics.totalUnits} units on hand
                </span>
                <details className="relative">
                  <summary className="btn-primary flex cursor-pointer list-none items-center gap-2">
                    <Settings2 className="h-4 w-4" />
                    {language === "th" ? "จัดการสต็อก" : "Stock actions"}
                    <ChevronDown className="h-4 w-4" />
                  </summary>
                  <div className="absolute right-0 top-12 z-30 w-56 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
                    <button className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-semibold hover:bg-slate-50 disabled:opacity-50" disabled={!can("inventory.receive")} onClick={() => setDialog("receive")}>
                      <ArrowDownToLine className="h-4 w-4 text-emerald-600" />Receive stock
                    </button>
                    <button className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-semibold hover:bg-slate-50 disabled:opacity-50" disabled={!can("inventory.issue")} onClick={() => setDialog("issue")}>
                      <ArrowUpFromLine className="h-4 w-4 text-violet-700" />Issue stock
                    </button>
                    <button className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-semibold hover:bg-slate-50 disabled:opacity-50" disabled={!can("inventory.adjust")} onClick={() => setDialog("adjust")}>
                      <Settings2 className="h-4 w-4 text-amber-600" />Adjust stock
                    </button>
                  </div>
                </details>
                <button className="btn-secondary gap-2" disabled={busy} onClick={() => void load()}>
                  <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
                  {c.refresh}
                </button>
              </div>
            </div>

            <div className="grid gap-px bg-slate-100 sm:grid-cols-2 xl:grid-cols-4">
              <div
                className={`p-5 ${
                  attention.length === 0
                    ? "bg-emerald-50/70"
                    : attention.some(
                        (variant) =>
                          inventoryStockStatus(
                            variant.current_quantity,
                            variant.minimum_stock
                          ) === "out"
                      )
                    ? "bg-rose-50/70"
                    : "bg-amber-50/70"
                }`}
              >
                <p
                  className={`text-[10px] font-bold uppercase tracking-[0.12em] ${
                    attention.length === 0
                      ? "text-emerald-700"
                      : attention.some(
                          (variant) =>
                            inventoryStockStatus(
                              variant.current_quantity,
                              variant.minimum_stock
                            ) === "out"
                        )
                      ? "text-rose-700"
                      : "text-amber-700"
                  }`}
                >
                  {language === "th" ? "สถานะสต็อก" : "Stock status"}
                </p>
                <p className="mt-2 text-2xl font-black text-slate-950">
                  {attention.length === 0 ? "All clear" : "Attention needed"}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {attention.length} options below minimum
                </p>
              </div>

              <div className="bg-white p-5">
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                  {language === "th" ? "สินค้าคงคลัง" : "Inventory items"}
                </p>
                <p className="mt-2 text-2xl font-black text-slate-950">
                  {summary.totalItems}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {inventoryMetrics.totalUnits} total pieces in stock
                </p>
              </div>

              <div className="bg-amber-50/60 p-5">
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-amber-700">
                  {language === "th" ? "ต้องสั่งเพิ่ม" : "Reorder quantity"}
                </p>
                <p className="mt-2 text-2xl font-black text-slate-950">
                  {inventoryMetrics.reorderRequired}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Pieces required to reach minimum levels
                </p>
              </div>

              <div className="bg-sky-50/60 p-5">
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-sky-700">
                  {language === "th" ? "มูลค่าสต็อก" : "Stock value"}
                </p>
                <p className="mt-2 text-2xl font-black text-slate-950">
                  {inventoryMetrics.costedVariants > 0
                    ? money(inventoryMetrics.stockValue)
                    : language === "th"
                    ? "ยังไม่คำนวณ"
                    : "Not calculated"}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {inventoryMetrics.costedVariants > 0
                    ? `${inventoryMetrics.costedVariants} costed options`
                    : "Add unit costs to enable stock valuation"}
                </p>
              </div>
            </div>
          </section>

          <section className="grid items-start gap-4 xl:grid-cols-[0.9fr_1.1fr]">
            <div className="surface-card overflow-hidden">
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                <div>
                  <h2 className="section-title">
                    {language === "th" ? "ต้องดำเนินการ" : "Needs attention"}
                  </h2>
                  <p className="mt-1 text-xs text-slate-500">
                    Only stock options below their minimum are shown.
                  </p>
                </div>
                {attention.length > 0 && (
                  <button
                    type="button"
                    className="text-sm font-bold text-violet-700"
                    onClick={() => {
                      setStockFilter("low");
                      setTab("stock");
                    }}
                  >
                    View low stock →
                  </button>
                )}
              </div>

              <div className="p-4">
                {attention.length === 0 ? (
                  <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4 text-sm font-semibold text-emerald-700">
                    Stock levels are currently healthy.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {attention.slice(0, 5).map((variant) => {
                      const item = data.items.find((i) => i.id === variant.item_id)!;
                      const current = Number(variant.current_quantity || 0);
                      const minimum = Number(variant.minimum_stock || 0);
                      const reorder = Math.max(minimum - current, 0);

                      return (
                        <div
                          key={variant.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => setViewItem(item)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              setViewItem(item);
                            }
                          }}
                          className="flex cursor-pointer items-center justify-between gap-4 rounded-2xl border border-slate-100 bg-white px-4 py-3 transition hover:border-violet-100 hover:bg-violet-50/30"
                        >
                          <div>
                            <p className="font-bold text-slate-950">
                              {inventoryDisplayName(item, language)}
                              {!variant.is_default ? ` · ${variant.name}` : ""}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                              {current} on hand · minimum {minimum}
                            </p>
                          </div>

                          <div className="text-right">
                            <p className="text-sm font-black text-amber-700">
                              Order {reorder}
                            </p>
                            {can("inventory.receive") && (
                              <button
                                className="mt-1 text-xs font-bold text-violet-700"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setDialog("receive");
                                }}
                              >
                                Receive stock
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="surface-card overflow-hidden">
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                <div>
                  <h2 className="section-title">
                    {language === "th" ? "การเคลื่อนไหวล่าสุด" : "Latest movements"}
                  </h2>
                  <p className="mt-1 text-xs text-slate-500">
                    The latest stock received, issued and adjusted.
                  </p>
                </div>

                <button
                  type="button"
                  className="text-sm font-bold text-violet-700"
                  onClick={() => setTab("movements")}
                >
                  View all movements →
                </button>
              </div>

              <div className="divide-y divide-slate-100">
                {data.movements.length === 0 ? (
                  <p className="p-5 text-sm text-slate-500">{c.noMovements}</p>
                ) : (
                  data.movements.slice(0, 6).map((movement) => {
                    const item = data.items.find((i) => i.id === movement.item_id);
                    const variant = data.variants.find(
                      (v) => v.id === movement.variant_id
                    );
                    const negative = movementIsNegative(movement);
                    const target = movementTarget(movement);

                    return (
                      <div
                        key={movement.id}
                        className="grid grid-cols-[1fr_auto] gap-4 px-5 py-3.5"
                      >
                        <div>
                          <p className="font-bold text-slate-950">
                            {item
                              ? inventoryDisplayName(item, language)
                              : "Unknown item"}
                            {variant && !variant.is_default
                              ? ` · ${variant.name}`
                              : ""}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            {movementLabel(movement.movement_type)}
                            {target ? ` · ${target}` : ""}
                            {" · "}
                            {date(movement.occurred_at)}
                          </p>
                        </div>

                        <div className="text-right">
                          <p
                            className={`text-lg font-black ${
                              negative ? "text-violet-700" : "text-emerald-700"
                            }`}
                          >
                            {negative ? "−" : "+"}
                            {movement.quantity}
                          </p>
                          <p className="text-[11px] text-slate-500">
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
        </>
      )}

      {tab === "stock" && (
        <section className="surface-card overflow-hidden">
          <div className="border-b border-slate-100 p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-violet-600">
                  {language === "th" ? "สต็อกปัจจุบัน" : "CURRENT STOCK"}
                </p>
                <h2 className="mt-1 text-xl font-black text-slate-950">
                  {language === "th" ? "รายการสินค้า" : "Stock items"}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  A compact operational list. Open an item only when you need the full breakdown.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <details className="relative">
                  <summary className="btn-primary flex cursor-pointer list-none items-center gap-2">
                    <Settings2 className="h-4 w-4" />Stock actions
                    <ChevronDown className="h-4 w-4" />
                  </summary>
                  <div className="absolute right-0 top-12 z-30 w-56 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
                    <button className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-semibold hover:bg-slate-50 disabled:opacity-50" disabled={!can("inventory.receive")} onClick={() => setDialog("receive")}>
                      <ArrowDownToLine className="h-4 w-4 text-emerald-600" />Receive stock
                    </button>
                    <button className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-semibold hover:bg-slate-50 disabled:opacity-50" disabled={!can("inventory.issue")} onClick={() => setDialog("issue")}>
                      <ArrowUpFromLine className="h-4 w-4 text-violet-700" />Issue stock
                    </button>
                    <button className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-semibold hover:bg-slate-50 disabled:opacity-50" disabled={!can("inventory.adjust")} onClick={() => setDialog("adjust")}>
                      <Settings2 className="h-4 w-4 text-amber-600" />Adjust stock
                    </button>
                  </div>
                </details>
                {can("inventory.manage") && (
                  <button className="btn-secondary gap-2" onClick={() => { setSelectedItem(null); setDialog("item"); }}>
                    <Plus className="h-4 w-4" />Add item
                  </button>
                )}
                <button className="btn-secondary gap-2" disabled={busy} onClick={() => void load()}>
                  <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />{c.refresh}
                </button>
              </div>
            </div>

            <div className="mt-5 grid gap-2 xl:grid-cols-[1.4fr_1fr_1fr_1fr]">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={language === "th" ? "ค้นหาสินค้า" : "Search item, SKU or name"}
                className="form-input w-full"
              />

              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="form-input border bg-white"
              >
                <option value="">All categories</option>
                {data.categories
                  .filter((category) => category.active)
                  .map((category) => (
                    <option key={category.id} value={category.id}>
                      {language === "th" && category.name_th
                        ? category.name_th
                        : category.name}
                    </option>
                  ))}
              </select>

              <select
                value={stockFilter}
                onChange={(e) => setStockFilter(e.target.value as StockFilter)}
                className="form-input border bg-white"
              >
                <option value="all">All stock status</option>
                <option value="healthy">Healthy stock</option>
                <option value="low">Low stock</option>
                <option value="out">Out of stock</option>
              </select>

              <select
                value={stockSort}
                onChange={(e) => setStockSort(e.target.value as StockSort)}
                className="form-input border bg-white"
              >
                <option value="attention">Attention first</option>
                <option value="name">Item name</option>
                <option value="quantity">Highest quantity</option>
              </select>
            </div>
          </div>

          <div className="px-5 py-3 text-xs text-slate-500">
            {shown.length} {shown.length === 1 ? "item" : "items"} shown
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-0">
              <thead>
                <tr className="bg-violet-50/60 text-left text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                  <th className="px-5 py-3">Item</th>
                  <th className="px-5 py-3">Category</th>
                  <th className="px-5 py-3 text-right">Variants</th>
                  <th className="px-5 py-3 text-right">In stock</th>
                  <th className="px-5 py-3 text-right">Below min.</th>
                  <th className="px-5 py-3 text-right">Order qty.</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3 text-right">Action</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100">
                {shown.map((item) => {
                  const metrics = itemMetrics(item);
                  const category = data.categories.find(
                    (entry) => entry.id === item.category_id
                  );
                  const image = getInventoryImage(item);
                  const healthy = metrics.lowVariantCount === 0;

                  return (
                    <tr
                      key={item.id}
                      className="cursor-pointer bg-white transition hover:bg-slate-50/70"
                      onClick={() => setViewItem(item)}
                    >
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-xl border border-violet-100 bg-violet-50/60">
                            {image ? (
                              <img
                                src={image}
                                alt={inventoryDisplayName(item, language)}
                                className="h-10 w-10 object-contain"
                              />
                            ) : (
                              <Boxes className="h-5 w-5 text-violet-600" />
                            )}
                          </div>

                          <div>
                            <p className="font-bold text-slate-950">
                              {inventoryDisplayName(item, language)}
                            </p>
                            <p className="mt-0.5 text-xs text-slate-400">
                              {item.sku || "No SKU"}
                            </p>
                          </div>
                        </div>
                      </td>

                      <td className="px-5 py-4 text-sm text-slate-600">
                        {category?.name ?? "Uncategorised"}
                      </td>
                      <td className="px-5 py-4 text-right font-semibold text-slate-800">
                        {metrics.variants.length}
                      </td>
                      <td className="px-5 py-4 text-right font-bold text-slate-950">
                        {metrics.totalQuantity}
                      </td>
                      <td className="px-5 py-4 text-right font-semibold text-amber-700">
                        {metrics.lowVariantCount}
                      </td>
                      <td className="px-5 py-4 text-right font-semibold text-amber-700">
                        {metrics.reorderQuantity}
                      </td>
                      <td className="px-5 py-4">
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                            healthy
                              ? "bg-emerald-50 text-emerald-700"
                              : metrics.outVariantCount > 0
                              ? "bg-rose-50 text-rose-700"
                              : "bg-amber-50 text-amber-700"
                          }`}
                        >
                          {healthy
                            ? "Healthy"
                            : metrics.outVariantCount > 0
                            ? "Out of stock"
                            : "Low stock"}
                        </span>
                      </td>

                      <td className="px-5 py-4 text-right">
                        <button
                          type="button"
                          className="rounded-xl border border-violet-100 bg-white px-3 py-2 text-xs font-bold text-violet-700 shadow-sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setViewItem(item);
                          }}
                        >
                          Details
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {shown.length === 0 && (
              <div className="p-10 text-center text-sm text-slate-500">
                {c.noItems}
              </div>
            )}
          </div>
        </section>
      )}

      {tab === "movements" && (
        <section className="space-y-2">
          <div className="surface-card flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="hidden text-xs font-semibold text-slate-500 sm:block">
              {language === "th"
                ? "บันทึกการรับ จ่าย และปรับสต็อกทั้งหมด"
                : "Receive, issue and adjust stock from one place."}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
            <details className="relative">
              <summary className="btn-primary flex cursor-pointer list-none items-center gap-2">
                <Settings2 className="h-4 w-4" />
                Stock actions
                <ChevronDown className="h-4 w-4" />
              </summary>
              <div className="absolute right-0 top-12 z-30 w-56 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
                <button
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-semibold hover:bg-slate-50 disabled:opacity-50"
                  disabled={!can("inventory.receive")}
                  onClick={() => setDialog("receive")}
                >
                  <ArrowDownToLine className="h-4 w-4 text-emerald-600" />
                  Receive stock
                </button>
                <button
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-semibold hover:bg-slate-50 disabled:opacity-50"
                  disabled={!can("inventory.issue")}
                  onClick={() => setDialog("issue")}
                >
                  <ArrowUpFromLine className="h-4 w-4 text-violet-700" />
                  Issue stock
                </button>
                <button
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-semibold hover:bg-slate-50 disabled:opacity-50"
                  disabled={!can("inventory.adjust")}
                  onClick={() => setDialog("adjust")}
                >
                  <Settings2 className="h-4 w-4 text-amber-600" />
                  Adjust stock
                </button>
              </div>
            </details>

              <button
                className="btn-secondary gap-2"
                disabled={busy}
                onClick={() => void load()}
              >
                <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
                {c.refresh}
              </button>
            </div>
          </div>

          <InventoryMovementHistory data={data} />
        </section>
      )}

      {tab === "categories" && (
        <section className="surface-card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 p-5">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-violet-600">INVENTORY SETUP</p>
              <h2 className="mt-1 text-xl font-black text-slate-950">{c.categories}</h2>
              <p className="mt-1 text-sm text-slate-500">Used categories stay visible. Empty categories are tucked away until needed.</p>
            </div>
            <div className="flex items-center gap-2">
              {can("inventory.manage") && (
                <button className="btn-secondary gap-2" onClick={() => { setSelectedCategory(null); setDialog("category"); }}>
                  <Plus className="h-4 w-4" />{c.addCategory}
                </button>
              )}
              <button className="btn-secondary gap-2" disabled={busy} onClick={() => void load()}>
                <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />{c.refresh}
              </button>
            </div>
          </div>

          <div className="p-5">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {data.categories
                .filter(
                  (category) =>
                    category.active &&
                    data.items.some(
                      (item) => item.category_id === category.id && item.active
                    )
                )
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((category) => {
                  const itemCount = data.items.filter((item) => item.category_id === category.id && item.active).length;
                  return (
                    <div key={category.id} className="rounded-2xl border border-violet-100 bg-gradient-to-br from-white to-violet-50/50 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100 text-violet-700"><Boxes className="h-4 w-4" /></div>
                          <p className="mt-3 font-black text-slate-950">{language === "th" && category.name_th ? category.name_th : category.name}</p>
                          <p className="mt-1 text-xs text-slate-500">{itemCount} {itemCount === 1 ? "active item" : "active items"}</p>
                        </div>
                        {can("inventory.manage") && (
                          <button className="rounded-xl border border-slate-200 bg-white p-2 text-slate-500 hover:text-violet-700" onClick={() => { setSelectedCategory(category); setDialog("category"); }}>
                            <Pencil className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>

            {data.categories.filter((category) => category.active && !data.items.some((item) => item.category_id === category.id && item.active)).length > 0 && (
              <details className="mt-5 rounded-2xl border border-slate-200 bg-slate-50/70">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5">
                  <div>
                    <p className="font-bold text-slate-800">Unused categories</p>
                    <p className="mt-0.5 text-xs text-slate-500">{data.categories.filter((category) => category.active && !data.items.some((item) => item.category_id === category.id && item.active)).length} empty groups kept for future stock</p>
                  </div>
                  <ChevronDown className="h-4 w-4 text-slate-400" />
                </summary>
                <div className="grid gap-2 border-t border-slate-200 p-3 md:grid-cols-2 xl:grid-cols-3">
                  {data.categories
                    .filter(
                      (category) =>
                        category.active &&
                        !data.items.some(
                          (item) => item.category_id === category.id && item.active
                        )
                    )
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((category) => (
                      <div key={category.id} className="flex items-center justify-between rounded-xl bg-white px-3 py-2.5">
                        <div>
                          <p className="text-sm font-semibold text-slate-700">{language === "th" && category.name_th ? category.name_th : category.name}</p>
                          <p className="text-[11px] text-slate-400">0 items</p>
                        </div>
                        {can("inventory.manage") && (
                          <div className="flex items-center gap-1">
                            <button className="rounded-lg p-2 text-slate-400 hover:bg-slate-50 hover:text-violet-700" onClick={() => { setSelectedCategory(category); setDialog("category"); }}><Pencil className="h-3.5 w-3.5" /></button>
                            <button className="rounded-lg px-2 py-1.5 text-[11px] font-semibold text-rose-500 hover:bg-rose-50" onClick={() => void archiveCategory(category)}>{c.archive}</button>
                          </div>
                        )}
                      </div>
                    ))}
                </div>
              </details>
            )}
          </div>
        </section>
      )}

      {viewItem && (() => {
        const metrics = itemMetrics(viewItem);
        const category = data.categories.find(
          (entry) => entry.id === viewItem.category_id
        );
        const image = getInventoryImage(viewItem);

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm">
            <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-[28px] border border-white/70 bg-[#f8f7ff] shadow-2xl">
              <div className="flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-6 py-5">
                <div className="flex items-center gap-4">
                  <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl border border-violet-100 bg-violet-50">
                    {image ? (
                      <img
                        src={image}
                        alt={inventoryDisplayName(viewItem, language)}
                        className="h-14 w-14 object-contain"
                      />
                    ) : (
                      <Boxes className="h-7 w-7 text-violet-700" />
                    )}
                  </div>

                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-violet-600">
                      INVENTORY ITEM
                    </p>
                    <h2 className="mt-1 text-2xl font-black text-slate-950">
                      {inventoryDisplayName(viewItem, language)}
                    </h2>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <p className="text-sm text-slate-500">
                        {category?.name ?? "Uncategorised"}
                        {viewItem.sku ? ` · ${viewItem.sku}` : ""}
                      </p>
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                          metrics.lowVariantCount === 0
                            ? "bg-emerald-50 text-emerald-700"
                            : metrics.outVariantCount > 0
                            ? "bg-rose-50 text-rose-700"
                            : "bg-amber-50 text-amber-700"
                        }`}
                      >
                        {metrics.lowVariantCount === 0
                          ? "Healthy stock"
                          : metrics.outVariantCount > 0
                          ? "Out of stock"
                          : `${metrics.lowVariantCount} below minimum`}
                      </span>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setViewItem(null)}
                  className="rounded-xl border border-slate-200 bg-white p-2 text-slate-500 hover:bg-slate-50"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="overflow-y-auto p-6">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-2xl border border-violet-100 bg-gradient-to-br from-white to-violet-50/60 p-4">
                    <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                      In stock
                    </p>
                    <p className="mt-2 text-2xl font-black text-slate-950">
                      {metrics.totalQuantity}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {viewItem.unit}
                    </p>
                  </div>

                  <div className="rounded-2xl border border-amber-100 bg-gradient-to-br from-white to-amber-50/70 p-4">
                    <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                      Order quantity
                    </p>
                    <p className="mt-2 text-2xl font-black text-amber-700">
                      {metrics.reorderQuantity}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Needed to reach minimum levels
                    </p>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50/70 p-4">
                    <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                      Options
                    </p>
                    <p className="mt-2 text-2xl font-black text-slate-950">
                      {metrics.variants.length}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Sizes / variants
                    </p>
                  </div>
                </div>

                <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white">
                  <div className="grid grid-cols-[1.2fr_1fr_1fr_1fr_1fr] bg-violet-50/60 px-4 py-3 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                    <span>Option</span>
                    <span className="text-right">Current</span>
                    <span className="text-right">Minimum</span>
                    <span className="text-right">Reorder</span>
                    <span className="text-right">Status</span>
                  </div>

                  <div className="divide-y divide-slate-100">
                    {metrics.variants.map((variant) => {
                      const current = Number(variant.current_quantity || 0);
                      const minimum = Number(variant.minimum_stock || 0);
                      const reorder = Math.max(minimum - current, 0);
                      const status = inventoryStockStatus(current, minimum);

                      return (
                        <div
                          key={variant.id}
                          className="grid grid-cols-[1.2fr_1fr_1fr_1fr_1fr] items-center px-4 py-3 text-sm"
                        >
                          <span className="font-bold text-slate-950">
                            {variant.is_default ? c.standard : variant.name}
                          </span>
                          <span className="text-right">{current}</span>
                          <span className="text-right">{minimum}</span>
                          <span
                            className={`text-right font-semibold ${
                              reorder > 0 ? "text-amber-700" : "text-slate-400"
                            }`}
                          >
                            {reorder}
                          </span>
                          <span className="text-right">
                            <span
                              className={`rounded-full px-2 py-1 text-xs font-bold ${
                                status === "ok"
                                  ? "bg-emerald-50 text-emerald-700"
                                  : status === "out"
                                  ? "bg-rose-50 text-rose-700"
                                  : "bg-amber-50 text-amber-700"
                              }`}
                            >
                              {status === "ok"
                                ? "Healthy"
                                : status === "out"
                                ? "Out"
                                : "Low"}
                            </span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-6 py-4">
                <div className="flex gap-2">
                  {can("inventory.receive") && (
                    <button
                      className="btn-primary gap-2"
                      onClick={() => setDialog("receive")}
                    >
                      <ArrowDownToLine className="h-4 w-4" />
                      Receive stock
                    </button>
                  )}

                  {can("inventory.issue") && (
                    <button
                      className="btn-secondary gap-2"
                      onClick={() => setDialog("issue")}
                    >
                      <ArrowUpFromLine className="h-4 w-4" />
                      Issue stock
                    </button>
                  )}
                </div>

                {can("inventory.manage") && (
                  <div className="flex gap-2">
                    <button
                      className="btn-secondary gap-2"
                      onClick={() => {
                        setSelectedItem(viewItem);
                        setDialog("item");
                      }}
                    >
                      <Pencil className="h-4 w-4" />
                      Edit item
                    </button>

                    <button
                      className="btn-action text-rose-700"
                      onClick={() => void archiveItem(viewItem)}
                    >
                      Archive
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

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
