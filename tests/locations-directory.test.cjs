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
  buildGoogleMapsSearchUrl,
  formatCoordinates,
  getDispatchRestriction,
  getLocationDisplayName,
  getLocationMapUrl,
  getUnpinnedLocationIds,
  isValidCoordinates,
  matchesLocationFilter,
  matchesLocationSearch,
  parseCoordinates,
  parseAlternativeNames,
  projectLocationForDirectory,
  safeGoogleMapsUrl,
  validateLocationForm
} = loadTypeScriptModule("lib/locations-directory.ts");

const location = {
  company_name: "Pacific Knitting Factory",
  thai_name: "โรงงานถักแปซิฟิก",
  alternative_names: ["Pacific Knit", "PKF"],
  address: "12 Industrial Road, Bangkok",
  province: "Bangkok",
  destination_type: "Factory",
  notes: "Call the office before arrival.",
  source_info: "Historical workbook"
};

test("search covers English and Thai names, alternative names, addresses, provinces and translated categories", () => {
  assert.equal(matchesLocationSearch(location, "pacific knit", "en"), true);
  assert.equal(matchesLocationSearch(location, "โรงงานถัก", "th"), true);
  assert.equal(matchesLocationSearch(location, "industrial road", "en"), true);
  assert.equal(matchesLocationSearch(location, "Bangkok", "th"), true);
  assert.equal(matchesLocationSearch(location, "โรงงาน", "th", ["Factory", "โรงงาน", "plant"]), true);
  assert.equal(matchesLocationSearch(location, "dyeing", "en"), false);
});

test("Thai display uses the stored Thai name and falls back to the original name when missing", () => {
  assert.equal(getLocationDisplayName(location, "th"), "โรงงานถักแปซิฟิก");
  assert.equal(getLocationDisplayName({ ...location, thai_name: null }, "th"), "Pacific Knitting Factory");
  assert.equal(getLocationDisplayName(location, "en"), "Pacific Knitting Factory");
});

test("directory filters include all locations, favourites and recently used records", () => {
  assert.equal(matchesLocationFilter("all", undefined), true);
  assert.equal(matchesLocationFilter("favourites", { is_favourite: true, last_used_at: null }), true);
  assert.equal(matchesLocationFilter("favourites", { is_favourite: false, last_used_at: "2026-10-19T00:00:00Z" }), false);
  assert.equal(matchesLocationFilter("recent", { is_favourite: false, last_used_at: "2026-10-19T00:00:00Z" }), true);
  assert.equal(matchesLocationFilter("recent", { is_favourite: true, last_used_at: null }), false);
});

test("Google Maps links must use HTTPS, an allowed Google host, and a Maps path", () => {
  assert.equal(safeGoogleMapsUrl("https://www.google.com/maps/search/?api=1&query=x"), "https://www.google.com/maps/search/?api=1&query=x");
  assert.equal(safeGoogleMapsUrl("https://maps.google.com/maps?q=x"), "https://maps.google.com/maps?q=x");
  assert.equal(safeGoogleMapsUrl("https://www.google.co.th/maps/place/x"), "https://www.google.co.th/maps/place/x");
  assert.equal(safeGoogleMapsUrl("http://www.google.com/maps?q=x"), null);
  assert.equal(safeGoogleMapsUrl("https://google.com.evil.test/maps?q=x"), null);
  assert.equal(safeGoogleMapsUrl("https://www.google.com/not-maps"), null);
  assert.equal(safeGoogleMapsUrl("https://user:pass@www.google.com/maps?q=x"), null);
  assert.equal(safeGoogleMapsUrl("https://www.google.com:8443/maps?q=x"), null);
});

test("Maps search links safely encode Thai and English addresses and replace invalid saved URLs", () => {
  const generated = new URL(buildGoogleMapsSearchUrl("ถนน สุขุมวิท & Main Road"));
  assert.equal(generated.origin, "https://www.google.com");
  assert.equal(generated.pathname, "/maps/search/");
  assert.equal(generated.searchParams.get("api"), "1");
  assert.equal(generated.searchParams.get("query"), "ถนน สุขุมวิท & Main Road");
  assert.equal(getLocationMapUrl({ address: location.address, google_maps_url: "javascript:alert(1)" }), buildGoogleMapsSearchUrl(location.address));
  assert.equal(buildGoogleMapsSearchUrl("  "), null);
});

