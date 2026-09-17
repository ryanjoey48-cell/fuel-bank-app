"use client";
import { useLanguage } from "@/lib/language-provider";
import { maintenanceDue, maintenanceLineTotal } from "@/lib/maintenance";
import { maintenanceCategoryLabels } from "@/lib/maintenance-translations";
import type { MaintenanceItem, MaintenanceRecord } from "@/lib/maintenance-types";
import { formatCurrency, formatDate, formatNumber } from "@/lib/utils";

export function MaintenanceItemTable({ items, record }: { items: MaintenanceItem[]; record: MaintenanceRecord }) {
  const { t, language } = useLanguage(), c = t.maintenance;
  return <div className="overflow-hidden rounded-xl border border-violet-100 bg-[#faf9fe]"><table className="block w-full table-fixed text-left text-sm md:table">
    <caption className="sr-only">{c.items}</caption>
    <thead className="hidden border-b border-violet-100 bg-violet-50/80 text-xs text-slate-600 md:table-header-group"><tr>{[c.item,c.category,c.quantity,c.unitPrice,c.lineTotal,c.itemNotes].map((label,index) => <th key={label} scope="col" className={`px-3 py-2.5 font-semibold ${index===0?"w-[28%]":index===2?"w-[8%]":index===5?"w-[20%]":index===3||index===4?"text-right":""}`}>{label}</th>)}</tr></thead>
    <tbody className="block md:table-row-group">{items.map(item => {
      const due = maintenanceDue(item, record);
      const cell = "flex justify-between gap-3 px-3 py-1 md:table-cell md:py-3 md:align-top";
      return <tr key={item.id} className="mb-2 block rounded-xl border border-violet-100 bg-white/70 py-2 last:mb-0 md:table-row md:rounded-none md:border-x-0 md:border-t-0 md:even:bg-violet-50/35">
        <td className={cell}><div className="min-w-0"><p className="break-words font-semibold">{item.description}</p>{item.description_th&&<p className="mt-1 break-words text-xs text-slate-500"><span>{c.originalWording}: </span>{item.description_th}</p>}{(due.date||due.km!==null)&&<p className="mt-2 text-xs text-violet-700">{c.nextDate}: {due.date?formatDate(due.date,language):"—"} · {c.nextMileage}: {due.km===null?"—":formatNumber(due.km,language)}</p>}</div></td>
        <td className={cell}><span className="text-xs text-slate-500 md:hidden">{c.category}</span><span className="break-words">{maintenanceCategoryLabels[language][item.category]}</span></td>
        <td className={`${cell} md:text-right`}><span className="text-xs text-slate-500 md:hidden">{c.quantity}</span>{formatNumber(item.quantity,language,2)}</td>
        <td className={`${cell} md:text-right`}><span className="text-xs text-slate-500 md:hidden">{c.unitPrice}</span><span className="break-words">{formatCurrency(Number(item.unit_price),language)}</span></td>
        <td className={`${cell} md:text-right`}><span className="text-xs text-slate-500 md:hidden">{c.lineTotal}</span><strong className="break-words">{formatCurrency(maintenanceLineTotal(item),language)}</strong></td>
        <td className={`${cell} whitespace-pre-wrap break-words text-slate-600`}><span className="text-xs text-slate-500 md:hidden">{c.itemNotes}</span><span className="min-w-0">{item.notes||"—"}</span></td>
      </tr>;
    })}</tbody>
  </table></div>;
}
