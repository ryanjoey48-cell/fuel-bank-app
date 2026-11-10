-- REVIEW ONLY. Do not apply without explicit approval of the isolated test target.
-- Requires V1 + V1.1 and the existing Booking Diary office RLS. Never enables config.
begin;

create or replace function public.expenses_register(q jsonb) returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare expr text; direction text; size integer; page_number integer; result jsonb;
begin
 if public.expenses_role() is null then raise exception 'EXPENSES_FORBIDDEN' using errcode='42501'; end if;
 if jsonb_typeof(q)<>'object' or length(q::text)>4000 then raise exception 'INVALID_FILTER'; end if;
 if coalesce(q->>'from','')<>'' then perform (q->>'from')::date; end if;
 if coalesce(q->>'to','')<>'' then perform (q->>'to')::date; end if;
 if coalesce(q->>'from','')<>'' and coalesce(q->>'to','')<>'' and q->>'from'>q->>'to' then raise exception 'INVALID_FILTER_DATE'; end if;
 if coalesce(q->>'status','') not in ('','draft','submitted','needs_information','approved','rejected','closed','voided') or coalesce(q->>'payment','') not in ('','unpaid','partially_paid','paid') then raise exception 'INVALID_FILTER'; end if;
 if exists(select 1 from jsonb_each_text(q) x where x.key in ('q','supplier','employee') and length(x.value)>200) then raise exception 'INVALID_FILTER'; end if;
 size:=coalesce((q->>'pageSize')::integer,20);page_number:=coalesce((q->>'page')::integer,1);
 if size not in (10,20,50) or page_number<1 or page_number>100000 then raise exception 'INVALID_PAGE'; end if;
 direction:=q#>>'{sort,direction}';if direction not in ('asc','desc') or direction is null then raise exception 'INVALID_SORT'; end if;
 expr:=case q#>>'{sort,key}' when 'date' then 'data->>''date''' when 'description' then 'data->>''description''' when 'category' then case when q->>'th'='true' then 'data->>''category_th''' else 'data->>''category_en''' end when 'allocation' then case when q->>'th'='true' then 'coalesce(nullif(data->>''vehicle_reg'',''''),data->>''centre_th'')' else 'coalesce(nullif(data->>''vehicle_reg'',''''),data->>''centre_en'')' end when 'supplier' then 'data->>''supplier''' when 'amount' then '(data->>''amount_satang'')::bigint' when 'receipt' then 'receipt_count' when 'approval' then 'status' when 'payment' then 'data->>''payment_status''' when 'employee' then 'data->>''submitted_by''' end;
 if expr is null then raise exception 'INVALID_SORT'; end if;
 if q#>>'{sort,key}' not in ('amount','receipt') then expr:='coalesce('||expr||','''') collate "C"'; end if;
 execute format($sql$
 with filtered as materialized (
   select e.*, (select count(*) from public.expenses_attachments a where a.expense_id=e.id and a.state='ready') receipt_count,
   (data->>'amount_satang')::bigint amount,
   coalesce((data->>'paid_satang')::bigint,case when data->>'payment_status'='paid' then (data->>'amount_satang')::bigint else coalesce((nullif(data->>'paid_amount',''))::numeric*100,0)::bigint end) paid,
   status in ('submitted','needs_information','approved','closed') and data->>'source'='standalone' and data->>'cost_treatment'<>'customer_charge' included
   from public.expenses_entries e
   where (coalesce($1->>'from','')='' or data->>'date'>=$1->>'from') and (coalesce($1->>'to','')='' or data->>'date'<=$1->>'to')
   and (coalesce($1->>'vehicle','')='' or data->>'allocation'='vehicle' and data->>'vehicle_id'=$1->>'vehicle')
   and (coalesce($1->>'category','')='' or data->>'category_id'=$1->>'category')
   and (coalesce($1->>'centre','')='' or data->>'allocation'='centre' and data->>'cost_centre_id'=$1->>'centre')
   and (coalesce($1->>'status','')='' or status=$1->>'status')
   and (coalesce($1->>'payment','')='' or data->>'payment_status'=$1->>'payment')
   and (coalesce($1->>'supplier','')='' or strpos(lower(normalize(coalesce(data->>'supplier',''),NFKC)),lower(normalize($1->>'supplier',NFKC)))>0)
   and (coalesce($1->>'employee','')='' or strpos(lower(normalize(coalesce(data->>'submitted_by',''),NFKC)),lower(normalize($1->>'employee',NFKC)))>0)
   and (coalesce($1->>'q','')='' or strpos(lower(normalize(concat_ws(' ',id::text,data->>'description',data->>'vehicle_reg',data->>'document_number',data->>'supplier'),NFKC)),lower(normalize($1->>'q',NFKC)))>0)
 ), paging as (select least($3,greatest(1,ceil(count(*)::numeric/$2)::integer)) page from filtered),
 page_rows as materialized (select * from filtered order by %s %s,id asc limit $2 offset ((select page from paging)-1)*$2),
 category_totals as (select case when $1->>'th'='true' then data->>'category_th' else data->>'category_en' end label,sum(amount) value from filtered where included group by 1),
 vehicle_totals as (select data->>'vehicle_reg' label,sum(amount) value from filtered where included and data->>'allocation'='vehicle' and coalesce(data->>'vehicle_reg','')<>'' group by 1),
 month_totals as (select left(data->>'date',7) label,sum(amount) value from filtered where included group by 1)
 select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(p)-'receipt_count'-'amount'-'paid'-'included' order by %s %s,id asc) from page_rows p),'[]'::jsonb),
 'recent',coalesce((select jsonb_agg(to_jsonb(r)-'receipt_count'-'amount'-'paid'-'included' order by updated_at desc,id asc) from (select * from filtered order by updated_at desc,id asc limit 5) r),'[]'::jsonb),
 'attachments',coalesce((select jsonb_agg(to_jsonb(a)) from public.expenses_attachments a where a.expense_id in (select id from page_rows)),'[]'::jsonb),
 'totalCount',(select count(*) from filtered),'page',(select page from paging),'pageSize',$2,
 'summary',(select jsonb_build_object('recorded',coalesce(sum(amount) filter(where included),0),'approved',coalesce(sum(amount) filter(where included and status in ('approved','closed')),0),'provisional',coalesce(sum(amount) filter(where included and status in ('submitted','needs_information')),0),'paidApproved',coalesce(sum(paid) filter(where included and status in ('approved','closed')),0),'unpaidApproved',coalesce(sum(greatest(0,amount-paid)) filter(where included and status in ('approved','closed')),0),'unpaidApprovedCount',count(*) filter(where included and status in ('approved','closed') and amount>paid),'vehicle',coalesce(sum(amount) filter(where included and data->>'allocation'='vehicle'),0),'pending',count(*) filter(where status='submitted'),'missing',count(*) filter(where included and receipt_count=0),'submitted',count(*) filter(where included),'paid',coalesce(sum(paid) filter(where included),0),'outstanding',coalesce(sum(greatest(0,amount-paid)) filter(where included),0)) from filtered),
 'categories',coalesce((select jsonb_agg(jsonb_build_array(label,value) order by value desc,label collate "C") from category_totals),'[]'::jsonb),
 'vehicles',coalesce((select jsonb_agg(jsonb_build_array(label,value) order by value desc,label collate "C") from vehicle_totals),'[]'::jsonb),
 'months',coalesce((select jsonb_agg(jsonb_build_array(label,value) order by label) from month_totals),'[]'::jsonb))
 $sql$,expr,direction,expr,direction) into result using q,size,page_number;
 return result;
