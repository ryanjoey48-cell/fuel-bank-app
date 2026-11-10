/**
 * V7.8 visit map: pure shaping of ONE visit's map evidence. Observed positions, Forth saved-point candidates and the match are kept as three
 * different kinds of thing. Nothing here invents a coordinate, upgrades a saved point to a confirmed customer location, or uses the Forth
 * diameter field as a boundary.
 */
export const MAX_MAP_POSITIONS = 240;
export type MapPosition = { at: string; latitude: number; longitude: number; verified: boolean; speedKph: number | null; phase: "before" | "during" | "after"; distanceFromCentreM: number };
export type MapCandidate = { id: string; name: string; thaiName: string | null; latitude: number; longitude: number; distanceM: number; source: "office_confirmed_pin" | "forth_saved_location"; category: string | null; role: "primary" | "alternative" | "nearby" };
export type VisitInfo = { firstAt: string; lastAt: string; observedMinutes: number; spanMinutes: number; maxMinutes: number | null; stops: number; observations: number; sourceQuality: "verified_gps" | "mixed" | "unverified"; openStart: boolean; openEnd: boolean; nextToGap: boolean; interruptions: number; missingReports: number; arrival: { earliest: string | null; latest: string }; departure: { earliest: string; latest: string | null }; spreadM: number };
export type MapMatch = { status: string; reasons: string[]; uncertainty: string[]; primaryName: string | null; primaryDistanceM: number | null };
export type VisitMapBase = { vehicleId: string; registration: string; day: string; visitId: string };
export type VisitMapData = VisitMapBase & (
  | { status: "day_not_held" | "visit_not_found" }
  | {
    status: "ready" | "no_location_evidence";
    visit: VisitInfo;
    centre: { latitude: number; longitude: number } | null;
    match: MapMatch;
    candidates: MapCandidate[];
    positions: MapPosition[];
    positionCounts: { shown: number; total: number; verifiedShown: number; unverifiedShown: number; downsampled: boolean };
  }
);

/** Keeps the first and last position and every unverified one, then thins verified ones evenly. Order is preserved. */
export function boundPositions<T extends { at: string; verified: boolean }>(items: readonly T[], max = MAX_MAP_POSITIONS): { items: T[]; downsampled: boolean } {
  if (items.length <= max) return { items: [...items], downsampled: false };
  const keep = new Set<number>([0, items.length - 1]);
  items.forEach((p, i) => { if (!p.verified) keep.add(i); });
  const room = Math.max(0, max - keep.size);
  const verifiedIdx = items.map((p, i) => (p.verified && !keep.has(i) ? i : -1)).filter(i => i >= 0);
  const step = verifiedIdx.length / Math.max(room, 1);
  for (let k = 0; k < room && k * step < verifiedIdx.length; k++) keep.add(verifiedIdx[Math.floor(k * step)]);
  const out = [...keep].sort((a, b) => a - b).map(i => items[i]);
  // Unverified positions alone could exceed the bound; the cap is a hard limit.
  return { items: out.length > max ? out.filter((_, i) => i % Math.ceil(out.length / max) === 0).slice(0, max) : out, downsampled: true };
}

const validCoord = (p: { latitude: number; longitude: number }) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude) && Math.abs(p.latitude) <= 90 && Math.abs(p.longitude) <= 180 && !(p.latitude === 0 && p.longitude === 0);

export function visitMapView(input: {
  base: VisitMapBase;
  group: VisitInfo & { centroid: { latitude: number; longitude: number } };
  match: MapMatch;
  candidates: MapCandidate[]; positions: MapPosition[];
}): VisitMapData {
  const { base, group, match } = input;
  const usable = input.positions.filter(validCoord);
  const bounded = boundPositions(usable);
  const { centroid, ...visit } = group;
  const hasCentre = validCoord(centroid) && usable.length > 0;
  const candidates = input.candidates.filter(validCoord);
  return {
    ...base, status: hasCentre ? "ready" : "no_location_evidence", visit, centre: hasCentre ? centroid : null, match, candidates: hasCentre ? candidates : [],
    positions: bounded.items,
    positionCounts: { shown: bounded.items.length, total: usable.length, verifiedShown: bounded.items.filter(p => p.verified).length, unverifiedShown: bounded.items.filter(p => !p.verified).length, downsampled: bounded.downsampled }
  };
}

/** The map response only applies to the vehicle, day and visit it was requested for. A late answer for anything else is dropped. */
export type VisitMapRequest = Pick<VisitMapBase, "vehicleId" | "day" | "visitId">;
export const mapMatchesRequest = (data: VisitMapRequest | null | undefined, want: VisitMapRequest) => Boolean(data) && data!.vehicleId === want.vehicleId && data!.day === want.day && data!.visitId === want.visitId;

/** Visit selection survives a refresh only if a visit with the same observed window still exists; ids (V01…) are positional and can shift. */
export function reselectVisit(prev: { id: string; firstAt: string; lastAt: string } | null, visits: readonly { id: string; firstAt: string; lastAt: string }[]): string | null {
  if (!prev) return null;
  const same = visits.find(v => v.firstAt === prev.firstAt && v.lastAt === prev.lastAt);
  if (same) return same.id;
  const s0 = Date.parse(prev.firstAt), e0 = Date.parse(prev.lastAt);
  const overlapping = visits.filter(v => Math.min(e0, Date.parse(v.lastAt)) - Math.max(s0, Date.parse(v.firstAt)) > 0);
  return overlapping.length === 1 ? overlapping[0].id : null;
}

export const MAP_COPY = {
  viewLocation: ["View location", "ดูตำแหน่ง"], viewRoute: ["View route", "ดูเส้นทาง"], nearbySites: ["Nearby saved sites", "สถานที่ที่บันทึกใกล้เคียง"],
  possible: ["Possible match", "อาจตรงกัน"], likely: ["Likely match", "น่าจะตรงกัน"], multiple: ["Multiple candidates", "มีหลายผู้สมัคร"], unknown: ["Unknown stopping area", "พื้นที่จอดที่ไม่ทราบ"],
  verified: ["Verified GPS", "GPS ที่ยืนยัน"], unverified: ["Unverified GPS", "GPS ที่ไม่ยืนยัน"], gap: ["Tracking gap", "ช่วงขาดข้อมูล"], window: ["Observed time window", "ช่วงเวลาที่สังเกตได้"],
  details: ["Visit details", "รายละเอียดการเข้าเยี่ยม"], close: ["Close map", "ปิดแผนที่"], prev: ["Previous visit", "การเข้าเยี่ยมก่อนหน้า"], next: ["Next visit", "การเข้าเยี่ยมถัดไป"],
  evidence: ["Open original evidence", "เปิดหลักฐานต้นฉบับ"], fuelReview: ["Fuel review", "ตรวจสอบเชื้อเพลิง"], coverage: ["Fleet evidence coverage", "ความครอบคลุมหลักฐานของกลุ่มรถ"]
} as const;
export const mapText = (key: keyof typeof MAP_COPY, language: "en" | "th") => MAP_COPY[key][language === "th" ? 1 : 0];
