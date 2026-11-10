/**
 * One-shot supervised Forth history probe.
 * Does NOT flip FORTH_HISTORY_LIVE_REQUESTS_ENABLED.
 * Loads .env.local, resolves one fleet vehicle, calls log (+ optional trips) once.
 * Prints sanitized counts only — never dumps credentials, tokens or full payloads.
 *
 * Usage:
 *   node scripts/forth-history-supervised-once.cjs
 * Optional env:
 *   FORTH_HISTORY_TEST_REGISTRATION  (default 3ฒน-9565)
 *   FORTH_HISTORY_TEST_DATE          (default 2026-10-24, YYYY-MM-DD)
 *   FORTH_HISTORY_TEST_INCLUDE_TRIPS (default true)
 */
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");

function loadEnvLocal() {
  const file = path.join(root, ".env.local");
  if (!fs.existsSync(file)) throw new Error("Missing .env.local");
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.replace(/^\uFEFF/, "").trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] == null || process.env[key] === "") process.env[key] = value;
  }
}

function loadTs(relative, cache = new Map()) {
  const file = path.resolve(root, relative);
  if (cache.has(file)) return cache.get(file).exports;
  const loaded = new Module(file, module);
  cache.set(file, loaded);
  loaded.filename = file;
  loaded.paths = Module._nodeModulePaths(path.dirname(file));
  loaded.require = (request) => {
    if (request.startsWith("@/") || request.startsWith(".")) {
      const target = request.startsWith("@/")
        ? path.join(root, request.slice(2))
        : path.resolve(path.dirname(file), request);
      const candidate = [target, `${target}.ts`, `${target}.tsx`].find(
        (name) => fs.existsSync(name) && fs.statSync(name).isFile()
      );
      if (candidate) return loadTs(path.relative(root, candidate), cache);
    }
    return require(request);
  };
  loaded._compile(
    ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true
      }
    }).outputText,
    file
  );
  return loaded.exports;
}

function redactId(value) {
  const text = String(value ?? "");
  if (text.length <= 4) return "[redacted]";
  return `${text.slice(0, 2)}…${text.slice(-2)} (len=${text.length})`;
}

