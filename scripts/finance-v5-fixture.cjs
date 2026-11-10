// Explicit isolated fixture store only. Does not read credentials or the normal Finance store.
const fs = require('node:fs');
const path = require('node:path');
const h = require('../tests/helpers/invoice-compare.cjs');
const f = h.lib('finance-demo-centre.ts');
const p = h.lib('finance-local-persistence.ts');
const dir = path.resolve('tmp/finance-v5-isolated-store');
if (fs.existsSync(path.join(dir, 'state.json'))) throw new Error('Fixture already exists; refusing to replace it.');
let s = f.createEmptyOwnerState();
for (const [wo, amount, toll] of [['6424', 13110, 320], ['5838', 5000, 365], ['6956', 5000, 365]]) {
  s = f.linkDiaryWorkOrder(s, { id: `v5-${wo}`, client_id: 'v5-apl', client_name: 'APL isolated fixture', booking_date: '2026-10-26', pickup: 'Sirtec (fixture)', dropoff: 'CAL-COMP (fixture)', vehicle_registration: 'FIXTURE', driver: 'Fixture driver' }, wo, 'admin', { amounts: Object.fromEntries(f.ADMIN_RECEIPT_FIELDS.map(k => [k, k === 'toll' ? toll : null])), notes: 'V5 test fixture' });
}
s = f.applyAction(s, { type: 'sheet_create', clientId: 'v5-apl' }, 'finance');
const id = s.billingSheets.at(-1).id;
for (const [wo, amount, toll] of [['6424', 13110, 320], ['5838', 5000, 365], ['6956', 5000, 365]]) {
  const jobId = s.bookings.find(j => f.confirmedWorkOrder(j) === wo).id;
  for (const a of [{ type: 'sheet_add_paper', sheetId: id, workOrder: wo }, { type: 'sheet_set_transport', sheetId: id, jobId, transport: { amount, source: 'manual', overrideReason: 'Owner historical manual example, isolated fixture only' } }, { type: 'sheet_set_extra', sheetId: id, jobId, kind: 'toll', value: { decision: 'bill', amount: toll } }]) s = f.applyAction(s, a, 'finance');
}
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(p.createFinanceLocalStoreEnvelope({ owner: s, previous_demo: f.createEmptyOwnerState() }, 'admin', 'owner')));
console.log('Created isolated APL fixture only: tmp/finance-v5-isolated-store');
