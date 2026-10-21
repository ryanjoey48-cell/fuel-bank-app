export type ForthCoordinateStatus = "valid" | "missing" | "invalid";
export type ForthGpsConnectivity = "connected" | "disconnected" | "unknown";
export type ForthTimestampStatus = "current" | "stale" | "missing" | "invalid" | "timezone_ambiguous";
export type ForthPositionStatus = "gps" | "non_gps" | "unknown";

/** Fields returned by the upstream API are optional and may vary by device. */
export type ForthRawTrackingRecord = {
  gpsID?: unknown;
  plateNumber?: unknown;
  dateTime?: unknown;
  GPS?: unknown;
  GPRS?: unknown;
  Engine?: unknown;
  Speed?: unknown;
  Sensor1?: unknown;
  Sensor2?: unknown;
  Sensor3?: unknown;
  Latitude?: unknown;
  Longitude?: unknown;
  Fuel?: unknown;
  Temperature?: unknown;
  COG?: unknown;
  vehicleName?: unknown;
  vehicleType?: unknown;
  groupVehicle?: unknown;
  IDCard?: unknown;
  IDTransport?: unknown;
  statusCardReader?: unknown;
  driver?: unknown;
  poi?: unknown;
  addressT?: unknown;
  addressE?: unknown;
  powerStatus?: unknown;
  externalBatt?: unknown;
  positionSource?: unknown;
};

export type ForthRawTrackingResponse = ForthRawTrackingRecord[];

export type ForthTrackingRecord = {
  gpsDeviceId: string | null;
  vehicleRegistration: string | null;
  reportedDriver: string | null;
  latitude: number | null;
  longitude: number | null;
  coordinateStatus: ForthCoordinateStatus;
  speed: number | null;
  engineOn: boolean | null;
  gpsConnectivity: ForthGpsConnectivity;
  gprsConnectivity: ForthGpsConnectivity;
  lastGpsTimestamp: string | null;
  timestampStatus: ForthTimestampStatus;
  heading: number | null;
  positionSource: string | null;
  positionStatus: ForthPositionStatus;
  optionalSensors: {
    sensor1: unknown;
    sensor2: unknown;
    sensor3: unknown;
    fuel: unknown;
    temperature: unknown;
  };
};

export class ForthTrackingPayloadError extends Error {
  constructor() {
    super("Forth tracking response must be an array of objects.");
    this.name = "ForthTrackingPayloadError";
  }
}

const DEFAULT_STALE_AFTER_MS = 15 * 60 * 1000;
const FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1000;

function recordValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function optionalText(value: unknown) {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function optionalDriverLabel(value: unknown) {
  if (typeof value !== "string") return null;
  const label = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!label || label.length > 100 || !/^[\p{L}\p{M}\s.'’\-]+$/u.test(label)) return null;
  return label;
}

function numericValue(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const text = value.trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function coordinateValue(value: unknown) {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) {
    return { present: false, value: null as number | null };
  }
  return { present: true, value: numericValue(value) };
}

function parseBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1 ? true : value === 0 ? false : null;
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on", "connected", "available", "valid", "online", "ok", "normal"].includes(normalized)) return true;
  if (["0", "false", "no", "off", "disconnected", "unavailable", "invalid", "offline", "lost", "no gps"].includes(normalized)) return false;
  return null;
}

function parseTimestamp(value: unknown, now: number, staleAfterMs: number) {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) {
    return { timestamp: null, status: "missing" as const };
  }
  if (typeof value !== "string") return { timestamp: null, status: "invalid" as const };

  const raw = value.trim();
  // Forth's timestamp timezone has not been confirmed. Naive timestamps are not
  // interpreted in the server's local timezone because that would vary by host.
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)) {
    return { timestamp: null, status: "timezone_ambiguous" as const };
  }

  const milliseconds = Date.parse(raw);
  if (!Number.isFinite(milliseconds) || milliseconds > now + FUTURE_CLOCK_SKEW_MS) {
    return { timestamp: null, status: "invalid" as const };
  }
  return {
    timestamp: new Date(milliseconds).toISOString(),
    status: now - milliseconds > staleAfterMs ? "stale" as const : "current" as const
  };
}

function sourceStatus(value: string | null): ForthPositionStatus {
  if (!value) return "unknown";
  return /\bgps\b/i.test(value) ? "gps" : "non_gps";
}

