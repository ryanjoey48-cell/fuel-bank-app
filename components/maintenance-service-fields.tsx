'use client';
import { useLanguage } from '@/lib/language-provider';
import { centreCopy } from '@/lib/maintenance-centre-copy';
import { SERVICE_ACTIONS,SERVICE_CATALOG } from '@/lib/preventative-maintenance';
import type { MaintenanceData,MaintenanceItemInput } from '@/lib/maintenance-types';
export function MaintenanceServiceFields({item,data,vehicleId,onChange}:{item:MaintenanceItemInput;data:MaintenanceData;vehicleId:string;onChange:(p:Partial<MaintenanceItemInput>)=>void}){
 const {language}=useLanguage(),c=centreCopy[language];
 const custom=data.requirements.filter(s=>s.service_key&&!SERVICE_CATALOG.some(x=>x[0]===s.service_key)&&data.applicability.some(a=>a.vehicle_id===vehicleId&&a.requirement_id===s.id));
 return <details open={!!item.service_key} className="space-y-2 rounded-xl border border-violet-200 p-3"><summary className="cursor-pointer text-sm text-violet-700">{language==='en'?'Replacement or inspection (optional)':'การเปลี่ยนหรือการตรวจ (ไม่บังคับ)'}</summary><div className="grid gap-3 sm:grid-cols-2">
 <label className="text-sm">{c.service}<select className="form-input mt-1" aria-label={c.service} value={item.service_key??''} onChange={e=>{const entry=SERVICE_CATALOG.find(s=>s[0]===e.target.value);onChange({service_key:e.target.value||null,service_confirmed:false,...(entry?{category:entry[3]}:{})});}}><option value="">{c.none}</option>{SERVICE_CATALOG.map(s=><option key={s[0]} value={s[0]}>{s[language==='en'?1:2]}</option>)}{Array.from(new Map(custom.map(s=>[s.service_key,s])).values()).map(s=><option key={s.service_key} value={s.service_key!}>{s.name}</option>)}</select></label>
 <label className="text-sm">{c.action}<select className="form-input mt-1" aria-label={c.action} value={item.service_action??'other'} onChange={e=>onChange({service_action:e.target.value,service_confirmed:false})}>{SERVICE_ACTIONS.map(s=><option key={s} value={s}>{c[s]}</option>)}</select></label>
 <label className="text-sm">{c.conditionLabel}<input className="form-input mt-1" maxLength={500} value={item.condition??''} onChange={e=>onChange({condition:e.target.value||null})}/></label>
 <label className="flex min-h-11 items-center gap-2 text-sm"><input className="!h-4 !w-4" type="checkbox" disabled={!item.service_key} checked={item.service_confirmed??false} onChange={e=>onChange({service_confirmed:e.target.checked})}/>{c.confirmed}</label>
 </div><p className="text-xs text-slate-500">{c.confirmHelp}</p></details>;
}
