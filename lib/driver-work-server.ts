import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabaseAdmin } from "@/lib/admin-user-management-server";
import { bangkokDateKey, DRIVER_JOB_SELECT, DriverPortalError, listAssignedDriverJobs, toDriverJob, type DriverPortalSession } from "@/lib/driver-portal-server";
import type { DriverJobEvent, DriverJobEventType, DriverPortalJob } from "@/lib/driver-portal";
import type { DriverWork, OperationsResult, OperationsRow, OperationsDriverDetail, OperationsHistoryResult } from "@/lib/driver-operations";
import { readDriverProfile } from "@/lib/driver-profile-server";
import { pickupWaitMinutes, jobStatus, driverCompletedOn, completedDriverEvent, hasOperationalAttention, shiftBangkokDate, driverHomeJobs } from "@/lib/driver-operations";

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
      .eq("started.event_type", "pickup_arrived")
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
  // Assignment authorizes these booking IDs; progress is a shared per-job sequence, even after a handoff.
  const events = await eventsForJobs(admin, jobs.map(job => job.id));
  return jobs.map(job => ({ job, events: events.get(job.id) || [] }));
}
export async function driverHistoryWork(session: DriverPortalSession, page = 0) {
  const admin = createServerSupabaseAdmin();
  const { data, error } = await admin.from("driver_job_events").select("booking_id,event_time")
    .eq("driver_id", session.driverId).eq("event_type", "job_completed").order("event_time", { ascending: false }).order("id", { ascending: false }).range(page * 20, page * 20 + 20);
  if (error || !data) throw new DriverPortalError(503, "History unavailable.");
  const hasMore = data.length > 20;
  const ids = data.slice(0, 20).map((r) => r.booking_id);
  if (!ids.length) return { rows: [], hasMore: false };
  // Completion ownership is historical: a later reassignment must not erase this driver's finished work.
  const bookings = await admin.from("booking_diary").select(DRIVER_JOB_SELECT).in("id", ids);
  if (bookings.error || !bookings.data) throw new DriverPortalError(503, "History unavailable.");
  const jobs = new Map(bookings.data.map((r) => { const job = toDriverJob(r as unknown as Record<string, unknown>, { ...session, vehicleRegistration: null, vehicleType: null }); return [job.id, job]; }));
  // Own completion events authorize these history IDs, while the full job timeline remains intact.
  const events = await eventsForJobs(admin, [...jobs.keys()]);
  return { rows: ids.flatMap((id) => { const job = jobs.get(id); return job ? [{ job, events: events.get(id) || [] }] : []; }), hasMore };
}
const OFFICE_JOB_SELECT = DRIVER_JOB_SELECT + ",notes";
const HISTORY_PAGE_SIZE = 25;
function operationsDataFailure(context: string, error: { code?: string; message?: string } | null) {
  console.error("Driver Operations data query failed", { context, code: error?.code || "INCOMPLETE_RESPONSE", message: error?.message || "Required data/count was not returned" });
  return new DriverPortalError(503, context + " unavailable.");
}

function liveBooking(row: Record<string, unknown>) {
  return !["cancelled", "canceled", "rejected"].includes(String(row.status || "").trim().toLowerCase());
}
async function openOperationsBookings(admin: SupabaseClient, driverId?: string) {
  const rows: Record<string, unknown>[] = [];
  for (let offset = 0; ; offset += 500) {
    let query = admin.from("booking_diary")
      .select(OFFICE_JOB_SELECT + ",started:driver_job_events!inner(id),finished:driver_job_events(id)")
      .not("driver_id", "is", null).eq("started.event_type", "pickup_arrived")
      .eq("finished.event_type", "job_completed").is("finished", null);
    if (driverId) query = query.eq("driver_id", driverId);
    const result = await query.order("booking_date").order("id").range(offset, offset + 499);
    if (result.error || !result.data) throw operationsDataFailure("Active operations", result.error);
    rows.push(...result.data as unknown as Record<string, unknown>[]);
    if (result.data.length < 500) return rows.filter(liveBooking);
  }
}

