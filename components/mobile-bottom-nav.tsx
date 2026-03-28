"use client";

import clsx from "clsx";
import { Droplets, LayoutDashboard, Route, Truck, Wallet } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLanguage } from "@/lib/language-provider";

export function MobileBottomNav() {
  const pathname = usePathname();
  const { t } = useLanguage();

  const items = [
    { href: "/dashboard", label: t.nav.dashboard, icon: LayoutDashboard },
    { href: "/fuel-logs", label: t.nav.fuelLogs, icon: Droplets },
    { href: "/transfers", label: t.nav.transfers, icon: Wallet },
    { href: "/drivers", label: t.nav.drivers, icon: Truck },
    { href: "/weekly-mileage", label: t.nav.weeklyMileage, icon: Route }
  ];

  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200/75 bg-[rgba(255,255,255,0.96)] px-2 pb-[calc(env(safe-area-inset-bottom,0px)+0.45rem)] pt-2 shadow-[0_-10px_30px_rgba(15,23,42,0.08)] backdrop-blur-xl md:hidden">
      <div className="mx-auto grid max-w-lg grid-cols-5 gap-1">
        {items.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;

          return (
            <Link
              key={href}
              href={href}
              className={clsx(
                "flex min-h-[62px] flex-col items-center justify-center gap-1 rounded-2xl px-1.5 py-2 text-center transition",
                active
                  ? "bg-slate-950 text-white shadow-[0_12px_24px_rgba(15,23,42,0.14)]"
                  : "text-slate-500 hover:bg-slate-100/90 hover:text-slate-900"
              )}
            >
              <Icon className={clsx("h-[18px] w-[18px]", active ? "text-white" : "text-slate-400")} />
              <span className="line-clamp-2 text-[10px] font-semibold leading-[1.15]">{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
