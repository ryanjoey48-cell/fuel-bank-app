"use client";

import clsx from "clsx";
import {
  ArrowRightLeft,
  ChevronRight,
  Droplets,
  LayoutDashboard,
  Route,
  Truck,
  X
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLanguage } from "@/lib/language-provider";

type SidebarProps = {
  open: boolean;
  onClose: () => void;
};

export function Sidebar({ open, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { t } = useLanguage();

  const navItems = [
    { href: "/dashboard", label: t.nav.dashboard, icon: LayoutDashboard },
    { href: "/fuel-logs", label: t.nav.fuelLogs, icon: Droplets },
    { href: "/transfers", label: t.nav.transfers, icon: ArrowRightLeft },
    { href: "/drivers", label: t.nav.drivers, icon: Truck },
    { href: "/weekly-mileage", label: t.nav.weeklyMileage, icon: Route }
  ];

  return (
    <>
      <aside
        id="mobile-nav-panel"
        className={clsx(
          "fixed inset-y-0 left-0 z-40 flex w-[85vw] max-w-[340px] max-w-[calc(100vw-env(safe-area-inset-left,0px)-1rem)] flex-col overflow-x-hidden overflow-y-auto border-r border-slate-200/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(244,247,251,0.97))] px-3.5 py-4 text-slate-900 shadow-[0_30px_60px_rgba(15,23,42,0.18)] backdrop-blur-xl transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] [padding-top:max(1rem,calc(env(safe-area-inset-top,0px)+0.75rem))] [padding-bottom:max(1rem,calc(env(safe-area-inset-bottom,0px)+0.75rem))] [padding-left:max(0.875rem,calc(env(safe-area-inset-left,0px)+0.5rem))] [padding-right:0.875rem] sm:px-4 sm:py-5 md:w-auto md:max-w-none md:translate-x-0 md:overflow-visible md:border-r md:bg-[linear-gradient(180deg,#15162d_0%,#1f1b3d_100%)] md:px-5 md:py-5 md:text-white md:shadow-[0_22px_48px_rgba(15,23,42,0.28)]",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="mb-5 flex w-full items-start justify-between gap-3 md:hidden">
          <div className="min-w-0 flex-1 pr-2">
            <p className="truncate text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">
              {t.common.appName}
            </p>
            <p className="mt-1 truncate text-sm font-semibold text-slate-900">{t.common.operations}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-slate-200/80 bg-white text-slate-600 shadow-[0_10px_20px_rgba(15,23,42,0.08)]"
            aria-label={t.nav.closeSidebar}
          >
            <X className="h-4.5 w-4.5" />
          </button>
        </div>

        <div className="mb-6 w-full min-w-0 rounded-[1.5rem] border border-slate-200/80 bg-[linear-gradient(145deg,rgba(255,255,255,0.98),rgba(241,245,249,0.92))] px-3.5 py-4 shadow-[0_20px_40px_rgba(15,23,42,0.08)] md:mb-8 md:border-white/10 md:bg-white/[0.05] md:px-4 md:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
          <div className="flex min-w-0 flex-col items-center justify-center text-center">
            <div className="flex h-[88px] w-full min-w-0 items-center justify-center sm:h-[108px]">
              <Image
                src="/logo.png"
                alt={t.common.appName}
                width={228}
                height={90}
                className="h-full w-auto max-w-[min(100%,200px)] object-contain brightness-105 drop-shadow-[0_6px_16px_rgba(15,23,42,0.16)] md:max-w-[228px] md:drop-shadow-[0_6px_16px_rgba(15,23,42,0.28)]"
                priority
              />
            </div>
            <div className="mt-4 flex w-full max-w-[220px] min-w-0 flex-col items-center">
              <p className="w-full text-center text-[11px] font-medium uppercase tracking-[0.2em] text-slate-500 sm:text-xs md:text-slate-300">
                {t.common.appSubtitle}
              </p>
              <h1 className="mt-2.5 w-full text-center text-[12px] font-semibold uppercase leading-[1.35] tracking-[0.03em] text-slate-950 sm:text-[12.5px] md:text-white">
                {t.common.appName}
              </h1>
            </div>
          </div>
        </div>

        <div className="mb-3 px-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500 md:text-slate-400">
            Navigation
          </p>
        </div>

        <nav className="w-full min-w-0 space-y-2.5">
          {navItems.map(({ href, label, icon: Icon }) => {
            const active = pathname === href;

            return (
              <Link
                key={href}
                href={href}
                className={clsx(
                  "group flex w-full min-w-0 items-center gap-3 rounded-[1.35rem] px-3.5 py-3.5 text-[14px] font-medium transition duration-200",
                  active
                    ? "bg-slate-950 text-white shadow-[0_18px_32px_rgba(15,23,42,0.18)] md:bg-white/[0.1] md:shadow-[0_18px_32px_rgba(15,23,42,0.16),inset_0_1px_0_rgba(255,255,255,0.05)]"
                    : "text-slate-600 hover:bg-white hover:text-slate-950 hover:shadow-[0_14px_24px_rgba(15,23,42,0.08)] md:text-slate-300 md:hover:bg-white/[0.04] md:hover:text-white md:hover:shadow-none"
                )}
                onClick={onClose}
              >
                <div
                  className={clsx(
                    "flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border transition",
                    active
                      ? "border-white/10 bg-white/[0.12] text-white md:text-brand-200"
                      : "border-slate-200/80 bg-slate-50 text-slate-500 group-hover:text-slate-950 md:border-white/10 md:bg-white/[0.04] md:text-slate-400 md:group-hover:text-white"
                  )}
                >
                  <Icon className="h-[18px] w-[18px]" />
                </div>
                <div className="min-w-0 flex-1 overflow-hidden">
                  <p className="truncate font-semibold">{label}</p>
                </div>
                <ChevronRight
                  className={clsx(
                    "h-4 w-4 shrink-0 transition",
                    active ? "text-white md:text-brand-200" : "text-slate-400 group-hover:text-slate-700 md:text-slate-500 md:group-hover:text-slate-300"
                  )}
                />
              </Link>
            );
          })}
        </nav>

        <div className="mt-6 w-full min-w-0 rounded-[1.35rem] border border-slate-200/80 bg-white/92 px-3.5 py-3.5 shadow-[0_14px_28px_rgba(15,23,42,0.06)] md:mt-auto md:border-white/10 md:bg-white/[0.04] md:px-4 md:shadow-none">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 md:text-slate-400">
            {t.common.appName}
          </p>
          <p className="mt-2 break-words text-sm leading-6 text-slate-600 md:text-slate-300">
            {t.common.appSubtitle}
          </p>
        </div>
      </aside>

      {open ? (
        <button
          className="fixed inset-0 z-30 bg-slate-950/36 backdrop-blur-[4px] md:hidden"
          onClick={onClose}
          type="button"
          aria-label={t.nav.closeSidebar}
        />
      ) : null}
    </>
  );
}
