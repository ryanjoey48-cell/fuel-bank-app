"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useLanguage } from "@/lib/language-provider";
import { adaptForthFleetResponse, matchesLiveVehicleSearch, type FleetTrackingV2LiveVehicle } from "@/lib/fleet-tracking-v2/live-adapter";
import type { EesVehicleIdentity } from "@/lib/forth-tracking";
import { canFocusVehicle, formatReportTime, getMotionState, type MotionState } from "@/lib/fleet-tracking-v2/view";
import { FLEET_TRACKING_V2_COPY } from "@/lib/fleet-tracking-v2/copy";
import { FleetTrackingV2Map } from "./fleet-map";
import styles from "./workspace.module.css";

type Language = "en" | "th";
type Filter = "all" | "moving" | "stopped" | "unknown";
type Command = { type: "fit" | "focus"; sequence: number; key?: string | null };
type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; records: FleetTrackingV2LiveVehicle[]; fetchedAt: string | null; vehicleRegistryAvailable: boolean };

const LIVE_COPY = {
  en: {
    eyebrow: "LIVE FLEET DATA · READ ONLY", title: "Fleet Tracking Centre",
    sourceNote: "Existing protected Forth feed · manual refresh only · no background polling.",
    fixtureLink: "Open labelled development fixture", returned: "Forth records", activity: "Activity reported",
    activityUnavailable: "Unavailable", verified: "GPS verified", fetched: "Feed fetched", loading: "Loading protected fleet data…",
    errorTitle: "Live fleet data is unavailable",
    errorHelp: "No simulated readings are shown. Check office access and the Forth Preview configuration, then retry.",
    retry: "Retry", refresh: "Refresh live data", search: "Search registration, device, driver or address",
    roster: "Vehicle roster", all: "All", moving: "Moving", stopped: "Stopped", unknown: "Unavailable",
    noRecords: "Forth returned no vehicle records.", noResults: "No vehicles match this search.",
    registrationUnavailable: "Registration unavailable", locationUnavailable: "Location unavailable",
    speed: "Source speed", engine: "Engine", engineOn: "On", engineOff: "Off", engineUnknown: "Unknown",
    movement: "Reported activity", driving: "Driving", uncertain: "Uncertain",
    stoppedEngineOn: "Stopped · engine on", stoppedEngineOff: "Stopped · engine off",
    stoppedEngineUnknown: "Stopped · engine unknown", activityUnavailableLabel: "Activity unavailable",
    location: "Location", tracker: "Tracker connection", trackerConnected: "Connected",
    trackerDisconnected: "Disconnected", trackerUnknown: "Unknown",
    gpsVerifiedLabel: "GPS position verified", gpsUnverified: "GPS position not verified",
    gpsConfidenceUnavailable: "GPS confidence unavailable", timezoneUnknown: "Source timezone unknown",
    stale: "Position report is stale", sourceTimestamp: "Last source report", rawTimestamp: "Original source time",
    noSourceTime: "No interpretable source time", gpsReceiver: "GPS receiver", positionQuality: "Position quality",
    positionSource: "Position source", coordinates: "Source coordinates", identity: "EES vehicle identity",
    identityMatched: "Matched", identityAmbiguous: "Ambiguous · not linked", identityUnmatched: "No unique EES match",
    identityUnavailable: "EES vehicle roster unavailable", identityReason: "Match status",
    reportedDriver: "Forth-reported driver", noDriver: "No driver reported", technical: "Technical details",
    closeDetails: "Close details", fitArea: "Fit fleet", showRoster: "Show roster", hideRoster: "Hide roster",
    clusterTitle: "Vehicles at this map point",
    clusterHint: "Select a registration to open details. Original coordinates are unchanged.",
    chooseVehicle: "Select", gpsIssue: "GPS not verified", sourceStale: "Stale report",
    signIn: "A verified office sign-in is required.", requestFailed: "The tracking request failed.",
    unavailableGps: "No verified GPS positions are currently available."
  },
  th: {
    eyebrow: "ข้อมูลรถจริง · อ่านอย่างเดียว", title: "ศูนย์ติดตามรถ",
    sourceNote: "ใช้ข้อมูล Forth ผ่าน API ที่มีการป้องกัน · รีเฟรชเองเท่านั้น · ไม่มีการดึงข้อมูลเบื้องหลัง",
    fixtureLink: "เปิดชุดข้อมูลจำลองสำหรับพัฒนา", returned: "รายการจาก Forth", activity: "สถานะการใช้งาน",
    activityUnavailable: "ไม่พร้อมใช้งาน", verified: "ตำแหน่ง GPS ยืนยันแล้ว", fetched: "ดึงข้อมูลเมื่อ", loading: "กำลังโหลดข้อมูลรถ…",
    errorTitle: "ไม่สามารถใช้งานข้อมูลรถจริงได้",
    errorHelp: "ไม่มีการแสดงข้อมูลจำลอง โปรดตรวจสอบสิทธิ์สำนักงานและการตั้งค่า Forth Preview แล้วลองอีกครั้ง",
    retry: "ลองอีกครั้ง", refresh: "รีเฟรชข้อมูลจริง", search: "ค้นหาทะเบียน อุปกรณ์ คนขับ หรือที่อยู่",
    roster: "รายชื่อรถ", all: "ทั้งหมด", moving: "กำลังเคลื่อนที่", stopped: "หยุด", unknown: "ไม่พร้อมใช้งาน",
    noRecords: "Forth ไม่ส่งรายการรถกลับมา", noResults: "ไม่พบรถที่ตรงกับการค้นหา",
    registrationUnavailable: "ไม่มีทะเบียนรถ", locationUnavailable: "ไม่มีข้อมูลสถานที่",
    speed: "ความเร็วจากอุปกรณ์", engine: "เครื่องยนต์", engineOn: "เปิด", engineOff: "ปิด", engineUnknown: "ไม่ทราบ",
    movement: "สถานะจากข้อมูล", driving: "กำลังขับ", uncertain: "ไม่แน่ชัด",
    stoppedEngineOn: "หยุด · เครื่องยนต์เปิด", stoppedEngineOff: "หยุด · เครื่องยนต์ปิด",
    stoppedEngineUnknown: "หยุด · ไม่ทราบสถานะเครื่องยนต์", activityUnavailableLabel: "สถานะไม่พร้อมใช้งาน",
    location: "สถานที่", tracker: "การเชื่อมต่ออุปกรณ์", trackerConnected: "เชื่อมต่อ",
    trackerDisconnected: "ขาดการเชื่อมต่อ", trackerUnknown: "ไม่ทราบ",
    gpsVerifiedLabel: "ยืนยันตำแหน่ง GPS แล้ว", gpsUnverified: "ยังไม่ยืนยันตำแหน่ง GPS",
    gpsConfidenceUnavailable: "ไม่สามารถประเมินความน่าเชื่อถือ GPS", timezoneUnknown: "ไม่ทราบเขตเวลาต้นทาง",
    stale: "ข้อมูลตำแหน่งเก่า", sourceTimestamp: "รายงานล่าสุดจากต้นทาง", rawTimestamp: "เวลาต้นฉบับ",
    noSourceTime: "ไม่มีเวลาต้นทางที่แปลผลได้", gpsReceiver: "การเชื่อมต่อ GPS", positionQuality: "คุณภาพตำแหน่ง",
    positionSource: "แหล่งตำแหน่ง", coordinates: "พิกัดต้นทาง", identity: "ข้อมูลรถใน EES",
    identityMatched: "จับคู่แล้ว", identityAmbiguous: "ไม่ชัดเจน · ยังไม่เชื่อมโยง",
    identityUnmatched: "ไม่มีรายการ EES ที่ไม่ซ้ำ", identityUnavailable: "ไม่มีรายชื่อรถ EES",
    identityReason: "สถานะการจับคู่", reportedDriver: "คนขับที่ Forth รายงาน", noDriver: "ไม่มีข้อมูลคนขับ",
    technical: "รายละเอียดทางเทคนิค", closeDetails: "ปิดรายละเอียด", fitArea: "แสดงรถทั้งหมด",
    showRoster: "แสดงรายชื่อ", hideRoster: "ซ่อนรายชื่อ", clusterTitle: "รถที่ตำแหน่งแผนที่นี้",
    clusterHint: "เลือกทะเบียนเพื่อดูรายละเอียด ระบบคงพิกัดเดิม", chooseVehicle: "เลือก",
    gpsIssue: "ยังไม่ยืนยัน GPS", sourceStale: "รายงานเก่า",
    signIn: "ต้องเข้าสู่ระบบสำนักงานที่ยืนยันแล้ว", requestFailed: "คำขอติดตามรถไม่สำเร็จ",
    unavailableGps: "ขณะนี้ไม่มีตำแหน่ง GPS ที่ยืนยันแล้ว"
  }
} as const;

