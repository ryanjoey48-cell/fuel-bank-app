"use client";
import type { FuelTypeGroup } from "@/lib/fleet-evidence-view";
import { fuelReviewAction, fuelReviewTitle, type FuelReviewCandidate } from "@/lib/fleet-fuel-review";

type Lang = "en" | "th";
export type HistoryDay = {
  day: string;
  /** A Forth day report was read and is held for this user. Unread days are "Not reviewed", never zero. */
  read: boolean;
  providerKm: number | null; providerReconciled: boolean; gpsKm: number | null;
  /** Stops of 10+ minutes in the report, and report-confirmed missing minutes. Null when journey detail is unavailable. */
  stops: number | null; missingMinutes: number | null;
  fuel: FuelTypeGroup[] | null; odometerReadings: number | null;
};
export type OdometerSpan = { label: string; km: number; from: string; to: string; reviewRequired: boolean } | null;

const fmt = (language: Lang, v: number | null | undefined, digits = 2) => (v === null || v === undefined ? "—" : v.toLocaleString(language === "th" ? "th-TH" : "en-GB", { minimumFractionDigits: digits, maximumFractionDigits: digits }));
const fuelTotals = (days: readonly HistoryDay[]) => {
  const byType = new Map<string, { litres: number; cost: number | null; records: number }>(); let known = 0;
  for (const d of days) { if (d.fuel === null) continue; known++; for (const g of d.fuel) { const e = byType.get(g.fuelType) ?? { litres: 0, cost: 0 as number | null, records: 0 }; e.litres += g.purchasedLitres ?? 0; e.cost = e.cost === null || g.costThb === null ? null : e.cost + g.costThb; e.records += g.records; byType.set(g.fuelType, e); } }
  return { byType, known };
};
const fuelType = (type: string, language: Lang) => (type === "unrecorded" ? (language === "th" ? "ไม่ได้บันทึกชนิด" : "type not recorded") : type.toUpperCase());

