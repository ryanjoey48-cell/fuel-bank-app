import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  extractForthLocationIdFromSourceInfo,
  parseForthPinnedLocationsCsv,
  reconcileForthPinnedLocations,
  type EesLocationForForthMatch,
  type ForthLocationReconcileResult
} from "@/lib/forth-locations-import";

export const FORTH_PINNED_LOCATIONS_CSV_RELATIVE_PATH = path.join(
  "data",
  "forth-locations",
  "Locations Forth Pinned.csv"
);

export async function loadBundledForthPinnedLocationsCsv() {
  const csvPath = path.join(process.cwd(), FORTH_PINNED_LOCATIONS_CSV_RELATIVE_PATH);
  return readFile(csvPath, "utf8");
}

type DirectoryRow = {
  id: string;
  company_name: string;
  thai_name: string | null;
  alternative_names: string[] | null;
  address: string;
  province: string | null;
  destination_type: string | null;
  source_info: string | null;
  google_maps_url?: string | null;
  verification_status?: string | null;
};

type PinRow = {
  location_id: string;
  latitude: number;
  longitude: number;
  pin_type: string;
  pin_status: string;
};

export async function reconcileBundledForthPinnedLocationsAgainstDirectory(
  locations: readonly DirectoryRow[],
  pins: readonly PinRow[]
): Promise<ForthLocationReconcileResult & { csvPath: string }> {
  const csvText = await loadBundledForthPinnedLocationsCsv();
  const records = parseForthPinnedLocationsCsv(csvText);
  const pinByLocation = new Map<string, PinRow>();
  for (const pin of pins) {
    if (pin.pin_type !== "destination" || pin.pin_status !== "manual_confirmed") continue;
    if (!pinByLocation.has(pin.location_id)) pinByLocation.set(pin.location_id, pin);
  }
  const eesLocations: EesLocationForForthMatch[] = locations.map((location) => {
    const pin = pinByLocation.get(location.id);
    return {
      id: location.id,
      companyName: location.company_name,
      thaiName: location.thai_name,
      alternativeNames: location.alternative_names,
      address: location.address,
      province: location.province,
      destinationType: location.destination_type,
      sourceInfo: location.source_info,
      googleMapsUrl: location.google_maps_url ?? null,
      latitude: pin?.latitude ?? null,
      longitude: pin?.longitude ?? null,
      hasConfirmedDestinationPin: Boolean(pin)
    };
  });
  const approvedForthLocationIds = new Set(
    locations
      .map((location) => extractForthLocationIdFromSourceInfo(location.source_info))
      .filter((value): value is string => Boolean(value))
  );
  const result = reconcileForthPinnedLocations(records, eesLocations, { approvedForthLocationIds });
  return { ...result, csvPath: FORTH_PINNED_LOCATIONS_CSV_RELATIVE_PATH };
}
