const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");

function loadTypeScript(relativePath) {
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
  return load(relativePath);
}

const { buildForthFleetAlerts, getUnreviewedForthFleetAlerts, reconcileForthAlertAcknowledgements, groupForthFleetIncidents } = loadTypeScript("lib/forth-fleet-alerts.ts");
const base = {
  gpsDeviceId: "100", vehicleRegistration: "64-1000", timestampStatus: "current", coordinateStatus: "valid",
  latitude: 13.7, longitude: 100.5, gpsConnectivity: "connected", gprsConnectivity: "connected",
  positionQuality: "gps", speed: 0, engineOn: false, lastGpsTimestamp: "2026-10-27T12:00:00.000Z"
};

test("speed review requires fresh GPS evidence and the operational threshold", () => {
  // Owner Group A plate 74-8969 uses the 70 km/h device alert (not a road legal limit).
  const record = { ...base, vehicleRegistration: "74-8969", speed: 70, engineOn: true };
  assert.deepEqual(buildForthFleetAlerts([record]).map(({ kind }) => kind), ["speed_review"]);
  for (const changes of [
    { speed: 69 }, { speed: null }, { speed: NaN }, { timestampStatus: "stale" },
    { positionQuality: "no_gps" }, { gpsConnectivity: "disconnected" },
    { coordinateStatus: "missing", latitude: null }, { longitude: 181 }
  ]) {
    assert.equal(buildForthFleetAlerts([{ ...record, ...changes }]).some(({ kind }) => kind === "speed_review"), false);
  }
});

test("positive speed with engine off creates a readings review instead of a speed incident", () => {
  const alerts = buildForthFleetAlerts([{ ...base, speed: 95, engineOn: false }]);
  assert.deepEqual(alerts.map(({ kind }) => kind), ["speed_engine_conflict"]);
  assert.equal(alerts[0].filter, "uncertain");
});

test("source conditions can coexist and retain distinct actionable filters", () => {
  const alerts = buildForthFleetAlerts([{ ...base, gprsConnectivity: "disconnected", timestampStatus: "stale", engineOn: true }]);
  assert.deepEqual(alerts.map(({ kind, filter }) => [kind, filter]), [["offline", "offline"], ["stale", "stale"]]);
  assert.equal(alerts.some(({ kind }) => kind === "engine_on_stopped"), false);
});

test("78-6996 offline and stale are one incident with two stable observations", () => {
  const record = { ...base, gpsDeviceId: "786996", vehicleRegistration: "78-6996", gprsConnectivity: "disconnected", timestampStatus: "stale" };
  const alerts = buildForthFleetAlerts([record]);
  const incidents = groupForthFleetIncidents(alerts);
  assert.equal(incidents.length, 1);
  assert.deepEqual(incidents[0].alerts.map(({ kind }) => kind), ["offline", "stale"]);
  const acknowledged = new Set(incidents[0].alerts.map(({ id }) => id));
  assert.equal(getUnreviewedForthFleetAlerts(alerts, acknowledged).length, 0);
  const stillOffline = buildForthFleetAlerts([{ ...record, timestampStatus: "current" }]);
  assert.deepEqual([...reconcileForthAlertAcknowledgements(acknowledged, stillOffline)], [alerts[0].id]);
});

test("78-6996 is one visible review card while both warnings remain readable", () => {
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const { ForthFleetAlertQueue, ForthFleetAlerts } = loadTypeScript("components/forth-fleet-alerts.tsx");
  const records = [{ ...base, gpsDeviceId: "786996", vehicleRegistration: "78-6996", gprsConnectivity: "disconnected", timestampStatus: "stale" }];
  const alerts = buildForthFleetAlerts(records);
  const props = { language: "en", onSelect() {}, onFilter() {} };
  const launcher = renderToStaticMarkup(React.createElement(ForthFleetAlerts, { ...props, records }));
  const queue = renderToStaticMarkup(React.createElement(ForthFleetAlertQueue, { unreviewed: alerts, reviewed: [], language: "en", onSelect() {}, onAcknowledge() {}, onReviewAll() {} }));
  assert.match(launcher, /<strong class="forth-alert-count">1<\/strong>/);
  assert.equal(queue.split('class="forth-alert-row forth-incident-row').length - 1, 1);
  assert.match(queue, /Tracker offline/);
  assert.match(queue, /Stale report/);
  assert.match(queue, /2 observations from one report/);
});

