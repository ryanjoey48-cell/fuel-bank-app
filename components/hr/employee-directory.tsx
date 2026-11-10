"use client";
import Link from "next/link";
import { useCallback,useEffect,useMemo,useRef,useState } from "react";
import { Users,UserCheck,CalendarDays,CalendarClock,Search,Plus,Download,RefreshCw,LockKeyhole,ArrowRight,FileWarning,IdCard,CircleHelp,ClipboardCheck,ListChecks } from "lucide-react";
import { EESLogo } from "@/components/ees-logo";
import { useLanguage } from "@/lib/language-provider";
import {subscribeHRSession} from "@/lib/ees-hr-session";
import { supabase } from "@/lib/supabase";
import { hrRequest } from "@/lib/ees-hr-v7-client";
import { hrVehicleType } from "@/lib/ees-hr-v7-vehicle-label";
import { hrCopy,hrErrorMessage,hrStatus } from "@/lib/ees-hr-v7-copy";
import { hrV8Copy } from "@/lib/ees-hr-v8-copy";
import { primaryAttention, type AttentionQueue } from "@/lib/ees-hr-attention";
import {peopleCopy} from "@/lib/ees-people-copy";
import {HRPage} from "./hr-page";
import { useRouter } from "next/navigation";
import { safeDirectoryExport,type HRDirectory,type DirectoryEmployee } from "@/lib/ees-hr-v7-types";
import type {ComplianceList} from "@/lib/ees-hr-compliance";
import { HRDialog,HRFields,HRNotice,useHRMutation,type HRField } from "./hr-ui";

const DOC_ALERTS=new Set(["expired","expiring","needs_review","incompatible"]);
function formatCount(language:"en"|"th",value:number|null|undefined){
  if(value==null)return "—";
  return new Intl.NumberFormat(language==="th"?"th-TH":"en-GB").format(value);
}
function statusPill(status:string){
  if(status==="active"||status==="on_leave")return "hr-pill hr-pill--ok";
  if(status==="left")return "hr-pill hr-pill--muted";
  return "hr-pill hr-pill--muted";
}
function documentPill(status:string|null|undefined){
  if(!status||status==="not_recorded")return "hr-pill hr-pill--muted";
  if(status==="expired"||status==="incompatible")return "hr-pill hr-pill--alert";
  if(status==="expiring"||status==="needs_review")return "hr-pill hr-pill--warn";
  return "hr-pill hr-pill--info";
}

