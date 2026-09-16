const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const test = require('node:test');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function loader(mocks = {}) {
  const cache = new Map();
  function load(filename) {
    filename = path.resolve(filename);
    if (cache.has(filename)) return cache.get(filename).exports;
    const mod = new Module(filename, module);
    cache.set(filename, mod);
    mod.paths = Module._nodeModulePaths(path.dirname(filename));
    mod.require = request => {
      if (request in mocks) return mocks[request];
      if (request.startsWith('.') || request.startsWith('@/')) {
        const base = request.startsWith('@/') ? path.resolve(request.slice(2)) : path.resolve(path.dirname(filename), request);
        const target = [base, base + '.ts', base + '.tsx'].find(p => fs.existsSync(p) && fs.statSync(p).isFile());
        if (target) return load(target);
      }
      return require(request);
    };
    mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }
    }).outputText, filename);
    return mod.exports;
  }
  return load;
}
const load = loader();
const translations = load('lib/translations.ts').translations;
const logic = load('lib/maintenance.ts');
const empty = { vehicles: [], drivers: [], mileage: [], fuel: [], records: [], items: [], requirements: [], applicability: [], attachments: [] };
const fleet = { ...empty, vehicles: [{ id: 'v1', vehicle_reg: 'TEST', active: true, vehicle_type: 'truck' }] };

test('both languages register Maintenance and all thirteen categories', () => {
  const { MAINTENANCE_CATEGORIES } = load('lib/maintenance-types.ts');
  assert.deepEqual(MAINTENANCE_CATEGORIES, ['grease','oil','brakes','tyres','battery','engine','transmission','suspension','steering','electrical','inspection','labour','other']);
  for (const language of ['en', 'th']) assert.ok(translations[language].maintenance.title);
});

test('empty Maintenance history produces no false reminders or invalid analytics', () => {
  assert.deepEqual(logic.buildMaintenanceReminders(fleet), []);
  const result = logic.maintenanceAnalytics(fleet, 'v1', '2026-01-01', '2026-09-14');
  assert.equal(result.total, 0);
  assert.equal(result.visits, 0);
  assert.equal(result.distance, null);
  assert.equal(result.combinedPerKm, null);
  assert.equal(logic.maintenanceTotal([logic.newMaintenanceItem('i')]), 0);
});

test('pages and Add Maintenance render with real bilingual translations and empty history', () => {
  for (const language of ['en', 'th']) {
    const renderLoad = loader({
      '@/lib/language-provider': { useLanguage: () => ({ language, t: translations[language] }) },
      '@/lib/use-account-access': { useAccountAccess: () => ({ can: () => true }) },
      '@/lib/supabase': { supabase: {} },
      '@/components/header': { Header: ({title}) => React.createElement('h1', null, title) },
      '@/lib/export': {},
      'next/link': ({children, ...props}) => React.createElement('a', props, children)
    });
    for (const file of ['app/(dashboard)/maintenance/page.tsx', 'app/(dashboard)/maintenance/analytics/page.tsx']) {
      assert.ok(renderToStaticMarkup(React.createElement(renderLoad(file).default)).includes(translations[language].maintenance.title));
    }
    const html = renderToStaticMarkup(React.createElement(renderLoad('components/maintenance-record-form.tsx').MaintenanceRecordForm, {
      data: fleet, record: null, vehicleId: 'v1', onClose() {}, onSaved() {}
    }));
    assert.ok(html.includes('TEST'));
    assert.ok(html.includes('value="transmission"'));
    assert.ok(html.includes(translations[language].maintenance.save));
  }
});

test('loader keeps zero-row results and reports the exact failed endpoint', async () => {
  let failed = null;
  const queried = [];
  const api = loader({ '@/lib/supabase': { supabase: { from(table) {
    queried.push(table);
    const query = { select() {return this}, order() {return this}, range() {return this}, abortSignal() {
      return Promise.resolve(table === failed ? { data: null, status: 404, error: { code: 'PGRST205', message: 'missing table' } } : { data: [], error: null, status: 200 });
    }};
    return query;
  } } } })('lib/maintenance-data.ts');
  assert.deepEqual(await api.fetchMaintenanceData(true), empty);
  assert.ok(queried.includes('weekly_mileage'));
  assert.ok(!queried.includes('grease_maintenance_records'));
  failed = 'maintenance_items';
  await assert.rejects(api.fetchMaintenanceData(), error => error.table === failed && error.code === 'PGRST205' && error.status === 404);
});

