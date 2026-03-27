"use client";

import { supabase } from "@/lib/supabase";
import {
  normalizeFuelTypeKey,
  normalizePaymentMethodKey,
  normalizeTransferTypeKey
} from "@/lib/localized-values";
import type {
  BankTransfer,
  BankTransferWithDriver,
  Driver,
  FuelLog,
  FuelLogWithDriver,
  WeeklyMileageEntry
} from "@/types/database";

function stripUndefined<T extends Record<string, unknown>>(payload: T) {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined)
  ) as T;
}

export async function fetchDrivers() {
  const { data, error } = await supabase
    .from("drivers")
    .select("*")
    .order("name", { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []) as Driver[];
}

export async function fetchFuelLogs() {
  const { data, error } = await supabase
    .from("fuel_logs")
    .select("*")
    .order("id", { ascending: false })
    .order("date", { ascending: false });

  if (error) {
    throw error;
  }

  return ((data ?? []) as FuelLogWithDriver[]).map((log) => ({
    ...log,
    fuel_type: normalizeFuelTypeKey(log.fuel_type) ?? log.fuel_type,
    payment_method: normalizePaymentMethodKey(log.payment_method) ?? log.payment_method
  }));
}

export async function fetchTransfers() {
  const { data: transferRows, error: transferError } = await supabase
    .from("bank_transfers")
    .select("id, transfer_date, driver_id, driver, vehicle_reg, amount, transfer_type, notes")
    .order("transfer_date", { ascending: false })
    .order("id", { ascending: false });

  if (transferError) {
    console.error("fetchTransfers bank_transfers error:", transferError);
    throw transferError;
  }

  const { data: driverRows, error: driverError } = await supabase
    .from("drivers")
    .select("id, name");

  if (driverError) {
    console.error("fetchTransfers drivers error:", driverError);
    throw driverError;
  }

  const driverLookup = new Map(
    ((driverRows ?? []) as Array<{ id: string; name: string | null }>).map((driver) => [
      String(driver.id),
      driver.name ?? ""
    ])
  );

  return ((transferRows ?? []) as Array<{
    id: string;
    transfer_date: string | null;
    driver_id: string | null;
    driver: string | null;
    vehicle_reg: string;
    amount: number;
    transfer_type: string;
    notes: string | null;
  }>).map((transfer) => {
    return {
      id: transfer.id,
      driver_id: transfer.driver_id ?? "",
      driver:
        (transfer.driver_id ? driverLookup.get(String(transfer.driver_id)) : "") ??
        transfer.driver ??
        "",
      vehicle_reg: transfer.vehicle_reg,
      amount: transfer.amount,
      transfer_type: normalizeTransferTypeKey(transfer.transfer_type) ?? transfer.transfer_type,
      notes: transfer.notes,
      date: transfer.transfer_date ?? ""
    };
  }) as BankTransferWithDriver[];
}

export async function fetchWeeklyMileage() {
  const { data, error } = await supabase
    .from("weekly_mileage")
    .select("*")
    .order("week_ending", { ascending: false })
    .order("id", { ascending: false });

  if (error) {
    throw error;
  }

  return (data ?? []) as WeeklyMileageEntry[];
}

export async function saveDriver(payload: Partial<Driver>) {
  const { id, ...rest } = payload;
  const cleaned = stripUndefined(rest);
  const { data, error } = id
    ? await supabase.from("drivers").update(cleaned).eq("id", id).select().single()
    : await supabase.from("drivers").insert(cleaned).select().single();

  if (error) {
    throw error;
  }

  return data as Driver;
}

export async function deleteDriver(id: string) {
  const { error } = await supabase.from("drivers").delete().eq("id", id);

  if (error) {
    throw error;
  }
}

export async function saveFuelLog(payload: Partial<FuelLog>) {
  const { id, ...rest } = payload;
  const cleaned = stripUndefined({
    ...rest,
    fuel_type: normalizeFuelTypeKey(rest.fuel_type) ?? rest.fuel_type,
    payment_method: normalizePaymentMethodKey(rest.payment_method) ?? rest.payment_method
  });
  const { data, error } = id
    ? await supabase.from("fuel_logs").update(cleaned).eq("id", id).select().single()
    : await supabase.from("fuel_logs").insert(cleaned).select().single();

  if (error) {
    throw error;
  }

  return data as FuelLog;
}

export async function deleteFuelLog(id: string) {
  const { error } = await supabase.from("fuel_logs").delete().eq("id", id);

  if (error) {
    throw error;
  }
}

export async function saveTransfer(
  payload: Partial<BankTransfer> & { transfer_date?: string }
) {
  const { id, ...rest } = payload;
  const cleaned = stripUndefined({
    ...rest,
    transfer_type: normalizeTransferTypeKey(rest.transfer_type) ?? rest.transfer_type
  });

  const { data, error } = id
    ? await supabase.from("bank_transfers").update(cleaned).eq("id", id).select().single()
    : await supabase.from("bank_transfers").insert(cleaned).select().single();

  if (error) {
    throw new Error(error.message || error.details || error.hint || "Unable to save transfer.");
  }

  return data as BankTransfer;
}

export async function deleteTransfer(id: string) {
  const { error } = await supabase.from("bank_transfers").delete().eq("id", id);

  if (error) {
    throw error;
  }
}

export async function saveWeeklyMileage(payload: Partial<WeeklyMileageEntry>) {
  const { id, ...rest } = payload;
  const cleaned = stripUndefined(rest);
  const { data, error } = id
    ? await supabase
        .from("weekly_mileage")
        .update(cleaned)
        .eq("id", id)
        .select()
        .single()
    : await supabase.from("weekly_mileage").insert(cleaned).select().single();

  if (error) {
    throw error;
  }

  return data as WeeklyMileageEntry;
}

export async function deleteWeeklyMileage(id: string) {
  const { error } = await supabase.from("weekly_mileage").delete().eq("id", id);

  if (error) {
    throw error;
  }
}
