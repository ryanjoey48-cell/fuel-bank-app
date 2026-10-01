"use client";

import { usePathname } from "next/navigation";
import { memo } from "react";
import { AccountMenu } from "@/components/account-menu";
import { EESLogo } from "@/components/ees-logo";
import { useLanguage } from "@/lib/language-provider";

type HeaderProps = {
  title: string;
  description: string;
  showSignOut?: boolean;
};

const ACCENTS = {
  blue: "var(--accent-booking)",
  green: "var(--accent-trip)",
  indigo: "var(--accent-reports)",
  orange: "var(--accent-fuel)",
  purple: "var(--accent-dashboard)",
  red: "var(--accent-support)"
} as const;

function getHeaderAccent(pathname: string) {
  if (pathname.startsWith("/booking-diary")) return ACCENTS.blue;
  if (pathname.startsWith("/dispatch")) return ACCENTS.blue;
  if (pathname.startsWith("/trip-journey")) return ACCENTS.green;
  if (pathname.startsWith("/fuel-logs")) return ACCENTS.orange;
  if (pathname.startsWith("/fuel-spend-report")) return ACCENTS.indigo;
  if (pathname.startsWith("/support") || pathname.startsWith("/admin/support-tickets")) return ACCENTS.red;
  return ACCENTS.purple;
}

function HeaderComponent({ title, description, showSignOut = false }: HeaderProps) {
  const { t } = useLanguage();
  const pathname = usePathname();
  const accent = getHeaderAccent(pathname);

  return (
    <header className="page-header relative overflow-visible px-3.5 py-3 transition duration-150 min-[1367px]:px-4">
      <div className="relative flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 flex-1 items-center gap-3.5">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[0.9rem] border border-[#e4ddff] bg-slate-950 shadow-[0_8px_18px_rgba(79,70,229,0.09)]">
            <EESLogo alt={t.common.appName} size={40} className="h-10 w-10" priority />
          </div>
          <div className="min-w-0">
            <p className="truncate text-[10px] font-bold uppercase tracking-[0.16em] text-brand-700">
              {t.common.appName}
            </p>
            <div className="mt-1 flex min-w-0 items-start gap-3">
              <span
                className="mt-1.5 h-8 w-[3px] shrink-0 rounded-full"
                style={{ backgroundColor: accent }}
                aria-hidden="true"
              />
              <div className="min-w-0">
                <h2
                  className="truncate text-[1.35rem] font-bold leading-8 sm:text-[1.5rem]"
                  style={{ color: accent }}
                >
                  {title}
                </h2>
                <p className="max-w-2xl truncate text-[12px] leading-5 text-slate-500/75 sm:text-[13px]">
                {description}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-stretch gap-3 md:items-end">
          <AccountMenu />
          {showSignOut ? null : null}
        </div>
      </div>
    </header>
  );
}

export const Header = memo(HeaderComponent);
export const PageHeader = Header;