const activityKeys = {
  driving: "driving",
  uncertain: "uncertain",
  stopped_engine_on: "stoppedEngineOn",
  stopped_engine_off: "stoppedEngineOff",
  stopped_engine_unknown: "stoppedEngineUnknown",
  unavailable: "activityUnavailableLabel"
} as const;

function pillClass(state: MotionState) {
  if (state === "moving") return styles.pillMoving;
  if (state === "stopped") return styles.pillStopped;
  if (state === "offline") return styles.pillOffline;
  return styles.pillUnknown;
}

function activityLabel(vehicle: FleetTrackingV2LiveVehicle, copy: (typeof LIVE_COPY)[Language]) {
  return copy[activityKeys[vehicle.activity]];
}

function trackerLabel(vehicle: FleetTrackingV2LiveVehicle, copy: (typeof LIVE_COPY)[Language]) {
  if (vehicle.trackerConnectivity === "connected") return copy.trackerConnected;
  if (vehicle.trackerConnectivity === "disconnected") return copy.trackerDisconnected;
  return copy.trackerUnknown;
}

function identityLabel(vehicle: FleetTrackingV2LiveVehicle, copy: (typeof LIVE_COPY)[Language]) {
  if (vehicle.eesIdentity.status === "matched") {
    return copy.identityMatched + " · " + (vehicle.eesIdentity.registration ?? vehicle.eesIdentity.vehicleId ?? "");
  }
  if (vehicle.eesIdentity.status === "ambiguous") return copy.identityAmbiguous;
  if (vehicle.eesIdentity.status === "unmatched") return copy.identityUnmatched;
  return copy.identityUnavailable;
}