/** Period summary: what was reviewed, what was not, and what the reviewed days show. Partial by construction, and says so. */
export function FleetOperatingStrip({ days, language }: { days: readonly HistoryDay[]; language: Lang }) {
  const t = (en: string, th: string) => (language === "th" ? th : en);
  const read = days.filter(d => d.read);
  const providerDays = read.filter(d => d.providerReconciled && d.providerKm !== null);
  const sum = (v: (d: HistoryDay) => number | null, rows: readonly HistoryDay[]) => (rows.length ? rows.reduce((n, d) => n + (v(d) ?? 0), 0) : null);
  const stopsDays = read.filter(d => d.stops !== null);
  const gapDays = read.filter(d => d.missingMinutes !== null);
  const fuel = fuelTotals(days);
  const issues = read.filter(d => !d.providerReconciled).length + gapDays.filter(d => (d.missingMinutes ?? 0) > 0).length;
  return (
    <section className="v73-history" aria-label={t("Operating history for the selected dates", "ประวัติการใช้งานตามช่วงวันที่เลือก")} data-operating-history>
      <div className="v72-section-head"><h3>{t("Operating history for these dates", "ประวัติการใช้งานตามช่วงวันที่นี้")}</h3><span className="v72-tag">{t("reviewed days only", "เฉพาะวันที่ตรวจสอบ")}</span></div>
      <dl className="v72-strip">
        <div><dt>{t("Reviewed days", "วันที่ตรวจสอบ")}</dt><dd><b>{read.length}/{days.length}</b><small>{days.length - read.length} {t("not reviewed (unknown, not zero)", "ยังไม่ได้ตรวจสอบ (ไม่ทราบ ไม่ใช่ศูนย์)")}</small></dd></div>
        <div><dt>{t("Forth km", "กม. Forth")}</dt><dd><b>{fmt(language, sum(d => d.providerKm, providerDays))}</b><small>{providerDays.length ? t(`partial: ${providerDays.length} reconciled day(s)`, `บางส่วน: ${providerDays.length} วันที่กระทบยอดแล้ว`) : t("no reviewed day", "ไม่มีวันที่ตรวจสอบ")}</small></dd></div>
        <div><dt>{t("GPS-derived km", "กม. จาก GPS")}</dt><dd><b>{fmt(language, sum(d => d.gpsKm, read.filter(d => d.gpsKm !== null)))}</b><small>{t("same reviewed days, separate source", "วันเดียวกัน แต่แยกแหล่งข้อมูล")}</small></dd></div>
        <div><dt>{t("Report stops of 10+ min", "จุดจอดในรายงาน 10+ นาที")}</dt><dd><b>{stopsDays.length ? stopsDays.reduce((n, d) => n + (d.stops ?? 0), 0) : "—"}</b><small>{t("report segments; place stops are under Daily Activity", "ช่วงในรายงาน จุดจอดตามตำแหน่งดูใน กิจกรรมประจำวัน")}</small></dd></div>
        <div><dt>{t("Tracking gaps", "ช่วงที่ขาดข้อมูล")}</dt><dd><b>{gapDays.length ? `${gapDays.reduce((n, d) => n + (d.missingMinutes ?? 0), 0)} ${t("min", "นาที")}` : "—"}</b><small>{t("report-confirmed", "ยืนยันโดยรายงาน")}</small></dd></div>
        <div className={issues > 0 ? "is-attention" : ""}><dt>{t("Data quality issues", "ปัญหาคุณภาพข้อมูล")}</dt><dd><b>{read.length ? issues : "—"}</b><small>{t("unreconciled days and gaps", "วันที่ยังไม่กระทบยอดและช่วงที่ขาด")}</small></dd></div>
      </dl>
      <dl className="v72-strip">
        <div className="v72-strip-wide"><dt>{t("Recorded fuel purchases (Fuel Logs, all dates)", "การซื้อเชื้อเพลิงที่บันทึก (บันทึกเชื้อเพลิง ทุกวัน)")}</dt><dd>{fuel.known === 0 ? <span>—</span> : fuel.byType.size === 0 ? <span>{t("No purchases recorded", "ไม่มีบันทึกการซื้อ")}</span> : [...fuel.byType.entries()].map(([type, v]) => <span key={type}><b>{fmt(language, v.litres)}</b> L <small>{fuelType(type, language)} · {v.cost === null ? "฿ —" : `฿${fmt(language, v.cost)}`} · {v.records} {t("record(s)", "รายการ")}</small></span>)}</dd></div>
        <div className="v72-strip-wide"><dt>{t("Driver attribution", "ผู้ขับ")}</dt><dd><span><small>{t("Shown per day under Daily Activity. No dated assignment history exists, so past days are \"Driver not confirmed\" unless a same-day fuel record names one driver (supporting evidence only).", "แสดงรายวันใน กิจกรรมประจำวัน ยังไม่มีประวัติการมอบหมายที่ระบุวันที่ วันที่ผ่านมาจึง \"ยังไม่ยืนยันคนขับ\" เว้นแต่บันทึกเชื้อเพลิงวันนั้นระบุคนขับคนเดียว (เป็นหลักฐานประกอบเท่านั้น)")}</small></span></dd></div>
      </dl>
      <p className="v72-hint">{t(`Based on ${read.length} of ${days.length} days read in this session. This is not a complete vehicle history; unread days are not represented.`, `อ้างอิงข้อมูล ${read.length} จาก ${days.length} วันที่อ่านในเซสชันนี้ ไม่ใช่ประวัติรถที่สมบูรณ์ วันที่ยังไม่ได้อ่านไม่ถูกรวม`)}</p>
    </section>
  );
}

