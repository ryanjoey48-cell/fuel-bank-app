"use client";

import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Search,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { inventoryDisplayName } from "@/lib/inventory";
import type {
  InventoryData,
  InventoryItem,
  InventoryMovement,
  InventoryMovementType,
} from "@/lib/inventory-types";
import { useLanguage } from "@/lib/language-provider";

const issueTypes: InventoryMovementType[] = [
  "issued_to_driver",
  "issued_to_vehicle",
  "general_use",
];

const negativeTypes: InventoryMovementType[] = [
  "issued_to_driver",
  "issued_to_vehicle",
  "general_use",
  "adjustment_minus",
];

export function InventoryMovementHistory({
  data,
  fixedItem,
  onClose,
}: {
  data: InventoryData;
  fixedItem?: InventoryItem | null;
  onClose?: () => void;
}) {
  const { t, language } = useLanguage();
  const c = t.inventory;

  const [movementType, setMovementType] = useState("");
  const [driverId, setDriverId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [itemId, setItemId] = useState(fixedItem?.id ?? "");
  const [fromDate, setFromDate] = useState("");
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest" | "largest">("newest");

  const driverById = useMemo(
    () => new Map(data.drivers.map((driver) => [String(driver.id), driver])),
    [data.drivers]
  );

  const vehicleById = useMemo(
    () => new Map(data.vehicles.map((vehicle) => [String(vehicle.id), vehicle])),
    [data.vehicles]
  );

  const itemById = useMemo(
    () => new Map(data.items.map((item) => [item.id, item])),
    [data.items]
  );

  const variantById = useMemo(
    () => new Map(data.variants.map((variant) => [variant.id, variant])),
    [data.variants]
  );

  const rows = useMemo(
    () =>
      data.movements
        .filter(
          (movement) =>
            (!movementType || movement.movement_type === movementType) &&
            (!driverId || String(movement.driver_id) === driverId) &&
            (!vehicleId || String(movement.vehicle_id) === vehicleId) &&
            (!itemId || movement.item_id === itemId) &&
            (!fromDate || movement.occurred_at.slice(0, 10) >= fromDate)
        )
        .sort((a, b) => {
          if (sortOrder === "oldest") {
            return new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime();
          }

          if (sortOrder === "largest") {
            return Math.abs(Number(b.quantity || 0)) - Math.abs(Number(a.quantity || 0));
          }

          return new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime();
        }),
    [data.movements, movementType, driverId, vehicleId, itemId, fromDate, sortOrder]
  );

  const label = (movement: InventoryMovement) =>
    movement.movement_type === "received"
      ? language === "th"
        ? "รับสต็อก"
        : "Received"
      : movement.movement_type === "issued_to_driver"
      ? language === "th"
        ? "จ่ายให้คนขับ"
        : "Issued to driver"
      : movement.movement_type === "issued_to_vehicle"
      ? language === "th"
        ? "จ่ายให้รถ"
        : "Issued to vehicle"
      : movement.movement_type === "general_use"
      ? c.generalUse
      : movement.movement_type === "adjustment_plus"
      ? language === "th"
        ? "ปรับเพิ่ม"
        : "Stock added"
      : language === "th"
      ? "ปรับลด"
      : "Stock removed";

  const target = (movement: InventoryMovement) => {
    if (movement.driver_id) {
      const driver = driverById.get(String(movement.driver_id));
      return driver?.name ?? "Unknown driver";
    }

    if (movement.vehicle_id) {
      const vehicle = vehicleById.get(String(movement.vehicle_id));
      return vehicle?.vehicle_reg || vehicle?.registration || "Unknown vehicle";
    }

    if (movement.movement_type === "general_use") {
      return c.generalUse;
    }

    return null;
  };

  const date = (value: string) =>
    new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));

  const isIssued = (movement: InventoryMovement) =>
    issueTypes.includes(movement.movement_type);

  const isAdjustmentMinus = (movement: InventoryMovement) =>
    movement.movement_type === "adjustment_minus";

  const isNegative = (movement: InventoryMovement) =>
    negativeTypes.includes(movement.movement_type);

  const auditLabel = (movement: InventoryMovement) =>
    movement.movement_type === "received"
      ? language === "th"
        ? "บันทึกโดย"
        : "Recorded by"
      : movement.movement_type === "adjustment_plus" ||
        movement.movement_type === "adjustment_minus"
      ? language === "th"
        ? "ปรับโดย"
        : "Adjusted by"
      : language === "th"
      ? "จ่ายโดย"
      : "Issued by";

  const totals = useMemo(() => {
    let received = 0;
    let issued = 0;

    for (const movement of rows) {
      const qty = Number(movement.quantity || 0);
      if (isNegative(movement)) issued += qty;
      else received += qty;
    }

    return {
      received,
      issued,
      net: received - issued,
    };
  }, [rows]);

  const hasFilters =
    Boolean(movementType) ||
    Boolean(driverId) ||
    Boolean(vehicleId) ||
    Boolean(itemId && !fixedItem) ||
    Boolean(fromDate);

  const clearFilters = () => {
    setMovementType("");
    setDriverId("");
    setVehicleId("");
    if (!fixedItem) setItemId("");
    setFromDate("");
  };

  const content = (
    <section className="surface-card overflow-hidden">
      <div className="border-b border-slate-100 px-5 py-5 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-violet-600">
              {language === "th" ? "บัญชีสต็อก" : "STOCK LEDGER"}
            </p>
            <h2 className="mt-1 text-xl font-black text-slate-950">
              {fixedItem
                ? `${inventoryDisplayName(fixedItem, language)} · ${
                    language === "th" ? "ประวัติสต็อก" : "Movement history"
                  }`
                : language === "th"
                ? "ประวัติสต็อก"
                : "Inventory History"}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {language === "th"
                ? "ตรวจสอบการรับ จ่าย และการปรับสต็อก พร้อมผู้รับผิดชอบและยอดคงเหลือ"
                : "A clear audit trail of stock received, issued and adjusted."}
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            {!fixedItem ? (
              <select
                value={sortOrder}
                onChange={(event) =>
                  setSortOrder(event.target.value as "newest" | "oldest" | "largest")
                }
                className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm outline-none transition focus:border-violet-300"
                aria-label="Sort inventory movements"
              >
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="largest">Largest change</option>
              </select>
            ) : null}
            <span className="rounded-xl bg-violet-50 px-3 py-2 text-xs font-bold text-violet-700">
              {rows.length} {rows.length === 1 ? "record" : "records"}
            </span>
            {onClose ? (
              <button
                type="button"
                onClick={onClose}
                className="btn-icon h-11 w-11"
                aria-label={c.cancel}
              >
                <X className="h-5 w-5" />
              </button>
            ) : null}
          </div>
        </div>

        <div className="mt-4 grid gap-px overflow-hidden rounded-2xl border border-slate-100 bg-slate-100 sm:grid-cols-3">
          <div className="bg-emerald-50/70 px-4 py-2.5">
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-emerald-700">
              {language === "th" ? "รับเข้า" : "Received"}
            </p>
            <p className="mt-0.5 text-lg font-black text-slate-950">+{totals.received}</p>
            <p className="mt-0.5 text-xs text-slate-500">Units added in this view</p>
          </div>

          <div className="bg-rose-50/60 px-4 py-2.5">
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-rose-700">
              {language === "th" ? "จ่ายออก" : "Issued / removed"}
            </p>
            <p className="mt-0.5 text-lg font-black text-slate-950">−{totals.issued}</p>
            <p className="mt-0.5 text-xs text-slate-500">Units taken from stock</p>
          </div>

          <div className="bg-violet-50/70 px-4 py-2.5">
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-violet-700">
              {language === "th" ? "สุทธิ" : "Net movement"}
            </p>
            <p
              className={`mt-0.5 text-lg font-black ${
                totals.net < 0 ? "text-rose-700" : "text-slate-950"
              }`}
            >
              {totals.net > 0 ? "+" : ""}
              {totals.net}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">Across filtered records</p>
          </div>
        </div>
      </div>

      <div className="border-b border-slate-100 bg-slate-50/50 px-5 py-4 sm:px-6">
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_1fr_190px]">
          <select
            value={movementType}
            onChange={(event) => setMovementType(event.target.value)}
            className="form-input border bg-white"
          >
            <option value="">{c.allMovements}</option>
            <option value="received">{language === "th" ? "รับสต็อก" : "Received"}</option>
            <option value="issued_to_driver">
              {language === "th" ? "จ่ายให้คนขับ" : "Issued to driver"}
            </option>
            <option value="issued_to_vehicle">
              {language === "th" ? "จ่ายให้รถ" : "Issued to vehicle"}
            </option>
            <option value="general_use">{c.generalUse}</option>
            <option value="adjustment_plus">
              {language === "th" ? "ปรับเพิ่ม" : "Stock added"}
            </option>
            <option value="adjustment_minus">
              {language === "th" ? "ปรับลด" : "Stock removed"}
            </option>
          </select>

          <select
            value={driverId}
            onChange={(event) => {
              setDriverId(event.target.value);
              if (event.target.value) setMovementType("issued_to_driver");
            }}
            className="form-input border bg-white"
          >
            <option value="">{c.allDrivers}</option>
            {data.drivers
              .filter((driver) => driver.active !== false)
              .map((driver) => (
                <option key={driver.id} value={String(driver.id)}>
                  {driver.name}
                </option>
              ))}
          </select>

          <select
            value={vehicleId}
            onChange={(event) => {
              setVehicleId(event.target.value);
              if (event.target.value) setMovementType("issued_to_vehicle");
            }}
            className="form-input border bg-white"
          >
            <option value="">{c.allVehicles}</option>
            {data.vehicles
              .filter((vehicle) => vehicle.active !== false)
              .map((vehicle) => (
                <option key={vehicle.id} value={String(vehicle.id)}>
                  {vehicle.vehicle_reg || vehicle.registration}
                </option>
              ))}
          </select>

          {!fixedItem ? (
            <select
              value={itemId}
              onChange={(event) => setItemId(event.target.value)}
              className="form-input border bg-white"
            >
              <option value="">{c.allItems}</option>
              {data.items
                .filter((item) => item.active !== false)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {inventoryDisplayName(item, language)}
                  </option>
                ))}
            </select>
          ) : (
            <div className="hidden xl:block" />
          )}

          <label className="relative">
            <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-400" />
            <input
              type="date"
              value={fromDate}
              onChange={(event) => setFromDate(event.target.value)}
              aria-label={c.fromDate}
              className="form-input w-full border bg-white pl-9"
            />
          </label>
        </div>

        {hasFilters ? (
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={clearFilters}
              className="text-xs font-bold text-violet-700 hover:text-violet-900"
            >
              Clear filters
            </button>
          </div>
        ) : null}
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[880px]">
          <div className="grid grid-cols-[minmax(260px,1.45fr)_minmax(250px,1fr)_120px_150px] bg-violet-50/60 px-5 py-3 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500 sm:px-6">
            <span>Item & date</span>
            <span>Movement / assignment</span>
            <span className="text-right">Change</span>
            <span className="text-right">Stock balance</span>
          </div>

          {rows.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
                <Search className="h-5 w-5" />
              </div>
              <p className="mt-3 font-bold text-slate-700">No matching movements</p>
              <p className="mt-1 text-sm text-slate-500">
                Try changing the filters above.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {rows.map((movement) => {
                const item = itemById.get(movement.item_id);
                const variant = variantById.get(movement.variant_id);
                const issued = isIssued(movement);
                const negative = isNegative(movement);
                const adjustmentMinus = isAdjustmentMinus(movement);
                const targetName = target(movement);

                const tone = issued
                  ? {
                      icon: "bg-violet-50 text-violet-700",
                      badge: "bg-violet-50 text-violet-700",
                      accent: "border-l-violet-300",
                    }
                  : adjustmentMinus
                  ? {
                      icon: "bg-amber-50 text-amber-700",
                      badge: "bg-amber-50 text-amber-700",
                      accent: "border-l-amber-300",
                    }
                  : {
                      icon: "bg-emerald-50 text-emerald-700",
                      badge: "bg-emerald-50 text-emerald-700",
                      accent: "border-l-emerald-300",
                    };

                return (
                  <article
                    key={movement.id}
                    className={`grid grid-cols-[minmax(260px,1.45fr)_minmax(250px,1fr)_120px_150px] items-center border-l-4 bg-white px-5 py-3.5 transition hover:bg-slate-50/80 sm:px-6 ${tone.accent}`}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tone.icon}`}
                      >
                        {negative ? (
                          <ArrowUpFromLine className="h-4 w-4" />
                        ) : (
                          <ArrowDownToLine className="h-4 w-4" />
                        )}
                      </div>

                      <div className="min-w-0">
                        <p className="truncate text-[15px] font-black tracking-[-0.01em] text-slate-950">
                          {item
                            ? inventoryDisplayName(item, language)
                            : "Unknown item"}
                          {variant && !variant.is_default ? ` · ${variant.name}` : ""}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {date(movement.occurred_at)}
                        </p>
                      </div>
                    </div>

                    <div className="min-w-0 pr-4">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold ${tone.badge}`}
                      >
                        {label(movement)}
                      </span>

                      {targetName ? (
                        <p className="mt-1.5 truncate text-sm font-extrabold text-slate-800">
                          {targetName}
                        </p>
                      ) : null}

                      <p className={`${targetName ? "mt-0.5" : "mt-1.5"} truncate text-xs text-slate-500`}>
                        {auditLabel(movement)}:{" "}
                        {movement.created_by_name || movement.created_by || "—"}
                      </p>
                    </div>

                    <div className="text-right">
                      <span
                        className={`inline-flex min-w-14 justify-center rounded-xl px-3 py-2 text-base font-black ${
                          negative
                            ? "bg-rose-50 text-rose-700"
                            : "bg-emerald-50 text-emerald-700"
                        }`}
                      >
                        {negative ? "−" : "+"}
                        {movement.quantity}
                      </span>
                    </div>

                    <div className="text-right">
                      <p className="text-lg font-black text-slate-950">
                        {movement.new_quantity}
                      </p>
                      <p className="mt-0.5 text-[11px] font-medium text-slate-400">
                        {movement.previous_quantity} → {movement.new_quantity}
                      </p>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );

  return onClose ? (
    <div className="fixed inset-0 z-[70] overflow-y-auto bg-slate-950/40 p-3 backdrop-blur-sm sm:p-6">
      <div className="mx-auto max-w-6xl">{content}</div>
    </div>
  ) : (
    content
  );
}
