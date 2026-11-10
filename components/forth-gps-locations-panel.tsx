"use client";

import { Crosshair, ExternalLink, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ForthFleetTrackingRecord } from "@/lib/forth-tracking-server";
import {
  filterForthGpsMapLocations,
  type ForthGpsMapLocation
} from "@/lib/forth-gps-map-locations";
import {
  formatForthProximityDistanceMeters,
  forthLocationProximityLabel,
  summarizeForthLocationProximity,
  type ForthLocationProximityVehicle
} from "@/lib/forth-location-proximity";
import { getForthTrackingVehicleIdentity } from "@/lib/forth-tracking-view";
import { FORTH_GPS_SOURCE_LABEL } from "@/lib/forth-selected-locations";

type Props = {
  locations: ForthGpsMapLocation[];
  groups: string[];
  records: ForthFleetTrackingRecord[];
  available: boolean;
  language: "en" | "th";
  selectedId: string | null;
  directoryCount: number;
  onSelect: (id: string | null) => void;
  onFocusMap: (id: string) => void;
  onFitResults: (ids: string[]) => void;
  onSelectVehicle: (key: string, options?: { focusMap?: boolean }) => void;
  confirmedDriverFor?: (record: ForthFleetTrackingRecord) => string | null;
  onClose: () => void;
};

const PAGE_SIZE = 40;

function ProximityRow({
  row,
  language,
  confirmedDriverFor,
  onSelectVehicle,
  planning
}: {
  row: ForthLocationProximityVehicle;
  language: "en" | "th";
  confirmedDriverFor?: (record: ForthFleetTrackingRecord) => string | null;
  onSelectVehicle: (key: string, options?: { focusMap?: boolean }) => void;
  planning?: boolean;
}) {
  const th = language === "th";
  const confirmed = confirmedDriverFor?.(row.record) ?? null;
  const identity = getForthTrackingVehicleIdentity(row.record.vehicleRegistration);
  return (
    <button
      type="button"
      className={`forth-locations-nearby-row${planning ? " is-planning" : ""}`}
      onClick={() => onSelectVehicle(row.key, { focusMap: true })}
    >
      <strong>{row.record.vehicleRegistration || "—"}</strong>
      <span>
        {formatForthProximityDistanceMeters(row.distanceMeters)}
        {" · "}
        {planning
          ? row.gpsVerified
            ? (th ? "GPS ยืนยัน" : "GPS verified")
            : (th ? "GPS ยังไม่ยืนยัน" : "GPS unverified")
          : forthLocationProximityLabel(row.band, language)}
      </span>
      <span>
        {[
          confirmed,
          identity.make,
          row.ageLabel,
          planning && row.band !== "outside" ? forthLocationProximityLabel(row.band, language) : null
        ].filter(Boolean).join(" · ")}
      </span>
    </button>
  );
}

