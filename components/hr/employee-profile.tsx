"use client";
import Link from "next/link";
import { useCallback,useEffect,useRef,useState } from "react";
import { ArrowLeft,RefreshCw } from "lucide-react";
import { useLanguage } from "@/lib/language-provider";
import {subscribeHRSession} from "@/lib/ees-hr-session";
import { supabase } from "@/lib/supabase";
import { hrRequest,invalidateHRReads,profilePath } from "@/lib/ees-hr-v7-client";
import { hrCopy,hrErrorMessage,hrStatus } from "@/lib/ees-hr-v7-copy";
import { HRV7Error,type EmployeeRef,type HRProfile,type ProfileSection } from "@/lib/ees-hr-v7-types";
import {CaseSection} from "./case-section";
import {peopleCopy,peopleLabel} from "@/lib/ees-people-copy";
import {HRDate} from "./hr-ui";
import { PersonnelSection } from "./personnel-section";
import { AssignmentSection } from "./assignment-section";
import { MeetingsSection } from "./meetings-section";
import { ProfileFollowups } from "./followups-section";
import { TrainingSection } from "./training-section";
import { DocumentsSection } from "./documents-section";
import { HRNotice,HRRestricted,HRDialog,HRFields,useHRMutation } from "./hr-ui";

const sections:ProfileSection[]=["overview","personnel","absences","incidents","documents","assignments","meetings","followups","training"];
export function EmployeeProfile({employeeRef}:{employeeRef:EmployeeRef}) {
  const {language}=useLanguage(),c=hrCopy(language),p=peopleCopy(language);
  const [section,setSection]=useState<ProfileSection>("overview"),[model,setModel]=useState<HRProfile|null>(null),[error,setError]=useState<string|null>(null),[loading,setLoading]=useState(true);
  const generation=useRef(0),scope=employeeRef.kind+":"+employeeRef.id;
  const languageRef=useRef(language);languageRef.current=language;
  const invalidate=useCallback(()=>{generation.current++;},[]);
  const dirty=useRef(false);const trackDirty=useCallback((value:boolean)=>{dirty.current=value;},[]);
  const [saving,setSaving]=useState(false);
  const allowLeave=()=>!saving&&(!dirty.current||window.confirm(language==="th"?"มีข้อมูลที่ยังไม่ได้บันทึก ต้องการออกจากส่วนนี้หรือไม่?":"You have unsaved changes. Leave this section?"));
  const [edit,setEdit]=useState(false),[draft,setDraft]=useState<Record<string,unknown>>({});
  useEffect(()=>{const requested=new URLSearchParams(window.location.search).get("section");if(sections.includes(requested as ProfileSection))setSection(requested as ProfileSection);},[]);
  const [linking,setLinking]=useState(false),[candidates,setCandidates]=useState<{id:string;name:string}[]>([]),[linkId,setLinkId]=useState("");
  const load=useCallback(async()=>{
    const seq=++generation.current;setLoading(true);setError(null);
    try{const fresh=await hrRequest<HRProfile>(profilePath({kind:employeeRef.kind,id:employeeRef.id},section));
      if(seq!==generation.current)throw new HRV7Error("HR_SAVE_UNVERIFIED",409);setModel(fresh);
    }catch(cause){if(seq===generation.current)setError(hrErrorMessage(languageRef.current,cause));throw cause;}
    finally{if(seq===generation.current)setLoading(false);}
  },[employeeRef.kind,employeeRef.id,section]);
  useEffect(()=>{setModel(null);void load().catch(()=>{});return invalidate;},[load,invalidate]);
  useEffect(()=>{return subscribeHRSession(supabase.auth,()=>void load().catch(()=>{}),()=>{generation.current++;invalidateHRReads();setModel(null);});},[load]);
  const mutation=useHRMutation(language,load);
  const labels:Record<ProfileSection,string>={absences:p.absences,incidents:p.incidents,overview:c.overview,personnel:c.personnel,assignments:c.history,meetings:c.meetings,documents:c.documents,followups:c.followups,training:c.training};
  const employee=model?.employee;
  const personal=model?.data.private as Record<string,unknown>|null;
  const startLink=async()=>{try{setCandidates(await hrRequest<{id:string;name:string}[]>("lookups/unlinked_drivers"));setLinkId("");mutation.clear();setLinking(true);}catch(cause){setError(hrErrorMessage(language,cause));}};
  const privateSection=["absences","incidents","personnel","meetings","documents","followups"].includes(section);
  return <main className="mx-auto w-full max-w-6xl space-y-4 py-3 sm:py-4">
    <Link href="/hr" onClick={event=>{if(!allowLeave())event.preventDefault();}} className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-violet-700"><ArrowLeft className="h-4 w-4"/>{c.back}</Link>
    <header className="rounded-2xl border border-violet-100 bg-white p-5 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold tracking-widest text-violet-600">EES PEOPLE & HR</p><h1 className="mt-2 break-words text-2xl font-bold text-slate-950">{employee?.name??(loading?c.loading:c.notRecorded)}</h1>{employee?<p className="mt-2 text-sm text-slate-600">{hrStatus(language,employee.employmentStatus)} · {employee.jobRole??c.notRecorded} · {employee.department??c.notRecorded}</p>:null}</div><div className="flex gap-2"><button className="btn-secondary" aria-label={c.refresh} disabled={loading||saving} onClick={()=>{invalidateHRReads();void load().catch(()=>{});}}><RefreshCw className="h-4 w-4"/></button>{employee?.driverId&&model?.access.operate?<button className="btn-secondary" onClick={()=>{mutation.clear();setDraft({name:employee.name,active:employee.operationalActive===true});setEdit(true);}}>{c.editDriver}</button>:null}</div></div>
      {employee?<dl className="mt-4 grid gap-3 border-t border-slate-100 pt-4 text-sm sm:grid-cols-3"><div><dt className="text-slate-500">{c.employeeNumber}</dt><dd className="mt-1 font-semibold">{employee.employeeNumber??c.notRecorded}</dd></div><div><dt className="text-slate-500">{c.vehicle}</dt><dd className="mt-1 font-semibold">{employee.vehicle?.registration??(employee.driverId?c.notRecorded:c.officeEmployee)}</dd></div><div><dt className="text-slate-500">{c.licenceReview}</dt><dd className="mt-1">{employee.documentStatus?hrStatus(language,employee.documentStatus):c.hrOnly}</dd></div></dl>:null}
    </header>
    <nav aria-label={c.overview} className="flex gap-1 overflow-x-auto rounded-xl bg-violet-50 p-1.5">{sections.map(tab=><button key={tab} type="button" aria-current={section===tab?"page":undefined} onClick={()=>{if(tab!==section&&allowLeave())setSection(tab);}} className={`min-h-10 shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold ${section===tab?"bg-violet-700 text-white":"text-violet-900 hover:bg-white"}`}>{labels[tab]}</button>)}</nav>
    {error?<HRNotice error>{error}</HRNotice>:null}{loading?<p role="status" className="text-sm text-slate-500">{c.loading}</p>:null}
    {model&&model.section===section?<div key={scope}>
      {privateSection&&!model.access.hr?<HRRestricted language={language}/>:null}
      {section==="overview"?<section className="space-y-3 rounded-xl bg-white p-5"><h2 className="text-lg font-bold">{c.overview}</h2>{model.access.hr?<dl className="grid gap-3 text-sm sm:grid-cols-2">{[[c.legalNameTh,personal?.legal_name_th],[c.englishName,personal?.english_name]].map(([label,value])=><div key={String(label)}><dt className="text-slate-500">{String(label)}</dt><dd className="mt-1 font-medium">{String(value??c.notRecorded)}</dd></div>)}</dl>:null}{employee?.profileCompleteness?<p className="text-sm font-semibold text-violet-700">{language==="th"?"ข้อมูลที่บันทึก":"Profile information recorded"}: {employee.profileCompleteness.recorded} / {employee.profileCompleteness.total}</p>:null}<p className="text-sm text-slate-600">{employee?.employeeId?c.returnCompleted:c.personalMissing}</p>{!employee?.driverId?<p className="text-sm text-slate-600">{c.noDriverLink}</p>:null}{!employee?.driverId&&model.access.hr?<button className="btn-secondary" onClick={()=>void startLink()}>{c.linkDriver}</button>:null}{model.access.hr?<Link href="#personnel" onClick={event=>{event.preventDefault();setSection("personnel");}} className="inline-flex min-h-10 items-center font-semibold text-violet-700">{c.personnel}</Link>:null}{employee?.startDate?<p className="text-sm">{c.startDate}: <HRDate value={employee.startDate} language={language}/></p>:null}{employee?.awayToday?<p className="text-sm text-amber-700">{p.away}</p>:null}{employee?.nextFollowup?<p className="text-sm">{c.nextFollowup}: {employee.nextFollowup}</p>:null}</section>:null}
      {(section==="absences"||section==="incidents")&&model.access.hr?model.access.peopleReady?<CaseSection kind={section} model={model} language={language} reload={load}/>:<HRNotice>{p.setup}</HRNotice>:null}
      {section==="overview"&&model.access.hr&&model.access.peopleReady?<section className="rounded-xl border border-violet-100 bg-white p-4"><h2 className="font-bold">{p.timeline}</h2>{(model.data.timeline as {id:string;at:string;type:string;status:string}[]??[]).length?<ol className="mt-3 space-y-3">{(model.data.timeline as {id:string;at:string;type:string;status:string}[]).map(event=><li key={event.type+event.id} className="border-l-2 border-violet-200 pl-3 text-sm"><span className="font-semibold">{peopleLabel(language,event.type)}</span> · {peopleLabel(language,event.status)}<p className="mt-1 text-xs text-slate-500"><HRDate value={event.at} language={language} time/></p></li>)}</ol>:<p className="mt-2 text-sm text-slate-500">{p.empty}</p>}</section>:null}
      {section==="personnel"&&model.access.hr?<PersonnelSection model={model} language={language} reload={load} onDirty={trackDirty} onBusy={setSaving}/>:null}
      {section==="assignments"?(employee?.driverId&&model.access.operate?<AssignmentSection model={model} language={language} reload={load}/>:<HRNotice>{employee?.driverId?c.restricted:c.noDriverLink}</HRNotice>):null}
      {section==="meetings"&&model.access.hr?<MeetingsSection model={model} language={language} reload={load}/>:null}
      {section==="followups"&&model.access.hr?<ProfileFollowups model={model} language={language} reload={load}/>:null}
      {section==="training"?<TrainingSection model={model} language={language} reload={load}/>:null}
      {section==="documents"&&model.access.hr?<DocumentsSection model={model} language={language} reload={load}/>:null}
    </div>:null}
    {linking&&employee?<HRDialog title={c.linkDriver} language={language} busy={mutation.busy} error={mutation.error} onClose={()=>setLinking(false)} onSubmit={()=>void mutation.run("link_driver",{employeeId:employee.employeeId,linkDriverId:linkId}).then(result=>{if(result)setLinking(false);})}><p className="mb-4 text-sm">{c.identityLink}</p><HRFields values={{linkId}} onChange={(_key,value)=>setLinkId(String(value))} fields={[{key:"linkId",label:c.chooseDriver,type:"select",required:true,options:[{value:"",label:c.chooseDriver},...candidates.map(row=>({value:row.id,label:row.name}))]}]}/></HRDialog>:null}
    {edit&&employee?<HRDialog title={c.editDriver} language={language} busy={mutation.busy} error={mutation.error} onClose={()=>setEdit(false)} onSubmit={()=>void mutation.run("save_driver",{driverId:employee.driverId,...draft}).then(result=>{if(result)setEdit(false);})}><HRFields fields={[{key:"name",label:c.displayName,required:true},{key:"active",label:c.operationalActive,type:"checkbox"}]} values={draft} disabled={mutation.busy} onChange={(key,value)=>setDraft(current=>({...current,[key]:value}))}/></HRDialog>:null}
  </main>;
}



