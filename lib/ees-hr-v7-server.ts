import "server-only";
import { createClient } from "@supabase/supabase-js";
import { AdminApiError, createServerSupabaseAdmin, getBearerToken, requireVerifiedUser } from "@/lib/admin-user-management-server";
import { completeJsonResponse, withRequestDeadline } from "@/lib/request-deadline";
import { HRV7Error, type HRAccess,type HRSetupDependency } from "@/lib/ees-hr-v7-types";

export function hrDatabaseError(error: { code?: string; message?: string } | null) {
  if (!error) return;
  if (["42P01","PGRST202","PGRST205","42703"].includes(error.code ?? "")) throw new HRV7Error("HR_SETUP_REQUIRED",503);
  if (error.code==="42501") throw new HRV7Error("HR_FORBIDDEN",403);
  if (error.code==="23505") throw new HRV7Error("HR_DUPLICATE_RECORD",409);
  if (["22P02","22007","22008","23514","22003"].includes(error.code ?? "")) throw new HRV7Error("HR_INVALID_INPUT",400);
  if (/^HR_[A-Z_]+$/.test(error.message ?? "")) throw new HRV7Error(error.message!,409);
  if (/fetch|network|timeout|timed out|abort/i.test(error.message ?? "")) throw new HRV7Error("HR_NETWORK",503);
  throw new HRV7Error("HR_OPERATION_FAILED",500);
}
export async function hrServerContext(request: Request, driverKey?: string) {
  let user;
  try { user=await withRequestDeadline(()=>requireVerifiedUser(request)); }
  catch(error) { if(error instanceof AdminApiError) throw new HRV7Error(error.status===401?"HR_AUTH_REQUIRED":error.status===403?"HR_FORBIDDEN":"HR_NETWORK",error.status); throw new HRV7Error("HR_NETWORK",503); }
  const token=getBearerToken(request)!;
  let claims:{sub?:string;role?:string};
  try { claims=JSON.parse(Buffer.from(token.split(".")[1],"base64url").toString("utf8")); }
  catch { throw new HRV7Error("HR_AUTH_REQUIRED",401); }
  if(claims.sub!==user.id || claims.role!=="authenticated") throw new HRV7Error("HR_FORBIDDEN",403);
  const client=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{
    global:{headers:{Authorization:`Bearer ${token}`},fetch:(input,init)=>withRequestDeadline(async signal=>completeJsonResponse(await fetch(input,{...init,signal,cache:"no-store"})),init?.signal)},
    auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}
  });
  const accessResult=await client.rpc("ees_hr_v7_access",{p_driver_id:driverKey??null});
  let access:HRAccess;
  const setupDependencies:HRSetupDependency[]=[];
  const unavailable=(error:{code?:string}|null)=>["PGRST202","42883"].includes(error?.code??"");
  if(unavailable(accessResult.error)) {
    setupDependencies.push({rpc:"ees_hr_v7_access",migration:"20261013120000_ees_hr_v7_reads.sql",reason:"missing_rpc"});
    const [office,active,hr,role]=await Promise.all([client.rpc("is_office_account"),client.rpc("is_account_active"),client.rpc("ees_is_hr_admin"),client.rpc("current_account_role")]);
    if(office.error || active.error || office.data!==true || active.data!==true) throw new HRV7Error("HR_FORBIDDEN",403);
    access={ready:false,hr:hr.data===true,operate:role.data==="admin",admin:role.data==="admin"&&hr.data===true,storageReady:false,userId:user.id};
  } else {
    if(accessResult.error&&["42P01","PGRST205","42703"].includes(accessResult.error.code??""))throw new HRV7Error("HR_SETUP_REQUIRED",503,[{rpc:"ees_hr_v7_access",migration:"20261013100000_ees_hr_v7_foundation.sql",reason:"missing_dependency"}]);
    hrDatabaseError(accessResult.error); access=accessResult.data as HRAccess;
  }
  if(access.userId!==user.id) throw new HRV7Error("HR_FORBIDDEN",403);
  let releaseReady=false;
  if(access.ready){
    const release=await client.rpc("ees_hr_v7_release_ready");
    if(!unavailable(release.error))hrDatabaseError(release.error);
    releaseReady=!release.error&&release.data===true;
    if(!releaseReady)setupDependencies.push({rpc:"ees_hr_v7_release_ready",migration:"20261013140000_ees_hr_v7_workflow_guards.sql",reason:unavailable(release.error)?"missing_rpc":"checks_failed"});
  }
  let peopleReady=false;
  if(releaseReady){
    const people=await client.rpc("ees_people_ready");
    if(!unavailable(people.error))hrDatabaseError(people.error);
    peopleReady=!people.error&&people.data===true;
    if(!peopleReady)setupDependencies.push({rpc:"ees_people_ready",migration:"20261013150000_ees_hr_v7_people_centre.sql",reason:unavailable(people.error)?"missing_rpc":"checks_failed"});
  }
  access={...access,releaseReady,peopleReady,setupDependencies};
  return {client,user,access,
    requireHR(){if(!access.ready)throw new HRV7Error("HR_SETUP_REQUIRED",503);if(!access.hr)throw new HRV7Error("HR_FORBIDDEN",403);},
    requireRelease(){if(!releaseReady)throw new HRV7Error("HR_RELEASE_REQUIRED",503);},
    storageAdmin(){if(!access.hr || !access.storageReady)throw new HRV7Error("HR_STORAGE_NOT_READY",409);return createServerSupabaseAdmin();}
  };
}
export function hrSafeResponseError(error: unknown) {
  if(error instanceof HRV7Error)return {status:error.status,code:error.code,dependencies:error.dependencies};
  if(error instanceof Error && /fetch|network|timeout|timed out|abort/i.test(error.message))return {status:503,code:"HR_NETWORK"};
  return {status:500,code:"HR_OPERATION_FAILED"};
}
