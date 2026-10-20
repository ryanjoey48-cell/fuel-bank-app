const fs=require('fs'),path=require('path'),Module=require('module'),ts=require('typescript'),test=require('node:test'),assert=require('node:assert/strict');
function loader(mocks={}){const cache=new Map();function load(file){file=path.resolve(file);if(cache.has(file))return cache.get(file).exports;const m=new Module(file,module);cache.set(file,m);m.paths=Module._nodeModulePaths(path.dirname(file));m.require=q=>{if(q in mocks)return mocks[q];if(q.startsWith('.')||q.startsWith('@/')){const b=q.startsWith('@/')?path.resolve(q.slice(2)):path.resolve(path.dirname(file),q);const f=[b,b+'.ts',b+'.tsx'].find(x=>fs.existsSync(x)&&fs.statSync(x).isFile());if(f)return load(f);}return require(q);};m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,file);return m.exports;}return load;}
const load=loader(),{evaluateSchedule,buildServiceSchedule}=load('lib/preventative-maintenance.ts'),{buildOilServiceSnapshot}=load('lib/oil-service-snapshot.ts');
const {buildFleetComponentRows,maintenanceComponentCatalogue}=load('lib/maintenance-components.ts');
const today='2026-10-14',schedule={id:'s',name:'Coolant',service_key:'coolant',schedule_kind:'replacement',applicability_status:'applicable',frequency_months:6,mileage_interval:10000,warning_days:30,warning_km:1000,active:true},baseline={date:'2026-04-14',odometer:10000,recordId:'r',itemId:'i'};
const data=()=>({vehicles:[{id:'v',vehicle_reg:'TEST',active:true}],drivers:[],mileage:[{vehicle_id:'v',week_ending:today,odometer_reading:15000,created_at:today}],fuel:[],records:[{id:'r',vehicle_id:'v',service_date:'2026-04-14',odometer:10000,created_at:today,is_deleted:false}],items:[{id:'i',record_id:'r',position:0,service_key:'coolant',service_action:'fluid_replacement',service_confirmed:true}],requirements:[schedule],applicability:[{vehicle_id:'v',requirement_id:'s'}],attachments:[]});
test('combined servicing reaches either threshold; exact date or km is overdue',()=>{assert.equal(evaluateSchedule(schedule,baseline,15000,today).status,'overdue');assert.equal(evaluateSchedule({...schedule,frequency_months:12},baseline,20000,today).status,'overdue');assert.equal(evaluateSchedule({...schedule,frequency_months:12},baseline,19500,today).status,'dueSoon');assert.equal(evaluateSchedule({...schedule,frequency_months:12},baseline,15000,today).status,'ok');});
test('unknown mileage never hides a date overdue; time-only and mileage-only remain independent',()=>{assert.equal(evaluateSchedule(schedule,baseline,null,today).status,'overdue');assert.equal(evaluateSchedule({...schedule,frequency_months:12},baseline,null,today).status,'unknown');assert.equal(evaluateSchedule({...schedule,mileage_interval:null,frequency_months:12},baseline,null,today).status,'ok');assert.equal(evaluateSchedule({...schedule,frequency_months:null},baseline,19500,today).status,'dueSoon');});
test('empty interval, NA and explicit condition statuses do not fabricate dates',()=>{for(const [extra,status]of [[{},'notConfigured'],[{replacement_strategy:'condition'},'condition'],[{applicability_status:'not_applicable'},'notApplicable']]){const r=evaluateSchedule({...schedule,mileage_interval:null,frequency_months:null,...extra},baseline,15000,today);assert.equal(r.status,status);assert.equal(r.dueDate,null);}assert.equal(evaluateSchedule(schedule,null,15000,today).status,'notConfigured');});
test('replacement baseline ignores top-ups, repairs, unconfirmed, future and voided events',()=>{for(const change of [{service_action:'fluid_top_up'},{service_action:'repair'},{service_action:'inspection'},{service_confirmed:false}]){const d=data();Object.assign(d.items[0],change);assert.equal(buildServiceSchedule(d,'v',null,today)[0].baseline,null);}for(const change of [{service_date:'2027-01-01'},{is_deleted:true},{odometer:999999}]){const d=data();Object.assign(d.records[0],change);assert.equal(buildServiceSchedule(d,'v',null,today)[0].baseline,null);}});
test('inspection independently advances only inspection schedule and stores condition',()=>{const d=data();d.items.push({...d.items[0],id:'inspect',service_action:'inspection',condition:'Needs review'});d.requirements.push({...schedule,id:'inspection',schedule_kind:'inspection'});d.applicability.push({vehicle_id:'v',requirement_id:'inspection'});const rows=buildServiceSchedule(d,'v',null,today);assert.equal(rows[0].baseline.itemId,'i');assert.equal(rows[1].baseline.itemId,'inspect');assert.equal(rows[1].condition,'Needs review');});
test('editing or voiding newest record recalculates from remaining event without mutating data',()=>{const d=data();d.records.push({...d.records[0],id:'new',service_date:'2026-09-01',odometer:14000});d.items.push({...d.items[0],id:'newitem',record_id:'new'});assert.equal(buildServiceSchedule(d,'v',null,today)[0].baseline.recordId,'new');d.records[1].is_deleted=true;assert.equal(buildServiceSchedule(d,'v',null,today)[0].baseline.recordId,'r');});
test('oil future records are ignored and impossible saved service requires review; current override shared',()=>{const vehicle={id:'v',vehicle_reg:'TEST',vehicle_type:'FOUR_WHEEL_TRUCK',active:true,last_oil_change_date:'2026-04-14',last_oil_change_odometer:10000,oil_change_interval_km:10000};const input={vehicles:[vehicle],drivers:[],baselines:[],mileage:[{vehicle_id:'v',vehicle_reg:'TEST',week_ending:today,odometer_reading:25000,created_at:today}],logs:[]};const before=JSON.stringify(input);for(const log of [{id:'future',vehicle_id:'v',vehicle_reg:'TEST',service_date:'2027-01-01',odometer:24000},{id:'bad',vehicle_id:'v',vehicle_reg:'TEST',service_date:'2026-10-01',odometer:999999}]){const r=buildOilServiceSnapshot({...input,logs:[log]})[0];assert.equal(r.lastOilChangeOdometer,10000);assert.equal(r.status,log.id==='bad'?'review_required':'overdue');}assert.equal(JSON.stringify(input),before);const r=buildOilServiceSnapshot({...input,vehicles:[{...vehicle,maintenance_oil_schedule:{...schedule,service_key:'engine_oil',frequency_months:null,mileage_interval:20000}}]})[0];assert.equal(r.nextOilChangeDueOdometer,30000);assert.equal(r.status,'ok');});
test('oil adapter exposes one confirmed event per visit, omits top-ups/voids and uses stable vehicle ID',async()=>{const records={id:'visit',vehicle_id:'v',service_date:today,odometer:10000,is_deleted:false,created_at:today,updated_at:today,vehicles:{vehicle_reg:'TEST'}};const list=[{id:'a',record_id:'visit',service_action:'fluid_replacement',service_confirmed:true,maintenance_records:records},{id:'b',record_id:'visit',service_action:'fluid_replacement',service_confirmed:true,maintenance_records:records},{id:'c',record_id:'topup',service_action:'fluid_top_up',service_confirmed:true,maintenance_records:records},{id:'d',record_id:'void',service_action:'fluid_replacement',service_confirmed:true,maintenance_records:{...records,is_deleted:true}}];const q={select(){return this},order(){return this},range(){return this},eq(){return this},abortSignal(){return Promise.resolve({data:list,error:null})}};const l=loader({'./supabase':{supabase:{from(){return q}}}});const result=await l('lib/maintenance-oil-data.ts').maintenanceOilEvents();assert.equal(result.length,1);assert.equal(result[0].vehicle_id,'v');assert.equal(result[0].maintenance_record_id,'visit');});

