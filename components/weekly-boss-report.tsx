"use client";

import Image from "next/image";
import { AlertCircle, CalendarDays, Gauge, Printer, Route, Truck, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { buildWeeklyBossReport, defaultWeeklyBossPeriod, weekFromEndingSunday, type WeeklyBossReport } from "@/lib/weekly-boss-report";
import type { Language } from "@/lib/translations";
import { formatCurrency, formatDate, formatNumber } from "@/lib/utils";
import type { BookingDiaryEntry, Driver, FuelLogWithDriver, TripJourneyWithFuel, Vehicle, WeeklyMileageEntry } from "@/types/database";

type Props = {
  bookings: BookingDiaryEntry[];
  trips: TripJourneyWithFuel[];
  fuelLogs: FuelLogWithDriver[];
  weeklyMileage: WeeklyMileageEntry[];
  vehicles: Vehicle[];
  drivers: Driver[];
  language: Language;
};

const copy = {
  en: {
    title: "Weekly Boss Summary",
    previousWeek: "Previous completed week",
    weekEnding: "Week-ending Sunday",
    start: "Start",
    end: "End",
    print: "Print Weekly Boss Report",
    kpis: "Weekly KPIs",
    clients: "Client activity",
    vehicles: "Vehicle reconciliation",
    drivers: "Driver workload",
    routes: "Route activity",
    attention: "Needs Attention",
    note: "Fuel purchased is based on fuel-log dates. Fuel efficiency is calculated only from verified full-tank vehicle cycles. Fuel logs are not allocated as exact fuel consumption per individual job.",
    fuelPurchased: "Fuel purchased during the week",
    workingKm: "Working KM",
    actualKm: "Verified Actual KM",
    plannedKm: "Planned Google KM",
    coverage: "Trip coverage",
    odometer: "Weekly odometer distance",
    unallocated: "Other/unallocated movement",
    missingMileage: "Vehicles missing weekly mileage",
    cycles: "Verified full-tank cycles ending in the week",
    dataChecked: "Data-checked trips",
    jobs: "Booking Diary jobs recorded",
    trips: "Trip Journeys created",
    avgPrice: "Average fuel price per litre",
    routeAccuracy: "Route accuracy sample",
    generated: "Generated",
    records: "records",
    manual: "Manual",
    cycleEnding: "Cycle ending this week",
    noAttention: "No attention items.",
    client: "Client", share: "Share", commonRoute: "Common route", vehicle: "Vehicle", missingTrips: "Missing trips",
    type: "Type", driver: "Driver", status: "Status", fuel: "Fuel", dataCheckedShort: "Data checked", missingInfo: "Missing info",
    route: "Route", activeDates: "Active dates", avgPlanned: "Avg planned", avgWorking: "Avg Working", vehiclesShort: "Vehicles", missingMapsTrip: "Missing Maps/Trip"
  },
  th: {
    title: "สรุปประจำสัปดาห์สำหรับผู้บริหาร",
    previousWeek: "สัปดาห์ที่จบแล้วก่อนหน้า",
    weekEnding: "วันอาทิตย์สิ้นสุดสัปดาห์",
    start: "เริ่ม",
    end: "สิ้นสุด",
    print: "พิมพ์รายงานผู้บริหารรายสัปดาห์",
    kpis: "ตัวชี้วัดรายสัปดาห์",
    clients: "กิจกรรมลูกค้า",
    vehicles: "ตรวจสอบรถและเลขไมล์",
    drivers: "ภาระงานคนขับ",
    routes: "กิจกรรมเส้นทาง",
    attention: "รายการที่ต้องดูแล",
    note: "น้ำมันที่ซื้ออ้างอิงจากวันที่ใน Fuel Log ประสิทธิภาพน้ำมันคำนวณเฉพาะรอบรถที่ยืนยันเติมเต็มถังแล้ว Fuel Log ไม่ได้ถูกจัดสรรเป็นการใช้น้ำมันจริงของแต่ละงาน",
    fuelPurchased: "น้ำมันที่ซื้อในสัปดาห์",
    workingKm: "Working KM",
    actualKm: "Verified Actual KM",
    plannedKm: "Google KM ตามแผน",
    coverage: "ความครอบคลุมทริป",
    odometer: "ระยะเลขไมล์รายสัปดาห์",
    unallocated: "ระยะอื่น/ยังไม่จัดสรร",
    missingMileage: "รถที่ขาด Weekly Mileage",
    cycles: "รอบเติมเต็มถังที่จบในสัปดาห์",
    dataChecked: "ทริปที่ข้อมูลตรวจแล้ว",
    jobs: "งานใน Booking Diary",
    trips: "Trip Journey ที่สร้าง",
    avgPrice: "ราคาน้ำมันเฉลี่ยต่อลิตร",
    routeAccuracy: "ตัวอย่างเปรียบเทียบเส้นทาง",
    generated: "สร้างเมื่อ",
    records: "รายการ",
    manual: "กรอกเอง",
    cycleEnding: "รอบที่สิ้นสุดในสัปดาห์นี้",
    noAttention: "ไม่มีรายการที่ต้องดูแล",
    client: "ลูกค้า", share: "สัดส่วน", commonRoute: "เส้นทางที่ใช้บ่อย", vehicle: "รถ", missingTrips: "ทริปที่ขาด",
    type: "ประเภท", driver: "พนักงานขับรถ", status: "สถานะ", fuel: "น้ำมัน", dataCheckedShort: "ตรวจข้อมูลแล้ว", missingInfo: "ข้อมูลที่ขาด",
    route: "เส้นทาง", activeDates: "วันที่มีงาน", avgPlanned: "ระยะตามแผนเฉลี่ย", avgWorking: "ระยะวิ่งงานเฉลี่ย", vehiclesShort: "รถ", missingMapsTrip: "ขาด Maps/ทริป"
  }
};

function percentText(value: number | null) {
  return value == null ? "-" : `${formatNumber(value, "en", 1)}%`;
}

function km(value: number | null | undefined, language: Language) {
  return value == null ? "-" : `${formatNumber(value, language, 1)} km`;
}

function baht(value: number | null | undefined, language: Language) {
  return value == null ? "-" : formatCurrency(value, language);
}

function litres(value: number | null | undefined, language: Language) {
  return value == null ? "-" : `${formatNumber(value, language, 2)} L`;
}

function Kpi({ label, value, helper }: { label: string; value: string; helper?: string }) {
  return <article className="booking-insights-overview-metric is-purple"><span>{label}</span><strong>{value}</strong>{helper ? <p>{helper}</p> : null}</article>;
}

function StatusPill({ value, language }: { value: string; language: Language }) {
  const green = value === "Complete";
  const label = language === "th" ? (green ? "ครบถ้วน" : "ต้องตรวจสอบ") : value;
  return <span className={`booking-insights-status ${green ? "is-green" : "is-amber"}`}>{label}</span>;
}

export function WeeklyBossReportPanel({ bookings, trips, fuelLogs, weeklyMileage, vehicles, drivers, language }: Props) {
  const languageKey = language === "th" ? "th" : "en";
  const c = copy[languageKey];
  const defaultPeriod = useMemo(() => defaultWeeklyBossPeriod(), []);
  const [weekEnding, setWeekEnding] = useState(defaultPeriod.endDate);
  const [generatedAt, setGeneratedAt] = useState("");
  const period = useMemo(() => weekFromEndingSunday(weekEnding || defaultPeriod.endDate), [defaultPeriod.endDate, weekEnding]);
  const report = useMemo(
    () => buildWeeklyBossReport({ bookings, trips, fuelLogs, weeklyMileage, vehicles, drivers, period }),
    [bookings, drivers, fuelLogs, period, trips, vehicles, weeklyMileage]
  );

  useEffect(() => {
    setGeneratedAt(new Intl.DateTimeFormat(languageKey === "th" ? "th-TH" : "en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Bangkok"
    }).format(new Date()));
  }, [languageKey]);

  const print = () => window.setTimeout(() => window.print(), 0);
  const topAttention = report.needsAttention.filter((issue) => issue.count > 0);

  return <section className="weekly-boss-report">
    <div className="booking-insights-section is-purple">
      <div className="booking-insights-section-heading">
        <div className="app-icon-tile h-9 w-9"><CalendarDays className="h-4 w-4" /></div>
        <div><h3>{c.title}</h3><p>{formatDate(period.startDate, language)} - {formatDate(period.endDate, language)}</p></div>
      </div>
      <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <label className="form-field max-w-xs">
          <span className="form-label">{c.weekEnding}</span>
          <input type="date" value={weekEnding} onChange={(event) => setWeekEnding(event.target.value)} className="booking-filter-control" />
        </label>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setWeekEnding(defaultPeriod.endDate)} className="btn-secondary">{c.previousWeek}</button>
          <button type="button" onClick={print} className="btn-primary gap-2"><Printer className="h-4 w-4" />{c.print}</button>
        </div>
      </div>
    </div>

    <section className="booking-insights-section is-slate">
      <div className="booking-insights-section-heading"><div className="app-icon-tile h-9 w-9"><Gauge className="h-4 w-4" /></div><div><h3>{c.kpis}</h3><p>{c.note}</p></div></div>
      <div className="booking-insights-overview-grid">
        <Kpi label={c.jobs} value={formatNumber(report.kpis.bookingJobs, language)} />
        <Kpi label={c.trips} value={formatNumber(report.kpis.tripJourneys, language)} />
        <Kpi label={c.dataChecked} value={formatNumber(report.kpis.dataCheckedTrips, language)} />
        <Kpi label={c.coverage} value={percentText(report.kpis.tripCoveragePercent)} />
        <Kpi label={c.plannedKm} value={km(report.kpis.plannedGoogleKm, language)} helper={`${report.kpis.plannedGoogleRecordCount} ${c.records}`} />
        <Kpi label={c.workingKm} value={km(report.kpis.workingKm, language)} helper={`${c.manual} ${km(report.kpis.workingBreakdown.manual, language)} | ${c.odometer} ${km(report.kpis.workingBreakdown.odometer, language)} | Google ${km(report.kpis.workingBreakdown.google, language)}`} />
        <Kpi label={c.actualKm} value={km(report.kpis.verifiedActualKm, language)} helper={`${report.kpis.verifiedActualRecordCount} ${c.records}`} />
        <Kpi label={`${c.fuelPurchased} - L`} value={litres(report.kpis.fuelPurchasedLitres, language)} />
        <Kpi label={`${c.fuelPurchased} - THB`} value={baht(report.kpis.fuelPurchasedThb, language)} />
        <Kpi label={c.avgPrice} value={report.kpis.averageFuelPricePerLitre == null ? "-" : `${baht(report.kpis.averageFuelPricePerLitre, language)}/L`} />
        <Kpi label={c.cycles} value={formatNumber(report.kpis.verifiedCyclesEnding, language)} helper={c.cycleEnding} />
        <Kpi label={c.odometer} value={km(report.kpis.weeklyOdometerDistance, language)} />
        <Kpi label={c.unallocated} value={km(report.kpis.otherUnallocatedMovement, language)} />
        <Kpi label={c.missingMileage} value={formatNumber(report.kpis.vehiclesMissingWeeklyMileage, language)} />
        <Kpi label={c.routeAccuracy} value={percentText(report.kpis.routeAccuracyPercent)} helper={`${report.kpis.routeAccuracySampleSize} ${c.records}`} />
      </div>
    </section>

    <div className="grid gap-3 xl:grid-cols-2">
      <BossTable title={c.clients} icon={Users} report={report} language={language} type="clients" />
      <BossTable title={c.vehicles} icon={Truck} report={report} language={language} type="vehicles" />
      <BossTable title={c.drivers} icon={Users} report={report} language={language} type="drivers" />
      <BossTable title={c.routes} icon={Route} report={report} language={language} type="routes" />
    </div>

    <section className="booking-insights-section is-amber">
      <div className="booking-insights-section-heading"><div className="app-icon-tile h-9 w-9"><AlertCircle className="h-4 w-4" /></div><div><h3>{c.attention}</h3><p>{c.note}</p></div></div>
      <div className="grid gap-2">
        {topAttention.length === 0 ? <p className="booking-insights-empty-copy">{c.noAttention}</p> : topAttention.map((issue) => (
          <details key={issue.key} className="rounded-lg border border-amber-200 bg-white/90 p-3">
            <summary className="cursor-pointer text-sm font-bold text-amber-900">{issue.label}: {formatNumber(issue.count, language)}</summary>
            <ul className="mt-2 grid gap-1 text-xs text-slate-600">{issue.rows.slice(0, 12).map((row) => <li key={`${issue.key}-${row.id}`}>{row.href ? <a className="font-semibold text-brand-700" href={row.href}>{row.label}</a> : row.label}</li>)}</ul>
          </details>
        ))}
      </div>
    </section>

    <WeeklyBossPrint report={report} language={language} generatedAt={generatedAt} />
  </section>;
}

