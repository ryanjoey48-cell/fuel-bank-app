"use client";
import Link from "next/link";
import {useCallback,useEffect,useRef,useState} from "react";
import {supabase} from "@/lib/supabase";
import {useLanguage} from "@/lib/language-provider";
import {hrRequest} from "@/lib/ees-hr-v7-client";
import {subscribeHRSession} from "@/lib/ees-hr-session";
import {hrCopy,hrErrorMessage,hrStatus} from "@/lib/ees-hr-v7-copy";
import {peopleCopy} from "@/lib/ees-people-copy";
import {HRV7Error} from "@/lib/ees-hr-v7-types";
import type {ComplianceList,ComplianceRow} from "@/lib/ees-hr-compliance";
import {HRPage,HRSetup} from "./hr-page";
import {useHRAccess} from "./use-hr-access";
import {HRDate,HRNotice,HRRestricted} from "./hr-ui";
export function ComplianceCentre(){
 const {language}=useLanguage(),c=hrCopy(language),p=peopleCopy(language),th=language==="th";
 const access=useHRAccess(language);
 const [data,setData]=useState<ComplianceList|null>(null),[error,setError]=useState<unknown>(null),[loading,setLoading]=useState(false),[page,setPage]=useState(1),[search,setSearch]=useState(""),[query,setQuery]=useState(""),[status,setStatus]=useState("all");
 const generation=useRef(0),request=useRef<AbortController|null>(null);
 const clear=useCallback(()=>{generation.current++;request.current?.abort();setData(null);setError(null);setLoading(false);},[]);
 useEffect(()=>{const timer=setTimeout(()=>{setQuery(search);setPage(1);},250);return()=>clearTimeout(timer);},[search]);
 const load=useCallback(async()=>{
  if(!access.access?.hr||!access.access.ready)return;
  request.current?.abort();const controller=new AbortController();request.current=controller;const seq=++generation.current;
  setLoading(true);setError(null);setData(null);
  const timer=setTimeout(()=>{if(seq===generation.current){generation.current++;controller.abort();setError(new HRV7Error("HR_NETWORK",503));setLoading(false);}},20_000);
  try{const result=await hrRequest<ComplianceList>("compliance?"+new URLSearchParams({page:String(page),search:query,status}),{signal:controller.signal});if(seq===generation.current)setData(result);}
  catch(cause){if(seq===generation.current)setError(cause);}finally{clearTimeout(timer);if(seq===generation.current)setLoading(false);}
 },[access.access?.hr,access.access?.ready,page,query,status]);
 useEffect(()=>{void load();return clear;},[load,clear]);
 useEffect(()=>subscribeHRSession(supabase.auth,()=>void load(),clear),[load,clear]);
 const href=(row:ComplianceRow)=>(row.kind==="driver"?"/drivers/":"/employees/")+row.id+"?section=documents";
 const labels={all:th?"ทั้งหมด":"All records",missing:th?"ยังไม่มีข้อมูล":"Missing / unrecorded",expired:th?"หมดอายุ":"Expired",expiring:th?"ใกล้หมดอายุ (30 วัน)":"Expiring within 30 days"};
 const licence=(row:ComplianceRow)=>row.licenceStatus?row.licenceStatus==="not_recorded"?<span className="text-slate-400">—</span>:<span className={row.licenceStatus==="expired"?"text-rose-700":row.licenceStatus==="expiring"?"text-amber-700":"text-slate-600"}>{hrStatus(language,row.licenceStatus)}</span>:<span className="text-slate-400">—</span>;
 const warning=(row:ComplianceRow)=>row.expired?<span className="rounded-full bg-rose-50 px-2 py-0.5 text-xs text-rose-700">{labels.expired}</span>:row.expiring?<span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-800">{th?"ใกล้หมดอายุ":"Expiring soon"}</span>:null;
 return <HRPage><header className="flex items-center justify-between gap-2"><h1 className="text-xl font-bold text-slate-950">{p.documents}</h1><button className="btn-secondary" disabled={loading||access.loading} onClick={()=>void (access.access?.hr?load():access.retry())}>{c.refresh}</button></header>
 {access.loading?<p role="status" className="text-sm text-slate-500">{th?"กำลังตรวจสอบสิทธิ์เข้าถึง…":"Checking HR access…"}</p>:access.error?<div className="space-y-2"><HRNotice error>{hrErrorMessage(language,access.error)}</HRNotice><button className="btn-secondary" onClick={()=>void access.retry()}>{th?"ลองอีกครั้ง":"Retry"}</button></div>:!access.access?.hr?<HRRestricted language={language}/>:!access.access.ready?<HRSetup language={language} dependencies={access.access.setupDependencies??[]} onRetry={()=>void access.retry()}/>:
 <section className="overflow-hidden rounded-xl border border-violet-100 bg-white/90 shadow-sm"><div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3"><input type="search" className="form-input min-w-[160px] flex-1" aria-label={p.search} placeholder={p.search} value={search} onChange={e=>setSearch(e.target.value)}/><select className="form-input !w-auto max-w-full bg-white" aria-label={th?"สถานะเอกสาร":"Document status"} value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}}>{Object.entries(labels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></div>
 <p className="px-3 py-2 text-xs text-slate-500">{th?"— หมายถึงยังไม่มีข้อมูล หรือไม่ใช้กับพนักงานรายนี้ นับเฉพาะเอกสารพร้อมใช้งาน วันหมดอายุที่ใกล้ที่สุดรวมใบขับขี่และเอกสารที่บันทึกไว้":"— means unrecorded or not applicable. Counts include ready documents; next expiry includes recorded licences and documents."}</p>
 {error?<div className="space-y-2 p-3"><HRNotice error>{hrErrorMessage(language,error)}</HRNotice><button className="btn-secondary" onClick={()=>void load()}>{th?"ลองอีกครั้ง":"Retry"}</button></div>:loading?<p role="status" className="p-4 text-sm text-slate-500">{c.loading}</p>:data&&!data.rows.length?<div className="p-5 text-sm text-slate-500">{p.empty}</div>:null}
 {data?<><div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[720px] text-left text-sm"><thead className="border-y border-slate-100 bg-slate-50/60 text-xs text-slate-500"><tr>{[c.name,c.vehicle,c.licence,th?"วันหมดอายุถัดไป":"Next expiry",th?"เอกสาร":"Documents",th?"การดำเนินการ":"Actions"].map(label=><th key={label} className="px-4 py-3 font-medium">{label}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{data.rows.map(row=><tr key={row.kind+row.id} className="hover:bg-violet-50/30"><td className="px-4 py-3"><Link className="font-semibold text-slate-950 hover:text-violet-700" href={href(row)}>{row.name}</Link></td><td className="px-4 py-3 text-slate-600">{row.vehicle??"—"}</td><td className="px-4 py-3">{licence(row)}</td><td className="px-4 py-3"><div className="flex flex-wrap items-center gap-2"><HRDate value={row.expiry} language={language}/>{warning(row)}</div></td><td className="px-4 py-3 tabular-nums text-slate-600">{row.documentCount}</td><td className="px-4 py-3"><Link className="table-action-secondary whitespace-nowrap" href={href(row)}>{th?"ดูเอกสาร":"View documents"}</Link></td></tr>)}</tbody></table></div>
 <ul className="divide-y divide-slate-100 md:hidden">{data.rows.map(row=><li key={row.kind+row.id} className="px-3 py-3"><div className="flex items-start justify-between gap-2"><Link href={href(row)} className="font-semibold text-slate-950">{row.name}</Link>{warning(row)}</div><div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500"><span>{row.vehicle??"—"}</span>{row.licenceStatus?<span>{c.licence}: {licence(row)}</span>:null}<span>{th?"เอกสาร":"Documents"}: {row.documentCount}</span>{row.expiry?<span><HRDate value={row.expiry} language={language}/></span>:null}</div><Link href={href(row)} className="mt-1 inline-flex min-h-9 items-center text-xs font-semibold text-violet-700">{th?"ดูเอกสาร":"View documents"}</Link></li>)}</ul>
 <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 p-3 text-xs text-slate-500"><span>{p.page} {page} / {Math.max(1,Math.ceil(data.total/25))} · {data.total}</span><div className="flex gap-2"><button className="btn-secondary" disabled={page===1||loading} onClick={()=>setPage(v=>v-1)}>{p.previous}</button><button className="btn-secondary" disabled={page*25>=data.total||loading} onClick={()=>setPage(v=>v+1)}>{p.next}</button></div></footer></>:null}
 </section>}</HRPage>;
}
