"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { X, LockKeyhole } from "lucide-react";
import { hrCopy, hrErrorMessage } from "@/lib/ees-hr-v7-copy";
import { hrAction } from "@/lib/ees-hr-v7-client";
import { HRV7Error,type HRAction,type HRLanguage } from "@/lib/ees-hr-v7-types";

export function HRNotice({children,error=false}:{children:ReactNode;error?:boolean}) {return <p role={error?"alert":"status"} className={`rounded-xl px-4 py-3 text-sm ${error?"bg-rose-50 text-rose-800":"bg-violet-50 text-violet-900"}`}>{children}</p>;}
export function HRRestricted({language}:{language:HRLanguage}) {return <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center"><LockKeyhole className="mx-auto mb-3 h-6 w-6 text-violet-600"/><p className="text-sm text-slate-600">{hrCopy(language).restricted}</p></div>;}
export type HRField = {key:string;label:string;type?:"text"|"datetime-local"|"date"|"number"|"textarea"|"select"|"checkbox";required?:boolean;options?:{value:string;label:string}[];help?:string;max?:string;step?:string};
export function HRFields({fields,values,onChange,disabled=false}:{fields:HRField[];values:Record<string,unknown>;onChange:(key:string,value:unknown)=>void;disabled?:boolean}) {
  const formId=useId();
  return <div className="grid gap-4 sm:grid-cols-2">{fields.map(field=>{
    const id=`${formId}-${field.key}`,helpId=field.help?`${id}-help`:undefined;
    const label=<label htmlFor={id}>{field.label}{field.required?<span aria-hidden="true"> *</span>:null}</label>;
    const props={id,required:field.required,disabled,"aria-describedby":helpId};
    return <div key={field.key} className={`min-w-0 text-sm font-semibold text-slate-800 ${field.type==="textarea"?"sm:col-span-2":""}`}>
      {field.type==="checkbox"?<div className="flex items-start gap-2"><input {...props} type="checkbox" checked={values[field.key]===true} onChange={event=>onChange(field.key,event.target.checked)} className="mt-1 accent-violet-600"/>{label}</div>:<>
        {label}
        {field.type==="textarea"?<textarea {...props} rows={4} value={String(values[field.key]??"")} onChange={event=>onChange(field.key,event.target.value)} className="form-input mt-1 w-full"/>:
        field.type==="select"?<select {...props} value={String(values[field.key]??"")} onChange={event=>onChange(field.key,event.target.value)} className="form-input mt-1 w-full bg-white">{field.options?.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select>:
        <input {...props} type={field.type??"text"} max={field.max} step={field.step??(field.type==="number"?"any":undefined)} value={String(values[field.key]??"")} onChange={event=>onChange(field.key,event.target.value)} className="form-input mt-1 w-full"/>}
      </>}{field.help?<span id={helpId} className="mt-1 block text-xs font-normal leading-5 text-slate-500">{field.help}</span>:null}
    </div>;
  })}</div>;
}
export function HRDialog({title,children,language,busy,onClose,onSubmit,error,saveLabel}:{title:string;children:ReactNode;language:HRLanguage;busy:boolean;onClose:()=>void;onSubmit:()=>void;error?:string|null;saveLabel?:string}) {
  const ref=useRef<HTMLDialogElement>(null);const c=hrCopy(language);
  useEffect(()=>{const dialog=ref.current;if(!dialog)return;dialog.showModal();return()=>{if(dialog.open)dialog.close();};},[]);
  return <dialog ref={ref} onCancel={event=>{event.preventDefault();if(!busy)onClose();}} className="fixed inset-0 m-auto hidden max-h-[90dvh] w-[calc(100%_-_1.5rem)] max-w-2xl flex-col overflow-hidden rounded-2xl border-0 bg-white p-0 shadow-2xl backdrop:bg-slate-950/40 open:flex" aria-label={title}>
    <header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 p-5"><h2 className="text-lg font-bold text-slate-950">{title}</h2><button type="button" aria-label={c.close} disabled={busy} onClick={onClose} className="table-action-secondary"><X className="h-4 w-4"/></button></header>
    <form className="flex min-h-0 flex-1 flex-col" onSubmit={event=>{event.preventDefault();onSubmit();}}>
      <div className="min-h-0 overflow-y-auto p-5">{children}{error?<div className="mt-4"><HRNotice error>{error}</HRNotice></div>:null}</div>
      <footer className="flex shrink-0 justify-end gap-2 border-t border-slate-100 bg-white p-4"><button type="button" className="btn-secondary" disabled={busy} onClick={onClose}>{c.cancel}</button><button type="submit" className="btn-primary disabled:opacity-50" disabled={busy}>{busy?c.saving:saveLabel??c.save}</button></footer>
    </form>
  </dialog>;
}
export function useHRMutation(language:HRLanguage,onSaved:()=>Promise<void>|void) {
  const lock=useRef(false);const request=useRef<{payload:string;id:string}|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[notice,setNotice]=useState<string|null>(null);
  const run=async(action:HRAction,input:Record<string,unknown>,verify?:()=>Promise<void>)=>{
    if(lock.current)return null;lock.current=true;setBusy(true);setError(null);setNotice(null);
    const payload=JSON.stringify({action,input});if(request.current?.payload!==payload)request.current={payload,id:crypto.randomUUID()};
    let committed=false;
    try {const result=await hrAction(action,input,request.current.id);committed=true;if(verify)await verify();await onSaved();request.current=null;setNotice(hrCopy(language).saved);return result;}
    catch(error){setError(hrErrorMessage(language,committed?new HRV7Error("HR_SAVE_UNVERIFIED",409):error));return null;}
    finally{lock.current=false;setBusy(false);}
  };
  return {run,busy,error,notice,clear(){setError(null);setNotice(null);}};
}
export function HRDate({value,language,time=false}:{value:string|null|undefined;language:HRLanguage;time?:boolean}) {
  if(!value)return <>—</>;const date=new Date(value);if(!Number.isFinite(date.getTime()))return <>—</>;
  return <>{new Intl.DateTimeFormat(language==="th"?"th-TH":"en-GB",{dateStyle:"medium",...(time?{timeStyle:"short" as const}:{}),timeZone:"Asia/Bangkok"}).format(date)}</>;
}