function confidenceLabel(vehicle: FleetTrackingV2LiveVehicle, copy: (typeof LIVE_COPY)[Language]) {
  if (vehicle.gpsConfidence === "verified") return copy.gpsVerifiedLabel;
  if (vehicle.gpsConfidence === "unavailable") return copy.gpsConfidenceUnavailable;
  return copy.gpsUnverified;
}

function sourceTimeLabel(vehicle: FleetTrackingV2LiveVehicle, language: Language, copy: (typeof LIVE_COPY)[Language]) {
  if (vehicle.timestampStatus.startsWith("timezone_")) {
    return vehicle.sourceTimestampRaw ? copy.timezoneUnknown + " · " + vehicle.sourceTimestampRaw : copy.timezoneUnknown;
  }
  if (vehicle.reportedAt) return formatReportTime(vehicle.reportedAt, language) ?? copy.noSourceTime;
  return vehicle.sourceTimestampRaw ?? copy.noSourceTime;
}

function locationLabel(vehicle: FleetTrackingV2LiveVehicle, language: Language, copy: (typeof LIVE_COPY)[Language]) {
  const address = language === "th"
    ? vehicle.locationAddressThai ?? vehicle.locationAddressEnglish
    : vehicle.locationAddressEnglish ?? vehicle.locationAddressThai;
  return address ?? copy.locationUnavailable;
}

function engineLabel(vehicle: FleetTrackingV2LiveVehicle, copy: (typeof LIVE_COPY)[Language]) {
  if (vehicle.engineOn === true) return copy.engineOn;
  if (vehicle.engineOn === false) return copy.engineOff;
  return copy.engineUnknown;
}

