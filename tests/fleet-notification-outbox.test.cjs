const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
function loadTs(relativePath) {
  const filename = path.join(root, relativePath);
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.require = (request) => {
    if (request.startsWith("@/lib/")) return loadTs(`lib/${request.slice("@/lib/".length)}.ts`);
    return require(request);
  };
  loaded._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, filename);
  return loaded.exports;
}

const { buildVisitNotificationIntent, shouldEnqueueVisitNotification } = loadTs("lib/fleet-notification-outbox.ts");

test("visit notification intents are idempotent by event key and keep push disabled", () => {
  const intent = buildVisitNotificationIntent({
    eventKey: "forth:1:loc:t:arrival",
    visitKey: "forth:1:loc:t",
    type: "arrival",
    registration: "78-6996",
    locationNameEn: "Depot A",
    locationNameTh: "คลัง A",
    occurredAt: "2026-10-31T03:00:00Z"
  });
  assert.equal(intent.intentKey, "visit:forth:1:loc:t:arrival:arrival");
  assert.equal(intent.deliveryEnabled, false);
  assert.equal(intent.href, "/fleet-events#forth%3A1%3Aloc%3At%3Aarrival");
  assert.equal(shouldEnqueueVisitNotification({ eventEvidence: "verified_forth_gps" }), true);
  assert.equal(shouldEnqueueVisitNotification({ eventEvidence: "guess" }), false);
  const again = buildVisitNotificationIntent({
    eventKey: "forth:1:loc:t:arrival",
    visitKey: "forth:1:loc:t",
    type: "arrival",
    registration: "78-6996",
    locationNameEn: "Depot A",
    locationNameTh: "คลัง A",
    occurredAt: "2026-10-31T03:00:00Z"
  });
  assert.equal(again.intentKey, intent.intentKey);
});
