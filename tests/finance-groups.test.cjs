const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const h = require('./helpers/invoice-compare.cjs');
const f = h.lib('finance-demo-centre.ts');
const ev = h.lib('finance-pricing-evidence.ts');
const fromSheet = h.lib('finance-invoice-from-sheet.ts');
const records = h.lib('finance-records.ts');
const read = (p) => fs.readFileSync(path.join(h.root, p), 'utf8');
const act = (s, a, who = 'finance') => f.applyAction(s, a, who);

// The six genuine APL jobs and the receipts already recorded in the real local store (Goodyear: parking 60 + a 30 charge recorded in the toll column;
// Saffron: NO receipt recorded for the spreadsheet's ฿160 — it must not be invented).
const JOBS = [
  { d: '2026-10-26', p: 'Sirtec', to: 'CAL-COMP', plate: '64-8665', wo: '6424', rec: { toll: 320 } },
  { d: '2026-10-26', p: 'Sirtec', to: 'CAL-COMP', plate: '68-7154', wo: '5838', rec: { toll: 365 } },
  { d: '2026-10-26', p: 'Sirtec', to: 'CAL-COMP', plate: '79-5318', wo: '6956', rec: { toll: 365 } },
  { d: '2026-09-23', p: 'TITAN', to: 'ลาดกระบัง', plate: '3ฒข196', wo: '5817.1', rec: {} },
  { d: '2026-10-26', p: 'GOODYEAR', to: 'สุวรรณภูมิ', plate: '701-1654', wo: '6144', rec: { parking: 60, toll: 30 } },
  { d: '2026-09-15', p: 'SAFFRON', to: 'บางนา', plate: '63-3543', wo: '5913', rec: {} }
];
const receipts = (a = {}) => ({ amounts: Object.fromEntries(f.ADMIN_RECEIPT_FIELDS.map((k) => [k, a[k] ?? null])), notes: '' });
const job = (s, wo) => s.bookings.find((b) => f.confirmedWorkOrder(b) === wo);
const row = (sid, pred) => f.CUSTOMER_RATE_SCHEDULES.find((x) => x.id === sid).rows.find(pred);
const map = (sid, r, match) => ({ type: 'confirm_rate_mapping', scheduleId: sid, rowId: r.id, clientId: 'apl', contractReference: 'Owner approval (test)', effectiveFrom: '2026-01-01', effectiveTo: null, reviewReason: '', match });
function base() {
  let s = f.createEmptyOwnerState();
  JOBS.forEach((j, i) => { s = f.linkDiaryWorkOrder(s, { id: 'j' + i, booking_id: 'BK' + i, client_id: 'apl', client_name: 'APL', booking_date: j.d, pickup: j.p, dropoff: j.to, vehicle: null, vehicle_registration: j.plate, driver: 'D' + i }, j.wo, 'admin', receipts(j.rec)); });
  return s;
}
function groups(s) {
  // four groups in the owner's historical TRN allocation: Sirtec / Titan / Goodyear / Saffron
  const spec = [['Sirtec', ['6424', '5838', '6956']], ['Titan', ['5817.1']], ['Goodyear', ['6144']], ['Saffron', ['5913']]];
  const ids = [];
  spec.forEach(([label, wos], i) => {
    s = act(s, { type: 'sheet_create', clientId: 'apl', additional: i > 0, label });
    const id = s.billingSheets.at(-1).id; ids.push(id);
    for (const wo of wos) s = act(s, { type: 'sheet_add_paper', sheetId: id, workOrder: wo });
  });
  return { s, ids };
}
function priced() {
  let { s, ids } = groups(base());
  for (const [sid, pred, match] of [
    ['sirtech', () => true, { pickup: ['Sirtec'], delivery: ['CAL-COMP'], vehicleClass: [] }],
    ['apl', (r) => r.pickup.startsWith('TITAN') && r.vehicle === '4W', { pickup: ['TITAN'], delivery: ['ลาดกระบัง'], vehicleClass: [], plates: ['3ฒข196'] }],
    ['apl', (r) => r.pickup === 'SAFFRON - BANGNA', { pickup: ['SAFFRON'], delivery: ['บางนา'], vehicleClass: [] }],
    ['goodyear', (r) => r.pickup === 'GOODYEAR' && r.vehicle === '6W', { pickup: ['GOODYEAR'], delivery: ['สุวรรณภูมิ'], vehicleClass: [], plates: ['701-1654'] }]]) s = act(s, map(sid, row(sid, pred), match), 'approver');
  for (const [d, p] of Object.entries({ '2026-10-26': 43.54, '2026-09-23': 40.69, '2026-09-15': 40.69 })) { s = act(s, { type: 'record_fuel_reference', date: d, priceThb: p, evidence: `Approved EES history page ${d} Diesel B7`, sourceUrl: f.DIESEL_B7_SOURCE_URL, proposed: true }); s = act(s, { type: 'verify_fuel_reference', date: d }); }
  const sheetOfJob = (jb) => s.billingSheets.find((x) => x.jobIds.includes(jb.id));
  for (const j of JOBS) {
    const jb = job(s, j.wo); const sh = sheetOfJob(jb); const d = f.diagnoseRate(s, jb);
    const ov = j.wo === '6144';
    s = act(s, { type: 'sheet_apply_rate', sheetId: sh.id, jobId: jb.id, mappingId: d.mappingId, amountThb: ov ? 3300 : d.amountThb, overrideReason: ov ? 'Matches existing EES office billing sheet; Goodyear fuel-band interpretation requires contract confirmation.' : '', routeVehicleConfirmed: true, confirmOverwrite: false });
    // Finance bills the recorded receipts of the Sirtec jobs (confirmed) and of Goodyear (both extras "if confirmed" → billed here as the owner's stated target)
    for (const [kind, amount] of Object.entries(j.rec)) s = act(s, { type: 'sheet_set_extra', sheetId: sh.id, jobId: jb.id, kind, value: { decision: 'bill', amount } });
  }
  // Saffron: the owner's confirmed spreadsheet amount (other charges ฿160) has NO Admin receipt; Finance enters it as a customer charge with a note — never as an invented receipt.
  { const jb = job(s, '5913'); const sh = s.billingSheets.find((x) => x.jobIds.includes(jb.id)); s = act(s, { type: 'sheet_set_extra', sheetId: sh.id, jobId: jb.id, kind: 'other', value: { decision: 'bill', amount: 160, note: "Owner's confirmed spreadsheet amount; no Admin receipt recorded" } }); assert.equal(jb.adminReceipts.amounts.other, null, 'no receipt was invented'); }
  return { s, ids };
}
const total = (s, id) => f.sheetSummary(s, s.billingSheets.find((x) => x.id === id)).totalSatang;

