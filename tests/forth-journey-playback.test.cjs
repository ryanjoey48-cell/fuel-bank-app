const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");

function load(file, cache = new Map()) {
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
      if (candidate) return load(candidate, cache);
    }
    return require(request);
  };
  loaded._compile(
    ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText,
    file
  );
  return loaded.exports;
}

const {
  forthPlaybackDayRange,
  orderHistoricalPointsByTime,
  dedupeHistoricalObservations,
  buildPlaybackObservations,
  seekPlaybackByProgress,
  seekPlaybackByTimestamp,
  advancePlaybackIndex,
  describeHistoryUnavailable
} = load("lib/forth-journey-playback.ts");
const { normalizeHistoricalLog } = load("lib/forth-history-log.ts");
const {
  findHistoricalHitsNearCustomer,
  groupHistoricalVisitWindows,
  summarizeHistoricalVisitCandidates
} = load("lib/forth-history-playback-analysis.ts");
const {
  FORTH_HISTORY_LIVE_REQUESTS_ENABLED,
  isForthHistoryLiveRequestsEnabled
} = load("lib/forth-history-live-gate.ts");
const {
  beginForthHistoryRateLimit,
  releaseForthHistoryRateLimit,
  resetForthHistoryRateLimitForTests
} = load("lib/forth-history-rate-limit.ts");
const { createJourneyPlaybackPostHandler } = load("lib/forth-history-playback-route.ts");

test("Bangkok day range builds Forth path stamps within one calendar day", () => {
  const range = forthPlaybackDayRange("2026-11-01", "08:00", "17:30");
  assert.deepEqual(range, { startTime: "20261101080000", endTime: "20261101173059" });
  assert.equal(forthPlaybackDayRange("bad", "08:00", "09:00"), null);
  assert.equal(forthPlaybackDayRange("2026-11-01", "18:00", "09:00"), null);
});

test("observations are ordered, deduped, and mark large gaps", () => {
  const points = [
    {
      sourceTimestamp: "b",
      timestampIso: "2026-11-01T01:20:00.000Z",
      latitude: 13.75,
      longitude: 100.56,
      coordinateStatus: "valid",
      gpsStatus: "connected",
      positionSource: "GPS",
      positionQuality: "gps",
      verifiedGps: true,
      speedKph: 20,
      engineOn: true,
      sourceDistanceRaw: null
    },
    {
      sourceTimestamp: "a",
      timestampIso: "2026-11-01T01:00:00.000Z",
      latitude: 13.74,
      longitude: 100.55,
      coordinateStatus: "valid",
      gpsStatus: "connected",
      positionSource: "GPS",
      positionQuality: "gps",
      verifiedGps: true,
      speedKph: 0,
      engineOn: true,
      sourceDistanceRaw: null
    },
    {
      sourceTimestamp: "a",
      timestampIso: "2026-11-01T01:00:00.000Z",
      latitude: 13.74,
      longitude: 100.55,
      coordinateStatus: "valid",
      gpsStatus: "connected",
      positionSource: "GPS",
      positionQuality: "gps",
      verifiedGps: true,
      speedKph: 0,
      engineOn: true,
      sourceDistanceRaw: null
    }
  ];
  const ordered = orderHistoricalPointsByTime(dedupeHistoricalObservations(points));
  assert.equal(ordered.length, 2);
  assert.equal(ordered[0].sourceTimestamp, "a");
  const observations = buildPlaybackObservations({
    points,
    segments: [],
    firstVerifiedIndex: 0,
    lastVerifiedIndex: 1
  });
  assert.equal(observations[1].isGapEdge, true);
  assert.ok(observations[1].gapBeforeMs > 5 * 60_000);
});

