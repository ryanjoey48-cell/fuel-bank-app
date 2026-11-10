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
  evaluateForthSpeedReview,
  isForthSpeedReviewCandidate,
  forthSpeedReviewConfidenceLabel
} = loadTypeScript("lib/forth-speed-review.ts");

const gpsDriving = {
  vehicleRegistration: "79-5318",
  speed: 75,
  engineOn: true,
  timestampStatus: "current",
  coordinateStatus: "valid",
  latitude: 13.7,
  longitude: 100.5,
  gpsConnectivity: "connected",
  positionQuality: "gps"
};

test("speed review uses owner device config and never invents a road legal limit", () => {
  const review = evaluateForthSpeedReview(gpsDriving);
  assert.equal(review.isReview, true);
  assert.equal(review.source, "owner_forth_device_config");
  assert.equal(review.confidence, "owner_device_config");
  assert.equal(review.applicableLimitKmh, 70);
  assert.equal(review.alertDelaySeconds, 10);
  assert.equal(review.isConfirmedDeviceOverspeed, false);
  assert.equal(review.isLegalRoadViolation, false);
  assert.ok(review.overLimitKmh > 0);
  assert.match(review.reasonEn, /Not a legal road-limit/i);
});

test("below-threshold speeds keep device context without flagging review", () => {
  const review = evaluateForthSpeedReview({ ...gpsDriving, speed: 65 });
  assert.equal(review.isReview, false);
  assert.equal(review.evidenceKind, "current_reading");
  assert.equal(review.applicableLimitKmh, 70);
  assert.equal(isForthSpeedReviewCandidate({ ...gpsDriving, speed: 65 }), false);
});

test("unknown plates fall back to class advisory without claiming device settings", () => {
  const review = evaluateForthSpeedReview({ ...gpsDriving, vehicleRegistration: "REVIEW-1", speed: 95 });
  assert.equal(review.isReview, true);
  assert.equal(review.source, "class_advisory_fallback");
  assert.equal(review.config, null);
  assert.equal(review.applicableLimitKmh, 90);
});

test("confidence labels stay operational, not legal", () => {
  assert.equal(forthSpeedReviewConfidenceLabel("owner_device_config", "en"), "Device setting (owner-reported)");
  assert.equal(forthSpeedReviewConfidenceLabel("no_limit_context", "en"), "Limit unavailable");
  assert.match(forthSpeedReviewConfidenceLabel("no_limit_context", "th"), /ขีดจำกัด/);
});

test("premium EES navigation is default and immersive operations remains optional", () => {
  const centre = fs.readFileSync(path.join(root, "components/forth-tracking-centre.tsx"), "utf8");
  const layout = fs.readFileSync(path.join(root, "app/(dashboard)/layout.tsx"), "utf8");
  const nav = fs.readFileSync(path.join(root, "components/top-navigation.tsx"), "utf8");
  assert.match(centre, /\[operationsMode, setOperationsMode\] = useState\(false\)/);
  assert.match(centre, /Fleet operations workspace|พื้นที่ปฏิบัติการกองรถ/);
  assert.match(layout, /is-fleet-route/);
  assert.match(layout, /has-floating-nav/);
  assert.match(layout, /<TopNavigation\s*\/>/);
  assert.equal(layout.includes("compact={isFleetTrackingRoute}"), false);
  assert.match(nav, /ees-floating-nav/);
  assert.equal(nav.includes("top-navigation-fleet-premium"), false);
  assert.match(nav, /entries\.map\(/);
});
