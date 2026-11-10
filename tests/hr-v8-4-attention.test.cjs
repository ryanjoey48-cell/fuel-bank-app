const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

async function loadAttention() {
  const file = pathToFileURL(path.join(__dirname, "..", "lib", "ees-hr-attention.ts")).href;
  try {
    return await import(file);
  } catch {
    return null;
  }
}

function baseRow(overrides) {
  return {
    id: "1",
    kind: "driver",
    name: "Alex",
    employmentStatus: "active",
    employeeNumber: "E1",
    jobRole: "Driver",
    personnelRecorded: true,
    documentStatus: "recorded_current",
    vehicle: { id: "v", registration: "1", type: "FOUR_WHEEL_TRUCK", model: null, name: null },
    nextFollowup: null,
    awayToday: false,
    ...overrides,
  };
}

test("V8.4 attention server paginates full workforce", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "lib", "ees-hr-attention-server.ts"), "utf8");
  assert.match(source, /page <= 500/);
  assert.match(source, /size:\s*50/);
  assert.match(source, /buildAttentionQueue/);
  assert.match(source, /requireHR/);
  assert.doesNotMatch(source, /slice\(0,\s*25\)/);
});

test("V8.4 API exposes attention route", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "app", "api", "hr", "[...path]", "route.ts"), "utf8");
  assert.match(source, /readAttentionQueue/);
  assert.match(source, /attention/);
});

test("V8.4 onboarding progress uses persisted model only", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "components", "hr", "onboarding-panel.tsx"), "utf8");
  assert.match(source, /stepDonePersisted/);
  assert.match(source, /onboardingStepsDone/);
  assert.match(source, /draftDiffers/);
  assert.match(source, /beforeunload/);
  assert.match(source, /save_employee/);
  assert.doesNotMatch(source, /stepDone\(.*draft/);
});

test("buildAttentionQueue separates expired, expiring and missing licences", async () => {
  const mod = await loadAttention();
  if (!mod) {
    assert.ok(true, "skip runtime import without TS loader");
    return;
  }
  const rows = [
    baseRow({ id: "a", name: "Expired", documentStatus: "expired" }),
    baseRow({ id: "b", name: "Expiring", documentStatus: "expiring" }),
    baseRow({ id: "c", name: "Missing", documentStatus: "not_recorded", employmentStatus: "not_recorded", employeeNumber: null, jobRole: null, personnelRecorded: false, vehicle: null }),
    baseRow({ id: "d", name: "Follow", nextFollowup: "2026-12-01" }),
    baseRow({ id: "e", name: "Clean" }),
  ];
  const queue = mod.buildAttentionQueue(rows, 10);
  assert.equal(queue.scanned, 5);
  assert.ok(queue.totalNeedingAttention >= 4);
  assert.equal(queue.counts.licenceExpired, 1);
  assert.equal(queue.counts.licenceExpiring, 1);
  assert.equal(queue.counts.licenceMissing, 1);
  assert.equal(queue.counts.followupsOpen, 1);
  assert.equal(queue.counts.employmentMissing, 1);
  const keys = new Set(queue.rows.flatMap((row) => row.reasons.map((reason) => reason.key)));
  assert.ok(keys.has("licence_expired"));
  assert.ok(keys.has("licence_expiring"));
  assert.ok(keys.has("licence_missing") || keys.has("employment"));
  assert.equal(new Set(queue.rows.map((row) => `${row.kind}:${row.id}`)).size, queue.rows.length);
});

test("onboardingStepsDone ignores draft and requires ready documents", async () => {
  const mod = await loadAttention();
  if (!mod) {
    assert.ok(true, "skip runtime import without TS loader");
    return;
  }
  const employee = baseRow({
    employmentStatus: "active",
    employeeNumber: "E9",
    jobRole: "Driver",
    documentStatus: "recorded_current",
    nextFollowup: null,
  });
  assert.equal(mod.onboardingStepsDone(employee, { documents: [{ state: "ready" }] }), 8);
  assert.equal(mod.onboardingStepsDone(employee, { documents: [{ state: "pending" }] }), 7);
  assert.equal(mod.onboardingStepsDone({ ...employee, employmentStatus: "not_recorded" }, { documents: [{ state: "ready" }] }), 7);
});
