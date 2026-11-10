"use client";
import Link from "next/link";
import { useCallback,useEffect,useRef,useState } from "react";
import { ArrowLeft,RefreshCw,ClipboardList } from "lucide-react";
import { useLanguage } from "@/lib/language-provider";
import {subscribeHRSession} from "@/lib/ees-hr-session";
import { supabase } from "@/lib/supabase";
import { hrRequest,invalidateHRReads,profilePath } from "@/lib/ees-hr-v7-client";
import { hrCopy,hrErrorMessage,hrStatus } from "@/lib/ees-hr-v7-copy";
import { hrVehicleType } from "@/lib/ees-hr-v7-vehicle-label";
import { hrV8Copy } from "@/lib/ees-hr-v8-copy";
import { actionableAttention, completenessFromProfile, onboardingStepsDone, primaryAttention } from "@/lib/ees-hr-attention";
import { HRV7Error,type EmployeeRef,type HRProfile,type ProfileSection } from "@/lib/ees-hr-v7-types";
import {CaseSection} from "./case-section";
import {peopleCopy,peopleLabel} from "@/lib/ees-people-copy";
import { HRDate } from "./hr-ui";
import { PersonnelSection } from "./personnel-section";
import { AssignmentSection } from "./assignment-section";
import { MeetingsSection } from "./meetings-section";
import { ProfileFollowups } from "./followups-section";
import { TrainingSection } from "./training-section";
import { DocumentsSection } from "./documents-section";
import { OnboardingPanel } from "./onboarding-panel";
import { HRNotice,HRRestricted,HRDialog,HRFields,useHRMutation } from "./hr-ui";

const sections:ProfileSection[]=["overview","personnel","absences","incidents","documents","assignments","meetings","followups","training"];
const peopleTabs=new Set<ProfileSection>(["absences","incidents"]);
const gateCodes=new Set(["HR_RELEASE_REQUIRED","HR_SETUP_REQUIRED"]);

function completenessLabel(language:"en"|"th",state:ReturnType<typeof completenessFromProfile>,v8:ReturnType<typeof hrV8Copy>){
  if(state==="recorded_verified")return v8.recordedVerified;
  if(state==="recorded_unverified")return v8.recordedUnverified;
  if(state==="missing")return v8.missing;
  if(state==="not_applicable")return v8.notApplicable;
  return v8.unableToDetermine;
}

