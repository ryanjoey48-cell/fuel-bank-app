/**
 * V6.4 recurring stopping areas and movement patterns. Pure and read-only.
 *
 * It takes stops that the existing V5.2 detector (`detectStopClusters`) already produced for reviewed vehicle-days and groups them
 * into areas. It adds NO new stop or distance calculation. Nothing here reads any job or order data, and nothing is saved.
 *
 * Evidence rules (deliberate):
 *  - Independent repeat evidence is a distinct DAY. Several visits by one vehicle on one day, or by many vehicles on one day, are
 *    counted as visits but are never counted as repeat days.
 *  - Recurrence never upgrades an unverified position to verified; source quality is carried from the stops themselves.
 *  - A stay is the OBSERVED minimum from the stop detector; a tracking gap is never added to a stay.
 *  - "Depot" or "customer" is never inferred from movement. A depot hint needs a directory point categorised as depot or office;
 *    a customer-area hint needs a directory point and a repeat. Everything else is just a recurring area.
 *  - Areas are grown from a seed and bounded in both radius and diameter, so a chain of nearby stops cannot become one huge area.
 */
import { metersBetween } from "./fleet-job-movement";
import type { StopCluster } from "./fleet-stop-intelligence";
import { isEesDepotOrOfficeCategory } from "./forth-gps-map-locations";
import type { SiteMatch } from "./fleet-location-match";

export type AreaVisit = {
  vehicleKey: string;
  registration: string;
  day: string;
  cluster: StopCluster;
  /** Provider-confirmed missing minutes for that vehicle-day, when known. */
  dayMissingMinutes?: number | null;
};
export type DirectoryPoint = {
  id: string; name: string; latitude: number; longitude: number;
  source: "office_confirmed_pin" | "forth_saved_location";
  category?: string | null;
  /** V7.3: Forth stores a name layer, a Thai name and a site diameter per saved location; used only for read-only site matching. The diameter has no verified unit and is a hint, never a boundary. */
  thaiName?: string | null; groupLayer?: string | null; forthDiameterRaw?: string | null; boundaryVerified?: boolean;
};
export type AnalysisOptions = {
  /** A stop joins an area only if it is within this distance of the area seed. */
  seedRadiusM: number;
  /** ...and within this distance of EVERY member, which stops chains of nearby stops from growing without bound. */
  maxDiameterM: number;
  minRecurringDays: number;
  extendedStayMinutes: number;
  /** Observed stays shorter than this on every visit are flagged as possibly roadside or traffic. */
  shortStayMinutes: number;
  directoryRadiusM: number;
  neighbourWarningM: number;
  maxVisits: number;
  maxAreas: number;
};
export const DEFAULT_OPTIONS: AnalysisOptions = { seedRadiusM: 120, maxDiameterM: 250, minRecurringDays: 2, extendedStayMinutes: 60, shortStayMinutes: 10, directoryRadiusM: 150, neighbourWarningM: 400, maxVisits: 2000, maxAreas: 60 };

export type AreaKind = "one_off_stop" | "extended_stay" | "recurring_area" | "possible_customer_area" | "likely_depot_area";
export type PlaceHint = "near_depot_or_office" | "near_directory_location" | "near_unverified_directory_point" | "multiple_plausible" | "no_match";
export type AreaFlag = "same_day_repeats_only" | "single_vehicle" | "multi_vehicle" | "short_stays_only_possible_roadside" | "next_to_tracking_gap" | "unverified_positions" | "could_be_neighbouring_site" | "duplicates_removed";
export type QualityMix = { verified: number; mixed: number; unverified: number };

