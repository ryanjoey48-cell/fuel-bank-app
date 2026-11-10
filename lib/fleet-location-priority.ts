/**
 * V5.1 coordinate priority for journey tracking. Pure.
 *
 * Order (highest first):
 *  1. office-verified loading point suited to the job
 *  2. office-verified vehicle (truck) entrance
 *  3. other explicitly verified customer site location (destination pin)
 *  4. the booking's own coordinate, labelled unverified
 *  5. nothing, with the reason
 * The booking's original coordinate is never replaced or edited: it is carried alongside whatever was chosen so the screen can show both.
 * Candidate, needs-verification and rejected pins are never used for matching. Two different verified points at the same rank are
 * ambiguous and are not guessed between unless a vehicle-class restriction separates them.
 */
export type PinKind = "loading_point" | "truck_entrance" | "destination";
export type PinStatus = "verified_by_office" | "candidate_awaiting_review" | "needs_verification" | "rejected_invalid";
export type SitePin = {
  id: string; locationId: string; kind: PinKind; status: PinStatus;
  latitude: number; longitude: number;
  radiusMeters?: number | null;
  /** Vehicle classes the pin is for (e.g. "18-wheeler"); null or empty = any. */
  vehicleClasses?: readonly string[] | null;
  source?: string | null; verifiedAt?: string | null;
};
export type Coordinate = { latitude: number; longitude: number };
export type PointRank = 1 | 2 | 3 | 4 | 5;
export type PointProvenance = "office_verified_loading_point" | "office_verified_entrance" | "office_verified_site_location" | "booking_coordinate_unverified" | "missing";

export type ResolvedPoint = {
  point: Coordinate | null;
  rank: PointRank;
  provenance: PointProvenance;
  verified: boolean;
  pinId: string | null;
  /** Boundary radius chosen for this point; null means "use the default 150 m". */
  radiusMeters: number | null;
  ambiguous: boolean;
  alternatives: { pinId: string; kind: PinKind }[];
  bookingCoordinate: Coordinate | null;
  reason: string;
};

const valid = (p: Coordinate | null | undefined): p is Coordinate => Boolean(p) && Number.isFinite(p!.latitude) && Number.isFinite(p!.longitude) && Math.abs(p!.latitude) <= 90 && Math.abs(p!.longitude) <= 180;
const apart = (a: Coordinate, b: Coordinate) => { const r = (d: number) => d * Math.PI / 180; const h = Math.sin(r(b.latitude - a.latitude) / 2) ** 2 + Math.cos(r(a.latitude)) * Math.cos(r(b.latitude)) * Math.sin(r(b.longitude - a.longitude) / 2) ** 2; return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)); };
const SAME_POINT_M = 30;
const RANKS: { kind: PinKind; rank: PointRank; provenance: PointProvenance }[] = [
  { kind: "loading_point", rank: 1, provenance: "office_verified_loading_point" },
  { kind: "truck_entrance", rank: 2, provenance: "office_verified_entrance" },
  { kind: "destination", rank: 3, provenance: "office_verified_site_location" }
];

/** Converts an existing directory pin row (`destination` / `truck_entrance`, status `manual_confirmed`) into a SitePin. */
export function pinFromDirectoryRow(row: { id: string; location_id: string; pin_type: string; pin_status: string; latitude: number; longitude: number; confirmed_at?: string | null; coordinate_source?: string | null; radius_meters?: number | null; vehicle_classes?: string[] | null }): SitePin | null {
  const kind: PinKind | null = row.pin_type === "truck_entrance" ? "truck_entrance" : row.pin_type === "destination" ? "destination" : row.pin_type === "loading_point" ? "loading_point" : null;
  if (!kind) return null;
  const status: PinStatus = row.pin_status === "manual_confirmed" || row.pin_status === "verified_by_office" ? "verified_by_office" : row.pin_status === "candidate_awaiting_review" ? "candidate_awaiting_review" : row.pin_status === "rejected_invalid" ? "rejected_invalid" : "needs_verification";
  return { id: row.id, locationId: row.location_id, kind, status, latitude: Number(row.latitude), longitude: Number(row.longitude), radiusMeters: row.radius_meters ?? null, vehicleClasses: row.vehicle_classes ?? null, source: row.coordinate_source ?? null, verifiedAt: row.confirmed_at ?? null };
}

export function resolveJobPoint(input: { booking: Coordinate | null; pins: readonly SitePin[]; vehicleClass?: string | null }): ResolvedPoint {
  const booking = valid(input.booking) ? input.booking : null;
  const usable = input.pins.filter(p => p.status === "verified_by_office" && valid(p));
  for (const level of RANKS) {
    let atLevel = usable.filter(p => p.kind === level.kind);
    if (!atLevel.length) continue;
    // A vehicle-class restriction separates pins only when it positively matches; unrestricted pins stay eligible.
    if (input.vehicleClass) {
      const matching = atLevel.filter(p => p.vehicleClasses?.includes(input.vehicleClass!));
      const unrestricted = atLevel.filter(p => !p.vehicleClasses || p.vehicleClasses.length === 0);
      const excluded = atLevel.filter(p => p.vehicleClasses && p.vehicleClasses.length > 0 && !p.vehicleClasses.includes(input.vehicleClass!));
      atLevel = matching.length ? matching : unrestricted.length ? unrestricted : excluded.length === atLevel.length ? [] : atLevel;
      if (!atLevel.length) continue;
    }
    const distinct = atLevel.filter((p, i) => atLevel.findIndex(q => apart(p, q) <= SAME_POINT_M) === i);
    if (distinct.length > 1) {
      return { point: null, rank: level.rank, provenance: level.provenance, verified: true, pinId: null, radiusMeters: null, ambiguous: true, alternatives: distinct.map(p => ({ pinId: p.id, kind: p.kind })), bookingCoordinate: booking, reason: "Several verified points of this kind exist and nothing in the job or vehicle separates them; the office must choose." };
    }
    const chosen = distinct[0];
    return { point: { latitude: chosen.latitude, longitude: chosen.longitude }, rank: level.rank, provenance: level.provenance, verified: true, pinId: chosen.id, radiusMeters: chosen.radiusMeters ?? null, ambiguous: false, alternatives: [], bookingCoordinate: booking, reason: level.rank === 1 ? "Office-verified loading point." : level.rank === 2 ? "Office-verified vehicle entrance; no verified loading point exists." : "Office-verified site location; no verified entrance or loading point exists." };
  }
  if (booking) return { point: booking, rank: 4, provenance: "booking_coordinate_unverified", verified: false, pinId: null, radiusMeters: null, ambiguous: false, alternatives: [], bookingCoordinate: booking, reason: "Booking coordinate, not reviewed by the office; it may be a roadside geocode rather than the loading point." };
  return { point: null, rank: 5, provenance: "missing", verified: false, pinId: null, radiusMeters: null, ambiguous: false, alternatives: [], bookingCoordinate: null, reason: "No verified pin and no booking coordinate exist for this location." };
}
