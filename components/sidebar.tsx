"use client";

import clsx from "clsx";
import { Droplets, LayoutDashboard, Menu, Route, Truck, Wallet } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useLanguage } from "@/lib/language-provider";

export function Sidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const { language, setLanguage, t } = useLanguage();

  const navItems = [
    { href: "/dashboard", label: t.nav.dashboard, icon: LayoutDashboard },
    { href: "/drivers", label: t.nav.drivers, icon: Truck },
    { href: "/fuel-logs", label: t.nav.fuelLogs, icon: Droplets },
    { href: "/transfers", label: t.nav.transfers, icon: Wallet },
    { href: "/weekly-mileage", label: t.nav.weeklyMileage, icon: Route }
  ];

  return (
    <>
      <button
        className="fixed left-3 top-3 z-50 rounded-2xl bg-slate-950 p-3 text-white shadow-soft md:hidden"
        onClick={() => setOpen((value) => !value)}
        type="button"
        aria-label={t.nav.openMenu}
      >
        <Menu className="h-5 w-5" />
      </button>

      <aside
        className={clsx(
          "fixed inset-y-0 left-0 z-40 w-[86vw] max-w-72 border-r border-white/60 bg-slate-950 px-4 py-5 text-white shadow-soft transition-transform sm:px-5 sm:py-6 md:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="mb-8 rounded-3xl border border-white/10 bg-white/[0.03] px-4 py-5">
          <div className="flex flex-col items-center justify-center text-center">
            <div className="flex h-[98px] w-full items-center justify-center sm:h-[108px]">
              <Image
                src="/logo.png"
                alt={t.common.appName}
                width={228}
                height={90}
                className="h-full w-auto max-w-[228px] object-contain brightness-105 drop-shadow-[0_6px_16px_rgba(15,23,42,0.28)]"
                priority
              />
            </div>
            <div className="mt-5 flex max-w-[224px] flex-col items-center">
              <p className="text-center text-[11px] font-medium uppercase tracking-[0.2em] text-slate-400 sm:text-xs">
                {t.common.appSubtitle}
              </p>
              <h1 className="mt-3 text-center text-[12.5px] font-semibold uppercase leading-[1.35] tracking-[0.04em] text-white sm:text-[13px]">
                {t.common.appName}
              </h1>
            </div>
          </div>
        </div>

        <nav className="space-y-2">
          {navItems.map(({ href, label, icon: Icon }) => {
            const active = pathname === href;

            return (
              <Link
                key={href}
                href={href}
                className={clsx(
                  "flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-medium transition",
                  active
                    ? "bg-white text-slate-950"
                    : "text-slate-300 hover:bg-white/10 hover:text-white"
                )}
                onClick={() => setOpen(false)}
              >
                <Icon className="h-5 w-5" />
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
            {t.common.language}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setLanguage("en")}
              className={clsx(
                "rounded-2xl px-4 py-2 text-sm font-semibold",
                language === "en"
                  ? "bg-white text-slate-950"
                  : "bg-white/5 text-slate-300 hover:bg-white/10"
              )}
            >
              EN
            </button>
            <button
              type="button"
              onClick={() => setLanguage("th")}
              className={clsx(
                "rounded-2xl px-4 py-2 text-sm font-semibold",
                language === "th"
                  ? "bg-white text-slate-950"
                  : "bg-white/5 text-slate-300 hover:bg-white/10"
              )}
            >
              TH
            </button>
          </div>
        </div>
      </aside>

      {open ? (
        <button
          className="fixed inset-0 z-30 bg-slate-950/50 md:hidden"
          onClick={() => setOpen(false)}
          type="button"
          aria-label={t.nav.closeSidebar}
        />
      ) : null}
    </>
  );
}
