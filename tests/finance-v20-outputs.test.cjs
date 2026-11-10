const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/invoice-compare.cjs');
const f = h.lib('finance-demo-centre.ts');
const fromSheet = h.lib('finance-invoice-from-sheet.ts');
const render = h.lib('finance-invoice-render.ts');
const records = h.lib('finance-records.ts');
const SOURCE = 'https://xn--42c6baaa9bl0b2fcebb3cztja2d.com/history';

// Isolated in-memory fixtures; amounts come from the genuine imported tables through the engine. Fuel values are FIXTURE values.
const rc = (a = {}) => ({ amounts: Object.fromEntries(f.ADMIN_RECEIPT_FIELDS.map((k) => [k, a[k] ?? null])), notes: '' });
const seed = (id, date, pu, de, veh, plate) => ({ id, booking_id: `BK-O-${id}`, client_id: 'fixture-apl', client_name: 'APL (fixture)', booking_date: date, pickup: pu, dropoff: de, vehicle: veh, vehicle_registration: plate, driver: 'Driver' });
const act = (s, a, who = 'finance') => f.applyAction(s, a, who);

function fourGroups() {
  let s = f.createEmptyOwnerState();
  const link = (...a) => { s = f.linkDiaryWorkOrder(s, seed(...a.slice(0, 6)), a[6], 'admin', rc(a[7])); };
  link('s1', '2026-10-26', 'Sirtec', 'CAL-COMP', 'trailer', '64-8665', '6424', { toll: 320 });
  link('s2', '2026-10-26', 'Sirtec', 'CAL-COMP', 'trailer', '68-7154', '5838', { toll: 365 });
  link('s3', '2026-10-26', 'Sirtec', 'CAL-COMP', 'trailer', '79-5318', '6956', { toll: 365 });
  link('g1', '2026-10-26', 'GOODYEAR', 'สุวรรณภูมิ', '6ล้อ', '701-1654', '6144', { parking: 60, toll: 30 });
  link('t1', '2026-09-15', 'TITAN SPORTSWEAR CO., LTD', 'Khon Kaen', '4ล้อ', '70-0001', '5817.1', {});
  link('f1', '2026-09-23', 'SAFFRON - BANGNA', 'Khon Kaen', '40', '70-0002', '5913', { other: 160 });
  const map = (sc, row, pu, de, vc) => { s = act(s, { type: 'confirm_rate_mapping', scheduleId: sc, rowId: row, clientId: 'fixture-apl', contractReference: 'FIXTURE', effectiveFrom: '2026-01-01', effectiveTo: null, reviewReason: '', match: { pickup: pu, delivery: de, vehicleClass: vc } }, 'approver'); };
  map('sirtech', 'sirtech-calcomp-trailer-empty40', ['sirtec'], ['calcomp'], ['TRAILER']);
  map('goodyear', 'goodyear-route-2', ['goodyear'], ['สุวรรณภูมิ'], ['6W']);
  map('apl', 'apl-route-7', ['titan'], ['khonkaen'], ['4W']);
  map('apl', 'apl-route-10', ['saffron'], ['khonkaen'], ['40']);
  for (const [d, p] of [['2026-10-26', 43.54], ['2026-09-15', 40.69], ['2026-09-23', 40.69]]) s = act(s, { type: 'record_fuel_reference', date: d, priceThb: p, evidence: 'Isolated fixture value (not a real verified record)', sourceUrl: SOURCE });
  const job = (wo) => s.bookings.find((b) => f.confirmedWorkOrder(b) === wo);
  const group = (label, wos) => { s = act(s, { type: 'sheet_create', clientId: 'fixture-apl', label, additional: true }); const id = s.billingSheets.at(-1).id; for (const wo of wos) s = act(s, { type: 'sheet_add_paper', sheetId: id, workOrder: wo }); return id; };
  const ids = [group('Sirtec', ['6424', '5838', '6956']), group('Goodyear', ['6144']), group('Titan', ['5817.1']), group('Saffron', ['5913'])];
  for (const id of ids) for (const jobId of s.billingSheets.find((x) => x.id === id).jobIds) {
    const b = s.bookings.find((x) => x.id === jobId);
    if (f.ownerTransportDecision(b)) continue; // owner clicks this one
    const d = f.diagnoseRate(s, b);
    assert.equal(d.kind, 'suggested');
    s = act(s, { type: 'sheet_apply_rate', sheetId: id, jobId, mappingId: d.mappingId, amountThb: d.amountThb, overrideReason: '', routeVehicleConfirmed: true, confirmOverwrite: false });
  }
  const dec = f.ownerTransportDecision(job('6144'));
  s = act(s, { type: 'sheet_set_transport', sheetId: ids[1], jobId: job('6144').id, transport: { amount: dec.amountThb, source: 'manual', suggestedThb: dec.suggestedThb, overrideReason: dec.reason } });
  const bill = (i, wo, k, a) => { s = act(s, { type: 'sheet_set_extra', sheetId: ids[i], jobId: job(wo).id, kind: k, value: { decision: 'bill', amount: a } }); };
  bill(0, '6424', 'toll', 320); bill(0, '5838', 'toll', 365); bill(0, '6956', 'toll', 365); bill(1, '6144', 'parking', 60);
  s = act(s, { type: 'sheet_reclassify_extra', sheetId: ids[1], jobId: job('6144').id, from: 'toll', to: 'other' });
  bill(3, '5913', 'other', 160);
  return { s, ids };
}

