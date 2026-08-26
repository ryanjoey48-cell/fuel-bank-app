import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import {
  canonicalRouteKey,
  countApprovedAliasImpact,
  createDryRunIdempotencyKey,
  isSuspiciousRouteDistance,
  matchHistoricalBooking,
  nextResumableBatch,
  normalizeBookingLocationName,
  parseScopedNormalizedAlias,
  partitionHistoricalBookings,
  scopedNormalizedAlias,
  type ApprovedAlias,
  type CanonicalLocationMatch,
  type HistoricalBookingMapInput
} from "@/lib/booking-maps-backfill";
import { AdminApiError } from "@/lib/admin-user-management-server";
import {
  bookingCheckStatus,
  canonicalToBookingCheckLocation,
  clientNameSimilarity,
  createBookingCheckReview,
  matchingBookingIds,
  type BookingCheckLocationValue,
  type BookingCheckReview
} from "@/lib/booking-map-check";
import {
  approvalScopeCount,
  buildLocationReviewSnapshot,
  locationIssueGroupKey,
  locationReviewSnapshotReconciles,
  occurrencesForLocationIssue,
  recommendApprovalScope,
  summarizeLocationEvidence,
  type LocationReviewOccurrence
} from "@/lib/booking-location-review";
import { getServerGoogleMapsApiKey } from "@/lib/google-maps";
import {
  getRememberedVerifiedGooglePlace,
  rememberVerifiedGooglePlace
} from "@/lib/google-place-verification";
import {
  parseGoogleDurationSeconds,
  selectRouteWithFallback,
  type GoogleComputedRoute
} from "@/lib/route-planning";

type BookingRow = {
  id: string;
  booking_id: string | null;
  job_order_number: string | null;
  warehouse_no: string | null;
  booking_date: string;
  client_id: string | null;
  pickup: string;
  dropoff: string;
  pickup_location_id: string | null;
  dropoff_location_id: string | null;
  pickup_place_id: string | null;
  dropoff_place_id: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
  route_distance_meters: number | null;
  route_duration_seconds: number | null;
  estimated_distance_km: number | null;
  google_maps_route_url: string | null;
  map_resolution_status: string | null;
  map_values_manually_corrected: boolean | null;
  client: { id: string; name: string } | null;
};

type CanonicalRow = {
  id: string;
  display_name: string;
  normalized_name: string;
  full_google_address: string;
  google_place_id: string;
  latitude: number;
  longitude: number;
  country_code: string | null;
  approval_status: string;
};

type AliasRow = {
  id: string;
  canonical_location_id: string;
  client_id: string | null;
  alias: string;
  normalized_alias: string;
  approval_status: string;
};

export class BookingMapsStaleCountError extends AdminApiError {
  readonly currentAffectedCount: number;
  readonly cutoffDate: string;

  constructor(expectedAffectedCount: number, currentAffectedCount: number, cutoffDate: string) {
    super(
      409,
      `Affected booking count changed from ${expectedAffectedCount} to ${currentAffectedCount}. Review the updated count before approving.`
    );
    this.currentAffectedCount = currentAffectedCount;
    this.cutoffDate = cutoffDate;
  }
}

export class BookingMapsStaleSnapshotError extends AdminApiError {
  constructor(readonly snapshot: Awaited<ReturnType<typeof getLocationReviewSnapshot>>) {
    super(409, "The location review data changed. Review the updated snapshot before approving.");
  }
}

type RouteCacheRow = {
  id: string;
  pickup_location_id: string;
  dropoff_location_id: string;
  routing_preference: string;
  distance_meters: number;
  duration_seconds: number;
  static_duration_seconds: number | null;
  google_maps_route_url: string;
  route_label: string | null;
  route_description: string | null;
  encoded_polyline: string | null;
  traffic_aware: boolean;
  fallback_info: Record<string, unknown> | null;
  calculated_at: string;
};

type GooglePlaceDetails = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  addressComponents?: Array<{ shortText?: string; types?: string[] }>;
  error?: { message?: string; status?: string };
};

type RouteResponse = {
  routes?: GoogleComputedRoute[];
  fallbackInfo?: Record<string, unknown>;
  error?: { message?: string; status?: string };
};

const BOOKING_SELECT = [
  "id",
  "booking_id",
  "job_order_number",
  "warehouse_no",
  "booking_date",
  "client_id",
  "pickup",
  "dropoff",
  "pickup_location_id",
  "dropoff_location_id",
  "pickup_place_id",
  "dropoff_place_id",
  "pickup_address",
  "dropoff_address",
  "pickup_lat",
  "pickup_lng",
  "dropoff_lat",
  "dropoff_lng",
  "route_distance_meters",
  "route_duration_seconds",
  "estimated_distance_km",
  "google_maps_route_url",
  "map_resolution_status",
  "map_values_manually_corrected",
  "client:clients(id,name)"
].join(",");

const ROUTE_FIELD_MASK = [
  "routes.distanceMeters",
  "routes.duration",
  "routes.staticDuration",
  "routes.routeLabels",
  "routes.description",
  "routes.polyline.encodedPolyline",
  "fallbackInfo"
].join(",");

function isSetupError(error: { code?: string; message?: string } | null) {
  const message = String(error?.message ?? "").toLowerCase();
  return (
    error?.code === "42P01" ||
    error?.code === "42703" ||
    error?.code === "PGRST204" ||
    error?.code === "PGRST205" ||
    message.includes("canonical_locations") ||
    message.includes("map_resolution_status")
  );
}

function assertQuery(error: { code?: string; message?: string } | null, fallback: string) {
  if (!error) return;
  if (isSetupError(error)) {
    throw new AdminApiError(
      503,
      "Booking Maps setup required. Apply migration 20260731_booking_maps_backfill.sql."
    );
  }
  throw new AdminApiError(500, error.message || fallback);
}

