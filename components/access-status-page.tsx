"use client";

import { Clock3, LogOut, ShieldX } from "lucide-react";
import { useRouter } from "next/navigation";
import { EESLogo } from "@/components/ees-logo";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useLanguage } from "@/lib/language-provider";
import { supabase } from "@/lib/supabase";

export function AccessStatusPage({ status }: { status: "pending" | "rejected" }) {
  const router = useRouter();
  const { language } = useLanguage();
  const pending = status === "pending";
  const copy = language === "th"
    ? pending
      ? { title: "กำลังรอการอนุมัติ", detail: "บัญชีของคุณถูกสร้างแล้ว คำขอสิทธิ์เข้าใช้งานกำลังรอการอนุมัติจาก EES Operations", action: "ออกจากระบบ" }
      : { title: "คำขอไม่ได้รับการอนุมัติ", detail: "คำขอสิทธิ์เข้าใช้งานนี้ไม่ได้รับการอนุมัติ กรุณาติดต่อ EES Operations", action: "ออกจากระบบ" }
    : pending
      ? { title: "Awaiting approval", detail: "Account created. Your access request is awaiting approval from EES Operations.", action: "Sign out" }
      : { title: "Access request rejected", detail: "This access request was not approved. Please contact EES Operations.", action: "Sign out" };

  const signOut = async () => {
    await supabase.auth.signOut({ scope: "local" });
    router.replace("/login");
  };

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-[var(--app-background)] px-4 py-8">
      <section className="w-full max-w-md rounded-[1.5rem] border border-slate-200 bg-[#fffdf8] p-6 text-center shadow-[0_24px_70px_rgba(57,40,24,0.13)]">
        <div className="flex items-center justify-between gap-4">
          <span className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-xl bg-[#211336]">
            <EESLogo alt="EES" size={48} className="h-12 w-12 max-w-none scale-[1.8]" priority />
          </span>
          <LanguageSwitcher compact />
        </div>
        <span className={`mx-auto mt-8 flex h-14 w-14 items-center justify-center rounded-2xl ${pending ? "bg-amber-50 text-amber-700" : "bg-rose-50 text-rose-700"}`}>
          {pending ? <Clock3 className="h-7 w-7" /> : <ShieldX className="h-7 w-7" />}
        </span>
        <h1 className="mt-5 text-2xl font-black text-slate-950">{copy.title}</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">{copy.detail}</p>
        <button type="button" onClick={() => void signOut()} className="btn-secondary mt-7 w-full gap-2">
          <LogOut className="h-4 w-4" />
          {copy.action}
        </button>
      </section>
    </main>
  );
}
