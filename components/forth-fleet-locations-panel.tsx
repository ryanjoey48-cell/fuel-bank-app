"use client";

import { Crosshair, ExternalLink, MapPinned, Search, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { ForthFleetTrackingRecord } from "@/lib/forth-tracking-server";
import {
  FLEET_LOCATION_CATEGORIES,
  filterFleetDirectoryLocations,
  findNearbyVehiclesForLocation,
  type FleetDirectoryLocation
} from "@/lib/forth-fleet-locations";
import { getForthTrackingVehicleIdentity } from "@/lib/forth-tracking-view";

type Props = {
  locations: FleetDirectoryLocation[];
  records: ForthFleetTrackingRecord[];
  available: boolean;
  language: "en" | "th";
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onFocusMap: (id: string) => void;
  onSelectVehicle: (key: string, options?: { focusMap?: boolean }) => void;
  confirmedDriverFor?: (record: ForthFleetTrackingRecord) => string | null;
  onClose: () => void;
};

const COPY = {
  en: {
    title: "Saved locations",
    search: "Search company or address",
    all: "All categories",
    empty: "No mapped locations match these filters",
    waiting: "Waiting for Locations Directory",
    noneMapped: "No confirmed destination pins with coordinates",
    focus: "Focus on map",
    directory: "Open in Locations",
    maps: "Google Maps",
    nearby: "Nearby vehicles",
    nearbyNote: "Straight-line distance from the saved pin — not driving distance or ETA.",
    gpsVerified: "GPS verified",
    gpsUnverified: "GPS not verified",
    close: "Close locations",
    selected: "Selected location",
    count: "mapped"
  },
  th: {
    title: "สถานที่ที่บันทึก",
    search: "ค้นหาบริษัทหรือที่อยู่",
    all: "ทุกประเภท",
    empty: "ไม่มีสถานที่ที่ตรงกับตัวกรอง",
    waiting: "กำลังรอข้อมูลไดเรกทอรีสถานที่",
    noneMapped: "ยังไม่มีหมุดปลายทางที่ยืนยันพร้อมพิกัด",
    focus: "โฟกัสแผนที่",
    directory: "เปิดในไดเรกทอรีสถานที่",
    maps: "Google Maps",
    nearby: "รถใกล้เคียง",
    nearbyNote: "ระยะเส้นตรงจากหมุดที่บันทึก — ไม่ใช่ระยะทางขับรถหรือเวลาถึง",
    gpsVerified: "GPS ยืนยัน",
    gpsUnverified: "ยังไม่ยืนยัน GPS",
    close: "ปิดสถานที่",
    selected: "สถานที่ที่เลือก",
    count: "มีพิกัด"
  }
};

const PAGE_SIZE = 40;

export function ForthFleetLocationsPanel({
  locations,
  records,
  available,
  language,
  selectedId,
  onSelect,
  onFocusMap,
  onSelectVehicle,
  confirmedDriverFor,
  onClose
}: Props) {
  const copy = COPY[language];
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [page, setPage] = useState(0);
  const filtered = useMemo(() => filterFleetDirectoryLocations(locations, search, category), [locations, search, category]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageIndex = Math.min(page, pageCount - 1);
  const visible = filtered.slice(pageIndex * PAGE_SIZE, pageIndex * PAGE_SIZE + PAGE_SIZE);
  const selected = selectedId ? locations.find((location) => location.id === selectedId) ?? null : null;
  const nearby = selected
    ? findNearbyVehiclesForLocation(selected, records, { language, limit: 6 })
    : [];

  return (
    <section className="forth-locations-panel" aria-label={copy.title}>
      <header className="forth-locations-panel-header">
        <div>
          <p className="forth-locations-eyebrow">{copy.title}</p>
          <strong>{available ? `${locations.length} ${copy.count}` : "—"}</strong>
        </div>
        <button type="button" aria-label={copy.close} onClick={onClose}><X aria-hidden="true" /></button>
      </header>

      <div className="forth-locations-controls">
        <label className="forth-locations-search">
          <Search aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(0);
            }}
            placeholder={copy.search}
            aria-label={copy.search}
          />
        </label>
        <select
          aria-label={copy.all}
          value={category}
          onChange={(event) => {
            setCategory(event.target.value);
            setPage(0);
          }}
        >
          <option value="all">{copy.all}</option>
          {FLEET_LOCATION_CATEGORIES.map((value) => (
            <option key={value} value={value}>{value}</option>
          ))}
        </select>
      </div>

      {!available ? (
        <p className="forth-locations-empty">{copy.waiting}</p>
      ) : locations.length === 0 ? (
        <p className="forth-locations-empty">{copy.noneMapped}</p>
      ) : visible.length === 0 ? (
        <p className="forth-locations-empty">{copy.empty}</p>
      ) : (
        <div className="forth-locations-list">
          {visible.map((location) => (
            <button
              key={location.id}
              type="button"
              className={`forth-locations-row${selectedId === location.id ? " is-selected" : ""}`}
              onClick={() => onSelect(location.id)}
            >
              <span className={`forth-locations-category is-${location.category.toLowerCase()}`}>{location.category}</span>
              <strong>{location.companyName}</strong>
              {location.thaiName ? <span className="forth-locations-thai">{location.thaiName}</span> : null}
              <span className="forth-locations-address">{[location.address, location.province].filter(Boolean).join(" · ")}</span>
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

      {selected ? (
        <div className="forth-locations-detail" aria-label={copy.selected}>
          <p className="forth-locations-eyebrow">{selected.category}</p>
          <h3>{selected.companyName}</h3>
          {selected.thaiName ? <p className="forth-locations-thai">{selected.thaiName}</p> : null}
          <p className="forth-locations-address">{selected.address}{selected.province ? ` · ${selected.province}` : ""}</p>
          <div className="forth-locations-actions">
            <button type="button" onClick={() => onFocusMap(selected.id)}><Crosshair aria-hidden="true" />{copy.focus}</button>
            {selected.googleMapsUrl ? (
              <a href={selected.googleMapsUrl} target="_blank" rel="noopener noreferrer"><ExternalLink aria-hidden="true" />{copy.maps}</a>
            ) : null}
            <Link href={selected.directoryHref}><MapPinned aria-hidden="true" />{copy.directory}</Link>
          </div>
          <div className="forth-locations-nearby">
            <p className="forth-locations-eyebrow">{copy.nearby}</p>
            <p className="forth-locations-nearby-note">{copy.nearbyNote}</p>
            {nearby.length === 0 ? (
              <p className="forth-locations-empty">{language === "th" ? "ไม่มีรถที่มีพิกัดใกล้เคียง" : "No nearby vehicles with coordinates"}</p>
            ) : (
              nearby.map(({ key, record, distanceKm, gpsVerified, ageLabel }) => {
                const confirmed = confirmedDriverFor?.(record) ?? null;
                const forthDriver = record.reportedDriver && record.reportedDriver !== confirmed ? record.reportedDriver : null;
                const driver = confirmed ?? (forthDriver ? `${language === "th" ? "Forth (ยังไม่ยืนยัน)" : "Forth unverified"}: ${forthDriver}` : null);
                const identity = getForthTrackingVehicleIdentity(record.vehicleRegistration);
                return (
                  <button
                    key={key}
                    type="button"
                    className="forth-locations-nearby-row"
                    onClick={() => onSelectVehicle(key, { focusMap: true })}
                  >
                    <strong>{record.vehicleRegistration || "—"}</strong>
                    <span>{distanceKm < 10 ? `${distanceKm.toFixed(1)} km` : `${Math.round(distanceKm)} km`} · {gpsVerified ? copy.gpsVerified : copy.gpsUnverified}</span>
                    <span>{[driver, identity.make, identity.model, ageLabel].filter(Boolean).join(" · ")}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