test("dispatch restrictions remain extractable while routine notes do not become alerts", () => {
  assert.equal(getDispatchRestriction(location), null);
  assert.match(getDispatchRestriction({ notes: "DO NOT DISPATCH before confirming the access road.", source_info: null }), /DO NOT DISPATCH/);
  assert.match(getDispatchRestriction({ notes: null, source_info: "ห้ามส่งรถเข้าทางด้านหลัง" }), /ห้ามส่งรถ/);
  assert.equal(getDispatchRestriction({ notes: "Verification note: NEEDS VERIFICATION — do not dispatch until the correct receiving gate and truck entrance are confirmed.", source_info: null }), "do not dispatch until the correct receiving gate and truck entrance are confirmed.");
  assert.ok(getDispatchRestriction({ notes: `Do not dispatch ${"until confirmed ".repeat(30)}`, source_info: null }).length <= 220);
});

test("directory projection keeps dispatch warnings but hides full internal notes and sources from non-admin accounts", () => {
  const record = { ...location, notes: "DO NOT DISPATCH until the rear entrance is confirmed.", source_info: "Internal workbook row 17" };
  const officeView = projectLocationForDirectory(record, false);
  assert.equal(officeView.notes, null);
  assert.equal(officeView.source_info, null);
  assert.equal(officeView.dispatch_restriction, "DO NOT DISPATCH until the rear entrance is confirmed.");

  const adminView = projectLocationForDirectory(record, true);
  assert.equal(adminView.notes, record.notes);
  assert.equal(adminView.source_info, record.source_info);
});

test("add and edit form validation requires essentials, safe Maps links and evidence for verified records", () => {
  assert.deepEqual(validateLocationForm({ company_name: "", address: "" }), ["companyName", "address"]);
  assert.deepEqual(validateLocationForm({ company_name: "Name", address: "Address", google_maps_url: "javascript:alert(1)" }), ["googleMapsUrl"]);
  assert.deepEqual(validateLocationForm({ company_name: "Name", address: "Address", truck_entrance_url: "https://example.com" }), ["truckEntranceUrl"]);
  assert.deepEqual(validateLocationForm({ company_name: "Name", address: "Address", verification_status: "verified" }), ["verificationEvidence"]);
  assert.deepEqual(validateLocationForm({ company_name: "Name", address: "Address", verification_status: "verified", verification_evidence: "On-site entrance checked" }), []);
});

test("alternative names retain distinct spellings and remove empty or duplicate entries", () => {
  assert.deepEqual(parseAlternativeNames("Pacific Knit, PKF\nPacific Knit; PKF"), ["Pacific Knit", "PKF"]);
});

test("coordinate parsing accepts copied pairs and rejects malformed or out-of-range values", () => {
  assert.deepEqual(parseCoordinates("13.7563, 100.5018"), { latitude: 13.7563, longitude: 100.5018 });
  assert.deepEqual(parseCoordinates("(13.7563;100.5018)"), { latitude: 13.7563, longitude: 100.5018 });
  assert.deepEqual(parseCoordinates("13.7563 100.5018"), { latitude: 13.7563, longitude: 100.5018 });
  assert.equal(parseCoordinates("91, 100"), null);
  assert.equal(parseCoordinates("13, 181"), null);
  assert.equal(parseCoordinates("NaN, 100"), null);
  assert.equal(parseCoordinates("13, Infinity"), null);
  assert.equal(parseCoordinates("13.2, 100.3 trailing"), null);
  assert.equal(isValidCoordinates(-90, 180), true);
  assert.equal(isValidCoordinates(-90.001, 180), false);
  assert.equal(isValidCoordinates(0, -180.001), false);
  assert.equal(formatCoordinates({ latitude: 13.7563, longitude: 100.5018 }), "13.756300, 100.501800");
});

test("confirmed destination pins preserve separately named Pacific records and truck pins do not count as main pins", () => {
  const pacificDestinations = [
    { id: "knitting", company_name: "Pacific Knitting Factory" },
    { id: "dyeing", company_name: "Pacific Dyeing & Finishing" }
  ];
  const unpinned = getUnpinnedLocationIds(pacificDestinations, [
    { location_id: "knitting", pin_type: "destination" },
    { location_id: "dyeing", pin_type: "truck_entrance" }
  ]);
  assert.deepEqual([...unpinned], ["dyeing"]);
});