export type RecurringArea = {
  id: string;
  centroid: { latitude: number; longitude: number };
  radiusM: number;
  kind: AreaKind;
  placeHint: PlaceHint;
  matches: { id: string; name: string; distanceM: number; source: DirectoryPoint["source"]; depotOrOffice: boolean }[];
  visits: number;
  /** Distinct vehicle-days: the independent unit of evidence for "this vehicle really goes here". */
  vehicleDays: number;
  distinctDays: number;
  vehicles: string[];
  firstSeen: string; lastSeen: string;
  days: string[];
  stayMinutes: { min: number; median: number; longestSupported: number };
  quality: QualityMix;
  visitsNextToGap: number;
  daysWithKnownMissingTracking: number;
  flags: AreaFlag[];
  nearestOtherAreaM: number | null;
  /** V7.3: directory site match (attached by the server after analysis; the analysis above is unchanged). */
  siteMatch?: SiteMatch;
  /** The visits, newest first, capped, so a screen can list dates without a raw-position payload. */
  visitList: { registration: string; day: string; firstAt: string; lastAt: string; stayMinutesObserved: number; sourceQuality: StopCluster["sourceQuality"] }[];
};

export type MovementPattern = { from: string; to: string; days: number; vehicles: number; vehicleDays: number; kind: "repeated_sequence" | "return_to_area" };
export type SampleInfo = { vehicleDays: number; vehicles: number; days: number; visitsAnalysed: number; duplicatesRemoved: number; slowMovementIgnored: number; truncated: boolean };
export type RecurringAnalysis = { options: AnalysisOptions; sample: SampleInfo; areas: RecurringArea[]; patterns: MovementPattern[]; areasTotal: number; limits: string[] };

const round1 = (n: number) => Math.round(n * 10) / 10;
const ms = (iso: string) => Date.parse(iso);
const minutesOf = (c: StopCluster) => Math.round(c.dwellMs.min / 60_000);
const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : 0; };
const centroidOf = (pts: { latitude: number; longitude: number }[]) => ({ latitude: pts.reduce((n, p) => n + p.latitude, 0) / pts.length, longitude: pts.reduce((n, p) => n + p.longitude, 0) / pts.length });
const validPoint = (p: { latitude: number; longitude: number }) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude) && Math.abs(p.latitude) <= 90 && Math.abs(p.longitude) <= 180;

