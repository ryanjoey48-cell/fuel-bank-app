const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const crypto = require("node:crypto");
const ts = require("typescript");
const XLSX = require("xlsx");

const workbookPath = "C:/Users/joery/Downloads/EES System upload data.xlsx";
const source = fs.readFileSync("lib/job-verification-historical-demo.ts", "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const loaded = { exports: {} };
new Function("module", "exports", compiled)(loaded, loaded.exports);

test("historical demonstration facts match the exact workbook cells and source hash", { skip: !fs.existsSync(workbookPath) }, () => {
  const bytes = fs.readFileSync(workbookPath);
  assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), loaded.exports.historicalWorkbook.sha256);
  const workbook = XLSX.read(bytes, { type: "buffer" });
  assert.deepEqual(workbook.SheetNames, ["January", "Feb", "March", "April", "May", "June", "July", "August", "September"]);
  for (const record of loaded.exports.historicalDemoRecords) {
    const sheet = workbook.Sheets[record.source.sheet];
    assert.ok(sheet);
    for (const [column, expected] of Object.entries(record.source.cells)) {
      const cell = sheet[`${column}${record.source.row}`];
      assert.ok(cell, `${record.source.sheet}!${column}${record.source.row}`);
      if (column === "A") {
        const date = XLSX.SSF.parse_date_code(cell.v);
        const iso = `${date.y}-${String(date.m).padStart(2,"0")}-${String(date.d).padStart(2,"0")}T00:00:00`;
        assert.equal(iso, expected);
      } else assert.equal(cell.v, expected, `${record.source.sheet}!${column}${record.source.row}`);
    }
    assert.match(record.simulation.en, /^SIMULATED:/);
    assert.match(record.simulation.th, /^จำลอง:/);
  }
});
