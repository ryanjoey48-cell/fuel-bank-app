const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const h = require('./helpers/invoice-compare.cjs');
const f = h.lib('finance-demo-centre.ts');
const ev = h.lib('finance-pricing-evidence.ts');
const fromSheet = h.lib('finance-invoice-from-sheet.ts');
const read = (p) => fs.readFileSync(path.join(h.root, p), 'utf8');
const walk = (dir) => fs.readdirSync(path.join(h.root, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

const JOBS = [
  ['2026-10-26', 'Sirtec', 'CAL-COMP', '64-8665', '6424'], ['2026-10-26', 'Sirtec', 'CAL-COMP', '68-7154', '5838'], ['2026-10-26', 'Sirtec', 'CAL-COMP', '79-5318', '6956'],
  ['2026-09-23', 'TITAN', 'ลาดกระบัง', '3ฒข196', '5817.1'], ['2026-10-26', 'GOODYEAR', 'สุวรรณภูมิ', '701-1654', '6144'], ['2026-09-15', 'SAFFRON', 'บางนา', '63-3543', '5913']
];
const receipts = (a = {}) => ({ amounts: Object.fromEntries(f.ADMIN_RECEIPT_FIELDS.map((k) => [k, a[k] ?? null])), notes: '' });
const act = (s, a, who = 'finance') => f.applyAction(s, a, who);
const job = (s, wo) => s.bookings.find((b) => f.confirmedWorkOrder(b) === wo);
const row = (sid, pred) => f.CUSTOMER_RATE_SCHEDULES.find((x) => x.id === sid).rows.find(pred);
const map = (sid, r, match) => ({ type: 'confirm_rate_mapping', scheduleId: sid, rowId: r.id, clientId: 'apl', contractReference: 'Owner approval (test)', effectiveFrom: '2026-01-01', effectiveTo: null, reviewReason: '', match });
function base() {
  let s = f.createEmptyOwnerState();
  JOBS.forEach(([date, p, d, plate, wo], i) => { s = f.linkDiaryWorkOrder(s, { id: 'j' + i, booking_id: 'BK' + i, client_id: 'apl', client_name: 'APL', booking_date: date, pickup: p, dropoff: d, vehicle: null, vehicle_registration: plate, driver: 'D' + i }, wo, 'admin', receipts(wo === '6424' ? { toll: 320 } : {})); });
  s = act(s, { type: 'sheet_create', clientId: 'apl' });
  const id = s.billingSheets.at(-1).id;
  for (const j of JOBS) s = act(s, { type: 'sheet_add_paper', sheetId: id, workOrder: j[4] });
  return { s, id };
}
const MAPS = [
  ['sirtech', () => true, { pickup: ['Sirtec', 'SIRTEC', 'SIRTEX'], delivery: ['CAL-COMP'], vehicleClass: [] }],
  ['apl', (r) => r.pickup.startsWith('TITAN') && r.vehicle === '4W', { pickup: ['TITAN'], delivery: ['ลาดกระบัง'], vehicleClass: [], plates: ['3ฒข196'] }],
  ['apl', (r) => r.pickup === 'SAFFRON - BANGNA', { pickup: ['SAFFRON'], delivery: ['บางนา'], vehicleClass: [] }],
  ['goodyear', (r) => r.pickup === 'GOODYEAR' && r.vehicle === '6W', { pickup: ['GOODYEAR'], delivery: ['สุวรรณภูมิ'], vehicleClass: [], plates: ['701-1654'] }]
];
const READINGS = { '2026-10-26': 43.54, '2026-09-23': 40.69, '2026-09-15': 40.69 };

test('the approved history website is the ONLY fuel-price source anywhere in the app code, docs and records', () => {
  const files = ['components', 'lib', 'app', 'docs'].flatMap(walk).filter((p) => /\.(ts|tsx|md|json)$/.test(p) && /finance|pricing|fuel-b7|diesel/i.test(p));
  const banned = /raakaadee|bangchak\.co\.th|bangchak-history|ptt(station|oil)?\.com|pttor|thaioil|oil-price\.|eppo\.go\.th/i;
  for (const file of files) assert.doesNotMatch(read(file), banned, file);
  assert.equal(f.DIESEL_B7_SOURCE_URL, 'https://xn--42c6baaa9bl0b2fcebb3cztja2d.com/history');
  const urls = new Set(files.filter((p) => /\.(ts|tsx)$/.test(p)).flatMap((p) => read(p).match(/https?:\/\/[^\s"'`)<>]+/g) || []).filter((u) => /fuel|oil|diesel|history|xn--/.test(u)));
  assert.deepEqual([...urls].filter((u) => !u.startsWith('https://xn--42c6baaa9bl0b2fcebb3cztja2d.com')), [], 'no other fuel URL is referenced');
  assert.doesNotMatch(read('components/finance-fuel-prices-panel.tsx'), /\bfetch\(/);
});

test('where to look on the approved page: Thai month, Buddhist year and row text for each job date', () => {
  assert.deepEqual([ev.sourceLookup('2026-10-26').thaiMonth, ev.sourceLookup('2026-10-26').buddhistYear, ev.sourceLookup('2026-10-26').rowText], ['ตุลาคม', 2569, '26 ตุลาคม 2569']);
  assert.equal(ev.sourceLookup('2026-09-15').rowText, '15 กันยายน 2569'); assert.equal(ev.sourceLookup('2026-09-23').enMonth, 'September');
});

test('owner review: everything Pending before approval; Approved only after an owner-approved mapping covers it; Goodyear reading stays Pending', () => {
  const { s: s0, id } = base();
  const sheet = (s) => s.billingSheets.find((x) => x.id === id);
  const jobs = (s) => sheet(s).jobIds.map((i) => s.bookings.find((b) => b.id === i));
  const ui = read('components/finance-owner-review.tsx');
  assert.match(ui, /data-testid="owner-review"/); assert.match(read('components/finance-pricing-setup.tsx'), /<FinanceOwnerReview/);
  assert.equal(f.activeRateMappings(s0).length, 0);
  let s = s0; for (const [sid, pred, match] of MAPS) s = act(s, map(sid, row(sid, pred), match), 'approver');
  assert.equal(f.activeRateMappings(s).length, 4);
  for (const j of JOBS) assert.ok(jobs(s).every((b) => f.activeRateMappings(s).some((m) => f.jobMatchesMapping(b, m).ok)), 'every job is covered');
  assert.ok(!f.activeRateMappings(s0).some((m) => f.jobMatchesMapping(job(s0, '5817.1'), m).ok));
});

test('six jobs, verified fuel on three dates (not six): charges, Goodyear override, billable ฿320 toll → ฿59,835 + ฿320 = ฿60,155, derived independently', () => {
  let { s, id } = base();
  for (const [sid, pred, match] of MAPS) s = act(s, map(sid, row(sid, pred), match), 'approver');
  const entries = [];
  for (const [d, p] of Object.entries(READINGS)) { s = act(s, { type: 'record_fuel_reference', date: d, priceThb: p, evidence: `History page ${d} Diesel B7 (approved source)`, sourceUrl: f.DIESEL_B7_SOURCE_URL, proposed: true }); entries.push(d); }
  assert.equal(s.fuelReferences.length, 3, 'three dates → three entries');
  assert.equal(f.diagnoseRate(s, job(s, '6424')).code, 'fuel_proposed');
  for (const d of entries) s = act(s, { type: 'verify_fuel_reference', date: d });
  assert.equal(new Set(s.fuelReferences.map((r) => r.id)).size, 3);
  s = act(s, { type: 'sheet_set_extra', sheetId: id, jobId: job(s, '6424').id, kind: 'toll', value: { decision: 'bill', amount: 320, note: 'Owner confirmed billable to APL' } });
  for (const j of JOBS) {
    const b = job(s, j[4]); const d = f.diagnoseRate(s, b); assert.equal(d.kind, 'suggested', j[4]);
    const override = j[4] === '6144';
    s = act(s, { type: 'sheet_apply_rate', sheetId: id, jobId: b.id, mappingId: d.mappingId, amountThb: override ? 3300 : d.amountThb, overrideReason: override ? 'Matches existing EES office billing sheet; Goodyear fuel-band interpretation requires contract confirmation.' : '', routeVehicleConfirmed: true, confirmOverwrite: false });
  }
  const sheet = s.billingSheets.find((x) => x.id === id);
  // independent derivation straight from the saved lines (not from sheetSummary)
  let transport = 0; let extras = 0;
  for (const jid of sheet.jobIds) { const line = sheet.lines[jid]; transport += Math.round(line.transport.amount * 100); for (const e of Object.values(line.extras)) if (e.decision === 'bill') extras += Math.round(e.amount * 100); }
  assert.equal(transport, 5983500); assert.equal(extras, 32000); assert.equal(transport + extras, 6015500);
  assert.equal(f.sheetSummary(s, sheet).totalSatang, 6015500);
  assert.deepEqual(JOBS.map((j) => sheet.lines[job(s, j[4]).id].transport.amount), [13110, 13110, 13110, 8880, 3300, 8325]);
  const toll = JOBS.map((j) => job(s, j[4])).flatMap((b) => Object.entries(sheet.lines[b.id].extras).map(([k, e]) => [f.confirmedWorkOrder(b), k, e.amount]));
  assert.deepEqual(toll, [['6424', 'toll', 320]], 'toll included once and only once');
  const doc = fromSheet.invoiceFromSheet(s, sheet, fromSheet.previewProfileForSheet(sheet).profile, '2026-11-06');
  assert.equal(doc.totals.subtotalSatang, 6015500); assert.equal(doc.lines.filter((l) => l.kind === 'extra').length, 1);
  assert.equal(doc.lines.find((l) => l.workOrder === '6144')?.amountSatang, 330000);
  const calc = ev.fuelCalculation(s, sheet, job(s, '6144'));
  assert.deepEqual([calc.tableCharge, calc.applied, calc.fuel.status], [3350, 3300, 'verified']); assert.match(calc.overrideReason, /Goodyear fuel-band interpretation requires contract confirmation/);
  // one value per date: summary has exactly three rows with the right job counts
  const jobs = sheet.jobIds.map((i) => s.bookings.find((b) => b.id === i));
  assert.deepEqual(ev.fuelDateSummary(s, sheet, jobs).map((r) => [r.date, r.jobCount, r.status]), [['2026-09-15', 1, 'verified'], ['2026-09-23', 1, 'verified'], ['2026-10-26', 4, 'verified']]);
});

test('panel carries the approved-source wording, confirm/correct controls and the where-to-look hint', () => {
  const panel = read('components/finance-fuel-prices-panel.tsx');
  for (const text of ['EES Historical Diesel B7 — Official Reference', 'Open Source', 'Confirm price', 'Correct price', 'fuel-open-source', 'sourceLookup', 'only fuel-price source']) assert.match(panel, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(read('docs/finance-diesel-b7-source.md'), /disallows AI crawlers/);
});
