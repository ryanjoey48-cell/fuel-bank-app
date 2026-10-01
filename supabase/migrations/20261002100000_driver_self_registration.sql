begin;

create table if not exists public.driver_access_requests (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  full_name text not null check (char_length(btrim(full_name)) between 2 and 120),
  email text not null,
  phone text not null check (char_length(btrim(phone)) between 7 and 30),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  rejection_reason text
);

do $$
declare
  drivers_id_type text;
begin
  select format_type(a.atttypid, a.atttypmod)
  into drivers_id_type
  from pg_attribute a
  where a.attrelid = 'public.drivers'::regclass
    and a.attname = 'id'
    and not a.attisdropped;

  if drivers_id_type is null then
    raise exception 'public.drivers.id is required before installing driver self-registration';
  end if;

  execute format(
    'alter table public.driver_access_requests add column if not exists linked_driver_id %s references public.drivers(id) on delete restrict',
    drivers_id_type
  );
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.driver_access_requests'::regclass
      and conname = 'driver_access_request_review_shape'
  ) then
    alter table public.driver_access_requests
      add constraint driver_access_request_review_shape check (
        (status = 'pending' and reviewed_at is null and reviewed_by is null and linked_driver_id is null) or
        (status = 'approved' and reviewed_at is not null and reviewed_by is not null and linked_driver_id is not null) or
        (status = 'rejected' and reviewed_at is not null and reviewed_by is not null and linked_driver_id is null)
      );
  end if;
end
$$;

create index if not exists driver_access_requests_status_requested_idx
  on public.driver_access_requests(status, requested_at desc);

alter table public.driver_access_requests enable row level security;
revoke all on public.driver_access_requests from public, anon, authenticated, driver_portal;

create or replace function public.create_default_account_access_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if lower(coalesce(new.raw_user_meta_data->>'registration_type', '')) = 'driver' then
    insert into public.driver_access_requests (auth_user_id, full_name, email, phone)
    values (
      new.id,
      btrim(coalesce(new.raw_user_meta_data->>'full_name', '')),
      lower(btrim(coalesce(new.email, ''))),
      btrim(coalesce(new.raw_user_meta_data->>'phone', ''))
    );
  end if;

  -- Public Auth creation never grants office access. Office access must be
  -- inserted explicitly by an existing authorised administrator.
  return new;
end;
$$;

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  claims jsonb := event->'claims';
  target_user_id uuid := (event->>'user_id')::uuid;
  driver_active boolean;
  request_status text;
  office_active boolean;
begin
  select exists (
    select 1 from public.driver_accounts
    where auth_user_id = target_user_id and active = true
  ) into driver_active;

  select status into request_status
  from public.driver_access_requests
  where auth_user_id = target_user_id;

  select exists (
    select 1 from public.account_access
    where user_id = target_user_id and status = 'active'
  ) into office_active;

  if driver_active or request_status is not null or not office_active then
    claims := jsonb_set(claims, '{role}', to_jsonb('driver_portal'::text));
    claims := jsonb_set(
      claims,
      '{user_role}',
      to_jsonb(case when driver_active then 'driver' else coalesce('driver_request_' || request_status, 'unauthorised') end)
    );
  end if;
  return jsonb_set(event, '{claims}', claims);
end;
$$;

create or replace function public.review_driver_access_request(
  p_request_id uuid,
  p_decision text,
  p_linked_driver_id text,
  p_rejection_reason text,
  p_reviewed_by uuid
)
returns public.driver_access_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.driver_access_requests;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Invalid driver access decision.';
  end if;

  select * into target
  from public.driver_access_requests
  where id = p_request_id and status = 'pending'
  for update;

  if target.id is null then
    raise exception 'Pending driver access request not found.';
  end if;

  if not exists (
    select 1 from public.account_access
    where user_id = p_reviewed_by and role = 'admin' and status = 'active'
  ) then
    raise exception 'Administrator permission required.';
  end if;

  delete from public.account_access where user_id = target.auth_user_id;

  if p_decision = 'approved' then
    if p_linked_driver_id is null or not exists (
      select 1 from public.drivers where id::text = p_linked_driver_id and active = true
    ) then
      raise exception 'An active existing driver must be selected.';
    end if;

    insert into public.driver_accounts (auth_user_id, driver_id, active)
    select target.auth_user_id, id, true
    from public.drivers
    where id::text = p_linked_driver_id and active = true
    on conflict (auth_user_id) do update
      set driver_id = excluded.driver_id, active = true, updated_at = now();

    update public.driver_access_requests
    set status = 'approved', reviewed_at = now(), reviewed_by = p_reviewed_by,
        linked_driver_id = (
          select id from public.drivers where id::text = p_linked_driver_id and active = true
        ), rejection_reason = null
    where id = p_request_id
    returning * into target;
  else
    update public.driver_accounts set active = false where auth_user_id = target.auth_user_id;
    update public.driver_access_requests
    set status = 'rejected', reviewed_at = now(), reviewed_by = p_reviewed_by,
        linked_driver_id = null, rejection_reason = nullif(btrim(p_rejection_reason), '')
    where id = p_request_id
    returning * into target;
  end if;

  return target;
end;
$$;

revoke all on function public.review_driver_access_request(uuid,text,text,text,uuid) from public, anon, authenticated, driver_portal;
grant execute on function public.review_driver_access_request(uuid,text,text,text,uuid) to service_role;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from public, anon, authenticated, driver_portal;

notify pgrst, 'reload schema';
commit;
