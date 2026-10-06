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
    subheading: "Logistics Control",
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
    subheading: "ระบบงานขนส่ง",
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
    <main className="flex min-h-[100dvh] items-center justify-center bg-[var(--driver-bg)] px-4 py-8">
      <section className="w-full max-w-md rounded-[1.5rem] border border-[var(--driver-border)] bg-[var(--driver-surface)] p-5 shadow-[0_24px_70px_rgba(57,40,24,0.13)] sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl bg-[var(--driver-surface)] shadow-sm">
              <EESLogo alt="EES" size={56} className="h-14 w-14 max-w-none scale-[1.8]" priority />
            </span>
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.18em] driver-accent">{labels.eyebrow}</p>
              <p className="mt-1 text-xs font-semibold text-[var(--driver-text-muted)]">{labels.subheading}</p>
            </div>
          </div>
          <LanguageSwitcher compact />
        </div>

        <div className="mt-8">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--driver-surface-soft)] driver-accent">
            <LockKeyhole className="h-5 w-5" />
          </span>
          <h1 className="mt-4 text-2xl font-black tracking-[-0.035em] text-[var(--driver-text)]">{labels.title}</h1>
          <p className="mt-2 text-sm leading-6 text-[var(--driver-text-muted)]">{labels.description}</p>
        </div>

        <form className="mt-7 space-y-5" onSubmit={submit}>
          <label className="block">
            <span className="block text-sm font-semibold text-[var(--driver-text-secondary)]">{labels.email}</span>
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder={labels.emailPlaceholder}
              className="driver-field"
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
            <p role="alert" className="rounded-xl border border-[var(--driver-border)] bg-[var(--driver-surface-soft)] px-3.5 py-3 text-sm font-semibold text-[var(--driver-text-muted)]">
              {error}
            </p>
          ) : null}

          <button type="submit" disabled={loading} className="driver-primary-action flex min-h-11 w-full items-center justify-center gap-2 rounded-xl font-bold disabled:cursor-not-allowed disabled:opacity-60">
            {loading ? labels.loading : labels.submit}
            {!loading ? <ArrowRight className="h-4 w-4" /> : null}
          </button>
        </form>
      </section>
    </main>
  );
}

