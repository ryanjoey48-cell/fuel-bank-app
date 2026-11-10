'use client';
import { useState } from 'react';
import { money, paidSatang, outstandingSatang, validatePayment, type Expense } from '@/lib/expenses';
import s from './expenses-centre.module.css';

export function ExpensesPartialPayment({expense,th,busy,note,onSave,onError}:{expense:Expense;th:boolean;busy:boolean;note:string;onSave:(amount:string)=>void;onError:(error:unknown)=>void}) {
  const [amount,setAmount]=useState('');const t=(en:string,thai:string)=>th?thai:en;
  return <div className={s.paymentPanel}><p>{t('Paid to date','ชำระสะสม')} <strong>฿{money(paidSatang(expense))}</strong> · {t('Outstanding','คงค้าง')} <strong>฿{money(outstandingSatang(expense))}</strong></p><div><label className={s.field}>{t('Total paid so far · THB','ยอดชำระสะสม · บาท')}<input inputMode="decimal" aria-label={t('Total paid so far · THB','ยอดชำระสะสม · บาท')} value={amount} placeholder="0.00" onChange={e=>setAmount(e.target.value)}/></label><button className={s.secondary} disabled={busy||!note.trim()||!amount} onClick={()=>{try{validatePayment({amount:expense.data.amount,payment_status:'partially_paid',paid_amount:amount});onSave(amount);}catch(e){onError(e);}}}>{t('Record partial payment','บันทึกชำระบางส่วน')}</button></div><p className={s.muted}>{t('Enter the cumulative amount paid, not an extra instalment. Add payment evidence in the review note.','กรอกยอดชำระสะสม ไม่ใช่ยอดงวดที่เพิ่ม และระบุหลักฐานในหมายเหตุการตรวจ')}</p></div>;
}
