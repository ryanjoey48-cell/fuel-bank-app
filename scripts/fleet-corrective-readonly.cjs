#!/usr/bin/env node
// Fixed corrective audit, no DB writes/SQL, no provider commands and no secret output.
const fs=require('node:fs'),path=require('node:path');
const {load,envFile}=require('./fleet-real-day-validation.cjs');
async function main(){
 const root=path.resolve(__dirname,'..'),env=envFile();
 const folder=path.join(root,'output/fleet-real-validation','corrective-'+Date.now());fs.mkdirSync(folder,{recursive:true});
 const evidence={capturedAt:new Date().toISOString(),day:'2026-11-03',timeZone:'Asia/Bangkok',requests:[],databaseWrites:0,providerWrites:0};
 const {createClient}=require('@supabase/supabase-js');
 const client=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(url,init)=>{
  if(init?.method&&!['GET','HEAD'].includes(init.method))throw new Error('read_only_guard');return fetch(url,{...init,signal:AbortSignal.timeout(12000)});
 }}});
 const safe=['id','date','week_ending','vehicle_id','vehicle_reg','odometer','mileage','odometer_reading','created_at','updated_at','is_odometer_baseline','odometer_note','litres','total_cost','fuel_type','receipt_checked','full_tank_confirmed'];
 for(const table of ['fuel_logs','weekly_mileage']){
  const date=table==='fuel_logs'?'date':'week_ending';
  const result=await client.from(table).select('*').eq('vehicle_reg','ฒอ-8453').gte(date,'2026-10-01').lte(date,'2026-11-04').order(date).limit(101);
  evidence[table]={code:result.error?.code??null,columns:result.data?.[0]?Object.keys(result.data[0]):[],truncated:(result.data?.length??0)>100,
   rows:(result.data??[]).map(r=>Object.fromEntries(safe.filter(k=>Object.hasOwn(r,k)).map(k=>[k,r[k]])))};
 }
 let allowedDevice=null;
 const fetcher=async(url,init)=>{
  const u=new URL(url),allowed=['/authorizationserver/token','/trackingresource/api/tracking'].includes(u.pathname)||allowedDevice&&u.pathname===`/trackingresource/api/log/${allowedDevice}/20261103060000/20261103061500`&&init?.method==='GET';
  if(u.hostname!=='webapi.forthtrack.com'||!allowed)throw new Error('fixed_endpoint_guard');
  const res=await fetch(url,init);evidence.requests.push({path:u.pathname,status:res.status});return res;
 };
 const service=load('lib/forth-tracking-server.ts').createForthTrackingService({environment:env,fetcher});
 const fleet=await service.getFleetData();
 evidence.fleet={status:fleet.connectionStatus,sourceCounts:{},count:fleet.records.length};
 for(const r of fleet.records)evidence.fleet.sourceCounts[r.positionQuality]=(evidence.fleet.sourceCounts[r.positionQuality]??0)+1;
 const comparator=fleet.records.find(r=>r.gpsDeviceId!=='519698'&&r.positionQuality==='gps'&&r.gpsConnectivity==='connected'&&fleet.records.filter(v=>v.gpsDeviceId===r.gpsDeviceId).length===1);
 if(comparator){
  allowedDevice=comparator.gpsDeviceId;
  const result=await service.getLogReport({deviceId:allowedDevice,startTime:'20261103060000',endTime:'20261103061500'});
  evidence.comparator={deviceId:allowedDevice,registration:comparator.vehicleRegistration,currentSource:comparator.positionSource,ok:result.ok,error:result.ok?null:result.error.code};
  if(result.ok&&Array.isArray(result.payload)){
   const fields=['gpsID','plateNumber','dateTime','Latitude','Longitude','GPS','positionSource','Distance','Speed','Engine'];
   evidence.comparator.returnedKeys=result.payload[0]?Object.keys(result.payload[0]):[];
   evidence.comparator.rows=result.payload.map(r=>Object.fromEntries(fields.filter(k=>Object.hasOwn(r,k)).map(k=>[k,r[k]])));
  }
 }else evidence.comparator={reason:'no_unique_current_verified_comparator'};
 fs.writeFileSync(path.join(folder,'evidence.json'),JSON.stringify(evidence,null,2),{flag:'wx'});
 console.log(JSON.stringify({folder:path.relative(root,folder),fuelRows:evidence.fuel_logs.rows.length,weeklyRows:evidence.weekly_mileage.rows.length,fuelColumns:evidence.fuel_logs.columns,weeklyColumns:evidence.weekly_mileage.columns,fleet:evidence.fleet,comparator:evidence.comparator?{...evidence.comparator,rows:evidence.comparator.rows?.length}:null}));
}
main().catch(()=>{console.error('Corrective read-only audit stopped; no private errors emitted.');process.exitCode=1;});
