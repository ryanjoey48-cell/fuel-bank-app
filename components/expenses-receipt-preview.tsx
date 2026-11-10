'use client';
import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { X, RefreshCw } from 'lucide-react';
import type { ExpenseAttachment } from '@/lib/expenses';
import { ExpensesPdfPreview } from './expenses-pdf-preview';
import s from './expenses-centre.module.css';

export function ExpensesReceiptPreview({attachment,th,resolve,onClose,onDownload}:{attachment:ExpenseAttachment;th:boolean;resolve:(a:ExpenseAttachment)=>Promise<string>;onClose:()=>void;onDownload:(a:ExpenseAttachment)=>void}) {
  const ref=useRef<HTMLDialogElement>(null),resolveRef=useRef(resolve);resolveRef.current=resolve;
  const [url,setUrl]=useState(''),[error,setError]=useState(false),[attempt,setAttempt]=useState(0);
  const t=(en:string,thai:string)=>th?thai:en;
  useEffect(()=>{const dialog=ref.current;const previous=document.activeElement as HTMLElement|null;dialog?.showModal();return()=>{dialog?.close();previous?.focus();};},[]);
  useEffect(()=>{let active=true;setUrl('');setError(false);void resolveRef.current(attachment).then(value=>{if(active)setUrl(value);}).catch(()=>{if(active)setError(true);});return()=>{active=false;};},[attachment,attempt]);
  const heic=/hei[cf]/i.test(attachment.mime),pdf=attachment.mime==='application/pdf';
  return <dialog ref={ref} className={s.receiptDialog} aria-label={t('Receipt preview','ตัวอย่างใบเสร็จ')} onCancel={e=>{e.preventDefault();onClose();}}><header><div><h2>{attachment.name}</h2><p className={s.muted}>{t('Original document · private access','เอกสารต้นฉบับ · การเข้าถึงส่วนตัว')}</p></div><button className={s.secondary} onClick={onClose} aria-label={t('Close receipt preview','ปิดตัวอย่างใบเสร็จ')}><X size={18}/></button></header><div className={s.previewDocument}>
    {!url&&!error?<p role="status"><span className={s.busy}/> {t('Loading original…','กำลังโหลดต้นฉบับ…')}</p>:null}
    {error?<p role="alert">{t('The preview is unavailable or expired. Refresh it or download the original.','ตัวอย่างไม่พร้อมใช้งานหรือหมดอายุ รีเฟรชหรือดาวน์โหลดต้นฉบับ')}</p>:url?pdf?<ExpensesPdfPreview source={url} th={th} title={t('Original PDF receipt','ใบเสร็จ PDF ต้นฉบับ')}/>:heic?<p>{t('This browser may not display HEIC/HEIF. Download the untouched original to open it.','เบราว์เซอร์นี้อาจแสดง HEIC/HEIF ไม่ได้ ดาวน์โหลดต้นฉบับเพื่อเปิด')}</p>:<Image src={url} alt={t('Original receipt','ใบเสร็จต้นฉบับ')} width={1200} height={1000} unoptimized onError={()=>setError(true)}/>:null}
  </div><footer><p className={s.muted}>{t('Originals are retained. Preview access expires; refresh when needed.','เก็บต้นฉบับไว้ ลิงก์ตัวอย่างมีอายุจำกัด รีเฟรชได้เมื่อจำเป็น')}</p><button className={s.secondary} onClick={()=>setAttempt(a=>a+1)}><RefreshCw size={15}/>{t('Refresh preview','รีเฟรชตัวอย่าง')}</button><button className={s.primary} onClick={()=>onDownload(attachment)}>{t('Download original','ดาวน์โหลดต้นฉบับ')}</button></footer></dialog>;
}
