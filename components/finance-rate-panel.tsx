"use client";

import { useState } from "react";
import type { FlowRun, FlowT } from "@/components/finance-billing-flow";
import { sheetErrorText } from "@/components/finance-billing-flow";
import { useFinanceFixture } from "@/components/finance-fixture-provider";
import {
  CUSTOMER_RATE_SCHEDULES,
  DIESEL_B7_SOURCE_URL,
  confirmedWorkOrder,
  diagnoseRate,
  evaluateMapping,
  resolveJobFuel,
  type BillingSheet,
  type Booking,
  type RateSuggested,
  type State
} from "@/lib/finance-demo-centre";
import { formatThb } from "@/lib/finance-display";
import { fuelCalculation } from "@/lib/finance-pricing-evidence";

const input = "w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-950";
const btn = "rounded-lg border border-violet-400 bg-violet-50 px-3 py-1.5 text-sm font-semibold text-violet-950 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-40";
const btnPrimary = "rounded-lg bg-violet-800 px-3 py-1.5 text-sm font-semibold text-white hover:bg-violet-900 disabled:cursor-not-allowed disabled:opacity-40";

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="break-words text-sm font-medium text-slate-900">{value}</dd>
    </div>
  );
}

/**
 * Contextual pricing evidence for one work order: the matched schedule, the historical Diesel B7 for the job's own
 * transport date, the exact quoted band and the actions Finance can take. Nothing is applied without a click, and a price
 * is never invented — when the chain is incomplete the panel says exactly which link is missing.
 */