test("timeline seeking stays on observation indices", () => {
  const observations = buildPlaybackObservations({
    points: [
      {
        sourceTimestamp: "1",
        timestampIso: "2026-11-01T01:00:00.000Z",
        latitude: 13.7,
        longitude: 100.5,
        coordinateStatus: "valid",
        gpsStatus: "connected",
        positionSource: "GPS",
        positionQuality: "gps",
        verifiedGps: true,
        speedKph: 10,
        engineOn: true,
        sourceDistanceRaw: null
      },
      {
        sourceTimestamp: "2",
        timestampIso: "2026-11-01T01:01:00.000Z",
        latitude: 13.71,
        longitude: 100.51,
        coordinateStatus: "valid",
        gpsStatus: "connected",
        positionSource: "GPS",
        positionQuality: "gps",
        verifiedGps: true,
        speedKph: 12,
        engineOn: true,
        sourceDistanceRaw: null
      },
      {
        sourceTimestamp: "3",
        timestampIso: "2026-11-01T01:02:00.000Z",
        latitude: 13.72,
        longitude: 100.52,
        coordinateStatus: "valid",
        gpsStatus: "connected",
        positionSource: "GPS",
        positionQuality: "gps",
        verifiedGps: true,
        speedKph: 14,
        engineOn: true,
        sourceDistanceRaw: null
      }
    ],
    segments: [{ fromIndex: 0, toIndex: 1 }, { fromIndex: 1, toIndex: 2 }],
    firstVerifiedIndex: 0,
    lastVerifiedIndex: 2
  });
  assert.equal(seekPlaybackByProgress(observations, 0).index, 0);
  assert.equal(seekPlaybackByProgress(observations, 1).index, 2);
  assert.equal(seekPlaybackByTimestamp(observations, "2026-11-01T01:01:00.000Z").index, 1);
  assert.equal(advancePlaybackIndex(observations, 0, 1), 1);
});

test("reported trail links GPS-connected no_gps rows without calling them verified", () => {
  const device = "box-trail";
  const replay = normalizeHistoricalLog([
    { gpsID: device, dateTime: "2026-10-24T08:00:00+07:00", GPS: "1", GPRS: "1", positionSource: "No GPS", Latitude: 13.74, Longitude: 100.55, Speed: 40, Engine: "1" },
    { gpsID: device, dateTime: "2026-10-24T08:01:00+07:00", GPS: "1", GPRS: "1", positionSource: "No GPS", Latitude: 13.741, Longitude: 100.551, Speed: 42, Engine: "1" },
    { gpsID: device, dateTime: "2026-10-24T08:02:00+07:00", GPS: "1", GPRS: "1", positionSource: "WiFi", Latitude: 13.742, Longitude: 100.552, Speed: 0, Engine: "1" }
  ], device, "Asia/Bangkok");
  assert.ok(replay);
  assert.equal(replay.points.filter((point) => point.verifiedGps).length, 0);
  assert.equal(replay.points.filter((point) => point.trailEligible).length, 2);
  assert.equal(replay.segments.length, 0);
  assert.equal(replay.reportedTrailSegments.length, 1);
});

test("route continuity skips unverified and large gaps", () => {
  const device = "box-1";
  const replay = normalizeHistoricalLog([
    { gpsID: device, dateTime: "2026-11-01T08:00:00+07:00", GPS: "1", GPRS: "1", positionSource: "GPS", Latitude: 13.74, Longitude: 100.55, Speed: 0, Engine: "1" },
    { gpsID: device, dateTime: "2026-11-01T08:02:00+07:00", GPS: "1", GPRS: "1", positionSource: "GPS", Latitude: 13.741, Longitude: 100.551, Speed: 20, Engine: "1" },
    { gpsID: device, dateTime: "2026-11-01T08:20:00+07:00", GPS: "1", GPRS: "1", positionSource: "GPS", Latitude: 13.75, Longitude: 100.56, Speed: 0, Engine: "0" },
    { gpsID: device, dateTime: "2026-11-01T08:21:00+07:00", GPS: "0", GPRS: "1", positionSource: "LBS", Latitude: 13.751, Longitude: 100.561, Speed: 0, Engine: "0" }
  ], device, "Asia/Bangkok");
  assert.ok(replay);
  assert.equal(replay.segments.length, 1);
  assert.equal(replay.segments[0].fromIndex, 0);
  assert.equal(replay.segments[0].toIndex, 1);
});

