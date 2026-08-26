import { normalizeBookingLocationName } from "@/lib/booking-maps-backfill";

export type LocationApprovalScope = "global" | "client" | "booking";
export type LocationConfidence = "high" | "medium" | "low";

export type LocationReviewOccurrence = {
  bookingId: string;
  bookingReference: string | null;
  bookingDate: string;
  clientId: string | null;
  clientName: string;
  pickup: string;
  dropoff: string;
  side: "pickup" | "dropoff";
  placeId: string | null;
  address: string | null;
  routeUrl: string | null;
};

export type LocationReviewSnapshotRow = {
  id: string;
  bookingDate: string;
  clientId: string | null;
  clientName: string;
  pickup: string;
  dropoff: string;
};

export type LocationReviewSnapshotData = {
  originalName: string;
  normalizedName: string;
  side: "pickup" | "dropoff";
  cutoffDate: string;
  uniqueAffectedBookings: number;
  fieldOccurrences: number;
  excludedFutureBookings: number;
  originalNames: Array<{ name: string; count: number }>;
  clients: Array<{ key: string; clientId: string | null; clientName: string; count: number }>;
  routes: Array<{
    key: string;
    clientId: string | null;
    clientName: string;
    pickup: string;
    dropoff: string;
    count: number;
  }>;
  bookingIds: string[];
};

export function buildLocationReviewSnapshot(
  bookings: LocationReviewSnapshotRow[],
  input: { name: string; side: "pickup" | "dropoff"; cutoffDate: string }
): LocationReviewSnapshotData {
  const normalizedName = normalizeBookingLocationName(input.name);
  const matchesName = (row: LocationReviewSnapshotRow) =>
    normalizeBookingLocationName(input.side === "pickup" ? row.pickup : row.dropoff) === normalizedName;
  const historicalMatches = bookings.filter((row) => row.bookingDate <= input.cutoffDate && matchesName(row));
  const futureMatches = bookings.filter((row) => row.bookingDate > input.cutoffDate && matchesName(row));
  const uniqueRows = [...new Map(historicalMatches.map((row) => [row.id, row])).values()];
  const originalNames = new Map<string, number>();
  const clients = new Map<string, { key: string; clientId: string | null; clientName: string; count: number }>();
  const routes = new Map<string, LocationReviewSnapshotData["routes"][number]>();

  for (const row of historicalMatches) {
    const originalName = input.side === "pickup" ? row.pickup : row.dropoff;
    originalNames.set(originalName, (originalNames.get(originalName) ?? 0) + 1);
    const clientKey = row.clientId ?? "unknown";
    const client = clients.get(clientKey) ?? {
      key: clientKey,
      clientId: row.clientId,
      clientName: row.clientName || "Unknown client",
      count: 0
    };
    client.count += 1;
    clients.set(clientKey, client);

    const routeKey = [
      clientKey,
      normalizeBookingLocationName(row.pickup),
      normalizeBookingLocationName(row.dropoff)
    ].join("::");
    const route = routes.get(routeKey) ?? {
      key: routeKey,
      clientId: row.clientId,
      clientName: row.clientName || "Unknown client",
      pickup: row.pickup,
      dropoff: row.dropoff,
      count: 0
    };
    route.count += 1;
    routes.set(routeKey, route);
  }

  return {
    originalName: input.name,
    normalizedName,
    side: input.side,
    cutoffDate: input.cutoffDate,
    uniqueAffectedBookings: uniqueRows.length,
    fieldOccurrences: historicalMatches.length,
    excludedFutureBookings: new Set(futureMatches.map((row) => row.id)).size,
    originalNames: [...originalNames.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    clients: [...clients.values()].sort((a, b) => b.count - a.count || a.clientName.localeCompare(b.clientName)),
    routes: [...routes.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)),
    bookingIds: uniqueRows.map((row) => row.id).sort()
  };
}

export function locationReviewSnapshotReconciles(snapshot: LocationReviewSnapshotData) {
  const clientTotal = snapshot.clients.reduce((sum, client) => sum + client.count, 0);
  return (
    snapshot.uniqueAffectedBookings === snapshot.fieldOccurrences &&
    clientTotal === snapshot.uniqueAffectedBookings &&
    snapshot.clients.every((client) => client.count <= snapshot.uniqueAffectedBookings) &&
    snapshot.routes.every((route) => route.count <= snapshot.uniqueAffectedBookings)
  );
}

