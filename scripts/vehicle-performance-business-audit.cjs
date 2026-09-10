// Read-only source audit. Never writes to Supabase.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
require('@next/env').loadEnvConfig(process.cwd(), true);
const resolve = Module._resolveFilename;
Module._resolveFilename = function(request, ...args) { return resolve.call(this, request.startsWith('@/') ? path.resolve(request.slice(2) + '.ts') : request, ...args); };
Module._extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText, filename);
const perf = require('../lib/vehicle-performance.ts');
const { buildFuelSpendReportVehicleMonthlyFuelRows } = require('../lib/fuel-spend-report.ts');
async function read(table, query) {
 const key=process.env.SUPABASE_SERVICE_ROLE_KEY; const rows=[];
 for(let offset=0;;offset+=1000){
  const r=await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${table}?${query}&offset=${offset}&limit=1000`,{headers:{apikey:key,Authorization:`Bearer ${key}`}});
  if(!r.ok) throw Error(`${table}: ${r.status}`);
  const batch=await r.json();rows.push(...batch);if(batch.length<1000)return rows;
 }
}
(async()=>{
 const [records,logs]=await Promise.all([
 read('vehicle_monthly_performance','select=year,month,vehicle_registration,gross_revenue,salary_cost,trip_income,other_expenses,lpg_cost&year=eq.2026&month=gte.1&month=lte.7&order=month,vehicle_registration'),
 read('fuel_logs','select=id,date,vehicle_reg,total_cost&date=gte.2026-01-01&date=lte.2026-07-31&order=date,id')]);
 const fuelRows=buildFuelSpendReportVehicleMonthlyFuelRows(logs,{year:2026});
 const rows=perf.buildVehiclePerformanceRows({records,fuelRows});
 const summary=perf.buildVehiclePerformanceSummary(rows);
 const monthly=perf.buildVehicleMonthlyPerformanceRows({records,fuelRows,months:[1,2,3,4,5,6,7],expectedVehicleCount:rows.length});
 const report={zeroRevenueMonths:records.filter(r=>Number(r.gross_revenue)<=0).map(r=>({registration:r.vehicle_registration,month:r.month})),recordCount:records.length,fuelLogCount:logs.length,summary,monthly,vehicles:rows};
 if(fs.existsSync('lib/vehicle-performance-management.ts')) report.management=require('../lib/vehicle-performance-management.ts').buildPerformanceManagement({records,fuelRows,months:[1,2,3,4,5,6,7]});
 fs.writeFileSync('output/vehicle-performance-business-audit.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify({recordCount:records.length,fuelLogCount:logs.length,summary,monthly,management:report.management},null,2));
})().catch(e=>{console.error(e.message);process.exitCode=1});
