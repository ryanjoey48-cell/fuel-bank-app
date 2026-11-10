"use client";

import { Bell, Check, CheckCheck, CircleAlert, Clock3, Gauge, RadioTower, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ForthFleetTrackingRecord } from "@/lib/forth-tracking-server";
import {
  buildForthFleetAlerts,
  groupForthFleetIncidents,
  getUnreviewedForthFleetAlerts,
  reconcileForthAlertAcknowledgements,
  type ForthFleetAlert,
  type ForthFleetIncident,
  type ForthFleetAlertKind
} from "@/lib/forth-fleet-alerts";
import { formatForthRelativeAge, getForthLocationDescription, type ForthFleetFilter } from "@/lib/forth-tracking-view";
import { evaluateForthSpeedReview } from "@/lib/forth-speed-review";

type Props = {
  records: ForthFleetTrackingRecord[];
  available?: boolean;
  language: "en" | "th";
  onSelect: (recordKey: string) => void;
  onFilter: (filter: ForthFleetFilter) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideLauncher?: boolean;
  onReturnFocus?: () => void;
};

const COPY = {
  en: {
    watch: "Attention", needsReview: "Needs action", advisories: "Advisories", reviewAll: "Mark all reviewed",
    alerts: "Attention", title: "Fleet attention", close: "Close attention", current: "Current conditions", unreviewed: "to review", reviewed: "Reviewed", review: "Needs action", advisory: "Advisory", markReviewed: "Mark reviewed", openVehicle: "Open vehicle", unknownVehicle: "Unidentified vehicle", noAlerts: "No active attention items", noAlertsBody: "Speed review, tracker, coordinates, engine and stale conditions are checked with every refresh. Speed Watch (top-right) ranks current speeds separately.", allReviewed: "All current attention items reviewed", noNew: "Reviewed conditions stay below until they clear.", unavailable: "Attention unavailable", unavailableBody: "Waiting for a successful tracking refresh.",     speed: "Speed review", engineStops: "Engine on · stopped", threshold: "Speed review uses owner-reported Forth device alert settings. A live snapshot above threshold is not a confirmed Forth overspeed event when a delay applies. Road legal limits are unavailable. Speed Watch ranks live speeds separately. EES review is not Forth acknowledgement.", latestOnly: "Current reports only · reviewed for this page session only", missingTime: "Report time unavailable", noLocation: "No place description reported", speedDetail: "GPS verified · device alert", conflictDetail: "Positive speed with engine off; movement is uncertain.", offlineDetail: "The tracker reports no data connection.", staleDetail: "The latest source report is stale.", missingDetail: "No usable reported coordinates.", stoppedDetail: "Engine on at 0 km/h. Stopped duration is unavailable."
  },
  th: {
    watch: "ควรตรวจสอบ", needsReview: "ต้องดำเนินการ", advisories: "ข้อมูลแนะนำ", reviewAll: "ทำเครื่องหมายทั้งหมดว่าตรวจสอบแล้ว",
    alerts: "ควรตรวจสอบ", title: "รายการที่ควรตรวจสอบ", close: "ปิดรายการตรวจสอบ", current: "สถานะปัจจุบัน", unreviewed: "รายการรอตรวจสอบ", reviewed: "ตรวจสอบแล้ว", review: "ต้องดำเนินการ", advisory: "ข้อมูลแนะนำ", markReviewed: "ทำเครื่องหมายว่าตรวจสอบแล้ว", openVehicle: "เปิดรถ", unknownVehicle: "ไม่ระบุทะเบียน", noAlerts: "ไม่มีรายการที่ต้องตรวจสอบ", noAlertsBody: "ตรวจสอบความเร็ว ตัวติดตาม พิกัด เครื่องยนต์ และรายงานเก่าทุกครั้งที่รีเฟรช สรุปความเร็ว (มุมขวาบน) จัดอันดับความเร็วแยกต่างหาก", allReviewed: "ตรวจสอบรายการปัจจุบันทั้งหมดแล้ว", noNew: "รายการที่ตรวจสอบแล้วยังคงอยู่ด้านล่างจนกว่าสถานะจะหายไป", unavailable: "ยังไม่มีรายการตรวจสอบ", unavailableBody: "กำลังรอรีเฟรชการติดตามสำเร็จ",     speed: "ตรวจสอบความเร็ว", engineStops: "จอด · เครื่องยนต์ทำงาน", threshold: "ใช้เกณฑ์แจ้งเตือนอุปกรณ์ Forth ที่เจ้าของรายงาน สแนปช็อตเกินเกณฑ์ไม่ใช่เหตุการณ์ Forth ที่ยืนยันเมื่อมีการหน่วง ไม่มีขีดจำกัดถนน สรุปความเร็วจัดอันดับแยกต่างหาก การตรวจใน EES ไม่ใช่การรับทราบฝั่ง Forth", latestOnly: "รายงานปัจจุบันเท่านั้น · การตรวจสอบใช้เฉพาะเซสชันหน้านี้", missingTime: "ไม่มีเวลารายงาน", noLocation: "ไม่มีคำอธิบายสถานที่", speedDetail: "ยืนยันด้วย GPS · เกณฑ์อุปกรณ์", conflictDetail: "รายงานความเร็วเป็นบวกขณะเครื่องยนต์ดับ ยังยืนยันการเคลื่อนที่ไม่ได้", offlineDetail: "ตัวติดตามรายงานว่าไม่มีการเชื่อมต่อข้อมูล", staleDetail: "รายงานล่าสุดจากต้นทางเก่าแล้ว", missingDetail: "ไม่มีพิกัดที่ใช้งานได้", stoppedDetail: "เครื่องยนต์ทำงานที่ 0 กม./ชม. ไม่มีข้อมูลระยะเวลาจอด"
  }
};

