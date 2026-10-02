import "server-only";
import { createServerSupabaseAdmin } from "@/lib/admin-user-management-server";
import { DriverPortalError, getAssignedDriverJob, type DriverPortalSession } from "@/lib/driver-portal-server";
import { DRIVER_JOB_EVENT_TYPES, type DriverJobEvent, type DriverJobEventType } from "@/lib/driver-portal";

export const DRIVER_EVENT_SELECT = "id,event_type,event_time,latitude,longitude";

function normalize(row: Record<string, unknown>): DriverJobEvent {
  return {
    id: String(row.id), eventType: row.event_type as DriverJobEventType, eventTime: String(row.event_time),
    latitude: typeof row.latitude === "number" ? row.latitude : null,
    longitude: typeof row.longitude === "number" ? row.longitude : null
  };
}

export async function readDriverJobEvents(bookingId: string) {
  const { data, error } = await createServerSupabaseAdmin().from("driver_job_events")
    .select(DRIVER_EVENT_SELECT).eq("booking_id", bookingId).order("event_time", { ascending: true });
  if (error || !data) throw new DriverPortalError(503, "Job progress is unavailable. Please contact operations.");
  return data.map((row) => normalize(row));
}

export async function getAssignedDriverJobEvents(session: DriverPortalSession, bookingId: string) {
  if (!await getAssignedDriverJob(session, bookingId)) throw new DriverPortalError(404, "Job not found.");
  return readDriverJobEvents(bookingId);
}

export async function appendDriverJobEvent(session: DriverPortalSession, bookingId: string, body: Record<string, unknown>) {
  if (!await getAssignedDriverJob(session, bookingId)) throw new DriverPortalError(404, "Job not found.");
  if (!DRIVER_JOB_EVENT_TYPES.includes(body.eventType as DriverJobEventType)) throw new DriverPortalError(400, "Invalid progress event.");
  const latitude = body.latitude ?? null;
  const longitude = body.longitude ?? null;
  if ((latitude === null) !== (longitude === null)
    || (latitude !== null && (typeof latitude !== "number" || typeof longitude !== "number"
      || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180))) {
    throw new DriverPortalError(400, "Invalid location.");
  }
  // The RPC re-verifies this session and ownership under a booking lock and generates timestamps.
  // Never forward browser driver/auth IDs, timestamps, notes, or other arbitrary properties.
  const { data, error } = await createServerSupabaseAdmin().rpc("append_driver_job_event", {
    p_session_id: session.sessionId, p_booking_id: bookingId, p_event_type: body.eventType,
    p_latitude: latitude, p_longitude: longitude
  });
  if (error) {
    const status = ({ PT400: 400, PT401: 401, PT404: 404, PT409: 409, "23505": 409 } as Record<string, number>)[error.code] ?? 503;
    throw new DriverPortalError(status, status === 503 ? "Unable to save job progress. Please contact operations." : error.message);
  }
  if (!data || typeof data !== "object") throw new DriverPortalError(503, "Unable to save job progress.");
  return normalize(data as Record<string, unknown>);
}
