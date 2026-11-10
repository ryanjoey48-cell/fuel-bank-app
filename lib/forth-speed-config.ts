/**
 * EES-maintained Forth device speed-alert configuration (V12).
 *
 * Source: owner inspection of Forth device configuration screens (2026-10-28).
 * This is NOT an independent API verification of each device, and it does NOT
 * write settings back to Forth. Road legal limits are never inferred here.
 */

import { normalizeForthRegistration, type EesVehicleIdentity, matchForthVehicle } from "@/lib/forth-tracking";

export const FORTH_SPEED_CONFIG_VERSION = "2026-10-28.v12";
export const FORTH_SPEED_CONFIG_VERIFICATION_DATE = "2026-10-28";

export type ForthSpeedConfigSource = "owner_forth_console" | "office_local_override";
export type ForthSpeedConfigVerification = "owner_reported" | "office_confirmed" | "unverified" | "conflict";

export type ForthSpeedConfigGroup = "A_70_10s" | "B_90_0s";

export type ForthSpeedDeviceConfig = {
  /** Display registration as supplied by the owner. */
  registrationDisplay: string;
  /** Normalized registration key (Thai-safe, punctuation stripped). */
  registrationKey: string;
  group: ForthSpeedConfigGroup;
  speedAlertKmh: number;
  /** Configured Forth speed-alert delay in seconds. */
  alertDelaySeconds: number;
  /** Hours; null when the owner could not establish the value. */
  maxWorkingDurationHours: number | null;
  /** Minutes; null when the owner could not establish the value. */
  maxEngineIdlingMinutes: number | null;
  /** Hours; preserved for future intelligence — not alerted yet. */
  powerSavingParkingHours: number | null;
  source: ForthSpeedConfigSource;
  verificationStatus: ForthSpeedConfigVerification;
  verificationDate: string;
  lastUpdate: string;
  notesEn: string;
  notesTh: string;
};

type OwnerSeed = {
  registrationDisplay: string;
  group: ForthSpeedConfigGroup;
};

const GROUP_A_DEFAULTS = {
  group: "A_70_10s" as const,
  speedAlertKmh: 70,
  alertDelaySeconds: 10,
  maxWorkingDurationHours: 8,
  maxEngineIdlingMinutes: 15,
  powerSavingParkingHours: 12
};

const GROUP_B_DEFAULTS = {
  group: "B_90_0s" as const,
  speedAlertKmh: 90,
  alertDelaySeconds: 0,
  maxWorkingDurationHours: null as number | null,
  maxEngineIdlingMinutes: null as number | null,
  powerSavingParkingHours: 12
};

/** Owner-supplied Group A — 70 km/h with 10-second delay. */
const GROUP_A_REGISTRATIONS: OwnerSeed[] = [
  { registrationDisplay: "79-5318", group: "A_70_10s" },
  { registrationDisplay: "64-0359", group: "A_70_10s" },
  { registrationDisplay: "63-3543", group: "A_70_10s" },
  { registrationDisplay: "62-1085", group: "A_70_10s" },
  { registrationDisplay: "78-6996", group: "A_70_10s" },
  { registrationDisplay: "61-6672", group: "A_70_10s" },
  { registrationDisplay: "61-2835", group: "A_70_10s" },
  { registrationDisplay: "62-4337", group: "A_70_10s" },
  { registrationDisplay: "79-2945", group: "A_70_10s" },
  { registrationDisplay: "74-8969", group: "A_70_10s" }
];

/** Owner-supplied Group B — 90 km/h with 0-second delay. */
const GROUP_B_REGISTRATIONS: OwnerSeed[] = [
  { registrationDisplay: "64-5954", group: "B_90_0s" },
  { registrationDisplay: "ฒอ-8453", group: "B_90_0s" },
  { registrationDisplay: "64-8665", group: "B_90_0s" },
  { registrationDisplay: "64-5956", group: "B_90_0s" },
  { registrationDisplay: "3ฒล4565", group: "B_90_0s" },
  { registrationDisplay: "700-4145", group: "B_90_0s" },
  { registrationDisplay: "701-5145", group: "B_90_0s" },
  { registrationDisplay: "3ฒน-9565", group: "B_90_0s" },
  { registrationDisplay: "701-1654", group: "B_90_0s" },
  { registrationDisplay: "68-7154", group: "B_90_0s" },
  { registrationDisplay: "700-6659", group: "B_90_0s" }
];

