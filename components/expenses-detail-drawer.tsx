'use client';
import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import s from './expenses-centre.module.css';

export function ExpensesDetailDrawer({children,th,onClose}:{children:ReactNode;th:boolean;onClose:()=>void}) {
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const dialog=ref.current;const previous=document.activeElement as HTMLElement|null;dialog?.showModal();return()=>{dialog?.close();previous?.focus();};},[]);
  return <dialog ref={ref} className={s.detailDrawer} aria-label={th?'รายละเอียดค่าใช้จ่าย':'Expense details'} onCancel={e=>{e.preventDefault();onClose();}} onClick={e=>{if(e.target===e.currentTarget)onClose();}}><div className={s.drawerBody}><button type="button" className={`${s.secondary} ${s.drawerClose}`} onClick={onClose} aria-label={th?'ปิดรายละเอียด':'Close expense details'}><X size={18}/></button>{children}</div></dialog>;
}
