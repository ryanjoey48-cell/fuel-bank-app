"use client";
import { useEffect,useRef,useState } from "react";
import Image from "next/image";
import { hrDocumentBlob,hrRequest,invalidateHRReads } from "@/lib/ees-hr-v7-client";
import { hrVehicleType } from "@/lib/ees-hr-v7-vehicle-label";
import { hrCopy,hrErrorMessage,hrStatus } from "@/lib/ees-hr-v7-copy";
import { HRV7Error,bangkokToday,type HRProfile,type HRLanguage,type HRDocument,type HRDocumentPolicy,type HRAction } from "@/lib/ees-hr-v7-types";
import { HRDate,HRDialog,HRFields,HRNotice,useHRMutation,type HRField } from "./hr-ui";

function SecurePreview({doc,language,onClose}:{doc:HRDocument;language:HRLanguage;onClose:()=>void}){
  const c=hrCopy(language),canvas=useRef<HTMLCanvasElement>(null);
  const [url,setUrl]=useState<string|null>(null),[error,setError]=useState<string|null>(null),[page,setPage]=useState(1),[pages,setPages]=useState(0);
  useEffect(()=>{let alive=true,objectUrl:string|undefined;let destroy:(()=>void)|undefined;
    void (async()=>{try{const blob=await hrDocumentBlob(doc.id);if(!alive)return;
      if(doc.mime_type==="application/pdf"){
        const pdfjs=await import("pdfjs-dist");pdfjs.GlobalWorkerOptions.workerSrc=new URL("pdfjs-dist/build/pdf.worker.min.mjs",import.meta.url).toString();
        if(!alive)return;
        const task=pdfjs.getDocument({data:new Uint8Array(await blob.arrayBuffer()),stopAtErrors:true});destroy=()=>{void task.destroy();};
        const pdf=await task.promise;if(!alive){destroy();return;}setPages(pdf.numPages);const sheet=await pdf.getPage(page),viewport=sheet.getViewport({scale:1.3});
        const target=canvas.current;if(!target)return;target.width=viewport.width;target.height=viewport.height;
        const context=target.getContext("2d");if(context)await sheet.render({canvas:target,canvasContext:context,viewport}).promise;
      }else if(["image/jpeg","image/png"].includes(doc.mime_type)){objectUrl=URL.createObjectURL(blob);if(alive)setUrl(objectUrl);}
      else throw new HRV7Error("HR_DOCUMENT_UNAVAILABLE");
    }catch(cause){if(alive)setError(hrErrorMessage(language,cause));}})();
    return()=>{alive=false;destroy?.();if(objectUrl)URL.revokeObjectURL(objectUrl);};
  },[doc.id,doc.mime_type,language,page]);
  return <HRDialog title={c.preview} language={language} busy={false} onClose={onClose} onSubmit={onClose} saveLabel={c.close} error={error}>
    {doc.mime_type==="application/pdf"?<><canvas ref={canvas} className="h-auto w-full"/><div className="mt-3 flex items-center justify-between"><button type="button" className="btn-secondary" disabled={page<=1} onClick={()=>setPage(value=>value-1)}>{c.previous}</button><span>{page} / {pages||"—"}</span><button type="button" className="btn-secondary" disabled={page>=pages} onClick={()=>setPage(value=>value+1)}>{c.next}</button></div></>:url?<Image src={url} alt={c.preview} unoptimized width={1000} height={1200} className="h-auto max-w-full"/>:<p>{error?c.documentPreviewUnavailable:c.loading}</p>}
  </HRDialog>;
}

