const fs=require('node:fs');const {PGlite}=require('@electric-sql/pglite');
const ids={staff:'11000000-0000-4000-8000-000000000001',manager:'11000000-0000-4000-8000-000000000002',reader:'11000000-0000-4000-8000-000000000003',driver:'11000000-0000-4000-8000-000000000004',superAdmin:'11000000-0000-4000-8000-000000000005',suspended:'11000000-0000-4000-8000-000000000006'};
async function createExpenseDb(directory,canonicalTestVehicles=false){
 const db=new PGlite(directory);
 let setup=`create role anon;create role authenticated;create role service_role;create schema auth;create schema storage;
 create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claims',true)::jsonb->>'sub','')::uuid$$;
 grant usage on schema auth to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon,service_role;
 create table public.account_access(user_id uuid primary key references auth.users(id),display_name text,role text,status text);
 create table public.driver_accounts(auth_user_id uuid,active boolean);
 create function public.is_office_account() returns boolean language sql stable security definer as $$select exists(select 1 from public.account_access where user_id=auth.uid() and status='active') and not exists(select 1 from public.driver_accounts where auth_user_id=auth.uid() and active)$$;
 create table public.vehicles(id uuid primary key,vehicle_reg text,active boolean);
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(bucket_id text,name text);
 alter table storage.objects enable row level security;
 insert into auth.users values ${Object.values(ids).map(id=>`('${id}')`).join(',')};
 insert into public.account_access values ${Object.entries(ids).map(([name,id])=>`('${id}','Synthetic ${name}','${name==='superAdmin'?'super_admin':name==='manager'||name==='suspended'?'admin':name==='reader'?'read_only':'office_staff'}','${name==='suspended'?'suspended':'active'}')`).join(',')};
 insert into public.driver_accounts values('${ids.driver}',true);
 insert into public.vehicles values('22000000-0000-4000-8000-000000000001','ทดสอบ-001',true);`;
 if(canonicalTestVehicles)setup=setup.replace('create table public.vehicles(id uuid primary key,vehicle_reg text,active boolean);','').replace("insert into public.vehicles values('22000000-0000-4000-8000-000000000001','ทดสอบ-001',true);",'');
 await db.exec(setup);
 if(canonicalTestVehicles){await db.exec("set ees.expenses.approved_test_project_ref='wpmnjfncaoogssgpqxek'");await db.exec(fs.readFileSync('docs/expenses-v11-test-vehicles-prerequisite-review-only.sql','utf8'));}
 await db.exec(fs.readFileSync('supabase/migrations/20261109090000_expenses_centre_review_only.sql','utf8'));
 await db.exec(fs.readFileSync('supabase/migrations/20261110100000_expenses_centre_v11_review_only.sql','utf8'));
 return db;
}
async function asUser(db,name,role='authenticated'){await db.exec('reset role');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:ids[name],role})]);await db.exec(`set role ${role}`);}
async function command(db,command,body){return(await db.query('select public.expenses_command($1,$2::jsonb) as value',[command,JSON.stringify(body)])).rows[0].value;}
module.exports={ids,createExpenseDb,asUser,command};
