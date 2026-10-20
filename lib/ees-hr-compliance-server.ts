import "server-only";
import {hrDatabaseError,type hrServerContext} from "./ees-hr-v7-server";
import {HRV7Error,type HRDirectory,type DirectoryEmployee} from "./ees-hr-v7-types";
import {complianceRows,type ComplianceDocument,type ComplianceLicence,type ComplianceList} from "./ees-hr-compliance";
type Context=Awaited<ReturnType<typeof hrServerContext>>;
async function readRows<T>(read:(from:number,to:number)=>PromiseLike<{data:T[]|null;error:{code?:string;message?:string}|null}>){
 const all:T[]=[];for(let offset=0;;offset+=500){const result=await read(offset,offset+499);hrDatabaseError(result.error);const rows=result.data??[];all.push(...rows);if(rows.length<500)return all;}
}
export async function readCompliance(ctx:Context,query:URLSearchParams):Promise<ComplianceList>{
 ctx.requireHR();const status=query.get("status")??"all",search=(query.get("search")??"").trim().slice(0,80),page=Number(query.get("page")??1);
 if(!["all","missing","expired","expiring"].includes(status)||!Number.isSafeInteger(page)||page<1||page>100000)throw new HRV7Error("HR_INVALID_INPUT");
 const directory=async()=>{const all:DirectoryEmployee[]=[];for(let page=1;;page++){
  const result=await ctx.client.rpc(ctx.access.peopleReady?"ees_people_directory":"ees_hr_v7_directory",{p_query:{page,size:50}});hrDatabaseError(result.error);
  const data=result.data as HRDirectory;if(!data||!Array.isArray(data.rows))throw new HRV7Error("HR_OPERATION_FAILED",500);
  all.push(...data.rows);if(page*50>=data.total||data.rows.length===0)return all;
 }};
 const [people,documents,licences]=await Promise.all([directory(),
  readRows<ComplianceDocument>((from,to)=>ctx.client.from("ees_employee_documents").select("employee_id,state,expiry_date").order("id").range(from,to)),
  readRows<ComplianceLicence>((from,to)=>ctx.client.from("ees_employee_licences").select("employee_id,issue_date,expiry_date,recorded_at").order("id").range(from,to))]);
 const rows=complianceRows(people,documents,licences).filter(row=>(!search||(row.name+" "+(row.vehicle??"")).toLocaleLowerCase().includes(search.toLocaleLowerCase()))&&(status==="all"||row[status as "missing"|"expired"|"expiring"]));
 return {rows:rows.slice((page-1)*25,page*25),total:rows.length,page};
}
