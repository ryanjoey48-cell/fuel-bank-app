"use client";

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

export function MobileAppBar() {
  const pathname = usePathname();
  const { language, setLanguage, t } = useLanguage();
  const pageKey = PAGE_KEY_BY_PATH[pathname] ?? "dashboard";
  const pageLabel = t.nav[pageKey];

  return (
    <div className="mobile-app-bar fixed inset-x-0 top-0 z-20 border-b border-slate-200/70 bg-[rgba(248,250,252,0.9)] shadow-[0_10px_24px_rgba(15,23,42,0.07)] backdrop-blur-xl md:hidden">
      <div className="flex min-h-[72px] items-center gap-3 px-4 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-3 pl-14">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/80 bg-white shadow-[0_10px_20px_rgba(15,23,42,0.08)]">
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
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">
              Fuel &amp; Bank App
            </p>
            <p className="mt-1 truncate text-sm font-semibold tracking-[-0.02em] text-slate-950">
              {pageLabel}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 rounded-2xl border border-slate-200/80 bg-white/90 p-1 shadow-[0_8px_18px_rgba(15,23,42,0.06)]">
          <button
            type="button"
            onClick={() => setLanguage("en")}
            className={`min-h-[40px] min-w-[44px] rounded-xl px-3 text-xs font-semibold ${
              language === "en"
                ? "bg-slate-950 text-white shadow-[0_10px_20px_rgba(15,23,42,0.14)]"
                : "text-slate-500"
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
                : "text-slate-500"
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
