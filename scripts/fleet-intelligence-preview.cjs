#!/usr/bin/env node
/** Offline pilot: existing Forth log JSON -> review report. Never reads env or contacts services. */
const fs=require('node:fs');const path=require('node:path');const Module=require('node:module');const ts=require('typescript');
const root=path.resolve(__dirname,'..');
function load(name,cache=new Map()) {
 const file=path.resolve(root,name);if(cache.has(file))return cache.get(file).exports;
 const m=new Module(file,module);cache.set(file,m);m.filename=file;m.paths=Module._nodeModulePaths(path.dirname(file));
 m.require=r=>r.startsWith('.')?load(path.relative(root,path.resolve(path.dirname(file),r))+'.ts',cache):require(r);
 m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);return m.exports;
}
try {
 const [inputPath,outputPath]=process.argv.slice(2);
 if(!inputPath||!outputPath) throw new Error('usage');
 if(fs.statSync(inputPath).size>1000000) throw new Error('size');
 const input=JSON.parse(fs.readFileSync(inputPath,'utf8'));
 const {normalizeHistoricalLog}=load('lib/forth-history-log.ts');
 const core=load('lib/fleet-intelligence.ts');const ops=load('lib/fleet-intelligence-operations.ts');
 const sources=load('lib/fleet-intelligence-sources.ts');
 if(!input.vehicleId||!input.deviceId) throw new Error('identity');
 const replay=normalizeHistoricalLog(input.forthLog,input.deviceId,'Asia/Bangkok');if(!replay) throw new Error('log');
 const crypto=require('node:crypto');
 const points=replay.points.map(p=>({...p,evidenceId:crypto.createHash('sha256').update(JSON.stringify([input.deviceId,p])).digest('hex')}));
 const daily=core.calculateVehicleDay(input.day,points);
 const allocation=core.allocateDistance(daily.intervals,input.confirmedAllocations??[]);
 if(daily.observedKm!==null && Math.abs(allocation.totalObservedKm-daily.observedKm)>1e-9) throw new Error('reconciliation');
 const timeline=core.segmentTimeline(daily.intervals);
 const timelineKm=timeline.reduce((n,s)=>n+(s.km??0),0);
 if(Math.abs(timelineKm-allocation.totalObservedKm)>1e-9) throw new Error('timeline');
 const fuel=ops.fuelIntelligence(input.vehicleId,input.day,input.purchases??[],input.consumption??[],input.valuation);
 const jobSuggestions=(input.journeyCandidates??[]).map(j=>({start:j.start,end:j.end,candidates:ops.rankJobCandidates(j,input.jobs??[])}));
 const distanceCheck=sources.reconcileValues(daily.observedKm,daily.observedKm===null?null:allocation.totalObservedKm,daily.complete);
 const timelineCheck=sources.reconcileValues(daily.observedKm,daily.observedKm===null?null:timelineKm,daily.complete);
 const provider=sources.reconcileProviderSegments({rows:input.providerSegments??[],deviceId:input.deviceId,day:input.day,completeness:input.providerCompleteness??'unknown',capturedAt:input.capturedAt??new Date().toISOString()});
 const distanceSources=sources.sourceAwareDay({day:input.day,gpsKm:daily.observedKm,gpsComplete:daily.complete,gpsEvidenceIds:daily.intervals.filter(i=>i.km!==null).flatMap(i=>i.evidenceIds),gpsSourceTimestamp:points.map(p=>p.timestampIso).filter(Boolean).sort().at(-1)??null,provider});
 const report={mode:'offline_review',realDataVerified:false,vehicleId:input.vehicleId,daily,allocation,timeline,fuel,jobSuggestions,
   distanceSources,providerEvidence:provider,
   checks:{distanceReconciled:distanceCheck.status==='pass',timelineReconciled:timelineCheck.status==='pass',distance:distanceCheck,timeline:timelineCheck,provider:provider.acceptance,productionWrites:0,providerRequests:0},
   limitations:['Input provenance and vehicle mapping require operator review.','No booking match is confirmed by this preview.','Unobserved distance and consumption remain unknown.']};
 fs.writeFileSync(outputPath,JSON.stringify(report,null,2),{flag:'wx'});
 if(process.argv.includes('--require-complete')){sources.requireCompleteReconciliation(distanceCheck);sources.requireCompleteReconciliation(timelineCheck);}
 console.log('Offline review report created; no provider request or production write.');
} catch {console.error('Preview failed. Use: node scripts/fleet-intelligence-preview.cjs INPUT.json NEW-OUTPUT.json. Check scope, JSON, size, evidence and output filename; existing files are never overwritten.');process.exitCode=1;}
