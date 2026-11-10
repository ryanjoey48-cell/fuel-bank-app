"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { FinanceFixtureProvider } from "@/components/finance-fixture-provider";
import { FinancePreviewBanner } from "@/components/finance-preview-banner";
import { SetupNotice } from "@/components/setup-notice";
import { FloatingNavV3 } from "@/components/floating-nav-v3";
import { TopNavigation } from "@/components/top-navigation";
import { AdminFetchError, resolveLoginRouting } from "@/lib/account-management";
import { isFinanceCentreLocalWorkspace, isFinanceFixtureMode, usesFinanceLocalDemoScreens } from "@/lib/finance-fixture-mode";
import { isFinanceWorkspaceRoute } from "@/lib/finance-workspace-routes";
import { isFinanceLocalPreview } from "@/lib/finance-local-preview";
import { useLanguage } from "@/lib/language-provider";
import { supabase, supabaseConfigError } from "@/lib/supabase";
import { AccountAccessProvider, useAccountAccess } from "@/lib/use-account-access";

const AUTH_CHECK_TIMEOUT_MS = 20_000;

type ServiceUnavailableState = {
  message: string;
};

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string) {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(`${label} timed out.`));
    }, timeoutMs);

    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function isServiceAvailabilityError(error: unknown) {
  if (error instanceof AdminFetchError) {
    return error.status === 0 || error.status >= 500;
  }

  if (error instanceof TypeError) {
    return true;
  }

  const message = error instanceof Error ? error.message : String(error ?? "");
  return /timed out|failed to fetch|network|supabase client configuration|load failed|fetch/i.test(message);
}

function ServiceUnavailable({
  message,
  onRetry,
  copy
}: {
  message: string;
  onRetry: () => void;
  copy: ReturnType<typeof useLanguage>["t"]["serviceUnavailable"];
}) {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center px-4">
      <section className="surface-card w-full max-w-lg p-6 text-center sm:p-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-brand-600">
          {copy.eyebrow}
        </p>
        <h1 className="mt-3 text-2xl font-semibold text-slate-950">
          {copy.title}
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          {copy.description}
        </p>
        <p className="mt-2 text-xs leading-5 text-slate-500">{message}</p>
        <button type="button" className="btn-primary mt-6" onClick={onRetry}>
          {copy.retry}
        </button>
      </section>
    </main>
  );
}