/** Fuel and kilometre review candidates: prompts to look, never a finding of fault. Quiet when there is nothing to show. */
export function FleetFuelReview({ candidates, language }: { candidates: readonly FuelReviewCandidate[]; language: Lang }) {
  const t = (en: string, th: string) => (language === "th" ? th : en);
  const KEY: Record<string, [string, string]> = { source: ["Source", "แหล่ง"], from: ["From", "ตั้งแต่"], to: ["To", "ถึง"], intervals: ["Intervals", "ช่วง"], records: ["Records", "รายการ"], days: ["Days", "วัน"], odometerKm: ["Odometer km", "กม. จากเลขไมล์"], providerKm: ["Forth km", "กม. Forth"], differenceKm: ["Difference km", "ผลต่าง กม."] };
  const VAL = (v: number | string) => (v === "fuel_logs" ? t("Fuel Logs", "บันทึกเชื้อเพลิง") : v === "weekly_mileage" ? t("Weekly Mileage", "เลขไมล์รายสัปดาห์") : String(v));
  const evidence = (c: FuelReviewCandidate) => Object.entries(c.evidence).map(([k, v]) => `${(KEY[k] ?? [k, k])[language === "th" ? 1 : 0]}: ${VAL(v)}`).join(" · ");
  return (
    <section className="v77-fuelreview" aria-label={t("Fuel and kilometre review candidates", "รายการที่ควรตรวจสอบด้านเชื้อเพลิงและระยะทาง")} data-fuel-review>
      <h4>{t("Review candidates", "รายการที่ควรตรวจสอบ")} · {candidates.length}</h4>
      {candidates.length === 0 ? <p className="v72-empty-line">{t("Nothing to review in the evidence loaded for these dates. This does not cover days or sources that were not read.", "ไม่มีรายการให้ตรวจในหลักฐานที่โหลดสำหรับช่วงวันที่นี้ ไม่ครอบคลุมวันหรือแหล่งข้อมูลที่ไม่ได้อ่าน")}</p> : (
        <ul className="v77-fuelreview-list">{candidates.map((c, i) => <li key={`${c.key}-${i}`} data-fuel-candidate={c.key} className={`is-${c.severity}`}>
          <b>{fuelReviewTitle(c.key, language)}</b> <small>{c.severity === "medium" ? t("Medium", "กลาง") : t("Info", "ข้อมูล")}</small>
          <small>{evidence(c)}</small><span>{fuelReviewAction(c.key, language)}</span></li>)}</ul>
      )}
      <p className="v72-hint">{t("Candidates are prompts to look, not findings. Purchased fuel is not consumption and no km/L is calculated.", "รายการเหล่านี้เป็นข้อเสนอให้ตรวจ ไม่ใช่ข้อสรุป เชื้อเพลิงที่ซื้อไม่ใช่การใช้จริง และไม่คำนวณ กม./ลิตร")}</p>
    </section>
  );
}

