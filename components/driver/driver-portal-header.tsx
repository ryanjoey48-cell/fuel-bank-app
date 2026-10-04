"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useEffect } from "react";
import { DriverAvatar } from "./driver-ui";
import type { DriverProfile } from "@/lib/driver-operations";
import { EESLogo } from "@/components/ees-logo";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useLanguage } from "@/lib/language-provider";

export function DriverPortalHeader({ driverName }: { driverName: string }) {
  const router = useRouter();
  const { language } = useLanguage();
  const [signingOut, setSigningOut] = useState(false);
  const [profile, setProfile] = useState<DriverProfile | null>(null);
  useEffect(() => {
    let active = true;
    const load = async () => { try { const response = await fetch("/api/driver/profile", { cache: "no-store" }); if (response.ok && active) setProfile(await response.json()); } catch { /* Keep official identity visible if profile service is unavailable. */ } };
    const updated = (event: Event) => setProfile((event as CustomEvent<DriverProfile>).detail);
    window.addEventListener("ees-driver-profile-updated", updated);
    void load();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 60000);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener("ees-driver-profile-updated", updated); };
  }, []);

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
    <header className="driver-portal-header sticky top-0 z-30 border-b border-slate-200 bg-[#fffbf2]/95 shadow-sm backdrop-blur-xl">
      <div className="mx-auto flex min-h-[50px] max-w-3xl items-center gap-2 px-3 sm:min-h-[68px] sm:gap-3 sm:px-6 lg:min-h-[88px] lg:max-w-[1152px] lg:gap-4 lg:[&_[role=group]_button]:min-h-10 lg:[&_[role=group]_button]:min-w-12 lg:[&_[role=group]_button]:text-sm">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[#152638] lg:h-14 lg:w-14 lg:rounded-2xl">
          <EESLogo alt="EES" size={40} className="h-10 w-10 max-w-none scale-[1.8] lg:h-14 lg:w-14" priority />
        </span>
        <div className="min-w-0 flex-1">
          <p className="whitespace-nowrap text-[9px] font-black uppercase tracking-[0.12em] text-[#152638] lg:text-xs">EES Driver</p>
          <p className="mt-0.5 truncate text-sm font-bold text-slate-950 lg:text-xl">{profile?.displayName || driverName}</p>
        </div>
        <DriverAvatar src={profile?.avatarUrl} name={profile?.displayName || driverName} className="h-8 w-8 rounded-full lg:h-12 lg:w-12 lg:text-lg" />
        <LanguageSwitcher compact />
        <button
          type="button"
          onClick={() => void signOut()}
          disabled={signingOut}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-[#fffdf8] text-slate-600 shadow-sm hover:border-brand-200 hover:text-brand-700 disabled:opacity-50 lg:h-12 lg:w-12"
          aria-label={language === "th" ? "ออกจากระบบ" : "Sign out"}
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}

