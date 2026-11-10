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
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
    }).outputText, file);
    return loaded.exports;
  }
  return load(relative);
}

const { evaluateForthSpeedReview, assessForthSpeedDelayEvidence, isForthHighReportedSpeed } = loadTypeScript("lib/forth-speed-review.ts");
const { buildForthFleetAlerts, getUnreviewedForthFleetAlerts, reconcileForthAlertAcknowledgements } = loadTypeScript("lib/forth-fleet-alerts.ts");
const officeLocal = loadTypeScript("lib/forth-speed-config-office.ts");

const gps = {
  engineOn: true,
  timestampStatus: "current",
  coordinateStatus: "valid",
  latitude: 13.7,
  longitude: 100.5,
  gpsConnectivity: "connected",
  positionQuality: "gps"
};

test("equality at the configured threshold is an exceedance, not a confirmed sustained event", () => {
  const atThreshold = { ...gps, vehicleRegistration: "79-5318", speed: 70 };
  const below = { ...gps, vehicleRegistration: "79-5318", speed: 69.9 };
  assert.equal(isForthHighReportedSpeed(below), false);
  assert.equal(isForthHighReportedSpeed(atThreshold), true);
  const review = evaluateForthSpeedReview(atThreshold);
  assert.equal(review.isThresholdExceedance, true);
  assert.equal(review.isConfirmedDeviceOverspeed, false);
  assert.equal(review.isLegalRoadViolation, false);
  assert.equal(review.applicableLimitKmh, 70);
  assert.equal(review.alertDelaySeconds, 10);
  assert.match(review.reasonEn, /does not prove the delay/i);
});

test("10-second delay is never inferred from a single live reading", () => {
  const delay = assessForthSpeedDelayEvidence({
    alertDelaySeconds: 10,
    isThresholdExceedance: true,
    hasForthOverspeedEventRecord: false
  });
  assert.equal(delay.delaySatisfied, false);
  assert.equal(delay.evidenceKind, "threshold_exceedance");
});

test("device thresholds are never labelled as legal road limits", () => {
  const review = evaluateForthSpeedReview({ ...gps, vehicleRegistration: "64-5954", speed: 95 });
  assert.equal(review.isLegalRoadViolation, false);
  assert.match(review.reasonEn, /Not a legal road-limit/i);
  assert.equal(review.source, "owner_forth_device_config");
});

test("refreshing the same overspeed condition does not create duplicate alert ids", () => {
  const first = buildForthFleetAlerts([{ ...gps, gpsDeviceId: "box-1", vehicleRegistration: "74-8969", speed: 72 }]);
  const second = buildForthFleetAlerts([{ ...gps, gpsDeviceId: "box-1", vehicleRegistration: "74-8969", speed: 73, lastGpsTimestamp: "2026-10-29T01:00:00.000Z" }]);
  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
  assert.equal(first[0].id, second[0].id);
  const acknowledged = new Set([first[0].id]);
  assert.equal(getUnreviewedForthFleetAlerts(second, reconcileForthAlertAcknowledgements(acknowledged, second)).length, 0);
});

test("browser-local office reviews are retired and refuse writes", () => {
  assert.deepEqual(officeLocal.readForthSpeedConfigOfficeReviews(), []);
  assert.throws(() => officeLocal.writeForthSpeedConfigOfficeReview({
    registrationKey: "795318",
    status: "office_confirmed"
  }), /retired/i);
});

test("shared speed-config API enforces read vs write permissions and migration notice", () => {
  const route = fs.readFileSync(path.join(root, "app/api/admin/forth-tracking/speed-config/route.ts"), "utf8");
  const migration = fs.readFileSync(path.join(root, "supabase/migrations/20261029100000_forth_speed_config_audit.sql"), "utf8");
  const panel = fs.readFileSync(path.join(root, "components/forth-speed-config-panel.tsx"), "utf8");
  assert.match(route, /business:read/);
  assert.match(route, /business:write/);
  assert.match(route, /migrationApplied/);
  assert.match(route, /forthUnchanged: true/);
  assert.match(migration, /forth_speed_config_reviews/);
  assert.match(migration, /forth_speed_config_audit/);
  assert.match(migration, /current_account_role\(\) in \('admin', 'office_staff', 'read_only'\)/);
  assert.match(migration, /current_account_role\(\) in \('admin', 'office_staff'\)/);
  assert.match(migration, /independently_verified boolean not null default false/);
  assert.doesNotMatch(migration, /service_role/);
  assert.match(panel, /\/api\/admin\/forth-tracking\/speed-config/);
  assert.doesNotMatch(panel, /localStorage/);
  assert.match(panel, /canWrite/);
});

test("all 21 owner catalogue registrations remain available to the office panel path", () => {
  const { listForthSpeedDeviceConfigs } = loadTypeScript("lib/forth-speed-config.ts");
  assert.equal(listForthSpeedDeviceConfigs().length, 21);
  const centre = fs.readFileSync(path.join(root, "components/forth-tracking-centre.tsx"), "utf8");
  assert.match(centre, /ForthSpeedConfigPanel/);
  assert.match(centre, /speedSettings/);
});
