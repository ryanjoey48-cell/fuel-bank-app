import type { SupabaseClient } from "@supabase/supabase-js";
import { AdminApiError } from "@/lib/admin-user-management-server";
import { normalizeBookingLocationName } from "@/lib/booking-maps-backfill";

export type RouteApprovalStatus = "pending" | "needs_review" | "confirmed" | "reopened";

export type RouteApprovalLocation = {
  displayName: string;
  fullGoogleAddress: string | null;
  googlePlaceId: string | null;
  latitude: number | null;
  longitude: number | null;
};

export type RouteApprovalBooking = {
  id: string;
  bookingDate: string;
  clientName: string;
  bookingReference: string | null;
  jobOrderNumber: string | null;
  driver: string | null;
  vehicleRegistration: string | null;
  pickup: string;
  dropoff: string;
};

export type RouteApprovalGroup = {
  key: string;
  normalizedPickup: string;
  normalizedDropoff: string;
  displayPickup: string;
  displayDropoff: string;
  bookingCount: number;
  activeDateCount: number;
  firstBookingDate: string;
  latestBookingDate: string;
  status: RouteApprovalStatus;
  mapsStatus: "matched" | "needs_review";
  approvalId: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  pickup: RouteApprovalLocation;
  dropoff: RouteApprovalLocation;
  googleDistanceKm: number | null;
  routeDistanceMeters: number | null;
  googleMapsRouteUrl: string | null;
  needsReviewReasons: string[];
  bookings: RouteApprovalBooking[];
};

type BookingRouteRow = {
  id: string;
  booking_id: string | null;
  booking_date: string;
  job_order_number: string | null;
  pickup: string | null;
  dropoff: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  pickup_place_id: string | null;
  dropoff_place_id: string | null;
  pickup_lat: number | string | null;
  pickup_lng: number | string | null;
  dropoff_lat: number | string | null;
  dropoff_lng: number | string | null;
  estimated_distance_km: number | string | null;
  route_distance_meters: number | string | null;
  google_maps_route_url: string | null;
  approved_route_id: string | null;
  route_confirmation_status: RouteApprovalStatus | null;
  driver: string | null;
  vehicle: string | null;
  vehicle_registration: string | null;
  client: { name: string } | null;
};

type ApprovalRow = {
  id: string;
  normalized_pickup: string;
  normalized_dropoff: string;
  display_pickup: string;
  display_dropoff: string;
  pickup_canonical_name: string | null;
  pickup_formatted_address: string | null;
  pickup_place_id: string | null;
  pickup_lat: number | string | null;
  pickup_lng: number | string | null;
  dropoff_canonical_name: string | null;
  dropoff_formatted_address: string | null;
  dropoff_place_id: string | null;
  dropoff_lat: number | string | null;
  dropoff_lng: number | string | null;
  google_distance_km: number | string | null;
  route_distance_meters: number | string | null;
  google_maps_route_url: string | null;
  status: RouteApprovalStatus;
  approved_at: string | null;
  approved_by: string | null;
};

export type RouteApprovalSummary = {
  repeatRoutesFound: number;
  repeatRoutesConfirmed: number;
  repeatRoutesRemaining: number;
  bookingsCoveredByConfirmedRoutes: number;
  bookingsAwaitingRouteVerification: number;
  needsReview: number;
};

export type RouteApprovalQueue = {
  summary: RouteApprovalSummary;
  routes: RouteApprovalGroup[];
};

export type RouteApprovalPayload = {
  normalizedPickup: string;
  normalizedDropoff: string;
  displayPickup: string;
  displayDropoff: string;
  pickup: RouteApprovalLocation;
  dropoff: RouteApprovalLocation;
  googleDistanceKm?: number | null;
  routeDistanceMeters?: number | null;
  googleMapsRouteUrl?: string | null;
};

