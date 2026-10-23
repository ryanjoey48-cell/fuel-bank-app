export type ForthCoordinateStatus = "valid" | "missing" | "invalid";
export type ForthGpsConnectivity = "connected" | "disconnected" | "unknown";
export type ForthPositionQuality = "gps" | "no_gps" | "wifi" | "lbs" | "other" | "unknown";
export type ForthPositionSourceShape =
  | "missing"
  | "null"
  | "empty"
  | "number"
  | "boolean"
  | "recognized_string"
  | "unrecognized_string"
  | "other";
export type ForthSourceFieldSnapshot = {
  shape: "missing" | "null" | "empty" | "string" | "number" | "boolean" | "unsupported";
  value: string | number | boolean | null;
  truncated: boolean;
};
export type ForthTrackingSourceAudit = {
  registration: ForthSourceFieldSnapshot;
  deviceId: ForthSourceFieldSnapshot;
  driver: ForthSourceFieldSnapshot;
  latitude: ForthSourceFieldSnapshot;
  longitude: ForthSourceFieldSnapshot;
  speed: ForthSourceFieldSnapshot;
  engine: ForthSourceFieldSnapshot;
  heading: ForthSourceFieldSnapshot;
  gpsSignal: ForthSourceFieldSnapshot;
  gprs: ForthSourceFieldSnapshot;
  positionSource: ForthSourceFieldSnapshot;
  positionTimestamp: ForthSourceFieldSnapshot;
};
export type ForthTimestampStatus =
  | "current"
  | "stale"
  | "missing"
  | "invalid"
  | "timezone_unconfigured"
  | "timezone_invalid"
  | "timezone_ambiguous";

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
  /** Allowlisted scalar source values for the protected, read-only accuracy view. */
  sourceAudit: ForthTrackingSourceAudit;
  gpsDeviceId: string | null;
  vehicleRegistration: string | null;
  reportedDriver: string | null;
  locationAddressEnglish: string | null;
  locationAddressThai: string | null;
  locationPointOfInterest: string | null;
  latitude: number | null;
  longitude: number | null;
  coordinateStatus: ForthCoordinateStatus;
  speed: number | null;
  engineOn: boolean | null;
  gpsConnectivity: ForthGpsConnectivity;
  gprsConnectivity: ForthGpsConnectivity;
  sourceTimestampRaw: string | null;
  lastGpsTimestamp: string | null;
  timestampStatus: ForthTimestampStatus;
  heading: number | null;
  positionSource: string | null;
  /** Untrimmed source text retained only for the protected, sanitized one-shot diagnostic. */
  positionSourceRaw: string | null;
  positionQuality: ForthPositionQuality;
  /** Sanitized raw-field shape used only by the protected aggregate diagnostic. */
  positionSourceShape: ForthPositionSourceShape;
  /** Shape categories for source-like alternate keys; no names or values are retained. */
  alternatePositionSourceCandidates: ForthPositionSourceShape[];
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

const MAX_LOCATION_DESCRIPTION_LENGTH = 240;

function optionalLocationDescription(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (!normalized) return null;
  return Array.from(normalized).slice(0, MAX_LOCATION_DESCRIPTION_LENGTH).join("") || null;
}

const MAX_SOURCE_AUDIT_TEXT_LENGTH = 160;

function sourceFieldSnapshot(value: unknown, present: boolean): ForthSourceFieldSnapshot {
  if (!present || value === undefined) return { shape: "missing", value: null, truncated: false };
  if (value === null) return { shape: "null", value: null, truncated: false };
  if (typeof value === "boolean") return { shape: "boolean", value, truncated: false };
  if (typeof value === "number") {
    return Number.isFinite(value)
      ? { shape: "number", value, truncated: false }
      : { shape: "unsupported", value: null, truncated: false };
  }
  if (typeof value !== "string") return { shape: "unsupported", value: null, truncated: false };
  const safeCharacters = Array.from(value, (character) =>
    /[\p{Cc}\p{Cf}]/u.test(character) ? " " : character
  );
  const truncated = safeCharacters.length > MAX_SOURCE_AUDIT_TEXT_LENGTH;
  const safeValue = safeCharacters.slice(0, MAX_SOURCE_AUDIT_TEXT_LENGTH).join("");
  return {
    shape: safeValue.trim() ? "string" : "empty",
    value: safeValue,
    truncated
  };
}

