"use client";
import type {ReactNode} from "react";
import type {HRLanguage,HRSetupDependency} from "@/lib/ees-hr-v7-types";
import {PeopleNavigation} from "./people-navigation";
export function HRPage({children}:{children:ReactNode}){return <div className="mx-auto w-full max-w-6xl space-y-4 py-3 sm:py-4"><PeopleNavigation/>{children}</div>;}
export function HRSetup({language,dependencies,onRetry}:{language:HRLanguage;dependencies:HRSetupDependency[];onRetry:()=>void}){
 const th=language==="th";
 return <section className="rounded-xl border border-amber-200 bg-amber-50/70 p-4" role="status"><h2 className="font-semibold text-slate-950">{th?"ต้องตั้งค่าฐานข้อมูล":"Database setup required"}</h2><p className="mt-1 text-sm text-slate-600">{th?"ผู้ดูแลต้องตรวจสอบ migration และสิทธิ์เข้าถึงก่อนเปิดใช้ส่วนนี้":"An administrator must verify the migration and access controls before this section can be used."}</p><ul className="mt-3 space-y-2 text-sm">{dependencies.map(d=><li key={d.rpc}><p>{th?"จุดตรวจสอบ":"Dependency"}: <code className="break-all font-semibold">{d.rpc}</code> · {d.reason==="checks_failed"?(th?"ยังไม่ผ่านการตรวจสอบ":"Readiness checks failed"):(th?"ไม่มี RPC หรือยังไม่พร้อมใช้งาน":"RPC missing or unavailable")}</p><p className="mt-1 break-all text-xs text-slate-600">{d.migration}</p>{d.rpc==="ees_hr_v7_release_ready"&&d.reason==="checks_failed"?<p className="text-xs text-slate-600">{th?"ตรวจสอบ read corrections 20261013130000 ด้วย":"Also verify 20261013130000_ees_hr_v7_read_corrections.sql."}</p>:null}</li>)}</ul><button type="button" className="btn-secondary mt-3" onClick={onRetry}>{th?"ตรวจสอบอีกครั้ง":"Check again"}</button></section>;
}
