/**
 * V7.3/V7.4 smart location matching. Pure, deterministic and read-only.
 *
 * It compares an observed stopping place (from the existing stop detector / recurring-area analysis) with saved directory points and
 * explains the result in real distances. It adds NO new stop, GPS-verification or distance calculation, never creates or edits a
 * location, and never turns a verified GPS position into a verified company identity.
 *
 * Boundary honesty (V7.4): Forth stores a "diameter" per saved location (100 for 465 rows, 150 for one), but its unit and meaning are
 * UNVERIFIED (the import code and docs say it is not to be applied as a geofence). It is therefore carried only as a hint
 * (`forthDiameterRaw`) and is NOT used as a boundary. Matching uses one fixed, documented reference distance around the saved point
 * (REFERENCE_RADIUS_M), and says so. A site boundary is only claimed for an office-confirmed pin that carries a verified boundary.
 *
 * Rules (deliberate):
 *  - Nearest is not the answer. Distinct companies are compared, and a second site that is as close, or that is also within the
 *    reference distance, makes the result "multiple nearby locations".
 *  - Several saved points with the same name are one company with several entrances, not competitors.
 *  - A Forth saved point is not office-verified. The best possible result for it is "likely".
 *  - GPS quality and site-match confidence are reported separately. Unverified GPS, short stays and tracking gaps can only lower the
 *    result, never raise it. The search radius is never widened to force a match.
 *  - There are no percentages: the evidence is distance, the reference distance, repeat days and observed dwell.
 */
import { metersBetween } from "./fleet-job-movement";

export type SitePoint = {
  id: string; name: string; thaiName?: string | null; latitude: number; longitude: number;
  source: "office_confirmed_pin" | "forth_saved_location";
  category?: string | null; groupLayer?: string | null;
  /** Raw Forth diameter field, shown as a hint only. Unit unverified; never used as a boundary. */
  forthDiameterRaw?: string | null;
  /** True only for an office-confirmed pin whose boundary has been reviewed. No such record exists today. */
  boundaryVerified?: boolean;
};
export type StopEvidence = {
  latitude: number; longitude: number;
  /** Spread of the observed stop positions, so a loosely clustered stop is not matched more tightly than it was observed. */
  radiusM?: number;
  /** Observed minimum stay (never includes tracking gaps). */
  dwellMinutes: number;
  /** Distinct days with this stop. */
  days: number; visits: number;
  sourceQuality: "verified_gps" | "mixed" | "unverified";
  /** Every observed stay was shorter than SHORT_STAY_MINUTES. */
  shortStaysOnly?: boolean;
  nextToGap?: boolean;
};
export type MatchStatus = "reviewed_site_boundary" | "likely_directory_match" | "possible_directory_match" | "multiple_nearby_locations" | "unknown_stopping_area" | "drive_by_only";
export type MatchReason = "within_reference_distance" | "repeat_days" | "long_observed_stay" | "verified_gps_stop" | "several_entrances_same_company";
export type MatchUncertainty = "saved_point_not_office_verified" | "beyond_reference_distance" | "near_saved_point" | "boundary_not_verified" | "other_site_nearby" | "short_stays_possible_roadside" | "unverified_gps" | "partly_verified_gps" | "next_to_tracking_gap" | "single_visit" | "repeated_offset_from_saved_point" | "no_saved_point_nearby" | "too_short_to_be_a_stop_here";
/** How far the stop is from the saved point, in plain bands. "near" is beyond the reference distance but within NEAR_RADIUS_M. */
export type Proximity = "within_reference" | "near" | "far";
export type SiteCandidate = {
  name: string; thaiName: string | null; groupLayer: string | null; category: string | null;
  source: SitePoint["source"]; distanceM: number; proximity: Proximity;
  /** Reference distance used (fixed). The saved site's real boundary is unknown. */
  referenceRadiusM: number; forthDiameterRaw: string | null;
  /** Saved points with this name inside the search distance (more than one = several entrances). */
  entrances: number; pointId: string;
};
export type SiteMatch = {
  status: MatchStatus;
  primary: SiteCandidate | null;
  alternatives: SiteCandidate[];
  reasons: MatchReason[];
  uncertainty: MatchUncertainty[];
  /** Carried from the stop. Never changed by matching. */
  gpsQuality: StopEvidence["sourceQuality"];
};

export const SEARCH_RADIUS_M = 250;
export const REFERENCE_RADIUS_M = 50;
export const NEAR_RADIUS_M = 150;
export const COMPETITOR_MARGIN_M = 75;
export const DRIVE_BY_MINUTES = 5;
export const SHORT_STAY_MINUTES = 10;
export const LONG_STAY_MINUTES = 60;
const CELL_DEG = 0.003; // about 330 m, larger than SEARCH_RADIUS_M at Thai latitudes

