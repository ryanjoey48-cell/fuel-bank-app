-- V12.1 shared office audit for Forth device speed-alert configuration reviews.
-- Owner-reported catalogue remains in application code (lib/forth-speed-config.ts).
-- These tables store office review state and append-only audit only.
-- They never write settings back to Forth trackers.

begin;

do $migration$
begin
  if to_regprocedure('public.is_office_account()') is null
    or to_regprocedure('public.is_account_active()') is null
    or to_regprocedure('public.current_account_role()') is null then
    raise exception 'Expected office account helper functions before Forth speed-config audit migration.';
  end if;
end;
$migration$;

create table if not exists public.forth_speed_config_reviews (
  registration_key text primary key
    check (length(btrim(registration_key)) > 0),
  registration_display text not null check (length(btrim(registration_display)) > 0),
  review_status text not null
    check (review_status in ('office_confirmed', 'conflict', 'cleared')),
  note text not null default '' check (char_length(note) <= 500),
  -- Snapshot of the owner-reported catalogue values at review time (not independently verified).
  owner_speed_alert_kmh integer not null check (owner_speed_alert_kmh > 0 and owner_speed_alert_kmh <= 200),
  owner_alert_delay_seconds integer not null check (owner_alert_delay_seconds >= 0 and owner_alert_delay_seconds <= 3600),
  -- Remains false until a verified Forth/device API confirmation exists.
  independently_verified boolean not null default false,
  source text not null default 'owner_forth_console'
    check (source in ('owner_forth_console', 'office_review')),
  reviewed_by_user_id uuid not null references auth.users(id) on delete restrict,
  reviewed_by_name text not null check (length(btrim(reviewed_by_name)) > 0),
  reviewed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.forth_speed_config_reviews is
  'Current office review state for owner-reported Forth speed-alert settings. Does not configure Forth devices.';

create table if not exists public.forth_speed_config_audit (
  id uuid primary key default gen_random_uuid(),
  registration_key text not null check (length(btrim(registration_key)) > 0),
  registration_display text not null check (length(btrim(registration_display)) > 0),
  action text not null
    check (action in ('office_confirmed', 'conflict', 'cleared', 'note_update')),
  previous_value jsonb,
  new_value jsonb not null,
  source text not null
    check (source in ('owner_forth_console', 'office_review')),
  reason text not null default '' check (char_length(reason) <= 500),
  reviewer_user_id uuid not null references auth.users(id) on delete restrict,
  reviewer_name text not null check (length(btrim(reviewer_name)) > 0),
  created_at timestamptz not null default now()
);

comment on table public.forth_speed_config_audit is
  'Append-only audit of EES office reviews of Forth speed-alert configuration. Not Forth acknowledgement.';

create index if not exists forth_speed_config_audit_registration_idx
  on public.forth_speed_config_audit (registration_key, created_at desc);

create index if not exists forth_speed_config_audit_reviewer_idx
  on public.forth_speed_config_audit (reviewer_user_id, created_at desc);

alter table public.forth_speed_config_reviews enable row level security;
alter table public.forth_speed_config_audit enable row level security;

-- Active office accounts may read shared review state (including read_only).
drop policy if exists forth_speed_config_reviews_office_select on public.forth_speed_config_reviews;
create policy forth_speed_config_reviews_office_select
on public.forth_speed_config_reviews
for select to authenticated
using (
  public.is_office_account()
  and public.is_account_active()
  and public.current_account_role() in ('admin', 'office_staff', 'read_only')
);

-- Only admin and office_staff may approve/modify configuration reviews.
drop policy if exists forth_speed_config_reviews_office_insert on public.forth_speed_config_reviews;
create policy forth_speed_config_reviews_office_insert
on public.forth_speed_config_reviews
for insert to authenticated
with check (
  public.is_office_account()
  and public.is_account_active()
  and public.current_account_role() in ('admin', 'office_staff')
  and reviewed_by_user_id = auth.uid()
);

drop policy if exists forth_speed_config_reviews_office_update on public.forth_speed_config_reviews;
create policy forth_speed_config_reviews_office_update
on public.forth_speed_config_reviews
for update to authenticated
using (
  public.is_office_account()
  and public.is_account_active()
  and public.current_account_role() in ('admin', 'office_staff')
)
with check (
  public.is_office_account()
  and public.is_account_active()
  and public.current_account_role() in ('admin', 'office_staff')
  and reviewed_by_user_id = auth.uid()
);

drop policy if exists forth_speed_config_reviews_office_delete on public.forth_speed_config_reviews;
create policy forth_speed_config_reviews_office_delete
on public.forth_speed_config_reviews
for delete to authenticated
using (
  public.is_office_account()
  and public.is_account_active()
  and public.current_account_role() in ('admin', 'office_staff')
);

drop policy if exists forth_speed_config_audit_office_select on public.forth_speed_config_audit;
create policy forth_speed_config_audit_office_select
on public.forth_speed_config_audit
for select to authenticated
using (
  public.is_office_account()
  and public.is_account_active()
  and public.current_account_role() in ('admin', 'office_staff', 'read_only')
);

drop policy if exists forth_speed_config_audit_office_insert on public.forth_speed_config_audit;
create policy forth_speed_config_audit_office_insert
on public.forth_speed_config_audit
for insert to authenticated
with check (
  public.is_office_account()
  and public.is_account_active()
  and public.current_account_role() in ('admin', 'office_staff')
  and reviewer_user_id = auth.uid()
);

-- Audit is append-only for authenticated clients.
revoke update, delete on public.forth_speed_config_audit from authenticated;
grant select, insert on public.forth_speed_config_reviews to authenticated;
grant update, delete on public.forth_speed_config_reviews to authenticated;
grant select, insert on public.forth_speed_config_audit to authenticated;

commit;
