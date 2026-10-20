import { NextResponse } from "next/server";
import {readCompliance} from "@/lib/ees-hr-compliance-server";
import sharp from "sharp";
import { createHash } from "node:crypto";
import { hrDatabaseError, hrSafeResponseError, hrServerContext } from "@/lib/ees-hr-v7-server";
import { HRV7Error, driverId, uuid, type HRDirectory, type DirectoryEmployee } from "@/lib/ees-hr-v7-types";
import { MAX_DOCUMENT_BYTES, validateDocumentBytes, validateHRAction } from "@/lib/ees-hr-v7-validation";

export const runtime="nodejs";
export const dynamic="force-dynamic";
type RouteContext={params:Promise<{path:string[]}>};
const headers={"Cache-Control":"private, no-store, max-age=0",Vary:"Authorization","X-Content-Type-Options":"nosniff"};
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers});
async function limitedBody(request:Request,limit:number) {
  if(Number(request.headers.get("content-length")??0)>limit)throw new HRV7Error("HR_FILE_TOO_LARGE",413);
  if(!request.body)return new Uint8Array();
  const reader=request.body.getReader();const chunks:Uint8Array[]=[];let length=0;
  try {while(true){const part=await reader.read();if(part.done)break;length+=part.value.byteLength;
    if(length>limit){await reader.cancel();throw new HRV7Error("HR_FILE_TOO_LARGE",413);}chunks.push(part.value);}}
  finally{reader.releaseLock();}
  const body=new Uint8Array(length);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.length;}return body;
}
async function inputJson(request:Request) {try{return JSON.parse(new TextDecoder().decode(await limitedBody(request,65536)));}catch(error){if(error instanceof HRV7Error)throw error;throw new HRV7Error("HR_INVALID_INPUT");}}

async function legacyDirectory(ctx:Awaited<ReturnType<typeof hrServerContext>>,query:Record<string,unknown>):Promise<HRDirectory> {
  const size=25,page=Math.max(1,Number(query.page)||1);const search=String(query.search??"").slice(0,80);
  let request=ctx.client.from("drivers").select("id,name,active,assigned_vehicle_id,assignedVehicle:vehicles!assigned_vehicle_id(id,vehicle_reg,vehicle_type,vehicle_name)",{count:"exact"}).order("name");
  if(search)request=request.ilike("name",`%${search}%`);
  const result=await request.range((page-1)*size,page*size-1);hrDatabaseError(result.error);
  const summary=await ctx.client.from("drivers").select("id,active,assigned_vehicle_id");hrDatabaseError(summary.error);
  const rows=(result.data??[]).map(raw=>{
    const vehicle=Array.isArray(raw.assignedVehicle)?raw.assignedVehicle[0]:raw.assignedVehicle;
    const linked=vehicle?{id:String(vehicle.id),registration:vehicle.vehicle_reg,type:vehicle.vehicle_type,model:null,name:vehicle.vehicle_name}:null;
    return {id:String(raw.id),kind:"driver",driverId:String(raw.id),employeeId:null,name:raw.name,employeeNumber:null,
      employmentStatus:"not_recorded",operationalActive:raw.active,jobRole:null,department:null,vehicle:linked,regularVehicle:linked,documentStatus:null,nextFollowup:null} as DirectoryEmployee;
  });
  return {access:ctx.access,rows,total:result.count??rows.length,summary:{total:summary.data?.length??0,activeEmployees:0,
    activeDrivers:(summary.data??[]).filter(row=>row.active===true).length,assignments:(summary.data??[]).filter(row=>row.assigned_vehicle_id).length,
    followupsDue:null,unrecordedEmployment:summary.data?.length??0}};
}

