const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");

function loadTypeScript(relative) {
  const cache = new Map();
  function load(file) {
    file = path.resolve(root, file);
    if (cache.has(file)) return cache.get(file).exports;
    const loaded = new Module(file, module);
    cache.set(file, loaded);
    loaded.filename = file;
    loaded.paths = Module._nodeModulePaths(path.dirname(file));
    loaded.require = (request) => {
      if (request.startsWith("@/") || request.startsWith(".")) {
        const target = request.startsWith("@/") ? path.join(root, request.slice(2)) : path.resolve(path.dirname(file), request);
        const candidate = [target, `${target}.ts`, `${target}.tsx`].find((name) => fs.existsSync(name) && fs.statSync(name).isFile());
        if (candidate) return load(candidate);
      }
      return require(request);
    };
    loaded._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText, file);
    return loaded.exports;
  }
  return load(relative);
}

const {
  listForthSpeedDeviceConfigs,
  lookupForthSpeedConfig,
  matchForthSpeedConfigsToRegistry,
  forthLiveDeviceMapByRegistration,
  FORTH_SPEED_CONFIG_VERSION
} = loadTypeScript("lib/forth-speed-config.ts");

const {
  evaluateForthSpeedReview,
  assessForthSpeedDelayEvidence,
  isForthSpeedReviewCandidate
} = loadTypeScript("lib/forth-speed-review.ts");

const { isForthHighReportedSpeed, FORTH_HIGH_SPEED_REVIEW_KMH } = loadTypeScript("lib/forth-tracking-view.ts");

const gpsBase = {
  engineOn: true,
  timestampStatus: "current",
  coordinateStatus: "valid",
  latitude: 13.7,
  longitude: 100.5,
  gpsConnectivity: "connected",
  positionQuality: "gps"
};

test("owner catalogue covers exactly 21 registrations across groups A and B", () => {
  const configs = listForthSpeedDeviceConfigs();
  assert.equal(configs.length, 21);
  assert.equal(configs.filter((row) => row.group === "A_70_10s").length, 10);
  assert.equal(configs.filter((row) => row.group === "B_90_0s").length, 11);
  assert.ok(FORTH_SPEED_CONFIG_VERSION.includes("v12"));
  assert.equal(lookupForthSpeedConfig("79-5318")?.speedAlertKmh, 70);
  assert.equal(lookupForthSpeedConfig("79-5318")?.alertDelaySeconds, 10);
  assert.equal(lookupForthSpeedConfig("ฒอ8453")?.speedAlertKmh, 90);
  assert.equal(lookupForthSpeedConfig("ฒอ-8453")?.alertDelaySeconds, 0);
  assert.equal(lookupForthSpeedConfig("3ฒน-9565")?.maxWorkingDurationHours, null);
  assert.equal(lookupForthSpeedConfig("74-8969")?.maxEngineIdlingMinutes, 15);
  assert.equal(lookupForthSpeedConfig("UNKNOWN-1"), null);
});

test("registration matching prefers unique device IDs and flags ambiguity", () => {
  const vehicles = [
    { id: "ees-a", vehicle_reg: "79-5318", gpsDeviceId: "GPS-795318" },
    { id: "ees-b", vehicle_reg: "64-5954", gpsDeviceId: "GPS-645954" },
    { id: "ees-dup-1", vehicle_reg: "61-2835", gpsDeviceId: "SHARED" },
    { id: "ees-dup-2", vehicle_reg: "61-6672", gpsDeviceId: "SHARED" }
  ];
  const liveMap = forthLiveDeviceMapByRegistration([
    { vehicleRegistration: "79-5318", gpsDeviceId: "GPS-795318" },
    { vehicleRegistration: "64-5954", gpsDeviceId: "GPS-645954" },
    { vehicleRegistration: "61-2835", gpsDeviceId: "SHARED" }
  ]);
  const rows = matchForthSpeedConfigsToRegistry(vehicles, liveMap);
  const a = rows.find((row) => row.config.registrationDisplay === "79-5318");
  const b = rows.find((row) => row.config.registrationDisplay === "64-5954");
  const ambiguous = rows.find((row) => row.config.registrationDisplay === "61-2835");
  assert.equal(a.matchStatus, "matched");
  assert.equal(a.matchedBy, "device_id");
  assert.equal(b.matchStatus, "matched");
  assert.equal(ambiguous.matchStatus, "ambiguous");
  assert.equal(rows.filter((row) => row.matchStatus === "unmatched").length >= 1, true);
});

