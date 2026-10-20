"use client";
import Link from "next/link";
import {usePathname} from "next/navigation";
import {useLanguage} from "@/lib/language-provider";
import {peopleCopy} from "@/lib/ees-people-copy";
import {hrCopy} from "@/lib/ees-hr-v7-copy";
export function PeopleNavigation(){const {language}=useLanguage(),c=peopleCopy(language),pathname=usePathname();return <nav aria-label={language==="th"?"ศูนย์บุคลากรและ HR":"People & HR Centre"} className="flex gap-1 overflow-x-auto rounded-xl border border-violet-100 bg-white p-1.5">{[["/hr",c.directory],["/hr/absences",c.absences],["/hr/incidents",c.incidents],["/hr/documents",c.documents],["/hr/follow-ups",hrCopy(language).followups]].map(([href,label])=><Link key={href} href={href} aria-current={pathname===href?"page":undefined} className={`shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold ${pathname===href||href==="/hr"&&pathname==="/drivers"?"bg-violet-700 text-white":"text-violet-900 hover:bg-violet-50"}`}>{label}</Link>)}</nav>;}