test('shared oil status supports time-only missing odometer and Not Applicable without fake missing configuration',()=>{const vehicle={id:'v',vehicle_reg:'TEST',vehicle_type:'FOUR_WHEEL_TRUCK',active:true,maintenance_oil_schedule:{...schedule,service_key:'engine_oil',frequency_months:12,mileage_interval:null}};const args={vehicles:[vehicle],drivers:[],baselines:[],mileage:[],logs:[{id:'maintenance-visit',maintenance_record_id:'visit',vehicle_id:'v',vehicle_reg:'TEST',service_date:'2026-09-01',odometer:null,created_at:today}]};const r=buildOilServiceSnapshot(args)[0];assert.equal(r.lastOilChangeDate,'2026-09-01');assert.equal(r.status,'ok');assert.equal(r.nextOilChangeDueOdometer,null);const na=buildOilServiceSnapshot({...args,vehicles:[{...vehicle,maintenance_oil_schedule:{...vehicle.maintenance_oil_schedule,applicability_status:'not_applicable'}}]})[0];assert.equal(na.status,'not_applicable');});

test('vehicle interval editor preserves an explicitly month-only oil schedule',()=>{
 const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
 const labels=load('lib/translations.ts').translations.en;
 const d=data();d.vehicles[0].vehicle_type='FOUR_WHEEL_TRUCK';d.requirements=[{...schedule,service_key:'engine_oil',mileage_interval:null,frequency_months:12,updated_at:'2026-10-15T01:00:00Z'}];
 const render=loader({'@/lib/language-provider':{useLanguage:()=>({language:'en',t:labels})},'@/lib/use-account-access':{useAccountAccess:()=>({can:()=>true})},'@/lib/supabase':{supabase:{}}});
 const html=renderToStaticMarkup(React.createElement(render('components/maintenance-schedule-settings.tsx').MaintenanceScheduleSettings,{data:d,vehicleId:'v',onSaved(){}}));
 const name=labels.maintenance.mileageInterval.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 assert.match(html,new RegExp('aria-label="'+name+'"[^>]*value=""'));
 assert.ok(html.includes('12 months'));
});


