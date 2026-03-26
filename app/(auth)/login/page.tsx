import { AuthForm } from "@/components/auth-form";
import { SetupNotice } from "@/components/setup-notice";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="grid w-full max-w-6xl gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
        <section className="rounded-[2rem] border border-white/50 bg-slate-950 px-8 py-10 text-white shadow-soft sm:px-10">
          <p className="text-sm font-semibold uppercase tracking-[0.25em] text-brand-300">
            Fleet Finance
          </p>
          <h1 className="mt-4 text-4xl font-semibold leading-tight sm:text-5xl">
            Track fuel costs and driver transfers in one operational hub.
          </h1>
          <p className="mt-6 max-w-xl text-base text-slate-300">
            Built for logistics teams that need clean daily records, accurate spend totals, and a
            simple workflow across mobile and desktop.
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