function driverSourceFieldSnapshot(value: unknown, present: boolean): ForthSourceFieldSnapshot {
  if (typeof value === "string" && value.trim() && !optionalDriverLabel(value)) {
    return { shape: "unsupported", value: null, truncated: false };
  }
  return sourceFieldSnapshot(value, present);
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

type TimestampParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
};

function utcMilliseconds(parts: TimestampParts) {
  const date = new Date(0);
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  date.setUTCHours(parts.hour, parts.minute, parts.second, parts.millisecond);
  if (
    date.getUTCFullYear() !== parts.year ||
    date.getUTCMonth() !== parts.month - 1 ||
    date.getUTCDate() !== parts.day ||
    date.getUTCHours() !== parts.hour ||
    date.getUTCMinutes() !== parts.minute ||
    date.getUTCSeconds() !== parts.second ||
    date.getUTCMilliseconds() !== parts.millisecond
  ) return null;
  return date.getTime();
}

function localPartsAt(milliseconds: number, formatter: Intl.DateTimeFormat): TimestampParts | null {
  const values = new Map(formatter.formatToParts(new Date(milliseconds)).map((part) => [part.type, part.value]));
  const year = Number(values.get("year"));
  const month = Number(values.get("month"));
  const day = Number(values.get("day"));
  const hour = Number(values.get("hour"));
  const minute = Number(values.get("minute"));
  const second = Number(values.get("second"));
  if (![year, month, day, hour, minute, second].every(Number.isInteger)) return null;
  return { year, month, day, hour, minute, second, millisecond: new Date(milliseconds).getUTCMilliseconds() };
}

function resolveLocalTimestamp(parts: TimestampParts, sourceTimeZone: string):
  | { milliseconds: number }
  | { failure: "timezone_invalid" | "timezone_ambiguous" | "invalid" } {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-US-u-ca-gregory-nu-latn", {
      timeZone: sourceTimeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    });
  } catch {
    return { failure: "timezone_invalid" };
  }

  const wallClock = utcMilliseconds(parts);
  if (wallClock === null) return { failure: "invalid" };
  const offsets = new Set<number>();
  for (let hours = -36; hours <= 36; hours += 6) {
    const sample = wallClock + hours * 60 * 60 * 1000;
    const local = localPartsAt(sample, formatter);
    if (!local) continue;
    const localAsUtc = utcMilliseconds({ ...local, millisecond: 0 });
    if (localAsUtc !== null) offsets.add(localAsUtc - Math.floor(sample / 1000) * 1000);
  }

  const matches = [...offsets]
    .map((offset) => wallClock - offset)
    .filter((candidate) => {
      const local = localPartsAt(candidate, formatter);
      return local !== null &&
        local.year === parts.year &&
        local.month === parts.month &&
        local.day === parts.day &&
        local.hour === parts.hour &&
        local.minute === parts.minute &&
        local.second === parts.second;
    });

  if (matches.length === 0) return { failure: "invalid" };
  if (matches.length > 1) return { failure: "timezone_ambiguous" };
  return { milliseconds: matches[0] };
}

