"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BriefcaseBusiness, Truck } from "lucide-react";
import { resolveLoginRouting } from "@/lib/account-management";
import { useLanguage } from "@/lib/language-provider";
import { getLastAuthRequestDebug, supabase } from "@/lib/supabase";

const DEFAULT_RETURN_PATH = "/dashboard";

type AuthFormResult =
  | Awaited<ReturnType<typeof supabase.auth.signInWithPassword>>
  | Awaited<ReturnType<typeof supabase.auth.signUp>>;

type AuthMode = "login" | "signup";

type AuthFormProps = {
  onModeChange?: (mode: AuthMode) => void;
};

function safeReturnPath(value: string | null) {
  if (!value) return DEFAULT_RETURN_PATH;

  try {
    const decoded = decodeURIComponent(value);

    if (
      !decoded.startsWith("/") ||
      decoded.startsWith("//") ||
      decoded.includes("\\")
    ) {
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
  if (/email not confirmed/i.test(detail ?? "")) {
    return "Please confirm your email using the signup confirmation link, then sign in again. / กรุณายืนยันอีเมลผ่านลิงก์ที่ได้รับหลังสมัคร แล้วเข้าสู่ระบบอีกครั้ง";
  }

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

export function AuthForm({ onModeChange }: AuthFormProps) {
  const router = useRouter();
  const { language, t } = useLanguage();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");

  const [accountType, setAccountType] = useState<
    "driver" | "office_staff"
  >("driver");

  const [loginType, setLoginType] = useState<
    "driver" | "office_staff"
  >("driver");

  const [mode, setMode] = useState<AuthMode>("login");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [returnPath, setReturnPath] = useState(DEFAULT_RETURN_PATH);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setReturnPath(safeReturnPath(params.get("next")));
  }, []);

  const changeMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setMessage(null);
    onModeChange?.(nextMode);
  };

  const handleSubmit = async (
    event: React.FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();
    setLoading(true);
    setMessage(null);

    if (mode === "signup") {
      if (fullName.trim().length < 2 || phone.trim().length < 7) {
        setMessage(
          language === "th"
            ? "กรุณากรอกชื่อและหมายเลขโทรศัพท์ให้ครบถ้วน"
            : "Enter your full name and phone number."
        );

        setLoading(false);
        return;
      }

      if (password !== confirmPassword) {
        setMessage(
          language === "th"
            ? "รหัสผ่านไม่ตรงกัน"
            : "Passwords do not match."
        );

        setLoading(false);
        return;
      }
    }

    let authResult: AuthFormResult;

    try {
      const action =
        mode === "login"
          ? supabase.auth.signInWithPassword({
              email,
              password
            })
          : supabase.auth.signUp({
              email,
              password,
              options: {
                data: {
                  registration_type: accountType,
                  full_name: fullName.trim(),
                  phone: phone.trim()
                }
              }
            });

      authResult = await action;
    } catch (error) {
      const detail =
        error instanceof Error
          ? error.message
          : "Data service unavailable";

      reportAuthDiagnostics({
        event:
          mode === "login"
            ? "sign-in-request-threw"
            : "sign-up-request-threw",
        error: detail,
        redirectTo: returnPath
      });

      setMessage(
        mode === "login"
          ? bilingualSignInError(detail)
          : t.login.signupError
      );

      setLoading(false);
      return;
    }

    const { error } = authResult;
    const returnedSession = authResult.data?.session ?? null;
    const returnedUser = authResult.data?.user ?? null;

    reportAuthDiagnostics({
      event:
        mode === "login"
          ? "sign-in-response"
          : "sign-up-response",
      hasSession: Boolean(returnedSession),
      hasUser: Boolean(returnedUser),
      hasError: Boolean(error),
      errorName: error?.name ?? null,
      errorMessage: error?.message ?? null,
      errorStatus:
        "status" in (error ?? {})
          ? (error as { status?: number }).status ?? null
          : null,
      redirectTo: returnPath
    });

    if (error) {
      setMessage(
        mode === "login"
          ? bilingualSignInError(error.message)
          : t.login.signupError
      );

      setLoading(false);
      return;
    }

    if (mode === "login") {
      let verifiedSession = returnedSession;

      let sessionResult: Awaited<
        ReturnType<typeof supabase.auth.getSession>
      >;

      if (!verifiedSession) {
        try {
          sessionResult = await supabase.auth.getSession();
        } catch (error) {
          const detail =
            error instanceof Error
              ? error.message
              : "Data service unavailable";

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
          setMessage(
            bilingualSignInError(
              sessionError?.message ||
                "No local session was saved"
            )
          );

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

      if (!verifiedSession) {
        await supabase.auth.signOut({ scope: "local" });

        setMessage(
          bilingualSignInError(
            "No verified session was available."
          )
        );

        setLoading(false);
        return;
      }

      try {
        const routing = await resolveLoginRouting(
          verifiedSession.access_token
        );

        if (routing.accountType === "driver") {
          await supabase.auth.signOut({ scope: "local" });
          setLoading(false);
          router.replace("/driver");
          return;
        }

        if (routing.accountType !== "office") {
          setLoading(false);
          router.replace(routing.destination);
          return;
        }
      } catch (error) {
        const detail =
          error instanceof Error
            ? error.message
            : "Unable to determine account access.";

        await supabase.auth.signOut({ scope: "local" });

        setMessage(bilingualSignInError(detail));
        setLoading(false);
        return;
      }
    }

    if (mode === "signup") {
      setMessage(
        language === "th"
          ? "สร้างบัญชีแล้ว คำขอของคุณกำลังรอการอนุมัติจาก Joey Ryan"
          : "Account created. Your access request is awaiting approval from Joey Ryan."
      );

      setLoading(false);

      if (returnedSession) {
        try {
          const routing = await resolveLoginRouting(
            returnedSession.access_token
          );

          router.replace(routing.destination);
        } catch {
          await supabase.auth.signOut({ scope: "local" });
          router.replace("/access/pending");
        }
      } else {
        router.replace("/access/pending");
      }

      return;
    }

    setMessage(t.login.loginSuccess);
    setLoading(false);
    router.replace(returnPath);
  };

  return (
    <div
      className={`surface-card w-full max-w-md ${
        mode === "signup"
          ? "p-5 sm:p-6 lg:[&_.form-input]:min-h-0 lg:[&_.form-input]:py-2.5 lg:[&_.form-field]:gap-1.5"
          : "p-6 sm:p-8"
      }`}
    >
      {/* HEADER */}
      <div className={mode === "signup" ? "mb-4" : "mb-7"}>
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
          EES Operations · Logistics Control
        </p>

        <h2
          className={`font-semibold tracking-[-0.045em] text-slate-950 ${
            mode === "signup"
              ? "mt-1.5 text-[1.7rem]"
              : "mt-2.5 text-[1.9rem]"
          }`}
        >
          {mode === "login"
            ? t.login.signIn
            : t.login.createAccount}
        </h2>

        <p
          className={`text-sm text-slate-600 ${
            mode === "signup"
              ? "mt-1 leading-5"
              : "mt-2 leading-6"
          }`}
        >
          {mode === "login"
            ? loginType === "driver"
              ? language === "th"
                ? "เข้าสู่ระบบคนขับเพื่อดูงานและรายละเอียดเส้นทางที่ได้รับมอบหมาย"
                : "Driver sign in for assigned jobs and route details."
              : language === "th"
                ? "เข้าสู่ระบบสำหรับพนักงานสำนักงานและผู้ดูแลระบบ"
                : "Office and admin sign in for EES Operations."
            : language === "th"
              ? "ขอสิทธิ์เข้าใช้งานสำหรับคนขับหรือพนักงานสำนักงาน"
              : "Request access as a driver or office staff member."}
        </p>
      </div>

      {/* LOGIN / CREATE ACCOUNT TABS */}
      <div
        className={`flex rounded-[1rem] border border-brand-100 bg-brand-50/60 p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] ${
          mode === "signup" ? "mb-4" : "mb-5"
        }`}
      >
        <button
          type="button"
          className={`flex-1 rounded-[1.05rem] px-4 text-sm font-medium transition ${
            mode === "signup" ? "py-2.5" : "py-3"
          } ${
            mode === "login"
              ? "bg-white/85 text-brand-700 shadow-[0_12px_24px_rgba(95,51,183,0.12)]"
              : "text-slate-500 hover:text-slate-700"
          }`}
          onClick={() => changeMode("login")}
        >
          {t.login.loginTab}
        </button>

        <button
          type="button"
          className={`flex-1 rounded-[1.05rem] px-4 text-sm font-medium transition ${
            mode === "signup" ? "py-2.5" : "py-3"
          } ${
            mode === "signup"
              ? "bg-white/85 text-brand-700 shadow-[0_12px_24px_rgba(95,51,183,0.12)]"
              : "text-slate-500 hover:text-slate-700"
          }`}
          onClick={() => changeMode("signup")}
        >
          {t.login.signupTab}
        </button>
      </div>

      {/* LOGIN TYPE */}
      {mode === "login" ? (
        <div className="mb-6">
          <p className="form-label mb-2">
            {language === "th"
              ? "เข้าสู่ระบบในฐานะ"
              : "Sign in as"}
          </p>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              aria-pressed={loginType === "driver"}
              onClick={() => {
                setLoginType("driver");
                setMessage(null);
              }}
              className={`flex min-h-14 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-bold transition ${
                loginType === "driver"
                  ? "border-brand-400 bg-brand-50 text-brand-800 shadow-sm"
                  : "border-slate-200 bg-white text-slate-600 hover:border-brand-200 hover:bg-brand-50/40"
              }`}
            >
              <Truck className="h-5 w-5" />

              {language === "th"
                ? "คนขับ"
                : "Driver"}
            </button>

            <button
              type="button"
              aria-pressed={loginType === "office_staff"}
              onClick={() => {
                setLoginType("office_staff");
                setMessage(null);
              }}
              className={`flex min-h-14 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-bold transition ${
                loginType === "office_staff"
                  ? "border-brand-400 bg-brand-50 text-brand-800 shadow-sm"
                  : "border-slate-200 bg-white text-slate-600 hover:border-brand-200 hover:bg-brand-50/40"
              }`}
            >
              <BriefcaseBusiness className="h-5 w-5" />

              {language === "th"
                ? "สำนักงาน"
                : "Office Staff"}
            </button>
          </div>

          <p className="mt-2 text-xs leading-5 text-slate-500">
            {loginType === "driver"
              ? language === "th"
                ? "ใช้บัญชีคนขับที่ได้รับอนุมัติเพื่อเข้าสู่ Driver Portal"
                : "Use your approved driver account to open the Driver Portal."
              : language === "th"
                ? "ใช้บัญชีสำนักงานหรือผู้ดูแลระบบที่ได้รับอนุมัติ"
                : "Use your approved office or administrator account."}
          </p>
        </div>
      ) : null}

      <form
        className={mode === "signup" ? "space-y-3.5" : "space-y-6"}
        onSubmit={handleSubmit}
      >
        {mode === "signup" ? (
          <>
            {/* NAME + PHONE */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="form-field">
                <label className="form-label">
                  {language === "th"
                    ? "ชื่อ-นามสกุล"
                    : "Full name"}
                </label>

                <input
                  type="text"
                  required
                  minLength={2}
                  maxLength={120}
                  autoComplete="name"
                  value={fullName}
                  onChange={(event) =>
                    setFullName(event.target.value)
                  }
                  className="form-input"
                />
              </div>

              <div className="form-field">
                <label className="form-label">
                  {language === "th"
                    ? "หมายเลขโทรศัพท์"
                    : "Phone number"}
                </label>

                <input
                  type="tel"
                  required
                  minLength={7}
                  maxLength={30}
                  autoComplete="tel"
                  value={phone}
                  onChange={(event) =>
                    setPhone(event.target.value)
                  }
                  className="form-input"
                />
              </div>
            </div>
          </>
        ) : null}

        {/* EMAIL */}
        <div className="form-field">
          <label className="form-label">
            {t.login.email}
          </label>

          <input
            type="email"
            required
            placeholder={t.login.emailPlaceholder}
            value={email}
            onChange={(event) =>
              setEmail(event.target.value)
            }
            className="form-input"
          />
        </div>

        {mode === "signup" ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="form-field">
              <label className="form-label">
                {t.login.password}
              </label>

              <input
                type="password"
                required
                minLength={6}
                autoComplete="new-password"
                placeholder={t.login.passwordPlaceholder}
                value={password}
                onChange={(event) =>
                  setPassword(event.target.value)
                }
                className="form-input"
              />
            </div>

            <div className="form-field">
              <label className="form-label">
                {language === "th"
                  ? "ยืนยันรหัสผ่าน"
                  : "Confirm password"}
              </label>

              <input
                type="password"
                required
                minLength={6}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) =>
                  setConfirmPassword(event.target.value)
                }
                className="form-input"
              />
            </div>
          </div>
        ) : (
          <div className="form-field">
            <label className="form-label">
              {t.login.password}
            </label>

            <input
              type="password"
              required
              minLength={6}
              autoComplete="current-password"
              placeholder={t.login.passwordPlaceholder}
              value={password}
              onChange={(event) =>
                setPassword(event.target.value)
              }
              className="form-input"
            />
          </div>
        )}

        {/* SIGNUP ACCOUNT TYPE */}
        {mode === "signup" ? (
          <fieldset className="pt-0.5">
            <legend className="form-label">
              {language === "th"
                ? "ประเภทบัญชี"
                : "Account type"}
            </legend>

            <div className="mt-1.5 grid grid-cols-2 gap-2">
              {[
                {
                  value: "driver" as const,
                  label:
                    language === "th"
                      ? "คนขับ"
                      : "Driver",
                  icon: Truck
                },
                {
                  value: "office_staff" as const,
                  label:
                    language === "th"
                      ? "พนักงานสำนักงาน"
                      : "Office Staff",
                  icon: BriefcaseBusiness
                }
              ].map((option) => {
                const Icon = option.icon;
                const selected =
                  accountType === option.value;

                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={selected}
                    onClick={() =>
                      setAccountType(option.value)
                    }
                    className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm font-bold transition ${
                      selected
                        ? "border-brand-400 bg-brand-50 text-brand-800 shadow-sm"
                        : "border-slate-200 bg-white text-slate-700 hover:border-brand-200 hover:bg-brand-50/40"
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />

                    {option.label}
                  </button>
                );
              })}
            </div>

            <p className="mt-2 text-[11px] leading-4 text-slate-600">
              {accountType === "driver"
                ? language === "th"
                  ? "ขอสิทธิ์คนขับเพื่อดูงานที่ได้รับมอบหมายและรายละเอียดเส้นทาง"
                  : "Driver access includes assigned jobs and route details."
                : language === "th"
                  ? "ขอสิทธิ์สำนักงานสำหรับการปฏิบัติงานภายในที่ได้รับอนุมัติ"
                  : "Office access is for approved internal operational use."}
            </p>

            <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-semibold leading-4 text-amber-900">
              {language === "th"
                ? "คำขอบัญชีใหม่ทั้งหมดต้องได้รับการอนุมัติจาก Joey Ryan ก่อนเปิดใช้งาน"
                : "All new accounts require Joey Ryan approval before access is activated."}
            </p>
          </fieldset>
        ) : null}

        {message ? (
          <p
            className="app-card-soft px-4 py-3 text-sm leading-5 text-slate-700"
            role="status"
            aria-live="polite"
          >
            {message}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={loading}
          className={`btn-primary w-full disabled:cursor-not-allowed disabled:opacity-70 ${
            mode === "signup" ? "mt-1" : ""
          }`}
        >
          {loading
            ? t.login.waiting
            : mode === "login"
              ? t.login.signIn
              : t.login.createAccount}
        </button>
      </form>
    </div>
  );
}