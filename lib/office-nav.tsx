"use client";

import {
  Activity,
  BarChart3,
  CalendarDays,
  ClipboardCheck,
  FileBarChart,
  FileSearch,
  Fuel,
  Gauge,
  HardHat,
  MapPinned,
  Package,
  ShieldCheck,
  Shirt,
  TicketCheck,
  Truck,
  Users,
  Wrench,
  type LucideIcon
} from "lucide-react";
import { useMemo } from "react";
import { financeRecordsCopy } from "@/lib/finance-records-copy";
import { useLanguage } from "@/lib/language-provider";
import { useAccountAccess } from "@/lib/use-account-access";

/** Single source of truth for office navigation (Home navbar + V3 drawer). */
export type NavItem = {
  href: string;
  icon: LucideIcon;
  label: string;
  suppressActive?: boolean;
};

export type NavLink = {
  type: "link";
  key: string;
  href: string;
  label: string;
};

export type NavGroup = {
  type: "group";
  key: string;
  label: string;
  items: NavItem[];
};

export type NavEntry = NavLink | NavGroup;

export function routeIsActive(pathname: string, href: string) {
  if (href === "/dashboard") {
    return pathname === "/dashboard";
  }

  return (
    pathname === href ||
    pathname.startsWith(`${href}/`) ||
    (href === "/hr" &&
      ["/drivers", "/employees"].some(
        (path) => pathname === path || pathname.startsWith(`${path}/`)
      ))
  );
}

export function useOfficeNavEntries(): NavEntry[] {
  const { t, language } = useLanguage();
  const { can } = useAccountAccess();
  const copy = t.home.topNavigation;
  const th = language === "th";

  return useMemo<NavEntry[]>(() => {
    const operationsItems: NavItem[] = [
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
        label: th ? "งานขนส่ง / ใบเสนอราคา" : "Shipments / Quotes",
        icon: Package
      },
      {
        href: "/trip-journey",
        label: t.nav.tripJourney,
        icon: MapPinned
      },
      ...(can("business:read")
        ? [
            {
              href: "/locations",
              label: copy.locationsDirectory,
              icon: MapPinned
            } satisfies NavItem
          ]
        : []),
      {
        href: "/insurance",
        label: th ? "ศูนย์ประกันภัย" : "Insurance Centre",
        icon: ShieldCheck
      },
      {
        href: "/inventory",
        label: copy.uniformsEquipment,
        icon: Shirt
      }
    ];

    const fleetItems: NavItem[] = [
      ...(can("business:read")
        ? [
            {
              href: "/fleet-tracking",
              label: th ? "ติดตามรถ" : "Fleet Tracking",
              icon: MapPinned
            } satisfies NavItem
          ]
        : []),
      {
        href: "/weekly-mileage",
        label: t.nav.weeklyMileage,
        icon: Gauge
      },
      {
        href: "/maintenance",
        label: th ? "ศูนย์บำรุงรักษา" : "Maintenance Centre",
        icon: Wrench
      }
    ];

    const financeItems: NavItem[] = [
      {
        href: "/finance-centre",
        label: th ? "ศูนย์การเงิน" : "Finance Centre",
        icon: FileBarChart
      },
      {
        href: "/expenses-centre",
        label: th ? "ศูนย์ค่าใช้จ่าย" : "Expenses Centre",
        icon: FileBarChart
      },
      {
        href: "/finance-records",
        label: financeRecordsCopy[th ? "th" : "en"].nav,
        icon: FileSearch
      },
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
    ];

    const peopleItems: NavItem[] = [
      {
        href: "/hr",
        label: th ? "บุคลากรและงาน HR" : "People & HR",
        icon: Users
      },
      ...(can("admin:user_management")
        ? [
            {
              href: "/admin/driver-operations",
              label: th ? "ปฏิบัติการคนขับ" : "Driver Operations",
              icon: Truck
            } satisfies NavItem
          ]
        : []),
      {
        href: "/safety",
        label: th ? "ความปลอดภัยรถ" : "Vehicle Safety",
        icon: HardHat
      }
    ];

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
        href: "/admin/users",
        label: t.adminUsers.title,
        icon: Users
      });
    }

    const next: NavEntry[] = [
      {
        type: "link",
        key: "home",
        href: "/dashboard",
        label: copy.home
      },
      {
        type: "group",
        key: "operations",
        label: copy.operations,
        items: operationsItems
      },
      {
        type: "group",
        key: "fleet",
        label: copy.fleet,
        items: fleetItems
      },
      {
        type: "group",
        key: "finance",
        label: copy.finance,
        items: financeItems
      },
      {
        type: "group",
        key: "people",
        label: copy.peopleSafety,
        items: peopleItems
      },
      {
        type: "link",
        key: "reports",
        href: "/reports",
        label: copy.reports
      }
    ];

    if (adminItems.length) {
      next.push({
        type: "group",
        key: "admin",
        label: copy.admin,
        items: adminItems
      });
    }

    return next;
  }, [can, copy, t, th]);
}
