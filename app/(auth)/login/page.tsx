"use client";

import { AuthForm } from "@/components/auth-form";
import { SetupNotice } from "@/components/setup-notice";
import { useLanguage } from "@/lib/language-provider";

export default function LoginPage() {
  const { t } = useLanguage();

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-8 sm:py-10">
      <div className="grid w-full max-w-6xl gap-6 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:gap-10">
        <section className="rounded-[2rem] border border-brand-100/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(247,244,252,0.95))] px-6 py-8 text-slate-950 shadow-[0_32px_70px_rgba(38,18,78,0.08)] sm:px-10 sm:py-10">
          <p className="text-sm font-semibold uppercase tracking-[0.25em] text-brand-700">
            {t.login.eyebrow}
          </p>
          <h1 className="mt-4 text-3xl font-semibold leading-tight tracking-[-0.04em] sm:text-5xl">
            {t.login.title}
          </h1>
          <p className="mt-5 max-w-xl text-sm leading-7 text-slate-600 sm:text-base">
            {t.login.description}
          </p>
          <div className="mt-8">
            <SetupNotice />
          </div>
        </section>

        <section className="flex justify-center">
          <AuthForm />
        </section>
      </div>
    </main>
  );
}
