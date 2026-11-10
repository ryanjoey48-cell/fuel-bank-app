/**
 * V7.8.4 vehicle-day chronology. Pure, deterministic, read-only, no coordinates.
 *
 * Why it exists: Daily Activity used to sort visits, provider journeys and gaps by start time into one flat list. A visit window
 * (10:06–10:59) and a short movement inside it (10:36–10:37) then looked like contradictory facts, and the minutes could be read
 * twice. The sources really do describe different things:
 *   - a VISIT is a window built from GPS stops (positions staying together and slow). Its bridged interruptions are inside the window
 *     but are not counted as stationary time (supported stationary minutes are a lower bound);
 *   - a provider MOVING SEGMENT is Forth's own trip record, with its own boundaries;
 *   - a GPS MOVING interval is the speed/position state between two samples (up to 5 minutes apart).
 * This model keeps every source interval as it was (nothing is trimmed or merged away), says how each movement relates to the visit
 * windows, and separately accounts the day ONCE: every second of the window lands in exactly one bucket, contested seconds stay
 * contested instead of being counted as both driving and stationary, and unobserved time is never turned into stationary time.
 */
import { REPORT_JITTER_MS, TELEMETRY_GAP_MS } from "./fleet-stop-intelligence";
import { VISIT_LEAVE_DISTANCE_M } from "./fleet-visit-grouping";

/** The grouping's own site-leave distance (300 m), in km. A movement whose whole path is shorter cannot be a departure by the grouping's definition. */
export const SITE_SCALE_KM = VISIT_LEAVE_DISTANCE_M / 1000;

export type ChronoGps = { start: string; end: string; state: string; reason: string | null; km: number | null };
export type ChronoJourney = {
  id: string; start: string; end: string | null; kind: "moving" | "stopped" | "open_final"; minutes: number | null;
  providerKm: number; verifiedGpsKm: number | null; reportedTrailKm: number | null; positionSource: string; ambiguous: boolean;
};
export type ChronoStop = { id: string; firstAt: string; lastAt: string; observedMinutes: number };
export type ChronoJoin = { fromStopId: string; toStopId: string; interruptionMinutes: number; farthestBetweenM: number; maxSpeedBetweenKph: number | null; observationsBetween: number; missingReport: boolean };
export type ChronoVisit = { id: string; firstAt: string; lastAt: string; observedMinutes: number; spanMinutes: number; openStart: boolean; openEnd: boolean; stops: ChronoStop[]; joins: ChronoJoin[] };
export type ChronoLogGap = { start: string; end: string; minutes: number };
export type ChronologyInput = {
  day: string;
  /** Clock for an in-progress day. Defaults to now; tests pass a fixed value. */
  nowMs?: number;
  journeys: readonly ChronoJourney[];
  /** The day's GPS timeline, or null when no GPS log was read (then nothing is observed). */
  gps: readonly ChronoGps[] | null;
  visits: readonly ChronoVisit[];
  providerLogGaps?: readonly ChronoLogGap[];
  /** True when the provider log is present and shows NO spacing over 10 minutes: a longer unobserved GPS run is then several 5–10-minute spacings back to back, not an outage, so it gets no "unknown interval" row (it stays in the coverage figures). */
  noSpacingOverTenMinutes?: boolean;
};

/** How a movement relates to a visit window. */
export type MovementRelation =
  | "within_site_between_stops"   // inside the gap between two stops the grouping joined: positions stayed near the site
  | "site_scale_movement"          // inside a stop's own span, but the whole path is within the grouping's site-leave distance: site-scale, not a departure
  | "during_stationary_stop"       // inside a stop's own span with a longer or unknown path: the sources disagree on these minutes
  | "visit_edge"                   // overlaps the start or end of the window: arrival or departure adjacency
  | "spans_visit";                 // covers the whole window: the vehicle was not stationary in this source's view
export type MovementSource = "provider_segment" | "gps_interval";
export type ChronoMovement = {
  key: string; source: MovementSource; journeyId: string | null; start: string; end: string; minutes: number;
  providerKm: number | null; gpsKm: number | null;
  /** The longest path any source gives for this movement (km); null when no source gives one. */
  pathKm: number | null; relation: MovementRelation | null;
  /** The grouping's own evidence for a movement inside a join gap: farthest distance from the site and top speed. No coordinates. */
  siteEvidence: { farthestBetweenM: number; maxSpeedBetweenKph: number | null; observationsBetween: number } | null;
};
export type Departure = "not_indicated" | "repositioning_within_site" | "sources_disagree";
export type UnknownReason = "gps_spacing" | "provider_log_gap";

