#!/usr/bin/env node
// Fixed, read-only pilot. No schema/business writes, arbitrary URLs or secret output.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
function load(name,cache=new Map()) {
 const file=path.resolve(root,name);if(cache.has(file))return cache.get(file).exports;
 const m=new Module(file,module);cache.set(file,m);m.filename=file;m.paths=Module._nodeModulePaths(path.dirname(file));
 m.require=r=>r==='server-only'?{}:r.startsWith('.')||r.startsWith('@/')?load((r.startsWith('@/')?r.slice(2):path.relative(root,path.resolve(path.dirname(file),r)))+'.ts',cache):require(r);
 m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);return m.exports;
}
function envFile() {
 const result={};if(!fs.existsSync(path.join(root,'.env.local')))return result;
 for(const line of fs.readFileSync(path.join(root,'.env.local'),'utf8').split(/\r?\n/)) {
  const match=/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);if(!match)continue;
  let value=match[2].trim();if((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'")))value=value.slice(1,-1);
  result[match[1]]=value;
 }return {...result,...process.env};
}
const key=s=>String(s??'').normalize('NFKC').replace(/[\s\-‐‑‒–—]/g,'').toUpperCase();
async function main() {
 const env=envFile(),target='ฒอ-8453';const evidence={capturedAt:new Date().toISOString(),target,timeZone:'Asia/Bangkok',requests:[],productionWrites:0,providerWrites:0};
 const folder=path.join(root,'output','fleet-real-validation',Date.now().toString());fs.mkdirSync(folder,{recursive:true});
 const save=()=>fs.writeFileSync(path.join(folder,'evidence.json'),JSON.stringify(evidence,null,2));
 let authorizedDevice=null,reportAuthorization=null;
 const fetcher=async(url,init)=>{
  const parsed=new URL(url);
  const logAllowed=authorizedDevice && init?.method==='GET' && new RegExp('^/trackingresource/api/log/'+authorizedDevice+'/[0-9]{14}/[0-9]{14}$').test(parsed.pathname);
  const tripsAllowed=authorizedDevice && ['/trackingresource/api/vehicle/trips','/trackingresource/api/vehicle/parkingTrip'].includes(parsed.pathname) && init?.method==='POST';
  if(parsed.hostname!=='webapi.forthtrack.com'||(!['/authorizationserver/token','/trackingresource/api/tracking'].includes(parsed.pathname)&&!logAllowed&&!tripsAllowed))throw new Error('endpoint_not_authorized_for_discovery');
  if(tripsAllowed)reportAuthorization=init.headers.Authorization;
  try {const response=await fetch(url,init);evidence.requests.push({endpoint:parsed.pathname,status:response.status});return response;}
  catch(error){evidence.requests.push({endpoint:parsed.pathname,status:null,failure:error?.name??'network_error',networkCode:error?.cause?.code??null});throw error;}
 };
 const service=load('lib/forth-tracking-server.ts').createForthTrackingService({environment:env,fetcher});
 const fleet=await service.getFleetData();
 evidence.forth={connectionStatus:fleet.connectionStatus,error: fleet.error?.code??null,recordCount:fleet.records.length};
 const matches=fleet.records.filter(r=>key(r.vehicleRegistration)===key(target));
 evidence.mapping={forthMatches:matches.length,records:matches.map(r=>({deviceId:r.gpsDeviceId,registration:r.vehicleRegistration,positionTimestamp:r.lastGpsTimestamp,sourceTimestamp:r.sourceTimestampRaw,quality:r.positionQuality,gps:r.gpsConnectivity}))};
 // Read only the configured local target, using explicit GETs and bounded rows.
 const dbUrl=env.NEXT_PUBLIC_SUPABASE_URL;const dbKey=env.SUPABASE_SERVICE_ROLE_KEY;
 evidence.ees={configured:Boolean(dbUrl&&dbKey)};
 if(dbUrl) evidence.ees.environmentClass=load('lib/ees-database-environment.ts').classifyEesSupabaseUrl(dbUrl);
 if(dbUrl&&dbKey) {
  const {createClient}=require('@supabase/supabase-js');
  const client=createClient(dbUrl,dbKey,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(url,init)=>{
   if(init?.method && init.method!=='GET')throw new Error('read_only_database_guard');return fetch(url,{...init,signal:AbortSignal.timeout(12000)});
  }}});
  const result=await client.from('vehicles').select('id,vehicle_reg,vehicle_type').limit(101);
  evidence.ees.vehicleQuery={code:result.error?.code??null,count:result.data?.length??null};
  evidence.ees.vehicles=(result.data??[]).filter(r=>key(r.vehicle_reg)===key(target));
  if(evidence.ees.vehicles.length===1) {
   const day=new Date(Date.now()+7*3600000-86400000).toISOString().slice(0,10);
   evidence.selectedDay=day;
   const columns=await client.from('booking_diary').select('*').eq('booking_date',day).limit(1);
   evidence.ees.bookingColumns={code:columns.error?.code??null,fields:columns.data?.[0]?Object.keys(columns.data[0]):[]};
   const requested=['id','booking_date','pickup_time','vehicle_id','vehicle','vehicle_registration','job_order_number','pickup','dropoff','pickup_lat','pickup_lng','dropoff_lat','dropoff_lng','route_confirmation_status','updated_at'];
   const selected=requested.filter(k=>evidence.ees.bookingColumns.fields.includes(k));
   const [jobs,fuel]=await Promise.all([
    selected.length?client.from('booking_diary').select(selected.join(',')).eq('booking_date',day).limit(501):Promise.resolve({data:[],error:{code:'no_day_row_for_schema_discovery'}}),
    client.from('fuel_logs').select('id,date,vehicle_reg,litres,total_cost,fuel_type,odometer,created_at').eq('date',day).limit(501)
   ]);
   const vid=evidence.ees.vehicles[0].id;
   evidence.ees.jobs={code:jobs.error?.code??null,truncated:(jobs.data?.length??0)>500,rows:(jobs.data??[]).filter(r=>r.vehicle_id?r.vehicle_id===vid:key(r.vehicle_registration??r.vehicle)===key(target))};
   evidence.ees.fuel={code:fuel.error?.code??null,truncated:(fuel.data?.length??0)>500,rows:(fuel.data??[]).filter(r=>key(r.vehicle_reg)===key(target))};
  }
 }
 evidence.history={attempted:false,reason:matches.length===1?'discovery_complete_history_scope_pending':'unique_current_forth_mapping_not_established'};
 if(process.argv.includes('--ees-check')&&dbUrl&&dbKey) {
  const {createClient}=require('@supabase/supabase-js');
  const client=createClient(dbUrl,dbKey,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(url,init)=>{
   if(init?.method&&!['GET','HEAD'].includes(init.method))throw new Error('read_only_database_guard');return fetch(url,{...init,signal:AbortSignal.timeout(12000)});
  }}});
  const day=evidence.selectedDay??'2026-11-03';
  const [latest,count,fuelDetails]=await Promise.all([
   client.from('booking_diary').select('*').order('booking_date',{ascending:false}).limit(1),
   client.from('booking_diary').select('id',{count:'exact',head:true}).eq('booking_date',day),
   client.from('fuel_logs').select('*').eq('date',day).eq('vehicle_reg',target).limit(10)
  ]);
  evidence.ees.bookingInspection={latestQueryCode:latest.error?.code??null,latestBookingDate:latest.data?.[0]?.booking_date??null,actualColumns:latest.data?.[0]?Object.keys(latest.data[0]):[],selectedDayCount:count.count,countQueryCode:count.error?.code??null};
  evidence.ees.fuelQuality={code:fuelDetails.error?.code??null,rows:(fuelDetails.data??[]).map(r=>({id:r.id,storedFuelType:r.fuel_type,notesMentionLpg:/lpg|แอลพีจี|แก๊ส/i.test(String(r.notes??'')),receiptChecked:r.receipt_checked??null,fullTankConfirmed:r.full_tank_confirmed??null,availableColumns:Object.keys(r)}))};
 }
 if(process.argv.includes('--history')&&matches.length===1) {
  authorizedDevice=matches[0].gpsDeviceId;
  const day=evidence.selectedDay??new Date(Date.now()+7*3600000-86400000).toISOString().slice(0,10),stamp=day.replaceAll('-','');
  const fullDay=process.argv.includes('--full-day');
  const result=await service.getLogReport({deviceId:authorizedDevice,startTime:stamp+'000000',endTime:stamp+(fullDay?'235959':'001500')});
  evidence.selectedDay=day;
  evidence.history={attempted:true,windowBangkok:['00:00:00',fullDay?'23:59:59':'00:15:00'],ok:result.ok,error:result.ok?null:result.error.code,rows:result.ok&&Array.isArray(result.payload)?result.payload.length:null};
  if(result.ok&&Array.isArray(result.payload)) {
   const allowed=['gpsID','plateNumber','dateTime','GPS','GPRS','Engine','Speed','Distance','Latitude','Longitude','positionSource','Fuel','Sensor1','Sensor2','Sensor3'];
   const rows=result.payload.map(row=>Object.fromEntries(allowed.filter(k=>Object.hasOwn(row,k)).map(k=>[k,row[k]])));
   const vehicleId=evidence.ees.vehicles?.[0]?.id??'mapping_not_confirmed';
   fs.writeFileSync(path.join(folder,'actual-input.json'),JSON.stringify({vehicleId,deviceId:authorizedDevice,day,forthLog:rows},null,2));
  }
  const trips=await service.getTripsReport({deviceId:authorizedDevice,forthDate:stamp,language:'en'});
  evidence.forthTrips={ok:trips.ok,error:trips.ok?null:trips.error.code,rows:trips.ok&&Array.isArray(trips.payload)?trips.payload.length:null};
  if(trips.ok&&Array.isArray(trips.payload)) {
   const allowed=['boxId','plateNo','rDate','arriveTime','source','departTime','arriveDestinationTime','destination','departDestinationTime','routingTime'];
   fs.writeFileSync(path.join(folder,'actual-trips.json'),JSON.stringify(trips.payload.map(r=>Object.fromEntries(allowed.filter(k=>Object.hasOwn(r,k)).map(k=>[k,r[k]]))),null,2));
  }
  if(fullDay&&reportAuthorization) {
   const response=await fetcher('https://webapi.forthtrack.com/trackingresource/api/vehicle/parkingTrip',{method:'POST',headers:{Authorization:reportAuthorization,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({boxIds:authorizedDevice,startDate:stamp,endDate:stamp,language:'en'}),redirect:'error',signal:AbortSignal.timeout(10000)});
   const reader=response.body.getReader();let size=0,text='';const decoder=new TextDecoder();
   while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.length;if(size>1000000){await reader.cancel();throw new Error('report_size_limit');}text+=decoder.decode(chunk.value,{stream:true});}text+=decoder.decode();
   let data=null;try{data=JSON.parse(text);}catch{}
   evidence.forthParking={status:response.status,isArray:Array.isArray(data),rows:Array.isArray(data)?data.length:null};
   if(Array.isArray(data)) {
    const allowed=['boxId','plateNo','rDate','startTime','endTime','routingTime','parkingEngineOn','parkingTime','sumDistance','maxSpeed'];
    fs.writeFileSync(path.join(folder,'actual-parking.json'),JSON.stringify(data.map(r=>Object.fromEntries(allowed.filter(k=>Object.hasOwn(r,k)).map(k=>[k,r[k]]))),null,2));
   }
  }
 }
 save();console.log(JSON.stringify({folder:path.relative(root,folder),...evidence},null,2));
}
module.exports={load,envFile};
if(require.main===module)main().catch(()=>{console.error('Read-only validation stopped; no secrets or raw error details emitted.');process.exitCode=1;});
