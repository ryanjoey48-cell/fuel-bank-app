/** Expenses Centre contract. All money is integer satang; no legacy ledger writes. */
import type { ExpensesReadiness } from './expenses-readiness-state';
export type { ExpensesReadiness };
export type ExpenseStatus = 'draft' | 'submitted' | 'needs_information' | 'approved' | 'rejected' | 'closed' | 'voided';
export type PaymentStatus = 'unpaid' | 'partially_paid' | 'paid';
export type ExpenseCategory = { id: string; en: string; th: string; parent_id: string | null; active: boolean; position: number };
export type CostCentre = { id: string; en: string; th: string; active: boolean };
export type ExpenseVehicle = { id: string; vehicle_reg: string; vehicle_name: string; vehicle_category?: string | null; vehicle_type?: string | null };
export type ExpenseInput = {
  date: string; amount: string; category_id: string; allocation: string; vehicle_id: string; cost_centre_id: string;
  description: string; supplier: string; payment_method: string; paid_by: string; document_number: string; notes: string;
  document_type: string; vat_basis: string; vat_amount: string; supplier_tax_id: string; tax_review: string;
  reimbursement: boolean; related_job: string; related_trip: string; recurring: boolean;
  source: string; source_id: string; cost_treatment: string; payment_status: string; paid_amount?: string; missing_receipt_reason: string;
};
export type Expense = {
  id: string; created_by: string; created_at: string; updated_at: string; revision: number; status: ExpenseStatus;
  data: ExpenseInput & { amount_satang: number; vat_satang: number; paid_satang?: number; category_en: string; category_th: string; vehicle_reg: string; centre_en: string; centre_th: string; submitted_by: string };
};
export type ExpenseAttachment = { id: string; expense_id: string; name: string; mime: string; size: number; sha256: string; state: 'pending' | 'ready' | 'removed'; created_at: string };
export type ExpenseAudit = { id: string; expense_id: string | null; actor: string; action: string; note: string; old_value: unknown; new_value: unknown; created_at: string };
export type ExpenseTemplate = { id: string; name: string; next_date: string; frequency: 'monthly' | 'yearly'; active: boolean; input: ExpenseInput };
export type ExpenseSnapshot = { expenses: Expense[]; categories: ExpenseCategory[]; centres: CostCentre[]; attachments: ExpenseAttachment[]; audit: ExpenseAudit[]; templates: ExpenseTemplate[]; vehicles: ExpenseVehicle[]; capabilities: { write: boolean; review: boolean; approve: boolean; admin: boolean }; user_id: string; ready: boolean; readiness?: ExpensesReadiness };

export const DEFAULT_CATEGORIES: ExpenseCategory[] = [
  ['vehicle', 'Vehicle expenses', 'ค่าใช้จ่ายรถ'], ['depot', 'Depot and lorry park', 'คลังและลานจอดรถ'],
  ['office', 'Office and administration', 'สำนักงานและธุรการ'], ['transport', 'Transport operations', 'การขนส่ง'],
  ['staff', 'Staff and drivers', 'พนักงานและคนขับ'], ['insurance', 'Insurance and compliance', 'ประกันภัยและการปฏิบัติตามกฎ'],
  ['equipment', 'Maintenance and equipment', 'ซ่อมบำรุงและอุปกรณ์'], ['general', 'General business expenses', 'ค่าใช้จ่ายธุรกิจทั่วไป'], ['other', 'Other', 'อื่น ๆ']
].map(([id, en, th], position) => ({ id, en, th, parent_id: null, active: true, position }));
export const DEFAULT_CENTRES: CostCentre[] = [{ id: 'depot', en: 'Depot / Lorry park', th: 'คลัง / ลานจอดรถ', active: true }, { id: 'office', en: 'Office', th: 'สำนักงาน', active: true }, { id: 'general', en: 'General company', th: 'บริษัททั่วไป', active: true }];
export const SOURCES = ['standalone', 'maintenance', 'insurance', 'fuel', 'finance', 'other'] as const;
export const STATUS_LABELS: Record<ExpenseStatus, [string, string]> = { draft: ['Draft', 'ร่าง'], submitted: ['Submitted', 'ส่งตรวจแล้ว'], needs_information: ['Needs information', 'ต้องการข้อมูล'], approved: ['Approved', 'อนุมัติแล้ว'], rejected: ['Rejected', 'ไม่อนุมัติ'], closed: ['Closed', 'ปิดรายการ'], voided: ['Voided', 'ยกเลิก'] };
export const PAYMENT_LABELS: Record<PaymentStatus,[string,string]> = { unpaid:['Unpaid','ยังไม่ชำระ'], partially_paid:['Partially paid','ชำระบางส่วน'], paid:['Paid','ชำระแล้ว'] };
export function bangkokToday() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
export function emptyExpense(): ExpenseInput { return { date: bangkokToday(), amount: '', category_id: '', allocation: 'centre', vehicle_id: '', cost_centre_id: 'general', description: '', supplier: '', payment_method: '', paid_by: '', document_number: '', notes: '', document_type: 'receipt', vat_basis: 'unknown', vat_amount: '0.00', supplier_tax_id: '', tax_review: 'unreviewed', reimbursement: false, related_job: '', related_trip: '', recurring: false, source: 'standalone', source_id: '', cost_treatment: 'internal', payment_status: 'unpaid', missing_receipt_reason: '' }; }
export function satang(value: string): number {
  if (!/^(0|[1-9]\d{0,8})(\.\d{1,2})?$/.test(value)) throw new Error('AMOUNT');
  const [whole, fraction = ''] = value.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}