test("Thai formatting variants resolve to the same owner config", () => {
  assert.equal(lookupForthSpeedConfig("3ฒล4565")?.registrationKey, lookupForthSpeedConfig("3ฒล-4565")?.registrationKey);
  assert.equal(lookupForthSpeedConfig("7004145")?.speedAlertKmh, 90);
  assert.equal(lookupForthSpeedConfig("700-4145")?.group, "B_90_0s");
});

test("Group A threshold uses 70 km/h and does not invent delay satisfaction", () => {
  assert.equal(FORTH_HIGH_SPEED_REVIEW_KMH, 70);
  const below = { ...gpsBase, vehicleRegistration: "79-5318", speed: 69 };
  const above = { ...gpsBase, vehicleRegistration: "79-5318", speed: 71 };
  assert.equal(isForthHighReportedSpeed(below), false);
  assert.equal(isForthHighReportedSpeed(above), true);
  const review = evaluateForthSpeedReview(above);
  assert.equal(review.isReview, true);
  assert.equal(review.isThresholdExceedance, true);
  assert.equal(review.isConfirmedDeviceOverspeed, false);
  assert.equal(review.isLegalRoadViolation, false);
  assert.equal(review.applicableLimitKmh, 70);
  assert.equal(review.alertDelaySeconds, 10);
  assert.equal(review.source, "owner_forth_device_config");
  assert.equal(review.evidenceKind, "threshold_exceedance");
  const delay = assessForthSpeedDelayEvidence({
    alertDelaySeconds: 10,
    isThresholdExceedance: true,
    hasForthOverspeedEventRecord: false
  });
  assert.equal(delay.delaySatisfied, false);
  assert.equal(delay.evidenceKind, "threshold_exceedance");
});

test("Group B zero delay still requires event records for confirmed overspeed", () => {
  const review = evaluateForthSpeedReview({ ...gpsBase, vehicleRegistration: "64-5954", speed: 95 });
  assert.equal(review.applicableLimitKmh, 90);
  assert.equal(review.alertDelaySeconds, 0);
  assert.equal(review.isConfirmedDeviceOverspeed, false);
  const delay = assessForthSpeedDelayEvidence({
    alertDelaySeconds: 0,
    isThresholdExceedance: true,
    hasForthOverspeedEventRecord: false
  });
  assert.equal(delay.delaySatisfied, false);
  assert.equal(
    assessForthSpeedDelayEvidence({
      alertDelaySeconds: 0,
      isThresholdExceedance: true,
      hasForthOverspeedEventRecord: true
    }).evidenceKind,
    "confirmed_device_overspeed"
  );
});

test("blank working/idling fields stay null and are never coerced to zero", () => {
  const groupB = lookupForthSpeedConfig("701-1654");
  assert.equal(groupB.maxWorkingDurationHours, null);
  assert.equal(groupB.maxEngineIdlingMinutes, null);
  assert.equal(groupB.powerSavingParkingHours, 12);
});

test("speed watch and office panel remain wired into Fleet Tracking", () => {
  const centre = fs.readFileSync(path.join(root, "components/forth-tracking-centre.tsx"), "utf8");
  const speedWatch = fs.readFileSync(path.join(root, "components/forth-speed-watch.tsx"), "utf8");
  assert.match(centre, /ForthSpeedConfigPanel/);
  assert.match(centre, /speedSettings/);
  assert.match(speedWatch, /over_threshold/);
  assert.match(speedWatch, /Device alert|เกณฑ์อุปกรณ์/);
  assert.equal(isForthSpeedReviewCandidate({ ...gpsBase, vehicleRegistration: "79-5318", speed: 70 }), true);
});