const KIND_LABELS: Record<"en" | "th", Record<ForthFleetAlertKind, string>> = {
  en: {
    speed_review: "Speed review",
    speed_engine_conflict: "Readings conflict",
    offline: "Tracker offline",
    stale: "Stale report",
    missing_coordinates: "Missing coordinates",
    engine_on_stopped: "Engine on while stopped"
  },
  th: {
    speed_review: "ตรวจสอบความเร็ว",
    speed_engine_conflict: "ค่ารายงานขัดแย้ง",
    offline: "ตัวติดตามออฟไลน์",
    stale: "รายงานเก่า",
    missing_coordinates: "ไม่มีพิกัด",
    engine_on_stopped: "จอดขณะเครื่องยนต์ทำงาน"
  }
};

function AlertIcon({ kind }: { kind: ForthFleetAlertKind }) {
  if (kind === "speed_review") return <Gauge aria-hidden="true" />;
  if (kind === "offline") return <RadioTower aria-hidden="true" />;
  if (kind === "stale") return <Clock3 aria-hidden="true" />;
  return <CircleAlert aria-hidden="true" />;
}

function alertDetail(alert: ForthFleetAlert, language: "en" | "th") {
  const copy = COPY[language];
  const record = alert.record;
  if (alert.kind === "speed_review") {
    const review = evaluateForthSpeedReview(record);
    return [
      `${record.speed} km/h`, copy.speedDetail,
      review?.applicableLimitKmh != null ? `${review.applicableLimitKmh}+` : null,
      review?.alertDelaySeconds != null ? `delay ${review.alertDelaySeconds}s` : null,
      review?.isConfirmedDeviceOverspeed ? "confirmed event" : "snapshot exceedance"
    ].filter(Boolean).join(" · ");
  }
  return alert.kind === "speed_engine_conflict" ? copy.conflictDetail
    : alert.kind === "offline" ? copy.offlineDetail
      : alert.kind === "stale" ? copy.staleDetail
        : alert.kind === "missing_coordinates" ? copy.missingDetail : copy.stoppedDetail;
}

