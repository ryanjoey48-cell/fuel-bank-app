const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');
const crypto = require('node:crypto');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, main, options) {
  return originalResolve.call(this, request.startsWith('@/') ? path.resolve(request.slice(2)) + '.ts' : request, parent, main, options);
};
Module._extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const { withRequestDeadline, completeJsonResponse } = require('../lib/request-deadline.ts');
const { verifyDeletedServiceRow, createServiceRefreshCoordinator } = require('../lib/oil-service-mutations.ts');
const { buildOilServiceSnapshot, historyDistanceSinceService, latestValidService, recordedServiceDate } = require('../lib/oil-service-snapshot.ts');
const reg = '3ฒน-9565';
const service = (id, date, odometer = 354784, interval = 10000) => ({ id, vehicle_reg: reg, service_type: 'oil_change', service_date: date, odometer, oil_change_odometer: odometer, interval_km: interval, created_at: '2026-10-12T00:00:00Z' });
const reading = (date, odometer, extra = {}) => ({ id: date, vehicle_reg: reg, week_ending: date, odometer_reading: odometer, mileage: odometer, ...extra });
const vehicle = { id: 'vehicle', vehicle_reg: reg, registration: reg, vehicle_type: 'FOUR_WHEEL_TRUCK', active: true };
const snapshot = (logs, mileage, overrides = {}) => buildOilServiceSnapshot({ vehicles: [{ ...vehicle, ...overrides }], baselines: [], logs, mileage, drivers: [] })[0];

test('delete verifies exactly the selected primary key, including RLS zero-row failures', () => {
  verifyDeletedServiceRow([{ id: 'selected' }], 'selected');
  for (const data of [[], null, [{ id: 'correct-record' }], [{ id: 'selected' }, { id: 'other' }]]) assert.throws(() => verifyDeletedServiceRow(data, 'selected'), /No selected service record/);
});
test('timeout aborts the request and a later request can succeed', async () => {
  let aborted = false;
  await assert.rejects(withRequestDeadline(signal => new Promise(() => signal.addEventListener('abort', () => { aborted = true; })), null, 10), /timed out/);
  assert.equal(aborted, true);
  assert.equal(await withRequestDeadline(async () => 'recovered', null, 10), 'recovered');
});
test('caller cancellation is preserved', async () => {
  const controller = new AbortController(); controller.abort(new Error('cancelled by caller'));
  await assert.rejects(withRequestDeadline(async () => 'unexpected', controller.signal), /cancelled by caller/);
});
test('concurrent dashboard refreshes share a read and mutations trigger one trailing fresh snapshot', async () => {
  const coordinator = createServiceRefreshCoordinator(); let release; let calls = 0; let rendered;
  let data = ['correct', 'incorrect'];
  const load = async () => { calls++; const snapshot = [...data]; if (calls === 1) await new Promise(resolve => { release = resolve; }); rendered = snapshot; };
  const first = coordinator.run(load); const second = coordinator.run(load);
  assert.equal(first, second); assert.equal(calls, 1);
  data = ['correct']; coordinator.invalidate();
  const mutationRefresh = coordinator.run(load); release(); await mutationRefresh;
  assert.equal(calls, 2); assert.deepEqual(rendered, ['correct']);
});
test('failed refresh releases the coordinator for retry', async () => {
  const coordinator = createServiceRefreshCoordinator();
  await assert.rejects(coordinator.run(async () => { throw new Error('offline'); }), /offline/);
  let refreshed = false; await coordinator.run(async () => { refreshed = true; }); assert.equal(refreshed, true);
});
test('latest service uses service date, not its recorded date', () => {
  const old = { ...service('old', '2026-07-18', 341928), created_at: '2026-10-12T00:00:00Z' };
  const correct = { ...service('correct', '2026-09-05'), created_at: '2026-09-05T00:00:00Z' };
  assert.equal(latestValidService([old, correct]).id, 'correct');
});
test('historical repeated services remain advisory when current baseline is reliable', () => {
  const logs = [service('correct', '2026-09-05'), service('incorrect-1', '2026-09-07'), service('incorrect-2', '2026-10-05')];
  const before = JSON.stringify(logs); const row = snapshot(logs, [reading('2026-10-11', 360000)]);
  assert.equal(row.status, 'ok'); assert.match(row.reviewReasons.join(' '), /repeated/); assert.equal(JSON.stringify(logs), before);
  const repaired = snapshot([logs[0]], [reading('2026-10-11', 360000)]);
  assert.equal(repaired.nextOilChangeDueOdometer, 364784); assert.equal(repaired.kmUsedSinceOilChange, 5216); assert.equal(repaired.kmRemaining, 4784);
});
test('historical distance uses current valid mileage rather than the prior oil change', () => {
  const readings = [reading('2026-10-11', 360000)];
  assert.equal(historyDistanceSinceService(service('correct', '2026-09-05'), readings), 5216);
  assert.equal(historyDistanceSinceService(service('older', '2026-07-18', 341928), readings), 18072);
  assert.equal(historyDistanceSinceService(service('future', '2026-10-12'), readings), null);
});
test('saved historical intervals and vehicle overrides are preserved', () => {
  const row = snapshot([service('historic', '2026-04-18', 319468, 8000)], [reading('2026-04-19', 320000)]);
  assert.equal(row.oilChangeIntervalKm, 8000); assert.equal(row.nextOilChangeDueOdometer, 327468);
  assert.equal(snapshot([], [reading('2026-10-11', 360000)], { last_oil_change_date: '2026-09-05', last_oil_change_odometer: 354784, oil_change_interval_km: 12000 }).oilChangeIntervalKm, 12000);
});
test('status thresholds and impossible readings are calculated consistently', () => {
  for (const [odometer, status] of [[365000,'overdue'], [364784,'urgent'], [364500,'urgent'], [363500,'due_soon'], [355000,'ok'], [350000,'review_required']]) assert.equal(snapshot([service('correct','2026-09-05')],[reading('2026-10-11',odometer)]).status, status);
  assert.equal(snapshot([service('correct','2026-09-05')], [reading('2026-10-04',360000), reading('2026-10-11',359000)]).status, 'review_required');
  assert.equal(snapshot([service('correct','2026-09-05')], [reading('2026-10-11',360000), reading('2026-10-11',360100)]).status, 'review_required');
});

