/**
 * Pure pilot readiness counts. Ready flags require real storage/config evidence,
 * not merely the presence of application source code.
 */

export type FleetPilotReadinessInput = {
  environmentLabel: "LOCAL" | "STAGING" | "PRODUCTION" | "UNKNOWN";
  forthSourceRecords: number;
  draftsWithForthId: number;
  awaitingConfirmation: number;
  confirmedDestinations: number;
  geofencesEnabled: number;
  pilotLocationsSelected: number;
  visitStorageReady: boolean;
  forthAuditStorageReady: boolean;
  mapPinStorageReady: boolean;
  monitorEnabled: boolean;
  monitorSecretConfigured: boolean;
  vapidConfigured: boolean;
  webPushTestEnabled: boolean;
  activePushDevices: number;
};

export type FleetPilotReadinessChecklistItem = {
  key: string;
  labelEn: string;
  labelTh: string;
  count: number | null;
  ready: boolean;
  blocker: string | null;
};

export function buildFleetPilotReadiness(input: FleetPilotReadinessInput) {
  const items: FleetPilotReadinessChecklistItem[] = [
    {
      key: "forth_source",
      labelEn: "Forth source records",
      labelTh: "รายการต้นทาง Forth",
      count: input.forthSourceRecords,
      ready: input.forthSourceRecords > 0,
      blocker: input.forthSourceRecords > 0 ? null : "Bundled Forth CSV was not parsed."
    },
    {
      key: "drafts",
      labelEn: "Directory drafts with Forth ID",
      labelTh: "ร่างไดเรกทอรีที่เชื่อมรหัส Forth",
      count: input.draftsWithForthId,
      ready: input.draftsWithForthId > 0,
      blocker: input.draftsWithForthId > 0 ? null : "No Forth drafts approved into EES yet."
    },
    {
      key: "awaiting_confirmation",
      labelEn: "Awaiting destination confirmation",
      labelTh: "รอการยืนยันพิกัดปลายทาง",
      count: input.awaitingConfirmation,
      ready: true,
      blocker: null
    },
    {
      key: "confirmed_destinations",
      labelEn: "Confirmed destination pins",
      labelTh: "หมุดปลายทางที่ยืนยันแล้ว",
      count: input.confirmedDestinations,
      ready: input.mapPinStorageReady && input.confirmedDestinations > 0,
      blocker: !input.mapPinStorageReady
        ? "Map-pin storage is not installed."
        : input.confirmedDestinations > 0 ? null : "No confirmed destination pins yet."
    },
    {
      key: "geofences_enabled",
      labelEn: "Geofences enabled",
      labelTh: "โซนติดตามที่เปิดใช้",
      count: input.geofencesEnabled,
      ready: input.visitStorageReady && input.geofencesEnabled > 0,
      blocker: !input.visitStorageReady
        ? "V20 visit/geofence tables are not installed."
        : input.geofencesEnabled > 0 ? null : "No active monitoring zones."
    },
    {
      key: "pilot_selected",
      labelEn: "Pilot locations selected",
      labelTh: "สถานที่นำร่องที่เลือก",
      count: input.pilotLocationsSelected,
      ready: input.pilotLocationsSelected >= 5 && input.pilotLocationsSelected <= 10,
      blocker: input.pilotLocationsSelected === 0
        ? "Select 5–10 verified operational sites for the pilot."
        : input.pilotLocationsSelected < 5
          ? "Pilot set is smaller than the recommended 5–10 sites."
          : input.pilotLocationsSelected > 10
            ? "Pilot set is larger than the recommended 5–10 sites."
            : null
    },
    {
      key: "database",
      labelEn: "Database readiness",
      labelTh: "ความพร้อมฐานข้อมูล",
      count: null,
      ready: input.visitStorageReady && input.mapPinStorageReady,
      blocker: [
        !input.mapPinStorageReady ? "map pins" : null,
        !input.visitStorageReady ? "fleet visit/geofence tables" : null,
        !input.forthAuditStorageReady ? "Forth import audit tables (optional for durable skip/defer)" : null
      ].filter(Boolean).join(", ") || null
    },
    {
      key: "monitor",
      labelEn: "Monitor configured",
      labelTh: "การตั้งค่ามอนิเตอร์",
      count: null,
      ready: input.monitorEnabled && input.monitorSecretConfigured && input.visitStorageReady,
      blocker: !input.visitStorageReady
        ? "Visit storage missing."
        : !input.monitorEnabled
          ? "EES_FLEET_MONITOR_ENABLED is false."
          : !input.monitorSecretConfigured
            ? "EES_FLEET_MONITOR_SECRET is missing or too short."
            : null
    },
    {
      key: "notifications",
      labelEn: "Notification readiness (not live)",
      labelTh: "ความพร้อมการแจ้งเตือน (ยังไม่เปิดใช้งานจริง)",
      count: input.activePushDevices,
      ready: input.vapidConfigured,
      blocker: !input.vapidConfigured
        ? "VAPID keys are not configured."
        : input.webPushTestEnabled
          ? "Server push test is enabled; live operational alerts remain disconnected."
          : "Infrastructure present; live operational push remains disabled by design."
    }
  ];

  const blockers = items.map((item) => item.blocker).filter((value): value is string => Boolean(value));
  const eligiblePilotGeofences = Math.min(input.confirmedDestinations, input.geofencesEnabled || input.confirmedDestinations);
  return {
    environmentLabel: input.environmentLabel,
    items,
    blockers,
    eligiblePilotGeofences,
    pilotReady: input.visitStorageReady
      && input.mapPinStorageReady
      && input.confirmedDestinations >= 5
      && input.geofencesEnabled >= 1
      && input.monitorSecretConfigured,
    liveNotificationsEnabled: false
  };
}

export function resolveFleetEnvironmentLabel(value: string | undefined): FleetPilotReadinessInput["environmentLabel"] {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return "LOCAL";
  if (normalized.includes("prod")) return "PRODUCTION";
  if (normalized.includes("stag") || normalized.includes("preview")) return "STAGING";
  if (normalized.includes("local") || normalized.includes("dev")) return "LOCAL";
  return "UNKNOWN";
}
