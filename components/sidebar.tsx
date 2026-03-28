"use client";

import clsx from "clsx";
import { Droplets, LayoutDashboard, Menu, Route, Truck, Wallet } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useLanguage } from "@/lib/language-provider";

export function Sidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const { language, setLanguage, t } = useLanguage();

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

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
        className="mobile-menu-trigger fixed z-50 flex h-12 w-12 items-center justify-center rounded-2xl border border-white/80 bg-white/94 text-slate-900 shadow-[0_14px_30px_rgba(15,23,42,0.12)] backdrop-blur md:hidden"
        onClick={() => setOpen((value) => !value)}
        type="button"
        aria-label={t.nav.openMenu}
        aria-expanded={open}
      >
        <Menu className="h-5 w-5" />
      </button>

      <aside
        className={clsx(
          "fixed inset-y-0 left-0 z-40 w-[86vw] max-w-72 border-r border-[#312e81]/30 bg-[linear-gradient(180deg,#15162d_0%,#1f1b3d_100%)] px-4 py-4 text-white shadow-[0_22px_48px_rgba(15,23,42,0.28)] transition-transform sm:px-5 sm:py-5 md:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="mb-8 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
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
            <div className="mt-4 flex max-w-[224px] flex-col items-center">
              <p className="text-center text-[11px] font-medium uppercase tracking-[0.2em] text-slate-300 sm:text-xs">
                {t.common.appSubtitle}
              </p>
              <h1 className="mt-2.5 text-center text-[12px] font-semibold uppercase leading-[1.35] tracking-[0.03em] text-white sm:text-[12.5px]">
                {t.common.appName}
              </h1>
            </div>
          </div>
        </div>

        <nav className="space-y-2.5">
          {navItems.map(({ href, label, icon: Icon }) => {
            const active = pathname === href;

            return (
              <Link
                key={href}
                href={href}
                className={clsx(
                  "flex min-h-[48px] items-center gap-2.5 rounded-xl px-3 py-2.5 text-[13px] font-medium transition duration-200",
                  active
                    ? "border-l-2 border-brand-400 bg-brand-400/10 pl-[10px] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                    : "text-slate-300 hover:bg-white/[0.03] hover:text-white"
                )}
                onClick={() => setOpen(false)}
              >
                <Icon className={clsx("h-4.5 w-4.5", active ? "text-brand-200" : "text-slate-400")} />
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-8 rounded-lg border border-white/10 bg-white/[0.04] p-3">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
            {t.common.language}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setLanguage("en")}
              className={clsx(
                "rounded-lg px-4 py-2 text-sm font-semibold",
                language === "en"
                  ? "bg-white text-slate-950"
                  : "bg-white/5 text-slate-300 hover:bg-brand-400/10 hover:text-white"
              )}
            >
              EN
            </button>
            <button
              type="button"
              onClick={() => setLanguage("th")}
              className={clsx(
                "rounded-lg px-4 py-2 text-sm font-semibold",
                language === "th"
                  ? "bg-white text-slate-950"
                  : "bg-white/5 text-slate-300 hover:bg-brand-400/10 hover:text-white"
              )}
            >
              TH
            </button>
          </div>
        </div>
      </aside>

      {open ? (
        <button
          className="fixed inset-0 z-30 bg-slate-950/40 backdrop-blur-[2px] md:hidden"
          onClick={() => setOpen(false)}
          type="button"
          aria-label={t.nav.closeSidebar}
        />
      ) : null}
    </>
  );
}