export function locationIssueGroupKey(
  side: LocationReviewOccurrence["side"],
  label: string
) {
  return `${side}:${normalizeBookingLocationName(label)}`;
}

export function occurrencesForLocationIssue(
  occurrences: LocationReviewOccurrence[],
  input: {
    side: LocationReviewOccurrence["side"];
    label: string;
    bookingIds: Set<string>;
  }
) {
  const normalizedLabel = normalizeBookingLocationName(input.label);
  return occurrences.filter((row) => {
    if (!input.bookingIds.has(row.bookingId) || row.side !== input.side) return false;
    const value = row.side === "pickup" ? row.pickup : row.dropoff;
    return normalizeBookingLocationName(value) === normalizedLabel;
  });
}

const GENERIC_LOCATION_LABELS = new Set([
  "global",
  "schenker",
  "cal comp",
  "calcomp",
  "qmb",
  "phuket",
  "ภูเก็ต",
  "ท่าเรือ",
  "port"
]);

export function isRiskyGenericLocation(label: string) {
  return GENERIC_LOCATION_LABELS.has(normalizeBookingLocationName(label));
}

export function approvalScopeCount(
  occurrences: LocationReviewOccurrence[],
  scope: LocationApprovalScope,
  clientId?: string | null,
  bookingId?: string | null
) {
  if (scope === "booking") {
    return new Set(occurrences.filter((row) => row.bookingId === bookingId).map((row) => row.bookingId)).size;
  }
  if (scope === "client") {
    return new Set(occurrences.filter((row) => row.clientId === clientId).map((row) => row.bookingId)).size;
  }
  return new Set(occurrences.map((row) => row.bookingId)).size;
}

export function approvalImpactForScope(input: {
  scope: "global" | "client" | "route" | "individual";
  globalCount: number;
  clientCount: number;
  routeCount: number;
  individualCount: number;
}) {
  if (input.scope === "global") return input.globalCount;
  if (input.scope === "client") return input.clientCount;
  if (input.scope === "route") return input.routeCount;
  return input.individualCount;
}

export function requiresAmbiguousGlobalConfirmation(
  ambiguous: boolean,
  scope: "global" | "client" | "route" | "individual",
  confirmed: boolean
) {
  return ambiguous && scope === "global" && !confirmed;
}

export function recommendApprovalScope(label: string, clientId: string | null) {
  if (isRiskyGenericLocation(label)) return clientId ? "client" : "booking";
  return "global";
}

export function summarizeLocationEvidence(label: string, occurrences: LocationReviewOccurrence[]) {
  const evidence = new Map<string, {
    placeId: string | null;
    address: string | null;
    count: number;
  }>();
  const routes = new Map<string, number>();
  for (const row of occurrences) {
    const evidenceKey = row.placeId || row.address;
    if (evidenceKey) {
      const current = evidence.get(evidenceKey) ?? {
        placeId: row.placeId,
        address: row.address,
        count: 0
      };
      current.count += 1;
      evidence.set(evidenceKey, current);
    }
    const route = `${row.pickup} → ${row.dropoff}`;
    routes.set(route, (routes.get(route) ?? 0) + 1);
  }
  const candidates = [...evidence.values()].sort((a, b) => b.count - a.count);
  const top = candidates[0] ?? null;
  const evidenceTotal = candidates.reduce((sum, item) => sum + item.count, 0);
  const share = top && evidenceTotal ? top.count / evidenceTotal : 0;
  const risky = isRiskyGenericLocation(label);
  const confidence: LocationConfidence =
    !risky && top && top.count >= 3 && share >= 0.8
      ? "high"
      : !risky && top && top.count >= 2 && share >= 0.6
        ? "medium"
        : "low";
  const reason = !top
    ? "No trustworthy previous Place ID or full address exists. Confirm with Google Places."
    : risky
      ? "This generic label has represented multiple facilities, so historical evidence is advisory only."
      : `${top.count} of ${evidenceTotal} previous mapped uses point to the same location.`;
  return {
    confidence,
    reason,
    recommended: top,
    candidates,
    routes: [...routes.entries()]
      .map(([route, count]) => ({ route, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
  };
}

export function shouldShowLocationReviewTab(input: {
  enabled: boolean;
  authorized: boolean;
  awaitingReview: number;
}) {
  return input.enabled && input.authorized && input.awaitingReview > 0;
}

export function bookingLocationReviewEnabled(value: string | undefined) {
  return value !== "false" && value !== "0";
}