export function analyseRecurringAreas(input: readonly AreaVisit[], directory: readonly DirectoryPoint[] = [], overrides: Partial<AnalysisOptions> = {}): RecurringAnalysis {
  const options: AnalysisOptions = { ...DEFAULT_OPTIONS, ...overrides };
  const limits: string[] = [];
  const stops = input.filter(v => v.cluster.kind === "stop" && validPoint(v.cluster.centroid));
  const slowMovementIgnored = input.filter(v => v.cluster.kind !== "stop").length;

  // Exact duplicate evidence (the same vehicle, day and stop window supplied twice) counts once.
  const seen = new Set<string>(); const unique: AreaVisit[] = [];
  for (const v of stops) {
    const key = `${v.vehicleKey}|${v.day}|${v.cluster.firstAt}|${v.cluster.lastAt}`;
    if (seen.has(key)) continue; seen.add(key); unique.push(v);
  }
  const duplicatesRemoved = stops.length - unique.length;
  // Deterministic order: longest observed stay seeds first, ties by day, time and vehicle.
  const ordered = [...unique].sort((a, b) => b.cluster.dwellMs.min - a.cluster.dwellMs.min || (a.day < b.day ? -1 : a.day > b.day ? 1 : 0) || ms(a.cluster.firstAt) - ms(b.cluster.firstAt) || (a.vehicleKey < b.vehicleKey ? -1 : a.vehicleKey > b.vehicleKey ? 1 : 0));
  const truncated = ordered.length > options.maxVisits;
  const work = truncated ? ordered.slice(0, options.maxVisits) : ordered;
  if (truncated) limits.push(`Only the ${options.maxVisits} longest stays were analysed.`);

  type Group = { seed: { latitude: number; longitude: number }; members: AreaVisit[] };
  const groups: Group[] = [];
  for (const visit of work) {
    const c = visit.cluster.centroid; let best: Group | null = null; let bestDistance = Infinity;
    for (const g of groups) {
      const d = metersBetween(g.seed, c);
      if (d > options.seedRadiusM || d >= bestDistance) continue;
      // The diameter bound: the new stop must be close to every member, not only to the seed.
      if (g.members.some(m => metersBetween(m.cluster.centroid, c) > options.maxDiameterM)) continue;
      best = g; bestDistance = d;
    }
    if (best) best.members.push(visit); else groups.push({ seed: c, members: [visit] });
  }

  const built = groups.map(g => {
    const pts = g.members.map(m => m.cluster.centroid); const centroid = centroidOf(pts);
    const days = [...new Set(g.members.map(m => m.day))].sort();
    const vehicles = [...new Set(g.members.map(m => m.registration))].sort();
    const vehicleDays = new Set(g.members.map(m => `${m.vehicleKey}|${m.day}`)).size;
    const stays = g.members.map(m => minutesOf(m.cluster));
    const quality: QualityMix = { verified: g.members.filter(m => m.cluster.sourceQuality === "verified_gps").length, mixed: g.members.filter(m => m.cluster.sourceQuality === "mixed").length, unverified: g.members.filter(m => m.cluster.sourceQuality === "unverified").length };
    const nextToGap = g.members.filter(m => (m.cluster.beforeAt !== null && m.cluster.gapBefore) || (m.cluster.afterAt !== null && m.cluster.gapAfter)).length;
    const daysWithMissing = new Set(g.members.filter(m => (m.dayMissingMinutes ?? 0) > 0).map(m => m.day)).size;
    const matches = directory.filter(d => validPoint(d)).map(d => ({ id: d.id, name: d.name, distanceM: Math.round(metersBetween(centroid, d)), source: d.source, depotOrOffice: isEesDepotOrOfficeCategory(d.category ?? null) }))
      .filter(m => m.distanceM <= options.directoryRadiusM).sort((a, b) => a.distanceM - b.distanceM || (a.id < b.id ? -1 : 1)).slice(0, 3);
    const radiusM = Math.round(Math.max(0, ...pts.map(p => metersBetween(centroid, p))));
    const sortedVisits = [...g.members].sort((a, b) => ms(b.cluster.firstAt) - ms(a.cluster.firstAt));
    return { g, centroid, days, vehicles, vehicleDays, stays, quality, nextToGap, daysWithMissing, matches, radiusM, sortedVisits };
  });

  // Stable ids: ordered by position, not by arrival order.
  built.sort((a, b) => a.centroid.latitude - b.centroid.latitude || a.centroid.longitude - b.centroid.longitude);
  const ids = built.map((_, i) => `RA-${String(i + 1).padStart(2, "0")}`);

  const areas: RecurringArea[] = built.map((b, i) => {
    const longest = Math.max(...b.stays); const recurring = b.days.length >= options.minRecurringDays;
    const hint: PlaceHint = b.matches.length === 0 ? "no_match"
      : b.matches.length > 1 && !b.matches.every(m => m.depotOrOffice === b.matches[0].depotOrOffice) ? "multiple_plausible"
      : b.matches.length > 1 ? "multiple_plausible"
      : b.matches[0].depotOrOffice ? "near_depot_or_office" : b.matches[0].source === "office_confirmed_pin" ? "near_directory_location" : "near_unverified_directory_point";
    const kind: AreaKind = hint === "near_depot_or_office" ? "likely_depot_area" : recurring && (hint === "near_directory_location" || hint === "near_unverified_directory_point") ? "possible_customer_area" : recurring ? "recurring_area" : longest >= options.extendedStayMinutes ? "extended_stay" : "one_off_stop";
    const otherDistances = built.filter((_, j) => j !== i).map(o => metersBetween(b.centroid, o.centroid));
    const nearest = otherDistances.length ? Math.round(Math.min(...otherDistances)) : null;
    const flags: AreaFlag[] = [];
    if (b.g.members.length > b.vehicleDays && b.days.length === 1) flags.push("same_day_repeats_only");
    flags.push(b.vehicles.length > 1 ? "multi_vehicle" : "single_vehicle");
    if (b.stays.every(s => s < options.shortStayMinutes)) flags.push("short_stays_only_possible_roadside");
    if (b.nextToGap > 0) flags.push("next_to_tracking_gap");
    if (b.quality.verified < b.g.members.length) flags.push("unverified_positions");
    if (nearest !== null && nearest <= options.neighbourWarningM) flags.push("could_be_neighbouring_site");
    if (duplicatesRemoved > 0) flags.push("duplicates_removed");
    return {
      id: ids[i], centroid: b.centroid, radiusM: b.radiusM, kind, placeHint: hint, matches: b.matches, visits: b.g.members.length, vehicleDays: b.vehicleDays,
      distinctDays: b.days.length, vehicles: b.vehicles, firstSeen: b.sortedVisits.at(-1)!.cluster.firstAt, lastSeen: b.sortedVisits[0].cluster.firstAt, days: b.days,
      stayMinutes: { min: Math.min(...b.stays), median: round1(median(b.stays)), longestSupported: longest }, quality: b.quality, visitsNextToGap: b.nextToGap, daysWithKnownMissingTracking: b.daysWithMissing,
      flags, nearestOtherAreaM: nearest,
      visitList: b.sortedVisits.slice(0, 12).map(m => ({ registration: m.registration, day: m.day, firstAt: m.cluster.firstAt, lastAt: m.cluster.lastAt, stayMinutesObserved: minutesOf(m.cluster), sourceQuality: m.cluster.sourceQuality }))
    };
  });

  // Movement patterns: ordered area sequences per vehicle-day. The first or last stop of a day is never assumed to be a depot.
  const areaOf = new Map<AreaVisit, string>();
  built.forEach((b, i) => b.g.members.forEach(m => areaOf.set(m, ids[i])));
  const sequences = new Map<string, { vehicleKey: string; registration: string; day: string; seq: string[] }>();
  for (const v of [...work].sort((a, b) => ms(a.cluster.firstAt) - ms(b.cluster.firstAt))) {
    const k = `${v.vehicleKey}|${v.day}`; const entry = sequences.get(k) ?? { vehicleKey: v.vehicleKey, registration: v.registration, day: v.day, seq: [] };
    const id = areaOf.get(v)!; if (entry.seq.at(-1) !== id) entry.seq.push(id); sequences.set(k, entry);
  }
  const pairs = new Map<string, Set<string>>(); const pairVehicles = new Map<string, Set<string>>(); const pairDays = new Map<string, Set<string>>();
  const returns = new Map<string, Set<string>>(); const returnVehicles = new Map<string, Set<string>>(); const returnDays = new Map<string, Set<string>>();
  for (const s of sequences.values()) {
    for (let i = 0; i + 1 < s.seq.length; i++) { const k = `${s.seq[i]}>${s.seq[i + 1]}`; (pairs.get(k) ?? pairs.set(k, new Set()).get(k)!).add(`${s.vehicleKey}|${s.day}`); (pairVehicles.get(k) ?? pairVehicles.set(k, new Set()).get(k)!).add(s.registration); (pairDays.get(k) ?? pairDays.set(k, new Set()).get(k)!).add(s.day); }
    s.seq.forEach((id, i) => { if (s.seq.indexOf(id) !== i) { const k = `${id}>${id}`; (returns.get(k) ?? returns.set(k, new Set()).get(k)!).add(`${s.vehicleKey}|${s.day}`); (returnVehicles.get(k) ?? returnVehicles.set(k, new Set()).get(k)!).add(s.registration); (returnDays.get(k) ?? returnDays.set(k, new Set()).get(k)!).add(s.day); } });
  }
  const patterns: MovementPattern[] = [];
  for (const [k, set] of pairs) { const days = pairDays.get(k)!.size; if (days < options.minRecurringDays) continue; const [from, to] = k.split(">"); patterns.push({ from, to, days, vehicles: pairVehicles.get(k)!.size, vehicleDays: set.size, kind: "repeated_sequence" }); }
  for (const [k, set] of returns) { const days = returnDays.get(k)!.size; if (days < options.minRecurringDays) continue; const [from] = k.split(">"); patterns.push({ from, to: from, days, vehicles: returnVehicles.get(k)!.size, vehicleDays: set.size, kind: "return_to_area" }); }
  patterns.sort((a, b) => b.days - a.days || b.vehicleDays - a.vehicleDays || (a.from + a.to < b.from + b.to ? -1 : 1));

  // Spots where every observed stay is short (junctions, tolls, traffic) are listed after areas with real stays.
  const roadside = (x: RecurringArea) => (x.flags.includes("short_stays_only_possible_roadside") ? 1 : 0);
  areas.sort((a, b) => roadside(a) - roadside(b) || b.distinctDays - a.distinctDays || b.vehicles.length - a.vehicles.length || b.stayMinutes.longestSupported - a.stayMinutes.longestSupported || (a.id < b.id ? -1 : 1));
  const allDays = new Set(work.map(v => v.day)), allVehicles = new Set(work.map(v => v.vehicleKey)), allVehicleDays = new Set(work.map(v => `${v.vehicleKey}|${v.day}`));
  if (allDays.size < options.minRecurringDays) limits.push("Fewer than two reviewed days: no area can show repeat-day evidence yet.");
  limits.push("Only vehicle-days already read in this session are included; days not read could contain other visits.");
  limits.push("A stay is the observed minimum from the position log; tracking gaps are not added to it.");
  return {
    options, areasTotal: areas.length, areas: areas.slice(0, options.maxAreas), patterns: patterns.slice(0, 30), limits,
    sample: { vehicleDays: allVehicleDays.size, vehicles: allVehicles.size, days: allDays.size, visitsAnalysed: work.length, duplicatesRemoved, slowMovementIgnored, truncated }
  };
}

