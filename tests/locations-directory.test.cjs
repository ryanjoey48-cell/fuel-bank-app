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
  getDispatchRestriction,
  getLocationDisplayName,
  getLocationMapUrl,
  matchesLocationFilter,
  matchesLocationSearch,
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
