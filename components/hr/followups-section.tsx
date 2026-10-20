"use client";
import { useCallback,useEffect,useRef,useState } from "react";
import {HRPage} from "./hr-page";
import {subscribeHRSession} from "@/lib/ees-hr-session";
import { supabase } from "@/lib/supabase";
import { hrRequest } from "@/lib/ees-hr-v7-client";
import { hrCopy,hrErrorMessage } from "@/lib/ees-hr-v7-copy";
import { bangkokToday,followupStatus,type HRFollowup,type HRLanguage,type HRProfile } from "@/lib/ees-hr-v7-types";
import { HRDate,HRDialog,HRFields,HRNotice,useHRMutation } from "./hr-ui";

export function FollowupList({rows,language,reload,parent}:{rows:HRFollowup[];language:HRLanguage;reload:()=>Promise<void>;parent?:{driverId:string|null;employeeId:string|null}}) {
  const c=hrCopy(language);const mutation=useHRMutation(language,reload);const [form,setForm]=useState<{kind:"new"|"complete"|"reopen";id?:string}|null>(null),[values,setValues]=useState<Record<string,unknown>>({}),[staff,setStaff]=useState<{id:string;name:string}[]>([]),[lookupError,setLookupError]=useState<string|null>(null);
  const open=(kind:"new"|"complete"|"reopen",id?:string)=>{mutation.clear();setValues(kind==="new"?{dueDate:bangkokToday(),requiredAction:"",responsibleId:""}:{outcome:""});setForm({kind,id});
    setLookupError(null);if(kind==="new")void hrRequest<{id:string;name:string}[]>("lookups/responsible").then(setStaff).catch(cause=>{setStaff([]);setLookupError(hrErrorMessage(language,cause));});};
  const save=async()=>{if(!form)return;const result=await mutation.run(form.kind==="new"?"save_followup":form.kind==="complete"?"complete_followup":"reopen_followup",form.kind==="new"?{...parent,...values}:{id:form.id,...values});if(result)setForm(null);};
  return <div className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-bold text-slate-950">{c.followups}</h2>{parent?<button type="button" className="btn-primary" onClick={()=>open("new")}>{c.newFollowup}</button>:null}</div><p className="text-sm text-slate-500">{c.followupIndependent}</p>
    {mutation.notice?<HRNotice>{mutation.notice}</HRNotice>:null}{mutation.error&&!form?<HRNotice error>{mutation.error}</HRNotice>:null}
    {!rows.length?<p className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">{c.noFollowups}</p>:rows.map(row=>{const status=followupStatus(row);return <article key={row.id} className="rounded-xl border border-violet-100 bg-white p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-semibold text-slate-950">{row.employee_name}</p><p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{row.required_action}</p></div><span className={`rounded-full px-3 py-1 text-xs font-semibold ${status==="overdue"?"bg-rose-50 text-rose-700":status==="completed"?"bg-slate-100 text-slate-600":"bg-violet-50 text-violet-800"}`}>{c[status]}</span></div>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3"><div><dt className="text-slate-500">{c.dueDate}</dt><dd className="mt-1 font-medium"><HRDate value={row.due_date} language={language}/></dd></div><div><dt className="text-slate-500">{c.responsible}</dt><dd className="mt-1 font-medium">{row.responsible_name??c.notRecorded}</dd></div><div><dt className="text-slate-500">{c.completed}</dt><dd className="mt-1"><HRDate value={row.completed_at} language={language} time/></dd></div></dl>
      {row.outcome_notes?<p className="mt-4 whitespace-pre-wrap text-sm text-slate-700">{c.outcome}: {row.outcome_notes}</p>:null}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><details className="text-sm"><summary className="cursor-pointer font-semibold text-violet-700">{c.eventHistory}</summary><ol className="mt-3 space-y-2">{row.events?.map(event=><li key={event.id}><span className="font-medium">{event.action==="complete_followup"?c.completed:event.action==="reopen_followup"?c.reopen:c.upcoming}</span> · <HRDate value={event.recorded_at} language={language} time/>{event.outcome_notes?<p className="mt-1 whitespace-pre-wrap text-slate-600">{event.outcome_notes}</p>:null}</li>)}</ol></details><button type="button" className="btn-secondary" disabled={mutation.busy} onClick={()=>open(row.completed_at?"reopen":"complete",row.id)}>{row.completed_at?c.reopen:c.complete}</button></div>
    </article>;})}
    {form?<HRDialog title={form.kind==="new"?c.newFollowup:form.kind==="complete"?c.complete:c.reopen} language={language} busy={mutation.busy} error={mutation.error} onClose={()=>setForm(null)} onSubmit={()=>void save()}>
      {lookupError?<HRNotice error>{lookupError}</HRNotice>:null}<HRFields values={values} disabled={mutation.busy} onChange={(key,value)=>setValues(current=>({...current,[key]:value}))} fields={form.kind==="new"?[
        {key:"dueDate",label:c.dueDate,type:"date",required:true},{key:"responsibleId",label:c.responsible,type:"select",options:[{value:"",label:c.notRecorded},...staff.map(person=>({value:person.id,label:person.name}))]},
        {key:"requiredAction",label:c.requiredAction,type:"textarea",required:true}]:[{key:"outcome",label:c.outcome,type:"textarea",required:true}]}/>
    </HRDialog>:null}
  </div>;
}
export function ProfileFollowups({model,language,reload}:{model:HRProfile;language:HRLanguage;reload:()=>Promise<void>}) {
  const c=hrCopy(language),[page,setPage]=useState(1),[extra,setExtra]=useState<HRFollowup[]>([]),[error,setError]=useState<string|null>(null),[loading,setLoading]=useState(false);
  const generation=useRef(0),invalidate=useCallback(()=>{generation.current++;},[]);
  const fetchPage=useCallback(async()=>{if(page===1)return;const seq=++generation.current;setLoading(true);setError(null);try{const query=new URLSearchParams({page:String(page),...(model.employee.driverId?{driverId:model.employee.driverId}:{employeeId:model.employee.employeeId!})});const result=await hrRequest<{rows:HRFollowup[]}>(`followups?${query}`);if(seq===generation.current)setExtra(result.rows);}catch(cause){if(seq===generation.current)setError(hrErrorMessage(language,cause));throw cause;}finally{if(seq===generation.current)setLoading(false);}},[page,model.employee.driverId,model.employee.employeeId,language]);
  useEffect(()=>{setExtra([]);void fetchPage().catch(()=>{});return invalidate;},[fetchPage,invalidate]);
  const refresh=async()=>{await reload();await fetchPage();};
  return <div className="space-y-4">{error?<HRNotice error>{error}</HRNotice>:null}{loading?<p role="status">{c.loading}</p>:<FollowupList rows={page===1?(model.data.rows??[]) as HRFollowup[]:extra} language={language} reload={refresh} parent={{driverId:model.employee.driverId,employeeId:model.employee.employeeId}}/>}<div className="flex items-center justify-end gap-2 text-sm"><span>{c.page} {page} / {Math.max(1,Math.ceil(Number(model.data.total??0)/25))}</span><button className="btn-secondary" disabled={page===1||loading} onClick={()=>setPage(value=>value-1)}>{c.previous}</button><button className="btn-secondary" disabled={page*25>=Number(model.data.total??0)||loading} onClick={()=>setPage(value=>value+1)}>{c.next}</button></div></div>;
}
export function CentralFollowups({language}:{language:HRLanguage}) {
  const c=hrCopy(language);const [rows,setRows]=useState<HRFollowup[]>([]),[status,setStatus]=useState("all"),[page,setPage]=useState(1),[total,setTotal]=useState(0),[error,setError]=useState<string|null>(null),[loading,setLoading]=useState(true);
  const generation=useRef(0),invalidate=useCallback(()=>{generation.current++;},[]);
  const load=useCallback(async()=>{const seq=++generation.current;setLoading(true);setError(null);try{const result=await hrRequest<{rows:HRFollowup[];total:number}>(`followups?status=${status}&page=${page}`);if(seq!==generation.current)return;setRows(result.rows);setTotal(result.total);}catch(error){if(seq===generation.current){setRows([]);setError(hrErrorMessage(language,error));}throw error;}finally{if(seq===generation.current)setLoading(false);}},[language,page,status]);
  useEffect(()=>{void load().catch(()=>{});return invalidate;},[load,invalidate]);
  useEffect(()=>{return subscribeHRSession(supabase.auth,()=>void load().catch(()=>{}),()=>{invalidate();setRows([]);});},[load,invalidate]);
  return <HRPage><header className="flex flex-wrap items-center justify-between gap-4"><h1 className="text-2xl font-bold text-slate-950">{c.followups}</h1><select value={status} aria-label={c.status} className="form-input bg-white" onChange={event=>{setStatus(event.target.value);setPage(1);}}>{["all","upcoming","due_today","overdue","completed"].map(value=><option key={value} value={value}>{c[value as keyof typeof c]}</option>)}</select></header>
    {error?<HRNotice error>{error}</HRNotice>:null}{loading?<p role="status" className="text-sm text-slate-500">{c.loading}</p>:!error?<FollowupList rows={rows} language={language} reload={load}/>:null}
    <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" disabled={page===1||loading} onClick={()=>setPage(value=>value-1)}>{c.previous}</button><button type="button" className="btn-secondary" disabled={page*25>=total||loading} onClick={()=>setPage(value=>value+1)}>{c.next}</button></div>
  </HRPage>;
}