export type ChronoRow =
  | { kind: "driving"; key: string; depth: 0; start: string; end: string | null; minutes: number | null; journeyId: string | null; source: MovementSource | "provider_and_gps"; providerKm: number | null; gpsKm: number | null; trailKm: number | null; positionSource: string | null; ambiguous: boolean; notInProviderReport: boolean; overlapsVisit: { id: string; minutes: number; relation: "visit_edge" | "spans_visit" } | null }
  | { kind: "visit"; key: string; depth: 0; id: string; start: string; end: string; spanMinutes: number; supportedMinutes: number; bridgedMinutes: number; unobservedInsideMinutes: number | null; openStart: boolean; openEnd: boolean; stops: number; movementInside: number; departure: Departure }
  | { kind: "movement_in_visit"; key: string; depth: 1; parentKey: string; movement: ChronoMovement }
  | { kind: "unknown"; key: string; depth: 0; start: string; end: string; minutes: number; reasons: UnknownReason[] }
  | { kind: "open_segment"; key: string; depth: 0; start: string; end: null; journeyId: string; providerKm: number };

export type TimeBuckets = {
  /** Provider moving segment or GPS moving interval, no stationary claim on the same seconds. */
  driving: number;
  /** Inside a stop's span, with GPS positions on both sides of every second. */
  stationary_supported: number;
  /** Inside a stop's span, but the GPS spacing there exceeds 5 minutes: bridged between two positions, no position in between. */
  stationary_bridged: number;
  /** Claimed both as movement and as a stationary stop. Never counted twice. */
  contested: number;
  /** Observed by GPS but neither a stop nor movement (ordinary low-speed or short stationary intervals outside stop clusters). */
  observed_other: number;
  /** No usable position: unobserved. Never counted as stationary. */
  unobserved: number;
};
export type TimeAccounting = { windowSeconds: number; gpsAvailable: boolean; buckets: TimeBuckets; sumSeconds: number };
export type Chronology = {
  day: string; windowStart: string; windowEnd: string; rows: ChronoRow[]; accounting: TimeAccounting;
  /** Movement-versus-visit overlaps found (informational; the rows keep every interval). */
  overlaps: { movementsInsideVisits: number; edges: number; spans: number; sourcesDisagree: number };
};

const ms = (iso: string) => Date.parse(iso);
const mins = (a: number, b: number) => Math.max(0, Math.round((b - a) / 60_000));
const iso = (t: number) => new Date(t).toISOString();
type Iv = { s: number; e: number };
const overlap = (a: Iv, b: Iv) => Math.min(a.e, b.e) - Math.max(a.s, b.s);
/** GPS intervals run between samples that can be up to 5 minutes apart, so their edges can differ from a provider boundary by that much. */
const GPS_EDGE_MS = 5 * 60_000;
const MATERIAL_UNKNOWN_MS = TELEMETRY_GAP_MS;