type Pair = readonly [string, string];
export const KIND_COPY: Record<AreaKind, Pair> = {
  one_off_stop: ["One-off stop", "จอดครั้งเดียว"], extended_stay: ["Extended stay (one day)", "จอดนาน (วันเดียว)"], recurring_area: ["Recurring stopping area", "จุดจอดที่เกิดซ้ำ"],
  possible_customer_area: ["Recurring area near a directory location", "จุดที่เกิดซ้ำใกล้สถานที่ในสมุดรายชื่อ"], likely_depot_area: ["Near a depot or office in the directory", "ใกล้คลังหรือสำนักงานในสมุดรายชื่อ"]
};
export const HINT_COPY: Record<PlaceHint, Pair> = {
  near_depot_or_office: ["Near a directory location categorised as depot or office", "ใกล้สถานที่ที่จัดเป็นคลังหรือสำนักงานในสมุดรายชื่อ"],
  near_directory_location: ["Near an office-confirmed directory pin", "ใกล้หมุดในสมุดรายชื่อที่สำนักงานยืนยันแล้ว"],
  near_unverified_directory_point: ["Near a Forth saved location (not office-verified)", "ใกล้สถานที่ที่บันทึกใน Forth (สำนักงานยังไม่ยืนยัน)"],
  multiple_plausible: ["Several directory locations are nearby; the site is not identified", "มีหลายสถานที่ใกล้เคียง ยังระบุไม่ได้ว่าเป็นที่ใด"],
  no_match: ["No directory location nearby", "ไม่พบสถานที่ในสมุดรายชื่อใกล้เคียง"]
};
export const FLAG_COPY: Record<AreaFlag, Pair> = {
  same_day_repeats_only: ["Several visits, but all on one day: not repeat-day evidence", "จอดหลายครั้งแต่ในวันเดียว ไม่ถือเป็นหลักฐานการเกิดซ้ำ"],
  single_vehicle: ["Only one vehicle stopped here", "มีรถเพียงคันเดียวจอดที่นี่"], multi_vehicle: ["More than one vehicle stopped here", "มีรถมากกว่าหนึ่งคันจอดที่นี่"],
  short_stays_only_possible_roadside: ["Every observed stay is short: this may be traffic or a roadside stop, not loading", "ทุกครั้งจอดสั้น อาจเป็นการจราจรหรือจอดข้างทาง ไม่ใช่การขนถ่าย"],
  next_to_tracking_gap: ["Some stays are next to a tracking gap, so their true length is unknown", "บางครั้งอยู่ติดช่วงที่ไม่มีข้อมูล จึงไม่ทราบระยะเวลาที่แท้จริง"],
  unverified_positions: ["Some or all positions are not verified GPS; repeating does not verify them", "บางหรือทุกตำแหน่งไม่ใช่ GPS ที่ยืนยัน การเกิดซ้ำไม่ได้ทำให้ยืนยัน"],
  could_be_neighbouring_site: ["Another recurring area is very close: this may also be a neighbouring facility", "มีอีกจุดอยู่ใกล้มาก อาจเป็นโรงงานข้างเคียง"],
  duplicates_removed: ["Exact duplicate evidence was counted once", "หลักฐานที่ซ้ำกันทุกประการนับเพียงครั้งเดียว"]
};
export const kindLabel = (k: AreaKind, l: "en" | "th") => KIND_COPY[k][l === "th" ? 1 : 0];
export const hintLabel = (h: PlaceHint, l: "en" | "th") => HINT_COPY[h][l === "th" ? 1 : 0];
export const flagLabel = (f: AreaFlag, l: "en" | "th") => FLAG_COPY[f][l === "th" ? 1 : 0];

