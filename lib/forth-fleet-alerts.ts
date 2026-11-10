import type { ForthFleetTrackingRecord } from "@/lib/forth-tracking-server";
import {
  getForthFleetRecordKey,
  getForthReportedActivity,
  isForthHighReportedSpeed,
  type ForthFleetFilter
} from "@/lib/forth-tracking-view";

export type ForthFleetAlertKind =
  | "speed_review"
  | "speed_engine_conflict"
  | "offline"
  | "stale"
  | "missing_coordinates"
  | "engine_on_stopped";
export type ForthFleetAlert = {
  /** One active condition for one source vehicle. Polling does not create a new alert. */
  id: string;
  recordKey: string;
  kind: ForthFleetAlertKind;
  priority: number;
  severity: "review" | "advisory";
  filter: ForthFleetFilter;
  record: ForthFleetTrackingRecord;
};

export type ForthFleetIncident = {
  /** One vehicle incident may carry several independently supported observations. */
  id: string;
  recordKey: string;
  severity: ForthFleetAlert["severity"];
  alerts: ForthFleetAlert[];
};

const ALERT_RULES: Record<ForthFleetAlertKind, { priority: number; severity: ForthFleetAlert["severity"]; filter: ForthFleetFilter }> = {
  speed_review: { priority: 0, severity: "review", filter: "high_speed" },
  speed_engine_conflict: { priority: 1, severity: "review", filter: "uncertain" },
  offline: { priority: 2, severity: "review", filter: "offline" },
  stale: { priority: 3, severity: "review", filter: "stale" },
  missing_coordinates: { priority: 4, severity: "review", filter: "missing_coordinates" },
  engine_on_stopped: { priority: 5, severity: "advisory", filter: "engine_on_stopped" }
};

function sourceTime(record: ForthFleetTrackingRecord) {
  const time = record.lastGpsTimestamp ? Date.parse(record.lastGpsTimestamp) : NaN;
  return Number.isFinite(time) ? time : -Infinity;
}

/** Current, source-supported conditions only. This is not an incident history or a legal speed-limit assessment. */
export function buildForthFleetAlerts(records: ForthFleetTrackingRecord[]): ForthFleetAlert[] {
  const alerts = new Map<string, ForthFleetAlert>();
  const latestRecords = new Map<string, ForthFleetTrackingRecord>();
  records.forEach((record, index) => {
    const recordKey = getForthFleetRecordKey(record, index);
    const previous = latestRecords.get(recordKey);
    if (!previous || sourceTime(previous) <= sourceTime(record)) latestRecords.set(recordKey, record);
  });
  latestRecords.forEach((record, recordKey) => {
    const kinds: ForthFleetAlertKind[] = [];
    const activity = getForthReportedActivity(record);
    if (isForthHighReportedSpeed(record)) kinds.push("speed_review");
    if (activity === "uncertain") kinds.push("speed_engine_conflict");
    if (record.gprsConnectivity === "disconnected") kinds.push("offline");
    if (record.timestampStatus === "stale") kinds.push("stale");
    if (record.coordinateStatus === "missing" || record.coordinateStatus === "invalid") kinds.push("missing_coordinates");
    if (activity === "stopped_engine_on") kinds.push("engine_on_stopped");
    for (const kind of kinds) {
      const id = `${kind}:${recordKey}`;
      alerts.set(id, { id, recordKey, kind, ...ALERT_RULES[kind], record });
    }
  });
  return [...alerts.values()].sort((left, right) => {
    if (left.priority !== right.priority) return left.priority - right.priority;
    if (left.kind === "speed_review" && right.kind === "speed_review" && left.record.speed !== right.record.speed) {
      return (right.record.speed ?? 0) - (left.record.speed ?? 0);
    }
    return (left.record.vehicleRegistration ?? left.recordKey).localeCompare(right.record.vehicleRegistration ?? right.recordKey, "en", { numeric: true }) || left.id.localeCompare(right.id);
  });
}

/** Keep acknowledgement for an active condition; a cleared condition is eligible to notify on recurrence. */
export function reconcileForthAlertAcknowledgements(acknowledgedIds: ReadonlySet<string>, activeAlerts: ForthFleetAlert[]) {
  const activeIds = new Set(activeAlerts.map(({ id }) => id));
  return new Set([...acknowledgedIds].filter((id) => activeIds.has(id)));
}

export function getUnreviewedForthFleetAlerts(alerts: ForthFleetAlert[], acknowledgedIds: ReadonlySet<string>) {
  return alerts.filter(({ id }) => !acknowledgedIds.has(id));
}

/** Group current observations by vehicle and urgency without erasing their stable IDs. */
export function groupForthFleetIncidents(alerts: ForthFleetAlert[]): ForthFleetIncident[] {
  const incidents = new Map<string, ForthFleetIncident>();
  for (const alert of alerts) {
    const id = `${alert.severity}:${alert.recordKey}`;
    const existing = incidents.get(id);
    if (existing) existing.alerts.push(alert);
    else incidents.set(id, { id, recordKey: alert.recordKey, severity: alert.severity, alerts: [alert] });
  }
  return [...incidents.values()];
}
