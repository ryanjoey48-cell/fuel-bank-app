const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

function loadTypeScriptModule(relativePath, mocks = {}) {
  const filename = path.resolve(relativePath);
  const source = fs.readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded.require = (request) => mocks[request] ?? Module.prototype.require.call(loaded, request);
  loaded._compile(compiled, filename);
  return loaded.exports;
}

const bookingMapsModule = loadTypeScriptModule("lib/booking-maps-backfill.ts");
const {
  canonicalRouteKey,
  countApprovedAliasImpact,
  createDryRunIdempotencyKey,
  isSuspiciousRouteDistance,
  matchHistoricalBooking,
  mergeWithoutManualOverwrite,
  nextResumableBatch,
  normalizeBookingLocationName,
  parseScopedNormalizedAlias,
  partitionHistoricalBookings,
  rollbackMapValues,
  scopedNormalizedAlias
} = bookingMapsModule;

const {
  approvalImpactForScope,
  approvalScopeCount,
  bookingLocationReviewEnabled,
  buildLocationReviewSnapshot,
  locationIssueGroupKey,
  locationReviewSnapshotReconciles,
  occurrencesForLocationIssue,
  recommendApprovalScope,
  requiresAmbiguousGlobalConfirmation,
  shouldShowLocationReviewTab,
  summarizeLocationEvidence
} = loadTypeScriptModule("lib/booking-location-review.ts", {
  "@/lib/booking-maps-backfill": bookingMapsModule
});

const {
  bookingCheckStatus,
  createBookingCheckReview,
  matchingBookingIds
} = loadTypeScriptModule("lib/booking-map-check.ts", {
  "@/lib/booking-maps-backfill": bookingMapsModule
});

const placeVerificationModule = loadTypeScriptModule("lib/google-place-verification.ts");

const locations = [
  {
    id: "airport",
    displayName: "Suvarnabhumi Airport",
    normalizedName: "suvarnabhumi airport",
    fullGoogleAddress: "999 Nong Prue, Bang Phli, Samut Prakan 10540",
    googlePlaceId: "airport-place",
    latitude: 13.69,
    longitude: 100.75,
    countryCode: "TH"
  },
  {
    id: "bangkok-port",
    displayName: "Bangkok Port",
    normalizedName: "bangkok port",
    fullGoogleAddress: "Khlong Toei, Bangkok 10110",
    googlePlaceId: "port-place",
    latitude: 13.70,
    longitude: 100.57,
    countryCode: "TH"
  },
  {
    id: "client-warehouse",
    displayName: "QMB Warehouse",
    normalizedName: "qmb warehouse",
    fullGoogleAddress: "Bang Na, Bangkok",
    googlePlaceId: "warehouse-place",
    latitude: 13.66,
    longitude: 100.66,
    countryCode: "TH"
  }
];

function booking(overrides = {}) {
  return {
    id: "booking-1",
    clientId: null,
    pickup: "ท่าเรือ",
    dropoff: "สุวรรณภูมิ",
    existingDistanceMeters: null,
    manuallyCorrected: false,
    ...overrides
  };
}

test("Thai and English labels normalize consistently without fuzzy matching", () => {
  assert.equal(normalizeBookingLocationName("  ท่าเรือ\u200b  กรุงเทพฯ "), "ท่าเรือ กรุงเทพฯ");
  assert.equal(normalizeBookingLocationName("QMB-WAREHOUSE"), "qmb warehouse");
  assert.notEqual(normalizeBookingLocationName("ท่าเรือ"), normalizeBookingLocationName("Bangkok Port"));
});