function normalizePlate(value) {
  return String(value ?? "")
    .trim()
    .toLocaleUpperCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

async function main() {
  loadEnvLocal();
  const registration = process.env.FORTH_HISTORY_TEST_REGISTRATION || "3ฒน-9565";
  const dateYmd = process.env.FORTH_HISTORY_TEST_DATE || "2026-10-24";
  const includeTrips = process.env.FORTH_HISTORY_TEST_INCLUDE_TRIPS !== "false";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateYmd)) throw new Error("Invalid FORTH_HISTORY_TEST_DATE");

  const required = [
    "FORTH_CLIENT_ID",
    "FORTH_CLIENT_SECRET",
    "FORTH_USERNAME",
    "FORTH_PASSWORD",
    "FORTH_TOKEN_REQUEST_PROFILE"
  ];
  for (const key of required) {
    if (!process.env[key]) throw new Error(`Missing ${key} in environment`);
  }
  if (process.env.FORTH_TOKEN_REQUEST_PROFILE !== "oauth-password-basic-v1") {
    throw new Error("Unexpected FORTH_TOKEN_REQUEST_PROFILE");
  }

  const { getForthTrackingFleetData, getForthLogReport, getForthTripsReport } = loadTs(
    "lib/forth-tracking-server.ts"
  );
  const { forthPlaybackDayRange, buildPlaybackObservations, dedupeHistoricalObservations } = loadTs(
    "lib/forth-journey-playback.ts"
  );
  const { normalizeHistoricalLog } = loadTs("lib/forth-history-log.ts");
  const { FORTH_HISTORY_LIVE_REQUESTS_ENABLED } = loadTs("lib/forth-history-live-gate.ts");

  console.log(
    JSON.stringify(
      {
        phase: "preflight",
        globalHistoryGateEnabled: FORTH_HISTORY_LIVE_REQUESTS_ENABLED,
        proposedRegistration: registration,
        proposedDate: dateYmd,
        tokenProfileConfigured: true,
        sourceTimeZone: process.env.FORTH_SOURCE_TIME_ZONE || null,
        endpoints: {
          tracking: "GET /trackingresource/api/tracking",
          log: "GET /trackingresource/api/log/{id}/{start}/{end}",
          trips: "POST /trackingresource/api/vehicle/trips"
        },
        note: "Swagger documents report/log paths; account entitlement is proven only by this call."
      },
      null,
      2
    )
  );

  const fleet = await getForthTrackingFleetData();
  if (fleet.connectionStatus !== "connected" || fleet.error) {
    console.log(
      JSON.stringify(
        {
          phase: "fleet_resolve",
          ok: false,
          connectionStatus: fleet.connectionStatus,
          errorCode: fleet.error?.code ?? null
        },
        null,
        2
      )
    );
    process.exitCode = 2;
    return;
  }

  const plate = normalizePlate(registration);
  const matches = fleet.records.filter(
    (record) => normalizePlate(record.vehicleRegistration) === plate
  );
  if (matches.length !== 1 || !matches[0].gpsDeviceId) {
    console.log(
      JSON.stringify(
        {
          phase: "fleet_resolve",
          ok: false,
          code: "identity_unverified",
          matchCount: matches.length,
          fleetCount: fleet.records.length
        },
        null,
        2
      )
    );
    process.exitCode = 3;
    return;
  }

  const deviceId = matches[0].gpsDeviceId;
  const deviceDupes = fleet.records.filter((record) => record.gpsDeviceId === deviceId);
  if (deviceDupes.length !== 1) {
    console.log(JSON.stringify({ phase: "fleet_resolve", ok: false, code: "device_ambiguous" }, null, 2));
    process.exitCode = 3;
    return;
  }

  console.log(
    JSON.stringify(
      {
        phase: "fleet_resolve",
        ok: true,
        registration: matches[0].vehicleRegistration,
        deviceIdRedacted: redactId(deviceId),
        uniqueInFleet: true
      },
      null,
      2
    )
  );

  const range = forthPlaybackDayRange(dateYmd, "00:00", "23:59");
  if (!range) throw new Error("Invalid Bangkok day range");

  console.log(
    JSON.stringify(
      {
        phase: "request_shape",
        log: {
          method: "GET",
          pathPattern: "/trackingresource/api/log/{deviceId}/{startTime}/{endTime}",
          startTime: range.startTime,
          endTime: range.endTime,
          auth: "Bearer token from oauth-password-basic-v1"
        },
        trips: includeTrips
          ? {
              method: "POST",
              path: "/trackingresource/api/vehicle/trips",
              body: {
                boxIds: "[one device]",
                startDate: dateYmd.replaceAll("-", ""),
                endDate: dateYmd.replaceAll("-", ""),
                language: "en"
              }
            }
          : null
      },
      null,
      2
    )
  );

  const logResult = await getForthLogReport({
    deviceId,
    startTime: range.startTime,
    endTime: range.endTime
  });

  if (!logResult.ok) {
    console.log(
      JSON.stringify(
        {
          phase: "log_call",
          ok: false,
          httpishStatus: logResult.status,
          errorCode: logResult.error.code,
          message: logResult.error.message,
          entitlementHint:
            logResult.error.code === "report_auth_rejected"
              ? "Forth rejected auth for historical log — account may lack report/log entitlement on this API profile."
              : logResult.error.code === "report_http_error"
                ? "Forth returned a non-success response for the log endpoint."
                : "Upstream log call failed before a usable payload was received."
        },
        null,
        2
      )
    );
  } else {
    const replay = normalizeHistoricalLog(
      logResult.payload,
      deviceId,
      process.env.FORTH_SOURCE_TIME_ZONE || "Asia/Bangkok"
    );
    if (!replay) {
      console.log(
        JSON.stringify(
          {
            phase: "log_call",
            ok: false,
            errorCode: "invalid_log_payload",
            message: "Response did not normalize to a historical log replay."
          },
          null,
          2
        )
      );
    } else {
      const observations = buildPlaybackObservations({
        ...replay,
        points: dedupeHistoricalObservations(replay.points)
      });
      const withCoords = observations.filter(
        (row) => row.point.latitude != null && row.point.longitude != null
      );
      const verified = observations.filter((row) => row.point.verifiedGps);
      const withSpeed = observations.filter((row) => row.point.speedKph != null).length;
      const withEngine = observations.filter((row) => row.point.engineOn != null).length;
      const gaps = observations.filter((row) => row.isGapEdge).length;
      const first = verified[0]?.point.timestampIso ?? null;
      const last = verified[verified.length - 1]?.point.timestampIso ?? null;
      const trustBreakdown = {};
      for (const row of observations) {
        const key = [
          row.point.positionQuality || "unknown",
          row.point.gpsStatus || "unknown",
          row.point.timestampIso ? "ts" : "no_ts",
          row.point.coordinateStatus || "coords"
        ].join("|");
        trustBreakdown[key] = (trustBreakdown[key] || 0) + 1;
      }
      console.log(
        JSON.stringify(
          {
            phase: "log_call",
            ok: true,
            observationCount: observations.length,
            withCoordinates: withCoords.length,
            verifiedGpsCount: verified.length,
            trailEligibleCount: observations.filter((row) => row.point.trailEligible).length,
            segmentCount: replay.segments.length,
            reportedTrailSegmentCount: replay.reportedTrailSegments?.length ?? 0,
            gapEdges: gaps,
            trustBreakdown,
            observationsWithSpeed: withSpeed,
            observationsWithEngine: withEngine,
            firstVerifiedTimestampIso: first,
            lastVerifiedTimestampIso: last,
            distanceClaim: null,
            note: "Distance units remain unconfirmed; not summed."
          },
          null,
          2
        )
      );
    }
  }

  if (includeTrips) {
    const forthDate = dateYmd.replaceAll("-", "");
    const trips = await getForthTripsReport({
      deviceId,
      forthDate,
      language: "en"
    });
    if (!trips.ok) {
      console.log(
        JSON.stringify(
          {
            phase: "trips_call",
            ok: false,
            httpishStatus: trips.status,
            errorCode: trips.error.code,
            message: trips.error.message
          },
          null,
          2
        )
      );
    } else {
      const rows = Array.isArray(trips.payload) ? trips.payload.length : null;
      console.log(
        JSON.stringify(
          {
            phase: "trips_call",
            ok: true,
            recordCount: rows,
            note: "Trip summary strings only; not used as continuous GPS path."
          },
          null,
          2
        )
      );
    }
  }

  console.log(
    JSON.stringify(
      {
        phase: "gate_status",
        FORTH_HISTORY_LIVE_REQUESTS_ENABLED: FORTH_HISTORY_LIVE_REQUESTS_ENABLED,
        officePlaybackRoute: "still gated until owner enables production history access"
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        phase: "fatal",
        ok: false,
        message: error instanceof Error ? error.message : "unknown_error"
      },
      null,
      2
    )
  );
  process.exitCode = 1;
});
