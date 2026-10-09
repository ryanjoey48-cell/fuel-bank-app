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
  Users,
  Wrench,
  X,
  type LucideIcon
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { AccountMenu } from "@/components/account-menu";
import { EESLogo } from "@/components/ees-logo";
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
  return (
    pathname === href ||
    (href !== "/dashboard" && pathname.startsWith(`${href}/`))
  );
}

export function TopNavigation() {
  const pathname = usePathname();
  const { t, language } = useLanguage();
  const { can } = useAccountAccess();
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const rootRef = useRef<HTMLElement>(null);
  const copy = t.home.topNavigation;

  const groups = useMemo<NavGroup[]>(() => {
    const adminItems: NavItem[] = [];

    if (can("admin:support_tickets")) {
      adminItems.push({
        href: "/admin/support-tickets",
        label: t.dashboard.management.supportTickets,
        icon: TicketCheck
      });
    }

    if (can("admin:user_management")) {
      adminItems.push({
        href: "/admin/driver-operations",
        label:
          language === "th"
            ? "ปฏิบัติการคนขับ"
            : "Driver Operations",
        icon: Truck
      });

      adminItems.push({
        href: "/admin/users",
        label: t.adminUsers.title,
        icon: Users
      });
    }

    return [
      {
        key: "home",
        label: copy.home,
        items: [
          {
            href: "/dashboard",
            label: copy.home,
            icon: LayoutDashboard
          }
        ]
      },
      {
        key: "operations",
        label: copy.operations,
        items: [
          {
            href: "/booking-diary",
            label: t.nav.bookingDiary,
            icon: CalendarDays
          },
          {
            href: "/dispatch",
            label: t.nav.dispatch,
            icon: ClipboardCheck
          },
          {
            href: "/shipments",
            label: t.nav.shipments,
            icon: Package
          },
          {
            href: "/trip-journey",
            label: t.nav.tripJourney,
            icon: MapPinned
          }
        ]
      },
      {
        key: "fleet",
        label: copy.fleet,
        items: [
          {
            href: "/drivers",
            label:
              language === "th"
                ? "คนขับและยานพาหนะ"
                : "Drivers & Vehicles",
            icon: Truck
          },
          {
            href: "/weekly-mileage",
            label: t.nav.weeklyMileage,
            icon: Gauge
          },
          {
            href: "/maintenance",
            label: t.maintenance.title,
            icon: Wrench
          },
          {
            href: "/insurance",
            label: t.dashboard.management.insurance.title,
            icon: ShieldCheck
          },
          {
            href: "/safety",
            label:
              language === "th"
                ? "ความปลอดภัยรถ"
                : "Vehicle Safety",
            icon: ClipboardCheck
          },
          {
            href: "/inventory",
            label: t.home.shortcuts.inventory,
            icon: PackageSearch
          }
        ]
      },
      {
        key: "fuel",
        label: copy.fuel,
        items: [
          {
            href: "/fuel-logs",
            label: t.nav.fuelLogs,
            icon: Fuel
          },
          {
            href: "/fuel-spend-report",
            label: t.nav.fuelSpendReport,
            icon: BarChart3
          },
          {
            href: "/vehicle-performance",
            label: t.nav.vehiclePerformance,
            icon: Activity
          }
        ]
      },
      {
        key: "reports",
        label: copy.reports,
        items: [
          {
            href: "/reports",
            label: t.nav.reports,
            icon: FileBarChart
          }
        ]
      },
      ...(adminItems.length
        ? [
            {
              key: "admin",
              label: copy.admin,
              items: adminItems
            }
          ]
        : [])
    ];
  }, [can, copy, t, language]);

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
      if (
        rootRef.current &&
        !rootRef.current.contains(event.target as Node)
      ) {
        setOpenGroup(null);
      }
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
    <header
      ref={rootRef}
      className="top-navigation sticky top-0 z-40 border-b border-slate-200/80 bg-[#fffbf2]/95 shadow-[0_8px_24px_rgba(57,40,24,0.065)] backdrop-blur-xl"
    >
      <div className="mx-auto flex min-h-[60px] w-full items-center gap-2 px-3 sm:min-h-[72px] sm:gap-3 sm:px-6 lg:px-8 xl:grid xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] xl:gap-6 xl:px-10">
        <Link
          href="/dashboard"
          className="flex min-w-0 shrink-0 items-center gap-3.5 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-brand-300 xl:justify-self-start"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-[1.05rem] bg-[#211336] shadow-[0_7px_18px_rgba(33,19,54,0.16)] ring-1 ring-brand-900/10 sm:h-14 sm:w-14">
            <EESLogo
              alt={t.common.appName}
              size={56}
              className="h-11 w-11 max-w-none scale-[1.8] sm:h-14 sm:w-14"
              priority
            />
          </span>

          <span className="hidden xl:block">
            <span className="block text-[15px] font-black tracking-[-0.025em] text-slate-950">
              EES Operations
            </span>

            <span className="mt-0.5 block text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              {t.common.appSubtitle}
            </span>
          </span>
        </Link>

        <nav
          className="hidden min-w-0 flex-1 items-center justify-center gap-0.5 lg:flex xl:justify-self-center xl:gap-1"
          aria-label={t.common.navigation}
        >
          {groups.map((group) => {
            const active = group.items.some(
              (item) =>
                !item.suppressActive &&
                routeIsActive(pathname, item.href)
            );

            const open = openGroup === group.key;

            return (
              <div
                key={group.key}
                className="relative"
                onMouseEnter={() => setOpenGroup(group.key)}
                onMouseLeave={() => setOpenGroup(null)}
              >
                <button
                  type="button"
                  onClick={() =>
                    setOpenGroup(open ? null : group.key)
                  }
                  onFocus={() => setOpenGroup(group.key)}
                  className={`inline-flex min-h-10 items-center gap-1.5 whitespace-nowrap rounded-xl px-2.5 text-[13px] font-bold outline-none transition duration-200 xl:px-3.5 xl:text-sm ${
                    active
                      ? "bg-brand-700 text-white shadow-[0_5px_14px_rgba(91,35,142,0.18)] ring-1 ring-brand-800/80"
                      : "text-slate-600 hover:bg-brand-50/90 hover:text-brand-800"
                  }`}
                  aria-expanded={open}
                  aria-haspopup="menu"
                >
                  {group.label}

                  <ChevronDown
                    className={`h-3.5 w-3.5 transition ${
                      open ? "rotate-180" : ""
                    }`}
                  />
                </button>

                {open ? (
                  <div className="absolute left-1/2 top-full w-[15.5rem] -translate-x-1/2 pt-2.5">
                    <div
                      className="rounded-2xl border border-brand-100/80 bg-[#fffdf8] p-2 shadow-[0_20px_50px_rgba(57,40,24,0.13)] ring-1 ring-white/80"
                      role="menu"
                    >
                      <p className="px-3 pb-2 pt-1 text-[10px] font-black uppercase tracking-[0.16em] text-brand-600">
                        {group.label}
                      </p>

                      {group.items.map((item, index) => {
                        const Icon = item.icon;

                        const itemActive =
                          !item.suppressActive &&
                          routeIsActive(pathname, item.href);

                        return (
                          <Link
                            key={`${group.key}-${item.href}-${index}`}
                            href={item.href}
                            role="menuitem"
                            className={`flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold transition duration-150 ${
                              itemActive
                                ? "bg-brand-50 text-brand-800 ring-1 ring-inset ring-brand-100"
                                : "text-slate-700 hover:bg-brand-50/85 hover:text-brand-800"
                            }`}
                          >
                            <span
                              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                                itemActive
                                  ? "bg-brand-100 text-brand-700"
                                  : "bg-slate-100 text-slate-500"
                              }`}
                            >
                              <Icon className="h-4 w-4" />
                            </span>

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

        <div className="ml-auto flex shrink-0 items-center gap-2 lg:gap-2.5 xl:ml-0 xl:justify-self-end">
          <div className="hidden h-10 items-center sm:flex">
            <LanguageSwitcher compact />
          </div>

          <AccountMenu compact />

          <button
            type="button"
            onClick={() =>
              setMobileOpen((current) => !current)
            }
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-[#fffdf8] text-slate-700 shadow-sm transition hover:border-brand-200 hover:text-brand-700 lg:hidden"
            aria-label={
              mobileOpen ? copy.closeMenu : copy.openMenu
            }
            aria-expanded={mobileOpen}
            aria-controls="top-navigation-mobile-menu"
          >
            {mobileOpen ? (
              <X className="h-5 w-5" />
            ) : (
              <Menu className="h-5 w-5" />
            )}
          </button>
        </div>
      </div>

      {mobileOpen ? (
        <>
          <button
            type="button"
            className="fixed inset-0 top-[68px] z-40 bg-slate-950/20 backdrop-blur-[2px] lg:hidden"
            onClick={() => setMobileOpen(false)}
            aria-label={copy.closeMenu}
          />

          <nav
            id="top-navigation-mobile-menu"
            className="absolute inset-x-3 top-[calc(100%+0.5rem)] z-50 max-h-[calc(100dvh-5.5rem)] overflow-y-auto rounded-2xl border border-slate-200 bg-[#fffdf8] p-3 shadow-[0_24px_60px_rgba(57,40,24,0.2)] sm:inset-x-5 lg:hidden"
            aria-label={t.common.navigation}
          >
            <div className="mb-3 sm:hidden">
              <LanguageSwitcher />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {groups.map((group) => (
                <section
                  key={group.key}
                  className="rounded-xl border border-slate-200 bg-slate-50/70 p-2"
                >
                  <h2 className="px-2 py-1.5 text-[11px] font-black uppercase tracking-[0.14em] text-violet-700">
                    {group.label}
                  </h2>

                  <div className="grid gap-0.5">
                    {group.items.map((item, index) => {
                      const Icon = item.icon;

                      const active =
                        !item.suppressActive &&
                        routeIsActive(pathname, item.href);

                      return (
                        <Link
                          key={`${group.key}-mobile-${item.href}-${index}`}
                          href={item.href}
                          className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-semibold transition ${
                            active
                              ? "bg-brand-700 text-white"
                              : "text-slate-700 hover:bg-brand-50 hover:text-brand-800"
                          }`}
                        >
                          <Icon className="h-4 w-4 shrink-0" />
                          {item.label}
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