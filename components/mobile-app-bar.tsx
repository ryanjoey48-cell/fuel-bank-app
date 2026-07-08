"use client";

import clsx from "clsx";
import { Menu, X } from "lucide-react";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { AccountMenu } from "@/components/account-menu";
import { useLanguage } from "@/lib/language-provider";

type PageKey = "dashboard" | "bookingDiary" | "drivers" | "fuelLogs" | "fuelSpendReport" | "shipments" | "transfers" | "tripJourney" | "weeklyMileage";

const PAGE_KEY_BY_PATH: Record<string, PageKey> = {
  "/booking-diary": "bookingDiary",
  "/dashboard": "dashboard",
  "/drivers": "drivers",
  "/fuel-logs": "fuelLogs",
  "/fuel-spend-report": "fuelSpendReport",
  "/shipments": "shipments",
  "/transfers": "transfers",
  "/trip-journey": "tripJourney",
  "/weekly-mileage": "weeklyMileage"
};

const ACCENTS = {
  blue: "var(--accent-booking)",
  green: "var(--accent-trip)",
  indigo: "var(--accent-reports)",
  orange: "var(--accent-fuel)",
  purple: "var(--accent-dashboard)",
  red: "var(--accent-support)"
} as const;

function getMobileAccent(pathname: string) {
  if (pathname.startsWith("/booking-diary")) return ACCENTS.blue;
  if (pathname.startsWith("/trip-journey")) return ACCENTS.green;
  if (pathname.startsWith("/fuel-logs")) return ACCENTS.orange;
  if (pathname.startsWith("/fuel-spend-report")) return ACCENTS.indigo;
  if (pathname.startsWith("/support") || pathname.startsWith("/admin/support-tickets")) return ACCENTS.red;
  return ACCENTS.purple;
}

type MobileAppBarProps = {
  open: boolean;
  onToggle: () => void;
};

export function MobileAppBar({ open, onToggle }: MobileAppBarProps) {
  const pathname = usePathname();
  const { t } = useLanguage();
  const pageKey = PAGE_KEY_BY_PATH[pathname] ?? "dashboard";
  const pageLabel = pathname.startsWith("/admin/support-tickets")
    ? t.support.adminTitle
    : pathname.startsWith("/support")
      ? t.support.title
      : pathname.startsWith("/profile")
        ? t.profile.title
        : pageKey === "dashboard" && pathname.startsWith("/change-password")
          ? t.support.menu.changePassword
          : t.nav[pageKey];
  const accent = getMobileAccent(pathname);

  return (
    <div className="mobile-app-bar fixed inset-x-0 top-0 z-30 border-b border-[#ece8ff] bg-[linear-gradient(90deg,#faf8ff_0%,#ffffff_45%,#faf8ff_100%)] shadow-[0_14px_34px_rgba(79,70,229,0.11)] backdrop-blur-xl min-[1367px]:hidden">
      <div className="mx-auto flex min-h-[76px] w-full max-w-full items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={onToggle}
          className={clsx(
            "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/80 bg-white/92 text-slate-900 shadow-[0_12px_28px_rgba(15,23,42,0.12)] transition duration-200",
            open ? "scale-[0.98] border-brand-600 bg-brand-600 text-white shadow-[0_18px_32px_rgba(95,51,183,0.24)]" : "active:scale-[0.98]"
          )}
          aria-label={open ? t.nav.closeSidebar : t.nav.openMenu}
          aria-expanded={open}
          aria-controls="mobile-nav-panel"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>

        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex h-[3.25rem] w-[3.25rem] shrink-0 items-center justify-center rounded-[1.15rem] border border-[#e4ddff] bg-[#f4f0ff] shadow-[0_10px_22px_rgba(79,70,229,0.09)]">
            <Image
              src="/logo.png"
              alt={t.common.appName}
              width={40}
              height={40}
              className="h-9 w-9 object-contain"
              priority
            />
          </div>

          <div className="flex min-w-0 items-start gap-2">
            <span
              className="mt-[1.15rem] h-6 w-1 shrink-0 rounded-full"
              style={{ backgroundColor: accent }}
              aria-hidden="true"
            />
            <div className="min-w-0">
            <p className="truncate text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
              {t.common.appName}
            </p>
            <p className="mt-1 truncate text-[16px] font-bold tracking-normal" style={{ color: accent }}>
              {pageLabel}
            </p>
            </div>
          </div>
        </div>
        <AccountMenu compact />
      </div>
    </div>
  );
}
