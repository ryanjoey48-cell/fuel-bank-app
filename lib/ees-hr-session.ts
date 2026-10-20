import type {SupabaseClient} from "@supabase/supabase-js";
/** Supabase invokes auth callbacks under its exclusive lock. Defer all requests. */
export function subscribeHRSession(auth:Pick<SupabaseClient["auth"],"onAuthStateChange">,refresh:()=>void,clear:()=>void=()=>{}) {
  let identity:string|null|undefined;
  let timer:ReturnType<typeof setTimeout>|undefined;
  const {data}=auth.onAuthStateChange((event,session)=>{
    const next=session?.user.id??null;
    if(event==="INITIAL_SESSION"){identity=next;return;}
    if(!["SIGNED_IN","SIGNED_OUT","USER_UPDATED"].includes(event))return;
    if(event!=="USER_UPDATED"&&identity===next)return;
    identity=next;clear();
    if(timer)clearTimeout(timer);
    timer=setTimeout(()=>{timer=undefined;refresh();},0);
  });
  return ()=>{if(timer)clearTimeout(timer);data.subscription.unsubscribe();};
}
