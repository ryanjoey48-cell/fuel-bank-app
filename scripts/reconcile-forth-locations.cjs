#!/usr/bin/env node
/* Offline Forth pinned-locations reconciliation report.
   Default: parse bundled CSV and compare against optional EES JSON fixture.
   Never writes to Forth or the database. */
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
function loadLib(relativePath, requireMap = {}) {
  const filename = path.join(root, relativePath);
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.require = (request) => {
    if (requireMap[request]) {
      const target = path.join(root, requireMap[request]);
      const child = new Module(target, module);
      child._compile(ts.transpileModule(fs.readFileSync(target, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
      }).outputText, target);
      return child.exports;
    }
    return require(request);
  };
  loaded._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, filename);
  return loaded.exports;
}

const { parseForthPinnedLocationsCsv, reconcileForthPinnedLocations } = loadLib(
  "lib/forth-locations-import.ts",
  { "@/lib/fleet-geofence-engine": "lib/fleet-geofence-engine.ts" }
);

const args = process.argv.slice(2);
const eesIndex = args.indexOf("--ees");
const reportIndex = args.indexOf("--report");
const valueFlags = new Set(["--ees", "--report"]);
const csvArg = args.find((arg, index) => !arg.startsWith("--") && !valueFlags.has(args[index - 1]));
const csvPath = path.resolve(csvArg || path.join(root, "data/forth-locations/Locations Forth Pinned.csv"));
const eesPath = eesIndex >= 0 ? path.resolve(args[eesIndex + 1]) : null;
const reportPath = reportIndex >= 0
  ? path.resolve(args[reportIndex + 1])
  : path.join(root, "output/forth-locations-reconciliation.json");

if (!fs.existsSync(csvPath)) {
  console.error(`CSV not found: ${csvPath}`);
  process.exit(2);
}

const records = parseForthPinnedLocationsCsv(fs.readFileSync(csvPath, "utf8"));
const eesLocations = eesPath
  ? JSON.parse(fs.readFileSync(eesPath, "utf8"))
  : [];
const result = reconcileForthPinnedLocations(records, eesLocations);
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, JSON.stringify({
  generatedAt: new Date().toISOString(),
  csvPath,
  eesPath,
  diameterNote: result.diameterNote,
  summary: result.summary,
  items: result.items.map((item) => ({
    forthLocationId: item.record.forthLocationId,
    name: item.record.name,
    groupLayer: item.record.groupLayer,
    latitude: item.record.latitude,
    longitude: item.record.longitude,
    address: item.record.address,
    diameterRaw: item.record.diameterRaw,
    classification: item.classification,
    suggestedCategory: item.suggestedCategory,
    matchedEesLocationId: item.matchedEesLocationId,
    matchCandidates: item.matchCandidates,
    notes: item.notes
  }))
}, null, 2));

console.log(JSON.stringify({
  csvPath,
  eesRecords: eesLocations.length,
  reportPath,
  summary: result.summary,
  diameterNote: result.diameterNote
}, null, 2));
