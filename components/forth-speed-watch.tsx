"use client";

import { ChevronDown, Crosshair, Gauge, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ForthFleetTrackingRecord } from "@/lib/forth-tracking-server";
import {
  formatForthRelativeAge,
  getForthLocationArea,
  getForthTrackingVehicleIdentity
} from "@/lib/forth-tracking-view";
import { forthSpeedEvidenceLabel, forthSpeedReviewConfidenceLabel } from "@/lib/forth-speed-review";
import {
  FORTH_SPEED_WATCH_DEFAULT_LIMIT,
  countForthSpeedWatchOverThreshold,
  getForthSpeedWatchEntries,
  type ForthSpeedWatchFilter
} from "@/lib/forth-speed-watch";

type Props = {
  records: ForthFleetTrackingRecord[];
  available: boolean;
  language: "en" | "th";
  onSelect: (key: string) => void;
  onFocusMap?: (key: string) => void;
  forceOpen?: boolean;
  onClose?: () => void;
  confirmedDriverFor?: (record: ForthFleetTrackingRecord) => string | null;
};

const COPY = {
  en: {
    title: "Speed watch",
    subtitle: "Live vs Forth device alerts",
    empty: "No current moving reports",
    emptyOver: "No vehicles currently above their Forth device alert",
    waiting: "Waiting for tracking data",
    open: "Open vehicle",
    focus: "Focus map",
    showAll: "Show all moving",
    showTop: "Show top 5",
    reviewNote: "Compares Forth reported speed to owner-reported device alert settings. Delay does not prove a recorded Forth event. Road legal limits are not assessed.",
    gpsVerified: "GPS verified",
    approximate: "GPS not verified",
    unknown: "Unidentified",
    close: "Close Speed watch",
    topLabel: "Fastest now",
    overLabel: "Over device alert",
    threshold: "Device alert",
    delay: "Delay",
    delta: "vs alert",
    filterAll: "All moving",
    filterOver: "Over threshold",
    filterConfigured: "Configured",
    filterUnknown: "Unknown settings",
    noDriver: "Driver not confirmed",
    ownerReported: "Owner-reported setting",
    seconds: "s"
  },
  th: {
    title: "สรุปความเร็ว",
    subtitle: "เทียบเกณฑ์แจ้งเตือนอุปกรณ์ Forth",
    empty: "ไม่มีรถที่กำลังเคลื่อนที่ในรายงานปัจจุบัน",
    emptyOver: "ไม่มีรถที่เกินเกณฑ์แจ้งเตือนอุปกรณ์ Forth ตอนนี้",
    waiting: "กำลังรอข้อมูลติดตาม",
    open: "เปิดรถ",
    focus: "โฟกัสแผนที่",
    showAll: "แสดงทั้งหมดที่เคลื่อนที่",
    showTop: "แสดง 5 อันดับแรก",
    reviewNote: "เปรียบเทียบความเร็วจาก Forth กับการตั้งค่าแจ้งเตือนอุปกรณ์ที่เจ้าของรายงาน หน่วงเวลาไม่ได้พิสูจน์เหตุการณ์ที่บันทึก ไม่ประเมินขีดจำกัดถนน",
    gpsVerified: "GPS ยืนยัน",
    approximate: "ยังไม่ยืนยัน GPS",
    unknown: "ไม่ระบุทะเบียน",
    close: "ปิดสรุปความเร็ว",
    topLabel: "เร็วสุดตอนนี้",
    overLabel: "เกินเกณฑ์อุปกรณ์",
    threshold: "เกณฑ์อุปกรณ์",
    delay: "หน่วง",
    delta: "เทียบเกณฑ์",
    filterAll: "ทั้งหมดที่เคลื่อนที่",
    filterOver: "เกินเกณฑ์",
    filterConfigured: "มีการตั้งค่า",
    filterUnknown: "ไม่ทราบการตั้งค่า",
    noDriver: "ยังไม่ยืนยันผู้ขับ",
    ownerReported: "ตั้งค่าที่เจ้าของรายงาน",
    seconds: "วินาที"
  }
};

