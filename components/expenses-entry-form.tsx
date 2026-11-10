'use client';

import { Camera, ImagePlus, FileUp, ReceiptText, X, FileText, Check, RotateCw } from 'lucide-react';
import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { emptyExpense, money, validateExpense, type Expense, type ExpenseInput, type ExpenseSnapshot, type ExpenseAttachment } from '@/lib/expenses';
import { ExpensesBookingPicker } from './expenses-booking-picker';
import type { BookingLink, ExpenseBooking } from '@/lib/expenses-intelligence';
import { ExpensesSelectedPdf } from './expenses-pdf-preview';
import s from './expenses-centre.module.css';

export type ExpenseCommand = (command: string, body: Record<string, unknown>) => Promise<unknown>;
export type LocalReceipt = { file: File; url: string; state: 'waiting' | 'uploading' | 'ready' | 'failed'; progress?: number };
type Props = { fixture:boolean;bookingLink:BookingLink|null;linkBooking:(id:string,booking_id:string|null,revision:number)=>Promise<BookingLink>;snapshot: ExpenseSnapshot; initial: Expense | null; template?: ExpenseInput | null; th: boolean; command: ExpenseCommand; upload: (id: string, file: File, onProgress?: (percent:number)=>void) => Promise<ExpenseAttachment>; remove: (id: string, attachment: string, note: string) => Promise<void>; onDone: (id: string) => void; onCancel: () => void; onError: (e: unknown) => void };
export function ExpensesEntryForm({ fixture, bookingLink, linkBooking, snapshot, initial, template, th, command, upload, remove, onDone, onCancel, onError }: Props) {
  const t = (en: string, thai: string) => th ? thai : en;
  const [input, setInput] = useState<ExpenseInput>(initial?.data || template || emptyExpense());
  const [booking,setBooking]=useState<ExpenseBooking|null>(bookingLink?.booking||null),[bookingId,setBookingId]=useState<string|null>(bookingLink?.booking_id||null);
  const savedLink=useRef(bookingLink);
  const [files, setFiles] = useState<LocalReceipt[]>([]);
  const filesRef = useRef(files); filesRef.current = files;
  const [busy, setBusy] = useState(false); const lock = useRef(false);
  const [record, setRecord] = useState<Expense | null>(initial);
  const requestKey = useRef(''); const [restored, setRestored] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [categoryQuery,setCategoryQuery]=useState(''); const [templateConfirmed,setTemplateConfirmed]=useState(false);
  const [vehicleQuery, setVehicleQuery] = useState(''); const [removalNote, setRemovalNote] = useState('');
  const storageKey = `ees-expense-draft-v1:${snapshot.user_id}:${initial?.id || 'new'}`;
  useEffect(() => {
    requestKey.current = crypto.randomUUID();
    if (!initial && !template) {
      try { const saved = sessionStorage.getItem(storageKey); if (saved) { const draft = JSON.parse(saved); if (draft.input && draft.key) { setInput({ ...emptyExpense(), ...draft.input }); requestKey.current = draft.key; if (draft.record) setRecord(draft.record); if(draft.bookingId!==undefined)setBookingId(draft.bookingId);if(draft.booking)setBooking(draft.booking);if(draft.savedLink)savedLink.current=draft.savedLink; setDirty(true); } } } catch { /* Optional recovery only. */ }
    }
    setRestored(true);
    return () => filesRef.current.forEach(f => URL.revokeObjectURL(f.url));
  }, [storageKey, initial, template]);
  useEffect(() => {
    if (!restored || !dirty) return;
    try { sessionStorage.setItem(storageKey, JSON.stringify({ input, key: requestKey.current, record,booking,bookingId,savedLink:savedLink.current })); } catch { /* Saving remains available if browser storage is disabled. */ }
  }, [input, record, booking, bookingId, storageKey, restored, dirty]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty || filesRef.current.length) { event.preventDefault(); } };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const set = <K extends keyof ExpenseInput>(key: K, value: ExpenseInput[K]) => { setInput(old => ({ ...old, [key]: value, ...(key==='payment_status'?{paid_amount:value==='paid'?old.amount:value==='unpaid'?'0.00':''}:key==='amount'&&old.payment_status==='paid'?{paid_amount:String(value)}:{}) })); setDirty(true); };
  const receipts = snapshot.attachments.filter(a => a.expense_id === record?.id && a.state !== 'removed');
  const addFiles = (list: FileList | null) => {
    if (!list) return;
    try {
      const next = Array.from(list);
      if (files.filter(f=>f.state!=='ready').length + receipts.length + next.length > 12) throw new Error('ATTACHMENT_LIMIT');
      if (next.some(f => f.size > 15 * 1024 * 1024 || !f.size)) throw new Error('FILE_SIZE');
      if (next.some(f => !/\.(jpe?g|png|webp|heic|heif|pdf)$/i.test(f.name))) throw new Error('FILE_TYPE');
      setFiles(old => [...old, ...next.map(file => ({ file, url: URL.createObjectURL(file), state: 'waiting' as const }))]); setDirty(true);
    } catch (error) { onError(error); }
  };
  async function save(submit: boolean) {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try {
      validateExpense(input);
      if(submit&&template&&!templateConfirmed)throw new Error('TEMPLATE_CONFIRMATION_REQUIRED');
      if (submit && !files.length && !receipts.some(a => a.state === 'ready') && !input.missing_receipt_reason.trim()) throw new Error('MISSING_RECEIPT_REASON');
      let current = await command(record ? 'edit' : 'create', { ...(record ? { id: record.id, revision: record.revision } : { request_key: requestKey.current }), input }) as Expense;
      // A lost create response may be retried after the user has corrected the form.
      // Reuse the original draft, then save those corrections before uploading/submitting.
      if (!record && Object.entries(input).some(([key,value]) => current.data[key as keyof ExpenseInput] !== value)) {
        current = await command('edit', { id: current.id, revision: current.revision, input }) as Expense;
      }
      setRecord(current);
      if((savedLink.current?.booking_id||null)!==bookingId)savedLink.current=await linkBooking(current.id,bookingId,savedLink.current?.revision||0);
      for (let index = 0; index < files.length; index++) {
        if (files[index].state === 'ready') continue;
        setFiles(old => old.map((f, i) => i === index ? { ...f, state: 'uploading', progress:0 } : f));
        try { await upload(current.id, files[index].file, progress=>setFiles(old=>old.map((f,i)=>i===index?{...f,progress}:f))); setFiles(old => old.map((f, i) => i === index ? { ...f, state: 'ready' } : f)); }
        catch (error) { setFiles(old => old.map((f, i) => i === index ? { ...f, state: 'failed' } : f)); throw error; }
      }
      if (submit) current = await command('transition', { id: current.id, revision: current.revision, status: 'submitted' }) as Expense;
      try { sessionStorage.removeItem(storageKey); } catch { /* Recovery is optional. */ }
      setDirty(false); onDone(current.id);
    } catch (error) { onError(error); }
    finally { setBusy(false); lock.current = false; }
  }
  const field = (key: keyof ExpenseInput, en: string, thai: string, type = 'text') => <label className={s.field}>{t(en, thai)}<input aria-label={t(en, thai)} type={type} value={String(input[key])} onChange={e => set(key, e.target.value)} /></label>;
  const select = (key: keyof ExpenseInput, en: string, thai: string, options: [string,string,string][]) => <label className={s.field}>{t(en, thai)}<select aria-label={t(en, thai)} value={String(input[key])} onChange={e => set(key, e.target.value)}>{options.map(([value, english, thaiLabel]) => <option key={value} value={value}>{t(english, thaiLabel)}</option>)}</select></label>;
  return <form onSubmit={e => { e.preventDefault(); void save(true); }} className={s.formLayout} aria-busy={busy}>
    <section className={s.card}><div className={s.sectionHead}><div><h2>{t(initial ? 'Correct expense' : 'A few details. All done.', initial ? 'แก้ไขรายการ' : 'กรอกนิดเดียว ก็เรียบร้อย')}</h2><p className={s.muted}>{t('Capture the receipt, then tell us what it was for.', 'แนบใบเสร็จ แล้วระบุค่าใช้จ่าย')}</p></div><span className={s.badge}>{t('THB · ฿', 'บาท · ฿')}</span></div>
      {record && !initial ? <p className={s.success}>{fixture?t('Fixture draft only. Finish attachments and submit for testing.', 'ร่างข้อมูลทดสอบเท่านั้น แนบเอกสารและส่งเพื่อลองใช้'):t('Draft saved. Finish attachments and submit when ready.', 'บันทึกร่างแล้ว แนบเอกสารและส่งตรวจเมื่อพร้อม')} · {record.id.slice(0,8)}</p> : null}
      <div className={s.shortcuts} aria-label={t('Expense shortcuts','ทางลัดค่าใช้จ่าย')}>{snapshot.categories.filter(c=>c.active&&!c.parent_id).slice(0,5).map(c=><button type="button" key={c.id} aria-pressed={input.category_id===c.id} onClick={()=>{set('category_id',c.id);setCategoryQuery('');}}>{th?c.th:c.en}</button>)}{snapshot.centres.filter(c=>c.active).map(c=><button type="button" key={c.id} aria-pressed={input.allocation==='centre'&&input.cost_centre_id===c.id} onClick={()=>{setInput(old=>({...old,allocation:'centre',cost_centre_id:c.id}));setDirty(true);}}>{th?c.th:c.en}</button>)}</div>
      <div className={s.fields}>
        <label className={`${s.field} ${s.amount} ${s.full}`}>{t('Total amount · THB *', 'ยอดรวม · บาท *')}<input aria-label={t("Total amount · THB *", "ยอดรวม · บาท *")} autoComplete="off" inputMode="decimal" placeholder="0.00" required value={input.amount} onChange={e => set('amount', e.target.value)} /><small>{t('Enter the final total payable, including VAT where applicable.', 'ระบุยอดรวมที่ต้องชำระ รวมภาษีมูลค่าเพิ่มถ้ามี')}</small></label>
        <label className={s.field}>{t('Expense date *', 'วันที่ค่าใช้จ่าย *')}<input required type="date" value={input.date} onChange={e => set('date',e.target.value)} /></label>
        <label className={s.field}>{t('Category *', 'หมวดหมู่ *')}<input aria-label={t('Search categories','ค้นหาหมวดหมู่')} placeholder={t('Search category…','ค้นหาหมวดหมู่…')} value={categoryQuery} onChange={e=>setCategoryQuery(e.target.value)}/><select aria-label={t("Category *", "หมวดหมู่ *")} required value={input.category_id} onChange={e => set('category_id',e.target.value)}><option value="">{t('Choose category', 'เลือกหมวดหมู่')}</option>{snapshot.categories.filter(c => (c.id===input.category_id||`${c.en} ${c.th}`.normalize('NFKC').toLowerCase().includes(categoryQuery.normalize('NFKC').toLowerCase())) && c.active && (!c.parent_id || snapshot.categories.some(p => p.id === c.parent_id && p.active))).sort((a,b) => a.position-b.position).map(c => <option key={c.id} value={c.id}>{c.parent_id ? '↳ ' : ''}{th ? c.th : c.en}</option>)}</select></label>
        <label className={`${s.field} ${s.full}`}>{t('Allocate to *', 'จัดสรรให้ *')}<select aria-label={t("Allocate to *", "จัดสรรให้ *")} value={input.allocation} onChange={e => set('allocation',e.target.value)}><option value="vehicle">{t('Specific vehicle', 'รถที่ระบุ')}</option><option value="centre">{t('Depot, office or company cost centre', 'คลัง สำนักงาน หรือศูนย์ต้นทุนบริษัท')}</option></select></label>
        {input.allocation === 'vehicle' ? <div className={`${s.field} ${s.full}`}><label htmlFor="expense-vehicle-search">{t('Search registration · EN / TH', 'ค้นหาทะเบียน · EN / TH')}</label><input id="expense-vehicle-search" value={vehicleQuery} onChange={e => setVehicleQuery(e.target.value)} placeholder={t('Type registration or vehicle name…', 'พิมพ์ทะเบียนหรือชื่อรถ…')} /><label htmlFor="expense-vehicle">{t('Vehicle *', 'รถ *')}</label><select id="expense-vehicle" required value={input.vehicle_id} onChange={e => set('vehicle_id',e.target.value)}><option value="">{t('Select a vehicle', 'เลือกรถ')}</option>{snapshot.vehicles.filter(v => v.id === input.vehicle_id || `${v.vehicle_reg} ${v.vehicle_name}`.normalize('NFKC').toLowerCase().includes(vehicleQuery.normalize('NFKC').toLowerCase())).map(v => <option key={v.id} value={v.id}>{v.vehicle_reg} · {v.vehicle_name}</option>)}</select><small>{t('Selected from the existing Vehicles database. Personal-car costs stay separate from fleet reports.', 'เลือกจากฐานข้อมูลรถเดิม ค่าใช้จ่ายรถส่วนบุคคลแยกจากรายงานกองรถ')}</small></div> : <label className={`${s.field} ${s.full}`}>{t('Cost centre *', 'ศูนย์ต้นทุน *')}<select aria-label={t("Cost centre *", "ศูนย์ต้นทุน *")} required value={input.cost_centre_id} onChange={e => set('cost_centre_id',e.target.value)}>{snapshot.centres.filter(c => c.active).map(c => <option key={c.id} value={c.id}>{th ? c.th : c.en}</option>)}</select></label>}
        <label className={`${s.field} ${s.full}`}>{t('What was it for? *', 'ค่าใช้จ่ายอะไร? *')}<input required maxLength={500} placeholder={t('e.g. Parking for delivery', 'เช่น ค่าจอดรถส่งสินค้า')} value={input.description} onChange={e => set('description',e.target.value)} /></label>
      </div>
      <ExpensesBookingPicker value={booking} onChange={value=>{setBooking(value);setBookingId(value?.id||null);setDirty(true);}} registration={input.allocation==='vehicle'?snapshot.vehicles.find(v=>v.id===input.vehicle_id)?.vehicle_reg||'':''} fixture={fixture} th={th}/>
      {bookingId&&!booking?<p className={s.notice}>{t('Existing job is unavailable. Its identifier will be kept unless you remove the link.','งานเดิมไม่พร้อมใช้งาน จะเก็บรหัสไว้จนกว่าจะนำลิงก์ออก')} · {bookingId} <button type="button" className={s.link} onClick={()=>{setBookingId(null);setDirty(true);}}>{t('Remove link','นำลิงก์ออก')}</button></p>:null}
      <details className={s.details}><summary>{t('Supplier, payment & more', 'ผู้ขาย การชำระเงิน และรายละเอียดเพิ่มเติม')}</summary><div className={s.fields}>
        {field('supplier','Supplier / vendor','ผู้ขาย')}{field('document_number','Receipt / invoice number','เลขที่ใบเสร็จ / ใบกำกับภาษี')}
        {select('payment_status','Payment status','สถานะการชำระเงิน',[['unpaid','Not yet paid','ยังไม่ชำระ'],['partially_paid','Partially paid','ชำระบางส่วน'],['paid','Already paid','ชำระแล้ว']])}
        {input.payment_status==='partially_paid'?<label className={s.field}>{t('Total paid so far · THB','ยอดชำระสะสม · บาท')}<input inputMode="decimal" value={input.paid_amount||''} onChange={e=>set('paid_amount',e.target.value)} aria-label={t('Total paid so far · THB','ยอดชำระสะสม · บาท')}/></label>:null}
        {select('payment_method','Payment method','วิธีชำระเงิน',[['','Not specified','ไม่ระบุ'],['cash','Cash','เงินสด'],['transfer','Bank transfer','โอนเงิน'],['card','Card','บัตร'],['other','Other','อื่น ๆ']])}
        {field('paid_by','Paid by','ชำระโดย')}
        {select('cost_treatment','Cost treatment','ประเภทต้นทุน',[['internal','Internal company expense','ค่าใช้จ่ายบริษัท'],['rebillable','Customer-rebillable · pending Finance','เรียกเก็บลูกค้าได้ · รอฝ่ายการเงิน'],['customer_charge','Customer charge already in Finance','ยอดเรียกเก็บที่มีในศูนย์การเงินแล้ว']])}
        {field('related_job','Legacy job note · unverified','บันทึกงานเดิม · ยังไม่ยืนยัน')}{field('related_trip','Related Trip Journey reference (optional)','อ้างอิงเที่ยวรถ (ถ้ามี)')}
        <label className={s.checkbox}><input type="checkbox" checked={input.reimbursement} onChange={e => set('reimbursement',e.target.checked)} />{t('Reimbursement required','ต้องเบิกคืน')}</label>
        <label className={s.checkbox}><input type="checkbox" checked={input.recurring} onChange={e => set('recurring',e.target.checked)} />{t('Recurring cost','ค่าใช้จ่ายประจำ')}</label>
        <label className={`${s.field} ${s.full}`}>{t('Notes','หมายเหตุ')}<textarea rows={3} value={input.notes} maxLength={2000} onChange={e => set('notes',e.target.value)} /></label>
      </div><p className={s.footer}>{t('Rebillable costs do not change any invoice. Finance Centre remains authoritative.', 'ค่าใช้จ่ายเรียกเก็บต่อไม่เปลี่ยนใบแจ้งหนี้ ศูนย์การเงินเป็นผู้กำหนดยอด')}</p></details>
      <details className={s.details}><summary>{t('VAT & tax documents','ภาษีมูลค่าเพิ่มและเอกสารภาษี')}</summary><div className={s.fields}>
        {select('document_type','Document type','ประเภทเอกสาร',[['receipt','Receipt','ใบเสร็จ'],['tax_invoice','Tax invoice','ใบกำกับภาษี'],['invoice','Invoice','ใบแจ้งหนี้'],['other','Other','อื่น ๆ']])}
        {select('vat_basis','Original document amount basis','ฐานยอดเงินในเอกสาร',[['unknown','Unknown','ไม่ทราบ'],['inclusive','VAT inclusive','รวม VAT'],['exclusive','VAT exclusive','ไม่รวม VAT'],['none','No VAT stated','ไม่ระบุ VAT']])}
        {field('vat_amount','VAT amount · THB','ภาษีมูลค่าเพิ่ม · บาท')}{field('supplier_tax_id','Supplier tax ID','เลขประจำตัวผู้เสียภาษีผู้ขาย')}
        {snapshot.capabilities.approve ? select('tax_review','Tax document review','ตรวจสอบเอกสารภาษี',[['unreviewed','Unreviewed','ยังไม่ตรวจสอบ'],['verified','Verified by authorised reviewer','ตรวจโดยผู้มีอำนาจแล้ว'],['not_eligible','Not eligible (reviewed)','ไม่เข้าเกณฑ์ (ตรวจแล้ว)']]) : null}
      </div><p className={s.footer}>{t('VAT recovery is never assumed. The amount above is always the final payable total; review the original document separately.', 'ไม่สรุปสิทธิขอคืน VAT อัตโนมัติ ยอดด้านบนคือยอดรวมที่ต้องชำระเสมอ โปรดตรวจเอกสารต้นฉบับ')}</p></details>
      <details className={s.details}><summary>{t('Link an existing cost · avoid counting twice','เชื่อมต้นทุนเดิม · ป้องกันการนับซ้ำ')}</summary><div className={s.fields}>
        {select('source','Source','แหล่งข้อมูล',[['standalone','New standalone expense','ค่าใช้จ่ายใหม่'],['maintenance','Existing maintenance record','รายการซ่อมบำรุงเดิม'],['insurance','Existing insurance record','ประกันภัยเดิม'],['fuel','Existing fuel transaction','รายการน้ำมันเดิม'],['finance','Existing Finance expense','ค่าใช้จ่ายการเงินเดิม'],['other','Other recognised source','แหล่งอื่น']])}
        {field('source_id','Source record reference','อ้างอิงรายการต้นทาง')}
      </div><p className={s.footer}>{t('Linked records are reconciliation references and are excluded from Expenses Centre spending totals. Existing source records are untouched.', 'รายการที่เชื่อมใช้อ้างอิงกระทบยอด และไม่นับในยอดรวมศูนย์ค่าใช้จ่าย ไม่แก้ไขรายการต้นทาง')}</p></details>
      {template?<label className={s.checkbox}><input type="checkbox" checked={templateConfirmed} onChange={e=>setTemplateConfirmed(e.target.checked)}/>{t('I have checked the actual invoice and amount for this occurrence.','ฉันตรวจใบแจ้งหนี้และยอดเงินจริงของงวดนี้แล้ว')}</label>:null}
      <div className={s.formFooter}><button type="button" className={s.secondary} disabled={busy} onClick={onCancel}>{t('Keep for later','เก็บไว้ก่อน')}</button><button type="button" className={s.secondary} disabled={busy || !snapshot.ready} onClick={() => void save(false)}>{t('Save draft','บันทึกร่าง')}</button><button className={s.primary} type="submit" disabled={busy || !snapshot.ready}>{busy ? <span className={s.busy} /> : <Check size={16} />}{busy ? t('Saving…','กำลังบันทึก…') : files.some(f => f.state === 'failed') ? t('Retry & submit','ลองอีกครั้งและส่งตรวจ') : t('Submit expense','ส่งตรวจค่าใช้จ่าย')}</button></div>
    </section>
    <aside className={s.receiptPanel}><section className={s.card}><h2>{t('Receipt first. Details second.','แนบใบเสร็จก่อน กรอกทีหลัง')}</h2><p className={`${s.muted} mb-4`}>{t('Keep every original with the expense.','เก็บต้นฉบับทุกฉบับกับรายการ')}</p><div className={s.upload}><ReceiptText size={30} strokeWidth={1.4} /><strong>{t('Add your receipt','เพิ่มใบเสร็จ')}</strong><p className={s.muted}>{t('Up to 12 files · 15 MB each','สูงสุด 12 ไฟล์ · ไฟล์ละ 15 MB')}</p><div className={s.uploadActions}>
      <label><Camera size={16}/>{t('Take photo','ถ่ายรูป')}<input className="sr-only" type="file" accept="image/*" capture="environment" disabled={busy} onChange={e => { addFiles(e.target.files); e.target.value=''; }} /></label>
      <label><ImagePlus size={16}/>{t('Photos','รูปภาพ')}<input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" multiple disabled={busy} onChange={e => { addFiles(e.target.files); e.target.value=''; }} /></label>
      <label><FileUp size={16}/>{t('PDF','PDF')}<input className="sr-only" type="file" accept="application/pdf,.pdf" multiple disabled={busy} onChange={e => { addFiles(e.target.files); e.target.value=''; }} /></label>
    </div></div>
    {files.map((f,i) => <div className={s.attachment} key={f.url}>{f.file.type.startsWith('image/') && !/hei[cf]/i.test(f.file.type+' '+f.file.name) ? <Image src={f.url} width={52} height={58} unoptimized alt={t('Receipt preview','ตัวอย่างใบเสร็จ')} /> : <FileText size={25}/>}<div className={s.attachmentText}><a href={f.url} target="_blank" rel="noreferrer" className={s.link}>{f.file.name}</a><p>{money(f.file.size / 1024 * 100)} KB · {f.state === 'ready' ? t('Uploaded','อัปโหลดแล้ว') : f.state === 'failed' ? t('Failed · retry when saving','ไม่สำเร็จ · ลองใหม่เมื่อบันทึก') : f.state === 'uploading' ? (f.progress===99?t('Verifying original…','กำลังตรวจยืนยันต้นฉบับ…'):`${t('Uploading','กำลังอัปโหลด')} ${f.progress||0}%`) : t('Ready to upload','พร้อมอัปโหลด')}</p>{f.state==='uploading'?<progress max={100} value={f.progress||0} aria-label={t('Receipt upload progress','ความคืบหน้าอัปโหลดใบเสร็จ')}/>:null}{/hei[cf]/i.test(f.file.type+' '+f.file.name)?<small>{t('HEIC/HEIF original retained. Inline preview is unavailable in some browsers; use the original download.','เก็บต้นฉบับ HEIC/HEIF ไว้ บางเบราว์เซอร์แสดงตัวอย่างไม่ได้ ใช้การดาวน์โหลดต้นฉบับ')}</small>:null}{f.file.type==='application/pdf'?<ExpensesSelectedPdf source={f.url} th={th}/>:null}</div>{f.state === 'failed' ? <RotateCw size={16}/> : null}{f.state !== 'ready' ? <button type="button" aria-label={t('Remove attachment','นำไฟล์ออก')} disabled={busy} onClick={() => { URL.revokeObjectURL(f.url); setFiles(old => old.filter((_,index) => i !== index)); }}><X size={17}/></button> : <Check size={16}/>}</div>)}
    {receipts.filter(a => !files.some(f => f.state === 'ready' && f.file.name === a.name)).map(a => <div className={s.attachment} key={a.id}><FileText size={20}/><div className={s.attachmentText}>{a.name}<p>{a.state === 'ready' ? t('Stored original','เก็บต้นฉบับแล้ว') : t('Upload incomplete · choose the same file to retry','อัปโหลดไม่ครบ · เลือกไฟล์เดิมเพื่อลองอีกครั้ง')}</p></div><button type="button" disabled={busy || !removalNote.trim()} aria-label={t('Remove stored attachment','นำเอกสารที่เก็บออก')} onClick={async () => { try { await remove(record!.id,a.id,removalNote); } catch (error) { onError(error); } }}><X size={17}/></button></div>)}
    {receipts.length ? <label className={`${s.field} mt-3`}>{t('Reason for removing a stored receipt','เหตุผลที่นำเอกสารออก')}<input value={removalNote} onChange={e => setRemovalNote(e.target.value)}/></label> : null}
    <label className={`${s.field} mt-5`}>{t('No receipt? Tell the reviewer why.','ไม่มีใบเสร็จ? ระบุเหตุผลให้ผู้ตรวจสอบ')}<textarea rows={2} value={input.missing_receipt_reason} onChange={e => set('missing_receipt_reason',e.target.value)} placeholder={t('Required if submitting without a receipt','ต้องระบุเมื่อส่งโดยไม่มีใบเสร็จ')} /></label><p className={s.footer}>{t('Text is recovered in this browser tab where available. Files must be reselected after a refresh. This is not offline saving.','กู้ข้อความในแท็บนี้ได้เมื่อเบราว์เซอร์รองรับ ต้องเลือกไฟล์ใหม่หลังรีเฟรช ไม่ใช่การบันทึกออฟไลน์')}</p></section></aside>
  </form>;
}