end; $$;
revoke all on function public.expenses_register(jsonb) from public,anon;
grant execute on function public.expenses_register(jsonb) to authenticated;

-- Independent link table keeps the true diary UUID even after deletion/renaming.
-- No booking FK cascade, no booking writes, no grants on existing booking tables.
create table public.expenses_booking_links (
 expense_id uuid primary key references public.expenses_entries(id),booking_id uuid,
 revision integer not null default 1 check(revision>0),note text not null check(length(trim(note)) between 1 and 2000),
 actor uuid not null default auth.uid(),updated_at timestamptz not null default now()
);
alter table public.expenses_booking_links enable row level security;
grant select,insert,update on public.expenses_booking_links to authenticated;
create policy expenses_booking_read on public.expenses_booking_links for select to authenticated using(exists(select 1 from public.expenses_entries e where e.id=expense_id));
create policy expenses_booking_insert on public.expenses_booking_links for insert to authenticated with check(
 actor=auth.uid() and exists(select 1 from public.expenses_config where enabled and schema_version=3)
 and public.expenses_role() in ('office_staff','admin','super_admin')
 and exists(select 1 from public.expenses_entries e where e.id=expense_id and e.status in ('draft','needs_information','rejected') and (e.created_by=auth.uid() or public.expenses_role() in ('admin','super_admin')))
 and (booking_id is null or exists(select 1 from public.booking_diary b where b.id=expenses_booking_links.booking_id)));
