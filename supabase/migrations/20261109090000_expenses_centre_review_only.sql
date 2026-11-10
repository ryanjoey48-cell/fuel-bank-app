-- PREPARED ONLY. Do not apply to any remote database without environment verification and owner approval.
-- Existing fleet, finance and source records are never mutated by this migration.
begin;

create table public.expenses_config (id boolean primary key default true check(id), enabled boolean not null default false);
insert into public.expenses_config values (true, false);
create table public.expenses_categories (
  id text primary key, en text not null check(length(en) between 1 and 120), th text not null check(length(th) between 1 and 120),
  parent_id text references public.expenses_categories(id), active boolean not null default true, position integer not null default 0,
  check(parent_id is distinct from id)
);
insert into public.expenses_categories(id,en,th,position) values
 ('vehicle','Vehicle expenses','ค่าใช้จ่ายรถ',0), ('depot','Depot and lorry park','คลังและลานจอดรถ',1),
 ('office','Office and administration','สำนักงานและธุรการ',2), ('transport','Transport operations','การขนส่ง',3),
 ('staff','Staff and drivers','พนักงานและคนขับ',4), ('insurance','Insurance and compliance','ประกันภัยและการปฏิบัติตามกฎ',5),
 ('equipment','Maintenance and equipment','ซ่อมบำรุงและอุปกรณ์',6), ('general','General business expenses','ค่าใช้จ่ายธุรกิจทั่วไป',7), ('other','Other','อื่น ๆ',8);
insert into public.expenses_categories(id,en,th,parent_id,position) values
 ('electricity','Electricity','ไฟฟ้า','depot',10), ('rent','Rent','ค่าเช่า','depot',11), ('water','Water','น้ำประปา','depot',12),
 ('telephone','Telephone / Internet','โทรศัพท์ / อินเทอร์เน็ต','office',13), ('parking','Parking','ค่าจอดรถ','transport',14),
 ('tolls','Tolls / Ferries','ทางด่วน / เรือข้ามฟาก','transport',15), ('tyres','Tyres / Batteries','ยาง / แบตเตอรี่','vehicle',16),
 ('repairs','Repairs / Cleaning','ซ่อม / ทำความสะอาด','vehicle',17), ('supplies','Consumables / Supplies','วัสดุสิ้นเปลือง','office',18),
 ('uniforms','Uniforms','เครื่องแบบ','staff',19), ('licences','Licences','ใบอนุญาต','insurance',20);
create table public.expenses_cost_centres(id text primary key, en text not null check(length(en) between 1 and 120), th text not null check(length(th) between 1 and 120), active boolean not null default true);
insert into public.expenses_cost_centres values ('depot','Depot / Lorry park','คลัง / ลานจอดรถ',true),('office','Office','สำนักงาน',true),('general','General company','บริษัททั่วไป',true);
create table public.expenses_entries (
 id uuid primary key default gen_random_uuid(), created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), revision integer not null default 1,
 status text not null default 'draft' check(status in ('draft','submitted','needs_information','approved','rejected','closed','voided')),
 data jsonb not null check(jsonb_typeof(data)='object'),
 vehicle_id uuid references public.vehicles(id), category_id text not null references public.expenses_categories(id),
 request_key uuid not null, unique(created_by, request_key)
);
create index expenses_entries_date on public.expenses_entries ((data->>'date'));
create index expenses_entries_creator on public.expenses_entries(created_by);
create index expenses_entries_status on public.expenses_entries(status);
create table public.expenses_attachments (
 id uuid primary key, expense_id uuid not null references public.expenses_entries(id),
 name text not null check(length(name) between 1 and 180), mime text not null check(mime in ('image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf')),
 size integer not null check(size between 1 and 15728640), sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
 state text not null default 'pending' check(state in ('pending','ready','removed')),
 created_at timestamptz not null default now(), unique(expense_id,sha256)
);
create table public.expenses_audit (
 id uuid primary key default gen_random_uuid(), expense_id uuid references public.expenses_entries(id), actor uuid not null references auth.users(id),
 action text not null, note text not null default '', old_value jsonb, new_value jsonb, created_at timestamptz not null default now()
);
create index expenses_audit_entry on public.expenses_audit(expense_id,created_at);
create table public.expenses_templates(id uuid primary key default gen_random_uuid(), name text not null, next_date date not null, frequency text not null check(frequency in ('monthly','yearly')), active boolean not null default true, input jsonb not null);