export default function FinanceRatePanel({ state, sheet, job, run, t, locked }: {
  state: State; sheet: BillingSheet; job: Booking; run: FlowRun; t: FlowT; locked: boolean;
}) {
  const { role } = useFinanceFixture();
  const wo = confirmedWorkOrder(job);
  const line = sheet.lines[job.id];
  const diagnosis = diagnoseRate(state, job);
  const calc = fuelCalculation(state, sheet, job);
  const fuel = resolveJobFuel(state, job);
  const [choice, setChoice] = useState("");
  const [checked, setChecked] = useState(false);
  const [overwrite, setOverwrite] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualAmount, setManualAmount] = useState("");
  const [manualReason, setManualReason] = useState("");
  const [fuelPrice, setFuelPrice] = useState("");
  const [fuelEvidence, setFuelEvidence] = useState("");
  const [fuelRevise, setFuelRevise] = useState("");
  const [scheduleId, setScheduleId] = useState("");
  const [rowId, setRowId] = useState("");
  const [contract, setContract] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [review, setReview] = useState("");
  const [message, setMessage] = useState("");

  const candidates = diagnosis.kind === "unavailable" ? diagnosis.candidates : [];
  const chosen: RateSuggested | null = diagnosis.kind === "suggested" ? diagnosis : candidates.find((item) => item.mappingId === choice) ?? null;
  const chosenMapping = chosen ? (state.rateMappings || []).find((item) => item.id === chosen.mappingId) : undefined;
  const existing = line?.transport ?? null;
  const schedule = CUSTOMER_RATE_SCHEDULES.find((item) => item.id === scheduleId);
  const row = schedule?.rows.find((item) => item.id === rowId);
  const report = (result: ReturnType<FlowRun>, ok: string) => setMessage(result.ok ? ok : sheetErrorText(result.code, result.detail, t));
  const sourceHref = chosenMapping ? `/api/finance-pricing-source/${chosenMapping.scheduleId}#page=${chosen!.sourcePage}` : "";

  const apply = (amount: number, reason: string) => {
    if (!chosen) return;
    const result = run({ type: "sheet_apply_rate", sheetId: sheet.id, jobId: job.id, mappingId: chosen.mappingId, amountThb: amount, overrideReason: reason, routeVehicleConfirmed: checked, confirmOverwrite: overwrite });
    report(result, amount === chosen.amountThb ? t("Suggested price applied. Totals, TRN statement, invoice draft and Finance Records now use it.", "ใช้ราคาที่แนะนำแล้ว ยอดรวม TRN ใบแจ้งหนี้ร่าง และบันทึกการเงินใช้ยอดนี้") : t("Manual price recorded with your reason.", "บันทึกราคาที่กำหนดเองพร้อมเหตุผลแล้ว"));
    if (result.ok) { setManualOpen(false); setManualAmount(""); setManualReason(""); setChecked(false); setOverwrite(false); }
  };

  const unavailableText = diagnosis.kind === "unavailable" ? t(diagnosis.en, diagnosis.th) : "";
  const source = fuel ? (fuel.method === "automatic" ? t("retrieved automatically", "ดึงอัตโนมัติ") : t("manually verified", "ตรวจยืนยันด้วยคน")) : "";

  return (
    <div className="space-y-3 rounded-xl border border-violet-200 bg-white p-3" data-testid="rate-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-bold text-violet-950">{t("Suggested Transport Charge", "ราคาค่าขนส่งที่แนะนำ")} · WO {wo}</h3>
        <span className="text-xs text-slate-600">{t("Fuel price follows the transport date", "ราคาน้ำมันอ้างอิงตามวันขนส่ง")}: <b>{job.date}</b></span>
      </div>

      <div className="rounded-lg bg-violet-50/60 p-3 ring-1 ring-violet-200" data-testid="fuel-calculation" data-calc-state={calc.state}>
        <p className="mb-1 text-sm font-bold text-violet-950">{t("Fuel calculation", "การคำนวณตามราคาน้ำมัน")}</p>
        <p className="mb-2 text-xs text-slate-700">{t("This is the job date → the fuel price on that date → its pricing band → the exact charge from the customer's rate table.", "วันงาน → ราคาน้ำมันของวันนั้น → ช่วงราคา → ค่าขนส่งตามตารางราคาลูกค้า")}</p>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 md:grid-cols-4">
          <Field label={t("Customer", "ลูกค้า")} value={calc.customer} />
          <Field label={t("Work order", "ใบงาน")} value={<b>{calc.workOrder}</b>} />
          <Field label={t("Booking date", "วันที่งาน")} value={calc.jobDate} />
          <Field label={t("Route", "เส้นทาง")} value={calc.route} />
          <Field label={t("Vehicle", "รถ")} value={calc.registration + (calc.vehicle ? " · " + calc.vehicle : "")} />
          <Field label="Diesel B7" value={calc.fuel.priceThb === null ? <span className="text-rose-800">{t("Missing", "ยังไม่มี")}</span> : <>฿{calc.fuel.priceThb.toFixed(2)}/L <span className={"rounded-full px-1.5 text-xs font-bold " + (calc.fuel.status === "verified" ? "bg-emerald-100 text-emerald-900" : calc.fuel.status === "proposed" ? "bg-amber-100 text-amber-900" : "bg-orange-200 text-orange-950")}>{calc.fuel.status === "verified" ? t("verified", "ยืนยันแล้ว") : calc.fuel.status === "proposed" ? t("pending owner verification", "รอเจ้าของยืนยัน") : t("disputed", "โต้แย้ง")}</span></>} />
          <Field label={t("Matching fuel band", "ช่วงราคาที่ตรงกัน")} value={calc.band || "—"} />
          <Field label={t("Source schedule", "ตารางต้นทาง")} value={calc.schedule ? calc.schedule + " · v" + calc.scheduleVersion + (calc.sourcePage ? " · " + t("page", "หน้า") + " " + calc.sourcePage : "") : "—"} />
          <Field label={t("Rate row", "แถวราคา")} value={calc.routeRow ? calc.routeRow + " · " + calc.rowVehicle : "—"} />
          <Field label={t("Table charge", "ราคาตามตาราง")} value={calc.tableCharge === null ? "—" : <b>{formatThb(calc.tableCharge)}</b>} />
          <Field label={t("Applied charge", "ราคาที่ใช้")} value={calc.applied === null ? t("not applied", "ยังไม่ใช้") : <b>{formatThb(calc.applied)}</b>} />
          <Field label={t("Evidence", "หลักฐาน")} value={calc.fuel.evidence || "—"} />
        </dl>
        {calc.overrideReason ? <p className="mt-1 text-xs font-semibold text-amber-900">{t("Manual override", "แก้ราคาเอง")}: {calc.overrideReason}</p> : null}
        <p className="mt-1 text-xs text-slate-700">{calc.note}</p>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="space-y-2 rounded-lg bg-slate-50 p-3">
          <p className="text-sm font-semibold text-slate-800">{t("Historical Diesel B7 (Bangkok)", "ดีเซล B7 ย้อนหลัง (กรุงเทพฯ)")}</p>
          {fuel ? (
            <p className="text-sm text-slate-900" data-testid="rate-fuel">
              <b className="text-lg tabular-nums">฿{fuel.priceThb.toFixed(2)}</b>/L · {fuel.date} · {source}{fuel.reviewer ? ` · ${t("confirmed by", "ยืนยันโดย")} ${fuel.reviewer}` : ""}
              <span className="mt-0.5 block break-words text-xs text-slate-600">{fuel.evidence}</span>
            </p>
          ) : (
            <p className="text-sm font-semibold text-amber-900">{t(`No verified Diesel B7 price for ${job.date} yet.`, `ยังไม่มีราคาดีเซล B7 ที่ยืนยันสำหรับ ${job.date}`)}</p>
          )}
          {!locked ? (
            <details className="text-sm" open={!fuel}>
              <summary className="cursor-pointer font-semibold text-violet-900">{fuel ? t("Revise this date's reference", "แก้ไขราคาอ้างอิงของวันนี้") : t("Enter the exact-date Diesel B7 price", "กรอกราคาดีเซล B7 ตรงวัน")}</summary>
              <p className="my-2 text-xs text-slate-600">
                {t("Automatic retrieval is not enabled (the website has no documented API). Open the source, read the Diesel B7 price for exactly this date, and record it with a dated evidence note. No carry-forward from another day. If the source has no row for this exact date, do not guess — ask the owner whether a carry-forward rule is approved.", "ยังไม่เปิดการดึงอัตโนมัติ (เว็บไซต์ไม่มี API ที่เผยแพร่) เปิดแหล่งข้อมูล อ่านราคาดีเซล B7 ของวันนี้โดยตรง แล้วบันทึกพร้อมหลักฐานที่ระบุวันที่ ห้ามใช้ราคาของวันอื่น หากแหล่งข้อมูลไม่มีแถวของวันนั้น อย่าเดา ให้ถามเจ้าของว่าอนุมัติกฎใช้ราคาวันก่อนหน้าหรือไม่")}
                {" "}<a className="font-semibold text-violet-900 underline" href={DIESEL_B7_SOURCE_URL} target="_blank" rel="noreferrer">{t("Open historical source", "เปิดแหล่งราคาย้อนหลัง")}</a>
              </p>
              <div className="grid gap-2 sm:grid-cols-[8rem_1fr]">
                <label className="text-xs font-semibold">{t("THB per litre", "บาทต่อลิตร")}<input className={input} inputMode="decimal" aria-label={t("Diesel B7 THB per litre", "ราคาดีเซล B7 บาทต่อลิตร")} value={fuelPrice} onChange={(e) => setFuelPrice(e.target.value)} /></label>
                <label className="text-xs font-semibold">{t("Dated evidence reference", "หลักฐานอ้างอิงที่ระบุวันที่")}<input className={input} aria-label={t("Fuel evidence", "หลักฐานราคาน้ำมัน")} value={fuelEvidence} onChange={(e) => setFuelEvidence(e.target.value)} placeholder={t(`e.g. History page, ${job.date}, Diesel B7`, `เช่น หน้าประวัติราคา ${job.date} ดีเซล B7`)} /></label>
              </div>
              {fuel ? <label className="mt-2 block text-xs font-semibold">{t("Why the value changes (kept in the audit trail)", "เหตุผลที่เปลี่ยนค่า (เก็บในประวัติ)")}<input className={input} value={fuelRevise} onChange={(e) => setFuelRevise(e.target.value)} /></label> : null}
              <button type="button" className={`${btn} mt-2`} disabled={!/^\d{1,3}(\.\d{1,2})?$/.test(fuelPrice.trim()) || fuelEvidence.trim().length < 10}
                onClick={() => { const r = run({ type: "record_fuel_reference", date: job.date, priceThb: Number(fuelPrice), evidence: fuelEvidence, sourceUrl: DIESEL_B7_SOURCE_URL, ...(fuelRevise.trim() ? { revisionReason: fuelRevise } : {}) }); report(r, t("Diesel B7 reference saved for this date and reusable for every job on it.", "บันทึกราคาดีเซล B7 ของวันนี้แล้ว ใช้ซ้ำกับทุกงานวันเดียวกันได้")); if (r.ok) { setFuelPrice(""); setFuelEvidence(""); setFuelRevise(""); } }}>
                {t("Save fuel reference", "บันทึกราคาน้ำมัน")}
              </button>
            </details>
          ) : null}
        </div>

        <div className="space-y-2 rounded-lg bg-slate-50 p-3">
          {diagnosis.kind === "unavailable" ? (
            <>
              <p className="text-sm font-semibold text-amber-900" data-testid="rate-unavailable">{unavailableText}</p>
              {candidates.length ? (
                <fieldset className="space-y-1">
                  {candidates.map((item) => (
                    <label key={item.mappingId} className="flex items-start gap-2 text-sm">
                      <input type="radio" className="mt-0.5 h-4 w-4 shrink-0" name={`route-${job.id}`} checked={choice === item.mappingId} onChange={() => { setChoice(item.mappingId); setChecked(false); }} />
                      <span>{item.route} · {item.vehicle} · <b>{formatThb(item.amountThb)}</b></span>
                    </label>
                  ))}
                </fieldset>
              ) : null}
            </>
          ) : null}
          {chosen ? (
            <>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5" data-testid="rate-evidence">
                <Field label={t("Customer", "ลูกค้า")} value={job.client} />
                <Field label={t("Job date", "วันที่งาน")} value={job.date} />
                <Field label={t("Route", "เส้นทาง")} value={chosen.route} />
                <Field label={t("Vehicle", "รถ")} value={chosen.vehicle} />
                <Field label="Diesel B7" value={`฿${chosen.fuelPriceThb.toFixed(2)}/L`} />
                <Field label={t("Fuel bracket", "ช่วงราคาน้ำมัน")} value={chosen.bandLabel} />
                <Field label={t("Pricing source", "แหล่งราคา")} value={`${chosen.scheduleName} · v${chosen.scheduleVersion} · ${t("page", "หน้า")} ${chosen.sourcePage}`} />
                <Field label={t("Contract", "สัญญา")} value={chosen.contractReference} />
              </dl>
              <p className="text-lg font-black text-violet-950" data-testid="rate-suggested">{t("Suggested charge", "ราคาที่แนะนำ")}: {formatThb(chosen.amountThb)}</p>
              {chosen.reviewFlags.map((flag) => <p key={flag} className="text-xs font-semibold text-amber-900">⚠ {flag}</p>)}
              {existing ? <p className="text-xs text-amber-900">{t(`This line already has ${formatThb(existing.amount)} (${existing.source === "schedule" ? "approved rate" : "manual"}). Applying replaces it; the earlier price stays in the history.`, `รายการนี้มี ${formatThb(existing.amount)} อยู่แล้ว การใช้ราคานี้จะแทนที่ ราคาเดิมเก็บไว้ในประวัติ`)}</p> : null}
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0" checked={checked} onChange={(e) => setChecked(e.target.checked)} />{t("I checked this job's route and vehicle against this rate row", "ตรวจเส้นทางและรถของงานนี้ตรงกับแถวราคาแล้ว")}</label>
              {existing ? <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />{t("Replace the price already entered", "แทนที่ราคาที่กรอกไว้แล้ว")}</label> : null}
              <div className="flex flex-wrap gap-2">
                <button type="button" className={btnPrimary} disabled={locked || !checked || (!!existing && !overwrite)} onClick={() => apply(chosen.amountThb, "")}>{t("Apply Suggested Price", "ใช้ราคาที่แนะนำ")}</button>
                <a className={`${btn} inline-block`} href={sourceHref} target="_blank" rel="noreferrer">{t("Review Source Rate", "ดูราคาต้นทาง")}</a>
                <button type="button" className={btn} disabled={locked} onClick={() => setManualOpen((v) => !v)}>{t("Enter Manual Price", "กรอกราคาเอง")}</button>
              </div>
              {manualOpen ? (
                <div className="grid gap-2 sm:grid-cols-[9rem_1fr_auto]">
                  <input className={input} inputMode="decimal" aria-label={t("Manual transport price", "ราคาค่าขนส่งที่กำหนดเอง")} placeholder="THB" value={manualAmount} onChange={(e) => setManualAmount(e.target.value)} />
                  <input className={input} aria-label={t("Override reason", "เหตุผลที่เปลี่ยนราคา")} placeholder={t("Reason for overriding the suggestion", "เหตุผลที่เปลี่ยนราคาที่แนะนำ")} value={manualReason} onChange={(e) => setManualReason(e.target.value)} />
                  <button type="button" className={btn} disabled={!checked || !/^\d+(\.\d{1,2})?$/.test(manualAmount.trim()) || manualReason.trim().length < 10 || (!!existing && !overwrite)} onClick={() => apply(Number(manualAmount), manualReason)}>{t("Save override", "บันทึกการเปลี่ยนราคา")}</button>
                </div>
              ) : null}
            </>
          ) : diagnosis.kind === "unavailable" && !candidates.length && !locked ? (
            <div className="space-y-2">
              <p className="text-xs text-slate-600">{t("Authorised manual pricing: type the charge in the Transport column or record it here with an explanation.", "กำหนดราคาเองโดยผู้มีสิทธิ์: กรอกในช่องค่าขนส่ง หรือบันทึกที่นี่พร้อมคำอธิบาย")}</p>
              <div className="grid gap-2 sm:grid-cols-[9rem_1fr_auto]">
                <input className={input} inputMode="decimal" aria-label={t("Manual transport price", "ราคาค่าขนส่งที่กำหนดเอง")} placeholder="THB" value={manualAmount} onChange={(e) => setManualAmount(e.target.value)} />
                <input className={input} aria-label={t("Manual price explanation", "คำอธิบายราคาที่กำหนดเอง")} placeholder={t("Why no automatic price (min. 10 characters)", "เหตุผลที่ไม่ใช้ราคาอัตโนมัติ (อย่างน้อย 10 ตัวอักษร)")} value={manualReason} onChange={(e) => setManualReason(e.target.value)} />
                <button type="button" className={btn} disabled={!/^\d+(\.\d{1,2})?$/.test(manualAmount.trim()) || manualReason.trim().length < 10}
                  onClick={() => { const r = run({ type: "sheet_set_transport", sheetId: sheet.id, jobId: job.id, transport: { amount: Number(manualAmount), source: "manual", overrideReason: manualReason } }); report(r, t("Manual price recorded with your explanation.", "บันทึกราคาที่กำหนดเองพร้อมคำอธิบายแล้ว")); if (r.ok) { setManualAmount(""); setManualReason(""); } }}>
                  {t("Save manual price", "บันทึกราคาเอง")}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {line?.transport?.provenance ? (
        <details className="text-sm" data-testid="rate-saved">
          <summary className="cursor-pointer font-semibold text-slate-800">{t("Saved pricing decision", "การตัดสินใจราคาที่บันทึก")}: {formatThb(line.transport.provenance.appliedThb)}{line.transport.provenance.overrideReason ? ` (${t("override", "เปลี่ยนราคา")})` : ""}</summary>
          <p className="mt-1 text-slate-700">
            {line.transport.provenance.scheduleName} v{line.transport.provenance.scheduleVersion} · p.{line.transport.provenance.sourcePage} · {line.transport.provenance.route} · {line.transport.provenance.vehicle} · {line.transport.provenance.bandLabel} · Diesel B7 ฿{line.transport.provenance.fuel.priceThb.toFixed(2)}/L ({line.transport.provenance.fuel.date}, {line.transport.provenance.fuel.method}) ·
            {" "}{t("suggested", "แนะนำ")} {formatThb(line.transport.provenance.suggestedThb)} → {t("applied", "ใช้จริง")} {formatThb(line.transport.provenance.appliedThb)} · {line.transport.provenance.decidedBy} · {line.transport.provenance.decidedAt.slice(0, 16).replace("T", " ")}
            {line.transport.provenance.overrideReason ? ` · ${t("reason", "เหตุผล")}: ${line.transport.provenance.overrideReason}` : ""}
          </p>
          <p className="text-xs text-slate-500">{t("This decision is kept as saved. Changing a schedule or fuel value later never reprices it.", "การตัดสินใจนี้เก็บตามที่บันทึก การเปลี่ยนตารางหรือราคาน้ำมันภายหลังจะไม่ปรับราคาเดิม")}</p>
        </details>
      ) : null}
      {line?.priceHistory?.length ? (
        <details className="text-sm"><summary className="cursor-pointer font-semibold text-slate-800">{t("Earlier prices", "ราคาก่อนหน้า")} ({line.priceHistory.length})</summary>
          <ul className="mt-1 list-disc pl-5 text-slate-700">{line.priceHistory.map((entry, index) => <li key={index}>{formatThb(entry.transport.amount)} · {entry.transport.source} · {t("replaced", "ถูกแทนที่")} {entry.replacedAt.slice(0, 16).replace("T", " ")} · {entry.replacedBy}{entry.reason ? ` · ${entry.reason}` : ""}</li>)}</ul>
        </details>
      ) : null}

      <p className="text-xs text-slate-600" data-testid="agreement-note">{t("Pricing agreements are approved once in Price setup (owner) and apply to every matching job — no approval is needed per work order.", "ข้อตกลงราคาอนุมัติครั้งเดียวในตั้งค่าราคา (เจ้าของ) ใช้กับทุกงานที่ตรงกัน ไม่ต้องอนุมัติรายใบงาน")}</p>

      {message ? <p role="status" className="text-sm font-semibold text-violet-950" data-testid="rate-message">{message}</p> : null}
    </div>
  );
}
