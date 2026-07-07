"use client";

import { useEffect, useState } from "react";
import { Header } from "@/components/header";
import { supabase } from "@/lib/supabase";

type ProfileUser = {
  email?: string;
  created_at?: string;
  last_sign_in_at?: string | null;
  user_metadata?: Record<string, unknown>;
  app_metadata?: Record<string, unknown>;
};

function metaString(user: ProfileUser | null, key: string) {
  const value = user?.user_metadata?.[key] ?? user?.app_metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(parsed);
}

export default function ProfilePage() {
  const [user, setUser] = useState<ProfileUser | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUser((data.user ?? null) as ProfileUser | null);
    });
  }, []);

  const email = user?.email ?? "";
  const name = metaString(user, "name") || metaString(user, "full_name") || (email.toLowerCase() === "joeryan09@outlook.com" ? "Joey Ryan" : email || "-");
  const role = email.toLowerCase() === "joeryan09@outlook.com" ? "Admin" : metaString(user, "role") || "Staff";
  const company = metaString(user, "company") || metaString(user, "company_name") || "Expert Express Sender Co., Ltd.";

  return (
    <>
      <div className="mb-6 hidden md:block">
        <Header title="My Profile" description="View your Fuel Bank account details." />
      </div>

      <section className="surface-card p-4 sm:p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            ["Name", name],
            ["Email", email || "-"],
            ["Role", role],
            ["Company", company],
            ["Account created", formatDate(user?.created_at)],
            ["Last login", formatDate(user?.last_sign_in_at)]
          ].map(([label, value]) => (
            <div key={label} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</p>
              <p className="mt-1 font-semibold text-slate-950">{value}</p>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
