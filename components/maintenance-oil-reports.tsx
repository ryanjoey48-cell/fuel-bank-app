'use client';
import {oilStatusLabel} from '@/lib/oil-service-labels';

import {useRef,useState} from 'react';
import {useLanguage} from '@/lib/language-provider';
import {exportWorkbookToXlsx} from '@/lib/export';
import {formatDate,formatNumber} from '@/lib/utils';
import type {OilChangeAlertRow} from '@/lib/operations';
import type {VehicleServiceLog} from '@/types/database';
import {maintenanceToday} from '@/lib/maintenance';

export function MaintenanceOilReports({rows,logs}:{rows:OilChangeAlertRow[];logs:VehicleServiceLog[]}) {
  const {language}=useLanguage(),[busy,setBusy]=useState(false),[error,setError]=useState(''),lock=useRef(false);
  const status=(row:OilChangeAlertRow)=>oilStatusLabel(row.status,language);
  const km=(value:number|null)=>value===null?'—':`${formatNumber(value,language)} KM`;
  async function pdf(){
    if(lock.current)return;lock.current=true;setBusy(true);setError('');
    try{
      const {buildLastOilChangesPdf,loadOilServicePdfLogo,downloadBlob}=await import('@/lib/oil-service-pdf');
      const count=(key:string)=>String(rows.filter(row=>row.status===key).length);
      const data={generatedAt:new Intl.DateTimeFormat(language==='th'?'th-TH':'en-GB',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Bangkok'}).format(new Date()),
        summary:{total:String(rows.length),urgent:count('urgent'),dueSoon:count('due_soon'),overdue:count('overdue'),ok:count('ok'),noRecord:String(rows.filter(r=>!r.lastOilChangeDate).length)},
        rows:[...rows].sort((a,b)=>a.sortRank-b.sortRank||(a.kmRemaining??Infinity)-(b.kmRemaining??Infinity)).map(row=>({
          vehicleReg:row.registration,vehicleType:row.vehicleTypeLabel,driverName:row.driverName??'—',status:row.status,statusLabel:status(row),
          hasServiceRecord:!!row.lastOilChangeDate,lastOilChangeDate:row.lastOilChangeDate?formatDate(row.lastOilChangeDate,language):'—',
          lastOilChangeOdometer:km(row.lastOilChangeOdometer),lastOilChangeTime:row.lastOilChangeDate?Date.parse(row.lastOilChangeDate):Infinity,
          currentOdometer:km(row.currentOdometer),currentOdometerDate:row.currentOdometerDate?formatDate(row.currentOdometerDate,language):'—',
          currentOdometerDateTone:'muted' as const,currentOdometerWarning:row.reviewReasons.join(' · ')||null,
          kmDrivenSinceOilChange:row.status==='review_required'?'—':km(row.kmUsedSinceOilChange),kmRemaining:row.status==='review_required'?'—':km(row.kmRemaining),kmRemainingSort:row.kmRemaining??Infinity,
        }))};
      downloadBlob(await buildLastOilChangesPdf(data,await loadOilServicePdfLogo(),language),`EES-Oil-Service-${maintenanceToday()}.pdf`);
    }catch(e){setError(e instanceof Error?e.message:String(e));}finally{lock.current=false;setBusy(false);}
  }
  return <div className="flex flex-wrap items-center gap-2">
    <button type="button" className="btn-secondary" disabled={busy||!rows.length} onClick={()=>void pdf()}>{busy?(language==='th'?'กำลังสร้าง PDF':'Generating PDF…'):(language==='th'?'รายงานน้ำมันเครื่อง PDF':'Oil service PDF')}</button>
    <button type="button" className="btn-secondary" disabled={!rows.length} onClick={()=>exportWorkbookToXlsx([
      {name:'Oil Service',rows:rows.map(r=>({Registration:r.registration,Driver:r.driverName??'',Status:status(r),'Current km':r.currentOdometer??'','Mileage date':r.currentOdometerDate??'','Last oil change':r.lastOilChangeDate??'','Service km':r.lastOilChangeOdometer??'',Interval:r.oilChangeIntervalKm??'','Next due km':r.nextOilChangeDueOdometer??'','Km since service':r.status==='review_required'?'':r.kmUsedSinceOilChange??'','Remaining km':r.status==='review_required'?'':r.kmRemaining??'',Review:r.reviewReasons.join(' · ')}))},
      {name:'Oil History',rows:logs.map(log=>({ID:log.id,'Maintenance visit ID':log.maintenance_record_id??'',Registration:log.vehicle_reg,Date:log.service_date,Odometer:log.oil_change_odometer??log.odometer??'',Interval:log.interval_km??'',Notes:log.notes??'','Created at':log.created_at??'','Updated at':log.updated_at??''}))},
    ],'EES-Oil-Service-'+maintenanceToday())}>{language==='th'?'ส่งออกสถานะและประวัติ Excel':'Export status & history Excel'}</button>
    {error&&<p role="alert" className="text-xs text-rose-800">{error}</p>}
  </div>;
}
