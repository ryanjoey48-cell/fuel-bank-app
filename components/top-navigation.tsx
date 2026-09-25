"use client";

import {
  Activity,
  BarChart3,
  CalendarDays,
  ChevronDown,
  ClipboardCheck,
  FileBarChart,
  Fuel,
  Gauge,
  LayoutDashboard,
  MapPinned,
  Menu,
  Package,
  PackageSearch,
  ShieldCheck,
  TicketCheck,
  Truck,
  UserRound,
  Users,
  Wrench,
  X,
  type LucideIcon
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { AccountMenu } from "@/components/account-menu";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useLanguage } from "@/lib/language-provider";
import { useAccountAccess } from "@/lib/use-account-access";

type NavItem = {
  href: string;
  icon: LucideIcon;
  label: string;
  suppressActive?: boolean;
};

type NavGroup = {
  key: string;
  label: string;
  items: NavItem[];
};

function routeIsActive(pathname: string, href: string) {
  return pathname === href || (href !== "/dashboard" && pathname.startsWith(`${href}/`));
}

export function TopNavigation() {
  const pathname = usePathname();
  const { t } = useLanguage();
  const { can } = useAccountAccess();
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const rootRef = useRef<HTMLElement>(null);
  const copy = t.home.topNavigation;

  const groups = useMemo<NavGroup[]>(() => {
    const adminItems: NavItem[] = [];
    if (can("admin:support_tickets")) {
      adminItems.push({ href: "/admin/support-tickets", label: t.dashboard.management.supportTickets, icon: TicketCheck });
    }
    if (can("admin:user_management")) {
      adminItems.push({ href: "/admin/users", label: t.adminUsers.title, icon: Users });
    }

    return [
      {
        key: "home",
        label: copy.home,
        items: [{ href: "/dashboard", label: copy.home, icon: LayoutDashboard }]
      },
      {
        key: "operations",
        label: copy.operations,
        items: [
          { href: "/booking-diary", label: t.nav.bookingDiary, icon: CalendarDays },
          { href: "/dispatch", label: t.nav.dispatch, icon: ClipboardCheck },
          { href: "/shipments", label: t.nav.shipments, icon: Package },
          { href: "/trip-journey", label: t.nav.tripJourney, icon: MapPinned }
        ]
      },
      {
        key: "fleet",
        label: copy.fleet,
        items: [
          { href: "/drivers", label: t.home.shortcuts.fleet, icon: Truck },
          { href: "/weekly-mileage", label: t.nav.weeklyMileage, icon: Gauge },
          { href: "/maintenance", label: t.maintenance.title, icon: Wrench },
          { href: "/insurance", label: t.dashboard.management.insurance.title, icon: ShieldCheck },
          { href: "/drivers", label: t.nav.drivers, icon: UserRound, suppressActive: true },
          { href: "/inventory", label: t.home.shortcuts.inventory, icon: PackageSearch }
        ]
      },
      {
        key: "fuel",
        label: copy.fuel,
        items: [
          { href: "/fuel-logs", label: t.nav.fuelLogs, icon: Fuel },
          { href: "/fuel-spend-report", label: t.nav.fuelSpendReport, icon: BarChart3 },
          { href: "/vehicle-performance", label: t.nav.vehiclePerformance, icon: Activity }
        ]
      },
      {
        key: "reports",
        label: copy.reports,
        items: [
          { href: "/reports", label: t.nav.reports, icon: FileBarChart },
          { href: "/booking-diary", label: t.home.shortcuts.insights, icon: BarChart3, suppressActive: true }
        ]
      },
      ...(adminItems.length ? [{ key: "admin", label: copy.admin, items: adminItems }] : [])
    ];
  }, [can, copy, t]);

  useEffect(() => {
    setOpenGroup(null);
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  useEffect(() => {
    const closeOnPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpenGroup(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenGroup(null);
        setMobileOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOnPointerDown);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  return (
    <header ref={rootRef} className="top-navigation sticky top-0 z-40 border-b border-slate-200/90 bg-white/95 shadow-[0_8px_28px_rgba(15,23,42,0.08)] backdrop-blur-xl">
      <div className="mx-auto flex min-h-[68px] w-full items-center gap-3 px-4 sm:px-5 lg:px-6 xl:px-8">
        <Link href="/dashboard" className="flex min-w-0 shrink-0 items-center gap-2.5 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-orange-400">
          <span className="flex h-10 w-12 items-center justify-center overflow-hidden rounded-xl bg-slate-950/95 px-1.5 shadow-sm">
            <Image src="/ees-logo.png" alt={t.common.appName} width={64} height={44} className="h-8 w-auto object-contain" priority />
          </span>
          <span className="hidden xl:block">
            <span className="block text-sm font-black tracking-tight text-slate-950">EES Operations</span>
            <span className="block text-[10px] font-semibold uppercase tracking-[0.13em] text-slate-500">{t.common.appSubtitle}</span>
          </span>
        </Link>

        <nav className="hidden min-w-0 flex-1 items-center justify-center gap-0.5 lg:flex" aria-label={t.common.navigation}>
          {groups.map((group) => {
            const active = group.items.some((item) => !item.suppressActive && routeIsActive(pathname, item.href));
            const open = openGroup === group.key;
            return (
              <div key={group.key} className="relative" onMouseEnter={() => setOpenGroup(group.key)} onMouseLeave={() => setOpenGroup(null)}>
                <button
                  type="button"
                  onClick={() => setOpenGroup(open ? null : group.key)}
                  onFocus={() => setOpenGroup(group.key)}
                  className={`inline-flex min-h-10 items-center gap-1 rounded-xl px-2.5 text-sm font-bold outline-none transition xl:px-3.5 ${active ? "bg-orange-50 text-orange-700" : "text-slate-600 hover:bg-violet-50 hover:text-violet-800"}`}
                  aria-expanded={open}
                  aria-haspopup="menu"
                >
                  {group.label}<ChevronDown className={`h-3.5 w-3.5 transition ${open ? "rotate-180" : ""}`} />
                </button>
                {open ? (
                  <div className="absolute left-1/2 top-full w-64 -translate-x-1/2 pt-2">
                    <div className="rounded-2xl border border-slate-200 bg-white p-2 shadow-[0_22px_55px_rgba(15,23,42,0.18)]" role="menu">
                      <p className="px-3 pb-1.5 pt-1 text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">{group.label}</p>
                      {group.items.map((item, index) => {
                        const Icon = item.icon;
                      const itemActive = !item.suppressActive && routeIsActive(pathname, item.href);
                        return (
                          <Link
                            key={`${group.key}-${item.href}-${index}`}
                            href={item.href}
                            role="menuitem"
                            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${itemActive ? "bg-orange-50 text-orange-800" : "text-slate-700 hover:bg-violet-50 hover:text-violet-800"}`}
                          >
                            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${itemActive ? "bg-orange-100 text-orange-700" : "bg-slate-100 text-slate-500"}`}><Icon className="h-4 w-4" /></span>
                            {item.label}
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <div className="hidden sm:block"><LanguageSwitcher compact /></div>
          <AccountMenu compact />
          <button
            type="button"
            onClick={() => setMobileOpen((current) => !current)}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:border-violet-200 hover:text-violet-700 lg:hidden"
            aria-label={mobileOpen ? copy.closeMenu : copy.openMenu}
            aria-expanded={mobileOpen}
            aria-controls="top-navigation-mobile-menu"
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {mobileOpen ? (
        <>
          <button type="button" className="fixed inset-0 top-[68px] z-40 bg-slate-950/20 backdrop-blur-[2px] lg:hidden" onClick={() => setMobileOpen(false)} aria-label={copy.closeMenu} />
          <nav id="top-navigation-mobile-menu" className="absolute inset-x-3 top-[calc(100%+0.5rem)] z-50 max-h-[calc(100dvh-5.5rem)] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_24px_60px_rgba(15,23,42,0.22)] sm:inset-x-5 lg:hidden" aria-label={t.common.navigation}>
            <div className="mb-3 sm:hidden"><LanguageSwitcher /></div>
            <div className="grid gap-3 sm:grid-cols-2">
              {groups.map((group) => (
                <section key={group.key} className="rounded-xl border border-slate-200 bg-slate-50/60 p-2">
                  <h2 className="px-2 py-1.5 text-[11px] font-black uppercase tracking-[0.14em] text-violet-700">{group.label}</h2>
                  <div className="grid gap-0.5">
                    {group.items.map((item, index) => {
                      const Icon = item.icon;
                      const active = !item.suppressActive && routeIsActive(pathname, item.href);
                      return (
                        <Link key={`${group.key}-mobile-${item.href}-${index}`} href={item.href} className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-semibold transition ${active ? "bg-orange-50 text-orange-800" : "text-slate-700 hover:bg-white hover:text-violet-800"}`}>
                          <Icon className="h-4 w-4 shrink-0" />{item.label}
                        </Link>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          </nav>
        </>
      ) : null}
    </header>
  );
}