test("historical customer proximity uses 100/200 m and verified points only", () => {
  const location = {
    id: "forth:1",
    forthLocationId: "1",
    name: "Test site",
    latitude: 13.75,
    longitude: 100.56
  };
  const points = [
    {
      sourceTimestamp: null,
      timestampIso: "2026-11-01T01:00:00.000Z",
      latitude: 13.7501,
      longitude: 100.5601,
      coordinateStatus: "valid",
      gpsStatus: "connected",
      positionSource: "GPS",
      positionQuality: "gps",
      verifiedGps: true,
      speedKph: 0,
      engineOn: false,
      sourceDistanceRaw: null
    },
    {
      sourceTimestamp: null,
      timestampIso: "2026-11-01T01:05:00.000Z",
      latitude: 13.7501,
      longitude: 100.5601,
      coordinateStatus: "valid",
      gpsStatus: "connected",
      positionSource: "GPS",
      positionQuality: "gps",
      verifiedGps: true,
      speedKph: 0,
      engineOn: false,
      sourceDistanceRaw: null
    },
    {
      sourceTimestamp: null,
      timestampIso: "2026-11-01T01:10:00.000Z",
      latitude: 13.8,
      longitude: 100.7,
      coordinateStatus: "valid",
      gpsStatus: "unknown",
      positionSource: "LBS",
      positionQuality: "lbs",
      verifiedGps: false,
      speedKph: 0,
      engineOn: false,
      sourceDistanceRaw: null
    }
  ];
  const hits = findHistoricalHitsNearCustomer(points, location);
  assert.equal(hits.length, 2);
  assert.equal(hits[0].band, "at_location");
  const candidates = summarizeHistoricalVisitCandidates(points, [location], { minObservations: 2 });
  assert.equal(candidates.length, 1);
  assert.ok(candidates[0].durationMs != null && candidates[0].durationMs >= 5 * 60_000);
  assert.equal(candidates[0].forthLocationId, "1");
  // 5-minute internal span equals the window threshold → sparse, still evidenced.
  assert.equal(candidates[0].gapQuality, "sparse");
});

test("visit windows split on large gaps and keep Forth location id", () => {
  const location = {
    id: "loc-a",
    forthLocationId: "9001",
    name: "Customer A",
    latitude: 13.75,
    longitude: 100.5
  };
  const mk = (index, iso, lat = 13.75001, lon = 100.50001) => ({
    sourceTimestamp: iso,
    timestampIso: iso,
    latitude: lat,
    longitude: lon,
    coordinateStatus: "valid",
    gpsStatus: "connected",
    positionSource: "GPS",
    positionQuality: "gps",
    verifiedGps: true,
    speedKph: 0,
    engineOn: false,
    sourceDistanceRaw: null,
    __index: index
  });
  const points = [
    mk(0, "2026-10-24T01:00:00.000Z"),
    mk(1, "2026-10-24T01:02:00.000Z"),
    mk(2, "2026-10-24T03:00:00.000Z"),
    mk(3, "2026-10-24T03:01:00.000Z")
  ];
  // Rebuild with correct observation indices via findHistoricalHitsNearCustomer
  const hits = findHistoricalHitsNearCustomer(points, location);
  assert.equal(hits.length, 4);
  const windows = groupHistoricalVisitWindows(hits, { minObservations: 2, windowGapMs: 5 * 60_000 });
  assert.equal(windows.length, 2);
  assert.equal(windows[0].observationCount, 2);
  assert.equal(windows[1].observationCount, 2);
  assert.equal(windows[0].forthLocationId, "9001");
  assert.ok(windows[0].firstTimestampIso);
  assert.ok(windows[0].lastTimestampIso);
});

test("default history gate stays off; production never uses supervised session", () => {
  assert.equal(FORTH_HISTORY_LIVE_REQUESTS_ENABLED, false);
  const previousVercel = process.env.VERCEL_ENV;
  const previousSupervised = process.env.FORTH_HISTORY_SUPERVISED_SESSION;
  const previousOffice = process.env.FORTH_HISTORY_OFFICE_PLAYBACK_ENABLED;
  try {
    process.env.VERCEL_ENV = "production";
    process.env.FORTH_HISTORY_SUPERVISED_SESSION = "1";
    delete process.env.FORTH_HISTORY_OFFICE_PLAYBACK_ENABLED;
    assert.equal(isForthHistoryLiveRequestsEnabled(), false);
    process.env.FORTH_HISTORY_OFFICE_PLAYBACK_ENABLED = "1";
    assert.equal(isForthHistoryLiveRequestsEnabled(), true);
    delete process.env.FORTH_HISTORY_OFFICE_PLAYBACK_ENABLED;
    process.env.VERCEL_ENV = "development";
    process.env.FORTH_HISTORY_SUPERVISED_SESSION = "1";
    assert.equal(isForthHistoryLiveRequestsEnabled(), true);
    delete process.env.FORTH_HISTORY_SUPERVISED_SESSION;
    assert.equal(isForthHistoryLiveRequestsEnabled(), false);
  } finally {
    if (previousVercel == null) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = previousVercel;
    if (previousSupervised == null) delete process.env.FORTH_HISTORY_SUPERVISED_SESSION;
    else process.env.FORTH_HISTORY_SUPERVISED_SESSION = previousSupervised;
    if (previousOffice == null) delete process.env.FORTH_HISTORY_OFFICE_PLAYBACK_ENABLED;
    else process.env.FORTH_HISTORY_OFFICE_PLAYBACK_ENABLED = previousOffice;
  }
});

