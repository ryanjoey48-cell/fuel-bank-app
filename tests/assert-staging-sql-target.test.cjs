const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { spawnSync } = require("node:child_process");

const script = path.resolve(__dirname, "../scripts/assert-staging-sql-target.cjs");

function run(envFileContents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ees-staging-assert-"));
  const envFile = path.join(dir, ".env.test");
  fs.writeFileSync(envFile, envFileContents);
  const result = spawnSync(process.execPath, [script, `--env-file=${envFile}`], {
    encoding: "utf8",
    cwd: path.resolve(__dirname, "..")
  });
  return { status: result.status, stdout: result.stdout || "", stderr: result.stderr || "" };
}

test("assert-staging-sql-target accepts approved staging env file", () => {
  const result = run(`
NEXT_PUBLIC_SUPABASE_URL=https://wpmnjfncaoogssgpqxek.supabase.co
EES_APPROVED_STAGING_PROJECT_REF=wpmnjfncaoogssgpqxek
`);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /"ok": true/);
  assert.match(result.stdout, /wpmnjfncaoogssgpqxek/);
});

test("assert-staging-sql-target refuses production URL", () => {
  const result = run(`
NEXT_PUBLIC_SUPABASE_URL=https://hafoaurzfgkkwpvzedvd.supabase.co
EES_APPROVED_STAGING_PROJECT_REF=wpmnjfncaoogssgpqxek
`);
  assert.notEqual(result.status, 0);
  assert.match(`${result.stderr}${result.stdout}`, /production/i);
});