function VehicleDetails({ vehicle, language, copy, onClose }: {
  vehicle: FleetTrackingV2LiveVehicle;
  language: Language;
  copy: (typeof LIVE_COPY)[Language];
  onClose: () => void;
}) {
  const coordinates = typeof vehicle.latitude === "number" && typeof vehicle.longitude === "number"
    ? String(vehicle.latitude) + ", " + String(vehicle.longitude)
    : copy.locationUnavailable;
  return (
    <section className={styles.details} aria-labelledby="fleet-v2-live-details-title">
      <div className={styles.detailsHead}>
        <div><h2 id="fleet-v2-live-details-title">{vehicle.registration}</h2><p className={styles.detailsTag}>{identityLabel(vehicle, copy)}</p></div>
        <button type="button" className={styles.close} onClick={onClose}>{copy.closeDetails}</button>
      </div>
      <dl className={styles.coreGrid}>
        <div className={styles.coreItem}><dt>{copy.movement}</dt><dd><span className={styles.pill + " " + pillClass(getMotionState(vehicle))}>{activityLabel(vehicle, copy)}</span></dd></div>
        <div className={styles.coreItem}><dt>{copy.speed}</dt><dd className={styles.coreStrong}>{typeof vehicle.speedKph === "number" ? String(vehicle.speedKph) : "—"}</dd></div>
        <div className={styles.coreItem}><dt>{copy.engine}</dt><dd className={styles.coreStrong}>{engineLabel(vehicle, copy)}</dd></div>
        <div className={styles.coreItem + " " + styles.coreLocation}><dt>{copy.location}</dt><dd>{locationLabel(vehicle, language, copy)}</dd></div>
      </dl>
      <p className={styles.detailsTag}>{confidenceLabel(vehicle, copy)} · {vehicle.reportFreshness === "stale" ? copy.stale : sourceTimeLabel(vehicle, language, copy)}</p>
      <details className={styles.technical}>
        <summary>{copy.technical}</summary>
        <dl className={styles.dl}>
          <dt>{copy.tracker}</dt><dd>{trackerLabel(vehicle, copy)}</dd>
          <dt>{copy.gpsReceiver}</dt><dd>{vehicle.gpsConnectivity}</dd>
          <dt>{copy.positionQuality}</dt><dd>{vehicle.positionQuality}</dd>
          <dt>{copy.positionSource}</dt><dd>{vehicle.positionSource ?? "—"}</dd>
          <dt>{copy.sourceTimestamp}</dt><dd>{sourceTimeLabel(vehicle, language, copy)}</dd>
          <dt>{copy.rawTimestamp}</dt><dd>{vehicle.sourceTimestampRaw ?? "—"}</dd>
          <dt>{copy.coordinates}</dt><dd>{coordinates}</dd>
          <dt>{copy.identity}</dt><dd>{identityLabel(vehicle, copy)}</dd>
          <dt>{copy.identityReason}</dt><dd>{vehicle.eesIdentity.reason}</dd>
          <dt>{copy.reportedDriver}</dt><dd>{vehicle.reportedDriver ?? copy.noDriver}</dd>
        </dl>
      </details>
    </section>
  );
}

