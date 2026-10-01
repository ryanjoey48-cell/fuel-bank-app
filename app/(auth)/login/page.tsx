"use client";

import Image from "next/image";
import { AuthForm } from "@/components/auth-form";
import { EESLogo } from "@/components/ees-logo";
import { LanguageSwitcher } from "@/components/language-switcher";
import { SetupNotice } from "@/components/setup-notice";
import { useLanguage } from "@/lib/language-provider";

export default function LoginPage() {
  const { t } = useLanguage();

  return (
    <main className="app-workspace-bg flex min-h-screen items-center justify-center px-4 py-8 sm:py-10">
      <div className="grid w-full max-w-6xl gap-6 lg:grid-cols-[1.08fr_0.92fr] lg:items-stretch lg:gap-8">
        <section className="relative min-h-[24rem] overflow-hidden rounded-[2rem] bg-[#211336] text-white shadow-[0_24px_70px_rgba(48,25,78,0.22)] sm:min-h-[30rem]">
          <Image
            src="/ees-truck.png"
            alt="EES logistics lorry"
            fill
            priority
            sizes="(min-width: 1024px) 55vw, 100vw"
            className="object-cover object-[76%_center] opacity-55"
          />
          <div className="absolute inset-0 bg-gradient-to-br from-[#211336]/95 via-[#3d205d]/76 to-[#c94f25]/48" />

          <div className="relative z-10 flex h-full min-h-[24rem] flex-col justify-between p-6 sm:min-h-[30rem] sm:p-10">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl bg-white/95 shadow-lg">
                  <EESLogo
                    alt="EES"
                    size={56}
                    className="h-14 w-14 max-w-none scale-[1.8]"
                    priority
                  />
                </span>
                <div>
                  <p className="text-sm font-black uppercase tracking-[0.16em]">
                    EES Operations
                  </p>
                  <p className="mt-1 text-xs font-bold uppercase tracking-[0.22em] text-orange-200">
                    Logistics Control
                  </p>
                </div>
              </div>
              <LanguageSwitcher compact />
            </div>

            <div className="max-w-lg py-8">
              <p className="text-xs font-bold uppercase tracking-[0.25em] text-orange-200">
                {t.login.eyebrow}
              </p>
              <h1 className="mt-4 text-3xl font-semibold leading-tight tracking-[-0.04em] sm:text-5xl">
                {t.login.title}
              </h1>
              <p className="mt-5 max-w-md text-sm leading-7 text-white/82 sm:text-base">
                {t.login.description}
              </p>
            </div>

            <div>
              <SetupNotice />
            </div>
          </div>
        </section>

        <section className="flex justify-center">
          <AuthForm />
        </section>
      </div>
    </main>
  );
}