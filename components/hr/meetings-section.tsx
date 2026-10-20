"use client";
import { useState } from "react";
import { hrRequest } from "@/lib/ees-hr-v7-client";
import { hrCopy,hrErrorMessage,hrStatus } from "@/lib/ees-hr-v7-copy";
import { meetingPdf,printMeeting } from "@/lib/ees-hr-meeting-report";
import { bangkokToday,type HRLanguage,type HRMeetingV7,type HRProfile } from "@/lib/ees-hr-v7-types";
import { HRDate,HRDialog,HRFields,HRNotice,useHRMutation,type HRField } from "./hr-ui";

export function MeetingRecord({meeting,language,onAddendum}:{meeting:HRMeetingV7;language:HRLanguage;onAddendum?:()=>void}) {
  const c=hrCopy(language);const [pdfBusy,setPdfBusy]=useState(false),[error,setError]=useState<string|null>(null);
  const download=async()=>{setPdfBusy(true);setError(null);try{const fresh=await hrRequest<HRMeetingV7>(`meetings/${meeting.id}`);const blob=await meetingPdf(fresh,language);const url=URL.createObjectURL(blob);const link=document.createElement("a");link.href=url;link.download=`EES-Meeting-${meeting.meeting_date}.pdf`;link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}catch(error){setError(hrErrorMessage(language,error));}finally{setPdfBusy(false);}};
  const fields=[{label:c.attendees,value:meeting.attendees},{label:c.discussion,value:meeting.discussion},{label:c.response,value:meeting.employee_response},{label:c.agreedActions,value:meeting.agreed_actions}];
  return <section className="rounded-xl border border-violet-200 bg-white p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-semibold text-violet-700">{c.original} · {hrStatus(language,meeting.category)}</p><h3 className="mt-1 text-xl font-bold text-slate-950">{meeting.subject}</h3><p className="mt-2 text-sm text-slate-500"><HRDate value={meeting.meeting_date} language={language}/> · {meeting.employee_name}</p></div><div className="flex flex-wrap gap-2"><button type="button" className="btn-secondary" onClick={()=>{try{printMeeting(meeting,language);}catch(error){setError(hrErrorMessage(language,error));}}}>{c.print}</button><button type="button" className="btn-secondary" disabled={pdfBusy} onClick={()=>void download()}>{pdfBusy?c.progress:c.pdf}</button></div></div>
    {error?<div className="mt-4"><HRNotice error>{error}</HRNotice></div>:null}
    <dl className="mt-5 space-y-5">{fields.map(field=><div key={field.label}><dt className="text-sm font-semibold text-slate-600">{field.label}</dt><dd className="mt-2 whitespace-pre-wrap break-words text-sm leading-7 text-slate-900">{field.value??"—"}</dd></div>)}
      <div className="grid gap-4 sm:grid-cols-2"><div><dt className="text-sm font-semibold text-slate-600">{c.acknowledgement}</dt><dd className="mt-2 text-sm">{hrStatus(language,meeting.acknowledgement)}</dd></div><div><dt className="text-sm font-semibold text-slate-600">{c.followupDate}</dt><dd className="mt-2 text-sm"><HRDate value={meeting.follow_up_date} language={language}/></dd></div><div><dt className="text-sm font-semibold text-slate-600">{c.author}</dt><dd className="mt-2 break-all text-sm">{meeting.author_name??meeting.created_by}</dd></div><div><dt className="text-sm font-semibold text-slate-600">{c.recordedAt}</dt><dd className="mt-2 text-sm"><HRDate value={meeting.created_at} language={language} time/></dd></div></div>
    </dl><p className="mt-5 rounded-lg bg-violet-50 p-3 text-sm text-violet-900">{c.immutable}</p>
    <div className="mt-5 flex flex-wrap justify-between gap-3"><h4 className="font-bold text-slate-950">{c.addendumHistory}</h4>{onAddendum?<button type="button" className="btn-secondary" onClick={onAddendum}>{c.addendum}</button>:null}</div>
    <ol className="mt-4 space-y-3">{meeting.addenda.map(entry=><li key={entry.id} className="rounded-lg border border-slate-100 p-4 text-sm"><p className="font-semibold">{entry.kind==="correction"?c.correction:entry.kind==="acknowledgement"?c.ackUpdate:c.additionalRecord} · <HRDate value={entry.created_at} language={language} time/></p><p className="mt-2 whitespace-pre-wrap">{entry.content}</p><p className="mt-2 whitespace-pre-wrap text-slate-500">{c.reason}: {entry.reason}</p>{entry.acknowledgement?<p className="mt-2">{c.acknowledgement}: {hrStatus(language,entry.acknowledgement)}</p>:null}</li>)}</ol>
  </section>;
}
export function MeetingsSection({model,language,reload}:{model:HRProfile;language:HRLanguage;reload:()=>Promise<void>}) {
  const c=hrCopy(language);const rows=(model.data.meetings??[]) as HRMeetingV7[];const [selected,setSelected]=useState<string|null>(null),[form,setForm]=useState<"meeting"|"addendum"|null>(null),[values,setValues]=useState<Record<string,unknown>>({});const mutation=useHRMutation(language,reload);
  const full=rows.find(row=>row.id===selected)??null;const parent={driverId:model.employee.driverId,employeeId:model.employee.employeeId};
  const openMeeting=()=>{mutation.clear();setValues({date:bangkokToday(),category:"general",subject:"",attendees:"",discussion:"",response:"",actions:"",followup:"",acknowledgement:"not_requested"});setForm("meeting");};
  const openAddendum=()=>{mutation.clear();setValues({kind:"addendum",reason:"",content:"",acknowledgement:""});setForm("addendum");};
  const save=async()=>{const result=await mutation.run(form==="meeting"?"record_meeting":"add_meeting_addendum",form==="meeting"?{...parent,...values}:{meetingId:selected,...values});if(result){setForm(null);if(form==="meeting")setSelected(String(result.id));}};
  const acknowledgements=["not_requested","pending","acknowledged","declined"].map(value=>({value,label:hrStatus(language,value)}));
  const fields:HRField[]=form==="meeting"?[
    {key:"date",label:c.meetingDate,type:"date",required:true},{key:"category",label:c.meetingType,type:"select",options:["general","performance","attendance","welfare","safety","disciplinary","training","other"].map(value=>({value,label:hrStatus(language,value)}))},
    {key:"subject",label:c.subject,required:true},{key:"attendees",label:c.attendees,required:true},{key:"discussion",label:c.discussion,type:"textarea",required:true},
    {key:"response",label:c.response,type:"textarea"},{key:"actions",label:c.agreedActions,type:"textarea"},{key:"followup",label:c.followupDate,type:"date"},
    {key:"acknowledgement",label:c.acknowledgement,type:"select",options:acknowledgements}]:[
    {key:"kind",label:c.addendum,type:"select",options:[{value:"addendum",label:c.additionalRecord},{value:"correction",label:c.correction},{value:"acknowledgement",label:c.ackUpdate}]},
    {key:"reason",label:c.reason,type:"textarea",required:true},{key:"content",label:c.content,type:"textarea",required:true},
    ...(values.kind==="acknowledgement"?[{key:"acknowledgement",label:c.acknowledgement,type:"select" as const,required:true,options:[{value:"",label:c.notRecorded},...acknowledgements]}]:[])];
  return <div className="space-y-5"><div className="flex flex-wrap justify-between gap-3"><div><h2 className="text-lg font-bold text-slate-950">{c.meetings}</h2><p className="mt-1 text-sm text-slate-500">{c.meetingConfidential}</p></div><button type="button" className="btn-primary" onClick={openMeeting}>{c.recordMeeting}</button></div>
    {mutation.notice?<HRNotice>{mutation.notice}</HRNotice>:null}
    {!rows.length?<p className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">{c.noMeetings}</p>:<div className="grid gap-3">{rows.map(row=><button key={row.id} type="button" onClick={()=>setSelected(row.id)} className={`rounded-xl border p-4 text-left transition ${selected===row.id?"border-violet-300 bg-violet-50":"border-slate-200 bg-white hover:border-violet-200"}`}><div className="flex flex-wrap justify-between gap-2"><p className="font-semibold text-slate-950">{row.subject}</p><span className="text-xs font-medium text-violet-700">{hrStatus(language,row.acknowledgement)}</span></div><p className="mt-2 text-sm text-slate-500"><HRDate value={row.meeting_date} language={language}/> · {hrStatus(language,row.category)}{row.follow_up_date?<> · {c.followupDate}: <HRDate value={row.follow_up_date} language={language}/></>:null}</p></button>)}</div>}
    {full?<MeetingRecord meeting={full} language={language} onAddendum={openAddendum}/>:null}
    {form?<HRDialog title={form==="meeting"?c.recordMeeting:c.addendum} language={language} busy={mutation.busy} error={mutation.error} onClose={()=>setForm(null)} onSubmit={()=>void save()}><HRFields fields={fields} values={values} disabled={mutation.busy} onChange={(key,value)=>setValues(current=>({...current,[key]:value}))}/><p className="mt-4 rounded-lg bg-violet-50 p-3 text-sm text-violet-900">{form==="meeting"?c.meetingConfidential:c.immutable}</p></HRDialog>:null}
  </div>;
}

