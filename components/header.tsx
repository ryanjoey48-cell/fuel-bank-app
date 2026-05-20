"use client";

import { LogOut } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { memo } from "react";
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
    <header className="surface-card hidden overflow-hidden px-3.5 py-3 min-[1367px]:block min-[1367px]:px-4">
      <div className="absolute inset-x-0 top-0 h-full bg-[linear-gradient(135deg,rgba(95,51,183,0.035),rgba(242,138,47,0.014)_58%,transparent)]" />
      <div className="relative flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 flex-1 items-center gap-3.5">
          <div className="flex h-14 w-16 shrink-0 items-center justify-center rounded-[0.8rem] border border-slate-200 bg-white/95 shadow-[0_8px_18px_rgba(38,18,78,0.055),inset_0_1px_0_rgba(255,255,255,0.92)]">
            <Image
              src="/logo.png"
              alt={t.common.appName}
              width={92}
              height={64}
              className="h-12 w-auto object-contain brightness-105"
              priority
            />
          </div>
          <div className="min-w-0">
            <p className="truncate text-[10px] font-bold uppercase tracking-[0.16em] text-brand-700">
              {t.common.appName}
            </p>
            <div className="mt-0.5 flex min-w-0 flex-col gap-0.5 lg:flex-row lg:items-baseline lg:gap-3">
              <h2 className="truncate text-[1.2rem] font-semibold leading-7 text-slate-950 sm:text-[1.35rem]">
                {title}
              </h2>
              <p className="max-w-2xl truncate text-[12px] leading-5 text-slate-500 sm:text-[13px]">
                {description}
              </p>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-stretch gap-3 md:items-end">
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
