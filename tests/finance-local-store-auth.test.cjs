"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

test("finance local store writes require Admin when Supabase auth is present; reads stay verified-user", () => {
  const route = read("app/api/finance-local-store/route.ts");
  const attachments = read("app/api/finance-local-store/attachments/route.ts");
  assert.match(route, /requireAdminAccess/);
  assert.match(route, /gate\(request, "write"\)/);
  assert.match(route, /gate\(request, "read"\)/);
  assert.match(attachments, /requireAdminAccess/);
  assert.match(attachments, /gate\(request, "write"\)/);
  // Settings PUT already admin-gated — keep that invariant.
  const settings = read("app/api/finance-settings/route.ts");
  assert.match(settings, /requireAdminAccess/);
});

test("official issuance remains hard-disabled; prerequisites list every critical gate", () => {
  const ts = require("typescript");
  const file = path.join(process.cwd(), "lib/finance-issuance-gate.ts");
  const js = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const mod = { exports: {} };
  new Function("module", "exports", "require", js)(mod, mod.exports, require);
  assert.equal(mod.exports.isOfficialIssuanceEnabled(), false);
  const blocked = mod.exports.issuanceBlockedReasons();
  assert.ok(blocked.some((item) => item.id === "shared_storage"));
  assert.ok(blocked.some((item) => item.id === "official_trn_register"));
  assert.ok(blocked.some((item) => item.id === "customer_profile_approved"));
  assert.ok(mod.exports.FINANCE_ISSUANCE_PREREQUISITES.every((item) => item.en && item.th));
});
