const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
function loadTs(relativePath) {
  const filename = path.join(root, relativePath);
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.require = (request) => {
    if (request.startsWith("@/lib/")) {
      return loadTs(`lib/${request.slice("@/lib/".length)}.ts`);
    }
    return require(request);
  };
  loaded._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, filename);
  return loaded.exports;
}

const {
  parseForthPinnedLocationsCsv,
  reconcileForthPinnedLocations,
  extractMapsCoordinateHint
} = loadTs("lib/forth-locations-import.ts");
const { isBulkDraftEligible, planForthBulkApprovals, previewForthBulkAction } = loadTs("lib/forth-locations-bulk.ts");
const { buildFleetPilotReadiness } = loadTs("lib/fleet-pilot-readiness.ts");

const csvPath = path.join(root, "data/forth-locations/Locations Forth Pinned.csv");
const fixturePath = path.join(root, "output/ees-locations-forth-reconcile-fixture.json");

test("improved matching finds exact-name strong proposals without claiming MATCHED without pins", () => {
  const records = parseForthPinnedLocationsCsv(fs.readFileSync(csvPath, "utf8"));
  const ees = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  const result = reconcileForthPinnedLocations(records, ees);
  assert.equal(result.summary.forthSourceRecords, 466);
  assert.equal(result.summary.eesDirectoryRecords, 103);
  assert.equal(result.summary.classifications.MATCHED, 0);
  assert.ok(result.summary.classifications.POSSIBLE_DUPLICATE >= 10);
  assert.ok(result.summary.classifications.NEW_LOCATION >= 400);
  const strongExact = result.items.filter((item) =>
    item.bestMatchConfidence === "strong"
    && item.matchCandidates.some((candidate) => candidate.reasons.some((reason) => reason.startsWith("Exact name"))));
  assert.ok(strongExact.length >= 8, `expected exact-name strong matches, got ${strongExact.length}`);
  assert.ok(strongExact.every((item) => item.classification === "POSSIBLE_DUPLICATE"));
  assert.equal(result.items.filter((item) => item.bulkEligible).length, result.summary.classifications.NEW_LOCATION);
});

test("short Forth names do not soft-match against unrelated Directory rows", () => {
  const csv = [
    "รหัสสถานที่,ชื่อสถานที่,ชื่อชั้นสถานที่,ละติจูด,ลองจิจูด,ที่อยู่,ประเภทสถานที่,เส้นผ่านศูนย์กลาง,สัญลักษณ์",
    "9001,SS,Layer,13.7,100.6,,จุดทั่วไป,100,0"
  ].join("\n");
  const result = reconcileForthPinnedLocations(parseForthPinnedLocationsCsv(csv), [{
    id: "ees-1", companyName: "Business Support Services", thaiName: null, address: "Somewhere",
    latitude: null, longitude: null
  }]);
  assert.equal(result.items[0].classification, "NEW_LOCATION");
  assert.equal(result.items[0].bulkEligible, true);
});

test("maps URL hints remain uncertain and never auto-match alone", () => {
  const hint = extractMapsCoordinateHint("https://www.google.com/maps?q=13.700000,100.600000");
  assert.deepEqual(hint, { latitude: 13.7, longitude: 100.6 });
  const csv = [
    "รหัสสถานที่,ชื่อสถานที่,ชื่อชั้นสถานที่,ละติจูด,ลองจิจูด,ที่อยู่,ประเภทสถานที่,เส้นผ่านศูนย์กลาง,สัญลักษณ์",
    "9002,Unrelated Name,Layer,13.7002,100.6000,,จุดทั่วไป,100,0"
  ].join("\n");
  const result = reconcileForthPinnedLocations(parseForthPinnedLocationsCsv(csv), [{
    id: "ees-maps", companyName: "Other Place", thaiName: null, address: "Addr",
    googleMapsUrl: "https://www.google.com/maps?q=13.700000,100.600000"
  }]);
  assert.equal(result.items[0].classification, "POSSIBLE_DUPLICATE");
  assert.equal(result.items[0].bestMatchConfidence, "uncertain");
  assert.equal(result.items[0].bulkEligible, false);
});

test("bulk approve plans are idempotent and exclude duplicates", () => {
  const records = parseForthPinnedLocationsCsv(fs.readFileSync(csvPath, "utf8")).slice(0, 20);
  const result = reconcileForthPinnedLocations(records, []);
  const eligible = result.items.filter(isBulkDraftEligible).map((item) => item.record.forthLocationId);
  assert.ok(eligible.length > 0);
  const preview = previewForthBulkAction(result.items, [...eligible, "999999"], "approve_drafts");
  assert.equal(preview.eligibleCount, eligible.length);
  assert.deepEqual(preview.missingIds, ["999999"]);
  const first = planForthBulkApprovals(result.items, eligible.slice(0, 3), new Set());
  assert.ok(first.every((row) => row.status === "created"));
  const second = planForthBulkApprovals(result.items, eligible.slice(0, 3), new Set(eligible.slice(0, 3)));
  assert.ok(second.every((row) => row.status === "already_imported"));
  const duplicateRow = result.items.find((item) => !item.bulkEligible);
  if (duplicateRow) {
    const rejected = planForthBulkApprovals(result.items, [duplicateRow.record.forthLocationId], new Set());
    assert.equal(rejected[0].status, "rejected");
  }
});

test("pilot readiness distinguishes code presence from real storage readiness", () => {
  const ready = buildFleetPilotReadiness({
    environmentLabel: "LOCAL",
    forthSourceRecords: 466,
    draftsWithForthId: 0,
    awaitingConfirmation: 0,
    confirmedDestinations: 0,
    geofencesEnabled: 0,
    pilotLocationsSelected: 0,
    visitStorageReady: false,
    forthAuditStorageReady: false,
    mapPinStorageReady: true,
    monitorEnabled: false,
    monitorSecretConfigured: false,
    vapidConfigured: false,
    webPushTestEnabled: false,
    activePushDevices: 0
  });
  assert.equal(ready.pilotReady, false);
  assert.equal(ready.liveNotificationsEnabled, false);
  assert.ok(ready.blockers.length >= 3);
});
