"use client";
import Link from "next/link";
import {usePathname} from "next/navigation";
import {useLanguage} from "@/lib/language-provider";
import {peopleCopy} from "@/lib/ees-people-copy";
import {hrCopy} from "@/lib/ees-hr-v7-copy";

export function PeopleNavigation(){
  const {language}=useLanguage();
  const c=peopleCopy(language);
  const pathname=usePathname();
  const items:[string,string][]=[
    ["/hr",c.directory],
    ["/hr/absences",c.absences],
    ["/hr/incidents",c.incidents],
    ["/hr/documents",c.documents],
    ["/hr/follow-ups",hrCopy(language).followups],
  ];
  const active=(href:string)=>pathname===href||(href==="/hr"&&(pathname==="/drivers"||pathname.startsWith("/drivers/")||pathname.startsWith("/employees/")));
  return (
    <nav aria-label={language==="th"?"ศูนย์บุคลากรและ HR":"People & HR Centre"} className="hr-nav">
      {items.map(([href,label])=>(
        <Link key={href} href={href} aria-current={active(href)?"page":undefined}>
          {label}
        </Link>
      ))}
    </nav>
  );
}
