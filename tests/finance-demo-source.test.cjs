const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { createRequire } = require("node:module");
const ts = require("typescript");
const XLSX = require("xlsx");
const fixture = require("../lib/finance-demo-source-data.json");

function load(file) {
  const source = fs.readFileSync(file, "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  new Function("module", "exports", "require", js)(module, module.exports, createRequire(path.resolve(file)));
  return module.exports;
}
const model = load("lib/finance-demo-centre.ts");
const sourcePath = path.join("demo-references", "test data for EES system - Finance.xlsx");
const trnPath = path.join("demo-references", "2026-TRN629-INTEGRA.xls");
const dateFromSerial = (serial) => { const date = XLSX.SSF.parse_date_code(serial); return `${date.y}-${String(date.m).padStart(2, "0")}-${String(date.d).padStart(2, "0")}`; };

test("all 15 populated source rows match every copied field and the source hash", { skip: !fs.existsSync(sourcePath) }, () => {
  const bytes = fs.readFileSync(sourcePath);
  assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), fixture.sha256);
  const sheet = XLSX.read(bytes, { type: "buffer", cellDates: false }).Sheets.Sheet1;
  const at = (col, row) => sheet[`${col}${row}`]?.v ?? null;
  const populated = [];
  for (let row = 2; row <= 100; row++) if ("ABCDEFGHIJKLMNOPQRSTUV".split("").some((col) => at(col, row) !== null)) populated.push(row);
  assert.deepEqual(populated, fixture.rows.map((row) => row.row));
  const mapping = { B: "pickup", C: "delivery", D: "jobNumber", E: "vehicle", F: "driver", H: "historicalTrn", I: "tripCharge", J: "otherCharges", K: "parkingFees", L: "overtime", M: "containerPickup", N: "overnight", O: "totalCollected", P: "sequence", R: "client" };
  for (const row of fixture.rows) {
    assert.equal(row.sheet, "Sheet1");
    assert.equal(row.date, dateFromSerial(at("A", row.row)), `A${row.row}`);
    assert.equal(row.workOrder, String(at("G", row.row)), `G${row.row}`);
    assert.equal(row.receiptRef, String(at("Q", row.row)), `Q${row.row}`);
    for (const [col, key] of Object.entries(mapping)) assert.equal(row[key], at(col, row.row), `${col}${row.row}`);
  }
});

test("source totals, customer groups and historical TRNs reconcile independently", () => {
  const rows = fixture.rows;
  assert.equal(rows.length, 15);
  assert.equal(new Set(rows.map((row) => row.workOrder)).size, 15);
  assert.equal(rows.reduce((sum, row) => sum + row.totalCollected, 0), 35000);
  assert.equal(rows.reduce((sum, row) => sum + (row.tripCharge ?? 0), 0), 5800);
  assert.equal(rows.reduce((sum, row) => sum + (row.otherCharges ?? 0), 0), 600);
  assert.deepEqual(Object.fromEntries([...new Set(rows.map((row) => row.client))].map((client) => [client, rows.filter((row) => row.client === client).reduce((sum, row) => sum + row.totalCollected, 0)])), { Mass: 8000, Amazing: 24200, "Neo Tradex": 2800 });
  assert.deepEqual(Object.fromEntries([...new Set(rows.map((row) => row.historicalTrn))].map((trn) => [trn, rows.filter((row) => row.historicalTrn === trn).reduce((sum, row) => sum + row.totalCollected, 0)])), { "TRN010/2026": 8000, "TRN037/2026": 24200, "TRN042/2026": 2800 });
  assert.ok(rows.every((row) => row.jobNumber === null && row.parkingFees === null && row.overtime === null && row.containerPickup === null && row.overnight === null));
});

test("source-backed demonstration keeps historical references and new drafts separate", () => {
  let state = model.createSourceState();
  assert.equal(state.mode, "source");
  assert.equal(state.bookings.length, 15);
  assert.equal(state.bookings.find((job) => job.id === "source-r2").source.historicalTrn, "TRN010/2026");
  assert.equal(state.bookings.find((job) => job.id === "source-r2").collection.amount, 2500);
  assert.equal(state.bookings.find((job) => job.id === "source-r2").price, null);
  assert.equal(state.bookings.find((job) => job.id === "source-r2").pickupTime, "");
  assert.deepEqual(model.missingDocs(state, "source-r3"), ["green_order", "parking", "toll"]);
  assert.deepEqual(model.mismatches(state.bookings.find((job) => job.id === "source-r4")), ["delivery"]);
  assert.equal(state.bookings.find((job) => job.id === "source-r2").workOrderConfirmed, true);
  assert.equal(model.ready(state, "source-r5"), true);
  assert.equal(model.ready(state, "source-r16"), true);
  state = model.applyAction(state, { type: "create_batch", clientId: "source-amazing", week: "2026-01-19" }, "finance");
  for (const id of ["source-r5", "source-r6"]) {
    assert.throws(() => model.applyAction(state, { type: "allocate_job", batchId: "SIM-BATCH-1", jobId: id }, "finance"), /pricing/);
  }
  assert.equal(model.batchTotal(state, state.batches[0]), 0);
  state = model.applyAction(state, { type: "create_batch", clientId: "source-neo-tradex", week: "2026-01-26" }, "finance");
  assert.throws(() => model.applyAction(state, { type: "allocate_job", batchId: "SIM-BATCH-2", jobId: "source-r16" }, "finance"), /pricing/);
  assert.equal(model.batchTotal(state, state.batches[1]), 0);
  assert.equal(model.hasFinalTrnNumber(state), false);
  assert.ok(state.batches.every((batch) => batch.id.startsWith("SIM-BATCH-") && !batch.id.startsWith("TRN")));
});

