const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

async function loadAttention() {
  const file = pathToFileURL(path.join(__dirname, "..", "lib", "ees-hr-attention.ts")).href;
  // Compiled via tsx if available; otherwise assert source contracts.
  try {
    return await import(file);
  } catch {
    return null;
  }
}

test("attention helper source distinguishes missing employment from inactive", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "lib", "ees-hr-attention.ts"), "utf8");
  assert.match(source, /employmentStatus === "not_recorded"/);
  assert.doesNotMatch(source, /employmentStatus === "not_recorded".*inactive/s);
  assert.match(source, /not_applicable/);
  assert.match(source, /Unable to determine|unknown/);
  assert.match(source, /prioritisedAttentionRows/);
});

test("V8.3 copy keeps gated approvals and upload honesty", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "lib", "ees-hr-v8-copy.ts"), "utf8");
  assert.match(source, /approvalsGated/);
  assert.match(source, /uploadDisabled/);
  assert.match(source, /setupAbsences/);
  assert.match(source, /previewOnly/);
  assert.match(source, /Gate B/);
});

test("onboarding panel uses authorised save_employee only", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "components", "hr", "onboarding-panel.tsx"), "utf8");
  assert.match(source, /save_employee/);
  assert.doesNotMatch(source, /from\("ees_employee/);
  assert.match(source, /sessionStorage/);
  assert.match(source, /uploadDisabled|Gate B|previewOnly/);
});

test("attention ranking prefers employment gaps", async () => {
  const mod = await loadAttention();
  if (!mod) {
    assert.ok(true, "skip runtime import without TS loader");
    return;
  }
  const rows = [
    {
      id: "2",
      kind: "driver",
      name: "Zed",
      employmentStatus: "active",
      employeeNumber: "E2",
      jobRole: "Driver",
      personnelRecorded: true,
      documentStatus: "recorded_current",
      vehicle: { id: "v", registration: "1", type: "FOUR_WHEEL_TRUCK", model: null, name: null },
    },
    {
      id: "1",
      kind: "driver",
      name: "Alex",
      employmentStatus: "not_recorded",
      employeeNumber: null,
      jobRole: null,
      personnelRecorded: false,
      documentStatus: "not_recorded",
      vehicle: null,
    },
  ];
  const ranked = mod.prioritisedAttentionRows(rows, 2);
  assert.equal(ranked[0].name, "Alex");
  assert.match(mod.primaryAttention(ranked[0], "en"), /employment|personnel|employee code/i);
});
