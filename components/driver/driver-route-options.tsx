"use client";

import { ExternalLink, MapPin, Navigation2, Route, Warehouse } from "lucide-react";
import { DriverDisclosure } from "./driver-disclosure";

type RouteStart = "current" | "depot" | "pickup";
type RouteDestination = "pickup" | "delivery";
type RouteUrls = { current: string | null; depot: string | null; pickup: string | null; delivery: string | null; pickupToDropoff: string | null };

const copy = {
  en: {
    more: "Route options",
    depotTo: "EES Depot → Pickup",
    pickupToDelivery: "Pickup → Delivery",
    fullRoute: "Full Job Route",
    pickup: "Pickup",
    delivery: "Delivery",
    depot: "EES Depot",
    herePickup: "My location → Pickup",
    hereDelivery: "My location → Delivery",
    missing: "No additional routes available"
  },
  th: {
    more: "ตัวเลือกเส้นทาง",
    depotTo: "คลัง EES → จุดรับ",
    pickupToDelivery: "จุดรับไปจุดส่ง",
    fullRoute: "เส้นทางงานทั้งหมด",
    pickup: "จุดรับ",
    delivery: "จุดส่ง",
    depot: "คลัง EES",
    herePickup: "ตำแหน่งฉัน → จุดรับ",
    hereDelivery: "ตำแหน่งฉัน → จุดส่ง",
    missing: "ไม่มีเส้นทางเพิ่มเติม"
  }
} as const;

// Keep the existing URL construction untouched so verified place IDs/waypoints continue to work.
export function selectedDriverRoute(urls: RouteUrls, start: RouteStart, destination: RouteDestination, viaPickup: boolean) {
  if (start === "pickup") return destination === "delivery" ? urls.pickupToDropoff : null;
  if (start === "current") return destination === "pickup" ? urls.pickup : viaPickup ? urls.current : urls.delivery;
  return urls.depot;
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

  // This is a labelled segment; Full Job Route below retains the whole journey.
  const depotPickup = urls.depot && urls.pickup ? new URL(urls.pickup) : null;
  if (depotPickup && urls.depot) {
    const full = new URL(urls.depot);
    for (const key of ["origin", "origin_place_id"]) {
      const value = full.searchParams.get(key);
      if (value) depotPickup.searchParams.set(key, value);
    }
  }
  const destination = defaultDestination === "pickup" ? pickup : delivery;
  const routes = [
    { id: "depotPickup", title: l.depotTo, detail: l.depot + " → " + pickup, href: depotPickup?.toString(), Icon: Warehouse },
    { id: "pickupDelivery", title: l.pickupToDelivery, detail: pickup + " → " + delivery, href: urls.pickupToDropoff, Icon: MapPin },
    { id: "current", title: defaultDestination === "pickup" ? l.herePickup : l.hereDelivery, detail: destination,
      href: defaultDestination === "pickup" ? urls.pickup : urls.delivery, Icon: Navigation2 },
    { id: "full", title: l.fullRoute, detail: l.depot + " → " + pickup + " → " + delivery, href: urls.depot, Icon: Route }
  ].filter(route => route.href);

  return (
    <DriverDisclosure title={l.more} id="job-route-options">
      <div className="border-t border-[var(--driver-border)] bg-[var(--driver-surface)] px-1 py-1">
        {routes.length ? (
          <div className="divide-y divide-[var(--driver-border)]">
            {routes.map(({ id, title, detail, href, Icon }) => (
              <a
                key={id}
                href={href!}
                target="_blank"
                rel="noreferrer"
                className="group flex min-h-14 items-center gap-3 rounded-xl px-2 py-2.5 text-[var(--driver-text)] transition-colors hover:bg-[var(--driver-surface)] active:bg-[var(--driver-surface)]"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--driver-border)] bg-[var(--driver-surface-soft)] driver-accent">
                  <Icon aria-hidden="true" className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold leading-5">{title}</span>
                  <span className="mt-0.5 block break-words text-xs text-[var(--driver-text-muted)]">{detail}</span>
                </span>
                <ExternalLink aria-hidden="true" className="h-4 w-4 shrink-0 text-[var(--driver-text-muted)]" />
              </a>
            ))}
          </div>
        ) : (
          <p role="status" className="px-2 py-3 text-xs text-[var(--driver-text-muted)]">{l.missing}</p>
        )}
      </div>
    </DriverDisclosure>
  );
}
