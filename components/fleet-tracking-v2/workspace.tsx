"use client";

import { useMemo, useState } from "react";
import { FleetTrackingV2Map } from "./fleet-map";
import styles from "./workspace.module.css";
import { FLEET_TRACKING_V2_COPY } from "@/lib/fleet-tracking-v2/copy";

type Copy = (typeof FLEET_TRACKING_V2_COPY)[keyof typeof FLEET_TRACKING_V2_COPY];
import { SYNTHETIC_FLEET, type MotionState, type SyntheticVehicle } from "@/lib/fleet-tracking-v2/synthetic-fleet";
import { useLanguage } from "@/lib/language-provider";
import {
  canFocusVehicle,
  formatReportTime,
  formatSpeed,
  getMotionState,
  matchesVehicleSearch
} from "@/lib/fleet-tracking-v2/view";

type Filter = "all" | MotionState;
type Command = { type: "fit" | "focus"; sequence: number; key?: string | null };

function pillClass(state: MotionState) {
  if (state === "moving") return styles.pillMoving;
  if (state === "stopped") return styles.pillStopped;
  if (state === "offline") return styles.pillOffline;
  return styles.pillUnknown;
}

function trustCopy(vehicle: SyntheticVehicle, copy: Copy) {
  if (vehicle.gpsTrust === "verified") return copy.gpsVerified;
  if (vehicle.gpsTrust === "unverified") return copy.gpsUnverified;
  if (vehicle.gpsTrust === "missing") return copy.gpsMissing;
  if (vehicle.gpsTrust === "stale") return copy.gpsStale;
  return copy.gpsOffline;
}

function trackerCopy(vehicle: SyntheticVehicle, copy: Copy) {
  if (vehicle.trackerConnectivity === "connected") return copy.trackerConnected;
  if (vehicle.trackerConnectivity === "disconnected") return copy.trackerDisconnected;
  return copy.trackerUnknown;
}

function trackerCopyShort(vehicle: SyntheticVehicle, copy: Copy) {
  if (vehicle.trackerConnectivity === "connected") return copy.trackerConnectedShort;
  if (vehicle.trackerConnectivity === "disconnected") return copy.trackerDisconnectedShort;
  return copy.trackerUnknownShort;
}

function rowExceptionCopy(vehicle: SyntheticVehicle, copy: Copy) {
  if (vehicle.gpsTrust === "offline" || vehicle.trackerConnectivity === "disconnected") return trackerCopyShort(vehicle, copy);
  if (vehicle.gpsTrust === "stale") return copy.gpsStaleShort;
  if (vehicle.gpsTrust === "unverified") return copy.gpsUnverifiedShort;
  if (vehicle.gpsTrust === "missing") return copy.gpsMissingShort;
  return null;
}
function positionSourceCopy(vehicle: SyntheticVehicle, copy: Copy) {
  if (vehicle.gpsQuality === "gps") return copy.gpsQualityGps;
  if (vehicle.gpsQuality === "wifi") return copy.gpsQualityWifi;
  if (vehicle.gpsQuality === "none") return copy.gpsQualityNone;
  return copy.gpsQualityUnknown;
}

