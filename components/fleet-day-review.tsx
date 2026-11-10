"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { originHeaders } from "@/lib/fleet-request-origin";
import { bangkokDateInput } from "@/lib/fleet-evidence-view";
import { INSIGHT_COPY, coverageLabel, evidenceLabel, reliabilityLabel } from "@/lib/fleet-day-insights";
import {
  EXCEPTION_COPY, INSIGHT_UNKNOWN, QUESTION_COPY, buildAttentionQueue, groupLabel, managementQuestions, previousBangkokDay, priorityLabel, reviewVehicle, runReadQueue, sortReviews, statusLabel, summarizeFleetReview, vehiclesToRead,
  type FleetException, type ReadState, type ReviewRowInput, type VehicleDayReview, type VehicleReview
} from "@/lib/fleet-day-review";

type Lang = "en" | "th";
type ApiRow = { vehicleId: string; registration: string; metric: { value: number | null } | null; arithmeticPassed: boolean; segments: number | null; capturedAt: string | null; review: VehicleDayReview | null; registry?: "active" | "inactive" | "duplicate_registration" };
type ApiReport = { day: string; capturedAt: string; rows: ApiRow[] };

const toInput = (row: ApiRow): ReviewRowInput => ({ vehicleId: row.vehicleId, registration: row.registration, providerKm: row.metric?.value ?? null, providerReconciled: row.arithmeticPassed, segments: row.segments, capturedAt: row.capturedAt, review: row.review, registry: row.registry });

/**
 * Fleet-wide daily review. Opening it only shows evidence that already exists in this user's server cache; it never contacts
 * Forth. "Read missing days" is an explicit, bounded, one-at-a-time action. Missing evidence is "not requested", never zero.
 */
