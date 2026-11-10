const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const source = fs.readFileSync("lib/finance-paperwork.ts", "utf8");
const copySource = fs.readFileSync("lib/finance-paperwork-copy.ts", "utf8");
function load(text) { const module = { exports: {} }; new Function("module", "exports", ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(module, module.exports); return module.exports; }
const p = load(source), copy = load(copySource).paperworkCopy;
const file = (bytes, type, name = "order.pdf") => Object.assign(new Blob([new Uint8Array(bytes)], { type }), { name });
const pdf = () => file([37,80,68,70,45,49,46,55,10,65], "application/pdf");

test("PDF, JPEG, PNG and WebP signatures match allowed MIME and size", async () => {
  const samples = [pdf(),file([255,216,255,0],"image/jpeg","photo.jpg"),file([137,80,78,71,13,10,26,10,0],"image/png","receipt.png"),file([82,73,70,70,0,0,0,0,87,69,66,80],"image/webp","receipt.webp")];
  for (const sample of samples) assert.equal((await p.validatePaperworkFile(sample)).mime, sample.type);
});

test("invalid type, spoofed MIME, empty and oversized files are refused", async () => {
  await assert.rejects(p.validatePaperworkFile(file([1,2,3],"application/pdf")),/PAPERWORK_TYPE_INVALID/);
  await assert.rejects(p.validatePaperworkFile(file([37,80,68,70,45],"image/png")),/PAPERWORK_TYPE_INVALID/);
  await assert.rejects(p.validatePaperworkFile(file([],"application/pdf")),/PAPERWORK_SIZE_OR_NAME_INVALID/);
  await assert.rejects(p.validatePaperworkFile({name:"huge.pdf",type:"application/pdf",size:p.PAPERWORK_MAX_BYTES+1,slice(){throw Error("should not read")}}),/PAPERWORK_SIZE_OR_NAME_INVALID/);
  assert.equal(p.safePaperworkFilename("../unsafe\\name.pdf"),".._unsafe_name.pdf");
});

function mockClient({ failUpload = false } = {}) {
  const calls = []; let sequence = 0;
  const client = {
    calls,
    rpc: async (name, args) => {
      calls.push(["rpc",name,args]);
      if (name === "finance_reserve_paperwork") {
        sequence++;
        return {data:{id:`doc-${sequence}`,booking_id:args.p_booking_id,kind:args.p_kind,object_key:`${args.p_booking_id}/doc-${sequence}`,original_filename:args.p_filename,mime_type:args.p_mime,size_bytes:args.p_size,status:"pending",revision_of:args.p_revision_of,physical_location:null,created_at:"now",reviewed_at:null},error:null};
      }
      if (name === "finance_finalize_paperwork") return failUpload ? {data:null,error:new Error("not uploaded")} : {data:{id:args.p_document_id,status:"uploaded"},error:null};
      throw Error(`unexpected RPC ${name}`);
    },
    storage: { from(bucket) { assert.equal(bucket,p.PAPERWORK_BUCKET); return { upload: async (key,_file,options) => { calls.push(["upload",key,options]); return failUpload ? {error:new Error("network failed")} : {error:null}; }, download: async (key) => { calls.push(["download",key]); return {data:new Blob(["private"]),error:null}; } }; } }
  };
  return client;
}

test("booking association, duplicate filenames and revisions use separate immutable object keys", async () => {
  const client=mockClient();
  await p.reserveAndUploadPaperwork(client,"booking-1","green_job_order",pdf());
  await p.reserveAndUploadPaperwork(client,"booking-1","green_job_order",pdf(),"prior-doc");
  const reservations=client.calls.filter((call)=>call[1]==="finance_reserve_paperwork");
  assert.equal(reservations.length,2);
  assert.equal(reservations[0][2].p_booking_id,"booking-1");
  assert.equal(reservations[1][2].p_revision_of,"prior-doc");
  assert.deepEqual(client.calls.filter((call)=>call[0]==="upload").map((call)=>call[1]),["booking-1/doc-1","booking-1/doc-2"]);
  assert.ok(client.calls.filter((call)=>call[0]==="upload").every((call)=>call[2].upsert===false));
  assert.ok(!client.calls.some((call)=>call[1]==="finance_submit_verification"));
});

test("upload failure keeps a retryable reservation without marking it reviewed", async () => {
  const client=mockClient({failUpload:true});
  let pending;
  await assert.rejects(p.reserveAndUploadPaperwork(client,"booking-1","parking_receipt",pdf()),(error)=>{ assert.ok(error instanceof p.PaperworkUploadError); pending=error.pending; return true; });
  assert.equal(pending.status,"pending");
  client.rpc=async (name,args)=>({data:{id:args.p_document_id,status:"uploaded"},error:null});
  await assert.rejects(p.uploadReservedPaperwork(client,pending,file([255,216,255],"image/jpeg","other.jpg")),/PAPERWORK_RETRY_FILE_MISMATCH/);
  const result=await p.uploadReservedPaperwork(client,pending,pdf());
  assert.equal(result.status,"uploaded");
});

test("only reviewed evidence clears missing flags; inbox and errors have English and Thai labels", () => {
  const docs=[{kind:"green_job_order",status:"uploaded"},{kind:"parking_receipt",status:"reviewed"},{kind:"toll_receipt",status:"rejected"}];
  assert.deepEqual(p.paperworkMissing(docs),["green_job_order","toll_receipt"]);
  for(const key of Object.keys(copy.en)) assert.ok(copy.th[key],key);
  assert.deepEqual(Object.keys(copy.en.events).sort(),Object.keys(copy.th.events).sort());
  const page=fs.readFileSync("app/(dashboard)/paperwork-inbox/page.tsx","utf8");
  const verification=fs.readFileSync("app/(dashboard)/job-verification/page.tsx","utf8");
  assert.match(page,/fetchBookingDiaryEntries\(/);
  assert.match(page,/reserveAndUploadPaperwork/);
  assert.match(page,/reviewBookingPaperwork/);
  assert.match(page,/documents\.filter\(\(document\) => document\.booking_id === selected\)/);
  assert.match(page,/events\.filter\(\(event\) => event\.booking_id === selected\)/);
  assert.match(page,/retryPending\(doc\)/);
  assert.match(verification,/finance_paperwork_documents/);
  assert.match(verification,/status", "reviewed"/);
  assert.doesNotMatch(page+source,/service_role|SERVICE_ROLE|createPublicUrl|finance_submit_verification/);
});