function AlertRow({ alert, language, reviewed, onSelect, onAcknowledge }: {
  alert: ForthFleetAlert;
  language: "en" | "th";
  reviewed: boolean;
  onSelect: (key: string) => void;
  onAcknowledge: (id: string) => void;
}) {
  const copy = COPY[language];
  const record = alert.record;
  const detail = alertDetail(alert, language);
  return <article className={`forth-alert-row is-${alert.severity}${reviewed ? " is-reviewed" : ""}`}>
    <div className="forth-alert-row-heading"><span className="forth-alert-icon"><AlertIcon kind={alert.kind} /></span><strong>{KIND_LABELS[language][alert.kind]}</strong><span className="forth-alert-severity">{reviewed ? copy.reviewed : alert.severity === "review" ? copy.review : copy.advisory}</span></div>
    <button type="button" className="forth-alert-vehicle" onClick={() => onSelect(alert.recordKey)} title={copy.openVehicle} aria-label={`${copy.openVehicle}: ${record.vehicleRegistration || copy.unknownVehicle} · ${KIND_LABELS[language][alert.kind]}`}>
      <strong>{record.vehicleRegistration || copy.unknownVehicle}</strong><span className="forth-alert-detail">{detail}</span><span className="forth-alert-location">{getForthLocationDescription(record, language) ?? copy.noLocation}</span>
    </button>
    <div className="forth-alert-row-footer"><span>{formatForthRelativeAge(record.lastGpsTimestamp, Date.now(), language) ?? copy.missingTime}</span>{!reviewed ? <button type="button" aria-label={`${copy.markReviewed}: ${record.vehicleRegistration || copy.unknownVehicle} · ${KIND_LABELS[language][alert.kind]}`} onClick={() => onAcknowledge(alert.id)}><Check aria-hidden="true" />{copy.markReviewed}</button> : <CheckCheck className="forth-alert-reviewed-icon" aria-hidden="true" />}</div>
  </article>;
}

function IncidentRow({ incident, language, reviewed, onSelect, onAcknowledge }: {
  incident: ForthFleetIncident;
  language: "en" | "th";
  reviewed: boolean;
  onSelect: (key: string) => void;
  onAcknowledge: (ids: string[]) => void;
}) {
  const copy = COPY[language];
  const record = incident.alerts[0].record;
  return <article className={`forth-alert-row forth-incident-row is-${incident.severity}${reviewed ? " is-reviewed" : ""}`}>
    <div className="forth-alert-row-heading"><span className="forth-alert-icon"><AlertIcon kind={incident.alerts[0].kind} /></span><strong>{record.vehicleRegistration || copy.unknownVehicle}</strong><span className="forth-alert-severity">{reviewed ? copy.reviewed : copy.review}</span></div>
    <p className="forth-incident-summary">{incident.alerts.length} {language === "th" ? "ข้อสังเกตจากรายงานเดียว" : incident.alerts.length === 1 ? "observation from one report" : "observations from one report"}</p>
    <ul className="forth-incident-observations">{incident.alerts.map((alert) => <li key={alert.id}><strong>{KIND_LABELS[language][alert.kind]}</strong><span>{alertDetail(alert, language)}</span></li>)}</ul>
    <button type="button" className="forth-incident-open" onClick={() => onSelect(incident.recordKey)}>{copy.openVehicle} · {getForthLocationDescription(record, language) ?? copy.noLocation}</button>
    <div className="forth-alert-row-footer"><span>{formatForthRelativeAge(record.lastGpsTimestamp, Date.now(), language) ?? copy.missingTime}</span>{!reviewed ? <button type="button" onClick={() => onAcknowledge(incident.alerts.map(({ id }) => id))}><Check aria-hidden="true" />{copy.markReviewed}</button> : <CheckCheck className="forth-alert-reviewed-icon" aria-hidden="true" />}</div>
  </article>;
}

