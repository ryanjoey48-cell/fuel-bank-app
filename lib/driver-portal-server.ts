import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { cache } from "react";
import {
  createServerSupabaseAdmin,
  findActiveDriverAccount,
  findDriverAccessRequest
} from "@/lib/admin-user-management-server";
import type { DriverPortalIdentity, DriverPortalJob } from "@/lib/driver-portal";

export const DRIVER_SESSION_COOKIE = "ees_driver_session";
export const DRIVER_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 14;

type DriverAccountRow = {
  id: string;
  auth_user_id: string;
  driver_id: string | number;
  active: boolean;
};

type DriverRow = {
  id: string | number;
  name: string;
  vehicle_reg: string | null;
  vehicle_type: string | null;
  active: boolean;
};

type DriverSessionRow = {
  id: string;
  driver_account_id: string;
  expires_at: string;
};

export type DriverPortalSession = DriverPortalIdentity & {
  accountId: string;
  authUserId: string;
  sessionId: string;
};

export class DriverPortalError extends Error {
  status: number;
  destination?: "/access/pending" | "/access/rejected";

  constructor(status: number, message: string, destination?: "/access/pending" | "/access/rejected") {
    super(message);
    this.name = "DriverPortalError";
    this.status = status;
    this.destination = destination;
  }
}

function publicSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new DriverPortalError(503, "Driver sign-in is not configured.");
  return { url, anonKey };
}

function createDriverAuthClient() {
  const { url, anonKey } = publicSupabaseConfig();
  return createClient(url, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false
    }
  });
}

function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function isMissingDriverPortalTable(error: { code?: string; message?: string } | null) {
  return error?.code === "42P01" || error?.code === "PGRST205" || /driver_(accounts|sessions)/i.test(error?.message ?? "");
}

async function loadDriverIdentity(account: DriverAccountRow): Promise<DriverPortalIdentity> {
  const admin = createServerSupabaseAdmin();
  const { data, error } = await admin
    .from("drivers")
    .select("id,name,vehicle_reg,vehicle_type,active")
    .eq("id", account.driver_id)
    .maybeSingle();

  if (error) throw new DriverPortalError(503, "Unable to load the linked driver record.");
  const driver = data as DriverRow | null;
  if (!driver || !driver.active) {
    throw new DriverPortalError(403, "Driver account not configured. Please contact the office.");
  }

  return {
    driverId: String(driver.id),
    driverName: driver.name,
    vehicleRegistration: driver.vehicle_reg?.trim() || null,
    vehicleType: driver.vehicle_type?.trim() || null
  };
}

export async function createDriverPortalSession(email: string, password: string) {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !password || password.length < 6) {
    throw new DriverPortalError(400, "Enter a valid email address and password.");
  }

  const auth = createDriverAuthClient();
  const { data: authData, error: authError } = await auth.auth.signInWithPassword({
    email: normalizedEmail,
    password
  });

  if (authError || !authData.user) {
    throw new DriverPortalError(401, "Unable to sign in. Check your email and password.");
  }

  return createDriverPortalSessionForAuthUser(authData.user.id);
}

export async function createDriverPortalSessionForAuthUser(authUserId: string) {
  const admin = createServerSupabaseAdmin();
  let account: DriverAccountRow | null;
  try {
    account = await findActiveDriverAccount(admin, authUserId) as DriverAccountRow | null;
  } catch (error) {
    if (isMissingDriverPortalTable(error as { code?: string; message?: string })) {
      throw new DriverPortalError(503, "Driver portal setup is incomplete. Please contact the office.");
    }
    throw new DriverPortalError(503, "Unable to verify the driver account.");
  }

  if (!account) {
    const accessRequest = await findDriverAccessRequest(admin, authUserId);
    if (accessRequest?.status === "pending" || (accessRequest?.status === "approved" && accessRequest.requested_account_type === "driver")) {
      throw new DriverPortalError(403, "Driver access is awaiting approval.", "/access/pending");
    }
    if (accessRequest?.status === "rejected") {
      throw new DriverPortalError(403, "Driver access request was rejected.", "/access/rejected");
    }
    throw new DriverPortalError(403, "Driver account not configured. Please contact the office.");
  }
  const identity = await loadDriverIdentity(account);
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + DRIVER_SESSION_MAX_AGE_SECONDS * 1000).toISOString();
  const { data: inserted, error: sessionError } = await admin
    .from("driver_sessions")
    .insert({
      driver_account_id: account.id,
      token_hash: hashSessionToken(token),
      expires_at: expiresAt
    })
    .select("id")
    .single();

  if (sessionError || !inserted) {
    throw new DriverPortalError(503, "Unable to start the driver session.");
  }

  return {
    token,
    session: {
      ...identity,
      accountId: account.id,
      authUserId: account.auth_user_id,
      sessionId: String(inserted.id)
    } satisfies DriverPortalSession
  };
}

