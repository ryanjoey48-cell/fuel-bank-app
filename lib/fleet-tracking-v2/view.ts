export type MotionState = "moving" | "stopped" | "offline" | "unknown";

export type FleetV2Vehicle = {
  id: string;
  registration: string;
  sampleTag?: "SIMULATED";
  trackerConnectivity: "connected" | "disconnected" | "unknown";
  locationNameEn: string;
  locationNameTh: string;
  latitude: number | null;
  longitude: number | null;
  coordinateStatus?: "valid" | "missing" | "invalid";
  speedKph: number | null;
  engineOn: boolean | null;
  reportedAt: string | null;
  gpsTrust: "verified" | "unverified" | "missing" | "stale" | "offline";
  gpsQuality: "gps" | "wifi" | "unknown" | "none";
  scenario?: string;
  activityState?: MotionState;
};

export const FLEET_V2_MARKER_SIZE_PX = 28;
export const FLEET_V2_COLLISION_RADIUS_PX = 34;
/** Neighbourhood scale: enough road context to see where the truck is. */
export const FLEET_V2_FOCUS_ZOOM = 12;
export const FLEET_V2_LABEL_ZOOM = 8;
export const FLEET_V2_OPERATING_CENTER: [number, number] = [13.7563, 100.5018];
export const FLEET_V2_OPERATING_RADIUS_KM = 150;
export const FLEET_V2_DEFAULT_ZOOM = 9;

export function isTrustedMapPosition(vehicle: FleetV2Vehicle) {
  return vehicle.gpsTrust === "verified" &&
    (vehicle.coordinateStatus === undefined || vehicle.coordinateStatus === "valid") &&
    typeof vehicle.latitude === "number" &&
    typeof vehicle.longitude === "number" &&
    Number.isFinite(vehicle.latitude) &&
    Number.isFinite(vehicle.longitude) &&
    vehicle.latitude >= -90 &&
    vehicle.latitude <= 90 &&
    vehicle.longitude >= -180 &&
    vehicle.longitude <= 180 &&
    vehicle.gpsQuality === "gps";
}

export function canFocusVehicle(vehicle: FleetV2Vehicle) {
  return isTrustedMapPosition(vehicle);
}

/** Only expose original, legal source coordinates after an explicit user opt-in. */
export function canShowUnverifiedReportedPosition(vehicle: FleetV2Vehicle) {
  return vehicle.gpsTrust !== "verified" &&
    vehicle.gpsTrust !== "offline" &&
    (vehicle.coordinateStatus === undefined || vehicle.coordinateStatus === "valid") &&
    typeof vehicle.latitude === "number" &&
    Number.isFinite(vehicle.latitude) &&
    vehicle.latitude >= -90 &&
    vehicle.latitude <= 90 &&
    typeof vehicle.longitude === "number" &&
    Number.isFinite(vehicle.longitude) &&
    vehicle.longitude >= -180 &&
    vehicle.longitude <= 180;
}

export function getVisibleMapVehicles(vehicles: FleetV2Vehicle[], showUnverifiedReportedPositions = false) {
  return vehicles.filter((vehicle) =>
    isTrustedMapPosition(vehicle) ||
    (showUnverifiedReportedPositions && canShowUnverifiedReportedPosition(vehicle))
  );
}

export function getMotionState(vehicle: FleetV2Vehicle): MotionState {
  if (vehicle.activityState) return vehicle.activityState;
  if (vehicle.gpsTrust === "offline") return "offline";
  if (vehicle.gpsTrust === "missing" || vehicle.gpsTrust === "unverified" || vehicle.gpsTrust === "stale") {
    return "unknown";
  }
  if (!isTrustedMapPosition(vehicle)) return "unknown";
  if (typeof vehicle.speedKph === "number" && vehicle.speedKph > 0 && vehicle.engineOn !== false) return "moving";
  return "stopped";
}

export type FleetV2RosterFilter = "all" | "moving" | "stopped" | "unknown" | "offline";

/** Tracker connectivity is an independent filter and never rewrites reported activity. */
export function matchesFleetV2RosterFilter(vehicle: FleetV2Vehicle, filter: FleetV2RosterFilter) {
  if (filter === "all") return true;
  if (filter === "offline") return vehicle.trackerConnectivity === "disconnected";
  const activity = getMotionState(vehicle);
  if (filter === "unknown") return activity === "unknown" && vehicle.trackerConnectivity !== "disconnected";
  return activity === filter;
}

export function getMapVehicles(vehicles: FleetV2Vehicle[]) {
  return vehicles.filter(isTrustedMapPosition);
}

