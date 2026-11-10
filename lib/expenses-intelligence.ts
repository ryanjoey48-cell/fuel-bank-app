import type { Expense, ExpenseAttachment } from './expenses';
export type DuplicateReason = 'file'|'receipt'|'amount'|'date'|'supplier'|'vehicle';
export type DuplicateMatch = { expense: Expense; strength:'strong'|'possible'; reasons:DuplicateReason[]; version:string; other_version:string; resolution?:{note:string;actor:string;created_at:string}|null };
export const DUPLICATE_REASONS:Record<DuplicateReason,[string,string]>={file:['Identical receipt fingerprint','ลายนิ้วมือไฟล์ใบเสร็จตรงกัน'],receipt:['Same receipt number','เลขที่ใบเสร็จตรงกัน'],amount:['Same amount','ยอดเงินตรงกัน'],date:['Expense dates within 3 days','วันที่ค่าใช้จ่ายห่างไม่เกิน 3 วัน'],supplier:['Same supplier','ผู้ขายตรงกัน'],vehicle:['Same vehicle','รถตรงกัน']};
const norm=(s:string)=>s.normalize('NFKC').trim().toLowerCase();
export function duplicateMatches(expense:Expense,rows:Expense[],attachments:ExpenseAttachment[]):DuplicateMatch[]{
  if(expense.status==='voided')return [];
  const hashes=new Set(attachments.filter(a=>a.expense_id===expense.id&&a.state==='ready').map(a=>a.sha256));
  return rows.flatMap(other=>{
    if(other.id===expense.id||other.status==='voided')return [];
    const a=expense.data,b=other.data, reasons:DuplicateReason[]=[];
    if(attachments.some(f=>f.expense_id===other.id&&f.state==='ready'&&hashes.has(f.sha256)))reasons.push('file');
    if(a.document_number&&norm(a.document_number)===norm(b.document_number))reasons.push('receipt');
    if(a.amount_satang===b.amount_satang)reasons.push('amount');
    if(Math.abs(Date.parse(a.date)-Date.parse(b.date))<=3*86400000)reasons.push('date');
    if(a.supplier&&norm(a.supplier)===norm(b.supplier))reasons.push('supplier');
    if(a.allocation==='vehicle'&&b.allocation==='vehicle'&&a.vehicle_id===b.vehicle_id)reasons.push('vehicle');
    const has=(key:DuplicateReason)=>reasons.includes(key),strong=has('file')||has('receipt')&&has('supplier')&&has('amount');
    const possible=has('amount')&&has('date')&&(has('supplier')||has('receipt')||has('vehicle'))||has('receipt')&&has('supplier');
    return strong||possible?[{expense:other,strength:strong?'strong' as const:'possible' as const,reasons,version:fixtureEvidenceVersion(expense,attachments),other_version:fixtureEvidenceVersion(other,attachments)}]:[];
  });
}
export function fixtureEvidenceVersion(e:Expense,attachments:ExpenseAttachment[]){return JSON.stringify([e.revision,attachments.filter(a=>a.expense_id===e.id).map(a=>[a.id,a.sha256,a.state]).sort()]);}
export type ExpenseBooking = {id:string;booking_id:string|null;job_order_number?:string|null;booking_date:string;client_name:string|null;vehicle_registration:string|null;vehicle:string|null;driver:string|null};
export type BookingLink = {expense_id:string;booking_id:string|null;revision:number;note:string;booking?:ExpenseBooking|null};
export function bookingVehicleMismatch(registration:string,booking:ExpenseBooking|null){return !!registration&&!!booking?.vehicle_registration&&norm(registration).replace(/[\s-]/g,'')!==norm(booking.vehicle_registration).replace(/[\s-]/g,'');}
/** Synthetic bookings are never used as fallback for real authenticated requests. */
export const FIXTURE_BOOKINGS:ExpenseBooking[]=[{id:'33000000-0000-4000-8000-000000000001',booking_id:'SYNTHETIC-JOB-001',job_order_number:'WO-SYNTHETIC-001',booking_date:'2026-11-10',client_name:'Synthetic customer only',vehicle_registration:'TEST-001',vehicle:null,driver:'Synthetic driver'},{id:'33000000-0000-4000-8000-000000000002',booking_id:'SYNTHETIC-JOB-002',job_order_number:'WO-SYNTHETIC-002',booking_date:'2026-11-10',client_name:'Synthetic second customer',vehicle_registration:'TEST-999',vehicle:null,driver:'Synthetic driver B'}];
