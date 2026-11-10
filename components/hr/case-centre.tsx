"use client";
import Link from "next/link";
import {useLanguage} from "@/lib/language-provider";
import {hrErrorMessage} from "@/lib/ees-hr-v7-copy";
import {peopleCopy} from "@/lib/ees-people-copy";
import {hrV8Copy} from "@/lib/ees-hr-v8-copy";
import {HRV7Error} from "@/lib/ees-hr-v7-types";
import {useHRAccess} from "./use-hr-access";
import {HRPage,HRSetup} from "./hr-page";
import {CaseSection} from "./case-section";
import {HRNotice,HRRestricted} from "./hr-ui";

export function CaseCentre({kind}:{kind:"absences"|"incidents"}){
 const {language}=useLanguage(),c=peopleCopy(language),v8=hrV8Copy(language),th=language==="th";
 const {access,error,loading,retry}=useHRAccess(language);
 const setup=access?.setupDependencies??(error instanceof HRV7Error?error.dependencies:undefined)??[];
 return <HRPage>
  <header className="office-page-header">
   <p className="office-page-header__eyebrow">EES · People & Safety</p>
   <h1 className="office-page-header__title">{c[kind]}</h1>
   <p className="office-page-header__description">
    {kind==="absences"
      ?(th?"บันทึกและติดตามการลา/ขาดงานโดยไม่เดาจากข้อมูลที่หายไป":"Record and track leave without treating missing attendance as absence.")
      :(th?"พื้นที่เหตุการณ์ — เปิดใช้เมื่อฐานข้อมูลผ่านการตรวจสอบความพร้อมเท่านั้น":"Incident workspace — available only after database readiness is verified.")}
   </p>
  </header>
  {loading?<p role="status" className="text-sm text-slate-500">{th?"กำลังตรวจสอบสิทธิ์เข้าถึง…":"Checking HR access…"}</p>:
   error?<div className="space-y-3"><HRNotice error>{hrErrorMessage(language,error)}</HRNotice>{setup.length?<HRSetup language={language} dependencies={setup} onRetry={()=>void retry()}/>:<div className="flex gap-2"><button className="btn-secondary" onClick={()=>void retry()}>{th?"ลองอีกครั้ง":"Retry"}</button>{error instanceof HRV7Error&&error.code==="HR_AUTH_REQUIRED"?<Link className="btn-primary" href="/login">{th?"เข้าสู่ระบบ":"Sign in"}</Link>:null}</div>}</div>:
   !access?.hr?<HRRestricted language={language}/>:
   !access.peopleReady?<div className="space-y-3"><HRNotice>{kind==="absences"?v8.setupAbsences:v8.setupIncidents}</HRNotice><p className="text-sm text-slate-600">{v8.preparedWorkflow}</p><HRSetup language={language} dependencies={setup.length?setup:[{rpc:"ees_people_ready",migration:"20261013150000_ees_hr_v7_people_centre.sql",reason:"checks_failed"}]} onRetry={()=>void retry()}/></div>:
   <CaseSection kind={kind} language={language}/>}
 </HRPage>;
}
