"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/lib/language-provider";
import { getLastAuthRequestDebug, supabase } from "@/lib/supabase";

const DEFAULT_RETURN_PATH = "/dashboard";
type AuthFormResult =
  | Awaited<ReturnType<typeof supabase.auth.signInWithPassword>>
  | Awaited<ReturnType<typeof supabase.auth.signUp>>;

function safeReturnPath(value: string | null) {
  if (!value) return DEFAULT_RETURN_PATH;

  try {
    const decoded = decodeURIComponent(value);
    if (!decoded.startsWith("/") || decoded.startsWith("//") || decoded.includes("\\")) {
      return DEFAULT_RETURN_PATH;
    }
    if (decoded === "/login" || decoded.startsWith("/login?")) {
      return DEFAULT_RETURN_PATH;
    }
    return decoded;
  } catch {
    return DEFAULT_RETURN_PATH;
  }
}

function isInvalidCredentialError(detail?: string) {
  return /invalid login credentials|invalid credentials/i.test(detail ?? "");
}

function bilingualSignInError(detail?: string) {
  const isCredentialProblem = isInvalidCredentialError(detail);
  const english = isCredentialProblem
    ? "Unable to sign in. Please check your email and password, then try again."
    : "Unable to sign in right now. Please try again.";

  return [
    english,
    isCredentialProblem
      ? "ไม่สามารถเข้าสู่ระบบได้ กรุณาตรวจสอบอีเมลและรหัสผ่าน แล้วลองอีกครั้ง"
      : "ไม่สามารถเข้าสู่ระบบได้ในขณะนี้ กรุณาลองอีกครั้ง"
  ].join(" / ");
}

function reportAuthDiagnostics(details: Record<string, unknown>) {
  if (process.env.NODE_ENV === "production") return;
  console.info("[fuel-bank-auth]", {
    ...details,
    lastAuthRequest: getLastAuthRequestDebug()
  });
}

export function AuthForm() {
  const router = useRouter();
  const { t } = useLanguage();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [returnPath, setReturnPath] = useState(DEFAULT_RETURN_PATH);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setReturnPath(safeReturnPath(params.get("next")));
  }, []);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setMessage(null);

    let authResult: AuthFormResult;
    try {
      const action =
        mode === "login"
          ? supabase.auth.signInWithPassword({ email, password })
          : supabase.auth.signUp({ email, password });
      authResult = await action;
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Data service unavailable";
      reportAuthDiagnostics({
        event: mode === "login" ? "sign-in-request-threw" : "sign-up-request-threw",
        error: detail,
        redirectTo: returnPath
      });
      setMessage(mode === "login" ? bilingualSignInError(detail) : t.login.signupError);
      setLoading(false);
      return;
    }

    const { error } = authResult;
    const returnedSession = authResult.data?.session ?? null;
    const returnedUser = authResult.data?.user ?? null;

    reportAuthDiagnostics({
      event: mode === "login" ? "sign-in-response" : "sign-up-response",
      hasSession: Boolean(returnedSession),
      hasUser: Boolean(returnedUser),
      hasError: Boolean(error),
      errorName: error?.name ?? null,
      errorMessage: error?.message ?? null,
      errorStatus: "status" in (error ?? {}) ? (error as { status?: number }).status ?? null : null,
      redirectTo: returnPath
    });

    if (error) {
      setMessage(mode === "login" ? bilingualSignInError(error.message) : t.login.signupError);
      setLoading(false);
      return;
    }

    if (mode === "login") {
      let verifiedSession = returnedSession;
      let sessionResult: Awaited<ReturnType<typeof supabase.auth.getSession>>;

      if (!verifiedSession) {
        try {
          sessionResult = await supabase.auth.getSession();
        } catch (error) {
          const detail = error instanceof Error ? error.message : "Data service unavailable";
          reportAuthDiagnostics({
            event: "sign-in-session-check-threw",
            error: detail,
            redirectTo: returnPath
          });
          setMessage(bilingualSignInError(detail));
          setLoading(false);
          return;
        }

        const { data, error: sessionError } = sessionResult;
        verifiedSession = data.session;
        reportAuthDiagnostics({
          event: "sign-in-session-check",
          hasSession: Boolean(data.session),
          hasError: Boolean(sessionError),
          errorName: sessionError?.name ?? null,
          errorMessage: sessionError?.message ?? null,
          redirectTo: returnPath
        });

        if (sessionError || !data.session) {
          setMessage(bilingualSignInError(sessionError?.message || "No local session was saved"));
          setLoading(false);
          return;
        }
      } else {
        reportAuthDiagnostics({
          event: "sign-in-returned-session-used",
          hasSession: true,
          redirectTo: returnPath
        });
      }

    }

    setMessage(
      mode === "signup"
        ? t.login.signupSuccess
        : t.login.loginSuccess
    );

    setLoading(false);

    if (mode === "login") {
      router.replace(returnPath);
    }
  };

  return (
    <div className="surface-card w-full max-w-md p-6 sm:p-8">
      <div className="mb-7">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
          Fuel &amp; Bank App
        </p>
        <h2 className="mt-2.5 text-[1.9rem] font-semibold tracking-[-0.045em] text-slate-950">
          {mode === "login" ? t.login.signIn : t.login.createAccount}
        </h2>
      </div>

      <div className="mb-8 flex rounded-[1rem] border border-brand-100 bg-brand-50/60 p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
        <button
          type="button"
          className={`flex-1 rounded-[1.05rem] px-4 py-3.5 text-sm font-medium transition ${
            mode === "login"
              ? "bg-white/85 text-brand-700 shadow-[0_12px_24px_rgba(95,51,183,0.12)]"
              : "text-slate-500 hover:text-slate-700"
          }`}
          onClick={() => setMode("login")}
        >
          {t.login.loginTab}
        </button>
        <button
          type="button"
          className={`flex-1 rounded-[1.05rem] px-4 py-3.5 text-sm font-medium transition ${
            mode === "signup"
              ? "bg-white/85 text-brand-700 shadow-[0_12px_24px_rgba(95,51,183,0.12)]"
              : "text-slate-500 hover:text-slate-700"
          }`}
          onClick={() => setMode("signup")}
        >
          {t.login.signupTab}
        </button>
      </div>

      <form className="space-y-6" onSubmit={handleSubmit}>
        <div className="form-field">
          <label className="form-label">{t.login.email}</label>
          <input
            type="email"
            required
            placeholder={t.login.emailPlaceholder}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="form-input"
          />
        </div>

        <div className="form-field">
          <label className="form-label">{t.login.password}</label>
          <input
            type="password"
            required
            minLength={6}
            placeholder={t.login.passwordPlaceholder}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="form-input"
          />
        </div>

        {message ? (
          <p className="app-card-soft px-4.5 py-3.5 text-sm leading-6 text-slate-700" role="status" aria-live="polite">
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
