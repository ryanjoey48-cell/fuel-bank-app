import type { LocationPinType } from "@/lib/locations-directory";

export type GeocodeLocation = {
  company_name: string;
  thai_name?: string | null;
  alternative_names?: string[] | null;
  address: string;
  province?: string | null;
};

export type GeoapifyCandidate = {
  id: string;
  placeId: string | null;
  name: string;
  formattedAddress: string;
  latitude: number;
  longitude: number;
  resultType: "amenity" | "building";
  confidence: number;
  attribution: string;
  license: string | null;
  dataSource: string | null;
};

export type SmartPinState = {
  stage: "idle" | "searching" | "choosing" | "not_found" | "lookup_error" | "saving" | "save_error" | "saved";
  candidates: Array<GeoapifyCandidate & { confirmationToken: string }>;
  selectedId: string;
  error: "lookup" | "rate_limit" | "save" | "";
};

export type SmartPinAction =
  | { type: "lookup_started" }
  | { type: "lookup_succeeded"; candidates: SmartPinState["candidates"] }
  | { type: "lookup_failed"; reason: "lookup" | "rate_limit" }
  | { type: "selected"; id: string }
  | { type: "save_started" }
  | { type: "save_failed" }
  | { type: "save_succeeded" }
  | { type: "reset" };

export const initialSmartPinState: SmartPinState = {
  stage: "idle",
  candidates: [],
  selectedId: "",
  error: ""
};

export function smartPinReducer(state: SmartPinState, action: SmartPinAction): SmartPinState {
  switch (action.type) {
    case "lookup_started":
      return { ...initialSmartPinState, stage: "searching" };
    case "lookup_succeeded":
      return {
        stage: action.candidates.length ? "choosing" : "not_found",
        candidates: action.candidates,
        selectedId: "",
        error: ""
      };
    case "lookup_failed":
      return { ...initialSmartPinState, stage: "lookup_error", error: action.reason };
    case "selected":
      return state.stage === "choosing" && state.candidates.some((candidate) => candidate.id === action.id)
        ? { ...state, selectedId: action.id, error: "" }
        : state;
    case "save_started":
      return state.stage === "choosing" && state.selectedId ? { ...state, stage: "saving", error: "" } : state;
    case "save_failed":
      return { ...state, stage: "save_error", error: "save" };
    case "save_succeeded":
      return { ...state, stage: "saved", error: "" };
    case "reset":
      return initialSmartPinState;
  }
}

export function buildGeoapifyQuery(location: GeocodeLocation) {
  const values = [
    location.company_name,
    location.thai_name,
    ...(location.alternative_names ?? []),
    location.address,
    location.province,
    "Thailand"
  ].map((value) => String(value ?? "").trim().replace(/\s+/g, " ")).filter(Boolean);
  return [...new Set(values)].join(", ").slice(0, 1200);
}

function cleanString(value: unknown, maxLength = 300): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maxLength) : "";
}

