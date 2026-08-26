export type BookingMapMatchStatus =
  | "ready"
  | "missing_pickup"
  | "missing_dropoff"
  | "ambiguous_location"
  | "conflicting_route"
  | "google_api_failure"
  | "suspicious_distance"
  | "protected_manual_value";

export type CanonicalLocationMatch = {
  id: string;
  displayName: string;
  normalizedName: string;
  fullGoogleAddress: string;
  googlePlaceId: string;
  latitude: number;
  longitude: number;
  countryCode: string | null;
};

export type ApprovedAlias = {
  canonicalLocationId: string;
  normalizedAlias: string;
  clientId: string | null;
  side?: "pickup" | "dropoff" | null;
};

const ALIAS_SIDE_SEPARATOR = "::";

export function scopedNormalizedAlias(
  alias: string,
  side: "pickup" | "dropoff"
) {
  return `${side}${ALIAS_SIDE_SEPARATOR}${normalizeBookingLocationName(alias)}`;
}

export function parseScopedNormalizedAlias(value: string) {
  const pickupPrefix = `pickup${ALIAS_SIDE_SEPARATOR}`;
  const dropoffPrefix = `dropoff${ALIAS_SIDE_SEPARATOR}`;
  if (value.startsWith(pickupPrefix)) {
    return { side: "pickup" as const, normalizedAlias: value.slice(pickupPrefix.length) };
  }
  if (value.startsWith(dropoffPrefix)) {
    return { side: "dropoff" as const, normalizedAlias: value.slice(dropoffPrefix.length) };
  }
  return { side: null, normalizedAlias: value };
}

export function partitionHistoricalBookings<T extends { booking_date: string }>(
  bookings: T[],
  cutoffDate: string
) {
  return bookings.reduce(
    (result, booking) => {
      if (booking.booking_date > cutoffDate) result.future.push(booking);
      else result.historical.push(booking);
      return result;
    },
    { historical: [] as T[], future: [] as T[] }
  );
}

export function countApprovedAliasImpact(
  bookings: Array<{
    clientId: string | null;
    pickup: string;
    dropoff: string;
  }>,
  alias: string,
  clientId: string | null,
  side?: "pickup" | "dropoff"
) {
  const normalizedAlias = normalizeBookingLocationName(alias);
  return bookings.filter(
    (booking) =>
      (!clientId || booking.clientId === clientId) &&
      (side
        ? normalizeBookingLocationName(side === "pickup" ? booking.pickup : booking.dropoff) === normalizedAlias
        : normalizeBookingLocationName(booking.pickup) === normalizedAlias ||
          normalizeBookingLocationName(booking.dropoff) === normalizedAlias)
  ).length;
}

export type HistoricalBookingMapInput = {
  id: string;
  clientId: string | null;
  pickup: string;
  dropoff: string;
  existingDistanceMeters: number | null;
  manuallyCorrected: boolean;
};

export type BookingMapMatch = {
  status: BookingMapMatchStatus;
  pickupLocation: CanonicalLocationMatch | null;
  dropoffLocation: CanonicalLocationMatch | null;
  reason: string | null;
  pickupIssue: BookingMapFieldIssue | null;
  dropoffIssue: BookingMapFieldIssue | null;
};

export type BookingMapFieldIssue = {
  status: "missing_pickup" | "missing_dropoff" | "ambiguous_location" | "protected_manual_value";
  reason: string;
};

const THAI_DIGITS = "๐๑๒๓๔๕๖๗๘๙";
const ASCII_DIGITS = "0123456789";

