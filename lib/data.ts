"use client";

import { supabase } from "@/lib/supabase";
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
    .order("date", { ascending: false })
    .order("id", { ascending: false });

  if (error) {
    throw error;
  }

  return (data ?? []) as FuelLogWithDriver[];
}

export async function fetchTransfers() {
  const { data, error } = await supabase
    .from("bank_transfers")
    .select("*")
    .order("date", { ascending: false })
    .order("id", { ascending: false });

  if (error) {
    throw error;
  }

  return (data ?? []) as BankTransferWithDriver[];
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
  const cleaned = stripUndefined(rest);
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

export async function saveTransfer(payload: Partial<BankTransfer>) {
  const { id, ...rest } = payload;
  const cleaned = stripUndefined(rest);
  const { data, error } = id
    ? await supabase.from("bank_transfers").update(cleaned).eq("id", id).select().single()
    : await supabase.from("bank_transfers").insert(cleaned).select().single();

  if (error) {
    throw error;
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