function buildConfig(seed: OwnerSeed): ForthSpeedDeviceConfig {
  const defaults = seed.group === "A_70_10s" ? GROUP_A_DEFAULTS : GROUP_B_DEFAULTS;
  const registrationKey = normalizeForthRegistration(seed.registrationDisplay);
  return {
    registrationDisplay: seed.registrationDisplay,
    registrationKey,
    group: seed.group,
    speedAlertKmh: defaults.speedAlertKmh,
    alertDelaySeconds: defaults.alertDelaySeconds,
    maxWorkingDurationHours: defaults.maxWorkingDurationHours,
    maxEngineIdlingMinutes: defaults.maxEngineIdlingMinutes,
    powerSavingParkingHours: defaults.powerSavingParkingHours,
    source: "owner_forth_console",
    verificationStatus: "owner_reported",
    verificationDate: FORTH_SPEED_CONFIG_VERIFICATION_DATE,
    lastUpdate: FORTH_SPEED_CONFIG_VERIFICATION_DATE,
    notesEn: seed.group === "A_70_10s"
      ? "Owner-reported Forth console settings (70 km/h, 10 s delay). Not API-verified per device."
      : "Owner-reported Forth console settings (90 km/h, 0 s delay). Working/idling maxima not established. Not API-verified per device.",
    notesTh: seed.group === "A_70_10s"
      ? "การตั้งค่าจากหน้าจอ Forth ที่เจ้าของรายงาน (70 กม./ชม. หน่วง 10 วินาที) ยังไม่ได้ยืนยันทีละเครื่องผ่าน API"
      : "การตั้งค่าจากหน้าจอ Forth ที่เจ้าของรายงาน (90 กม./ชม. หน่วง 0 วินาที) ระยะเวลาทำงาน/เดินเบาสูงสุดยังไม่ทราบ ยังไม่ได้ยืนยันทีละเครื่องผ่าน API"
  };
}

const OWNER_CONFIGS: ForthSpeedDeviceConfig[] = [...GROUP_A_REGISTRATIONS, ...GROUP_B_REGISTRATIONS].map(buildConfig);

const CONFIG_BY_KEY = new Map(OWNER_CONFIGS.map((config) => [config.registrationKey, config]));

export function listForthSpeedDeviceConfigs(): ForthSpeedDeviceConfig[] {
  return OWNER_CONFIGS.map((config) => ({ ...config }));
}

export function getForthSpeedConfigVersion() {
  return FORTH_SPEED_CONFIG_VERSION;
}

/** Lookup by any registration formatting variant. */
export function lookupForthSpeedConfig(registration: string | null | undefined): ForthSpeedDeviceConfig | null {
  const key = normalizeForthRegistration(registration ?? null);
  if (!key) return null;
  const found = CONFIG_BY_KEY.get(key);
  return found ? { ...found } : null;
}

export type ForthSpeedConfigMatchRow = {
  config: ForthSpeedDeviceConfig;
  eesVehicleId: string | null;
  matchedBy: "device_id" | "registration" | null;
  matchStatus: "matched" | "ambiguous" | "unmatched" | "duplicate_config";
  forthDeviceId: string | null;
  reason: string;
};

/**
 * Match owner-reported registrations to an EES vehicle registry.
 * Prefer unique Forth device ID when present on the EES vehicle; never silent-match ambiguous rows.
 */
export function matchForthSpeedConfigsToRegistry(
  vehicles: readonly EesVehicleIdentity[],
  liveDeviceByRegistration?: ReadonlyMap<string, string | null>
): ForthSpeedConfigMatchRow[] {
  const seenKeys = new Map<string, number>();
  for (const config of OWNER_CONFIGS) {
    seenKeys.set(config.registrationKey, (seenKeys.get(config.registrationKey) ?? 0) + 1);
  }

  return OWNER_CONFIGS.map((config) => {
    if ((seenKeys.get(config.registrationKey) ?? 0) > 1) {
      return {
        config: { ...config },
        eesVehicleId: null,
        matchedBy: null,
        matchStatus: "duplicate_config" as const,
        forthDeviceId: liveDeviceByRegistration?.get(config.registrationKey) ?? null,
        reason: "Duplicate registration key in the speed-config catalogue."
      };
    }

    const liveDeviceId = liveDeviceByRegistration?.get(config.registrationKey) ?? null;
    const match = matchForthVehicle(
      { gpsDeviceId: liveDeviceId, vehicleRegistration: config.registrationDisplay },
      [...vehicles]
    );

    return {
      config: { ...config },
      eesVehicleId: match.vehicleId,
      matchedBy: match.matchedBy,
      matchStatus: match.status,
      forthDeviceId: liveDeviceId,
      reason: match.reason
    };
  });
}

/** Build a live registration→device map from Forth tracking records (no SIM or private fields). */
export function forthLiveDeviceMapByRegistration(
  records: ReadonlyArray<{ vehicleRegistration: string | null; gpsDeviceId: string | null }>
) {
  const map = new Map<string, string | null>();
  for (const record of records) {
    const key = normalizeForthRegistration(record.vehicleRegistration);
    if (!key) continue;
    const deviceId = record.gpsDeviceId?.trim() || null;
    const previous = map.get(key);
    if (previous === undefined) {
      map.set(key, deviceId);
      continue;
    }
    if (previous && deviceId && previous !== deviceId) {
      // Conflicting device IDs for the same registration — clear until office review.
      map.set(key, null);
    }
  }
  return map;
}

export function forthSpeedConfigGroupLabel(group: ForthSpeedConfigGroup, language: "en" | "th") {
  if (group === "A_70_10s") {
    return language === "th" ? "กลุ่ม ก · 70 กม./ชม. · หน่วง 10 วินาที" : "Group A · 70 km/h · 10 s delay";
  }
  return language === "th" ? "กลุ่ม ข · 90 กม./ชม. · หน่วง 0 วินาที" : "Group B · 90 km/h · 0 s delay";
}
