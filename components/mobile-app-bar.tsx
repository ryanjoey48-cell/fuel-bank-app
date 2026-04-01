"use client";

import clsx from "clsx";
import { Menu, X } from "lucide-react";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useLanguage } from "@/lib/language-provider";

const PAGE_KEY_BY_PATH: Record<string, "dashboard" | "drivers" | "fuelLogs" | "transfers" | "weeklyMileage"> = {
  "/dashboard": "dashboard",
  "/drivers": "drivers",
  "/fuel-logs": "fuelLogs",
  "/transfers": "transfers",
  "/weekly-mileage": "weeklyMileage"
};

type MobileAppBarProps = {
  open: boolean;
  onToggle: () => void;
};

export function MobileAppBar({ open, onToggle }: MobileAppBarProps) {
  const pathname = usePathname();
  const { t } = useLanguage();
  const pageKey = PAGE_KEY_BY_PATH[pathname] ?? "dashboard";
  const pageLabel = t.nav[pageKey];

  return (
    <div className="mobile-app-bar fixed inset-x-0 top-0 z-30 border-b border-brand-100/60 bg-[linear-gradient(180deg,rgba(251,250,254,0.98),rgba(248,246,252,0.94))] shadow-[0_16px_36px_rgba(38,18,78,0.08)] backdrop-blur-xl md:hidden">
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
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[1.15rem] border border-brand-100/70 bg-white shadow-[0_12px_24px_rgba(38,18,78,0.07)]">
            <Image
              src="/logo.png"
              alt={t.common.appName}
              width={40}
              height={40}
              className="h-8 w-8 object-contain"
              priority
            />
          </div>

          <div className="min-w-0">
            <p className="truncate text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
              {t.common.appName}
            </p>
            <p className="mt-1 truncate text-[15px] font-semibold tracking-[-0.03em] text-slate-950">
              {pageLabel}
            </p>
          </div>
        </div>

        <LanguageSwitcher compact />
      </div>
    </div>
  );
}
