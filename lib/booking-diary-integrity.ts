/**
 * Booking Diary integrity analysis (V6). Pure and read-only: it never changes, deletes, merges or "repairs" a booking.
 * It explains, in plain words, what in an existing booking is incomplete, ambiguous or in conflict, so a person can fix it.
 *
 * What the audit of the live diary showed (see reports/2026-11-07-booking-diary-v6-audit.md):
 *  - `vehicle` is a free text that holds a vehicle TYPE in most rows but an old registration in some; `vehicle_registration`
 *    is newer (empty before Aug 2026). When the registration is changed the old `vehicle` text stays, so the two can disagree.
 *  - `vehicle_id` is never written by the diary; the registration text is the only link to the fleet.
 *  - The "duplicate" action copies the registration, so two trucks on one route often carry the same registration. Most
 *    same-route rows are separate trucks; only rows with the same driver AND vehicle text look like double entries.
 *  - Coordinates are stored per booking from Google lookups, so one customer name can sit at several places.
 */
import { registrationKey } from "./fleet-fuel-view";

export type IntegrityBooking = {
  id: string; booking_id?: string | null; booking_date: string; pickup_time?: string | null;
  vehicle?: string | null; vehicle_registration?: string | null; vehicle_id?: string | null;
  driver?: string | null; driver_id?: number | string | null; job_order_number?: string | null;
  pickup?: string | null; dropoff?: string | null;
  pickup_lat?: number | string | null; pickup_lng?: number | string | null; dropoff_lat?: number | string | null; dropoff_lng?: number | string | null;
  created_at?: string | null;
};
export type IntegrityVehicle = { id: string; vehicle_reg: string };

export type IntegrityFlag =
  | "missing_registration" | "vehicle_text_differs_from_registration" | "registration_not_in_fleet" | "registration_ambiguous_in_fleet"
  | "possible_duplicate_entry" | "conflicting_site_coordinates"
  | "missing_pickup_time" | "vehicle_id_not_linked" | "same_route_other_truck" | "missing_work_order" | "driver_not_linked" | "late_entry";
/** Flags a person should look at. The rest are information that explains why a booking cannot feed other screens. */
export const ATTENTION_FLAGS: readonly IntegrityFlag[] = ["vehicle_text_differs_from_registration", "registration_not_in_fleet", "registration_ambiguous_in_fleet", "possible_duplicate_entry", "conflicting_site_coordinates"];

export type VehicleIdentity =
  | { status: "empty" }
  | { status: "unique"; vehicleId: string; registration: string }
  | { status: "ambiguous"; candidates: string[] }
  | { status: "not_found" };

export type BookingIntegrity = { id: string; flags: IntegrityFlag[]; attention: boolean; details: { otherRegistrationText?: string; duplicateOf?: number; spreadKm?: number; vehicleIdentity: VehicleIdentity["status"] } };
export type IntegrityReport = { byId: Map<string, BookingIntegrity>; counts: Record<IntegrityFlag, number>; attentionTotal: number; total: number; coordinateConflicts: { name: string; places: number; spreadKm: number; bookings: number }[] };

const norm = (s: string | null | undefined) => (s ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
const num = (v: unknown) => { const n = typeof v === "string" ? Number(v) : v; return typeof n === "number" && Number.isFinite(n) ? n : null; };
const validPoint = (lat: unknown, lng: unknown) => { const a = num(lat), b = num(lng); return a !== null && b !== null && Math.abs(a) <= 90 && Math.abs(b) <= 180 && !(a === 0 && b === 0); };
/** A registration-like text has at least three digits (so "6", "กระบะ" and "EIGHTEEN_WHEELER" are vehicle types, not registrations). */
export const looksLikeRegistration = (text: string | null | undefined) => ((text ?? "").match(/[0-9]/g) ?? []).length >= 3;
const km = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => { const r = (d: number) => d * Math.PI / 180; const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2; return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)); };

/**
 * Can this registration text safely point at ONE fleet vehicle? Exact, normalised match only (spaces, hyphens and case ignored).
 * Two fleet rows with the same registration are ambiguous and are never resolved by guessing.
 */
export function resolveVehicleIdentity(text: string | null | undefined, fleet: readonly IntegrityVehicle[]): VehicleIdentity {
  const key = registrationKey(text ?? "");
  if (!key) return { status: "empty" };
  const matches = fleet.filter(v => registrationKey(v.vehicle_reg) === key);
  if (matches.length === 1) return { status: "unique", vehicleId: matches[0].id, registration: matches[0].vehicle_reg };
  if (matches.length > 1) return { status: "ambiguous", candidates: matches.map(m => m.id) };
  return { status: "not_found" };
}

