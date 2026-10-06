import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabaseAdmin } from "@/lib/admin-user-management-server";
import { bangkokDateKey, DRIVER_JOB_SELECT, DriverPortalError, listAssignedDriverJobs, toDriverJob, type DriverPortalSession } from "@/lib/driver-portal-server";
import type { DriverJobEvent, DriverJobEventType, DriverPortalJob } from "@/lib/driver-portal";
import type { DriverWork, OperationsResult } from "@/lib/driver-operations";
import { readDriverProfile } from "@/lib/driver-profile-server";
import { pickupWaitMinutes } from "@/lib/driver-operations";

export async function eventsForJobs(admin: SupabaseClient, ids: string[], driverId?: string) {
  const result = new Map<string, DriverJobEvent[]>();
  for (let start = 0; start < ids.length; start += 100) {
    for (let offset = 0; ; offset += 500) {
      let query = admin.from("driver_job_events").select("id,booking_id,event_type,event_time,latitude,longitude").in("booking_id", ids.slice(start, start + 100));
      if (driverId) query = query.eq("driver_id", driverId);
      const { data, error } = await query.order("event_time").order("id").range(offset, offset + 499);
      if (error || !data) throw new DriverPortalError(503, "Progress unavailable.");
      for (const row of data) {
        const entries = result.get(row.booking_id) || [];
        entries.push({ id: row.id, eventType: row.event_type as DriverJobEventType, eventTime: row.event_time, latitude: row.latitude, longitude: row.longitude });
        result.set(row.booking_id, entries);
      }
      if (data.length < 500) break;
    }
  }
  return result;
}
/** Keep a started, unfinished assignment visible after its Bangkok booking day. */
export async function pastActiveDriverJobs(admin: SupabaseClient, session: DriverPortalSession, today = bangkokDateKey()) {
  const jobs: DriverPortalJob[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await admin.from("booking_diary")
      .select(DRIVER_JOB_SELECT + ",started:driver_job_events!inner(id),finished:driver_job_events(id)")
      .eq("driver_id", session.driverId).lt("booking_date", today)
      .eq("started.driver_id", session.driverId).eq("started.event_type", "pickup_arrived")
      .eq("finished.event_type", "job_completed").is("finished", null)
      .order("booking_date").order("id").range(offset, offset + 499);
    if (error || !data) throw new DriverPortalError(503, "Active jobs unavailable.");
    jobs.push(...data.map(row => toDriverJob(row as unknown as Record<string, unknown>, session)));
    if (data.length < 500) return jobs;
  }
}

export async function driverHomeWork(session: DriverPortalSession, today = bangkokDateKey()): Promise<DriverWork[]> {
  const admin = createServerSupabaseAdmin();
  const [scheduled, active] = await Promise.all([
    listAssignedDriverJobs(session, today), pastActiveDriverJobs(admin, session, today)
  ]);
  const jobs = [...new Map([...scheduled, ...active].map(job => [job.id, job])).values()];
  const events = await eventsForJobs(admin, jobs.map(job => job.id), session.driverId);
  return jobs.map(job => ({ job, events: events.get(job.id) || [] }));
}
export async function driverHistoryWork(session: DriverPortalSession, page = 0) {
  const admin = createServerSupabaseAdmin();
  const { data, error } = await admin.from("driver_job_events").select("booking_id,event_time")
    .eq("driver_id", session.driverId).eq("event_type", "job_completed").order("event_time", { ascending: false }).order("id").range(page * 20, page * 20 + 20);
  if (error || !data) throw new DriverPortalError(503, "History unavailable.");
  const hasMore = data.length > 20;
  const ids = data.slice(0, 20).map((r) => r.booking_id);
  if (!ids.length) return { rows: [], hasMore: false };
  // Recheck current relational ownership; an event alone does not authorize a booking.
  const bookings = await admin.from("booking_diary").select(DRIVER_JOB_SELECT).eq("driver_id", session.driverId).in("id", ids);
  if (bookings.error || !bookings.data) throw new DriverPortalError(503, "History unavailable.");
  const jobs = new Map(bookings.data.map((r) => { const job = toDriverJob(r as unknown as Record<string, unknown>, session); return [job.id, job]; }));
  const events = await eventsForJobs(admin, [...jobs.keys()], session.driverId);
  return { rows: ids.flatMap((id) => { const job = jobs.get(id); return job ? [{ job, events: events.get(id) || [] }] : []; }), hasMore };
}
export async function driverOperations(admin: SupabaseClient): Promise<OperationsResult> {
  const date = bangkokDateKey();
  const bookings: Record<string, unknown>[] = [];
  for (let offset = 0; ; offset += 500) {
    const result = await admin.from("booking_diary").select(`${DRIVER_JOB_SELECT},driver_id`).eq("booking_date", date).not("driver_id", "is", null).order("pickup_time", { nullsFirst: false }).order("id").range(offset, offset + 499);
    if (result.error || !result.data) throw new DriverPortalError(503, "Operations unavailable.");
    bookings.push(...result.data as unknown as Record<string, unknown>[]);
    if (result.data.length < 500) break;
  }
  const rows = await operationsRows(admin, bookings);
  const fetchedAt = new Date().toISOString();
  return { date, fetchedAt, rows: rows.map((row) => ({ ...row, waitingMinutes: pickupWaitMinutes(row.events, fetchedAt) })) };
}
export async function operationsRows(admin: SupabaseClient, bookings: Record<string, unknown>[]) {
  const driverIds = [...new Set(bookings.map((r) => String(r.driver_id)))];
  const identities = new Map<string, { driverId: string; driverName: string; vehicleRegistration: string | null; vehicleType: string | null; accountActive: boolean | null; authId: string | null }>();
  for (let i = 0; i < driverIds.length; i += 100) {
    const ids = driverIds.slice(i, i + 100);
    const [drivers, accounts] = await Promise.all([
      admin.from("drivers").select("id,name,vehicle_reg,vehicle_type,active").in("id", ids),
      admin.from("driver_accounts").select("driver_id,auth_user_id,active").in("driver_id", ids)
    ]);
    if (drivers.error || accounts.error || !drivers.data || !accounts.data) throw new DriverPortalError(503, "Drivers unavailable.");
    for (const d of drivers.data) {
      const a = accounts.data.find((r) => String(r.driver_id) === String(d.id));
      identities.set(String(d.id), { driverId: String(d.id), driverName: d.name, vehicleRegistration: d.vehicle_reg, vehicleType: d.vehicle_type, accountActive: a ? a.active === true && d.active === true : null, authId: a?.auth_user_id || null });
    }
  }
  const profiles = new Map<string, Awaited<ReturnType<typeof readDriverProfile>>>();
  const linked = [...identities.values()].filter((d) => d.authId);
  for (let i = 0; i < linked.length; i += 10) await Promise.all(linked.slice(i, i + 10).map(async (d) => { profiles.set(d.driverId, await readDriverProfile(d.authId!, d)); }));
  const events = await eventsForJobs(admin, bookings.map((b) => String(b.id)));
  return bookings.map((b) => {
    const identity = identities.get(String(b.driver_id));
    if (!identity) throw new DriverPortalError(503, "Assigned driver unavailable.");
    const job = toDriverJob(b, identity);
    return { job, events: events.get(job.id) || [], driverId: identity.driverId, driverName: identity.driverName, accountActive: identity.accountActive, profile: profiles.get(identity.driverId) || null };
  });
}

