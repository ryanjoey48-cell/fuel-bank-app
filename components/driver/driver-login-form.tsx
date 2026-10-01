"use client";

import { ArrowRight, LockKeyhole } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { EESLogo } from "@/components/ees-logo";
import { LanguageSwitcher } from "@/components/language-switcher";
import { resolveLoginRouting } from "@/lib/account-management";
import { useLanguage } from "@/lib/language-provider";
import { supabase } from "@/lib/supabase";

const copy = {
  en: {
    eyebrow: "EES Driver",
    title: "Driver sign in",
    description: "Use the account provided by the office to view your assigned jobs.",
    email: "Email",
    emailPlaceholder: "driver@example.com",
    password: "Password",
    passwordPlaceholder: "Enter your password",
    submit: "Sign in",
    loading: "Signing in…",
    fallbackError: "Unable to sign in. Please try again."
  },
  th: {
    eyebrow: "EES DRIVER",
    title: "เข้าสู่ระบบคนขับ",
    description: "ใช้บัญชีที่สำนักงานจัดให้เพื่อดูงานที่ได้รับมอบหมาย",
    email: "อีเมล",
    emailPlaceholder: "driver@example.com",
    password: "รหัสผ่าน",
    passwordPlaceholder: "กรอกรหัสผ่าน",
    submit: "เข้าสู่ระบบ",
    loading: "กำลังเข้าสู่ระบบ…",
    fallbackError: "ไม่สามารถเข้าสู่ระบบได้ กรุณาลองอีกครั้ง"
  }
} as const;

export function DriverLoginForm() {
  const router = useRouter();
  const { language } = useLanguage();
  const labels = copy[language];
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError || !data.session) {
        setError(labels.fallbackError);
        return;
      }

      const routing = await resolveLoginRouting(data.session.access_token);
      if (routing.accountType === "driver") {
        await supabase.auth.signOut({ scope: "local" });
      }
      router.replace(routing.destination);
      router.refresh();
    } catch {
      await supabase.auth.signOut({ scope: "local" });
      setError(labels.fallbackError);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-[var(--app-background)] px-4 py-8">
      <section className="w-full max-w-md rounded-[1.5rem] border border-slate-200 bg-[#fffdf8] p-5 shadow-[0_24px_70px_rgba(57,40,24,0.13)] sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl bg-[#211336] shadow-sm">
              <EESLogo alt="EES" size={56} className="h-14 w-14 max-w-none scale-[1.8]" priority />
            </span>
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.18em] text-brand-700">{labels.eyebrow}</p>
              <p className="mt-1 text-xs font-semibold text-slate-500">Logistics Control</p>
            </div>
          </div>
          <LanguageSwitcher compact />
        </div>

        <div className="mt-8">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
            <LockKeyhole className="h-5 w-5" />
          </span>
          <h1 className="mt-4 text-2xl font-black tracking-[-0.035em] text-slate-950">{labels.title}</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">{labels.description}</p>
        </div>

        <form className="mt-7 space-y-5" onSubmit={submit}>
          <label className="block">
            <span className="form-label">{labels.email}</span>
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder={labels.emailPlaceholder}
              className="form-input"
            />
          </label>

          <label className="block">
            <span className="form-label">{labels.password}</span>
            <input
              type="password"
              autoComplete="current-password"
              required
              minLength={6}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={labels.passwordPlaceholder}
              className="form-input"
            />
          </label>

          {error ? (
            <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-sm font-semibold text-rose-700">
              {error}
            </p>
          ) : null}

          <button type="submit" disabled={loading} className="btn-primary w-full gap-2 disabled:cursor-not-allowed disabled:opacity-60">
            {loading ? labels.loading : labels.submit}
            {!loading ? <ArrowRight className="h-4 w-4" /> : null}
          </button>
        </form>
      </section>
    </main>
  );
}