test("pickup and drop-off audit issues stay aligned to their own displayed label", () => {
  const match = matchHistoricalBooking(
    booking({ pickup: "SCHAFFENER", dropoff: "Phuket" }),
    [],
    locations
  );
  assert.equal(match.status, "missing_pickup");
  assert.equal(match.pickupIssue.status, "missing_pickup");
  assert.match(match.pickupIssue.reason, /SCHAFFENER/);
  assert.doesNotMatch(match.pickupIssue.reason, /Phuket/);
  assert.equal(match.dropoffIssue.status, "missing_dropoff");
  assert.match(match.dropoffIssue.reason, /Phuket/);
  assert.doesNotMatch(match.dropoffIssue.reason, /SCHAFFENER/);
  const server = fs.readFileSync(path.resolve("lib/booking-maps-server.ts"), "utf8");
  assert.match(server, /recordLocationIssue\([\s\S]*booking\.pickup,[\s\S]*match\.pickupIssue/);
  assert.match(server, /recordLocationIssue\([\s\S]*booking\.dropoff,[\s\S]*match\.dropoffIssue/);
  assert.match(server, /locationIssueGroupKey\(side, label\)/);
  assert.match(server, /occurrencesForLocationIssue\(allOccurrences/);

  const occurrences = [
    { bookingId: "phuket", bookingReference: null, bookingDate: "2026-01-01", clientId: "a", clientName: "Client A", pickup: "SCHAFFNER", dropoff: "ภูเก็ต", side: "dropoff", placeId: null, address: null, routeUrl: null },
    { bookingId: "bkk", bookingReference: null, bookingDate: "2026-01-02", clientId: "b", clientName: "Client B", pickup: "BKK", dropoff: "DELTA บางปู", side: "pickup", placeId: null, address: null, routeUrl: null }
  ];
  assert.notEqual(locationIssueGroupKey("pickup", "BKK"), locationIssueGroupKey("dropoff", "BKK"));
  const phuketRows = occurrencesForLocationIssue(occurrences, {
    side: "dropoff",
    label: "ภูเก็ต",
    bookingIds: new Set(["phuket"])
  });
  assert.equal(phuketRows.length, 1);
  assert.equal(phuketRows[0].clientName, "Client A");
  assert.equal(phuketRows[0].dropoff, "ภูเก็ต");
  assert.equal(phuketRows[0].pickup, "SCHAFFNER");
});

test("repeat routes share a stable cache key", () => {
  assert.equal(
    canonicalRouteKey("bangkok-port", "airport"),
    canonicalRouteKey("bangkok-port", "airport")
  );
  assert.notEqual(
    canonicalRouteKey("bangkok-port", "airport"),
    canonicalRouteKey("airport", "bangkok-port")
  );
});

test("ambiguous approved aliases are never auto-selected", () => {
  const aliases = [
    { canonicalLocationId: "airport", normalizedAlias: "ท่าเรือ", clientId: null },
    { canonicalLocationId: "bangkok-port", normalizedAlias: "ท่าเรือ", clientId: null },
    { canonicalLocationId: "airport", normalizedAlias: "สุวรรณภูมิ", clientId: null }
  ];
  const match = matchHistoricalBooking(booking(), aliases, locations);
  assert.equal(match.status, "ambiguous_location");
  assert.equal(match.pickupLocation, null);
});

test("client-specific aliases override a global alias", () => {
  const aliases = [
    { canonicalLocationId: "bangkok-port", normalizedAlias: "qmb", clientId: null },
    { canonicalLocationId: "client-warehouse", normalizedAlias: "qmb", clientId: "client-qmb" },
    { canonicalLocationId: "airport", normalizedAlias: "สุวรรณภูมิ", clientId: null }
  ];
  const match = matchHistoricalBooking(
    booking({ clientId: "client-qmb", pickup: "QMB" }),
    aliases,
    locations
  );
  assert.equal(match.status, "ready");
  assert.equal(match.pickupLocation.id, "client-warehouse");
});

test("dry-run keys are idempotent and unique per booking", () => {
  assert.equal(
    createDryRunIdempotencyKey("batch-1", "booking-1"),
    createDryRunIdempotencyKey("batch-1", "booking-1")
  );
  assert.notEqual(
    createDryRunIdempotencyKey("batch-1", "booking-1"),
    createDryRunIdempotencyKey("batch-1", "booking-2")
  );
});

test("resumable batches continue after the recorded cursor", () => {
  const rows = ["a", "b", "c", "d", "e"].map((id) => ({ id }));
  const first = nextResumableBatch(rows, null, 2);
  const second = nextResumableBatch(rows, first.nextCursor, 2);
  const third = nextResumableBatch(rows, second.nextCursor, 2);
  assert.deepEqual(first.items.map((row) => row.id), ["a", "b"]);
  assert.deepEqual(second.items.map((row) => row.id), ["c", "d"]);
  assert.deepEqual(third.items.map((row) => row.id), ["e"]);
  assert.equal(third.complete, true);
});

test("historical dry runs exclude future bookings using a fixed cutoff date", () => {
  const rows = [
    { id: "past", booking_date: "2026-08-03" },
    { id: "today", booking_date: "2026-08-04" },
    { id: "future", booking_date: "2026-08-05" }
  ];
  const partition = partitionHistoricalBookings(rows, "2026-08-04");
  assert.deepEqual(partition.historical.map((row) => row.id), ["past", "today"]);
  assert.deepEqual(partition.future.map((row) => row.id), ["future"]);
});

test("global alias approval shows cross-client impact while client aliases stay scoped", () => {
  const rows = [
    { clientId: null, pickup: "สุวรรณภูมิ", dropoff: "A" },
    { clientId: "mass", pickup: "B", dropoff: "สุวรรณภูมิ" },
    { clientId: "apl", pickup: "สุวรรณภูมิ", dropoff: "C" }
  ];
  assert.equal(countApprovedAliasImpact(rows, "สุวรรณภูมิ", null), 3);
  assert.equal(countApprovedAliasImpact(rows, "สุวรรณภูมิ", "mass"), 1);
});

test("side-scoped aliases preserve the original label and do not leak across fields", () => {
  const stored = scopedNormalizedAlias("Warehouse A", "pickup");
  assert.equal(stored, "pickup::warehouse a");
  assert.deepEqual(parseScopedNormalizedAlias(stored), { side: "pickup", normalizedAlias: "warehouse a" });
  const aliases = [
    { canonicalLocationId: "bangkok-port", normalizedAlias: "warehouse a", clientId: null, side: "pickup" },
    { canonicalLocationId: "airport", normalizedAlias: "destination", clientId: null, side: "dropoff" }
  ];
  const original = booking({ pickup: "Warehouse A", dropoff: "Destination" });
  const match = matchHistoricalBooking(original, aliases, locations);
  assert.equal(match.status, "ready");
  assert.equal(match.pickupLocation.id, "bangkok-port");
  assert.equal(match.dropoffLocation.id, "airport");
  assert.equal(original.pickup, "Warehouse A");
  assert.equal(original.dropoff, "Destination");
});

test("location review counts global, client, and booking approval scopes exactly", () => {
  const rows = [
    { bookingId: "a", clientId: "mass" },
    { bookingId: "a", clientId: "mass" },
    { bookingId: "b", clientId: "mass" },
    { bookingId: "c", clientId: "apl" }
  ];
  assert.equal(approvalScopeCount(rows, "global"), 3);
  assert.equal(approvalScopeCount(rows, "client", "mass"), 2);
  assert.equal(approvalScopeCount(rows, "booking", null, "a"), 1);
  assert.equal(approvalImpactForScope({ scope: "global", globalCount: 468, clientCount: 42, routeCount: 7, individualCount: 1 }), 468);
  assert.equal(approvalImpactForScope({ scope: "client", globalCount: 468, clientCount: 42, routeCount: 7, individualCount: 1 }), 42);
  assert.equal(approvalImpactForScope({ scope: "route", globalCount: 468, clientCount: 42, routeCount: 7, individualCount: 1 }), 7);
  assert.equal(requiresAmbiguousGlobalConfirmation(true, "global", false), true);
  assert.equal(requiresAmbiguousGlobalConfirmation(true, "global", true), false);
});

test("one location snapshot reconciles all-client, client, occurrence, and future counts", () => {
  const rows = [
    { id: "a", bookingDate: "2026-08-01", clientId: null, clientName: "Unknown client", pickup: "Airport", dropoff: "Port" },
    { id: "b", bookingDate: "2026-08-02", clientId: "mass", clientName: "MASS", pickup: "Airport", dropoff: "Port" },
    { id: "c", bookingDate: "2026-08-03", clientId: "mass", clientName: "MASS", pickup: "Airport", dropoff: "Other" },
    { id: "future", bookingDate: "2026-08-07", clientId: "mass", clientName: "MASS", pickup: "Airport", dropoff: "Port" }
  ];
  const snapshot = buildLocationReviewSnapshot(rows, { name: "Airport", side: "pickup", cutoffDate: "2026-08-06" });
  assert.equal(snapshot.uniqueAffectedBookings, 3);
  assert.equal(snapshot.fieldOccurrences, 3);
  assert.equal(snapshot.excludedFutureBookings, 1);
  assert.equal(snapshot.clients.reduce((sum, client) => sum + client.count, 0), 3);
  assert.equal(snapshot.clients.find((client) => client.clientId === "mass").count, 2);
  assert.equal(snapshot.clients.find((client) => client.clientId === null).count, 1);
  assert.equal(locationReviewSnapshotReconciles(snapshot), true);
});

test("duplicated booking rows fail the approval snapshot invariant", () => {
  const duplicate = { id: "same", bookingDate: "2026-08-01", clientId: "mass", clientName: "MASS", pickup: "Airport", dropoff: "Port" };
  const snapshot = buildLocationReviewSnapshot([duplicate, duplicate], { name: "Airport", side: "pickup", cutoffDate: "2026-08-06" });
  assert.equal(snapshot.uniqueAffectedBookings, 1);
  assert.equal(snapshot.fieldOccurrences, 2);
  assert.equal(locationReviewSnapshotReconciles(snapshot), false);
});

test("generic location labels default to narrow approval scopes", () => {
  assert.equal(recommendApprovalScope("GLOBAL", "mass"), "client");
  assert.equal(recommendApprovalScope("QMB", null), "booking");
  assert.equal(recommendApprovalScope("สุวรรณภูมิ", null), "global");
});

test("recommendations explain dominant evidence but cap generic labels at low confidence", () => {
  const common = { bookingReference: null, bookingDate: "2026-01-01", clientId: null, clientName: "-", pickup: "A", dropoff: "B", side: "pickup", routeUrl: null };
  const stable = [1, 2, 3, 4].map((index) => ({ ...common, bookingId: String(index), placeId: "place-a", address: "Verified A" }));
  assert.equal(summarizeLocationEvidence("Warehouse A", stable).confidence, "high");
  assert.equal(summarizeLocationEvidence("GLOBAL", stable).confidence, "low");
});

test("location review flag and automatic tab hiding fail closed", () => {
  assert.equal(bookingLocationReviewEnabled("false"), false);
  assert.equal(bookingLocationReviewEnabled("0"), false);
  assert.equal(shouldShowLocationReviewTab({ enabled: true, authorized: true, awaitingReview: 1 }), true);
  assert.equal(shouldShowLocationReviewTab({ enabled: true, authorized: false, awaitingReview: 1 }), false);
  assert.equal(shouldShowLocationReviewTab({ enabled: true, authorized: true, awaitingReview: 0 }), false);
});

test("Booking Diary location review stays admin-only and exposes required review actions", () => {
  const diary = fs.readFileSync(path.resolve("app/(dashboard)/booking-diary/page.tsx"), "utf8");
  const review = fs.readFileSync(path.resolve("components/booking-location-review.tsx"), "utf8");
  assert.match(diary, /currentUser\?\.isAdmin/);
  assert.match(diary, /NEXT_PUBLIC_BOOKING_LOCATION_REVIEW_ENABLED/);
  assert.match(diary, /requestedTab === ["']location-review/);
  assert.ok(diary.indexOf('setActiveTab("locationReview")') < diary.lastIndexOf('setActiveTab("bookingCheck")'));
  assert.match(review, /Approve this booking only/);
  assert.match(review, /Approve location/);
  assert.match(review, /Skip \/ manual review/);
  assert.match(review, /Mark for manual review/);
  assert.match(review, /booking-location-review:\$\{userId\}/);
  assert.match(review, /onAvailabilityChange\(remainingCount\)/);
  assert.match(review, /scrollIntoView/);
  assert.match(review, /googleMapsSearchUrl/);
  assert.match(review, /LocationApprovalDialog/);
});

test("location review approval stays server-authoritative while dispositions never write bookings", () => {
  const review = fs.readFileSync(path.resolve("components/booking-location-review.tsx"), "utf8");
  const approvalRoute = fs.readFileSync(path.resolve("app/api/admin/booking-maps/locations/route.ts"), "utf8");
  assert.match(approvalRoute, /requireAdminAccess\(request\)/);
  assert.match(review, /safeLocalStorage\.setItem/);
  assert.doesNotMatch(review, /\.from\(["']booking_diary["']\)\.(?:update|upsert|insert)/);
});

test("Approve location opens the same-page Google Places modal without changing tabs", () => {
  const auditPage = fs.readFileSync(path.resolve("app/(dashboard)/admin/booking-maps/page.tsx"), "utf8");
  const dialog = fs.readFileSync(path.resolve("components/location-approval-dialog.tsx"), "utf8");
  assert.match(auditPage, /startApproval/);
  assert.match(auditPage, /LocationApprovalDialog/);
  assert.doesNotMatch(auditPage, /router\.push|tab: ["']booking-check/);
  assert.match(dialog, /LocationAutocomplete/);
  assert.match(dialog, /Open in Google Maps/);
  assert.match(dialog, /Original Booking Diary name/);
  assert.match(dialog, /Our confirmed pickup\/drop-off name/);
  assert.match(dialog, /Linked Google Maps location/);
  assert.match(dialog, /Use for all clients with this exact original name/);
  assert.match(dialog, /Use for this client only/);
  assert.match(dialog, /Use for this exact route only/);
  assert.match(dialog, /Mark as needs investigation/);
  assert.match(dialog, /Route-specific scope/);
  assert.match(dialog, /Approve location for/);
  assert.match(dialog, /expectedAffectedCount: affectedCount/);
  assert.match(dialog, /snapshotVersion: snapshot\.snapshotVersion/);
  assert.match(dialog, /confirmedName: confirmedName\.trim\(\)/);
  assert.match(dialog, /\/api\/admin\/booking-maps\/locations/);
  assert.match(dialog, /onClick=\{onClose\}/);
  assert.match(dialog, /max-h-\[90dvh\]/);
  assert.match(dialog, /overflow-y-auto overflow-x-hidden/);
  assert.match(dialog, /snapshot\.uniqueAffectedBookings\.toLocaleString\(\)/);
  assert.match(dialog, /STALE_REVIEW_SNAPSHOT/);
  assert.match(dialog, /setSnapshotReviewed\(false\)/);
  assert.match(dialog, /setConfirmAmbiguousGlobal\(false\)/);
  assert.match(dialog, /outsideThailand \?/);
  assert.doesNotMatch(dialog, /\.from\(["']booking_diary["']\)\.(?:update|upsert|insert)/);
});

test("location approval API preserves separate names and returns a structured stale snapshot", () => {
  const route = fs.readFileSync(path.resolve("app/api/admin/booking-maps/locations/route.ts"), "utf8");
  const server = fs.readFileSync(path.resolve("lib/booking-maps-server.ts"), "utf8");
  assert.match(route, /body\.side/);
  assert.match(route, /STALE_REVIEW_SNAPSHOT/);
  assert.match(route, /snapshot: error\.snapshot/);
  assert.match(server, /target_alias: confirmedName/);
  assert.match(server, /target_normalized_alias: normalizedAlias/);
  assert.match(server, /scopedNormalizedAlias\(input\.alias, input\.side\)/);
  assert.match(server, /displayName = input\.displayName\?\.trim\(\) \|\| place\.displayName/);
  assert.doesNotMatch(server, /from\(["']booking_diary["']\)\.update/);
});

test("Places API New uses one session token for autocomplete and details without legacy fallback", () => {
  const autocomplete = fs.readFileSync(path.resolve("app/api/location-autocomplete/route.ts"), "utf8");
  const details = fs.readFileSync(path.resolve("app/api/location-details/route.ts"), "utf8");
  const component = fs.readFileSync(path.resolve("components/location-autocomplete.tsx"), "utf8");
  const loader = fs.readFileSync(path.resolve("components/google-maps-loader.tsx"), "utf8");

  assert.match(autocomplete, /places\.googleapis\.com\/v1\/places:autocomplete/);
  assert.match(autocomplete, /sessionToken: sessionToken \|\| undefined/);
  assert.match(details, /detailsUrl\.searchParams\.set\("sessionToken", sessionToken\)/);
  assert.match(component, /location-details\?placeId=.*sessionToken=/s);
  assert.match(component, /setSessionToken\(crypto\.randomUUID\(\)\)/);
  assert.match(loader, /libraries: "places"/);
  assert.match(loader, /importLibrary\("places"\)/);
  assert.match(component, /browserConfigured && !browserPlacesReady/);
  assert.match(component, /AutocompleteSuggestion/);
  assert.match(component, /AutocompleteSessionToken/);
  assert.match(component, /prediction\.toPlace\(\)/);
  assert.match(component, /place\.fetchFields/);
  assert.doesNotMatch(component, /Manual entry still allowed/i);
  assert.doesNotMatch(autocomplete, /maps\.googleapis\.com\/maps\/api\/place\/autocomplete/);
  assert.doesNotMatch(details, /maps\.googleapis\.com\/maps\/api\/place\/details/);
});

test("browser and server Google credentials are separate and approval never accepts manual text", () => {
  const maps = fs.readFileSync(path.resolve("lib/google-maps.ts"), "utf8");
  const dialog = fs.readFileSync(path.resolve("components/location-approval-dialog.tsx"), "utf8");
  const example = fs.readFileSync(path.resolve(".env.example"), "utf8");
  assert.match(maps, /GOOGLE_MAPS_SERVER_API_KEY/);
  assert.match(maps, /NEXT_PUBLIC_GOOGLE_MAPS_API_KEY/);
  assert.match(example, /GOOGLE_MAPS_SERVER_API_KEY=/);
  assert.match(dialog, /!selected\?\.place_id/);
  assert.match(dialog, /GoogleMapsLoader/);
  assert.match(dialog, /Mark as needs investigation/);
  assert.doesNotMatch(dialog, /Manual entry still allowed/i);
});

test("a server-verified selected place is reused during approval", () => {
  delete global.__fuelBankVerifiedGooglePlaces;
  const place = {
    placeId: "places/test-place",
    displayName: "Test place",
    fullGoogleAddress: "Test address, Thailand",
    latitude: 13.1,
    longitude: 100.1,
    countryCode: "TH"
  };
  placeVerificationModule.rememberVerifiedGooglePlace(place);
  assert.deepEqual(placeVerificationModule.getRememberedVerifiedGooglePlace("test-place"), {
    ...place,
    placeId: "test-place"
  });

  const details = fs.readFileSync(path.resolve("app/api/location-details/route.ts"), "utf8");
  const server = fs.readFileSync(path.resolve("lib/booking-maps-server.ts"), "utf8");
  assert.match(details, /rememberVerifiedGooglePlace\(place\)/);
  assert.match(server, /getRememberedVerifiedGooglePlace\(placeId\)/);
  assert.match(server, /if \(cachedPlace\) return cachedPlace/);
});

test("Approved Directory exposes original, confirmed, Google, scope, edit, and undo controls", () => {
  const review = fs.readFileSync(path.resolve("components/booking-location-review.tsx"), "utf8");
  const mappingRoute = fs.readFileSync(path.resolve("app/api/admin/booking-maps/locations/[id]/route.ts"), "utf8");
  assert.match(review, /Original alias/);
  assert.match(review, /Our confirmed location name/);
  assert.match(review, /Google Maps place/);
  assert.match(review, /Linked bookings/);
  assert.match(review, /Confirm undo/);
  assert.match(mappingRoute, /requireAdminAccess\(request\)/);
  assert.match(mappingRoute, /renameApprovedLocationMapping/);
  assert.match(mappingRoute, /undoApprovedLocationMapping/);
});

test("booking checks complete only after client, pickup, and drop-off are each confirmed", () => {
  const original = { clientId: "client-a", clientName: "Client A", pickup: "A", dropoff: "B" };
  const base = {
    current: null,
    actorUserId: "admin-user",
    now: "2026-08-05T10:00:00.000Z",
    original,
    client: { id: "client-a", name: "Client A" },
    pickup: { displayName: "A", fullGoogleAddress: "Address A", googlePlaceId: "place-a", latitude: 1, longitude: 2 },
    dropoff: { displayName: "B", fullGoogleAddress: "Address B", googlePlaceId: "place-b", latitude: 3, longitude: 4 }
  };
  const partial = createBookingCheckReview({ ...base, action: "confirm_client" });
  assert.equal(bookingCheckStatus(partial), "partial");
  const completed = createBookingCheckReview({ ...base, current: partial, action: "confirm_all" });
  assert.equal(bookingCheckStatus(completed), "completed");
  assert.deepEqual(completed.original, original);
  assert.equal(completed.pickup.confirmedBy, "admin-user");
  assert.equal(completed.dropoff.confirmedAt, "2026-08-05T10:00:00.000Z");
});

test("apply matching scope requires the same client and exact directional route", () => {
  const rows = [
    { id: "one", clientId: "a", pickup: "Port", dropoff: "Airport" },
    { id: "two", clientId: "a", pickup: " port ", dropoff: "AIRPORT" },
    { id: "other-client", clientId: "b", pickup: "Port", dropoff: "Airport" },
    { id: "reverse", clientId: "a", pickup: "Airport", dropoff: "Port" }
  ];
  assert.deepEqual(matchingBookingIds(rows, rows[0]), ["one", "two"]);
});

test("Booking check UI exposes field confirmations, evidence, filters, and safe audit-only writes", () => {
  const diary = fs.readFileSync(path.resolve("app/(dashboard)/booking-diary/page.tsx"), "utf8");
  const component = fs.readFileSync(path.resolve("components/booking-map-check.tsx"), "utf8");
  const route = fs.readFileSync(path.resolve("app/api/admin/booking-maps/booking-checks/route.ts"), "utf8");
  const server = fs.readFileSync(path.resolve("lib/booking-maps-server.ts"), "utf8");
  assert.match(diary, /Booking check/);
  assert.match(diary, /booking-check/);
  for (const label of ["Confirm all and next", "Confirm client", "Confirm pickup", "Confirm drop-off", "Edit client", "Change\/search pickup", "Change\/search drop-off", "Skip for later", "Mark as needs investigation", "Apply to matching bookings"]) {
    assert.match(component, new RegExp(label));
  }
  assert.match(component, /Previous bookings with this client or route/);
  assert.match(component, /createClient\(newClientName\)/);
  assert.match(route, /requireAdminAccess\(request\)/);
  assert.doesNotMatch(route, /booking_diary.*(?:update|upsert|insert)/s);
  assert.match(server, /fetchGooglePlace\(input\.pickup\.googlePlaceId\)/);
  assert.match(server, /location_review:[\s\S]*\[input\.side\]: placeValue/);
  assert.match(server, /from\("booking_map_backfill_items"\)[\s\S]*\.upsert\(rows/);
});

test("rollback restores the exact before snapshot", () => {
  const before = { pickup_address: "manual address", route_distance_meters: 4000 };
  const restored = rollbackMapValues(before);
  assert.deepEqual(restored, before);
  assert.notEqual(restored, before);
});

test("manual values are not overwritten without explicit confirmation", () => {
  const merged = mergeWithoutManualOverwrite(
    { pickup_address: "manual address", route_distance_meters: null },
    { pickup_address: "proposed address", route_distance_meters: 29000 },
    ["pickup_address", "route_distance_meters"]
  );
  assert.equal(merged.pickup_address, "manual address");
  assert.equal(merged.route_distance_meters, 29000);
});

test("suspicious routes flag implausible and conflicting distances", () => {
  assert.ok(isSuspiciousRouteDistance({ distanceMeters: 3_507_900 }).length > 0);
  assert.ok(isSuspiciousRouteDistance({ distanceMeters: 29_000, existingDistanceMeters: 4_000 }).length > 0);
  assert.ok(isSuspiciousRouteDistance({ distanceMeters: 30_000, pickupEqualsDropoff: true }).length > 0);
});

test("migration creates isolated dry-run infrastructure and never backfills bookings", () => {
  const migration = fs.readFileSync(
    path.resolve("supabase/migrations/20260731_booking_maps_backfill.sql"),
    "utf8"
  );
  assert.match(migration, /create table public\.canonical_locations/i);
  assert.match(migration, /create table public\.canonical_location_aliases/i);
  assert.match(migration, /create table public\.canonical_route_cache/i);
  assert.match(migration, /create table public\.booking_map_backfill_batches/i);
  assert.match(migration, /create table public\.booking_map_backfill_items/i);
  assert.match(migration, /create table public\.booking_map_backfill_changes/i);
  assert.match(migration, /alter table public\.canonical_locations enable row level security/i);
  assert.match(migration, /revoke all on public\.booking_map_backfill_items from anon, authenticated/i);
  assert.doesNotMatch(migration, /(?:update|delete from|insert into)\s+public\.booking_diary/i);
  assert.doesNotMatch(migration, /drop table|truncate/i);
});

test("dry-run API contains no Booking Diary update operation", () => {
  const server = fs.readFileSync(path.resolve("lib/booking-maps-server.ts"), "utf8");
  const dryRunStart = server.indexOf("export async function createBookingMapsDryRun");
  const dryRunSource = server.slice(dryRunStart);
  assert.doesNotMatch(dryRunSource, /from\("booking_diary"\)\s*\n?\s*\.update/);
  assert.match(dryRunSource, /from\("booking_map_backfill_items"\)/);
  assert.match(dryRunSource, /\.range\(from, from \+ pageSize - 1\)/);
});
