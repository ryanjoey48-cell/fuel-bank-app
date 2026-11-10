import "server-only";
import type { createServerSupabaseAdmin } from "@/lib/admin-user-management-server";
import {
  buildVisitNotificationIntent,
  shouldEnqueueVisitNotification,
  type FleetNotificationOutboxIntent
} from "@/lib/fleet-notification-outbox";
import type { GeofenceVisitEvent } from "@/lib/fleet-geofence-engine";

type Admin = ReturnType<typeof createServerSupabaseAdmin>;

function missingRpc(error: unknown) {
  const message = String((error as { message?: unknown })?.message ?? "").toLowerCase();
  const code = String((error as { code?: unknown })?.code ?? "");
  return code === "PGRST202" || message.includes("could not find the function") || message.includes("does not exist");
}

/** Enqueue durable intents only. Never enables live operational push from the monitor. */
export async function enqueueVisitNotificationIntents(
  admin: Admin,
  events: readonly GeofenceVisitEvent[],
  locationNames: ReadonlyMap<string, { en: string; th: string }>
) {
  const results: Array<{ eventKey: string; intentKey: string; status: "enqueued" | "skipped" | "storage_pending" | "failed" }> = [];
  for (const event of events) {
    if (!shouldEnqueueVisitNotification({ eventEvidence: event.evidence })) {
      results.push({ eventKey: event.eventKey, intentKey: "", status: "skipped" });
      continue;
    }
    const names = locationNames.get(event.locationId) ?? {
      en: event.locationId,
      th: event.locationId
    };
    const intent: FleetNotificationOutboxIntent = buildVisitNotificationIntent({
      eventKey: event.eventKey,
      visitKey: event.visitKey,
      type: event.type,
      registration: event.registration,
      locationNameEn: names.en,
      locationNameTh: names.th,
      occurredAt: event.occurredAt,
      deliveryEnabled: false
    });
    const { error } = await admin.rpc("enqueue_ees_fleet_notification_outbox", {
      p_intent_key: intent.intentKey,
      p_event_key: intent.eventKey,
      p_category: intent.category,
      p_severity: intent.severity,
      p_title_en: intent.titleEn,
      p_title_th: intent.titleTh,
      p_body_en: intent.bodyEn,
      p_body_th: intent.bodyTh,
      p_href: intent.href,
      p_delivery_enabled: false
    });
    if (error) {
      results.push({
        eventKey: event.eventKey,
        intentKey: intent.intentKey,
        status: missingRpc(error) ? "storage_pending" : "failed"
      });
      continue;
    }
    results.push({ eventKey: event.eventKey, intentKey: intent.intentKey, status: "enqueued" });
  }
  return results;
}