test('loaded empty pages and failed-query pages render without losing their retry action', () => {
  for (const [file, errorIndex] of [['app/(dashboard)/maintenance/page.tsx', 2], ['app/(dashboard)/maintenance/analytics/page.tsx', 1]]) {
    for (const failed of [false, true]) {
      let index = 0;
      const renderLoad = loader({
        react: { ...React, useState(initial) {
          const current = index++;
          return React.useState(current === 0 ? (failed ? null : fleet) : current === errorIndex ? (failed ? 'maintenance_items (404, PGRST205)' : null) : initial);
        } },
        '@/lib/language-provider': { useLanguage: () => ({ language: 'en', t: translations.en }) },
        '@/lib/use-account-access': { useAccountAccess: () => ({ can: () => true }) },
        '@/lib/supabase': { supabase: {} },
        '@/components/header': { Header: ({title}) => React.createElement('h1', null, title) },
        '@/lib/export': {},
        'next/link': ({children, ...props}) => React.createElement('a', props, children)
      });
      const html = renderToStaticMarkup(React.createElement(renderLoad(file).default));
      assert.ok(html.includes(translations.en.maintenance.refresh));
      assert.ok(html.includes(failed ? 'maintenance_items (404, PGRST205)' : 'TEST'));
      if (failed) assert.ok(html.includes('role="alert"'));
    }
  }
});

test('receipts accept supported signatures and reject empty, oversized or disguised files', async () => {
  const { validateMaintenanceFile } = loader({ '@/lib/supabase': { supabase: {} } })('lib/maintenance-data.ts');
  assert.equal(await validateMaintenanceFile(new File(['%PDF-1.7'], 'receipt.pdf', {type:'application/pdf'})), 'application/pdf');
  assert.equal(await validateMaintenanceFile(new File([new Uint8Array([255,216,255])], 'photo.jpg', {type:'image/jpeg'})), 'image/jpeg');
  assert.equal(await validateMaintenanceFile(new File([new Uint8Array([137,80,78,71,13,10,26,10])], 'scan.png', {type:'image/png'})), 'image/png');
  await assert.rejects(validateMaintenanceFile(new File([], 'empty.pdf')), /FILE_SIZE/);
  await assert.rejects(validateMaintenanceFile(new File(['plain text'], 'bad.jpg')), /FILE_TYPE/);
  await assert.rejects(validateMaintenanceFile(new File(['%PDF-1.7'], 'bad.png', {type:'image/png'})), /FILE_TYPE/);
  await assert.rejects(validateMaintenanceFile(new File([new Uint8Array(10485761)], 'big.pdf')), /FILE_SIZE/);
});

test('history sorting and summary use existing record totals without mutating source data', () => {
  const ux = load('lib/maintenance-ux.ts');
  const records = [
    {id:'a',vehicle_id:'v1',service_date:'2026-09-01',created_at:'2026-09-01',calculated_total:100.15},
    {id:'b',vehicle_id:'v2',service_date:'2026-09-10',created_at:'2026-09-10',calculated_total:250.25},
    {id:'c',vehicle_id:'v1',service_date:'2026-09-05',created_at:'2026-09-05',calculated_total:50.10}
  ];
  const data = {...fleet,vehicles:[{id:'v1',vehicle_reg:'79-2945'},{id:'v2',vehicle_reg:'61-2835'}]};
  assert.deepEqual(ux.sortMaintenanceHistory(records,data,'newestFirst').map(r=>r.id),['b','c','a']);
  assert.deepEqual(ux.sortMaintenanceHistory(records,data,'oldestFirst').map(r=>r.id),['a','c','b']);
  assert.deepEqual(ux.sortMaintenanceHistory(records,data,'highestCost').map(r=>r.id),['b','a','c']);
  assert.deepEqual(ux.sortMaintenanceHistory(records,data,'vehicleRegistration').map(r=>r.id),['b','c','a']);
  assert.deepEqual(records.map(r=>r.id),['a','b','c']);
  assert.deepEqual(ux.maintenanceHistorySummary(records),{records:3,vehicles:2,total:400.5,average:133.5});
  assert.equal(ux.maintenanceHistorySummary([]).average,null);
});

