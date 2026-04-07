"use client";

import { LogOut } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { memo } from "react";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useLanguage } from "@/lib/language-provider";
import { supabase } from "@/lib/supabase";

type HeaderProps = {
  title: string;
  description: string;
  showSignOut?: boolean;
};

function HeaderComponent({ title, description, showSignOut = false }: HeaderProps) {
  const router = useRouter();
  const { t } = useLanguage();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.replace("/login");
  };

  return (
    <header className="surface-card hidden overflow-hidden p-5 sm:p-6 md:block">
      <div className="absolute inset-x-0 top-0 h-20 bg-[linear-gradient(135deg,rgba(95,51,183,0.065),rgba(242,138,47,0.025)_55%,transparent)]" />
      <div className="relative flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 flex-1">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-brand-100/70 bg-white/92 px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-700 shadow-[0_10px_20px_rgba(38,18,78,0.05)]">
            {t.common.operations}
          </div>
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[1.2rem] border border-brand-100/70 bg-white shadow-[0_16px_30px_rgba(38,18,78,0.07)] sm:h-[3.25rem] sm:w-[3.25rem]">
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
              <h2 className="text-[1.45rem] font-semibold tracking-[-0.045em] text-slate-950 sm:text-[1.82rem]">
                {title}
              </h2>
              <p className="mt-2.5 max-w-2xl text-[13px] leading-7 text-slate-500 sm:text-[15px]">
                {description}
              </p>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-stretch gap-3 md:items-end">
          <LanguageSwitcher />

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
      </div>
    </header>
  );
}

export const Header = memo(HeaderComponent);
