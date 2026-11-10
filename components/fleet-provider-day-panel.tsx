"use client";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { originHeaders } from "@/lib/fleet-request-origin";
import type { ProviderDay } from "@/lib/fleet-intelligence-day";

/**
 * variant "full" (default, unchanged): read controls and evidence together.
 * V7.2 "bar": only the read controls and one status line. "details": only the evidence taken from the loaded day; it never reads.
 */
export function FleetProviderDayPanel({ vehicleId, day, language, initial, onRead, variant = "full" }: { vehicleId: string | null; day: string; language: "en" | "th"; initial: ProviderDay | null; onRead: () => void; variant?: "full" | "bar" | "details" }) {
  const t = (en: string, th: string) => language === "th" ? th : en;
  type CacheInfo = { hit: boolean; storedAt: string; expiresAt: string | null };
  const [loaded, setLoaded] = useState<(ProviderDay & { cache?: CacheInfo }) | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "failed">("idle");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => { const controller = request.current; request.current = null; controller?.abort(); }, []);
  const evidence = loaded ?? initial;
  const number = (n: number | null) => n === null ? "—" : n.toLocaleString(language === "th" ? "th-TH" : "en-GB", { maximumFractionDigits: 2 });
  const time = (iso: string | null) => iso && Number.isFinite(Date.parse(iso)) ? new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-GB", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(iso)) : "—";
  async function read(refresh = false) {
    const controller = new AbortController(); request.current?.abort(); request.current = controller; setState("loading");
    const timeout = setTimeout(() => controller.abort(), 50000);
    try {
      const session = await supabase.auth.getSession();
      if (!session.data.session || !vehicleId) throw new Error();
      const response = await fetch(`/api/admin/forth-tracking/evidence/provider?${new URLSearchParams(refresh ? { vehicleId, day, refresh: "1" } : { vehicleId, day })}`, { method: "POST", headers: { Authorization: `Bearer ${session.data.session.access_token}`, ...originHeaders(refresh ? "daily_refresh_button" : "daily_read_button") }, signal: controller.signal, cache: "no-store" });
      if (!response.ok) throw new Error();
      const result = await response.json() as ProviderDay & { cache?: CacheInfo };
      if (!controller.signal.aborted) { setLoaded(result); setState("idle"); onRead(); }
    } catch { if (!controller.signal.aborted) setState("failed"); else if (request.current === controller) setState("failed"); }
    finally { clearTimeout(timeout); }
  }
  return <section className={`fleet-provider-day v72-provider-${variant}`} aria-label={t("Provider distance and GPS evidence", "ระยะทางผู้ให้บริการและหลักฐาน GPS")}>
    {variant === "full" ? <h4>{t("Forth distance & activity", "ระยะทางและกิจกรรม Forth")} · {day}</h4> : null}
    {variant !== "details" ? <div className="v72-read-row">
    {!(evidence && variant === "bar") ? <button className="btn-secondary" type="button" disabled={!vehicleId || state === "loading"} onClick={() => void read()}>{state === "loading" ? t("Reading one vehicle/day…", "กำลังอ่านรถหนึ่งคัน/วัน…") : t("Read Forth report & GPS", "อ่านรายงาน Forth และ GPS")}</button> : null}
    {evidence ? <button className="btn-secondary" type="button" disabled={!vehicleId || state === "loading"} onClick={() => void read(true)}>{t("Refresh from Forth (new request)", "รีเฟรชจาก Forth (ส่งคำขอใหม่)")}</button> : null}
      {variant === "bar" ? <span className="v72-read-status" role="status">{state === "failed" ? t("Read failed, timed out or is gated. Retry manually.", "อ่านไม่สำเร็จ หมดเวลา หรือยังไม่เปิดสิทธิ์ ลองใหม่ด้วยตนเอง") : state === "loading" ? t("Reading one vehicle/day…", "กำลังอ่านรถหนึ่งคัน/วัน…") : evidence ? t("Forth report for this day: loaded", "รายงาน Forth ของวันนี้: โหลดแล้ว") : t("Forth report for this day: not read. Nothing is requested until you press Read.", "รายงาน Forth ของวันนี้: ยังไม่ได้อ่าน จะไม่ขอข้อมูลจนกว่าคุณจะกดอ่าน")}</span> : null}
    </div> : null}
    {variant !== "details" && evidence ? <small className="fleet-evidence-note">{(() => { const c = (loaded as { cache?: CacheInfo } | null)?.cache; const when = (iso: string) => new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-GB", { timeZone: "Asia/Bangkok", dateStyle: "medium", timeStyle: "medium" }).format(new Date(iso));
      return c ? (c.hit ? t(`Served from this server's memory, stored ${when(c.storedAt)}; expires ${c.expiresAt ? when(c.expiresAt) : "—"}. No new Forth request was made.`, `ใช้ข้อมูลในหน่วยความจำเซิร์ฟเวอร์ที่เก็บไว้ ${when(c.storedAt)} หมดอายุ ${c.expiresAt ? when(c.expiresAt) : "—"} ไม่มีการเรียก Forth ใหม่`) : t(`Fresh from Forth ${when(c.storedAt)}; kept in server memory until ${c.expiresAt ? when(c.expiresAt) : "—"} (not saved to a database).`, `ดึงใหม่จาก Forth ${when(c.storedAt)} เก็บในหน่วยความจำเซิร์ฟเวอร์ถึง ${c.expiresAt ? when(c.expiresAt) : "—"} (ไม่ได้บันทึกลงฐานข้อมูล)`)) : t("Earlier snapshot from the day list; it expires 30 minutes after it was read and is not stored in a database.", "ภาพรวมที่อ่านไว้ก่อนหน้า หมดอายุ 30 นาทีหลังอ่านและไม่ได้เก็บในฐานข้อมูล"); })()}</small> : null}
    {variant === "full" ? <p className="fleet-evidence-note">{t("One selected vehicle/day only. Current vehicle/device association; historical assignment and provider coverage still require review. No automatic full-fleet downloads.", "อ่านเฉพาะรถและวันที่เลือก การจับคู่รถ/อุปกรณ์เป็นข้อมูลปัจจุบัน ยังต้องตรวจสอบประวัติการติดตั้งและความครบถ้วน ไม่ดาวน์โหลดประวัติทั้งกองรถอัตโนมัติ")}</p> : null}
    {variant === "full" ? <p role="status">{state === "failed" ? t("Provider read failed, timed out, was rate limited or is gated. Existing evidence below is an earlier snapshot, if present; retry manually.", "อ่านข้อมูลไม่สำเร็จ หมดเวลา ถูกจำกัด หรือยังไม่เปิดสิทธิ์ ข้อมูลด้านล่างถ้ามีเป็นภาพรวมที่อ่านก่อนหน้า โปรดลองใหม่ด้วยตนเอง") : ""}</p> : null}
    {!evidence ? (variant === "full" ? <p>{t("Not read for this day. Provider and GPS kilometres are unknown.", "ยังไม่ได้อ่านวันนี้ ระยะทางผู้ให้บริการและ GPS ยังไม่ทราบ")}</p> : null) : variant === "bar" ? null : <>
      <div className="fleet-evidence-metrics"><div><span>{t("Provider-reported km", "กม. ที่ผู้ให้บริการรายงาน")}</span><strong>{number(evidence.sources.providerReported.value)}</strong></div><div><span>{t("GPS-derived km", "กม. จาก GPS")}</span><strong>{number(evidence.sources.gpsDerived.value)}</strong></div></div>
      <dl className="fleet-evidence-sources">
        <div><dt>{t("Report source", "แหล่งรายงาน")}</dt><dd>Forth parkingTrip · sumDistance · {evidence.deviceId}</dd></div>
        <div><dt>{t("Arithmetic reconciliation", "ตรวจผลรวมรายงาน")}</dt><dd>{evidence.provider.arithmetic.status === "pass" ? t("Segment sum matches provider Total", "ผลรวมรายการตรงกับยอด Total") : t("Not reconciled · do not use as accepted mileage", "ยังไม่กระทบยอด · ห้ามใช้เป็นระยะทางที่ยอมรับแล้ว")} · {number(evidence.provider.providerAssertedTotalKm)} / {number(evidence.provider.metric.value)} km</dd></div>
        <div><dt>{t("Mileage acceptance", "การยอมรับระยะทาง")}</dt><dd>{evidence.provider.acceptance.status === "pass" ? t("Complete and reconciled", "ครบและกระทบยอดแล้ว") : evidence.provider.acceptance.status === "incomplete" ? t("Incomplete · provider coverage not established", "ไม่ครบ · ยังไม่ยืนยันความครอบคลุมของผู้ให้บริการ") : t("Not comparable or failed", "เปรียบเทียบไม่ได้หรือไม่ผ่าน")}{evidence.provider.issues.length ? ` · ${evidence.provider.issues.join(", ")}` : ""}</dd></div>
        <div><dt>{t("Source completeness", "ความครบถ้วนแหล่งข้อมูล")}</dt><dd>{t("Unverified coverage; open segments and missing periods remain uncertain. Matching totals do not prove full-day coverage.", "ยังไม่ยืนยันความครอบคลุม รายการเปิดและช่วงที่ขาดยังไม่แน่นอน ยอดตรงกันไม่ได้ยืนยันข้อมูลครบวัน")}</dd></div>
        <div><dt>{t("GPS observations / verified", "รายงาน GPS / ที่ยืนยัน")}</dt><dd>{evidence.logAvailable ? `${evidence.gps.observations} / ${evidence.gps.verifiedObservations}` : "—"}</dd></div>
        <div><dt>{t("Accepted GPS coverage / unknown seconds", "GPS ที่ยอมรับ / วินาทีที่ยังไม่ทราบ")}</dt><dd>{evidence.logAvailable ? `${number(evidence.gps.coveredSeconds)} / ${number(evidence.gps.unknownSeconds)} s` : "—"}</dd></div>
        <div><dt>{t("First / last verified fix", "GPS ที่ยืนยันครั้งแรก / สุดท้าย")}</dt><dd>{time(evidence.gps.firstVerifiedAt)} / {time(evidence.gps.lastVerifiedAt)}</dd></div>
        <div><dt>{t("Provider km without confirmed job allocation", "กม. ผู้ให้บริการที่ยังไม่ยืนยันการจัดสรรงาน")}</dt><dd>{number(evidence.sources.providerReported.value)} km · {t("No allocation inferred", "ไม่อนุมานการจัดสรร")}</dd></div>
      </dl>
      <details><summary>{t("Provider report segments", "รายการช่วงที่ผู้ให้บริการรายงาน")} · {evidence.provider.segments.length}</summary><p>{t("These are report segments, not verified journeys. Times use the requested Bangkok day; provider timezone confirmation remains outstanding. No route is drawn from them.", "เป็นช่วงจากรายงาน ไม่ใช่เที่ยวรถที่ยืนยัน เวลาอิงวันที่ไทยที่ร้องขอ ยังรอยืนยันเขตเวลาผู้ให้บริการ และไม่สร้างเส้นทางจากรายการเหล่านี้")}</p><ul className="fleet-evidence-list">{evidence.provider.segments.slice(0,100).map(segment => <li key={segment.id}><strong>{time(segment.start)} → {segment.end ? time(segment.end) : t("Open end", "ยังไม่ปิดช่วง")} · {number(segment.km)} km</strong>{"routingTime" in segment && segment.routingTime ? <small>{t("Provider routingTime (unverified)", "routingTime ของผู้ให้บริการ (ยังไม่ยืนยัน)")}: {segment.routingTime}</small> : null}</li>)}</ul>{evidence.provider.segments.length > 100 ? <p>{t("First 100 segments shown; totals use all returned segments.", "แสดง 100 รายการแรก ผลรวมใช้ทุกรายการที่ได้รับ")}</p> : null}</details>
      <details><summary>{t("Coverage and gaps", "ความครอบคลุมและช่วงขาด")}</summary><p>{t("Report interval separations are not proof of a GPS outage. GPS unknown intervals below distinguish missing samples and rejected positions.", "ช่องว่างระหว่างช่วงรายงานไม่ได้ยืนยันว่า GPS ขาด ช่วงที่ไม่ทราบด้านล่างแยกรายงานที่ขาดและตำแหน่งที่ไม่ผ่านเกณฑ์")}</p><p>{t("Provider interval separations", "ช่องว่างระหว่างช่วงรายงาน")}: {evidence.providerGaps.length}</p><ul className="fleet-evidence-list">{evidence.gps.timeline.slice(0,100).map((segment,index) => <li key={index}><strong>{time(segment.start)} → {time(segment.end)} · {number(segment.km)} km</strong><span>{segment.km === null ? segment.reason === "unverified_position" ? t("GPS source rejected; activity unknown", "แหล่ง GPS ไม่ผ่านเกณฑ์ ไม่ทราบกิจกรรม") : segment.reason === "sample_gap" || segment.reason === "missing_samples" ? t("Missing observation period", "ช่วงรายงานขาด") : t("Uncertain interval", "ช่วงที่ยังไม่แน่นอน") : t("GPS-derived observed interval", "ช่วงสังเกตที่คำนวณจาก GPS")}</span></li>)}</ul></details>
      <small>{t("Captured", "อ่านเมื่อ")}: {new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-GB", { timeZone: "Asia/Bangkok", dateStyle: "medium", timeStyle: "short" }).format(new Date(evidence.capturedAt))}</small>
    </>}
  </section>;
}