/** Plain statements built only from the real values of one area. No percentages and no invented confidence. */
export function describeArea(a: RecurringArea, language: "en" | "th"): string[] {
  const en = language !== "th"; const out: string[] = [];
  out.push(en ? `Stopped here on ${a.distinctDays} reviewed day${a.distinctDays === 1 ? "" : "s"} (${a.visits} visit${a.visits === 1 ? "" : "s"}).` : `จอดที่นี่ ${a.distinctDays} วันที่ตรวจสอบ (${a.visits} ครั้ง)`);
  if (a.vehicles.length > 1) out.push(en ? `${a.vehicles.length} vehicles stopped here independently (${a.vehicles.join(", ")}).` : `มีรถ ${a.vehicles.length} คันจอดที่นี่ (${a.vehicles.join(", ")})`);
  out.push(en ? `Observed stays: shortest ${a.stayMinutes.min} min, typical ${a.stayMinutes.median} min, longest supported ${a.stayMinutes.longestSupported} min.` : `เวลาที่สังเกตได้: สั้นสุด ${a.stayMinutes.min} นาที ปกติ ${a.stayMinutes.median} นาที นานสุดที่รองรับ ${a.stayMinutes.longestSupported} นาที`);
  const unverified = a.visits - a.quality.verified;
  if (unverified > 0) out.push(en ? `${unverified} of ${a.visits} visit${a.visits === 1 ? "" : "s"} used positions that are not verified GPS.` : `${unverified} จาก ${a.visits} ครั้ง ใช้ตำแหน่งที่ไม่ใช่ GPS ที่ยืนยัน`);
  if (a.flags.includes("could_be_neighbouring_site")) out.push(en ? `Another recurring area is about ${a.nearestOtherAreaM} m away, so this may also be a neighbouring facility.` : `มีอีกจุดห่างประมาณ ${a.nearestOtherAreaM} ม. จึงอาจเป็นโรงงานข้างเคียง`);
  if (a.visitsNextToGap > 0) out.push(en ? `${a.visitsNextToGap} visit${a.visitsNextToGap === 1 ? " is" : "s are"} next to a tracking gap, so the real stay may be longer.` : `${a.visitsNextToGap} ครั้งอยู่ติดช่วงที่ไม่มีข้อมูล ระยะเวลาจริงอาจนานกว่า`);
  out.push(en ? "Tracking coverage is limited to the reviewed days, so visits on other days are unknown." : "ข้อมูลครอบคลุมเฉพาะวันที่ตรวจสอบ จึงไม่ทราบการจอดในวันอื่น");
  return out;
}
