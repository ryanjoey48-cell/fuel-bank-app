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
  getConfirmedDestinationLocationIds,
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

test("Maps search links safely encode English and Thai destination names with the full address and province", () => {
  const generated = new URL(buildGoogleMapsSearchUrl(location));
  assert.equal(generated.origin, "https://www.google.com");
  assert.equal(generated.pathname, "/maps/search/");
  assert.equal(generated.searchParams.get("api"), "1");
  assert.equal(generated.searchParams.get("query"), "Pacific Knitting Factory, โรงงานถักแปซิฟิก, 12 Industrial Road, Bangkok, Bangkok");
  assert.equal(generated.searchParams.get("query").includes("& Main Road"), false);
  assert.equal(buildGoogleMapsSearchUrl({ ...location, address: "  " }), null);
});

test("a saved Maps URL is reused only when its company name and full address match the destination", () => {
  const matchingSavedUrl = "https://www.google.com/maps/search/?api=1&query=Pacific%20Knitting%20Factory%2C%20%E0%B9%82%E0%B8%A3%E0%B8%87%E0%B8%87%E0%B8%B2%E0%B8%99%E0%B8%96%E0%B8%B1%E0%B8%81%E0%B9%81%E0%B8%9B%E0%B8%8B%E0%B8%B4%E0%B8%9F%E0%B8%B4%E0%B8%81%2C%2012%20Industrial%20Road%2C%20Bangkok";
  assert.equal(getLocationMapUrl({ ...location, google_maps_url: matchingSavedUrl }), new URL(matchingSavedUrl).toString());

  const otherCompanyUrl = buildGoogleMapsSearchUrl({
    ...location,
    company_name: "Pacific Dyeing & Finishing",
    thai_name: null
  });
  assert.equal(getLocationMapUrl({ ...location, google_maps_url: otherCompanyUrl }), buildGoogleMapsSearchUrl(location));
  assert.equal(getLocationMapUrl({ ...location, alternative_names: ["Pacific"], google_maps_url: otherCompanyUrl }), buildGoogleMapsSearchUrl(location));

  const nameOnlyUrl = "https://www.google.com/maps/search/?api=1&query=Pacific%20Knitting%20Factory";
  assert.equal(getLocationMapUrl({ ...location, google_maps_url: nameOnlyUrl }), buildGoogleMapsSearchUrl(location));
  assert.equal(getLocationMapUrl({ ...location, google_maps_url: "javascript:alert(1)" }), buildGoogleMapsSearchUrl(location));
});