export function FleetTrackingV2LiveWorkspace({ showFixtureLink }: { showFixtureLink: boolean }) {
  const { language, setLanguage } = useLanguage();
  const copy = LIVE_COPY[language];
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [clusterIds, setClusterIds] = useState<string[] | null>(null);
  const [command, setCommand] = useState<Command>({ type: "fit", sequence: 1 });
  const [sheetOpen, setSheetOpen] = useState(false);
  const [dataState, setDataState] = useState<LoadState>({ status: "loading" });
  const startedRef = useRef(false);
  const activeRef = useRef(true);

  const loadLiveData = useCallback(async () => {
    setDataState({ status: "loading" });
    try {
      const sessionResult = await supabase.auth.getSession();
      if (sessionResult.error) throw new Error(copy.requestFailed);
      const token = sessionResult.data.session?.access_token;
      if (!token) throw new Error(copy.signIn);

      const [response, vehicleResult] = await Promise.all([
        fetch("/api/admin/forth-tracking/vehicles", {
          method: "GET", cache: "no-store", headers: { Authorization: "Bearer " + token }
        }),
        Promise.resolve(supabase.from("vehicles").select("id,vehicle_reg").order("vehicle_reg", { ascending: true })).catch(() => null)
      ]);
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const envelope = payload !== null && typeof payload === "object" ? payload as { error?: unknown } : {};
        throw new Error(typeof envelope.error === "string" ? envelope.error : copy.requestFailed);
      }

      const registry = !vehicleResult || vehicleResult.error || !Array.isArray(vehicleResult.data)
        ? null
        : vehicleResult.data as unknown as EesVehicleIdentity[];
      const result = adaptForthFleetResponse(payload, registry);
      if (result.status === "unavailable") throw new Error(result.message);
      if (activeRef.current) {
        setDataState({
          status: "ready",
          records: result.records,
          fetchedAt: result.fetchedAt,
          vehicleRegistryAvailable: result.vehicleRegistryAvailable
        });
      }
    } catch (error) {
      if (activeRef.current) {
        setDataState({ status: "error", message: error instanceof Error && error.message ? error.message : copy.requestFailed });
      }
    }
  }, [copy.requestFailed, copy.signIn]);

  useEffect(() => {
    activeRef.current = true;
    if (!startedRef.current) {
      startedRef.current = true;
      void loadLiveData();
    }
    return () => { activeRef.current = false; };
  }, [loadLiveData]);

  const vehicles = useMemo(() => dataState.status === "ready" ? dataState.records : [], [dataState]);
  const visible = useMemo(() => vehicles.filter((vehicle) => {
    if (!matchesLiveVehicleSearch(vehicle, query)) return false;
    return filter === "all" || getMotionState(vehicle) === filter;
  }), [filter, query, vehicles]);
  const selected = vehicles.find((vehicle) => vehicle.id === selectedId) ?? null;
  const clusterVehicles = clusterIds ? vehicles.filter((vehicle) => clusterIds.includes(vehicle.id)) : [];
  const showDetails = Boolean(selected && detailsOpen && clusterVehicles.length === 0);
  const knownActivity = vehicles.filter((vehicle) => vehicle.activity !== "unavailable").length;
  const gpsVerifiedCount = vehicles.filter((vehicle) => vehicle.gpsConfidence === "verified").length;
  const activitySummary = vehicles.length === 0
    ? (dataState.status === "ready" ? "0" : "—")
    : knownActivity === 0 ? copy.activityUnavailable : String(knownActivity) + "/" + String(vehicles.length);
  const gpsSummary = vehicles.length ? String(gpsVerifiedCount) + "/" + String(vehicles.length) : "—";

  function selectVehicle(id: string) {
    const vehicle = vehicles.find((entry) => entry.id === id);
    if (!vehicle) return;
    setSelectedId(id);
    setDetailsOpen(true);
    setClusterIds(null);
    setSheetOpen(window.matchMedia("(max-width: 1023px)").matches);
    if (canFocusVehicle(vehicle)) setCommand((current) => ({ type: "focus", sequence: current.sequence + 1, key: id }));
  }

  function fitArea() {
    setClusterIds(null);
    setCommand((current) => ({ type: "fit", sequence: current.sequence + 1 }));
  }

  const filters: Filter[] = ["all", "moving", "stopped", "unknown"];

  return (
    <div className={styles.shell + " " + styles.dashboardShell}>
      <header className={styles.banner}>
        <div className={styles.bannerCopy}>
          <p className={styles.eyebrow}>{copy.eyebrow}</p>
          <h1 className={styles.title}>{copy.title}</h1>
          <p className={styles.notice}>{dataState.status === "loading" ? copy.loading : dataState.status === "error" ? copy.errorTitle + ": " + dataState.message : copy.sourceNote + (dataState.fetchedAt ? " · " + copy.fetched + " " + (formatReportTime(dataState.fetchedAt, language) ?? dataState.fetchedAt) : "")}</p>
          {showFixtureLink ? <Link className={styles.detailsTag} href="/fleet-tracking-v2/fixture">{copy.fixtureLink}</Link> : null}
        </div>
        <div className={styles.liveSummary} aria-live="polite">
          <div className={styles.summaryItem}><span>{copy.returned}</span><strong>{dataState.status === "ready" ? String(vehicles.length) : "—"}</strong></div>
          <div className={styles.summaryItem}><span>{copy.activity}</span><strong>{activitySummary}</strong></div>
          <div className={styles.summaryItem}><span>{copy.verified}</span><strong>{gpsSummary}</strong></div>
          <div className={styles.lang} role="group" aria-label="Language">
            <button type="button" aria-pressed={language === "en"} onClick={() => setLanguage("en")}>{FLEET_TRACKING_V2_COPY.en.languageEn}</button>
            <button type="button" aria-pressed={language === "th"} onClick={() => setLanguage("th")}>{FLEET_TRACKING_V2_COPY.en.languageTh}</button>
          </div>
          {dataState.status === "ready" ? <button type="button" className={styles.close} onClick={() => void loadLiveData()}>{copy.refresh}</button> : null}
          {dataState.status === "error" ? <button type="button" className={styles.close} onClick={() => void loadLiveData()}>{copy.retry}</button> : null}
        </div>
      </header>

      {dataState.status === "error" ? <section className="mx-3 mt-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-950" role="alert">{copy.errorHelp}</section> : null}
      {dataState.status === "ready" && !dataState.vehicleRegistryAvailable ? <p className="mx-3 mt-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900" role="status">{copy.identityUnavailable}</p> : null}

      <div className={sheetOpen ? styles.body + " " + styles.bodyRosterOpen : styles.body}>
        <aside className={styles.roster + " " + (sheetOpen ? styles.rosterOpen : "")} aria-label={copy.roster}>
          <div className={styles.rosterHead}>
            <div className={styles.rosterHeadRow}><h2 className={styles.rosterTitle}>{copy.roster}</h2><span className={styles.count}>{dataState.status === "ready" ? String(visible.length) : "—"}</span></div>
            <input className={styles.search} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy.search} aria-label={copy.search} />
            <div className={styles.filters}>{filters.map((value) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{value === "all" ? copy.all : copy[value]}</button>)}</div>
          </div>
          {clusterVehicles.length > 0 ? (
            <div className={styles.cluster} role="group" aria-label={copy.clusterTitle}>
              <div className={styles.clusterHeading}>
                <div><h2>{copy.clusterTitle} · {clusterVehicles.length}</h2><p>{copy.clusterHint}</p></div>
                <button type="button" className={styles.clusterClose} aria-label={copy.closeDetails} onClick={() => setClusterIds(null)}>×</button>
              </div>
              {clusterVehicles.map((vehicle) => <button key={vehicle.id} type="button" className={styles.row + " " + styles.clusterRow} aria-pressed={selectedId === vehicle.id} onClick={() => selectVehicle(vehicle.id)}><span className={styles.reg}>{vehicle.registration}</span><span className={styles.clusterAction}>{copy.chooseVehicle}</span></button>)}
            </div>
          ) : null}
          <div className={styles.results} id="fleet-v2-live-vehicle-list">
            {dataState.status === "loading" ? <p className={styles.noResults}>{copy.loading}</p> : null}
            {dataState.status === "error" ? <p className={styles.noResults}>{copy.errorTitle}</p> : null}
            {dataState.status === "ready" && visible.length === 0 ? <p className={styles.noResults}>{vehicles.length ? copy.noResults : copy.noRecords}</p> : null}
            {dataState.status === "ready" ? visible.map((vehicle) => {
              const motion = getMotionState(vehicle);
              const exception = vehicle.reportFreshness === "stale" ? copy.sourceStale : vehicle.gpsConfidence !== "verified" ? copy.gpsIssue : vehicle.trackerConnectivity === "disconnected" ? copy.trackerDisconnected : null;
              return (
                <button key={vehicle.id} type="button" className={styles.row} aria-pressed={selectedId === vehicle.id} onClick={() => selectVehicle(vehicle.id)}>
                  <span className={styles.rowMain}><span className={styles.reg}>{vehicle.registration}</span><span className={styles.speed}>{typeof vehicle.speedKph === "number" ? String(vehicle.speedKph) : "—"}</span></span>
                  <span className={styles.rowSub}><span className={styles.pill + " " + pillClass(motion)}>{activityLabel(vehicle, copy)}</span>{exception ? <span className={styles.exception}>{exception}</span> : null}</span>
                </button>
              );
            }) : null}
          </div>
        </aside>

        <div className={styles.mapPane}>
          <FleetTrackingV2Map vehicles={vehicles} selectedId={selectedId} onSelect={selectVehicle} onCluster={(ids) => {
            setClusterIds(ids);
            setDetailsOpen(false);
            setSheetOpen(true);
          }} command={command} mapUnavailable={copy.unavailableGps} />
        </div>
        <button type="button" className={styles.fit} onClick={fitArea}>{copy.fitArea}</button>
        <button type="button" className={styles.sheetToggle} aria-expanded={sheetOpen} aria-controls="fleet-v2-live-vehicle-list" onClick={() => {
          setSheetOpen((open) => !open);
          setClusterIds(null);
        }}>{sheetOpen ? copy.hideRoster : copy.showRoster}</button>
        {showDetails && selected ? <VehicleDetails vehicle={selected} language={language} copy={copy} onClose={() => setDetailsOpen(false)} /> : null}
      </div>
    </div>
  );
}
