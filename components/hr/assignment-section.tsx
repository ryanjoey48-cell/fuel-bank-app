"use client";
import {VehicleMaintenanceSummary} from '@/components/vehicle-maintenance-summary';
import { useState } from "react";
import { hrVehicleType } from "@/lib/ees-hr-v7-vehicle-label";
import { hrCopy,hrStatus } from "@/lib/ees-hr-v7-copy";
import { bangkokToday,type HRLanguage,type HRProfile,type HRVehicle } from "@/lib/ees-hr-v7-types";
import { HRDate,HRDialog,HRFields,HRNotice,useHRMutation } from "./hr-ui";

export function AssignmentSection({model,language,reload}:{model:HRProfile;language:HRLanguage;reload:()=>Promise<void>}) {
  const c=hrCopy(language);const [open,setOpen]=useState(false);const [values,setValues]=useState<Record<string,unknown>>({vehicleId:"",date:bangkokToday(),kind:"permanent",endDate:"",reason:"",notes:""});
  const mutation=useHRMutation(language,reload);const history=(model.data.history??[]) as Record<string,unknown>[];const vehicles=(model.data.vehicles??[]) as HRVehicle[];
  const today=bangkokToday();const parent={driverId:model.employee.driverId};
  return <div className="space-y-4">
    <section className="rounded-xl border border-violet-100 bg-white p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm text-slate-500">{c.regularVehicle}</p><h2 className="mt-1 text-xl font-bold text-slate-950">{model.employee.regularVehicle?.registration??c.notRecorded}</h2><p className="mt-1 text-sm text-slate-600">{hrVehicleType(language,model.employee.regularVehicle?.type)} · {model.employee.regularVehicle?.model??"—"}</p></div>
      <button type="button" className="btn-primary" disabled={!model.employee.driverId} onClick={()=>{mutation.clear();setOpen(true);}}>{c.changeVehicle}</button></div>
      <p className="mt-4 text-sm text-slate-500">{c.fleetAuthority}</p><p className="mt-2 text-sm text-slate-500">{c.licenceReview}: {hrStatus(language,model.employee.documentStatus)}. {c.notLegalCertification}</p>
    </section>
    {model.employee.regularVehicle?.id?<VehicleMaintenanceSummary vehicleId={model.employee.regularVehicle.id}/>:null}
    {mutation.error&&!open?<HRNotice error>{mutation.error}</HRNotice>:null}{mutation.notice?<HRNotice>{mutation.notice}</HRNotice>:null}
    <section className="rounded-xl border border-violet-100 bg-white p-5"><h2 className="text-lg font-bold text-slate-950">{c.history}</h2><p className="mt-1 text-sm text-slate-500">{c.historyDescription}</p>
      {!history.length?<p className="mt-5 text-sm text-slate-500">{c.noHistory}</p>:<ol className="mt-5 space-y-4">{history.map(row=>{const vehicle=row.vehicle as HRVehicle|null;const current=!row.cancelled_at&&!row.closed_at&&String(row.effective_from)<=today&&(!row.effective_to||String(row.effective_to)>=today);return <li key={String(row.id)} className="border-l-2 border-violet-200 pl-4"><div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-semibold text-slate-950">{vehicle?.registration??c.notRecorded}</h3><p className="mt-1 text-sm text-slate-600">{row.assignment_kind==="temporary"?c.temporary:c.permanent} · <HRDate value={String(row.effective_from)} language={language}/> — <HRDate value={row.effective_to?String(row.effective_to):null} language={language}/></p></div><span className="rounded-full bg-violet-50 px-2 py-1 text-xs text-violet-800">{row.cancelled_at?(language==="th"?"ยกเลิกแล้ว":"Cancelled"):current?c.current:String(row.effective_from)>today?c.scheduled:c.previousAssignment}</span></div><p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{String(row.reason??"")}</p>{row.notes?<p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{String(row.notes)}</p>:null}<p className="mt-2 text-xs text-slate-500">{c.recordedAt}: <HRDate value={String(row.recorded_at)} language={language} time/> · {String(row.author_name??row.recorded_by??"—")}</p>{row.assignment_kind==="temporary"&&current?<button type="button" className="btn-secondary mt-3" disabled={mutation.busy} onClick={()=>void mutation.run("end_cover",{...parent,id:row.id,date:today})}>{c.endCover}</button>:null}</li>;})}</ol>}
    </section>
    {open?<HRDialog title={c.changeVehicle} language={language} busy={mutation.busy} error={mutation.error} onClose={()=>setOpen(false)} onSubmit={()=>void mutation.run("change_vehicle",{...parent,...values}).then(result=>{if(result)setOpen(false);})}>
      <p className="mb-4 text-sm text-slate-500">{c.regularVehicle}: {model.employee.regularVehicle?.registration??c.notRecorded}</p>
      <HRFields values={values} disabled={mutation.busy} onChange={(key,value)=>setValues(current=>({...current,[key]:value}))} fields={[
        {key:"vehicleId",label:c.chooseVehicle,type:"select",required:true,options:[{value:"",label:c.chooseVehicle},...vehicles.map(vehicle=>({value:vehicle.id,label:`${vehicle.registration} · ${hrVehicleType(language,vehicle.type)} · ${vehicle.model??"—"}`}))]},
        {key:"kind",label:c.assignmentKind,type:"select",options:[{value:"permanent",label:c.permanent},{value:"temporary",label:c.temporary}]},
        {key:"date",label:c.effectiveDate,type:"date",required:true,max:values.kind==="permanent"?today:undefined},
        ...(values.kind==="temporary"?[{key:"endDate",label:c.optionalEnd,type:"date" as const}]:[]),
        {key:"reason",label:c.reason,required:true},{key:"notes",label:c.notes,type:"textarea"}]}/>
      <p className="mt-4 text-sm text-slate-500">{c.futurePermanent}</p>
    </HRDialog>:null}
  </div>;
}