// Recording canvas: captures every string the real drawing code prints.
function recordingCanvas(w, hgt) {
  const texts = [];
  let fontSize = 10;
  const ctx = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'fillText' || prop === 'strokeText') return (t) => { texts.push(String(t)); };
      // Width scales with the current font size like a real canvas (about 0.5 em per glyph), so shrink-to-fit behaves realistically.
      if (prop === 'measureText') return (t) => ({ width: String(t).length * fontSize * 0.5 });
      return () => {};
    },
    set(_t, prop, value) { if (prop === 'font') { const m = /(\d+(?:\.\d+)?)px/.exec(String(value)); if (m) fontSize = Number(m[1]); } return true; }
  });
  return { width: w, height: hgt, texts, getContext: () => ctx };
}
const printed = (doc, variant) => render.drawInvoice(recordingCanvas, 1, doc, { variant, banner: true }).flatMap((c) => c.texts).join(' ');
const baht = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

test('four separate invoices: totals agree across Billing, Original, Modern, and Finance Records; extras counted once', () => {
  const { s, ids } = fourGroups();
  const sheets = ids.map((id) => s.billingSheets.find((x) => x.id === id));
  const billing = sheets.map((sh) => f.sheetSummary(s, sh).totalSatang);
  assert.deepEqual(billing.map((x) => x / 100), [40380, 3390, 8880, 8485]);
  assert.equal(billing.reduce((a, b) => a + b, 0) / 100, 61135);

  const recs = records.buildFinanceRecords(s);
  sheets.forEach((sheet, i) => {
    const doc = fromSheet.invoiceFromSheet(s, sheet, fromSheet.previewProfileForSheet(sheet).profile, '2026-11-06');
    assert.equal(doc.draft, true, 'drafts stay watermarked');
    assert.equal(doc.totals.subtotalSatang, billing[i], `invoice ${sheet.simulatedTrn} equals Billing`);
    const text = billing[i] / 100;
    for (const variant of ['reference', 'modern']) {
      const out = printed(doc, variant);
      assert.ok(out.includes(baht(text)), `${variant} PDF for ${sheet.simulatedTrn} prints ${baht(text)}`);
      assert.ok(out.includes(sheet.simulatedTrn), `${variant} PDF prints ${sheet.simulatedTrn}`);
      for (const jobId of sheet.jobIds) { const wo = f.confirmedWorkOrder(s.bookings.find((b) => b.id === jobId)); assert.ok(out.includes(wo), `${variant} PDF for ${sheet.simulatedTrn} lists WO ${wo}; printed: ${out.slice(0, 400)}`); }
      assert.match(out, /DRAFT|TEST|ทดสอบ|ตัวอย่าง/i, `${variant} PDF keeps its draft/test marking`);
    }
    const batch = recs.batches.find((b) => b.trn === sheet.simulatedTrn);
    assert.ok(batch, `Finance Records keeps ${sheet.simulatedTrn} as its own invoice`);
    assert.equal(batch.totalSatang, billing[i]);
  });
  assert.equal(new Set(recs.batches.filter((b) => sheets.some((x) => x.simulatedTrn === b.trn)).map((b) => b.trn)).size, 4);
  // Goodyear: extras are counted exactly once and ฿30 shows as Other, not Toll.
  const gDoc = fromSheet.invoiceFromSheet(s, sheets[1], fromSheet.previewProfileForSheet(sheets[1]).profile, '2026-11-06');
  const extras = gDoc.lines.filter((l) => l.kind === 'extra').map((l) => l.description);
  // Parking is printed in the Parking column; the ฿30 is the only separate line and it is OTHER, never TOLL.
  assert.equal(extras.length, 1);
  assert.match(extras[0], /OTHER/i);
  assert.ok(!extras.some((d) => /TOLL/i.test(d)));
  assert.equal(gDoc.totals.parkingSatang, 6000);
  assert.equal(gDoc.totals.subtotalSatang, 339000);
});