/** Kilometre and fuel sources side by side, per day, plus a period comparison that says when sources cannot be compared. */
export function FleetKmFuelTable({ days, spans, language }: { days: readonly HistoryDay[]; spans: readonly OdometerSpan[]; language: Lang }) {
  const t = (en: string, th: string) => (language === "th" ? th : en);
  const readDays = new Set(days.filter(d => d.read && d.providerReconciled && d.providerKm !== null).map(d => d.day));
  const providerSum = [...readDays].reduce((n, day) => n + (days.find(d => d.day === day)?.providerKm ?? 0), 0);
  const inSpan = (from: string, to: string) => days.filter(d => d.day >= from && d.day <= to);
  const status = (d: HistoryDay) => (!d.read ? t("Not reviewed", "ยังไม่ได้ตรวจสอบ") : !d.providerReconciled ? t("Report not reconciled", "รายงานยังไม่กระทบยอด") : t("Reviewed", "ตรวจสอบแล้ว"));
  return (
    <section className="v73-kmfuel" aria-label={t("Kilometres and fuel by day", "ระยะทางและเชื้อเพลิงรายวัน")} data-km-fuel-table>
      <h4>{t("Kilometres and fuel by day", "ระยะทางและเชื้อเพลิงรายวัน")}</h4>
      <div className="v72-table-wrap"><table className="v72-table">
        <thead><tr><th scope="col">{t("Day", "วัน")}</th><th scope="col" className="num">{t("Forth km", "กม. Forth")}</th><th scope="col" className="num">{t("GPS km", "กม. GPS")}</th><th scope="col">{t("Fuel purchased", "เชื้อเพลิงที่ซื้อ")}</th><th scope="col" className="num">{t("Amount (฿)", "จำนวนเงิน (฿)")}</th><th scope="col" className="num">{t("Odometer readings", "เลขไมล์")}</th><th scope="col">{t("Status", "สถานะ")}</th></tr></thead>
        <tbody>{days.map(d => { const cost = d.fuel === null || d.fuel.length === 0 ? null : d.fuel.some(g => g.costThb === null) ? null : d.fuel.reduce((n, g) => n + (g.costThb ?? 0), 0); return <tr key={d.day} className={!d.read ? "" : d.providerReconciled ? "" : "needs-review"}>
          <th scope="row">{d.day}</th>
          <td className="num">{d.read && d.providerReconciled ? fmt(language, d.providerKm) : <span className="v72-muted">{d.read ? "—" : t("not reviewed", "ยังไม่ได้ตรวจสอบ")}</span>}</td>
          <td className="num">{d.read ? fmt(language, d.gpsKm) : "—"}</td>
          <td>{d.fuel === null ? "—" : d.fuel.length === 0 ? <span className="v72-muted">{t("none recorded", "ไม่มีบันทึก")}</span> : d.fuel.map(g => `${fuelType(g.fuelType, language)} ${fmt(language, g.purchasedLitres, 1)} L`).join(" · ")}</td>
          <td className="num">{cost === null ? "—" : fmt(language, cost)}</td>
          <td className="num">{d.odometerReadings === null ? "—" : d.odometerReadings}</td>
          <td>{status(d)}</td></tr>; })}</tbody>
      </table></div>
      <h4>{t("Source comparison for this period", "เปรียบเทียบแหล่งข้อมูลในช่วงนี้")}</h4>
      <div className="v72-table-wrap"><table className="v72-table" data-source-comparison>
        <thead><tr><th scope="col">{t("Source", "แหล่งข้อมูล")}</th><th scope="col" className="num">{t("Distance (km)", "ระยะทาง (กม.)")}</th><th scope="col">{t("Date coverage", "ช่วงวันที่ที่ครอบคลุม")}</th><th scope="col">{t("Compared with Forth", "เทียบกับ Forth")}</th></tr></thead>
        <tbody>
          <tr><th scope="row">{t("Forth provider-reported", "Forth รายงาน")}</th><td className="num">{readDays.size ? fmt(language, providerSum) : "—"}</td><td>{t(`${readDays.size} of ${days.length} days reviewed`, `ตรวจสอบ ${readDays.size} จาก ${days.length} วัน`)}</td><td>—</td></tr>
          {spans.map(s => { if (!s) return null; const covered = inSpan(s.from, s.to); const allRead = covered.length > 0 && covered.every(d => readDays.has(d.day)); const coveredSum = covered.reduce((n, d) => n + (readDays.has(d.day) ? d.providerKm ?? 0 : 0), 0); const diff = allRead ? Math.abs(coveredSum - s.km) : null;
            return <tr key={s.label} className={diff !== null && diff >= Math.max(5, 0.1 * Math.max(coveredSum, s.km)) ? "needs-review" : ""}><th scope="row">{s.label}</th><td className="num">{fmt(language, s.km, 0)}</td><td>{s.from} → {s.to}{s.reviewRequired ? ` · ${t("date-only, office review", "ระบุเฉพาะวันที่ ต้องตรวจสอบ")}` : ""}</td>
              <td>{allRead ? `${t("Comparable", "เทียบได้")} · ${t("difference", "ผลต่าง")} ${fmt(language, diff)} km${diff !== null && diff >= Math.max(5, 0.1 * Math.max(coveredSum, s.km)) ? ` · ${t("review", "ตรวจสอบ")}` : ""}` : covered.length === 0 ? t("Unknown: the span lies outside the dates shown", "ไม่ทราบ: ช่วงอยู่นอกวันที่ที่แสดง") : covered.some(d => readDays.has(d.day)) ? t(`Partially comparable: Forth reviewed for ${covered.filter(d => readDays.has(d.day)).length} of ${covered.length} days in this span`, `เทียบได้บางส่วน: ตรวจสอบ Forth ${covered.filter(d => readDays.has(d.day)).length} จาก ${covered.length} วันในช่วงนี้`) : t(`Not comparable: no Forth day reviewed in this span (${covered.length} days)`, `เทียบไม่ได้: ไม่มีวัน Forth ที่ตรวจสอบในช่วงนี้ (${covered.length} วัน)`)}</td></tr>; })}
          {spans.every(s => s === null) ? <tr><td colSpan={4}><span className="v72-muted">{t("No usable odometer span in this period (fewer than two clean readings, or an interval was withheld for review).", "ไม่มีช่วงเลขไมล์ที่ใช้ได้ในช่วงนี้ (มีเลขไมล์ที่ชัดเจนน้อยกว่าสองค่า หรือมีช่วงที่ระงับไว้เพื่อตรวจสอบ)")}</span></td></tr> : null}
        </tbody>
      </table></div>
      <p className="v72-hint">{t("Sources are kept separate and never added together. An odometer span is compared with Forth kilometres only when every day inside the span was reviewed. Purchased fuel is not consumed fuel; no km/L is calculated.", "แหล่งข้อมูลแยกกันและไม่รวมกัน เลขไมล์จะเทียบกับกม. Forth เมื่อตรวจสอบครบทุกวันในช่วงเท่านั้น เชื้อเพลิงที่ซื้อไม่ใช่ที่ใช้จริง ไม่คำนวณ กม./ลิตร")}</p>
    </section>
  );
}