function normalized(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function numeric(value: unknown): number | null {
  const result = typeof value === "number" ? value : Number(value);
  return Number.isFinite(result) ? result : null;
}

function hasAddressEvidence(location: GeocodeLocation, properties: Record<string, unknown>) {
  const candidateAddress = normalized([
    cleanString(properties.formatted, 500),
    cleanString(properties.address_line1, 200),
    cleanString(properties.address_line2, 200),
    cleanString(properties.street, 200),
    cleanString(properties.housenumber, 30),
    cleanString(properties.postcode, 20),
    cleanString(properties.state, 100),
    cleanString(properties.county, 100),
    cleanString(properties.city, 100)
  ].join(" "));
  const targetPostcodes: string[] = location.address.match(/\b\d{5}\b/g) ?? [];
  const resultPostcode = cleanString(properties.postcode, 20);
  if (resultPostcode && targetPostcodes.includes(resultPostcode)) return true;

  const targetHouseNumbers: string[] = location.address.match(/\b\d{1,5}(?:\/\d{1,5})?[A-Za-z]?\b/g) ?? [];
  const candidateHouseNumber = cleanString(properties.housenumber, 30);
  if (candidateHouseNumber && targetHouseNumbers.includes(candidateHouseNumber)) return true;
  if (targetHouseNumbers.some((part) => part.length >= 2 && candidateAddress.includes(normalized(part)))) return true;

  const targetPieces = location.address.split(/[\n,;|]+/).map((part) => part.trim()).filter((part) => part.length >= 7);
  return targetPieces.some((part) => {
    const partKey = normalized(part);
    return partKey.length >= 7 && candidateAddress.includes(partKey);
  });
}

function hasProvinceEvidence(location: GeocodeLocation, properties: Record<string, unknown>) {
  const province = normalized(cleanString(location.province, 100));
  if (province.length < 3) return false;
  const returnedAreas = [properties.state, properties.county, properties.city]
    .map((value) => normalized(cleanString(value, 100)))
    .filter((value) => value.length >= 3);
  return returnedAreas.some((area) => area === province || area.includes(province) || province.includes(area));
}

function hasConflictingProvince(location: GeocodeLocation, properties: Record<string, unknown>) {
  const expectedText = cleanString(location.province, 100);
  const returnedText = cleanString(properties.state, 100);
  const expectedProvince = normalized(expectedText);
  const returnedProvince = normalized(returnedText);
  // Geoapify can localize the returned province based on the selected UI language.
  // Compare only when both values use the same script to avoid rejecting Thai/English equivalents.
  if (/\p{Script=Latin}/u.test(expectedText) !== /\p{Script=Latin}/u.test(returnedText)) return false;
  return expectedProvince.length >= 3 && returnedProvince.length >= 3
    && !expectedProvince.includes(returnedProvince)
    && !returnedProvince.includes(expectedProvince);
}

function hasExactPlaceName(location: GeocodeLocation, properties: Record<string, unknown>) {
  const expectedNames = [location.company_name, location.thai_name, ...(location.alternative_names ?? [])]
    .map((name) => normalized(cleanString(name, 200)))
    .filter((name) => name.length >= 4);
  const returnedNames = [cleanString(properties.name, 200), cleanString(properties.address_line1, 200)]
    .map(normalized)
    .filter((name) => name.length >= 4);
  return expectedNames.some((expected) => returnedNames.some((returned) => returned === expected || returned.includes(expected)));
}

/** Keep only Thailand amenity/building results with provider confidence and a stored-name or address match.
 * City, district, postcode, and street-centre results are intentionally excluded.
 */
export function filterReliableGeoapifyResults(raw: unknown, location: GeocodeLocation): GeoapifyCandidate[] {
  const response = record(raw);
  const sourceResults = Array.isArray(response.results)
    ? response.results
    : Array.isArray(response.features)
      ? response.features.map((feature) => record(feature).properties)
      : [];
  const candidates: GeoapifyCandidate[] = [];
  const seen = new Set<string>();

  for (const item of sourceResults) {
    const properties = record(item);
    const latitude = numeric(properties.lat);
    const longitude = numeric(properties.lon);
    const countryCode = cleanString(properties.country_code, 4).toLowerCase();
    const resultType = cleanString(properties.result_type, 40);
    const rank = record(properties.rank);
    const confidence = numeric(rank.confidence) ?? 0;
    const buildingConfidence = numeric(rank.confidence_building_level) ?? 0;
    if (latitude === null || longitude === null || countryCode !== "th") continue;
    if (latitude < 5.2 || latitude > 20.7 || longitude < 97.2 || longitude > 105.9) continue;
    if (resultType !== "amenity" && resultType !== "building") continue;
    if (hasConflictingProvince(location, properties)) continue;

    const exactName = hasExactPlaceName(location, properties);
    const addressEvidence = hasAddressEvidence(location, properties);
    if (resultType === "amenity" && (confidence < 0.7 || !exactName || (!addressEvidence && !hasProvinceEvidence(location, properties)))) continue;
    if (resultType === "building" && (buildingConfidence < 0.7 || !addressEvidence)) continue;

    const placeId = cleanString(properties.place_id, 200) || null;
    const id = placeId ?? `${latitude.toFixed(6)}:${longitude.toFixed(6)}`;
    if (seen.has(id)) continue;
    seen.add(id);

    const datasource = record(properties.datasource);
    candidates.push({
      id,
      placeId,
      name: cleanString(properties.name, 200) || cleanString(properties.address_line1, 200) || cleanString(properties.formatted, 300),
      formattedAddress: cleanString(properties.formatted, 500),
      latitude,
      longitude,
      resultType,
      confidence,
      attribution: cleanString(datasource.attribution, 500) || "© OpenStreetMap contributors",
      license: cleanString(datasource.license, 200) || null,
      dataSource: cleanString(datasource.sourcename, 200) || null
    });
  }

  return candidates.slice(0, 5);
}

export function isLocationPinType(value: unknown): value is LocationPinType {
  return value === "destination" || value === "truck_entrance";
}
