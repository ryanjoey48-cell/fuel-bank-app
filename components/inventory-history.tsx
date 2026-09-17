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

  const driverById = useMemo(
    () =>
      new Map(
        data.drivers.map((driver) => [String(driver.id), driver])
      ),
    [data.drivers]
  );

  const vehicleById = useMemo(
    () =>
      new Map(
        data.vehicles.map((vehicle) => [String(vehicle.id), vehicle])
      ),
    [data.vehicles]
  );

  const itemById = useMemo(
    () => new Map(data.items.map((item) => [item.id, item])),
    [data.items]
  );

  const variantById = useMemo(
    () =>
      new Map(
        data.variants.map((variant) => [variant.id, variant])
      ),
    [data.variants]
  );

  const rows = data.movements.filter(
    (movement) =>
      (!movementType ||
        movement.movement_type === movementType) &&
      (!driverId || String(movement.driver_id) === driverId) &&
      (!vehicleId || String(movement.vehicle_id) === vehicleId) &&
      (!itemId || movement.item_id === itemId) &&
      (!fromDate ||
        movement.occurred_at.slice(0, 10) >= fromDate)
  );

  const label = (movement: InventoryMovement) =>
    movement.movement_type === "received"
      ? c.received
      : movement.movement_type === "issued_to_driver"
      ? (language === "th" ? "จ่ายให้คนขับ" : "Given to Driver")
      : movement.movement_type === "issued_to_vehicle"
      ? (language === "th" ? "จ่ายให้รถ" : "Given to Vehicle")
      : movement.movement_type === "general_use"
      ? c.generalUse
      : movement.movement_type === "adjustment_plus"
      ? (language === "th" ? "เพิ่มสต็อก" : "Stock Added")
      : (language === "th" ? "ลดสต็อก" : "Stock Removed");

  const target = (movement: InventoryMovement) => {
    if (movement.driver_id) {
      const driver = driverById.get(String(movement.driver_id));
      return driver?.name ?? "Unknown driver";
    }

    if (movement.vehicle_id) {
      const vehicle = vehicleById.get(String(movement.vehicle_id));
      return (
        vehicle?.vehicle_reg ||
        vehicle?.registration ||
        "Unknown vehicle"
      );
    }

    if (movement.movement_type === "general_use") {
      return c.generalUse;
    }

    return null;
  };

  const date = (value: string) =>
    new Intl.DateTimeFormat(
      language === "th" ? "th-TH" : "en-GB",
      {
        dateStyle: "medium",
        timeStyle: "short",
      }
    ).format(new Date(value));

  const isIssued = (movement: InventoryMovement) =>
    issueTypes.includes(movement.movement_type);

  const isAdjustmentMinus = (movement: InventoryMovement) =>
    movement.movement_type === "adjustment_minus";

  const auditLabel = (movement: InventoryMovement) =>
    movement.movement_type === "received"
      ? language === "th" ? "บันทึกโดย" : "Recorded by"
      : movement.movement_type === "adjustment_plus" ||
        movement.movement_type === "adjustment_minus"
      ? language === "th" ? "ปรับโดย" : "Adjusted by"
      : language === "th" ? "จ่ายโดย" : "Given by";

  const content = (
    <section className="surface-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="section-title">
            {fixedItem
              ? `${inventoryDisplayName(
                  fixedItem,
                  language
                )} · ${language === "th" ? "ประวัติสต็อก" : "Inventory History"}`
              : language === "th"
              ? "ประวัติสต็อก"
              : "Inventory History"}
          </h2>

          <p className="section-subtitle">
            {language === "th"
              ? `${rows.length} รายการ`
              : `${rows.length} record${rows.length === 1 ? "" : "s"}`}
          </p>
        </div>

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

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <select
          value={movementType}
          onChange={(event) =>
            setMovementType(event.target.value)
          }
          className="form-input border"
        >
          <option value="">{c.allMovements}</option>
          <option value="received">{c.received}</option>
          <option value="issued_to_driver">
            {language === "th" ? "จ่ายให้คนขับ" : "Given to Driver"}
          </option>
          <option value="issued_to_vehicle">
            {language === "th" ? "จ่ายให้รถ" : "Given to Vehicle"}
          </option>
          <option value="general_use">{c.generalUse}</option>
          <option value="adjustment_plus">
            {language === "th" ? "เพิ่มสต็อก" : "Stock Added"}
          </option>
          <option value="adjustment_minus">
            {language === "th" ? "ลดสต็อก" : "Stock Removed"}
          </option>
        </select>

        <select
          value={driverId}
          onChange={(event) => {
            setDriverId(event.target.value);

            if (event.target.value) {
              setMovementType("issued_to_driver");
            }
          }}
          className="form-input border"
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

            if (event.target.value) {
              setMovementType("issued_to_vehicle");
            }
          }}
          className="form-input border"
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
            className="form-input border"
          >
            <option value="">{c.allItems}</option>

            {data.items.map((item) => (
              <option key={item.id} value={item.id}>
                {inventoryDisplayName(item, language)}
              </option>
            ))}
          </select>
        ) : (
          <div />
        )}

        <label className="relative">
          <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-400" />

          <input
            type="date"
            value={fromDate}
            onChange={(event) =>
              setFromDate(event.target.value)
            }
            aria-label={c.fromDate}
            className="form-input w-full border pl-9"
          />
        </label>
      </div>

      <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white">
        {rows.length === 0 ? (
          <div className="p-5 text-sm text-slate-500">
            {c.noMovements}
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {rows.map((movement) => {
              const item = itemById.get(movement.item_id);
              const variant = variantById.get(
                movement.variant_id
              );

              const issued = isIssued(movement);

              const negative = negativeTypes.includes(
                movement.movement_type
              );

              const adjustmentMinus = isAdjustmentMinus(movement);
              const targetName = target(movement);

              return (
                <article
                  key={movement.id}
                  className="grid gap-3 px-4 py-3 transition hover:bg-slate-50 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_110px]"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                        issued
                          ? "bg-violet-50 text-violet-700"
                          : adjustmentMinus
                          ? "bg-amber-50 text-amber-700"
                          : "bg-emerald-50 text-emerald-700"
                      }`}
                    >
                      {negative ? (
                        <ArrowUpFromLine className="h-4 w-4" />
                      ) : (
                        <ArrowDownToLine className="h-4 w-4" />
                      )}
                    </div>

                    <div className="min-w-0">
                      <p className="truncate font-bold text-slate-950">
                        {item
                          ? inventoryDisplayName(item, language)
                          : "Unknown item"}

                        {variant && !variant.is_default
                          ? ` · ${variant.name}`
                          : ""}
                      </p>

                      <p className="mt-0.5 text-xs text-slate-500">
                        {date(movement.occurred_at)}
                      </p>
                    </div>
                  </div>

                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex rounded-full px-2 py-1 text-[10px] font-black ${
                          negative
                            ? "bg-rose-100 text-rose-700"
                            : "bg-emerald-100 text-emerald-700"
                        }`}
                      >
                        {label(movement)}
                      </span>

                      {targetName ? (
                        <span className="truncate text-sm font-semibold text-slate-800">
                          {targetName}
                        </span>
                      ) : null}
                    </div>

                    <p className="mt-1 text-xs text-slate-500">
                      {auditLabel(movement)}:{" "}
                      {movement.created_by_name ||
                        movement.created_by}
                    </p>
                  </div>

                  <div className="text-left sm:text-right">
                    <p
                      className={`text-lg font-black ${
                        negative
                          ? "text-rose-700"
                          : "text-emerald-700"
                      }`}
                    >
                      {negative ? "−" : "+"}
                      {movement.quantity}
                    </p>

                    <p className="text-xs text-slate-500">
                      {movement.previous_quantity} →{" "}
                      {movement.new_quantity}
                    </p>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );

  return onClose ? (
    <div className="fixed inset-0 z-[70] overflow-y-auto bg-slate-950/40 p-3 backdrop-blur-sm sm:p-6">
      <div className="mx-auto max-w-5xl">{content}</div>
    </div>
  ) : (
    content
  );
}