export async function operationsHistory(admin: SupabaseClient, params: URLSearchParams) {
  const page = Number(params.get("page") || "0");
  if (!Number.isInteger(page) || page < 0 || page > 10000) throw new DriverPortalError(400, "Invalid page.");
  const today = bangkokDateKey();
  let query = admin.from("driver_job_events")
    .select(`booking_id,driver_id,event_time,booking:booking_diary!inner(${DRIVER_JOB_SELECT},driver_id)`)
    .eq("event_type", "job_completed").lt("event_time", `${today}T00:00:00+07:00`);
  for (const [key, operator] of [["from", "gte"], ["to", "lt"]] as const) {
    const value = params.get(key);
    if (!value) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value))) throw new DriverPortalError(400, "Invalid date.");
    if (operator === "gte") query = query.gte("event_time", `${value}T00:00:00+07:00`);
    else { const next = new Date(`${value}T00:00:00+07:00`); next.setUTCDate(next.getUTCDate() + 1); query = query.lt("event_time", next.toISOString()); }
  }
  const search = (params.get("q") || "").trim();
  if (search.length > 100) throw new DriverPortalError(400, "Search too long.");
  if (search) {
    // Only literal text can enter PostgREST filter syntax; never interpolate punctuation.
    const literal = search.replace(/[^\p{L}\p{M}\p{N} \-]/gu, " ").trim();
    if (!literal) return { rows: [], hasMore: false };
    const pattern = `%${literal}%`;
    const [drivers, clients] = await Promise.all([
      admin.from("drivers").select("id").ilike("name", pattern).limit(1000),
      admin.from("clients").select("id").ilike("name", pattern).limit(1000)
    ]);
    if (drivers.error || clients.error) throw new DriverPortalError(503, "Search unavailable.");
    const clauses = ["pickup", "dropoff", "vehicle_registration"].map((field) => `${field}.ilike.${pattern}`);
    if (drivers.data?.length) clauses.push(`driver_id.in.(${drivers.data.map((d) => d.id).join(",")})`);
    if (clients.data?.length) clauses.push(`client_id.in.(${clients.data.map((c) => c.id).join(",")})`);
    query = query.or(clauses.join(","), { referencedTable: "booking" });
  }
  const result = await query.order("event_time", { ascending: false }).order("id", { ascending: false }).range(page * 20, page * 20 + 20);
  if (result.error || !result.data) throw new DriverPortalError(503, "History unavailable.");
  // History identifies the driver who actually completed the job, even if the
  // booking's assignment is later changed. Live Operations still uses assignment.
  const bookings = (result.data as unknown as { driver_id: string | number; booking: Record<string, unknown> }[]).slice(0, 20).map((row) => ({ ...row.booking, driver_id: row.driver_id }));
  return { rows: await operationsRows(admin, bookings), hasMore: result.data.length > 20 };
}
