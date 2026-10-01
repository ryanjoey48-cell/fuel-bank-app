"use client";

import {useCallback,useEffect,useMemo,useState} from "react";
import Link from "next/link";
import {
  CalendarClock,
  CheckCircle2,
  FileUp,
  MoreHorizontal,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  WalletCards,
  Wrench,
} from "lucide-react";
import {MaintenanceAttention} from "@/components/maintenance-attention";
import {MaintenanceField as Field} from "@/components/maintenance-fields";
import {MaintenanceHistory} from "@/components/maintenance-history";
import {MaintenancePeriodPresets} from "@/components/maintenance-period-presets";
import {MaintenanceRecordCollection} from "@/components/maintenance-record-collection";
import {MaintenanceRecordForm} from "@/components/maintenance-record-form";
import {MaintenanceReceiptImport} from "@/components/maintenance-receipt-import";
import {MaintenanceRequirements} from "@/components/maintenance-requirements";
import {useAccountAccess} from "@/lib/use-account-access";
import {useLanguage} from "@/lib/language-provider";
import {fetchMaintenanceData,MaintenanceLoadError} from "@/lib/maintenance-data";
import {maintenanceExportRows} from "@/lib/maintenance-export";
import {
  buildMaintenanceReminders,
  filterMaintenanceRecords,
  maintenanceDriver,
  maintenanceStatusOrder,
  maintenanceToday,
  type MaintenanceFilters,
} from "@/lib/maintenance";
import {maintenanceDateRange,maintenanceVehicleType} from "@/lib/maintenance-ux";
import {MAINTENANCE_CATEGORIES,type MaintenanceData,type MaintenanceRecord} from "@/lib/maintenance-types";
import {maintenanceCategoryLabels} from "@/lib/maintenance-translations";
import {exportToCsv,exportWorkbookToXlsx} from "@/lib/export";
import {formatCurrency,formatDate} from "@/lib/utils";

const baseFilters=():MaintenanceFilters=>({
  vehicle:"",
  driver:"",
  vehicleType:"",
  category:"",
  status:"",
  garage:"",
  ...maintenanceDateRange("thisYear"),
  search:"",
});

