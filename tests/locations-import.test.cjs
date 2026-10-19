const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const XLSX = require("xlsx");

test("locations workbook importer creates a review-only report and flags possible duplicates", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ees-locations-"));
  const workbookPath = path.join(directory, "locations.xlsx");
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet([
    { "Company Name": "Example Factory", "Thai Name": "โรงงานตัวอย่าง", Address: "10 Main Road", Province: "Bangkok", "Google Maps URL": "https://www.google.com/maps/search/?api=1&query=10" },
    { "Company Name": "Example Factory", Address: "10 Main Road", Province: "Bangkok", "Google Maps URL": "not a url" },
    { "Company Name": "Shared Premises Tenant", Address: "10 Main Road" },
    { "Company Name": "Missing Address", Address: "" }
  ]);
  XLSX.utils.book_append_sheet(workbook, sheet, "Historical");
  XLSX.writeFile(workbook, workbookPath);
  const result = spawnSync(process.execPath, [path.resolve("scripts/import-locations.cjs"), workbookPath], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const reportPath = `${workbookPath}.locations-review.json`;
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  assert.equal(report.apply, false);
  assert.equal(report.summary.total, 4);
  assert.equal(report.summary.importable_without_duplicate_override, 2);
  assert.equal(report.records[0].verification_status, "needs_check");
  assert.equal(report.records[0].thai_name, "โรงงานตัวอย่าง");
  assert.match(report.records[1].issues.join(" "), /Duplicate company and address/);
  assert.match(report.records[1].issues.join(" "), /Invalid Google Maps URL/);
  assert.equal(report.records[2].issues.length, 0);
  assert.match(report.records[2].duplicate_warnings.join(" "), /Same address/);
  assert.match(report.records[3].issues.join(" "), /Missing address/);
  fs.rmSync(directory, { recursive: true, force: true });
});