export const getDriverPortalSession = cache(async (): Promise<DriverPortalSession | null> => {
  const cookieStore = await cookies();
  const token = cookieStore.get(DRIVER_SESSION_COOKIE)?.value;
  if (!token) return null;

  const admin = createServerSupabaseAdmin();
  const { data, error } = await admin
    .from("driver_sessions")
    .select("id,driver_account_id,expires_at")
    .eq("token_hash", hashSessionToken(token))
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (error || !data) return null;
  const sessionRow = data as DriverSessionRow;

  const { data: accountData, error: accountError } = await admin
    .from("driver_accounts")
    .select("id,auth_user_id,driver_id,active")
    .eq("id", sessionRow.driver_account_id)
    .eq("active", true)
    .maybeSingle();

  if (accountError || !accountData) return null;
  const account = accountData as DriverAccountRow;

  try {
    const identity = await loadDriverIdentity(account);
    return {
      ...identity,
      accountId: account.id,
      authUserId: account.auth_user_id,
      sessionId: sessionRow.id
    };
  } catch {
    return null;
  }
});

export async function revokeDriverPortalSession(token: string | undefined) {
  if (!token) return;
  const admin = createServerSupabaseAdmin();
  await admin
    .from("driver_sessions")
    .update({ revoked_at: new Date().toISOString() })
    .eq("token_hash", hashSessionToken(token))
    .is("revoked_at", null);
}

export function bangkokDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

export const DRIVER_JOB_SELECT = [
  "id",
  "booking_date",
  "pickup_time",
  "pickup",
  "pickup_address",
  "pickup_place_id",
  "pickup_lat",
  "pickup_lng",
  "dropoff",
  "dropoff_address",
  "dropoff_place_id",
  "dropoff_lat",
  "dropoff_lng",
  "vehicle",
  "vehicle_registration",
  "trailer_registration",
  "job_order_number",
  "map_resolution_status",
  "client:clients(name)"
].join(",");

function optionalNumber(value: unknown) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clientName(value: unknown) {
  const record = Array.isArray(value) ? value[0] : value;
  if (!record || typeof record !== "object") return null;
  const name = (record as { name?: unknown }).name;
  return typeof name === "string" && name.trim() ? name.trim() : null;
}

export function toDriverJob(row: Record<string, unknown>, identity: DriverPortalIdentity): DriverPortalJob {
  return {
    id: String(row.id),
    bookingDate: String(row.booking_date),
    pickupTime: typeof row.pickup_time === "string" ? row.pickup_time : null,
    clientName: clientName(row.client),
    pickupName: String(row.pickup ?? ""),
    pickupAddress: typeof row.pickup_address === "string" ? row.pickup_address : null,
    pickupPlaceId: typeof row.pickup_place_id === "string" ? row.pickup_place_id : null,
    pickupLat: optionalNumber(row.pickup_lat),
    pickupLng: optionalNumber(row.pickup_lng),
    dropoffName: String(row.dropoff ?? ""),
    dropoffAddress: typeof row.dropoff_address === "string" ? row.dropoff_address : null,
    dropoffPlaceId: typeof row.dropoff_place_id === "string" ? row.dropoff_place_id : null,
    dropoffLat: optionalNumber(row.dropoff_lat),
    dropoffLng: optionalNumber(row.dropoff_lng),
    vehicleRegistration: typeof row.vehicle_registration === "string" && row.vehicle_registration.trim()
      ? row.vehicle_registration.trim()
      : identity.vehicleRegistration,
    trailerRegistration: typeof row.trailer_registration === "string" && row.trailer_registration.trim()
      ? row.trailer_registration.trim()
      : null,
    vehicleType: typeof row.vehicle === "string" && row.vehicle.trim() ? row.vehicle.trim() : identity.vehicleType,
    jobOrderNumber: typeof row.job_order_number === "string" && row.job_order_number.trim()
      ? row.job_order_number.trim()
      : null,
    locationsVerified: row.map_resolution_status === "resolved"
  };
}

export async function listAssignedDriverJobs(session: DriverPortalSession) {
  const admin = createServerSupabaseAdmin();
  const today = bangkokDateKey();
  const jobs: DriverPortalJob[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await admin
      .from("booking_diary")
      .select(DRIVER_JOB_SELECT)
      .eq("driver_id", session.driverId)
      .gte("booking_date", today)
      .order("booking_date", { ascending: true })
      .order("pickup_time", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true })
      .range(offset, offset + 499);

    if (error) throw new DriverPortalError(503, "Unable to load assigned jobs.");
    jobs.push(...(data ?? []).map((row) => toDriverJob(row as unknown as Record<string, unknown>, session)));
    if (!data || data.length < 500) return jobs;
  }
}

export async function getAssignedDriverJob(session: DriverPortalSession, bookingId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(bookingId)) return null;
  const admin = createServerSupabaseAdmin();
  const { data, error } = await admin
    .from("booking_diary")
    .select(DRIVER_JOB_SELECT)
    .eq("id", bookingId)
    .eq("driver_id", session.driverId)
    .maybeSingle();

  if (error) throw new DriverPortalError(503, "Unable to load this job.");
  return data ? toDriverJob(data as unknown as Record<string, unknown>, session) : null;
}

