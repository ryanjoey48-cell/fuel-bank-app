"use client";

import { LogOut } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/lib/language-provider";
import { supabase } from "@/lib/supabase";

type HeaderProps = {
  title: string;
  description: string;
  showSignOut?: boolean;
};

export function Header({ title, description, showSignOut = false }: HeaderProps) {
  const router = useRouter();
  const { t } = useLanguage();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.replace("/login");
  };

  return (
    <header className="rounded-[2rem] border border-white/60 bg-white/90 p-4 shadow-soft backdrop-blur sm:p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-14 shrink-0 items-center justify-center sm:h-12 sm:w-16">
              <Image
                src="/logo.png"
                alt={t.common.appName}
                width={64}
                height={48}
                className="h-full w-auto object-contain"
                priority
              />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-brand-600">
                {t.common.operations}
              </p>
              <h2 className="mt-1 text-xl font-semibold text-slate-950 sm:text-2xl">{title}</h2>
            </div>
          </div>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-500">{description}</p>
        </div>

        {showSignOut ? (
          <button
            onClick={handleLogout}
            type="button"
            className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50 sm:w-auto"
          >
            <LogOut className="h-4 w-4" />
            {t.common.signOut}
          </button>
        ) : null}
      </div>
    </header>
  );
}