export function FleetDayReview({ language, onVehicle }: { language: Lang; onVehicle: (registration: string, day: string) => void }) {
  const t = (en: string, th: string) => (language === "th" ? th : en);
  const lang = language === "th" ? 1 : 0;
  const [day, setDay] = useState(() => previousBangkokDay());
  const [report, setReport] = useState<ApiReport | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "failed">("idle");
  const [reads, setReads] = useState<Record<string, ReadState>>({});
  const [queueRunning, setQueueRunning] = useState(false);
  const [sort, setSort] = useState<"priority" | "registration" | "distance" | "evidence">("priority");
  const [filter, setFilter] = useState<"all" | "review" | "not_requested" | "unverified">("all");
  const [search, setSearch] = useState("");
  const reportRequest = useRef<AbortController | null>(null);
  const queueAbort = useRef<AbortController | null>(null);
  const generation = useRef(0);

  const token = useCallback(async () => (await supabase.auth.getSession()).data.session?.access_token ?? null, []);
  const loadReport = useCallback(async (forDay: string) => {
    reportRequest.current?.abort(); const controller = new AbortController(); reportRequest.current = controller; const id = ++generation.current;
    setStatus("loading");
    const timeout = setTimeout(() => controller.abort(), 25000);
    try {
      const access = await token(); if (!access) throw new Error("session");
      const response = await fetch(`/api/admin/forth-tracking/evidence/fleet?${new URLSearchParams({ day: forDay })}`, { headers: { Authorization: `Bearer ${access}` }, signal: controller.signal, cache: "no-store" });
      if (!response.ok) throw new Error("status");
      const result = await response.json() as ApiReport;
      if (id === generation.current) { setReport(result); setStatus("idle"); }
    } catch { if (id === generation.current && !controller.signal.aborted) setStatus("failed"); } finally { clearTimeout(timeout); }
  }, [token]);

  // Cache-only: safe to run on open and when the day changes (no Forth request is made by this endpoint).
  useEffect(() => { void loadReport(day); }, [day, loadReport]);
  useEffect(() => () => { reportRequest.current?.abort(); queueAbort.current?.abort(); }, []);

  const rowsInput = useMemo(() => (report?.rows ?? []).map(toInput), [report]);
  const reviews = useMemo(() => rowsInput.map(row => reviewVehicle(row, reads[row.vehicleId] ?? "idle")), [rowsInput, reads]);
  const summary = useMemo(() => summarizeFleetReview(reviews), [reviews]);
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const passes = (r: VehicleReview) => (!q || r.registration.toLowerCase().includes(q.replace(/\s+/g, "")) || r.registration.toLowerCase().includes(q)) &&
      (filter === "all" || (filter === "review" ? r.priority === "high" || r.priority === "medium" : filter === "not_requested" ? r.status === "not_requested" : r.verified === "unverified" || r.verified === "partly"));
    return sortReviews(reviews.filter(passes), sort);
  }, [reviews, sort, filter, search]);
  const pending = useMemo(() => vehiclesToRead(rowsInput, reads), [rowsInput, reads]);
  const queue = useMemo(() => buildAttentionQueue(reviews), [reviews]);
  const questions = useMemo(() => managementQuestions(summary), [summary]);

  async function readIds(ids: string[]) {
    if (!ids.length || queueRunning) return;
    const controller = new AbortController(); queueAbort.current = controller; setQueueRunning(true);
    try {
      const access = await token(); if (!access) throw new Error("session");
      await runReadQueue(ids, async (id, signal) => {
        const response = await fetch(`/api/admin/forth-tracking/evidence/provider?${new URLSearchParams({ vehicleId: id, day })}`, { method: "POST", headers: { Authorization: `Bearer ${access}`, ...originHeaders("reports_day_review_queue") }, signal: AbortSignal.any([signal, AbortSignal.timeout(50000)]), cache: "no-store" });
        return { status: response.status };
      }, { signal: controller.signal, concurrency: 1, onState: (id, state) => setReads(current => ({ ...current, [id]: state })) });
    } catch { /* a session problem leaves every vehicle "not requested" */ } finally { setQueueRunning(false); queueAbort.current = null; await loadReport(day); }
  }

  const n = (v: number | null | undefined) => (v === null || v === undefined ? "—" : v.toLocaleString(language === "th" ? "th-TH" : "en-GB", { maximumFractionDigits: 1 }));
  const mins = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${Math.floor(v / 60)} ${t("h", "ชม.")} ${Math.round(v % 60)} ${t("min", "นาที")}`);
  const exceptionTitle = (e: FleetException) => e.insightId ? INSIGHT_COPY[e.insightId].title[lang] : EXCEPTION_COPY[e.key]?.title[lang] ?? e.key;
  const evidenceText = (e: FleetException) => Object.entries(e.evidence).filter(([, v]) => v !== null).map(([k, v]) => `${evidenceLabel(k, language)}: ${v}`).join(" · ");
  const progress = Object.values(reads).filter(s => s === "done" || s === "failed" || s === "no_device" || s === "rate_limited" || s === "unavailable").length;
  const queued = Object.values(reads).filter(s => s === "queued" || s === "loading").length;
  const maxDay = bangkokDateInput();
  const failedBanner = Object.values(reads).includes("rate_limited") ? t("Forth read limit reached. Reads stopped safely; the rest stay not requested. Resume in a minute.", "ถึงขีดจำกัดการอ่านของ Forth หยุดอย่างปลอดภัย ที่เหลือยังไม่ได้ขอข้อมูล ลองต่อในอีกสักครู่") : Object.values(reads).includes("unavailable") ? t("Forth is unavailable or not authorised right now. Reads stopped safely.", "Forth ไม่พร้อมหรือไม่มีสิทธิ์ในขณะนี้ หยุดอย่างปลอดภัย") : null;

  return <section className="fleet-evidence fleet-day-review" aria-label={t("Fleet daily review", "ตรวจสอบกองรถรายวัน")} data-fleet-day-review>
    <div className="fleet-evidence-heading"><span>{t("EES · READ ONLY · FORTH EVIDENCE", "EES · อ่านอย่างเดียว · หลักฐาน FORTH")}</span><h3>{t("Fleet daily review", "ตรวจสอบกองรถรายวัน")}</h3></div>
    <div className="fleet-review-controls">
      <label>{t("Bangkok date", "วันที่ (เวลาไทย)")}<input type="date" value={day} max={maxDay} onChange={event => { if (event.target.value) { queueAbort.current?.abort(); setReads({}); setReport(null); setDay(event.target.value); } }} /></label>
      <button type="button" className="btn-secondary" disabled={queueRunning || pending.length === 0 || status === "loading"} onClick={() => void readIds(pending)}>
        {queueRunning ? t(`Reading ${Math.min(progress + 1, progress + queued)} of ${progress + queued}…`, `กำลังอ่าน ${Math.min(progress + 1, progress + queued)} จาก ${progress + queued}…`) : t(`Read ${pending.length} missing vehicle-days from Forth`, `อ่านข้อมูล Forth ที่ยังไม่มี ${pending.length} คัน`)}
      </button>
      {queueRunning ? <button type="button" className="btn-secondary" onClick={() => queueAbort.current?.abort()}>{t("Stop", "หยุด")}</button> : null}
    </div>
    <details className="v72-hint-details" data-review-help><summary>{t("How this review reads data", "การอ่านข้อมูลของหน้านี้")}</summary><p className="fleet-evidence-note">{t("Opening this page reads only evidence already in your session (up to 30 minutes); it never contacts Forth. The button reads one vehicle at a time, read-only, and stops at the first rate-limit or access error. Nothing is saved or scheduled.", "การเปิดหน้านี้อ่านเฉพาะหลักฐานที่มีอยู่ในเซสชันของคุณ (สูงสุด 30 นาที) ไม่ติดต่อ Forth ปุ่มด้านบนอ่านทีละคัน แบบอ่านอย่างเดียว และหยุดเมื่อถึงขีดจำกัดหรือไม่มีสิทธิ์ ไม่มีการบันทึกหรือตั้งเวลา")}</p></details>
    <div role="status" aria-live="polite">
      {status === "failed" ? <p role="alert">{t("The fleet list could not be loaded. Check access and connection, then retry.", "โหลดรายการกองรถไม่ได้ โปรดตรวจสอบสิทธิ์และการเชื่อมต่อแล้วลองใหม่")} <button type="button" className="fleet-link-button" onClick={() => void loadReport(day)}>{t("Retry", "ลองใหม่")}</button></p> : null}
      {status === "loading" && !report ? <p>{t("Loading fleet…", "กำลังโหลดกองรถ…")}</p> : null}
      {failedBanner ? <p role="alert" data-queue-banner>{failedBanner}</p> : null}
    </div>
    {report ? <>
      {Object.entries(summary.byException).length ? <div className="v72-exceptions" data-exception-groups><h4>{t("Needs attention first", "ต้องตรวจสอบก่อน")}</h4><ul>{Object.entries(summary.byException).sort((x, y) => y[1] - x[1]).slice(0, 6).map(([key, count]) => <li key={key}><b>{count}</b> {INSIGHT_COPY[key as keyof typeof INSIGHT_COPY]?.title[lang] ?? EXCEPTION_COPY[key]?.title[lang] ?? key}</li>)}</ul></div> : <p className="v72-empty-line" data-exception-groups>{summary.withEvidence === 0 ? t("No vehicle has been reviewed for this day yet, so no exception can be shown. Not requested is not the same as no problem.", "ยังไม่ได้ตรวจสอบรถคันใดในวันนี้ จึงยังแสดงรายการผิดปกติไม่ได้ ยังไม่ได้ขอไม่ได้หมายความว่าไม่มีปัญหา") : t("No exceptions in the reviewed vehicles.", "ไม่พบรายการผิดปกติในรถที่ตรวจแล้ว")}</p>}
      <dl className="v72-strip" data-fleet-summary>
        <div><dt>{t("Vehicles reviewed", "รถที่ตรวจแล้ว")}</dt><dd><b>{summary.withEvidence}/{summary.vehicles}</b><small>{t("vehicles with Forth evidence", "รถที่มีหลักฐาน Forth")}</small></dd></div>
        <div><dt>{t("Not requested", "ยังไม่ได้ขอ")}</dt><dd><b>{summary.notRequested}</b><small>{t("nothing read yet", "ยังไม่ได้อ่าน")}</small></dd></div>
        <div><dt>{t("Verified GPS", "GPS ที่ยืนยัน")}</dt><dd><b>{summary.verified}</b><small>{t("vehicles", "คัน")}</small></dd></div>
        <div><dt>{t("Unverified / partly", "ไม่ยืนยัน / บางส่วน")}</dt><dd><b>{summary.unverified}/{summary.partlyVerified}</b><small>{t("vehicles", "คัน")}</small></dd></div>
        <div className={summary.needingReview.high + summary.needingReview.medium > 0 ? "is-attention" : ""}><dt>{t("Need review (high / medium)", "ต้องตรวจ (สูง / กลาง)")}</dt><dd><b>{summary.needingReview.high}/{summary.needingReview.medium}</b><small>{t("vehicles", "คัน")}</small></dd></div>
        <div><dt>{t("Provider-reported km (reviewed vehicles only)", "กม. ที่ผู้ให้บริการรายงาน (เฉพาะรถที่ตรวจแล้ว)")}</dt><dd><b>{n(summary.distance.km)}</b><small>{summary.distance.complete ? t("all vehicles", "ทุกคัน") : t("reviewed vehicles only", "เฉพาะรถที่ตรวจแล้ว")}</small></dd></div>
      </dl>
      <p className={summary.distance.complete ? "v72-hint" : "v72-notice is-partial"} role="note" data-distance-disclosure>{summary.distance.complete
        ? t(`Provider km covers all ${summary.distance.totalVehicles} vehicles with verified, complete evidence.`, `กม. ผู้ให้บริการครอบคลุมรถทั้ง ${summary.distance.totalVehicles} คันที่มีหลักฐานครบ`)
        : t(`Provider km is a partial sum of ${summary.distance.includedVehicles} of ${summary.distance.totalVehicles} vehicles. It is not a fleet total and sources are never added together.`, `กม. ผู้ให้บริการเป็นผลรวมบางส่วนของ ${summary.distance.includedVehicles} จาก ${summary.distance.totalVehicles} คัน ไม่ใช่ยอดรวมกองรถ และไม่รวมข้ามแหล่งข้อมูล`)}</p>
      <section className="v77-management" data-management-summary aria-label={t("Management summary", "สรุปสำหรับฝ่ายบริหาร")}>
        <h4>{t("What needs attention", "สิ่งที่ต้องตรวจสอบ")}</h4>
        <p className="v72-hint">{t(`Counted over the ${questions.reviewed} of ${questions.total} vehicles reviewed for ${report.day}. The other ${questions.total - questions.reviewed} are not requested, which is not the same as no problem.`, `นับจากรถที่ตรวจแล้ว ${questions.reviewed} จาก ${questions.total} คัน สำหรับวันที่ ${report.day} ส่วนอีก ${questions.total - questions.reviewed} คันยังไม่ได้ขอ ซึ่งไม่ได้หมายความว่าไม่มีปัญหา`)}</p>
        <ul className="v77-questions" data-management-questions>{questions.questions.map(q => <li key={q.id} data-question={q.id} className={q.vehicles > 0 ? "has-vehicles" : ""}><b>{questions.reviewed === 0 ? "—" : q.vehicles}</b><span>{QUESTION_COPY[q.id][lang]}</span></li>)}</ul>
        <p className="v72-hint">{t("Fuel and odometer anomalies and recurring customer locations are not part of a single-day review: see Fuel Intelligence and Recurring places for a vehicle.", "ความผิดปกติของเชื้อเพลิงและเลขไมล์ รวมถึงสถานที่ลูกค้าที่เกิดซ้ำ ไม่อยู่ในการตรวจรายวัน ดูได้ที่ข้อมูลเชื้อเพลิงและจุดที่เกิดซ้ำของแต่ละคัน")}</p>
        {queue.length === 0 ? <p className="v72-empty-line" data-attention-queue>{questions.reviewed === 0 ? t("Nothing reviewed yet, so no issue can be listed.", "ยังไม่ได้ตรวจรถ จึงยังแสดงรายการไม่ได้") : t("No high or medium issues in the reviewed vehicles.", "ไม่พบปัญหาระดับสูงหรือกลางในรถที่ตรวจแล้ว")}</p> : (
          <div data-attention-queue>{queue.slice(0, 8).map((g, index) => {
            const c = g.insightId ? INSIGHT_COPY[g.insightId] : EXCEPTION_COPY[g.key]; const title = g.insightId ? INSIGHT_COPY[g.insightId].title[lang] : EXCEPTION_COPY[g.key]?.title[lang] ?? g.key;
            return <details key={g.key} className={`v77-issue is-${g.priority}`} open={index < 2} data-issue={g.key}>
              <summary><span className={`fleet-review-badge is-priority-${g.priority}`}>{priorityLabel(g.priority, language)}</span> <b>{title}</b> · {g.vehicles.length} {t(g.vehicles.length === 1 ? "vehicle" : "vehicles", "คัน")}</summary>
              {c ? <p className="v72-hint">{"reason" in c ? c.reason[lang] : ""}</p> : null}
              <div className="v72-table-wrap"><table className="v72-table"><thead><tr><th scope="col">{t("Vehicle", "รถ")}</th><th scope="col">{t("Day", "วัน")}</th><th scope="col">{t("Evidence", "หลักฐาน")}</th><th scope="col">{t("Source", "แหล่ง")}</th></tr></thead>
                <tbody>{g.vehicles.slice(0, 10).map(v => <tr key={v.vehicleId} data-vehicle={v.registration}><th scope="row"><button type="button" className="fleet-link-button" onClick={() => onVehicle(v.registration, day)} aria-label={t(`Open ${v.registration} on ${day}`, `เปิด ${v.registration} วันที่ ${day}`)}>{v.registration} →</button></th><td>{report.day}</td>
                  <td>{Object.entries(v.evidence).filter(([, x]) => x !== null).map(([k, x]) => `${evidenceLabel(k, language)}: ${x}`).join(" · ") || "—"}</td><td>{reliabilityLabel(v.reliability, language)}</td></tr>)}</tbody></table></div>
              {g.vehicles.length > 10 ? <p className="v72-hint">+{g.vehicles.length - 10} {t("more in the vehicle list below", "คันในรายการรถด้านล่าง")}</p> : null}
              {c ? <p className="v72-hint"><b>{t("Still unknown", "ยังไม่ทราบ")}:</b> {g.insightId ? INSIGHT_UNKNOWN[g.insightId][lang] : "unknown" in c ? c.unknown[lang] : ""} · <b>{t("Office action", "สิ่งที่สำนักงานทำได้")}:</b> {c.action[lang]}</p> : null}
            </details>;
          })}{queue.length > 8 ? <p className="v72-hint">+{queue.length - 8} {t("more issue types: use the vehicle list below", "ประเภทปัญหาเพิ่มเติม: ดูในรายการรถด้านล่าง")}</p> : null}</div>
        )}
      </section>
      <p className="v72-hint v72-legend">{t("Reviewed = evidence read in your session · Not requested = nothing read yet · Partial = some evidence missing · Unverified = positions not GPS-verified · Unknown is never shown as zero.", "ตรวจแล้ว = มีหลักฐานในเซสชัน · ยังไม่ได้ขอ = ยังไม่ได้อ่าน · บางส่วน = หลักฐานไม่ครบ · ไม่ยืนยัน = ตำแหน่งไม่ใช่ GPS ที่ยืนยัน · ไม่ทราบไม่แสดงเป็นศูนย์")}</p>
      <div className="fleet-review-controls">
        <label>{t("Search registration", "ค้นหาทะเบียน")}<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="68-7154" /></label>
        <label>{t("Show", "แสดง")}<select value={filter} onChange={event => setFilter(event.target.value as typeof filter)}>
          <option value="all">{t("All vehicles", "รถทั้งหมด")}</option><option value="review">{t("Needs review", "ต้องตรวจสอบ")}</option><option value="not_requested">{t("Not requested", "ยังไม่ได้ขอ")}</option><option value="unverified">{t("Unverified positions", "ตำแหน่งไม่ยืนยัน")}</option></select></label>
        <label>{t("Sort", "เรียงตาม")}<select value={sort} onChange={event => setSort(event.target.value as typeof sort)}>
          <option value="priority">{t("Priority", "ความสำคัญ")}</option><option value="registration">{t("Registration", "ทะเบียน")}</option><option value="distance">{t("Provider km", "กม. ผู้ให้บริการ")}</option><option value="evidence">{t("Evidence status", "สถานะหลักฐาน")}</option></select></label>
      </div>
      <p className="fleet-evidence-note" role="status">{t(`Showing ${visible.length} of ${reviews.length} vehicles · ${report.day} · Asia/Bangkok. This is a historical day, not live tracking.`, `แสดง ${visible.length} จาก ${reviews.length} คัน · ${report.day} · เวลาไทย เป็นข้อมูลย้อนหลัง ไม่ใช่การติดตามสด`)}</p>
      {visible.length === 0 ? <p>{t("No vehicles match this filter.", "ไม่มีรถที่ตรงกับตัวกรองนี้")}</p> : null}
      <ul className="fleet-evidence-list fleet-review-list">{visible.map(r => {
        const input = rowsInput.find(x => x.vehicleId === r.vehicleId)!; const rv = input.review; const top = r.exceptions.slice(0, 2);
        return <li key={r.vehicleId} data-vehicle={r.registration} data-status={r.status} data-priority={r.priority}>
          <div className="fleet-review-row">
            <button type="button" onClick={() => onVehicle(r.registration, day)} aria-label={t(`Open ${r.registration} on ${day}`, `เปิด ${r.registration} วันที่ ${day}`)}><strong>{r.registration}</strong> →</button>
            <span className={`fleet-review-badge is-${r.status}`}>{statusLabel(r.status, language)}</span>
            {r.priority !== "none" ? <span className={`fleet-review-badge is-priority-${r.priority}`}>{priorityLabel(r.priority, language)}</span> : null}
            <span>{t("Provider-reported km", "กม. ที่ผู้ให้บริการรายงาน")}: {n(r.providerKm)}</span>
            {r.coverage ? <small>{coverageLabel(r.coverage, language)}</small> : null}
            {(r.status === "not_requested" || r.status === "failed" || r.status === "rate_limited") && input.registry !== "duplicate_registration" && input.registry !== "inactive" ? <button type="button" className="fleet-link-button" disabled={queueRunning} onClick={() => void readIds([r.vehicleId])}>{t("Read this day", "อ่านวันนี้")}</button> : null}
          </div>
          {rv?.activity.movingJourneys != null ? <small>{rv.activity.movingJourneys} {t("moving", "เคลื่อนที่")} · {mins(rv.activity.movingMinutes)} · {rv.activity.stops} {t("stops", "จุดจอด")} · {t("longest stop", "จอดนานสุด")} {mins(rv.activity.longestStopMinutes)} · {t("unknown gaps", "ช่วงไม่มีข้อมูล")} {mins(rv.activity.missingMinutes)}</small> : rv?.journeyAccess === "requires_authorisation" ? <small>{t("Journey detail needs administrator authorisation; provider distance only.", "รายละเอียดเที่ยวต้องได้รับอนุญาตจากผู้ดูแลระบบ แสดงเฉพาะระยะทางผู้ให้บริการ")}</small> : null}
          {top.length ? <small>{top.map(exceptionTitle).join(" · ")}{r.exceptions.length > top.length ? ` · +${r.exceptions.length - top.length}` : ""}</small> : null}
          {r.exceptions.length ? <details><summary>{t("Why and what to do", "สาเหตุและสิ่งที่ควรทำ")} · {r.exceptions.length}</summary>
            <ul className="fleet-evidence-list">{r.exceptions.map(e => { const c = e.insightId ? INSIGHT_COPY[e.insightId] : EXCEPTION_COPY[e.key]; return <li key={e.key} data-exception={e.key}>
              <strong>{exceptionTitle(e)}</strong> <small>{groupLabel(e.group, language)} · {priorityLabel(e.priority, language)} · {reliabilityLabel(e.reliability, language)}</small>
              {c ? <div>{"reason" in c ? c.reason[lang] : null}</div> : null}
              {evidenceText(e) ? <small>{t("Evidence", "หลักฐาน")}: {evidenceText(e)}</small> : null}
              {c ? <div><small>{t("Still unknown", "ยังไม่ทราบ")}: {e.insightId ? INSIGHT_UNKNOWN[e.insightId][lang] : "unknown" in c ? c.unknown[lang] : ""}</small></div> : null}
              {c ? <div><small>{t("Office action", "สิ่งที่สำนักงานทำได้")}: {c.action[lang]}</small></div> : null}
            </li>; })}</ul></details> : null}
        </li>;
      })}</ul>
    </> : null}
  </section>;
}
