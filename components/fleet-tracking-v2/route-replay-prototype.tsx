"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import { normalizeHistoricalLog } from "@/lib/forth-history-log";
import { FLEET_TRACKING_V2_TILE_ATTRIBUTION, FLEET_TRACKING_V2_TILE_URL } from "@/lib/fleet-tracking-v2/map-engine";

const fixtureDevice = "synthetic-device";
const fixture = [
  { gpsID: fixtureDevice, dateTime: "2026-10-24T08:00:00+07:00", GPS: "1", GPRS: "1", positionSource: "GPS", Latitude: 13.7339, Longitude: 100.5168, Speed: 0, Engine: "1", Distance: 0 },
  { gpsID: fixtureDevice, dateTime: "2026-10-24T08:02:00+07:00", GPS: "1", GPRS: "1", positionSource: "GPS", Latitude: 13.7371, Longitude: 100.5192, Speed: 24, Engine: "1", Distance: 410 },
  { gpsID: fixtureDevice, dateTime: "2026-10-24T08:04:00+07:00", GPS: "0", GPRS: "1", positionSource: "LBS", Latitude: 13.7401, Longitude: 100.5211, Speed: 17, Engine: "1", Distance: 320 },
  { gpsID: fixtureDevice, dateTime: "2026-10-24T08:06:00+07:00", GPS: "0", GPRS: "1", positionSource: "Unknown", Latitude: null, Longitude: null, Speed: 0, Engine: "1" },
  { gpsID: fixtureDevice, dateTime: "2026-10-24T08:08:00+07:00", GPS: "1", GPRS: "1", positionSource: "GPS", Latitude: 13.7450, Longitude: 100.5261, Speed: 29, Engine: "1", Distance: 820 },
  { gpsID: fixtureDevice, dateTime: "2026-10-24T08:25:00+07:00", GPS: "1", GPRS: "1", positionSource: "GPS", Latitude: 13.7521, Longitude: 100.5337, Speed: 0, Engine: "0", Distance: 1110 },
  { gpsID: fixtureDevice, dateTime: "2026-10-24T08:27:00+07:00", GPS: "1", GPRS: "1", positionSource: "GPS", Latitude: 13.7524, Longitude: 100.5340, Speed: 0, Engine: "0", Distance: 0 }
];

const replay = normalizeHistoricalLog(fixture, fixtureDevice);