export function money(value: number) { return (value / 100).toLocaleString('en-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
export function decimalTHB(value: number) { return `${Math.floor(value / 100)}.${String(value % 100).padStart(2,'0')}`; }
export function validatePayment(input: Pick<ExpenseInput,'amount'|'payment_status'|'paid_amount'>) {
  const total = satang(input.amount);
  if (!Object.hasOwn(PAYMENT_LABELS,input.payment_status)) throw new Error('PAYMENT_STATUS');
  const paid = input.paid_amount === undefined ? input.payment_status === 'paid' ? total : 0 : satang(input.paid_amount);
  if (paid > total || (input.payment_status === 'paid' && paid !== total) || (input.payment_status === 'unpaid' && paid !== 0) || (input.payment_status === 'partially_paid' && (paid <= 0 || paid >= total))) throw new Error('PAYMENT_AMOUNT');
  return { paid_satang: paid, paid_amount: decimalTHB(paid) };
}
/** V1 paid/unpaid records remain readable without any backfill or historical mutation. */
export function paidSatang(e: Expense) { return e.data.paid_satang ?? (e.data.payment_status === 'paid' ? e.data.amount_satang : e.data.paid_amount ? satang(e.data.paid_amount) : 0); }
export function outstandingSatang(e: Expense) { return Math.max(0,e.data.amount_satang - paidSatang(e)); }
export function expenseValueLabel(value: string, th: boolean) {
  const labels: Record<string,[string,string]> = {
    standalone:['New standalone expense','ค่าใช้จ่ายใหม่'], maintenance:['Maintenance','ซ่อมบำรุง'], insurance:['Insurance','ประกันภัย'], fuel:['Fuel','น้ำมัน'], finance:['Finance Centre','ศูนย์การเงิน'], other:['Other','อื่น ๆ'],
    internal:['Internal company cost','ค่าใช้จ่ายบริษัท'], rebillable:['Customer-rebillable · pending Finance','เรียกเก็บลูกค้าได้ · รอฝ่ายการเงิน'], customer_charge:['Customer charge already in Finance','ยอดเรียกเก็บลูกค้าในศูนย์การเงินแล้ว'],
    unreviewed:['Tax document unreviewed','เอกสารภาษียังไม่ตรวจสอบ'], verified:['Verified by reviewer','ผู้ตรวจสอบยืนยันแล้ว'], not_eligible:['Not eligible (reviewed)','ไม่เข้าเกณฑ์ (ตรวจแล้ว)'],
    receipt:['Receipt','ใบเสร็จ'], invoice:['Invoice','ใบแจ้งหนี้'], tax_invoice:['Tax invoice','ใบกำกับภาษี'], inclusive:['VAT inclusive','รวม VAT'], exclusive:['VAT exclusive','ไม่รวม VAT'], none:['No VAT stated','ไม่ระบุ VAT'], unknown:['Unknown','ไม่ทราบ'],
    cash:['Cash','เงินสด'], transfer:['Bank transfer','โอนเงิน'], card:['Card','บัตร']
  };
  return labels[value]?.[th?1:0] || value || '—';
}
export function validateExpense(input: ExpenseInput) {
  const amount = satang(input.amount); const vat = satang(input.vat_amount);
  if (amount <= 0 || vat > amount) throw new Error('AMOUNT');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || Number.isNaN(Date.parse(input.date)) || new Date(input.date).toISOString().slice(0, 10) !== input.date) throw new Error('DATE');
  if (!input.category_id || !input.description.trim() || input.description.length > 500) throw new Error('REQUIRED');
  if (!['vehicle', 'centre'].includes(input.allocation) || (input.allocation === 'vehicle' ? !input.vehicle_id : !input.cost_centre_id)) throw new Error('ALLOCATION');
  if (!SOURCES.includes(input.source as typeof SOURCES[number]) || (input.source !== 'standalone' && !input.source_id.trim())) throw new Error('SOURCE');
  validatePayment(input);
  for (const [key, values] of Object.entries({ payment_status: ['unpaid', 'partially_paid', 'paid'], cost_treatment: ['internal', 'rebillable', 'customer_charge'], vat_basis: ['unknown', 'inclusive', 'exclusive', 'none'], tax_review: ['unreviewed', 'verified', 'not_eligible'], document_type: ['receipt', 'tax_invoice', 'invoice', 'other'] })) {
    if (!values.includes(String(input[key as keyof ExpenseInput]))) throw new Error('INVALID');
  }
  for (const value of Object.values(input)) if (typeof value === 'string' && value.length > 2000) throw new Error('TOO_LONG');
  return { amount_satang: amount, vat_satang: vat };
}
/** Standalone ledger basis only. Draft/rejected/void, linked sources and customer charges never enter spending totals. */
export function countsAsSpend(e: Expense) { return ['submitted', 'needs_information', 'approved', 'closed'].includes(e.status) && e.data.source === 'standalone' && e.data.cost_treatment !== 'customer_charge'; }
export function possibleDuplicates(expense: Expense, rows: Expense[], attachments: ExpenseAttachment[]) {
  const hashes = new Set(attachments.filter(a => a.expense_id === expense.id && a.state === 'ready').map(a => a.sha256));
  const norm = (s: string) => s.normalize('NFKC').trim().toLocaleLowerCase();
  return rows.filter(e => e.id !== expense.id && e.status !== 'voided' && (
    attachments.some(a => a.expense_id === e.id && a.state === 'ready' && hashes.has(a.sha256)) ||
    (e.data.date === expense.data.date && e.data.amount_satang === expense.data.amount_satang && (
      (expense.data.document_number && norm(e.data.document_number) === norm(expense.data.document_number)) ||
      (expense.data.supplier && norm(e.data.supplier) === norm(expense.data.supplier)) ||
      (expense.data.vehicle_id && e.data.vehicle_id === expense.data.vehicle_id)
    ))
  ));
}
export type ExpenseFilters = { from: string; to: string; q: string; vehicle: string; category: string; status: string; payment?: string; centre?: string; supplier: string; employee: string };
export function filterExpenses(rows: Expense[], f: ExpenseFilters) { const norm=(value:string)=>value.normalize('NFKC').toLocaleLowerCase();return rows.filter(e => (!f.from || e.data.date >= f.from) && (!f.to || e.data.date <= f.to) && (!f.q || norm(`${e.id} ${e.data.description} ${e.data.vehicle_reg} ${e.data.document_number} ${e.data.supplier}`).includes(norm(f.q))) && (!f.vehicle || e.data.allocation === 'vehicle' && e.data.vehicle_id === f.vehicle) && (!f.category || e.data.category_id === f.category) && (!f.status || e.status === f.status) && (!f.payment || e.data.payment_status === f.payment) && (!f.supplier || norm(e.data.supplier).includes(norm(f.supplier))) && (!f.employee || norm(e.data.submitted_by).includes(norm(f.employee)))); }
export type ExpenseSort = { key: 'date'|'description'|'category'|'allocation'|'supplier'|'amount'|'receipt'|'approval'|'payment'|'employee'; direction: 'asc'|'desc' };
export function sortExpenses(rows: Expense[], sort: ExpenseSort, th=false, attachments: ExpenseAttachment[]=[]) {
  const receipts=new Map<string,number>();for(const a of attachments)if(a.state==='ready')receipts.set(a.expense_id,(receipts.get(a.expense_id)||0)+1);
  const value=(e:Expense):string|number=>({date:e.data.date,description:e.data.description,category:th?e.data.category_th:e.data.category_en,allocation:e.data.vehicle_reg||(th?e.data.centre_th:e.data.centre_en),supplier:e.data.supplier,amount:e.data.amount_satang,receipt:receipts.get(e.id)||0,approval:STATUS_LABELS[e.status][th?1:0],payment:PAYMENT_LABELS[e.data.payment_status as PaymentStatus]?.[th?1:0]||'',employee:e.data.submitted_by})[sort.key];
  return rows.slice().sort((a,b)=>{const av=value(a),bv=value(b);const result=typeof av==='number'&&typeof bv==='number'?av-bv:String(av).localeCompare(String(bv),th?'th':'en',{numeric:true});return (sort.direction==='asc'?result:-result)||a.id.localeCompare(b.id);});
}
export function expenseSummary(rows:Expense[]) {
  const included=rows.filter(countsAsSpend),approved=included.filter(e=>['approved','closed'].includes(e.status)),provisional=included.filter(e=>['submitted','needs_information'].includes(e.status));
  const sum=(items:Expense[])=>items.reduce((total,e)=>total+e.data.amount_satang,0);
  return {recorded:sum(included),approved:sum(approved),provisional:sum(provisional),paidApproved:approved.reduce((total,e)=>total+paidSatang(e),0),unpaidApproved:approved.reduce((total,e)=>total+outstandingSatang(e),0),unpaidApprovedCount:approved.filter(e=>outstandingSatang(e)>0).length};
}
export function nextRecurringDate(date:string,frequency:'monthly'|'yearly') {
  const [year,month,day]=date.split('-').map(Number);const target=new Date(Date.UTC(year,month-1+(frequency==='monthly'?1:12),1));const last=new Date(Date.UTC(target.getUTCFullYear(),target.getUTCMonth()+1,0)).getUTCDate();target.setUTCDate(Math.min(day,last));return target.toISOString().slice(0,10);
}
export function exportRows(rows: Expense[], th = false) {
  const safe = (v: string) => /^[=+\-@\t\r]/.test(v.trimStart()) ? `'${v}` : v;
  return rows.map(e => ({ Date: e.data.date, ID: e.id, Description: safe(e.data.description), Category: safe(th ? e.data.category_th : e.data.category_en), Allocation: safe(e.data.vehicle_reg || (th ? e.data.centre_th : e.data.centre_en)), Supplier: safe(e.data.supplier), THB: e.data.amount_satang / 100, SpendingTHB: countsAsSpend(e) ? e.data.amount_satang / 100 : 0, Approval: STATUS_LABELS[e.status][th ? 1 : 0], Payment: PAYMENT_LABELS[e.data.payment_status as PaymentStatus]?.[th?1:0]||e.data.payment_status, PaidTHB: paidSatang(e)/100, OutstandingTHB: outstandingSatang(e)/100, SpendingPaidTHB: countsAsSpend(e)?paidSatang(e)/100:0, SpendingOutstandingTHB: countsAsSpend(e)?outstandingSatang(e)/100:0, Source: e.data.source, SourceReference: safe(e.data.source_id), Treatment: e.data.cost_treatment, IncludedInSpending: countsAsSpend(e) ? 'Yes' : 'No', SubmittedBy: safe(e.data.submitted_by), VAT_THB: e.data.vat_satang / 100, TaxReview: e.data.tax_review }));
}
