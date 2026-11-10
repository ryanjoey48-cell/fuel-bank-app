/**
 * Parse and reconcile Forth "Pinned Locations" CSV exports against the EES Locations Directory.
 * Coordinates from Forth are source candidates, not office-confirmed destination pins.
 * Diameter values are preserved as raw Forth fields; units are not assumed.
 */

import { geofenceDistanceMeters, validGeofenceCoordinates } from "@/lib/fleet-geofence-engine";

export const FORTH_LOCATION_ID_MARKER = "Forth location ID:";
export const FORTH_EXPORT_SOURCE_LABEL = "Forth pinned locations CSV";

export const FORTH_PINNED_CSV_HEADERS = [
  "รหัสสถานที่",
  "ชื่อสถานที่",
  "ชื่อชั้นสถานที่",
  "ละติจูด",
  "ลองจิจูด",
  "ที่อยู่",
  "ประเภทสถานที่",
  "เส้นผ่านศูนย์กลาง",
  "สัญลักษณ์"
] as const;

export type ForthPinnedCsvHeader = (typeof FORTH_PINNED_CSV_HEADERS)[number];

export type ForthLocationClassification =
  | "MATCHED"
  | "POSSIBLE_DUPLICATE"
  | "NEW_LOCATION"
  | "MISSING_COORDINATES"
  | "INVALID_COORDINATES"
  | "REQUIRES_REVIEW";

export type ForthPinnedLocationRecord = {
  forthLocationId: string;
  name: string | null;
  groupLayer: string | null;
  latitude: number | null;
  longitude: number | null;
  address: string | null;
  locationType: string | null;
  /** Raw Forth diameter field. Do not treat as metres without provider confirmation. */
  diameterRaw: string | null;
  symbol: string | null;
  sourceRow: number;
  raw: Record<ForthPinnedCsvHeader, string>;
};

export type EesLocationForForthMatch = {
  id: string;
  companyName: string;
  thaiName: string | null;
  alternativeNames?: readonly string[] | null;
  address: string;
  province?: string | null;
  destinationType?: string | null;
  sourceInfo?: string | null;
  googleMapsUrl?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  /** Optional coordinates parsed from a Google Maps URL — never treated as confirmed pins. */
  mapsHintLatitude?: number | null;
  mapsHintLongitude?: number | null;
  hasConfirmedDestinationPin?: boolean;
};

export type ForthMatchConfidence = "strong" | "possible" | "uncertain";

export type ForthLocationMatchCandidate = {
  eesLocationId: string;
  companyName: string;
  thaiName: string | null;
  distanceMeters: number | null;
  confidence: ForthMatchConfidence;
  reasons: string[];
};

export type ForthLocationReconcileItem = {
  record: ForthPinnedLocationRecord;
  classification: ForthLocationClassification;
  suggestedCategory: "Customer" | "Warehouse" | "Factory" | "Depot" | "Port" | "Airport" | "Other";
  matchCandidates: ForthLocationMatchCandidate[];
  matchedEesLocationId: string | null;
  bestMatchConfidence: ForthMatchConfidence | null;
  /** True only for safe NEW_LOCATION drafts eligible for bulk approve. */
  bulkEligible: boolean;
  notes: string[];
  /** Proposed Directory draft fields. Never auto-applied without office approval. */
  proposedDirectory: {
    companyName: string;
    thaiName: string | null;
    address: string;
    destinationType: "Customer" | "Warehouse" | "Factory" | "Depot" | "Port" | "Airport" | "Other";
    sourceInfo: string;
    notes: string;
  } | null;
};

export type ForthLocationReconcileSummary = {
  forthSourceRecords: number;
  uniqueForthLocationIds: number;
  validCoordinatePairs: number;
  exactDuplicateCoordinateGroups: number;
  populatedNames: number;
  populatedAddresses: number;
  distinctGroupLayers: number;
  eesDirectoryRecords: number;
  eesConfirmedDestinationPins: number;
  classifications: Record<ForthLocationClassification, number>;
  approvedImports: number;
};

