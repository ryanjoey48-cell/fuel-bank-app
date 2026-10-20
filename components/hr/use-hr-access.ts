"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {supabase} from "@/lib/supabase";
import {hrRequest,invalidateHRReads} from "@/lib/ees-hr-v7-client";
import {subscribeHRSession} from "@/lib/ees-hr-session";
import {HRV7Error,type HRAccess,type HRLanguage} from "@/lib/ees-hr-v7-types";
export function useHRAccess(language:HRLanguage){
 const [state,setState]=useState<{access:HRAccess|null;error:unknown;loading:boolean}>({access:null,error:null,loading:true});
 const generation=useRef(0),request=useRef<AbortController|null>(null);
 const clear=useCallback(()=>{generation.current++;request.current?.abort();invalidateHRReads();setState({access:null,error:null,loading:false});},[]);
 const load=useCallback(async()=>{
  request.current?.abort();const controller=new AbortController();request.current=controller;
  const seq=++generation.current;setState({access:null,error:null,loading:true});
  const timer=setTimeout(()=>{if(seq===generation.current){generation.current++;controller.abort();setState({access:null,error:new HRV7Error("HR_NETWORK",503),loading:false});}},20_000);
  try{const access=await hrRequest<HRAccess>("access",{signal:controller.signal});if(seq===generation.current)setState({access,error:null,loading:false});}
  catch(error){if(seq===generation.current)setState({access:null,error,loading:false});}
  finally{clearTimeout(timer);}
 },[]);
 useEffect(()=>{void load();return clear;},[language,load,clear]);
 useEffect(()=>subscribeHRSession(supabase.auth,()=>void load(),clear),[load,clear]);
 return {...state,retry:load};
}
