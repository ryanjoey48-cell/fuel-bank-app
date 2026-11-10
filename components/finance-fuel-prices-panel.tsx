"use client";

import { useState } from "react";
import { sheetErrorText, type FlowRun, type FlowT } from "@/components/finance-billing-flow";
import { DIESEL_B7_SOURCE_URL, type BillingSheet, type Booking, type State } from "@/lib/finance-demo-centre";
import { formatBangkokDateTime } from "@/lib/finance-display";
import { fuelDateSummary, sourceLookup } from "@/lib/finance-pricing-evidence";

const input = "w-full min-w-0 rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm text-slate-950";
const btn = "rounded-lg border border-violet-400 bg-violet-50 px-2.5 py-1 text-sm font-semibold text-violet-950 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-40";
const CHIP: Record<string, string> = {
  missing: "bg-rose-100 text-rose-900", proposed: "bg-amber-100 text-amber-900", verified: "bg-emerald-100 text-emerald-900", disputed: "bg-orange-200 text-orange-950"
};

/**
 * Permanent "Historical Diesel B7 Prices" section: one row per distinct job date in the batch. A value drives prices only when
 * it is Verified; Proposed and Disputed values are shown (with the band they would give) but never price a job. Finance enters,
 * verifies, disputes or corrects a value here once and every job on that date reuses it. Entry is manual-only.
 */