create policy expenses_booking_update on public.expenses_booking_links for update to authenticated using(
 public.expenses_role() in ('office_staff','admin','super_admin') and exists(select 1 from public.expenses_entries e where e.id=expense_id and e.status in ('draft','needs_information','rejected') and (e.created_by=auth.uid() or public.expenses_role() in ('admin','super_admin')))) with check(
 actor=auth.uid() and exists(select 1 from public.expenses_config where enabled and schema_version=3)
 and exists(select 1 from public.expenses_entries e where e.id=expense_id and e.status in ('draft','needs_information','rejected') and (e.created_by=auth.uid() or public.expenses_role() in ('admin','super_admin')))
 and (booking_id is null or exists(select 1 from public.booking_diary b where b.id=expenses_booking_links.booking_id)));

create or replace function public.expenses_evidence_version(target uuid) returns text language sql stable security invoker set search_path=public,pg_temp as $$
 select md5(e.revision::text||coalesce((select string_agg(a.id::text||a.sha256||a.state,',' order by a.id) from public.expenses_attachments a where a.expense_id=e.id),'')) from public.expenses_entries e where e.id=target;
$$;
revoke all on function public.expenses_evidence_version(uuid) from public,anon;
grant execute on function public.expenses_evidence_version(uuid) to authenticated;
create table public.expenses_duplicate_resolutions (
 id uuid primary key default gen_random_uuid(),expense_id uuid not null references public.expenses_entries(id),other_id uuid not null references public.expenses_entries(id),
 version text not null,other_version text not null,note text not null check(length(trim(note)) between 1 and 2000),actor uuid not null default auth.uid(),created_at timestamptz not null default now(),check(expense_id<>other_id)
);
alter table public.expenses_duplicate_resolutions enable row level security;
grant select,insert on public.expenses_duplicate_resolutions to authenticated;
create policy expenses_duplicate_read on public.expenses_duplicate_resolutions for select to authenticated using(exists(select 1 from public.expenses_entries e where e.id=expense_id) and exists(select 1 from public.expenses_entries e where e.id=other_id));
create policy expenses_duplicate_insert on public.expenses_duplicate_resolutions for insert to authenticated with check(
 actor=auth.uid() and public.expenses_role() in ('admin','super_admin') and exists(select 1 from public.expenses_config where enabled and schema_version=3)
 and exists(select 1 from public.expenses_entries e where e.id=expense_id and e.created_by<>auth.uid())
 and exists(select 1 from public.expenses_entries e where e.id=other_id)
 and version=public.expenses_evidence_version(expense_id) and other_version=public.expenses_evidence_version(other_id));

create or replace function public.expenses_v12_evidence_audit() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare entry public.expenses_entries;
begin
 if tg_table_name='expenses_booking_links' then
   select * into entry from public.expenses_entries where id=new.expense_id for update;
   if entry.id is null or entry.status not in ('draft','needs_information','rejected') or not (entry.created_by=auth.uid() or public.expenses_role() in ('admin','super_admin')) then raise exception 'BOOKING_LINK_LOCKED' using errcode='42501'; end if;
   if tg_op='UPDATE' and (new.expense_id<>old.expense_id or new.revision<>old.revision+1) then raise exception 'EXPENSE_CONFLICT'; end if;
   if tg_op='INSERT' and new.revision<>1 then raise exception 'EXPENSE_CONFLICT'; end if;
   new.updated_at:=now();new.actor:=auth.uid();
 end if;
 insert into public.expenses_audit(expense_id,actor,action,note,old_value,new_value) values(new.expense_id,auth.uid(),case when tg_table_name='expenses_booking_links' then 'booking_link' else 'duplicate_review' end,new.note,case when tg_op='UPDATE' then to_jsonb(old) else null end,to_jsonb(new));
 return new;
