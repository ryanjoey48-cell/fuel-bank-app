const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

function loadPicker(rows, calls) {
  const supabase = { from(table) {
    assert.equal(table, 'booking_diary');
    const filters = {}; let start = 0; let end = 999;
    const query = {
      select() { return query; }, order() { return query; },
      range(a, b) { start = a; end = b; return query; },
      gte(field, value) { assert.equal(field, 'booking_date'); filters.from = value; return query; },
      lte(field, value) { assert.equal(field, 'booking_date'); filters.to = value; return query; },
      then(resolve, reject) {
        calls.push({ start, end, ...filters });
        const data = rows.filter((row) => (!filters.from || row.booking_date >= filters.from) && (!filters.to || row.booking_date <= filters.to)).slice(start, end + 1);
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      }
    }; return query;
  } };
  const mod = { exports: {} };
  const js = ts.transpileModule(fs.readFileSync('components/finance-booking-diary-picker.tsx', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('module', 'exports', 'require', js)(mod, mod.exports, (name) => name === '@/lib/supabase' ? { supabase, supabaseConfigError: null } : {});
  return mod.exports;
}
test('runtime loader paginates all matching historical rows and includes both boundary dates', async () => {
  const rows = Array.from({ length: 1001 }, (_, i) => ({ id: `isolated-${i}`, booking_date: i === 0 ? '2026-01-01' : '2026-01-31', pickup: 'Fixture', dropoff: 'Fixture', job_order_number: '003628.1' }));
  rows.push({ id: 'outside', booking_date: '2026-02-01' });
  const calls = []; const picker = loadPicker(rows, calls);
  const result = await picker.loadBookingDiaryPickerRows({ dateFrom: '2026-01-01', dateTo: '2026-01-31' });
  assert.equal(result.error, ''); assert.equal(result.rows.length, 1001);
  assert.equal(result.rows[0].job_order_number, '003628.1');
  assert.deepEqual(calls, [{ start: 0, end: 999, from: '2026-01-01', to: '2026-01-31' }, { start: 1000, end: 1999, from: '2026-01-01', to: '2026-01-31' }]);
  assert.equal(picker.formatDiaryDateDisplay('2026-01-19'), '19/01/2026');
});
test('invalid reversed range sends no database query', async () => {
  const calls = []; const picker = loadPicker([], calls);
  const result = await picker.loadBookingDiaryPickerRows({ dateFrom: '2026-02-01', dateTo: '2026-01-31' });
  assert.ok(result.error); assert.equal(calls.length, 0);
});

test('picker maps an optional source customer reference without deriving one from internal IDs or work orders', () => {
  const picker = loadPicker([], []);
  const input = { id: 'isolated', booking_id: 'BK-INTERNAL', job_order_number: 'GREEN-WO', customer_job_number: '000-CUSTOMER/09', booking_date: '2026-01-19' };
  const seed = picker.toDiaryPickerSeed(input);
  assert.equal(seed.customer_job_number, '000-CUSTOMER/09');
  assert.equal(seed.job_order_number, 'GREEN-WO');
  assert.equal(seed.booking_id, 'BK-INTERNAL');
  assert.equal(picker.toDiaryPickerSeed({ ...input, customer_job_number: undefined }).customer_job_number, null);
});