/** Current review items and lower-priority advisories have separate reading order. */
export function ForthFleetAlertQueue({ unreviewed, reviewed, language, onSelect, onAcknowledge, onReviewAll }: {
  unreviewed: ForthFleetAlert[];
  reviewed: ForthFleetAlert[];
  language: "en" | "th";
  onSelect: (key: string) => void;
  onAcknowledge: (ids: string[]) => void;
  onReviewAll: () => void;
}) {
  const copy = COPY[language];
  const reviewItems = groupForthFleetIncidents(unreviewed.filter(({ severity }) => severity === "review"));
  const advisories = unreviewed.filter(({ severity }) => severity === "advisory");
  const reviewedIncidents = groupForthFleetIncidents(reviewed.filter(({ severity }) => severity === "review"));
  return <div className="forth-alert-list">
    {unreviewed.length ? <div className="forth-alert-summary"><p><strong>{reviewItems.length}</strong> {copy.needsReview}<span> · {advisories.length} {copy.advisories}</span></p>{reviewItems.length + advisories.length > 1 ? <button type="button" className="forth-alert-review-all" onClick={onReviewAll}><CheckCheck aria-hidden="true" />{copy.reviewAll}</button> : null}</div> : <div className="forth-alert-empty"><CheckCheck aria-hidden="true" /><strong>{reviewed.length ? copy.allReviewed : copy.noAlerts}</strong><p>{reviewed.length ? copy.noNew : copy.noAlertsBody}</p></div>}
    {reviewItems.length ? <section className="forth-alert-group" aria-label={copy.needsReview}><h3 className="forth-alert-list-heading">{copy.needsReview} <strong>{reviewItems.length}</strong></h3>{reviewItems.map((incident) => <IncidentRow key={incident.id} incident={incident} language={language} reviewed={false} onSelect={onSelect} onAcknowledge={onAcknowledge} />)}</section> : null}
    {advisories.length ? <details className="forth-alert-advisories" open={reviewItems.length === 0}><summary>{copy.advisories}<strong>{advisories.length}</strong></summary>{advisories.map((alert) => <AlertRow key={alert.id} alert={alert} language={language} reviewed={false} onSelect={onSelect} onAcknowledge={(id) => onAcknowledge([id])} />)}</details> : null}
    {reviewed.length ? <details className="forth-alert-reviewed"><summary>{copy.reviewed} · {reviewedIncidents.length + reviewed.filter(({ severity }) => severity === "advisory").length}</summary>{reviewedIncidents.map((incident) => <IncidentRow key={incident.id} incident={incident} language={language} reviewed onSelect={onSelect} onAcknowledge={onAcknowledge} />)}{reviewed.filter(({ severity }) => severity === "advisory").map((alert) => <AlertRow key={alert.id} alert={alert} language={language} reviewed onSelect={onSelect} onAcknowledge={(id) => onAcknowledge([id])} />)}</details> : null}
  </div>;
}