export function ForthGpsLocationsPanel({
  locations,
  groups,
  records,
  available,
  language,
  selectedId,
  directoryCount,
  onSelect,
  onFocusMap,
  onFitResults,
  onSelectVehicle,
  confirmedDriverFor,
  onClose
}: Props) {
  const th = language === "th";
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState("");
  const [page, setPage] = useState(0);
  const [showNearestPlanning, setShowNearestPlanning] = useState(false);

  useEffect(() => {
    setShowNearestPlanning(false);
  }, [selectedId]);

  const filtered = useMemo(
    () => filterForthGpsMapLocations(locations, { search, group }),
    [locations, search, group]
  );
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageIndex = Math.min(page, pageCount - 1);
  const visible = filtered.slice(pageIndex * PAGE_SIZE, pageIndex * PAGE_SIZE + PAGE_SIZE);
  const selected = selectedId ? locations.find((location) => location.id === selectedId) ?? null : null;

  const proximity = useMemo(
    () => (selected
      ? summarizeForthLocationProximity(selected, records, { language, nearestLimit: 8 })
      : null),
    [selected, records, language]
  );

  return (
    <section className="forth-locations-panel" aria-label={th ? "สถานที่ Forth GPS" : "Forth GPS locations"}>
      <header className="forth-locations-panel-header">
        <div>
          <p className="forth-locations-eyebrow">{FORTH_GPS_SOURCE_LABEL}</p>
          <strong>{available ? `${locations.length} ${th ? "จุด" : "saved"}` : "—"}</strong>
          <p className="text-[10px] font-medium text-slate-500">
            {th
              ? `หมุดจาก Forth · ไม่ใช่หมุดที่ยืนยันโดยสำนักงาน · Directory EES ${directoryCount} รายการคงเดิม`
              : `Forth pins · ${directoryCount} Directory records`}
          </p>
        </div>
        <button type="button" aria-label={th ? "ปิด" : "Close"} onClick={onClose}><X aria-hidden="true" /></button>
      </header>

      <div className="forth-locations-controls">
        <label className="forth-locations-search">
          <Search aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(event) => { setSearch(event.target.value); setPage(0); }}
            placeholder={th ? "ค้นหาชื่อ / Forth ID" : "Search name or Forth ID"}
            aria-label={th ? "ค้นหาสถานที่ Forth" : "Search Forth locations"}
          />
        </label>
        <select
          aria-label={th ? "กลุ่ม" : "Group"}
          value={group}
          onChange={(event) => { setGroup(event.target.value); setPage(0); }}
        >
          <option value="">{th ? "ทุกกลุ่ม" : "All groups"}</option>
          {groups.map((value) => (
            <option key={value} value={value}>{value}</option>
          ))}
        </select>
      </div>

      <div className="mb-2 flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-secondary text-xs"
          disabled={!filtered.length}
          onClick={() => onFitResults(filtered.map((location) => location.id))}
        >
          {th ? `จัดมุมมองตามผลการค้นหา (${filtered.length})` : `Fit search results (${filtered.length})`}
        </button>
      </div>

      {selected && proximity ? (
        <div className="forth-locations-detail" aria-label={th ? "รายละเอียด" : "Selected location"} aria-live="polite">
          <p className="forth-locations-eyebrow">{FORTH_GPS_SOURCE_LABEL}</p>
          <h3>{selected.name}</h3>
          <p className="forth-locations-address">{th ? "หมุดจาก Forth · ยังไม่ยืนยันโดยสำนักงาน" : "Forth source pin · not office-verified"}</p>
          <p className="forth-locations-thai">Forth ID {selected.forthLocationId}</p>
          {selected.groupLayer ? <p className="forth-locations-address">{th ? "กลุ่ม" : "Group"}: {selected.groupLayer}</p> : null}
          {selected.address ? <p className="forth-locations-address">{selected.address}</p> : null}
          <p className="forth-locations-address">
            {selected.latitude.toFixed(6)}, {selected.longitude.toFixed(6)}
          </p>
          {selected.locationType ? <p className="text-xs text-slate-500">{selected.locationType}</p> : null}
          <div className="forth-locations-actions">
            <button type="button" onClick={() => onFocusMap(selected.id)}><Crosshair aria-hidden="true" />{th ? "โฟกัสแผนที่" : "Focus on map"}</button>
            <a href={selected.googleMapsUrl} target="_blank" rel="noopener noreferrer"><ExternalLink aria-hidden="true" />Google Maps</a>
          </div>

          <div className="forth-proximity-summary" aria-label={th ? "สรุประยะใกล้เคียง" : "Proximity summary"}>
            <p className="forth-locations-eyebrow">{th ? "ระยะใกล้เคียงลูกค้า" : "Customer proximity"}</p>
            <p className="forth-locations-nearby-note">
              {th
                ? "ระยะเส้นตรง · เฉพาะ GPS ที่ยืนยันและข้อมูลใหม่ · ไม่ใช่การมาถึง · ไม่เปิด geofence"
                : "Straight-line · verified fresh GPS only · not an arrival · geofences remain off"}
            </p>
            <div className="forth-proximity-counts">
              <span><strong>{proximity.atLocationCount}</strong> {th ? "ภายใน 100 ม." : "within 100 m"}</span>
              <span><strong>{proximity.approachingCount}</strong> {th ? "100–200 ม." : "100–200 m"}</span>
            </div>

            {proximity.active.length === 0 ? (
              <p className="forth-locations-empty">
                {th
                  ? "ไม่มีรถที่ GPS ยืนยันภายใน 200 ม."
                  : "No verified vehicles within 200 m"}
              </p>
            ) : (
              <div className="forth-locations-nearby" aria-label={th ? "รถในระยะใกล้เคียง" : "Vehicles in proximity"}>
                {proximity.active.map((row) => (
                  <ProximityRow
                    key={row.key}
                    row={row}
                    language={language}
                    confirmedDriverFor={confirmedDriverFor}
                    onSelectVehicle={onSelectVehicle}
                  />
                ))}
              </div>
            )}

            {proximity.cautionReports.length > 0 ? (
              <div className="forth-proximity-caution" role="status">
                <p className="forth-locations-eyebrow">
                  {th ? "รายงานล่าสุด (ยังไม่ยืนยัน)" : "Last-reported (not confirmed)"}
                </p>
                <p className="forth-locations-nearby-note">
                  {th
                    ? "พิกัดยังไม่ยืนยันหรือข้อมูลเก่า — ไม่นับเป็นที่สถานที่/กำลังเข้าใกล้"
                    : "Unverified or stale GPS — not counted as at-location or approaching"}
                </p>
                {proximity.cautionReports.map((row) => (
                  <ProximityRow
                    key={`caution-${row.key}`}
                    row={row}
                    language={language}
                    confirmedDriverFor={confirmedDriverFor}
                    onSelectVehicle={onSelectVehicle}
                    planning
                  />
                ))}
              </div>
            ) : null}

            <button
              type="button"
              className="forth-nearest-toggle"
              aria-expanded={showNearestPlanning}
              onClick={() => setShowNearestPlanning((value) => !value)}
            >
              {showNearestPlanning
                ? (th ? "ซ่อนค้นหารถใกล้ที่สุด" : "Hide nearest-vehicle search")
                : (th ? "ค้นหารถใกล้ที่สุด (วางแผนจัดส่ง)" : "Find nearest vehicles (dispatch planning)")}
            </button>

            {showNearestPlanning ? (
              <div className="forth-nearest-planning" aria-label={th ? "รถใกล้ที่สุดสำหรับวางแผน" : "Nearest vehicles for planning"}>
                <p className="forth-locations-nearby-note">
                  {th
                    ? "เครื่องมือวางแผน — ระยะไกลไม่ใช่ “กำลังเข้าใกล้” และไม่ใช่การมาถึง"
                    : "Planning tool — distant trucks are not “approaching” and are not arrivals"}
                </p>
                {proximity.nearestPlanning.map((row) => (
                  <ProximityRow
                    key={`plan-${row.key}`}
                    row={row}
                    language={language}
                    confirmedDriverFor={confirmedDriverFor}
                    onSelectVehicle={onSelectVehicle}
                    planning
                  />
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {!available ? (
        <p className="forth-locations-empty">{th ? "กำลังโหลดสถานที่ Forth" : "Forth locations are not available yet. See the connection status above."}</p>
      ) : locations.length === 0 ? (
        <p className="forth-locations-empty">{th ? "ไม่พบสถานที่ Forth ที่ผ่านการตรวจสอบ" : "No validated Forth locations"}</p>
      ) : visible.length === 0 ? (
        <p className="forth-locations-empty">{th ? "ไม่มีสถานที่ที่ตรงกับตัวกรอง" : "No locations match these filters"}</p>
      ) : (
        <div className="forth-locations-list">
          {visible.map((location) => (
            <button
              key={location.id}
              type="button"
              className={`forth-locations-row${selectedId === location.id ? " is-selected" : ""}`}
              onClick={() => onSelect(location.id)}
            >
              <strong>{location.name}</strong>
              <span className="forth-location-result-meta"><span>{location.groupLayer || "Forth"} · ID {location.forthLocationId}</span><Crosshair aria-hidden="true" /></span>
            </button>
          ))}
        </div>
      )}

      {filtered.length > PAGE_SIZE ? (
        <div className="forth-locations-pager">
          <button type="button" disabled={pageIndex <= 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>‹</button>
          <span>{pageIndex + 1}/{pageCount}</span>
          <button type="button" disabled={pageIndex >= pageCount - 1} onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}>›</button>
        </div>
      ) : null}
    </section>
  );
}