export default function MaintenancePage(){
  const {t,language}=useLanguage(),c=t.maintenance,{can}=useAccountAccess();
  const [data,setData]=useState<MaintenanceData|null>(null);
  const [busy,setBusy]=useState(true);
  const [error,setError]=useState<string|null>(null);
  const [today,setToday]=useState(maintenanceToday);
  const [filters,setFilters]=useState<MaintenanceFilters>(baseFilters);
  const [form,setForm]=useState<{key:string;record:MaintenanceRecord|null;vehicleId:string}|null>(null);
  const [history,setHistory]=useState<string|null>(null);
  const [showRequirements,setShowRequirements]=useState(false);
  const [filtersOpen,setFiltersOpen]=useState(false);
  const [importOpen,setImportOpen]=useState(false);
  const [showAllRecords,setShowAllRecords]=useState(false);

  const load=useCallback(async()=>{
    setBusy(true);
    try{
      setData(await fetchMaintenanceData());
      setError(null);
    }catch(caught){
      setError(caught instanceof MaintenanceLoadError?`${caught.table} (${caught.status}, ${caught.code})`:"");
      console.error("Maintenance load failed",caught);
    }finally{
      setBusy(false);
    }
  },[]);

  useEffect(()=>{
    void load();
    const vehicle=new URL(window.location.href).searchParams.get("vehicle");
    if(vehicle){
      setHistory(vehicle);
      setFilters(value=>({...value,vehicle}));
    }
    const timer=window.setInterval(()=>setToday(maintenanceToday()),60000);
    return()=>window.clearInterval(timer);
  },[load]);

  const reminders=useMemo(()=>data?buildMaintenanceReminders(data,today):[],[data,today]);
  const records=useMemo(()=>data?filterMaintenanceRecords(data,filters,reminders):[],[data,filters,reminders]);
  const newestRecords=useMemo(()=>[...records].sort((a,b)=>{
    const byDate=(b.service_date??"").localeCompare(a.service_date??"");
    if(byDate!==0)return byDate;
    return (b.created_at??"").localeCompare(a.created_at??"");
  }),[records]);
  const displayedRecords=showAllRecords?newestRecords:newestRecords.slice(0,6);

  const change=(patch:Partial<MaintenanceFilters>)=>{
    setFilters(old=>({...old,...patch}));
    setShowAllRecords(false);
  };

  const openForm=(record:MaintenanceRecord|null,vehicleId="")=>{
    setForm({key:crypto.randomUUID(),record,vehicleId});
    window.setTimeout(()=>document.getElementById("maintenance-form")?.scrollIntoView({behavior:"smooth",block:"start"}),0);
  };

  const openHistory=(vehicleId:string)=>{
    if(!vehicleId)return;
    setHistory(vehicleId);
  };

  const exportRows=data?maintenanceExportRows(data,records,language):null;
  const defaultRange=maintenanceDateRange("thisYear",today);
  const activeFilters=[filters.vehicle,filters.driver,filters.vehicleType,filters.category,filters.status,filters.garage,filters.search].filter(Boolean).length+(filters.start!==defaultRange.start||filters.end!==defaultRange.end?1:0);

  const filteredReminders=reminders.filter(r=>{
    if(!data)return false;
    const vehicle=data.vehicles.find(v=>v.id===r.vehicle_id);
    const record=data.records.find(v=>v.id===r.record_id);
    return(!filters.vehicle||filters.vehicle===r.vehicle_id)
      &&(!filters.driver||data.drivers.some(d=>d.id===filters.driver&&d.active!==false&&d.assigned_vehicle_id===r.vehicle_id))
      &&(!filters.vehicleType||vehicle?.vehicle_type===filters.vehicleType)
      &&(!filters.category||r.category===filters.category)
      &&(!filters.garage||record?.garage===filters.garage)
      &&`${vehicle?.vehicle_reg} ${maintenanceDriver(data,r.vehicle_id)} ${record?.garage??""} ${record?.receipt_reference??""} ${r.name}`.toLowerCase().includes(filters.search.toLowerCase());
  });

  const visibleReminders=filteredReminders.filter(r=>filters.status?r.status===filters.status:r.status!=="ok"||r.mileage_unavailable);

  const dashboard=useMemo(()=>{
    if(!data)return null;
    const vehicles=data.vehicles.filter(v=>v.active!==false);
    const month=today.slice(0,7);
    const year=today.slice(0,4);
    const active=data.records.filter(r=>!r.is_deleted);
    let healthOverdue=0,healthSoon=0,healthOk=0;

    for(const vehicle of vehicles){
      const own=reminders.filter(r=>r.vehicle_id===vehicle.id);
      if(own.some(r=>r.status==="overdue"||r.status==="mileageDue"))healthOverdue++;
      else if(own.some(r=>r.status==="dueSoon"))healthSoon++;
      else healthOk++;
    }

    const sum=(prefix:string)=>active
      .filter(r=>r.service_date.startsWith(prefix))
      .reduce((total,r)=>total+Math.round(Number(r.calculated_total)*100),0)/100;

    const dueSoonVehicleIds=new Set(reminders.filter(r=>
      r.status==="dueSoon"||
      (r.days!==null&&r.days>=0&&r.days<=30)||
      (r.km!==null&&r.km>=0&&r.km<=2000)
    ).map(r=>r.vehicle_id));

    return{
      overdue:reminders.filter(r=>r.status==="overdue"||r.status==="mileageDue").length,
      dueSoonVehicles:dueSoonVehicleIds.size,
      serviced:new Set(active.filter(r=>r.service_date.startsWith(month)).map(r=>r.vehicle_id)).size,
      month:sum(month),
      year:sum(year),
      healthOverdue,
      healthSoon,
      healthOk,
      total:Math.max(1,vehicles.length),
    };
  },[data,reminders,today]);

  const english=language==="en";

  return <div className="maintenance-shell -m-3 min-h-full space-y-4 p-3 sm:-m-4 sm:p-4 lg:-m-5 lg:p-5">
    <section className="surface-card flex flex-col gap-5 px-5 py-6 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
      <div className="min-w-0">
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-violet-500">EXPERT EXPRESS SENDER CO., LTD.</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950 sm:text-[28px]">{c.title}</h1>
        <p className="mt-1 text-sm text-slate-500">{c.description}</p>
      </div>

      <nav aria-label="Maintenance sections" className="inline-flex w-fit shrink-0 rounded-2xl border border-violet-100 bg-violet-50/70 p-1">
        <Link href="/maintenance" className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-violet-700 shadow-sm">{c.title}</Link>
        <Link href="/maintenance/analytics" className="rounded-xl px-4 py-2 text-sm font-medium text-slate-500 transition hover:bg-white/70 hover:text-violet-700">{c.analytics}</Link>
      </nav>
    </section>

    <section className="maintenance-panel space-y-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[.16em] text-violet-600">{english?"FLEET MAINTENANCE":"การบำรุงรักษากองรถ"}</p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-950">{english?"Maintenance overview":"ภาพรวมการบำรุงรักษา"}</h2>
          <p className="mt-1 text-sm text-slate-500">{english?"See what needs attention, add service records and review recent maintenance.":"ดูรายการที่ต้องดำเนินการ เพิ่มประวัติการซ่อม และตรวจสอบงานล่าสุด"}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {can("business:write")&&<>
            <button className="btn-secondary min-h-10" disabled={!data||error!==null} onClick={()=>setImportOpen(true)}><FileUp className="h-4 w-4"/>{c.importReceipt}</button>
            <button className="btn-primary min-h-10" disabled={!data||error!==null} onClick={()=>openForm(null,filters.vehicle)}><Plus className="h-4 w-4"/>{c.add}</button>
          </>}
          <details className="relative">
            <summary className="btn-secondary min-h-10 cursor-pointer list-none"><MoreHorizontal className="h-4 w-4"/>More</summary>
            <div className="absolute right-0 z-30 mt-2 w-56 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
              <Link href="/maintenance/analytics" className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50"><WalletCards className="h-4 w-4"/>{c.analytics}</Link>
              <button type="button" className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50" disabled={busy} onClick={()=>void load()}><RefreshCw className="h-4 w-4"/>{c.refresh}</button>
              <button type="button" className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50" onClick={()=>setShowRequirements(!showRequirements)}><Wrench className="h-4 w-4"/>{c.requirements}</button>
            </div>
          </details>
        </div>
      </div>

      {!can("business:write")&&<p className="text-sm text-slate-500">{c.readOnly}</p>}
      {busy&&<div role="status" className="h-10 animate-pulse rounded-xl bg-violet-100/60" aria-label={t.common.loading}/>} 
      {error!==null&&<p role="alert" className="rounded-xl bg-amber-50 p-3 text-amber-900">{c.loadError}{error&&<span className="mt-1 block text-xs">{error}</span>}</p>}

      {dashboard&&<OverviewKpis c={c} language={language} dashboard={dashboard} onDueSoon={()=>change({status:filters.status==="dueSoon"?"":"dueSoon"})}/>} 
    </section>

    {data&&importOpen&&<MaintenanceReceiptImport data={data} onClose={()=>setImportOpen(false)} onImported={load} onViewRecord={record=>{setImportOpen(false);openForm(record);}}/>}
    {data&&form&&<MaintenanceRecordForm key={form.key} data={data} record={form.record} vehicleId={form.vehicleId} onClose={()=>setForm(null)} onSaved={()=>void load()}/>} 

    {data&&error===null&&<>
      {showRequirements&&<MaintenanceRequirements data={data} onSaved={()=>void load()}/>} 

      <section className="maintenance-panel space-y-3 p-3 sm:p-4">
        <div className="grid gap-2 md:grid-cols-[minmax(240px,1.7fr)_minmax(160px,1fr)_auto]">
          <Field label={c.search}><input className="form-input bg-white/80" type="search" value={filters.search} onChange={e=>change({search:e.target.value})}/></Field>
          <Field label={c.vehicle}><select className="form-input bg-white/80" value={filters.vehicle} onChange={e=>change({vehicle:e.target.value})}><option value="">{c.all}</option>{data.vehicles.map(v=><option key={v.id} value={v.id}>{v.vehicle_reg}</option>)}</select></Field>
          <button type="button" className="btn-secondary self-end" aria-expanded={filtersOpen} aria-controls="maintenance-more-filters" onClick={()=>setFiltersOpen(!filtersOpen)}><SlidersHorizontal className="h-4 w-4"/>{c.moreFilters}{activeFilters?` (${activeFilters})`:""}</button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <MaintenancePeriodPresets start={filters.start} end={filters.end} onChange={change}/>
          {activeFilters>0&&<button className="text-sm font-semibold text-violet-700 hover:underline" onClick={()=>{setFilters(baseFilters());setShowAllRecords(false);}}>{c.clearFilters}</button>}
        </div>

        <div id="maintenance-more-filters" className={filtersOpen?"grid gap-2 rounded-2xl border border-violet-100 bg-[#f5f3fc] p-3 sm:grid-cols-2 lg:grid-cols-5":"hidden"}>
          <Field label={c.driver}><select className="form-input bg-white/80" value={filters.driver} onChange={e=>change({driver:e.target.value})}><option value="">{c.all}</option>{data.drivers.filter(d=>d.active!==false).map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
          <Field label={c.vehicleType}><select className="form-input bg-white/80" value={filters.vehicleType} onChange={e=>change({vehicleType:e.target.value})}><option value="">{c.all}</option>{Array.from(new Set(data.vehicles.map(v=>v.vehicle_type).filter(Boolean))).map(v=><option key={v} value={v!}>{maintenanceVehicleType(v,t.weeklyMileage.oil.vehicleTypes)}</option>)}</select></Field>
          <Field label={c.category}><select className="form-input bg-white/80" value={filters.category} onChange={e=>change({category:e.target.value})}><option value="">{c.all}</option>{MAINTENANCE_CATEGORIES.map(v=><option key={v} value={v}>{maintenanceCategoryLabels[language][v]}</option>)}</select></Field>
          <Field label={c.garage}><select className="form-input bg-white/80" value={filters.garage} onChange={e=>change({garage:e.target.value})}><option value="">{c.all}</option>{Array.from(new Set(data.records.filter(r=>!r.is_deleted).map(r=>r.garage).filter(Boolean))).map(v=><option key={v} value={v!}>{v}</option>)}</select></Field>
          <div className="grid grid-cols-2 gap-2"><Field label={c.start}><input className="form-input bg-white/80" type="date" min="1900-01-01" max={filters.end} value={filters.start} onChange={e=>change({start:e.target.value})}/></Field><Field label={c.end}><input className="form-input bg-white/80" type="date" min={filters.start} max={today} value={filters.end} onChange={e=>change({end:e.target.value})}/></Field></div>
        </div>

        <p className="text-xs text-slate-500">{c.period}: {filters.start==="1900-01-01"?c.allTime:formatDate(filters.start,language)} – {formatDate(filters.end,language)}</p>
      </section>

      {visibleReminders.length>0&&<MaintenanceAttention data={data} reminders={visibleReminders} today={today} filters={filters} onAdd={id=>openForm(null,id)} onHistory={openHistory}/>}

      <section className="maintenance-history-panel space-y-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[.14em] text-violet-600">{english?"RECENT MAINTENANCE":"การบำรุงรักษาล่าสุด"}</p>
            <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-950">{showAllRecords?(english?"Maintenance history":"ประวัติการบำรุงรักษา"):(english?"Latest service records":"รายการซ่อมล่าสุด")}</h2>
            <p className="mt-1 text-sm text-slate-500">
              {showAllRecords
                ? `${english?"Showing all":"แสดงทั้งหมด"} ${records.length} ${english?"maintenance records in this period.":"รายการในช่วงเวลานี้"}`
                : `${english?"Showing the latest":"แสดงล่าสุด"} ${Math.min(6,records.length)} ${english?"of":"จาก"} ${records.length} ${english?"maintenance records.":"รายการ"}`}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {records.length>6&&<button className={showAllRecords?"btn-secondary min-h-10":"btn-primary min-h-10"} onClick={()=>setShowAllRecords(value=>!value)}>{showAllRecords?(english?"Show latest 6":"แสดง 6 รายการล่าสุด"):`${english?"View all":"ดูทั้งหมด"} ${records.length} ${english?"records":"รายการ"}`}</button>}
            <details className="relative">
              <summary className="btn-secondary min-h-10 cursor-pointer list-none"><MoreHorizontal className="h-4 w-4"/>Export</summary>
              <div className="absolute right-0 z-30 mt-2 w-56 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
                <button className="w-full rounded-xl px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50" disabled={!records.length} onClick={()=>exportToCsv(exportRows!.records,"maintenance-visits")}>{c.exportRecords}</button>
                <button className="w-full rounded-xl px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50" disabled={!records.length} onClick={()=>exportToCsv(exportRows!.items,"maintenance-items")}>{c.exportItems}</button>
                <button className="w-full rounded-xl px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50" disabled={!records.length} onClick={()=>exportWorkbookToXlsx([{name:c.visits,rows:exportRows!.records},{name:c.items,rows:exportRows!.items}],"maintenance-report")}>{c.exportExcel}</button>
              </div>
            </details>
          </div>
        </div>

        <MaintenanceRecordCollection records={displayedRecords} data={data} onEdit={r=>openForm(r)} onChanged={()=>void load()} reminders={reminders} showSummary={false}/>
      </section>

      {history&&<MaintenanceHistory key={history} vehicleId={history} data={data} onEdit={r=>openForm(r)} onChanged={()=>void load()}/>} 
    </>}
  </div>;
}

function OverviewKpis({c,language,dashboard,onDueSoon}:{
  c:ReturnType<typeof useLanguage>["t"]["maintenance"];
  language:"en"|"th";
  dashboard:{
    overdue:number;
    dueSoonVehicles:number;
    serviced:number;
    month:number;
    year:number;
    healthOverdue:number;
    healthSoon:number;
    healthOk:number;
    total:number;
  };
  onDueSoon:()=>void;
}){
  const english=language==="en";
  const allClear=dashboard.healthOverdue===0&&dashboard.healthSoon===0;
  const items=[
    {
      label:english?"FLEET STATUS":"สถานะกองรถ",
      value:allClear?(english?"All clear":"ปกติทั้งหมด"):`${dashboard.healthOverdue+dashboard.healthSoon}`,
      helper:allClear?`${dashboard.healthOk} ${english?"vehicles OK":"คันปกติ"}`:`${dashboard.healthOverdue} ${english?"overdue":"เกินกำหนด"} · ${dashboard.healthSoon} ${english?"due soon":"ใกล้ถึงกำหนด"}`,
      tone:"emerald",
      Icon:CheckCircle2,
    },
    {
      label:english?"DUE SOON":"ใกล้ถึงกำหนด",
      value:dashboard.dueSoonVehicles,
      helper:english?"Vehicles with upcoming maintenance":"รถที่มีงานบำรุงรักษาใกล้ถึงกำหนด",
      tone:"amber",
      Icon:CalendarClock,
      action:onDueSoon,
    },
    {
      label:english?"VEHICLES SERVICED THIS MONTH":"รถที่เข้าซ่อมเดือนนี้",
      value:dashboard.serviced,
      helper:english?"Unique vehicles serviced this month":"จำนวนรถที่เข้าซ่อมในเดือนนี้",
      tone:"violet",
      Icon:Wrench,
    },
    {
      label:c.spendThisMonth,
      value:formatCurrency(dashboard.month,language),
      helper:`${formatCurrency(dashboard.year,language)} ${c.yearToDate}`,
      tone:"blue",
      Icon:WalletCards,
    },
  ];

  const colors:Record<string,string>={
    emerald:"border-emerald-200 bg-emerald-50/70",
    amber:"border-amber-200 bg-amber-50/70",
    violet:"border-violet-200 bg-violet-50/70",
    blue:"border-blue-200 bg-blue-50/70",
  };

  return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
    {items.map(({label,value,helper,tone,Icon,action})=>{
      const content=<>
        <div className="flex items-start justify-between gap-2">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">{label}</p>
          <Icon className="h-4 w-4 text-slate-400"/>
        </div>
        <p className="mt-2 break-words text-xl font-semibold tracking-tight text-slate-950 sm:text-2xl">{value}</p>
        <p className="mt-1 text-xs text-slate-500">{helper}</p>
      </>;
      return action
        ?<button key={label} type="button" onClick={action} className={`rounded-2xl border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-sm ${colors[tone]}`}>{content}</button>
        :<div key={label} className={`rounded-2xl border p-4 ${colors[tone]}`}>{content}</div>;
    })}
  </div>;
}