test("Locations API keeps the existing read, write and delete permission gates", () => {
  const collectionApi = fs.readFileSync(path.resolve("app/api/locations/route.ts"), "utf8");
  const itemApi = fs.readFileSync(path.resolve("app/api/locations/[id]/route.ts"), "utf8");

  assert.match(collectionApi, /requireVerifiedUser\(request\)/);
  assert.match(collectionApi, /resolveAccountAccess\(admin, user\)/);
  assert.match(collectionApi, /write \? "business:write" : "business:read"/);
  assert.match(itemApi, /access\(request, "business:write"\)/);
  assert.match(itemApi, /access\(request, "business:read"\)/);
  assert.match(itemApi, /access\(request, "business:delete"\)/);
  assert.match(collectionApi, /safeGoogleMapsUrl\(value\)/);
  assert.match(itemApi, /safeGoogleMapsUrl\(value\)/);
});

test("Locations UI is subscribed to the existing language provider without adding another switch", () => {
  const component = fs.readFileSync(path.resolve("components/locations-directory.tsx"), "utf8");
  assert.match(component, /useLanguage\(\)/);
  assert.match(component, /t\.locations/);
  assert.doesNotMatch(component, /LanguageSwitcher/);
  assert.match(component, /aria-label=\{copy\.viewsLabel\}/);
  assert.match(component, /view === "map"/);
  assert.match(component, /lg:items-start/);
  assert.match(component, /location\.destination_type === "Other" \? copy\.destination/);
  assert.match(component, /canViewInternal && <button/);

  const collectionApi = fs.readFileSync(path.resolve("app/api/locations/route.ts"), "utf8");
  assert.match(collectionApi, /projectLocationForDirectory\(location, includeInternal\)/);
  assert.match(collectionApi, /admin:user_management/);
});