function parseTimestamp(value: unknown, now: number, staleAfterMs: number, sourceTimeZone?: string | null) {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) {
    return { timestamp: null, status: "missing" as const };
  }
  if (typeof value !== "string") return { timestamp: null, status: "invalid" as const };

  const raw = value.trim();
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|([+-])(\d{2}):?(\d{2}))?$/i.exec(raw);
  const forthDateMatch = /^(\d{2})-(\d{2})-(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(raw);
  if (!isoMatch && !forthDateMatch) return { timestamp: null, status: "invalid" as const };

  const parts: TimestampParts = isoMatch ? {
    year: Number(isoMatch[1]),
    month: Number(isoMatch[2]),
    day: Number(isoMatch[3]),
    hour: Number(isoMatch[4]),
    minute: Number(isoMatch[5]),
    second: Number(isoMatch[6]),
    millisecond: Number((isoMatch[7] ?? "").padEnd(3, "0").slice(0, 3) || "0")
  } : {
    year: Number(forthDateMatch![3]),
    month: Number(forthDateMatch![2]),
    day: Number(forthDateMatch![1]),
    hour: Number(forthDateMatch![4]),
    minute: Number(forthDateMatch![5]),
    second: Number(forthDateMatch![6]),
    millisecond: 0
  };
  const wallClock = utcMilliseconds(parts);
  if (wallClock === null) return { timestamp: null, status: "invalid" as const };

  let milliseconds: number;
  const zone = isoMatch?.[8];
  if (zone?.toUpperCase() === "Z") {
    milliseconds = wallClock;
  } else if (zone) {
    const offsetHours = Number(isoMatch![10]);
    const offsetMinutes = Number(isoMatch![11]);
    if (offsetHours > 14 || offsetMinutes > 59 || (offsetHours === 14 && offsetMinutes !== 0)) {
      return { timestamp: null, status: "invalid" as const };
    }
    const offset = (offsetHours * 60 + offsetMinutes) * 60_000 * (isoMatch![9] === "+" ? 1 : -1);
    milliseconds = wallClock - offset;
  } else {
    const configuredTimeZone = sourceTimeZone?.trim();
    if (!configuredTimeZone) return { timestamp: null, status: "timezone_unconfigured" as const };
    const resolved = resolveLocalTimestamp(parts, configuredTimeZone);
    if ("failure" in resolved) {
      return { timestamp: null, status: resolved.failure };
    }
    milliseconds = resolved.milliseconds;
  }

  if (milliseconds > now + FUTURE_CLOCK_SKEW_MS) {
    return { timestamp: null, status: "invalid" as const };
  }
  const status = now - milliseconds > staleAfterMs ? "stale" as const : "current" as const;
  return { timestamp: new Date(milliseconds).toISOString(), status };
}

function sourceQuality(value: string | null): ForthPositionQuality {
  if (!value) return "unknown";
  const trimmed = value.trim().toLocaleLowerCase();
  if (/^no\s+gps$/.test(trimmed)) return "no_gps";
  const normalized = trimmed.replace(/[\s_-]+/g, "");
  if (normalized === "gps") return "gps";
  if (normalized === "wifi") return "wifi";
  if (normalized === "lbs") return "lbs";
  if (normalized === "nongps") return "other";
  return "unknown";
}

function positionSourceShape(value: unknown, present: boolean): ForthPositionSourceShape {
  if (!present) return "missing";
  if (value === null) return "null";
  if (typeof value === "string") {
    if (!value.trim()) return "empty";
    return sourceQuality(value) === "unknown" ? "unrecognized_string" : "recognized_string";
  }
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return "other";
}

function isAlternatePositionSourceKey(key: string, insidePositionContext: boolean) {
  const normalized = key.toLocaleLowerCase().replace(/[^a-z0-9]/g, "");
  return /^(?:position|location)(?:gps)?source$/.test(normalized) ||
    /^source(?:position|location)(?:gps)?$/.test(normalized) ||
    /^gpsposition(?:source|quality|type|method|mode)$/.test(normalized) ||
    /^position(?:source)?(?:quality|type|method|mode)$/.test(normalized) ||
    (insidePositionContext && ["source", "sourcetype", "sourcequality", "type", "quality", "method", "mode"].includes(normalized));
}

function alternatePositionSourceShapes(
  value: Record<string, unknown>,
  depth = 0,
  insidePositionContext = false
): ForthPositionSourceShape[] {
  if (depth > 2) return [];
  const shapes: ForthPositionSourceShape[] = [];
  for (const [key, entry] of Object.entries(value)) {
    const isCanonicalField = depth === 0 && key === "positionSource";
    if (!isCanonicalField && isAlternatePositionSourceKey(key, insidePositionContext)) {
      shapes.push(positionSourceShape(entry, true));
    }
    if (entry !== null && typeof entry === "object" && !Array.isArray(entry)) {
      const normalizedKey = key.toLocaleLowerCase().replace(/[^a-z0-9]/g, "");
      const nestedContext = insidePositionContext ||
        /^(?:position|location|coordinates?|gpsposition)$/.test(normalizedKey);
      shapes.push(...alternatePositionSourceShapes(entry as Record<string, unknown>, depth + 1, nestedContext));
    }
  }
  return shapes;
}

