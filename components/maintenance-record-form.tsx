"use client";
import { useRef,useState,type ChangeEvent,type FormEvent } from "react";
import { useLanguage } from "@/lib/language-provider";
import { useAccountAccess } from "@/lib/use-account-access";
import { maintenanceLineTotal,maintenanceToday,maintenanceTotal,newMaintenanceItem,receiptDifference,validMaintenanceDate,maintenanceDriver } from "@/lib/maintenance";
import { saveMaintenanceRecord,uploadMaintenanceAttachment,validateMaintenanceFile } from "@/lib/maintenance-data";
import { duplicateMaintenanceItem } from "@/lib/maintenance-intelligence";
import { reliableMaintenanceMileage } from "@/lib/maintenance";
import { formatCurrency,formatDate,formatNumber } from "@/lib/utils";
import type { MaintenanceData,MaintenanceRecord,MaintenanceRecordInput } from "@/lib/maintenance-types";
import { MaintenanceField as Field,MaintenanceCategorySelect } from "./maintenance-fields";
import { MaintenanceAttachmentList,MaintenanceUploader } from "./maintenance-attachments";

import {MaintenanceServiceFields} from './maintenance-service-fields';
import { MaintenanceReminderFields, modeFor, type ItemForm } from "./maintenance-reminder-fields";
import {ENGINE_OIL_PACKAGE,proposedOilPackage,validateOilPackage} from '@/lib/maintenance-service-packages';
const timeInput=(value:string|null)=>value?new Date(Date.parse(value)+7*3600000).toISOString().slice(0,16):"";
const timeValue=(value:string)=>value?new Date(`${value}:00+07:00`).toISOString():null;
export function MaintenanceRecordForm({data,record,vehicleId,onClose,onSaved,preventativeReady=true,packageRequested=false}:{data:MaintenanceData;record:MaintenanceRecord|null;vehicleId:string;onClose:()=>void;onSaved:()=>void;preventativeReady?:boolean;packageRequested?:boolean}) {
 const {t,language}=useLanguage(),c=t.maintenance,{can}=useAccountAccess();const [savedRecord,setSavedRecord]=useState(record);
 const [form,setForm]=useState<MaintenanceRecordInput>(()=>record?{...record}:{id:crypto.randomUUID(),vehicle_id:vehicleId,service_date:maintenanceToday(),odometer:null,garage:null,receipt_reference:null,receipt_total:null,mismatch_confirmed:false,notes:null,off_road_at:null,returned_at:null});
 const [items,setItems]=useState<ItemForm[]>(()=>record?data.items.filter(i=>i.record_id===record.id).sort((a,b)=>a.position-b.position).map(i=>({...i,quantity:Number(i.quantity),unit_price:Number(i.unit_price),line_total:i.line_total==null?null:Number(i.line_total),mode:modeFor(i)})):packageRequested?proposedOilPackage(()=>crypto.randomUUID()).map(i=>({...i,service_confirmed:true,mode:"none"})):[{...newMaintenanceItem(crypto.randomUUID()),mode:"none"}]);
 const [packageMode,setPackageMode]=useState(packageRequested),[packageReviewed,setPackageReviewed]=useState(false);
 const [uploadState,setUploadState]=useState({busy:false,pending:0}),[justSaved,setJustSaved]=useState(false);
 const [receiptFile,setReceiptFile]=useState<File|null>(null);
 const [receiptFileError,setReceiptFileError]=useState('');
 const [receiptProgress,setReceiptProgress]=useState<number|null>(null);
 const [receiptUploadError,setReceiptUploadError]=useState(false);
 const [receiptUploading,setReceiptUploading]=useState(false);
 const receiptUploadLock=useRef(false);
 const [completedReceipt,setCompletedReceipt]=useState(false);
 const selectReceipt=async(event:ChangeEvent<HTMLInputElement>)=>{
  const file=event.target.files?.[0];event.target.value='';if(!file)return;
  setReceiptFileError('');setReceiptUploadError(false);setCompletedReceipt(false);
  try{await validateMaintenanceFile(file);setReceiptFile(file);}
  catch{setReceiptFile(null);setReceiptFileError(language==='th'?'ใช้ไฟล์ PDF, JPG หรือ PNG ขนาดไม่เกิน 10 MB':'Choose a PDF, JPG or PNG receipt of 10 MB or less.');}
 };
 const attachReceipt=async(id:string,file:File)=>{
  if(receiptUploadLock.current)return false;
  receiptUploadLock.current=true;setReceiptUploading(true);setReceiptProgress(0);setReceiptUploadError(false);
  try{await uploadMaintenanceAttachment(id,file,setReceiptProgress);setReceiptFile(null);setReceiptUploadError(false);setCompletedReceipt(true);onSaved();return true;}
  catch(error){console.error('Maintenance receipt attachment failed',error);setReceiptUploadError(true);return false;}
  finally{receiptUploadLock.current=false;setReceiptUploading(false);}
 };
 const closeSafely=()=>{
  if(busy||receiptUploading||uploadState.busy)return;
  if(receiptFile&&(!savedRecord||receiptUploadError)&&!window.confirm(language==='th'?'ใบเสร็จนี้ยังไม่ได้แนบเข้ากับบันทึก ต้องการปิดหรือไม่?':'This receipt has NOT been attached to the saved record. Leave anyway?'))return;
  if(uploadState.pending&&!window.confirm(c.closeWithFiles))return;
  onClose();
 };
 const [busy,setBusy]=useState(false),[error,setError]=useState<"saveError"|"invalid"|"conflict"|null>(null);const lock=useRef(false);
 const set=(patch:Partial<MaintenanceRecordInput>)=>{setPackageReviewed(false);setForm(old=>({...old,...patch,mismatch_confirmed:patch.mismatch_confirmed??false}));};
 const update=(id:string,patch:Partial<ItemForm>)=>{setPackageReviewed(false);const adjusted=("quantity" in patch||"unit_price" in patch)?{...patch,line_total:null}:patch;setItems(old=>old.map(i=>i.id===id?{...i,...adjusted}:i));setForm(old=>({...old,mismatch_confirmed:false}));};
 const total=maintenanceTotal(items),difference=receiptDifference(total,form.receipt_total),vehicle=data.vehicles.find(v=>v.id===form.vehicle_id);
 const sourceMileage=reliableMaintenanceMileage(data.mileage,form.vehicle_id,form.service_date);
 const suggestions=Array.from(new Set(data.items.map(i=>i.description))).sort();
 // Derived preview only. No new writes or modifications to inspection history.
 const linkedWork=items.filter(i=>Boolean(i.service_key)&&i.service_confirmed===true);
 const unconfirmedWork=items.filter(i=>Boolean(i.service_key)&&i.service_confirmed!==true);
 const serviceActionLabel=(action:string)=>{
  const labels:Record<string,[string,string]>={
   inspection:['Inspection','ตรวจสอบ'],
   fluid_replacement:['Fluid replacement','เปลี่ยนของเหลว'],
   fluid_top_up:['Fluid top-up','เติมของเหลว'],
   component_replacement:['Component replacement','เปลี่ยนอะไหล่'],
   repair:['Repair','ซ่อมแซม'],
   other:['Other work','งานอื่น ๆ'],
  };
  return labels[action]?.[language==='th'?1:0]??(language==='th'?'งานอื่น ๆ':'Other work');
 };

 const submit=async(e:FormEvent)=>{
  e.preventDefault();if(lock.current||uploadState.busy||!can("business:write"))return;setError(null);
  if((packageMode||(!record&&items.some(i=>i.service_key==='engine_oil'&&i.service_action==='fluid_replacement')))&&(!packageReviewed||!validateOilPackage(items)||form.odometer===null)){setError("invalid");return;}
  if(!vehicle||!validMaintenanceDate(form.service_date)||form.service_date>maintenanceToday()||!items.length||items.some(i=>!i.description.trim()||(i.reminder_km!==null&&form.odometer===null&&i.override_km===null)||(i.mode==="date"&&!i.override_date)||(i.mode==="odometer"&&i.override_km===null)||(i.mode==="months"&&!i.reminder_months)||(i.mode==="mileage"&&!i.reminder_km&&i.override_km===null)||(i.mode==="both"&&(!i.reminder_months||!i.reminder_km))||(i.override_date&&i.override_date<form.service_date)||(i.override_km!==null&&form.odometer!==null&&i.override_km<form.odometer))||total>9999999999.99||(form.returned_at&&(!form.off_road_at||form.returned_at<form.off_road_at))){setError("invalid");return;}
  if(difference!==null&&difference!==0&&!form.mismatch_confirmed){setError("invalid");return;}
  lock.current=true;setBusy(true);try{
   const r=await saveMaintenanceRecord(form,items.map(({mode,...item})=>item),savedRecord?.updated_at??null);
   setSavedRecord(r);setJustSaved(true);onSaved();
   if(receiptFile)await attachReceipt(r.id,receiptFile);
   window.setTimeout(()=>document.getElementById("maintenance-receipts")?.scrollIntoView({behavior:"smooth",block:"center"}),0);
  }catch(err){setError(String((err as {message?:string}).message??err).includes("CONFLICT")?"conflict":"saveError");}
  finally{setBusy(false);lock.current=false;}
 };
 return <section className="surface-card space-y-4 p-4 sm:p-5" id="maintenance-form"><div className="flex flex-wrap justify-between gap-2"><h3 className="section-title">{record?c.edit:c.add}</h3><button type="button" className="btn-secondary" disabled={busy||receiptUploading||uploadState.busy} onClick={closeSafely}>{c.close}</button></div><p className="text-sm text-slate-500">{c.formHelp}</p><form onSubmit={submit} className="space-y-4">
 {error&&<p role="alert" className="rounded-xl bg-rose-50 p-3 text-rose-800">{c[error]}</p>}{justSaved&&<p role="status" className="rounded-xl bg-emerald-50 p-3 text-emerald-800">{language==='th'?'บันทึกงานซ่อมแล้ว':'Maintenance record saved.'} {receiptFile?(language==='th'?'ตรวจสอบสถานะการแนบใบเสร็จด้านล่าง':'Check the receipt attachment status below.'):c.receiptSaved}</p>}
 {!savedRecord&&<section className="rounded-2xl border border-violet-200 bg-white p-4" aria-label="Original garage receipt">
  <div className="flex flex-wrap items-start justify-between gap-3"><div><h4 className="font-semibold text-slate-950">📎 {language==='th'?'ใบเสร็จต้นฉบับ':'Original garage receipt'}</h4><p className="mt-1 text-xs text-slate-600">{language==='th'?'เลือก PDF หรือรูปถ่ายไว้ก่อน ระบบจะบันทึกข้อมูลการซ่อม แล้วแนบไฟล์โดยอัตโนมัติ':'Choose the PDF or photo now. Once you save the maintenance details, EES will upload this original receipt to the saved record.'}</p></div><span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">PDF · JPG · PNG · 10 MB</span></div>
  <div className="mt-3 flex flex-wrap items-center gap-3"><label className="btn-secondary cursor-pointer">{language==='th'?'เลือกใบเสร็จ':'Choose receipt'}<input type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" className="sr-only" onChange={e=>void selectReceipt(e)} disabled={busy||receiptUploading}/></label>{receiptFile&&<><span className="min-w-0 max-w-md truncate text-sm text-slate-700" title={receiptFile.name}>{receiptFile.name}</span><button type="button" className="text-xs font-medium text-rose-700 underline" disabled={busy||receiptUploading} onClick={()=>setReceiptFile(null)}>{language==='th'?'นำออก':'Remove'}</button></>}</div>
  {receiptFileError&&<p role="alert" className="mt-2 text-sm text-rose-700">{receiptFileError}</p>}
  <p className="mt-2 text-xs text-slate-500">{language==='th'?'ไม่สามารถอ่านข้อความจาก PDF โดยอัตโนมัติ โปรดกรอกข้อมูลตามใบเสร็จ':'PDF/photo text extraction is not automatic here. Enter the garage work as shown on the receipt; retain the original for verification.'}</p>
 </section>}
 <fieldset disabled={busy||receiptUploading||uploadState.busy||!can("business:write")} className="space-y-5 disabled:opacity-60"><section className="space-y-3 rounded-2xl border border-violet-100 bg-white p-3 sm:p-4"><h4 className="font-semibold text-violet-950">{c.vehicleReceiptSection}</h4><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
 <Field label={`${c.vehicle} *`}><select required className="form-input" value={form.vehicle_id} onChange={e=>set({vehicle_id:e.target.value})}><option value="">{c.select}</option>{data.vehicles.map(v=><option key={v.id} value={v.id}>{v.vehicle_reg}</option>)}</select></Field>
 <Field label={`${c.serviceDate} *`}><input className="form-input" type="date" min="1900-01-01" max={maintenanceToday()} required value={form.service_date} onChange={e=>set({service_date:e.target.value})}/></Field>
 <Field label={c.mileage}><input className="form-input" type="number" min="0" max="9999999999.99" step="0.01" value={form.odometer??""} onChange={e=>set({odometer:e.target.value===""?null:Number(e.target.value)})}/></Field>
 <Field label={c.garage}><input className="form-input" maxLength={500} value={form.garage??""} onChange={e=>set({garage:e.target.value||null})}/></Field>
 <Field label={c.receiptReference}><input className="form-input" maxLength={500} value={form.receipt_reference??""} onChange={e=>set({receipt_reference:e.target.value||null})}/></Field>
 <Field label={c.receiptTotal}><input className="form-input" type="number" min="0" max="9999999999.99" step="0.01" value={form.receipt_total??""} onChange={e=>set({receipt_total:e.target.value===""?null:Number(e.target.value)})}/></Field>
 </div><p className="text-xs text-slate-500">{c.mileageHelp}</p>{sourceMileage.value!==null&&<div className="rounded-xl bg-violet-50 p-3 text-xs"><p>{c.latestMileage}: {formatNumber(sourceMileage.value,language)} · {formatDate(sourceMileage.date!,language)}</p><p className="my-1 text-slate-500">{c.mileageSourceHelp}</p><button type="button" className="btn-secondary" onClick={()=>set({odometer:sourceMileage.value})}>{c.useMileage}</button></div>}<p className="text-sm text-slate-500">{c.driver}: {maintenanceDriver(data,form.vehicle_id)||c.unassigned}</p></section>
 {!record&&<section className="rounded-xl border border-violet-200 bg-violet-50/50 p-3 space-y-2"><h4 className="font-semibold">🛢️ {language==='th'?'ชุดบริการน้ำมันเครื่อง EES':'EES Engine Oil Service Package'}</h4><p className="text-xs text-slate-600">{language==='th'?'น้ำมันเครื่อง + กรองน้ำมันเครื่อง + กรองเชื้อเพลิง ในการเข้าบริการครั้งเดียว กรุณายืนยันงานจริง หากไม่ได้เปลี่ยนให้ยกเลิกการยืนยันและระบุเหตุผลในหมายเหตุ':'Engine Oil + Engine Oil Filter + Fuel Filter in one visit. Confirm actual work below. For an exception, clear that item’s confirmation and document the reason in its notes. Enter actual receipt costs.'}</p>{!packageMode?<button type="button" className="btn-secondary" disabled={!ENGINE_OIL_PACKAGE.vehicleTypes.includes(vehicle?.vehicle_type??'')} onClick={()=>{setPackageMode(true);setItems(old=>[...old.filter(i=>i.description.trim()),...proposedOilPackage(()=>crypto.randomUUID()).filter(i=>!old.some(existing=>existing.service_key===i.service_key)).map(i=>({...i,service_confirmed:true,mode:'none' as const}))]);}}>{language==='th'?'เพิ่มชุดบริการ 3 รายการ':'Add standard three-item package'}</button>:<label className="flex gap-2 items-start text-sm"><input className="!h-4 !w-4" type="checkbox" checked={packageReviewed} onChange={e=>setPackageReviewed(e.target.checked)}/>{language==='th'?'ตรวจสอบทั้งสามรายการและข้อยกเว้นแล้ว ยืนยันเฉพาะงานที่ทำจริง':'I reviewed all three items and documented exceptions; confirmed items were actually replaced.'}</label>}</section>}
 <div className="space-y-3"><h4 className="font-semibold text-violet-950">{c.itemsSection} *</h4><p className="text-xs text-slate-500">{c.itemsHelp}</p><p className="text-xs text-slate-500">{c.notesNotCopied}</p><datalist id="maintenance-descriptions">{suggestions.map(s=><option key={s} value={s}/>)}</datalist>
 {items.map((item,index)=>{return <div key={item.id} className="space-y-3 rounded-2xl border border-violet-100 bg-white p-4 shadow-sm sm:p-5"><div className="flex flex-wrap items-center justify-between gap-2"><strong>{c.item} {index+1}</strong><div className="flex flex-wrap gap-2"><button className="min-h-11 rounded-lg px-2 text-xs font-medium text-slate-500 hover:bg-violet-50 hover:text-violet-700" type="button" onClick={()=>{setItems([...items,duplicateMaintenanceItem(item,crypto.randomUUID())]);setForm({...form,mismatch_confirmed:false});}}>{c.duplicateItem}</button><button className="min-h-11 rounded-lg px-2 text-xs text-slate-500 hover:bg-rose-50 hover:text-rose-700" type="button" onClick={()=>{if(window.confirm(c.confirmRemoveItem)){setItems(items.filter(i=>i.id!==item.id));setForm({...form,mismatch_confirmed:false});}}}>{c.removeItem}</button></div></div>
 <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><Field label={`${c.descriptionLabel} *`}><input required className="form-input" maxLength={500} list="maintenance-descriptions" value={item.description} onChange={e=>update(item.id,{description:e.target.value})}/></Field><Field label={c.category}><MaintenanceCategorySelect value={item.category} onChange={category=>update(item.id,{category,requirement_id:null,...(category==="grease"&&item.mode==="none"?{reminder_months:12,mode:"months"}:{})})}/></Field>
 <Field label={c.quantity}><input required className="form-input" type="number" min="0" max="1000000" step="0.01" value={item.quantity} onChange={e=>update(item.id,{quantity:Number(e.target.value)})}/></Field><Field label={c.unitPrice}><input required className="form-input" type="number" min="0" max="100000000" step="0.01" value={item.unit_price} onChange={e=>update(item.id,{unit_price:Number(e.target.value)})}/></Field><div className="self-end rounded-xl bg-white p-3 font-semibold">{c.lineTotal}: {formatCurrency(maintenanceLineTotal(item),language)}</div></div>
 <details className="rounded-xl border border-slate-100 p-3"><summary className="cursor-pointer py-2 text-sm text-slate-600">{c.optionalItemDetails}</summary><div className="mt-2 grid gap-3 sm:grid-cols-2"><Field label={c.originalWording}><input className="form-input" maxLength={500} value={item.description_th??""} onChange={e=>update(item.id,{description_th:e.target.value||null})}/></Field> <Field label={c.itemNotes}><input className="form-input" maxLength={2000} placeholder={c.itemNotesHelp} value={item.notes??""} onChange={e=>update(item.id,{notes:e.target.value||null})}/></Field></div></details>
 {preventativeReady&&<MaintenanceServiceFields item={item} data={data} vehicleId={form.vehicle_id} onChange={patch=>update(item.id,patch)}/>}<MaintenanceReminderFields item={item} form={form} data={data} onChange={patch=>update(item.id,patch)}/></div>;})}
 <button className="btn-secondary" type="button" onClick={()=>setItems([...items,{...newMaintenanceItem(crypto.randomUUID()),mode:"none"}])}>{c.addItem}</button>
  </div>
  <section aria-label={language==='th'?'สรุปการเชื่อมโยงประวัติซ่อม':'Maintenance history linking summary'} className="rounded-2xl border border-violet-200 bg-violet-50/60 p-4 space-y-2">
   <h4 className="font-semibold text-violet-950">🔗 {language==='th'?'สรุปงานซ่อมที่เชื่อมกับประวัติรถ':'Linked vehicle maintenance work'}</h4>
   <p className="text-xs text-slate-600">{language==='th'?'แสดงเฉพาะรายการที่เลือกชิ้นส่วน ประเภทงาน และยืนยันงานจริงแล้ว แก้ไขได้ในส่วนงานบริการของแต่ละรายการด้านบน':'Only items with a selected component, service action and confirmed work appear below. Edit the service details within each item above.'}</p>
   <p className="text-xs text-slate-600">{language==='th'?'วันที่ทำงาน':'Service date'}: <strong>{formatDate(form.service_date,language)}</strong></p>
   {linkedWork.length>0?<ul className="space-y-2">{linkedWork.map(i=><li key={i.id} className="rounded-xl border border-emerald-100 bg-white px-3 py-2 text-sm"><span className="font-semibold text-slate-900">{i.description}</span><span className="block text-xs text-emerald-800">✓ {i.service_key?.replaceAll('_',' ')} · {serviceActionLabel(i.service_action??'')}</span></li>)}</ul>:<p className="rounded-lg bg-white p-3 text-xs text-slate-600">{language==='th'?'ยังไม่มีรายการที่ยืนยันเพื่อเชื่อมประวัติ':'No confirmed component-linked work yet. Saving this receipt alone does not establish a replacement.'}</p>}
   {unconfirmedWork.length>0&&<p className="text-xs text-amber-900">⚠ {language==='th'?'มีรายการที่เลือกชิ้นส่วนแต่ยังไม่ยืนยันงาน':'Some component-linked items have not been confirmed'}: {unconfirmedWork.map(i=>i.description).join(', ')}</p>}
   <p className="text-[11px] text-slate-500">{language==='th'?'สรุปนี้ไม่ใช่การตรวจสภาพรถ และไม่เปลี่ยนกำหนดบริการโดยอัตโนมัติ':'This is not an inspection. Approved intervals and service scheduling remain controlled by existing EES logic.'}</p>
  </section><div className="rounded-2xl border border-violet-200 bg-violet-50 p-4"><output className="text-lg font-bold" aria-live="polite">{c.calculatedTotal}: {formatCurrency(total,language)}</output>{difference!==null&&<p className={`mt-2 font-semibold ${difference===0?"text-emerald-700":"text-amber-800"}`}>{difference===0?c.matched:`${c.difference}: ${formatCurrency(difference,language)}`}</p>}{difference!==null&&difference!==0&&<><p className="mt-2 text-sm">{c.mismatchWarning}</p><label className="mt-2 flex items-start gap-2 text-sm"><input className="!h-4 !w-4 shrink-0" type="checkbox" required checked={form.mismatch_confirmed} onChange={e=>set({mismatch_confirmed:e.target.checked})}/>{c.confirmMismatch}</label></>}</div>
 <section id="maintenance-receipts" className="scroll-mt-28 space-y-3"><h4 className="font-semibold text-violet-950">{c.receiptSection}</h4>
 {receiptUploading&&<div role="status" className="rounded-xl border border-violet-200 bg-violet-50 p-3 text-sm text-violet-900">{language==='th'?'กำลังแนบใบเสร็จต้นฉบับ':'Uploading original receipt'} · {receiptProgress??0}%</div>}
 {completedReceipt&&<p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">✓ {language==='th'?'แนบใบเสร็จเข้ากับรายการแล้ว':'Original receipt attached successfully.'}</p>}
 {savedRecord&&receiptFile&&receiptUploadError&&<div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"><strong>{language==='th'?'บันทึกงานซ่อมแล้ว แต่ยังแนบใบเสร็จไม่สำเร็จ':'Maintenance saved, but receipt upload failed.'}</strong><p className="mt-1">{language==='th'?'อย่ากดบันทึกงานซ่อมอีกครั้ง กดลองแนบไฟล์อีกครั้งแทน':'Do not save the maintenance record again. Retry the attachment below to avoid duplicating work.'}</p><button type="button" className="btn-secondary mt-3" disabled={receiptUploading||busy} onClick={()=>void attachReceipt(savedRecord.id,receiptFile)}>{language==='th'?'ลองแนบใบเสร็จอีกครั้ง':'Retry receipt upload'}</button></div>}
 {savedRecord&&receiptFile&&!receiptUploadError&&!receiptUploading&&!completedReceipt&&<button type="button" className="btn-secondary" onClick={()=>void attachReceipt(savedRecord.id,receiptFile)}>{language==='th'?'แนบใบเสร็จที่เลือก':'Attach selected receipt'}</button>}

 {savedRecord&&<MaintenanceAttachmentList attachments={data.attachments.filter(a=>a.record_id===savedRecord.id)} onChange={onSaved}/>}
 <MaintenanceUploader recordId={savedRecord?.id??null} onUploaded={onSaved} onStateChange={setUploadState}/>
 </section>
 <section className="space-y-3 rounded-2xl border border-slate-200 p-3 sm:p-4"><h4 className="font-semibold text-violet-950">{c.optionalSection}</h4><Field label={c.generalNotes}><textarea className="form-input" rows={3} maxLength={10000} placeholder={c.generalNotesHelp} value={form.notes??""} onChange={e=>set({notes:e.target.value||null})}/></Field>
 <details className="rounded-xl border border-slate-200 p-3"><summary className="cursor-pointer py-2 text-sm font-semibold">{c.downtimeOptional}</summary><p className="my-2 text-xs text-slate-500">{c.downtimeHelp}</p>
 <div className="grid gap-3 sm:grid-cols-2"><Field label={c.offRoad}><input className="form-input" type="datetime-local" max={timeInput(new Date().toISOString())} value={timeInput(form.off_road_at)} onChange={e=>set({off_road_at:timeValue(e.target.value)})}/></Field><Field label={c.returned}><input className="form-input" type="datetime-local" min={timeInput(form.off_road_at)||undefined} max={timeInput(new Date().toISOString())} value={timeInput(form.returned_at)} onChange={e=>set({returned_at:timeValue(e.target.value)})}/></Field></div><p className="text-xs text-slate-500">{c.thailandTime}</p></details>
 </section><div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-violet-100 bg-white/95 p-3 shadow-lg backdrop-blur"><strong className="text-sm">{c.calculatedTotal}: {formatCurrency(total,language)}</strong><button className="btn-primary min-h-11 w-full sm:w-auto" type="submit" disabled={busy||receiptUploading||uploadState.busy}>{busy?t.common.saving:receiptUploading||uploadState.busy?c.uploading:c.save}</button></div></fieldset>
 </form>
 </section>;
}
