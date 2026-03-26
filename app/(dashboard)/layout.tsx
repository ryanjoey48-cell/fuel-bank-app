"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Sidebar } from "@/components/sidebar";
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
        <div className="rounded-[2rem] border border-white/60 bg-white/90 px-6 py-5 text-sm text-slate-600 shadow-soft">
          {t.common.sessionCheck}
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-screen">
      <Sidebar />
      <div className="md:pl-72">
        <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-4 px-4 pb-8 pt-20 sm:gap-5 md:px-6 md:pb-10 md:pt-8 lg:px-8">
          <SetupNotice />
          {children}
        </main>
      </div>
    </div>
  );
}