function normalizeRecord(
  value: unknown,
  now: number,
  staleAfterMs: number,
  sourceTimeZone?: string | null,
  includeDiagnosticUnknownPositionSourceText = false
): ForthTrackingRecord {
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
  const timestamp = parseTimestamp(raw.dateTime, now, staleAfterMs, sourceTimeZone);
  const positionSource = optionalText(raw.positionSource);
  const hasPositionSource = Object.hasOwn(raw, "positionSource");
  const speed = numericValue(raw.Speed);
  const heading = numericValue(raw.COG);
  const gprsValue = parseBoolean(raw.GPRS);

  return {
    sourceAudit: {
      registration: sourceFieldSnapshot(raw.plateNumber, Object.hasOwn(raw, "plateNumber")),
      deviceId: sourceFieldSnapshot(raw.gpsID, Object.hasOwn(raw, "gpsID")),
      driver: driverSourceFieldSnapshot(raw.driver, Object.hasOwn(raw, "driver")),
      latitude: sourceFieldSnapshot(raw.Latitude, Object.hasOwn(raw, "Latitude")),
      longitude: sourceFieldSnapshot(raw.Longitude, Object.hasOwn(raw, "Longitude")),
      speed: sourceFieldSnapshot(raw.Speed, Object.hasOwn(raw, "Speed")),
      engine: sourceFieldSnapshot(raw.Engine, Object.hasOwn(raw, "Engine")),
      heading: sourceFieldSnapshot(raw.COG, Object.hasOwn(raw, "COG")),
      gpsSignal: sourceFieldSnapshot(raw.GPS, Object.hasOwn(raw, "GPS")),
      gprs: sourceFieldSnapshot(raw.GPRS, Object.hasOwn(raw, "GPRS")),
      positionSource: sourceFieldSnapshot(raw.positionSource, Object.hasOwn(raw, "positionSource")),
      positionTimestamp: sourceFieldSnapshot(raw.dateTime, Object.hasOwn(raw, "dateTime"))
    },
    gpsDeviceId: optionalText(raw.gpsID),
    vehicleRegistration: optionalText(raw.plateNumber),
    reportedDriver: optionalDriverLabel(raw.driver),
    locationAddressEnglish: optionalLocationDescription(raw.addressE),
    locationAddressThai: optionalLocationDescription(raw.addressT),
    locationPointOfInterest: optionalLocationDescription(raw.poi),
    latitude: coordinateStatus === "valid" ? latitude.value : null,
    longitude: coordinateStatus === "valid" ? longitude.value : null,
    coordinateStatus,
    speed: speed !== null && speed >= 0 ? speed : null,
    engineOn: parseBoolean(raw.Engine),
    // GPS status and position source are separate Forth signals. A Wi-Fi/LBS
    // position can be fresh while GPS has no fix; do not let source metadata
    // override the explicit GPS field or imply the device lost communication.
    gpsConnectivity: gpsValue === false
      ? "disconnected"
      : gpsValue === true ? "connected" : "unknown",
    gprsConnectivity: gprsValue === null
      ? "unknown"
      : gprsValue ? "connected" : "disconnected",
    sourceTimestampRaw: typeof raw.dateTime === "string" ? raw.dateTime : null,
    lastGpsTimestamp: timestamp.timestamp,
    timestampStatus: timestamp.status,
    heading: heading !== null && heading >= 0 && heading <= 360 ? heading : null,
    positionSource,
    positionSourceRaw: includeDiagnosticUnknownPositionSourceText &&
      typeof raw.positionSource === "string" &&
      sourceQuality(positionSource) === "unknown"
      ? raw.positionSource
      : null,
    positionQuality: sourceQuality(positionSource),
    positionSourceShape: positionSourceShape(raw.positionSource, hasPositionSource),
    alternatePositionSourceCandidates: alternatePositionSourceShapes(raw),
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
  options: {
    now?: number;
    staleAfterMs?: number;
    sourceTimeZone?: string | null;
    includeDiagnosticUnknownPositionSourceText?: boolean;
  } = {}
): ForthTrackingRecord[] {
  if (!Array.isArray(payload)) throw new ForthTrackingPayloadError();
  const now = options.now ?? Date.now();
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  return payload.map((record) => normalizeRecord(
    record,
    now,
    staleAfterMs,
    options.sourceTimeZone,
    options.includeDiagnosticUnknownPositionSourceText === true
  ));
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