test('maintenance vehicle labels use saved model data without inventing missing models',()=>{
 const {maintenanceVehicleModel}=load('lib/maintenance-vehicle-label.ts');
 assert.equal(maintenanceVehicleModel({vehicle_name:'ISUZU Forward'}),'ISUZU Forward');
 assert.equal(maintenanceVehicleModel({vehicle_name:'Fleet truck',model:'HINO Ranger'}),'HINO Ranger');
 assert.equal(maintenanceVehicleModel({vehicle_name:'',vehicle_type:'SIX_WHEEL_TRUCK'}),'');
 assert.equal(maintenanceVehicleModel(null),'');
});

test('fleet component view includes every active vehicle and keeps unknown replacement history unknown',()=>{
 const d=data();
 d.vehicles.push({...d.vehicles[0],id:'v2',vehicle_reg:'NO-HISTORY'});
 d.items[0].service_action='inspection';
 d.items[0].service_confirmed=true;
 d.items[0].notes='Battery was mentioned but replacement was not confirmed';
 const checks=[{id:'check',request_id:'request',vehicle_id:'v',service_key:'battery',item_name:'Battery',check_date:today,odometer:15000,result:'ok',notes:null,maintenance_record_id:'r',checked_by:'user',checked_by_name:'User',created_at:today}];
 const rows=buildFleetComponentRows(d,checks,[],'battery',today);
 assert.equal(rows.length,2);
 assert.equal(rows.find(row=>row.vehicleId==='v').latestInspection.id,'check');
 assert.equal(rows.find(row=>row.vehicleId==='v').lastReplacement,null);
 assert.equal(rows.find(row=>row.vehicleId==='v2').inspectionResult,'not_checked');
 assert.equal(rows.find(row=>row.vehicleId==='v2').lastReplacement,null);
});

test('fleet component replacement history only accepts explicit confirmed structured replacement actions',()=>{
 const d=data();
 d.items[0].service_key='battery';
 d.items[0].service_action='component_replacement';
 d.items[0].service_confirmed=true;
 let row=buildFleetComponentRows(d,[],[],'battery',today)[0];
 assert.equal(row.lastReplacement.recordId,'r');
 assert.equal(row.lastReplacement.odometer,10000);
 d.items[0].service_confirmed=false;
 row=buildFleetComponentRows(d,[],[],'battery',today)[0];
 assert.equal(row.lastReplacement,null);
});

test('fleet component catalogue reuses service keys and preserves custom inspection items',()=>{
 const d=data();
 const checks=[{id:'check',request_id:'request',vehicle_id:'v',service_key:'custom:hydraulic-pump',item_name:'Hydraulic pump',check_date:today,odometer:null,result:'attention',notes:null,maintenance_record_id:null,checked_by:'user',checked_by_name:'User',created_at:today}];
 const catalogue=maintenanceComponentCatalogue(d,checks);
 assert.equal(catalogue.filter(item=>item.key==='battery').length,1);
 assert.equal(catalogue.find(item=>item.key==='custom:hydraulic-pump').category,'custom');
});

test('unified maintenance navigation and fleet component view stay bilingual and responsive',()=>{
 const centre=fs.readFileSync('components/maintenance-centre.tsx','utf8');
 const components=fs.readFileSync('components/maintenance-component-overview.tsx','utf8');
 for(const label of ['Overview','Fleet Vehicles','Maintenance Records','Components & Inspections','Service Intervals'])assert.match(centre,new RegExp(label.replace(/[&]/g,'\\&')));
 for(const label of ['ภาพรวม','รถในฝูง','บันทึกการซ่อม','ชิ้นส่วนและการตรวจ','รอบการบริการ'])assert.ok(centre.includes(label));
 assert.match(components,/hidden overflow-x-auto[^\n]+md:block/);
 assert.match(components,/grid gap-2 md:hidden/);
 assert.match(components,/History unknown/);
 assert.match(components,/Not yet inspected/);
 assert.match(components,/Interval not set/);
});
