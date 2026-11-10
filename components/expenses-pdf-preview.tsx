'use client';
import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, PDFDocumentLoadingTask, RenderTask } from 'pdfjs-dist';
import s from './expenses-centre.module.css';

/** Canvas previews do not depend on a phone/browser PDF plug-in. Originals are never modified. */
export function ExpensesPdfPreview({source,th,title}:{source:string;th:boolean;title:string}) {
  const canvas=useRef<HTMLCanvasElement>(null);
  const [document,setDocument]=useState<PDFDocumentProxy|null>(null),[page,setPage]=useState(1),[error,setError]=useState(false),[loading,setLoading]=useState(true);
  const t=(en:string,thai:string)=>th?thai:en;
  useEffect(()=>{
    let active=true,task:PDFDocumentLoadingTask|undefined;const abort=new AbortController();
    setDocument(null);setPage(1);setError(false);setLoading(true);
    void(async()=>{
      try{
        const [pdfjs,response]=await Promise.all([import('pdfjs-dist'),fetch(source,{cache:'no-store',signal:abort.signal,referrerPolicy:'no-referrer'})]);
        if(!response.ok)throw new Error('PDF_UNAVAILABLE');
        pdfjs.GlobalWorkerOptions.workerSrc=new URL('pdfjs-dist/build/pdf.worker.min.mjs',import.meta.url).toString();
        const bytes=new Uint8Array(await response.arrayBuffer());if(!active)return;
        task=pdfjs.getDocument({data:bytes,enableXfa:false,useSystemFonts:true,stopAtErrors:true});
        const pdf=await task.promise;if(active)setDocument(pdf);
      }catch{if(active){setError(true);setLoading(false);}}
    })();
    return()=>{active=false;abort.abort();void task?.destroy().catch(()=>{});};
  },[source]);
  useEffect(()=>{
    if(!document)return;let active=true,render:RenderTask|undefined;setLoading(true);
    void(async()=>{
      try{
        const sheet=await document.getPage(page),target=canvas.current;if(!active||!target)return;
        const original=sheet.getViewport({scale:1});const width=target.parentElement?.clientWidth||700;
        const scale=Math.min(Math.max(200,width)/original.width,1200/original.width,1800/original.height)*Math.min(window.devicePixelRatio||1,2);
        const viewport=sheet.getViewport({scale});target.width=Math.ceil(viewport.width);target.height=Math.ceil(viewport.height);
        const context=target.getContext('2d');if(!context)throw new Error('PDF_CANVAS');
        render=sheet.render({canvas:target,canvasContext:context,viewport});await render.promise;
        if(active){target.dataset.pdfRendered='true';setError(false);setLoading(false);}
      }catch{if(active){setError(true);setLoading(false);}}
    })();return()=>{active=false;render?.cancel();};
  },[document,page]);
  return <div className={s.pdfCanvasPreview}>
    {loading?<p role="status"><span className={s.busy}/> {t('Rendering PDF…','กำลังแสดง PDF…')}</p>:null}
    {error?<p role="alert">{t('PDF preview is unavailable. Refresh the preview or open the original document.','ไม่สามารถแสดง PDF ได้ รีเฟรชตัวอย่างหรือเปิดเอกสารต้นฉบับ')}</p>:null}
    <canvas ref={canvas} role="img" aria-label={title} hidden={loading||error}/>
    {document?<div className={s.pdfNavigation}><button type="button" className={s.secondary} disabled={loading||page<=1} onClick={()=>setPage(p=>p-1)}>{t('Previous page','หน้าก่อน')}</button><span>{page} / {document.numPages}</span><button type="button" className={s.secondary} disabled={loading||page>=document.numPages} onClick={()=>setPage(p=>p+1)}>{t('Next page','หน้าถัดไป')}</button></div>:null}
  </div>;
}

export function ExpensesSelectedPdf({source,th}:{source:string;th:boolean}) {
  const [open,setOpen]=useState(false);
  return <details onToggle={e=>setOpen(e.currentTarget.open)}><summary className={s.link}>{th?'ตัวอย่าง PDF':'Preview PDF'}</summary>{open?<ExpensesPdfPreview source={source} th={th} title={th?'ใบเสร็จ PDF ที่เลือก':'Selected PDF receipt'}/>:null}</details>;
}