test("engine-on stopped is an advisory only for a fresh zero-speed report", () => {
  const alerts = buildForthFleetAlerts([{ ...base, engineOn: true }]);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].kind, "engine_on_stopped");
  assert.equal(alerts[0].severity, "advisory");
  assert.equal(alerts[0].filter, "engine_on_stopped");
  assert.equal(Object.hasOwn(alerts[0], "duration"), false);
  assert.equal(buildForthFleetAlerts([{ ...base, engineOn: true, speed: null }]).length, 0);
});

test("missing coordinates create a review alert without inventing a position", () => {
  const alerts = buildForthFleetAlerts([{ ...base, coordinateStatus: "missing", latitude: null, longitude: null }]);
  assert.deepEqual(alerts.map(({ kind, severity, filter }) => [kind, severity, filter]), [["missing_coordinates", "review", "missing_coordinates"]]);
});

test("alerts put speed reviews first, sort higher speeds first and keep source input immutable", () => {
  const records = [
    { ...base, gpsDeviceId: "idle", engineOn: true },
    { ...base, gpsDeviceId: "offline", gprsConnectivity: "disconnected" },
    { ...base, gpsDeviceId: "fast", vehicleRegistration: "64-5954", speed: 110, engineOn: true },
    { ...base, gpsDeviceId: "review", vehicleRegistration: "74-8969", speed: 75, engineOn: true },
    { ...base, gpsDeviceId: "conflict", speed: 12, engineOn: false }
  ];
  const before = structuredClone(records);
  const alerts = buildForthFleetAlerts(records);
  assert.deepEqual(alerts.map(({ recordKey }) => recordKey), ["device:fast", "device:review", "device:conflict", "device:offline", "device:idle"]);
  assert.deepEqual(records, before);
});

test("polls update values without producing new alert IDs", () => {
  const first = buildForthFleetAlerts([{ ...base, vehicleRegistration: "74-8969", speed: 72, engineOn: true }]);
  const next = buildForthFleetAlerts([{ ...base, vehicleRegistration: "74-8969", speed: 74, engineOn: true, lastGpsTimestamp: "2026-10-27T12:01:00.000Z" }]);
  assert.equal(first[0].id, next[0].id);
  assert.equal(next[0].record.speed, 74);
  const acknowledged = new Set([first[0].id]);
  assert.equal(getUnreviewedForthFleetAlerts(next, reconcileForthAlertAcknowledgements(acknowledged, next)).length, 0);
});

test("a cleared condition can notify again when it recurs", () => {
  const active = buildForthFleetAlerts([{ ...base, vehicleRegistration: "74-8969", speed: 72, engineOn: true }]);
  const acknowledged = new Set([active[0].id]);
  const clear = buildForthFleetAlerts([{ ...base, vehicleRegistration: "74-8969", speed: 40, engineOn: true }]);
  const afterClear = reconcileForthAlertAcknowledgements(acknowledged, clear);
  assert.equal(afterClear.size, 0);
  const recurring = buildForthFleetAlerts([{ ...base, vehicleRegistration: "74-8969", speed: 73, engineOn: true }]);
  assert.equal(getUnreviewedForthFleetAlerts(recurring, afterClear).length, 1);
  assert.equal(acknowledged.size, 1);
});

test("a newer duplicate identity replaces the entire older report before conditions are evaluated", () => {
  const older = { ...base, vehicleRegistration: "74-8969", speed: 100, engineOn: true, lastGpsTimestamp: "2026-10-27T11:59:00.000Z" };
  const newer = { ...base, vehicleRegistration: "74-8969", speed: 40, engineOn: true };
  assert.equal(buildForthFleetAlerts([newer, older]).length, 0);
  const duplicate = buildForthFleetAlerts([
    { ...base, vehicleRegistration: "74-8969", speed: 75, engineOn: true },
    { ...base, vehicleRegistration: "74-8969", speed: 75, engineOn: true }
  ]);
  assert.equal(duplicate.length, 1);
});

test("an ordinary unverified position is not promoted to an alert by itself", () => {
  assert.equal(buildForthFleetAlerts([{ ...base, positionQuality: "no_gps", speed: 55, engineOn: true }]).length, 0);
});

