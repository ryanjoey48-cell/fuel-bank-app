"use client";

import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { DriverDisclosure } from "./driver-disclosure";

type RouteStart = "current" | "depot" | "pickup";
type RouteDestination = "pickup" | "delivery";
type RouteUrls = { current: string | null; depot: string | null; pickup: string | null; delivery: string | null; pickupToDropoff: string | null };

const copy = {
  en: { more: "More route options", start: "Start from", go: "Go to", current: "My location", depot: "EES depot", pickup: "Pickup", delivery: "Delivery", via: "Via pickup", open: "Open route in Google Maps", missing: "Route unavailable", depotHelp: "Delivery routes from the depot include the pickup stop." },
  th: { more: "ตัวเลือกเส้นทางเพิ่มเติม", start: "เริ่มจาก", go: "ไปที่", current: "ตำแหน่งฉัน", depot: "คลัง EES", pickup: "จุดรับ", delivery: "จุดส่ง", via: "ผ่านจุดรับ", open: "เปิดเส้นทางใน Google Maps", missing: "ไม่มีข้อมูลเส้นทาง", depotHelp: "เส้นทางจากคลังไปจุดส่งจะแวะจุดรับก่อน" }
};

// Reuse the existing Maps URLs, including their verified place IDs and waypoints.
// Depot → pickup combines the existing depot origin with the existing pickup destination.
export function selectedDriverRoute(urls: RouteUrls, start: RouteStart, destination: RouteDestination, viaPickup: boolean) {
  if (start === "pickup") return destination === "delivery" ? urls.pickupToDropoff : null;
  if (start === "current") return destination === "pickup" ? urls.pickup : viaPickup ? urls.current : urls.delivery;
  if (destination === "delivery") return urls.depot;
  if (!urls.depot || !urls.pickup) return null;
  const route = new URL(urls.pickup);
  const depot = new URL(urls.depot);
  for (const key of ["origin", "origin_place_id"]) {
    const value = depot.searchParams.get(key);
    if (value) route.searchParams.set(key, value);
  }
  return route.toString();
}

export function DriverRouteOptions({ language, pickupName, deliveryName, defaultDestination, urls }: {
  language: "en" | "th";
  pickupName: string | null;
  deliveryName: string | null;
  defaultDestination: RouteDestination;
  urls: RouteUrls;
}) {
  const l = copy[language];
  const [start, setStart] = useState<RouteStart>("current");
  const [destination, setDestination] = useState<RouteDestination>(defaultDestination);
  const [viaPickup, setViaPickup] = useState(false);
  const href = selectedDriverRoute(urls, start, destination, viaPickup);
  const option = "driver-route-option min-h-11 min-w-0 rounded-lg border px-2 py-1.5 text-xs font-semibold";

  return <DriverDisclosure title={l.more} compact>
    <div className="driver-route-options space-y-2 border-t border-[var(--driver-border)] pb-2 pt-3">
      <fieldset>
        <legend className="driver-eyebrow mb-1">{l.start}</legend>
        <div className="grid grid-cols-3 gap-1.5">
          {(["current", "depot", "pickup"] as const).map(value => <button key={value} type="button" className={option} aria-pressed={start === value} disabled={value === "depot" ? !urls.depot : value === "pickup" ? !urls.pickupToDropoff : !urls.pickup && !urls.delivery} onClick={() => { setStart(value); if (value === "pickup") setDestination("delivery"); }}>{l[value]}</button>)}
        </div>
      </fieldset>
      <fieldset>
        <legend className="driver-eyebrow mb-1">{l.go}</legend>
        <div className="grid grid-cols-2 gap-1.5">
          {(["pickup", "delivery"] as const).map(value => <button key={value} type="button" className={option} aria-pressed={destination === value} disabled={value === "pickup" ? !urls.pickup || start === "pickup" : !urls.delivery} onClick={() => setDestination(value)}><span className="block break-words text-sm">{(value === "pickup" ? pickupName : deliveryName) || "—"}</span><span className="block text-[11px] font-normal">{l[value]}</span></button>)}
        </div>
      </fieldset>
      {destination === "delivery" && start === "current" ? <label className="flex min-h-11 cursor-pointer items-center gap-2 text-xs text-slate-600"><input type="checkbox" className="h-4 w-4 accent-[var(--driver-primary)]" checked={viaPickup} disabled={!urls.current} onChange={e => setViaPickup(e.target.checked)} />{l.via} · {pickupName || "—"}</label> : null}
      {destination === "delivery" && start === "depot" ? <p className="text-xs leading-4 text-slate-500">{l.depotHelp}</p> : null}
      {href ? <a href={href} target="_blank" rel="noreferrer" className="driver-route-open flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[var(--driver-border)] bg-slate-50 px-3 text-center text-xs font-semibold text-[#152638]">{l.open}<ExternalLink aria-hidden="true" className="h-3.5 w-3.5 shrink-0" /></a> : <p role="status" className="text-xs text-slate-500">{l.missing}</p>}
    </div>
  </DriverDisclosure>;
}
