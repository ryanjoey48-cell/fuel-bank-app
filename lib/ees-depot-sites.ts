/**
 * Canonical EES office vs lorry depot Forth identities.
 * Office and depot are separate — never treat 1708908 as the yard.
 */

export const EES_OFFICE_FORTH_LOCATION_ID = "1708908";
export const EES_LORRY_DEPOT_FORTH_LOCATION_ID = "1977073";

export const EES_LORRY_DEPOT_FORTH_COORDINATES = {
  latitude: 13.768732,
  longitude: 100.766033
} as const;

/** Owner-confirmed Maps corroboration (not a substitute for Directory pin confirmation). */
export const EES_LORRY_DEPOT_MAPS_COORDINATES = {
  latitude: 13.7688008,
  longitude: 100.7657385
} as const;

export const EES_LORRY_DEPOT_PROVISIONAL_RADIUS_METERS = 120;

export const EES_OFFICE_FORTH_COORDINATES = {
  latitude: 13.763182,
  longitude: 100.753118
} as const;

export function isEesLorryDepotForthId(forthLocationId: string | null | undefined) {
  return String(forthLocationId ?? "").trim() === EES_LORRY_DEPOT_FORTH_LOCATION_ID;
}

export function isEesOfficeForthId(forthLocationId: string | null | undefined) {
  return String(forthLocationId ?? "").trim() === EES_OFFICE_FORTH_LOCATION_ID;
}

export function labelEesForthSite(forthLocationId: string | null | undefined, language: "en" | "th" = "en") {
  if (isEesLorryDepotForthId(forthLocationId)) {
    return language === "th" ? "ลานจอดรถ EES" : "EES lorry depot";
  }
  if (isEesOfficeForthId(forthLocationId)) {
    return language === "th" ? "สำนักงาน EES" : "EES office";
  }
  return null;
}
