const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const h = require('./helpers/invoice-compare.cjs');

const baht = h.lib('thai-baht-text.ts').thaiBahtText;
const model = h.lib('finance-invoice-model.ts');
const profiles = h.lib('finance-customer-profiles.ts');
const render = h.lib('finance-invoice-render.ts');

test('Thai baht text: reference amount, satang, ones/tens/millions rules', () => {
  assert.equal(baht(475200), 'สี่พันเจ็ดร้อยห้าสิบสองบาทถ้วน');
  assert.equal(baht(0), 'ศูนย์บาทถ้วน');
  assert.equal(baht(100), 'หนึ่งบาทถ้วน');
  assert.equal(baht(1100), 'สิบเอ็ดบาทถ้วน');
  assert.equal(baht(2100), 'ยี่สิบเอ็ดบาทถ้วน');
  assert.equal(baht(12345), 'หนึ่งร้อยยี่สิบสามบาทสี่สิบห้าสตางค์');
  assert.equal(baht(50), 'ห้าสิบสตางค์');
  assert.equal(baht(101), 'หนึ่งบาทหนึ่งสตางค์');
  assert.equal(baht(100000000), 'หนึ่งล้านบาทถ้วน');
  assert.equal(baht(100000100), 'หนึ่งล้านเอ็ดบาทถ้วน');
  assert.equal(baht(2500000000), 'ยี่สิบห้าล้านบาทถ้วน');
  assert.throws(() => baht(1.5));
  assert.throws(() => baht(-1));
});

test('invoice maths: gross, 1% deduction, advance, net — integer satang, half-up', () => {
  const totals = model.computeInvoiceTotals([{ amountSatang: 380000 }, { amountSatang: 100000 }], { basisPoints: 100 });
  assert.deepEqual({ ...totals }, { subtotalSatang: 480000, amountColumnSatang: 480000, parkingSatang: 0, overtimeSatang: 0, deductionSatang: 4800, deductionBasisPoints: 100, advanceSatang: 0, netSatang: 475200 });
  assert.equal(model.percentOfSatang(12350, 100), 124); // 123.50 → 1.235 → 1.24 (half up)
  assert.equal(model.percentOfSatang(12349, 100), 123);
  assert.equal(model.computeInvoiceTotals([{ amountSatang: 480000 }], null).deductionSatang, 0); // no deduction unless a rule says so
  assert.equal(model.computeInvoiceTotals([{ amountSatang: 480000 }], { basisPoints: 100 }, 100000).netSatang, 480000 - 4800 - 100000);
});

test('INTEGRA profile is pending owner approval, so it is not auto-selected for real drafts', () => {
  const profile = profiles.findCustomerProfile('Integra Logistics Corporation Co., Ltd.');
  assert.ok(profile && profile.taxId === '0105551036315');
  assert.equal(profile.reviewStatus, 'pending_owner_approval');
  assert.equal(profiles.approvedProfileFor('INTEGRA LOGISTICS CORPORATION CO., LTD.'), null);
  assert.equal(profiles.findCustomerProfile('Fixture MASS'), null); // MASS never gets the INTEGRA template or deduction
  const doc = h.integraFixtureDocument().doc;
  assert.ok(doc.warnings.some((w) => /not approved/i.test(w)));
});

test('fixture invoice reproduces the reference figures', () => {
  const { doc } = h.integraFixtureDocument();
  assert.equal(doc.totals.subtotalSatang, 480000);
  assert.equal(doc.totals.deductionSatang, 4800);
  assert.equal(doc.totals.netSatang, 475200);
  assert.equal(doc.amountInWordsTh, 'สี่พันเจ็ดร้อยห้าสิบสองบาทถ้วน');
  assert.equal(doc.seller.taxId, '0105559196532');
  assert.equal(doc.customer.taxId, '0105551036315');
  assert.equal(doc.lines.filter((l) => l.kind === 'extra').length, 1); // overnight stays its own row
  assert.equal(render.invoiceDate('2026-10-27'), '27-10-26');
  assert.equal(render.money2(475200), '4,752.00');
  assert.deepEqual([render.INVOICE_PAGE.width, render.INVOICE_PAGE.height], [612, 792]); // US Letter, as the source
});

