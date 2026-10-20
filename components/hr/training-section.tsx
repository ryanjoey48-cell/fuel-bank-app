"use client";
import Link from "next/link";
import { useState } from "react";
import { hrCopy,hrStatus } from "@/lib/ees-hr-v7-copy";
import { bangkokToday,type HRLanguage,type HRProfile } from "@/lib/ees-hr-v7-types";
import { HRDate,HRDialog,HRFields,HRNotice,useHRMutation } from "./hr-ui";

export function TrainingSection({model,language,reload}:{model:HRProfile;language:HRLanguage;reload:()=>Promise<void>}) {
  const c=hrCopy(language),mutation=useHRMutation(language,reload);const [open,setOpen]=useState(false),[values,setValues]=useState<Record<string,unknown>>({course:"",completedOn:bangkokToday(),expiresOn:"",certificateId:"",notes:""});
  const training=(model.data.training??[]) as Record<string,unknown>[],safety=(model.data.safety??[]) as Record<string,unknown>[];
  return <div className="space-y-5"><section className="rounded-xl border border-violet-100 bg-white p-5"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-bold text-slate-950">{c.training}</h2>{model.access.hr?<button type="button" className="btn-primary" disabled={!model.employee.employeeId} onClick={()=>{mutation.clear();setOpen(true);}}>{c.recordTraining}</button>:null}</div>
    {mutation.notice?<div className="mt-4"><HRNotice>{mutation.notice}</HRNotice></div>:null}
    {!training.length?<p className="mt-4 text-sm text-slate-500">{c.noTraining}</p>:<div className="mt-4 space-y-3">{training.map(row=><article key={String(row.id)} className="rounded-lg bg-slate-50 p-4 text-sm"><h3 className="font-semibold text-slate-950">{String(row.course)}</h3><p className="mt-2 text-slate-600">{c.completedOn}: <HRDate value={String(row.completed_on)} language={language}/> · {c.expiresOn}: <HRDate value={row.expires_on?String(row.expires_on):null} language={language}/></p>{row.certificate_id&&model.access.hr?<Link className="mt-3 inline-flex min-h-10 items-center font-semibold text-violet-700" href={`/${model.employee.driverId?"drivers":"employees"}/${model.employee.id}?section=documents#${row.certificate_id}`}>{c.certificate}</Link>:null}{row.notes?<p className="mt-3 whitespace-pre-wrap">{String(row.notes)}</p>:null}</article>)}</div>}
  </section><section className="rounded-xl border border-violet-100 bg-white p-5"><div className="flex flex-wrap justify-between gap-3"><h2 className="font-bold text-slate-950">{c.existingSafety}</h2><Link href="/safety" className="text-sm font-semibold text-violet-700">{c.openSafety}</Link></div>{safety.length?<ol className="mt-4 space-y-3">{safety.map(row=><li key={String(row.id)} className="flex flex-wrap justify-between gap-2 text-sm"><HRDate value={String(row.date)} language={language}/><span>{hrStatus(language,String(row.status))}</span></li>)}</ol>:<p className="mt-4 text-sm text-slate-500">{c.noSafety}</p>}</section>
  {open?<HRDialog title={c.recordTraining} language={language} busy={mutation.busy} error={mutation.error} onClose={()=>setOpen(false)} onSubmit={()=>void mutation.run("save_training",{employeeId:model.employee.employeeId,...values}).then(result=>{if(result)setOpen(false);})}><HRFields values={values} disabled={mutation.busy} onChange={(key,value)=>setValues(current=>({...current,[key]:value}))} fields={[
    {key:"course",label:c.course,required:true},{key:"completedOn",label:c.completedOn,type:"date",required:true},{key:"expiresOn",label:c.expiresOn,type:"date"},
    {key:"certificateId",label:c.certificate,type:"select",options:[{value:"",label:c.notRecorded},...((model.data.certificates??[]) as {id:string;description:string|null;version:number}[]).map(doc=>({value:doc.id,label:`${doc.description??c.certificate} · ${c.version} ${doc.version}`}))]},{key:"notes",label:c.notes,type:"textarea"}]}/></HRDialog>:null}
  </div>;
}

