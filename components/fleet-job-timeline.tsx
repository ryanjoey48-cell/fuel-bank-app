"use client";
import { useMemo } from "react";
import styles from "./fleet-job-timeline.module.css";
import type { suggestDayJobs } from "@/lib/fleet-intelligence-day";
import type { DayAnalysis } from "@/lib/fleet-vehicle-day-summary";
import type { JourneyLedger } from "@/lib/fleet-journey-ledger";
import { positionSourceLabel } from "@/lib/fleet-journey-copy";
import type { MovementEvent, MovementEventStatus, MovementStage } from "@/lib/fleet-job-movement";
import { buildReviewGuidance, missingEvidenceLabel, reviewActionLabel } from "@/lib/fleet-job-review-guidance";
import { buildReviewQueue, describeWindow, formatBangkokTime, formatDwell, movementReasonLabel, movementStageLabel, movementStatusLabel, pointProvenanceLabel, reviewReasonLabel, siteClassLabel, siteReasonLabel, visitAlternativeLabel, visitConfidenceLabel, visitReasonLabel, visitSummaryLabel } from "@/lib/fleet-job-movement-view";

type Job = ReturnType<typeof suggestDayJobs>[number] & { movementAccess?: "granted" | "requires_authorisation" | "not_read" };
type Lang = "en" | "th";
const STATUSES: MovementEventStatus[] = ["verified_gps", "provider_reported_unverified", "office_confirmed", "estimated", "missing"];
const STAGES: MovementStage[] = ["pickup_arrival", "pickup_departure", "delivery_arrival", "delivery_departure"];

/**
 * V5 job movement timeline and office review queue. Read-only. Every time shown was derived from an observed position
 * and carries its status; a time that cannot be supported is shown as missing, never filled in. Nothing is saved.
 */