const validPoint = (p: { latitude: number; longitude: number }) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude) && Math.abs(p.latitude) <= 90 && Math.abs(p.longitude) <= 180;
export const companyKey = (name: string) => name.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();
const cellKey = (ix: number, iy: number) => `${ix}:${iy}`;
const cellOf = (p: { latitude: number; longitude: number }) => [Math.floor(p.latitude / CELL_DEG), Math.floor(p.longitude / CELL_DEG)] as const;

export type PreparedSites = { count: number; usable: number; cells: Map<string, SitePoint[]> };

/** Built once per set of directory points (it is cheap, but not something to repeat per render). Unusable points are counted, not used. */
export function prepareSites(points: readonly SitePoint[]): PreparedSites {
  const cells = new Map<string, SitePoint[]>(); let usable = 0;
  for (const p of points) {
    if (!p.name?.trim() || !validPoint(p)) continue;
    usable++;
    const [ix, iy] = cellOf(p); const key = cellKey(ix, iy);
    const bucket = cells.get(key); if (bucket) bucket.push(p); else cells.set(key, [p]);
  }
  return { count: points.length, usable, cells };
}

export function nearby(prepared: PreparedSites, at: { latitude: number; longitude: number }, radiusM: number) {
  const [cx, cy] = cellOf(at); const found: { point: SitePoint; distanceM: number }[] = [];
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    for (const point of prepared.cells.get(cellKey(cx + dx, cy + dy)) ?? []) {
      const distanceM = metersBetween(at, point);
      if (distanceM <= radiusM) found.push({ point, distanceM });
    }
  }
  return found.sort((a, b) => a.distanceM - b.distanceM || (a.point.id < b.point.id ? -1 : 1));
}

const rounded = (n: number) => Math.round(n);
const proximityOf = (distanceM: number, stopRadius: number): Proximity => (distanceM <= REFERENCE_RADIUS_M + stopRadius ? "within_reference" : distanceM <= NEAR_RADIUS_M + stopRadius ? "near" : "far");

export function matchStop(prepared: PreparedSites, stop: StopEvidence): SiteMatch {
  const uncertainty: MatchUncertainty[] = []; const reasons: MatchReason[] = [];
  const base = { gpsQuality: stop.sourceQuality };
  if (!validPoint(stop)) return { status: "unknown_stopping_area", primary: null, alternatives: [], reasons, uncertainty: ["no_saved_point_nearby"], ...base };
  // A very short stationary period is not evidence of a visit, wherever it happens.
  if (stop.dwellMinutes < DRIVE_BY_MINUTES) return { status: "drive_by_only", primary: null, alternatives: [], reasons, uncertainty: ["too_short_to_be_a_stop_here"], ...base };

  const found = nearby(prepared, stop, SEARCH_RADIUS_M);
  const stopRadius = Math.max(0, stop.radiusM ?? 0);
  // One entry per company: the nearest of its saved points, plus how many entrances were found.
  const companies = new Map<string, { nearest: { point: SitePoint; distanceM: number }; entrances: number }>();
  for (const f of found) {
    const key = companyKey(f.point.name); const existing = companies.get(key);
    if (!existing) companies.set(key, { nearest: f, entrances: 1 }); else existing.entrances++;
  }
  const toCandidate = (c: { nearest: { point: SitePoint; distanceM: number }; entrances: number }): SiteCandidate => ({
    name: c.nearest.point.name, thaiName: c.nearest.point.thaiName ?? null, groupLayer: c.nearest.point.groupLayer ?? null, category: c.nearest.point.category ?? null,
    source: c.nearest.point.source, distanceM: rounded(c.nearest.distanceM), proximity: proximityOf(c.nearest.distanceM, stopRadius), referenceRadiusM: REFERENCE_RADIUS_M,
    forthDiameterRaw: c.nearest.point.forthDiameterRaw ?? null, entrances: c.entrances, pointId: c.nearest.point.id
  });
  const ranked = [...companies.values()].sort((a, b) => a.nearest.distanceM - b.nearest.distanceM || (a.nearest.point.id < b.nearest.point.id ? -1 : 1)).map(toCandidate);
  if (ranked.length === 0) return { status: "unknown_stopping_area", primary: null, alternatives: [], reasons, uncertainty: ["no_saved_point_nearby"], ...base };

  const [best, ...others] = ranked;
  const bestPoint = found.find(f => f.point.id === best.pointId)!.point;
  const competitor = others.find(o => o.distanceM - best.distanceM <= COMPETITOR_MARGIN_M || o.proximity === "within_reference");
  const alternatives = others.slice(0, 3);
  const within = best.proximity === "within_reference";
  if (best.entrances > 1) reasons.push("several_entrances_same_company");
  if (within) reasons.push("within_reference_distance");
  if (stop.days >= 2) reasons.push("repeat_days");
  if (stop.dwellMinutes >= LONG_STAY_MINUTES) reasons.push("long_observed_stay");
  if (stop.sourceQuality === "verified_gps") reasons.push("verified_gps_stop");

  if (best.source === "forth_saved_location") uncertainty.push("saved_point_not_office_verified");
  if (!bestPoint.boundaryVerified) uncertainty.push("boundary_not_verified");
  if (best.proximity === "near") uncertainty.push("near_saved_point"); else if (best.proximity === "far") uncertainty.push("beyond_reference_distance");
  if (competitor) uncertainty.push("other_site_nearby");
  if (stop.sourceQuality === "unverified") uncertainty.push("unverified_gps"); else if (stop.sourceQuality === "mixed") uncertainty.push("partly_verified_gps");
  if (stop.shortStaysOnly) uncertainty.push("short_stays_possible_roadside");
  if (stop.nextToGap) uncertainty.push("next_to_tracking_gap");
  if (stop.visits <= 1) uncertainty.push("single_visit");
  if (stop.days >= 2 && !within) uncertainty.push("repeated_offset_from_saved_point");

  let status: MatchStatus;
  if (competitor) status = "multiple_nearby_locations";
  else if (within && stop.sourceQuality !== "unverified" && !stop.shortStaysOnly && (stop.dwellMinutes >= SHORT_STAY_MINUTES || stop.days >= 2)) {
    status = best.source === "office_confirmed_pin" && bestPoint.boundaryVerified ? "reviewed_site_boundary" : "likely_directory_match";
  } else status = "possible_directory_match";
  return { status, primary: best, alternatives, reasons, uncertainty, ...base };
}

