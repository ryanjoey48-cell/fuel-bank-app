"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import {
  FORTH_PLAYBACK_SPEEDS,
  describeHistoryUnavailable,
  describePlaybackHttpError,
  type ForthPlaybackSpeed
} from "@/lib/forth-journey-playback";
import {
  findHistoricalHitsNearCustomer,
  summarizeHistoricalVisitCandidates
} from "@/lib/forth-history-playback-analysis";
import {
  formatJourneyDuration,
  summarizeJourneyIntelligence
} from "@/lib/forth-journey-intelligence";
import {
  createInactivePlaybackOverlay,
  nextPlaybackSession,
  shouldDiscardPlaybackResponse,
  type ForthPlaybackOverlayState
} from "@/lib/forth-playback-mode";
import type { ForthGpsMapLocation } from "@/lib/forth-gps-map-locations";
import type { ForthFleetTrackingRecord } from "@/lib/forth-tracking-server";
import { getForthFleetRecordKey, getForthTrackingVehicleIdentity } from "@/lib/forth-tracking-view";
import { forthVehicleIconLabel } from "@/lib/forth-vehicle-icons";
import { supabase } from "@/lib/supabase";
import { originHeaders } from "@/lib/fleet-request-origin";

export type PlaybackPoint = {
  index: number;
  sourceTimestamp: string | null;
  timestampIso: string | null;
  latitude: number | null;
  longitude: number | null;
  verifiedGps: boolean;
  trailEligible?: boolean;
  speedKph: number | null;
  engineOn: boolean | null;
  positionQuality: string;
  gapBeforeMs: number | null;
  isGapEdge: boolean;
};

export type PlaybackPayload = {
  status: "ready";
  deviceId: string;
  vehicleRegistration: string | null;
  date: string;
  points: PlaybackPoint[];
  segments: Array<{ fromIndex: number; toIndex: number }>;
  reportedTrailSegments?: Array<{ fromIndex: number; toIndex: number }>;
  observationCount: number;
  verifiedCount: number;
  trailEligibleCount?: number;
  segmentCount: number;
  reportedTrailSegmentCount?: number;
  gapCount: number;
  empty?: boolean;
  message?: string;
  distanceClaim: null;
};

export type ForthJourneyPlaybackPanelHandle = {
  clearPlayback: () => void;
  isBusy: () => boolean;
};

type Props = {
  language: "en" | "th";
  records: ForthFleetTrackingRecord[];
  selectedKey: string | null;
  onSelectVehicle: (key: string) => void;
  forthGpsLocations: ForthGpsMapLocation[];
  selectedLocationId: string | null;
  externalCursorIndex?: number | null;
  onExternalCursorConsumed?: () => void;
  onPlaybackChange: (state: ForthPlaybackOverlayState) => void;
  onExitToLive: () => void;
  /** V7.8: a movement chosen in Daily Activity. It only fills the date and time fields; the supervised read still needs the usual button press. */
  presetRange?: { nonce: number; day: string; start: string; end: string } | null;
};

function playbackTimeLabel(point: { timestampIso?: string | null; sourceTimestamp?: string | null } | undefined, language: "en" | "th") {
  const source = point?.timestampIso;
  if (!source || !Number.isFinite(Date.parse(source))) return point?.sourceTimestamp ?? "—";
  return new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-GB", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(source));
}

function todayBangkokYmd() {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Bangkok",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function toOverlay(
  payload: PlaybackPayload | null,
  cursor: number,
  registrationFallback: string | null
): ForthPlaybackOverlayState {
  if (!payload) return createInactivePlaybackOverlay();
  return {
    active: true,
    points: payload.points,
    segments: payload.segments,
    reportedTrailSegments: payload.reportedTrailSegments ?? [],
    cursorIndex: cursor,
    registration: payload.vehicleRegistration ?? registrationFallback
  };
}