const selectedUuid = "388afff7-6421-483b-a754-da56b2f1b0ca";
const { deleteVerifiedOilServiceRecord } = require("../lib/oil-service-delete.ts");
function dataHarness() {
  const source = fs.readFileSync('lib/data.ts', 'utf8'); const calls = []; let result = { data: [{ id: selectedUuid }], error: null, status: 200 };
  const context = { crypto, verifyDeletedServiceRow, console: { error() {} },
    isMissingColumnError: () => false, getMissingColumnName: () => null, logDataError() {}, serializeError: x => x,
    normalizeOilChangeVehicleRegKey: x => x, fetchOilChangeLogById: async id => ({ id, vehicle_reg: reg }),
    fetchVehicleForOilChangeRegistration: async () => vehicle, recomputeOilChangeBaselineFromHistory: async () => ({ vehicle }),
    dispatchDataChange: (...args) => calls.push(['event', ...args]),
    supabase: { from(table) { const query = {maybeSingle(){return Promise.resolve({data:{id:selectedUuid,vehicle_reg:reg,service_type:"oil_change",user_id:null},error:null,status:200});}, delete(){calls.push(['delete',table]);return query;}, eq(key,id){calls.push(['eq',key,id]);return query;}, select(columns){calls.push(['select',columns]);return query;}, insert(payload){calls.push(['insert',payload]);return query;}, update(payload){calls.push(['update',payload]);return query;}, single(){return Promise.resolve(result);}, then(resolve,reject){return Promise.resolve(result).then(resolve,reject);} }; return query;} }
  };
  context.createOilServiceDeleteContext = async () => ({ client: context.supabase, projectHost: "fixture.supabase.co", userId: "staff", databaseRole: "authenticated", accountRole: "office_staff" });
  context.deleteVerifiedOilServiceRecord = deleteVerifiedOilServiceRecord;
  vm.createContext(context);
  for (const [start,end] of [['async function insertVehicleServiceLogWithSchemaFallback','async function updateOilChangeHistoryWithSchemaFallback'],['export async function deleteOilChangeService','export async function fetchFuelEfficiency']]) {
    const body = source.slice(source.indexOf(start), source.indexOf(end,source.indexOf(start))).replaceAll('export async function','async function');
    vm.runInContext(ts.transpileModule(body, {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText, context);
  }
  return { context, calls, result: x => {result=x;} };
}
test('real deletion helper targets selected UUID and verifies returning id, refreshing once', async () => {
  const h = dataHarness(); await h.context.deleteOilChangeService({serviceLogId:selectedUuid,vehicleReg:reg});
  assert.deepEqual(h.calls.filter(x=>x[0]==='eq'), [['eq','id',selectedUuid],['eq','id',selectedUuid]]);
  assert.deepEqual(h.calls.filter(x=>x[0]==='select'), [['select','*'],['select','id']]); assert.equal(h.calls.filter(x=>x[0]==='event').length,1);
});
test('real deletion helper surfaces database errors and RLS no-op without success refresh', async () => {
  for (const result of [{data:null,error:{message:'permission denied'}},{data:[],error:null}]) {
    const h = dataHarness();h.result(result); await assert.rejects(h.context.deleteOilChangeService({serviceLogId:selectedUuid,vehicleReg:reg}), /permission denied|zero eligible/);
    assert.equal(h.calls.filter(x=>x[0]==='event').length,0);
  }
});
test('new insert IDs are unique and editing only updates the selected record', async () => {
  const h = dataHarness(); await h.context.insertVehicleServiceLogWithSchemaFallback({service_date:'2026-09-05'}); await h.context.insertVehicleServiceLogWithSchemaFallback({service_date:'2026-09-07'});
  const inserts=h.calls.filter(x=>x[0]==='insert');assert.notEqual(inserts[0][1].id,inserts[1][1].id);
  await h.context.updateVehicleServiceLogWithSchemaFallback('selected',{odometer:354784});
  assert.deepEqual(h.calls.filter(x=>x[0]==='eq'),[['eq','id','selected']]);assert.equal(h.calls.filter(x=>x[0]==='update').length,1);
});

test('recorded date uses the fleet Bangkok timezone and impossible dates are rejected', () => {
  assert.equal(recordedServiceDate('2026-10-11T18:30:00Z'), '2026-10-12');
  assert.equal(latestValidService([service('invalid', '2026-02-31')]), null);
});

test('a pending JSON response body remains bounded after HTTP headers arrive', async () => {
  const response = new Response(new ReadableStream({start() {}}), {status:200});
  await assert.rejects(withRequestDeadline(() => completeJsonResponse(response), null, 10), /timed out/);
});

test('registration spacing and hyphens use the same normalized service dataset', () => {
  const log = service('correct', '2026-09-05'); log.vehicle_reg = ' 3ฒน9565 ';
  const row = snapshot([log], [reading('2026-10-11',360000)]);
  assert.equal(row.lastOilChangeOdometer,354784);
});