test("launcher stays labelled Attention and counts needs-action reviews", () => {
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const { ForthFleetAlerts } = loadTypeScript("components/forth-fleet-alerts.tsx");
  const records = [
    { ...base, gpsDeviceId: "fast-1", vehicleRegistration: "74-8969", speed: 75, engineOn: true },
    { ...base, gpsDeviceId: "fast-2", vehicleRegistration: "79-5318", speed: 72, engineOn: true },
    { ...base, gpsDeviceId: "offline", gprsConnectivity: "disconnected" }
  ];
  const markup = renderToStaticMarkup(React.createElement(ForthFleetAlerts, { records, language: "en", onSelect() {}, onFilter() {} }));
  assert.match(markup, /class="forth-alert-launcher forth-command-button has-alerts"/);
  assert.doesNotMatch(markup, /has-speed-review/);
  assert.match(markup, /aria-label="Attention: 3 Needs action, 0 Advisories"/);
  assert.match(markup, /<span>Attention<\/span><strong class="forth-alert-count">3<\/strong>/);
});

test("launcher keeps the ordinary alert label when there is no unreviewed speed condition", () => {
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const { ForthFleetAlerts } = loadTypeScript("components/forth-fleet-alerts.tsx");
  const markup = renderToStaticMarkup(React.createElement(ForthFleetAlerts, { records: [{ ...base, gprsConnectivity: "disconnected" }], language: "en", onSelect() {}, onFilter() {} }));
  assert.doesNotMatch(markup, /has-speed-review/);
  assert.match(markup, /<span>Attention<\/span><strong class="forth-alert-count">1<\/strong>/);
});

test("advisory-only conditions use a neutral Attention launcher", () => {
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const { ForthFleetAlerts } = loadTypeScript("components/forth-fleet-alerts.tsx");
  const markup = renderToStaticMarkup(React.createElement(ForthFleetAlerts, { records: [{ ...base, engineOn: true }], language: "en", onSelect() {}, onFilter() {} }));
  assert.match(markup, /class="forth-alert-launcher forth-command-button has-advisories"/);
  assert.doesNotMatch(markup, /has-alerts/);
  assert.match(markup, /<span>Attention<\/span><strong class="forth-alert-count">0<\/strong>/);
});

test("launcher action count excludes lower-priority advisories", () => {
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const { ForthFleetAlerts } = loadTypeScript("components/forth-fleet-alerts.tsx");
  const records = [{ ...base, gpsDeviceId: "offline", gprsConnectivity: "disconnected" }, { ...base, gpsDeviceId: "idle-1", engineOn: true }, { ...base, gpsDeviceId: "idle-2", engineOn: true }];
  const markup = renderToStaticMarkup(React.createElement(ForthFleetAlerts, { records, language: "en", onSelect() {}, onFilter() {} }));
  assert.match(markup, /aria-label="Attention: 1 Needs action, 2 Advisories"/);
  assert.match(markup, /<span>Attention<\/span><strong class="forth-alert-count">1<\/strong>/);
});

test("queue puts review issues first and collapses advisory-only details beneath them", () => {
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const { ForthFleetAlertQueue } = loadTypeScript("components/forth-fleet-alerts.tsx");
  const unreviewed = buildForthFleetAlerts([
    { ...base, gpsDeviceId: "idle", vehicleRegistration: "IDLE-1", engineOn: true },
    { ...base, gpsDeviceId: "fast", vehicleRegistration: "74-8969", speed: 75, engineOn: true }
  ]);
  const markup = renderToStaticMarkup(React.createElement(ForthFleetAlertQueue, { unreviewed, reviewed: [], language: "en", onSelect() {}, onAcknowledge() {}, onReviewAll() {} }));
  assert.match(markup, /<strong>1<\/strong> Needs action<span> · 1 Advisories<\/span>/);
  assert.match(markup, /<section class="forth-alert-group" aria-label="Needs action">/);
  assert.match(markup, /<details class="forth-alert-advisories">/);
  assert.ok(markup.indexOf("74-8969") < markup.indexOf("IDLE-1"));
  assert.match(markup, /Mark all reviewed/);
  assert.match(markup, /Stopped duration is unavailable/);
  assert.match(markup, /snapshot exceedance/);
});

test("queue opens the advisory group when there are no action items", () => {
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const { ForthFleetAlertQueue } = loadTypeScript("components/forth-fleet-alerts.tsx");
  const unreviewed = buildForthFleetAlerts([{ ...base, engineOn: true }]);
  const markup = renderToStaticMarkup(React.createElement(ForthFleetAlertQueue, { unreviewed, reviewed: [], language: "en", onSelect() {}, onAcknowledge() {}, onReviewAll() {} }));
  assert.match(markup, /<strong>0<\/strong> Needs action/);
  assert.match(markup, /<details class="forth-alert-advisories" open="">/);
  assert.doesNotMatch(markup, /Mark all reviewed/);
});