test("history rate limit blocks overlapping in-flight requests", () => {
  resetForthHistoryRateLimitForTests();
  const first = beginForthHistoryRateLimit("user:device");
  assert.equal(first.allowed, true);
  const second = beginForthHistoryRateLimit("user:device");
  assert.equal(second.allowed, false);
  releaseForthHistoryRateLimit("user:device");
  const third = beginForthHistoryRateLimit("user:device");
  assert.equal(third.allowed, true);
  releaseForthHistoryRateLimit("user:device");
});

test("playback API stays gated and honest when live history is disabled", async () => {
  assert.equal(FORTH_HISTORY_LIVE_REQUESTS_ENABLED, false);
  const handler = createJourneyPlaybackPostHandler({
    enabled: false,
    requireUser: async () => ({ id: "u1" }),
    createAdmin: () => ({}),
    resolveAccess: async () => ({}),
    checkPermission: () => true,
    getFleet: async () => ({ connectionStatus: "connected", records: [], error: null }),
    getLog: async () => {
      throw new Error("must not call Forth log while gated");
    }
  });
  const response = await handler(new Request("https://ees.test/api/admin/forth-tracking/history/playback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceId: "box-1", date: "2026-11-01", language: "en" })
  }));
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.status, "unavailable");
  assert.equal(body.code, "history_live_disabled");
  assert.match(body.message, /not available/i);
  assert.match(describeHistoryUnavailable("en"), /not available/i);
});