async function fetchAllBookings(admin: SupabaseClient) {
  const rows: BookingRow[] = [];
  const pageSize = 500;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await admin
      .from("booking_diary")
      .select(BOOKING_SELECT)
      .order("booking_date", { ascending: false })
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    assertQuery(error, "Unable to load Booking Diary map data.");
    const page = (data ?? []) as unknown as BookingRow[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

function currentBangkokDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

async function fetchHistoricalBookings(admin: SupabaseClient) {
  const allBookings = await fetchAllBookings(admin);
  const cutoffDate = currentBangkokDate();
  const partition = partitionHistoricalBookings(allBookings, cutoffDate);
  return { ...partition, cutoffDate };
}

function snapshotRow(booking: BookingRow) {
  return {
    id: booking.id,
    bookingDate: booking.booking_date,
    clientId: booking.client_id,
    clientName: booking.client?.name ?? "Unknown client",
    pickup: booking.pickup,
    dropoff: booking.dropoff
  };
}

export async function getLocationReviewSnapshot(
  admin: SupabaseClient,
  input: { name: string; side: "pickup" | "dropoff" }
) {
  const bookings = await fetchAllBookings(admin);
  const cutoffDate = currentBangkokDate();
  const snapshot = buildLocationReviewSnapshot(bookings.map(snapshotRow), {
    name: input.name,
    side: input.side,
    cutoffDate
  });
  if (!locationReviewSnapshotReconciles(snapshot)) {
    throw new AdminApiError(
      409,
      "Location review counts do not reconcile. Approval is blocked until the audit snapshot is regenerated."
    );
  }
  const snapshotVersion = createHash("sha256")
    .update(JSON.stringify({
      normalizedName: snapshot.normalizedName,
      side: snapshot.side,
      cutoffDate: snapshot.cutoffDate,
      bookingIds: snapshot.bookingIds,
      clients: snapshot.clients.map((client) => [client.key, client.count]),
      routes: snapshot.routes.map((route) => [route.key, route.count])
    }))
    .digest("hex");
  return {
    ...snapshot,
    snapshotVersion,
    generatedAt: new Date().toISOString()
  };
}

async function fetchDirectory(admin: SupabaseClient) {
  const [locationsResult, aliasesResult] = await Promise.all([
    admin
      .from("canonical_locations")
      .select("id,display_name,normalized_name,full_google_address,google_place_id,latitude,longitude,country_code,approval_status")
      .eq("approval_status", "approved"),
    admin
      .from("canonical_location_aliases")
      .select("id,canonical_location_id,client_id,alias,normalized_alias,approval_status")
      .eq("approval_status", "approved")
  ]);
  assertQuery(locationsResult.error, "Unable to load canonical locations.");
  assertQuery(aliasesResult.error, "Unable to load canonical aliases.");

  const locations = (locationsResult.data ?? []) as CanonicalRow[];
  const aliases = (aliasesResult.data ?? []) as AliasRow[];
  return {
    locationRows: locations,
    aliasRows: aliases,
    locations: locations.map((row) => ({
      id: row.id,
      displayName: row.display_name,
      normalizedName: row.normalized_name,
      fullGoogleAddress: row.full_google_address,
      googlePlaceId: row.google_place_id,
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
      countryCode: row.country_code
    })) satisfies CanonicalLocationMatch[],
    aliases: aliases.map((row) => {
      const parsed = parseScopedNormalizedAlias(row.normalized_alias);
      return {
        canonicalLocationId: row.canonical_location_id,
        normalizedAlias: parsed.normalizedAlias,
        clientId: row.client_id,
        side: parsed.side
      };
    }) satisfies ApprovedAlias[]
  };
}

async function fetchLocationReviewConfirmations(admin: SupabaseClient) {
  const confirmed = new Set<string>();
  const { data: batch, error: batchError } = await admin
    .from("booking_map_backfill_batches")
    .select("id")
    .eq("dry_run", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  assertQuery(batchError, "Unable to load location review progress.");
  if (!batch?.id) return confirmed;
  for (let from = 0; ; from += 500) {
    const { data, error } = await admin
      .from("booking_map_backfill_items")
      .select("booking_id,proposed_values")
      .eq("batch_id", batch.id)
      .range(from, from + 499);
    assertQuery(error, "Unable to load location review proposals.");
    const rows = (data ?? []) as Array<{ booking_id: string; proposed_values: Record<string, unknown> | null }>;
    for (const row of rows) {
      const review = row.proposed_values?.location_review as Record<string, unknown> | undefined;
      if (review?.pickup) confirmed.add(`${row.booking_id}:pickup`);
      if (review?.dropoff) confirmed.add(`${row.booking_id}:dropoff`);
    }
    if (rows.length < 500) break;
  }
  return confirmed;
}

function bookingMatchInput(booking: BookingRow): HistoricalBookingMapInput {
  return {
    id: booking.id,
    clientId: booking.client_id,
    pickup: booking.pickup,
    dropoff: booking.dropoff,
    existingDistanceMeters:
      booking.route_distance_meters ??
      (booking.estimated_distance_km != null
        ? Number(booking.estimated_distance_km) * 1000
        : null),
    manuallyCorrected: booking.map_values_manually_corrected === true
  };
}

function groupKey(parts: Array<string | null | undefined>) {
  return parts.map((part) => part || "-").join("::");
}

function addCount<T extends { affectedBookingCount: number }>(
  map: Map<string, T>,
  key: string,
  factory: () => T
) {
  const current = map.get(key) ?? factory();
  current.affectedBookingCount += 1;
  map.set(key, current);
}

export async function buildBookingMapsAudit(admin: SupabaseClient) {
  const [bookingPartition, directory, reviewConfirmations] = await Promise.all([
    fetchHistoricalBookings(admin),
    fetchDirectory(admin),
    fetchLocationReviewConfirmations(admin)
  ]);
  const bookings = bookingPartition.historical;
  const locations = new Map<string, {
    label: string;
    normalizedLabel: string;
    clientId: string | null;
    clientName: string;
    side: "pickup" | "dropoff";
    status: string;
    reason: string;
    bookingIds: Set<string>;
  }>();
  const routes = new Map<string, {
    pickup: string;
    dropoff: string;
    clientName: string;
    status: string;
    reason: string | null;
    affectedBookingCount: number;
    existingDistancesKm: number[];
  }>();
  const summary = {
    totalBookings: bookings.length,
    completed: 0,
    readyToBackfill: 0,
    missingPickup: 0,
    missingDropoff: 0,
    ambiguousLocation: 0,
    conflictingRoute: 0,
    googleApiFailure: 0,
    suspiciousDistance: 0,
    protectedManualValue: 0,
    futureBookingsExcluded: bookingPartition.future.length
  };

  for (const booking of bookings) {
    const match = matchHistoricalBooking(
      bookingMatchInput(booking),
      directory.aliases,
      directory.locations
    );
    const completed =
      booking.map_resolution_status === "resolved" &&
      Boolean(booking.pickup_location_id && booking.dropoff_location_id) &&
      Number(booking.route_distance_meters) > 0 &&
      Number(booking.route_duration_seconds) > 0;
    if (completed) summary.completed += 1;
    else if (match.status === "ambiguous_location") summary.ambiguousLocation += 1;
    else if (match.status === "protected_manual_value") summary.protectedManualValue += 1;
    else {
      const pickupResolved = Boolean(match.pickupLocation) || reviewConfirmations.has(`${booking.id}:pickup`);
      const dropoffResolved = Boolean(match.dropoffLocation) || reviewConfirmations.has(`${booking.id}:dropoff`);
      if (pickupResolved && dropoffResolved) summary.readyToBackfill += 1;
      if (!pickupResolved) summary.missingPickup += 1;
      if (!dropoffResolved) summary.missingDropoff += 1;
    }

    const recordLocationIssue = (
      side: "pickup" | "dropoff",
      label: string,
      issue: NonNullable<typeof match.pickupIssue>
    ) => {
      const key = locationIssueGroupKey(side, label);
      const current = locations.get(key);
      if (current) {
        current.bookingIds.add(booking.id);
        if (current.clientId !== booking.client_id) {
          current.clientId = null;
          current.clientName = "Multiple clients";
        }
        if (issue.status === "ambiguous_location") {
          current.status = issue.status;
          current.reason = issue.reason;
        }
        locations.set(key, current);
        return;
      }
      locations.set(key, {
        label,
        normalizedLabel: normalizeBookingLocationName(label),
        clientId: booking.client_id,
        clientName: booking.client?.name ?? "Unknown client",
        side,
        status: issue.status,
        reason: issue.reason,
        bookingIds: new Set([booking.id])
      });
    };
    if (match.pickupIssue && !reviewConfirmations.has(`${booking.id}:pickup`)) {
      recordLocationIssue(
        "pickup",
        booking.pickup,
        match.pickupIssue
      );
    }
    if (match.dropoffIssue && !reviewConfirmations.has(`${booking.id}:dropoff`)) {
      recordLocationIssue(
        "dropoff",
        booking.dropoff,
        match.dropoffIssue
      );
    }

    const routeKey = groupKey([
      booking.client_id,
      normalizeBookingLocationName(booking.pickup),
      normalizeBookingLocationName(booking.dropoff)
    ]);
    const route = routes.get(routeKey) ?? {
      pickup: booking.pickup,
      dropoff: booking.dropoff,
      clientName: booking.client?.name ?? "Unknown client",
      status: completed ? "completed" : match.status,
      reason: match.reason,
      affectedBookingCount: 0,
      existingDistancesKm: []
    };
    route.affectedBookingCount += 1;
    const existingKm =
      booking.route_distance_meters != null
        ? Number(booking.route_distance_meters) / 1000
        : Number(booking.estimated_distance_km);
    if (Number.isFinite(existingKm) && existingKm > 0) route.existingDistancesKm.push(existingKm);
    const uniqueRounded = new Set(route.existingDistancesKm.map((value) => Math.round(value * 10) / 10));
    if (uniqueRounded.size > 1) {
      route.status = "conflicting_route";
      route.reason = `Existing records contain ${uniqueRounded.size} different distances.`;
    }
    routes.set(routeKey, route);
  }

  summary.conflictingRoute = [...routes.values()].reduce(
    (total, route) => total + (route.status === "conflicting_route" ? route.affectedBookingCount : 0),
    0
  );

  const allOccurrences: LocationReviewOccurrence[] = bookings.flatMap((booking) => {
    const common = {
      bookingId: booking.id,
      bookingReference: booking.booking_id,
      bookingDate: booking.booking_date,
      clientId: booking.client_id,
      clientName: booking.client?.name ?? "Unknown client",
      pickup: booking.pickup,
      dropoff: booking.dropoff,
      routeUrl: booking.google_maps_route_url
    };
    return [
      { ...common, side: "pickup" as const, placeId: booking.pickup_place_id, address: booking.pickup_address },
      { ...common, side: "dropoff" as const, placeId: booking.dropoff_place_id, address: booking.dropoff_address }
    ];
  });
  const locationReviewItems = [...locations.values()].map(({ bookingIds, ...location }) => {
    const normalizedLabel = normalizeBookingLocationName(location.label);
    const occurrences = occurrencesForLocationIssue(allOccurrences, {
      side: location.side,
      label: location.label,
      bookingIds
    });
    const aliasOccurrences = allOccurrences.filter((row) => {
      if (row.side !== location.side) return false;
      const value = row.side === "pickup" ? row.pickup : row.dropoff;
      return normalizeBookingLocationName(value) === normalizedLabel;
    });
    const recommendation = summarizeLocationEvidence(location.label, occurrences);
    const exampleBookingId = occurrences[0]?.bookingId ?? null;
    const clientContextMap = new Map<string, {
      clientId: string | null;
      clientName: string;
      bookingIds: Set<string>;
    }>();
    for (const row of aliasOccurrences) {
      const clientKey = row.clientId ?? "unknown";
      const context = clientContextMap.get(clientKey) ?? {
        clientId: row.clientId,
        clientName: row.clientName,
        bookingIds: new Set<string>()
      };
      context.bookingIds.add(row.bookingId);
      clientContextMap.set(clientKey, context);
    }
    const clientContexts = [...clientContextMap.values()]
      .map((context) => ({
        clientId: context.clientId,
        clientName: context.clientName,
        count: context.bookingIds.size
      }))
      .sort((a, b) => b.count - a.count || a.clientName.localeCompare(b.clientName));
    const recommendedScope = clientContexts.length > 1
      ? (clientContexts.some((context) => context.clientId) ? "client" : "booking")
      : recommendApprovalScope(location.label, clientContexts[0]?.clientId ?? null);
    return {
      ...location,
      affectedBookingCount: approvalScopeCount(aliasOccurrences, "global"),
      examples: [...occurrences]
        .sort((a, b) => b.bookingDate.localeCompare(a.bookingDate))
        .filter((row, index, rows) => rows.findIndex((candidate) => candidate.bookingId === row.bookingId) === index)
        .slice(0, 5),
      recommendation,
      clientContexts,
      recommendedScope,
      scopeCounts: {
        global: approvalScopeCount(aliasOccurrences, "global"),
        client: clientContexts.find((context) => context.clientId)
          ? approvalScopeCount(aliasOccurrences, "client", clientContexts.find((context) => context.clientId)?.clientId)
          : 0,
        booking: exampleBookingId
          ? approvalScopeCount(occurrences, "booking", null, exampleBookingId)
          : 0
      }
    };
  });

  return {
    summary,
    locations: locationReviewItems
      .sort(
        (a, b) => b.affectedBookingCount - a.affectedBookingCount || a.label.localeCompare(b.label)
      ),
    routes: [...routes.values()].sort(
      (a, b) => b.affectedBookingCount - a.affectedBookingCount || a.pickup.localeCompare(b.pickup)
    ),
    approvedLocations: directory.locationRows.map((location) => ({
      id: location.id,
      displayName: location.display_name,
      fullGoogleAddress: location.full_google_address,
      googlePlaceId: location.google_place_id,
      latitude: Number(location.latitude),
      longitude: Number(location.longitude),
      countryCode: location.country_code,
      aliases: directory.aliasRows
        .filter((alias) => alias.canonical_location_id === location.id)
        .map((alias) => {
          const parsed = parseScopedNormalizedAlias(alias.normalized_alias);
          const matching = bookings.filter((booking) => {
            if (alias.client_id && booking.client_id !== alias.client_id) return false;
            if (parsed.side === "pickup") {
              return normalizeBookingLocationName(booking.pickup) === parsed.normalizedAlias;
            }
            if (parsed.side === "dropoff") {
              return normalizeBookingLocationName(booking.dropoff) === parsed.normalizedAlias;
            }
            return normalizeBookingLocationName(booking.pickup) === parsed.normalizedAlias ||
              normalizeBookingLocationName(booking.dropoff) === parsed.normalizedAlias;
          });
          const originalNames = new Map<string, number>();
          for (const booking of matching) {
            const values = parsed.side === "pickup"
              ? [booking.pickup]
              : parsed.side === "dropoff"
                ? [booking.dropoff]
                : [booking.pickup, booking.dropoff];
            for (const value of values) {
              if (normalizeBookingLocationName(value) !== parsed.normalizedAlias) continue;
              originalNames.set(value, (originalNames.get(value) ?? 0) + 1);
            }
          }
          const originalAlias = [...originalNames.entries()]
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? parsed.normalizedAlias;
          return {
            id: alias.id,
            originalAlias,
            confirmedName: alias.alias,
            normalizedAlias: parsed.normalizedAlias,
            side: parsed.side,
            clientId: alias.client_id,
            scope: alias.client_id ? "client" : "global",
            linkedBookingCount: new Set(matching.map((booking) => booking.id)).size
          };
        })
    }))
  };
}

type BookingCheckAuditItem = {
  id: string;
  booking_id: string;
  item_status?: string;
  pickup_location_id?: string | null;
  dropoff_location_id?: string | null;
  original_values: Record<string, unknown>;
  proposed_values: Record<string, unknown> | null;
  exact_reason?: string | null;
  related_booking_count?: number;
  suspicious_reasons?: unknown[];
  idempotency_key?: string;
};

async function fetchLatestDryRunBatch(admin: SupabaseClient) {
  const { data, error } = await admin
    .from("booking_map_backfill_batches")
    .select("id")
    .eq("dry_run", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  assertQuery(error, "Unable to load the Booking Maps review batch.");
  if (!data?.id) throw new AdminApiError(409, "Run a Booking Maps dry run before reviewing bookings.");
  return String(data.id);
}

async function fetchBookingCheckItems(admin: SupabaseClient, batchId: string) {
  const rows: BookingCheckAuditItem[] = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await admin
      .from("booking_map_backfill_items")
      .select("id,booking_id,item_status,pickup_location_id,dropoff_location_id,original_values,proposed_values,exact_reason,related_booking_count,suspicious_reasons,idempotency_key")
      .eq("batch_id", batchId)
      .range(from, from + 499);
    assertQuery(error, "Unable to load booking review progress.");
    const page = (data ?? []) as BookingCheckAuditItem[];
    rows.push(...page);
    if (page.length < 500) break;
  }
  return rows;
}

export async function buildBookingCheckSummary(admin: SupabaseClient) {
  const [partition, batchId] = await Promise.all([
    fetchHistoricalBookings(admin),
    fetchLatestDryRunBatch(admin)
  ]);
  const items = await fetchBookingCheckItems(admin, batchId);
  const reviewByBookingId = new Map(items.map((item) => [item.booking_id, bookingCheckReviewFromItem(item)]));
  const totals = partition.historical.reduce((result, booking) => {
    result[bookingCheckStatus(reviewByBookingId.get(booking.id) ?? null)] += 1;
    return result;
  }, { unchecked: 0, partial: 0, completed: 0, investigation: 0 });
  return {
    totals,
    remaining: partition.historical.length - totals.completed,
    futureBookingsExcluded: partition.future.length
  };
}

function bookingCheckReviewFromItem(item: BookingCheckAuditItem | undefined) {
  const value = item?.proposed_values?.booking_check;
  return value && typeof value === "object" ? value as BookingCheckReview : null;
}

function locationEvidence(bookings: BookingRow[], label: string) {
  const normalized = normalizeBookingLocationName(label);
  const occurrences: LocationReviewOccurrence[] = [];
  for (const booking of bookings) {
    const common = {
      bookingId: booking.id,
      bookingReference: booking.booking_id,
      bookingDate: booking.booking_date,
      clientId: booking.client_id,
      clientName: booking.client?.name ?? "Unknown client",
      pickup: booking.pickup,
      dropoff: booking.dropoff,
      routeUrl: booking.google_maps_route_url
    };
    if (normalizeBookingLocationName(booking.pickup) === normalized) {
      occurrences.push({ ...common, side: "pickup", placeId: booking.pickup_place_id, address: booking.pickup_address });
    }
    if (normalizeBookingLocationName(booking.dropoff) === normalized) {
      occurrences.push({ ...common, side: "dropoff", placeId: booking.dropoff_place_id, address: booking.dropoff_address });
    }
  }
  return summarizeLocationEvidence(label, occurrences);
}

export async function buildBookingChecks(admin: SupabaseClient) {
  const [partition, directory, batchId, clientsResult] = await Promise.all([
    fetchHistoricalBookings(admin),
    fetchDirectory(admin),
    fetchLatestDryRunBatch(admin),
    admin.from("clients").select("id,name").order("name")
  ]);
  assertQuery(clientsResult.error, "Unable to load clients for booking review.");
  const items = await fetchBookingCheckItems(admin, batchId);
  const itemByBookingId = new Map(items.map((item) => [item.booking_id, item]));
  const bookings = partition.historical;
  const allClients = (clientsResult.data ?? []) as Array<{ id: string; name: string }>;
  const evidenceCache = new Map<string, ReturnType<typeof summarizeLocationEvidence>>();
  const evidenceFor = (label: string) => {
    const key = normalizeBookingLocationName(label);
    const cached = evidenceCache.get(key);
    if (cached) return cached;
    const evidence = locationEvidence(bookings, label);
    evidenceCache.set(key, evidence);
    return evidence;
  };
  const routeBookings = new Map<string, BookingRow[]>();
  for (const booking of bookings) {
    const key = groupKey([
      normalizeBookingLocationName(booking.pickup),
      normalizeBookingLocationName(booking.dropoff)
    ]);
    routeBookings.set(key, [...(routeBookings.get(key) ?? []), booking]);
  }
  const checks = bookings.map((booking) => {
    const match = matchHistoricalBooking(bookingMatchInput(booking), directory.aliases, directory.locations);
    const review = bookingCheckReviewFromItem(itemByBookingId.get(booking.id));
    const pickupEvidence = evidenceFor(booking.pickup);
    const dropoffEvidence = evidenceFor(booking.dropoff);
    const pickupCandidate = review?.pickup.value ?? (match.pickupLocation
      ? canonicalToBookingCheckLocation(match.pickupLocation)
      : pickupEvidence.recommended
        ? {
            displayName: booking.pickup,
            fullGoogleAddress: pickupEvidence.recommended.address ?? "",
            googlePlaceId: pickupEvidence.recommended.placeId ?? "",
            latitude: 0,
            longitude: 0
          }
        : null);
    const dropoffCandidate = review?.dropoff.value ?? (match.dropoffLocation
      ? canonicalToBookingCheckLocation(match.dropoffLocation)
      : dropoffEvidence.recommended
        ? {
            displayName: booking.dropoff,
            fullGoogleAddress: dropoffEvidence.recommended.address ?? "",
            googlePlaceId: dropoffEvidence.recommended.placeId ?? "",
            latitude: 0,
            longitude: 0
          }
        : null);
    const pickupNormalized = normalizeBookingLocationName(booking.pickup);
    const dropoffNormalized = normalizeBookingLocationName(booking.dropoff);
    const sameRoute = routeBookings.get(groupKey([pickupNormalized, dropoffNormalized])) ?? [];
    const routeClientCounts = new Map<string, number>();
    for (const candidate of sameRoute) {
      if (candidate.client_id) routeClientCounts.set(candidate.client_id, (routeClientCounts.get(candidate.client_id) ?? 0) + 1);
    }
    const currentClientName = booking.client?.name ?? "Unknown client";
    const clientSuggestions = allClients
      .map((client) => ({
        ...client,
        routeUses: routeClientCounts.get(client.id) ?? 0,
        nameSimilarity: clientNameSimilarity(currentClientName, client.name),
        current: client.id === booking.client_id
      }))
      .filter((client) => client.current || client.routeUses > 0 || client.nameSimilarity >= 0.65)
      .sort((a, b) => Number(b.current) - Number(a.current) || b.routeUses - a.routeUses || b.nameSimilarity - a.nameSimilarity)
      .slice(0, 8)
      .map((client) => ({
        ...client,
        confidence: client.current && client.routeUses > 1 ? "high" : client.routeUses > 0 || client.nameSimilarity >= 0.8 ? "medium" : "low",
        reason: client.current
          ? `Current linked client; used ${client.routeUses} time(s) on this exact route.`
          : `${client.routeUses} exact-route use(s); ${Math.round(client.nameSimilarity * 100)}% name similarity.`
      }));
    const exactIds = new Set(sameRoute.filter((candidate) => candidate.client_id === booking.client_id).map((candidate) => candidate.id));
    const previousBookings = bookings
      .filter((candidate) => candidate.id !== booking.id && (
        sameRoute.some((same) => same.id === candidate.id) ||
        (candidate.client_id === booking.client_id && (
          normalizeBookingLocationName(candidate.pickup) === pickupNormalized ||
          normalizeBookingLocationName(candidate.dropoff) === dropoffNormalized
        ))
      ))
      .slice(0, 8)
      .map((candidate) => ({
        id: candidate.id,
        bookingDate: candidate.booking_date,
        reference: candidate.job_order_number || candidate.warehouse_no || candidate.booking_id,
        clientName: candidate.client?.name ?? "Unknown client",
        pickup: candidate.pickup,
        dropoff: candidate.dropoff,
        pickupPlaceId: candidate.pickup_place_id,
        dropoffPlaceId: candidate.dropoff_place_id
      }));
    return {
      id: booking.id,
      bookingDate: booking.booking_date,
      bookingReference: booking.booking_id,
      jobOrderNumber: booking.job_order_number,
      warehouseNumber: booking.warehouse_no,
      original: {
        clientId: booking.client_id,
        clientName: currentClientName,
        pickup: booking.pickup,
        dropoff: booking.dropoff
      },
      review,
      status: bookingCheckStatus(review),
      disposition: review?.disposition ?? "active",
      clientSuggestions,
      pickup: {
        candidate: pickupCandidate,
        confidence: match.pickupLocation ? "high" : pickupEvidence.confidence,
        reason: match.pickupLocation ? "An approved alias resolves this pickup." : pickupEvidence.reason,
        candidates: pickupEvidence.candidates
      },
      dropoff: {
        candidate: dropoffCandidate,
        confidence: match.dropoffLocation ? "high" : dropoffEvidence.confidence,
        reason: match.dropoffLocation ? "An approved alias resolves this drop-off." : dropoffEvidence.reason,
        candidates: dropoffEvidence.candidates
      },
      routeUseCount: sameRoute.length,
      previousBookings,
      matchingBookingCount: exactIds.size
    };
  });
  const totals = checks.reduce((result, check) => {
    result[check.status] += 1;
    return result;
  }, { unchecked: 0, partial: 0, completed: 0, investigation: 0 });
  return {
    batchId,
    futureBookingsExcluded: partition.future.length,
    clients: allClients,
    totals,
    remaining: checks.filter((check) => check.status !== "completed").length,
    checks
  };
}

export async function buildBookingCheckMatchingPreview(admin: SupabaseClient, bookingId: string) {
  const partition = await fetchHistoricalBookings(admin);
  const inputs = partition.historical.map((booking) => ({
    id: booking.id,
    clientId: booking.client_id,
    pickup: booking.pickup,
    dropoff: booking.dropoff
  }));
  const anchor = inputs.find((booking) => booking.id === bookingId);
  if (!anchor) throw new AdminApiError(404, "Booking is not available in the historical review set.");
  const ids = new Set(matchingBookingIds(inputs, anchor));
  const bookings = partition.historical
    .filter((booking) => ids.has(booking.id))
    .map((booking) => ({
      id: booking.id,
      bookingDate: booking.booking_date,
      reference: booking.job_order_number || booking.warehouse_no || booking.booking_id,
      clientName: booking.client?.name ?? "Unknown client",
      pickup: booking.pickup,
      dropoff: booking.dropoff
    }));
  return { count: bookings.length, bookings };
}

export async function saveBookingCheck(
  admin: SupabaseClient,
  actorUserId: string,
  input: {
    bookingId: string;
    action: "confirm_all" | "confirm_client" | "confirm_pickup" | "confirm_dropoff" | "skip" | "investigate";
    applyMatching?: boolean;
    client?: { id: string; name: string } | null;
    pickup?: BookingCheckLocationValue | null;
    dropoff?: BookingCheckLocationValue | null;
  }
) {
  const [partition, directory, batchId] = await Promise.all([
    fetchHistoricalBookings(admin),
    fetchDirectory(admin),
    fetchLatestDryRunBatch(admin)
  ]);
  const anchor = partition.historical.find((booking) => booking.id === input.bookingId);
  if (!anchor) throw new AdminApiError(404, "Booking is not available in the historical review set.");
  if (input.client) {
    const { data, error } = await admin.from("clients").select("id,name").eq("id", input.client.id).single();
    assertQuery(error, "Unable to verify the selected client.");
    if (!data || data.name !== input.client.name) throw new AdminApiError(409, "The selected client changed. Review it again.");
  }
  const confirmsPickup = input.action === "confirm_all" || input.action === "confirm_pickup";
  const confirmsDropoff = input.action === "confirm_all" || input.action === "confirm_dropoff";
  const [verifiedPickupPlace, verifiedDropoffPlace] = await Promise.all([
    confirmsPickup && input.pickup?.googlePlaceId ? fetchGooglePlace(input.pickup.googlePlaceId) : null,
    confirmsDropoff && input.dropoff?.googlePlaceId ? fetchGooglePlace(input.dropoff.googlePlaceId) : null
  ]);
  for (const place of [verifiedPickupPlace, verifiedDropoffPlace]) {
    if (place && place.countryCode !== "TH") {
      throw new AdminApiError(409, "The selected Google Place is outside Thailand and requires separate manual investigation.");
    }
  }
  const verifiedPickup: BookingCheckLocationValue | null = verifiedPickupPlace ? {
    displayName: verifiedPickupPlace.displayName,
    fullGoogleAddress: verifiedPickupPlace.fullGoogleAddress,
    googlePlaceId: verifiedPickupPlace.placeId,
    latitude: verifiedPickupPlace.latitude,
    longitude: verifiedPickupPlace.longitude
  } : input.pickup ?? null;
  const verifiedDropoff: BookingCheckLocationValue | null = verifiedDropoffPlace ? {
    displayName: verifiedDropoffPlace.displayName,
    fullGoogleAddress: verifiedDropoffPlace.fullGoogleAddress,
    googlePlaceId: verifiedDropoffPlace.placeId,
    latitude: verifiedDropoffPlace.latitude,
    longitude: verifiedDropoffPlace.longitude
  } : input.dropoff ?? null;
  const bookingInputs = partition.historical.map((booking) => ({
    id: booking.id,
    clientId: booking.client_id,
    pickup: booking.pickup,
    dropoff: booking.dropoff
  }));
  const anchorInput = bookingInputs.find((booking) => booking.id === anchor.id)!;
  const targetIds = new Set(input.applyMatching ? matchingBookingIds(bookingInputs, anchorInput) : [anchor.id]);
  const targets = partition.historical.filter((booking) => targetIds.has(booking.id));
  const { data: existingRows, error: existingError } = await admin
    .from("booking_map_backfill_items")
    .select("id,booking_id,item_status,pickup_location_id,dropoff_location_id,original_values,proposed_values,exact_reason,related_booking_count,suspicious_reasons,idempotency_key")
    .eq("batch_id", batchId)
    .in("booking_id", [...targetIds]);
  assertQuery(existingError, "Unable to load existing booking confirmations.");
  const existingByBooking = new Map(((existingRows ?? []) as BookingCheckAuditItem[]).map((row) => [row.booking_id, row]));
  const now = new Date().toISOString();
  const rows = targets.map((booking) => {
    const existing = existingByBooking.get(booking.id);
    let review: BookingCheckReview;
    try {
      review = createBookingCheckReview({
        current: bookingCheckReviewFromItem(existing),
        actorUserId,
        now,
        original: {
          clientId: booking.client_id,
          clientName: booking.client?.name ?? "Unknown client",
          pickup: booking.pickup,
          dropoff: booking.dropoff
        },
        action: input.action,
        client: input.client,
        pickup: verifiedPickup,
        dropoff: verifiedDropoff
      });
    } catch (error) {
      throw new AdminApiError(400, error instanceof Error ? error.message : "Invalid booking confirmation.");
    }
    const match = matchHistoricalBooking(bookingMatchInput(booking), directory.aliases, directory.locations);
    return {
      batch_id: batchId,
      booking_id: booking.id,
      item_status: existing?.item_status ?? match.status,
      pickup_location_id: existing?.pickup_location_id ?? match.pickupLocation?.id ?? null,
      dropoff_location_id: existing?.dropoff_location_id ?? match.dropoffLocation?.id ?? null,
      original_values: existing?.original_values ?? originalMapValues(booking),
      proposed_values: { ...(existing?.proposed_values ?? {}), booking_check: review },
      exact_reason: existing?.exact_reason ?? match.reason,
      related_booking_count: existing?.related_booking_count ?? targets.length,
      suspicious_reasons: existing?.suspicious_reasons ?? [],
      idempotency_key: existing?.idempotency_key ?? createDryRunIdempotencyKey(batchId, booking.id)
    };
  });
  const { error } = await admin
    .from("booking_map_backfill_items")
    .upsert(rows, { onConflict: "batch_id,booking_id" });
  assertQuery(error, "Unable to save booking confirmations.");
  return { affectedCount: rows.length, bookingIds: rows.map((row) => row.booking_id) };
}

export async function countAliasImpact(
  admin: SupabaseClient,
  alias: string,
  clientId: string | null,
  side: "pickup" | "dropoff"
) {
  const normalized = normalizeBookingLocationName(alias);
  if (!normalized) throw new AdminApiError(400, "Alias is required.");
  const { historical: bookings, cutoffDate } = await fetchHistoricalBookings(admin);
  const affectedCount = countApprovedAliasImpact(
    bookings.map((booking) => ({
      clientId: booking.client_id,
      pickup: booking.pickup,
      dropoff: booking.dropoff
    })),
    normalized,
    clientId,
    side
  );
  return { affectedCount, cutoffDate };
}

export async function countRouteContextImpact(
  admin: SupabaseClient,
  input: { alias: string; side: "pickup" | "dropoff"; clientId: string | null; pickup: string; dropoff: string }
) {
  const { historical, cutoffDate } = await fetchHistoricalBookings(admin);
  const normalizedAlias = normalizeBookingLocationName(input.alias);
  const normalizedPickup = normalizeBookingLocationName(input.pickup);
  const normalizedDropoff = normalizeBookingLocationName(input.dropoff);
  const affectedCount = historical.filter((booking) =>
    booking.client_id === input.clientId &&
    normalizeBookingLocationName(booking.pickup) === normalizedPickup &&
    normalizeBookingLocationName(booking.dropoff) === normalizedDropoff &&
    normalizeBookingLocationName(input.side === "pickup" ? booking.pickup : booking.dropoff) === normalizedAlias
  ).length;
  return { affectedCount, cutoffDate };
}

export async function approveRouteContextLocation(
  admin: SupabaseClient,
  actorUserId: string,
  input: {
    alias: string;
    side: "pickup" | "dropoff";
    clientId: string | null;
    pickup: string;
    dropoff: string;
    displayName?: string | null;
    placeId: string;
    expectedAffectedCount: number;
    snapshotVersion: string;
    confirmedName: string;
    outsideThailandApproved?: boolean;
  }
) {
  const snapshot = await getLocationReviewSnapshot(admin, { name: input.alias, side: input.side });
  if (snapshot.snapshotVersion !== input.snapshotVersion) {
    throw new BookingMapsStaleSnapshotError(snapshot);
  }
  const impact = await countRouteContextImpact(admin, input);
  const affectedCount = impact.affectedCount;
  if (affectedCount !== input.expectedAffectedCount) {
    throw new BookingMapsStaleSnapshotError(snapshot);
  }
  if (affectedCount < 1) throw new AdminApiError(409, "No historical bookings match this route context.");
  const place = await fetchGooglePlace(input.placeId);
  const outsideThailand = place.countryCode !== "TH";
  if (outsideThailand && !input.outsideThailandApproved) {
    throw new AdminApiError(409, `Google resolved this place outside Thailand (${place.countryCode ?? "unknown country"}). Explicit approval is required.`);
  }
  const displayName = input.displayName?.trim() || place.displayName;
  const confirmedName = input.confirmedName.trim();
  if (!confirmedName) throw new AdminApiError(400, "Confirmed company location name is required.");
  const { data: existingLocation, error: lookupError } = await admin
    .from("canonical_locations")
    .select("id")
    .eq("google_place_id", place.placeId)
    .maybeSingle();
  assertQuery(lookupError, "Unable to check the canonical location directory.");
  const locationValues = {
      display_name: displayName,
      normalized_name: normalizeBookingLocationName(displayName),
      full_google_address: place.fullGoogleAddress,
      google_place_id: place.placeId,
      latitude: place.latitude,
      longitude: place.longitude,
      country_code: place.countryCode,
      approval_status: "approved",
      outside_thailand_approved: outsideThailand && Boolean(input.outsideThailandApproved),
      approved_at: new Date().toISOString(),
      approved_by: actorUserId,
      updated_by: actorUserId
  };
  const locationResult = existingLocation?.id
    ? await admin.from("canonical_locations").update(locationValues).eq("id", existingLocation.id).select("id").single()
    : await admin.from("canonical_locations").insert({ ...locationValues, created_by: actorUserId }).select("id").single();
  const { data: location, error: locationError } = locationResult;
  assertQuery(locationError, "Unable to save the route-specific canonical location.");
  if (!location?.id) throw new AdminApiError(500, "Canonical location approval returned no ID.");

  const [partition, batchId] = await Promise.all([fetchHistoricalBookings(admin), fetchLatestDryRunBatch(admin)]);
  const normalizedPickup = normalizeBookingLocationName(input.pickup);
  const normalizedDropoff = normalizeBookingLocationName(input.dropoff);
  const targets = partition.historical.filter((booking) =>
    booking.client_id === input.clientId &&
    normalizeBookingLocationName(booking.pickup) === normalizedPickup &&
    normalizeBookingLocationName(booking.dropoff) === normalizedDropoff
  );
  const targetIds = targets.map((booking) => booking.id);
  const { data: existingRows, error: existingError } = await admin
    .from("booking_map_backfill_items")
    .select("id,booking_id,item_status,pickup_location_id,dropoff_location_id,original_values,proposed_values,exact_reason,related_booking_count,suspicious_reasons,idempotency_key")
    .eq("batch_id", batchId)
    .in("booking_id", targetIds);
  assertQuery(existingError, "Unable to load route-context proposals.");
  const existingByBooking = new Map(((existingRows ?? []) as BookingCheckAuditItem[]).map((row) => [row.booking_id, row]));
  const confirmedAt = new Date().toISOString();
  const placeValue = { canonicalLocationId: String(location.id), originalName: input.alias, confirmedName, googlePlaceName: displayName, fullGoogleAddress: place.fullGoogleAddress, googlePlaceId: place.placeId, latitude: place.latitude, longitude: place.longitude, confirmedBy: actorUserId, confirmedAt, scope: "route", snapshotVersion: input.snapshotVersion };
  const rows = targets.map((booking) => {
    const existing = existingByBooking.get(booking.id);
    const currentReview = (existing?.proposed_values?.location_review as Record<string, unknown> | undefined) ?? {};
    return {
      batch_id: batchId,
      booking_id: booking.id,
      item_status: existing?.item_status ?? (input.side === "pickup" ? "missing_pickup" : "missing_dropoff"),
      pickup_location_id: input.side === "pickup" ? String(location.id) : existing?.pickup_location_id ?? null,
      dropoff_location_id: input.side === "dropoff" ? String(location.id) : existing?.dropoff_location_id ?? null,
      original_values: existing?.original_values ?? originalMapValues(booking),
      proposed_values: { ...(existing?.proposed_values ?? {}), location_review: { ...currentReview, [input.side]: placeValue } },
      exact_reason: existing?.exact_reason ?? `Route-specific ${input.side} location approved for dry-run review.`,
      related_booking_count: targets.length,
      suspicious_reasons: existing?.suspicious_reasons ?? [],
      idempotency_key: existing?.idempotency_key ?? createDryRunIdempotencyKey(batchId, booking.id)
    };
  });
  const { error } = await admin.from("booking_map_backfill_items").upsert(rows, { onConflict: "batch_id,booking_id" });
  assertQuery(error, "Unable to save route-context location proposals.");
  return { canonicalLocationId: String(location.id), affectedCount, place, scope: "route" as const };
}

function getCountryCode(place: GooglePlaceDetails) {
  const component = place.addressComponents?.find((item) =>
    item.types?.includes("country")
  );
  return component?.shortText?.toUpperCase() ?? null;
}

async function fetchGooglePlace(placeId: string) {
  const cachedPlace = getRememberedVerifiedGooglePlace(placeId);
  if (cachedPlace) return cachedPlace;

  const apiKey = getServerGoogleMapsApiKey();
  if (!apiKey) throw new AdminApiError(503, "GOOGLE_MAPS_SERVER_API_KEY is not configured on the server.");
  const cleanPlaceId = placeId.replace(/^places\//, "").trim();
  if (!cleanPlaceId) throw new AdminApiError(400, "Google Place ID is required.");
  const response = await fetch(
    `https://places.googleapis.com/v1/places/${encodeURIComponent(cleanPlaceId)}?languageCode=en&regionCode=TH`,
    {
      cache: "no-store",
      headers: {
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "id,displayName,formattedAddress,location,addressComponents"
      }
    }
  );
  const data = (await response.json()) as GooglePlaceDetails;
  if (!response.ok) {
    throw new AdminApiError(422, data.error?.message || "Google Place details could not be verified.");
  }
  const latitude = Number(data.location?.latitude);
  const longitude = Number(data.location?.longitude);
  if (!data.id || !data.formattedAddress || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new AdminApiError(422, "Google returned incomplete Place details.");
  }
  const place = {
    placeId: data.id,
    displayName: data.displayName?.text?.trim() || data.formattedAddress,
    fullGoogleAddress: data.formattedAddress,
    latitude,
    longitude,
    countryCode: getCountryCode(data)
  };
  rememberVerifiedGooglePlace(place);
  return place;
}

export async function approveCanonicalLocation(
  admin: SupabaseClient,
  actorUserId: string,
  input: {
    alias: string;
    side: "pickup" | "dropoff";
    clientId: string | null;
    displayName?: string | null;
    placeId: string;
    expectedAffectedCount: number;
    snapshotVersion: string;
    confirmedName: string;
    outsideThailandApproved?: boolean;
  }
) {
  const snapshot = await getLocationReviewSnapshot(admin, { name: input.alias, side: input.side });
  if (snapshot.snapshotVersion !== input.snapshotVersion) {
    throw new BookingMapsStaleSnapshotError(snapshot);
  }
  const affectedCount = input.clientId
    ? snapshot.clients.find((client) => client.clientId === input.clientId)?.count ?? 0
    : snapshot.uniqueAffectedBookings;
  if (affectedCount !== input.expectedAffectedCount) {
    throw new BookingMapsStaleSnapshotError(snapshot);
  }
  const place = await fetchGooglePlace(input.placeId);
  const outsideThailand = place.countryCode !== "TH";
  if (outsideThailand && !input.outsideThailandApproved) {
    throw new AdminApiError(
      409,
      `Google resolved this place outside Thailand (${place.countryCode ?? "unknown country"}). Explicit approval is required.`
    );
  }
  const displayName = input.displayName?.trim() || place.displayName;
  const confirmedName = input.confirmedName.trim();
  if (!confirmedName) throw new AdminApiError(400, "Confirmed company location name is required.");
  const normalizedName = normalizeBookingLocationName(displayName);
  const normalizedAlias = scopedNormalizedAlias(input.alias, input.side);

  const { data: locationId, error: approvalError } = await admin.rpc(
    "approve_canonical_booking_location",
    {
      target_display_name: displayName,
      target_normalized_name: normalizedName,
      target_full_google_address: place.fullGoogleAddress,
      target_google_place_id: place.placeId,
      target_latitude: place.latitude,
      target_longitude: place.longitude,
      target_country_code: place.countryCode,
      target_outside_thailand_approved:
        outsideThailand && Boolean(input.outsideThailandApproved),
      target_alias: confirmedName,
      target_normalized_alias: normalizedAlias,
      target_client_id: input.clientId,
      actor_user_id: actorUserId
    });
  assertQuery(approvalError, "Unable to approve the canonical location and alias.");
  if (!locationId) throw new AdminApiError(500, "Canonical location approval returned no ID.");
  return { canonicalLocationId: String(locationId), affectedCount, place };
}

export async function renameApprovedLocationMapping(
  admin: SupabaseClient,
  actorUserId: string,
  aliasId: string,
  confirmedName: string
) {
  if (!/^[0-9a-f-]{36}$/i.test(aliasId)) throw new AdminApiError(400, "Invalid location mapping ID.");
  const cleanName = confirmedName.trim();
  if (!cleanName || cleanName.length > 160) throw new AdminApiError(400, "Confirmed company location name must be 1-160 characters.");
  const { data, error } = await admin
    .from("canonical_location_aliases")
    .update({ alias: cleanName, updated_by: actorUserId })
    .eq("id", aliasId)
    .eq("approval_status", "approved")
    .select("id,alias")
    .maybeSingle();
  assertQuery(error, "Unable to rename the approved location mapping.");
  if (!data) throw new AdminApiError(404, "Approved location mapping not found.");
  return { id: data.id, confirmedName: data.alias };
}

export async function undoApprovedLocationMapping(
  admin: SupabaseClient,
  actorUserId: string,
  aliasId: string
) {
  if (!/^[0-9a-f-]{36}$/i.test(aliasId)) throw new AdminApiError(400, "Invalid location mapping ID.");
  const { data, error } = await admin
    .from("canonical_location_aliases")
    .update({ approval_status: "pending", updated_by: actorUserId })
    .eq("id", aliasId)
    .eq("approval_status", "approved")
    .select("id")
    .maybeSingle();
  assertQuery(error, "Unable to undo the approved location mapping.");
  if (!data) throw new AdminApiError(404, "Approved location mapping not found.");
  return { id: data.id, undone: true };
}

function routeUrl(pickup: CanonicalLocationMatch, dropoff: CanonicalLocationMatch) {
  return `https://www.google.com/maps/dir/?api=1&origin_place_id=${encodeURIComponent(pickup.googlePlaceId)}&destination_place_id=${encodeURIComponent(dropoff.googlePlaceId)}&travelmode=driving`;
}

async function waitForRetry(attempt: number) {
  await new Promise((resolve) => setTimeout(resolve, Math.min(1000 * 2 ** attempt, 8000)));
}

async function computeRouteWithRetry(
  pickup: CanonicalLocationMatch,
  dropoff: CanonicalLocationMatch
) {
  const apiKey = getServerGoogleMapsApiKey();
  if (!apiKey) throw new AdminApiError(503, "GOOGLE_MAPS_SERVER_API_KEY is not configured on the server.");
  let lastMessage = "Google Routes API failed.";
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": ROUTE_FIELD_MASK
      },
      body: JSON.stringify({
        origin: { placeId: pickup.googlePlaceId.replace(/^places\//, "") },
        destination: { placeId: dropoff.googlePlaceId.replace(/^places\//, "") },
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_AWARE_OPTIMAL",
        trafficModel: "BEST_GUESS",
        computeAlternativeRoutes: true,
        regionCode: "TH",
        languageCode: "en",
        units: "METRIC"
      })
    });
    const data = (await response.json()) as RouteResponse;
    const selected = selectRouteWithFallback(data.routes ?? []).selectedRoute;
    if (response.ok && selected) {
      const durationSeconds = parseGoogleDurationSeconds(selected.duration);
      if (durationSeconds == null || !selected.distanceMeters) {
        throw new AdminApiError(422, "Google returned an incomplete route.");
      }
      return {
        distanceMeters: Number(selected.distanceMeters),
        durationSeconds,
        staticDurationSeconds: parseGoogleDurationSeconds(selected.staticDuration),
        googleMapsRouteUrl: routeUrl(pickup, dropoff),
        routeLabel: selected.routeLabels?.includes("DEFAULT_ROUTE")
          ? "DEFAULT_ROUTE"
          : selected.routeLabels?.[0] ?? "FASTEST_TRAFFIC_AWARE",
        routeDescription: selected.description ?? null,
        encodedPolyline: selected.polyline?.encodedPolyline ?? null,
        trafficAware: !data.fallbackInfo,
        fallbackInfo: data.fallbackInfo ?? null,
        calculatedAt: new Date().toISOString()
      };
    }
    lastMessage = data.error?.message || lastMessage;
    if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 3) break;
    await waitForRetry(attempt);
  }
  throw new AdminApiError(422, lastMessage);
}

async function getOrCreateRoute(
  admin: SupabaseClient,
  pickup: CanonicalLocationMatch,
  dropoff: CanonicalLocationMatch
) {
  const preference = "TRAFFIC_AWARE_OPTIMAL";
  const { data: existing, error: existingError } = await admin
    .from("canonical_route_cache")
    .select("*")
    .eq("pickup_location_id", pickup.id)
    .eq("dropoff_location_id", dropoff.id)
    .eq("routing_preference", preference)
    .maybeSingle();
  assertQuery(existingError, "Unable to read the route cache.");
  if (existing) return existing as RouteCacheRow;

  const route = await computeRouteWithRetry(pickup, dropoff);
  const { data, error } = await admin
    .from("canonical_route_cache")
    .upsert({
      pickup_location_id: pickup.id,
      dropoff_location_id: dropoff.id,
      routing_preference: preference,
      distance_meters: route.distanceMeters,
      duration_seconds: route.durationSeconds,
      static_duration_seconds: route.staticDurationSeconds,
      google_maps_route_url: route.googleMapsRouteUrl,
      route_label: route.routeLabel,
      route_description: route.routeDescription,
      encoded_polyline: route.encodedPolyline,
      traffic_aware: route.trafficAware,
      fallback_info: route.fallbackInfo,
      calculated_at: route.calculatedAt
    }, {
      onConflict: "pickup_location_id,dropoff_location_id,routing_preference"
    })
    .select("*")
    .single();
  assertQuery(error, "Unable to cache the Google route.");
  return data as RouteCacheRow;
}

function originalMapValues(booking: BookingRow) {
  return {
    pickup_location_id: booking.pickup_location_id,
    dropoff_location_id: booking.dropoff_location_id,
    pickup_place_id: booking.pickup_place_id,
    dropoff_place_id: booking.dropoff_place_id,
    pickup_address: booking.pickup_address,
    dropoff_address: booking.dropoff_address,
    pickup_lat: booking.pickup_lat,
    pickup_lng: booking.pickup_lng,
    dropoff_lat: booking.dropoff_lat,
    dropoff_lng: booking.dropoff_lng,
    route_distance_meters: booking.route_distance_meters,
    route_duration_seconds: booking.route_duration_seconds,
    estimated_distance_km: booking.estimated_distance_km,
    google_maps_route_url: booking.google_maps_route_url,
    map_resolution_status: booking.map_resolution_status
  };
}

export async function createBookingMapsDryRun(
  admin: SupabaseClient,
  actorUserId: string,
  options: { batchId?: string | null; batchSize?: number } = {}
) {
  const [bookingPartition, directory] = await Promise.all([
    fetchHistoricalBookings(admin),
    fetchDirectory(admin)
  ]);
  const bookings = bookingPartition.historical;
  let batch: {
    id: string;
    cursor_booking_id: string | null;
    ready_count: number;
    exception_count: number;
    processed_count: number;
    status: string;
  };
  if (options.batchId) {
    const { data, error } = await admin
      .from("booking_map_backfill_batches")
      .select("id,cursor_booking_id,ready_count,exception_count,processed_count,status")
      .eq("id", options.batchId)
      .eq("dry_run", true)
      .single();
    assertQuery(error, "Unable to resume the dry run.");
    if (!data) throw new AdminApiError(404, "Dry-run batch not found.");
    batch = data as typeof batch;
    if (batch.status === "review") return getDryRun(admin, batch.id);
  } else {
    const { data, error } = await admin
      .from("booking_map_backfill_batches")
      .insert({
        status: "dry_run",
        dry_run: true,
        total_bookings: bookings.length,
        created_by: actorUserId,
        updated_by: actorUserId,
        started_at: new Date().toISOString(),
        options: {
          approved_aliases_only: true,
          route_preference: "TRAFFIC_AWARE_OPTIMAL",
          overwrite_manual_values: false,
          resumable: true,
          historical_cutoff_date: bookingPartition.cutoffDate,
          future_bookings_excluded: bookingPartition.future.length
        }
      })
      .select("id,cursor_booking_id,ready_count,exception_count,processed_count,status")
      .single();
    assertQuery(error, "Unable to start the dry run.");
    if (!data) throw new AdminApiError(500, "Dry-run batch creation returned no row.");
    batch = data as typeof batch;
  }

  const routePromises = new Map<string, Promise<RouteCacheRow>>();
  const historicalRouteDistances = new Map<string, Set<number>>();
  for (const booking of bookings) {
    const key = groupKey([
      booking.client_id,
      normalizeBookingLocationName(booking.pickup),
      normalizeBookingLocationName(booking.dropoff)
    ]);
    const distanceKm =
      booking.route_distance_meters != null
        ? Number(booking.route_distance_meters) / 1000
        : Number(booking.estimated_distance_km);
    if (!Number.isFinite(distanceKm) || distanceKm <= 0) continue;
    const values = historicalRouteDistances.get(key) ?? new Set<number>();
    values.add(Math.round(distanceKm * 10) / 10);
    historicalRouteDistances.set(key, values);
  }
  let readyCount = Number(batch.ready_count) || 0;
  let exceptionCount = Number(batch.exception_count) || 0;
  let processedCount = Number(batch.processed_count) || 0;
  const slice = nextResumableBatch(
    bookings,
    batch.cursor_booking_id,
    Math.min(200, Math.max(10, options.batchSize ?? 100))
  );
  const itemRows: Array<Record<string, unknown>> = [];

  for (const booking of slice.items) {
    const match = matchHistoricalBooking(
      bookingMatchInput(booking),
      directory.aliases,
      directory.locations
    );
    let itemStatus = match.status;
    let reason = match.reason;
    let route: RouteCacheRow | null = null;
    let suspiciousReasons: string[] = [];

    if (match.status === "ready" && match.pickupLocation && match.dropoffLocation) {
      const key = canonicalRouteKey(match.pickupLocation.id, match.dropoffLocation.id);
      let pendingRoute = routePromises.get(key);
      if (!pendingRoute) {
        pendingRoute = getOrCreateRoute(admin, match.pickupLocation, match.dropoffLocation);
        routePromises.set(key, pendingRoute);
      }
      try {
        route = await pendingRoute;
        suspiciousReasons = isSuspiciousRouteDistance({
          distanceMeters: Number(route.distance_meters),
          existingDistanceMeters: bookingMatchInput(booking).existingDistanceMeters,
          pickupEqualsDropoff: match.pickupLocation.id === match.dropoffLocation.id
        });
        if (suspiciousReasons.length) {
          itemStatus = "suspicious_distance";
          reason = suspiciousReasons.join(" ");
        }
      } catch (error) {
        itemStatus = "google_api_failure";
        reason = error instanceof Error ? error.message : "Google Routes API failed.";
      }
    }

    const historicalRouteKey = groupKey([
      booking.client_id,
      normalizeBookingLocationName(booking.pickup),
      normalizeBookingLocationName(booking.dropoff)
    ]);
    const conflictingDistances = historicalRouteDistances.get(historicalRouteKey);
    if (
      route &&
      itemStatus !== "google_api_failure" &&
      conflictingDistances &&
      conflictingDistances.size > 1
    ) {
      itemStatus = "conflicting_route";
      reason = `Historical records contain ${conflictingDistances.size} different distances (${[...conflictingDistances].join(", ")} km).`;
    }

    const proposedValues =
      route && match.pickupLocation && match.dropoffLocation
        ? {
            pickup_location_id: match.pickupLocation.id,
            dropoff_location_id: match.dropoffLocation.id,
            pickup_place_id: match.pickupLocation.googlePlaceId,
            dropoff_place_id: match.dropoffLocation.googlePlaceId,
            pickup_address: match.pickupLocation.fullGoogleAddress,
            dropoff_address: match.dropoffLocation.fullGoogleAddress,
            pickup_lat: match.pickupLocation.latitude,
            pickup_lng: match.pickupLocation.longitude,
            dropoff_lat: match.dropoffLocation.latitude,
            dropoff_lng: match.dropoffLocation.longitude,
            route_distance_meters: Number(route.distance_meters),
            estimated_distance_km: Number(route.distance_meters) / 1000,
            route_duration_seconds: Number(route.duration_seconds),
            estimated_duration_minutes: Math.ceil(Number(route.duration_seconds) / 60),
            route_static_duration_seconds: route.static_duration_seconds,
            google_maps_route_url: route.google_maps_route_url,
            routing_preference: route.routing_preference,
            route_label: route.route_label,
            route_description: route.route_description,
            route_polyline: route.encoded_polyline,
            route_traffic_aware: route.traffic_aware,
            route_fallback_info: route.fallback_info,
            route_calculated_at: route.calculated_at,
            map_resolution_status: "resolved",
            map_backfill_batch_id: batch.id
          }
        : null;

    const relatedBookingCount = bookings.filter(
      (candidate) =>
        normalizeBookingLocationName(candidate.pickup) ===
          normalizeBookingLocationName(booking.pickup) &&
        normalizeBookingLocationName(candidate.dropoff) ===
          normalizeBookingLocationName(booking.dropoff) &&
        candidate.client_id === booking.client_id
    ).length;
    itemRows.push({
        batch_id: batch.id,
        booking_id: booking.id,
        item_status: itemStatus,
        pickup_location_id: match.pickupLocation?.id ?? null,
        dropoff_location_id: match.dropoffLocation?.id ?? null,
        route_cache_id: route?.id ?? null,
        original_values: originalMapValues(booking),
        proposed_values: proposedValues,
        exact_reason: reason,
        suggested_correction:
          itemStatus === "missing_pickup" || itemStatus === "missing_dropoff"
            ? "Approve the correct Google Place and alias, then run a new dry run."
            : itemStatus === "ambiguous_location"
              ? "Use a client-specific alias or split this label into distinct locations."
              : itemStatus === "suspicious_distance"
                ? "Review the canonical locations and Google recommended route."
                : null,
        related_booking_count: relatedBookingCount,
        suspicious_reasons: suspiciousReasons,
        idempotency_key: createDryRunIdempotencyKey(batch.id, booking.id)
    });
    processedCount += 1;
    if (itemStatus === "ready") readyCount += 1;
    else exceptionCount += 1;
  }

  if (itemRows.length) {
    const { error: itemError } = await admin
      .from("booking_map_backfill_items")
      .upsert(itemRows, { onConflict: "batch_id,booking_id" });
    assertQuery(itemError, "Unable to save dry-run proposals.");
  }

  const { error: completeError } = await admin
    .from("booking_map_backfill_batches")
    .update({
      status: slice.complete ? "review" : "dry_run",
      ready_count: readyCount,
      exception_count: exceptionCount,
      processed_count: processedCount,
      cursor_booking_id: slice.nextCursor,
      completed_at: slice.complete ? new Date().toISOString() : null,
      updated_by: actorUserId
    })
    .eq("id", batch.id);
  assertQuery(completeError, "Unable to complete the dry run.");
  return getDryRun(admin, batch.id as string);
}

export async function getDryRun(admin: SupabaseClient, batchId?: string | null) {
  let batchQuery = admin
    .from("booking_map_backfill_batches")
    .select("*")
    .eq("dry_run", true)
    .order("created_at", { ascending: false })
    .limit(1);
  if (batchId) batchQuery = batchQuery.eq("id", batchId);
  const { data: batches, error: batchError } = await batchQuery;
  assertQuery(batchError, "Unable to load the dry run.");
  const batch = batches?.[0] ?? null;
  if (!batch) return null;

  const items: Record<string, unknown>[] = [];
  const pageSize = 500;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await admin
      .from("booking_map_backfill_items")
      .select("*,booking:booking_diary(id,booking_id,booking_date,pickup,dropoff,client:clients(name))")
      .eq("batch_id", batch.id)
      .order("item_status", { ascending: true })
      .order("related_booking_count", { ascending: false })
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    assertQuery(error, "Unable to load dry-run proposals.");
    const page = (data ?? []) as Record<string, unknown>[];
    items.push(...page);
    if (page.length < pageSize) break;
  }
  return { batch, items };
}

export async function buildExceptionsCsv(admin: SupabaseClient, batchId?: string | null) {
  const dryRun = await getDryRun(admin, batchId);
  if (!dryRun) throw new AdminApiError(404, "No dry-run batch exists.");
  const headers = [
    "booking ID",
    "date",
    "client",
    "pickup",
    "drop-off",
    "failure status",
    "exact reason",
    "suggested correction",
    "other bookings affected"
  ];
  const escape = (value: unknown) => {
    const text = String(value ?? "");
    return `"${text.replaceAll('"', '""')}"`;
  };
  const rows = dryRun.items
    .filter((item: Record<string, unknown>) => item.item_status !== "ready")
    .map((item: Record<string, any>) => [
      item.booking?.booking_id ?? item.booking?.id,
      item.booking?.booking_date,
      item.booking?.client?.name,
      item.booking?.pickup,
      item.booking?.dropoff,
      item.item_status,
      item.exact_reason,
      item.suggested_correction,
      Math.max(0, Number(item.related_booking_count) - 1)
    ]);
  return `\uFEFF${[headers, ...rows].map((row) => row.map(escape).join(",")).join("\r\n")}`;
}
