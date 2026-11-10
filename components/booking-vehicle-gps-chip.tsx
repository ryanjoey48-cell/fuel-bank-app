"use client";

import { useEffect, useState } from "react";
import { geofenceDistanceMeters, validGeofenceCoordinates } from "@/lib/fleet-geofence-engine";
import { formatForthTrackingTime, isForthGpsPositionVerified } from "@/lib/forth-tracking-view";
import type { ForthFleetTrackingRecord } from "@/lib/forth-tracking-server";
import { supabase } from "@/lib/supabase";
import { useLanguage } from "@/lib/language-provider";

type Props = {
  vehicleRegistration: string | null | undefined;
  /** Dropoff (or pickup) coordinates when the booking has a verified pin — used only as a read-only proximity hint. */
  destinationLatitude?: number | null;
  destinationLongitude?: number | null;
  destinationLabel?: string | null;
};

type ChipState = {
  status: "loading" | "unavailable" | "ready";
  label: string;
  detail: string;
};

function normalizeReg(value: string | null | undefined) {
  return String(value ?? "").replace(/[\s-]/g, "").toUpperCase();
}

const NEAR_DESTINATION_METERS = 150;

let cachedFleet: { fetchedAt: number; records: ForthFleetTrackingRecord[] } | null = null;

async function loadFleet(accessToken: string) {
  if (cachedFleet && Date.now() - cachedFleet.fetchedAt < 45_000) return cachedFleet.records;
  const response = await fetch("/api/admin/forth-tracking/vehicles", {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store"
  });
  if (!response.ok) return [];
  const payload = await response.json();
  const records = (payload.records ?? []) as ForthFleetTrackingRecord[];
  cachedFleet = { fetchedAt: Date.now(), records };
  return records;
}

/** Read-only GPS context for Booking Diary cards. Never writes booking or finance data. */
export function BookingVehicleGpsChip({
  vehicleRegistration,
  destinationLatitude,
  destinationLongitude,
  destinationLabel
}: Props) {
  const { language } = useLanguage();
  const th = language === "th";
  const [chip, setChip] = useState<ChipState>({
    status: "loading",
    label: th ? "GPS…" : "GPS…",
    detail: ""
  });

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const reg = normalizeReg(vehicleRegistration);
      if (!reg) {
        if (!cancelled) {
          setChip({ status: "unavailable", label: th ? "ไม่มีทะเบียน" : "No plate", detail: "" });
        }
        return;
      }
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) throw new Error("auth");
        const records = await loadFleet(session.access_token);
        const match = records.find((record) => normalizeReg(record.vehicleRegistration) === reg);
        if (!match || match.latitude == null || match.longitude == null) {
          if (!cancelled) {
            setChip({
              status: "unavailable",
              label: th ? "ไม่มี GPS สด" : "No live GPS",
              detail: ""
            });
          }
          return;
        }
        const verified = isForthGpsPositionVerified(match);
        const when = formatForthTrackingTime(match.lastGpsTimestamp, language) ?? match.lastGpsTimestamp ?? "—";
        let destinationHint = "";
        if (
          validGeofenceCoordinates(destinationLatitude, destinationLongitude) &&
          validGeofenceCoordinates(match.latitude, match.longitude)
        ) {
          const distance = geofenceDistanceMeters(
            { latitude: match.latitude, longitude: match.longitude },
            { latitude: destinationLatitude as number, longitude: destinationLongitude as number }
          );
          if (distance <= NEAR_DESTINATION_METERS) {
            const place = destinationLabel?.trim() || (th ? "ปลายทางลูกค้า" : "customer destination");
            destinationHint = th
              ? ` · ใกล้ ${place} (~${Math.round(distance)} ม.)`
              : ` · near ${place} (~${Math.round(distance)} m)`;
          }
        }
        if (!cancelled) {
          setChip({
            status: "ready",
            label: verified ? (th ? "GPS ยืนยัน" : "GPS verified") : (th ? "GPS รายงาน" : "GPS reported"),
            detail: `${match.latitude.toFixed(5)}, ${match.longitude.toFixed(5)} · ${when}${destinationHint}`
          });
        }
      } catch {
        if (!cancelled) {
          setChip({
            status: "unavailable",
            label: th ? "GPS ไม่พร้อม" : "GPS unavailable",
            detail: ""
          });
        }
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [
    vehicleRegistration,
    destinationLatitude,
    destinationLongitude,
    destinationLabel,
    language,
    th
  ]);

  return (
    <span
      className={`inline-flex max-w-full flex-col rounded-md px-2 py-1 text-[11px] font-semibold ${
        chip.status === "ready"
          ? "bg-emerald-50 text-emerald-900"
          : "bg-slate-100 text-slate-600"
      }`}
      title={chip.detail || undefined}
    >
      <span>{chip.label}</span>
      {chip.detail ? <span className="font-normal text-[10px] opacity-80 truncate">{chip.detail}</span> : null}
    </span>
  );
}