function numberOrNull(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function normalizeRouteApprovalName(value: string | null | undefined) {
  return normalizeBookingLocationName(value ?? "");
}

export function routeApprovalKey(pickup: string, dropoff: string) {
  return `${pickup} -> ${dropoff}`;
}

function hasVerifiedLocation(location: RouteApprovalLocation) {
  return Boolean(
    location.googlePlaceId &&
      location.fullGoogleAddress &&
      location.latitude != null &&
      location.longitude != null
  );
}

function bestLocation(rows: BookingRouteRow[], side: "pickup" | "dropoff"): RouteApprovalLocation {
  const displayName = rows.find((row) => (side === "pickup" ? row.pickup : row.dropoff)?.trim())?.[side]?.trim() ?? "";
  const candidates = new Map<string, { count: number; location: RouteApprovalLocation }>();
  for (const row of rows) {
    const placeId = side === "pickup" ? row.pickup_place_id : row.dropoff_place_id;
    const address = side === "pickup" ? row.pickup_address : row.dropoff_address;
    const lat = numberOrNull(side === "pickup" ? row.pickup_lat : row.dropoff_lat);
    const lng = numberOrNull(side === "pickup" ? row.pickup_lng : row.dropoff_lng);
    if (!placeId || !address || lat == null || lng == null) continue;
    const key = `${placeId}|${address}|${lat}|${lng}`;
    const current = candidates.get(key);
    candidates.set(key, {
      count: (current?.count ?? 0) + 1,
      location: {
        displayName,
        fullGoogleAddress: address,
        googlePlaceId: placeId,
        latitude: lat,
        longitude: lng
      }
    });
  }
  return [...candidates.values()].sort((a, b) => b.count - a.count)[0]?.location ?? {
    displayName,
    fullGoogleAddress: null,
    googlePlaceId: null,
    latitude: null,
    longitude: null
  };
}

function approvalLocation(approval: ApprovalRow | null, fallback: RouteApprovalLocation, side: "pickup" | "dropoff") {
  if (!approval) return fallback;
  return {
    displayName: (side === "pickup" ? approval.pickup_canonical_name : approval.dropoff_canonical_name) || fallback.displayName,
    fullGoogleAddress: side === "pickup" ? approval.pickup_formatted_address : approval.dropoff_formatted_address,
    googlePlaceId: side === "pickup" ? approval.pickup_place_id : approval.dropoff_place_id,
    latitude: numberOrNull(side === "pickup" ? approval.pickup_lat : approval.dropoff_lat),
    longitude: numberOrNull(side === "pickup" ? approval.pickup_lng : approval.dropoff_lng)
  };
}

function routeDistance(rows: BookingRouteRow[], approval: ApprovalRow | null) {
  const approvalKm = numberOrNull(approval?.google_distance_km);
  if (approvalKm != null) return approvalKm;
  const approvalMeters = numberOrNull(approval?.route_distance_meters);
  if (approvalMeters != null) return Math.round((approvalMeters / 1000) * 10) / 10;
  const distances = rows.map((row) => numberOrNull(row.estimated_distance_km)).filter((value): value is number => value != null && value > 0);
  if (!distances.length) return null;
  return Math.round((distances.reduce((sum, value) => sum + value, 0) / distances.length) * 10) / 10;
}

function routeUrl(location: { pickup: RouteApprovalLocation; dropoff: RouteApprovalLocation }, fallback: string | null) {
  if (fallback) return fallback;
  if (!location.pickup.fullGoogleAddress || !location.dropoff.fullGoogleAddress) return null;
  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  url.searchParams.set("origin", location.pickup.fullGoogleAddress);
  url.searchParams.set("destination", location.dropoff.fullGoogleAddress);
  if (location.pickup.googlePlaceId) url.searchParams.set("origin_place_id", location.pickup.googlePlaceId.replace(/^places\//, ""));
  if (location.dropoff.googlePlaceId) url.searchParams.set("destination_place_id", location.dropoff.googlePlaceId.replace(/^places\//, ""));
  return url.toString();
}

export function buildRouteApprovalQueueFromRows(bookings: BookingRouteRow[], approvals: ApprovalRow[]): RouteApprovalQueue {
  const approvalByRoute = new Map(approvals.map((approval) => [routeApprovalKey(approval.normalized_pickup, approval.normalized_dropoff), approval]));
  const grouped = new Map<string, BookingRouteRow[]>();
  for (const booking of bookings) {
    const normalizedPickup = normalizeRouteApprovalName(booking.pickup);
    const normalizedDropoff = normalizeRouteApprovalName(booking.dropoff);
    if (!normalizedPickup || !normalizedDropoff) continue;
    const key = routeApprovalKey(normalizedPickup, normalizedDropoff);
    grouped.set(key, [...(grouped.get(key) ?? []), booking]);
  }

  const routes = [...grouped.entries()].map(([key, rows]) => {
    const [normalizedPickup, normalizedDropoff] = key.split(" -> ");
    const dates = [...new Set(rows.map((row) => row.booking_date))].sort();
    const sortedRows = [...rows].sort((a, b) => a.booking_date.localeCompare(b.booking_date));
    const approval = approvalByRoute.get(key) ?? null;
    const inferredPickup = bestLocation(rows, "pickup");
    const inferredDropoff = bestLocation(rows, "dropoff");
    const pickup = approvalLocation(approval, inferredPickup, "pickup");
    const dropoff = approvalLocation(approval, inferredDropoff, "dropoff");
    const missingPickup = !hasVerifiedLocation(pickup);
    const missingDropoff = !hasVerifiedLocation(dropoff);
    const needsReviewReasons = [
      missingPickup ? "Pickup Maps location needs review." : "",
      missingDropoff ? "Drop-off Maps location needs review." : ""
    ].filter(Boolean);
    const mapsStatus = needsReviewReasons.length ? "needs_review" : "matched";
    const status: RouteApprovalStatus = approval?.status === "confirmed"
      ? "confirmed"
      : approval?.status === "reopened"
        ? "reopened"
        : mapsStatus === "needs_review"
          ? "needs_review"
          : "pending";
    const googleDistanceKm = routeDistance(rows, approval);
    const routeDistanceMeters = numberOrNull(approval?.route_distance_meters) ?? (googleDistanceKm != null ? Math.round(googleDistanceKm * 1000) : null);
    return {
      key,
      normalizedPickup,
      normalizedDropoff,
      displayPickup: approval?.display_pickup || sortedRows[0]?.pickup?.trim() || normalizedPickup,
      displayDropoff: approval?.display_dropoff || sortedRows[0]?.dropoff?.trim() || normalizedDropoff,
      bookingCount: rows.length,
      activeDateCount: dates.length,
      firstBookingDate: dates[0] ?? "",
      latestBookingDate: dates.at(-1) ?? "",
      status,
      mapsStatus,
      approvalId: approval?.id ?? null,
      approvedAt: approval?.approved_at ?? null,
      approvedBy: approval?.approved_by ?? null,
      pickup,
      dropoff,
      googleDistanceKm,
      routeDistanceMeters,
      googleMapsRouteUrl: routeUrl({ pickup, dropoff }, approval?.google_maps_route_url ?? rows.find((row) => row.google_maps_route_url)?.google_maps_route_url ?? null),
      needsReviewReasons,
      bookings: sortedRows.map((row) => ({
        id: row.id,
        bookingDate: row.booking_date,
        clientName: row.client?.name ?? "",
        bookingReference: row.booking_id,
        jobOrderNumber: row.job_order_number,
        driver: row.driver,
        vehicleRegistration: row.vehicle_registration || row.vehicle,
        pickup: row.pickup ?? "",
        dropoff: row.dropoff ?? ""
      }))
    } satisfies RouteApprovalGroup;
  }).filter((route) => route.bookingCount >= 2 && route.activeDateCount >= 2)
    .sort((a, b) => b.bookingCount - a.bookingCount || b.activeDateCount - a.activeDateCount || a.displayPickup.localeCompare(b.displayPickup));

  const summary = {
    repeatRoutesFound: routes.length,
    repeatRoutesConfirmed: routes.filter((route) => route.status === "confirmed").length,
    repeatRoutesRemaining: routes.filter((route) => route.status !== "confirmed").length,
    bookingsCoveredByConfirmedRoutes: routes.filter((route) => route.status === "confirmed").reduce((sum, route) => sum + route.bookingCount, 0),
    bookingsAwaitingRouteVerification: routes.filter((route) => route.status !== "confirmed").reduce((sum, route) => sum + route.bookingCount, 0),
    needsReview: routes.filter((route) => route.status === "needs_review" || route.status === "reopened").length
  };

  return { summary, routes };
}

function assertSetup(error: { code?: string; message?: string } | null, fallback: string) {
  if (!error) return;
  const message = String(error.message ?? "").toLowerCase();
  if (error.code === "42P01" || error.code === "42703" || error.code === "PGRST204" || message.includes("booking_route_approvals")) {
    throw new AdminApiError(503, "Route Approval setup required. Apply migration 20260826120000_add_booking_route_approvals.sql.");
  }
  throw new AdminApiError(500, error.message || fallback);
}

async function fetchRouteApprovalBookings(admin: SupabaseClient) {
  const rows: BookingRouteRow[] = [];
  const pageSize = 500;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await admin
      .from("booking_diary")
      .select("id,booking_id,booking_date,job_order_number,pickup,dropoff,pickup_address,dropoff_address,pickup_place_id,dropoff_place_id,pickup_lat,pickup_lng,dropoff_lat,dropoff_lng,estimated_distance_km,route_distance_meters,google_maps_route_url,approved_route_id,route_confirmation_status,driver,vehicle,vehicle_registration,client:clients(name)")
      .order("booking_date", { ascending: false })
      .range(from, from + pageSize - 1);
    assertSetup(error, "Unable to load Booking Diary routes.");
    const page = (data ?? []) as unknown as BookingRouteRow[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

async function fetchRouteApprovals(admin: SupabaseClient) {
  const { data, error } = await admin
    .from("booking_route_approvals")
    .select("*");
  assertSetup(error, "Unable to load approved Booking Diary routes.");
  return (data ?? []) as unknown as ApprovalRow[];
}

export async function buildRouteApprovalQueue(admin: SupabaseClient) {
  const [bookings, approvals] = await Promise.all([
    fetchRouteApprovalBookings(admin),
    fetchRouteApprovals(admin)
  ]);
  return buildRouteApprovalQueueFromRows(bookings, approvals);
}

function approvalValues(payload: RouteApprovalPayload, actorUserId: string, status: RouteApprovalStatus) {
  return {
    normalized_pickup: payload.normalizedPickup,
    normalized_dropoff: payload.normalizedDropoff,
    display_pickup: payload.displayPickup,
    display_dropoff: payload.displayDropoff,
    pickup_canonical_name: payload.pickup.displayName,
    pickup_formatted_address: payload.pickup.fullGoogleAddress,
    pickup_place_id: payload.pickup.googlePlaceId,
    pickup_lat: payload.pickup.latitude,
    pickup_lng: payload.pickup.longitude,
    dropoff_canonical_name: payload.dropoff.displayName,
    dropoff_formatted_address: payload.dropoff.fullGoogleAddress,
    dropoff_place_id: payload.dropoff.googlePlaceId,
    dropoff_lat: payload.dropoff.latitude,
    dropoff_lng: payload.dropoff.longitude,
    google_distance_km: payload.googleDistanceKm ?? null,
    route_distance_meters: payload.routeDistanceMeters ?? (payload.googleDistanceKm ? Math.round(payload.googleDistanceKm * 1000) : null),
    google_maps_route_url: payload.googleMapsRouteUrl ?? null,
    status,
    approved_at: status === "confirmed" ? new Date().toISOString() : null,
    approved_by: status === "confirmed" ? actorUserId : null,
    updated_by: actorUserId,
    created_by: actorUserId
  };
}

function validateApprovalPayload(payload: RouteApprovalPayload) {
  const missing = [
    !payload.normalizedPickup ? "normalized pickup" : "",
    !payload.normalizedDropoff ? "normalized drop-off" : "",
    !hasVerifiedLocation(payload.pickup) ? "verified pickup Maps location" : "",
    !hasVerifiedLocation(payload.dropoff) ? "verified drop-off Maps location" : ""
  ].filter(Boolean);
  if (missing.length) throw new AdminApiError(400, `Approve Route requires ${missing.join(", ")}.`);
}

async function updateMatchingBookings(admin: SupabaseClient, approval: ApprovalRow, status: RouteApprovalStatus) {
  const bookings = await fetchRouteApprovalBookings(admin);
  const ids = bookings
    .filter((booking) =>
      normalizeRouteApprovalName(booking.pickup) === approval.normalized_pickup &&
      normalizeRouteApprovalName(booking.dropoff) === approval.normalized_dropoff
    )
    .map((booking) => booking.id);
  if (!ids.length) return 0;

  const baseValues = status === "confirmed" ? {
    approved_route_id: approval.id,
    route_confirmation_status: "confirmed",
    pickup_place_id: approval.pickup_place_id,
    pickup_address: approval.pickup_formatted_address,
    pickup_lat: numberOrNull(approval.pickup_lat),
    pickup_lng: numberOrNull(approval.pickup_lng),
    dropoff_place_id: approval.dropoff_place_id,
    dropoff_address: approval.dropoff_formatted_address,
    dropoff_lat: numberOrNull(approval.dropoff_lat),
    dropoff_lng: numberOrNull(approval.dropoff_lng),
    estimated_distance_km: numberOrNull(approval.google_distance_km),
    route_distance_meters: numberOrNull(approval.route_distance_meters),
    google_maps_route_url: approval.google_maps_route_url,
    distance_source: "approved_route",
    map_resolution_status: "resolved"
  } : {
    approved_route_id: null,
    route_confirmation_status: status
  };

  for (let index = 0; index < ids.length; index += 100) {
    const chunk = ids.slice(index, index + 100);
    const { error } = await admin.from("booking_diary").update(baseValues).in("id", chunk);
    assertSetup(error, "Unable to update matching Booking Diary routes.");
  }
  return ids.length;
}

export async function approveBookingRoute(admin: SupabaseClient, actorUserId: string, payload: RouteApprovalPayload) {
  validateApprovalPayload(payload);
  const values = approvalValues(payload, actorUserId, "confirmed");
  const { data, error } = await admin
    .from("booking_route_approvals")
    .upsert(values, { onConflict: "normalized_pickup,normalized_dropoff" })
    .select("*")
    .single();
  assertSetup(error, "Unable to approve route.");
  const approval = data as unknown as ApprovalRow;
  const affectedBookings = await updateMatchingBookings(admin, approval, "confirmed");
  return { approval, affectedBookings, queue: await buildRouteApprovalQueue(admin) };
}

export async function reopenBookingRoute(admin: SupabaseClient, actorUserId: string, approvalId: string) {
  const { data, error } = await admin
    .from("booking_route_approvals")
    .update({
      status: "reopened",
      reopened_at: new Date().toISOString(),
      reopened_by: actorUserId,
      updated_by: actorUserId
    })
    .eq("id", approvalId)
    .select("*")
    .single();
  assertSetup(error, "Unable to reopen route.");
  const approval = data as unknown as ApprovalRow;
  const affectedBookings = await updateMatchingBookings(admin, approval, "reopened");
  return { approval, affectedBookings, queue: await buildRouteApprovalQueue(admin) };
}
