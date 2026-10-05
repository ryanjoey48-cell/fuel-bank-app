"use client";

import { ExternalLink } from "lucide-react";
import { DriverDisclosure } from "./driver-disclosure";

type RouteStart = "current" | "depot" | "pickup";
type RouteDestination = "pickup" | "delivery";
type RouteUrls = { current: string | null; depot: string | null; pickup: string | null; delivery: string | null; pickupToDropoff: string | null };

const copy = {
  en: { more: "More navigation options", options: "Navigation options", current: "From my location", depot: "EES depot", pickup: "Pickup", delivery: "Delivery", full: "Full job route", missing: "Route unavailable" },
  th: { more: "ตัวเลือกนำทางเพิ่มเติม", options: "ตัวเลือกการนำทาง", current: "จากตำแหน่งฉัน", depot: "คลัง EES", pickup: "จุดรับ", delivery: "จุดส่ง", full: "เส้นทางงานทั้งหมด", missing: "ไม่มีข้อมูลเส้นทาง" }
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

export function driverNavigationRoutes(urls: RouteUrls, destination: RouteDestination) {
  const pickup = { id: "pickup", href: urls.pickup };
  const delivery = { id: "delivery", href: urls.delivery };
  return [
    destination === "pickup" ? pickup : delivery,
    { id: "depotPickup", href: selectedDriverRoute(urls, "depot", "pickup", false) },
    { id: "pickupDelivery", href: urls.pickupToDropoff },
    destination === "pickup" ? delivery : pickup,
    { id: "fullCurrent", href: urls.current },
    { id: "fullDepot", href: urls.depot }
  ].filter(route => route.href);
}

export function DriverRouteOptions({ language, pickupName, deliveryName, defaultDestination, urls }: {
  language: "en" | "th";
  pickupName: string | null;
  deliveryName: string | null;
  defaultDestination: RouteDestination;
  urls: RouteUrls;
}) {
  const l = copy[language];
  const pickup = pickupName || l.pickup;
  const delivery = deliveryName || l.delivery;
  const labels: Record<string, { from: string; to: string; detail?: string }> = {
    pickup: { from: l.current, to: pickup },
    delivery: { from: l.current, to: delivery },
    depotPickup: { from: l.depot, to: pickup },
    pickupDelivery: { from: pickup, to: delivery },
    fullCurrent: { from: l.current, to: l.full, detail: pickup + " → " + delivery },
    fullDepot: { from: l.depot, to: l.full, detail: pickup + " → " + delivery }
  };
  const routes = driverNavigationRoutes(urls, defaultDestination);

  return <DriverDisclosure title={l.more} compact>
    <div className="driver-navigation-options border-t border-[var(--driver-border)] pb-1 pt-2">
      <p className="driver-eyebrow mb-1">{l.options}</p>
      <div className="divide-y divide-[var(--driver-border)]">
        {routes.map(({ id, href }) => <a key={id} href={href!} target="_blank" rel="noreferrer" className="driver-navigation-row flex min-h-11 items-center justify-between gap-3 py-2 text-sm text-[#152638]">
          <span className="min-w-0 break-words"><span>{labels[id].from}</span><span aria-hidden="true" className="px-1 text-slate-400">→</span><span className="font-semibold">{labels[id].to}</span>{labels[id].detail ? <span className="mt-0.5 block text-xs text-slate-500">{labels[id].detail}</span> : null}</span>
          <ExternalLink aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-400" />
        </a>)}
      </div>
      {!routes.length ? <p role="status" className="py-2 text-xs text-slate-500">{l.missing}</p> : null}
    </div>
  </DriverDisclosure>;
}