function DashboardShell({
  children
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const financeFixture = isFinanceFixtureMode();
  const financeLocalWorkspace = isFinanceCentreLocalWorkspace();
  const financePreview = financeFixture || (isFinanceLocalPreview() && !!supabaseConfigError);
  const [checkingAuth, setCheckingAuth] = useState(!financePreview);
  const [serviceUnavailable, setServiceUnavailable] = useState<ServiceUnavailableState | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const { t, language } = useLanguage();
  const { refresh } = useAccountAccess();
  // V7.8.4: the session check must not depend on the display language. It used to list the (translated) message string as an effect
  // dependency, so every EN/TH switch re-ran the check, showed "Checking your session…" and unmounted every workspace (losing the
  // selected dates and loaded evidence). The latest message is read through a ref instead.
  const connectionFailedMessage = useRef(t.serviceUnavailable.connectionFailed);
  connectionFailedMessage.current = t.serviceUnavailable.connectionFailed;

  useEffect(() => {
    if (!financePreview) return;
    setCheckingAuth(false);
    setServiceUnavailable(null);
  }, [financePreview]);

  useEffect(() => {
    if (financePreview) return;
    let active = true;
    const loginPath = () => {
      const currentPath = typeof window === "undefined"
        ? pathname
        : `${window.location.pathname}${window.location.search}`;
      return `/login?next=${encodeURIComponent(currentPath || "/dashboard")}`;
    };

    const checkSession = async () => {
      setCheckingAuth(true);
      setServiceUnavailable(null);

      let sessionResult: Awaited<ReturnType<typeof supabase.auth.getSession>>;
      try {
        sessionResult = await withTimeout(
          supabase.auth.getSession(),
          AUTH_CHECK_TIMEOUT_MS,
          "Supabase session check"
        );
      } catch (error) {
        if (active && isServiceAvailabilityError(error)) {
          setServiceUnavailable({ message: error instanceof Error ? error.message : connectionFailedMessage.current });
          setCheckingAuth(false);
          return;
        }
        throw error;
      }

      if (sessionResult.error) {
        if (active && isServiceAvailabilityError(sessionResult.error)) {
          setServiceUnavailable({ message: sessionResult.error.message });
          setCheckingAuth(false);
          return;
        }
      }

      const { data } = sessionResult;

      if (!data.session && active) {
        router.replace(loginPath());
        return;
      }

      try {
        const routing = await withTimeout(
          resolveLoginRouting(data.session!.access_token),
          AUTH_CHECK_TIMEOUT_MS,
          "Account routing check"
        );
        if (routing.accountType === "driver") {
          await supabase.auth.signOut({ scope: "local" });
          window.location.replace("/driver");
          return;
        }
        if (routing.accountType !== "office") {
          window.location.replace(routing.destination);
          return;
        }
        await withTimeout(refresh({ force: true }), AUTH_CHECK_TIMEOUT_MS, "Account access check");
      } catch (error) {
        if (active && error instanceof AdminFetchError && error.status === 401) {
          await supabase.auth.signOut();
          router.replace(loginPath());
          return;
        }

        if (active && error instanceof AdminFetchError && error.status === 403) {
          if (/driver accounts must use the driver portal/i.test(error.message)) {
            await supabase.auth.signOut();
            router.replace("/driver");
            return;
          }
          setCheckingAuth(false);
          return;
        }

        if (active && isServiceAvailabilityError(error)) {
          setServiceUnavailable({ message: error instanceof Error ? error.message : connectionFailedMessage.current });
          setCheckingAuth(false);
          return;
        }

        throw error;
      }

      if (active) {
        setCheckingAuth(false);
      }
    };

    void checkSession();

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      if (!session) {
        router.replace(loginPath());
      } else if (pathname === "/login") {
        router.replace("/dashboard");
      }
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [financePreview, pathname, refresh, retryCount, router]);

  useEffect(() => {
    if (pathname !== "/fleet-tracking") {
      document.body.style.overflow = "";
      document.documentElement.style.overflow = "";
      return;
    }

    const previousBodyOverflow = document.body.style.overflow;
    const previousDocumentOverflow = document.documentElement.style.overflow;
    const previousBodyPaddingTop = document.body.style.paddingTop;
    const previousBodyPaddingBottom = document.body.style.paddingBottom;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    document.body.style.paddingTop = "0";
    document.body.style.paddingBottom = "0";
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousDocumentOverflow;
      document.body.style.paddingTop = previousBodyPaddingTop;
      document.body.style.paddingBottom = previousBodyPaddingBottom;
    };
  }, [pathname]);

  if (checkingAuth) {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center px-4">
        <div className="surface-card px-6 py-5 text-sm text-slate-600">
          {t.common.sessionCheck}
        </div>
      </main>
    );
  }

  if (serviceUnavailable) {
    return (
      <ServiceUnavailable
        message={serviceUnavailable.message}
        onRetry={() => setRetryCount((current) => current + 1)}
        copy={t.serviceUnavailable}
      />
    );
  }

  const isFleetTrackingRoute = pathname === "/fleet-tracking";
  const isHomeRoute = pathname === "/dashboard";
  const onFinanceRoute = isFinanceWorkspaceRoute(pathname);
  const isNarrowOfficeRoute = pathname === "/profile" || pathname === "/change-password";
  // Data-heavy operational pages use the wide shell (fluid width + readable table/filter type).
  const isWideOfficeRoute =
    !isNarrowOfficeRoute &&
    !isHomeRoute &&
    !isFleetTrackingRoute &&
    (pathname === "/booking-diary" ||
      pathname === "/weekly-mileage" ||
      pathname === "/fuel-logs" ||
      pathname === "/fuel-spend-report" ||
      pathname === "/vehicle-performance" ||
      pathname === "/expenses-centre" ||
      pathname === "/reports" ||
      pathname === "/dispatch" ||
      pathname === "/shipments" ||
      pathname === "/trip-journey" ||
      pathname === "/maintenance" ||
      pathname.startsWith("/maintenance/") ||
      pathname === "/inventory" ||
      pathname === "/locations" ||
      pathname === "/insurance" ||
      pathname === "/fleet-events" ||
      pathname === "/safety" ||
      pathname.startsWith("/hr") ||
      pathname.startsWith("/drivers") ||
      pathname.startsWith("/employees") ||
      pathname.startsWith("/admin/") ||
      onFinanceRoute);

  // Universal office chrome: every authenticated office route uses the same
  // floating-glass TopNavigation. Fleet keeps a full-height map viewport shell
  // under the nav — it must never restyle or re-parent the navbar.
  const contentFrameClass = [
    "dashboard-content-frame !pl-0",
    isHomeRoute ? "has-floating-nav" : "has-v3-nav",
    isHomeRoute ? "has-hero-overlay" : "",
    isFleetTrackingRoute ? "ees-fleet-under-nav" : ""
  ]
    .filter(Boolean)
    .join(" ");

  const mainClass = [
    "dashboard-mobile-shell ees-shell-main mx-auto flex w-full max-w-full flex-col",
    isFleetTrackingRoute
      ? "min-h-0 flex-1 gap-0 px-0 pb-0"
      : "min-h-[calc(100dvh-56px)] gap-3.5 px-4 pb-5 sm:gap-4 sm:px-5 sm:pb-6 md:px-6 md:pb-7 lg:px-8",
    isHomeRoute ? "ees-shell-main--hero" : "ees-shell-main--standard",
    isWideOfficeRoute ? "ees-shell-main--wide" : "",
    isNarrowOfficeRoute ? "ees-shell-main--narrow" : ""
  ].join(" ");

  return (
    <div className="ees-office-shell min-h-[100dvh]">
      {onFinanceRoute && financePreview && !financeLocalWorkspace && !financeFixture ? (
        <FinancePreviewBanner />
      ) : null}
      {isHomeRoute ? <TopNavigation /> : <FloatingNavV3 />}
      {isFleetTrackingRoute ? (
        <div className="dashboard-dispatch-shell is-fleet-route ees-fleet-viewport">
          <div className={contentFrameClass}>
            <main className={mainClass}>{children}</main>
          </div>
        </div>
      ) : (
        <div className={contentFrameClass}>
          <main className={mainClass}>
            {onFinanceRoute && financePreview && !financeLocalWorkspace ? (
              <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
                {language === "th" ? "การทดสอบจำลอง · ไม่เชื่อมต่อระบบเข้าสู่ระบบและสมุดจองจริง" : "Simulated fixture testing · authentication and live Booking Diary are intentionally offline"}
              </p>
            ) : onFinanceRoute || isHomeRoute ? null : (
              <SetupNotice />
            )}
            {children}
          </main>
        </div>
      )}
    </div>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const financeLocalScreens = usesFinanceLocalDemoScreens();
  const shell = <DashboardShell>{children}</DashboardShell>;
  return (
    <AccountAccessProvider>
      {financeLocalScreens ? <FinanceFixtureProvider>{shell}</FinanceFixtureProvider> : shell}
    </AccountAccessProvider>
  );
}
