/**
 * Operational map camera helpers for EES Fleet Tracking.
 * Cameras never rewrite Forth coordinates — they only change the Leaflet viewport.
 */

export type ForthMapCameraMode =
  | "bangkok"
  | "thailand_neighbours"
  | "full_fleet"
  | "driving"
  | "gps_verified"
  | "selected";

/**
 * Core Operations corridor (camera only): Bangkok, Samut Prakan, Lat Krabang,
 * Chonburi, Laem Chabang, Rayong and nearby industrial areas.
 * Kept under the historical `bangkok` mode id so existing callers keep working.
 */
export const FORTH_CORE_OPS_BOUNDS: [[number, number], [number, number]] = [
  [12.55, 100.20],
  [14.20, 101.55]
];

/** @deprecated Alias — Core Operations replaced the narrower Bangkok-only box. */
export const FORTH_BANGKOK_OPS_BOUNDS = FORTH_CORE_OPS_BOUNDS;

export const FORTH_CORE_OPS_CENTER: [number, number] = [13.55, 100.95];
export const FORTH_BANGKOK_OPS_CENTER = FORTH_CORE_OPS_CENTER;

/** Practical Core Operations zoom — roads/icons readable without fitting the whole country. */
export const FORTH_CORE_OPS_ZOOM = 9;
export const FORTH_BANGKOK_OPS_ZOOM = FORTH_CORE_OPS_ZOOM;

/** Thailand and neighbouring countries (camera only). */
export const FORTH_THAILAND_NEIGHBOURS_BOUNDS: [[number, number], [number, number]] = [
  [5.2, 96.8],
  [21.0, 106.0]
];

export const FORTH_THAILAND_NEIGHBOURS_CENTER: [number, number] = [13.2, 101.0];
export const FORTH_THAILAND_NEIGHBOURS_ZOOM = 6;

export function isWithinForthCoreOpsBounds(latitude: number, longitude: number) {
  if (![latitude, longitude].every(Number.isFinite)) return false;
  const [[south, west], [north, east]] = FORTH_CORE_OPS_BOUNDS;
  return latitude >= south && latitude <= north && longitude >= west && longitude <= east;
}

/** @deprecated Prefer isWithinForthCoreOpsBounds. */
export const isWithinForthBangkokOpsBounds = isWithinForthCoreOpsBounds;

export function isWithinForthThailandNeighboursBounds(latitude: number, longitude: number) {
  if (![latitude, longitude].every(Number.isFinite)) return false;
  const [[south, west], [north, east]] = FORTH_THAILAND_NEIGHBOURS_BOUNDS;
  return latitude >= south && latitude <= north && longitude >= west && longitude <= east;
}

/**
 * Vehicles with valid Forth coordinates outside the Core Operations corridor.
 * Distinct from viewport-offscreen, Thailand-outside, missing coords, and GPS unverified.
 */
export function classifyOutsideCoreOperations(
  points: Array<{ key: string; latitude: number; longitude: number }>
) {
  const valid = points.filter(
    (point) =>
      Number.isFinite(point.latitude) &&
      point.latitude >= -90 &&
      point.latitude <= 90 &&
      Number.isFinite(point.longitude) &&
      point.longitude >= -180 &&
      point.longitude <= 180
  );
  const inside: string[] = [];
  const outside: string[] = [];
  for (const point of valid) {
    if (isWithinForthCoreOpsBounds(point.latitude, point.longitude)) inside.push(point.key);
    else outside.push(point.key);
  }
  return { inside, outside };
}

/**
 * Positions that sit outside the densest working majority when Fit Fleet would
 * otherwise pull the camera across the whole country (e.g. Phuket + Bangkok).
 * Used for UI disclosure only — markers stay at source coordinates.
 */
export function classifyForthMapOutliers(
  points: Array<{ key: string; latitude: number; longitude: number }>
) {
  const valid = points.filter(
    (point) =>
      Number.isFinite(point.latitude) &&
      point.latitude >= -90 &&
      point.latitude <= 90 &&
      Number.isFinite(point.longitude) &&
      point.longitude >= -180 &&
      point.longitude <= 180
  );
  if (valid.length < 4) {
    return { inViewMajority: valid.map((point) => point.key), outliers: [] as string[] };
  }

  const distanceKm = (left: { latitude: number; longitude: number }, right: { latitude: number; longitude: number }) => {
    const radians = (degrees: number) => (degrees * Math.PI) / 180;
    const latitudeDelta = radians(right.latitude - left.latitude);
    const longitudeDelta = radians(right.longitude - left.longitude);
    const haversine =
      Math.sin(latitudeDelta / 2) ** 2 +
      Math.cos(radians(left.latitude)) * Math.cos(radians(right.latitude)) * Math.sin(longitudeDelta / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(Math.max(0, 1 - haversine)));
  };

  const nearby = valid.map((anchor) => valid.filter((point) => distanceKm(anchor, point) <= 90));
  const primary = nearby.reduce((best, candidate) => (candidate.length > best.length ? candidate : best), nearby[0]);
  if (primary.length < Math.ceil(valid.length / 2) || primary.length === valid.length) {
    return { inViewMajority: valid.map((point) => point.key), outliers: [] as string[] };
  }
  const majorityKeys = new Set(primary.map((point) => point.key));
  return {
    inViewMajority: [...majorityKeys],
    outliers: valid.filter((point) => !majorityKeys.has(point.key)).map((point) => point.key)
  };
}

/** Build an external OpenStreetMap link for a reported Forth coordinate. */
export function forthReportedCoordinateMapsUrl(latitude: number, longitude: number) {
  if (![latitude, longitude].every(Number.isFinite)) return null;
  const lat = Number(latitude.toFixed(6));
  const lng = Number(longitude.toFixed(6));
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`;
}

export function forthReportedCoordinateClipboardText(latitude: number, longitude: number) {
  if (![latitude, longitude].every(Number.isFinite)) return null;
  return `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
}
