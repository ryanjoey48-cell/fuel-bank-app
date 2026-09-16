// Isolated UI fixture. Real Maintenance components, in-memory data, no Supabase connection.
// Run: node scripts/maintenance-ui-fixture.cjs; open http://localhost:3004/maintenance
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const root = process.cwd();
const dir = path.join(root, 'tmp/maintenance-polish-qa');
const useRealSnapshot = process.argv.includes('--real-snapshot');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'loader.cjs'), `module.exports=function(source){return require(${JSON.stringify(require.resolve('typescript'))}).transpileModule(source,{compilerOptions:{target:7,module:99,jsx:4,esModuleInterop:true}}).outputText}`);
fs.writeFileSync(path.join(dir, 'entry.tsx'), `
import React from 'react'; import {createRoot} from 'react-dom/client';
import Maintenance from '../../app/(dashboard)/maintenance/page';
import Analytics from '../../app/(dashboard)/maintenance/analytics/page';
import {FixtureProvider} from './mocks';
createRoot(document.getElementById('root')!).render(<FixtureProvider>{location.pathname.includes('analytics')?<Analytics/>:<Maintenance/>}</FixtureProvider>);
`);
fs.writeFileSync(path.join(dir, 'mocks.tsx'), `
import React,{createContext,useContext,useState} from 'react';
import {translations} from '../../lib/translations';
import {maintenanceToday,maintenanceTotal} from '../../lib/maintenance';
import {validateMaintenanceFile as validate} from '../../lib/maintenance-data';
const Context=createContext<any>(null);
export function FixtureProvider({children}:any){const [language,setLanguage]=useState<'en'|'th'>('en');return <Context.Provider value={{language,t:translations[language]}}><div className="mb-5 rounded-xl bg-amber-100 p-3 text-sm">Local UI fixture · all writes stay in memory · no production connection <button className="btn-secondary ml-3" onClick={()=>setLanguage(language==='en'?'th':'en')}>English / ไทย</button></div>{children}</Context.Provider>}
export const useLanguage=()=>useContext(Context);
export const useAccountAccess=()=>({can:()=>true});
export const Header=({title,description}:any)=><header className="mb-5"><h1 className="text-2xl font-bold">{title}</h1><p className="text-sm text-slate-500">{description}</p></header>;
export const supabase={};
export default function Link({children,...props}:any){return <a {...props}>{children}</a>}
export const exportToCsv=()=>{}; export const exportWorkbookToXlsx=()=>{};
const data:any={vehicles:[{id:'v1',vehicle_reg:'701-1654',vehicle_type:'Truck',active:true},{id:'v2',vehicle_reg:'61-2835',vehicle_type:'Truck',active:true},{id:'v3',vehicle_reg:'79-2945',vehicle_type:'Truck',active:true}],drivers:[{id:'d1',name:'Fixture driver',assigned_vehicle_id:'v1',active:true}],mileage:[],fuel:[],records:[],items:[],requirements:[],applicability:[],attachments:[]};
const audit={created_by:'fixture-staff',updated_by:'fixture-staff',created_at:'2026-01-01T00:00:00Z',updated_at:'2026-01-01T00:00:00Z'};
if(!location.search.includes('empty')){
data.records=[{...audit,id:'r1',vehicle_id:'v1',service_date:maintenanceToday(),odometer:961250,garage:'ABC Garage',receipt_reference:'TEST-001',receipt_total:6150,calculated_total:6150,mismatch_confirmed:false,notes:'Fixture maintenance history',off_road_at:null,returned_at:null,is_deleted:false}];
data.items=[{...audit,id:'i1',record_id:'r1',position:0,description:'Grease + Engine Oil + Oil Filter',description_th:'จาระบี + น้ำมันเครื่อง + ไส้กรองน้ำมัน',category:'grease',quantity:1,unit_price:6150,notes:null,requirement_id:null,reminder_months:12,reminder_km:null,warning_days:30,warning_km:1000,override_date:null,override_km:null}];
data.attachments=[{id:'a1',record_id:'r1',file_path:'r1/receipt.pdf',original_filename:'scanned-receipt.pdf',mime_type:'application/pdf',size_bytes:12800,uploaded_by:'fixture-staff',uploaded_at:audit.created_at}];
}
if(data.records.length){
const base=data.records[0],item=data.items[0];
data.records.push({...base,id:'r2',vehicle_id:'v2',service_date:'2026-09-10',receipt_total:12000,calculated_total:12000},{...base,id:'r3',vehicle_id:'v3',service_date:'2026-09-12',receipt_total:13520,calculated_total:13520});
data.items.push({...item,id:'i2',record_id:'r2',category:'tyres',description:'Tyre service',unit_price:12000});
for(let i=0;i<11;i++)data.items.push({...item,id:'detail'+i,record_id:'r3',position:i,description:'Detailed receipt line '+(i+1),category:['brakes','steering','grease','oil','labour'][i%5],quantity:1,unit_price:i===0?3520:1000});
data.attachments.push({...data.attachments[0],id:'a2',record_id:'r3',original_filename:'supplier-scan.pdf'},{...data.attachments[0],id:'a3',record_id:'r3',original_filename:'receipt-photo.png',mime_type:'image/png'});
data.requirements.push({...audit,id:'req1',name:'Standard grease rule',category:'grease',vehicle_type:'Truck',frequency_months:12,mileage_interval:null,warning_days:30,warning_km:1000,active:true,notes:null});
if(location.search.includes('many'))for(let i=4;i<=50;i++){data.records.push({...base,id:'r'+i,vehicle_id:'v'+((i%3)+1),service_date:'2026-08-'+String((i%28)+1).padStart(2,'0')});data.items.push({...item,id:'many'+i,record_id:'r'+i})}
}
if(location.search.includes('attention')){
 const today=maintenanceToday();const shift=(days:number)=>new Date(Date.parse(today+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);
 data.mileage=[{vehicle_id:'v1',week_ending:today,odometer_reading:962000,created_at:today}];
 data.items[0].override_date=shift(-5); data.items[0].override_km=961900;
 data.items[1].override_date=shift(5);
 for(let n=0;n<3;n++){const id='repair'+n;data.records.push({...data.records[0],id,service_date:shift(-10-n*70),calculated_total:2300,receipt_total:2200});data.items.push({...data.items[0],id:'repair-line'+n,record_id:id,description:'Steering tie rod end',description_th:'ลูกหมากคันชัก',category:'steering',unit_price:2300,reminder_months:null,override_date:null,override_km:null});}
}
export class MaintenanceLoadError extends Error {}
export async function fetchMaintenanceData(){return structuredClone(data)}
export async function saveMaintenanceRecord(payload:any,items:any[],updatedAt:any){const existing=data.records.find((r:any)=>r.id===payload.id);if(existing&&existing.updated_at!==updatedAt)throw Error('MAINTENANCE_CONFLICT');const record={...audit,...payload,updated_at:new Date().toISOString(),calculated_total:maintenanceTotal(items),is_deleted:false};data.records=data.records.filter((r:any)=>r.id!==payload.id).concat(record);data.items=data.items.filter((i:any)=>i.record_id!==payload.id).concat(items.map((item:any,position:number)=>({...audit,...item,record_id:payload.id,position})));return record}
export async function deleteMaintenanceRecord(record:any){data.records.find((r:any)=>r.id===record.id).is_deleted=true}
export async function saveMaintenanceRequirement(){throw Error('Fixture does not write requirements')}
export const validateMaintenanceFile=validate;
export async function uploadMaintenanceAttachment(recordId:string,file:File,onProgress:any){await validate(file);onProgress(100);data.attachments.push({id:crypto.randomUUID(),record_id:recordId,file_path:recordId+'/'+file.name,original_filename:file.name,mime_type:file.type,size_bytes:file.size,uploaded_by:'fixture-staff',uploaded_at:new Date().toISOString()})}
export async function viewMaintenanceAttachment(){return '/fixture-receipt.pdf'}
export async function deleteMaintenanceAttachment(a:any){data.attachments=data.attachments.filter((item:any)=>item.id!==a.id)}
`);
if (useRealSnapshot) {
  const snapshot = JSON.parse(fs.readFileSync(path.join(dir, 'real-snapshot.json'), 'utf8'));
  const file = path.join(dir, 'mocks.tsx');
  let source = fs.readFileSync(file, 'utf8').replace('Local UI fixture · all writes stay in memory · no production connection', 'Read-only production snapshot · local preview · no production writes');
  source += `\nObject.assign(data, ${JSON.stringify(snapshot)});\n`;
  // Disable save/delete/upload controls while reviewing the real-data snapshot.
  source = source.replace('can:()=>true', 'can:()=>false').replace("export async function viewMaintenanceAttachment(){return '/fixture-receipt.pdf'}", "export async function viewMaintenanceAttachment(a:any){return '/local-receipt/'+a.id}");
  fs.writeFileSync(file, source);
}
// Compile the application's actual styles and Tailwind config for these components.
execFileSync(process.execPath, [require.resolve('tailwindcss/lib/cli'), '-i', path.join(root, 'app/globals.css'), '-o', path.join(dir, 'app.css'), '--minify'], { cwd: root, stdio: 'inherit' });
const webpack = require('next/dist/compiled/webpack/webpack'); webpack.init();
const mocks = path.join(dir, 'mocks.tsx');
const alias = {};
for (const name of ['@/lib/language-provider', '@/lib/use-account-access', '@/components/header', '@/lib/maintenance-data', '@/lib/supabase', '@/lib/export', 'next/link']) alias[name + '$'] = mocks;
alias['@'] = root;
webpack.webpack({mode:'development',devtool:false,entry:path.join(dir,'entry.tsx'),output:{path:dir,filename:'app.js'},resolve:{extensions:['.tsx','.ts','.js'],alias},module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:path.join(dir,'loader.cjs')}]},plugins:[new webpack.webpack.DefinePlugin({'process.env.NEXT_PUBLIC_SUPABASE_URL':'""','process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY':'""'})]},(error,stats)=>{
  if(error||stats.hasErrors()){console.error(error||stats.toString({all:false,errors:true}));process.exitCode=1;return}
  http.createServer((req,res)=>{
    if(req.url==='/app.js'||req.url==='/app.css'){res.setHeader('Content-Type',req.url.endsWith('.css')?'text/css':'text/javascript');res.end(fs.readFileSync(path.join(dir,req.url.slice(1))));return}
    if(useRealSnapshot && req.url.startsWith('/local-receipt/')){const id=req.url.slice('/local-receipt/'.length);const snapshot=JSON.parse(fs.readFileSync(path.join(dir,'real-snapshot.json'),'utf8'));const attachment=snapshot.attachments.find(a=>a.id===id);const file=path.join(dir,'receipt-'+id);if(attachment&&/^[a-zA-Z0-9-]+$/.test(id)&&fs.existsSync(file)){res.setHeader('Content-Type',attachment.mime_type);res.setHeader('Content-Disposition','inline');res.end(fs.readFileSync(file));return}res.statusCode=404;res.end('Local receipt unavailable');return}
    if(req.url==='/fixture-receipt.pdf'){res.setHeader('Content-Type','text/plain');res.end('Local receipt preview fixture. No production file read.');return}
    res.setHeader('Content-Type','text/html; charset=utf-8');
    // Block all external requests, including accidental production calls.
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'");
    res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/app.css"><title>Maintenance UI fixture</title></head><body><main id="root" class="mx-auto max-w-7xl p-3 sm:p-6"></main><script src="/app.js"></script></body></html>');
  }).listen(3004,'127.0.0.1',()=>console.log('Isolated Maintenance fixture ready: http://localhost:3004/maintenance'));
});

