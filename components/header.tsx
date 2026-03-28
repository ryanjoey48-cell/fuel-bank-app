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
    <header className="surface-card hidden overflow-hidden p-4 sm:p-5 md:block">
      <div className="absolute inset-x-0 top-0 h-16 bg-[linear-gradient(135deg,rgba(109,40,217,0.08),rgba(249,115,22,0.04)_55%,transparent)]" />
      <div className="relative flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-slate-200/80 bg-white/88 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 shadow-[0_8px_18px_rgba(15,23,42,0.05)]">
            {t.common.operations}
          </div>
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/80 bg-white shadow-[0_14px_28px_rgba(15,23,42,0.08)] sm:h-12 sm:w-12">
              <Image
                src="/logo.png"
                alt={t.common.appName}
                width={64}
                height={48}
                className="h-8 w-8 object-contain"
                priority
              />
            </div>
            <div className="min-w-0">
              <h2 className="text-[1.35rem] font-semibold tracking-[-0.04em] text-slate-950 sm:text-[1.7rem]">
                {title}
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500 sm:text-[15px]">
                {description}
              </p>
            </div>
          </div>
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