-- Uses the existing authoritative account model, never caller-supplied roles.
create function public.expenses_role() returns text language sql stable security definer set search_path=public,pg_temp as $$
 select role from public.account_access where user_id=auth.uid() and status='active' and role in ('super_admin','admin','office_staff','read_only') and public.is_office_account()
$$;
create function public.expenses_can_read(e public.expenses_entries) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select public.expenses_role() is not null and (e.created_by=auth.uid() or public.expenses_role() in ('super_admin','admin','office_staff'))
$$;
alter table public.expenses_config enable row level security;
alter table public.expenses_categories enable row level security;
alter table public.expenses_cost_centres enable row level security;
alter table public.expenses_entries enable row level security;
alter table public.expenses_attachments enable row level security;
alter table public.expenses_audit enable row level security;
alter table public.expenses_templates enable row level security;
create policy expenses_config_read on public.expenses_config for select to authenticated using(public.expenses_role() is not null);
create policy expenses_categories_read on public.expenses_categories for select to authenticated using(public.expenses_role() is not null);
create policy expenses_centres_read on public.expenses_cost_centres for select to authenticated using(public.expenses_role() is not null);
create policy expenses_entries_read on public.expenses_entries for select to authenticated using(public.expenses_can_read(expenses_entries));
create policy expenses_attachments_read on public.expenses_attachments for select to authenticated using(exists(select 1 from public.expenses_entries e where e.id=expense_id and public.expenses_can_read(e)));
create policy expenses_audit_read on public.expenses_audit for select to authenticated using((expense_id is null and public.expenses_role() in ('super_admin','admin')) or exists(select 1 from public.expenses_entries e where e.id=expense_id and public.expenses_can_read(e)));
create policy expenses_templates_read on public.expenses_templates for select to authenticated using(public.expenses_role() is not null);
-- No direct mutation grants or policies: every change passes the locked, audited command below.
revoke all on public.expenses_config,public.expenses_categories,public.expenses_cost_centres,public.expenses_entries,public.expenses_attachments,public.expenses_audit,public.expenses_templates from anon,authenticated;
grant select on public.expenses_config,public.expenses_categories,public.expenses_cost_centres,public.expenses_entries,public.expenses_attachments,public.expenses_audit,public.expenses_templates to authenticated;