test('pagination keeps the one-page form for normal batches and adds pages instead of shrinking', () => {
  const rows = (n) => Array.from({ length: n }, (_, i) => i);
  assert.equal(render.paginateInvoiceLines(rows(13)).length, 1);
  const many = render.paginateInvoiceLines(rows(40));
  assert.ok(many.length >= 2);
  assert.equal(many.flat().length, 40);
  assert.ok(many[many.length - 1].length <= render.ROWS_SINGLE_PAGE); // totals + signatures always fit on the last page
});

test('visual comparison with the owner reference PDF (rules geometry and ink overlap)', async (t) => {
  const refPng = path.join(h.root, '.ees-local', 'invoice-ref', 'ref-p1.png');
  if (!fs.existsSync(refPng)) { t.skip('reference render missing — run: node scripts/pdf-reference-tools.mjs "TRN invoice test.pdf" .ees-local/invoice-ref/ref 3'); return; }
  const { doc } = h.integraFixtureDocument();
  const [png] = await h.renderFixturePng(3, doc);
  const ref = await h.luminance(fs.readFileSync(refPng));
  const gen = await h.luminance(png);
  assert.deepEqual([gen.width, gen.height], [ref.width, ref.height]);
  const cmp = h.compareRules(h.rules(ref, 3), h.rules(gen, 3));
  // Every border/rule that is long and horizontal in the source must exist in the same place (±1.2 pt).
  assert.deepEqual(cmp.missing.filter((r) => r.axis === 'h'), []);
  // Table column rules (tall verticals) too; short vertical strokes are letter stems, not borders.
  assert.deepEqual(cmp.missing.filter((r) => r.axis === 'v' && r.to - r.from > 30 && r.pos > 70), []);
  const ink = h.inkOverlap(ref, gen, 4);
  assert.ok(ink.referenceCovered > 0.97, `reference ink covered ${ink.referenceCovered}`);
  assert.ok(ink.generatedCovered > 0.97, `generated ink covered ${ink.generatedCovered}`);
});

test('draft banner sits in the top margin, outside the source form area', () => {
  const src = fs.readFileSync(path.join(h.root, 'lib', 'finance-invoice-render.ts'), 'utf8');
  assert.match(src, /strokeRect\(76\.33, 14, 434\.7, 20\)/);
  assert.match(src, /NOT AN ISSUED INVOICE/);
});

test('dynamic population: saved MASS batch → invoice lines from the same figures; INTEGRA rules never leak to MASS', (t) => {
  const stateFile = path.join(h.root, '.ees-local', 'finance-test', 'state.json');
  if (!fs.existsSync(stateFile)) { t.skip('no local Finance state'); return; }
  const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  const state = (saved.workspaces && saved.workspaces[saved.activeWorkspace]) || saved.state || saved;
  const sheet = (state.billingSheets || []).find((s) => /MASS/i.test(s.client) && s.jobIds.length === 3);
  if (!sheet) { t.skip('MASS test batch not present'); return; }
  const fromSheet = h.lib('finance-invoice-from-sheet.ts');
  const dc = h.lib('finance-demo-centre.ts');
  assert.equal(fromSheet.invoiceProfileForSheet(sheet).profile, null); // no customer profile → generic draft, never the INTEGRA template
  const approved = { ...profiles.CUSTOMER_BILLING_PROFILES[0], reviewStatus: 'approved', deduction: null, match: ['MASS'] }; // synthetic: tests the plumbing only
  const doc = fromSheet.invoiceFromSheet(state, sheet, approved, '2026-11-05');
  const summary = dc.sheetSummary(state, sheet);
  assert.equal(doc.totals.subtotalSatang, summary.totalSatang); // invoice == billing sheet == records
  assert.equal(doc.totals.deductionSatang, 0);
  assert.equal(doc.lines.filter((l) => l.kind === 'trip').length, 3);
  assert.deepEqual(doc.lines.filter((l) => l.kind === 'trip').map((l) => l.workOrder), sheet.jobIds.map((id) => dc.confirmedWorkOrder(state.bookings.find((b) => b.id === id))));
  const extras = doc.lines.filter((l) => l.kind === 'extra');
  assert.ok(extras.every((l) => l.amountSatang > 0 && l.description)); // extras stay separate rows
  assert.equal(doc.invoiceNo, sheet.simulatedTrn ?? sheet.draftReference);
  assert.equal(doc.draft, true);
});