test("interactive map uses a Thailand default, clustered markers, OSM attribution and a confirm-before-save editor", () => {
  const map = fs.readFileSync(path.resolve("components/locations-map.tsx"), "utf8");
  const css = fs.readFileSync(path.resolve("components/locations-map.module.css"), "utf8");
  assert.match(map, /center:\s*\[15,\s*101\]/);
  assert.match(map, /markerClusterGroup/);
  assert.match(map, /tile\.openstreetmap\.org\/\{z\}\/\{x\}\/\{y\}\.png/);
  assert.match(map, /openstreetmap\.org\/copyright/);
  assert.match(map, /onSavePin\(/);
  assert.match(map, /confirmAndSavePin/);
  assert.match(map, /onClick=\{\(\)\s*=>\s*void\s+confirmAndSave\(\)\}/);
  assert.match(map, /clickMapToChoose/);
  assert.match(map, /role="application"/);
  assert.match(map, /md:hidden/);
  assert.match(css, /@media\s*\(max-width:\s*639px\)/);
  assert.match(css, /\.ees-map-candidate/);
});

test("map pin API gates reads and confirmed writes through the existing EES permission model", () => {
  const api = fs.readFileSync(path.resolve("app/api/locations/map-pins/route.ts"), "utf8");
  assert.match(api, /requireVerifiedUser\(request\)/);
  assert.match(api, /resolveAccountAccess\(admin, user\)/);
  assert.match(api, /write \? "business:write" : "business:read"/);
  assert.match(api, /body\.confirm !== true/);
  assert.match(api, /isValidCoordinates\(body\.latitude, body\.longitude\)/);
  assert.match(api, /onConflict:\s*"location_id,pin_type"/);
  assert.match(api, /confirmed_by:\s*user\.id/);
  assert.match(api, /pin_status:\s*"manual_confirmed"/);
  assert.match(api, /storageReady:\s*false/);
});

test("proposed map schema is additive, idempotent and leaves the historical destination rows unchanged", () => {
  const sql = fs.readFileSync(path.resolve("docs/ees-locations-map-pins-review-only.sql"), "utf8");
  assert.match(sql, /REVIEW ONLY/i);
  assert.match(sql, /create table if not exists public\.ees_location_map_pins/i);
  assert.match(sql, /create table if not exists public\.ees_location_map_pin_history/i);
  assert.match(sql, /unique \(location_id, pin_type\)/i);
  assert.match(sql, /latitude between -90 and 90/i);
  assert.match(sql, /longitude between -180 and 180/i);
  assert.match(sql, /pin_status = 'manual_confirmed'/i);
  assert.match(sql, /public\.is_office_account\(\)/i);
  assert.match(sql, /public\.is_account_active\(\)/i);
  assert.match(sql, /current_account_role\(\) in \('admin', 'office_staff', 'read_only'\)/i);
  assert.match(sql, /current_account_role\(\) in \('admin', 'office_staff'\)/i);
  assert.match(sql, /drop policy if exists[\s\S]*create policy/i);
  assert.match(sql, /grant select, insert, update on public\.ees_location_map_pins to authenticated/i);
  assert.match(sql, /revoke all on public\.ees_location_map_pins from anon, authenticated/i);
  assert.doesNotMatch(sql, /alter\s+table\s+public\.ees_locations\b/i);
  assert.doesNotMatch(sql, /update\s+public\.ees_locations\b/i);
  assert.doesNotMatch(sql, /insert\s+into\s+public\.ees_locations\b/i);

  const policyBlocks = new Map([...sql.matchAll(/create policy (\w+)[\s\S]*?\);/gi)].map((match) => [match[1], match[0].toLowerCase()]));
  const readPolicy = policyBlocks.get("ees_location_map_pins_office_read");
  assert.match(readPolicy, /for select to authenticated/);
  assert.match(readPolicy, /using\s*\([\s\S]*is_office_account\(\)[\s\S]*is_account_active\(\)[\s\S]*current_account_role\(\) in \('admin', 'office_staff', 'read_only'\)/);
  const insertPolicy = policyBlocks.get("ees_location_map_pins_office_insert");
  assert.match(insertPolicy, /for insert to authenticated/);
  assert.match(insertPolicy, /with check\s*\([\s\S]*is_office_account\(\)[\s\S]*is_account_active\(\)[\s\S]*current_account_role\(\) in \('admin', 'office_staff'\)[\s\S]*confirmed_by = auth\.uid\(\)[\s\S]*updated_by = auth\.uid\(\)/);
  const updatePolicy = policyBlocks.get("ees_location_map_pins_office_update");
  assert.match(updatePolicy, /for update to authenticated[\s\S]*using\s*\([\s\S]*is_office_account\(\)[\s\S]*is_account_active\(\)[\s\S]*current_account_role\(\) in \('admin', 'office_staff'\)[\s\S]*?\)\s*with check\s*\(/);
  assert.match(updatePolicy, /confirmed_by = auth\.uid\(\)[\s\S]*updated_by = auth\.uid\(\)/);
  assert.doesNotMatch(sql, /for delete to authenticated/i);

  const api = fs.readFileSync(path.resolve("app/api/locations/map-pins/route.ts"), "utf8");
  const apiColumns = api.match(/const pinFields = "([^"]+)"/)?.[1].split(",") ?? [];
  for (const column of ["id", "location_id", "pin_type", "latitude", "longitude", "pin_status", "coordinate_source", "source_reference", "confirmed_by", "confirmed_at", "updated_at"]) {
    assert.ok(apiColumns.includes(column), `${column} is selected by the map API`);
    assert.match(sql, new RegExp(`\\b${column}\\b`), `${column} exists in the proposed schema`);
  }
});

test("new map labels exist in English and Thai without translating stored company/address values", () => {
  const source = fs.readFileSync(path.resolve("lib/translations.ts"), "utf8");
  for (const key of ["confirmedPins", "candidatePins", "locationsWithoutCoordinates", "chooseOnMap", "coordinatesLabel", "invalidCoordinates", "confirmAndSavePin", "pinStorageUnavailable"]) {
    assert.equal((source.match(new RegExp(`^\\s+${key}:`, "gm")) ?? []).length, 2, `${key} is translated in both languages`);
  }
  const map = fs.readFileSync(path.resolve("components/locations-map.tsx"), "utf8");
  assert.match(map, /getLocationDisplayName\(location, language\)/);
  assert.match(map, /location\.address/);
});
