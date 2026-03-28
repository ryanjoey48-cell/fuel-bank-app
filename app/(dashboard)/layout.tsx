"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Sidebar } from "@/components/sidebar";
import { MobileAppBar } from "@/components/mobile-app-bar";
import { MobileBottomNav } from "@/components/mobile-bottom-nav";
import { SetupNotice } from "@/components/setup-notice";
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
  const { t } = useLanguage();

  useEffect(() => {
    let active = true;

    const checkSession = async () => {
      const { data } = await supabase.auth.getSession();

      if (!data.session && active) {
        router.replace("/login");
        return;
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

  if (checkingAuth) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="surface-card px-6 py-5 text-sm text-slate-600">
          {t.common.sessionCheck}
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-screen">
      <Sidebar />
      <MobileAppBar />
      <MobileBottomNav />
      <div className="md:pl-72">
        <main className="dashboard-mobile-shell mx-auto flex min-h-screen w-full max-w-[1440px] max-w-full flex-col gap-4 pb-[7.5rem] sm:gap-4.5 sm:px-5 sm:pt-20 sm:pb-8 md:px-6 md:pt-8 md:pb-7 lg:px-8">
          <SetupNotice />
          {children}
        </main>
      </div>
    </div>
  );
}
