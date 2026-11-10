"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  EXCLUDED_COPY, METHOD_COPY, NOT_COMPARABLE_COPY, QUALIFIER_COPY, RECON_STATUS_COPY,
  type DayReconciliation, type JourneyReconRow, type PeriodReconciliation, type ReconStatus
} from "@/lib/fleet-mileage-reconciliation";

type Lang = "en" | "th";
type Row = { reconciliation: DayReconciliation; journeys: JourneyReconRow[]; capturedAt: string | null; expiresAt: string };
type Report = { vehicleId: string; registration: string; from: string; to: string; calendarDays: number; days: Row[]; period: PeriodReconciliation };
export type ReconTarget = "daily" | "journeys" | "route" | "evidence";
const clock = (language: Lang, iso: string | null) => (iso && Number.isFinite(Date.parse(iso)) ? new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-GB", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso)) : "—");

/**
 * One focused mileage investigation for a vehicle and period. It mounts only after the user asks for it and makes ONE cache-only request
 * (this user's own 30-minute memory): it never contacts Forth. It explains a difference between two existing figures; it adds no distance
 * measure, adjusts nothing and does not say what the vehicle did. Coordinates never reach the browser.
 */
export function FleetMileageReconciliation({ language, vehicleId, registration, from, to, focusDay, onOpen, onClose }: {
  language: Lang; vehicleId: string; registration: string; from: string; to: string; focusDay?: string | null; onOpen: (target: ReconTarget, day: string) => void; onClose: () => void;
}) {
  const t = (en: string, th: string) => (language === "th" ? th : en);
  const lang = language === "th" ? 1 : 0;
  const [data, setData] = useState<Report | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "forbidden" | "failed">("loading");
  const [day, setDay] = useState<string | null>(focusDay ?? null);
  const head = useRef<HTMLHeadingElement | null>(null);
  const n = (v: number | null | undefined, d = 2) => (v === null || v === undefined ? "—" : v.toLocaleString(language === "th" ? "th-TH" : "en-GB", { minimumFractionDigits: d, maximumFractionDigits: d }));
  const signed = (v: number | null) => (v === null ? "—" : `${v > 0 ? "+" : ""}${n(v)}`);

  useEffect(() => {
    const controller = new AbortController(); setState("loading"); setData(null);
    const timeout = setTimeout(() => controller.abort(), 30000);
    (async () => {
      try {
        const token = (await supabase.auth.getSession()).data.session?.access_token; if (!token) throw new Error("session");
        const response = await fetch(`/api/admin/forth-tracking/evidence/mileage-reconciliation?${new URLSearchParams({ vehicleId, from, to })}`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal, cache: "no-store" });
        if (controller.signal.aborted) return;
        if (response.status === 403) { setState("forbidden"); return; }
        if (!response.ok) throw new Error("status");
        const body = await response.json() as Report;
        if (controller.signal.aborted || body.vehicleId !== vehicleId || body.from !== from || body.to !== to) return; // a late answer for another vehicle or period is dropped
        setData(body); setState("ready");
        setDay(prev => prev && body.days.some(r => r.reconciliation.day === prev) ? prev : body.period.largest?.day ?? body.days[0]?.reconciliation.day ?? null);
      } catch { if (!controller.signal.aborted) setState("failed"); } finally { clearTimeout(timeout); }
    })();
    return () => { controller.abort(); clearTimeout(timeout); };
  }, [vehicleId, from, to]);
  useEffect(() => { head.current?.focus(); }, [vehicleId]);

  const selected = useMemo(() => data?.days.find(r => r.reconciliation.day === day) ?? null, [data, day]);
  const statusLabel = (s: ReconStatus) => RECON_STATUS_COPY[s][lang];
  const p = data?.period;

  return <section className="v783-recon" aria-label={t(`Mileage investigation: ${registration}`, `ตรวจสอบระยะทาง: ${registration}`)} data-mileage-reconciliation={vehicleId}>
    <header className="v783-recon-head">
      <div><h4 ref={head} tabIndex={-1}>{t("Mileage discrepancy", "ความต่างของระยะทาง")} · {registration}</h4><p className="v72-hint">{from === to ? from : `${from} → ${to}`} · {t("explains the difference between two existing figures from your cached reviewed days. Read only; Forth is not contacted.", "อธิบายความต่างของสองตัวเลขเดิมจากวันที่ตรวจแล้วในแคชของคุณ อ่านอย่างเดียว ไม่ติดต่อ Forth")}</p></div>
      <button type="button" className="btn-primary min-h-11" onClick={onClose}>{t("Close", "ปิด")}</button>
    </header>
    <div role="status" aria-live="polite">
      {state === "loading" ? <p className="v72-hint">{t("Reading cached evidence…", "กำลังอ่านหลักฐานในแคช…")}</p> : null}
      {state === "forbidden" ? <p role="alert" data-recon-forbidden>{t("Mileage reconciliation uses historical journeys and needs administrator authorisation.", "การกระทบยอดระยะทางใช้ประวัติการเดินทาง ต้องได้รับอนุญาตจากผู้ดูแลระบบ")}</p> : null}
      {state === "failed" ? <p role="alert">{t("The reconciliation could not be loaded. Other figures are unaffected.", "โหลดการกระทบยอดไม่ได้ ตัวเลขอื่นไม่ได้รับผลกระทบ")}</p> : null}
    </div>
    {state === "ready" && data && p ? (data.days.length === 0 ? <p className="v72-empty-line" data-recon-empty>{t("None of these days is in your 30-minute cache, so nothing can be reconciled. Read the days again in Daily Activity or the Reports coverage review; nothing is fetched here.", "ไม่มีวันใดในช่วงนี้อยู่ในแคช 30 นาทีของคุณ จึงกระทบยอดไม่ได้ อ่านวันอีกครั้งใน กิจกรรมประจำวัน หรือการตรวจความครอบคลุมใน รายงาน ที่นี่ไม่ดึงข้อมูล")}</p> : <>
      <dl className="v72-strip v783-strip" data-recon-summary>
        <div><dt>{t("Provider distance (Forth report)", "ระยะทางผู้ให้บริการ (รายงาน Forth)")}</dt><dd><b>{n(p.providerKm)} {t("km", "กม.")}</b><small>{t("reconciled reviewed days", "วันที่ตรวจและกระทบยอดแล้ว")}</small></dd></div>
        <div><dt>{t("GPS-derived distance", "ระยะทางจาก GPS")}</dt><dd><b>{n(p.gpsKm)} {t("km", "กม.")}</b><small>{t("verified positions · estimate of the path", "ตำแหน่งที่ยืนยัน · ประมาณเส้นทาง")}</small></dd></div>
        <div className={p.differenceKm !== null && Math.abs(p.differenceKm) >= 5 ? "is-attention" : ""}><dt>{t("Difference (GPS − provider)", "ผลต่าง (GPS − ผู้ให้บริการ)")}</dt><dd><b>{signed(p.differenceKm)} {t("km", "กม.")}</b><small>{p.percentOfLarger === null ? "—" : `${n(p.percentOfLarger, 1)}% ${t("of the larger figure", "ของค่าที่มากกว่า")}`} · {p.comparableDays}/{p.reviewedDays} {t("days with both figures", "วันที่มีทั้งสองตัวเลข")}</small></dd></div>
        <div><dt>{t("Largest contributing day", "วันที่มีส่วนมากสุด")}</dt><dd>{p.largest ? <><b>{p.largest.day}</b><small>{signed(p.largest.differenceKm)} {t("km", "กม.")}{p.largest.shareOfPeriod === null ? "" : ` · ${n(p.largest.shareOfPeriod, 0)}% ${t("of the difference", "ของผลต่าง")}`}</small></> : <b>—</b>}</dd></div>
      </dl>
      {p.onlyOneSource.days > 0 ? <p className="v72-hint" data-recon-one-source>{t(`${p.onlyOneSource.days} reviewed day(s) have only one of the two figures and are not compared: provider-only ${n(p.onlyOneSource.providerOnlyKm)} km, GPS-only ${n(p.onlyOneSource.gpsOnlyKm)} km. Unknown is not zero.`, `${p.onlyOneSource.days} วันที่ตรวจมีเพียงตัวเลขเดียวจึงไม่เปรียบเทียบ: เฉพาะผู้ให้บริการ ${n(p.onlyOneSource.providerOnlyKm)} กม. เฉพาะ GPS ${n(p.onlyOneSource.gpsOnlyKm)} กม. ไม่ทราบไม่ใช่ศูนย์`)}</p> : null}
      {p.reviewedDays < p.days ? <p className="v72-hint">{t(`Only ${p.reviewedDays} of ${p.days} days in this period are reviewed. The difference covers those days only.`, `ตรวจแล้วเพียง ${p.reviewedDays} จาก ${p.days} วันในช่วงนี้ ผลต่างครอบคลุมเฉพาะวันเหล่านั้น`)}</p> : null}

      <h5>{t("Contributing days", "วันที่มีส่วนต่อผลต่าง")}</h5>
      <div className="v72-table-wrap"><table className="v72-table v783-days v782-cards" data-recon-days>
        <thead><tr><th scope="col">{t("Day", "วัน")}</th><th scope="col">{t("Status", "สถานะ")}</th><th scope="col" className="num">{t("Provider km", "กม. ผู้ให้บริการ")}</th><th scope="col" className="num">{t("GPS km", "กม. GPS")}</th><th scope="col" className="num">{t("Difference", "ผลต่าง")}</th><th scope="col" className="num">%</th><th scope="col" className="num">{t("Share", "สัดส่วน")}</th><th scope="col">{t("Coverage", "ความครอบคลุม")}</th></tr></thead>
        <tbody>{data.days.map(r => { const d = r.reconciliation; const c = p.contributions.find(x => x.day === d.day); return <tr key={d.day} className={d.day === day ? "is-active" : ""} data-day={d.day} data-recon-status={d.status}>
          <th scope="row" data-label={t("Day", "วัน")}><button type="button" className="fleet-link-button" aria-pressed={d.day === day} onClick={() => setDay(d.day)}>{d.day}</button></th>
          <td data-label={t("Status", "สถานะ")}><span className={`v783-chip is-${d.status}`}>{statusLabel(d.status)}</span></td>
          <td className="num" data-label={t("Provider km", "กม. ผู้ให้บริการ")}>{n(d.providerKm)}</td><td className="num" data-label={t("GPS km", "กม. GPS")}>{n(d.gpsKm)}</td>
          <td className="num" data-label={t("Difference", "ผลต่าง")}><b>{signed(d.differenceKm)}</b></td><td className="num" data-label="%">{d.percentOfLarger === null ? "—" : n(d.percentOfLarger, 1)}</td>
          <td className="num" data-label={t("Share", "สัดส่วน")}>{c?.shareOfPeriod === null || c === undefined ? "—" : `${n(c.shareOfPeriod, 0)}%`}</td>
          <td data-label={t("Coverage", "ความครอบคลุม")}>{d.verifiedPositions}/{d.positions} {t("verified", "ยืนยัน")} · {n(d.coveragePercent, 1)}%{d.trackingGapMinutes ? ` · ${d.trackingGapMinutes} ${t("min gap", "นาทีขาด")}` : ""}</td></tr>; })}</tbody>
      </table></div>

      {selected ? (() => { const d = selected.reconciliation; const a = d.attribution; return <div className="v783-day" data-recon-detail={d.day}>
        <h5>{d.day} · {statusLabel(d.status)}</h5>
        {d.notComparable ? <p className="v72-hint">{t("Not comparable", "เปรียบเทียบไม่ได้")}: {NOT_COMPARABLE_COPY[d.notComparable][lang]}.</p> : null}
        {d.qualifiers.length ? <p className="v72-hint" data-recon-qualifiers>{t("Partially comparable because", "เปรียบเทียบได้บางส่วนเพราะ")}: {d.qualifiers.map(q => QUALIFIER_COPY[q][lang]).join(" · ")}.</p> : null}
        <p className="v72-hint">{t("A day with every received position GPS-verified can still contain uncertain distance: verification says the position came from GPS, not that the summed chords equal the kilometres driven.", "วันที่ทุกตำแหน่งที่ได้รับยืนยันด้วย GPS ก็ยังมีระยะทางที่ไม่แน่นอนได้ การยืนยันบอกเพียงว่าตำแหน่งมาจาก GPS ไม่ได้บอกว่าผลรวมเส้นตรงเท่ากับระยะที่วิ่งจริง")}</p>
        {a && d.outsideMovingKm !== null && d.likeForLikeResidualKm !== null ? <>
          <div className="v72-table-wrap"><table className="v72-table v782-cards" data-recon-attribution aria-label={t("Where the GPS kilometres lie", "ระยะ GPS อยู่ที่ใด")}>
            <thead><tr><th scope="col">{t("GPS distance lies…", "ระยะ GPS อยู่…")}</th><th scope="col" className="num">{t("km", "กม.")}</th><th scope="col" className="num">{t("Count", "จำนวน")}</th></tr></thead>
            <tbody>
              <tr><th scope="row" data-label={t("GPS distance lies…", "ระยะ GPS อยู่…")}>{t("inside provider moving segments (GPS known)", "ในช่วงเคลื่อนที่ของผู้ให้บริการ (ทราบ GPS)")}</th><td className="num" data-label={t("km", "กม.")}>{n(a.insideMoving.km)}</td><td className="num" data-label={t("Count", "จำนวน")}>{a.insideMoving.segments} {t("segments", "ช่วง")}</td></tr>
              <tr><th scope="row" data-label={t("GPS distance lies…", "ระยะ GPS อยู่…")}>{t("inside provider stopped segments", "ในช่วงจอดของผู้ให้บริการ")}</th><td className="num" data-label={t("km", "กม.")}>{n(a.insideStopped.km)}</td><td className="num" data-label={t("Count", "จำนวน")}>{a.insideStopped.segments} {t("segments", "ช่วง")}</td></tr>
              <tr><th scope="row" data-label={t("GPS distance lies…", "ระยะ GPS อยู่…")}>{t("outside every provider report segment", "นอกทุกช่วงในรายงานของผู้ให้บริการ")}</th><td className="num" data-label={t("km", "กม.")}>{n(a.outsideReport.km)}</td><td className="num" data-label={t("Count", "จำนวน")}>{a.outsideReport.segments} {t("GPS intervals", "ช่วง GPS")} · {a.outsideReport.minutes} {t("min", "นาที")}</td></tr>
              <tr><th scope="row" data-label={t("GPS distance lies…", "ระยะ GPS อยู่…")}>{t("not placed (crosses a segment edge or its GPS is unknown)", "ยังระบุไม่ได้ (คาบเกี่ยวขอบช่วงหรือไม่ทราบ GPS)")}</th><td className="num" data-label={t("km", "กม.")}>{n(a.unattributed.km)}</td><td className="num" data-label={t("Count", "จำนวน")}>—</td></tr>
            </tbody></table></div>
          <p data-recon-formula><b>{t("Difference", "ผลต่าง")} {signed(d.differenceKm)}</b> = {signed(d.outsideMovingKm)} {t("GPS not inside the compared moving segments", "GPS ที่ไม่อยู่ในช่วงเคลื่อนที่ที่นำมาเทียบ")} + {signed(d.likeForLikeResidualKm)} <b>{t("like-for-like residual", "ส่วนต่างเมื่อเทียบช่วงเดียวกัน")}</b> ({t("GPS inside moving segments minus the provider km of the same segments", "GPS ในช่วงเคลื่อนที่ ลบ กม. ผู้ให้บริการของช่วงเดียวกัน")}){a.providerUncomparedKm ? ` − ${n(a.providerUncomparedKm)} ${t("provider km in segments with no comparable GPS", "กม. ผู้ให้บริการในช่วงที่ไม่มี GPS เทียบได้")}` : ""}.</p>
          {d.outsideWindows.length ? <div data-recon-outside><p className="v72-hint"><b>{t("Largest GPS windows with no provider report segment", "ช่วง GPS ที่ไม่มีช่วงในรายงานผู้ให้บริการ (มากสุด)")}</b> — {t("where the two figures cover different time. Inspect these in the route; they are not proof of driving.", "ที่สองตัวเลขครอบคลุมเวลาต่างกัน ตรวจดูในเส้นทาง ไม่ใช่หลักฐานการขับ")}</p>
            <ul className="v72-plain-list">{d.outsideWindows.map(w => <li key={w.start}>{clock(language, w.start)} → {clock(language, w.end)} · {w.minutes} {t("min", "นาที")} · {n(w.km)} {t("km", "กม.")}</li>)}</ul></div> : null}
        </> : null}
        <p className="v72-hint" data-recon-state>{t("GPS km by interval state", "กม. GPS ตามสถานะช่วง")}: {t("moving", "เคลื่อนที่")} {n(d.gpsByState.moving)} · {t("idling", "เดินเครื่องจอด")} {n(d.gpsByState.idling)} · {t("stopped", "จอด")} {n(d.gpsByState.stopped)} · {t("other low-speed or unknown state", "สถานะอื่น/ความเร็วต่ำ/ไม่ทราบ")} {n(d.gpsByState.unknown)}</p>
        {d.excluded.length ? <p className="v72-hint" data-recon-excluded>{t("Excluded from GPS distance (not counted, not zero driving)", "ไม่รวมในระยะ GPS (ไม่ใช่ศูนย์)")}: {d.excluded.slice(0, 5).map(e => `${EXCLUDED_COPY[e.reason]?.[lang] ?? e.reason} ${e.minutes} ${t("min", "นาที")} (${e.intervals})`).join(" · ")}</p> : null}
        <p className="v72-hint" data-recon-indicators>{t("Position indicators", "ตัวบ่งชี้ตำแหน่ง")}: {d.chord ? t(`${d.chord.positions} verified positions · largest point-to-point ${n(d.chord.largestChordKm)} km · ${d.chord.chordsOver3Km} over 3 km · ${d.chord.repeatedPositions} repeated coordinates`, `${d.chord.positions} ตำแหน่งที่ยืนยัน · ระยะระหว่างจุดมากสุด ${n(d.chord.largestChordKm)} กม. · เกิน 3 กม. ${d.chord.chordsOver3Km} · พิกัดซ้ำ ${d.chord.repeatedPositions}`) : "—"}{d.duplicatePositions !== null ? ` · ${d.duplicatePositions} ${t("duplicate records removed", "รายการซ้ำที่ตัดออก")}` : ""}</p>

        <h5>{t("Provider moving segments", "ช่วงเคลื่อนที่ของผู้ให้บริการ")} · {selected.journeys.length}</h5>
        {selected.journeys.length === 0 ? <p className="v72-hint">{t("No provider moving segment with log records.", "ไม่มีช่วงเคลื่อนที่ของผู้ให้บริการที่มีบันทึก")}</p> : <div className="v72-table-wrap"><table className="v72-table v782-cards" data-recon-journeys>
          <thead><tr><th scope="col">{t("Window", "ช่วงเวลา")}</th><th scope="col" className="num">{t("Provider km", "กม. ผู้ให้บริการ")}</th><th scope="col" className="num">{t("GPS km inside", "กม. GPS ภายใน")}</th><th scope="col" className="num">{t("Unexplained", "อธิบายไม่ได้")}</th><th scope="col">{t("Notes", "หมายเหตุ")}</th></tr></thead>
          <tbody>{selected.journeys.map(j => <tr key={j.id} data-journey={j.id}>
            <th scope="row" data-label={t("Window", "ช่วงเวลา")}>{clock(language, j.start)} → {j.end ? clock(language, j.end) : t("open", "ยังไม่ปิด")}</th><td className="num" data-label={t("Provider km", "กม. ผู้ให้บริการ")}>{n(j.providerKm)}</td>
            <td className="num" data-label={t("GPS km inside", "กม. GPS ภายใน")}>{j.gpsKm === null ? t("unknown", "ไม่ทราบ") : n(j.gpsKm)}</td><td className="num" data-label={t("Unexplained", "อธิบายไม่ได้")}>{j.unexplainedKm === null ? "—" : signed(j.unexplainedKm)}</td>
            <td data-label={t("Notes", "หมายเหตุ")}>{j.positionSource === "gps" ? t("GPS-verified", "ยืนยันด้วย GPS") : j.positionSource === "mixed" ? t("partly verified", "ยืนยันบางส่วน") : t("not verified", "ไม่ยืนยัน")}{j.issues.length ? ` · ${j.issues.join(", ")}` : ""}{j.ambiguous ? ` · ${t("ambiguous", "ไม่ชัดเจน")}` : ""}</td></tr>)}</tbody></table></div>}
        <p className="v72-hint">{t("Provider distance per segment is the report's own figure; nothing is apportioned. GPS inside a segment is unknown when a GPS interval crosses its edge.", "ระยะผู้ให้บริการรายช่วงเป็นตัวเลขของรายงานเอง ไม่แบ่งสัดส่วน ระยะ GPS ในช่วงจะไม่ทราบเมื่อช่วง GPS คาบเกี่ยวขอบ")}</p>
        <p className="v783-actions" role="group" aria-label={t("Investigate this day", "ตรวจสอบวันนี้")}>
          <button type="button" className="btn-secondary min-h-11" onClick={() => onOpen("route", d.day)} data-open-route>{t("View historical route", "ดูเส้นทางย้อนหลัง")}</button>
          <button type="button" className="btn-secondary min-h-11" onClick={() => onOpen("journeys", d.day)}>{t("Inspect journeys", "ดูเที่ยวรถ")}</button>
          <button type="button" className="btn-secondary min-h-11" onClick={() => onOpen("daily", d.day)}>{t("Open Daily Activity", "เปิดกิจกรรมประจำวัน")}</button>
          <button type="button" className="btn-secondary min-h-11" onClick={() => onOpen("evidence", d.day)}>{t("Open original evidence", "เปิดหลักฐานต้นฉบับ")}</button>
        </p>
        <p className="v72-hint" data-recon-next>{t("Suggested office check: compare this day's timeline in Daily Activity with the route, look at stops and low-speed movement, and check whether the report's segments cover the same hours. Opening the route reads Forth only when you press Load Journey. This is a review candidate, not a finding about the vehicle or driver.", "สิ่งที่สำนักงานควรตรวจ: เทียบไทม์ไลน์ของวันนี้ใน กิจกรรมประจำวัน กับเส้นทาง ดูจุดจอดและการเคลื่อนที่ช้า และตรวจว่าช่วงในรายงานครอบคลุมชั่วโมงเดียวกันหรือไม่ การเปิดเส้นทางจะอ่าน Forth เมื่อกด โหลดเส้นทาง เท่านั้น นี่คือสิ่งที่ควรตรวจ ไม่ใช่ข้อสรุปเกี่ยวกับรถหรือคนขับ")}</p>
      </div>; })() : null}
      <details className="v72-evidence" data-recon-method><summary>{t("How the figures and percentages are calculated", "วิธีคำนวณตัวเลขและร้อยละ")}</summary><p className="fleet-evidence-note">{METHOD_COPY[lang]}</p></details>
    </>) : null}
  </section>;
}