type Lang = "en" | "th";
const REASONS: Record<MatchReason, [string, string]> = {
  within_reference_distance: ["The stop is within 50 m of the saved point (a fixed reference distance; the site boundary itself is not known).", "จุดจอดอยู่ห่างจากจุดที่บันทึกไม่เกิน 50 ม. (ระยะอ้างอิงคงที่ ไม่ทราบขอบเขตจริงของสถานที่)"],
  repeat_days: ["Seen on more than one day.", "พบมากกว่าหนึ่งวัน"],
  long_observed_stay: ["Observed stay of an hour or more.", "สังเกตเห็นการจอดตั้งแต่หนึ่งชั่วโมง"],
  verified_gps_stop: ["The stop's positions are verified GPS.", "ตำแหน่งของจุดจอดเป็น GPS ที่ยืนยัน"],
  several_entrances_same_company: ["The same name has several saved points nearby; they are treated as one place.", "ชื่อเดียวกันมีหลายจุดที่บันทึกไว้ใกล้กัน นับเป็นสถานที่เดียว"]
};
const UNCERTAIN: Record<MatchUncertainty, [string, string]> = {
  saved_point_not_office_verified: ["The saved point comes from Forth and has not been verified by the office.", "จุดที่บันทึกมาจาก Forth และสำนักงานยังไม่ได้ยืนยัน"],
  boundary_not_verified: ["The site's real boundary is not known (Forth's diameter field has no verified unit).", "ไม่ทราบขอบเขตจริงของสถานที่ (ฟิลด์เส้นผ่านศูนย์กลางของ Forth ยังไม่ยืนยันหน่วย)"],
  beyond_reference_distance: ["The stop is more than 150 m from the saved point: the point may be a gate or a roadside position, or the stop may belong to another site.", "จุดจอดอยู่ห่างจากจุดที่บันทึกเกิน 150 ม. จุดนั้นอาจเป็นประตูหรือข้างถนน หรือจุดจอดอาจเป็นของสถานที่อื่น"],
  near_saved_point: ["The stop is 50–150 m from the saved point: close, but not at it.", "จุดจอดห่างจากจุดที่บันทึก 50–150 ม. ใกล้แต่ไม่ตรงจุด"],
  other_site_nearby: ["Another saved location is just as close or also within 50 m. Other nearby businesses may explain it.", "มีสถานที่อื่นที่ใกล้พอกันหรืออยู่ในระยะ 50 ม. อาจเป็นธุรกิจข้างเคียง"],
  short_stays_possible_roadside: ["Every stay was short: possibly traffic, a junction or a roadside stop.", "ทุกครั้งจอดสั้น อาจเป็นการจราจร สี่แยก หรือจอดข้างทาง"],
  unverified_gps: ["The positions are not verified GPS, so even the location is approximate.", "ตำแหน่งไม่ใช่ GPS ที่ยืนยัน แม้แต่ตำแหน่งก็เป็นค่าโดยประมาณ"],
  partly_verified_gps: ["Only some positions are verified GPS.", "มีเพียงบางตำแหน่งที่เป็น GPS ที่ยืนยัน"],
  next_to_tracking_gap: ["The stop is next to a tracking gap, so its start or end is not fully observed.", "จุดจอดอยู่ติดช่วงที่ขาดข้อมูล จึงสังเกตการเริ่มหรือสิ้นสุดได้ไม่ครบ"],
  single_visit: ["Only one visit: nothing repeats it.", "มาเพียงครั้งเดียว ยังไม่มีการซ้ำ"],
  repeated_offset_from_saved_point: ["Repeated stays sit away from the saved point; the saved coordinates may be wrong or may be an entrance.", "การจอดซ้ำอยู่ห่างจากจุดที่บันทึก พิกัดที่บันทึกอาจผิดหรือเป็นทางเข้า"],
  no_saved_point_nearby: ["No saved location lies within 250 m.", "ไม่มีสถานที่ที่บันทึกไว้ในระยะ 250 ม."],
  too_short_to_be_a_stop_here: ["Stationary for under 5 minutes: treated as a drive-by, not a visit.", "จอดน้อยกว่า 5 นาที ถือเป็นการผ่าน ไม่ใช่การเข้าจุด"]
};
export const reasonLabel = (r: MatchReason, language: Lang) => REASONS[r][language === "th" ? 1 : 0];
export const uncertaintyLabel = (u: MatchUncertainty, language: Lang) => UNCERTAIN[u][language === "th" ? 1 : 0];
export const statusLabel = (s: MatchStatus, language: Lang) => ({
  reviewed_site_boundary: ["Matched to reviewed site boundary", "ตรงกับขอบเขตสถานที่ที่ตรวจสอบแล้ว"],
  likely_directory_match: ["Likely directory match", "น่าจะตรงกับสมุดสถานที่"],
  possible_directory_match: ["Possible directory match", "อาจตรงกับสมุดสถานที่"],
  multiple_nearby_locations: ["Multiple nearby companies", "มีหลายบริษัทอยู่ใกล้กัน"],
  unknown_stopping_area: ["Unknown stopping area", "ไม่ทราบพื้นที่จอด"],
  drive_by_only: ["Drive-by only", "ผ่านเท่านั้น"]
} as const)[s][language === "th" ? 1 : 0];
export const proximityLabel = (p: Proximity, language: Lang) => ({ within_reference: ["within 50 m of the saved point", "ห่างจากจุดที่บันทึกไม่เกิน 50 ม."], near: ["50–150 m from the saved point", "ห่างจากจุดที่บันทึก 50–150 ม."], far: ["more than 150 m from the saved point", "ห่างจากจุดที่บันทึกเกิน 150 ม."] } as const)[p][language === "th" ? 1 : 0];

