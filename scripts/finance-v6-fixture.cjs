// Explicit isolated fixture store only. Does not read credentials or the normal Finance store.
const fs = require('node:fs');
const path = require('node:path');
const h = require('../tests/helpers/invoice-compare.cjs');
const f = h.lib('finance-demo-centre.ts');
const p = h.lib('finance-local-persistence.ts');
const dir = path.resolve('tmp/finance-v6-isolated-store');
if (fs.existsSync(path.join(dir, 'state.json'))) throw new Error('Fixture already exists; refusing to replace it.');
let s = f.createEmptyOwnerState();
for (const [wo, amount, toll] of [['6424', 13110, 320], ['5838', 5000, 365], ['6956', 5000, 365]]) {
  s = f.linkDiaryWorkOrder(s, { id: `v6-${wo}`, client_id: 'v6-apl', client_name: 'APL isolated fixture', booking_date: '2026-10-26', pickup: 'Sirtec (fixture)', dropoff: 'CAL-COMP (fixture)', vehicle_registration: 'FIXTURE', driver: 'Fixture driver' }, wo, 'admin', { amounts: Object.fromEntries(f.ADMIN_RECEIPT_FIELDS.map(k => [k, k === 'toll' ? toll : null])), notes: 'V6 test fixture' });
}
s = f.applyAction(s, { type: 'sheet_create', clientId: 'v6-apl' }, 'finance');
const id = s.billingSheets.at(-1).id;
for (const [wo, amount, toll] of [['6424', 13110, 320], ['5838', 5000, 365], ['6956', 5000, 365]]) {
  const jobId = s.bookings.find(j => f.confirmedWorkOrder(j) === wo).id;
  for (const a of [{ type: 'sheet_add_paper', sheetId: id, workOrder: wo }, { type: 'sheet_set_transport', sheetId: id, jobId, transport: { amount, source: 'manual', overrideReason: 'Owner historical manual example, isolated fixture only' } }, { type: 'sheet_set_extra', sheetId: id, jobId, kind: 'toll', value: { decision: 'bill', amount: toll } }]) s = f.applyAction(s, a, 'finance');
}
const receipt = { amounts: Object.fromEntries(f.ADMIN_RECEIPT_FIELDS.map(k => [k, k === 'parking' ? 60 : k === 'toll' ? 30 : null])), notes: 'Explicit V6 receipt classification fixture' };
s = f.linkDiaryWorkOrder(s, { id: 'v6-6144', client_id: 'v6-apl', client_name: 'APL isolated fixture', booking_date: '2026-10-26', pickup: 'GOODYEAR (fixture)', dropoff: 'Airport (fixture)', vehicle_registration: 'FIXTURE-6144', driver: 'Fixture driver' }, '6144', 'admin', receipt);
s = f.applyAction(s, { type: 'sheet_create', clientId: 'v6-apl', additional: true, label: 'WO6144 receipt review' }, 'finance');
const goodyearId = s.billingSheets.at(-1).id;
for (const a of [{ type: 'sheet_add_paper', sheetId: goodyearId, workOrder: '6144' }, { type: 'sheet_set_transport', sheetId: goodyearId, jobId: 'v6-6144', transport: { amount: 3300, source: 'manual', overrideReason: 'Owner job-specific historical fixture, not contract verification' } }, { type: 'sheet_set_extra', sheetId: goodyearId, jobId: 'v6-6144', kind: 'parking', value: { decision: 'bill', amount: 60 } }, { type: 'sheet_set_extra', sheetId: goodyearId, jobId: 'v6-6144', kind: 'toll', value: { decision: 'bill', amount: 30 } }]) s = f.applyAction(s, a, 'finance');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(p.createFinanceLocalStoreEnvelope({ owner: s, previous_demo: f.createEmptyOwnerState() }, 'admin', 'owner')));
console.log('Created isolated APL fixture only: tmp/finance-v6-isolated-store');
