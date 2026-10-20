"use client";
import Link from "next/link";
import { useCallback,useEffect,useRef,useState } from "react";
import { Users,UserCheck,CalendarDays,CalendarClock,Search,Plus,Download,RefreshCw,LockKeyhole,ArrowRight } from "lucide-react";
import { EESLogo } from "@/components/ees-logo";
import { useLanguage } from "@/lib/language-provider";
import {subscribeHRSession} from "@/lib/ees-hr-session";
import { supabase } from "@/lib/supabase";
import { hrRequest } from "@/lib/ees-hr-v7-client";
import { hrVehicleType } from "@/lib/ees-hr-v7-vehicle-label";
import { hrCopy,hrErrorMessage,hrStatus } from "@/lib/ees-hr-v7-copy";
import {peopleCopy} from "@/lib/ees-people-copy";
import {HRPage} from "./hr-page";
import { useRouter } from "next/navigation";
import { safeDirectoryExport,type HRDirectory,type DirectoryEmployee } from "@/lib/ees-hr-v7-types";
import { HRDate,HRDialog,HRFields,HRNotice,useHRMutation,type HRField } from "./hr-ui";

export function EmployeeDirectory() {
  const {language}=useLanguage();const c=hrCopy(language);
  const router=useRouter(),p=peopleCopy(language);
  const [role,setRole]=useState("all");
  const [data,setData]=useState<HRDirectory|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState<string|null>(null);
  const [search,setSearch]=useState(""),[query,setQuery]=useState(""),[status,setStatus]=useState("all"),[vehicleType,setVehicleType]=useState("all"),[sort,setSort]=useState("name-asc"),[page,setPage]=useState(1);
  const [create,setCreate]=useState<"employee"|"driver"|null>(null),[draft,setDraft]=useState<Record<string,unknown>>({});const generation=useRef(0);
  const [kind,setKind]=useState("all");
  const invalidate=useCallback(()=>{generation.current++;},[]);
  useEffect(()=>{const timer=setTimeout(()=>{setQuery(search);setPage(1);},250);return()=>clearTimeout(timer);},[search]);
  const load=useCallback(async()=>{const seq=++generation.current;setLoading(true);setError(null);try{
    const result=await hrRequest<HRDirectory>("directory",{method:"POST",body:JSON.stringify({search:query,status,vehicleType,sort,page,size:25,kind,role})});
    if(generation.current===seq)setData(result);
  }catch(error){if(generation.current===seq)setError(hrErrorMessage(language,error));throw error;}finally{if(generation.current===seq)setLoading(false);}},[language,page,query,sort,status,vehicleType,kind,role]);
  useEffect(()=>{void load().catch(()=>{});return invalidate;},[load,invalidate]);
  useEffect(()=>{const refresh=()=>{void load().catch(()=>{});};window.addEventListener("focus",refresh);window.addEventListener("ees:hr-changed",refresh);const unsubscribe=subscribeHRSession(supabase.auth,refresh,()=>{generation.current++;setData(null);});return()=>{window.removeEventListener("focus",refresh);window.removeEventListener("ees:hr-changed",refresh);unsubscribe();};},[load]);
  const mutation=useHRMutation(language,load);
  const openCreate=(kind:"employee"|"driver")=>{mutation.clear();setDraft(kind==="employee"?{preferredName:"",employmentStatus:"not_recorded",statusReason:""}:{name:"",active:true});setCreate(kind);};
  const saveCreate=async()=>{const result=await mutation.run(create==="driver"?"save_driver":"save_employee",draft);if(result)setCreate(null);};
  const href=(row:DirectoryEmployee)=>row.kind==="driver"?`/drivers/${row.id}`:`/employees/${row.id}`;
  const summary=data?.summary;
  const cards=[{label:c.total,value:summary?.total,icon:Users,detail:""},{label:c.active,value:summary?.activeEmployees,icon:UserCheck,detail:summary?`${summary.activeDrivers} ${c.activeDriverRecords}`:""},{label:p.away,value:summary?.awayToday,icon:CalendarDays,detail:data&&!data.access.hr?c.hrOnly:""},{label:p.actions,value:summary?.actionsDue??summary?.followupsDue,icon:CalendarClock,detail:data&&!data.access.hr?c.hrOnly:""}];
  const vehicleTypes=data?.vehicleTypes??[...new Set((data?.rows??[]).map(row=>row.vehicle?.type).filter((type):type is string=>Boolean(type)))];
  const fields:HRField[]=create==="driver"?[{key:"name",label:c.displayName,required:true}]:[
    {key:"preferredName",label:c.displayName,required:true},{key:"employeeNumber",label:c.employeeNumber,help:c.employeeCodeHelp},
    {key:"jobRole",label:c.jobRole},{key:"department",label:c.department},
    {key:"employmentStatus",label:c.status,type:"select",options:["not_recorded","active","on_leave","left"].map(value=>({value,label:hrStatus(language,value)}))},
    {key:"startDate",label:c.startDate,type:"date"},{key:"endDate",label:c.endDate,type:"date"},{key:"statusReason",label:c.statusReason,required:true,type:"textarea"}];
  return <HRPage><div className="ees-driver-directory space-y-4">
    <header className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-violet-100 bg-white/90 p-5 shadow-sm">
      <div className="flex min-w-0 items-center gap-3"><EESLogo className="h-10 w-10"/><div><h1 className="text-xl font-bold text-slate-950 sm:text-2xl">{c.title}</h1><p className="mt-1 text-sm text-slate-500">{c.subtitle}</p></div></div>
      <div className="flex flex-wrap gap-2">{data?.access.admin?<Link href="/hr/settings" className="btn-secondary">{c.managerAccess}</Link>:null}
        {data?.access.hr&&data.access.ready?<button type="button" className="btn-primary gap-2" onClick={()=>openCreate("employee")}><Plus className="h-4 w-4"/>{c.newEmployee}</button>:null}
        {data?.access.operate&&data.access.ready?<button type="button" className="btn-secondary" onClick={()=>openCreate("driver")}>{c.newDriver}</button>:null}
      </div>
    </header>
    {data&&!data.access.ready?<HRNotice><strong>{c.setup}</strong> — {c.setupDescription}</HRNotice>:null}
    {error?<HRNotice error>{error}</HRNotice>:null}{mutation.notice?<HRNotice>{mutation.notice}</HRNotice>:null}
    <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label={c.overview}>{cards.map(card=><div key={card.label} className="rounded-xl border border-violet-100 bg-white p-4 shadow-sm"><div className="flex items-center justify-between gap-2"><p className="text-sm font-medium text-slate-600">{card.label}</p><card.icon className="h-4 w-4 shrink-0 text-violet-600"/></div><p className="mt-2 text-2xl font-bold text-slate-950">{card.value==null?"—":new Intl.NumberFormat(language==="th"?"th-TH":"en-GB").format(card.value)}</p>{card.detail?<p className="mt-1 text-xs text-slate-500">{card.detail}</p>:null}{card.label===c.active&&summary?.unrecordedEmployment?<p className="mt-1 text-xs text-slate-400">{summary.unrecordedEmployment} · {p.unrecorded}</p>:null}</div>)}</section>
    <section className="overflow-hidden rounded-2xl border border-violet-100 bg-white shadow-sm">
      <div className="flex flex-wrap gap-2 border-b border-slate-100 p-4"><label className="relative min-w-[180px] flex-1"><Search className="absolute left-3 top-3 h-4 w-4 text-slate-400"/><input type="search" aria-label={c.search} placeholder={c.search} value={search} onChange={event=>setSearch(event.target.value)} className="form-input w-full pl-9"/></label>
        <select aria-label={c.staff} value={kind} onChange={event=>{setKind(event.target.value);setPage(1);}} className="form-input !w-auto max-w-full bg-white"><option value="all">{c.all}</option><option value="driver">{c.newDriver}</option><option value="employee">{c.officeEmployee}</option></select>
        <select aria-label={c.status} value={status} onChange={event=>{setStatus(event.target.value);setPage(1);}} className="form-input !w-auto max-w-full bg-white"><option value="all">{c.all}</option>{["active","on_leave","left","not_recorded"].map(value=><option key={value} value={value}>{hrStatus(language,value)}</option>)}</select>
        <select aria-label={p.role} value={role} onChange={event=>{setRole(event.target.value);setPage(1);}} className="form-input !w-auto max-w-full bg-white"><option value="all">{p.role}: {c.all}</option>{(data?.roles??[]).map(value=><option key={value} value={value}>{value}</option>)}</select>
        <select aria-label={c.vehicleType} value={vehicleType} onChange={event=>{setVehicleType(event.target.value);setPage(1);}} className="form-input !w-auto max-w-full bg-white"><option value="all">{c.allTypes}</option>{vehicleTypes.map(type=><option key={type} value={type}>{hrVehicleType(language,type)}</option>)}</select>
        <select aria-label={c.name} value={sort} onChange={event=>{setSort(event.target.value);setPage(1);}} className="form-input !w-auto max-w-full bg-white">{[["name-asc",c.nameAsc],["name-desc",c.nameDesc],["vehicle",c.sortVehicle],["role",c.sortRole]].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>
        <button type="button" className="btn-secondary" aria-label={c.refresh} onClick={()=>void load().catch(()=>{})} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading?"animate-spin":""}`}/></button>
        <button type="button" className="btn-secondary gap-2" disabled={!data?.rows.length} onClick={()=>void import("@/lib/export").then(({exportToXlsx})=>exportToXlsx(safeDirectoryExport(data?.rows??[]),"EES-Employee-Directory")).catch(cause=>setError(hrErrorMessage(language,cause)))}><Download className="h-4 w-4"/>{p.exportPage}</button>
      </div>
      {loading&&!data?<p role="status" className="p-6 text-sm text-slate-500">{c.loading}</p>:null}
      {data&&!data.rows.length?<div className="p-8 text-center"><h2 className="font-semibold text-slate-900">{c.empty}</h2><p className="mt-2 text-sm text-slate-500">{c.emptyDescription}</p></div>:null}
      <div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[960px] text-left text-sm"><thead className="bg-slate-50/70 text-slate-600"><tr>{[c.name,c.status,c.vehicle,c.vehicleType,c.jobRole,c.documents,c.nextFollowup,""].map((label,index)=><th key={index} className="px-4 py-3 font-semibold">{label}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{data?.rows.map(row=><tr key={`${row.kind}:${row.id}`} className="cursor-pointer hover:bg-violet-50/40" onClick={event=>{if(!(event.target as HTMLElement).closest("a,button"))router.push(href(row));}}><td className="px-4 py-3"><Link href={href(row)} className="font-semibold text-slate-950 hover:text-violet-700">{row.name}</Link>{row.employeeNumber?<p className="mt-1 text-xs text-slate-500">{row.employeeNumber}</p>:null}</td><td className="px-4 py-3"><span className={row.employmentStatus==="not_recorded"?"text-slate-400":"text-slate-700"} title={hrStatus(language,row.employmentStatus)}>{row.employmentStatus==="not_recorded"?"—":hrStatus(language,row.employmentStatus)}</span>{row.awayToday?<p className="mt-1 text-xs text-amber-700">{p.away}</p>:null}</td><td className="px-4 py-3 font-medium">{row.vehicle?.registration??"—"}</td><td className="px-4 py-3">{row.vehicle?.type?hrVehicleType(language,row.vehicle.type):"—"}</td><td className="px-4 py-3">{row.jobRole??"—"}</td><td className="px-4 py-3">{row.documentStatus?row.documentStatus==="not_recorded"?<span className="text-slate-400" title={hrStatus(language,row.documentStatus)}>—</span>:hrStatus(language,row.documentStatus):<LockKeyhole aria-label={c.hrOnly} className="h-4 w-4 text-slate-400"/>}</td><td className="px-4 py-3">{data.access.hr?<HRDate value={row.nextFollowup} language={language}/>:"—"}</td><td className="px-4 py-3"><Link href={href(row)} className="table-action-secondary whitespace-nowrap">{c.view}</Link></td></tr>)}</tbody></table></div>
      <div className="divide-y divide-slate-100 md:hidden">{data?.rows.map(row=><article key={`${row.kind}:${row.id}`} className="cursor-pointer p-4" onClick={event=>{if(!(event.target as HTMLElement).closest("a,button"))router.push(href(row));}}><div className="flex items-start justify-between gap-3"><Link href={href(row)} className="text-base font-semibold text-slate-950">{row.name}</Link><span title={hrStatus(language,row.employmentStatus)} className={row.employmentStatus==="not_recorded"?"text-xs text-slate-400":"rounded-full bg-violet-50 px-2 py-1 text-xs text-violet-800"}>{row.employmentStatus==="not_recorded"?"—":hrStatus(language,row.employmentStatus)}</span></div><p className="mt-2 text-sm text-slate-600">{row.vehicle?.registration??(row.kind==="employee"?c.officeEmployee:c.notRecorded)} · {row.jobRole??row.vehicle?.type??"—"}</p>{row.documentStatus&&row.documentStatus!=="not_recorded"?<p className="mt-2 text-xs text-slate-500">{c.licence}: {hrStatus(language,row.documentStatus)}</p>:null}{row.awayToday?<p className="mt-2 text-xs text-amber-700">{p.away}</p>:null}<Link href={href(row)} className="mt-3 inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-violet-700">{c.view}<ArrowRight className="h-4 w-4"/></Link></article>)}</div>
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 p-4 text-sm text-slate-500"><p>{c.page} {page} {c.of} {Math.max(1,Math.ceil((data?.total??0)/25))}</p><div className="flex gap-2"><button type="button" className="btn-secondary" disabled={page===1||loading} onClick={()=>setPage(value=>value-1)}>{c.previous}</button><button type="button" className="btn-secondary" disabled={page*25>=(data?.total??0)||loading} onClick={()=>setPage(value=>value+1)}>{c.next}</button></div></footer>
    </section>
    {create?<HRDialog title={create==="employee"?c.newEmployee:c.newDriver} language={language} busy={mutation.busy} onClose={()=>setCreate(null)} onSubmit={()=>void saveCreate()} error={mutation.error}><HRFields fields={fields} values={draft} disabled={mutation.busy} onChange={(key,value)=>setDraft(current=>({...current,[key]:value}))}/></HRDialog>:null}
  </div></HRPage>;
}