async function assignedOfficeBookings(admin: SupabaseClient, date: string, driverId?: string) {
  const bookings: Record<string, unknown>[] = [];
  for (let offset = 0; ; offset += 500) {
    let query = admin.from("booking_diary").select(OFFICE_JOB_SELECT).eq("booking_date", date).not("driver_id", "is", null);
    if (driverId) query = query.eq("driver_id", driverId);
    const result = await query.order("pickup_time", { nullsFirst: false }).order("id").range(offset, offset + 499);
    if (result.error || !result.data) throw operationsDataFailure("Assignments", result.error);
    bookings.push(...(result.data as unknown as Record<string, unknown>[]).filter(liveBooking));
    if (result.data.length < 500) return bookings;
  }
}

export async function driverOperations(admin: SupabaseClient): Promise<OperationsResult> {
  const fetchedAt = new Date().toISOString();
  const date = bangkokDateKey(new Date(fetchedAt));
  const nextDate = shiftBangkokDate(date, 1);
  const scheduled = await assignedOfficeBookings(admin, date);
  const active = await openOperationsBookings(admin);
  const completions: { driver_id: string | number; booking: Record<string, unknown> }[] = [];
  for (let offset = 0; ; offset += 500) {
    const result = await admin.from("driver_job_events")
      .select(`driver_id,booking:booking_diary!inner(${OFFICE_JOB_SELECT})`)
      .eq("event_type", "job_completed").gte("event_time", `${date}T00:00:00+07:00`)
      .lt("event_time", `${nextDate}T00:00:00+07:00`).order("id").range(offset, offset + 499);
    if (result.error || !result.data) throw operationsDataFailure("Completion totals", result.error);
    completions.push(...result.data as unknown as typeof completions);
    if (result.data.length < 500) break;
  }
  const completedBookings: Record<string, unknown>[] = completions.map(row => ({ ...row.booking, driver_id: row.driver_id, completed_by_driver_id: row.driver_id }));
  const bookings = [...new Map([...scheduled, ...active, ...completedBookings].map(row => [String(row.id), row])).values()];
  const rows = (await operationsRows(admin, bookings)).map(row => ({ ...row, waitingMinutes: pickupWaitMinutes(row.events, fetchedAt) }));
  const driverActivity: OperationsResult["driverActivity"] = {};
  for (const booking of scheduled) {
    const key = String(booking.driver_id);
    const value = driverActivity[key] ?? { jobsToday: 0, status: null };
    value.jobsToday++; driverActivity[key] = value;
  }
  for (const row of rows) {
    const status = jobStatus(row.events);
    const value = driverActivity[row.driverId] ?? { jobsToday: 0, status: null };
    if (status !== "completed" && (value.status === null || value.status === "ready")) value.status = status;
    driverActivity[row.driverId] = value;
  }
  return { date, fetchedAt, rows, driverActivity, summary: {
    driversToday: new Set(scheduled.map(row => String(row.driver_id))).size,
    jobsToday: scheduled.length,
    activeNow: rows.filter(row => !["ready", "completed"].includes(jobStatus(row.events)) && liveBooking({ status: row.job.bookingStatus })).length,
    attention: rows.filter(row => hasOperationalAttention(row, fetchedAt)).length,
    completedToday: rows.filter(row => driverCompletedOn(row.events, date)).length
  } };
}

