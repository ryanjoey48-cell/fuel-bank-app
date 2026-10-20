const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const { PGlite } = require("@electric-sql/pglite");
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

const geocoding = loadTypeScriptModule("lib/location-geocoding.ts");
const signing = loadTypeScriptModule("lib/location-geocoding-server.ts");
const migration = fs.readFileSync(path.resolve("supabase/migrations/20261020100000_ees_locations_geoapify_rate_limits.sql"), "utf8");
const lookupApi = fs.readFileSync(path.resolve("app/api/locations/geocode/route.ts"), "utf8");
const pinApi = fs.readFileSync(path.resolve("app/api/locations/map-pins/route.ts"), "utf8");
const directory = fs.readFileSync(path.resolve("components/locations-directory.tsx"), "utf8");
const dialog = fs.readFileSync(path.resolve("components/location-smart-pin-dialog.tsx"), "utf8");
const keyExample = fs.readFileSync(path.resolve(".env.example"), "utf8");

const destination = {
  company_name: "Pacific Dyeing & Finishing",
  thai_name: "บริษัท แปซิฟิค ไดอิ้ง แอนด์ ฟินิชชิ่ง จำกัด",
  alternative_names: ["Pacific Dyeing"],
  address: "99/1 Moo 4, Setthakit 1 Road, Om Noi, Krathum Baen, Samut Sakhon 74130",
  province: "Samut Sakhon"
};

function providerResult(overrides = {}) {
  return {
    place_id: "geo-place-1",
    name: destination.company_name,
    formatted: "Pacific Dyeing & Finishing, 99/1 Setthakit 1 Road, Om Noi, Samut Sakhon 74130, Thailand",
    address_line1: "Pacific Dyeing & Finishing",
    address_line2: "99/1 Setthakit 1 Road, Om Noi, Samut Sakhon 74130",
    housenumber: "99/1",
    street: "Setthakit 1 Road",
    city: "Om Noi",
    county: "Krathum Baen",
    state: "Samut Sakhon",
    postcode: "74130",
    country_code: "th",
    result_type: "amenity",
    lat: 13.65,
    lon: 100.27,
    rank: { confidence: 0.94, confidence_building_level: 0.89 },
    datasource: { attribution: "© OpenStreetMap contributors", license: "ODbL", sourcename: "openstreetmap" },
    ...overrides
  };
}

test("Geoapify query includes English and Thai names, aliases, full address, province and Thailand", () => {
  const query = geocoding.buildGeoapifyQuery(destination);
  for (const value of [destination.company_name, destination.thai_name, "Pacific Dyeing", destination.address, destination.province, "Thailand"]) {
    assert.ok(query.includes(value), `query includes ${value}`);
  }
});

test("exact amenity matches pass only with Thailand, confidence, stored name and address evidence", () => {
  const matches = geocoding.filterReliableGeoapifyResults({ results: [providerResult()] }, destination);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].placeId, "geo-place-1");
  assert.equal(matches[0].latitude, 13.65);
  assert.equal(matches[0].attribution, "© OpenStreetMap contributors");
  assert.equal(geocoding.filterReliableGeoapifyResults({ results: [providerResult({ state: "Chon Buri" })] }, destination).length, 0);
  assert.equal(geocoding.filterReliableGeoapifyResults({ results: [providerResult({ state: "Samut Sakhon" })] }, { ...destination, province: "สมุทรสาคร" }).length, 1);
  assert.equal(geocoding.filterReliableGeoapifyResults({ results: [providerResult({ rank: { confidence: 0.3 } })] }, destination).length, 0);
});

test("ambiguous reliable matches remain separate candidates for staff selection", () => {
  const first = providerResult();
  const second = providerResult({ place_id: "geo-place-2", lat: 13.66, lon: 100.28 });
  const matches = geocoding.filterReliableGeoapifyResults({ results: [first, second] }, destination);
  assert.deepEqual(matches.map((candidate) => candidate.placeId), ["geo-place-1", "geo-place-2"]);
});

test("no results and broad town-centre matches produce no candidate", () => {
  const cityResult = providerResult({ name: "Om Noi", result_type: "city", lat: 13.65, lon: 100.27 });
  const approximateStreet = providerResult({ name: "Setthakit 1 Road", result_type: "street", rank: { confidence: 0.99 } });
  assert.deepEqual(geocoding.filterReliableGeoapifyResults({ results: [] }, destination), []);
  assert.deepEqual(geocoding.filterReliableGeoapifyResults({ results: [cityResult, approximateStreet] }, destination), []);
});