/** In-page notifications only. Acknowledgements are kept in memory and discarded when this page closes. */
export function ForthFleetAlerts({ records, available = true, language, onSelect, onFilter, open: controlledOpen, onOpenChange, hideLauncher = false, onReturnFocus }: Props) {
  const copy = COPY[language];
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = useCallback((next: boolean) => {
    if (controlledOpen === undefined) setInternalOpen(next);
    onOpenChange?.(next);
  }, [controlledOpen, onOpenChange]);
  const [acknowledgedIds, setAcknowledgedIds] = useState<Set<string>>(() => new Set());
  const rootRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocus = useCallback(() => { if (hideLauncher) onReturnFocus?.(); else triggerRef.current?.focus(); }, [hideLauncher, onReturnFocus]);
  const activeAlerts = useMemo(() => buildForthFleetAlerts(records), [records]);
  const unreviewed = getUnreviewedForthFleetAlerts(activeAlerts, acknowledgedIds);
  const reviewCount = groupForthFleetIncidents(unreviewed.filter(({ severity }) => severity === "review")).length;
  const advisoryCount = unreviewed.filter(({ severity }) => severity === "advisory").length;
  const hasReviews = available && reviewCount > 0;
  const hasAdvisoriesOnly = available && reviewCount === 0 && advisoryCount > 0;
  const reviewed = activeAlerts.filter(({ id }) => acknowledgedIds.has(id));
  const speedCount = activeAlerts.filter(({ kind }) => kind === "speed_review").length;
  const engineStops = activeAlerts.filter(({ kind }) => kind === "engine_on_stopped").length;

  useEffect(() => {
    if (!available) return;
    setAcknowledgedIds((current) => {
      const next = reconcileForthAlertAcknowledgements(current, activeAlerts);
      return next.size === current.size ? current : next;
    });
  }, [activeAlerts, available]);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLButtonElement>(".forth-alert-panel-header button")?.focus();
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target) && !panelRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); restoreFocus(); }
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => { document.removeEventListener("pointerdown", closeOutside); document.removeEventListener("keydown", closeOnEscape); };
  }, [open, setOpen, restoreFocus]);

  const selectVehicle = (key: string) => { setOpen(false); onSelect(key); };
  const selectFilter = (filter: ForthFleetFilter) => { setOpen(false); onFilter(filter); };
  const acknowledge = (ids: string[]) => setAcknowledgedIds((current) => new Set([...current, ...ids]));
  const reviewAll = () => setAcknowledgedIds((current) => new Set([...current, ...unreviewed.map(({ id }) => id)]));

  const panel = open ? <section ref={panelRef} id="forth-operations-alerts" className="forth-alert-panel" role="dialog" aria-label={copy.title}>
      <header className="forth-alert-panel-header"><div><span className="forth-alert-eyebrow">{copy.current}</span><h2>{copy.title}</h2></div><button type="button" aria-label={copy.close} onClick={() => { setOpen(false); restoreFocus(); }}><X aria-hidden="true" /></button></header>
      {!available ? <div className="forth-alert-empty"><RadioTower aria-hidden="true" /><strong>{copy.unavailable}</strong><p>{copy.unavailableBody}</p></div> : <>
        <div className="forth-alert-widgets"><button type="button" onClick={() => selectFilter("high_speed")}><Gauge aria-hidden="true" /><strong>{speedCount}</strong><span>{copy.speed}</span></button><button type="button" onClick={() => selectFilter("engine_on_stopped")}><CircleAlert aria-hidden="true" /><strong>{engineStops}</strong><span>{copy.engineStops}</span></button></div>
        <p className="forth-alert-threshold">{copy.threshold}</p>
        <ForthFleetAlertQueue unreviewed={unreviewed} reviewed={reviewed} language={language} onSelect={selectVehicle} onAcknowledge={acknowledge} onReviewAll={reviewAll} />
        <footer className="forth-alert-panel-footer">{copy.latestOnly}</footer>
      </>}
    </section> : null;
  const dock = typeof document === "undefined" ? null : document.getElementById("forth-attention-dock");

  return <div className="forth-alerts" ref={rootRef}>
    {!hideLauncher ? <button ref={triggerRef} type="button" className={`forth-alert-launcher forth-command-button${hasReviews ? " has-alerts" : ""}${hasAdvisoriesOnly ? " has-advisories" : ""}`} aria-label={available ? `${copy.alerts}: ${reviewCount} ${copy.needsReview}, ${advisoryCount} ${copy.advisories}` : copy.unavailable} aria-expanded={open} aria-controls="forth-operations-alerts" onClick={() => setOpen(!open)}>
      <Bell aria-hidden="true" /><span>{copy.alerts}</span><strong className="forth-alert-count">{available ? reviewCount : "—"}</strong>
    </button> : null}
    <span className="sr-only" role="status" aria-live="polite">{available ? `${copy.alerts}: ${reviewCount} ${copy.needsReview}, ${advisoryCount} ${copy.advisories}` : copy.unavailable}</span>
    {dock ? createPortal(panel, dock) : panel}
  </div>;
}