export function ForthSpeedWatch({
  records,
  available,
  language,
  onSelect,
  onFocusMap,
  forceOpen = false,
  onClose,
  confirmedDriverFor
}: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (forceOpen) closeRef.current?.focus(); }, [forceOpen]);
  const [expanded, setExpanded] = useState(forceOpen);
  const [showAll, setShowAll] = useState(false);
  const [filter, setFilter] = useState<ForthSpeedWatchFilter>("all_moving");
  const copy = COPY[language];
  const th = language === "th";
  const allEntries = useMemo(
    () => (available ? getForthSpeedWatchEntries(records, null, filter) : []),
    [available, filter, records]
  );
  const entries = useMemo(
    () => (showAll ? allEntries : allEntries.slice(0, FORTH_SPEED_WATCH_DEFAULT_LIMIT)),
    [allEntries, showAll]
  );
  const open = forceOpen || expanded;
  const topSpeed = useMemo(() => {
    const moving = available ? getForthSpeedWatchEntries(records, 1, "all_moving") : [];
    return moving[0]?.record.speed ?? null;
  }, [available, records]);
  const overCount = useMemo(
    () => (available ? countForthSpeedWatchOverThreshold(records) : 0),
    [available, records]
  );

  const openVehicle = (key: string) => {
    if (!forceOpen) setExpanded(false);
    onSelect(key);
  };

  const filters: Array<{ id: ForthSpeedWatchFilter; label: string }> = [
    { id: "all_moving", label: copy.filterAll },
    { id: "over_threshold", label: copy.filterOver },
    { id: "configured", label: copy.filterConfigured },
    { id: "unknown_settings", label: copy.filterUnknown }
  ];
  const headingContent = <>
    <span className="forth-speed-watch-icon"><Gauge aria-hidden="true" /></span>
    <span className="forth-speed-watch-title">
      <strong>{copy.title}</strong>
      <small>{available && topSpeed !== null ? `${copy.topLabel} ${topSpeed} km/h${overCount ? ` · ${overCount} ${copy.overLabel}` : ""}` : copy.subtitle}</small>
    </span>
    <span className="forth-speed-watch-count">{available ? allEntries.length : "—"}</span>
  </>;

  return (
    <section className={`forth-speed-watch${forceOpen ? " is-panel" : ""}`} aria-label={copy.title}>
      <div className="forth-speed-watch-heading">
        {forceOpen ? <div className="forth-speed-watch-toggle is-static">{headingContent}</div> : (
          <button type="button" className="forth-speed-watch-toggle" aria-expanded={open} onClick={() => setExpanded((value) => !value)}>
            {headingContent}<ChevronDown className="forth-speed-watch-chevron" aria-hidden="true" />
          </button>
        )}
        {forceOpen && onClose ? <button type="button" ref={closeRef} className="forth-speed-watch-close" aria-label={copy.close} onClick={onClose}><X aria-hidden="true" /></button> : null}
      </div>
      {open ? (
        <div className="forth-speed-watch-body">
          {!available ? (
            <p className="forth-speed-watch-empty">{copy.waiting}</p>
          ) : (
            <>
              <div className="forth-speed-watch-filters" role="toolbar" aria-label={copy.title}>
                {filters.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={filter === item.id ? "is-active" : undefined}
                    aria-pressed={filter === item.id}
                    onClick={() => setFilter(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              {entries.length ? (
                <>
                  {entries.map(({ key, record, gpsVerified, config, review }) => {
                    const identity = getForthTrackingVehicleIdentity(record.vehicleRegistration);
                    const profile = [identity.make, identity.model].filter(Boolean).join(" · ");
                    const confirmed = confirmedDriverFor?.(record) ?? null;
                    const forthDriver = record.reportedDriver && record.reportedDriver !== confirmed ? record.reportedDriver : null;
                    const driverLine = confirmed
                      ?? (forthDriver ? `${th ? "Forth (ยังไม่ยืนยัน)" : "Forth unverified"}: ${forthDriver}` : copy.noDriver);
                    const age = formatForthRelativeAge(record.lastGpsTimestamp, Date.now(), language);
                    const area = getForthLocationArea(record, language);
                    const hasCoords = record.coordinateStatus === "valid";
                    const threshold = config?.speedAlertKmh ?? review?.applicableLimitKmh ?? null;
                    const delta = threshold !== null && record.speed !== null
                      ? Math.round((record.speed - threshold) * 10) / 10
                      : null;
                    const exceedance = Boolean(review?.isThresholdExceedance);
                    return (
                      <div
                        key={key}
                        className={`forth-speed-watch-row${exceedance ? " is-review" : ""}${!gpsVerified ? " is-approximate" : ""}`}
                      >
                        <button
                          type="button"
                          className="forth-speed-watch-select"
                          onClick={() => openVehicle(key)}
                          title={copy.open}
                          aria-label={`${copy.open}: ${record.vehicleRegistration || copy.unknown} · ${record.speed} km/h`}
                        >
                          <span className="forth-speed-watch-primary">
                            <strong title={profile || undefined}>{record.vehicleRegistration || copy.unknown}</strong>
                            <span className="forth-speed-watch-speed"><strong>{record.speed}</strong><small>km/h</small></span>
                          </span>
                          <span className="forth-speed-watch-driver">{driverLine}</span>
                          <span className="forth-speed-watch-meta">{[area, age].filter(Boolean).join(" · ") || copy.unknown}</span>
                          <span className="forth-speed-watch-device" title={config ? forthSpeedReviewConfidenceLabel(review?.confidence ?? "owner_device_config", language) : undefined}>
                            <span>{threshold !== null ? `${copy.threshold} ${threshold} km/h · ${copy.delay} ${config?.alertDelaySeconds ?? review?.alertDelaySeconds ?? 0}${copy.seconds}` : copy.filterUnknown}</span>
                            {exceedance && delta !== null ? <strong>{copy.delta} +{delta} km/h</strong> : null}
                          </span>
                          <span className="forth-speed-watch-trust">
                            <span className={gpsVerified ? "is-verified" : "is-approximate"}>{gpsVerified ? copy.gpsVerified : copy.approximate}</span>
                            {exceedance && review ? <span className="is-exceedance">{forthSpeedEvidenceLabel(review.evidenceKind, language)}</span> : null}
                          </span>
                        </button>
                        {onFocusMap && hasCoords ? (
                          <button
                            type="button"
                            className="forth-speed-watch-focus"
                            title={copy.focus}
                            aria-label={`${copy.focus}: ${record.vehicleRegistration || copy.unknown}`}
                            onClick={() => {
                              if (!forceOpen) setExpanded(false);
                              onFocusMap(key);
                            }}
                          >
                            <Crosshair aria-hidden="true" />
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
                  {allEntries.length > FORTH_SPEED_WATCH_DEFAULT_LIMIT ? (
                    <button type="button" className="forth-speed-watch-more" onClick={() => setShowAll((value) => !value)}>
                      {showAll ? copy.showTop : `${copy.showAll} (${allEntries.length})`}
                    </button>
                  ) : null}
                  <p className="forth-speed-watch-note">{copy.reviewNote}</p>
                </>
              ) : (
                <p className="forth-speed-watch-empty">{filter === "over_threshold" ? copy.emptyOver : copy.empty}</p>
              )}
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}

export function ForthSpeedWatchLauncher({
  records,
  available,
  language,
  pressed,
  onClick
}: {
  records: ForthFleetTrackingRecord[];
  available: boolean;
  language: "en" | "th";
  pressed: boolean;
  onClick: () => void;
}) {
  const copy = COPY[language];
  const entries = useMemo(
    () => (available ? getForthSpeedWatchEntries(records, null) : []),
    [available, records]
  );
  const top = entries[0]?.record.speed ?? null;
  const overCount = useMemo(
    () => (available ? countForthSpeedWatchOverThreshold(records) : 0),
    [available, records]
  );
  return (
    <button
      type="button"
      className={`forth-speed-watch-launcher forth-command-button${overCount ? " has-review" : ""}`}
      aria-pressed={pressed}
      aria-label={`${copy.title}${top !== null ? `: ${top} km/h` : ""}${overCount ? ` · ${overCount} ${copy.overLabel}` : ""}`}
      onClick={onClick}
    >
      <Gauge aria-hidden="true" />
      <span className="forth-speed-watch-launcher-label">{copy.title}</span>
      <strong className="forth-speed-watch-launcher-badge" aria-label={`${entries.length} ${copy.filterAll}`}>{available ? entries.length : "—"}</strong>
    </button>
  );
}
