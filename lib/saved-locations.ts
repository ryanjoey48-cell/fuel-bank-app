import type { SavedLocation, SavedLocationType } from "@/types/database";

export function normalizeSavedLocationName(value: string | null | undefined) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

export function findExactSavedLocation(
  locations: SavedLocation[],
  locationType: SavedLocationType,
  displayName: string
) {
  const normalizedName = normalizeSavedLocationName(displayName);
  if (!normalizedName) return null;

  return locations.find(
    (location) =>
      location.location_type === locationType &&
      location.normalized_name === normalizedName
  ) ?? null;
}

export function rankSavedLocations(
  locations: SavedLocation[],
  locationType: SavedLocationType
) {
  return locations
    .filter((location) => location.location_type === locationType)
    .sort(
      (a, b) =>
        b.use_count - a.use_count ||
        b.last_used_at.localeCompare(a.last_used_at) ||
        a.display_name.localeCompare(b.display_name)
    );
}

export function savedLocationHasVerifiedMapsData(location: SavedLocation) {
  return Boolean(
    location.formatted_address &&
      (location.google_place_id ||
        (location.latitude != null && location.longitude != null))
  );
}
