const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

function loadTypeScriptModule(relativePath) {
  const filename = path.resolve(relativePath);
  const source = fs.readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded._compile(compiled, filename);
  return loaded.exports;
}

const {
  findExactSavedLocation,
  normalizeSavedLocationName,
  rankSavedLocations,
  savedLocationHasVerifiedMapsData
} = loadTypeScriptModule("lib/saved-locations.ts");

function savedLocation(overrides = {}) {
  return {
    id: "location-id",
    location_type: "pickup",
    display_name: "Main Warehouse",
    normalized_name: "main warehouse",
    google_place_id: "place-1",
    formatted_address: "1 Warehouse Road, Bangkok",
    latitude: 13.75,
    longitude: 100.5,
    use_count: 1,
    last_used_at: "2026-07-21T00:00:00Z",
    created_at: "2026-07-21T00:00:00Z",
    updated_at: "2026-07-21T00:00:00Z",
    created_by: null,
    ...overrides
  };
}

test("saved locations use exact normalized names without fuzzy matching", () => {
  const locations = [savedLocation()];
  assert.equal(normalizeSavedLocationName("  MAIN   Warehouse "), "main warehouse");
  assert.equal(findExactSavedLocation(locations, "pickup", " main  warehouse ").id, "location-id");
  assert.equal(findExactSavedLocation(locations, "dropoff", "Main Warehouse"), null);
  assert.equal(findExactSavedLocation(locations, "pickup", "Main Warehouse Bangkok"), null);
});

test("saved suggestions rank frequency first, then recency, and keep location types separate", () => {
  const ranked = rankSavedLocations([
    savedLocation({ id: "recent", display_name: "Recent", normalized_name: "recent", use_count: 3, last_used_at: "2026-07-21T00:00:00Z" }),
    savedLocation({ id: "frequent", display_name: "Frequent", normalized_name: "frequent", use_count: 5, last_used_at: "2026-07-01T00:00:00Z" }),
    savedLocation({ id: "older", display_name: "Older", normalized_name: "older", use_count: 3, last_used_at: "2026-07-10T00:00:00Z" }),
    savedLocation({ id: "dropoff", location_type: "dropoff", display_name: "Drop", normalized_name: "drop", use_count: 99 })
  ], "pickup");
  assert.deepEqual(ranked.map((location) => location.id), ["frequent", "recent", "older"]);
});

test("verified saved data requires an address plus a place id or complete coordinates", () => {
  assert.equal(savedLocationHasVerifiedMapsData(savedLocation()), true);
  assert.equal(savedLocationHasVerifiedMapsData(savedLocation({ google_place_id: null })), true);
  assert.equal(savedLocationHasVerifiedMapsData(savedLocation({ google_place_id: null, longitude: null })), false);
  assert.equal(savedLocationHasVerifiedMapsData(savedLocation({ formatted_address: "" })), false);
});

