"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { EESLogo } from "@/components/ees-logo";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useLanguage } from "@/lib/language-provider";

export function DriverPortalHeader({ driverName }: { driverName: string }) {
  const router = useRouter();
  const { language } = useLanguage();
  const [signingOut, setSigningOut] = useState(false);

  const signOut = async () => {
    setSigningOut(true);
    try {
      await fetch("/api/driver/session", { method: "DELETE" });
    } finally {
      router.replace("/driver/login");
      router.refresh();
    }
  };

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-[#fffbf2]/95 shadow-[0_5px_18px_rgba(57,40,24,0.07)] backdrop-blur-xl">
      <div className="mx-auto flex min-h-[68px] max-w-3xl items-center gap-3 px-4 sm:px-6">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[#211336]">
          <EESLogo alt="EES" size={44} className="h-11 w-11 max-w-none scale-[1.8]" priority />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-black uppercase tracking-[0.17em] text-brand-700">EES Driver</p>
          <p className="mt-0.5 truncate text-sm font-bold text-slate-950">{driverName}</p>
        </div>
        <LanguageSwitcher compact />
        <button
          type="button"
          onClick={() => void signOut()}
          disabled={signingOut}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-[#fffdf8] text-slate-600 shadow-sm hover:border-brand-200 hover:text-brand-700 disabled:opacity-50"
          aria-label={language === "th" ? "ออกจากระบบ" : "Sign out"}
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}