test('one customer, several simultaneous invoice groups; each work order on exactly one; simulated TRNs are distinct', () => {
  const { s, ids } = groups(base());
  assert.equal(s.billingSheets.length, 4); assert.equal(new Set(s.billingSheets.map((x) => x.simulatedTrn)).size, 4);
  assert.deepEqual(s.billingSheets.map((x) => x.simulatedTrn), ['TRN651/2026', 'TRN652/2026', 'TRN653/2026', 'TRN654/2026']);
  assert.deepEqual(s.billingSheets.map((x) => x.label), ['Sirtec', 'Titan', 'Goodyear', 'Saffron']);
  assert.deepEqual(s.billingSheets.map((x) => x.jobIds.length), [3, 1, 1, 1]);
  for (const j of JOBS) assert.equal(s.billingSheets.filter((x) => x.jobIds.includes(job(s, j.wo).id)).length, 1, `WO ${j.wo} on exactly one group`);
  // creating another group needs the explicit flag; a work order cannot be on two groups
  assert.throws(() => act(s, { type: 'sheet_create', clientId: 'apl' }), /FINANCE_SHEET_ALREADY_OPEN/);
  assert.throws(() => act(s, { type: 'sheet_add_paper', sheetId: ids[1], workOrder: '6424' }), /FINANCE_WO_IN_OTHER_SHEET/);
  assert.ok(s.simulatedTrnLast === 654);
});