export type ForthLocationReconcileResult = {
  summary: ForthLocationReconcileSummary;
  items: ForthLocationReconcileItem[];
  diameterNote: string;
};

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
        continue;
      }
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      out.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  out.push(current);
  return out;
}

export function normalizeForthCompareText(value: string | null | undefined): string {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Compact alphanumeric compare for punctuation/spacing variants (EN/TH). */
export function compactForthCompareText(value: string | null | undefined): string {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

export function extractForthLocationIdFromSourceInfo(sourceInfo: string | null | undefined): string | null {
  if (!sourceInfo) return null;
  const match = sourceInfo.match(new RegExp(`${FORTH_LOCATION_ID_MARKER}\\s*([0-9]+)`, "i"));
  return match?.[1] ?? null;
}

/** Parse lat/lng from common Google Maps URL shapes. Hint only — not a confirmed destination pin. */
export function extractMapsCoordinateHint(googleMapsUrl: string | null | undefined): {
  latitude: number;
  longitude: number;
} | null {
  if (!googleMapsUrl) return null;
  const patterns = [
    /[?&]q=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i,
    /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/
  ];
  for (const pattern of patterns) {
    const match = googleMapsUrl.match(pattern);
    if (!match) continue;
    const latitude = Number(match[1]);
    const longitude = Number(match[2]);
    if (validGeofenceCoordinates(latitude, longitude)) return { latitude, longitude };
  }
  return null;
}

export function suggestEesCategoryFromForth(groupLayer: string | null, locationType: string | null):
  ForthLocationReconcileItem["suggestedCategory"] {
  const haystack = normalizeForthCompareText(`${groupLayer ?? ""} ${locationType ?? ""}`);
  if (/\b(airport|สนามบิน)\b/.test(haystack)) return "Airport";
  if (/\b(port|ท่าเรือ|harbor|harbour)\b/.test(haystack)) return "Port";
  if (/\b(warehouse|คลัง|โกดัง)\b/.test(haystack)) return "Warehouse";
  if (/\b(factory|โรงงาน|plant)\b/.test(haystack)) return "Factory";
  if (/\b(depot|ดีโป|yard)\b/.test(haystack)) return "Depot";
  if (/\b(customer|ลูกค้า|client)\b/.test(haystack)) return "Customer";
  return "Other";
}

export function parseForthPinnedLocationsCsv(csvText: string): ForthPinnedLocationRecord[] {
  const text = csvText.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!text) throw new Error("Forth locations CSV is empty.");
  const lines = text.split("\n").filter((line) => line.length > 0);
  const headers = parseCsvLine(lines[0]).map((header) => header.trim());
  for (const expected of FORTH_PINNED_CSV_HEADERS) {
    if (!headers.includes(expected)) {
      throw new Error(`Forth locations CSV is missing required column: ${expected}`);
    }
  }
  const indexOf = (header: ForthPinnedCsvHeader) => headers.indexOf(header);
  const records: ForthPinnedLocationRecord[] = [];
  for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
    const cells = parseCsvLine(lines[lineIndex]);
    const raw = Object.fromEntries(
      FORTH_PINNED_CSV_HEADERS.map((header) => [header, String(cells[indexOf(header)] ?? "").trim()])
    ) as Record<ForthPinnedCsvHeader, string>;
    const forthLocationId = raw["รหัสสถานที่"];
    if (!forthLocationId) continue;
    const latitudeRaw = raw["ละติจูด"];
    const longitudeRaw = raw["ลองจิจูด"];
    const latitude = latitudeRaw === "" ? null : Number(latitudeRaw);
    const longitude = longitudeRaw === "" ? null : Number(longitudeRaw);
    records.push({
      forthLocationId,
      name: raw["ชื่อสถานที่"] || null,
      groupLayer: raw["ชื่อชั้นสถานที่"] || null,
      latitude: latitudeRaw === "" ? null : latitude,
      longitude: longitudeRaw === "" ? null : longitude,
      address: raw["ที่อยู่"] || null,
      locationType: raw["ประเภทสถานที่"] || null,
      diameterRaw: raw["เส้นผ่านศูนย์กลาง"] || null,
      symbol: raw["สัญลักษณ์"] || null,
      sourceRow: lineIndex + 1,
      raw
    });
  }
  return records;
}

function nameSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const compactA = compactForthCompareText(a);
  const compactB = compactForthCompareText(b);
  if (compactA && compactA === compactB) return 0.98;
  // Avoid short-code false positives ("SS" inside longer address/company text).
  if (a.length >= 4 && b.length >= 4 && (a.includes(b) || b.includes(a))) return 0.85;
  const left = new Set(a.split(" ").filter((token) => token.length >= 2));
  const right = new Set(b.split(" ").filter((token) => token.length >= 2));
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  for (const token of left) if (right.has(token)) overlap += 1;
  const union = new Set([...left, ...right]).size;
  return union ? overlap / union : 0;
}

function eesNameFields(location: EesLocationForForthMatch): string[] {
  return [
    location.companyName,
    location.thaiName,
    ...(location.alternativeNames ?? [])
  ].map((value) => normalizeForthCompareText(value)).filter(Boolean);
}

function exactNameMatch(record: ForthPinnedLocationRecord, location: EesLocationForForthMatch): boolean {
  const forthName = normalizeForthCompareText(record.name);
  const forthCompact = compactForthCompareText(record.name);
  if (!forthName || !forthCompact) return false;
  return eesNameFields(location).some((candidate) =>
    candidate === forthName || compactForthCompareText(candidate) === forthCompact);
}

function strongNameMatch(record: ForthPinnedLocationRecord, location: EesLocationForForthMatch): boolean {
  if (exactNameMatch(record, location)) return true;
  const forthName = normalizeForthCompareText(record.name);
  if (!forthName || forthName.length < 4) return false;
  return eesNameFields(location).some((candidate) => nameSimilarity(forthName, candidate) >= 0.85);
}

function softNameMatch(record: ForthPinnedLocationRecord, location: EesLocationForForthMatch): boolean {
  const forthName = normalizeForthCompareText(record.name);
  if (!forthName || forthName.length < 4) return false;
  return eesNameFields(location).some((candidate) => nameSimilarity(forthName, candidate) >= 0.55);
}

function softAddressMatch(record: ForthPinnedLocationRecord, location: EesLocationForForthMatch): boolean {
  const forthAddress = normalizeForthCompareText(record.address);
  const eesAddress = normalizeForthCompareText(location.address);
  if (!forthAddress || !eesAddress || forthAddress.length < 8) return false;
  return nameSimilarity(forthAddress, eesAddress) >= 0.6;
}

function resolvePoint(location: EesLocationForForthMatch): {
  latitude: number;
  longitude: number;
  source: "confirmed_pin" | "maps_hint";
} | null {
  if (location.latitude != null && location.longitude != null
    && validGeofenceCoordinates(location.latitude, location.longitude)) {
    return { latitude: location.latitude, longitude: location.longitude, source: "confirmed_pin" };
  }
  if (location.mapsHintLatitude != null && location.mapsHintLongitude != null
    && validGeofenceCoordinates(location.mapsHintLatitude, location.mapsHintLongitude)) {
    return {
      latitude: location.mapsHintLatitude,
      longitude: location.mapsHintLongitude,
      source: "maps_hint"
    };
  }
  const hint = extractMapsCoordinateHint(location.googleMapsUrl);
  if (!hint) return null;
  return { ...hint, source: "maps_hint" };
}

function confidenceRank(value: ForthMatchConfidence): number {
  return value === "strong" ? 3 : value === "possible" ? 2 : 1;
}

function buildSourceInfo(record: ForthPinnedLocationRecord): string {
  return [
    `${FORTH_EXPORT_SOURCE_LABEL}; row ${record.sourceRow}`,
    `${FORTH_LOCATION_ID_MARKER} ${record.forthLocationId}`,
    record.groupLayer ? `Forth group/layer: ${record.groupLayer}` : null,
    record.locationType ? `Forth location type: ${record.locationType}` : null,
    record.diameterRaw != null
      ? `Forth diameter raw: ${record.diameterRaw} (unit unverified; not applied as geofence radius)`
      : null,
    record.symbol != null ? `Forth symbol: ${record.symbol}` : null,
    record.latitude != null && record.longitude != null
      ? `Forth coordinates: ${record.latitude},${record.longitude}`
      : null
  ].filter(Boolean).join("\n");
}