export const ForthJourneyPlaybackPanel = forwardRef<ForthJourneyPlaybackPanelHandle, Props>(
  function ForthJourneyPlaybackPanel(
    {
      language,
      records,
      selectedKey,
      onSelectVehicle,
      forthGpsLocations,
      selectedLocationId,
      externalCursorIndex = null,
      onExternalCursorConsumed,
      onPlaybackChange,
      onExitToLive,
      presetRange = null
    },
    ref
  ) {
    const [dateYmd, setDateYmd] = useState(() => (presetRange?.day && /^\d{4}-\d{2}-\d{2}$/.test(presetRange.day) ? presetRange.day : todayBangkokYmd()));
    const [startHm, setStartHm] = useState(() => (presetRange?.start && /^\d{2}:\d{2}$/.test(presetRange.start) ? presetRange.start : "00:00"));
    const [endHm, setEndHm] = useState(() => (presetRange?.end && /^\d{2}:\d{2}$/.test(presetRange.end) ? presetRange.end : "23:59"));
    const presetNonce = presetRange?.nonce ?? 0;
    useEffect(() => {
      if (!presetRange || presetNonce === 0) return;
      if (/^\d{4}-\d{2}-\d{2}$/.test(presetRange.day) && /^\d{2}:\d{2}$/.test(presetRange.start) && /^\d{2}:\d{2}$/.test(presetRange.end)) { setDateYmd(presetRange.day); setStartHm(presetRange.start); setEndHm(presetRange.end); }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [presetNonce]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [unavailableDetail, setUnavailableDetail] = useState<string | null>(null);
    const [payload, setPayload] = useState<PlaybackPayload | null>(null);
    const [cursor, setCursor] = useState(0);
    const [playing, setPlaying] = useState(false);
    const [speed, setSpeed] = useState<ForthPlaybackSpeed>(1);
    const [vehicleQuery, setVehicleQuery] = useState("");
    const loadAbortRef = useRef<AbortController | null>(null);
    const sessionRef = useRef(0);
    const onPlaybackChangeRef = useRef(onPlaybackChange);
    onPlaybackChangeRef.current = onPlaybackChange;

    const clearPlayback = useCallback(() => {
      sessionRef.current = nextPlaybackSession(sessionRef.current);
      loadAbortRef.current?.abort();
      loadAbortRef.current = null;
      setPlaying(false);
      setLoading(false);
      setPayload(null);
      setCursor(0);
      setError(null);
      setUnavailableDetail(null);
      onPlaybackChangeRef.current(createInactivePlaybackOverlay());
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        clearPlayback,
        isBusy: () => loading || Boolean(loadAbortRef.current)
      }),
      [clearPlayback, loading]
    );

    useEffect(() => {
      return () => {
        sessionRef.current = nextPlaybackSession(sessionRef.current);
        loadAbortRef.current?.abort();
      };
    }, []);

    const selected = useMemo(() => {
      if (!selectedKey) return null;
      return records.find((record, index) => getForthFleetRecordKey(record, index) === selectedKey) ?? null;
    }, [records, selectedKey]);

    const vehicleOptions = useMemo(() => {
      const query = vehicleQuery.trim().toLocaleLowerCase();
      return records
        .map((record, index) => {
          const key = getForthFleetRecordKey(record, index);
          const identity = getForthTrackingVehicleIdentity(record.vehicleRegistration);
          return {
            key,
            deviceId: record.gpsDeviceId,
            registration: record.vehicleRegistration ?? "—",
            label: `${record.vehicleRegistration ?? "—"} · ${forthVehicleIconLabel(identity.vehicleClass, language)}`
          };
        })
        .filter((row) => !query || row.label.toLocaleLowerCase().includes(query) || row.deviceId?.includes(query));
    }, [language, records, vehicleQuery]);

    const currentPoint = payload?.points[cursor] ?? null;

  const visitCandidates = useMemo(() => {
    if (!payload?.points.length) return [];
    const asLog = payload.points.map((point) => ({
      sourceTimestamp: point.sourceTimestamp,
      timestampIso: point.timestampIso,
      latitude: point.latitude,
      longitude: point.longitude,
      coordinateStatus: point.latitude != null && point.longitude != null ? ("valid" as const) : ("missing" as const),
      gpsStatus: point.verifiedGps ? ("connected" as const) : ("unknown" as const),
      positionSource: null,
      positionQuality: (point.positionQuality as "gps" | "no_gps" | "wifi" | "lbs" | "other" | "unknown") || "unknown",
      verifiedGps: point.verifiedGps,
      trailEligible: point.trailEligible ?? point.verifiedGps,
      speedKph: point.speedKph,
      engineOn: point.engineOn,
      sourceDistanceRaw: null
    }));
    return summarizeHistoricalVisitCandidates(asLog, forthGpsLocations, { minObservations: 2 }).slice(0, 8);
  }, [forthGpsLocations, payload]);

  const journeySummary = useMemo(() => {
    if (!payload?.points.length) return null;
    return summarizeJourneyIntelligence(payload.points, {
      proximityVisits: visitCandidates.map((visit) => {
        const location = forthGpsLocations.find((row) => row.id === visit.locationId);
        const depotHint = `${visit.name} ${location?.groupLayer ?? ""} ${location?.locationType ?? ""}`;
        return {
          locationId: visit.locationId,
          forthLocationId: visit.forthLocationId,
          name: visit.name,
          observationCount: visit.observationCount,
          atLocationCount: visit.atLocationCount,
          approachingCount: visit.approachingCount,
          firstTimestampIso: visit.firstTimestampIso,
          lastTimestampIso: visit.lastTimestampIso,
          durationMs: visit.durationMs,
          nearestDistanceMeters: visit.nearestDistanceMeters,
          // Label only — still proximity review, never a confirmed arrival.
          isDepot: /depot|office|ลานจอด|สำนักงาน|ees/i.test(depotHint)
        };
      })
    });
  }, [forthGpsLocations, payload, visitCandidates]);

  const seekToObservation = useCallback((index: number) => {
    if (!payload?.points.length) return;
    if (index < 0 || index >= payload.points.length) return;
    setPlaying(false);
    setCursor(index);
  }, [payload]);

    const selectedLocationHits = useMemo(() => {
      if (!payload || !selectedLocationId) return [];
      const location = forthGpsLocations.find((row) => row.id === selectedLocationId);
      if (!location) return [];
      const asLog = payload.points.map((point) => ({
        sourceTimestamp: point.sourceTimestamp,
        timestampIso: point.timestampIso,
        latitude: point.latitude,
        longitude: point.longitude,
        coordinateStatus: point.latitude != null && point.longitude != null ? ("valid" as const) : ("missing" as const),
        gpsStatus: point.verifiedGps || point.trailEligible ? ("connected" as const) : ("unknown" as const),
        positionSource: null,
        positionQuality: (point.positionQuality as "gps" | "no_gps" | "unknown") || "unknown",
        verifiedGps: point.verifiedGps,
        trailEligible: point.trailEligible ?? point.verifiedGps,
        speedKph: point.speedKph,
        engineOn: point.engineOn,
        sourceDistanceRaw: null
      }));
      return findHistoricalHitsNearCustomer(asLog, location);
    }, [forthGpsLocations, payload, selectedLocationId]);

    useEffect(() => {
      if (externalCursorIndex == null || !payload?.points.length) return;
      if (externalCursorIndex < 0 || externalCursorIndex >= payload.points.length) return;
      setPlaying(false);
      setCursor(externalCursorIndex);
      onExternalCursorConsumed?.();
    }, [externalCursorIndex, onExternalCursorConsumed, payload]);

    // Keep parent overlay in sync. Use a ref so parent inline handlers cannot retrigger this effect.
    useEffect(() => {
      onPlaybackChangeRef.current(toOverlay(payload, cursor, selected?.vehicleRegistration ?? null));
    }, [cursor, payload, selected?.vehicleRegistration]);

    useEffect(() => {
      if (!playing || !payload?.points.length) return;
      const intervalMs = Math.max(80, 700 / speed);
      const timer = window.setInterval(() => {
        setCursor((value) => {
          if (value >= payload.points.length - 1) {
            setPlaying(false);
            return value;
          }
          return value + 1;
        });
      }, intervalMs);
      return () => window.clearInterval(timer);
    }, [payload, playing, speed]);

    // Changing vehicle while a history trail is loaded must not keep the previous truck's path.
    useEffect(() => {
      if (!payload || !selected?.gpsDeviceId) return;
      if (payload.deviceId && payload.deviceId !== selected.gpsDeviceId.trim()) {
        clearPlayback();
      }
    }, [clearPlayback, payload, selected?.gpsDeviceId]);

    const loadHistory = useCallback(async () => {
      const deviceId = selected?.gpsDeviceId?.trim();
      if (!deviceId) {
        setError(language === "th" ? "เลือกรถก่อนโหลดประวัติ" : "Select a vehicle before loading history.");
        return;
      }
      const session = nextPlaybackSession(sessionRef.current);
      sessionRef.current = session;
      loadAbortRef.current?.abort();
      const abort = new AbortController();
      loadAbortRef.current = abort;
      setLoading(true);
      setError(null);
      setUnavailableDetail(null);
      setPayload(null);
      setPlaying(false);
      setCursor(0);
      onPlaybackChangeRef.current(createInactivePlaybackOverlay());
      try {
        const { data: authData } = await supabase.auth.getSession();
        const accessToken = authData.session?.access_token;
        if (!accessToken) {
          if (shouldDiscardPlaybackResponse(session, sessionRef.current)) return;
          setError(language === "th" ? "ต้องเข้าสู่ระบบก่อนโหลดประวัติ" : "Sign in is required before loading history.");
          setLoading(false);
          return;
        }
        const response = await fetch("/api/admin/forth-tracking/history/playback", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: `Bearer ${accessToken}`,
            ...originHeaders("journey_playback_load")
          },
          cache: "no-store",
          signal: abort.signal,
          body: JSON.stringify({
            deviceId,
            date: dateYmd,
            startTime: startHm,
            endTime: endHm,
            language
          })
        });
        if (abort.signal.aborted || shouldDiscardPlaybackResponse(session, sessionRef.current)) return;
        const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
        if (abort.signal.aborted || shouldDiscardPlaybackResponse(session, sessionRef.current)) return;
        if (response.status === 401) {
          setError(language === "th" ? "เซสชันหมดอายุ — เข้าสู่ระบบอีกครั้ง" : "Session expired — sign in again.");
          return;
        }
        if (!response.ok || !body || body.status !== "ready") {
          const message =
            (!response.ok && describePlaybackHttpError(response.status, language)) ||
            (typeof body?.message === "string" && body.message) ||
            (typeof body?.error === "string" && body.error) ||
            describeHistoryUnavailable(language);
          setError(message);
          setUnavailableDetail(typeof body?.detail === "string" ? body.detail : null);
          return;
        }
        const ready = body as unknown as PlaybackPayload;
        setPayload(ready);
        if (ready.empty || ready.observationCount === 0) {
          setUnavailableDetail(
            ready.message ||
              (language === "th"
                ? "ช่วงเวลานี้ไม่มีบันทึก GPS — ไม่สร้างเส้นทางสมมติ"
                : "No GPS observations for this window — no invented route.")
          );
        }
        const firstVerified = ready.points.findIndex((point) => point.verifiedGps);
        setCursor(firstVerified >= 0 ? firstVerified : 0);
      } catch (error) {
        if (abort.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
        if (shouldDiscardPlaybackResponse(session, sessionRef.current)) return;
        setError(describeHistoryUnavailable(language));
      } finally {
        if (loadAbortRef.current === abort) {
          setLoading(false);
          loadAbortRef.current = null;
        }
      }
    }, [dateYmd, endHm, language, selected, startHm]);

    const exitLabel = language === "th" ? "Back to Live Fleet" : "Back to Live Fleet";
    const exitLabelTh = language === "th" ? "กลับกองรถสด" : "Back to Live Fleet";

    return (
      <div className="forth-playback-panel" data-playback-active={payload ? "true" : "false"}>
        <header className="forth-playback-header">
          <div className="forth-playback-header-row">
            <div>
              <h3>{language === "th" ? "เล่นย้อนเส้นทาง" : "Journey Playback"}</h3>
              <p>
                {language === "th"
                  ? "โหมดประวัติแยกจากตำแหน่งสด — ไม่สร้างเส้นทางสมมติเมื่อไม่มีข้อมูล Forth"
                  : "Recorded Forth history · Bangkok time (UTC+7)"}
              </p>
            </div>
            <button type="button" className="forth-playback-exit" onClick={onExitToLive}>
              {language === "th" ? exitLabelTh : exitLabel}
            </button>
          </div>
        </header>

        {(payload || loading) && (
          <p className="forth-playback-live-bar" role="status">
            <strong>{language === "th" ? "กำลังดูประวัติ GPS (ไม่ใช่ตำแหน่งสด)" : "Historical GPS (not live positions)"}</strong>
          </p>
        )}

        <label className="forth-playback-field">
          <span>{language === "th" ? "ค้นหารถ" : "Find vehicle"}</span>
          <input
            type="search"
            value={vehicleQuery}
            onChange={(event) => setVehicleQuery(event.target.value)}
            placeholder={language === "th" ? "ทะเบียน หรือ ประเภท" : "Registration or type"}
          />
        </label>
        <label className="forth-playback-field">
          <span>{language === "th" ? "รถ" : "Vehicle"}</span>
          <select
            value={selectedKey ?? ""}
            onChange={(event) => {
              const next = event.target.value;
              if (!next) return;
              if (payload || loading) clearPlayback();
              onSelectVehicle(next);
            }}
          >
            <option value="">{language === "th" ? "เลือกรถ" : "Select vehicle"}</option>
            {vehicleOptions.map((row) => (
              <option key={row.key} value={row.key}>
                {row.label}
              </option>
            ))}
          </select>
        </label>

        <div className="forth-playback-time-row">
          <label className="forth-playback-field">
            <span>{language === "th" ? "วันที่ (กรุงเทพ)" : "Date (Bangkok)"}</span>
            <input type="date" value={dateYmd} onChange={(event) => setDateYmd(event.target.value)} />
          </label>
          <label className="forth-playback-field">
            <span>{language === "th" ? "จาก" : "From"}</span>
            <input type="time" value={startHm} onChange={(event) => setStartHm(event.target.value)} />
          </label>
          <label className="forth-playback-field">
            <span>{language === "th" ? "ถึง" : "To"}</span>
            <input type="time" value={endHm} onChange={(event) => setEndHm(event.target.value)} />
          </label>
        </div>

        <button type="button" className="btn-primary forth-playback-load" disabled={loading || !selected} onClick={() => void loadHistory()}>
          {loading
            ? language === "th"
              ? "กำลังโหลด…"
              : "Loading…"
            : language === "th"
              ? "โหลดประวัติ GPS"
              : "Load Journey"}
        </button>

        {loading ? (
          <div className="forth-playback-loading" role="status">
            <p>{language === "th" ? "กำลังโหลดประวัติ…" : "Loading history…"}</p>
          </div>
        ) : null}

        {error ? (
          <div className="forth-playback-unavailable" role="status">
            <strong>{language === "th" ? "ยังเล่นประวัติจริงไม่ได้" : "Live history not available"}</strong>
            <p>{error}</p>
            {unavailableDetail ? <p className="forth-playback-detail">{unavailableDetail}</p> : null}
          </div>
        ) : null}

        {payload ? (
          <section className="forth-playback-controls" aria-label={language === "th" ? "ควบคุมการเล่น" : "Playback controls"}>
            <p className="forth-playback-summary">
              {payload.observationCount === 0
                ? language === "th"
                  ? "ไม่มีจุด GPS ในช่วงนี้"
                  : "No GPS observations in this window"
                : `${payload.observationCount} ${language === "th" ? "จุด" : "obs"} · ${payload.verifiedCount} GPS · ${payload.trailEligibleCount ?? payload.verifiedCount} ${language === "th" ? "รายงานได้" : "trail"} · ${payload.segmentCount}/${payload.reportedTrailSegmentCount ?? payload.segmentCount} ${language === "th" ? "ช่วง" : "segs"} · ${payload.gapCount} ${language === "th" ? "ช่องว่าง" : "gaps"}`}
            </p>
            {payload.message ? <p className="forth-playback-detail">{payload.message}</p> : null}
            <div className="forth-playback-buttons">
              <button type="button" onClick={() => setPlaying((value) => !value)}>
                {playing ? (language === "th" ? "หยุด" : "Pause") : language === "th" ? "เล่น" : "Play"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setPlaying(false);
                  setCursor(0);
                }}
              >
                {language === "th" ? "เริ่มใหม่" : "Restart"}
              </button>
              {FORTH_PLAYBACK_SPEEDS.map((value) => (
                <button key={value} type="button" aria-pressed={speed === value} onClick={() => setSpeed(value)}>
                  {value}x
                </button>
              ))}
            </div>
            <label className="forth-playback-timeline">
              <span>{language === "th" ? "ไทม์ไลน์" : "Timeline · Bangkok"}</span>
              <input
                aria-label={language === "th" ? "ไทม์ไลน์" : "Journey timeline"}
                aria-valuetext={playbackTimeLabel(currentPoint ?? undefined, language)}
                type="range"
                min={0}
                max={Math.max(0, payload.points.length - 1)}
                value={cursor}
                onChange={(event) => {
                  setPlaying(false);
                  setCursor(Number(event.target.value));
                }}
              />
            </label>
            <div className="forth-playback-time-labels"><span>{playbackTimeLabel(payload.points[0], language)}</span><span>{playbackTimeLabel(payload.points[payload.points.length - 1], language)}</span></div>
            {currentPoint ? (
              <dl className="forth-playback-observation">
                <div>
                  <dt>{language === "th" ? "เวลา" : "Time"}</dt>
                  <dd title={currentPoint.sourceTimestamp ?? currentPoint.timestampIso ?? undefined}>{playbackTimeLabel(currentPoint, language)} · Bangkok</dd>
                </div>
                <div>
                  <dt>{language === "th" ? "ความเร็ว" : "Speed"}</dt>
                  <dd>{currentPoint.speedKph == null ? "—" : `${currentPoint.speedKph} km/h`}</dd>
                </div>
                <div>
                  <dt>GPS</dt>
                  <dd>
                    {currentPoint.verifiedGps
                      ? language === "th"
                        ? "ยืนยัน"
                        : "Verified"
                      : language === "th"
                        ? "ไม่ยืนยัน"
                        : "Unverified"}
                  </dd>
                </div>
                <div>
                  <dt>{language === "th" ? "เครื่องยนต์" : "Engine"}</dt>
                  <dd>{currentPoint.engineOn == null ? "—" : currentPoint.engineOn ? "On" : "Off"}</dd>
                </div>
                {currentPoint.isGapEdge ? (
                  <div>
                    <dt>{language === "th" ? "ช่องว่าง" : "Gap"}</dt>
                    <dd>{Math.round((currentPoint.gapBeforeMs ?? 0) / 60000)} min</dd>
                  </div>
                ) : null}
              </dl>
            ) : null}
          </section>
        ) : null}

        {journeySummary && journeySummary.observationCount > 0 ? (
          <section className="forth-journey-intelligence" aria-label={language === "th" ? "สรุปการเดินทาง" : "Journey intelligence"}>
            <h4>{language === "th" ? "สรุปจากบันทึก GPS จริง" : "Summary from recorded GPS"}</h4>
            <p className="forth-journey-intelligence-note">
              {language === "th"
                ? "สรุปจากจุดที่มีหลักฐานเท่านั้น — ไม่สร้างการเคลื่อนที่หรือการส่งมอบที่ขาดหาย"
                : "Evidence-only — missing movement or delivery completion is never invented."}
            </p>
            <dl className="forth-journey-intelligence-grid">
              <div>
                <dt>{language === "th" ? "จุดแรก / สุดท้าย" : "First / last"}</dt>
                <dd>
                  <button type="button" className="forth-journey-seek" onClick={() => journeySummary.first && seekToObservation(journeySummary.first.index)}>
                    {playbackTimeLabel(journeySummary.first ?? undefined, language)}
                  </button>
                  {" → "}
                  <button type="button" className="forth-journey-seek" onClick={() => journeySummary.last && seekToObservation(journeySummary.last.index)}>
                    {playbackTimeLabel(journeySummary.last ?? undefined, language)}
                  </button>
                </dd>
              </div>
              <div>
                <dt>{language === "th" ? "ช่วงเวลาที่สังเกต" : "Observed span"}</dt>
                <dd>{formatJourneyDuration(journeySummary.observedSpanMs, language)}</dd>
              </div>
              <div>
                <dt>{language === "th" ? "ความเร็ว" : "Speed"}</dt>
                <dd>
                  {journeySummary.speed.samples
                    ? `${language === "th" ? "สูงสุด" : "max"} ${journeySummary.speed.maxKph} · ${language === "th" ? "เฉลี่ย" : "avg"} ${journeySummary.speed.meanKph} km/h`
                    : "—"}
                </dd>
              </div>
              <div>
                <dt>{language === "th" ? "เคลื่อนที่ / หยุด / ไม่ทราบ" : "Moving / stopped / unknown"}</dt>
                <dd>
                  {journeySummary.movingObservationCount} / {journeySummary.stoppedObservationCount} /{" "}
                  {journeySummary.unknownActivityCount}
                </dd>
              </div>
              <div>
                <dt>{language === "th" ? "เส้นทาง GPS ยืนยัน / รายงาน" : "Verified / reported trail"}</dt>
                <dd>
                  {journeySummary.verifiedCount} GPS · {journeySummary.trailEligibleCount} trail ·{" "}
                  {journeySummary.reportedOnlyCount} {language === "th" ? "รายงานอย่างเดียว" : "reported-only"} ·{" "}
                  {journeySummary.gapCount} {language === "th" ? "ช่องว่าง" : "gaps"}
                </dd>
              </div>
            </dl>
            {journeySummary.stopCandidates.length ? (
              <div className="forth-journey-stops">
                <h5>{language === "th" ? "จุดหยุด / ใกล้สถานที่ (ตรวจทาน)" : "Stops / near locations (review)"}</h5>
                <p>
                  {language === "th"
                    ? "ความใกล้เคียงไม่ใช่การส่งมอบที่ยืนยัน — คลิกเพื่อเลื่อนไทม์ไลน์"
                    : "Proximity is not confirmed delivery — click to move the timeline."}
                </p>
                <ul>
                  {journeySummary.stopCandidates.map((stop) => (
                    <li key={stop.key}>
                      <button type="button" className="forth-journey-stop-btn" onClick={() => seekToObservation(stop.seekIndex)}>
                        <strong>{stop.label}</strong>
                        <span>
                          {stop.kind === "speed_stop"
                            ? language === "th"
                              ? "หยุดจากความเร็ว"
                              : "Speed stop"
                            : stop.kind === "depot_proximity"
                              ? language === "th"
                                ? "ใกล้ลานจอด/สำนักงาน"
                                : "Near depot/office"
                              : language === "th"
                                ? "ใกล้ลูกค้า"
                                : "Near customer"}
                          {stop.nearestDistanceMeters != null ? ` · ${Math.round(stop.nearestDistanceMeters)} m` : ""}
                          {stop.durationMs != null ? ` · ${formatJourneyDuration(stop.durationMs, language)}` : ""}
                          {` · ${stop.observationCount} obs`}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        ) : null}

        {selectedLocationHits.length ? (
          <p className="forth-playback-selected-hits" role="status">
            {language === "th"
              ? `${selectedLocationHits.length} จุดยืนยันภายใน 200 ม. ของสถานที่ที่เลือก`
              : `${selectedLocationHits.length} verified observations within 200 m of the selected location`}
            {" · "}
            <button
              type="button"
              className="forth-journey-seek"
              onClick={() => {
                const hit = selectedLocationHits[0];
                if (hit) seekToObservation(hit.observationIndex);
              }}
            >
              {language === "th" ? "ไปจุดแรก" : "Jump to first"}
            </button>
          </p>
        ) : null}

        {!payload && !loading && !error ? (
          <p className="forth-playback-hint">
            {language === "th"
              ? "เลือกวันเวลาแล้วโหลดประวัติ — ปุ่มกลับกองรถสดอยู่ด้านบนและบนแผนที่"
              : "Pick a date/time window, then load history — Back to Live is in the header and on the map."}
          </p>
        ) : null}
      </div>
    );
  }
);