test('move a work order between draft groups: charges and history travel with it, both groups audited, validations hold', () => {
  let { s, ids } = priced();
  const before = { sirtec: total(s, ids[0]), titan: total(s, ids[1]) };
  const jb = job(s, '5817.1');
  const moved = act(s, { type: 'sheet_move_to_group', fromSheetId: ids[1], toSheetId: ids[0], jobId: jb.id, reason: 'Allocated to the wrong invoice' });
  const sirtec = moved.billingSheets.find((x) => x.id === ids[0]); const titan = moved.billingSheets.find((x) => x.id === ids[1]);
  assert.ok(sirtec.jobIds.includes(jb.id)); assert.ok(!titan.jobIds.includes(jb.id)); assert.equal(sirtec.lines[jb.id].transport.amount, 8880);
  assert.equal(total(moved, ids[0]), before.sirtec + 888000); assert.equal(total(moved, ids[1]), 0);
  assert.equal(moved.billingSheets.reduce((n, x) => n + x.jobIds.filter((i) => i === jb.id).length, 0), 1, 'still on exactly one group');
  const tail = moved.audit.slice(-2);
  assert.deepEqual(tail.map((a) => a.action), ['sheet_move_out', 'sheet_move_to_group']); assert.deepEqual(tail.map((a) => a.subject), ['TRN652/2026', 'TRN651/2026']);
  assert.match(tail[1].detail, /moved from TRN652\/2026 to TRN651\/2026 with its transport charge, extra charges and price history.*wrong invoice/);
  // validations
  assert.throws(() => act(moved, { type: 'sheet_move_to_group', fromSheetId: ids[1], toSheetId: ids[0], jobId: jb.id }), /FINANCE_SHEET_PAPER_NOT_FOUND/);
  assert.throws(() => act(s, { type: 'sheet_move_to_group', fromSheetId: ids[1], toSheetId: ids[1], jobId: jb.id }), /FINANCE_SHEET_NOT_FOUND/);
  const locked = act(s, { type: 'sheet_mark_ready', sheetId: ids[0] });
  assert.throws(() => act(locked, { type: 'sheet_move_to_group', fromSheetId: ids[1], toSheetId: ids[0], jobId: jb.id }), /FINANCE_SHEET_LOCKED/);
  assert.throws(() => act(locked, { type: 'sheet_move_to_group', fromSheetId: ids[0], toSheetId: ids[1], jobId: job(s, '6424').id }), /FINANCE_SHEET_LOCKED/);
});

