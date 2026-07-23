"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { MobileAppBar } from "@/components/mobile-app-bar";
import { Sidebar } from "@/components/sidebar";
import { SetupNotice } from "@/components/setup-notice";
import { AdminFetchError, fetchCurrentAccess } from "@/lib/account-management";
import { useLanguage } from "@/lib/language-provider";
import { supabase } from "@/lib/supabase";

export default function DashboardLayout({
  children
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { t } = useLanguage();

  useEffect(() => {
    let active = true;

    const checkSession = async () => {
      const { data } = await supabase.auth.getSession();

      if (!data.session && active) {
        router.replace("/login");
        return;
      }

      try {
        await fetchCurrentAccess();
      } catch (error) {
        if (active && error instanceof AdminFetchError && (error.status === 401 || error.status === 403)) {
          await supabase.auth.signOut();
          router.replace("/login");
          return;
        }
      }

      if (active) {
        setCheckingAuth(false);
      }
    };

    void checkSession();

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        router.replace("/login");
      } else if (pathname === "/login") {
        router.replace("/dashboard");
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [pathname, router]);

  useEffect(() => {
    document.body.style.overflow = "";
    document.documentElement.style.overflow = "";
    setMobileMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileMenuOpen) {
      document.body.style.overflow = "";
      document.documentElement.style.overflow = "";
      return;
    }

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileMenuOpen(false);
      }
    };

    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      document.body.style.overflow = "";
      document.documentElement.style.overflow = "";
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [mobileMenuOpen]);

  if (checkingAuth) {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center px-4">
        <div className="surface-card px-6 py-5 text-sm text-slate-600">
          {t.common.sessionCheck}
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-[100dvh]">
      <Sidebar open={mobileMenuOpen} onClose={() => setMobileMenuOpen(false)} />
      <MobileAppBar
        open={mobileMenuOpen}
        onToggle={() => setMobileMenuOpen((current) => !current)}
      />
      <div className="dashboard-content-frame">
        <main className="dashboard-mobile-shell mx-auto flex min-h-[100dvh] w-full max-w-[1440px] max-w-full flex-col gap-3.5 pb-5 sm:gap-4 sm:px-5 sm:pt-20 sm:pb-6 md:px-6 md:pt-8 md:pb-7 lg:px-8">
          <SetupNotice />
          {children}
        </main>
      </div>
    </div>
  );
}
