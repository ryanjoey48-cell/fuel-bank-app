// Synthetic local Supabase-compatible transport around actual PostgreSQL SQL/RLS.
// Never connects to Supabase or contains production keys/data.
const {PGlite}=require('@electric-sql/pglite'),fs=require('node:fs'),http=require('node:http');
const hr='00000000-0000-4000-8000-000000000001',office='00000000-0000-4000-8000-000000000002',driver='00000000-0000-4000-8000-000000000003';
const token=(uid=hr,role='authenticated')=>Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:uid,role,aud:'authenticated',exp:Math.floor(Date.now()/1000)+86400})).toString('base64url')+'.synthetic-signature';
async function fixture({port=0}={}){
 const db=new PGlite();await db.exec(fs.readFileSync('tests/fixtures/hr-v7-base.sql','utf8'));
 for(const [id,name,role] of [[hr,'Synthetic HR','admin'],[office,'Synthetic Office','office_staff'],[driver,'Synthetic Driver Account','office_staff']]){await db.query('insert into auth.users values($1,$2)',[id,'synthetic@example.test']);await db.query('insert into account_access values($1,$2,$3,$4)',[id,name,role,'active']);}
 await db.query('insert into ees_hr_admins(user_id) values($1)',[hr]);await db.query('insert into driver_accounts values($1,true)',[driver]);
 for(let i=1;i<=32;i++)await db.query('insert into drivers(id,name) values($1,$2)',[i,`Synthetic Driver ${String(i).padStart(2,'0')}`]);
 const vehicle='10000000-0000-4000-8000-000000000001';await db.query("insert into vehicles(id,vehicle_reg,vehicle_type,vehicle_name) values($1,'FIXTURE-ONLY','FOUR_WHEEL_TRUCK','Synthetic fleet')",[vehicle]);await db.query('update drivers set assigned_vehicle_id=$1 where id=11',[vehicle]);
 for(const file of fs.readdirSync('supabase/migrations').filter(name=>/^20261013.*ees_hr_v7_/.test(name)).sort())await db.exec(fs.readFileSync('supabase/migrations/'+file,'utf8'));
 await db.exec('grant usage on schema public,auth,storage to service_role;grant all on all tables in schema storage to service_role;');
 let queue=Promise.resolve();const stored=new Map();const calls=[];
 const run=(claims,operation)=>{const work=queue.then(async()=>{await db.exec('begin');try{await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true)",[claims.sub??'',claims.role??'anon']);await db.exec('set local role '+(['authenticated','driver_portal','service_role'].includes(claims.role)?claims.role:'anon'));const result=await operation();await db.exec('commit');return result;}catch(error){await db.exec('rollback');throw error;}});queue=work.catch(()=>{});return work;};
 await run({sub:hr,role:'authenticated'},()=>db.query("select ees_hr_v7_action('save_employee',$1::jsonb,$2::uuid)",[JSON.stringify({driverId:'11',preferredName:'Synthetic Driver 11',telephone:'0811111111',employmentStatus:'active',startDate:'2026-01-01',statusReason:'Synthetic initial record'}),'20000000-0000-4000-8000-000000000001']));
 const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','*');res.setHeader('Access-Control-Allow-Methods','GET,POST,DELETE,OPTIONS');res.setHeader('Content-Type','application/json');
  if(req.method==='OPTIONS'){res.end();return;}
  const raw=[];for await(const chunk of req)raw.push(chunk);const bytes=Buffer.concat(raw);let body;try{body=JSON.parse(bytes.toString()||'{}');}catch{body={};}
  let claims={};try{claims=JSON.parse(Buffer.from((req.headers.authorization??'').split(' ')[1].split('.')[1],'base64url').toString());}catch{}
  if(req.headers.authorization==='Bearer synthetic-service-key')claims={sub:hr,role:'service_role'};
  calls.push({path:url.pathname,method:req.method,role:claims.role});
  try{
   if(url.pathname==='/auth/v1/user'){if(![hr,office,driver].includes(claims.sub)){res.statusCode=401;res.end(JSON.stringify({message:'Invalid synthetic session'}));return;}res.end(JSON.stringify({id:claims.sub,email:'synthetic@example.test',aud:'authenticated',role:claims.role,app_metadata:{},user_metadata:{}}));return;}
   if(url.pathname.startsWith('/rest/v1/rpc/')){
    const name=url.pathname.split('/').pop();if(!/^[a-z_0-9]+$/.test(name))throw Error('invalid RPC');const keys=Object.keys(body);if(keys.some(key=>!/^p_[a-z_]+$/.test(key)))throw Error('invalid parameters');
    const result=await run(claims,()=>db.query(`select public.${name}(${keys.map((key,i)=>`${key}=>$${i+1}`).join(',')}) as result`,keys.map(key=>typeof body[key]==='object'&&body[key]!==null?JSON.stringify(body[key]):body[key])));res.end(JSON.stringify(result.rows[0].result));return;
   }
   if(url.pathname==='/rest/v1/ees_employee_licences'||url.pathname==='/rest/v1/ees_employee_documents'&&!url.searchParams.has('id')){
    const table=url.pathname.endsWith('ees_employee_licences')?'ees_employee_licences':'ees_employee_documents';
    const fields=table==='ees_employee_licences'?'employee_id,issue_date::text as issue_date,expiry_date::text as expiry_date,recorded_at':'employee_id,state,expiry_date::text as expiry_date';
    const result=await run(claims,()=>db.query('select '+fields+' from '+table+' order by id offset $1 limit $2',[Number(url.searchParams.get('offset')??0),Number(url.searchParams.get('limit')??500)]));res.end(JSON.stringify(result.rows));return;
   }
   if(url.pathname==='/rest/v1/ees_employee_documents'){
    const id=(url.searchParams.get('id')??'').replace(/^eq\./,'');const result=await run(claims,()=>db.query('select * from ees_employee_documents where id=$1',[id]));const columns=(url.searchParams.get('select')??'*').split(',');const rows=result.rows.map(row=>columns[0]==='*'?row:Object.fromEntries(columns.map(key=>[key,row[key]])));
    res.end(JSON.stringify((req.headers.accept??'').includes('object+json')?rows[0]:rows));return;
   }
   if(url.pathname.startsWith('/storage/v1/object/')){
    if(claims.role!=='service_role'){res.statusCode=403;res.end(JSON.stringify({message:'Private bytes denied'}));return;}
    const key=decodeURIComponent(url.pathname.replace('/storage/v1/object/',''));
    if(req.method==='POST'){if(stored.has(key)){res.statusCode=409;res.end(JSON.stringify({message:'Duplicate'}));return;}stored.set(key,bytes);await db.query('insert into storage.objects(bucket_id,name) values($1,$2)',[key.split('/')[0],key.split('/').slice(1).join('/')]);res.end(JSON.stringify({Key:key}));return;}
    if(req.method==='GET'){if(!stored.has(key)){res.statusCode=404;res.end(JSON.stringify({message:'Missing'}));return;}res.setHeader('Content-Type','image/png');res.end(stored.get(key));return;}
    if(req.method==='DELETE'){for(const prefix of body.prefixes??[]){stored.delete(key+'/'+prefix);await db.query('delete from storage.objects where bucket_id=$1 and name=$2',[key,prefix]);}res.end('[]');return;}
   }
   res.statusCode=404;res.end(JSON.stringify({message:'Synthetic endpoint not implemented'}));
  }catch(error){res.statusCode=error.code==='42501'?403:400;res.end(JSON.stringify({code:error.code??'XX000',message:error.message}));}
 });
 await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));const url='http://127.0.0.1:'+server.address().port;
 return {db,run,server,url,token:token(),hr,office,driver,tokenFor:token,calls,async close(){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await db.close();}};
}
module.exports={fixture,token,hr,office,driver};