export function fleetDayChronology(input: ChronologyInput): Chronology {
  const dayStart = Date.parse(`${input.day}T00:00:00+07:00`), dayEnd = dayStart + 86_400_000;
  const nowMs = input.nowMs ?? Date.now();
  const winEnd = Math.max(dayStart, Math.min(dayEnd, nowMs));
  const clip = (s: number, e: number): Iv | null => { const a = Math.max(s, dayStart), b = Math.min(e, winEnd); return b > a ? { s: a, e: b } : null; };

  const visits = [...input.visits].sort((a, b) => ms(a.firstAt) - ms(b.firstAt) || ms(a.lastAt) - ms(b.lastAt) || a.id.localeCompare(b.id));
  const gps = input.gps ? [...input.gps].sort((a, b) => ms(a.start) - ms(b.start)) : null;
  const journeys = [...input.journeys].sort((a, b) => ms(a.start) - ms(b.start) || a.id.localeCompare(b.id));
  const providerMoving = journeys.filter(j => j.kind === "moving" && j.end);
  const gpsMoving = (gps ?? []).filter(g => g.state === "moving");
  const providerIvs = providerMoving.map(j => ({ s: ms(j.start), e: ms(j.end!) }));

  // ---- movement versus visit windows
  const used = new Set<string>(); // movements already shown inside a visit
  const overlaps = { movementsInsideVisits: 0, edges: 0, spans: 0, sourcesDisagree: 0 };
  const visitBlocks = visits.map(v => {
    const W: Iv = { s: ms(v.firstAt), e: ms(v.lastAt) };
    const stopIvs = v.stops.map(s => ({ s: ms(s.firstAt), e: ms(s.lastAt), id: s.id }));
    const gaps = v.joins.map(j => { const a = stopIvs.find(x => x.id === j.fromStopId), b = stopIvs.find(x => x.id === j.toStopId); return a && b ? { s: a.e, e: b.s, join: j } : null; }).filter((x): x is { s: number; e: number; join: ChronoJoin } => x !== null);
    const relate = (m: Iv): { relation: MovementRelation | null; gap: ChronoJoin | null } => {
      if (overlap(m, W) <= 0) return { relation: null, gap: null };
      if (m.s <= W.s + REPORT_JITTER_MS && m.e >= W.e - REPORT_JITTER_MS) return { relation: "spans_visit", gap: null };
      if (m.s >= W.s - REPORT_JITTER_MS && m.e <= W.e + REPORT_JITTER_MS) {
        const g = gaps.find(x => m.s >= x.s - REPORT_JITTER_MS && m.e <= x.e + REPORT_JITTER_MS);
        return g ? { relation: "within_site_between_stops", gap: g.join } : { relation: "during_stationary_stop", gap: null };
      }
      return { relation: "visit_edge", gap: null };
    };
    const inside: ChronoMovement[] = []; const edgeOrSpan: { key: string; relation: "visit_edge" | "spans_visit"; minutes: number }[] = [];
    const consider = (key: string, source: MovementSource, journeyId: string | null, s: number, e: number, providerKm: number | null, gpsKm: number | null) => {
      const r = relate({ s, e }); if (!r.relation) return;
      if (r.relation === "visit_edge" || r.relation === "spans_visit") { edgeOrSpan.push({ key, relation: r.relation, minutes: Math.round(overlap({ s, e }, W) / 60_000) }); return; }
      used.add(key);
      // The longest path any source gives for this movement: the provider's km, the ledger's GPS km, and the GPS moving intervals that overlap it
      // (whole intervals, never prorated). Unknown stays unknown.
      const overlappingGps = gpsMoving.filter(g => overlap({ s: ms(g.start), e: ms(g.end) }, { s, e }) > 0).map(g => g.km).filter((k): k is number => k !== null);
      const known = [providerKm, gpsKm, overlappingGps.length ? overlappingGps.reduce((n, k) => n + k, 0) : null].filter((k): k is number => k !== null);
      const pathKm = known.length ? Math.max(...known) : null;
      // A movement inside a stop whose whole path stays within the grouping's own site-leave distance cannot be a departure by that definition:
      // the sources use different thresholds (stop: 75 m anchor and 8 km/h; distance engine: its own moving speed), so it is site-scale movement.
      const relation: MovementRelation = r.relation === "during_stationary_stop" && pathKm !== null && pathKm <= SITE_SCALE_KM ? "site_scale_movement" : r.relation;
      inside.push({ key, source, journeyId, start: iso(s), end: iso(e), minutes: mins(s, e), providerKm, gpsKm, pathKm, relation,
        siteEvidence: r.gap ? { farthestBetweenM: r.gap.farthestBetweenM, maxSpeedBetweenKph: r.gap.maxSpeedBetweenKph, observationsBetween: r.gap.observationsBetween } : null });
    };
    providerMoving.forEach((j, i) => consider(`drive:${j.id}`, "provider_segment", j.id, providerIvs[i].s, providerIvs[i].e, j.providerKm, j.verifiedGpsKm));
    // A GPS moving interval that is the same event as a provider segment is not listed twice.
    gpsMoving.forEach(g => { const s = ms(g.start), e = ms(g.end); if (providerIvs.some(p => s >= p.s - GPS_EDGE_MS && e <= p.e + GPS_EDGE_MS)) return; consider(`gps:${g.start}`, "gps_interval", null, s, e, null, g.km); });
    inside.sort((a, b) => ms(a.start) - ms(b.start) || a.key.localeCompare(b.key));
    const bridged = Math.max(0, v.spanMinutes - v.observedMinutes);
    const unobservedInside = gps ? Math.round(gps.filter(g => g.state === "unavailable").reduce((n, g) => n + Math.max(0, overlap({ s: ms(g.start), e: ms(g.end) }, W)), 0) / 60_000) : null;
    const departure: Departure = inside.length === 0 && edgeOrSpan.every(x => x.relation === "visit_edge") ? "not_indicated"
      : edgeOrSpan.some(x => x.relation === "spans_visit") || inside.some(m => m.relation === "during_stationary_stop") ? "sources_disagree" : inside.length ? "repositioning_within_site" : "not_indicated";
    overlaps.movementsInsideVisits += inside.length; overlaps.edges += edgeOrSpan.filter(x => x.relation === "visit_edge").length; overlaps.spans += edgeOrSpan.filter(x => x.relation === "spans_visit").length; if (departure === "sources_disagree") overlaps.sourcesDisagree++;
    const row: ChronoRow = { kind: "visit", key: `visit:${v.id}`, depth: 0, id: v.id, start: v.firstAt, end: v.lastAt, spanMinutes: v.spanMinutes, supportedMinutes: v.observedMinutes, bridgedMinutes: bridged, unobservedInsideMinutes: unobservedInside, openStart: v.openStart, openEnd: v.openEnd, stops: v.stops.length, movementInside: inside.length, departure };
    return { v, W, row, inside, edgeOrSpan };
  });
  const overlapFor = new Map<string, { id: string; minutes: number; relation: "visit_edge" | "spans_visit" }>();
  for (const b of visitBlocks) for (const x of b.edgeOrSpan) { const cur = overlapFor.get(x.key); if (!cur || x.minutes > cur.minutes) overlapFor.set(x.key, { id: b.v.id, minutes: x.minutes, relation: x.relation }); }

  // ---- units, each placed by its start; a visit carries its nested movements with it
  type Unit = { start: number; key: string; rows: ChronoRow[] };
  const units: Unit[] = [];
  for (const b of visitBlocks) units.push({ start: b.W.s, key: b.row.key, rows: [b.row, ...b.inside.map<ChronoRow>(m => ({ kind: "movement_in_visit", key: `inside:${b.v.id}:${m.key}`, depth: 1, parentKey: b.row.key, movement: m }))] });
  providerMoving.forEach((j, i) => {
    const key = `drive:${j.id}`; if (used.has(key)) return;
    const gpsSame = gpsMoving.some(g => { const s = ms(g.start), e = ms(g.end); return s >= providerIvs[i].s - GPS_EDGE_MS && e <= providerIvs[i].e + GPS_EDGE_MS; });
    units.push({ start: providerIvs[i].s, key, rows: [{ kind: "driving", key, depth: 0, start: j.start, end: j.end, minutes: j.minutes, journeyId: j.id, source: gpsSame ? "provider_and_gps" : "provider_segment", providerKm: j.providerKm, gpsKm: j.verifiedGpsKm, trailKm: j.reportedTrailKm, positionSource: j.positionSource, ambiguous: j.ambiguous, notInProviderReport: false, overlapsVisit: overlapFor.get(key) ?? null }] });
  });
  for (const g of gpsMoving) {
    const key = `gps:${g.start}`, s = ms(g.start), e = ms(g.end);
    if (used.has(key) || providerIvs.some(p => s >= p.s - GPS_EDGE_MS && e <= p.e + GPS_EDGE_MS)) continue;
    units.push({ start: s, key, rows: [{ kind: "driving", key, depth: 0, start: g.start, end: g.end, minutes: mins(s, e), journeyId: null, source: "gps_interval", providerKm: null, gpsKm: g.km, trailKm: null, positionSource: "gps", ambiguous: false, notInProviderReport: true, overlapsVisit: overlapFor.get(key) ?? null }] });
  }
  for (const j of journeys.filter(x => x.kind === "open_final")) units.push({ start: ms(j.start), key: `open:${j.id}`, rows: [{ kind: "open_segment", key: `open:${j.id}`, depth: 0, start: j.start, end: null, journeyId: j.id, providerKm: j.providerKm }] });

  // ---- material unknown runs: contiguous unavailable GPS timeline plus provider log gaps, merged where they overlap
  const unknownRaw: (Iv & { reason: UnknownReason })[] = [];
  let run: Iv | null = null;
  for (const g of gps ?? []) {
    if (g.state === "unavailable") { const s = ms(g.start), e = ms(g.end); if (run && s <= run.e) run.e = Math.max(run.e, e); else { if (run) unknownRaw.push({ ...run, reason: "gps_spacing" }); run = { s, e }; } }
    else if (run) { unknownRaw.push({ ...run, reason: "gps_spacing" }); run = null; }
  }
  if (run) unknownRaw.push({ ...(run as Iv), reason: "gps_spacing" });
  for (const m of input.providerLogGaps ?? []) unknownRaw.push({ s: ms(m.start), e: ms(m.end), reason: "provider_log_gap" });
  const merged: { s: number; e: number; reasons: Set<UnknownReason> }[] = [];
  for (const u of unknownRaw.map(x => ({ ...x, c: clip(x.s, x.e) })).filter(x => x.c).sort((a, b) => a.c!.s - b.c!.s)) {
    const last = merged.at(-1);
    if (last && u.c!.s <= last.e) { last.e = Math.max(last.e, u.c!.e); last.reasons.add(u.reason); } else merged.push({ s: u.c!.s, e: u.c!.e, reasons: new Set([u.reason]) });
  }
  for (const u of merged.filter(x => x.e - x.s > MATERIAL_UNKNOWN_MS && !(input.noSpacingOverTenMinutes && !x.reasons.has("provider_log_gap")))) units.push({ start: u.s, key: `unknown:${iso(u.s)}`, rows: [{ kind: "unknown", key: `unknown:${iso(u.s)}`, depth: 0, start: iso(u.s), end: iso(u.e), minutes: mins(u.s, u.e), reasons: [...u.reasons].sort() as UnknownReason[] }] });

  units.sort((a, b) => a.start - b.start || a.key.localeCompare(b.key));
  const rows = units.flatMap(u => u.rows);

  // ---- additive accounting: every second of the window in exactly one bucket
  const P = providerIvs.map(x => clip(x.s, x.e)).filter((x): x is Iv => x !== null);
  const Gm = gpsMoving.map(g => clip(ms(g.start), ms(g.end))).filter((x): x is Iv => x !== null);
  const S = visits.flatMap(v => v.stops.map(s => clip(ms(s.firstAt), ms(s.lastAt)))).filter((x): x is Iv => x !== null);
  const U = (gps ?? []).filter(g => g.state === "unavailable").map(g => clip(ms(g.start), ms(g.end))).filter((x): x is Iv => x !== null);
  const cuts = new Set<number>([dayStart, winEnd]);
  for (const x of [...P, ...Gm, ...S, ...U]) { cuts.add(x.s); cuts.add(x.e); }
  const sorted = [...cuts].filter(t => t >= dayStart && t <= winEnd).sort((a, b) => a - b);
  const inAny = (list: readonly Iv[], t: number) => list.some(x => t >= x.s && t < x.e);
  const buckets: TimeBuckets = { driving: 0, stationary_supported: 0, stationary_bridged: 0, contested: 0, observed_other: 0, unobserved: 0 };
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1], b = sorted[i], mid = (a + b) / 2, sec = Math.round((b - a) / 1000);
    const mv = inAny(P, mid) || inAny(Gm, mid), st = inAny(S, mid), un = inAny(U, mid);
    const key: keyof TimeBuckets = mv && st ? "contested" : mv ? "driving" : st ? (un ? "stationary_bridged" : "stationary_supported") : un ? "unobserved" : gps ? "observed_other" : "unobserved";
    buckets[key] += sec;
  }
  const sumSeconds = Object.values(buckets).reduce((n, v) => n + v, 0);
  return { day: input.day, windowStart: iso(dayStart), windowEnd: iso(winEnd), rows, accounting: { windowSeconds: Math.round((winEnd - dayStart) / 1000), gpsAvailable: gps !== null, buckets, sumSeconds }, overlaps };
}