end; $$;
revoke all on function public.expenses_v12_evidence_audit() from public,anon,authenticated;
create trigger expenses_booking_audit before insert or update on public.expenses_booking_links for each row execute function public.expenses_v12_evidence_audit();
create trigger expenses_duplicate_audit before insert on public.expenses_duplicate_resolutions for each row execute function public.expenses_v12_evidence_audit();

create or replace function public.expenses_duplicate_matches(target uuid) returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
 with current_expense as (select * from public.expenses_entries where id=target and status<>'voided'),
 candidates as (
 select e, array_remove(array[
 case when exists(select 1 from public.expenses_attachments a join public.expenses_attachments b on b.sha256=a.sha256 where a.expense_id=target and b.expense_id=e.id and a.state='ready' and b.state='ready') then 'file' end,
 case when coalesce(c.data->>'document_number','')<>'' and lower(trim(normalize(c.data->>'document_number',NFKC)))=lower(trim(normalize(e.data->>'document_number',NFKC))) then 'receipt' end,
 case when c.data->>'amount_satang'=e.data->>'amount_satang' then 'amount' end,
 case when abs((c.data->>'date')::date-(e.data->>'date')::date)<=3 then 'date' end,
 case when coalesce(c.data->>'supplier','')<>'' and lower(trim(normalize(c.data->>'supplier',NFKC)))=lower(trim(normalize(e.data->>'supplier',NFKC))) then 'supplier' end,
 case when c.data->>'allocation'='vehicle' and e.data->>'allocation'='vehicle' and c.data->>'vehicle_id'=e.data->>'vehicle_id' then 'vehicle' end
 ],null) reasons from public.expenses_entries e cross join current_expense c where e.id<>target and e.status<>'voided'),
 matches as (select *,case when reasons@>array['file'] or reasons@>array['receipt','supplier','amount'] then 'strong' else 'possible' end strength from candidates where reasons@>array['file'] or reasons@>array['amount','date','supplier'] or reasons@>array['amount','date','receipt'] or reasons@>array['amount','date','vehicle'] or reasons@>array['receipt','supplier'])
 select coalesce(jsonb_agg(jsonb_build_object('expense',to_jsonb(e),'reasons',reasons,'strength',strength,'version',public.expenses_evidence_version(target),'other_version',public.expenses_evidence_version((e).id),
 'resolution',(select jsonb_build_object('note',r.note,'actor',r.actor,'created_at',r.created_at) from public.expenses_duplicate_resolutions r where ((r.expense_id=target and r.other_id=(e).id and r.version=public.expenses_evidence_version(target) and r.other_version=public.expenses_evidence_version((e).id)) or (r.other_id=target and r.expense_id=(e).id and r.other_version=public.expenses_evidence_version(target) and r.version=public.expenses_evidence_version((e).id))) order by r.created_at desc,r.id desc limit 1)) order by (e).id),'[]'::jsonb) from matches;
$$;
revoke all on function public.expenses_duplicate_matches(uuid) from public,anon;
grant execute on function public.expenses_duplicate_matches(uuid) to authenticated;
create index expenses_entries_date_id_v12 on public.expenses_entries((data->>'date'),id);
create index expenses_attachments_expense_state_v12 on public.expenses_attachments(expense_id,state);
create index expenses_duplicate_pair_v12 on public.expenses_duplicate_resolutions(expense_id,other_id,created_at desc);
-- Version upgrade only; deliberately preserves enabled=false on an unactivated installation.
update public.expenses_config set schema_version=3;
commit;

