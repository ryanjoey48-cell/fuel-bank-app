"use client";

import { useMemo } from "react";
import {
  EES_LORRY_DEPOT_FORTH_COORDINATES,
  EES_LORRY_DEPOT_FORTH_LOCATION_ID,
  EES_LORRY_DEPOT_PROVISIONAL_RADIUS_METERS,
  EES_OFFICE_FORTH_LOCATION_ID
} from "@/lib/ees-depot-sites";
import { classifyDepotProximity, summarizeDepotProximity } from "@/lib/ees-depot-proximity";
import {
  formatForthTrackingTime,
  getForthReportedActivity,
  getForthFleetRecordKey,
  isForthGpsPositionVerified
} from "@/lib/forth-tracking-view";
import type { ForthFleetTrackingRecord } from "@/lib/forth-tracking-server";
import { useLanguage } from "@/lib/language-provider";

type Props = {
  records: ForthFleetTrackingRecord[];
  fetchedAt: string | null;
  loading: boolean;
  snapshotStale: boolean;
  onSelect: (key: string) => void;
  confirmedDriverFor: (record: ForthFleetTrackingRecord) => string | null;
};

export function EesDepotOperationsPanel({ records, fetchedAt, loading, snapshotStale, onSelect, confirmedDriverFor }: Props) {
  const { language } = useLanguage();
  const th = language === "th";
  const rows = useMemo(() => classifyDepotProximity(records.map((record, index) => ({
    vehicleKey: getForthFleetRecordKey(record, index),
    registration: record.vehicleRegistration,
    latitude: record.latitude,
    longitude: record.longitude,
    lastGpsTimestamp: record.lastGpsTimestamp,
    gpsVerified: isForthGpsPositionVerified(record),
    positionStale: snapshotStale || record.timestampStatus === "stale",
    speedKmh: record.speed,
    activity: getForthReportedActivity(record),
    driverName: confirmedDriverFor(record)
  }))), [records, confirmedDriverFor, snapshotStale]);

  const summary = useMemo(() => summarizeDepotProximity(rows), [rows]);
  const visible = rows.filter((row) => row.band === "inside_depot" || row.band === "nearby_depot" || row.band === "near_office");

  return (
    <section className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-800">
            {th ? "ปฏิบัติการลานจอดรถ EES" : "EES depot operations"}
          </p>
          <h2 className="mt-1 text-lg font-bold text-emerald-950">
            {th ? "รถใกล้ลานจอด / สำนักงาน" : "Vehicles near depot / office"}
          </h2>
          <p className="mt-1 text-xs text-emerald-900/80">
            {th
              ? `ลานจอด Forth #${EES_LORRY_DEPOT_FORTH_LOCATION_ID} · รัศมีชั่วคราว ${EES_LORRY_DEPOT_PROVISIONAL_RADIUS_METERS} ม. · สำนักงาน #${EES_OFFICE_FORTH_LOCATION_ID} แยกต่างหาก · ไม่สร้างเวลาเข้า/ออกจากจุดเดียว`
              : `Depot Forth #${EES_LORRY_DEPOT_FORTH_LOCATION_ID} · provisional ${EES_LORRY_DEPOT_PROVISIONAL_RADIUS_METERS} m · office #${EES_OFFICE_FORTH_LOCATION_ID} is separate · one GPS snapshot never invents arrival/departure`}
          </p>
          <p className="mt-1 text-[11px] text-slate-600">
            {EES_LORRY_DEPOT_FORTH_COORDINATES.latitude}, {EES_LORRY_DEPOT_FORTH_COORDINATES.longitude}
            {fetchedAt ? ` · ${th ? "อัปเดต" : "updated"} ${formatForthTrackingTime(fetchedAt, language) ?? fetchedAt}` : ""}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        <span className="rounded-full bg-emerald-200/80 px-3 py-1.5 font-semibold text-emerald-950">
          {th ? "รายงานในรัศมีลานจอด" : "Reported inside depot"} · {summary.insideDepot}
        </span>
        <span className="rounded-full bg-sky-100 px-3 py-1.5 font-semibold text-sky-950">
          {th ? "รายงานใกล้ลานจอด (≤500 ม.)" : "Reported near depot (≤500 m)"} · {summary.nearbyDepot}
        </span>
        <span className="rounded-full bg-amber-100 px-3 py-1.5 font-semibold text-amber-950">
          {th ? "รายงานใกล้สำนักงาน" : "Reported near office"} · {summary.nearOffice}
        </span>
      </div>

      {snapshotStale ? <p className="mt-3 text-sm text-amber-900" role="status">{th ? "ข้อมูลเก่า — ระยะจากตำแหน่งที่รายงานล่าสุด" : "Stale snapshot — distances from last reported positions"}</p> : null}

      {visible.length ? (
        <div className="mt-3 max-h-72 overflow-y-auto divide-y divide-emerald-100 rounded-xl border border-emerald-100 bg-white">
          {visible.map((row) => (
            <button type="button" onClick={() => onSelect(row.vehicleKey)} key={row.vehicleKey} className="grid w-full text-left hover:bg-emerald-50 gap-1 px-3 py-2.5 text-sm sm:grid-cols-[minmax(0,1fr)_auto]">
              <div>
                <p className="font-bold text-slate-900">
                  {row.registration || (th ? "ไม่ทราบทะเบียน" : "Registration unavailable")}
                  <span className="ml-2 text-xs font-semibold text-emerald-800">
                    {row.band === "inside_depot"
                      ? (th ? "ในลานจอด" : "inside depot")
                      : row.band === "nearby_depot"
                        ? (th ? "ใกล้ลานจอด" : "nearby depot")
                        : (th ? "ใกล้สำนักงาน" : "near office")}
                  </span>
                </p>
                <p className="text-xs text-slate-600">
                  {row.distanceToDepotMeters != null ? `${Math.round(row.distanceToDepotMeters)} m → depot` : "—"}
                  {row.distanceToOfficeMeters != null ? ` · ${Math.round(row.distanceToOfficeMeters)} m → office` : ""}
                  {row.driverName ? ` · ${row.driverName}` : ""}
                </p>
                <p className="text-xs text-slate-500">
                  {row.positionStale ? (th ? "ข้อมูลตำแหน่งเก่า" : "Stale position") : `GPS ${row.gpsVerified ? (th ? "ยืนยันได้" : "verified") : (th ? "ยังไม่ยืนยัน" : "unverified")}`}
                  {row.lastGpsTimestamp
                    ? ` · ${formatForthTrackingTime(row.lastGpsTimestamp, language) ?? row.lastGpsTimestamp}`
                    : ""}
                  {row.speedKmh != null ? ` · ${Math.round(row.speedKmh)} km/h` : ""}
                  {row.activity ? ` · ${row.activity}` : ""}
                </p>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-sm text-slate-600">
          {loading
            ? (th ? "กำลังโหลดตำแหน่งรถ" : "Loading live positions")
            : (th ? "ขณะนี้ไม่มีรถในรัศมีลานจอดหรือใกล้เคียง" : "No reported positions inside or near the depot / office radii.")}
        </p>
      )}
    </section>
  );
}
