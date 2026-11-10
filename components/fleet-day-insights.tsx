"use client";
import { INSIGHT_COPY, coverageLabel, coverageReasonLabel, evidenceLabel, reliabilityLabel, type DayInsights, type Insight } from "@/lib/fleet-day-insights";

type Lang = "en" | "th";

/** Booking-independent day view: what the vehicle did, how much of it was tracked, and what needs a look. Read-only. */
export function FleetDayInsights({ model, registration, language }: { model: DayInsights; registration: string; language: Lang }) {
  const t = (en: string, th: string) => (language === "th" ? th : en);
  const a = model.activity;
  const num = (v: number | null, digits = 0) => (v === null ? "—" : v.toLocaleString(language === "th" ? "th-TH" : "en-GB", { maximumFractionDigits: digits }));
  const mins = (v: number | null) => {
    if (v === null) return "—";
    const h = Math.floor(v / 60), m = Math.round(v % 60);
    return h > 0 ? `${h} ${t("h", "ชม.")} ${m} ${t("min", "นาที")}` : `${m} ${t("min", "นาที")}`;
  };
  const time = (iso: string | null) => (iso && Number.isFinite(Date.parse(iso)) ? new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-GB", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso)) : "—");
  const evidenceText = (i: Insight) => Object.entries(i.evidence).filter(([, v]) => v !== null).map(([k, v]) => `${evidenceLabel(k, language)}: ${typeof v === "string" && Number.isFinite(Date.parse(v)) ? time(v) : v === "open_final" ? t("open", "ยังไม่ปิด") : v === "moving" ? t("moving", "เคลื่อนที่") : v}`).join(" · ");
  const lang = language === "th" ? 1 : 0;
  return <section className="fleet-day-insights" aria-label={t("Vehicle-day insights", "ข้อมูลเชิงลึกรายวัน")} data-day-insights data-coverage={model.coverage}>
    <h4>{t("What the vehicle did", "รถทำอะไรบ้าง")} · {registration || "—"} · {model.day} · Asia/Bangkok</h4>
    <p role="status"><strong>{coverageLabel(model.coverage, language)}</strong>{a.observations !== null ? ` · ${num(a.observations)} ${t("positions", "ตำแหน่ง")}${a.verifiedObservations !== null ? ` (${num(a.verifiedObservations)} ${t("verified", "ยืนยัน")})` : ""}` : ""}</p>
    {model.coverageReasons.length ? <p className="fleet-evidence-note" data-coverage-reasons>{model.coverageReasons.map(r => coverageReasonLabel(r, language)).join(" · ")}</p> : null}
    <p className="fleet-evidence-note">{t("Based only on Forth data. Bookings are not used, and a day without bookings is not an inactive day.", "อ้างอิงข้อมูล Forth เท่านั้น ไม่ใช้สมุดจอง และวันที่ไม่มีการจองไม่ได้หมายความว่ารถไม่ได้ใช้งาน")}</p>
    {a.movingJourneys === null ? null : <dl className="fleet-evidence-sources" data-day-activity>
      <div><dt>{t("Moving journeys", "เที่ยวที่เคลื่อนที่")}</dt><dd>{num(a.movingJourneys)} · {mins(a.movingMinutes)}</dd></div>
      <div><dt>{t("Stops in the report", "จุดจอดในรายงาน")}</dt><dd>{num(a.stops)} · {mins(a.stoppedMinutes)}{a.longestStopMinutes !== null ? ` · ${t("longest", "นานสุด")} ${mins(a.longestStopMinutes)}` : ""}</dd></div>
      <div><dt>{t("Unknown tracking gaps", "ช่วงที่ไม่มีข้อมูล")}</dt><dd>{mins(a.missingMinutes)}<small className="fleet-summary-source">{t("Unknown, not counted as a stay", "ไม่ทราบ ไม่นับเป็นการจอด")}</small></dd></div>
      <div><dt>{t("First and last report segment", "ช่วงแรกและช่วงสุดท้ายของรายงาน")}</dt><dd>{time(a.firstSegmentStart)} – {time(a.lastSegmentEnd)}<small className="fleet-summary-source">{t("Report boundaries, not departure or return times", "เป็นขอบเขตของรายงาน ไม่ใช่เวลาออกหรือกลับ")}</small></dd></div>
    </dl>}
    {model.positionCount.received !== null && model.positionCount.analysed !== null ? <p className="fleet-evidence-note" data-position-count>
      {t("Positions", "ตำแหน่ง")}: {num(model.positionCount.received)} {t("received from Forth", "ที่ได้รับจาก Forth")} → {num(model.positionCount.analysed)} {t("analysed", "ที่วิเคราะห์")}
      {model.positionCount.exactDuplicates ? ` · ${num(model.positionCount.exactDuplicates)} ${t("exact duplicates removed", "รายการซ้ำที่ตัดออก")}` : ""}
      {model.positionCount.noValidTime ? ` · ${num(model.positionCount.noValidTime)} ${t("without a readable time", "ที่ไม่มีเวลาที่อ่านได้")}` : ""}
      {model.positionCount.explained === false ? ` · ${t("difference not explained: report to Forth", "ส่วนต่างที่อธิบายไม่ได้ ควรแจ้ง Forth")}` : ""}
    </p> : null}
    <h5>{t("Insights", "ข้อสังเกต")} · {model.insights.length}</h5>
    {model.insights.length === 0
      ? <p>{model.coverage === "verified_complete" || model.coverage === "verified_incomplete" || model.coverage === "partly_verified" || model.coverage === "unverified" ? t("Nothing unusual found in the available evidence.", "ไม่พบสิ่งผิดปกติในหลักฐานที่มี") : t("No insight can be made until position history is available.", "ยังสรุปข้อสังเกตไม่ได้จนกว่าจะมีประวัติตำแหน่ง")}</p>
      : <ul className="fleet-evidence-list">{model.insights.map(i => {
        const c = INSIGHT_COPY[i.id];
        return <li key={i.id} data-insight={i.id}>
          <strong>{c.title[lang]}</strong> <small>{reliabilityLabel(i.reliability, language)}</small>
          <div>{c.reason[lang]}</div>
          <small>{t("Evidence", "หลักฐาน")}: {evidenceText(i)}</small>
          <div><small>{t("Office action", "สิ่งที่สำนักงานทำได้")}: {c.action[lang]}</small></div>
        </li>;
      })}</ul>}
  </section>;
}