test('maintenance visual signals use fleet history and clearly bounded mileage evidence', () => {
  const ux=load('lib/maintenance-ux.ts');
  const records=[100,200,300,900].map((calculated_total,index)=>({id:String(index),calculated_total,is_deleted:false}));
  assert.equal(ux.maintenanceHighCostThreshold(records),300);
  assert.equal(ux.maintenanceHighCostThreshold(records.slice(0,2)),null);
  const data={...fleet,mileage:[{vehicle_id:'v1',week_ending:'2026-09-01',odometer_reading:1000},{vehicle_id:'v1',week_ending:'2026-09-08',odometer_reading:1100},{vehicle_id:'v1',week_ending:'2026-08-01',odometer_reading:500}]};
  assert.deepEqual(ux.nearestMaintenanceMileage(data,'v1','2026-09-06'),{date:'2026-09-08',value:1100,distance:2});
  assert.equal(ux.nearestMaintenanceMileage(data,'v1','2026-10-01'),null);
});

test('compact history keeps full line items and actor identifiers inside hidden details', () => {
  const record={id:'r',vehicle_id:'v1',service_date:'2026-09-14',calculated_total:1234,receipt_total:1234,odometer:null,garage:'Test supplier',created_by:'private-actor-id',updated_by:'private-actor-id',created_at:'2026-09-14',updated_at:'2026-09-14'};
  const data={...fleet,records:[record],items:['brakes','steering','grease','oil','labour','brakes'].map((category,i)=>({...logic.newMaintenanceItem('i'+i,category),record_id:'r',position:i,description:'PRIVATE LINE '+i}))};
  for(const language of ['en','th']) {
    const renderLoad=loader({'@/lib/language-provider':{useLanguage:()=>({language,t:translations[language]})},'@/lib/use-account-access':{useAccountAccess:()=>({can:()=>false})},'@/lib/supabase':{supabase:{}}});
    const html=renderToStaticMarkup(React.createElement(renderLoad('components/maintenance-record-card.tsx').MaintenanceVisit,{record,data,reminders:[],onEdit(){},onChanged(){}}));
    assert.ok(html.includes('aria-expanded="false"'));
    const beforeDetails=html.slice(0,html.indexOf('hidden=""'));
    assert.ok(!beforeDetails.includes('PRIVATE LINE'));
    assert.ok(!beforeDetails.includes('private-actor-id'));
    assert.ok(html.includes('PRIVATE LINE 0'));
    assert.ok(!html.includes(translations[language].maintenance.edit+'</button>'));
    assert.ok(beforeDetails.includes('+2'));
  }
});