export function EmployeeProfile({employeeRef}:{employeeRef:EmployeeRef}) {
  const {language}=useLanguage(),c=hrCopy(language),p=peopleCopy(language),v8=hrV8Copy(language);
  const [section,setSection]=useState<ProfileSection>("overview"),[model,setModel]=useState<HRProfile|null>(null),[error,setError]=useState<string|null>(null),[loading,setLoading]=useState(true);
  const [showOnboarding,setShowOnboarding]=useState(false);
  const generation=useRef(0),scope=employeeRef.kind+":"+employeeRef.id,identity=useRef<HRProfile|null>(null);
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
    const apply=(fresh:HRProfile,uiSection:ProfileSection)=>{const next={...fresh,section:uiSection};identity.current=next;setModel(next);};
    try{
      const fresh=await hrRequest<HRProfile>(profilePath({kind:employeeRef.kind,id:employeeRef.id},section));
      if(seq!==generation.current)throw new HRV7Error("HR_SAVE_UNVERIFIED",409);
      apply(fresh,section);
    }catch(cause){
      if(seq!==generation.current)return;
      const code=cause instanceof HRV7Error?cause.code:"";
      if(peopleTabs.has(section)){
        try{
          const shell=await hrRequest<HRProfile>(profilePath({kind:employeeRef.kind,id:employeeRef.id},"overview"));
          if(seq!==generation.current)return;
          apply(shell,section);
          setError(gateCodes.has(code)?null:hrErrorMessage(languageRef.current,cause));
          return;
        }catch{/* keep prior identity below */}
      }
      setError(hrErrorMessage(languageRef.current,cause));
      if(identity.current)setModel({...identity.current,section});
      throw cause;
    }finally{if(seq===generation.current)setLoading(false);}
  },[employeeRef.kind,employeeRef.id,section]);
  useEffect(()=>{void load().catch(()=>{});return invalidate;},[load,invalidate]);
  useEffect(()=>{return subscribeHRSession(supabase.auth,()=>void load().catch(()=>{}),()=>{generation.current++;invalidateHRReads();identity.current=null;setModel(null);});},[load]);
  const mutation=useHRMutation(language,load);
  const labels:Record<ProfileSection,string>={absences:p.absences,incidents:p.incidents,overview:c.overview,personnel:c.personnel,assignments:c.history,meetings:c.meetings,documents:c.documents,followups:c.followups,training:c.training};
  const employee=model?.employee;
  const personal=model?.data.private as Record<string,unknown>|null;
  const startLink=async()=>{try{setCandidates(await hrRequest<{id:string;name:string}[]>("lookups/unlinked_drivers"));setLinkId("");mutation.clear();setLinking(true);}catch(cause){setError(hrErrorMessage(language,cause));}};
  const privateSection=["absences","incidents","personnel","meetings","documents","followups"].includes(section);
  const sectionReady=Boolean(model&&(model.section===section||(peopleTabs.has(section)&&model.employee)));
  const completeState=completenessFromProfile(employee?.profileCompleteness?.recorded,employee?.profileCompleteness?.total);
  const needsOnboarding=Boolean(employee&&model?.access.hr&&(employee.employmentStatus==="not_recorded"||!employee.personnelRecorded||!employee.employeeNumber||!employee.jobRole));
  const openActions=employee?actionableAttention(employee):[];
  const onboardingDone=employee&&model?onboardingStepsDone(employee,model.data):0;
  const timelineRows=((model?.data.timeline as {id:string;at:string;type:string;status:string}[]|undefined)??[]).slice(0,8);
  useEffect(()=>{if(needsOnboarding)setShowOnboarding(true);},[needsOnboarding]);
  return <main className="hr-centre-workspace mx-auto w-full max-w-6xl space-y-3 py-2 sm:space-y-3 sm:py-3">
    <Link href="/hr" onClick={event=>{if(!allowLeave())event.preventDefault();}} className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-violet-700"><ArrowLeft className="h-4 w-4"/>{c.back}</Link>
    <header className="hr-panel p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-bold tracking-[0.16em] text-violet-700">EES PEOPLE & HR</p>
          <h1 className="mt-1 break-words text-xl font-bold text-slate-950 sm:text-2xl">{employee?.name??(loading&&!employee?c.loading:c.notRecorded)}</h1>
          {employee?<p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-600">
            <span className={employee.employmentStatus==="not_recorded"?"text-slate-400":"font-medium text-slate-800"}>{employee.employmentStatus==="not_recorded"?"—":hrStatus(language,employee.employmentStatus)}</span>
            <span aria-hidden>·</span>
            <span>{employee.jobRole??c.notRecorded}</span>
            {employee.employeeNumber?<><span aria-hidden>·</span><span className="tabular-nums">{employee.employeeNumber}</span></>:null}
          </p>:null}
          {employee&&model?.access.hr?<p className="mt-2 text-xs font-medium text-violet-800">{v8.completeness}: {employee.profileCompleteness?`${employee.profileCompleteness.recorded}/${employee.profileCompleteness.total} · ${completenessLabel(language,completeState,v8)}`:completenessLabel(language,"unknown",v8)} · {primaryAttention(employee,language)}</p>:null}
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary" aria-label={c.refresh} disabled={loading||saving} onClick={()=>{invalidateHRReads();void load().catch(()=>{});}}><RefreshCw className="h-4 w-4"/></button>
          {model?.access.hr?<button type="button" className="btn-secondary gap-2" onClick={()=>setShowOnboarding(value=>!value)}><ClipboardList className="h-4 w-4"/>{v8.startOnboarding}</button>:null}
          {employee?.driverId&&model?.access.operate?<button className="btn-secondary" onClick={()=>{mutation.clear();setDraft({name:employee.name,active:employee.operationalActive===true});setEdit(true);}}>{c.editDriver}</button>:null}
        </div>
      </div>
      {employee?<dl className="mt-3 grid gap-2 border-t border-slate-100 pt-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div><dt className="text-xs text-slate-500">{c.employeeNumber}</dt><dd className="mt-1 font-semibold">{employee.employeeNumber??c.notRecorded}</dd></div>
        <div><dt className="text-xs text-slate-500">{c.vehicle}</dt><dd className="mt-1 font-semibold">{employee.vehicle?.registration??(employee.driverId?c.notRecorded:c.officeEmployee)}</dd></div>
        <div><dt className="text-xs text-slate-500">{c.vehicleType}</dt><dd className="mt-1 font-semibold">{employee.vehicle?.type?hrVehicleType(language,employee.vehicle.type):c.notRecorded}</dd></div>
        <div><dt className="text-xs text-slate-500">{c.licenceReview}</dt><dd className="mt-1">{employee.documentStatus?hrStatus(language,employee.documentStatus):c.hrOnly}</dd></div>
      </dl>:null}
    </header>
    <nav aria-label={c.overview} className="hr-profile-tabs">{sections.map(tab=><button key={tab} type="button" aria-current={section===tab?"page":undefined} onClick={()=>{if(tab!==section&&allowLeave())setSection(tab);}}>{labels[tab]}</button>)}</nav>
    {error?<HRNotice error>{error}</HRNotice>:null}{loading&&!employee?<p role="status" className="text-sm text-slate-500">{c.loading}</p>:null}
    {showOnboarding&&model?.access.hr&&employee?<OnboardingPanel model={model} language={language} reload={load} onOpenSection={(target)=>{setShowOnboarding(false);setSection(target);}}/>:null}
    {sectionReady?<div key={scope+":"+section} className="space-y-3">
      {privateSection&&!model!.access.hr?<HRRestricted language={language}/>:null}
      {section==="overview"&&employee?<section className="hr-panel space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-slate-950">{v8.overviewWorking}</h2>
            <p className="mt-1 text-xs text-slate-500">{v8.overviewHelp}</p>
          </div>
          {model!.access.hr?<p className="text-sm font-semibold text-violet-700">{onboardingDone} / 8 {v8.onboardingOf}</p>:null}
        </div>
        <dl className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-slate-100 bg-slate-50/70 px-3 py-2"><dt className="text-xs text-slate-500">{c.status}</dt><dd className="mt-1 font-semibold">{employee.employmentStatus==="not_recorded"?"—":hrStatus(language,employee.employmentStatus)}</dd></div>
          <div className="rounded-lg border border-slate-100 bg-slate-50/70 px-3 py-2"><dt className="text-xs text-slate-500">{c.vehicle}</dt><dd className="mt-1 font-semibold">{employee.vehicle?.registration??(employee.driverId?c.notRecorded:c.officeEmployee)}</dd></div>
          <div className="rounded-lg border border-slate-100 bg-slate-50/70 px-3 py-2"><dt className="text-xs text-slate-500">{v8.licenceReadiness}</dt><dd className="mt-1 font-semibold">{employee.documentStatus?hrStatus(language,employee.documentStatus):(employee.kind==="employee"?v8.notApplicable:c.hrOnly)}</dd></div>
          <div className="rounded-lg border border-slate-100 bg-slate-50/70 px-3 py-2"><dt className="text-xs text-slate-500">{v8.documentReadiness}</dt><dd className="mt-1 font-semibold">{!model!.access.storageReady?v8.uploadDisabled:employee.documentStatus?hrStatus(language,employee.documentStatus):c.notRecorded}</dd></div>
        </dl>
        {model!.access.hr?<div className="rounded-lg border border-slate-100 px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-slate-950">{v8.openActions}</h3>
            <span className="text-xs text-slate-500">{primaryAttention(employee,language)}</span>
          </div>
          {openActions.length?<ul className="mt-2 grid gap-1.5 sm:grid-cols-2">{openActions.slice(0,6).map(item=>
            <li key={item.key} className="flex items-start gap-2 text-sm text-slate-700"><span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden/><span>{language==="th"?item.th:item.en}</span></li>
          )}</ul>:<p className="mt-2 text-sm text-slate-500">{v8.noOpenActions}</p>}
        </div>:null}
        {model!.access.hr?<dl className="grid gap-2 border-t border-slate-100 pt-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {[[c.legalNameTh,personal?.legal_name_th],[c.englishName,personal?.english_name],[c.telephone,personal?.telephone],[c.startDate,employee.startDate],[c.department,employee.department],[v8.linkedProfile,employee.personnelRecorded?v8.linkedProfile:c.personalMissing]].map(([label,value],index)=>
            <div key={index}><dt className="text-xs text-slate-500">{String(label)}</dt><dd className="mt-1 font-medium">{value==null||value===""?c.notRecorded:typeof value==="string"&&/^\d{4}-\d{2}-\d{2}/.test(value)?<HRDate value={value} language={language}/>:String(value)}</dd></div>
          )}
        </dl>:null}
        {employee.awayToday?<p className="text-sm font-medium text-amber-700">{p.away}</p>:null}
        {employee.nextFollowup?<p className="text-sm">{c.nextAction}: {c.nextFollowup} · {employee.nextFollowup}</p>:null}
        <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
          {!employee.driverId&&model!.access.hr?<button type="button" className="btn-secondary" onClick={()=>void startLink()}>{c.linkDriver}</button>:null}
          {model!.access.hr?<button type="button" className="btn-secondary" onClick={()=>setSection("personnel")}>{v8.jumpPersonnel}</button>:null}
          {model!.access.hr?<button type="button" className="btn-secondary" onClick={()=>setSection("documents")}>{v8.jumpDocuments}</button>:null}
          {model!.access.hr?<button type="button" className="btn-secondary" onClick={()=>setSection("followups")}>{v8.jumpFollowups}</button>:null}
          {model!.access.hr?<button type="button" className="btn-secondary" onClick={()=>setSection("absences")}>{v8.jumpAbsences}</button>:null}
          {model!.access.hr?<button type="button" className="btn-secondary" onClick={()=>setSection("incidents")}>{v8.jumpIncidents}</button>:null}
          {model!.access.hr?<button type="button" className="btn-secondary" onClick={()=>setShowOnboarding(true)}>{v8.startOnboarding}</button>:null}
        </div>
        <div className="rounded-lg border border-slate-100 px-3 py-2">
          <h3 className="text-sm font-bold text-slate-950">{v8.safetyRecords}</h3>
          {model!.access.hr&&!model!.access.peopleReady?<p className="mt-1 text-sm text-slate-500">{v8.safetyGated}</p>:null}
          {model!.access.hr&&model!.access.peopleReady&&!timelineRows.length?<p className="mt-1 text-sm text-slate-500">{v8.emptyCompact}</p>:null}
          {model!.access.hr&&model!.access.peopleReady&&timelineRows.length?<ol className="mt-2 max-h-40 space-y-2 overflow-y-auto">{timelineRows.map(event=>
            <li key={event.type+event.id} className="border-l-2 border-violet-200 pl-3 text-sm"><span className="font-semibold">{peopleLabel(language,event.type)}</span> · {peopleLabel(language,event.status)}<p className="mt-0.5 text-xs text-slate-500"><HRDate value={event.at} language={language} time/></p></li>
          )}</ol>:null}
        </div>
      </section>:null}
      {(section==="absences"||section==="incidents")&&model!.access.hr?model!.access.peopleReady?<CaseSection kind={section} model={model!} language={language} reload={load}/>:<section className="hr-panel space-y-2 p-4"><h2 className="text-base font-bold text-slate-950">{section==="absences"?p.absences:p.incidents}</h2><HRNotice>{section==="absences"?v8.setupAbsences:v8.setupIncidents}</HRNotice><p className="text-xs text-slate-500">{v8.preparedWorkflow}</p></section>:null}
      {section==="personnel"&&model!.access.hr?<PersonnelSection model={model!} language={language} reload={load} onDirty={trackDirty} onBusy={setSaving}/>:null}
      {section==="assignments"?(employee?.driverId&&model!.access.operate?<AssignmentSection model={model!} language={language} reload={load}/>:<section className="hr-panel p-4"><HRNotice>{employee?.driverId?c.restricted:c.noDriverLink}</HRNotice></section>):null}
      {section==="meetings"&&model!.access.hr?<MeetingsSection model={model!} language={language} reload={load}/>:null}
      {section==="followups"&&model!.access.hr?<ProfileFollowups model={model!} language={language} reload={load}/>:null}
      {section==="training"?<TrainingSection model={model!} language={language} reload={load}/>:null}
      {section==="documents"&&model!.access.hr?<DocumentsSection model={model!} language={language} reload={load}/>:null}
    </div>:null}
    {linking&&employee?<HRDialog title={c.linkDriver} language={language} busy={mutation.busy} error={mutation.error} onClose={()=>setLinking(false)} onSubmit={()=>void mutation.run("link_driver",{employeeId:employee.employeeId,linkDriverId:linkId}).then(result=>{if(result)setLinking(false);})}><p className="mb-4 text-sm">{c.identityLink}</p><HRFields values={{linkId}} onChange={(_key,value)=>setLinkId(String(value))} fields={[{key:"linkId",label:c.chooseDriver,type:"select",required:true,options:[{value:"",label:c.chooseDriver},...candidates.map(row=>({value:row.id,label:row.name}))]}]}/></HRDialog>:null}
    {edit&&employee?<HRDialog title={c.editDriver} language={language} busy={mutation.busy} error={mutation.error} onClose={()=>setEdit(false)} onSubmit={()=>void mutation.run("save_driver",{driverId:employee.driverId,...draft}).then(result=>{if(result)setEdit(false);})}><HRFields fields={[{key:"name",label:c.displayName,required:true},{key:"active",label:c.operationalActive,type:"checkbox"}]} values={draft} disabled={mutation.busy} onChange={(key,value)=>setDraft(current=>({...current,[key]:value}))}/></HRDialog>:null}
  </main>;
}
