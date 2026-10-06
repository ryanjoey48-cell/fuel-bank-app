"use client";

import { ExternalLink, MapPin, Route, Warehouse } from "lucide-react";
import { DriverDisclosure } from "./driver-disclosure";

type RouteStart = "current" | "depot" | "pickup";
type RouteDestination = "pickup" | "delivery";
type RouteUrls = { current: string | null; depot: string | null; pickup: string | null; delivery: string | null; pickupToDropoff: string | null };

const copy = {
  en: {
    more: "More navigation options",
    depotTo: "From EES depot",
    pickupToDelivery: "Pickup → Delivery",
    fullRoute: "Full job route",
    pickup: "Pickup",
    delivery: "Delivery",
    missing: "No additional routes available"
  },
  th: {
    more: "ตัวเลือกนำทางเพิ่มเติม",
    depotTo: "จากคลัง EES",
    pickupToDelivery: "จุดรับไปจุดส่ง",
    fullRoute: "เส้นทางงานทั้งหมด",
    pickup: "จุดรับ",
    delivery: "จุดส่ง",
    missing: "ไม่มีเส้นทางเพิ่มเติม"
  }
} as const;

// Keep the existing URL construction untouched so verified place IDs/waypoints continue to work.
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
  const pickup = pickupName || l.pickup;
  const delivery = deliveryName || l.delivery;
  const currentDestination = defaultDestination === "pickup" ? pickup : delivery;

  const routes = [
    {
      id: "depot",
      title: l.depotTo,
      detail: `EES → ${currentDestination}`,
      href: defaultDestination === "pickup"
        ? selectedDriverRoute(urls, "depot", "pickup", false)
        : urls.depot,
      Icon: Warehouse
    },
    {
      id: "pickupDelivery",
      title: l.pickupToDelivery,
      detail: `${pickup} → ${delivery}`,
      href: urls.pickupToDropoff,
      Icon: MapPin
    },
    {
      id: "full",
      title: l.fullRoute,
      detail: `EES → ${pickup} → ${delivery}`,
      href: urls.depot,
      Icon: Route
    }
  ].filter((route) => route.href);

  return (
    <DriverDisclosure title={l.more} compact>
      <div className="border-t border-[#ddd5c9] bg-[#f8f3eb] px-1 py-1">
        {routes.length ? (
          <div className="divide-y divide-[var(--driver-border)]">
            {routes.map(({ id, title, detail, href, Icon }) => (
              <a
                key={id}
                href={href!}
                target="_blank"
                rel="noreferrer"
                className="group flex min-h-14 items-center gap-3 rounded-xl px-2 py-2.5 text-[#152638] transition-colors hover:bg-[#eef2f5] active:bg-[#e3e9ed]"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#d9e0e6] bg-[#eaf0f4] text-slate-600">
                  <Icon aria-hidden="true" className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold leading-5">{title}</span>
                  <span className="mt-0.5 block truncate text-xs text-slate-500">{detail}</span>
                </span>
                <ExternalLink aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-400" />
              </a>
            ))}
          </div>
        ) : (
          <p role="status" className="px-2 py-3 text-xs text-slate-500">{l.missing}</p>
        )}
      </div>
    </DriverDisclosure>
  );
}