function buildProposedDirectory(record: ForthPinnedLocationRecord, category: ForthLocationReconcileItem["suggestedCategory"]) {
  const companyName = record.name?.trim() || `Forth location ${record.forthLocationId}`;
  const address = record.address?.trim()
    || "Forth export: address not supplied. Confirm before dispatch use.";
  return {
    companyName,
    thaiName: record.name?.trim() || null,
    address,
    destinationType: category,
    sourceInfo: buildSourceInfo(record),
    notes: [
      "Imported from Forth pinned locations for office review.",
      "Forth coordinates are source evidence, not an office-confirmed destination pin.",
      "Do not activate geofence monitoring until Directory verification and destination pin confirmation."
    ].join(" ")
  };
}

export function reconcileForthPinnedLocations(
  records: readonly ForthPinnedLocationRecord[],
  eesLocations: readonly EesLocationForForthMatch[],
  options: { approvedForthLocationIds?: ReadonlySet<string> } = {}
): ForthLocationReconcileResult {
  const approved = options.approvedForthLocationIds ?? new Set<string>();
  const byForthId = new Map<string, EesLocationForForthMatch>();
  for (const location of eesLocations) {
    const linked = extractForthLocationIdFromSourceInfo(location.sourceInfo);
    if (linked) byForthId.set(linked, location);
  }

  const coordCounts = new Map<string, number>();
  for (const record of records) {
    if (record.latitude == null || record.longitude == null) continue;
    if (!validGeofenceCoordinates(record.latitude, record.longitude)) continue;
    const key = `${record.latitude}|${record.longitude}`;
    coordCounts.set(key, (coordCounts.get(key) ?? 0) + 1);
  }

  const items: ForthLocationReconcileItem[] = records.map((record) => {
    const notes: string[] = [];
    const suggestedCategory = suggestEesCategoryFromForth(record.groupLayer, record.locationType);
    const matchCandidates: ForthLocationMatchCandidate[] = [];
    const baseIncomplete = {
      record, suggestedCategory, matchCandidates: [] as ForthLocationMatchCandidate[],
      matchedEesLocationId: null as string | null, bestMatchConfidence: null as ForthMatchConfidence | null,
      bulkEligible: false, proposedDirectory: null as ForthLocationReconcileItem["proposedDirectory"]
    };

    if (record.latitude == null || record.longitude == null) {
      return {
        ...baseIncomplete, classification: "MISSING_COORDINATES" as const,
        notes: ["Latitude or longitude was blank in the Forth export."]
      };
    }
    if (!validGeofenceCoordinates(record.latitude, record.longitude)) {
      return {
        ...baseIncomplete, classification: "INVALID_COORDINATES" as const,
        notes: ["Forth coordinates are outside the valid geographic range."]
      };
    }

    const coordKey = `${record.latitude}|${record.longitude}`;
    if ((coordCounts.get(coordKey) ?? 0) > 1) {
      notes.push("Exact duplicate coordinate pair appears more than once in the Forth export.");
    }
    if (!record.name?.trim()) notes.push("Location name is blank in the Forth export.");

    const linked = byForthId.get(record.forthLocationId);
    if (linked) {
      const point = resolvePoint(linked);
      const distanceMeters = point
        ? geofenceDistanceMeters(
          { latitude: record.latitude, longitude: record.longitude },
          { latitude: point.latitude, longitude: point.longitude }
        )
        : null;
      matchCandidates.push({
        eesLocationId: linked.id,
        companyName: linked.companyName,
        thaiName: linked.thaiName,
        distanceMeters,
        confidence: "strong",
        reasons: ["Existing EES source_info links this Forth location ID."]
      });
      if (distanceMeters != null && distanceMeters > 75 && point?.source === "confirmed_pin") {
        notes.push("Linked EES record has a confirmed pin more than 75 m from the Forth coordinates.");
        return {
          record, classification: "REQUIRES_REVIEW", suggestedCategory, matchCandidates,
          matchedEesLocationId: linked.id, bestMatchConfidence: "strong", bulkEligible: false, notes,
          proposedDirectory: buildProposedDirectory(record, suggestedCategory)
        };
      }
      return {
        record, classification: "MATCHED", suggestedCategory, matchCandidates,
        matchedEesLocationId: linked.id, bestMatchConfidence: "strong", bulkEligible: false, notes,
        proposedDirectory: null
      };
    }

    for (const location of eesLocations) {
      const reasons: string[] = [];
      let confidence: ForthMatchConfidence | null = null;
      const point = resolvePoint(location);
      let distanceMeters: number | null = null;
      if (point) {
        distanceMeters = geofenceDistanceMeters(
          { latitude: record.latitude, longitude: record.longitude },
          { latitude: point.latitude, longitude: point.longitude }
        );
        if (point.source === "confirmed_pin" && distanceMeters <= 5) {
          reasons.push("Confirmed EES pin is within 5 m of Forth coordinates.");
          confidence = "strong";
        } else if (point.source === "confirmed_pin" && distanceMeters <= 75) {
          reasons.push("Confirmed EES pin is within 75 m of Forth coordinates.");
          confidence = "possible";
        } else if (point.source === "maps_hint" && distanceMeters <= 75) {
          reasons.push("Google Maps URL hint is within 75 m of Forth coordinates (not a confirmed pin).");
          confidence = "uncertain";
        }
      }
      if (exactNameMatch(record, location)) {
        reasons.push("Exact name match after normalizing punctuation/spacing (EN/TH).");
        confidence = "strong";
      } else if (strongNameMatch(record, location)) {
        reasons.push("Strong name similarity with EES Directory.");
        confidence = confidence === "strong" ? "strong" : "possible";
      } else if (softNameMatch(record, location)) {
        reasons.push("Partial name similarity with EES Directory.");
        confidence = confidence ?? "possible";
      }
      if (softAddressMatch(record, location)) {
        reasons.push("Address similarity with EES Directory.");
        confidence = confidence === "strong" ? "strong" : confidence ?? "possible";
      }
      if (!reasons.length || !confidence) continue;
      // Nearby coordinates alone are never enough for MATCHED / strong merge.
      if (reasons.length === 1 && /within 75 m/.test(reasons[0]) && !reasons[0].includes("Exact name")) {
        reasons.push("Proximity alone — office review required; not an automatic merge.");
        confidence = "uncertain";
      }
      matchCandidates.push({
        eesLocationId: location.id,
        companyName: location.companyName,
        thaiName: location.thaiName,
        distanceMeters,
        confidence,
        reasons
      });
    }

    matchCandidates.sort((left, right) =>
      confidenceRank(right.confidence) - confidenceRank(left.confidence)
      || (left.distanceMeters ?? Number.POSITIVE_INFINITY) - (right.distanceMeters ?? Number.POSITIVE_INFINITY)
      || left.companyName.localeCompare(right.companyName));

    const bestMatchConfidence = matchCandidates[0]?.confidence ?? null;
    const proposedDirectory = buildProposedDirectory(record, suggestedCategory);

    if (!record.name?.trim() || notes.some((note) => note.includes("duplicate coordinate"))) {
      return {
        record, classification: "REQUIRES_REVIEW", suggestedCategory, matchCandidates,
        matchedEesLocationId: null, bestMatchConfidence, bulkEligible: false, notes, proposedDirectory
      };
    }

    const uniqueStrongExact = matchCandidates.filter((candidate) =>
      candidate.confidence === "strong"
      && candidate.reasons.some((reason) => reason.startsWith("Exact name")));
    const uniquePinAndName = matchCandidates.filter((candidate) =>
      candidate.distanceMeters != null && candidate.distanceMeters <= 5
      && candidate.reasons.some((reason) => reason.includes("Confirmed EES pin"))
      && candidate.reasons.some((reason) => /Exact name|Strong name/.test(reason)));

    // MATCHED without a stored Forth ID only when unique confirmed-pin + strong/exact name evidence exists.
    if (uniquePinAndName.length === 1) {
      return {
        record, classification: "MATCHED", suggestedCategory, matchCandidates,
        matchedEesLocationId: uniquePinAndName[0].eesLocationId, bestMatchConfidence: "strong",
        bulkEligible: false, notes, proposedDirectory: null
      };
    }

    if (matchCandidates.length) {
      if (uniqueStrongExact.length === 1) {
        notes.push("Unique exact Directory name match — office should link the existing EES record rather than create a duplicate draft.");
      }
      return {
        record, classification: "POSSIBLE_DUPLICATE", suggestedCategory, matchCandidates,
        matchedEesLocationId: uniqueStrongExact.length === 1 ? uniqueStrongExact[0].eesLocationId : null,
        bestMatchConfidence, bulkEligible: false, notes, proposedDirectory
      };
    }

    return {
      record, classification: "NEW_LOCATION", suggestedCategory, matchCandidates: [],
      matchedEesLocationId: null, bestMatchConfidence: null, bulkEligible: true, notes, proposedDirectory
    };
  });

  const classifications: Record<ForthLocationClassification, number> = {
    MATCHED: 0, POSSIBLE_DUPLICATE: 0, NEW_LOCATION: 0,
    MISSING_COORDINATES: 0, INVALID_COORDINATES: 0, REQUIRES_REVIEW: 0
  };
  for (const item of items) classifications[item.classification] += 1;

  const uniqueIds = new Set(records.map((record) => record.forthLocationId));
  const validCoordinatePairs = records.filter((record) =>
    record.latitude != null && record.longitude != null
    && validGeofenceCoordinates(record.latitude, record.longitude)).length;
  const exactDuplicateCoordinateGroups = [...coordCounts.values()].filter((count) => count > 1).length;

  return {
    summary: {
      forthSourceRecords: records.length,
      uniqueForthLocationIds: uniqueIds.size,
      validCoordinatePairs,
      exactDuplicateCoordinateGroups,
      populatedNames: records.filter((record) => Boolean(record.name?.trim())).length,
      populatedAddresses: records.filter((record) => Boolean(record.address?.trim())).length,
      distinctGroupLayers: new Set(records.map((record) => record.groupLayer).filter(Boolean)).size,
      eesDirectoryRecords: eesLocations.length,
      eesConfirmedDestinationPins: eesLocations.filter((location) => location.hasConfirmedDestinationPin).length,
      classifications,
      approvedImports: records.filter((record) => approved.has(record.forthLocationId)).length
    },
    items,
    diameterNote: "Forth field เส้นผ่านศูนย์กลาง is preserved as diameterRaw only. Units are unverified and are not applied as geofence radii."
  };
}

export function buildForthImportApprovalPayload(item: ForthLocationReconcileItem) {
  if (!item.proposedDirectory) {
    throw new Error("This Forth record has no proposed Directory draft.");
  }
  if (item.classification === "MATCHED") {
    throw new Error("Matched Forth records should link, not create a new Directory row.");
  }
  if (item.classification === "MISSING_COORDINATES" || item.classification === "INVALID_COORDINATES") {
    throw new Error("Coordinates must be valid before approving an import draft.");
  }
  return {
    company_name: item.proposedDirectory.companyName,
    thai_name: item.proposedDirectory.thaiName,
    alternative_names: item.record.groupLayer ? [item.record.groupLayer] : [],
    address: item.proposedDirectory.address,
    province: null,
    destination_type: item.proposedDirectory.destinationType,
    google_maps_url: null,
    truck_entrance_url: null,
    verification_status: "needs_check" as const,
    notes: item.proposedDirectory.notes,
    source_info: item.proposedDirectory.sourceInfo,
    forth_location_id: item.record.forthLocationId,
    forth_latitude: item.record.latitude,
    forth_longitude: item.record.longitude,
    forth_diameter_raw: item.record.diameterRaw,
    create_confirmed_pin: false
  };
}
