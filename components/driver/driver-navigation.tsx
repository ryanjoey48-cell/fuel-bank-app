"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ClipboardList, History, UserRound } from "lucide-react";
import { useEffect } from "react";
import { useLanguage } from "@/lib/language-provider";
export function DriverNavigation() {
  const pathname = usePathname(); const { language } = useLanguage();
  const items = [["/driver", language === "th" ? "งาน" : "Jobs", ClipboardList], ["/driver/history", language === "th" ? "ประวัติ" : "History", History], ["/driver/profile", language === "th" ? "โปรไฟล์" : "Profile", UserRound]] as const;
  return <nav aria-label={language === "th" ? "เมนูคนขับ" : "Driver navigation"} className="fixed inset-x-0 bottom-0 z-40 border-t border-brand-100 bg-[#fffdf8]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:sticky sm:top-[68px] sm:bottom-auto"><div className="mx-auto grid max-w-3xl grid-cols-3">{items.map(([href, label, Icon]) => { const active = href === "/driver" ? pathname === href || pathname.startsWith("/driver/jobs/") : pathname.startsWith(href); return <Link key={href} href={href} aria-current={active ? "page" : undefined} className={`flex min-h-[52px] flex-col items-center justify-center gap-0.5 text-xs font-bold sm:min-h-14 sm:flex-row sm:gap-2 ${active ? "bg-[#152638] text-white" : "text-slate-500 hover:bg-slate-100"}`}><Icon className="h-5 w-5" />{label}</Link>; })}</div></nav>;
}
export function DriverAutoRefresh() {
  const router = useRouter();
  useEffect(() => { const refresh = () => { if (document.visibilityState === "visible") router.refresh(); }; const timer = setInterval(refresh, 60000); return () => clearInterval(timer); }, [router]);
  return null;
}