function BossTable({ title, icon: Icon, report, language, type }: { title: string; icon: typeof Users; report: WeeklyBossReport; language: Language; type: "clients" | "vehicles" | "drivers" | "routes" }) {
  const c = copy[language === "th" ? "th" : "en"];
  return <section className="booking-insights-section is-green">
    <div className="booking-insights-section-heading"><div className="app-icon-tile h-9 w-9"><Icon className="h-4 w-4" /></div><div><h3>{title}</h3></div></div>
    <div className="table-scroll">
      {type === "clients" ? <table className="booking-insights-manager-table"><thead><tr><th>{c.client}</th><th>{c.jobs}</th><th>{c.share}</th><th>{c.plannedKm}</th><th>{c.workingKm}</th><th>{c.commonRoute}</th><th>{c.vehicle}</th><th>{c.missingTrips}</th></tr></thead><tbody>{report.clientActivity.slice(0, 8).map((row) => <tr key={row.clientId}><td>{row.clientName}</td><td>{row.jobCount}</td><td>{percentText(row.sharePercent)}</td><td>{km(row.plannedKm, language)}</td><td>{km(row.workingKm, language)}</td><td>{row.mostCommonRoute}</td><td>{row.mostRequestedVehicleType}</td><td>{row.missingTripJourneyCount}</td></tr>)}</tbody></table> : null}
      {type === "vehicles" ? <table className="booking-insights-manager-table"><thead><tr><th>{c.vehicle}</th><th>{c.type}</th><th>{c.drivers}</th><th>{c.jobs}</th><th>{c.trips}</th><th>{c.workingKm}</th><th>{c.odometer}</th><th>{c.coverage}</th><th>{c.fuel} L/THB</th><th>km/L</th><th>{c.status}</th></tr></thead><tbody>{report.vehicleReconciliation.slice(0, 10).map((row) => <tr key={row.vehicleReg}><td>{row.vehicleReg}</td><td>{row.vehicleType}</td><td>{row.drivers.join(", ") || "-"}</td><td>{row.jobCount}</td><td>{row.tripCount}</td><td>{km(row.workingKm, language)}</td><td>{km(row.weeklyOdometerDistance, language)}</td><td>{percentText(row.coveragePercent)}</td><td>{litres(row.fuelPurchasedLitres, language)} / {baht(row.fuelPurchasedThb, language)}</td><td>{row.verifiedCycleKmPerLitre == null ? "-" : `${formatNumber(row.verifiedCycleKmPerLitre, language, 2)} km/L`}</td><td><StatusPill value={row.dataStatus} language={language} /></td></tr>)}</tbody></table> : null}
      {type === "drivers" ? <table className="booking-insights-manager-table"><thead><tr><th>{c.driver}</th><th>{c.jobs}</th><th>{c.trips}</th><th>{c.workingKm}</th><th>{c.dataCheckedShort}</th><th>{c.missingInfo}</th></tr></thead><tbody>{report.driverWorkload.slice(0, 10).map((row) => <tr key={row.driver}><td>{row.driver}</td><td>{row.jobs}</td><td>{row.trips}</td><td>{km(row.workingKm, language)}</td><td>{row.dataCheckedTrips}</td><td>{row.missingInformationCount}</td></tr>)}</tbody></table> : null}
      {type === "routes" ? <table className="booking-insights-manager-table"><thead><tr><th>{c.route}</th><th>{c.jobs}</th><th>{c.activeDates}</th><th>{c.avgPlanned}</th><th>{c.avgWorking}</th><th>{c.vehiclesShort}</th><th>{c.missingMapsTrip}</th></tr></thead><tbody>{report.routeActivity.slice(0, 10).map((row) => <tr key={row.route}><td>{row.route}</td><td>{row.jobCount}</td><td>{row.activeDates.join(", ")}</td><td>{km(row.averagePlannedKm, language)}</td><td>{km(row.averageWorkingKm, language)}</td><td>{row.vehicleTypesUsed.join(", ")}</td><td>{row.missingMapsOrTripCount}</td></tr>)}</tbody></table> : null}
    </div>
  </section>;
}

