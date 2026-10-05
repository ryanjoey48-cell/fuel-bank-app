"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ClipboardList, History, UserRound } from "lucide-react";
import { useEffect } from "react";
import { useLanguage } from "@/lib/language-provider";
export function DriverNavigation() {
  const pathname = usePathname(); const { language } = useLanguage();
  const items = [["/driver", language === "th" ? "งาน" : "Jobs", ClipboardList], ["/driver/history", language === "th" ? "ประวัติ" : "History", History], ["/driver/profile", language === "th" ? "โปรไฟล์" : "Profile", UserRound]] as const;
  return <nav aria-label={language === "th" ? "เมนูคนขับ" : "Driver navigation"} className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-[#fffdf8] pb-[env(safe-area-inset-bottom)] sm:sticky sm:top-[68px] sm:bottom-auto lg:top-[88px]"><div className="mx-auto grid max-w-3xl grid-cols-3 lg:max-w-[1152px]">{items.map(([href, label, Icon]) => { const active = href === "/driver" ? pathname === href || pathname.startsWith("/driver/jobs/") : pathname.startsWith(href); return <Link key={href} href={href} aria-current={active ? "page" : undefined} className={`flex min-h-[48px] flex-col items-center justify-center gap-0.5 text-xs font-bold sm:min-h-14 sm:flex-row sm:gap-2 lg:min-h-16 lg:text-base lg:font-semibold ${active ? "driver-accent" : "text-slate-500 hover:text-slate-700"}`}><Icon className="h-5 w-5 lg:h-6 lg:w-6" />{label}</Link>; })}</div></nav>;
}
export function DriverAutoRefresh() {
  const router = useRouter();
  useEffect(() => { const refresh = () => { if (document.visibilityState === "visible") router.refresh(); }; const timer = setInterval(refresh, 60000); return () => clearInterval(timer); }, [router]);
  return null;
}
