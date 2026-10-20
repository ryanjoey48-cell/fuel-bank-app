"use client";
import { useCallback,useEffect,useRef,useState } from "react";
import {subscribeHRSession} from "@/lib/ees-hr-session";
import { supabase } from "@/lib/supabase";
import {HRPage} from "./hr-page";
import { useLanguage } from "@/lib/language-provider";
import { hrRequest } from "@/lib/ees-hr-v7-client";
import { hrCopy,hrErrorMessage } from "@/lib/ees-hr-v7-copy";
import type { HRAccess,HRMeetingV7 } from "@/lib/ees-hr-v7-types";
import { MeetingRecord } from "./meetings-section";
import { HRDate,HRDialog,HRFields,HRNotice,HRRestricted,useHRMutation } from "./hr-ui";
export function HRSettings(){
  const {language}=useLanguage(),c=hrCopy(language);
  const [access,setAccess]=useState<HRAccess|null>(null),[staff,setStaff]=useState<Record<string,unknown>[]>([]),[tests,setTests]=useState<Record<string,unknown>[]>([]),[error,setError]=useState<string|null>(null),[meeting,setMeeting]=useState<HRMeetingV7|null>(null),[selected,setSelected]=useState<Record<string,unknown>|null>(null),[draft,setDraft]=useState<Record<string,unknown>>({});
  const generation=useRef(0);
  const load=useCallback(async()=>{const seq=++generation.current;setError(null);try{const actor=await hrRequest<HRAccess>("access");if(seq!==generation.current)return;setAccess(actor);if(actor.admin){const [people,records]=await Promise.all([hrRequest<Record<string,unknown>[]>("lookups/staff"),hrRequest<Record<string,unknown>[]>("lookups/test_meetings")]);if(seq!==generation.current)return;setStaff(people);setTests(records);}else{setStaff([]);setTests([]);setMeeting(null);setSelected(null);}}catch(cause){if(seq===generation.current)setError(hrErrorMessage(language,cause));throw cause;}},[language]);
  useEffect(()=>{void load().catch(()=>{});},[load]);const mutation=useHRMutation(language,load);
  useEffect(()=>{return subscribeHRSession(supabase.auth,()=>void load().catch(()=>{}),()=>{generation.current++;setAccess(null);setStaff([]);setTests([]);setMeeting(null);setSelected(null);});},[load]);
  if(access&&!access.admin)return <HRRestricted language={language}/>;
  return <HRPage><h1 className="text-xl font-bold">EES · {c.managerAccess}</h1>{error?<HRNotice error>{error}</HRNotice>:null}{mutation.notice?<HRNotice>{mutation.notice}</HRNotice>:null}
    <section className="rounded-xl bg-white p-5"><h2 className="font-bold">{c.managerAccess}</h2><p className="mt-2 text-sm text-slate-500">{c.noHRData}</p>{staff.map(row=><div key={String(row.id)} className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3"><span>{String(row.name)} · {row.manager?c.approvedManager:c.noManagerAccess}</span><button className="btn-secondary" onClick={()=>{mutation.clear();setSelected(row);setDraft({active:row.manager===true,allDrivers:row.driverIds==null,scope:Array.isArray(row.driverIds)?row.driverIds.join(","):""});}}>{c.manageAccess}</button></div>)}</section>
    <section className="rounded-xl bg-white p-5"><h2 className="font-bold">{c.testData}</h2><p className="mt-2 text-sm text-slate-500">{c.testWarning}</p>{tests.map(row=><article key={String(row.id)} className="mt-4 rounded-lg bg-slate-50 p-4"><strong>{String(row.name??"—")} · {String(row.subject)}</strong><p className="mt-2 break-all text-xs text-slate-500">{String(row.id)} · <HRDate value={String(row.date)} language={language}/></p><div className="mt-3 flex flex-wrap gap-2"><button className="btn-secondary" onClick={()=>void hrRequest<HRMeetingV7>(`meetings/${row.id}?allowTest=true`).then(setMeeting).catch(cause=>setError(hrErrorMessage(language,cause)))}>{c.openMeeting}</button>{!row.archivedAt?<button className="btn-secondary" disabled={mutation.busy} onClick={()=>{if(!window.confirm(c.archiveConfirm))return;const reason=window.prompt(c.reason);if(reason)void mutation.run("archive_test_meeting",{id:row.id,reason});}}>{c.archive}</button>:<span>{c.archive} · <HRDate value={String(row.archivedAt)} language={language}/></span>}</div></article>)}</section>
    {selected?<HRDialog title={c.managerAccess} language={language} busy={mutation.busy} error={mutation.error} onClose={()=>setSelected(null)} onSubmit={()=>{const driverIds=String(draft.scope??"").split(",").map(id=>id.trim()).filter(Boolean);void mutation.run("grant_manager",{userId:selected.id,active:draft.active,allDrivers:draft.allDrivers,driverIds}).then(result=>{if(result)setSelected(null);});}}><HRFields values={draft} disabled={mutation.busy} onChange={(key,value)=>setDraft(current=>({...current,[key]:value}))} fields={[{key:"active",label:c.approvedManager,type:"checkbox"},{key:"allDrivers",label:c.allDrivers,type:"checkbox"},...(!draft.allDrivers?[{key:"scope",label:c.driverScope,required:true}]:[])]}/></HRDialog>:null}
    {meeting?<HRDialog title={c.openMeeting} language={language} busy={false} onClose={()=>setMeeting(null)} onSubmit={()=>setMeeting(null)} saveLabel={c.close}><MeetingRecord meeting={meeting} language={language}/></HRDialog>:null}
  </HRPage>;
}