test("migration backfills safely, deduplicates by exact normalized alias, and never mutates bookings", () => {
  const migration = fs.readFileSync(path.resolve("supabase/migrations/20260721120000_add_saved_booking_locations.sql"), "utf8");
  const bookingColumns = migration.indexOf("alter table if exists public.booking_diary");
  const savedTable = migration.indexOf("create table if not exists public.saved_locations");
  const backfill = migration.indexOf("with location_candidates as");
  const rememberFunction = migration.indexOf("create or replace function public.remember_saved_location");
  const bookingTrigger = migration.indexOf("create trigger remember_booking_diary_locations");
  const tripColumns = migration.indexOf("alter table if exists public.trip_journeys");
  const schemaReload = migration.lastIndexOf("notify pgrst, 'reload schema'");

  assert.ok(bookingColumns >= 0);
  assert.ok(savedTable > bookingColumns);
  assert.ok(backfill > savedTable);
  assert.ok(rememberFunction > backfill);
  assert.ok(bookingTrigger > rememberFunction);
  assert.ok(tripColumns > bookingTrigger);
  assert.ok(schemaReload > tripColumns);
  for (const column of ["pickup_place_id", "pickup_address", "pickup_lat", "pickup_lng", "dropoff_place_id", "dropoff_address", "dropoff_lat", "dropoff_lng"]) {
    assert.match(migration.slice(bookingColumns, savedTable), new RegExp(`add column if not exists ${column} (?:text|numeric)`, "i"));
  }
  assert.match(migration, /create table if not exists public\.saved_locations/i);
  assert.match(migration, /unique \(location_type, normalized_name\)/i);
  assert.match(migration, /partition by candidate\.location_type, candidate\.normalized_name/i);
  assert.match(migration, /order by candidate\.used_at desc, candidate\.booking_id desc/i);
  assert.match(migration, /on conflict \(location_type, normalized_name\) do update/i);
  assert.match(migration, /after insert or update of[\s\S]*on public\.booking_diary/i);
  assert.match(migration, /if tg_op = 'INSERT' then/i);
  assert.match(migration, /coalesce\(nullif\(btrim\(booking\.pickup_address\), ''\), btrim\(booking\.pickup\)\)/i);
  assert.match(migration, /nullif\(btrim\(booking\.pickup_address\), ''\) is not null\s+or\s+nullif\(btrim\(booking\.pickup_place_id\), ''\) is not null/i);
  assert.match(migration, /drop constraint if exists saved_locations_verified_location_check/i);
  assert.match(migration, /where nullif\(btrim\(formatted_address\), ''\) is null/i);
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /grant select on public\.saved_locations to authenticated/i);
  assert.doesNotMatch(migration, /on delete cascade/i);
  assert.doesNotMatch(migration, /(?:update|delete from)\s+public\.booking_diary/i);
});

test("Booking Diary lookup is local, race guarded, and respects manual Maps edits", () => {
  const page = fs.readFileSync(path.resolve("app/(dashboard)/booking-diary/page.tsx"), "utf8");
  const data = fs.readFileSync(path.resolve("lib/data.ts"), "utf8");
  assert.match(data, /from\("saved_locations"\)/);
  assert.match(page, /findExactSavedLocation\(savedLocations, "pickup", form\.pickup\)/);
  assert.match(page, /savedLookupRequestRef\.current\.pickup !== requestId/);
  assert.match(page, /initialLocationNameRef\.current\.pickup/);
  assert.match(page, /manualLocationEditRef\.current\.pickup/);
  assert.match(page, /manualLocationEditRef\.current\.dropoff/);
  assert.match(page, /onSelectOption=\{\(option\) => \{[\s\S]*applySavedLocation\("pickup"/);
  assert.match(page, /Previously used location/);
  assert.match(page, /สถานที่ที่เคยใช้/);
});

test("Trip Journey receives and persists booking aliases plus verified Maps fields", () => {
  const data = fs.readFileSync(path.resolve("lib/data.ts"), "utf8");
  const tripPage = fs.readFileSync(path.resolve("app/(dashboard)/trip-journey/page.tsx"), "utf8");
  assert.match(data, /pickup_display_name:\s*pickupDisplay/);
  assert.match(data, /pickup_place_id:\s*booking\.pickup_place_id/);
  assert.match(data, /pickup_lat:\s*parseOptionalNumeric\(booking\.pickup_lat\)/);
  assert.match(data, /booking_estimated_km:\s*bookingEstimatedKm/);
  assert.match(tripPage, /<LocationAutocomplete[\s\S]*updateTripStructuredLocation\("pickup"/);
  assert.match(tripPage, /pickup_place_id:\s*form\.pickup_place_id \|\| null/);
  assert.match(tripPage, /dropoff_lng:\s*toNumber\(form\.dropoff_lng\)/);
  assert.match(tripPage, /ใช้สถานที่ที่บันทึกไว้แล้ว/);
});