/** Display name for a candidate: the stored Thai name when it exists and Thai is shown; never a translation. */
export const candidateName = (c: Pick<SiteCandidate, "name" | "thaiName">, language: Lang) => (language === "th" && c.thaiName ? c.thaiName : c.name);

/** Primary and secondary label. A name is shown plainly only when the evidence supports it; otherwise it is marked possible. */
export function matchLabel(match: SiteMatch | null | undefined, language: Lang, traceId?: string): { title: string; secondary: string; named: boolean } {
  const trace = traceId ?? "";
  if (!match || match.status === "unknown_stopping_area") return { title: language === "th" ? "ไม่ทราบพื้นที่จอด" : "Unknown stopping area", secondary: trace, named: false };
  if (match.status === "drive_by_only") return { title: language === "th" ? "ผ่านเท่านั้น" : "Drive-by only", secondary: trace, named: false };
  const name = match.primary ? candidateName(match.primary, language) : "";
  if (match.status === "likely_directory_match" || match.status === "reviewed_site_boundary") return { title: name, secondary: trace, named: true };
  if (match.status === "multiple_nearby_locations") {
    const names = [match.primary, ...match.alternatives].filter((c): c is SiteCandidate => Boolean(c)).slice(0, 3).map(c => candidateName(c, language)).join(" · ");
    return { title: language === "th" ? "มีหลายบริษัทอยู่ใกล้กัน" : "Multiple nearby companies", secondary: trace ? `${names} · ${trace}` : names, named: false };
  }
  return { title: `${language === "th" ? "อาจเป็น" : "Possible"}: ${name}`, secondary: trace, named: false };
}