test('four draft invoices reconcile to the owner\'s historical groups; extras follow their work order exactly once', () => {
  const { s, ids } = priced();
  const totals = ids.map((id) => total(s, id));
  assert.deepEqual(totals, [4038000, 888000, 339000, 848500], '฿40,380 / ฿8,880 / ฿3,390 / ฿8,485');
  // independent derivation from the saved lines
  for (const id of ids) {
    const sh = s.billingSheets.find((x) => x.id === id); let sum = 0;
    for (const jid of sh.jobIds) { const l = sh.lines[jid]; sum += Math.round(l.transport.amount * 100); for (const e of Object.values(l.extras)) if (e.decision === 'bill') sum += Math.round(e.amount * 100); }
    assert.equal(sum, total(s, id));
  }
  const allExtras = s.billingSheets.flatMap((sh) => sh.jobIds.flatMap((jid) => Object.entries(sh.lines[jid].extras).map(([k, e]) => `${f.confirmedWorkOrder(s.bookings.find((b) => b.id === jid))}:${k}:${e.amount}`)));
  assert.deepEqual(allExtras.sort(), ['5838:toll:365', '5913:other:160', '6144:parking:60', '6144:toll:30', '6424:toll:320', '6956:toll:365'], 'each charge once, on its own work order');
  assert.equal(totals.reduce((a, b) => a + b, 0), 6113500, 'aggregate ฿61,135 across four invoices (reporting only)');
  // each group has its own invoice with its own number and total
  const docs = ids.map((id) => { const sh = s.billingSheets.find((x) => x.id === id); return fromSheet.invoiceFromSheet(s, sh, fromSheet.previewProfileForSheet(sh).profile, '2026-11-06'); });
  assert.deepEqual(docs.map((d) => d.totals.subtotalSatang), totals);
  assert.deepEqual(docs.map((d) => d.invoiceNo), ['TRN651/2026', 'TRN652/2026', 'TRN653/2026', 'TRN654/2026']);
  assert.deepEqual(docs.map((d) => d.lines.filter((l) => l.kind === 'trip').length), [3, 1, 1, 1]);
  // Finance Records: four separate batches
  const batches = records.buildFinanceRecords(s).batches;
  assert.equal(batches.length, 4); assert.deepEqual(batches.map((b) => b.totalSatang).sort((a, b) => a - b), [...totals].sort((a, b) => a - b));
  // fuel evidence follows each job; one verified value per date is reused across groups
  assert.equal(s.fuelReferences.length, 3);
  for (const j of JOBS) { const c = ev.fuelCalculation(s, s.billingSheets.find((x) => x.jobIds.includes(job(s, j.wo).id)), job(s, j.wo)); assert.equal(c.state, 'applied'); assert.equal(c.fuel.status, 'verified'); }
  assert.equal(ev.fuelCalculation(s, s.billingSheets[2], job(s, '6144')).tableCharge, 3350);
});

test('grouping UI is wired: group strip, new group, move-to-group, unassigned list, aggregate label', () => {
  const flow = read('components/finance-billing-flow.tsx');
  for (const id of ['invoice-groups', 'new-invoice-group', 'customer-aggregate', 'invoice-group-chip']) assert.match(flow, new RegExp(id));
  assert.match(flow, /Aggregate across/); assert.match(flow, /issued and stored separately/);
  const arrange = read('components/finance-arrange-stage.tsx');
  assert.match(arrange, /move-to-group/); assert.match(arrange, /unassigned-work-orders/); assert.match(arrange, /sheet_move_to_group/);
});

test('MASS control batch is unchanged by grouping support', () => {
  let s = f.createEmptyOwnerState();
  [['219', 2200], ['253', 10000], ['220', 5000]].forEach(([wo, amt], i) => { s = f.linkDiaryWorkOrder(s, { id: 'm' + i, booking_id: 'M' + i, client_id: 'mass', client_name: 'MASS', booking_date: '2026-01-05', pickup: 'P' + i, dropoff: 'D' + i, vehicle_registration: 'V' + i, driver: 'X' }, wo, 'admin', receipts(wo === '219' ? { container_pickup: 200 } : {})); });
  s = act(s, { type: 'sheet_create', clientId: 'mass' }); const id = s.billingSheets.at(-1).id;
  for (const wo of ['219', '253', '220']) s = act(s, { type: 'sheet_add_paper', sheetId: id, workOrder: wo });
  for (const [wo, amt] of [['219', 2200], ['253', 10000], ['220', 5000]]) s = act(s, { type: 'sheet_set_transport', sheetId: id, jobId: job(s, wo).id, transport: { amount: amt, source: 'manual' } });
  s = act(s, { type: 'sheet_set_extra', sheetId: id, jobId: job(s, '219').id, kind: 'container_pickup', value: { decision: 'bill', amount: 200 } });
  assert.equal(total(s, id), 1740000);
});
