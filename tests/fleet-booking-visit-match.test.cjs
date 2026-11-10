const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const filename = path.join(root, "lib/fleet-booking-visit-match.ts");
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
const { proposeBookingMatches } = loaded.exports;

const visit = { visitKey: "v1", locationId: "loc1", registration: "78-6996", arrivalAt: "2026-10-31T03:00:00Z" };
const location = { id: "loc1", latitude: 13.7, longitude: 100.6 };
const booking = { id: "b1", bookingDate: "2026-10-31", vehicleRegistration: "78 6996", routeConfirmationStatus: "confirmed",
  pickup: { latitude: 13.7001, longitude: 100.6 }, dropoff: { latitude: 14.1, longitude: 100.1 } };

test("confirmed route and assigned vehicle produce a review candidate, not an automatic match", () => {
  const result = proposeBookingMatches(visit, location, [booking]);
  assert.equal(result.status, "review_candidate");
  assert.deepEqual(result.candidates.map((candidate) => [candidate.bookingId, candidate.side]), [["b1", "pickup"]]);
});

test("ambiguous bookings remain for office review", () => {
  const result = proposeBookingMatches(visit, location, [booking, { ...booking, id: "b2" }]);
  assert.equal(result.status, "ambiguous");
  assert.equal(result.candidates.length, 2);
});

test("unconfirmed route, mismatched vehicle, distant coordinate and stale date do not match", () => {
  for (const altered of [
    { routeConfirmationStatus: "pending" }, { vehicleRegistration: "OTHER" },
    { pickup: { latitude: 14.5, longitude: 100.6 } }, { bookingDate: "2026-10-20" }
  ]) assert.equal(proposeBookingMatches(visit, location, [{ ...booking, ...altered }]).status, "no_match");
});

test("a different EES location identity cannot borrow a nearby Booking Diary position", () => {
  assert.equal(proposeBookingMatches(visit, { ...location, id: "other" }, [booking]).status, "no_match");
});
