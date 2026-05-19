"use client";

import clsx from "clsx";
import { useEffect, useState } from "react";
import {
  ArrowRightLeft,
  CalendarDays,
  ChevronRight,
  Droplets,
  LayoutDashboard,
  Package,
  Route,
  Truck,
  X
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useLanguage } from "@/lib/language-provider";

type SidebarProps = {
  open: boolean;
  onClose: () => void;
};

const SIDEBAR_STORAGE_KEY = "fuel-bank-sidebar-expanded";

export function Sidebar({ open, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { language, t } = useLanguage();
  const [desktopExpanded, setDesktopExpanded] = useState(false);
  const [preferenceLoaded, setPreferenceLoaded] = useState(false);

  useEffect(() => {
    setDesktopExpanded(window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === "true");
    setPreferenceLoaded(true);
  }, []);

  useEffect(() => {
    if (!preferenceLoaded) {
      return;
    }

    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(desktopExpanded));
    document.documentElement.style.setProperty(
      "--dashboard-sidebar-width",
      desktopExpanded ? "17.5rem" : "5.25rem"
    );
  }, [desktopExpanded, preferenceLoaded]);

  const navItems = [
    { href: "/dashboard", label: t.nav.dashboard, icon: LayoutDashboard },
    { href: "/fuel-logs", label: t.nav.fuelLogs, icon: Droplets },
    { href: "/transfers", label: t.nav.transfers, icon: ArrowRightLeft },
    { href: "/weekly-mileage", label: t.nav.weeklyMileage, icon: Route },
    {
      href: "/shipments",
      label: language === "th" ? "งานขนส่ง" : "Shipments",
      icon: Package
    },
    { href: "/drivers", label: t.nav.drivers, icon: Truck },
    { href: "/booking-diary", label: language === "th" ? "สมุดจองงาน" : "Booking Diary", icon: CalendarDays }
  ];

  return (
    <>
      <aside
        id="mobile-nav-panel"
        className={clsx(
          "fixed inset-y-0 left-0 z-40 flex w-[85vw] max-w-[340px] max-w-[calc(100vw-env(safe-area-inset-left,0px)-1rem)] flex-col overflow-x-hidden overflow-y-auto border-r border-white/10 bg-[#1F1B3D] bg-[linear-gradient(180deg,#17152E_0%,#211A44_54%,#2A1E55_100%)] px-3.5 py-4 text-slate-50 shadow-[0_30px_70px_rgba(15,12,38,0.34)] backdrop-blur-xl transition-[width,transform,padding] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] [padding-top:max(1rem,calc(env(safe-area-inset-top,0px)+0.75rem))] [padding-bottom:max(1rem,calc(env(safe-area-inset-bottom,0px)+0.75rem))] [padding-left:max(0.875rem,calc(env(safe-area-inset-left,0px)+0.5rem))] [padding-right:0.875rem] sm:px-4 sm:py-5 min-[1367px]:max-w-none min-[1367px]:translate-x-0 min-[1367px]:overflow-visible min-[1367px]:border-r min-[1367px]:border-white/10 min-[1367px]:bg-[#1F1B3D] min-[1367px]:bg-[linear-gradient(180deg,#17152E_0%,#211A44_54%,#2A1E55_100%)] min-[1367px]:py-5 min-[1367px]:text-slate-50 min-[1367px]:shadow-[0_20px_44px_rgba(15,12,38,0.22)]",
          desktopExpanded ? "min-[1367px]:w-[17.5rem] min-[1367px]:px-5" : "min-[1367px]:w-[5.25rem] min-[1367px]:px-3",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="tablet-sidebar-header mb-5 flex w-full items-start justify-between gap-3 min-[1367px]:hidden">
          <div className="min-w-0 flex-1 pr-2">
            <p className="truncate text-[10px] font-semibold uppercase tracking-[0.22em] text-violet-200">
              {t.common.appName}
            </p>
            <p className="mt-1 truncate text-sm font-semibold text-slate-50">{t.common.operations}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/8 text-violet-100 shadow-[0_10px_22px_rgba(8,7,24,0.22)] hover:bg-white/12"
            aria-label={t.nav.closeSidebar}
          >
            <X className="h-4.5 w-4.5" />
          </button>
        </div>

        <div
          className={clsx(
            "mb-6 w-full min-w-0 rounded-[1.45rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.105),rgba(255,255,255,0.045))] px-3.5 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_18px_34px_rgba(8,7,24,0.22)] ring-1 ring-white/[0.035] transition-all duration-300 md:mb-8 md:px-4",
            !desktopExpanded && "min-[1367px]:mb-6 min-[1367px]:rounded-2xl min-[1367px]:px-1 min-[1367px]:py-2"
          )}
        >
          <div className="flex min-w-0 flex-col items-center justify-center text-center">
            <div
              className={clsx(
                "flex h-[102px] w-full min-w-0 items-center justify-center rounded-[1.15rem] border border-white/[0.08] bg-[radial-gradient(circle_at_50%_35%,rgba(255,255,255,0.13),rgba(255,255,255,0.035)_58%,rgba(255,255,255,0.02)_100%)] transition-all duration-300 sm:h-[122px]",
                !desktopExpanded && "min-[1367px]:h-14 min-[1367px]:rounded-[1rem]"
              )}
            >
              <Image
                src="/logo.png"
                alt={t.common.appName}
                width={228}
                height={90}
                className={clsx(
                  "h-full w-auto max-w-[min(100%,232px)] object-contain brightness-110 drop-shadow-[0_10px_22px_rgba(8,7,24,0.3)] transition-all duration-300 md:max-w-[246px]",
                  !desktopExpanded && "min-[1367px]:max-w-[64px]"
                )}
                priority
              />
            </div>
            <div
              className={clsx(
                "mt-4 flex w-full max-w-[232px] min-w-0 flex-col items-center transition-opacity duration-200",
                !desktopExpanded && "min-[1367px]:pointer-events-none min-[1367px]:hidden min-[1367px]:opacity-0"
              )}
            >
              <p className="w-full text-center text-[11px] font-semibold uppercase tracking-[0.22em] text-violet-200 sm:text-xs md:text-violet-200">
                {t.common.appSubtitle}
              </p>
              <h1 className="mt-2 w-full text-center text-[12px] font-semibold uppercase leading-[1.35] tracking-[0.04em] text-slate-50 sm:text-[12.5px] md:text-slate-50">
                {t.common.appName}
              </h1>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setDesktopExpanded((current) => !current)}
          className={clsx(
            "mb-5 hidden min-h-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.07] text-violet-100 shadow-[0_12px_24px_rgba(8,7,24,0.18)] transition hover:bg-white/[0.1] hover:text-white min-[1367px]:flex",
            desktopExpanded ? "w-full gap-2 px-3 text-sm font-semibold" : "mx-auto h-11 w-11"
          )}
          aria-label={desktopExpanded ? "Collapse sidebar" : "Expand sidebar"}
          title={desktopExpanded ? "Collapse sidebar" : "Expand sidebar"}
        >
          <ChevronRight className={clsx("h-4 w-4 transition-transform", desktopExpanded && "rotate-180")} />
          {desktopExpanded ? <span>Collapse</span> : null}
        </button>

        <div className={clsx("mb-3 px-1", !desktopExpanded && "min-[1367px]:sr-only")}>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-indigo-200 md:text-indigo-200">
            {t.common.navigation}
          </p>
        </div>

        <nav className="w-full min-w-0 space-y-2.5">
          {navItems.map(({ href, label, icon: Icon }) => {
            const active = pathname === href;

            return (
              <Link
                key={href}
                href={href}
                title={!desktopExpanded ? label : undefined}
                className={clsx(
                  "group relative flex w-full min-w-0 items-center gap-3 rounded-[1.35rem] px-3.5 py-3.5 text-[14px] font-medium transition duration-200",
                  !desktopExpanded && "min-[1367px]:justify-center min-[1367px]:gap-0 min-[1367px]:px-2 min-[1367px]:py-2.5",
                  active
                    ? "border border-[#8B7CF6]/60 bg-[rgba(103,80,216,0.22)] text-slate-50 shadow-[0_16px_30px_rgba(20,16,52,0.2)]"
                    : "border border-transparent text-slate-200 hover:border-white/10 hover:bg-white/[0.08] hover:text-white hover:shadow-[0_12px_24px_rgba(8,7,24,0.18)]"
                )}
                onClick={onClose}
              >
                {active ? (
                  <span className="absolute left-0 top-1/2 hidden h-7 w-1 -translate-y-1/2 rounded-r-full bg-[#8B7CF6] shadow-[0_0_14px_rgba(139,124,246,0.55)] min-[1367px]:block" />
                ) : null}
                <div
                  className={clsx(
                    "flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border transition",
                    active
                      ? "border-[#8B7CF6]/60 bg-[#6750D8]/28 text-violet-50"
                      : "border-white/10 bg-white/[0.055] text-violet-100 group-hover:border-white/16 group-hover:bg-white/[0.09] group-hover:text-white"
                  )}
                >
                  <Icon className="h-[18px] w-[18px]" />
                </div>
                <div className={clsx("min-w-0 flex-1 overflow-hidden", !desktopExpanded && "min-[1367px]:hidden")}>
                  <p className="truncate font-semibold">{label}</p>
                </div>
                <ChevronRight
                  className={clsx(
                    "h-4 w-4 shrink-0 transition",
                    !desktopExpanded && "min-[1367px]:hidden",
                    active ? "text-violet-200" : "text-indigo-200/70 group-hover:text-violet-100"
                  )}
                />
                {!desktopExpanded ? (
                  <span className="pointer-events-none absolute left-[calc(100%+0.7rem)] top-1/2 z-50 hidden -translate-y-1/2 whitespace-nowrap rounded-xl border border-white/10 bg-[#211A44] px-3 py-2 text-xs font-semibold text-slate-50 opacity-0 shadow-[0_14px_30px_rgba(8,7,24,0.28)] transition group-hover:opacity-100 min-[1367px]:block">
                    {label}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>

        <div className="mt-6 grid w-full min-w-0 gap-3 md:mt-auto">
          <div
            className={clsx(
              "w-full min-w-0 rounded-[1.35rem] border border-white/10 bg-white/[0.065] px-3.5 py-3.5 shadow-[0_12px_24px_rgba(8,7,24,0.2)] ring-1 ring-white/[0.04] md:px-4",
              !desktopExpanded && "min-[1367px]:hidden"
            )}
          >
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-200 md:text-violet-200">
              {t.common.appName}
            </p>
            <p className="mt-2 break-words text-sm leading-6 text-indigo-100 md:text-indigo-100">
              {t.common.appSubtitle}
            </p>
          </div>

          <div
            className={clsx(
              "w-full min-w-0 rounded-[1.15rem] border border-white/10 bg-white/[0.045] p-2 shadow-[0_10px_22px_rgba(8,7,24,0.16)]",
              !desktopExpanded && "min-[1367px]:rounded-2xl min-[1367px]:p-1"
            )}
          >
            <p
              className={clsx(
                "mb-2 px-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-200",
                !desktopExpanded && "min-[1367px]:sr-only"
              )}
            >
              Language
            </p>
            <LanguageSwitcher compact tone="sidebar" />
          </div>
        </div>
      </aside>

      {open ? (
        <button
          className="tablet-sidebar-backdrop fixed inset-0 z-30 bg-[rgba(43,24,81,0.22)] backdrop-blur-[4px] min-[1367px]:hidden"
          onClick={onClose}
          type="button"
          aria-label={t.nav.closeSidebar}
        />
      ) : null}
    </>
  );
}
