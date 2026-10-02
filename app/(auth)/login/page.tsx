"use client";

import Image from "next/image";
import { useState } from "react";
import { AuthForm } from "@/components/auth-form";
import { EESLogo } from "@/components/ees-logo";
import { LanguageSwitcher } from "@/components/language-switcher";
import { SetupNotice } from "@/components/setup-notice";
import { useLanguage } from "@/lib/language-provider";

export default function LoginPage() {
  const { t, language } = useLanguage();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [signupImageFailed, setSignupImageFailed] = useState(false);
  const signup = mode === "signup";
  const hero = signup ? {
    eyebrow: "EES OPERATIONS · TEAM ACCESS",
    title: language === "th" ? "เข้าร่วมพื้นที่ทำงานโลจิสติกส์ของคุณ" : "Join your logistics workspace",
    description: language === "th" ? "ขอสิทธิ์เข้าใช้งานสำหรับคนขับหรือสำนักงาน บัญชีใหม่ทั้งหมดจะได้รับการตรวจสอบก่อนเปิดใช้งาน" : "Request secure access for driver or office operations. All new accounts are reviewed before access is activated."
  } : t.login;

  return (
    <main className="app-workspace-bg min-h-screen px-4 py-4 lg:h-screen lg:overflow-hidden">
      <div className="mx-auto grid w-full max-w-6xl gap-5 lg:h-full lg:grid-cols-[1.08fr_0.92fr] lg:items-stretch lg:gap-7">
        
        {/* LEFT HERO PANEL */}
        <section className="relative min-h-[22rem] overflow-hidden rounded-[2rem] bg-[#211336] text-white shadow-[0_24px_70px_rgba(48,25,78,0.22)] lg:h-full lg:min-h-0">
          <Image
            src={signup && !signupImageFailed ? "/ees-signup-logistics.png" : "/ees-truck.png"}
            onError={() => { if (signup) setSignupImageFailed(true); }}
            alt="EES logistics operations"
            fill
            priority
            sizes="(min-width: 1024px) 55vw, 100vw"
            className="object-cover object-[76%_center] opacity-55"
          />

          <div className="absolute inset-0 bg-gradient-to-br from-[#211336]/95 via-[#3d205d]/76 to-[#c94f25]/48" />

          <div className="relative z-10 flex h-full flex-col justify-between p-6 sm:p-8 lg:p-8 xl:p-10">
            
            {/* BRAND HEADER */}
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white/95 shadow-lg">
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

            {/* MAIN HERO COPY */}
            <div className="max-w-lg py-5 lg:py-4">
              <p className="text-xs font-bold uppercase tracking-[0.25em] text-orange-200">
                {hero.eyebrow}
              </p>

              <h1 className="mt-3 text-3xl font-semibold leading-[1.03] tracking-[-0.04em] sm:text-4xl xl:text-5xl">
                {hero.title}
              </h1>

              <p className="mt-4 max-w-md text-sm leading-6 text-white/85 sm:text-base">
                {hero.description}
              </p>
            </div>

            {/* FOOTER / SETUP NOTICE */}
            <div className="shrink-0">
              <SetupNotice />
            </div>
          </div>
        </section>

        {/* AUTH FORM */}
        <section className="flex min-h-0 items-center justify-center lg:h-full">
          <div className="w-full">
            <AuthForm onModeChange={setMode} />
          </div>
        </section>
      </div>
    </main>
  );
}
