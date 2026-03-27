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
    <header className="surface-card p-3.5 sm:p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-11 shrink-0 items-center justify-center rounded-lg border border-white/70 bg-white/78 shadow-[0_1px_2px_rgba(0,0,0,0.04)] sm:h-10 sm:w-12">
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
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-brand-700">
                {t.common.operations}
              </p>
              <h2 className="mt-0.5 text-[17px] font-semibold tracking-tight text-slate-950 sm:text-[1.3rem]">
                {title}
              </h2>
            </div>
          </div>
          <p className="mt-2 max-w-2xl text-sm leading-5 text-slate-500">
            {description}
          </p>
        </div>

        {showSignOut ? (
          <button
            onClick={handleLogout}
            type="button"
            className="btn-secondary w-full gap-2 sm:w-auto"
          >
            <LogOut className="h-4 w-4" />
            {t.common.signOut}
          </button>
        ) : null}
      </div>
    </header>
  );
}