export function DocumentsSection({model,language,reload}:{model:HRProfile;language:HRLanguage;reload:()=>Promise<void>}){
  const c=hrCopy(language),mutation=useHRMutation(language,reload);
  const documents=(model.data.documents??[]) as HRDocument[],policies=(model.data.policies??[]) as HRDocumentPolicy[],licences=(model.data.licences??[]) as Record<string,unknown>[],rules=(model.data.licenceRules??[]) as Record<string,unknown>[];
  const categories=["national_id","driving_licence","contract","training","safety","other"];
  useEffect(()=>{const id=window.location.hash.slice(1);if(id)document.getElementById(id)?.scrollIntoView({block:"center"});},[]);
  const [form,setForm]=useState<{action:HRAction|"upload"|"purge";id?:string}|null>(null),[values,setValues]=useState<Record<string,unknown>>({}),[file,setFile]=useState<File|null>(null),[uploadBusy,setUploadBusy]=useState(false),[error,setError]=useState<string|null>(null),[preview,setPreview]=useState<HRDocument|null>(null),[showNumbers,setShowNumbers]=useState(false);
  const lock=useRef(false),nonce=useRef(crypto.randomUUID());
  const begin=(action:HRAction|"upload"|"purge",doc?:HRDocument)=>{mutation.clear();setError(null);setFile(null);nonce.current=crypto.randomUUID();setForm({action,id:doc?.id});setValues(action==="upload"?{category:doc?.category??"other",replacesId:doc?.id??"",policyId:"",description:"",issueDate:"",expiryDate:""}:action==="save_document_policy"?{category:"other",purpose:"",lawfulBasis:"",reference:"",retentionDays:"",approved:false}:action==="save_licence"?{category:"",number:"",issueDate:bangkokToday(),expiryDate:"",frontId:"",backId:"",verificationStatus:"unverified"}:action==="save_licence_rule"?{category:"",vehicleType:"",source:"",compatible:false}:{reason:"",hold:!doc?.legal_hold});};
  const save=async()=>{if(!form||lock.current)return;lock.current=true;setError(null);
    try{
      if(form.action==="upload"||form.action==="purge"){
        setUploadBusy(true);
        if(form.action==="upload"){
          if(!file)throw new HRV7Error("HR_INVALID_FILE");const body=new FormData();body.set("file",file);body.set("metadata",JSON.stringify({employeeId:model.employee.employeeId,...values}));body.set("requestId",nonce.current);
          await hrRequest("documents/upload",{method:"POST",body});
        }else{if(!window.confirm(c.purgeConfirm))return;await hrRequest(`documents/${form.id}/purge`,{method:"POST",body:JSON.stringify({reason:values.reason,requestId:nonce.current})});}
        invalidateHRReads();await reload();setForm(null);
      }else{const result=await mutation.run(form.action,{...(form.id?{id:form.id}:{}),...(["save_licence"].includes(form.action)?{employeeId:model.employee.employeeId}:{}),...values});if(result)setForm(null);}
    }catch(cause){setError(hrErrorMessage(language,cause));}finally{setUploadBusy(false);lock.current=false;}
  };
  const download=async(doc:HRDocument)=>{setError(null);try{const blob=await hrDocumentBlob(doc.id);const url=URL.createObjectURL(blob),anchor=document.createElement("a");anchor.href=url;anchor.download=`${doc.category}-v${doc.version}.${doc.mime_type==="application/pdf"?"pdf":doc.mime_type==="image/png"?"png":doc.mime_type==="image/jpeg"?"jpg":"heic"}`;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(cause){setError(hrErrorMessage(language,cause));}};
  const licenceDocs=documents.filter(doc=>doc.category==="driving_licence"&&doc.state==="ready");
  const docOptions=[{value:"",label:c.notRecorded},...licenceDocs.map(doc=>({value:doc.id,label:`${doc.description??c.driving_licence} · ${c.version} ${doc.version}`}))];
  let fields:HRField[]=[];
  if(form?.action==="upload")fields=[{key:"category",label:c.category,type:"select",options:categories.map(value=>({value,label:hrStatus(language,value)}))},{key:"policyId",label:c.policy,type:"select",required:true,options:[{value:"",label:c.policyRequired},...policies.filter(policy=>policy.category===values.category).map(policy=>({value:policy.id,label:policy.policy_reference}))]},{key:"description",label:c.description},{key:"issueDate",label:c.issueDate,type:"date"},{key:"expiryDate",label:c.expiryDate,type:"date"}];
  else if(form?.action==="save_document_policy")fields=[{key:"category",label:c.category,type:"select",options:categories.map(value=>({value,label:hrStatus(language,value)}))},{key:"purpose",label:c.purpose,type:"textarea",required:true},{key:"lawfulBasis",label:c.lawfulBasis,type:"textarea",required:true},{key:"reference",label:c.policyReference,required:true},{key:"retentionDays",label:c.retentionDays,type:"number",step:"1",required:true},{key:"approved",label:c.policyApproval,type:"checkbox",required:true}];
  else if(form?.action==="save_licence")fields=[{key:"category",label:c.licenceCategory,required:true},{key:"number",label:c.licenceNumber,required:true},{key:"issueDate",label:c.issueDate,type:"date",required:true},{key:"expiryDate",label:c.expiryDate,type:"date",required:true},{key:"frontId",label:c.front,type:"select",options:docOptions},{key:"backId",label:c.backDocument,type:"select",options:docOptions},{key:"verificationStatus",label:c.verification,type:"select",options:["unverified","verified","rejected"].map(value=>({value,label:hrStatus(language,value)}))}];
  else if(form?.action==="save_licence_rule")fields=[{key:"category",label:c.licenceCategory,required:true},{key:"vehicleType",label:c.vehicleType,type:"select",required:true,options:[{value:"",label:c.chooseVehicle},...((model.data.vehicleTypes??[]) as string[]).map(value=>({value,label:hrVehicleType(language,value)}))]},{key:"source",label:c.source,required:true},{key:"compatible",label:c.compatible,type:"checkbox"}];
  else fields=[{key:"reason",label:c.reason,type:"textarea",required:true}];
  const title=form?.action==="upload"?c.upload:form?.action==="save_document_policy"?c.newPolicy:form?.action==="save_licence"?c.recordLicence:form?.action==="save_licence_rule"?c.recordRule:form?.action==="hold_document"?(values.hold?c.hold:c.releaseHold):form?.action==="purge"?c.purge:c.retire;
  return <div className="space-y-5">
    {!model.employee.employeeId?<HRNotice>{c.profileFirst}</HRNotice>:null}{!model.access.storageReady?<HRNotice error>{c.storageBlocked}</HRNotice>:null}{error&&!form?<HRNotice error>{error}</HRNotice>:null}{mutation.notice?<HRNotice>{mutation.notice}</HRNotice>:null}
    <section className="rounded-xl border border-violet-100 bg-white p-5"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-bold">{c.documents}</h2><button className="btn-primary" disabled={!model.employee.employeeId||!model.access.storageReady} onClick={()=>begin("upload")}>{c.upload}</button></div><p className="mt-2 text-sm text-slate-500">{c.privateStorage}</p>
      {!documents.length?<p className="mt-4 text-sm text-slate-500">{c.noDocuments}</p>:<div className="mt-4 space-y-3">{documents.map(doc=><article id={doc.id} key={doc.id} className="rounded-lg bg-slate-50 p-4"><div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold">{hrStatus(language,doc.category)} · {c.version} {doc.version}</h3><span className="text-sm">{hrStatus(language,doc.state)}</span></div><p className="mt-2 break-words text-sm">{doc.description??"—"}</p><p className="mt-2 text-xs text-slate-600">{c.uploadedAt}: <HRDate value={doc.uploaded_at} language={language}/> · {c.retainUntil}: <HRDate value={doc.retain_until} language={language}/>{doc.legal_hold?` · ${c.hold}`:""}</p><div className="mt-3 flex flex-wrap gap-2">{["ready","retired"].includes(doc.state)?<><button className="btn-secondary" onClick={()=>setPreview(doc)}>{c.preview}</button><button className="btn-secondary" onClick={()=>void download(doc)}>{c.download}</button><button className="btn-secondary" onClick={()=>begin("hold_document",doc)}>{doc.legal_hold?c.releaseHold:c.hold}</button></>:null}{doc.state==="ready"?<><button className="btn-secondary" onClick={()=>begin("upload",doc)}>{c.replace}</button><button className="btn-secondary" onClick={()=>begin("retire_document",doc)}>{c.retire}</button></>:null}{["retired","purge_pending"].includes(doc.state)&&!doc.legal_hold&&doc.retain_until<=bangkokToday()?<button className="btn-secondary" onClick={()=>begin("purge",doc)}>{c.purge}</button>:null}</div></article>)}</div>}
    </section>
    <section className="rounded-xl border border-violet-100 bg-white p-5"><div className="flex flex-wrap justify-between gap-3"><h2 className="text-lg font-bold">{c.licenceHistory}</h2><div className="flex gap-2"><button className="btn-secondary" onClick={()=>setShowNumbers(value=>!value)}>{showNumbers?c.hide:c.reveal}</button><button className="btn-primary" disabled={!model.employee.employeeId} onClick={()=>begin("save_licence")}>{c.recordLicence}</button></div></div><p className="mt-3 text-sm text-slate-500">{c.licenceProof} {c.notLegalCertification}</p>{!licences.length?<p className="mt-4 text-sm">{c.noLicence}</p>:licences.map(row=><article key={String(row.id)} className="mt-4 rounded-lg bg-slate-50 p-4 text-sm"><strong>{String(row.category)}</strong> · {hrStatus(language,String(row.verification_status))}<p className="mt-2">{c.licenceNumber}: {showNumbers?String(row.licence_number):"••••••"}</p><p className="mt-2">{c.issueDate}: <HRDate value={String(row.issue_date)} language={language}/> · {c.expiryDate}: <HRDate value={String(row.expiry_date)} language={language}/></p></article>)}</section>
    <details className="rounded-xl border border-violet-100 bg-white p-5"><summary className="cursor-pointer font-bold">{c.policies}</summary><p className="mt-3 text-sm text-slate-500">{c.noConsentAssumption}</p><button className="btn-secondary mt-3" onClick={()=>begin("save_document_policy")}>{c.newPolicy}</button>{policies.map(policy=><article key={policy.id} className="mt-3 rounded-lg bg-slate-50 p-3 text-sm"><strong>{hrStatus(language,policy.category)} · {policy.policy_reference}</strong><p className="mt-2 whitespace-pre-wrap">{policy.processing_purpose}</p><p className="mt-2 whitespace-pre-wrap">{policy.documented_lawful_basis}</p><p className="mt-2">{c.retentionDays}: {policy.retention_days}</p></article>)}</details>
    <details className="rounded-xl border border-violet-100 bg-white p-5"><summary className="cursor-pointer font-bold">{c.rules}</summary><p className="mt-3 text-sm text-slate-500">{c.ruleCaution}</p><button className="btn-secondary mt-3" onClick={()=>begin("save_licence_rule")}>{c.recordRule}</button>{rules.map(row=><article key={String(row.id)} className="mt-3 text-sm"><strong>{String(row.category)} · {String(row.vehicle_type)}</strong><p>{row.compatible?c.compatible:c.incompatible}</p><a className="break-all text-violet-700 underline" href={/^https:\/\/([a-z0-9-]+\.)*dlt\.go\.th(\/|$)/i.test(String(row.reliable_source))?String(row.reliable_source):undefined} target="_blank" rel="noreferrer">{String(row.reliable_source)}</a></article>)}</details>
    {form?<HRDialog title={title} language={language} busy={mutation.busy||uploadBusy} error={error??mutation.error} onClose={()=>setForm(null)} onSubmit={()=>void save()}><HRFields fields={fields} values={values} disabled={mutation.busy||uploadBusy} onChange={(key,value)=>{nonce.current=crypto.randomUUID();setValues(current=>({...current,[key]:value,...(key==="category"&&form.action==="upload"?{policyId:""}:{})}));}}/>{form.action==="upload"?<label className="mt-4 block text-sm font-semibold">{c.file}<input className="mt-2 block w-full text-sm" type="file" accept=".jpg,.jpeg,.png,.heic,.heif,.pdf" required disabled={uploadBusy} onChange={event=>{nonce.current=crypto.randomUUID();setFile(event.target.files?.[0]??null);}}/><span className="mt-2 block text-xs font-normal text-slate-500">{c.fileHelp}</span></label>:null}</HRDialog>:null}
    {preview?<SecurePreview doc={preview} language={language} onClose={()=>setPreview(null)}/>:null}
  </div>;
}





