-- EES Vehicle Safety replacement progress: NON-DESTRUCTIVE ADDITION
-- SECURITY: The RPC below requires a JWT app_metadata role of admin or office_staff.
-- Verify your actual office JWT roles before applying: if they differ, update the check;
-- DO NOT replace it with an unrestricted authenticated-user write policy.
create table if not exists public.vehicle_safety_replacement_tracking (
 issue_id text primary key,
 stage text not null default 'reported' check (stage in ('reported','arranging','supplied','verified')),
 assigned_to text,
 note text,
 updated_at timestamptz not null default now(),
 updated_by uuid
);
create table if not exists public.vehicle_safety_replacement_events (
 id bigint generated always as identity primary key,
 issue_id text not null,
 stage text not null check (stage in ('reported','arranging','supplied','verified')),
 assigned_to text,
 note text,
 created_at timestamptz not null default now(),
 created_by uuid
);
create index if not exists vs_replacement_events_issue_idx on public.vehicle_safety_replacement_events(issue_id,created_at desc);
alter table public.vehicle_safety_replacement_tracking enable row level security;
alter table public.vehicle_safety_replacement_events enable row level security;
-- READ: only office JWT roles can see replacement notes. Confirm JWT roles before applying.
create policy "Safety tracking read" on public.vehicle_safety_replacement_tracking for select to authenticated using (coalesce(auth.jwt()->'app_metadata'->>'role','') in ('admin','office_staff'));
create policy "Safety tracking history read" on public.vehicle_safety_replacement_events for select to authenticated using (coalesce(auth.jwt()->'app_metadata'->>'role','') in ('admin','office_staff'));
-- No client INSERT, UPDATE or DELETE policies: changes only through the guarded RPC.
create or replace function public.save_vehicle_safety_replacement(
 p_issue_id text, p_stage text, p_assigned_to text, p_note text
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
 if auth.uid() is null or coalesce(auth.jwt()->'app_metadata'->>'role','') not in ('admin','office_staff') then
  raise exception 'Office access required';
 end if;
 if p_stage not in ('reported','arranging','supplied','verified') then
  raise exception 'Invalid stage';
 end if;
 if not exists (select 1 from public.vehicle_safety_issues where id::text = p_issue_id) then
  raise exception 'Safety issue not found';
 end if;
 insert into public.vehicle_safety_replacement_tracking(issue_id,stage,assigned_to,note,updated_at,updated_by)
 values(p_issue_id,p_stage,left(p_assigned_to,120),p_note,now(),auth.uid())
 on conflict(issue_id) do update set stage=excluded.stage,assigned_to=excluded.assigned_to,note=excluded.note,updated_at=now(),updated_by=auth.uid();
 insert into public.vehicle_safety_replacement_events(issue_id,stage,assigned_to,note,created_by)
 values(p_issue_id,p_stage,left(p_assigned_to,120),p_note,auth.uid());
end $$;
revoke all on function public.save_vehicle_safety_replacement(text,text,text,text) from public;
grant execute on function public.save_vehicle_safety_replacement(text,text,text,text) to authenticated;
