/**
 * Pure helpers for durable fleet notification intents.
 * Operational push delivery remains disabled until owner approval (V20.3).
 */

import type { FleetNotificationCategory, FleetNotificationSeverity } from "@/lib/fleet-notification-policy";

export type FleetNotificationOutboxIntent = {
  intentKey: string;
  eventKey: string;
  category: FleetNotificationCategory;
  severity: FleetNotificationSeverity;
  titleEn: string;
  titleTh: string;
  bodyEn: string;
  bodyTh: string;
  href: string;
  deliveryEnabled: boolean;
};

export function buildVisitNotificationIntent(input: {
  eventKey: string;
  visitKey: string;
  type: "arrival" | "departure";
  registration: string | null;
  locationNameEn: string;
  locationNameTh: string;
  occurredAt: string;
  deliveryEnabled?: boolean;
}): FleetNotificationOutboxIntent {
  const plate = input.registration?.trim() || "Registration unavailable";
  const category = input.type === "arrival" ? "arrival" : "departure";
  const verbEn = input.type === "arrival" ? "arrived at" : "departed";
  const verbTh = input.type === "arrival" ? "ถึง" : "ออกจาก";
  return {
    intentKey: `visit:${input.eventKey}:${category}`,
    eventKey: input.eventKey,
    category,
    severity: "action_required",
    titleEn: input.type === "arrival" ? "Vehicle arrival" : "Vehicle departure",
    titleTh: input.type === "arrival" ? "รถถึงสถานที่" : "รถออกจากสถานที่",
    bodyEn: `${plate} ${verbEn} ${input.locationNameEn}.`,
    bodyTh: `${plate} ${verbTh} ${input.locationNameTh}`,
    href: `/fleet-events#${encodeURIComponent(input.eventKey)}`,
    deliveryEnabled: input.deliveryEnabled === true
  };
}

export function shouldEnqueueVisitNotification(input: {
  eventEvidence: string;
  reviewStatus?: string | null;
}): boolean {
  return input.eventEvidence === "verified_forth_gps";
}
