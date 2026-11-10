const {test}=require('node:test');const assert=require('node:assert/strict');const path=require('node:path');
const h=require('./helpers/invoice-compare.cjs');const server=h.lib('expenses-server.ts');
const route=h.loadTs(path.resolve('app/api/expenses-centre/attachments/route.ts'));

test('private receipt API: signature validation, pending reservation, failed finalisation, retry, signed download and audited removal',async()=>{
 const originalContext=server.expensesContext,originalCommand=server.expenseCommand;
 const expenseId='10000000-0000-4000-8000-000000000001';const userId='10000000-0000-4000-8000-000000000002';
 let attachment=null,object=null,failFinish=true,reserves=0;const audit=[];let role='office_staff';let signed=0;
 const db={from:table=>{const query={select:()=>query,eq:()=>query,maybeSingle:async()=>({data:attachment,error:null}),single:async()=>({data:table==='expenses_entries'?{created_by:userId,status:'draft'}:attachment,error:null})};return query;}};
 const admin={from:()=>({select:()=>({eq:()=>({single:async()=>({data:{role,status:'active'}})})})}),storage:{from:bucket=>{assert.equal(bucket,'expenses-receipts');return{
  upload:async(key,bytes,options)=>{assert.equal(key,`${expenseId}/${attachment.id}`);assert.equal(options.upsert,false);if(object)return{error:{message:'already exists'}};object=bytes;return{error:null};},
  download:async()=>({data:object?new Blob([object]):null,error:object?null:{message:'not stored'}}),
  createSignedUrl:async(key,ttl,options)=>{signed++;assert.equal(ttl,60);assert.equal(options.download,'synthetic.pdf');return{data:{signedUrl:'https://synthetic.invalid/signed-receipt'},error:null};}
 };}},rpc:async()=>{if(failFinish)return{error:{message:'simulated interruption'}};attachment.state='ready';return{error:null};}};
 server.expensesContext=async()=>({db,admin,user:{id:userId},access:{role,status:'active'}});
 server.expenseCommand=async(_db,command,body)=>{audit.push({command,body});if(command==='attachment_reserve'){reserves++;attachment={id:body.attachment_id,expense_id:expenseId,...body,state:'pending'};return attachment;}if(command==='attachment_remove'){attachment.state='removed';return attachment;}throw new Error('unexpected command');};
 const request=(bytes,name='synthetic.pdf')=>{const form=new FormData();form.append('expense_id',expenseId);form.append('file',new File([bytes],name,{type:'application/pdf'}));return new Request('http://localhost/api/expenses-centre/attachments',{method:'POST',body:form});};
 try{
  let response=await route.POST(request('<script>not a PDF</script>'));assert.equal(response.status,400);assert.equal(reserves,0);assert.equal(object,null);
  const bytes=Buffer.from('%PDF-1.4\nSynthetic isolated original\n%%EOF');
  response=await route.POST(request(bytes));assert.equal(response.status,400);assert.equal((await response.json()).error,'UPLOAD_PENDING_RETRY');assert.equal(attachment.state,'pending');assert.ok(object,'original exists but is never falsely reported ready');
  failFinish=false;response=await route.POST(request(bytes));assert.equal(response.status,200);assert.equal((await response.json()).state,'ready');assert.equal(reserves,1,'retry reuses the durable reservation');
  response=await route.GET(new Request(`http://localhost/api/expenses-centre/attachments?id=${attachment.id}`));assert.equal(response.status,200);assert.equal(signed,1);assert.match(response.headers.get('cache-control'),/no-store/);
  response=await route.DELETE(new Request('http://localhost/api/expenses-centre/attachments',{method:'DELETE',body:JSON.stringify({id:expenseId,attachment_id:attachment.id,note:'Synthetic replacement reason'}),headers:{'Content-Type':'application/json'}}));assert.equal(response.status,200);assert.equal(attachment.state,'removed');assert.ok(object,'removal retains original');assert.ok(audit.some(a=>a.command==='attachment_remove'&&a.body.note));
  response=await route.GET(new Request(`http://localhost/api/expenses-centre/attachments?id=${attachment.id}`));assert.equal(response.status,404,'submitter cannot retrieve removed audit evidence');
  role='admin';response=await route.GET(new Request(`http://localhost/api/expenses-centre/attachments?id=${attachment.id}`));assert.equal(response.status,200,'admin can retrieve retained evidence');
 }finally{server.expensesContext=originalContext;server.expenseCommand=originalCommand;}
});
