"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useEffect } from "react";
import Image from "next/image";
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
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-[#fffbf2]/95 shadow-[0_5px_18px_rgba(57,40,24,0.07)] backdrop-blur-xl">
      <div className="mx-auto flex min-h-[68px] max-w-3xl items-center gap-2 px-4 sm:gap-3 sm:px-6">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[#211336]">
          <EESLogo alt="EES" size={40} className="h-10 w-10 max-w-none scale-[1.8]" priority />
        </span>
        <div className="min-w-0 flex-1">
          <p className="whitespace-nowrap text-[9px] font-black uppercase tracking-[0.12em] text-brand-700">EES Driver</p>
          <p className="mt-0.5 truncate text-sm font-bold text-slate-950">{profile?.displayName || driverName}</p>
        </div>
        {profile?.avatarUrl ? <Image unoptimized key={profile.avatarUrl} src={profile.avatarUrl} width={36} height={36} alt={profile.displayName} className="h-9 w-9 shrink-0 rounded-full object-cover ring-2 ring-white" /> : <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-black text-brand-700">{(profile?.displayName || driverName).slice(0, 1)}</span>}
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