create function public.expenses_command(command text, body jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
 r text := public.expenses_role(); e public.expenses_entries; previous jsonb; result jsonb;
 d jsonb; c public.expenses_categories; centre public.expenses_cost_centres; reg text; v uuid;
 target uuid; a public.expenses_attachments; next_status text; amount bigint; vat bigint;
 n text := coalesce(body->>'note',''); k text; obj_id text;
begin
 if r is null then raise exception 'EXPENSES_FORBIDDEN' using errcode='42501'; end if;
 if not exists(select 1 from public.expenses_config where enabled) then raise exception 'EXPENSES_NOT_ACTIVATED'; end if;
 if r='read_only' then raise exception 'EXPENSES_READ_ONLY' using errcode='42501'; end if;
 if length(n)>2000 then raise exception 'NOTE_TOO_LONG'; end if;

 if command in ('category','centre','template') then
   if r not in ('super_admin','admin') then raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
   if command='category' then
     obj_id := coalesce(nullif(body->>'id',''), gen_random_uuid()::text);
     select to_jsonb(t) into previous from public.expenses_categories t where id=obj_id for update;
     -- Only one subcategory level; cycles are impossible, historical snapshots are preserved.
     if nullif(body->>'parent_id','') is not null and not exists(select 1 from public.expenses_categories where id=body->>'parent_id' and parent_id is null and id<>obj_id) then raise exception 'INVALID_PARENT'; end if;
     if nullif(body->>'parent_id','') is not null and exists(select 1 from public.expenses_categories where parent_id=obj_id) then raise exception 'CATEGORY_HAS_CHILDREN'; end if;
     insert into public.expenses_categories values(obj_id,btrim(body->>'en'),btrim(body->>'th'),nullif(body->>'parent_id',''),coalesce((body->>'active')::boolean,true),coalesce((body->>'position')::integer,0))
     on conflict(id) do update set en=excluded.en,th=excluded.th,parent_id=excluded.parent_id,active=excluded.active,position=excluded.position returning to_jsonb(expenses_categories.*) into result;
   elsif command='centre' then
     obj_id := coalesce(nullif(body->>'id',''),gen_random_uuid()::text);
     select to_jsonb(t) into previous from public.expenses_cost_centres t where id=obj_id for update;
     insert into public.expenses_cost_centres values(obj_id,btrim(body->>'en'),btrim(body->>'th'),coalesce((body->>'active')::boolean,true)) on conflict(id) do update set en=excluded.en,th=excluded.th,active=excluded.active returning to_jsonb(expenses_cost_centres.*) into result;
   else
     target:=coalesce(nullif(body->>'id','')::uuid,gen_random_uuid());
     select to_jsonb(t) into previous from public.expenses_templates t where id=target for update;
     if length(btrim(body->>'name')) not between 1 and 120 or jsonb_typeof(body->'input')<>'object' then raise exception 'INVALID_TEMPLATE'; end if;
     insert into public.expenses_templates values(target,body->>'name',(body->>'next_date')::date,body->>'frequency',coalesce((body->>'active')::boolean,true),body->'input') on conflict(id) do update set name=excluded.name,next_date=excluded.next_date,frequency=excluded.frequency,active=excluded.active,input=excluded.input returning to_jsonb(expenses_templates.*) into result;
   end if;
   insert into public.expenses_audit(actor,action,note,old_value,new_value) values(auth.uid(),command,n,previous,result);
   return result;
 end if;

 if command='create' then
   -- Serialise idempotent retries, including concurrent requests for the same key.
   perform pg_advisory_xact_lock(hashtext(auth.uid()::text||(body->>'request_key')));
   select * into e from public.expenses_entries where created_by=auth.uid() and request_key=(body->>'request_key')::uuid;
   if found then return to_jsonb(e); end if;
 else
   target:=(body->>'id')::uuid;
   select * into e from public.expenses_entries where id=target for update;
   if not found or not public.expenses_can_read(e) then raise exception 'EXPENSE_NOT_FOUND' using errcode='42501'; end if;
   previous:=to_jsonb(e);
   if command not in ('attachment_ready','attachment_reserve','attachment_remove') and coalesce((body->>'revision')::integer,0)<>e.revision then raise exception 'EXPENSE_CONFLICT'; end if;
 end if;

 if command in ('create','edit') then
   if command='edit' and (e.status not in ('draft','needs_information','rejected') or (e.created_by<>auth.uid() and r not in ('admin','super_admin'))) then raise exception 'CORRECTION_NOT_ALLOWED' using errcode='42501'; end if;
   d:=body->'input';
   if d is null or jsonb_typeof(d)<>'object' or length(d::text)>20000 then raise exception 'INVALID_INPUT'; end if;
   foreach k in array array['date','amount','category_id','allocation','vehicle_id','cost_centre_id','description','supplier','payment_method','paid_by','document_number','notes','document_type','vat_basis','vat_amount','supplier_tax_id','tax_review','related_job','related_trip','source','source_id','cost_treatment','payment_status','missing_receipt_reason'] loop
     if jsonb_typeof(d->k) is distinct from 'string' or length(d->>k)>2000 then raise exception 'INVALID_FIELD %',k; end if;
   end loop;
   if jsonb_typeof(d->'reimbursement') is distinct from 'boolean' or jsonb_typeof(d->'recurring') is distinct from 'boolean' then raise exception 'INVALID_BOOLEAN'; end if;
   if d->>'amount' !~ '^(0|[1-9][0-9]{0,8})(\.[0-9]{1,2})?$' or d->>'vat_amount' !~ '^(0|[1-9][0-9]{0,8})(\.[0-9]{1,2})?$' then raise exception 'INVALID_AMOUNT'; end if;
   amount:=((d->>'amount')::numeric*100)::bigint; vat:=((d->>'vat_amount')::numeric*100)::bigint;
   if amount<=0 or vat>amount then raise exception 'INVALID_AMOUNT'; end if;
   if d->>'date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or to_char((d->>'date')::date,'YYYY-MM-DD')<>d->>'date' then raise exception 'INVALID_DATE'; end if;
   if length(btrim(d->>'description')) not between 1 and 500 then raise exception 'DESCRIPTION_REQUIRED'; end if;
   if d->>'payment_status' not in ('paid','unpaid') or d->>'cost_treatment' not in ('internal','rebillable','customer_charge') or d->>'vat_basis' not in ('unknown','inclusive','exclusive','none') or d->>'document_type' not in ('receipt','tax_invoice','invoice','other') or d->>'tax_review' not in ('unreviewed','verified','not_eligible') then raise exception 'INVALID_CLASSIFICATION'; end if;
   if d->>'tax_review'<>'unreviewed' and r not in ('super_admin','admin') then raise exception 'TAX_REVIEW_REQUIRED' using errcode='42501'; end if;
   if d->>'source' not in ('standalone','maintenance','insurance','fuel','finance','other') or (d->>'source'<>'standalone' and length(btrim(d->>'source_id'))=0) then raise exception 'SOURCE_REFERENCE_REQUIRED'; end if;
   select * into c from public.expenses_categories where id=d->>'category_id' and active;
   if not found or (c.parent_id is not null and not exists(select 1 from public.expenses_categories where id=c.parent_id and active)) then raise exception 'CATEGORY_INACTIVE'; end if;
   v:=null; reg:='';
   if d->>'allocation'='vehicle' then
     v:=(d->>'vehicle_id')::uuid;
     select vehicle_reg into reg from public.vehicles where id=v and active;
     if not found then raise exception 'VEHICLE_NOT_FOUND'; end if;
     d:=d||jsonb_build_object('cost_centre_id','','centre_en','','centre_th','');
   elsif d->>'allocation'='centre' then
     select * into centre from public.expenses_cost_centres where id=d->>'cost_centre_id' and active;
     if not found then raise exception 'CENTRE_INACTIVE'; end if;
     d:=d||jsonb_build_object('vehicle_id','','centre_en',centre.en,'centre_th',centre.th);
   else raise exception 'ALLOCATION_REQUIRED'; end if;
   d:=d||jsonb_build_object('amount_satang',amount,'vat_satang',vat,'category_en',c.en,'category_th',c.th,'vehicle_reg',reg,'submitted_by',coalesce((select display_name from public.account_access where user_id=coalesce(e.created_by,auth.uid())),auth.uid()::text));
   if command='create' then
     insert into public.expenses_entries(created_by,data,vehicle_id,category_id,request_key) values(auth.uid(),d,v,c.id,(body->>'request_key')::uuid) returning * into e;
   else
     update public.expenses_entries set data=d,vehicle_id=v,category_id=c.id,revision=revision+1,updated_at=now() where id=e.id returning * into e;
   end if;
 elsif command='transition' then
   next_status:=body->>'status';
   if next_status='submitted' and e.status in ('draft','needs_information','rejected') then
     if e.created_by<>auth.uid() and r not in ('admin','super_admin') then raise exception 'OWNER_REQUIRED' using errcode='42501'; end if;
     if exists(select 1 from public.expenses_attachments where expense_id=e.id and state='pending') then raise exception 'UPLOADS_INCOMPLETE'; end if;
     if not exists(select 1 from public.expenses_attachments where expense_id=e.id and state='ready') and length(btrim(e.data->>'missing_receipt_reason'))=0 then raise exception 'MISSING_RECEIPT_REASON'; end if;
   elsif next_status='needs_information' and e.status='submitted' then
     if r not in ('super_admin','admin','office_staff') or length(btrim(n))=0 then raise exception 'REVIEW_NOTE_REQUIRED' using errcode='42501'; end if;
   elsif next_status in ('approved','rejected') and e.status='submitted' then
     if r not in ('super_admin','admin') then raise exception 'MANAGER_REQUIRED' using errcode='42501'; end if;
     if e.created_by=auth.uid() then raise exception 'SELF_APPROVAL_NOT_ALLOWED'; end if;
     if next_status='rejected' and length(btrim(n))=0 then raise exception 'REVIEW_NOTE_REQUIRED'; end if;
   elsif next_status='closed' and e.status='approved' then
     if r not in ('super_admin','admin') or e.data->>'payment_status'<>'paid' then raise exception 'PAYMENT_CONFIRMATION_REQUIRED'; end if;
   elsif next_status='voided' and e.status<>'voided' then
     if r not in ('super_admin','admin') or length(btrim(n))=0 then raise exception 'VOID_NOTE_REQUIRED' using errcode='42501'; end if;
   else raise exception 'INVALID_TRANSITION'; end if;
   update public.expenses_entries set status=next_status,revision=revision+1,updated_at=now() where id=e.id returning * into e;
 elsif command='payment' then
   if r not in ('super_admin','admin') or e.status in ('closed','voided') or body->>'payment_status' not in ('paid','unpaid') or length(btrim(n))=0 then raise exception 'PAYMENT_NOT_ALLOWED' using errcode='42501'; end if;
   update public.expenses_entries set data=jsonb_set(data,'{payment_status}',to_jsonb(body->>'payment_status')),revision=revision+1,updated_at=now() where id=e.id returning * into e;
 elsif command in ('attachment_reserve','attachment_ready','attachment_remove') then
   if e.status not in ('draft','needs_information','rejected') or (e.created_by<>auth.uid() and r not in ('super_admin','admin')) then raise exception 'ATTACHMENT_LOCKED' using errcode='42501'; end if;
   if command='attachment_reserve' then
     if (select count(*) from public.expenses_attachments where expense_id=e.id and state<>'removed')>=12 then raise exception 'ATTACHMENT_LIMIT'; end if;
     insert into public.expenses_attachments(id,expense_id,name,mime,size,sha256) values((body->>'attachment_id')::uuid,e.id,body->>'name',body->>'mime',(body->>'size')::integer,body->>'sha256') returning * into a;
     result:=to_jsonb(a);
   else
     select * into a from public.expenses_attachments where id=(body->>'attachment_id')::uuid and expense_id=e.id for update;
     if not found then raise exception 'ATTACHMENT_NOT_FOUND'; end if;
     previous:=to_jsonb(a);
     -- Only server may verify a private object actually exists; users cannot finalise arbitrary metadata.
     if command='attachment_ready' and current_setting('request.jwt.claims',true)::jsonb->>'role'<>'service_role' then raise exception 'SERVER_VERIFICATION_REQUIRED' using errcode='42501'; end if;
     if command='attachment_remove' and length(btrim(n))=0 then raise exception 'REMOVAL_REASON_REQUIRED'; end if;
     update public.expenses_attachments set state=case when command='attachment_ready' then 'ready' else 'removed' end where id=a.id returning to_jsonb(expenses_attachments.*) into result;
   end if;
   insert into public.expenses_audit(expense_id,actor,action,note,old_value,new_value) values(e.id,auth.uid(),command,n,previous,result);
   return result;
 else raise exception 'UNKNOWN_COMMAND'; end if;
 result:=to_jsonb(e);
 insert into public.expenses_audit(expense_id,actor,action,note,old_value,new_value) values(e.id,auth.uid(),command,n,previous,result);
 return result;
end;
$$;
revoke all on function public.expenses_command(text,jsonb) from public,anon;
grant execute on function public.expenses_command(text,jsonb) to authenticated;
revoke all on function public.expenses_role(),public.expenses_can_read(public.expenses_entries) from public,anon;
grant execute on function public.expenses_role(),public.expenses_can_read(public.expenses_entries) to authenticated;

-- Private originals; no authenticated object policies. All reads/writes go through authorised server routes.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('expenses-receipts','expenses-receipts',false,15728640,array['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf']);

-- Finalisation is a dedicated server-only command, preserving the verified user's identity in the audit.
create function public.expenses_finish_upload(attachment uuid, actor_id uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.expenses_attachments; e public.expenses_entries;
begin
 if not exists(select 1 from public.expenses_config where enabled) then raise exception 'EXPENSES_NOT_ACTIVATED'; end if;
 select * into a from public.expenses_attachments where id=attachment;
 select * into e from public.expenses_entries where id=a.expense_id for update;
 select * into a from public.expenses_attachments where id=attachment for update;
 if a.id is null or a.state<>'pending' or e.status not in ('draft','needs_information','rejected') or exists(select 1 from public.driver_accounts where auth_user_id=actor_id and active) or not exists(select 1 from public.account_access where user_id=actor_id and status='active' and role in ('admin','super_admin','office_staff') and (user_id=e.created_by or role in ('admin','super_admin'))) then raise exception 'UPLOAD_NOT_ALLOWED'; end if;
 if not exists(select 1 from storage.objects where bucket_id='expenses-receipts' and name=e.id::text||'/'||a.id::text) then raise exception 'OBJECT_MISSING'; end if;
 update public.expenses_attachments set state='ready' where id=a.id;
 insert into public.expenses_audit(expense_id,actor,action,old_value,new_value) values(e.id,actor_id,'attachment_ready',to_jsonb(a),to_jsonb(a)||'{"state":"ready"}'::jsonb);
end;
$$;
revoke all on function public.expenses_finish_upload(uuid,uuid) from public,anon,authenticated;
grant execute on function public.expenses_finish_upload(uuid,uuid) to service_role;
grant select on public.expenses_entries,public.expenses_attachments to service_role;
commit;