export function analyseBookingIntegrity(bookings: readonly IntegrityBooking[], fleet: readonly IntegrityVehicle[]): IntegrityReport {
  const flagsById = new Map<string, Set<IntegrityFlag>>(); const details = new Map<string, BookingIntegrity["details"]>();
  const add = (id: string, flag: IntegrityFlag) => { (flagsById.get(id) ?? flagsById.set(id, new Set()).get(id)!).add(flag); };

  for (const b of bookings) {
    // The diary row normaliser copies the vehicle text into the registration field, so a type word like "6ล้อ" can arrive here; only registration-like text counts as a registration.
    const regField = (b.vehicle_registration ?? "").trim();
    const registrationText = looksLikeRegistration(regField) ? regField : (looksLikeRegistration(b.vehicle) ? (b.vehicle ?? "").trim() : "");
    const identity = resolveVehicleIdentity(registrationText, fleet);
    const d: BookingIntegrity["details"] = { vehicleIdentity: identity.status }; details.set(b.id, d);
    if (identity.status === "empty") add(b.id, "missing_registration");
    else if (identity.status === "not_found") add(b.id, "registration_not_in_fleet");
    else if (identity.status === "ambiguous") add(b.id, "registration_ambiguous_in_fleet");
    const regKey = registrationKey(b.vehicle_registration ?? "");
    if (regKey && looksLikeRegistration(b.vehicle) && registrationKey(b.vehicle ?? "") !== regKey) { add(b.id, "vehicle_text_differs_from_registration"); d.otherRegistrationText = (b.vehicle ?? "").trim(); }
    if (!b.vehicle_id && identity.status !== "empty") add(b.id, "vehicle_id_not_linked");
    if (!(b.pickup_time ?? "").trim()) add(b.id, "missing_pickup_time");
    if (!(b.job_order_number ?? "").trim()) add(b.id, "missing_work_order");
    if ((b.driver ?? "").trim() && (b.driver_id === null || b.driver_id === undefined)) add(b.id, "driver_not_linked");
    if (b.created_at && b.booking_date) { const lag = (Date.parse(b.created_at) - Date.parse(`${b.booking_date}T00:00:00+07:00`)) / 86_400_000; if (lag >= 8) add(b.id, "late_entry"); }
  }

  // Same route, same day, same vehicle reference: separate trucks (different driver or vehicle text, or different pickup times) or a possible double entry (everything the same).
  const groups = new Map<string, IntegrityBooking[]>();
  for (const b of bookings) {
    const refText = (b.vehicle_registration ?? "").trim() || (b.vehicle ?? "").trim(); const vehicleRef = looksLikeRegistration(refText) ? registrationKey(refText) : ""; const p = norm(b.pickup), r = norm(b.dropoff);
    if (!vehicleRef || !p || !r) continue;
    const key = `${b.booking_date}|${vehicleRef}|${p}|${r}`; groups.set(key, [...(groups.get(key) ?? []), b]);
  }
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const signature = (m: IntegrityBooking) => `${norm(m.driver)}|${norm(m.vehicle)}|${(m.pickup_time ?? "").slice(0, 5)}`;
    const seen = new Map<string, IntegrityBooking[]>();
    for (const m of members) seen.set(signature(m), [...(seen.get(signature(m)) ?? []), m]);
    for (const same of seen.values()) { if (same.length > 1) same.forEach(m => { add(m.id, "possible_duplicate_entry"); details.get(m.id)!.duplicateOf = same.length; }); }
    // Different driver or vehicle text on the same route and day: separate trucks. Same truck at different pickup times is a legitimate repeated trip and gets no flag.
    const trucks = new Set(members.map(m => `${norm(m.driver)}|${norm(m.vehicle)}`));
    if (trucks.size > 1) members.forEach(m => { if (!flagsById.get(m.id)?.has("possible_duplicate_entry")) add(m.id, "same_route_other_truck"); });
  }

  // One customer name stored with places kilometres apart across bookings.
  const places = new Map<string, { name: string; points: Map<string, { lat: number; lng: number; ids: string[] }> }>();
  const note = (name: string | null | undefined, lat: unknown, lng: unknown, id: string) => {
    const k = norm(name); if (!k || !validPoint(lat, lng)) return;
    const entry = places.get(k) ?? { name: (name ?? "").trim(), points: new Map() }; places.set(k, entry);
    const cell = `${num(lat)!.toFixed(3)},${num(lng)!.toFixed(3)}`; const p = entry.points.get(cell) ?? { lat: num(lat)!, lng: num(lng)!, ids: [] }; p.ids.push(id); entry.points.set(cell, p);
  };
  for (const b of bookings) { note(b.pickup, b.pickup_lat, b.pickup_lng, b.id); note(b.dropoff, b.dropoff_lat, b.dropoff_lng, b.id); }
  const coordinateConflicts: IntegrityReport["coordinateConflicts"] = [];
  for (const entry of places.values()) {
    const pts = [...entry.points.values()]; if (pts.length < 2) continue;
    let spread = 0; for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) spread = Math.max(spread, km(pts[i], pts[j]));
    if (spread < 1) continue;
    const ids = new Set(pts.flatMap(p => p.ids));
    coordinateConflicts.push({ name: entry.name, places: pts.length, spreadKm: Math.round(spread * 10) / 10, bookings: ids.size });
    for (const id of ids) { add(id, "conflicting_site_coordinates"); details.get(id)!.spreadKm = Math.round(spread * 10) / 10; }
  }
  coordinateConflicts.sort((a, b) => b.spreadKm - a.spreadKm);

  const all: IntegrityFlag[] = ["missing_registration", "vehicle_text_differs_from_registration", "registration_not_in_fleet", "registration_ambiguous_in_fleet", "possible_duplicate_entry", "conflicting_site_coordinates", "missing_pickup_time", "vehicle_id_not_linked", "same_route_other_truck", "missing_work_order", "driver_not_linked", "late_entry"];
  const counts = Object.fromEntries(all.map(f => [f, 0])) as Record<IntegrityFlag, number>;
  const byId = new Map<string, BookingIntegrity>(); let attentionTotal = 0;
  for (const b of bookings) {
    const flags = all.filter(f => flagsById.get(b.id)?.has(f)); flags.forEach(f => { counts[f]++; });
    const attention = flags.some(f => ATTENTION_FLAGS.includes(f)); if (attention) attentionTotal++;
    byId.set(b.id, { id: b.id, flags, attention, details: details.get(b.id)! });
  }
  return { byId, counts, attentionTotal, total: bookings.length, coordinateConflicts };
}