export default function FinanceFuelPricesPanel({ state, sheet, jobs, run, t, locked }: { state: State; sheet: BillingSheet; jobs: Booking[]; run: FlowRun; t: FlowT; locked: boolean }) {
  const rows = fuelDateSummary(state, sheet, jobs);
  const [edit, setEdit] = useState<Record<string, { price: string; evidence: string; reason: string; proposed: boolean; open: boolean }>>({});
  const [message, setMessage] = useState("");
  const get = (date: string) => edit[date] ?? { price: "", evidence: "", reason: "", proposed: false, open: false };
  const set = (date: string, patch: Partial<ReturnType<typeof get>>) => setEdit((prev) => ({ ...prev, [date]: { ...get(date), ...patch } }));
  const report = (result: ReturnType<FlowRun>, ok: string) => { setMessage(result.ok ? ok : sheetErrorText(result.code, result.detail, t)); return result.ok; };
  const STATUS: Record<string, [string, string]> = { missing: ["Missing", "ยังไม่มี"], proposed: ["Proposed", "เสนอ (รอยืนยัน)"], verified: ["Verified", "ยืนยันแล้ว"], disputed: ["Disputed", "โต้แย้ง"] };

  return (
    <section className="rounded-lg bg-slate-50 p-3" data-testid="fuel-prices-panel" aria-label={t("EES Historical Diesel B7 — Official Reference", "ราคาดีเซล B7 ย้อนหลัง — แหล่งอ้างอิงทางการของ EES")}>
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h3 className="text-base font-bold text-violet-950">{t("EES Historical Diesel B7 — Official Reference", "ราคาดีเซล B7 ย้อนหลัง — แหล่งอ้างอิงทางการของ EES")}</h3>
        <a className="ees-fc-btn-secondary !py-0.5 text-sm" href={DIESEL_B7_SOURCE_URL} target="_blank" rel="noreferrer" data-testid="fuel-open-source-main">{t("Open the approved source ↗", "เปิดแหล่งที่อนุมัติ ↗")}</a>
        <a className="text-xs font-semibold text-violet-900 underline" href={DIESEL_B7_SOURCE_URL} target="_blank" rel="noreferrer" data-testid="fuel-source-link">{DIESEL_B7_SOURCE_URL}</a>
      </div>
      <p className="mb-2 text-xs text-slate-600">
        {t("This is the only fuel-price source EES uses. The page lists retail reference prices (not filling-station transactions) by date; read the Diesel B7 (ดีเซล B7) column. Manual verification only — no automatic fetching. Only a Verified value prices a job; a Proposed or Disputed value is shown for review but never used. Each date's value is entered once and reused by every job on that date. Today's price and neighbouring days are never substituted.",
          "นี่คือแหล่งราคาน้ำมันเดียวที่ EES ใช้ หน้านี้แสดงราคาอ้างอิงขายปลีก (ไม่ใช่ราคาที่เติมจริง) ตามวันที่ ให้อ่านคอลัมน์ ดีเซล B7 ยืนยันด้วยมือเท่านั้น ไม่ดึงอัตโนมัติ เฉพาะค่าที่ยืนยันแล้วเท่านั้นที่ใช้คิดราคา ค่าที่เสนอหรือถูกโต้แย้งใช้แสดงเพื่อตรวจสอบเท่านั้น กรอกครั้งเดียวต่อวันและใช้ซ้ำกับทุกงานวันเดียวกัน ไม่ใช้ราคาวันนี้หรือวันใกล้เคียงแทน")}
      </p>
      <div className="overflow-x-auto rounded-lg bg-white ring-1 ring-slate-200">
        <table className="w-full text-sm" data-testid="fuel-date-table">
          <thead className="bg-slate-100 text-left text-xs text-slate-600">
            <tr>
              <th className="px-2 py-1">{t("Job date · where to look", "วันงาน · จุดที่ต้องดู")}</th><th className="px-2 py-1">{t("Jobs", "งาน")}</th><th className="px-2 py-1">{t("Diesel B7 ฿/L", "ดีเซล B7 ฿/ลิตร")}</th>
              <th className="px-2 py-1">{t("Status", "สถานะ")}</th><th className="px-2 py-1">{t("Evidence / verified by", "หลักฐาน / ผู้ยืนยัน")}</th><th className="px-2 py-1">{t("Band → transport price", "ช่วงราคา → ค่าขนส่ง")}</th><th className="px-2 py-1">{t("Needs owner review", "ต้องให้เจ้าของตรวจ")}</th><th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const e = get(row.date);
              return (
                <tr key={row.date} className="border-t border-slate-100 align-top" data-testid="fuel-date-row" data-status={row.status}>
                  <td className="px-2 py-1.5">
                    <b className="whitespace-nowrap tabular-nums">{row.date}</b>
                    <span className="block text-xs text-slate-600">{t(`Month ${sourceLookup(row.date).enMonth} ${sourceLookup(row.date).gregorianYear} (${sourceLookup(row.date).thaiMonth} พ.ศ. ${sourceLookup(row.date).buddhistYear}) → row "${sourceLookup(row.date).rowText}"`, `เดือน ${sourceLookup(row.date).thaiMonth} พ.ศ. ${sourceLookup(row.date).buddhistYear} → แถว "${sourceLookup(row.date).rowText}"`)}</span>
                    <a className="text-xs font-semibold text-violet-900 underline" href={DIESEL_B7_SOURCE_URL} target="_blank" rel="noreferrer" data-testid="fuel-open-source">{t("Open Source ↗", "เปิดแหล่งข้อมูล ↗")}</a>
                  </td>
                  <td className="px-2 py-1.5" title={row.workOrders.join(", ")}>{row.jobCount}<span className="block text-xs text-slate-500">{row.workOrders.join(", ")}</span></td>
                  <td className="px-2 py-1.5 text-base font-bold tabular-nums">{row.ref ? `฿${row.ref.priceThb.toFixed(2)}` : "—"}<span className="block text-xs font-normal text-slate-500">Diesel B7</span></td>
                  <td className="px-2 py-1.5"><span className={`rounded-full px-2 py-0.5 text-xs font-bold ${CHIP[row.status]}`}>{t(STATUS[row.status][0], STATUS[row.status][1])}</span></td>
                  <td className="max-w-[16rem] px-2 py-1.5 text-xs">
                    {row.ref ? <><span className="break-words">{row.ref.evidence}</span><br />
                      {row.status === "verified" ? <span className="text-emerald-800">{t("Verified by", "ยืนยันโดย")} {row.ref.verifiedBy ?? row.ref.reviewer} · {formatBangkokDateTime(row.ref.verifiedAt ?? row.ref.retrievedAt)}</span> : <span className="text-slate-500">{t("Entered by", "บันทึกโดย")} {row.ref.reviewer} · {formatBangkokDateTime(row.ref.retrievedAt)}</span>}</> : <span className="text-rose-800">{t("No value recorded", "ยังไม่มีค่า")}</span>}
                  </td>
                  <td className="px-2 py-1.5 text-xs">{row.charges.some((c) => c.band) ? row.charges.map((c) => <span key={c.workOrder} className="block whitespace-nowrap">{c.workOrder}: {c.band ? c.band + " → " : ""}<b>{c.applied !== null ? "฿" + c.applied.toFixed(2) : c.table !== null ? "฿" + c.table.toFixed(2) : "—"}</b>{c.state === "provisional" ? " (" + t("pending", "รอ") + ")" : ""}{c.applied !== null && c.table !== null && c.applied !== c.table ? " (" + t("table", "ตาราง") + " ฿" + c.table.toFixed(2) + ")" : ""}</span>) : "—"}</td>
                  <td className="max-w-[14rem] px-2 py-1.5 text-xs text-amber-900">{row.discrepancies.length ? row.discrepancies.map((d) => <span key={d} className="block">⚠ {d}</span>) : <span className="text-emerald-800">✓</span>}</td>
                  <td className="whitespace-nowrap px-2 py-1.5">
                    {locked ? null : (
                      <span className="flex flex-wrap gap-1">
                        {row.status === "proposed" || row.status === "disputed" ? <button type="button" className={btn} data-testid="fuel-verify" onClick={() => report(run({ type: "verify_fuel_reference", date: row.date }), t(`Verified Diesel B7 for ${row.date}. Every job on that date can now use it.`, `ยืนยันดีเซล B7 ของ ${row.date} แล้ว ทุกงานวันนั้นใช้ได้`))}>{t("Confirm price", "ยืนยันราคา")}</button> : null}
                        <button type="button" className={btn} onClick={() => set(row.date, { open: !e.open })}>{row.ref ? t("Correct price…", "แก้ไขราคา…") : t("Enter price…", "กรอกราคา…")}</button>
                        {row.ref && row.status !== "disputed" ? <button type="button" className={btn} data-testid="fuel-dispute" onClick={() => { const reason = window.prompt(t("Why is this value disputed? (kept in the history)", "เหตุผลที่โต้แย้งค่านี้ (เก็บในประวัติ)"), ""); if (reason !== null) report(run({ type: "dispute_fuel_reference", date: row.date, reason }), t("Marked as disputed. It no longer prices jobs.", "ทำเครื่องหมายโต้แย้งแล้ว ไม่ใช้คิดราคา")); }}>{t("Dispute", "โต้แย้ง")}</button> : null}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.flatMap((row) => {
              const e = get(row.date);
              if (!e.open || locked) return [];
              return [
                <tr key={row.date + "-edit"} className="border-t border-violet-100 bg-violet-50/50" data-testid="fuel-edit-row">
                  <td colSpan={8} className="px-2 py-2">
                    <div className="grid items-end gap-2 md:grid-cols-[7rem_1fr_1fr_auto_auto]">
                      <label className="text-xs font-semibold">{row.date} · THB/L<input className={input} inputMode="decimal" aria-label={`${t("Diesel B7 THB/L", "ดีเซล B7 บาท/ลิตร")} ${row.date}`} value={e.price} onChange={(ev) => set(row.date, { price: ev.target.value })} /></label>
                      <label className="text-xs font-semibold">{t("Dated evidence (source page, date)", "หลักฐานที่ระบุวันที่ (หน้าต้นทาง วันที่)")}<input className={input} aria-label={`${t("Dated evidence", "หลักฐานที่ระบุวันที่")} ${row.date}`} value={e.evidence} onChange={(ev) => set(row.date, { evidence: ev.target.value })} placeholder={t(`History page, ${row.date}, Diesel B7`, `หน้าประวัติ ${row.date} ดีเซล B7`)} /></label>
                      {row.ref ? <label className="text-xs font-semibold">{t("Why it changes (kept; original stays in history)", "เหตุผลที่เปลี่ยน (เก็บไว้ ค่าเดิมยังอยู่ในประวัติ)")}<input className={input} value={e.reason} onChange={(ev) => set(row.date, { reason: ev.target.value })} /></label> : <span />}
                      <label className="flex items-center gap-1 text-xs font-semibold"><input type="checkbox" className="h-4 w-4" checked={e.proposed} onChange={(ev) => set(row.date, { proposed: ev.target.checked })} />{t("Proposed only", "เสนอเท่านั้น")}</label>
                      <button type="button" className="ees-fc-btn-primary !py-1" data-testid="fuel-save"
                        disabled={!/^\d{1,3}(\.\d{1,2})?$/.test(e.price.trim()) || e.evidence.trim().length < 10 || (!!row.ref && e.reason.trim().length < 10 && Math.round(Number(e.price) * 100) !== Math.round(row.ref.priceThb * 100))}
                        onClick={() => { if (report(run({ type: "record_fuel_reference", date: row.date, priceThb: Number(e.price), evidence: e.evidence, sourceUrl: DIESEL_B7_SOURCE_URL, proposed: e.proposed, ...(e.reason.trim() ? { revisionReason: e.reason } : {}) }), e.proposed ? t(`Saved as PROPOSED for ${row.date}. It does not price jobs until verified.`, `บันทึกเป็นค่าที่เสนอของ ${row.date} จะไม่ใช้คิดราคาจนกว่าจะยืนยัน`) : t(`Saved and verified for ${row.date}.`, `บันทึกและยืนยัน ${row.date} แล้ว`))) set(row.date, { open: false, price: "", evidence: "", reason: "", proposed: false }); }}>{t("Save", "บันทึก")}</button>
                    </div>
                    {row.history.length > 1 ? <p className="mt-1 text-xs text-slate-600">{t("Earlier values kept:", "ค่าก่อนหน้าที่เก็บไว้:")} {row.history.filter((h) => h.supersededAt).map((h) => `฿${h.priceThb.toFixed(2)} (${h.supersedeReason})`).join(" · ")}</p> : null}
                  </td>
                </tr>
              ];
            })}
          </tbody>
        </table>
      </div>
      {message ? <p role="status" className="mt-1 text-sm font-semibold text-violet-950" data-testid="fuel-panel-message">{message}</p> : null}
    </section>
  );
}