export function normalizeBookingLocationName(value: string | null | undefined) {
  let normalized = String(value ?? "").normalize("NFC").trim().toLocaleLowerCase("th-TH");
  for (let index = 0; index < THAI_DIGITS.length; index += 1) {
    normalized = normalized.replaceAll(THAI_DIGITS[index], ASCII_DIGITS[index]);
  }
  return normalized
    .replace(/[\u00a0\u200b\ufeff]/g, " ")
    .replace(/[.,/#!$%^&*;:{}=\-_`~()[\]"'<>?\\|+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function createAliasIndex(aliases: ApprovedAlias[]) {
  const index = new Map<string, Set<string>>();
  for (const alias of aliases) {
    const side = alias.side ?? "*";
    const key = `${alias.clientId ?? "*"}:${side}:${alias.normalizedAlias}`;
    const matches = index.get(key) ?? new Set<string>();
    matches.add(alias.canonicalLocationId);
    index.set(key, matches);
  }
  return index;
}

function resolveAlias(
  label: string,
  clientId: string | null,
  side: "pickup" | "dropoff",
  aliasIndex: Map<string, Set<string>>,
  locations: Map<string, CanonicalLocationMatch>
) {
  const normalized = normalizeBookingLocationName(label);
  if (!normalized) return { location: null, ambiguous: false };

  const clientMatches = clientId ? aliasIndex.get(`${clientId}:${side}:${normalized}`) : null;
  const clientLegacyMatches = clientId ? aliasIndex.get(`${clientId}:*:${normalized}`) : null;
  const globalMatches = aliasIndex.get(`*:${side}:${normalized}`);
  const globalLegacyMatches = aliasIndex.get(`*:*:${normalized}`);
  const matches = clientMatches?.size
    ? clientMatches
    : clientLegacyMatches?.size
      ? clientLegacyMatches
      : globalMatches?.size
        ? globalMatches
        : globalLegacyMatches;
  if (!matches?.size) return { location: null, ambiguous: false };
  if (matches.size !== 1) return { location: null, ambiguous: true };

  const [locationId] = matches;
  return { location: locations.get(locationId) ?? null, ambiguous: false };
}

export function matchHistoricalBooking(
  booking: HistoricalBookingMapInput,
  aliases: ApprovedAlias[],
  canonicalLocations: CanonicalLocationMatch[]
): BookingMapMatch {
  if (booking.manuallyCorrected) {
    return {
      status: "protected_manual_value",
      pickupLocation: null,
      dropoffLocation: null,
      reason: "Existing map values are marked as manually corrected.",
      pickupIssue: {
        status: "protected_manual_value",
        reason: `Pickup "${booking.pickup}" is protected because its map values were manually corrected.`
      },
      dropoffIssue: {
        status: "protected_manual_value",
        reason: `Drop-off "${booking.dropoff}" is protected because its map values were manually corrected.`
      }
    };
  }

  const aliasIndex = createAliasIndex(aliases);
  const locations = new Map(canonicalLocations.map((location) => [location.id, location]));
  const pickup = resolveAlias(booking.pickup, booking.clientId, "pickup", aliasIndex, locations);
  const dropoff = resolveAlias(booking.dropoff, booking.clientId, "dropoff", aliasIndex, locations);

  if (pickup.ambiguous || dropoff.ambiguous) {
    return {
      status: "ambiguous_location",
      pickupLocation: pickup.location,
      dropoffLocation: dropoff.location,
      reason: "More than one approved location matches this label and client scope.",
      pickupIssue: pickup.ambiguous
        ? { status: "ambiguous_location", reason: `More than one approved location matches pickup "${booking.pickup}" and this client scope.` }
        : !pickup.location
          ? { status: "missing_pickup", reason: `No approved alias matches pickup "${booking.pickup}".` }
          : null,
      dropoffIssue: dropoff.ambiguous
        ? { status: "ambiguous_location", reason: `More than one approved location matches drop-off "${booking.dropoff}" and this client scope.` }
        : !dropoff.location
          ? { status: "missing_dropoff", reason: `No approved alias matches drop-off "${booking.dropoff}".` }
          : null
    };
  }
  if (!pickup.location) {
    return {
      status: "missing_pickup",
      pickupLocation: null,
      dropoffLocation: dropoff.location,
      reason: `No approved alias matches pickup "${booking.pickup}".`,
      pickupIssue: { status: "missing_pickup", reason: `No approved alias matches pickup "${booking.pickup}".` },
      dropoffIssue: !dropoff.location
        ? { status: "missing_dropoff", reason: `No approved alias matches drop-off "${booking.dropoff}".` }
        : null
    };
  }
  if (!dropoff.location) {
    return {
      status: "missing_dropoff",
      pickupLocation: pickup.location,
      dropoffLocation: null,
      reason: `No approved alias matches drop-off "${booking.dropoff}".`,
      pickupIssue: null,
      dropoffIssue: { status: "missing_dropoff", reason: `No approved alias matches drop-off "${booking.dropoff}".` }
    };
  }

  return {
    status: "ready",
    pickupLocation: pickup.location,
    dropoffLocation: dropoff.location,
    reason: null,
    pickupIssue: null,
    dropoffIssue: null
  };
}

export function canonicalRouteKey(
  pickupLocationId: string,
  dropoffLocationId: string,
  routingPreference = "TRAFFIC_AWARE_OPTIMAL"
) {
  return `${pickupLocationId}:${dropoffLocationId}:${routingPreference}`;
}

export function isSuspiciousRouteDistance(input: {
  distanceMeters: number;
  existingDistanceMeters?: number | null;
  pickupEqualsDropoff?: boolean;
}) {
  const reasons: string[] = [];
  if (!Number.isFinite(input.distanceMeters) || input.distanceMeters <= 0) {
    reasons.push("Route distance is missing or invalid.");
  }
  if (input.distanceMeters > 1_500_000) {
    reasons.push("Route exceeds 1,500 km and requires manual review.");
  }
  if (input.pickupEqualsDropoff && input.distanceMeters > 25_000) {
    reasons.push("Same-location route exceeds 25 km.");
  }
  if (
    input.existingDistanceMeters &&
    input.existingDistanceMeters > 0 &&
    Math.max(input.distanceMeters, input.existingDistanceMeters) /
      Math.min(input.distanceMeters, input.existingDistanceMeters) >=
      2.5
  ) {
    reasons.push("Calculated distance differs from the existing value by at least 2.5x.");
  }
  return reasons;
}

export function createDryRunIdempotencyKey(batchId: string, bookingId: string) {
  return `${batchId}:${bookingId}`;
}

export function nextResumableBatch<T extends { id: string }>(
  rows: T[],
  cursorId: string | null,
  batchSize: number
) {
  const safeSize = Math.max(1, Math.floor(batchSize));
  const startIndex = cursorId
    ? Math.max(0, rows.findIndex((row) => row.id === cursorId) + 1)
    : 0;
  const items = rows.slice(startIndex, startIndex + safeSize);
  return {
    items,
    nextCursor: items.at(-1)?.id ?? cursorId,
    complete: startIndex + items.length >= rows.length
  };
}

export function mergeWithoutManualOverwrite(
  original: Record<string, unknown>,
  proposed: Record<string, unknown>,
  protectedKeys: string[]
) {
  const merged = { ...original };
  for (const [key, value] of Object.entries(proposed)) {
    if (protectedKeys.includes(key) && original[key] != null && original[key] !== "") continue;
    merged[key] = value;
  }
  return merged;
}

export function rollbackMapValues(beforeValues: Record<string, unknown>) {
  return { ...beforeValues };
}