function normalizeRecord(value: unknown, now: number, staleAfterMs: number): ForthTrackingRecord {
  const raw = recordValue(value);
  if (!raw) throw new ForthTrackingPayloadError();

  const latitude = coordinateValue(raw.Latitude);
  const longitude = coordinateValue(raw.Longitude);
  let coordinateStatus: ForthCoordinateStatus;
  if (!latitude.present || !longitude.present) coordinateStatus = "missing";
  else if (latitude.value === null || longitude.value === null ||
    latitude.value < -90 || latitude.value > 90 || longitude.value < -180 || longitude.value > 180) {
    coordinateStatus = "invalid";
  } else coordinateStatus = "valid";

  const gpsValue = parseBoolean(raw.GPS);
  const timestamp = parseTimestamp(raw.dateTime, now, staleAfterMs);
  const positionSource = optionalText(raw.positionSource);
  const speed = numericValue(raw.Speed);
  const heading = numericValue(raw.COG);
  const gprsValue = parseBoolean(raw.GPRS);

  return {
    gpsDeviceId: optionalText(raw.gpsID),
    vehicleRegistration: optionalText(raw.plateNumber),
    reportedDriver: optionalDriverLabel(raw.driver),
    latitude: coordinateStatus === "valid" ? latitude.value : null,
    longitude: coordinateStatus === "valid" ? longitude.value : null,
    coordinateStatus,
    speed: speed !== null && speed >= 0 ? speed : null,
    engineOn: parseBoolean(raw.Engine),
    gpsConnectivity: gpsValue === null ? "unknown" : gpsValue ? "connected" : "disconnected",
    gprsConnectivity: gprsValue === null
      ? "unknown"
      : gprsValue ? "connected" : "disconnected",
    lastGpsTimestamp: timestamp.timestamp,
    timestampStatus: timestamp.status,
    heading: heading !== null && heading >= 0 && heading <= 360 ? heading : null,
    positionSource,
    positionStatus: sourceStatus(positionSource),
    optionalSensors: {
      sensor1: raw.Sensor1,
      sensor2: raw.Sensor2,
      sensor3: raw.Sensor3,
      fuel: raw.Fuel,
      temperature: raw.Temperature
    }
  };
}

export function normalizeForthTrackingResponse(
  payload: unknown,
  options: { now?: number; staleAfterMs?: number } = {}
): ForthTrackingRecord[] {
  if (!Array.isArray(payload)) throw new ForthTrackingPayloadError();
  const now = options.now ?? Date.now();
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  return payload.map((record) => normalizeRecord(record, now, staleAfterMs));
}

/** Registration normalization removes only harmless separators and whitespace. */
export function normalizeForthRegistration(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFKC")
    .toLocaleUpperCase("th-TH")
    .replace(/[\s\p{Z}\-‐‑‒–—.·]+/gu, "");
}

export type EesVehicleIdentity = {
  id: string;
  vehicle_reg?: string | null;
  registration?: string | null;
  province?: string | null;
  gpsDeviceId?: string | null;
  gps_device_id?: string | null;
  forthGpsId?: string | null;
  forth_gps_id?: string | null;
};

export type ForthVehicleIdentity = {
  gpsDeviceId?: string | null;
  vehicleRegistration?: string | null;
  province?: string | null;
};

export type VehicleMatchResult = {
  status: "matched" | "ambiguous" | "unmatched";
  vehicleId: string | null;
  matchedBy: "device_id" | "registration" | null;
  candidateVehicleIds: string[];
  reason: string;
};

function normalizedProvince(value: string | null | undefined) {
  return (value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleUpperCase("th-TH");
}

function candidateDeviceId(vehicle: EesVehicleIdentity) {
  return optionalText(vehicle.forthGpsId ?? vehicle.forth_gps_id ?? vehicle.gpsDeviceId ?? vehicle.gps_device_id);
}

export function matchForthVehicle(
  forth: ForthVehicleIdentity,
  vehicles: EesVehicleIdentity[]
): VehicleMatchResult {
  const deviceId = optionalText(forth.gpsDeviceId);
  if (deviceId) {
    const deviceMatches = vehicles.filter((vehicle) => candidateDeviceId(vehicle) === deviceId);
    if (deviceMatches.length === 1) {
      return { status: "matched", vehicleId: deviceMatches[0].id, matchedBy: "device_id", candidateVehicleIds: [deviceMatches[0].id], reason: "Unique confirmed GPS device identifier." };
    }
    if (deviceMatches.length > 1) {
      return { status: "ambiguous", vehicleId: null, matchedBy: null, candidateVehicleIds: deviceMatches.map((vehicle) => vehicle.id), reason: "GPS device identifier is assigned to multiple EES vehicles." };
    }
  }

  const registrationKey = normalizeForthRegistration(forth.vehicleRegistration);
  if (!registrationKey) {
    return { status: "unmatched", vehicleId: null, matchedBy: null, candidateVehicleIds: [], reason: "No GPS device identifier or registration is available." };
  }

  let registrationMatches = vehicles.filter((vehicle) =>
    normalizeForthRegistration(vehicle.vehicle_reg ?? vehicle.registration) === registrationKey
  );
  const forthProvince = normalizedProvince(forth.province);
  if (forthProvince) {
    registrationMatches = registrationMatches.filter((vehicle) => {
      const vehicleProvince = normalizedProvince(vehicle.province);
      return !vehicleProvince || vehicleProvince === forthProvince;
    });
  }

  if (registrationMatches.length === 1) {
    const candidate = registrationMatches[0];
    const vehicleProvince = normalizedProvince(candidate.province);
    if (forthProvince && vehicleProvince && forthProvince !== vehicleProvince) {
      return { status: "unmatched", vehicleId: null, matchedBy: null, candidateVehicleIds: [], reason: "Registration candidate has a different province." };
    }
    return { status: "matched", vehicleId: candidate.id, matchedBy: "registration", candidateVehicleIds: [candidate.id], reason: "Unique normalized registration." };
  }
  if (registrationMatches.length > 1) {
    return { status: "ambiguous", vehicleId: null, matchedBy: null, candidateVehicleIds: registrationMatches.map((vehicle) => vehicle.id), reason: "Registration matches multiple EES vehicles; review province and vehicle identity manually." };
  }
  return { status: "unmatched", vehicleId: null, matchedBy: null, candidateVehicleIds: [], reason: "No EES vehicle has the same normalized registration." };
}