test("ordinary location cards contain no pin-verification or geocoding status and retain one primary Maps action", () => {
  const source = fs.readFileSync(path.resolve("components/locations-directory.tsx"), "utf8");
  const cardStart = source.indexOf("{visibleLocations.map((location) => {");
  const cardEnd = source.indexOf("{detailLocation !== false", cardStart);
  const card = source.slice(cardStart, cardEnd);
  assert.ok(cardStart >= 0 && cardEnd > cardStart);
  assert.doesNotMatch(card, /copy\.findOnMap|copy\.needsCheck|copy\.noConfirmedPin|copy\.confirmedPinStatus|copy\.locationStatuses/);
  assert.match(card, /href=\{mapUrl\}[\s\S]*copy\.map/);
  assert.match(card, /location\.destination_type\.trim\(\)\.toLocaleLowerCase\(\) !== "other"/);
  assert.match(card, /<details className="group mt-1\.5/);
  assert.match(source, /canViewInternal \|\| view !== "map"/);
  assert.equal((source.match(/\/api\/locations\/map-pins/g) ?? []).length >= 1, true);
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

  const confirmed = getConfirmedDestinationLocationIds(pacificDestinations, [
    { location_id: "knitting", pin_type: "destination", pin_status: "manual_confirmed" },
    { location_id: "knitting", pin_type: "truck_entrance", pin_status: "manual_confirmed" },
    { location_id: "dyeing", pin_type: "truck_entrance", pin_status: "manual_confirmed" },
    { location_id: "deleted-location", pin_type: "destination", pin_status: "manual_confirmed" }
  ]);
  assert.deepEqual([...confirmed], ["knitting"]);
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
  assert.match(component, /categoryTerms\(location\.destination_type, copy\)\[1\] \?\? location\.destination_type/);
  assert.match(component, /canViewInternal && <button/);

  const collectionApi = fs.readFileSync(path.resolve("app/api/locations/route.ts"), "utf8");
  assert.match(collectionApi, /projectLocationForDirectory\(location, includeInternal\)/);
  assert.match(collectionApi, /admin:user_management/);
});

test("mobile directory cards stay compact, expose one Maps action, and keep administrative notes out of the standard card", () => {
  const component = fs.readFileSync(path.resolve("components/locations-directory.tsx"), "utf8");
  assert.match(component, /p-3\.5[\s\S]*sm:p-5/);
  const cardStart = component.indexOf("{visibleLocations.map((location) => {");
  const cardEnd = component.indexOf("{detailLocation !== false", cardStart);
  const card = component.slice(cardStart, cardEnd);
  assert.doesNotMatch(card, /copy\.googleMapsAction|copy\.findOnMap|copy\.needsCheck|copy\.noConfirmedPin|copy\.confirmedPinStatus/);
  assert.match(card, /copy\.map/);
  assert.match(component, /min-h-11/);
  assert.match(component, /<details className="group rounded-xl border border-slate-200 bg-slate-50/);
  assert.match(component, /<span>\{copy\.advancedDetails\}<\/span>/);
  assert.match(component, /detailLocation\.source_info/);
  assert.match(component, /numberFormat\.format\(locations\.length\)/);
  assert.doesNotMatch(component, /numberFormat\.format\(confirmedPinCount\)|numberFormat\.format\(needsReviewCount\)/);
  assert.match(component, /if \(!canViewInternal \|\| view !== "map"/);
  assert.match(component, /location\.destination_type\.trim\(\)\.toLocaleLowerCase\(\) !== "other"/);
  assert.match(component, /copy\.moreOptions/);
});

test("interactive map uses a Thailand default, clustered markers, OSM attribution and a confirm-before-save editor", () => {
  const map = fs.readFileSync(path.resolve("components/locations-map.tsx"), "utf8");
  const directory = fs.readFileSync(path.resolve("components/locations-directory.tsx"), "utf8");
  const css = fs.readFileSync(path.resolve("components/locations-map.module.css"), "utf8");
  assert.match(map, /THAILAND_BOUNDS:\s*\[\[number, number\], \[number, number\]\]/);
  assert.match(map, /fitBounds\(THAILAND_BOUNDS/);
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
  assert.match(directory, /function openPinEditor\(locationId: string\)/);
  assert.match(directory, /setMapEditorLocationId\(locationId\)/);
  assert.match(directory, /setView\("map"\)/);
  assert.match(directory, /copy\.findOnMap/);
  assert.match(map, /data-location-pin-select/);
});

test("Locations navigation is visible only to accounts with business read access and is translated", () => {
  const nav = fs.readFileSync(path.resolve("components/top-navigation.tsx"), "utf8");
  assert.match(nav, /can\("business:read"\)[\s\S]*?href: "\/locations"/);
  assert.match(nav, /language === "th" \? "สถานที่" : "Locations"/);
});

test("Locations Directory and Map controls retain English and Thai labels", () => {
  const translations = fs.readFileSync(path.resolve("lib/translations.ts"), "utf8");
  for (const label of [
    'directoryView: "Directory"', 'directoryView: "รายชื่อ"',
    'mapView: "Map"', 'mapView: "แผนที่"',
    'searchPlaceholder: "Search company, address or province"', 'searchPlaceholder: "ค้นหาบริษัท ที่อยู่ หรือจังหวัด"',
    'favourites: "Favourites"', 'favourites: "รายการโปรด"',
    'recentlyUsed: "Recently used"', 'recentlyUsed: "ใช้งานล่าสุด"',
    'pinThisLocation: "Find on Map"', 'pinThisLocation: "ค้นหาบนแผนที่"',
    'findOnMap: "Find on Map"', 'findOnMap: "ค้นหาบนแผนที่"',
    'confirmedPinStatus: "Pin confirmed"', 'confirmedPinStatus: "ยืนยันหมุดแล้ว"',
    'googleMapsAction: "Google Maps"'
  ]) assert.ok(translations.includes(label), `translation is present: ${label}`);
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

  const deleteApi = fs.readFileSync(path.resolve("app/api/locations/[id]/route.ts"), "utf8");
  assert.match(deleteApi, /access\(request, "business:delete"\)/);
  assert.match(deleteApi, /delete_ees_location_with_map_pin_audit_actor/);
  assert.match(deleteApi, /p_actor_id:\s*user\.id/);
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
  assert.match(sql, /grant select, insert, update on table public\.ees_location_map_pins to authenticated, service_role/i);
  assert.match(sql, /revoke all on table public\.ees_location_map_pins from public, anon, authenticated, service_role/i);
  assert.doesNotMatch(sql, /alter\s+table\s+public\.ees_locations\b/i);
  assert.doesNotMatch(sql, /update\s+public\.ees_locations\b/i);
  assert.doesNotMatch(sql, /insert\s+into\s+public\.ees_locations\b/i);

  const policyBlocks = new Map([...sql.matchAll(/create policy (\w+)[\s\S]*?\);/gi)].map((match) => [match[1], match[0].toLowerCase()]));
  const readPolicy = policyBlocks.get("ees_location_map_pins_office_read");
  assert.match(readPolicy, /for select to authenticated/);
  assert.match(readPolicy, /using\s*\([\s\S]*is_office_account\(\)[\s\S]*is_account_active\(\)[\s\S]*current_account_role\(\) in \('admin', 'office_staff', 'read_only'\)/);
  const insertPolicy = policyBlocks.get("ees_location_map_pins_office_insert");
  assert.match(insertPolicy, /for insert to authenticated/);
  assert.match(insertPolicy, /with check\s*\([\s\S]*is_office_account\(\)[\s\S]*is_account_active\(\)[\s\S]*current_account_role\(\) in \('admin', 'office_staff'\)[\s\S]*created_by = auth\.uid\(\)[\s\S]*confirmed_by = auth\.uid\(\)[\s\S]*updated_by = auth\.uid\(\)/);
  const updatePolicy = policyBlocks.get("ees_location_map_pins_office_update");
  assert.match(updatePolicy, /for update to authenticated[\s\S]*using\s*\([\s\S]*is_office_account\(\)[\s\S]*is_account_active\(\)[\s\S]*current_account_role\(\) in \('admin', 'office_staff'\)[\s\S]*?\)\s*with check\s*\(/);
  assert.match(updatePolicy, /updated_by = auth\.uid\(\)/);
  assert.doesNotMatch(updatePolicy, /confirmed_by = auth\.uid\(\)|created_by = auth\.uid\(\)/);
  assert.doesNotMatch(sql, /for delete to authenticated/i);

  const writeGuard = sql.match(/create or replace function public\.prepare_ees_location_map_pin_write\([\s\S]*?\$\$;/i)?.[0] ?? "";
  assert.match(writeGuard, /security invoker|language plpgsql[\s\S]*set search_path = ''/i);
  assert.match(writeGuard, /current_user = 'authenticated'[\s\S]*auth\.uid\(\)/);
  assert.match(writeGuard, /current_user = 'service_role'[\s\S]*public\.account_access[\s\S]*public\.driver_accounts/);
  assert.match(writeGuard, /new\.id is distinct from old\.id[\s\S]*new\.location_id is distinct from old\.location_id[\s\S]*new\.pin_type is distinct from old\.pin_type/);
  assert.match(writeGuard, /new\.confirmed_by := old\.confirmed_by[\s\S]*new\.confirmed_at := old\.confirmed_at/);
  assert.match(writeGuard, /new\.updated_by := v_actor/);
  assert.match(writeGuard, /new\.confirmed_at := v_now/);

  const audit = sql.match(/create or replace function ees_locations_internal\.audit_ees_location_map_pin\([\s\S]*?\$\$;/i)?.[0] ?? "";
  assert.match(audit, /security definer[\s\S]*set search_path = ''/i);
  assert.doesNotMatch(audit, /row_security\s*=\s*off/i);
  assert.match(sql, /set local role ees_locations_map_pin_auditor[\s\S]*create or replace function ees_locations_internal\.audit_ees_location_map_pin/i);
  assert.match(sql, /create role ees_locations_map_pin_auditor[\s\S]*nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls/i);
  assert.match(sql, /grant usage, create on schema ees_locations_internal to ees_locations_map_pin_auditor/i);
  assert.match(sql, /create policy ees_location_map_pin_history_auditor_insert[\s\S]*for insert to ees_locations_map_pin_auditor[\s\S]*with check \(true\)/i);
  assert.match(sql, /grant insert on table public\.ees_location_map_pin_history\s+to ees_locations_map_pin_auditor/i);
  assert.match(sql, /grant ees_locations_map_pin_auditor to %I with set true, inherit false/i);
  assert.match(audit, /insert into public\.ees_location_map_pin_history[\s\S]*'insert'/);
  assert.match(audit, /insert into public\.ees_location_map_pin_history[\s\S]*'update'/);
  assert.match(audit, /insert into public\.ees_location_map_pin_history[\s\S]*'delete'/);
  assert.match(audit, /current_setting\('ees\.map_pin_audit_actor', true\)/);
  assert.match(sql, /after insert or update or delete on public\.ees_location_map_pins[\s\S]*execute function ees_locations_internal\.audit_ees_location_map_pin/i);
  assert.match(sql, /before delete on public\.ees_locations[\s\S]*execute function public\.prepare_ees_location_delete_audit_context/i);
  assert.match(sql, /revoke all on table public\.ees_location_map_pin_history\s+from public, anon, authenticated, service_role, ees_locations_map_pin_auditor/i);
  assert.doesNotMatch(sql, /grant\s+(?:insert|update|delete|all)[^;]*ees_location_map_pin_history[^;]*\bto\s+(?:anon|authenticated|service_role)/i);
  assert.match(sql, /on delete cascade/i);
  assert.match(sql, /action in \('insert', 'update', 'delete'\)/i);
  assert.match(sql, /obj_description\([\s\S]*map-pins schema v3/i);
  assert.match(sql, /create or replace function public\.delete_ees_location_with_map_pin_audit_actor\([\s\S]*current_user <> 'service_role'[\s\S]*account_access[\s\S]*driver_accounts[\s\S]*set_config\('ees\.map_pin_audit_actor'/i);
  assert.match(sql, /grant execute on function public\.delete_ees_location_with_map_pin_audit_actor\(uuid, uuid\)\s+to service_role/i);

  const api = fs.readFileSync(path.resolve("app/api/locations/map-pins/route.ts"), "utf8");
  const apiColumns = api.match(/const pinFields = "([^"]+)"/)?.[1].split(",") ?? [];
  for (const column of ["id", "location_id", "pin_type", "latitude", "longitude", "pin_status", "coordinate_source", "source_reference", "created_by", "created_at", "confirmed_by", "confirmed_at", "updated_by", "updated_at"]) {
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
