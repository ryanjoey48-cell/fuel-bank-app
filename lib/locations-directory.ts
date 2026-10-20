export type LocationsLanguage = "en" | "th";
export type LocationListFilter = "all" | "favourites" | "recent";
export type LocationActivity = { is_favourite: boolean; last_used_at: string | null };

export type SearchableLocation = {
  company_name: string;
  thai_name?: string | null;
  alternative_names?: readonly string[] | null;
  address: string;
  province?: string | null;
  destination_type?: string | null;
  notes?: string | null;
  source_info?: string | null;
};

export type DirectoryLocationProjection<T extends SearchableLocation> = T & {
  dispatch_restriction: string | null;
};

export type LocationFormInput = {
  company_name: string;
  address: string;
  google_maps_url?: string | null;
  truck_entrance_url?: string | null;
  verification_status?: string | null;
  verification_evidence?: string | null;
};

export type LocationFormError =
  | "companyName"
  | "address"
  | "googleMapsUrl"
  | "truckEntranceUrl"
  | "verificationEvidence";

const GOOGLE_MAPS_HOST = /^(maps\.google\.com|(?:www\.)?google\.(?:com|[a-z]{2,3}|co\.[a-z]{2}))$/i;
const DISPATCH_RESTRICTION = /do\s+not\s+dispatch|do\s+not\s+send\s+(?:a\s+)?truck|no\s+dispatch|not\s+for\s+dispatch|ห้ามจัดส่ง|ห้ามส่งรถ|ห้ามใช้สำหรับจัดส่ง/i;

/** Returns a canonical Google Maps URL, or null when the value is not safe to open. */
export function safeGoogleMapsUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim() || value.length > 2048) return null;

  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== "https:" ||
      !GOOGLE_MAPS_HOST.test(url.hostname) ||
      url.pathname.startsWith("/maps") === false ||
      url.username !== "" ||
      url.password !== "" ||
      url.port !== ""
    ) return null;

    return url.toString();
  } catch {
    return null;
  }
}

/** Builds a correctly encoded Maps search URL without making a network request. */
export function buildGoogleMapsSearchUrl(address: string): string | null {
  const query = address.trim();
  if (!query) return null;

  const url = new URL("https://www.google.com/maps/search/");
  url.searchParams.set("api", "1");
  url.searchParams.set("query", query);
  return url.toString();
}

export function getLocationMapUrl(location: Pick<SearchableLocation, "address"> & { google_maps_url?: string | null }): string | null {
  return safeGoogleMapsUrl(location.google_maps_url) ?? buildGoogleMapsSearchUrl(location.address);
}

export function getLocationDisplayName(location: SearchableLocation, language: LocationsLanguage): string {
  if (language === "th" && location.thai_name?.trim()) return location.thai_name.trim();
  return location.company_name;
}

export function matchesLocationSearch(
  location: SearchableLocation,
  query: string,
  language: LocationsLanguage,
  translatedCategoryTerms: readonly string[] = []
): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase(language === "th" ? "th-TH" : "en-US");
  if (!normalizedQuery) return true;

  const searchableValues = [
    location.company_name,
    location.thai_name,
    ...(location.alternative_names ?? []),
    location.address,
    location.province,
    location.destination_type,
    ...translatedCategoryTerms
  ];
  const searchableText = searchableValues
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ")
    .toLocaleLowerCase(language === "th" ? "th-TH" : "en-US");

  return searchableText.includes(normalizedQuery);
}

export function matchesLocationFilter(filter: LocationListFilter, activity: LocationActivity | undefined): boolean {
  if (filter === "favourites") return activity?.is_favourite === true;
  if (filter === "recent") return Boolean(activity?.last_used_at);
  return true;
}

export function getDispatchRestriction(location: Pick<SearchableLocation, "notes" | "source_info">): string | null {
  const lines = [location.notes, location.source_info]
    .filter((value): value is string => typeof value === "string")
    .flatMap((value) => value.split(/\r?\n/));

  const restriction = lines.find((line) => DISPATCH_RESTRICTION.test(line))?.trim();
  if (!restriction) return null;

  const concise = restriction
    .replace(/^(?:workbook status|verification note):\s*/i, "")
    .replace(/^needs verification\s*[—-]\s*/i, "");
  return concise.length > 220 ? `${concise.slice(0, 217).trimEnd()}…` : concise;
}

/** Keep dispatch warnings available while limiting internal notes and sources to admins. */
export function projectLocationForDirectory<T extends SearchableLocation>(location: T, includeInternal: boolean): DirectoryLocationProjection<T> {
  return {
    ...location,
    notes: includeInternal ? location.notes ?? null : null,
    source_info: includeInternal ? location.source_info ?? null : null,
    dispatch_restriction: getDispatchRestriction(location)
  };
}

export function validateLocationForm(input: LocationFormInput): LocationFormError[] {
  const errors: LocationFormError[] = [];

  if (!input.company_name.trim()) errors.push("companyName");
  if (!input.address.trim()) errors.push("address");
  if (input.google_maps_url?.trim() && !safeGoogleMapsUrl(input.google_maps_url)) errors.push("googleMapsUrl");
  if (input.truck_entrance_url?.trim() && !safeGoogleMapsUrl(input.truck_entrance_url)) errors.push("truckEntranceUrl");
  if (input.verification_status === "verified" && !input.verification_evidence?.trim()) errors.push("verificationEvidence");

  return errors;
}

export function parseAlternativeNames(value: string): string[] {
  return [...new Set(value.split(/[\n,;]/).map((name) => name.trim()).filter(Boolean))];
}
