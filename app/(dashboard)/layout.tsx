"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { SetupNotice } from "@/components/setup-notice";
import { TopNavigation } from "@/components/top-navigation";
import { AdminFetchError } from "@/lib/account-management";
import { useLanguage } from "@/lib/language-provider";
import { supabase } from "@/lib/supabase";
import { AccountAccessProvider, useAccountAccess } from "@/lib/use-account-access";

const AUTH_CHECK_TIMEOUT_MS = 8_000;

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
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [serviceUnavailable, setServiceUnavailable] = useState<ServiceUnavailableState | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const { t } = useLanguage();
  const { refresh } = useAccountAccess();

  useEffect(() => {
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
          setServiceUnavailable({ message: error instanceof Error ? error.message : t.serviceUnavailable.connectionFailed });
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
        await withTimeout(refresh(), AUTH_CHECK_TIMEOUT_MS, "Account access check");
      } catch (error) {
        if (active && error instanceof AdminFetchError && error.status === 401) {
          await supabase.auth.signOut();
          router.replace(loginPath());
          return;
        }

        if (active && error instanceof AdminFetchError && error.status === 403) {
          setCheckingAuth(false);
          return;
        }

        if (active && isServiceAvailabilityError(error)) {
          setServiceUnavailable({ message: error instanceof Error ? error.message : t.serviceUnavailable.connectionFailed });
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
  }, [pathname, refresh, retryCount, router, t.serviceUnavailable.connectionFailed]);

  useEffect(() => {
    document.body.style.overflow = "";
    document.documentElement.style.overflow = "";
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

  return (
    <div className="min-h-[100dvh]">
      <TopNavigation />
      <div className="dashboard-content-frame !pl-0">
        <main className="dashboard-mobile-shell mx-auto flex min-h-[calc(100dvh-68px)] w-full max-w-full flex-col gap-3.5 px-4 pb-5 !pt-4 sm:gap-4 sm:px-5 sm:pb-6 md:px-6 md:pb-7 lg:px-8">
          <SetupNotice />
          {children}
        </main>
      </div>
    </div>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AccountAccessProvider>
      <DashboardShell>{children}</DashboardShell>
    </AccountAccessProvider>
  );
}
