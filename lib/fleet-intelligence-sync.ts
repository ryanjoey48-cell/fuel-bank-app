/** Server-side orchestration contract. Deliberately no route, cron or production store. */
import { createHash } from "node:crypto";
import { normalizeHistoricalLog } from "./forth-history-log";
import type { EvidencePoint } from "./fleet-intelligence";

export type SyncWindow = { vehicleId:string; deviceId:string; start:string; end:string; mappingEvidence:string };
export type SyncPolicy = {
  entitlementEvidence:string; limitsEvidence:string; sourceTimezone:"Asia/Bangkok";
  maxWindowSeconds:number; minIntervalMs:number; retentionStart:string;
  maxPages:number; maxRows:number; maxBytes:number;
};
export type RawEvidence = { id:string; deviceId:string; sourceTimestamp:unknown; receivedAt:string; fields:Record<string,unknown> };
export type SyncPage = { payload:unknown; nextCursor:string|null; completeness:"verified"|"unknown" };
export type SyncLease={token:string;generation:number;expiresAt:number};
export interface IntelligenceStore {
  /** Atomic lease shared by all workers; must also reserve the provider request budget. */
  acquire(key:string,minIntervalMs:number):Promise<SyncLease|null>;
  /** One transaction: insert immutable raw revisions, replace derived revision, checkpoint window. */
  commit(key:string,raw:readonly RawEvidence[],points:readonly EvidencePoint[],status:"complete"|"incomplete",lease:SyncLease):Promise<void>;
  fail(key:string,code:"request_failed"|"invalid_response"|"limit_exceeded",lease:SyncLease):Promise<void>;
  release(key:string,lease:SyncLease):Promise<void>;
}
const FIELDS=["gpsID","plateNumber","dateTime","GPS","GPRS","Engine","Speed","Distance","Latitude","Longitude","positionSource","Fuel","Sensor1","Sensor2","Sensor3"] as const;
const hash=(text:string)=>createHash("sha256").update(text).digest("hex");
function safeFields(row:Record<string,unknown>) {
  const result:Record<string,unknown>={};
  for (const field of FIELDS) {
    const value=row[field];
    if (value===null || typeof value==="boolean" || typeof value==="number" && Number.isFinite(value) || typeof value==="string" && value.length<=256) result[field]=value;
  }
  return result;
}
/** No default limits: reviewed provider constraints must be supplied. No automatic retries. */
export async function syncHistoryWindow(window:SyncWindow,policy:SyncPolicy,deps:{
  enabled:boolean; store:IntelligenceStore;
  authorizeMapping:(window:SyncWindow)=>Promise<boolean>;
  fetchPage:(window:SyncWindow,cursor:string|null)=>Promise<SyncPage>;
  /** Shared atomic provider budget; required before every additional page. */
  reserveNextRequest?:()=>Promise<boolean>;
  now:()=>number;
}) {
  if (!deps.enabled) return {status:"disabled" as const};
  const start=Date.parse(window.start),end=Date.parse(window.end),retention=Date.parse(policy.retentionStart);
  if (!window.vehicleId || !window.deviceId || !window.mappingEvidence.trim() || !policy.entitlementEvidence.trim() || !policy.limitsEvidence.trim() || policy.sourceTimezone!=="Asia/Bangkok" ||
    !Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(retention) || end<=start || start<retention || end>deps.now() ||
    ![policy.maxWindowSeconds,policy.minIntervalMs,policy.maxPages,policy.maxRows,policy.maxBytes].every(n=>Number.isSafeInteger(n) && n>0) || (end-start)/1000>policy.maxWindowSeconds) throw new Error("invalid_sync_scope");
  if (!await deps.authorizeMapping(window)) return {status:"mapping_rejected" as const};
  const key=hash(JSON.stringify([window.vehicleId,window.deviceId,window.start,window.end,window.mappingEvidence]));
  const lease=await deps.store.acquire(key,policy.minIntervalMs);
  if (!lease) return {status:"busy_or_rate_limited" as const};
  let code:"request_failed"|"invalid_response"|"limit_exceeded"="request_failed";
  try {
    const raw=new Map<string,RawEvidence>(); const points=new Map<string,EvidencePoint>();
    const seenCursors=new Set<string>(); let cursor:string|null=null,complete=true,bytes=0,rows=0;
    for (let pageIndex=0;;pageIndex++) {
      if (pageIndex>=policy.maxPages) { code="limit_exceeded"; throw new Error(code); }
      if (pageIndex>0 && (!deps.reserveNextRequest || !await deps.reserveNextRequest())) { code="limit_exceeded"; throw new Error("provider_budget_unavailable"); }
      const page=await deps.fetchPage(window,cursor);
      bytes+=Buffer.byteLength(JSON.stringify(page.payload));
      if (!Array.isArray(page.payload)) {code="invalid_response";throw new Error(code);}
      rows+=page.payload.length;
      if(bytes>policy.maxBytes || rows>policy.maxRows) {code="limit_exceeded";throw new Error(code);}
      const replay=normalizeHistoricalLog(page.payload,window.deviceId,policy.sourceTimezone);
      if(!replay) {code="invalid_response";throw new Error(code);}
      for(let i=0;i<replay.points.length;i++) {
        const p=replay.points[i]; const time=p.timestampIso ? Date.parse(p.timestampIso) : NaN;
        if(Number.isFinite(time) && (time<start || time>end)) {code="invalid_response";throw new Error("out_of_window");}
        const fields=safeFields(page.payload[i] as Record<string,unknown>);
        const id=hash(JSON.stringify([window.deviceId,fields]));
        raw.set(id,{id,deviceId:window.deviceId,sourceTimestamp:fields.dateTime ?? null,receivedAt:new Date(deps.now()).toISOString(),fields});
        points.set(id,{...p,evidenceId:id});
      }
      complete=complete && page.completeness==="verified";
      cursor=page.nextCursor;
      if(!cursor) break;
      if(seenCursors.has(cursor)) {code="invalid_response";throw new Error("repeated_cursor");}
      seenCursors.add(cursor);
    }
    const status=complete ? "complete" : "incomplete";
    if(!lease.token||!Number.isSafeInteger(lease.generation)||lease.generation<0||lease.expiresAt<=deps.now())throw new Error("invalid_or_expired_lease");
    // Store must fence this atomically too; the precheck alone cannot prevent races.
    await deps.store.commit(key,[...raw.values()],[...points.values()],status,lease);
    return {status,rawCount:raw.size,pointCount:points.size,key};
  } catch {
    try {await deps.store.fail(key,code,lease);} catch { /* stale leases cannot mutate status */ }
    return {status:"failed" as const,code,key};
  } finally {try {await deps.store.release(key,lease);} catch { /* do not unlock a replacement lease */ }}
}

/** Plan bounded overlapping windows. Persist each successful window, never a speculative watermark. */
export function planBackfill(start:string,end:string,maxWindowSeconds:number,overlapSeconds=1,maxWindows=100) {
  const lo=Date.parse(start),hi=Date.parse(end);
  if(!Number.isFinite(lo)||!Number.isFinite(hi)||hi<=lo||!Number.isSafeInteger(maxWindowSeconds)||maxWindowSeconds<=0||!Number.isSafeInteger(overlapSeconds)||overlapSeconds<0||overlapSeconds>=maxWindowSeconds||!Number.isSafeInteger(maxWindows)||maxWindows<1) throw new Error("invalid_backfill");
  const windows:{start:string;end:string}[]=[];
  for(let cursor=lo;cursor<hi;) {
    if(windows.length>=maxWindows) throw new Error("backfill_plan_limit");
    const midnight=(Math.floor((cursor+7*3600000)/86400000)+1)*86400000-7*3600000;
    const next=Math.min(hi,cursor+maxWindowSeconds*1000,midnight);
    windows.push({start:new Date(cursor).toISOString(),end:new Date(next).toISOString()});
    if(next===hi) break; cursor=next===midnight ? next : next-overlapSeconds*1000;
  }
  return windows;
}
