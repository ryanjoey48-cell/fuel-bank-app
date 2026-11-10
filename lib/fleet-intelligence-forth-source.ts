import "server-only";
import { getForthLogReport, getForthTrackingFleetData } from "./forth-tracking-server";
import { isForthHistoryLiveRequestsEnabled } from "./forth-history-live-gate";
import { buildHistoricalLogPath } from "./forth-history-log";
import type { SyncPage, SyncWindow } from "./fleet-intelligence-sync";

function providerStamp(iso:string) {
  const time=Date.parse(iso);
  if(!Number.isFinite(time)||time%1000!==0) throw new Error("invalid_provider_time");
  return new Date(time+7*3600000).toISOString().slice(0,19).replace(/[-:T]/g,"");
}
/** Secure fixed-URL binding. No arbitrary URLs, token exposure, writes or pagination guesses.
 * bindOfficeMapping must verify the EES user/business:read and the effective-dated
 * EES vehicle/device association using trusted server context, not request booleans.
 */
export function createReadonlyForthIntelligenceSource(bindOfficeMapping:(window:SyncWindow)=>Promise<boolean>) {
  const authorized=new Set<string>();
  const scope=(w:SyncWindow)=>JSON.stringify([w.vehicleId,w.deviceId,w.start,w.end,w.mappingEvidence]);
  return {
    async authorizeMapping(window:SyncWindow) {
      if(!isForthHistoryLiveRequestsEnabled() || !await bindOfficeMapping(window)) return false;
      const fleet=await getForthTrackingFleetData();
      if(fleet.connectionStatus!=="connected" || fleet.records.filter(r=>r.gpsDeviceId===window.deviceId).length!==1) return false;
      authorized.add(scope(window));return true;
    },
    async fetchPage(window:SyncWindow,cursor:string|null):Promise<SyncPage> {
      if(!isForthHistoryLiveRequestsEnabled() || !authorized.delete(scope(window))) throw new Error("scope_not_authorized");
      if(cursor!==null) throw new Error("forth_log_pagination_unverified");
      const startTime=providerStamp(window.start);
      const endMs=Date.parse(window.end);
      // Forth's path builder requires one calendar date. A half-open day ends
      // with the last representable source second; no midnight distance is invented.
      const atBangkokMidnight=(endMs+7*3600000)%86400000===0;
      const endTime=providerStamp(atBangkokMidnight ? new Date(endMs-1000).toISOString() : window.end);
      if(!buildHistoricalLogPath(window.deviceId,startTime,endTime)) throw new Error("invalid_provider_window");
      const result=await getForthLogReport({deviceId:window.deviceId,startTime,endTime});
      if(!result.ok) throw new Error("forth_history_request_failed");
      // HTTP 200 and an array do not establish that the provider did not truncate it.
      return {payload:result.payload,nextCursor:null,completeness:"unknown"};
    }
  };
}
