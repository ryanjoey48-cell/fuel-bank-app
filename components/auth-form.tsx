"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/lib/language-provider";
import { supabase } from "@/lib/supabase";

export function AuthForm() {
  const router = useRouter();
  const { t } = useLanguage();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setMessage(null);

    const action =
      mode === "login"
        ? supabase.auth.signInWithPassword({ email, password })
        : supabase.auth.signUp({ email, password });

    const { error } = await action;

    if (error) {
      setMessage(mode === "login" ? t.login.loginError : t.login.signupError);
      setLoading(false);
      return;
    }

    setMessage(
      mode === "signup"
        ? t.login.signupSuccess
        : t.login.loginSuccess
    );

    setLoading(false);

    if (mode === "login") {
      router.replace("/dashboard");
    }
  };

  return (
    <div className="surface-card w-full max-w-md p-8">
      <div className="mb-8 flex rounded-2xl border border-slate-200/80 bg-slate-100/90 p-1">
        <button
          type="button"
          className={`flex-1 rounded-2xl px-4 py-3 text-sm font-medium ${
            mode === "login"
              ? "bg-white text-brand-700 shadow-[0_10px_20px_rgba(109,40,217,0.12)]"
              : "text-slate-500"
          }`}
          onClick={() => setMode("login")}
        >
          {t.login.loginTab}
        </button>
        <button
          type="button"
          className={`flex-1 rounded-2xl px-4 py-3 text-sm font-medium ${
            mode === "signup"
              ? "bg-white text-brand-700 shadow-[0_10px_20px_rgba(109,40,217,0.12)]"
              : "text-slate-500"
          }`}
          onClick={() => setMode("signup")}
        >
          {t.login.signupTab}
        </button>
      </div>

      <form className="space-y-4" onSubmit={handleSubmit}>
        <div>
          <label className="mb-2 block text-sm font-medium text-slate-700">{t.login.email}</label>
          <input
            type="email"
            required
            placeholder={t.login.emailPlaceholder}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-slate-700">
            {t.login.password}
          </label>
          <input
            type="password"
            required
            minLength={6}
            placeholder={t.login.passwordPlaceholder}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>

        {message ? (
          <p className="rounded-2xl border border-brand-100 bg-brand-50/80 px-4 py-3 text-sm text-brand-800">
            {message}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={loading}
          className="btn-primary w-full disabled:cursor-not-allowed disabled:opacity-70"
        >
          {loading ? t.login.waiting : mode === "login" ? t.login.signIn : t.login.createAccount}
        </button>
      </form>
    </div>
  );
}