test("candidate confirmation tokens are actor-, destination-, pin-type- and expiry-bound", () => {
  const [candidate] = geocoding.filterReliableGeoapifyResults({ results: [providerResult()] }, destination);
  const secret = "unit-test-service-secret";
  const token = signing.signGeoapifyCandidate(candidate, {
    actorId: "10000000-0000-4000-8000-000000000001",
    locationId: "20000000-0000-4000-8000-000000000001",
    pinType: "destination"
  }, secret, 1000);
  const expected = {
    actorId: "10000000-0000-4000-8000-000000000001",
    locationId: "20000000-0000-4000-8000-000000000001",
    pinType: "destination"
  };
  assert.equal(signing.verifyGeoapifyConfirmationToken(token, expected, secret, 2000).latitude, 13.65);
  assert.equal(signing.verifyGeoapifyConfirmationToken(token, { ...expected, actorId: "10000000-0000-4000-8000-000000000002" }, secret, 2000), null);
  assert.equal(signing.verifyGeoapifyConfirmationToken(token, { ...expected, pinType: "truck_entrance" }, secret, 2000), null);
  assert.equal(signing.verifyGeoapifyConfirmationToken(token, expected, secret, 1000 + 15 * 60 * 1000 + 1), null);
  assert.equal(signing.verifyGeoapifyConfirmationToken(`${token}x`, expected, secret, 2000), null);
  const payload = signing.verifyGeoapifyConfirmationToken(token, expected, secret, 2000);
  assert.match(signing.geoapifySourceReference(payload), /OpenStreetMap contributors/);
});

test("lookup and pin-confirmation state supports explicit selection, cancel/reset and retry after failed save", () => {
  const [candidate] = geocoding.filterReliableGeoapifyResults({ results: [providerResult()] }, destination);
  const signed = { ...candidate, confirmationToken: "signed" };
  let state = geocoding.smartPinReducer(geocoding.initialSmartPinState, { type: "lookup_started" });
  assert.equal(state.stage, "searching");
  state = geocoding.smartPinReducer(state, { type: "lookup_succeeded", candidates: [signed] });
  assert.equal(state.stage, "choosing");
  assert.equal(state.selectedId, "", "the first result is never auto-confirmed");
  state = geocoding.smartPinReducer(state, { type: "selected", id: signed.id });
  state = geocoding.smartPinReducer(state, { type: "save_started" });
  state = geocoding.smartPinReducer(state, { type: "save_failed" });
  assert.equal(state.stage, "save_error");
  assert.equal(state.selectedId, signed.id, "retry keeps the reviewed result selected");
  state = geocoding.smartPinReducer(state, { type: "reset" });
  assert.equal(state.stage, "idle");
  assert.equal(state.candidates.length, 0, "cancel/reset clears transient results");
  const noMatch = geocoding.smartPinReducer(state, { type: "lookup_succeeded", candidates: [] });
  assert.equal(noMatch.stage, "not_found");
});