type Pair = readonly [string, string];
export const BUCKET_COPY: Record<keyof TimeBuckets, { label: Pair; note: Pair }> = {
  driving: { label: ["Driving", "กำลังขับ"], note: ["A provider moving segment or a GPS moving interval, with no stop claiming the same time.", "ช่วงเคลื่อนที่ของ Forth หรือช่วงที่ GPS เคลื่อนที่ โดยไม่มีจุดจอดอ้างช่วงเวลาเดียวกัน"] },
  stationary_supported: { label: ["Stationary (supported)", "จอดนิ่ง (มีหลักฐานรองรับ)"], note: ["Inside a stop with GPS positions on both sides. A lower bound.", "อยู่ในจุดจอดและมีตำแหน่ง GPS ทั้งสองด้าน เป็นค่าต่ำสุด"] },
  stationary_bridged: { label: ["Stationary (between positions)", "จอดนิ่ง (ระหว่างตำแหน่ง)"], note: ["Inside a stop, but more than 5 minutes passed with no position in between.", "อยู่ในจุดจอด แต่เกิน 5 นาทีโดยไม่มีตำแหน่งระหว่างกลาง"] },
  contested: { label: ["Sources disagree", "แหล่งข้อมูลไม่ตรงกัน"], note: ["Claimed both as movement and as a stationary stop. Counted once, here, never twice.", "ถูกระบุทั้งเป็นการเคลื่อนที่และการจอดนิ่ง นับครั้งเดียวที่นี่ ไม่นับซ้ำ"] },
  observed_other: { label: ["Observed, not a stop", "สังเกตได้ แต่ไม่ใช่จุดจอด"], note: ["GPS positions exist, but the time is neither a stop nor movement.", "มีตำแหน่ง GPS แต่ช่วงเวลานี้ไม่ใช่จุดจอดหรือการเคลื่อนที่"] },
  unobserved: { label: ["Unobserved", "ไม่มีการสังเกต"], note: ["No usable position. Never counted as stationary.", "ไม่มีตำแหน่งที่ใช้ได้ ไม่นับเป็นการจอดนิ่ง"] }
};
export const RELATION_COPY: Record<MovementRelation, Pair> = {
  site_scale_movement: ["Site-scale movement (under 300 m) while the GPS stop continues: the stop detector and the distance engine use different thresholds. Repositioning or GPS-scale movement, not a departure.", "การเคลื่อนที่ระดับพื้นที่ (ไม่ถึง 300 ม.) ขณะที่จุดจอด GPS ยังต่อเนื่อง ตัวตรวจจุดจอดกับตัวคำนวณระยะใช้เกณฑ์ต่างกัน เป็นการขยับรถหรือการเคลื่อนที่ระดับ GPS ไม่ใช่การออกจากที่"],
  within_site_between_stops: ["Movement within the visit: between two stops the grouping joined; positions stayed near the site.", "เคลื่อนที่ภายในการเข้าเยี่ยม: อยู่ระหว่างสองจุดจอดที่รวมกัน ตำแหน่งยังอยู่ใกล้สถานที่"],
  during_stationary_stop: ["The provider or GPS reports movement while the GPS stop is stationary. The sources use different boundaries; this is not shown as a departure.", "ผู้ให้บริการหรือ GPS รายงานการเคลื่อนที่ขณะที่จุดจอด GPS นิ่ง แหล่งข้อมูลใช้ขอบเขตต่างกัน ไม่ถือเป็นการออกจากที่"],
  visit_edge: ["Overlaps the start or end of the visit window.", "ทับซ้อนกับช่วงต้นหรือท้ายของการเข้าเยี่ยม"],
  spans_visit: ["Covers the whole visit window: the vehicle was not stationary in this source.", "ครอบคลุมทั้งช่วงการเข้าเยี่ยม รถไม่ได้จอดนิ่งตามแหล่งนี้"]
};
export const DEPARTURE_COPY: Record<Departure, Pair> = {
  not_indicated: ["No movement inside the visit window.", "ไม่มีการเคลื่อนที่ในช่วงการเข้าเยี่ยม"],
  repositioning_within_site: ["Movement inside the window stayed near the site: possible repositioning, not a departure.", "การเคลื่อนที่ในช่วงนี้อยู่ใกล้สถานที่ อาจเป็นการขยับรถ ไม่ใช่การออกจากที่"],
  sources_disagree: ["Movement overlaps time the GPS shows as stationary. Whether the vehicle left the site is not established.", "การเคลื่อนที่ทับกับเวลาที่ GPS แสดงว่านิ่ง ยังสรุปไม่ได้ว่ารถออกจากสถานที่หรือไม่"]
};
