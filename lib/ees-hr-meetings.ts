"use client";
import { hrAction,hrRequest } from "@/lib/ees-hr-v7-client";
import type { HRProfile,HRMeetingV7,HRAccess } from "@/lib/ees-hr-v7-types";
export type HRMeeting=HRMeetingV7;
export type HRMeetingInput={driverId:string;date:string;category:string;subject:string;attendees:string;discussion:string;response:string;actions:string;followup:string;acknowledgement:string};
export async function isHRAdmin(){return (await hrRequest<HRAccess>("access")).hr;}
export async function fetchHRMeetings(driverId:string):Promise<HRMeeting[]>{const model=await hrRequest<HRProfile>(`profile/driver/${encodeURIComponent(driverId)}?section=meetings`);return (model.data.meetings??[]) as HRMeeting[];}
export async function recordHRMeeting(input:HRMeetingInput):Promise<HRMeeting>{const result=await hrAction<{id:string}>("record_meeting",input);return hrRequest<HRMeeting>(`meetings/${result.id}`);}
