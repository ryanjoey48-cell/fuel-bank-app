"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useEffect } from "react";
import { DriverAvatar } from "./driver-ui";
import type { DriverProfile } from "@/lib/driver-operations";
import Image from "next/image";
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
    <div className="driver-header-slot">
    <header className="driver-portal-header fixed inset-x-0 top-0 z-50 border-b border-[var(--driver-border)] bg-[#fffbf2]">
      <div className="mx-auto flex min-h-[48px] max-w-3xl items-center gap-2 px-3 sm:min-h-[68px] sm:gap-3 sm:px-6 lg:min-h-[88px] lg:max-w-[1152px] lg:gap-4 lg:[&_[role=group]_button]:min-h-10 lg:[&_[role=group]_button]:min-w-12 lg:[&_[role=group]_button]:text-sm">
        <div className="flex min-w-0 flex-1 items-center gap-2 lg:gap-3">
        <span className="driver-header-logo relative h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-[var(--driver-border)] bg-[#f3eee5] lg:h-14 lg:w-16">
          {/* The official artwork has wide transparent margins. Only those margins
              extend outside this frame; the complete logo retains its aspect ratio. */}
          <Image src="/ees-logo.png" alt="EES" width={1536} height={1024} sizes="(min-width: 1024px) 148px, 100px" className="absolute left-1/2 top-[55%] h-auto w-[100px] max-w-none -translate-x-1/2 -translate-y-1/2 object-contain lg:w-[148px]" priority />
        </span>
        <div className="min-w-0 flex-1">
          <p className="whitespace-nowrap text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-500 lg:text-xs">EES Driver</p>
          <p className="mt-0.5 truncate text-sm font-semibold text-[#152638] lg:text-xl">{profile?.displayName || driverName}</p>
        </div>
        </div>
        <div className="driver-header-controls flex shrink-0 items-center gap-1.5 lg:gap-3">
        <DriverAvatar src={profile?.avatarUrl} name={profile?.displayName || driverName} className="h-8 w-8 rounded-full lg:h-12 lg:w-12 lg:text-lg" />
        <LanguageSwitcher compact />
        <button
          type="button"
          onClick={() => void signOut()}
          disabled={signingOut}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[var(--driver-border)] bg-[#fffdf8] text-slate-600 hover:text-[#152638] disabled:opacity-50 lg:h-12 lg:w-12"
          aria-label={language === "th" ? "ออกจากระบบ" : "Sign out"}
        >
          <LogOut className="h-4 w-4" />
        </button>
        </div>
      </div>
    </header>
    </div>
  );
}