export function RouteReplayPrototype() {
  const mapNode = useRef<HTMLDivElement | null>(null);
  const map = useRef<import("leaflet").Map | null>(null);
  const layer = useRef<import("leaflet").LayerGroup | null>(null);
  const leaflet = useRef<typeof import("leaflet") | null>(null);
  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [date, setDate] = useState("2026-10-24");
  const [start, setStart] = useState("08:00");
  const [end, setEnd] = useState("08:30");
  const visible = useMemo(() => {
    if (!replay || start >= end) return null;
    const points = date === "2026-10-24" ? replay.points.map((point, index) => ({ point, index })).filter(({ point }) => {
      const localTime = /^2026-10-24T(\d\d:\d\d)/.exec(point.sourceTimestamp ?? "")?.[1];
      return localTime !== undefined && localTime >= start && localTime <= end;
    }) : [];
    const indices = new Set(points.map(({ index }) => index));
    return { points, segments: replay.segments.filter(segment => indices.has(segment.fromIndex) && indices.has(segment.toIndex)) };
  }, [date, start, end]);

  useEffect(() => {
    let cancelled = false;
    async function startMap() {
      const loaded = await import("leaflet");
      const L = (loaded as unknown as { default?: typeof import("leaflet") }).default ?? loaded;
      if (cancelled || !mapNode.current) return;
      const instance = L.map(mapNode.current, { zoomControl: true }).setView([13.742, 100.523], 12);
      L.tileLayer(FLEET_TRACKING_V2_TILE_URL, { attribution: FLEET_TRACKING_V2_TILE_ATTRIBUTION, maxZoom: 18 }).addTo(instance);
      layer.current = L.layerGroup().addTo(instance);
      map.current = instance;
      leaflet.current = L;
      setReady(true);
    }
    void startMap().catch(() => { if (!cancelled) setMapError(true); });
    return () => { cancelled = true; map.current?.remove(); map.current = null; layer.current = null; };
  }, []);

  useEffect(() => {
    const L = leaflet.current, group = layer.current;
    if (!ready || !L || !group || !visible || !replay) return;
    group.clearLayers();
    for (const segment of visible.segments) {
      const a = replay.points[segment.fromIndex], b = replay.points[segment.toIndex];
      L.polyline([[a.latitude!, a.longitude!], [b.latitude!, b.longitude!]], { color: "#6b3f9c", weight: 4, opacity: 0.85 }).addTo(group);
    }
    for (const { point, index } of visible.points) {
      if (point.latitude === null || point.longitude === null) continue;
      const color = point.verifiedGps ? index === selected ? "#3f176d" : "#6b3f9c" : "#d18b2f";
      L.circleMarker([point.latitude, point.longitude], { radius: index === selected ? 9 : 6, color, fillColor: color, fillOpacity: point.verifiedGps ? 0.95 : 0.35, weight: 2 })
        .bindTooltip(`${point.sourceTimestamp ?? "Time unavailable"} · ${point.verifiedGps ? "GPS verified in fixture" : "Unverified position"}`)
        .on("click", () => setSelected(index)).addTo(group);
    }
  }, [ready, selected, visible]);

  function selectPoint(index: number) {
    setSelected(index);
    const point = replay?.points[index];
    if (point?.verifiedGps && point.latitude !== null && point.longitude !== null) map.current?.setView([point.latitude, point.longitude], 14);
  }

  return <main className="mx-auto max-w-7xl space-y-4 px-4 py-5 text-slate-900">
    <header className="rounded-2xl border border-purple-200 bg-amber-50 p-4">
      <p className="text-xs font-bold uppercase tracking-wider text-purple-800">Development fixture · simulated readings · not live Forth data</p>
      <h1 className="mt-1 text-2xl font-semibold">Historical GPS route replay prototype</h1>
      <p className="mt-1 text-sm">Synthetic vehicle 3ฒน-0000 · 24 October 2026. Purple points satisfy the fixture GPS checks; amber points are unverified. Lines stop at missing positions and long gaps.</p>
    </header>
    <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-purple-100 bg-white p-4">
      <label className="text-sm font-medium">Vehicle<select className="mt-1 block rounded-lg border p-2" value="fixture" onChange={() => undefined}><option value="fixture">3ฒน-0000 — simulated</option></select></label>
      <label className="text-sm font-medium">Date<input className="mt-1 block rounded-lg border p-2" type="date" value={date} onChange={event => setDate(event.target.value)} /></label>
      <label className="text-sm font-medium">From<input className="mt-1 block rounded-lg border p-2" type="time" value={start} onChange={event => setStart(event.target.value)} /></label>
      <label className="text-sm font-medium">To<input className="mt-1 block rounded-lg border p-2" type="time" value={end} onChange={event => setEnd(event.target.value)} /></label>
      <span className="text-sm text-slate-600">{visible?.points.length ?? 0} readings · {visible?.segments.length ?? 0} cautious segments · distance withheld pending live validation</span>
    </div>
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
      <div className="relative min-h-[420px] overflow-hidden rounded-2xl border border-purple-100 bg-slate-100 lg:min-h-[65vh]">
        <div ref={mapNode} aria-label="Synthetic historical route map" className="absolute inset-0" />
        {mapError ? <p role="alert" className="absolute inset-x-4 top-4 rounded-lg bg-white p-3 text-sm">Map unavailable. The source readings remain listed.</p> : null}
      </div>
      <section className="max-h-[65vh] overflow-y-auto rounded-2xl border border-purple-100 bg-white p-3" aria-label="Historical source readings">
        <h2 className="px-2 pb-2 font-semibold">Source readings</h2>
        {!visible ? <p className="p-2 text-sm">Choose an end time after the start time.</p> : null}
        {visible?.points.map(({ point, index }) => <button type="button" key={index} onClick={() => selectPoint(index)} className={`mb-2 w-full rounded-xl border p-3 text-left text-sm ${selected === index ? "border-purple-500 bg-purple-50" : "border-slate-200"}`}>
          <span className="font-semibold">{point.sourceTimestamp ?? "Time unavailable"}</span>
          <span className="ml-2 text-xs">{point.verifiedGps ? "GPS verified in fixture" : point.coordinateStatus === "missing" ? "No position" : "Unverified position"}{index === replay?.firstVerifiedIndex ? " · first verified" : ""}{index === replay?.lastVerifiedIndex ? " · last verified" : ""}</span>
          <span className="mt-1 block text-slate-600">{point.speedKph === null ? "Speed unavailable" : `${point.speedKph} km/h`} · Engine {point.engineOn === null ? "unknown" : point.engineOn ? "on" : "off"} · Source {point.positionSource ?? "unknown"}</span>
        </button>)}
      </section>
    </div>
    <p className="text-sm text-slate-600">First and last verified positions are marked by their source times in the list. Lines are straight visual connections between accepted consecutive samples, not road-matched travel or measured distance.</p>
  </main>;
}
