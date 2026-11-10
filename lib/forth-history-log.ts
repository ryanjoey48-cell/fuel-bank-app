import { normalizeForthTrackingResponse } from "./forth-tracking";

export type HistoricalLogPoint = {
  sourceTimestamp: string | null;
  timestampIso: string | null;
  latitude: number | null;
  longitude: number | null;
  coordinateStatus: "valid" | "missing" | "invalid";
  gpsStatus: "connected" | "disconnected" | "unknown";
  positionSource: string | null;
  positionQuality: "gps" | "no_gps" | "wifi" | "lbs" | "other" | "unknown";
  /** True only when Forth positionSource quality is GPS (strict). */
  verifiedGps: boolean;
  /**
   * Eligible for a reported-position trail when GPS connectivity is connected,
   * coordinates/time exist, and the source is not Wi-Fi/LBS.
   * Some Forth log rows report GPS=connected with positionSource "No GPS";
   * those stay unverified but may form an amber reported trail.
   */
  trailEligible: boolean;
  speedKph: number | null;
  engineOn: boolean | null;
  sourceDistanceRaw: number | null;
};

export type HistoricalLogSegment = {
  fromIndex: number;
  toIndex: number;
  kind: "verified_gps" | "reported_trail";
};

export type HistoricalLogReplay = {
  points: HistoricalLogPoint[];
  /** Strict GPS-verified continuity only. */
  segments: Array<{ fromIndex: number; toIndex: number }>;
  /** Reported-position continuity (may include non-GPS source labels). */
  reportedTrailSegments: Array<{ fromIndex: number; toIndex: number }>;
  firstVerifiedIndex: number | null;
  lastVerifiedIndex: number | null;
};

const MAX_GAP_MS = 5 * 60_000;
const MAX_STRAIGHT_LINE_SPEED_KPH = 150;

function calendarStamp(value: string): number | null {
  if (!/^\d{14}$/.test(value)) return null;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const hour = Number(value.slice(8, 10));
  const minute = Number(value.slice(10, 12));
  const second = Number(value.slice(12, 14));
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day ||
    date.getUTCHours() !== hour || date.getUTCMinutes() !== minute || date.getUTCSeconds() !== second) return null;
  return date.getTime();
}

/** Fixed endpoint shape, with one device and a window within one calendar day. No request is sent. */
export function buildHistoricalLogPath(deviceId: string, startTime: string, endTime: string): string | null {
  if (!deviceId || deviceId.length > 80 || deviceId.trim() !== deviceId || /[\p{Cc},/\\?#]/u.test(deviceId)) return null;
  const start = calendarStamp(startTime);
  const end = calendarStamp(endTime);
  if (start === null || end === null || end <= start || end - start > 24 * 60 * 60_000 ||
    startTime.slice(0, 8) !== endTime.slice(0, 8)) return null;
  return `/trackingresource/api/log/${encodeURIComponent(deviceId)}/${startTime}/${endTime}`;
}

function straightLineKm(a: HistoricalLogPoint, b: HistoricalLogPoint): number {
  const lat1 = a.latitude! * Math.PI / 180;
  const lat2 = b.latitude! * Math.PI / 180;
  const dLat = lat2 - lat1;
  const dLon = (b.longitude! - a.longitude!) * Math.PI / 180;
  const hav = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(hav)));
}

function canLink(a: HistoricalLogPoint, b: HistoricalLogPoint): boolean {
  if (!a.timestampIso || !b.timestampIso) return false;
  if (a.latitude == null || a.longitude == null || b.latitude == null || b.longitude == null) return false;
  const gapMs = Date.parse(b.timestampIso) - Date.parse(a.timestampIso);
  if (gapMs <= 0 || gapMs > MAX_GAP_MS) return false;
  if (straightLineKm(a, b) / (gapMs / 3_600_000) > MAX_STRAIGHT_LINE_SPEED_KPH) return false;
  return true;
}

function isTrailEligible(
  coordinateStatus: HistoricalLogPoint["coordinateStatus"],
  gpsStatus: HistoricalLogPoint["gpsStatus"],
  positionQuality: HistoricalLogPoint["positionQuality"],
  timestampIso: string | null
): boolean {
  if (coordinateStatus !== "valid" || !timestampIso) return false;
  if (gpsStatus !== "connected") return false;
  // Explicit non-GPS radio methods stay off the reported trail.
  if (positionQuality === "wifi" || positionQuality === "lbs") return false;
  return true;
}

/** Offline allowlist: excludes IDCard, IDTransport, fuel and sensor data. */
export function normalizeHistoricalLog(payload: unknown, deviceId: string, sourceTimeZone?: string | null): HistoricalLogReplay | null {
  if (!Array.isArray(payload) || payload.length > 20_000 || !deviceId) return null;
  if (payload.some(row => row === null || typeof row !== "object" || Array.isArray(row) ||
    (row as Record<string, unknown>).gpsID !== deviceId)) return null;
  let normalized: ReturnType<typeof normalizeForthTrackingResponse>;
  try {
    normalized = normalizeForthTrackingResponse(payload, { sourceTimeZone });
  } catch { return null; }
  const points = normalized.map((row, index): HistoricalLogPoint => {
    const rawDistance = (payload[index] as Record<string, unknown>).Distance;
    const sourceDistanceRaw = typeof rawDistance === "number" && Number.isSafeInteger(rawDistance) && rawDistance >= 0
      ? rawDistance : null;
    const verifiedGps = row.coordinateStatus === "valid" && row.gpsConnectivity === "connected" &&
      row.positionQuality === "gps" && row.lastGpsTimestamp !== null;
    const trailEligible = isTrailEligible(
      row.coordinateStatus,
      row.gpsConnectivity,
      row.positionQuality,
      row.lastGpsTimestamp
    );
    return {
      sourceTimestamp: row.sourceTimestampRaw,
      timestampIso: row.lastGpsTimestamp,
      latitude: row.latitude,
      longitude: row.longitude,
      coordinateStatus: row.coordinateStatus,
      gpsStatus: row.gpsConnectivity,
      positionSource: row.positionSource,
      positionQuality: row.positionQuality,
      verifiedGps,
      trailEligible,
      speedKph: row.speed,
      engineOn: row.engineOn,
      sourceDistanceRaw
    };
  });
  const segments: HistoricalLogReplay["segments"] = [];
  const reportedTrailSegments: HistoricalLogReplay["reportedTrailSegments"] = [];
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1]!;
    const b = points[index]!;
    if (!canLink(a, b)) continue;
    if (a.verifiedGps && b.verifiedGps) {
      segments.push({ fromIndex: index - 1, toIndex: index });
    }
    if (a.trailEligible && b.trailEligible) {
      reportedTrailSegments.push({ fromIndex: index - 1, toIndex: index });
    }
  }
  const firstVerifiedIndex = points.findIndex(point => point.verifiedGps);
  const lastVerifiedIndex = points.findLastIndex(point => point.verifiedGps);
  return {
    points,
    segments,
    reportedTrailSegments,
    firstVerifiedIndex: firstVerifiedIndex < 0 ? null : firstVerifiedIndex,
    lastVerifiedIndex: lastVerifiedIndex < 0 ? null : lastVerifiedIndex
  };
}