test('modern proposal: same figures/structure, current EES logo untouched, form typos corrected only there', async () => {
  const src = fs.readFileSync(path.join(h.root, 'lib', 'finance-invoice-render.ts'), 'utf8');
  assert.match(src, /RECEIVEC/); // reference keeps the source typos
  assert.match(src, /SINGNATURE/);
  assert.match(src, /INVOICE_TEMPLATE_TEXT_MODERN = \{ receiver: "ผู้รับบิล\/RECEIVED\/วันที่ DATE", signature: "ลายเซ็นต์ผู้มีอำนาจ\/AUTHORIZED SIGNATURE" \}/);
  // The modern version uses the app's own logo file as-is (crop by source rectangle only, no re-colouring or redraw).
  const crypto = require('node:crypto');
  const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(h.root, f))).digest('hex');
  assert.equal(sha('public/ees-logo.png'), sha('assets/branding/ees-mark.png'));
  const { doc } = h.integraFixtureDocument();
  const [ref] = await h.renderFixturePng(2, doc, 'reference');
  const [modern] = await h.renderFixturePng(2, doc, 'modern');
  const a = await h.luminance(ref), b = await h.luminance(modern);
  assert.deepEqual([a.width, a.height], [b.width, b.height]); // identical page size and resolution
  // Table geometry identical in both versions: every reference rule exists in the modern render.
  const cmp = h.compareRules(h.rules(a, 2), h.rules(b, 2));
  assert.deepEqual(cmp.missing.filter((r) => r.axis === 'h'), []);
  const ink = h.inkOverlap(a, b, 3);
  assert.ok(ink.referenceCovered > 0.9, `modern keeps the structure (${ink.referenceCovered})`);
});

test('Parking and OT print in their own columns (isolated fixture, never MASS data)', async () => {
  const model = h.lib('finance-invoice-model.ts');
  const profile = h.integraFixtureDocument().profile;
  const lines = [
    { kind: 'trip', date: '2026-10-27', pickup: 'A', delivery: 'B', vehicle: '64-0359', workOrder: '6372', fuelRate: 43.54, description: '', amountSatang: 380000, parkingSatang: 15000, overtimeSatang: 30000 },
    { kind: 'extra', date: null, pickup: '', delivery: '', vehicle: '', workOrder: '', fuelRate: null, description: 'OVERNIGHT CHARGE', amountSatang: 100000 }
  ];
  const withCols = model.buildInvoiceDocument({ invoiceNo: 'TRN0/2026', invoiceNoKind: 'draft_reference', invoiceDate: '2026-11-02', draft: true, lines }, profile);
  const without = model.buildInvoiceDocument({ invoiceNo: 'TRN0/2026', invoiceNoKind: 'draft_reference', invoiceDate: '2026-11-02', draft: true, lines: lines.map((l) => ({ ...l, parkingSatang: null, overtimeSatang: null })) }, profile);
  assert.equal(withCols.totals.subtotalSatang, 480000 + 15000 + 30000); // gross includes both columns
  assert.equal(withCols.totals.parkingSatang, 15000);
  assert.equal(withCols.totals.overtimeSatang, 30000);
  assert.equal(withCols.totals.deductionSatang, 5250); // 1% of 5,250.00 → 52.50
  assert.equal(withCols.totals.netSatang, 525000 - 5250);
  // Pixels: the Parking column (x 338–379.5 pt) and OT column (379.5–423.7 pt) of row 1 hold ink only when amounts exist.
  const [a] = await h.renderFixturePng(3, withCols); const [b] = await h.renderFixturePng(3, without);
  const A = await h.luminance(a), B = await h.luminance(b);
  const inkIn = (img, x0, x1, y0, y1) => { let n = 0; for (let y = Math.round(y0 * 3); y < Math.round(y1 * 3); y += 1) for (let x = Math.round(x0 * 3); x < Math.round(x1 * 3); x += 1) if (img.lum[y * img.width + x] < 120) n += 1; return n; };
  assert.ok(inkIn(A, 340, 378, 295, 312) > 20, 'parking amount drawn in the Parking column');
  assert.ok(inkIn(A, 381, 422, 295, 312) > 20, 'overtime amount drawn in the OT column');
  assert.equal(inkIn(B, 340, 378, 295, 312), 0, 'blank stays blank');
  assert.equal(inkIn(B, 381, 422, 295, 312), 0);
});