test('date presets and analytics explanations preserve mileage safeguards', () => {
  const ux=load('lib/maintenance-ux.ts');
  assert.deepEqual(ux.maintenanceDateRange('thisYear','2026-09-14'),{start:'2026-01-01',end:'2026-09-14'});
  assert.deepEqual(ux.maintenanceDateRange('last12Months','2024-02-29'),{start:'2023-02-28',end:'2024-02-29'});
  assert.equal(ux.maintenanceDateRange('allTime','2026-09-14').start,'1900-01-01');
  assert.deepEqual(ux.maintenanceDataIssues(fleet,'v1','2026-09-01','2026-09-14'),['missingStart','missingEnd','noFuelHistory','noMaintenanceHistory']);
  const data={...fleet,mileage:[{vehicle_id:'v1',week_ending:'2026-09-01',odometer_reading:1000,created_at:'2026-09-01'},{vehicle_id:'v1',week_ending:'2026-09-14',odometer_reading:900,created_at:'2026-09-14'}]};
  assert.ok(ux.maintenanceDataIssues(data,'v1','2026-09-01','2026-09-14').includes('odometerConflict'));
  assert.equal(logic.maintenancePeriodDistance(data,'v1','2026-09-01','2026-09-14'),null);
});
const intelligence = load('lib/maintenance-intelligence.ts');
const audit = {created_at:'2026-01-01',updated_at:'2026-01-01',created_by:'test',updated_by:'test'};
const visit = (id,date,patch={}) => ({...audit,id,vehicle_id:'v1',service_date:date,odometer:1000,garage:'Garage',receipt_total:100,calculated_total:100,is_deleted:false,...patch});
const line = (id,record,patch={}) => ({...audit,...logic.newMaintenanceItem(id),record_id:record,position:0,description:'Steering repair',category:'steering',quantity:1,unit_price:100,...patch});
test('attention distinguishes enabled scoped requirements, date overdue, mileage due, warnings and unknown mileage',()=>{
 const req={...audit,id:'q',name:'Configured',category:'steering',vehicle_type:'truck',frequency_months:1,mileage_interval:null,active:true};
 assert.deepEqual(logic.buildMaintenanceReminders(fleet,'2026-09-15'),[]);
 assert.equal(logic.buildMaintenanceReminders({...fleet,requirements:[req]},'2026-09-15')[0].status,'noHistory');
 assert.deepEqual(logic.buildMaintenanceReminders({...fleet,requirements:[{...req,active:false}]},'2026-09-15'),[]);
 assert.deepEqual(logic.buildMaintenanceReminders({...fleet,requirements:[{...req,vehicle_type:'car'}]},'2026-09-15'),[]);
 const data={...fleet,records:[visit('r','2026-09-01')],items:[line('i','r',{override_date:'2026-09-14'})]};
 assert.equal(logic.buildMaintenanceReminders(data,'2026-09-15')[0].status,'overdue');
 data.items[0].override_date='2026-09-20';
 assert.equal(logic.buildMaintenanceReminders(data,'2026-09-15')[0].status,'dueSoon');
 data.items[0].override_date=null;data.items[0].override_km=1500;
 data.mileage=[{vehicle_id:'v1',week_ending:'2026-09-15',created_at:'2026-09-15',odometer_reading:1500}];
 assert.equal(logic.buildMaintenanceReminders(data,'2026-09-15')[0].status,'mileageDue');
 data.mileage[0].odometer_reading=1600;
 assert.equal(logic.buildMaintenanceReminders(data,'2026-09-15')[0].status,'overdue');
 data.mileage=[];
 assert.equal(logic.buildMaintenanceReminders(data,'2026-09-15')[0].mileage_unavailable,true);
});
test('recurring repair counts distinct dates, excludes deleted/future/routine work and suppresses category duplicates',()=>{
 const records=['2026-01-15','2026-04-15','2026-09-01'].map((date,i)=>visit('r'+i,date));
 const items=records.map((r,i)=>line('i'+i,r.id));
 const data={...fleet,records,items};
 const initial=JSON.stringify(data);
 const repeats=intelligence.repeatedMaintenanceRepairs(data,'2026-09-15');
 assert.equal(repeats.length,1);assert.equal(repeats[0].visits,3);assert.equal(repeats[0].total,300);
 assert.equal(JSON.stringify(data),initial);
 assert.equal(intelligence.repeatedMaintenanceRepairs({...data,items:items.map(i=>({...i,category:'grease'}))},'2026-09-15').length,0);
 assert.equal(intelligence.repeatedMaintenanceRepairs({...data,records:records.map(r=>({...r,service_date:'2026-09-01'}))},'2026-09-15').length,0);
 assert.equal(intelligence.repeatedMaintenanceRepairs({...data,records:records.map((r,i)=>i===0?{...r,is_deleted:true}:r)},'2026-09-15').length,0);
 assert.equal(intelligence.repeatedMaintenanceRepairs({...data,records:records.map((r,i)=>i===0?{...r,service_date:'2026-10-01'}:r)},'2026-09-15').length,0);
 const fallback={...data,records:[...records,visit('r3','2026-08-01')],items:[...items,line('i3','r3')].map((r,i)=>({...r,description:'Different repair '+i}))};
 const category=intelligence.repeatedMaintenanceRepairs(fallback,'2026-09-15');assert.equal(category.length,1);assert.equal(category[0].categoryFallback,true);assert.equal(category[0].visits,4);
});
test('spending projections share exact totals, distinct visit counts and reliable mileage denominators',()=>{
 const data={...fleet,records:[visit('r','2026-09-01',{calculated_total:250.5,receipt_total:250.5})],items:[line('a','r',{unit_price:100.25}),line('b','r',{unit_price:150.25})],mileage:[{vehicle_id:'v1',week_ending:'2026-09-01',created_at:'2026-09-01',odometer_reading:1000},{vehicle_id:'v1',week_ending:'2026-09-08',created_at:'2026-09-08',odometer_reading:2000}]};
 const stats=intelligence.maintenanceCostIntelligence(data,['v1'],'2026-09-01','2026-09-08','2026-09-15');
 assert.equal(stats.total,250.5);assert.equal(stats.average,250.5);assert.equal(stats.items[0].visits,1);assert.equal(stats.garages[0].total,250.5);assert.equal(stats.categories[0].total,250.5);
 assert.equal(stats.vehicles[0].maintenancePerKm,.2505);assert.equal(stats.vehicles[0].maintenancePer10000Km,2505);
 assert.equal(intelligence.maintenanceCostIntelligence(data,['v1'],'2026-01-01','2026-09-08','2026-09-15').vehicles[0].maintenancePerKm,null);
 const supplierData={...data,records:[visit('r1','2026-08-01',{garage:'Yod Garage.'}),visit('r2','2026-09-01',{garage:' yod-garage '})],items:[line('i1','r1'),line('i2','r2')]};
 const supplierStats=intelligence.maintenanceCostIntelligence(supplierData,['v1'],'2026-08-01','2026-09-15','2026-09-15');
 assert.equal(supplierStats.garages.length,1);assert.equal(supplierStats.garages[0].visits,2);assert.equal(supplierStats.monthChange,0);
 assert.equal(logic.receiptDifference(250.5,250.5),0);assert.equal(logic.receiptDifference(250.5,250),.5);assert.equal(logic.receiptDifference(250.5,null),null);
 const exported=load('lib/maintenance-export.ts').maintenanceExportRows(data,data.records,'en');
 assert.equal(exported.items.length,2);assert.equal(exported.items[0][translations.en.maintenance.vehicleType],'truck');assert.equal(exported.records[0][translations.en.maintenance.calculatedTotal],stats.total);
});
test('duplicate item clears unrelated notes without changing existing historical data',()=>{
 const original=line('i','r',{notes:'Cleaning fluid used',description_th:'น้ำยาทำความสะอาด'});
 const copy=intelligence.duplicateMaintenanceItem(original,'new');
 assert.equal(copy.notes,null);assert.equal(copy.description_th,null);assert.equal(copy.unit_price,original.unit_price);assert.equal(original.notes,'Cleaning fluid used');assert.equal(original.description_th,'น้ำยาทำความสะอาด');
});
test('responsive item table preserves both languages and mismatches remain visible in expanded records',()=>{
 for(const language of ['en','th']) {
 const renderLoad=loader({'@/lib/language-provider':{useLanguage:()=>({language,t:translations[language]})},'@/lib/use-account-access':{useAccountAccess:()=>({can:()=>false})},'@/lib/supabase':{supabase:{}}});
 const record=visit('r','2026-09-01',{receipt_total:90});const data={...fleet,records:[record],items:[line('i','r',{description_th:'ลูกหมากคันชัก',notes:'Item-specific note'})]};
 const html=renderToStaticMarkup(React.createElement(renderLoad('components/maintenance-record-card.tsx').MaintenanceVisit,{record,data,detailed:true,reminders:[],onEdit(){},onChanged(){}}));
 assert.ok(html.includes('ลูกหมากคันชัก'));assert.ok(html.includes('Steering repair'));assert.ok(html.includes('md:table'));assert.ok(html.includes('border-amber-300'));assert.ok(html.includes(translations[language].maintenance.enteredTotal));
 }
});
