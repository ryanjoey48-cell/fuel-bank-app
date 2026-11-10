const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const filename = path.join(root, "lib/forth-locations-import.ts");
const loaded = new Module(filename, module);
loaded.filename = filename;
loaded.require = (request) => {
  if (request === "@/lib/fleet-geofence-engine") {
    const engineFile = path.join(root, "lib/fleet-geofence-engine.ts");
    const engine = new Module(engineFile, module);
    engine._compile(ts.transpileModule(fs.readFileSync(engineFile, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText, engineFile);
    return engine.exports;
  }
  return require(request);
};
loaded._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText, filename);

const {
  parseForthPinnedLocationsCsv,
  reconcileForthPinnedLocations,
  extractForthLocationIdFromSourceInfo,
  buildForthImportApprovalPayload,
  FORTH_LOCATION_ID_MARKER
} = loaded.exports;

const csvPath = path.resolve(__dirname, "../data/forth-locations/Locations Forth Pinned.csv");

test("parses the supplied Forth pinned locations CSV with 466 unique IDs", () => {
  const records = parseForthPinnedLocationsCsv(fs.readFileSync(csvPath, "utf8"));
  assert.equal(records.length, 466);
  assert.equal(new Set(records.map((row) => row.forthLocationId)).size, 466);
  assert.equal(records.filter((row) => row.name).length, 465);
  assert.equal(records.filter((row) => row.address).length, 53);
  assert.equal(records.filter((row) => row.latitude != null && row.longitude != null).length, 466);
  assert.equal(records[0].forthLocationId, "1625862");
  assert.equal(records[0].name, "พระราม 9");
  assert.equal(records[0].groupLayer, "โมเดอร์ฟอร์ม");
  assert.equal(records[0].diameterRaw, "100");
});

test("reconciles Forth records against empty EES Directory as new candidates", () => {
  const records = parseForthPinnedLocationsCsv(fs.readFileSync(csvPath, "utf8"));
  const result = reconcileForthPinnedLocations(records, []);
  assert.equal(result.summary.forthSourceRecords, 466);
  assert.equal(result.summary.uniqueForthLocationIds, 466);
  assert.equal(result.summary.validCoordinatePairs, 466);
  assert.equal(result.summary.exactDuplicateCoordinateGroups, 1);
  assert.equal(result.summary.populatedNames, 465);
  assert.equal(result.summary.populatedAddresses, 53);
  assert.equal(result.summary.distinctGroupLayers, 137);
  assert.equal(result.summary.eesDirectoryRecords, 0);
  assert.equal(
    result.summary.classifications.NEW_LOCATION + result.summary.classifications.REQUIRES_REVIEW,
    466
  );
  assert.equal(result.items.filter((item) => item.bulkEligible).length, result.summary.classifications.NEW_LOCATION);
  assert.match(result.diameterNote, /unit/i);
});

test("classifies linked, nearby duplicate, matched name/coord and invalid rows safely", () => {
  const csv = [
    "รหัสสถานที่,ชื่อสถานที่,ชื่อชั้นสถานที่,ละติจูด,ลองจิจูด,ที่อยู่,ประเภทสถานที่,เส้นผ่านศูนย์กลาง,สัญลักษณ์",
    "1001,Modernform Warehouse,Warehouse,13.700000,100.600000,123 Road,จุดทั่วไป,100,0",
    "1002,Nearby Site,Customer,13.700400,100.600000,,จุดทั่วไป,100,0",
    "1003,Blank Name Place,Layer,,,ที่อยู่,จุดทั่วไป,100,0",
    "1004,Bad Coords,Layer,999,100.6,,จุดทั่วไป,100,0"
  ].join("\n");
  const records = parseForthPinnedLocationsCsv(csv);
  const ees = [
    {
      id: "ees-1", companyName: "Modernform Warehouse", thaiName: null, address: "123 Road",
      sourceInfo: `${FORTH_LOCATION_ID_MARKER} 1001`, latitude: 13.700000, longitude: 100.600000,
      hasConfirmedDestinationPin: true
    },
    {
      id: "ees-2", companyName: "Other Customer", thaiName: null, address: "Elsewhere",
      sourceInfo: null, latitude: 13.700350, longitude: 100.600000, hasConfirmedDestinationPin: true
    }
  ];
  const result = reconcileForthPinnedLocations(records, ees);
  const byId = Object.fromEntries(result.items.map((item) => [item.record.forthLocationId, item]));
  assert.equal(byId["1001"].classification, "MATCHED");
  assert.equal(byId["1001"].matchedEesLocationId, "ees-1");
  assert.equal(byId["1002"].classification, "POSSIBLE_DUPLICATE");
  assert.ok(byId["1002"].matchCandidates.some((candidate) => candidate.eesLocationId === "ees-2"));
  assert.equal(byId["1002"].bulkEligible, false);
  assert.equal(byId["1003"].classification, "MISSING_COORDINATES");
  assert.equal(byId["1004"].classification, "INVALID_COORDINATES");
  assert.equal(extractForthLocationIdFromSourceInfo(ees[0].sourceInfo), "1001");
  const approval = buildForthImportApprovalPayload(byId["1002"]);
  assert.equal(approval.create_confirmed_pin, false);
  assert.equal(approval.verification_status, "needs_check");
  assert.match(approval.source_info, /1002/);
});

test("does not mark proximity-only candidates as MATCHED", () => {
  const csv = [
    "รหัสสถานที่,ชื่อสถานที่,ชื่อชั้นสถานที่,ละติจูด,ลองจิจูด,ที่อยู่,ประเภทสถานที่,เส้นผ่านศูนย์กลาง,สัญลักษณ์",
    "2001,Completely Different Name,Layer,13.7,100.6,,จุดทั่วไป,100,0"
  ].join("\n");
  const result = reconcileForthPinnedLocations(parseForthPinnedLocationsCsv(csv), [{
    id: "ees-near", companyName: "Unrelated Depot", thaiName: null, address: "Somewhere",
    latitude: 13.7002, longitude: 100.6, hasConfirmedDestinationPin: true
  }]);
  assert.equal(result.items[0].classification, "POSSIBLE_DUPLICATE");
  assert.equal(result.items[0].bestMatchConfidence, "uncertain");
  assert.equal(result.items[0].matchedEesLocationId, null);
  assert.equal(result.items[0].bulkEligible, false);
});