type Lang = "en" | "th";
export const INTEGRITY_COPY: Record<IntegrityFlag, readonly [string, string]> = {
  missing_registration: ["No vehicle registration", "ไม่มีทะเบียนรถ"],
  vehicle_text_differs_from_registration: ["The vehicle field names a different registration; check which truck did this job", "ช่องรถระบุทะเบียนอีกคัน โปรดตรวจว่ารถคันไหนทำงานนี้"],
  registration_not_in_fleet: ["Registration is not in the fleet list", "ทะเบียนไม่อยู่ในรายการรถ"],
  registration_ambiguous_in_fleet: ["Two fleet records share this registration; it cannot be linked until one is fixed", "มีรถสองรายการใช้ทะเบียนนี้ จึงยังเชื่อมโยงไม่ได้จนกว่าจะแก้หนึ่งรายการ"],
  possible_duplicate_entry: ["Same route, driver, vehicle and time entered more than once: possible double entry", "เส้นทาง คนขับ รถ และเวลาเดียวกันถูกบันทึกซ้ำ อาจเป็นการบันทึกซ้ำ"],
  conflicting_site_coordinates: ["This customer name is stored at places kilometres apart in different bookings", "ชื่อลูกค้านี้ถูกบันทึกในตำแหน่งที่ห่างกันหลายกิโลเมตรในหลายการจอง"],
  missing_pickup_time: ["No scheduled pickup time", "ไม่มีเวลารับตามแผน"],
  vehicle_id_not_linked: ["Linked to the fleet by registration text only", "เชื่อมกับรถด้วยข้อความทะเบียนเท่านั้น"],
  same_route_other_truck: ["Same route and day as another booking with a different driver or vehicle: probably a separate truck", "เส้นทางและวันเดียวกับอีกการจองที่คนขับหรือรถต่างกัน น่าจะเป็นรถคนละคัน"],
  missing_work_order: ["No work-order number", "ไม่มีเลขใบงาน"],
  driver_not_linked: ["Driver is typed text, not linked to a driver record", "คนขับเป็นข้อความที่พิมพ์ ไม่ได้เชื่อมกับข้อมูลคนขับ"],
  late_entry: ["Entered more than a week after the job date", "บันทึกหลังวันงานเกินหนึ่งสัปดาห์"]
};
export const integrityLabel = (flag: IntegrityFlag, language: Lang) => (language === "th" ? INTEGRITY_COPY[flag][1] : INTEGRITY_COPY[flag][0]);