export async function GET(request:Request,route:RouteContext) {
  try {
    const {path}=await route.params;const url=new URL(request.url);
    const scopedDriver=url.searchParams.get("driverId");
    const ctx=await hrServerContext(request,scopedDriver?driverId(scopedDriver):path[0]==="profile"&&path[1]==="driver"?driverId(path[2]):undefined);
    if(path[0]==="access")return json(ctx.access);
    if(path[0]==="compliance"&&path.length===1)return json(await readCompliance(ctx,url.searchParams));
    if(!ctx.access.ready)throw new HRV7Error("HR_SETUP_REQUIRED",503);
    if(path[0]==="profile" && path.length===3) {
      const kind=path[1];const id=kind==="driver"?driverId(path[2]):uuid(path[2]);const section=url.searchParams.get("section")??"overview";
      if(["absences","incidents"].includes(section)&&!ctx.access.peopleReady)throw new HRV7Error("HR_RELEASE_REQUIRED",503);
      if(["absences","incidents","personnel","meetings","documents","followups"].includes(section))ctx.requireHR();
      const result=await ctx.client.rpc(ctx.access.peopleReady?"ees_people_profile":"ees_hr_v7_profile",{p_kind:kind,p_id:id,p_section:section});hrDatabaseError(result.error);return json({...result.data,access:{...result.data.access,...ctx.access}});
    }
    if(path[0]==="people" && path.length===2) {
      ctx.requireHR();if(!ctx.access.peopleReady)throw new HRV7Error("HR_RELEASE_REQUIRED",503);
      if(path[1]==="choices"){const result=await ctx.client.rpc("ees_people_choices");hrDatabaseError(result.error);return json(result.data);}
      if(!["absences","incidents"].includes(path[1]))throw new HRV7Error("HR_NOT_FOUND",404);
      const result=await ctx.client.rpc("ees_people_cases",{p_kind:path[1],p_query:Object.fromEntries(url.searchParams)});hrDatabaseError(result.error);return json(result.data);
    }
    if(path[0]==="lookups"&&path.length===2) {
      if(path[1]!=="vehicles")ctx.requireHR();
      const result=await ctx.client.rpc("ees_hr_v7_lookups",{p_kind:path[1],p_driver_id:scopedDriver?driverId(scopedDriver):null});hrDatabaseError(result.error);return json(result.data);
    }
    if(path[0]==="meetings"&&path.length===2) {
      ctx.requireHR();const result=await ctx.client.rpc("ees_hr_v7_meeting",{p_id:uuid(path[1]),p_allow_test:url.searchParams.get("allowTest")==="true"});hrDatabaseError(result.error);return json(result.data);
    }
    if(path[0]==="followups") {
      ctx.requireHR();const query=Object.fromEntries(url.searchParams);
      const result=await ctx.client.rpc("ees_hr_v7_followups",{p_query:query});hrDatabaseError(result.error);return json(result.data);
    }
    if(path[0]==="documents"&&path.length===2) {
      ctx.requireHR();if(!ctx.access.storageReady)throw new HRV7Error("HR_STORAGE_NOT_READY",409);
      const result=await ctx.client.from("ees_employee_documents").select("id,category,mime_type,version,state,object_key").eq("id",uuid(path[1])).maybeSingle();hrDatabaseError(result.error);
      const doc=result.data;if(!doc)throw new HRV7Error("HR_NOT_FOUND",404);if(!["ready","retired"].includes(doc.state))throw new HRV7Error("HR_DOCUMENT_STATE",409);
      const download=await ctx.storageAdmin().storage.from("ees-employee-documents").download(doc.object_key);
      if(download.error || !download.data)throw new HRV7Error("HR_DOCUMENT_UNAVAILABLE",503);
      const extension=doc.mime_type==="application/pdf"?"pdf":doc.mime_type==="image/png"?"png":doc.mime_type==="image/jpeg"?"jpg":"heic";
      return new NextResponse(download.data,{headers:{...headers,"Content-Type":doc.mime_type,"Content-Disposition":`attachment; filename="${doc.category}-v${doc.version}.${extension}"`,"Content-Security-Policy":"default-src 'none'; sandbox"}});
    }
    throw new HRV7Error("HR_NOT_FOUND",404);
  } catch(error){const safe=hrSafeResponseError(error);return json({code:safe.code,...(safe.dependencies?{dependencies:safe.dependencies}:{})},safe.status);}
}