/** Resolve each canonical driver once, then batch job events; no per-row profile requests. */
export async function operationsRows(admin: SupabaseClient, bookings: Record<string, unknown>[], historical = false): Promise<OperationsRow[]> {
  const driverIds = [...new Set(bookings.map(row => String(row.driver_id)))];
  const identities = new Map<string, { driverId: string; driverName: string; vehicleRegistration: string | null; vehicleType: string | null; accountActive: boolean | null }>();
  for (let i = 0; i < driverIds.length; i += 100) {
    const ids = driverIds.slice(i, i + 100);
    const [drivers, accounts] = await Promise.all([
      admin.from("drivers").select("id,name,vehicle_reg,vehicle_type,active").in("id", ids),
      admin.from("driver_accounts").select("driver_id,active").in("driver_id", ids)
    ]);
    if (drivers.error || accounts.error || !drivers.data || !accounts.data) throw operationsDataFailure("Driver identities", drivers.error || accounts.error);
    for (const d of drivers.data) {
      const account = accounts.data.find(row => String(row.driver_id) === String(d.id));
      identities.set(String(d.id), { driverId: String(d.id), driverName: d.name, vehicleRegistration: d.vehicle_reg, vehicleType: d.vehicle_type, accountActive: account ? account.active === true && d.active === true : null });
    }
  }
  const events = await eventsForJobs(admin, bookings.map(row => String(row.id)));
  return bookings.map(booking => {
    const identity = identities.get(String(booking.driver_id));
    if (!identity) throw new DriverPortalError(503, "Assigned driver unavailable.");
    const jobEvents = events.get(String(booking.id)) || [];
    const completed = historical || !!completedDriverEvent(jobEvents);
    const job = toDriverJob(booking, completed ? { ...identity, vehicleRegistration: null, vehicleType: null } : identity);
    if (typeof booking.notes === "string") job.notes = booking.notes;
    return { job, events: jobEvents, driverId: identity.driverId, driverName: identity.driverName, accountActive: identity.accountActive, profile: null };
  });
}

export async function operationsHistory(admin: SupabaseClient, params: URLSearchParams): Promise<OperationsHistoryResult> {
  const page = Number(params.get("page") || "0");
  if (!Number.isInteger(page) || page < 0 || page > 10000) throw new DriverPortalError(400, "Invalid page.");
  const driverId = params.get("driver_id");
  if (driverId && !/^[a-zA-Z0-9-]{1,64}$/.test(driverId)) throw new DriverPortalError(400, "Invalid driver.");
  const search = (params.get("q") || "").trim();
  if (search.length > 100) throw new DriverPortalError(400, "Search too long.");
  const literal = search.replace(/[^\p{L}\p{M}\p{N} \-]/gu, " ").trim();
  const matchFields = literal ? ",driver_match:drivers(),job_match:booking_diary(client_match:clients())" : "";
  let query = admin.from("driver_job_events")
    .select(`booking_id,driver_id,event_time,booking:booking_diary!inner(${OFFICE_JOB_SELECT})${matchFields}`, { count: "exact" })
    .eq("event_type", "job_completed");
  if (driverId) query = query.eq("driver_id", driverId);
  for (const key of ["from", "to"] as const) {
    const value = params.get(key);
    if (!value) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value + "T12:00:00+07:00").toISOString().slice(0, 10) !== value) throw new DriverPortalError(400, "Invalid date.");
    query = key === "from" ? query.gte("event_time", `${value}T00:00:00+07:00`) : query.lt("event_time", `${shiftBangkokDate(value, 1)}T00:00:00+07:00`);
  }
  if (params.get("from") && params.get("to") && params.get("from")! > params.get("to")!) throw new DriverPortalError(400, "Invalid date range.");
  if (search && !literal) return { rows: [], total: 0, hasMore: false, page, pageSize: HISTORY_PAGE_SIZE };
  if (literal) {
    const pattern = `%${literal}%`;
    query = query.ilike("driver_match.name", pattern).ilike("job_match.client_match.name", pattern)
      .or(["pickup", "dropoff", "vehicle_registration", "job_order_number"].map(field => `${field}.ilike.${pattern}`).concat("client_match.not.is.null").join(","), { referencedTable: "job_match" })
      .or("driver_match.not.is.null,job_match.not.is.null");
  }
  const result = await query.order("event_time", { ascending: false }).order("id", { ascending: false })
    .range(page * HISTORY_PAGE_SIZE, (page + 1) * HISTORY_PAGE_SIZE - 1);
  if (result.error || !result.data || result.count == null) throw operationsDataFailure("History", result.error);
  if (page > 0 && result.count > 0 && !result.data.length && page * HISTORY_PAGE_SIZE >= result.count) {
    const adjusted = new URLSearchParams(params);
    adjusted.set("page", String(Math.floor((result.count - 1) / HISTORY_PAGE_SIZE)));
    return operationsHistory(admin, adjusted);
  }
  const bookings = (result.data as unknown as { driver_id: string | number; booking: Record<string, unknown> }[]).map(row => ({ ...row.booking, driver_id: row.driver_id }));
  return { rows: await operationsRows(admin, bookings, true), total: result.count,
    hasMore: (page + 1) * HISTORY_PAGE_SIZE < result.count, page, pageSize: HISTORY_PAGE_SIZE };
}

