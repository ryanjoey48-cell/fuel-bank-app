'use client';
import {useCallback,useEffect,useState} from 'react';
import Link from 'next/link';
import {fetchVehicles,fetchDrivers,fetchWeeklyMileage,fetchOilChangeHistory,fetchOilChangeBaselinesForVehicles,clearDataReadCache} from '@/lib/data';
import {buildOilServiceSnapshot} from '@/lib/oil-service-snapshot';
import {centreCopy} from '@/lib/maintenance-centre-copy';
import {useLanguage} from '@/lib/language-provider';
import type {OilChangeAlertRow} from '@/lib/operations';
export function VehicleMaintenanceSummary({vehicleId}:{vehicleId:string}){
 const {language,t}=useLanguage(),c=centreCopy[language];const [row,setRow]=useState<OilChangeAlertRow|null>(null),[error,setError]=useState(false);
 const load=useCallback(async()=>{try{clearDataReadCache();const [vehicles,drivers,mileage,logs]=await Promise.all([fetchVehicles(),fetchDrivers(),fetchWeeklyMileage(),fetchOilChangeHistory()]);const baselines=await fetchOilChangeBaselinesForVehicles(vehicles);setRow(buildOilServiceSnapshot({vehicles,drivers,mileage,logs,baselines}).find(r=>r.vehicleId===vehicleId)??null);setError(false);}catch{setRow(null);setError(true);}},[vehicleId]);
 useEffect(()=>{let active=true;const refresh=()=>{if(active)void load();};refresh();window.addEventListener('fuel-bank:data-changed',refresh);return()=>{active=false;window.removeEventListener('fuel-bank:data-changed',refresh);};},[load]);
 return <section className="rounded-xl border border-violet-200 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{c.title}</h3><Link className="text-sm text-violet-700 underline" href={`/maintenance?vehicle=${encodeURIComponent(vehicleId)}`}>{c.manage}</Link></div>{error?<p className="mt-2 text-sm">{t.maintenance.loadError}</p>:row?<div className="mt-3 grid gap-2 text-sm sm:grid-cols-3"><p>{c.last}: {row.lastOilChangeDate??c.noBaseline} · {row.lastOilChangeOdometer??'—'} km</p><p>{c.due}: {row.nextOilChangeDueOdometer??'—'} km</p><p>{c.remaining}: {row.kmRemaining??'—'} km · {row.status==='not_applicable'?c.notApplicable:row.status==='condition_based'?c.condition:row.status==='overdue'?c.overdue:row.status==='due_soon'||row.status==='urgent'?c.dueSoon:row.status==='ok'?c.ok:row.status==='not_set'?c.notConfigured:c.unknown}</p></div>:<p className="mt-2 text-sm">{t.common.loading}</p>}</section>;
}