export function distanceKm(from: [number, number], to: [number, number]) {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(to[0] - from[0]);
  const dLng = toRad(to[1] - from[1]);
  const lat1 = toRad(from[0]);
  const lat2 = toRad(to[0]);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function getOperatingAreaPositions(vehicles: FleetV2Vehicle[]): [number, number][] {
  return getFleetFitPositions(vehicles);
}

/** Keep explicit fleet fits inside the useful EES operating area. */
export function getFleetFitPositions(
  vehicles: FleetV2Vehicle[],
  includeUnverifiedReportedPositions = false
): [number, number][] {
  return vehicles
    .filter((vehicle) => isTrustedMapPosition(vehicle) ||
      (includeUnverifiedReportedPositions && canShowUnverifiedReportedPosition(vehicle)))
    .map((vehicle) => [vehicle.latitude as number, vehicle.longitude as number] as [number, number])
    .filter((position) => distanceKm(FLEET_V2_OPERATING_CENTER, position) <= FLEET_V2_OPERATING_RADIUS_KM);
}

/** Keep distant, verified trucks searchable and focusable without widening Fit Fleet. */
export function getVerifiedPositionsOutsideOperatingArea(vehicles: FleetV2Vehicle[]) {
  return vehicles.filter((vehicle) => isTrustedMapPosition(vehicle) &&
    distanceKm(FLEET_V2_OPERATING_CENTER, [vehicle.latitude as number, vehicle.longitude as number]) > FLEET_V2_OPERATING_RADIUS_KM);
}

export type MarkerScreenPoint = { key: string; x: number; y: number };

export function getMarkerCollisionGroups(points: MarkerScreenPoint[], radius = FLEET_V2_COLLISION_RADIUS_PX): string[][] {
  const valid = points.filter((point) => point.key && Number.isFinite(point.x) && Number.isFinite(point.y));
  const parent = valid.map((_, index) => index);
  const find = (index: number): number => {
    if (parent[index] !== index) parent[index] = find(parent[index]);
    return parent[index];
  };
  const union = (left: number, right: number) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
  };
  const radiusSquared = Math.max(0, radius) ** 2;
  for (let left = 0; left < valid.length; left += 1) {
    for (let right = left + 1; right < valid.length; right += 1) {
      const dx = valid[left].x - valid[right].x;
      const dy = valid[left].y - valid[right].y;
      if (dx * dx + dy * dy <= radiusSquared) union(left, right);
    }
  }
  const groups = new Map<number, string[]>();
  valid.forEach((point, index) => {
    const root = find(index);
    const group = groups.get(root) ?? [];
    group.push(point.key);
    groups.set(root, group);
  });
  return [...groups.values()].filter((group) => group.length > 1);
}

export function shouldOpenClusterPicker(
  positions: Array<[number, number]>,
  zoom: number,
  maxZoom: number
) {
  if (positions.length < 2) return false;
  if (Number.isFinite(zoom) && Number.isFinite(maxZoom) && zoom >= maxZoom) return true;
  const first = positions[0];
  return positions.every((position) => position[0] === first[0] && position[1] === first[1]);
}

export function getVisibleMarkerLabelKeys(
  placements: Array<{ key: string; left: number; top: number; width: number; height: number; selected: boolean }>,
  zoom: number,
  minimumZoom = FLEET_V2_LABEL_ZOOM
) {
  if (!Number.isFinite(zoom) || zoom < minimumZoom) {
    return new Set(placements.filter((placement) => placement.selected).map((placement) => placement.key));
  }
  const ordered = [...placements].sort((left, right) => {
    if (left.selected !== right.selected) return left.selected ? -1 : 1;
    return left.key.localeCompare(right.key);
  });
  const visible = new Set<string>();
  const boxes: Array<{ left: number; top: number; right: number; bottom: number }> = [];
  for (const placement of ordered) {
    const box = {
      left: placement.left,
      top: placement.top,
      right: placement.left + placement.width,
      bottom: placement.top + placement.height
    };
    const collides = boxes.some((existing) =>
      box.left < existing.right && box.right > existing.left && box.top < existing.bottom && box.bottom > existing.top
    );
    if (!collides || placement.selected) {
      visible.add(placement.key);
      boxes.push(box);
    }
  }
  return visible;
}

export function matchesVehicleSearch(vehicle: FleetV2Vehicle, query: string) {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  return [
    vehicle.registration,
    vehicle.locationNameEn,
    vehicle.locationNameTh,
    vehicle.id,
    vehicle.sampleTag
  ].filter((value): value is string => typeof value === "string" && value.length > 0)
    .some((value) => value.toLocaleLowerCase().includes(needle));
}

export function formatReportTime(iso: string | null, language: "en" | "th") {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-GB", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short"
  }).format(date);
}

export function formatReportAge(iso: string | null, language: "en" | "th") {
  if (!iso) return null;
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return null;
  const ageMs = syntheticNowMs() - timestamp;
  if (ageMs < 0) return language === "th" ? "เวลาในอนาคต" : "Future timestamp";
  const minutes = Math.floor(ageMs / 60_000);
  const formatter = new Intl.RelativeTimeFormat(language === "th" ? "th-TH" : "en-GB", { numeric: "auto" });
  if (minutes < 60) return formatter.format(-minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return formatter.format(-hours, "hour");
  return formatter.format(-Math.floor(hours / 24), "day");
}

export function formatSpeed(speedKph: number | null, kphLabel: string) {
  if (typeof speedKph !== "number" || !Number.isFinite(speedKph)) return "—";
  return `${Math.round(speedKph)} ${kphLabel}`;
}

export function syntheticNowMs() {
  return Date.parse("2026-10-25T00:20:00.000Z");
}