test("workbook collection confirmation is separate from customer pricing and cannot enable billing", () => {
  let state = model.createSourceState();
  for (const doc of state.documents.filter((item) => item.suggestedJobId === "source-r2")) {
    state = model.applyAction(state, { type: "confirm_document", documentId: doc.id, jobId: "source-r2", physicalRef: `DEMO cabinet / ${doc.id}` }, "office");
  }
  state = model.applyAction(state, { type: "verify_job", jobId: "source-r2" }, "office");
  assert.match(state.audit.at(-1).detail, /Workbook facts matched to DEMO returned order/);
  state = model.applyAction(state, { type: "create_batch", clientId: "source-mass", week: "2026-01-05" }, "finance");
  assert.throws(() => model.applyAction(state, { type: "allocate_job", batchId: "SIM-BATCH-1", jobId: "source-r2" }, "finance"), /pricing/);
  assert.throws(() => model.applyAction(state, { type: "confirm_source_amount", jobId: "source-r2" }, "office"), /DEMO_ROLE_REQUIRED/);
  state = model.applyAction(state, { type: "confirm_source_amount", jobId: "source-r2" }, "finance");
  const job = state.bookings.find((item) => item.id === "source-r2");
  assert.equal(job.collection.confirmed, true);
  assert.equal(job.price, null);
  assert.equal(model.customerTotal(job), 0);
  assert.match(state.audit.at(-1).detail, /not proof of payment/);
  assert.throws(() => model.applyAction(state, { type: "allocate_job", batchId: "SIM-BATCH-1", jobId: "source-r2" }, "finance"), /pricing/);
  assert.equal(state.batches[0].jobIds.length, 0);
  assert.equal(state.bookings.find((job) => job.id === "source-r2").source.totalCollected, 2500);
  assert.equal(state.bookings.find((job) => job.id === "source-r2").source.historicalTrn, "TRN010/2026");
});

test("INTEGRA layout and formula disagreement are recorded without reusing its number", { skip: !fs.existsSync(trnPath) }, () => {
  const bytes = fs.readFileSync(trnPath);
  assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), "4edfe654f35dad01338189b8859e4f82a0e4a57e39c801953ce6567242f9cd78");
  const workbook = XLSX.read(bytes, { type: "buffer", cellFormula: true });
  assert.deepEqual(workbook.SheetNames, ["trn", "ใบปะหน้า"]);
  const invoice = workbook.Sheets.trn, cover = workbook.Sheets["ใบปะหน้า"];
  assert.equal(invoice.D7.v, "ใบแจ้งหนี้/INVOICE");
  assert.equal(invoice.K8.v, "TRN629/2026");
  assert.deepEqual(["B13", "C13", "D13", "H13", "I13", "J13", "K13", "L13"].map((cell) => invoice[cell].v), ["วันที่", "สถานทีรับ", "สถานที่ส่ง", "ใบงาน", "ค่าจอด", "OT", "เรทน้ำมัน", "AMOUNT"]);
  assert.equal(invoice.L18.f, "SUM(L14:L17)");
  assert.equal(invoice.L22.f, "L18-L20+L21");
  assert.equal(cover.J11.f, "E11-F11+G11+H11+I11");
  assert.equal(invoice.L22.v, 5051);
  assert.equal(cover.J11.v, 5451);
  assert.equal(cover.J11.v - invoice.L22.v, 400);
});

test("print sample carries verified invoice and cover headings without issuing a number or settlement figure", () => {
  const print = fs.readFileSync("components/finance-demo-print.tsx", "utf8");
  for (const heading of ["ใบแจ้งหนี้/INVOICE", "ใบปะหน้า", "ค่ารถบรรทุก", "หัก ณ ที่จ่าย", "ค่าจอด", "OT", "ยอดที่ต้องชำระ"]) assert.ok(print.includes(heading), heading);
  assert.match(print, /c\.printWatermark/);
  assert.match(print, /c\.layoutNote/);
  assert.doesNotMatch(print, /TRN629\/2026|L18-L20\+L21|E11-F11\+G11\+H11\+I11/);
});
