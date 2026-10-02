import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DriverPortalError } from "@/lib/driver-portal-server";
import type { OperationalNotificationsResult } from "@/lib/driver-operations";

export async function evaluatePickupWaits(admin: SupabaseClient) {
  const result = await admin.rpc("evaluate_driver_pickup_wait_notifications");
  if (result.error) throw new DriverPortalError(503, "Waiting alerts unavailable.");
}
export async function readOperationalNotifications(admin: SupabaseClient, userId: string): Promise<OperationalNotificationsResult> {
  await evaluatePickupWaits(admin);
  const [list, unread] = await Promise.all([
    admin.from("driver_operational_notifications").select("id,booking_id,driver_id,created_at,read_at,resolved_at,arrival:driver_job_events!arrival_event_id(event_time),driver:drivers(name),booking:booking_diary(pickup,vehicle_registration,client:clients(name))")
      .eq("recipient_user_id", userId).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(30),
    admin.from("driver_operational_notifications").select("id", { count: "exact", head: true }).eq("recipient_user_id", userId).is("read_at", null)
  ]);
  if (list.error || unread.error || !list.data) throw new DriverPortalError(503, "Notifications unavailable.");
  const object = (value: unknown): Record<string, unknown> => (Array.isArray(value) ? value[0] : value) as Record<string, unknown> || {};
  return { fetchedAt: new Date().toISOString(), unreadCount: unread.count || 0, items: list.data.map((row) => {
    const booking = object(row.booking);
    return { id: row.id, bookingId: String(row.booking_id), driverId: String(row.driver_id), createdAt: row.created_at, readAt: row.read_at, resolvedAt: row.resolved_at,
      driverName: String(object(row.driver).name || "—"), arrivedAt: String(object(row.arrival).event_time), pickup: String(booking.pickup || "—"), vehicle: booking.vehicle_registration as string | null, customer: object(booking.client).name as string | null };
  }) };
}
