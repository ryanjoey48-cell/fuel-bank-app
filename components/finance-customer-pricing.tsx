"use client";

import { useState } from "react";
import { CUSTOMER_RATE_SCHEDULES, DIESEL_B7_SOURCE_URL, suggestCustomerRate, type State, type Booking, type Role, type Action } from "@/lib/finance-demo-centre";

export default function FinanceCustomerPricing({ state, job, role, dispatch, t }: {
  state: State; job: Booking; role: Role; dispatch: (action: Action) => boolean; t: (en: string, th: string) => string;
}) {
  const [scheduleId, setScheduleId] = useState("");
  const [rowId, setRowId] = useState("");
  const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const [contract, setContract] = useState(""); const [review, setReview] = useState("");
  const [fuel, setFuel] = useState(""); const [fuelEvidence, setFuelEvidence] = useState("");
  const [mappingId, setMappingId] = useState(""); const [checked, setChecked] = useState(false);
  const [override, setOverride] = useState(""); const [overrideReason, setOverrideReason] = useState("");
  const [message, setMessage] = useState("");
  const schedule = CUSTOMER_RATE_SCHEDULES.find((item) => item.id === scheduleId);
  const row = schedule?.rows.find((item) => item.id === rowId);
  const mappings = (state.rateMappings || []).filter((item) => item.clientId === job.clientId && item.effectiveFrom <= job.date && (!item.effectiveTo || item.effectiveTo >= job.date));
  const mapping = mappings.find((item) => item.id === mappingId);
  const cachedFuel = state.bookings.find((item) => item.id !== job.id && item.fuelEvidence?.jobDate === job.date && item.fuelEvidence.referenceDate === job.date && item.fuelEvidence.verified)?.fuelEvidence;
  let suggestion: ReturnType<typeof suggestCustomerRate> | undefined;
  let missing = "";
  try { if (mapping) suggestion = suggestCustomerRate(job, mapping); } catch { missing = t("An exact verified fuel reference and valid approved mapping are required. No price is extrapolated.", "ต้องมีราคาน้ำมันที่ยืนยันตรงวันที่และตารางที่อนุมัติ ไม่มีการคาดเดาราคานอกตาราง"); }
  const run = (action: Action) => setMessage(dispatch(action) ? t("Recorded in local test workspace; check save status above.", "บันทึกในพื้นที่ทดสอบ โปรดตรวจสถานะการบันทึกด้านบน") : t("Blocked: check role, dates, evidence, receipt status and existing billing allocation.", "ดำเนินการไม่ได้ โปรดตรวจสิทธิ์ วันที่ หลักฐาน การรับเอกสาร และชุดวางบิล"));
  const input = "w-full min-w-0 rounded-lg border border-slate-400 bg-white px-3 py-2 text-sm text-slate-950";
  const btn = "rounded-lg border border-violet-400 bg-violet-50 px-3 py-2 text-sm font-semibold text-violet-950 disabled:opacity-40";
  return <section className="rounded-xl border border-violet-200 bg-white p-4">
    <h2 className="text-lg font-bold text-violet-950">{t("Customer Pricing", "ราคาค่าขนส่งลูกค้า")}</h2>
    <p className="mt-1 text-sm text-slate-700">{t("Exact imported PDF rates. Customer contracts, route, vehicle and effective dates require explicit confirmation. All role decisions here remain local tests.", "ใช้ยอดตามตาราง PDF ลูกค้า สัญญา เส้นทาง รถ และวันที่มีผลต้องยืนยันชัดเจน การตัดสินใจตามสิทธิ์ในหน้านี้ยังเป็นการทดสอบในเครื่อง")}</p>
    <details className="mt-3 rounded-lg border p-3">
      <summary className="cursor-pointer font-semibold text-violet-950">{t("Customer Rate Management — imported sources and mappings", "จัดการราคาลูกค้า — แหล่งข้อมูลและการผูกสัญญา")}</summary>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <label className="text-sm">{t("Source schedule", "ตารางต้นทาง")}<select className={input} value={scheduleId} onChange={(e) => { setScheduleId(e.target.value); setRowId(""); }}><option value="">{t("Select source document", "เลือกเอกสารต้นทาง")}</option>{CUSTOMER_RATE_SCHEDULES.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="text-sm">{t("Route and vehicle from source", "เส้นทางและรถตามต้นทาง")}<select className={input} value={rowId} onChange={(e) => setRowId(e.target.value)}><option value="">{t("Select exact row", "เลือกแถวที่ตรงกัน")}</option>{schedule?.rows.map((item) => <option key={item.id} value={item.id}>{item.pickup} → {item.delivery} · {item.vehicle}</option>)}</select></label>
        <label className="text-sm">{t("Contract reference for", "อ้างอิงสัญญาของ")} {job.client}<input className={input} value={contract} onChange={(e) => setContract(e.target.value)} /></label>
        <div className="grid grid-cols-2 gap-2"><label className="text-sm">{t("Effective from", "เริ่มมีผล")}<input className={input} type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label><label className="text-sm">{t("Effective to (optional)", "สิ้นสุด (ไม่บังคับ)")}<input className={input} type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label></div>
      </div>
      {row?.reviewFlags.map((flag) => <p key={flag} className="mt-2 text-sm font-semibold text-amber-950">{t("Source review required", "ต้องทบทวนต้นทาง")}: {flag}</p>)}
      {row?.reviewFlags.length ? <label className="mt-2 block text-sm">{t("Manager review reason", "เหตุผลการทบทวนของผู้จัดการ")}<input className={input} value={review} onChange={(e) => setReview(e.target.value)} /></label> : null}
      <button className={`${btn} mt-3`} disabled={role !== "approver" || !row || !from || contract.trim().length < 3} onClick={() => run({ type: "confirm_rate_mapping", scheduleId, rowId, clientId: job.clientId, contractReference: contract, effectiveFrom: from, effectiveTo: to || null, reviewReason: review })}>{t("Confirm customer mapping (Approver · local test)", "ยืนยันการผูกสัญญา (ผู้อนุมัติ · ทดสอบ)")}</button>
      {schedule ? <details className="mt-3 text-sm"><summary>{t("Exact source rates and conditions", "ราคาและเงื่อนไขต้นทาง")}</summary>
        <p className="mt-2 break-all">{schedule.sourceFilename} · {t("Version", "รุ่น")} {schedule.version}</p>
        {schedule.rules.map((rule) => <p key={rule} className="mt-1">{rule}</p>)}
        <p className="mt-1 text-amber-950">{t("Conditions are retained for review; extras are not automatically charged.", "เก็บเงื่อนไขไว้ตรวจทบทวน ไม่เรียกเก็บค่าใช้จ่ายเพิ่มเติมอัตโนมัติ")}</p>
        <ul className="mt-2 grid max-h-64 gap-1 overflow-y-auto sm:grid-cols-2">{row?.bands.map((band) => <li key={band.label}>{band.label}: ฿{band.amountThb.toLocaleString()} · {t("page", "หน้า")} {band.sourcePage}</li>)}</ul>
      </details> : null}
    </details>
    <div className="mt-4 grid gap-4 md:grid-cols-2">
      <div className="rounded-lg border p-3">
        <h3 className="font-bold">{t("Historical Diesel B7", "ราคาดีเซล B7 ย้อนหลัง")} · {job.date}</h3>
        <a href={DIESEL_B7_SOURCE_URL} target="_blank" rel="noreferrer" className="text-sm font-semibold text-violet-900 underline">{t("Open historical source", "เปิดแหล่งราคาย้อนหลัง")}</a>
        <p className="my-2 text-xs text-slate-700">{t("Automatic access is not established. Manually verify Diesel B7 for this exact Bangkok job date. No carry-forward or product substitution.", "ยังไม่ยืนยันการเข้าถึงอัตโนมัติ โปรดตรวจดีเซล B7 ตรงวันขนส่งตามเวลาประเทศไทย ไม่ใช้ราคาวันก่อนหรือเชื้อเพลิงอื่นแทน")}</p>
        <label className="block text-sm">{t("Diesel B7 (THB/L)", "ดีเซล B7 (บาท/ลิตร)")}<input className={input} inputMode="decimal" value={fuel} onChange={(e) => setFuel(e.target.value)} /></label>
        <label className="mt-2 block text-sm">{t("Dated source evidence / reference", "หลักฐานหรืออ้างอิงต้นทางที่มีวันที่")}<textarea className={input} rows={2} value={fuelEvidence} onChange={(e) => setFuelEvidence(e.target.value)} /></label>
        {cachedFuel ? <button className={`${btn} mt-2`} onClick={() => { setFuel(String(cachedFuel.priceThb)); setFuelEvidence(cachedFuel.evidence); }}>{t("Use saved reference for this date", "ใช้ข้อมูลอ้างอิงที่บันทึกสำหรับวันนี้")}</button> : null}
        <button className={`${btn} mt-2`} disabled={role !== "finance" || !/^\d+(\.\d{1,2})?$/.test(fuel) || fuelEvidence.trim().length < 10} onClick={() => run({ type: "confirm_fuel_reference", jobId: job.id, referenceDate: job.date, priceThb: Number(fuel), evidence: fuelEvidence, sourceUrl: DIESEL_B7_SOURCE_URL })}>{t("Confirm exact-date fuel evidence (test)", "ยืนยันหลักฐานน้ำมันตรงวันที่ (ทดสอบ)")}</button>
        {job.fuelEvidence ? <p className="mt-2 text-sm font-semibold">Diesel B7 ฿{job.fuelEvidence.priceThb.toFixed(2)}/L · {job.fuelEvidence.referenceDate} · {t("Manual evidence", "หลักฐานตรวจด้วยคน")}</p> : null}
      </div>
      <div className="rounded-lg border p-3">
        <label className="text-sm font-semibold">{t("Confirmed customer contract / route / vehicle", "สัญญา / เส้นทาง / รถที่ยืนยันแล้ว")}<select className={input} value={mappingId} onChange={(e) => { setMappingId(e.target.value); setChecked(false); setOverride(""); }}><option value="">{t("Select an approved mapping", "เลือกการผูกสัญญาที่อนุมัติ")}</option>{mappings.map((item) => { const s = CUSTOMER_RATE_SCHEDULES.find((s) => s.id === item.scheduleId); const r = s?.rows.find((r) => r.id === item.rowId); return <option key={item.id} value={item.id}>{item.contractReference} · {r?.pickup} → {r?.delivery} · {r?.vehicle}</option>; })}</select></label>
        {missing ? <p className="mt-2 text-sm text-amber-950">{missing}</p> : null}
        {suggestion ? <>
          <p className="mt-3 text-sm">{suggestion.row.pickup} → {suggestion.row.delivery} · {suggestion.row.vehicle}</p>
          <p className="mt-2 font-bold">{suggestion.band.label} → ฿{suggestion.band.amountThb.toLocaleString()}</p>
          <label className="mt-3 block text-sm"><input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} /> {t("I checked this job's route and vehicle against this rate row", "ตรวจเส้นทางและประเภทรถของงานนี้ตรงกับแถวราคาแล้ว")}</label>
          <label className="mt-2 block text-sm">{t("Override amount (optional)", "ยอดแก้ไข (ไม่บังคับ)")}<input className={input} inputMode="decimal" value={override} onChange={(e) => setOverride(e.target.value)} /></label>
          <label className="mt-2 block text-sm">{t("Override reason", "เหตุผลแก้ไขราคา")}<input className={input} value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} /></label>
          <button className={`${btn} mt-3`} disabled={role !== "finance" || !checked} onClick={() => run({ type: "confirm_scheduled_price", jobId: job.id, mappingId, amountThb: override.trim() ? Number(override) : suggestion!.band.amountThb, overrideReason, routeVehicleConfirmed: checked })}>{t("Confirm transport price (test)", "ยืนยันราคาขนส่ง (ทดสอบ)")}</button>
        </> : <p className="mt-3 text-sm">{t("If no approved source matches, use the existing reasoned manual-price option below.", "หากไม่มีต้นทางที่อนุมัติตรงกัน ให้ใช้การกำหนดราคาด้วยคนพร้อมเหตุผลด้านล่าง")}</p>}
        {job.pricingSnapshot ? <details className="mt-3 text-sm"><summary>{t("Saved pricing evidence", "หลักฐานราคาที่บันทึก")}</summary><p>{job.pricingSnapshot.sourceFilename} · {job.pricingSnapshot.bandLabel} · Diesel B7 {job.pricingSnapshot.fuel.priceThb} · ฿{job.pricingSnapshot.confirmedThb}</p><p>{job.pricingSnapshot.fuel.sourceUrl}</p><p>{job.pricingSnapshot.fuel.evidence}</p></details> : null}
      </div>
    </div>
    {message ? <p role="status" className="mt-3 text-sm font-semibold text-violet-950">{message}</p> : null}
  </section>;
}
