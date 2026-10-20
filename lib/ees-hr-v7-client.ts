"use client";
import { supabase } from "@/lib/supabase";
import { withRequestDeadline } from "@/lib/request-deadline";
import { HRV7Error, type HRAction, type EmployeeRef } from "@/lib/ees-hr-v7-types";

const reads=new Map<string,Promise<unknown>>();
let readEpoch=0;
export function invalidateHRReads(){readEpoch++;reads.clear();}
export async function hrRequest<T>(path:string,init:RequestInit={}) {
  const {data,error}=await withRequestDeadline(()=>supabase.auth.getSession(),init.signal).catch(()=>{throw new HRV7Error("HR_NETWORK",503);});
  if(error || !data.session?.access_token) throw new HRV7Error("HR_AUTH_REQUIRED",401);
  const token=data.session.access_token;
  const request=()=>withRequestDeadline(async signal=>{
    const response=await fetch(`/api/hr/${path}`,{...init,cache:"no-store",signal,headers:{...(!(init.body instanceof FormData)?{"Content-Type":"application/json"}:{}),...init.headers,Authorization:`Bearer ${token}`}});
    const body=await response.json().catch(()=>null);
    if(!response.ok)throw new HRV7Error(body?.code??"HR_OPERATION_FAILED",response.status,body?.dependencies);
    if(body===null)throw new HRV7Error("HR_NETWORK",503);
    const current=await supabase.auth.getSession();
    if(!current.data.session || current.data.session.user?.id!==data.session?.user?.id)throw new HRV7Error("HR_AUTH_REQUIRED",401);
    return body as T;
  },init.signal,init.body instanceof FormData?45_000:15_000).catch(error=>{if(error instanceof HRV7Error)throw error;throw new HRV7Error("HR_NETWORK",503);});
  if(init.signal || init.method && init.method!=="GET")return request();
  const key=token+":"+readEpoch+":"+path;
  if(reads.has(key))return reads.get(key) as Promise<T>;
  const promise=request().finally(()=>{if(reads.get(key)===promise)reads.delete(key);});reads.set(key,promise);return promise;
}
export async function hrAction<T=Record<string,unknown>>(action:HRAction,input:Record<string,unknown>,requestId=crypto.randomUUID()) {
  const result=await hrRequest<T>("action",{method:"POST",body:JSON.stringify({action,input,requestId})});
  invalidateHRReads();
  const operational=action==="save_employee"?["preferredName","employmentStatus","endDate"].some(key=>Object.prototype.hasOwnProperty.call(input,key)):["save_driver","deactivate_driver","change_vehicle","end_cover","link_driver"].includes(action);
  if(operational) {
    const {clearDataReadCache}=await import("@/lib/data");
    clearDataReadCache();window.dispatchEvent(new CustomEvent("fuel-bank:data-changed",{detail:{resource:"drivers",resources:["drivers","employees","vehicles"]}}));
  }
  window.dispatchEvent(new CustomEvent("ees:hr-changed",{detail:{action,driverId:input.driverId,employeeId:input.employeeId}}));return result;
}
export function profilePath(ref:EmployeeRef,section="overview") {return `profile/${ref.kind}/${encodeURIComponent(ref.id)}?section=${section}`;}
export async function hrDocumentBlob(id:string) {
  const {data,error}=await withRequestDeadline(()=>supabase.auth.getSession());
  if(error || !data.session)throw new HRV7Error("HR_AUTH_REQUIRED",401);
  return withRequestDeadline(async signal=>{
    const response=await fetch(`/api/hr/documents/${encodeURIComponent(id)}`,{cache:"no-store",signal,headers:{Authorization:`Bearer ${data.session!.access_token}`}});
    if(!response.ok){const body=await response.json().catch(()=>null);throw new HRV7Error(body?.code??"HR_OPERATION_FAILED",response.status);}
    return response.blob();
  });
}