test("lookup API stays server-only, makes one upstream request and never retries or exposes the key", () => {
  assert.match(lookupApi, /process\.env\.GEOAPIFY_API_KEY/);
  assert.doesNotMatch(lookupApi, /NEXT_PUBLIC_GEOAPIFY_API_KEY/);
  assert.equal((lookupApi.match(/\bfetch\(/g) ?? []).length, 1);
  assert.match(lookupApi, /ees_locations_reserve_geocode_lookup/);
  assert.match(lookupApi, /countrycode:th/);
  assert.match(lookupApi, /request\.signal/);
  assert.match(keyExample, /^GEOAPIFY_API_KEY=$/m);
  assert.doesNotMatch(keyExample, /^NEXT_PUBLIC_GEOAPIFY_API_KEY=/m);
});

test("pin writes accept signed Geoapify candidates and restrict raw manual coordinates to administrators", () => {
  assert.match(pinApi, /verifyGeoapifyConfirmationToken/);
  assert.match(pinApi, /confirmation\.latitude/);
  assert.match(pinApi, /manual_correction !== true/);
  assert.match(pinApi, /hasPermission\(access, "admin:user_management"\)/);
  assert.match(pinApi, /Select a reviewed Geoapify result before saving a pin/);
  assert.match(pinApi, /abortSignal\(request\.signal\)/);
  assert.match(directory, /onClick=\{\(\) => openSmartPin\(location\)\}/);
  assert.match(directory, /confirmation_token: confirmationToken/);
  assert.match(dialog, /state\.selectedId === candidate\.id/);
  assert.match(dialog, /onClick=\{\(\) => void confirmLocation\(\)\}/);
  assert.match(dialog, /copy\.locationNotFound/);
  assert.match(dialog, /copy\.openGoogleMaps/);
  assert.match(dialog, /copy\.cancel/);
  assert.match(dialog, /copy\.reset/);
  assert.match(dialog, /copy\.retryLookup/);
  assert.match(dialog, /copy\.retrySave/);
  assert.match(dialog, /Powered by|geocodeAttribution/);
  assert.match(dialog, /openstreetmap\.org\/copyright/);
  const map = fs.readFileSync(path.resolve("components/locations-map.tsx"), "utf8");
  assert.match(map, /pins\.some\(\(pin\) => pin\.coordinate_source === "Geoapify Geocoding"\)/);
  assert.match(map, /href="https:\/\/www\.geoapify\.com\/"/);
});

test("one request per 400ms slot keeps every rolling one-second window at or below four requests", () => {
  const countsByStartOffset = Array.from({ length: 400 }, (_, offset) =>
    Math.floor((offset + 999) / 400) - Math.floor(offset / 400) + 1
  );
  assert.equal(Math.max(...countsByStartOffset), 4);
});

test("private usage migration is isolated, RLS-protected and repeatable in PGlite", async () => {
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /revoke all on table public\.ees_location_geocode_rate_buckets from public, anon, authenticated, service_role/i);
  assert.match(migration, /grant execute on function public\.ees_locations_reserve_geocode_lookup\(uuid\) to service_role/i);
  assert.doesNotMatch(migration, /alter\s+table\s+public\.ees_locations\b/i);
  assert.doesNotMatch(migration, /create\s+policy|drop\s+policy/i);
  assert.match(migration, /date_bin\(interval '400 milliseconds'/);
  assert.match(migration, /request_count < 1/);
  assert.match(migration, /request_count < 6/);
  assert.match(migration, /request_count < 2500/);

  const db = new PGlite();
  try {
    await db.exec("create role anon; create role authenticated; create role service_role;");
    await db.exec(migration);
    await db.exec(migration);
    const table = (await db.query(`select relrowsecurity from pg_class where oid = 'public.ees_location_geocode_rate_buckets'::regclass`)).rows[0];
    assert.deepEqual(table, { relrowsecurity: true });
    const permissions = (await db.query(`
      select has_table_privilege('authenticated', 'public.ees_location_geocode_rate_buckets', 'select') as auth_select,
             has_table_privilege('service_role', 'public.ees_location_geocode_rate_buckets', 'select') as service_select,
             has_function_privilege('authenticated', 'public.ees_locations_reserve_geocode_lookup(uuid)', 'execute') as auth_execute,
             has_function_privilege('service_role', 'public.ees_locations_reserve_geocode_lookup(uuid)', 'execute') as service_execute
    `)).rows[0];
    assert.deepEqual(permissions, { auth_select: false, service_select: false, auth_execute: false, service_execute: true });

    await db.exec("reset role;");
    const actor = "10000000-0000-4000-8000-000000000001";
    await db.query(`insert into public.ees_location_geocode_rate_buckets (bucket_type,bucket_key,bucket_start,request_count) values ('daily','global',date_trunc('day', now() at time zone 'UTC') at time zone 'UTC',2499)`);
    await db.exec("set role service_role;");
    const lastAllowed = (await db.query("select * from public.ees_locations_reserve_geocode_lookup($1)", [actor])).rows[0];
    assert.deepEqual(lastAllowed, { allowed: true, reason: null, daily_remaining: 0 });
    await new Promise((resolve) => setTimeout(resolve, 450));
    const dailyDenied = (await db.query("select * from public.ees_locations_reserve_geocode_lookup($1)", [actor])).rows[0];
    assert.equal(dailyDenied.allowed, false);
    assert.equal(dailyDenied.reason, "daily_limit");
    await db.exec("reset role; delete from public.ees_location_geocode_rate_buckets;");

    const burstActor = "10000000-0000-4000-8000-000000000003";
    await db.query(`insert into public.ees_location_geocode_rate_buckets (bucket_type,bucket_key,bucket_start,request_count) values ('per_second','global',date_bin(interval '400 milliseconds', clock_timestamp(), timestamptz '2000-01-01 00:00:00+00'),1)`);
    await db.exec("set role service_role;");
    const burstDenied = (await db.query("select * from public.ees_locations_reserve_geocode_lookup($1)", [burstActor])).rows[0];
    assert.equal(burstDenied.allowed, false);
    assert.equal(burstDenied.reason, "server_rate_limit");
    await db.exec("reset role; delete from public.ees_location_geocode_rate_buckets;");

    const secondActor = "10000000-0000-4000-8000-000000000002";
    await db.query(`insert into public.ees_location_geocode_rate_buckets (bucket_type,bucket_key,bucket_start,request_count) values ('per_minute',$1,date_trunc('minute', now() at time zone 'UTC') at time zone 'UTC',5)`, [secondActor]);
    await db.exec("set role service_role;");
    const sixth = (await db.query("select * from public.ees_locations_reserve_geocode_lookup($1)", [secondActor])).rows[0];
    assert.equal(sixth.allowed, true);
    await new Promise((resolve) => setTimeout(resolve, 450));
    const seventh = (await db.query("select * from public.ees_locations_reserve_geocode_lookup($1)", [secondActor])).rows[0];
    assert.equal(seventh.allowed, false);
    assert.equal(seventh.reason, "user_rate_limit");
    await assert.rejects(db.query("select * from public.ees_location_geocode_rate_buckets"), /permission denied|row-level security/i);
  } finally {
    await db.close();
  }
});