export async function operationsDriverDetail(admin: SupabaseClient, driverId: string): Promise<OperationsDriverDetail> {
  if (!/^[a-zA-Z0-9-]{1,64}$/.test(driverId)) throw new DriverPortalError(400, "Invalid driver.");
  const [driverResult, accountResult] = await Promise.all([
    admin.from("drivers").select("id,name,vehicle_reg,vehicle_type,active").eq("id", driverId).maybeSingle(),
    admin.from("driver_accounts").select("auth_user_id,active").eq("driver_id", driverId).maybeSingle()
  ]);
  if (driverResult.error || accountResult.error) throw new DriverPortalError(503, "Driver unavailable.");
  if (!driverResult.data) throw new DriverPortalError(404, "Driver not found.");
  const driver = driverResult.data, account = accountResult.data;
  const date = bangkokDateKey();
  const tomorrow = shiftBangkokDate(date, 1), weekStart = shiftBangkokDate(date, -6);
  const completedCount = async (from?: string, to?: string) => {
    let query = admin.from("driver_job_events").select("id", { count: "exact", head: true }).eq("driver_id", driverId).eq("event_type", "job_completed");
    if (from) query = query.gte("event_time", from + "T00:00:00+07:00");
    if (to) query = query.lt("event_time", to + "T00:00:00+07:00");
    const result = await query;
    if (result.error || result.count == null) throw operationsDataFailure("Completion statistics", result.error);
    return result.count;
  };
  const [todayCount, weekCount, totalCount, active, assigned, completed, profile] = await Promise.all([
    completedCount(date, tomorrow), completedCount(weekStart, tomorrow), completedCount(),
    openOperationsBookings(admin, driverId),
    listAssignedDriverJobs({ driverId, driverName: driver.name, vehicleRegistration: driver.vehicle_reg, vehicleType: driver.vehicle_type }, date),
    operationsHistory(admin, new URLSearchParams({ driver_id: driverId })),
    account ? readDriverProfile(account.auth_user_id, { driverId, driverName: driver.name, vehicleRegistration: driver.vehicle_reg }) : Promise.resolve(null)
  ]);
  const liveAssigned = assigned.filter(job => liveBooking({ status: job.bookingStatus }));
  const assignedJobs = [...new Map([...liveAssigned, ...active.map(booking => toDriverJob(booking, { driverId, driverName: driver.name, vehicleRegistration: driver.vehicle_reg, vehicleType: driver.vehicle_type }))].map(job => [job.id, job])).values()];
  const progress = await eventsForJobs(admin, assignedJobs.map(job => job.id));
  const home = driverHomeJobs(assignedJobs, Object.fromEntries(progress), date, driverId);
  return { driverId, driverName: driver.name, currentVehicle: driver.vehicle_reg,
    portalActive: account ? account.active === true && driver.active === true : null, profile: profile ? { ...profile, avatarUrl: null } : null, date,
    stats: { jobsToday: liveAssigned.filter(job => job.bookingDate === date).length, activeNow: active.length, completedToday: todayCount, completedLast7Days: weekCount, totalCompleted: totalCount },
    recentCompleted: completed.rows.slice(0, 5), recentAssigned: [home.nextJob, ...home.normalizedJobs.filter(job => job.id !== home.nextJob?.id)].filter((job): job is DriverPortalJob => !!job).slice(0, 5) };
}