export async function POST(request:Request,route:RouteContext) {
  try {
    const {path}=await route.params;
    const ctx=await hrServerContext(request);
    if(path[0]==="directory") {
      const query=await inputJson(request);
      if(!ctx.access.ready)return json(await legacyDirectory(ctx,query));
      const result=await ctx.client.rpc(ctx.access.peopleReady?"ees_people_directory":"ees_hr_v7_directory",{p_query:query});hrDatabaseError(result.error);return json({...result.data,access:{...result.data.access,...ctx.access}});
    }
    if(!ctx.access.ready)throw new HRV7Error("HR_SETUP_REQUIRED",503);
    if(path[0]==="people" && path.length===2 && ["absences","incidents"].includes(path[1])) {
      ctx.requireHR();ctx.requireRelease();if(!ctx.access.peopleReady)throw new HRV7Error("HR_RELEASE_REQUIRED",503);
      const body=await inputJson(request);
      const result=await ctx.client.rpc("ees_people_action",{p_kind:path[1],p_input:body.input,p_request_id:uuid(body.requestId)});
      hrDatabaseError(result.error);return json(result.data);
    }
    if(path[0]==="action") {
      const body=await inputJson(request);const validated=validateHRAction(body.action,body.input);const requestId=uuid(body.requestId);
      if(["finish_document","finish_purge","prepare_document"].includes(validated.action))throw new HRV7Error("HR_SERVER_FINALIZATION_REQUIRED",403);
      if(!["save_driver","deactivate_driver","change_vehicle","end_cover"].includes(validated.action))ctx.requireHR();
      if(validated.action==="save_driver"&&validated.input.employeeId)ctx.requireHR();
      ctx.requireRelease();
      const result=await ctx.client.rpc("ees_hr_v7_action",{p_action:validated.action,p_input:validated.input,p_request_id:requestId});hrDatabaseError(result.error);return json(result.data);
    }
    if(path[0]==="documents"&&path[1]==="upload") {
      ctx.requireHR();ctx.requireRelease();if(!ctx.access.storageReady)throw new HRV7Error("HR_STORAGE_NOT_READY",409);
      const bytes=await limitedBody(request,MAX_DOCUMENT_BYTES+131072);
      const form=await new Response(bytes,{headers:{"Content-Type":request.headers.get("content-type")??""}}).formData();
      const file=form.get("file");if(!(file instanceof File))throw new HRV7Error("HR_INVALID_FILE");
      const metadata=JSON.parse(String(form.get("metadata")??"{}"));
      const contents=new Uint8Array(await file.arrayBuffer());const validated=validateDocumentBytes(contents,file.name,file.type);
      if(["image/jpeg","image/png"].includes(validated.mime)) {
        try{const image=await sharp(Buffer.from(contents),{limitInputPixels:40000000}).metadata();if(!image.width||!image.height)throw new Error();}
        catch{throw new HRV7Error("HR_INVALID_FILE");}
      }
      const checked=validateHRAction("prepare_document",{...metadata,filename:validated.filename,mimeType:validated.mime,sizeBytes:contents.byteLength});
      const prepared=await ctx.client.rpc("ees_hr_v7_action",{p_action:"prepare_document",p_input:checked.input,p_request_id:uuid(String(form.get("requestId")))});hrDatabaseError(prepared.error);
      const intent=prepared.data as {id:string;objectKey:string};const admin=ctx.storageAdmin();
      const stored=await ctx.client.from("ees_employee_documents").select("state,uploaded_by").eq("id",intent.id).single();hrDatabaseError(stored.error);
      if(!stored.data)throw new HRV7Error("HR_NOT_FOUND",404);
      if(stored.data.uploaded_by!==ctx.user.id)throw new HRV7Error("HR_FORBIDDEN",403);
      if(!["pending","ready"].includes(stored.data.state))throw new HRV7Error("HR_DOCUMENT_STATE",409);
      if(stored.data.state==="ready") {
        const existing=await admin.storage.from("ees-employee-documents").download(intent.objectKey);
        if(existing.error||!existing.data)throw new HRV7Error("HR_DOCUMENT_UNAVAILABLE",503);
        if(createHash("sha256").update(Buffer.from(await existing.data.arrayBuffer())).digest("hex")!==createHash("sha256").update(contents).digest("hex"))throw new HRV7Error("HR_REQUEST_REUSED",409);
        return json({id:intent.id});
      }
      const upload=await admin.storage.from("ees-employee-documents").upload(intent.objectKey,contents,{upsert:false,contentType:validated.mime,cacheControl:"0"});
      if(upload.error) {
        // A previous attempt may have uploaded bytes before its response was lost.
        // Verify identical bytes before resuming; never overwrite a stored version.
        const existing=await admin.storage.from("ees-employee-documents").download(intent.objectKey);
        if(existing.error||!existing.data)throw new HRV7Error("HR_UPLOAD_FAILED",503);
        if(createHash("sha256").update(Buffer.from(await existing.data.arrayBuffer())).digest("hex")!==createHash("sha256").update(contents).digest("hex"))throw new HRV7Error("HR_REQUEST_REUSED",409);
      }
      const finished=await admin.rpc("ees_hr_v7_finalize_document",{p_id:intent.id,p_actor:ctx.user.id,p_operation:"ready"});
      if(finished.error)throw new HRV7Error("HR_UPLOAD_FINALIZATION_PENDING",503);
      return json({id:intent.id});
    }
    if(path[0]==="documents"&&path.length===3&&path[2]==="purge") {
      ctx.requireHR();const body=await inputJson(request);const id=uuid(path[1]);
      ctx.requireRelease();
      if(!ctx.access.storageReady)throw new HRV7Error("HR_STORAGE_NOT_READY",409);
      const state=await ctx.client.from("ees_employee_documents").select("state").eq("id",id).maybeSingle();hrDatabaseError(state.error);
      if(state.data?.state==="purged")return json({id});
      const prepared=await ctx.client.rpc("ees_hr_v7_action",{p_action:"prepare_purge",p_input:{id,reason:String(body.reason??"")},p_request_id:uuid(body.requestId)});hrDatabaseError(prepared.error);
      const key=prepared.data.objectKey as string;const admin=ctx.storageAdmin();
      const removed=await admin.storage.from("ees-employee-documents").remove([key]);if(removed.error)throw new HRV7Error("HR_DOCUMENT_UNAVAILABLE",503);
      const result=await admin.rpc("ees_hr_v7_finalize_document",{p_id:id,p_actor:ctx.user.id,p_operation:"purged"});hrDatabaseError(result.error);return json(result.data);
    }
    throw new HRV7Error("HR_NOT_FOUND",404);
  } catch(error){const safe=hrSafeResponseError(error);return json({code:safe.code,...(safe.dependencies?{dependencies:safe.dependencies}:{})},safe.status);}
}
