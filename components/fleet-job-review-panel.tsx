"use client";
import { useMemo, useState } from "react";
import { CONFLICT_REASONS, matchReasonLabel, matchStatusLabel, positionSourceLabel } from "@/lib/fleet-journey-copy";
import type { DayAnalysis } from "@/lib/fleet-vehicle-day-summary";
import type { Journey, JourneyLedger, OfficeDecision } from "@/lib/fleet-journey-ledger";
import type { suggestDayJobs } from "@/lib/fleet-intelligence-day";

type Job = ReturnType<typeof suggestDayJobs>[number];
type Lang = "en" | "th";
type Local = { decision: OfficeDecision; journeyId: string | null; fingerprint: string };

/**
 * TEMPORARY OFFICE REVIEW. Decisions live only in this component's memory: nothing is written to Booking Diary, Finance,
 * customer charges or any database, reloading clears them, and they never feed the confirmed-km figure. A decision made
 * against evidence that later changes is flagged as stale instead of being presented as still valid.
 */
export function FleetJobReviewPanel({ jobs, analysis, ledger, registration, language, day }: { jobs: Job[]; analysis: DayAnalysis; ledger: JourneyLedger | null; registration: string; language: Lang; day: string }) {
  const t = (en: string, th: string) => (language === "th" ? th : en);
  const [local, setLocal] = useState<Record<string, Local | undefined>>({});
  const [picks, setPicks] = useState<Record<string, string | null | undefined>>({});
  const moving = useMemo(() => ledger?.journeys.filter(j => j.kind === "moving") ?? [], [ledger]);
  const byId = useMemo(() => new Map(moving.map(j => [j.id, j])), [moving]);
  const matchOf = useMemo(() => new Map(analysis.matches.jobs.map(m => [m.jobId, m])), [analysis]);
  const time = (iso: string | null) => (iso && Number.isFinite(Date.parse(iso)) ? new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-GB", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso)) : t("open", "ยังไม่ปิด"));
  const n = (v: number | null | undefined) => (v === null || v === undefined ? "—" : v.toLocaleString(language === "th" ? "th-TH" : "en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const km = t("km", "กม.");
  const coords = (p: { latitude: number; longitude: number } | null) => (p ? `${p.latitude.toFixed(4)}, ${p.longitude.toFixed(4)}` : "—");
  const fingerprint = (journeyId: string | null) => { const j = journeyId ? byId.get(journeyId) : null; return j ? `${j.id}|${j.providerKm}|${j.start}|${j.end}` : "none"; };
  const decisionLabel = (d: OfficeDecision) => ({ confirm: t("Confirm", "ยืนยัน"), reject: t("Reject", "ปฏิเสธ"), needs_review: t("Needs Review", "ต้องตรวจสอบ") }[d]);
  const header = <><h4>{t("Office job review", "ตรวจสอบงานโดยสำนักงาน")} · {registration || "—"} · {day}</h4>
    <p className="fleet-evidence-note" role="note"><strong>{t("Temporary — not saved.", "ชั่วคราว — ไม่ได้บันทึก")}</strong> {t("Decisions here exist only in this open page. Nothing is saved or sent to Booking Diary, Finance, customer charges or any database, reloading clears them, and they do not change any confirmed kilometres.", "การตัดสินใจที่นี่อยู่เฉพาะในหน้านี้ ไม่มีการบันทึกหรือส่งไปยังสมุดจอง การเงิน ค่าบริการลูกค้า หรือฐานข้อมูล การโหลดใหม่จะล้างค่า และไม่เปลี่ยนระยะทางที่ยืนยัน")}</p></>;

  if (jobs.length === 0) return <section className="fleet-job-review" aria-label={t("Office job review", "ตรวจสอบงานโดยสำนักงาน")}>{header}<p>{t("No bookings found for this vehicle on this day. This does not mean no work was done; the provider kilometres stay unattributed.", "ไม่พบงานของรถคันนี้ในวันนี้ ไม่ได้หมายความว่าไม่มีการทำงาน ระยะทางผู้ให้บริการยังไม่ระบุงาน")}</p></section>;
  if (!ledger) return <section className="fleet-job-review" aria-label={t("Office job review", "ตรวจสอบงานโดยสำนักงาน")}>{header}<p>{t("Read the Forth report for this day to place bookings on journeys. Until then there is nothing to review against.", "อ่านรายงาน Forth ของวันนี้เพื่อจับคู่งานกับเที่ยว ก่อนหน้านั้นยังไม่มีข้อมูลให้ตรวจสอบ")}</p></section>;

  // Preview only: each journey's km counted once even when several previewed-confirmed jobs share it.
  const previewJourneys = new Set<string>();
  for (const job of jobs) { const d = local[job.jobId]; if (d?.decision === "confirm" && d.journeyId && fingerprint(d.journeyId) === d.fingerprint) previewJourneys.add(d.journeyId); }
  const previewKm = [...previewJourneys].reduce((sum, id) => Math.round((sum + (byId.get(id)?.providerKm ?? 0)) * 100) / 100, 0);
  const counts = { confirm: 0, reject: 0, needs_review: 0 };
  for (const job of jobs) { const d = local[job.jobId]; if (d) counts[d.decision]++; }

  return <section className="fleet-job-review" aria-label={t("Office job review", "ตรวจสอบงานโดยสำนักงาน")}>
    {header}
    <ul className="fleet-evidence-list">{jobs.map(job => {
      const match = matchOf.get(job.jobId); const d = local[job.jobId];
      const chosen = picks[job.jobId] !== undefined ? picks[job.jobId] ?? null : match?.journeyIds[0] ?? null; const journey: Journey | null = chosen ? byId.get(chosen) ?? null : null;
      const stale = Boolean(d && d.fingerprint !== fingerprint(d.journeyId));
      const conflicts = (match?.reasons ?? []).filter(r => CONFLICT_REASONS.includes(r));
      const sharing = journey ? jobs.filter(o => o.jobId !== job.jobId && (picks[o.jobId] !== undefined ? picks[o.jobId] : matchOf.get(o.jobId)?.journeyIds[0]) === journey.id).length : 0;
      const gaps = [
        ledger.totals.positionSource !== "gps" ? t("Positions are reported, not verified GPS: pickup and delivery are not compared with them", "ตำแหน่งเป็นค่าที่รายงาน ไม่ใช่ GPS ที่ยืนยัน จึงไม่เทียบจุดรับส่ง") : null,
        !job.pickupTime ? t("No scheduled pickup time", "ไม่มีเวลารับตามแผน") : null,
        !job.workOrder ? t("No work order reference", "ไม่มีเลขใบงาน") : null,
        !job.scheduledPickup || !job.scheduledDelivery ? t("Booking has no pickup or delivery coordinates", "การจองไม่มีพิกัดจุดรับหรือจุดส่ง") : null,
        job.bookingAssignment === "registration_only" ? t("Vehicle matched by registration text only (no vehicle ID)", "จับคู่รถด้วยข้อความทะเบียนเท่านั้น (ไม่มีรหัสรถ)") : null,
        t("Booking holds a scheduled pickup time only, not a completion window", "สมุดจองมีเฉพาะเวลารับตามแผน ไม่มีเวลาเสร็จงาน"),
        t("Driver is not confirmed (a booking assignment is not proof of who drove)", "ยังไม่ยืนยันผู้ขับ (การจัดรถในสมุดจองไม่ใช่หลักฐานว่าใครขับ)")
      ].filter((x): x is string => x !== null);
      return <li key={job.jobId} className={d ? `is-${d.decision}` : undefined}>
        <strong>{job.workOrder ?? t("No work order reference", "ไม่มีเลขใบงาน")}{job.bookingRef ? ` · ${t("booking", "การจอง")} ${job.bookingRef}` : ""} · {t("scheduled pickup", "เวลารับตามแผน")} {job.pickupTime ?? "—"}</strong>
        <span>{registration || "—"} · {day} · {match ? matchStatusLabel(match.status, language) : "—"} · {t("evidence weight", "น้ำหนักหลักฐาน")} {job.score}</span>
        <small>{t("Source", "ต้นทาง")}: {t("Forth day report segments + Booking Diary (read only)", "ช่วงในรายงาน Forth + สมุดจอง (อ่านอย่างเดียว)")}</small>
        <small>{t("Journey", "เที่ยว")}: {journey ? `${journey.id} · ${time(journey.start)} → ${time(journey.end)} · ${n(journey.providerKm)} ${km} (${t("provider-reported", "ผู้ให้บริการรายงาน")})` : t("Not placed on a journey", "ยังไม่ได้จับคู่กับเที่ยว")}</small>
        <small>{t("GPS trust", "ความน่าเชื่อถือ GPS")}: {journey ? positionSourceLabel(journey.positionSource, language) : positionSourceLabel(ledger.totals.positionSource, language)}</small>
        <small>{t("Booked pickup / delivery", "จุดรับ / ส่งตามการจอง")}: {job.pickupName ?? "—"} ({coords(job.scheduledPickup)}) → {job.deliveryName ?? "—"} ({coords(job.scheduledDelivery)})</small>
        <small>{t("Driver", "ผู้ขับ")}: {t("not confirmed", "ยังไม่ยืนยัน")}{job.driverText ? ` · ${t("booking text", "ข้อความในการจอง")}: ${job.driverText}` : ""}</small>
        <small>{t("Match reasons", "เหตุผลที่จับคู่")}: {(match?.reasons ?? []).filter(r => !CONFLICT_REASONS.includes(r)).map(r => matchReasonLabel(r, language)).join(" · ") || "—"}</small>
        {conflicts.length ? <small role="alert">{t("Conflicts", "ข้อขัดแย้ง")}: {conflicts.map(r => matchReasonLabel(r, language)).join(" · ")}</small> : null}
        {sharing > 0 ? <small>{t(`${sharing} other job(s) share this journey in your preview; its km count once`, `มีอีก ${sharing} งานใช้เที่ยวนี้ร่วมกันในตัวอย่าง ระยะทางนับครั้งเดียว`)}</small> : null}
        <details><summary>{t("Evidence completeness", "ความครบถ้วนของหลักฐาน")} · {gaps.length} {t("gaps", "ข้อที่ขาด")}</summary><ul>{gaps.map(g => <li key={g}>{g}</li>)}</ul></details>
        <label className="fleet-review-journey">{t("Journey (office judgement)", "เที่ยว (ดุลยพินิจของสำนักงาน)")}
          <select value={chosen ?? ""} onChange={event => { const journeyId = event.target.value || null; setPicks(prev => ({ ...prev, [job.jobId]: journeyId })); setLocal(prev => { const cur = prev[job.jobId]; return cur ? { ...prev, [job.jobId]: journeyId === null && cur.decision === "confirm" ? undefined : { ...cur, journeyId, fingerprint: fingerprint(journeyId) } } : prev; }); }}>
            <option value="">{t("No journey", "ไม่ระบุเที่ยว")}</option>
            {moving.map(j => <option key={j.id} value={j.id}>{j.id} · {time(j.start)}–{time(j.end)} · {n(j.providerKm)} {km}</option>)}
          </select>
        </label>
        <div className="fleet-review-actions" role="group" aria-label={t("Temporary decision (not saved)", "การตัดสินใจชั่วคราว (ไม่ได้บันทึก)")}>
          {(["confirm", "reject", "needs_review"] as const).map(value => <button key={value} type="button" aria-pressed={d?.decision === value} disabled={value === "confirm" && !chosen} onClick={() => setLocal(prev => ({ ...prev, [job.jobId]: prev[job.jobId]?.decision === value ? undefined : { decision: value, journeyId: chosen, fingerprint: fingerprint(chosen) } }))}>{decisionLabel(value)}</button>)}
        </div>
        {!chosen ? <small>{t("Confirm needs a journey: choose one above.", "การยืนยันต้องมีเที่ยว โปรดเลือกด้านบน")}</small> : null}
        {d ? <small role="status"><strong>{decisionLabel(d.decision)} · {t("Temporary — not saved", "ชั่วคราว — ไม่ได้บันทึก")}</strong>{stale ? ` · ${t("the evidence changed after this decision; re-check it", "หลักฐานเปลี่ยนหลังการตัดสินใจนี้ โปรดตรวจสอบอีกครั้ง")}` : ""}</small> : null}
      </li>; })}
    </ul>
    <dl className="fleet-evidence-sources" aria-live="polite">
      <div><dt>{t("Temporary decisions: confirm / reject / needs review", "การตัดสินใจชั่วคราว: ยืนยัน / ปฏิเสธ / ต้องตรวจสอบ")}</dt><dd>{counts.confirm} / {counts.reject} / {counts.needs_review} · {t("Temporary — not saved", "ชั่วคราว — ไม่ได้บันทึก")}</dd></div>
      <div><dt>{t("Preview km if these were confirmed", "กม. ตัวอย่างหากยืนยันตามนี้")}</dt><dd>{previewJourneys.size === 0 ? "—" : `${n(previewKm)} ${km} · ${previewJourneys.size} ${t("journey(s), each counted once", "เที่ยว นับเที่ยวละครั้ง")}`} · {t("preview only; official confirmed km stays —", "ตัวอย่างเท่านั้น ระยะทางยืนยันอย่างเป็นทางการยังเป็น —")}</dd></div>
    </dl>
  </section>;
}

