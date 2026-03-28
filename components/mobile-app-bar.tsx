"use client";

import clsx from "clsx";
import { Menu, X } from "lucide-react";
import Image from "next/image";
import { usePathname } from "next/navigation";
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
  const { language, setLanguage, t } = useLanguage();
  const pageKey = PAGE_KEY_BY_PATH[pathname] ?? "dashboard";
  const pageLabel = t.nav[pageKey];

  return (
    <div className="mobile-app-bar fixed inset-x-0 top-0 z-30 border-b border-white/65 bg-[linear-gradient(180deg,rgba(248,250,252,0.97),rgba(248,250,252,0.9))] shadow-[0_16px_36px_rgba(15,23,42,0.08)] backdrop-blur-xl md:hidden">
      <div className="mx-auto flex min-h-[76px] w-full max-w-full items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={onToggle}
          className={clsx(
            "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/80 bg-white/92 text-slate-900 shadow-[0_12px_28px_rgba(15,23,42,0.12)] transition duration-200",
            open ? "scale-[0.98] bg-slate-950 text-white shadow-[0_18px_32px_rgba(15,23,42,0.18)]" : "active:scale-[0.98]"
          )}
          aria-label={open ? t.nav.closeSidebar : t.nav.openMenu}
          aria-expanded={open}
          aria-controls="mobile-nav-panel"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>

        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[1.15rem] border border-white/80 bg-white shadow-[0_12px_24px_rgba(15,23,42,0.08)]">
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

        <div className="flex shrink-0 rounded-2xl border border-slate-200/80 bg-white/92 p-1 shadow-[0_8px_18px_rgba(15,23,42,0.06)]">
          <button
            type="button"
            onClick={() => setLanguage("en")}
            className={`min-h-[40px] min-w-[44px] rounded-xl px-3 text-xs font-semibold ${
              language === "en"
                ? "bg-slate-950 text-white shadow-[0_10px_20px_rgba(15,23,42,0.14)]"
                : "text-slate-500 hover:text-slate-800"
            }`}
            aria-label={t.common.language}
          >
            EN
          </button>
          <button
            type="button"
            onClick={() => setLanguage("th")}
            className={`min-h-[40px] min-w-[44px] rounded-xl px-3 text-xs font-semibold ${
              language === "th"
                ? "bg-slate-950 text-white shadow-[0_10px_20px_rgba(15,23,42,0.14)]"
                : "text-slate-500 hover:text-slate-800"
            }`}
            aria-label={t.common.language}
          >
            TH
          </button>
        </div>
      </div>
    </div>
  );
}
