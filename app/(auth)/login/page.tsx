"use client";

import { AuthForm } from "@/components/auth-form";
import { SetupNotice } from "@/components/setup-notice";
import { useLanguage } from "@/lib/language-provider";

export default function LoginPage() {
  const { t } = useLanguage();

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="grid w-full max-w-6xl gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
        <section className="rounded-[2rem] border border-brand-900/40 bg-[radial-gradient(circle_at_top_right,rgba(249,115,22,0.12),transparent_20%),linear-gradient(180deg,#17142f_0%,#231c45_100%)] px-8 py-10 text-white shadow-[0_32px_70px_rgba(36,24,71,0.28)] sm:px-10">
          <p className="text-sm font-semibold uppercase tracking-[0.25em] text-brand-300">
            {t.login.eyebrow}
          </p>
          <h1 className="mt-4 text-4xl font-semibold leading-tight tracking-[-0.04em] sm:text-5xl">
            {t.login.title}
          </h1>
          <p className="mt-6 max-w-xl text-base text-slate-300">
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