test('invoice preview never borrows another customer\'s details; a customer without a profile shows pending values', () => {
  const fromSheet = h.lib('finance-invoice-from-sheet.ts');
  const p = fromSheet.previewProfileForSheet({ client: 'MASS' });
  assert.equal(p.kind, 'no_profile');
  assert.equal(p.profile.taxId.includes('PENDING'), true);
  assert.equal(p.profile.deduction, null);
  assert.notEqual(p.profile.taxId, '0105551036315');
  assert.equal(fromSheet.previewProfileForSheet({ client: 'Integra Logistics' }).kind, 'pending_profile');
});

test('Admin-recorded receipts stay separate from Finance-approved customer charges; only confirmed charges reach the invoice', (t) => {
  const stateFile = path.join(h.root, '.ees-local', 'finance-test', 'state.json');
  if (!fs.existsSync(stateFile)) { t.skip('no local Finance state'); return; }
  const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  const state = JSON.parse(JSON.stringify((saved.workspaces && saved.workspaces[saved.activeWorkspace]) || saved.state || saved)); // in-memory clone; never written
  const sheet = (state.billingSheets || []).find((s) => /MASS/i.test(s.client) && s.jobIds.length === 3);
  if (!sheet) { t.skip('MASS test batch not present'); return; }
  const fromSheet = h.lib('finance-invoice-from-sheet.ts');
  const dc = h.lib('finance-demo-centre.ts');
  const profile = fromSheet.previewProfileForSheet(sheet).profile;
  const baseline = fromSheet.invoiceFromSheet(state, sheet, profile).totals.subtotalSatang;
  const job = state.bookings.find((b) => b.id === sheet.jobIds[1]);
  job.adminReceipts = { ...(job.adminReceipts || {}), amounts: { ...((job.adminReceipts || {}).amounts || {}), parking: 150, toll: 70, overtime: 300 } };
  const line = sheet.lines[job.id];
  for (const k of ['parking', 'toll', 'overtime']) delete line.extras[k];
  // 1) Admin recorded receipts, Finance has not decided → nothing added.
  let doc = fromSheet.invoiceFromSheet(state, sheet, profile);
  assert.equal(doc.totals.subtotalSatang, baseline);
  assert.equal(doc.totals.parkingSatang + doc.totals.overtimeSatang, 0);
  // 2) Finance marks them not billable → still nothing added.
  for (const k of ['parking', 'toll', 'overtime']) line.extras[k] = { amount: null, decision: 'not_billable' };
  doc = fromSheet.invoiceFromSheet(state, sheet, profile);
  assert.equal(doc.totals.subtotalSatang, baseline);
  // 3) Finance confirms a customer-billable amount that differs from the receipt → the confirmed amount is used.
  line.extras.parking = { amount: 100, decision: 'bill' };
  line.extras.toll = { amount: 70, decision: 'bill' };
  line.extras.overtime = { amount: 250, decision: 'bill' };
  doc = fromSheet.invoiceFromSheet(state, sheet, profile);
  assert.equal(doc.totals.parkingSatang, 10000); // ฿100 confirmed, not the ฿150 receipt
  assert.equal(doc.totals.overtimeSatang, 25000);
  assert.equal(doc.totals.subtotalSatang, baseline + 10000 + 25000 + 7000);
  assert.ok(doc.lines.some((l) => l.kind === 'extra' && /TOLL/.test(l.description) && l.amountSatang === 7000)); // toll = its own row
  // The Admin receipt itself is untouched.
  assert.equal(job.adminReceipts.amounts.parking, 150);
  assert.equal(dc.sheetSummary(state, sheet).totalSatang, doc.totals.subtotalSatang); // billing sheet agrees with the invoice
});
