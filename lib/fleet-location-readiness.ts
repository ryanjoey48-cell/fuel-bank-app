import { validGeofenceCoordinates } from "@/lib/fleet-geofence-engine";

export type DirectoryLocationForReview = {
  id: string;
  company_name: string;
  thai_name?: string | null;
  province?: string | null;
  verification_status: string;
  google_maps_url?: string | null;
};
export type ConfirmedDestinationPin = {
  location_id: string;
  pin_type: string;
  pin_status: string;
  latitude: number;
  longitude: number;
};
export type LocationReviewItem = {
  id: string;
  name: string;
  province: string | null;
  reasons: ("record_unverified" | "pin_missing" | "duplicate_candidate")[];
  duplicateIds: string[];
};

function key(value: string | null | undefined) {
  return value?.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase() || "";
}

/** Review hints only. A URL or matching name never supplies coordinates or merges records. */
export function reviewEesLocationReadiness(
  locations: readonly DirectoryLocationForReview[], pins: readonly ConfirmedDestinationPin[]
): LocationReviewItem[] {
  const confirmedIds = new Set(pins.filter((pin) => pin.pin_type === "destination" &&
    pin.pin_status === "manual_confirmed" && validGeofenceCoordinates(pin.latitude, pin.longitude))
    .map((pin) => pin.location_id));
  const groups = new Map<string, string[]>();
  for (const location of locations) {
    const name = key(location.company_name);
    const province = key(location.province);
    const url = key(location.google_maps_url);
    for (const groupKey of [name && province ? `name:${name}|${province}` : "", url ? `url:${url}` : ""]) {
      if (groupKey) groups.set(groupKey, [...(groups.get(groupKey) ?? []), location.id]);
    }
  }
  return locations.map((location) => {
    const name = key(location.company_name);
    const province = key(location.province);
    const url = key(location.google_maps_url);
    const duplicateIds = [...new Set([...(groups.get(`name:${name}|${province}`) ?? []),
      ...(url ? groups.get(`url:${url}`) ?? [] : [])])].filter((id) => id !== location.id);
    const reasons: LocationReviewItem["reasons"] = [];
    if (location.verification_status !== "verified") reasons.push("record_unverified");
    if (!confirmedIds.has(location.id)) reasons.push("pin_missing");
    if (duplicateIds.length) reasons.push("duplicate_candidate");
    return { id: location.id, name: location.company_name, province: location.province ?? null, reasons, duplicateIds };
  }).filter((item) => item.reasons.length > 0);
}