export function EmployeeDirectory() {
  const {language}=useLanguage();const c=hrCopy(language);const v8=hrV8Copy(language);
  const router=useRouter(),p=peopleCopy(language);
  const [role,setRole]=useState("all");
  const [data,setData]=useState<HRDirectory|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState<string|null>(null);
  const [search,setSearch]=useState(""),[query,setQuery]=useState(""),[status,setStatus]=useState("all"),[vehicleType,setVehicleType]=useState("all"),[sort,setSort]=useState("name-asc"),[page,setPage]=useState(1);
  const [create,setCreate]=useState<"employee"|"driver"|null>(null),[draft,setDraft]=useState<Record<string,unknown>>({});const generation=useRef(0);
  const [kind,setKind]=useState("all");
  const [docAlert,setDocAlert]=useState("all");
  const [docCounts,setDocCounts]=useState<{attention:number|null;expiring:number|null;missing:number|null}>({attention:null,expiring:null,missing:null});
  const [attention,setAttention]=useState<AttentionQueue|null>(null),[attentionLoading,setAttentionLoading]=useState(false);
  const invalidate=useCallback(()=>{generation.current++;},[]);
  useEffect(()=>{const timer=setTimeout(()=>{setQuery(search);setPage(1);},250);return()=>clearTimeout(timer);},[search]);
  const load=useCallback(async()=>{const seq=++generation.current;setLoading(true);setError(null);try{
    const size=docAlert==="action"?50:25;
    const result=await hrRequest<HRDirectory>("directory",{method:"POST",body:JSON.stringify({search:query,status,vehicleType,sort,page:docAlert==="action"?1:page,size,kind,role})});
    if(generation.current===seq)setData(result);
  }catch(error){if(generation.current===seq)setError(hrErrorMessage(language,error));throw error;}finally{if(generation.current===seq)setLoading(false);}},[docAlert,language,page,query,sort,status,vehicleType,kind,role]);
  const loadAttention=useCallback(async()=>{
    if(!data?.access.hr||!data.access.ready){setAttention(null);return;}
    setAttentionLoading(true);
    try{setAttention(await hrRequest<AttentionQueue>("attention?limit=12"));}
    catch{setAttention(null);}
    finally{setAttentionLoading(false);}
  },[data?.access.hr,data?.access.ready]);
  useEffect(()=>{void load().catch(()=>{});return invalidate;},[load,invalidate]);
  useEffect(()=>{void loadAttention();},[loadAttention,data?.summary.total]);
  useEffect(()=>{const refresh=()=>{void load().catch(()=>{});void loadAttention();};window.addEventListener("focus",refresh);window.addEventListener("ees:hr-changed",refresh);const unsubscribe=subscribeHRSession(supabase.auth,refresh,()=>{generation.current++;setData(null);setAttention(null);});return()=>{window.removeEventListener("focus",refresh);window.removeEventListener("ees:hr-changed",refresh);unsubscribe();};},[load,loadAttention]);
  useEffect(()=>{
    if(!data?.access.hr||!data.access.ready){setDocCounts({attention:null,expiring:null,missing:null});return;}
    let cancelled=false;
    Promise.all([
      hrRequest<ComplianceList>("compliance?status=expired&page=1"),
      hrRequest<ComplianceList>("compliance?status=expiring&page=1"),
      hrRequest<ComplianceList>("compliance?status=missing&page=1"),
    ]).then(([expired,expiring,missing])=>{
      if(cancelled)return;
      setDocCounts({
        attention:expired.total+expiring.total+missing.total,
        expiring:expiring.total,
        missing:missing.total,
      });
    }).catch(()=>{if(!cancelled)setDocCounts({attention:null,expiring:null,missing:null});});
    return()=>{cancelled=true;};
  },[data?.access.hr,data?.access.ready,data?.summary.total]);
  const mutation=useHRMutation(language,load);
  const openCreate=(kind:"employee"|"driver")=>{mutation.clear();setDraft(kind==="employee"?{preferredName:"",employmentStatus:"not_recorded",statusReason:""}:{name:"",active:true});setCreate(kind);};
  const saveCreate=async()=>{const result=await mutation.run(create==="driver"?"save_driver":"save_employee",draft);if(result)setCreate(null);};
  const href=(row:DirectoryEmployee)=>row.kind==="driver"?`/drivers/${row.id}`:`/employees/${row.id}`;
  const summary=data?.summary;
  const filteredRows=useMemo(()=>{
    const rows=data?.rows??[];
    if(docAlert!=="action")return rows;
    return rows.filter(row=>row.documentStatus&&DOC_ALERTS.has(row.documentStatus));
  },[data?.rows,docAlert]);
  const localPageRows=useMemo(()=>{
    if(docAlert!=="action")return filteredRows;
    return filteredRows.slice((page-1)*25,page*25);
  },[docAlert,filteredRows,page]);
  const displayTotal=docAlert==="action"?filteredRows.length:(data?.total??0);
  const approvalsAvailable=Boolean(data?.access.peopleReady);
  const cards=[
    {label:c.total,value:summary?.total??null,icon:Users,detail:"",title:""},
    {label:c.active,value:summary?.activeEmployees??null,icon:UserCheck,detail:summary?`${summary.activeDrivers} ${c.activeDriverRecords}`:"",title:c.confirmedActiveHelp},
    {label:c.employmentUnrecorded,value:summary?.unrecordedEmployment??null,icon:CircleHelp,detail:c.unrecordedHelp,title:c.unrecordedHelp},
    {label:v8.currentlyAbsent,value:summary?.awayToday??null,icon:CalendarDays,detail:data&&!data.access.hr?c.hrOnly:"",title:""},
    {label:v8.missingDocuments,value:data?.access.hr?docCounts.attention:null,icon:FileWarning,detail:data?.access.hr&&docCounts.missing!=null?`${formatCount(language,docCounts.missing)} ${language==="th"?"ขาด":"missing"}`:(data&&!data.access.hr?c.hrOnly:""),title:""},
    {label:c.licencesExpiring,value:data?.access.hr?docCounts.expiring:null,icon:IdCard,detail:data&&!data.access.hr?c.hrOnly:"",title:""},
    {label:v8.openFollowups,value:summary?.actionsDue??summary?.followupsDue??null,icon:CalendarClock,detail:data&&!data.access.hr?c.hrOnly:"",title:""},
    {label:v8.outstandingApprovals,value:approvalsAvailable?null:null,icon:ClipboardCheck,detail:approvalsAvailable?v8.preparedWorkflow:v8.approvalsGated,title:v8.approvalsGated},
  ];
  const vehicleTypes=data?.vehicleTypes??[...new Set((data?.rows??[]).map(row=>row.vehicle?.type).filter((type):type is string=>Boolean(type)))];
  const fields:HRField[]=create==="driver"?[{key:"name",label:c.displayName,required:true}]:[
    {key:"preferredName",label:c.displayName,required:true},{key:"employeeNumber",label:c.employeeNumber,help:c.employeeCodeHelp},
    {key:"jobRole",label:c.jobRole},{key:"department",label:c.department},
    {key:"employmentStatus",label:c.status,type:"select",options:["not_recorded","active","on_leave","left"].map(value=>({value,label:hrStatus(language,value)}))},
    {key:"startDate",label:c.startDate,type:"date"},{key:"endDate",label:c.endDate,type:"date"},{key:"statusReason",label:c.statusReason,required:true,type:"textarea"}];
  return <HRPage><div className="ees-driver-directory space-y-3">
    <header className="office-page-header office-page-header__row">
      <div className="office-page-header__identity"><EESLogo className="h-10 w-10"/><div><p className="office-page-header__eyebrow">EES · People & Safety · {v8.controlCentre}</p><h1 className="office-page-header__title">{c.title}</h1><p className="office-page-header__description">{c.subtitle}</p></div></div>
      <div className="office-page-header__actions">{data?.access.admin?<Link href="/hr/settings" className="btn-secondary">{c.managerAccess}</Link>:null}
        {data?.access.hr&&data.access.ready?<button type="button" className="btn-primary gap-2" onClick={()=>openCreate("employee")}><Plus className="h-4 w-4"/>{c.newEmployee}</button>:null}
        {data?.access.operate&&data.access.ready?<button type="button" className="btn-secondary" onClick={()=>openCreate("driver")}>{c.newDriver}</button>:null}
      </div>
    </header>
    {data&&!data.access.ready?<HRNotice><strong>{c.setup}</strong> — {c.setupDescription}</HRNotice>:null}
    {error?<HRNotice error>{error}</HRNotice>:null}{mutation.notice?<HRNotice>{mutation.notice}</HRNotice>:null}
    <section className="hr-stat-grid hr-stat-grid--8" aria-label={c.overview}>{cards.map(card=><div key={card.label} className="hr-stat-card" title={card.title||undefined}><div className="hr-stat-card__label"><span>{card.label}</span><card.icon className="h-3.5 w-3.5 shrink-0 text-violet-600"/></div><p className="hr-stat-card__value">{formatCount(language,card.value)}</p>{card.detail?<p className="hr-stat-card__detail">{card.detail}</p>:null}</div>)}</section>
    {data?.access.hr&&data.access.ready?<section className="hr-panel p-3 sm:p-4" aria-label={v8.attentionList}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-bold text-slate-950"><ListChecks className="h-4 w-4 text-violet-700"/>{v8.attentionList}</h2>
        <p className="text-xs text-slate-500">
          {attentionLoading?c.loading:attention?`${formatCount(language,attention.totalNeedingAttention)} / ${formatCount(language,attention.scanned)} · ${v8.attentionHelp}`:v8.attentionHelp}
        </p>
      </div>
      {attention&&(attention.counts.licenceExpired>0||attention.counts.licenceExpiring>0||attention.counts.licenceMissing>0)?
        <p className="mb-2 text-xs text-slate-600">
          {language==="th"?"ใบขับขี่/เอกสาร:":"Licence / documents:"}
          {" "}{attention.counts.licenceExpired} {language==="th"?"หมดอายุ":"expired"}
          {" · "}{attention.counts.licenceExpiring} {language==="th"?"ใกล้หมดอายุ":"expiring"}
          {" · "}{attention.counts.licenceMissing} {language==="th"?"ยังไม่มี":"missing"}
        </p>:null}
      {!attention?.rows.length&&!attentionLoading?<p className="text-sm text-slate-500">{v8.noAttention}</p>:null}
      {attention?.rows.length?<ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">{attention.rows.map(row=>
        <li key={`${row.kind}:${row.id}`} className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2">
          <div className="flex items-start justify-between gap-2"><Link href={row.href} className="font-semibold text-slate-950 hover:text-violet-700">{row.name}</Link><span className={statusPill(row.employmentStatus)}>{row.employmentStatus==="not_recorded"?"—":hrStatus(language,row.employmentStatus)}</span></div>
          <p className="mt-1 text-xs text-slate-600">{language==="th"?row.primary.th:row.primary.en}</p>
          <Link href={`${row.href}?section=overview`} className="mt-2 inline-flex text-xs font-semibold text-violet-700">{v8.attentionOpen}<ArrowRight className="ml-1 h-3.5 w-3.5"/></Link>
        </li>
      )}</ul>:null}
    </section>:null}
    <section className="hr-panel">
      <div className="hr-toolbar"><label className="relative min-w-[180px] flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400"/><input type="search" aria-label={c.search} placeholder={c.search} value={search} onChange={event=>setSearch(event.target.value)} className="form-input w-full pl-9"/></label>
        <select aria-label={c.staff} value={kind} onChange={event=>{setKind(event.target.value);setPage(1);}} className="form-input !w-auto max-w-full bg-white"><option value="all">{c.all}</option><option value="driver">{c.newDriver}</option><option value="employee">{c.officeEmployee}</option></select>
        <select aria-label={c.status} value={status} onChange={event=>{setStatus(event.target.value);setPage(1);}} className="form-input !w-auto max-w-full bg-white"><option value="all">{c.all}</option>{["active","on_leave","left","not_recorded"].map(value=><option key={value} value={value}>{hrStatus(language,value)}</option>)}</select>
        <select aria-label={p.role} value={role} onChange={event=>{setRole(event.target.value);setPage(1);}} className="form-input !w-auto max-w-full bg-white"><option value="all">{p.role}: {c.all}</option>{(data?.roles??[]).map(value=><option key={value} value={value}>{value}</option>)}</select>
        <select aria-label={c.vehicleType} value={vehicleType} onChange={event=>{setVehicleType(event.target.value);setPage(1);}} className="form-input !w-auto max-w-full bg-white"><option value="all">{c.allTypes}</option>{vehicleTypes.map(type=><option key={type} value={type}>{hrVehicleType(language,type)}</option>)}</select>
        <select aria-label={c.documentAlert} value={docAlert} onChange={event=>{setDocAlert(event.target.value);setPage(1);}} className="form-input !w-auto max-w-full bg-white"><option value="all">{c.documentAlertAll}</option><option value="action">{c.documentAlertAction}</option></select>
        <select aria-label={c.name} value={sort} onChange={event=>{setSort(event.target.value);setPage(1);}} className="form-input !w-auto max-w-full bg-white">{[["name-asc",c.nameAsc],["name-desc",c.nameDesc],["vehicle",c.sortVehicle],["role",c.sortRole]].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>
        <button type="button" className="btn-secondary" aria-label={c.refresh} onClick={()=>void load().catch(()=>{})} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading?"animate-spin":""}`}/></button>
        <button type="button" className="btn-secondary gap-2" disabled={!localPageRows.length} onClick={()=>void import("@/lib/export").then(({exportToXlsx})=>exportToXlsx(safeDirectoryExport(localPageRows),"EES-Employee-Directory")).catch(cause=>setError(hrErrorMessage(language,cause)))}><Download className="h-4 w-4"/>{p.exportPage}</button>
      </div>
      {loading&&!data?(
        <div className="space-y-2 p-4" role="status" aria-label={c.loading}>
          {Array.from({length:8}).map((_,index)=><div key={index} className="hr-skeleton h-9 w-full"/>)}
        </div>
      ):null}
      {data&&!localPageRows.length?<div className="p-6 text-center"><h2 className="font-semibold text-slate-900">{c.empty}</h2><p className="mt-1 text-sm text-slate-500">{c.emptyDescription}</p></div>:null}
      <div className="hidden overflow-x-auto md:block"><table className="hr-table"><thead><tr>{[c.name,c.employeeNumber,c.status,c.jobRole,c.vehicle,c.vehicleType,c.licence,c.documents,c.nextAction,""].map((label,index)=><th key={index}>{label}</th>)}</tr></thead><tbody>{localPageRows.map(row=><tr key={`${row.kind}:${row.id}`} onClick={event=>{if(!(event.target as HTMLElement).closest("a,button"))router.push(href(row));}}><td><Link href={href(row)} className="font-semibold text-slate-950 hover:text-violet-700">{row.name}</Link>{row.kind==="employee"?<p className="mt-0.5 text-[11px] text-slate-400">{c.officeEmployee}</p>:null}</td><td className="tabular-nums text-slate-600">{row.employeeNumber??"—"}</td><td><span className={statusPill(row.employmentStatus)} title={hrStatus(language,row.employmentStatus)}>{row.employmentStatus==="not_recorded"?"—":hrStatus(language,row.employmentStatus)}</span>{row.awayToday?<p className="mt-1 text-[11px] font-semibold text-amber-700">{p.away}</p>:null}</td><td>{row.jobRole??"—"}</td><td className="font-medium">{row.vehicle?.registration??"—"}</td><td>{row.vehicle?.type?hrVehicleType(language,row.vehicle.type):"—"}</td><td>{row.documentStatus?row.documentStatus==="not_recorded"?<span className="text-slate-400">—</span>:<span className={documentPill(row.documentStatus)}>{hrStatus(language,row.documentStatus)}</span>:<LockKeyhole aria-label={c.hrOnly} className="h-4 w-4 text-slate-400"/>}</td><td>{row.documentStatus&&DOC_ALERTS.has(row.documentStatus)?<span className="hr-pill hr-pill--warn">{c.documentAlertAction}</span>:<span className="text-slate-400">—</span>}</td><td className="max-w-[14rem] text-slate-600">{data?.access.hr?primaryAttention(row,language):"—"}</td><td><Link href={href(row)} className="table-action-secondary whitespace-nowrap">{c.view}</Link></td></tr>)}</tbody></table></div>
      <div className="divide-y divide-slate-100 md:hidden">{localPageRows.map(row=><article key={`${row.kind}:${row.id}`} className="cursor-pointer p-3.5" onClick={event=>{if(!(event.target as HTMLElement).closest("a,button"))router.push(href(row));}}><div className="flex items-start justify-between gap-3"><Link href={href(row)} className="text-base font-semibold text-slate-950">{row.name}</Link><span className={statusPill(row.employmentStatus)} title={hrStatus(language,row.employmentStatus)}>{row.employmentStatus==="not_recorded"?"—":hrStatus(language,row.employmentStatus)}</span></div>{row.employeeNumber?<p className="mt-1 text-xs text-slate-500">{row.employeeNumber}</p>:null}<p className="mt-2 text-sm text-slate-600">{row.vehicle?.registration??(row.kind==="employee"?c.officeEmployee:c.notRecorded)} · {row.jobRole??(row.vehicle?.type?hrVehicleType(language,row.vehicle.type):"—")}</p>{row.documentStatus&&row.documentStatus!=="not_recorded"?<p className="mt-2 text-xs text-slate-500">{c.licence}: {hrStatus(language,row.documentStatus)}</p>:null}{row.awayToday?<p className="mt-2 text-xs text-amber-700">{p.away}</p>:null}<p className="mt-2 text-xs text-slate-500">{c.nextAction}: {primaryAttention(row,language)}</p><Link href={href(row)} className="mt-3 inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-violet-700">{c.view}<ArrowRight className="h-4 w-4"/></Link></article>)}</div>
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-3 py-3 text-sm text-slate-500"><p>{c.page} {page} {c.of} {Math.max(1,Math.ceil(displayTotal/25))} · {formatCount(language,displayTotal)}</p><div className="flex gap-2"><button type="button" className="btn-secondary" disabled={page===1||loading} onClick={()=>setPage(value=>value-1)}>{c.previous}</button><button type="button" className="btn-secondary" disabled={page*25>=displayTotal||loading} onClick={()=>setPage(value=>value+1)}>{c.next}</button></div></footer>
    </section>
    {create?<HRDialog title={create==="employee"?c.newEmployee:c.newDriver} language={language} busy={mutation.busy} onClose={()=>setCreate(null)} onSubmit={()=>void saveCreate()} error={mutation.error}><HRFields fields={fields} values={draft} disabled={mutation.busy} onChange={(key,value)=>setDraft(current=>({...current,[key]:value}))}/></HRDialog>:null}
  </div></HRPage>;
}