function WeeklyBossPrint({ report, language, generatedAt }: { report: WeeklyBossReport; language: Language; generatedAt: string }) {
  const c = copy[language === "th" ? "th" : "en"];
  return <div className="weekly-boss-print-report" aria-hidden="true">
    <section className="booking-insights-print-page weekly-boss-print-page">
      <header className="booking-insights-print-header"><Image src="/logo.png" alt="Expert Express Sender Co., Ltd." width={48} height={48} priority /><div><p>Expert Express Sender Co., Ltd.</p><h1>{c.title}</h1><span>{formatDate(report.period.startDate, language)} - {formatDate(report.period.endDate, language)} · {c.generated}: {generatedAt}</span></div></header>
      <div className="booking-insights-print-kpis">
        <Kpi label={c.jobs} value={String(report.kpis.bookingJobs)} />
        <Kpi label={c.trips} value={String(report.kpis.tripJourneys)} />
        <Kpi label={c.workingKm} value={km(report.kpis.workingKm, language)} />
        <Kpi label={c.fuelPurchased} value={`${litres(report.kpis.fuelPurchasedLitres, language)} / ${baht(report.kpis.fuelPurchasedThb, language)}`} />
        <Kpi label={c.cycles} value={String(report.kpis.verifiedCyclesEnding)} />
        <Kpi label={c.attention} value={String(report.needsAttention.reduce((sum, issue) => sum + issue.count, 0))} />
      </div>
      <section><h3>{c.vehicles}</h3><table><thead><tr><th>{c.vehicle}</th><th>{c.trips}</th><th>{c.workingKm}</th><th>{c.odometer}</th><th>{c.coverage}</th><th>{c.fuel}</th><th>{c.status}</th></tr></thead><tbody>{report.vehicleReconciliation.slice(0, 8).map((row) => <tr key={row.vehicleReg}><td>{row.vehicleReg}</td><td>{row.tripCount}</td><td>{km(row.workingKm, language)}</td><td>{km(row.weeklyOdometerDistance, language)}</td><td>{percentText(row.coveragePercent)}</td><td>{litres(row.fuelPurchasedLitres, language)}</td><td>{language === "th" ? (row.dataStatus === "Complete" ? "ครบถ้วน" : "ต้องตรวจสอบ") : row.dataStatus}</td></tr>)}</tbody></table></section>
      <div className="booking-insights-print-columns"><section><h3>{c.clients}</h3><ol>{report.clientActivity.slice(0, 5).map((row) => <li key={row.clientId}>{row.clientName}: {row.jobCount}</li>)}</ol></section><section><h3>{c.routes}</h3><ol>{report.routeActivity.slice(0, 5).map((row) => <li key={row.route}>{row.route}: {row.jobCount}</li>)}</ol></section><section><h3>{c.attention}</h3><ol>{report.needsAttention.filter((issue) => issue.count > 0).slice(0, 6).map((issue) => <li key={issue.key}>{issue.label}: {issue.count}</li>)}</ol></section></div>
      <footer>{c.note}</footer>
    </section>
  </div>;
}
