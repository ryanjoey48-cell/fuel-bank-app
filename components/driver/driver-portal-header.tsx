"use client";

import Image from "next/image";
import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { DriverAvatar } from "./driver-ui";
import type { DriverProfile } from "@/lib/driver-operations";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useLanguage } from "@/lib/language-provider";

export function DriverPortalHeader({ driverName }: { driverName: string }) {
  const router = useRouter();
  const { language } = useLanguage();
  const [signingOut, setSigningOut] = useState(false);
  const [profile, setProfile] = useState<DriverProfile | null>(null);

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const response = await fetch(`/api/driver/profile?_=${Date.now()}`, {
          cache: "no-store",
          credentials: "same-origin",
          headers: { "Cache-Control": "no-cache", Pragma: "no-cache" }
        });

        if (response.ok && active) {
          setProfile(await response.json());
        }
      } catch {
        // Keep official identity visible if profile service is unavailable.
      }
    };

    const updated = (event: Event) => {
      setProfile((event as CustomEvent<DriverProfile>).detail);
    };

    const onFocus = () => void load();
    const onVisibility = () => {
      if (document.visibilityState === "visible") void load();
    };

    window.addEventListener("ees-driver-profile-updated", updated);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    void load();

    return () => {
      active = false;
      window.removeEventListener("ees-driver-profile-updated", updated);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
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
      <header className="driver-portal-header fixed inset-x-0 top-0 z-50 border-b border-[var(--driver-border)] bg-[var(--driver-surface)] backdrop-blur">
        <div className="mx-auto flex min-h-10 max-w-3xl items-center gap-1.5 px-3 sm:min-h-[52px] sm:px-4 lg:max-w-[1152px]">
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <span className="driver-header-logo relative h-8 w-8 shrink-0 overflow-hidden rounded-lg border border-[var(--driver-border)] bg-[var(--driver-surface)] sm:h-9 sm:w-10">
              <Image
                src="/ees-logo.png"
                alt="EES"
                width={1536}
                height={1024}
                sizes="96px"
                className="absolute left-1/2 top-[55%] h-auto w-[74px] max-w-none -translate-x-1/2 -translate-y-1/2 object-contain sm:w-[86px]"
                priority
              />
            </span>

            <div className="min-w-0 flex-1">
              <p className="whitespace-nowrap text-[7px] font-bold uppercase tracking-[0.16em] text-[var(--driver-text-muted)] sm:text-[8px]">
                EES Driver
              </p>
              <p className="truncate text-[12px] font-bold leading-[15px] text-[var(--driver-text)] sm:text-[13px]">
                {profile?.displayName || driverName}
              </p>
            </div>
          </div>

          <div className="driver-header-controls flex shrink-0 items-center gap-0.5">
            <DriverAvatar
              src={profile?.avatarUrl}
              name={profile?.displayName || driverName}
              className="h-7 w-7 rounded-full"
            />

            <LanguageSwitcher compact />

            <button
              type="button"
              onClick={() => void signOut()}
              disabled={signingOut}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--driver-border)] bg-[var(--driver-surface)] text-[var(--driver-text-muted)] transition-colors active:bg-[var(--driver-surface)] disabled:opacity-50"
              aria-label={language === "th" ? "ออกจากระบบ" : "Sign out"}
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </header>
    </div>
  );
}
