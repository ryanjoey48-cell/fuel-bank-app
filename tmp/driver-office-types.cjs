const fs=require('fs');let f='lib/driver-operations.ts',s=fs.readFileSync(f,'utf8');s=s.replace('export type OperationsResult = { date: string; fetchedAt: string; rows: OperationsRow[] };','export type OperationsSummary = { driversToday: number; jobsToday: number; activeNow: number; attention: number; completedToday: number };\nexport type OperationsResult = { date: string; fetchedAt: string; rows: OperationsRow[]; summary: OperationsSummary };');s=s.replace('export type OperationsHistoryResult = { rows: OperationsRow[]; hasMore: boolean };','export type OperationsHistoryResult = { rows: OperationsRow[]; hasMore: boolean; total: number; page: number; pageSize: number };\nexport type OperationsDriverDetail = { driverId: string; driverName: string; currentVehicle: string | null; portalActive: boolean | null; profile: DriverProfile | null; date: string; stats: { jobsToday: number; activeNow: number; completedToday: number; completedLast7Days: number; totalCompleted: number }; recentCompleted: OperationsRow[]; recentAssigned: DriverPortalJob[] };');s+=`
/** The completion event, rather than planned booking date, owns completion KPIs. */
export function completedDriverEvent(events: DriverJobEvent[]) {
  return events.find(event => event.eventType === "job_completed") ?? null;
}
export function bangkokOperationalDate(value: Date | string = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(typeof value === "string" ? new Date(value) : value);
}
export function shiftBangkokDate(dateKey: string, days: number) {
  const date = new Date(dateKey + "T12:00:00+07:00");
  date.setUTCDate(date.getUTCDate() + days);
  return bangkokOperationalDate(date);
}
export function driverCompletedOn(events: DriverJobEvent[], date: string) {
  const completed = completedDriverEvent(events);
  return !!completed && bangkokOperationalDate(completed.eventTime) === date;
}
export function driverDurationMinutes(events: DriverJobEvent[]) {
  const start = events.find(event => event.eventType === "pickup_arrived");
  const completed = completedDriverEvent(events);
  if (!start || !completed) return null;
  const minutes = (Date.parse(completed.eventTime) - Date.parse(start.eventTime)) / 60000;
  return Number.isFinite(minutes) && minutes >= 0 ? Math.round(minutes) : null;
}
export function hasOperationalAttention(row: OperationsRow, fetchedAt: string) {
  if (jobStatus(row.events) === "completed") return false;
  if (["cancelled", "canceled", "rejected"].includes(row.job.bookingStatus?.trim().toLowerCase() || "")) return false;
  if (!row.job.pickupName.trim() || !row.job.dropoffName.trim() || row.accountActive === false || (row.waitingMinutes ?? -1) >= 30) return true;
  if (row.job.bookingStatus?.trim().toLowerCase() === "completed") return true;
  if (jobStatus(row.events) === "ready" && row.job.pickupTime && /^\\d{2}:\\d{2}/.test(row.job.pickupTime)) {
    return Date.parse(row.job.bookingDate + "T" + row.job.pickupTime.slice(0, 5) + ":00+07:00") < Date.parse(fetchedAt);
  }
  return false;
}
`;fs.writeFileSync(f,s);
f='lib/driver-portal.ts';s=fs.readFileSync(f,'utf8').replace('  bookingStatus?: string | null;','  bookingStatus?: string | null;\n  notes?: string | null;');fs.writeFileSync(f,s);f='lib/driver-portal-server.ts';s=fs.readFileSync(f,'utf8').replace('  "status",','  "status",\n  "notes",').replace('    bookingStatus: typeof row.status === "string" ? row.status : null,','    bookingStatus: typeof row.status === "string" ? row.status : null,\n    notes: typeof row.notes === "string" ? row.notes : null,');s+=`
/** A completion recorded by this driver authorizes historical read access only. */
export async function getDriverVisibleJob(session: DriverPortalSession, bookingId: string) {
  const assigned = await getAssignedDriverJob(session, bookingId);
  if (assigned || !/^[0-9a-f-]{36}$/i.test(bookingId)) return assigned;
  const admin = createServerSupabaseAdmin();
  const completion = await admin.from("driver_job_events").select("booking_id")
    .eq("booking_id", bookingId).eq("driver_id", session.driverId).eq("event_type", "job_completed").maybeSingle();
  if (completion.error) throw new DriverPortalError(503, "History unavailable.");
  if (!completion.data) return null;
  const booking = await admin.from("booking_diary").select(DRIVER_JOB_SELECT).eq("id", bookingId).maybeSingle();
  if (booking.error) throw new DriverPortalError(503, "Historical job unavailable.");
  return booking.data ? toDriverJob(booking.data as unknown as Record<string, unknown>, { ...session, vehicleRegistration: null, vehicleType: null }) : null;
}
`;fs.writeFileSync(f,s);
f='app/driver/(protected)/jobs/[bookingId]/page.tsx';s=fs.readFileSync(f,'utf8').replaceAll('getAssignedDriverJob','getDriverVisibleJob');fs.writeFileSync(f,s);f='lib/driver-job-events-server.ts';s=fs.readFileSync(f,'utf8').replace('DriverPortalError, getAssignedDriverJob,','DriverPortalError, getAssignedDriverJob, getDriverVisibleJob,').replace('export async function getAssignedDriverJobEvents(session: DriverPortalSession, bookingId: string) {\n  if (!await getAssignedDriverJob(session, bookingId))','export async function getAssignedDriverJobEvents(session: DriverPortalSession, bookingId: string) {\n  if (!await getDriverVisibleJob(session, bookingId))');fs.writeFileSync(f,s);
f='public/sw.js';s=fs.readFileSync(f,'utf8').replace('url.pathname.startsWith("/api/driver/"))','url.pathname.startsWith("/api/driver/") || url.pathname === "/api/admin/driver-accounts" || url.pathname.startsWith("/api/admin/driver-operations"))');fs.writeFileSync(f,s);