test("centre exposes Playback mode and V21.2 pin defaults remain", () => {
  const source = fs.readFileSync(path.join(root, "components/forth-tracking-centre.tsx"), "utf8");
  assert.match(source, /"playback"/);
  assert.match(source, /ForthJourneyPlaybackPanel/);
  assert.match(source, /exitPlayback/);
  assert.match(source, /Back to Live Fleet/);
  assert.match(source, /forth-playback-map-exit/);
  assert.doesNotMatch(source, /workspaceMode !== "speed"/);
  assert.match(source, /forth-speed-watch-panel/);
  assert.match(source, /useState\(false\);\s*\n\s*const \[depotOfficeLayerOn/);
  assert.match(source, /selectForthMapPaintLocations/);
});

test("playback mode helpers discard stale history and restore live modes", () => {
  const mode = load("lib/forth-playback-mode.ts");
  assert.equal(mode.createInactivePlaybackOverlay().active, false);
  assert.equal(mode.shouldDiscardPlaybackResponse(1, 2), true);
  assert.equal(mode.shouldDiscardPlaybackResponse(3, 3), false);
  assert.equal(mode.nextPlaybackSession(4), 5);
  assert.equal(mode.resolvePlaybackReturnMode("vehicle", "v1"), "vehicle");
  assert.equal(mode.resolvePlaybackReturnMode("vehicle", null), "overview");
  assert.equal(mode.resolvePlaybackReturnMode("locations", null), "locations");
  assert.equal(mode.resolvePlaybackReturnMode("playback", "v1"), "overview");
  assert.equal(mode.resolveExitPlaybackTarget("locations", "vehicle", "v1"), "locations");
  assert.equal(mode.resolveExitPlaybackTarget(null, "vehicle", null), "overview");
  assert.equal(mode.resolveExitPlaybackTarget("vehicle", "overview", null), "overview");
});

test("playback panel exposes clearPlayback exit and abort session controls", () => {
  const panel = fs.readFileSync(path.join(root, "components/forth-journey-playback-panel.tsx"), "utf8");
  assert.match(panel, /clearPlayback/);
  assert.match(panel, /onExitToLive/);
  assert.match(panel, /shouldDiscardPlaybackResponse/);
  assert.match(panel, /AbortController/);
  assert.match(panel, /Back to Live Fleet/);
  assert.match(panel, /summarizeJourneyIntelligence/);
  assert.match(panel, /useImperativeHandle/);
});

test("journey intelligence summarises evidence without inventing arrivals", () => {
  const intel = load("lib/forth-journey-intelligence.ts");
  const points = [
    { index: 0, sourceTimestamp: "a", timestampIso: "2026-11-02T01:00:00.000Z", latitude: 13.7, longitude: 100.5, verifiedGps: true, trailEligible: true, speedKph: 40, engineOn: true, gapBeforeMs: null, isGapEdge: false },
    { index: 1, sourceTimestamp: "b", timestampIso: "2026-11-02T01:10:00.000Z", latitude: 13.71, longitude: 100.51, verifiedGps: true, trailEligible: true, speedKph: 0, engineOn: false, gapBeforeMs: 600000, isGapEdge: false },
    { index: 2, sourceTimestamp: "c", timestampIso: "2026-11-02T01:20:00.000Z", latitude: 13.71, longitude: 100.51, verifiedGps: false, trailEligible: true, speedKph: 0, engineOn: false, gapBeforeMs: 600000, isGapEdge: false },
    { index: 3, sourceTimestamp: "d", timestampIso: "2026-11-02T01:50:00.000Z", latitude: 13.72, longitude: 100.52, verifiedGps: true, trailEligible: true, speedKph: 35, engineOn: true, gapBeforeMs: 30 * 60000, isGapEdge: true }
  ];
  const summary = intel.summarizeJourneyIntelligence(points, {
    proximityVisits: [{
      locationId: "loc-1",
      forthLocationId: "1",
      name: "Customer A",
      observationCount: 2,
      atLocationCount: 2,
      approachingCount: 0,
      firstTimestampIso: "2026-11-02T01:10:00.000Z",
      lastTimestampIso: "2026-11-02T01:20:00.000Z",
      durationMs: 10 * 60000,
      nearestDistanceMeters: 40
    }]
  });
  assert.equal(summary.observationCount, 4);
  assert.equal(summary.verifiedCount, 3);
  assert.equal(summary.gapCount, 1);
  assert.equal(summary.first.index, 0);
  assert.equal(summary.last.index, 3);
  assert.ok(summary.observedSpanMs > 0);
  assert.ok(summary.stoppedObservationCount >= 2);
  assert.ok(summary.stopCandidates.some((item) => item.evidenceNote === "proximity_review_only"));
  assert.ok(summary.stopCandidates.every((item) => item.evidenceNote !== "confirmed_delivery"));
});

test("finance testing chrome is limited to Finance routes", () => {
  const routes = load("lib/finance-workspace-routes.ts");
  assert.equal(routes.isFinanceWorkspaceRoute("/finance-centre"), true);
  assert.equal(routes.isFinanceWorkspaceRoute("/weekly-billing"), true);
  assert.equal(routes.isFinanceWorkspaceRoute("/fleet-tracking"), false);
  assert.equal(routes.isFinanceWorkspaceRoute("/booking-diary"), false);
  const banner = fs.readFileSync(path.join(root, "components/finance-fixture-banner.tsx"), "utf8");
  const layout = fs.readFileSync(path.join(root, "app/(dashboard)/layout.tsx"), "utf8");
  const workspace = fs.readFileSync(path.join(root, "components/finance-centre-workspace.tsx"), "utf8");
  assert.match(banner, /export function FinanceFixtureBanner/);
  assert.match(banner, /return null/);
  assert.doesNotMatch(layout, /FinanceFixtureBanner/);
  assert.match(layout, /isFinanceWorkspaceRoute/);
  assert.match(layout, /onFinanceRoute/);
  // Finance clean-up: developer tools (incl. "Act as") render only in development builds.
  assert.match(workspace, /const IS_DEV_BUILD = process\.env\.NODE_ENV !== "production"/);
  assert.match(workspace, /\{IS_DEV_BUILD && params\.get\("dev"\) === "1" \? \(\s*<details className="ees-fc-dev/);
  assert.match(workspace, /Developer tools|เครื่องมือนักพัฒนา/);
  assert.match(workspace, /Test mode — no invoices issued|โหมดทดสอบ — ยังไม่ออกใบแจ้งหนี้/);
});