function VehicleDetails({
  vehicle,
  language,
  copy,
  onClose
}: {
  vehicle: SyntheticVehicle;
  language: "en" | "th";
  copy: Copy;
  onClose: () => void;
}) {
  const state = getMotionState(vehicle);
  const location = language === "th" ? vehicle.locationNameTh : vehicle.locationNameEn;
  const engine = vehicle.engineOn === true ? copy.engineOn : vehicle.engineOn === false ? copy.engineOff : copy.engineUnknown;
  return (
    <section className={styles.details} aria-labelledby="fleet-v2-details-title">
      <div className={styles.detailsHead}>
        <div>
          <h2 id="fleet-v2-details-title">{vehicle.registration}</h2>
          <p className={styles.detailsTag}>{copy.simulatedReading}</p>
        </div>
        <button type="button" className={styles.close} onClick={onClose}>{copy.closeDetails}</button>
      </div>
      <dl className={styles.coreGrid}>
        <div className={styles.coreItem}>
          <dt>{copy.movement}</dt>
          <dd><span className={styles.pill + " " + pillClass(state)}>{copy[state]}</span></dd>
        </div>
        <div className={styles.coreItem}>
          <dt>{copy.speed}</dt>
          <dd className={styles.coreStrong}>{formatSpeed(vehicle.speedKph, copy.kph)}</dd>
        </div>
        <div className={styles.coreItem}>
          <dt>{copy.engine}</dt>
          <dd className={styles.coreStrong}>{engine}</dd>
        </div>
        <div className={styles.coreItem + " " + styles.coreLocation}>
          <dt>{copy.location}</dt>
          <dd>{location}</dd>
        </div>
      </dl>
      <details className={styles.technical}>
        <summary>{copy.technicalDetails}</summary>
        <dl className={styles.dl}>
          <dt>{copy.identity}</dt><dd>{copy.identityUnavailable}</dd>
          <dt>{copy.tracker}</dt><dd>{trackerCopy(vehicle, copy)}</dd>
          <dt>{copy.positionSource}</dt><dd>{positionSourceCopy(vehicle, copy)}</dd>
          <dt>{copy.gpsConfidence}</dt><dd>{trustCopy(vehicle, copy)}</dd>
          <dt>{copy.updated}</dt><dd>{formatReportTime(vehicle.reportedAt, language) ?? copy.noSourceTime}</dd>
        </dl>
      </details>
    </section>
  );
}
export function FleetTrackingV2Workspace() {
  const { language, setLanguage } = useLanguage();
  const copy = FLEET_TRACKING_V2_COPY[language];
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [clusterIds, setClusterIds] = useState<string[] | null>(null);
  const [command, setCommand] = useState<Command>({ type: "fit", sequence: 1 });
  const [sheetOpen, setSheetOpen] = useState(false);
  const vehicles = SYNTHETIC_FLEET;

  const visible = useMemo(() => {
    return vehicles.filter((vehicle) => {
      if (!matchesVehicleSearch(vehicle, query)) return false;
      if (filter !== "all" && getMotionState(vehicle) !== filter) return false;
      return true;
    });
  }, [filter, query, vehicles]);

  const selected = vehicles.find((vehicle) => vehicle.id === selectedId) ?? null;
  const clusterVehicles = clusterIds ? vehicles.filter((vehicle) => clusterIds.includes(vehicle.id)) : [];
  const showDetails = Boolean(selected && detailsOpen && clusterVehicles.length === 0);

  function selectVehicle(id: string) {
    const vehicle = vehicles.find((entry) => entry.id === id);
    if (!vehicle) return;
    setSelectedId(id);
    setDetailsOpen(true);
    setClusterIds(null);
    setSheetOpen(window.matchMedia("(max-width: 1023px)").matches);
    if (canFocusVehicle(vehicle)) {
      setCommand((current) => ({ type: "focus", sequence: current.sequence + 1, key: id }));
    }
  }

  function closeDetails() {
    setDetailsOpen(false);
  }

  function fitArea() {
    setClusterIds(null);
    setCommand((current) => ({ type: "fit", sequence: current.sequence + 1 }));
  }

  const filters: Filter[] = ["all", "moving", "stopped", "offline", "unknown"];

  return (
    <div className={styles.shell}>
      <header className={styles.banner}>
        <div className={styles.bannerCopy}>
          <p className={styles.eyebrow}>{copy.prototypeEyebrow}</p>
          <h1 className={styles.title}>{copy.title}</h1>
          <p className={styles.notice}>{copy.testDataBanner}</p>
        </div>
        <div className={styles.lang} role="group" aria-label="Language">
          <button type="button" aria-pressed={language === "en"} onClick={() => setLanguage("en")}>{copy.languageEn}</button>
          <button type="button" aria-pressed={language === "th"} onClick={() => setLanguage("th")}>{copy.languageTh}</button>
        </div>
      </header>
      <div className={sheetOpen ? styles.body + " " + styles.bodyRosterOpen : styles.body}>
        <aside className={`${styles.roster} ${sheetOpen ? styles.rosterOpen : ""}`} aria-label={copy.roster}>
          <div className={styles.rosterHead}>
            <div className={styles.rosterHeadRow}>
              <h2 className={styles.rosterTitle}>{copy.roster}</h2>
              <span className={styles.count}>{copy.count(visible.length)}</span>
            </div>
            <input
              className={styles.search}
              value={query}
              onChange={(event) => {
                const nextQuery = event.target.value;
                setQuery(nextQuery);
                const matching = vehicles.filter((vehicle) => matchesVehicleSearch(vehicle, nextQuery) && (filter === "all" || getMotionState(vehicle) === filter));
                if (nextQuery.trim() && matching.length === 1) selectVehicle(matching[0].id);
              }}
              placeholder={copy.search}
              aria-label={copy.search}
            />
            <div className={styles.filters}>
              {filters.map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={filter === value}
                  onClick={() => setFilter(value)}
                >
                  {value === "all" ? copy.all : copy[value]}
                </button>
              ))}
            </div>
          </div>
          {clusterVehicles.length > 0 ? (
            <div className={styles.cluster} role="group" aria-label={copy.clusterTitle}>
              <div className={styles.clusterHeading}>
                <div>
                  <h2>{copy.clusterTitle} · {clusterVehicles.length}</h2>
                  <p>{copy.clusterHint}</p>
                </div>
                <button type="button" className={styles.clusterClose} aria-label={copy.closeDetails} onClick={() => setClusterIds(null)}>×</button>
              </div>
              {clusterVehicles.map((vehicle) => (
                <button
                  key={vehicle.id}
                  type="button"
                  className={styles.row + " " + styles.clusterRow}
                  aria-pressed={selectedId === vehicle.id}
                  onClick={() => selectVehicle(vehicle.id)}
                >
                  <span className={styles.reg}>{vehicle.registration}</span>
                  <span className={styles.clusterAction}>{copy.chooseVehicle}</span>
                </button>
              ))}
            </div>
          ) : null}
          <div className={styles.results} id="fleet-v2-vehicle-list">
            {visible.length === 0 ? <p className={styles.noResults}>{copy.noResults}</p> : visible.map((vehicle) => {
              const state = getMotionState(vehicle);
              const exception = rowExceptionCopy(vehicle, copy);
              return (
                <button
                  key={vehicle.id}
                  type="button"
                  className={styles.row}
                  aria-pressed={selectedId === vehicle.id}
                  onClick={() => selectVehicle(vehicle.id)}
                >
                  <span className={styles.rowMain}>
                    <span className={styles.reg}>{vehicle.registration}</span>
                    <span className={styles.speed}>{formatSpeed(vehicle.speedKph, copy.kph)}</span>
                  </span>
                  <span className={styles.rowSub}>
                    <span className={styles.pill + " " + pillClass(state)}>{copy[state]}</span>
                    {exception ? <span className={styles.exception}>{exception}</span> : null}
                  </span>
                </button>
              );
            })}
          </div>
        </aside>
        <div className={styles.mapPane}>
          <FleetTrackingV2Map
            vehicles={vehicles}
            selectedId={selectedId}
            onSelect={selectVehicle}
            onCluster={(ids) => {
              setClusterIds(ids);
              setDetailsOpen(false);
              setSheetOpen(true);
            }}
            command={command}
            mapUnavailable={copy.mapUnavailable}
          />
        </div>
        <button type="button" className={styles.fit} onClick={fitArea}>{copy.fitArea}</button>
        <button
          type="button"
          className={styles.sheetToggle}
          aria-expanded={sheetOpen}
          aria-controls="fleet-v2-vehicle-list"
          onClick={() => {
            setSheetOpen((open) => !open);
            setClusterIds(null);
          }}
        >
          {sheetOpen ? copy.hideRoster : copy.showRoster}
        </button>
        {showDetails && selected ? (
          <VehicleDetails vehicle={selected} language={language} copy={copy} onClose={closeDetails} />
        ) : null}
      </div>
    </div>
  );
}
