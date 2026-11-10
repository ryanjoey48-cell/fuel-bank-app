export type FleetNotificationCategory = "arrival" | "departure" | "extended_visit" | "tracker_incident" | "gps_incident" | "speed_alert";
export type FleetNotificationSeverity = "info" | "action_required" | "critical";
export type FleetNotificationPreference = {
  arrivals: boolean; departures: boolean; extended_visits: boolean;
  tracker_incidents: boolean; gps_incidents: boolean; speed_alerts: boolean;
  quiet_start: string | null; quiet_end: string | null;
};
export type FleetNotificationDecision = "queue_and_push" | "queue_only" | "suppress";

const preferenceKey: Record<FleetNotificationCategory, keyof Omit<FleetNotificationPreference, "quiet_start" | "quiet_end">> = {
  arrival: "arrivals", departure: "departures", extended_visit: "extended_visits",
  tracker_incident: "tracker_incidents", gps_incident: "gps_incidents", speed_alert: "speed_alerts"
};

function clockMinutes(value: string) {
  const parts = /^(\d{2}):(\d{2})/.exec(value);
  return parts ? Number(parts[1]) * 60 + Number(parts[2]) : null;
}

export function isBangkokQuietHour(at: string, start: string | null, end: string | null) {
  if (!start || !end) return false;
  const startMinute = clockMinutes(start);
  const endMinute = clockMinutes(end);
  const timestamp = Date.parse(at);
  if (startMinute === null || endMinute === null || !Number.isFinite(timestamp) || startMinute === endMinute) return false;
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(timestamp);
  const current = Number(parts.find((part) => part.type === "hour")?.value) * 60 +
    Number(parts.find((part) => part.type === "minute")?.value);
  return startMinute < endMinute ? current >= startMinute && current < endMinute :
    current >= startMinute || current < endMinute;
}

/** Scope is resolved by the server, never accepted from a browser role or vehicle ID. */
export function decideFleetNotification(input: {
  category: FleetNotificationCategory;
  severity: FleetNotificationSeverity;
  sourceKey: string;
  allowedByOfficeScope: boolean;
  preferences: FleetNotificationPreference;
  now: string;
  existing: { acknowledgedAt: string | null } | null;
}): FleetNotificationDecision {
  if (!input.sourceKey || !input.allowedByOfficeScope || !input.preferences[preferenceKey[input.category]]) return "suppress";
  if (input.existing) return "suppress"; // Unique inbox key also enforces this across workers.
  if (isBangkokQuietHour(input.now, input.preferences.quiet_start, input.preferences.quiet_end)) return "queue_only";
  return "queue_and_push";
}