export function FleetJobTimeline({ jobs, analysis, ledger, registration, language, day }: { jobs: Job[]; analysis: DayAnalysis; ledger: JourneyLedger | null; registration: string; language: Lang; day: string }) {
  const t = (en: string, th: string) => (language === "th" ? th : en);
  const km = t("km", "กม.");
  const n = (v: number | null | undefined) => (v === null || v === undefined ? "—" : v.toLocaleString(language === "th" ? "th-TH" : "en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const matchOf = useMemo(() => new Map(analysis.matches.jobs.map(m => [m.jobId, m])), [analysis]);
  const journeyOf = useMemo(() => new Map((ledger?.journeys ?? []).map(j => [j.id, j])), [ledger]);
  const queue = useMemo(() => buildReviewQueue(jobs, analysis.matches.jobs), [jobs, analysis]);
  const dayAllocation = analysis.allocation;
  const label = (status: MovementEventStatus) => movementStatusLabel(status, language);

  if (jobs.length === 0) return <section className={styles.wrap} aria-label={t("Job movements", "การเคลื่อนที่ของงาน")}><p className={styles.note}>{t("No bookings for this vehicle on this day, so there is no job timeline. This does not mean no work was done.", "ไม่มีการจองของรถคันนี้ในวันนี้ จึงไม่มีไทม์ไลน์งาน ไม่ได้หมายความว่าไม่มีการทำงาน")}</p></section>;
  const restricted = jobs.every(j => j.movementAccess === "requires_authorisation");

  const step = (event: MovementEvent) => {
    const time = formatBangkokTime(event.at, language), window = describeWindow(event, language);
    return <li key={event.stage} className={styles.step} data-status={event.status} data-stage={event.stage}>
      <span><strong>{movementStageLabel(event.stage, language)}</strong> · <span className={styles.time}>{time ?? "—"}</span> <span className={styles.chip} data-status={event.status}>{label(event.status)}</span></span>
      {window && event.status !== "missing" ? <small className={styles.note}>{t("Truth lies", "เวลาจริงอยู่")} {window}</small> : null}
      {event.status === "missing" && window ? <small className={styles.note}>{t("Last position at the location", "ตำแหน่งล่าสุดที่จุดนี้")}: {window}</small> : null}
      {event.reasons.length ? <small className={styles.note}>{event.reasons.map(r => movementReasonLabel(r, language)).join(" · ")}</small> : null}
    </li>;
  };

  return <section className={styles.wrap} aria-label={t("Job movements", "การเคลื่อนที่ของงาน")}>
    <h4>{t("Job movement timeline", "ไทม์ไลน์การเคลื่อนที่ของงาน")} · {registration || "—"} · {day}</h4>
    <p className={styles.note} role="note">{t("Times come from observed vehicle positions near the booked pickup and delivery points (150 m). Nothing is invented: if the evidence is not there, the time is shown as missing. Not saved anywhere.", "เวลามาจากตำแหน่งรถที่สังเกตได้ใกล้จุดรับและจุดส่งที่จอง (150 ม.) ไม่มีการสร้างเวลาขึ้นเอง หากไม่มีหลักฐานจะแสดงว่าไม่มีข้อมูล และไม่มีการบันทึก")}</p>
    <ul className={styles.legend} aria-label={t("Evidence status legend", "คำอธิบายสถานะหลักฐาน")}>{STATUSES.map(s => <li key={s}><span className={styles.chip} data-status={s}>{label(s)}</span></li>)}</ul>
    {restricted ? <p className={styles.note} role="note">{t("Arrival and departure times use historical positions and need administrator authorisation.", "เวลาถึงและออกใช้ประวัติตำแหน่ง ต้องได้รับอนุญาตจากผู้ดูแลระบบ")}</p> : null}

    <h5>{t("Office review queue", "คิวตรวจสอบของสำนักงาน")} · {queue.length}</h5>
    {queue.length === 0 ? <p className={styles.note}>{t("Nothing needs review from the evidence read so far.", "ไม่มีรายการที่ต้องตรวจสอบจากหลักฐานที่อ่านแล้ว")}</p>
      : <ul className={styles.queue}>{queue.map(item => <li key={item.jobId} data-priority={item.priority}><strong>{item.label}</strong><small className={styles.note}>{item.reasons.map(r => reviewReasonLabel(r, language)).join(" · ")}</small></li>)}</ul>}

    {jobs.map(job => {
      const match = matchOf.get(job.jobId); const journey = match?.journeyIds[0] ? journeyOf.get(match.journeyIds[0]) ?? null : null;
      const movement = job.movement;
      const byStage = new Map((movement?.events ?? []).map(e => [e.stage, e]));
      const events = STAGES.map(stage => byStage.get(stage) ?? { stage, status: "missing" as const, at: null, window: null, confidence: "none" as const, source: "none" as const, reasons: [] });
      const dwell = movement?.dwell;
      return <article key={job.jobId} className={styles.job} aria-label={job.workOrder ?? job.jobId}>
        <h5>{job.workOrder ?? t("No work order reference", "ไม่มีเลขใบงาน")}{job.bookingRef ? ` · ${t("booking", "การจอง")} ${job.bookingRef}` : ""}</h5>
        <p className={styles.note}>{registration || "—"} · {t("Driver not confirmed", "ยังไม่ยืนยันผู้ขับ")}{job.driverText ? ` (${t("booking text", "ข้อความในการจอง")}: ${job.driverText})` : ""}</p>
        {job.visitRecognition ? <div className={styles.likely} data-likely-visits>
          <strong>{t("Likely visits (suggested by EES, not confirmed)", "การเข้าพื้นที่ที่น่าจะเป็น (ระบบแนะนำ ยังไม่ยืนยัน)")}</strong>
          {(["pickup", "delivery"] as const).map(role => {
            const r = job.visitRecognition?.[role]; if (!r) return null; const top = r.candidates[0]; const hhmm = (v: string | null) => formatBangkokTime(v, language) ?? t("unknown", "ไม่ทราบ");
            return <div key={role} className={styles.likelyRole} data-role={role} data-summary={r.summary}>
              <p className={styles.classLine} data-class={r.summary === "probable_visit" ? "B" : r.summary === "drive_by_rejected" || r.summary === "no_reliable_evidence" ? "E" : r.summary === "competing_candidates" ? "F" : "C"}>{role === "pickup" ? t("Pickup", "จุดรับ") : t("Delivery", "จุดส่ง")} · {visitSummaryLabel(r.summary, language)}</p>
              {r.candidates.slice(0, r.summary === "competing_candidates" ? 2 : 1).map((c, index) => <div key={c.key} className={styles.windows}>
                <strong>{index === 0 ? t("Best candidate", "ตัวเลือกที่ดีที่สุด") : t("Competing candidate", "ตัวเลือกที่แข่งกัน")}</strong>
                <span>{t("Arrived between", "ถึงระหว่าง")} {c.arrival.earliest ? hhmm(c.arrival.earliest) : t("unknown", "ไม่ทราบ")} {t("and", "และ")} {hhmm(c.arrival.latest)} · {t("left between", "ออกระหว่าง")} {hhmm(c.departure.earliest)} {t("and", "และ")} {c.departure.latest ? hhmm(c.departure.latest) : t("unknown", "ไม่ทราบ")}</span>
                <span>{t("Observed stay", "เวลาที่สังเกตว่าอยู่")}: {formatDwell(c.dwell.minMinutes * 60_000, c.dwell.maxMinutes === null ? null : c.dwell.maxMinutes * 60_000, language)}{c.dwell.interruptions ? ` · ${c.stops} ${t("adjacent stops merged", "การหยุดติดกันที่รวมกัน")}` : ""}</span>
                <span>{c.distanceFromPointM} m {t("from the booked point", "จากจุดที่จอง")} ({c.zone === "direct" ? t("inside the site boundary", "ภายในขอบเขตสถานที่") : t("wider search area", "พื้นที่ค้นหากว้าง")}) · {c.sourceQuality === "verified_gps" ? t("verified GPS", "GPS ที่ยืนยัน") : c.sourceQuality === "mixed" ? t("mixed quality", "คุณภาพผสม") : t("unverified positions", "ตำแหน่งที่ยังไม่ยืนยัน")} · {t("confidence", "ความเชื่อมั่น")} {visitConfidenceLabel(c.confidence, language)} · {t("evidence weight", "น้ำหนักหลักฐาน")} {c.weight}/100</span>
                <small className={styles.note}>{c.reasons.map(x => visitReasonLabel(x, language)).join(" · ")}</small>
                <small className={styles.note}>{t("Alternatives", "คำอธิบายอื่นที่เป็นไปได้")}: {c.alternatives.map(x => visitAlternativeLabel(x, language)).join(" · ")}</small>
              </div>)}
              {!top && r.driveBys.length ? <small className={styles.note}>{t("Drove past at", "ขับผ่านเวลา")} {r.driveBys.map(d => `${hhmm(d.at)} (${d.speedKph ?? "?"} km/h)`).join(" · ")}</small> : null}
              {r.otherLongStops.length ? <small className={styles.note}>{t("Other long stops later in the day, outside the search area, not matched", "การหยุดนานอื่นช่วงหลังของวัน นอกพื้นที่ค้นหา ไม่ได้จับคู่")}: {r.otherLongStops.map(o => `${hhmm(o.firstAt)}–${hhmm(o.lastAt)} (${o.dwellMinutes} ${t("min", "นาที")}, ${(o.distanceFromPointM / 1000).toFixed(1)} km)`).join(" · ")}</small> : null}
              <small className={styles.note}>{r.note}</small>
            </div>;
          })}
        </div> : null}
        {job.visitRecognition ? (() => { const g = buildReviewGuidance(job); return <div className={styles.likely} data-review-guidance>
          <strong>{t("Missing evidence", "หลักฐานที่ขาด")}</strong>
          <ul className={styles.windows}>{g.missing.length ? g.missing.map(m => <li key={m}>{missingEvidenceLabel(m, language)}</li>) : <li>{t("None noted", "ไม่มี")}</li>}</ul>
          <strong>{t("Suggested review actions (these change nothing)", "การตรวจสอบที่แนะนำ (ไม่มีการเปลี่ยนแปลงใดๆ)")}</strong>
          <ol className={styles.windows}>{g.actions.map(a => <li key={a}>{reviewActionLabel(a, language)}</li>)}</ol>
        </div>; })() : null}
        <ol className={styles.steps}>
          <li className={styles.step} data-status={job.pickupTime ? "scheduled" : "missing"} data-stage="booking">
            <span><strong>{t("Booking", "การจอง")}</strong> · {t("scheduled pickup", "เวลารับตามแผน")} <span className={styles.time}>{job.pickupTime?.slice(0, 5) ?? "—"}</span></span>
            <small className={styles.note}>{job.pickupName ?? "—"} → {job.deliveryName ?? "—"} · {t("Booking last updated", "แก้ไขการจองล่าสุด")}: {formatBangkokTime(job.bookingUpdatedAt ?? null, language) ?? "—"} · {t("The booking creation time is not available", "ไม่มีเวลาที่สร้างการจอง")}</small>
          </li>
          {events.slice(0, 2).map(step)}
          {dwell ? <li className={styles.step} data-status="missing" data-stage="pickup_dwell"><small className={styles.note}>{t("Time at pickup", "เวลาอยู่ที่จุดรับ")}: {dwell.pickupMinutes === null ? t("unknown (needs both arrival and departure)", "ไม่ทราบ (ต้องมีทั้งเวลาถึงและออก)") : `${dwell.pickupMinutes} ${t("min (first to last position at the location)", "นาที (ตำแหน่งแรกถึงตำแหน่งสุดท้ายที่จุดนั้น)")}`}</small></li> : null}
          {events.slice(2).map(step)}
          {dwell ? <li className={styles.step} data-status="missing" data-stage="delivery_dwell"><small className={styles.note}>{t("Time at delivery", "เวลาอยู่ที่จุดส่ง")}: {dwell.deliveryMinutes === null ? t("unknown (needs both arrival and departure)", "ไม่ทราบ (ต้องมีทั้งเวลาถึงและออก)") : `${dwell.deliveryMinutes} ${t("min (first to last position at the location)", "นาที (ตำแหน่งแรกถึงตำแหน่งสุดท้ายที่จุดนั้น)")}`}</small></li> : null}
        </ol>
        {movement === null && job.movementAccess !== "requires_authorisation" ? <p className={styles.note}>{t("Read the Forth report for this day (Journeys tab) to derive arrival and departure times.", "อ่านรายงาน Forth ของวันนี้ (แท็บเส้นทาง) เพื่อหาเวลาถึงและออก")}</p> : null}
        {movement ? (["pickup", "delivery"] as const).map(side => {
          const list = movement.visits?.[side] ?? [];
          return <p key={side} className={styles.note} data-visits={side}>{side === "pickup" ? t("Visits within 150 m of pickup", "การเข้าใกล้จุดรับภายใน 150 ม.") : t("Visits within 150 m of delivery", "การเข้าใกล้จุดส่งภายใน 150 ม.")}: {list.length === 0 ? t("none", "ไม่มี") : list.map(v => `${formatBangkokTime(v.from, language)}–${formatBangkokTime(v.to, language)} (${v.observations} ${t("positions", "ตำแหน่ง")}, ${v.kind === "drive_by" ? t("drove past", "ขับผ่าน") : t("stopped or slow", "จอดหรือช้า")}${v.maxSpeedKph === null ? "" : `, ${t("max", "สูงสุด")} ${v.maxSpeedKph} km/h`})`).join(" · ")}</p>;
        }) : null}
        {job.stopAnalysis ? (["pickup", "delivery"] as const).map(side => {
          const s = job.stopAnalysis?.[side]; if (!s) return null;
          const a = s.assessment, p = s.point, stop = a.stop;
          const hhmm = (v: string | null) => formatBangkokTime(v, language) ?? "—";
          return <details key={side} className={styles.site} data-site={side} open={a.class !== "G_no_usable_evidence"}>
            <summary><strong>{side === "pickup" ? t("Pickup site evidence", "หลักฐานที่จุดรับ") : t("Delivery site evidence", "หลักฐานที่จุดส่ง")}</strong> · {siteClassLabel(a.class, language).split(" · ")[0]}</summary>
            <p className={styles.classLine} data-class={a.class}>{siteClassLabel(a.class, language)}</p>
            <p className={styles.note}>{t("Point used", "จุดที่ใช้")}: {pointProvenanceLabel(p.provenance, language)} · {t("boundary", "ขอบเขต")} {p.radiusMeters} m{p.verified ? "" : ` · ${t("unverified", "ยังไม่ตรวจสอบ")}`}{p.ambiguous ? ` · ${t("several verified points: office must choose", "มีหลายจุดที่ยืนยันแล้ว สำนักงานต้องเลือก")}` : ""}</p>
            {stop ? <ul className={styles.windows}>
              <li>{t("Earliest–latest arrival", "ถึงเร็วสุด–ช้าสุด")}: {stop.arrivalWindow.earliest ? hhmm(stop.arrivalWindow.earliest) : t("unknown", "ไม่ทราบ")} – {hhmm(stop.arrivalWindow.latest)}</li>
              <li>{t("Earliest–latest departure", "ออกเร็วสุด–ช้าสุด")}: {hhmm(stop.departureWindow.earliest)} – {stop.departureWindow.latest ? hhmm(stop.departureWindow.latest) : t("unknown", "ไม่ทราบ")}</li>
              <li>{t("Time stayed (not unloading time, not billable waiting)", "เวลาที่อยู่ (ไม่ใช่เวลาขนถ่าย และไม่ใช่เวลารอที่คิดเงินได้)")}: {formatDwell(stop.dwellMs.min, stop.dwellMs.max, language)} · {stop.observations} {t("positions", "ตำแหน่ง")} · {stop.sourceQuality === "verified_gps" ? t("verified GPS", "GPS ที่ยืนยัน") : stop.sourceQuality === "mixed" ? t("mixed quality", "คุณภาพผสม") : t("unverified positions", "ตำแหน่งที่ยังไม่ยืนยัน")}</li>
            </ul> : null}
            <p className={styles.note}>{a.reasons.map(r => siteReasonLabel(r, language)).join(" · ")}</p>
            {a.driveBys.length ? <p className={styles.note}>{t("Drive-bys", "ขับผ่าน")}: {a.driveBys.map(d => `${hhmm(d.at)} (${d.speedKph ?? "?"} km/h, ${d.closestM} m)`).join(" · ")}</p> : null}
            {s.candidateSearch ? <div className={styles.candidates}>
              <strong>{t("Stops found near the booked point (candidates, not customer sites)", "จุดที่หยุดใกล้จุดที่จอง (ตัวเลือก ยังไม่ใช่ที่ตั้งลูกค้า)")}</strong>
              <small className={styles.note}>{t(`Search within ${s.candidateSearch.searchRadiusM} m. The matching boundary is not widened.`, `ค้นหาในระยะ ${s.candidateSearch.searchRadiusM} ม. ไม่ขยายขอบเขตการจับคู่`)}{s.candidateSearch.bookedPointOnRoad ? ` · ${t("a vehicle passed the booked point at road speed, so it may be a roadside pin", "มีรถผ่านจุดที่จองด้วยความเร็วบนถนน จุดนี้อาจเป็นหมุดริมถนน")}` : ""}</small>
              {s.candidateSearch.candidates.length === 0 ? <small className={styles.note}>{t("No stop of two or more positions within the search area.", "ไม่มีการหยุดตั้งแต่สองตำแหน่งในพื้นที่ค้นหา")}</small>
                : <ol>{s.candidateSearch.candidates.slice(0, 5).map((c, i) => <li key={i}><span>{c.distanceFromBookedPointM} m · {hhmm(c.cluster.firstAt)}–{hhmm(c.cluster.lastAt)} · {formatDwell(c.cluster.dwellMs.min, c.cluster.dwellMs.max, language)} · {c.cluster.observations} {t("positions", "ตำแหน่ง")}</span> <span className={styles.chip} data-status="estimated">{t("evidence weight", "น้ำหนักหลักฐาน")} {c.weight}/100 · {t("unverified, office review needed", "ยังไม่ตรวจสอบ ต้องให้สำนักงานตรวจ")}</span><small className={styles.note}>{t("Coordinates (not saved)", "พิกัด (ไม่บันทึก)")}: {c.cluster.centroid.latitude.toFixed(5)}, {c.cluster.centroid.longitude.toFixed(5)} · {c.cluster.sourceQuality === "verified_gps" ? t("verified GPS", "GPS ที่ยืนยัน") : c.cluster.sourceQuality === "mixed" ? t("mixed quality", "คุณภาพผสม") : t("unverified positions", "ตำแหน่งที่ยังไม่ยืนยัน")}{c.reasons.includes("could_belong_to_a_neighbouring_site") ? ` · ${t("may belong to a neighbouring site", "อาจเป็นของสถานที่ข้างเคียง")}` : ""}</small></li>)}</ol>}
            </div> : null}
          </details>;
        }) : null}
        {movement ? <p className={styles.note}>{t("Closest approach", "เข้าใกล้ที่สุด")}: {t("pickup", "จุดรับ")} {movement.closestApproachMeters.pickup === null ? "—" : `${movement.closestApproachMeters.pickup} m`} · {t("delivery", "จุดส่ง")} {movement.closestApproachMeters.delivery === null ? "—" : `${movement.closestApproachMeters.delivery} m`}</p> : null}
        <dl className={styles.distance} aria-label={t("Journey distance", "ระยะทางของเที่ยว")}>
          <div><dt>{t("Journey", "เที่ยว")}</dt><dd>{journey ? `${journey.id} · ${formatBangkokTime(journey.start, language) ?? "—"}–${formatBangkokTime(journey.end, language) ?? t("open", "ยังไม่ปิด")}` : t("Not placed", "ยังไม่จับคู่")}</dd></div>
          <div><dt>{t("Provider-reported", "ผู้ให้บริการรายงาน")}</dt><dd>{journey ? `${n(journey.providerKm)} ${km}` : "—"}</dd></div>
          <div><dt>{t("Verified GPS", "GPS ที่ยืนยัน")}</dt><dd>{journey ? (journey.verifiedGpsKm === null ? t("not available", "ไม่มี") : `${n(journey.verifiedGpsKm)} ${km}`) : "—"}</dd></div>
          <div><dt>{t("Position trust", "ความน่าเชื่อถือตำแหน่ง")}</dt><dd>{journey ? positionSourceLabel(journey.positionSource, language) : "—"}</dd></div>
        </dl>
        <small className={styles.note}>{t("Distance is the journey's, shared if several jobs use it. It is a candidate until the office confirms the match.", "ระยะทางเป็นของเที่ยว ใช้ร่วมกันหากมีหลายงาน และเป็นเพียงตัวเลือกจนกว่าสำนักงานจะยืนยัน")}</small>
      </article>;
    })}

    <dl className={styles.distance} aria-label={t("Day distance buckets", "ระยะทางรายวันแยกประเภท")}>
      <div><dt>{t("Provider-reported total", "ยอดรวมที่ผู้ให้บริการรายงาน")}</dt><dd>{dayAllocation.providerKm === null ? "—" : `${n(dayAllocation.providerKm)} ${km}`}</dd></div>
      <div><dt>{t("Confirmed to jobs", "ยืนยันกับงานแล้ว")}</dt><dd>{dayAllocation.confirmedJobKm === null ? t("— (no approved record)", "— (ไม่มีบันทึกที่อนุมัติ)") : `${n(dayAllocation.confirmedJobKm)} ${km}`}</dd></div>
      <div><dt>{t("Candidate, pending review", "ตัวเลือก รอตรวจสอบ")}</dt><dd>{dayAllocation.candidateKm === null ? "—" : `${n(dayAllocation.candidateKm)} ${km}`}</dd></div>
      <div><dt>{t("Unallocated", "ยังไม่จัดสรร")}</dt><dd>{dayAllocation.unallocatedKm === null ? "—" : `${n(dayAllocation.unallocatedKm)} ${km}`}</dd></div>
      <div><dt>{t("Unknown coverage", "ช่วงที่ไม่ทราบ")}</dt><dd>{dayAllocation.missing.intervals} {t("period(s)", "ช่วง")} · {dayAllocation.missing.minutes} {t("min, km unknown", "นาที ไม่ทราบกม.")}</dd></div>
    </dl>
  </section>;
}
