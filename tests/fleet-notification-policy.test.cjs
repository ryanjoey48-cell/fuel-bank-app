const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const file = path.resolve(__dirname, "../lib/fleet-notification-policy.ts");
const loaded = new Module(file, module);
loaded._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText, file);
const { decideFleetNotification, isBangkokQuietHour } = loaded.exports;
const preferences = { arrivals: true, departures: false, extended_visits: false,
  tracker_incidents: true, gps_incidents: false, speed_alerts: false,
  quiet_start: "22:00", quiet_end: "07:00" };
const base = { category: "arrival", severity: "info", sourceKey: "arrival:1", allowedByOfficeScope: true,
  preferences, now: "2026-10-31T05:00:00Z", existing: null };

test("a permitted arrival is queued for push outside Bangkok quiet hours", () => {
  assert.equal(decideFleetNotification(base), "queue_and_push");
  assert.equal(decideFleetNotification({ ...base, category: "departure" }), "suppress");
  assert.equal(decideFleetNotification({ ...base, allowedByOfficeScope: false }), "suppress");
});

test("acknowledged or already queued source events never resend on another poll", () => {
  assert.equal(decideFleetNotification({ ...base, existing: { acknowledgedAt: null } }), "suppress");
  assert.equal(decideFleetNotification({ ...base, existing: { acknowledgedAt: base.now } }), "suppress");
});

test("quiet hours retain an inbox record but defer push, including critical alerts", () => {
  assert.equal(isBangkokQuietHour("2026-10-30T16:00:00Z", "22:00", "07:00"), true);
  assert.equal(decideFleetNotification({ ...base, now: "2026-10-30T16:00:00Z", severity: "critical" }), "queue_only");
  assert.equal(isBangkokQuietHour("2026-10-31T05:00:00Z", "22:00", "07:00"), false);
});
