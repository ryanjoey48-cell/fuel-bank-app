"use client";
import { CentralFollowups } from "@/components/hr/followups-section";
import { useLanguage } from "@/lib/language-provider";
export default function FollowupsPage(){const {language}=useLanguage();return <CentralFollowups language={language}/>;}
