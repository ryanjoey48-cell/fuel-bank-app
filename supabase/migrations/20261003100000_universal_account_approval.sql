begin;

alter table public.driver_access_requests
  add column if not exists requested_account_type text;

update public.driver_access_requests
set requested_account_type = 'driver'
where requested_account_type is null;

alter table public.driver_access_requests
  alter column requested_account_type set default 'driver',
  alter column requested_account_type set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.driver_access_requests'::regclass
      and conname = 'driver_access_requests_account_type_check'
  ) then
    alter table public.driver_access_requests
      add constraint driver_access_requests_account_type_check
      check (requested_account_type in ('driver', 'office_staff'));
  end if;
end
$$;

alter table public.driver_access_requests
  drop constraint if exists driver_access_request_review_shape;

alter table public.driver_access_requests
  add constraint driver_access_request_review_shape check (
    (status = 'pending' and reviewed_at is null and reviewed_by is null and linked_driver_id is null) or
    (status = 'approved' and requested_account_type = 'driver' and reviewed_at is not null and reviewed_by is not null and linked_driver_id is not null) or
    (status = 'approved' and requested_account_type = 'office_staff' and reviewed_at is not null and reviewed_by is not null and linked_driver_id is null) or
    (status = 'rejected' and reviewed_at is not null and reviewed_by is not null and linked_driver_id is null)
  );

create or replace function public.create_default_account_access_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_type text := lower(btrim(coalesce(new.raw_user_meta_data->>'registration_type', '')));
begin
  if requested_type in ('driver', 'office_staff') then
    insert into public.driver_access_requests (
      auth_user_id,
      full_name,
      email,
      phone,
      requested_account_type
    )
    values (
      new.id,
      btrim(coalesce(new.raw_user_meta_data->>'full_name', '')),
      lower(btrim(coalesce(new.email, ''))),
      btrim(coalesce(new.raw_user_meta_data->>'phone', '')),
      requested_type
    );
  end if;

  -- Auth creation never grants operational access. Accounts without a valid
  -- request type also remain unauthorised and receive the restricted JWT role.
  return new;
end;
$$;

drop trigger if exists create_default_account_access_for_new_user on auth.users;
create trigger create_default_account_access_for_new_user
after insert on auth.users
for each row
execute function public.create_default_account_access_for_new_user();

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
  request_type text;
  office_active boolean;
  office_role text;
begin
  select exists (
    select 1 from public.driver_accounts
    where auth_user_id = target_user_id and active = true
  ) into driver_active;

  select status, requested_account_type
  into request_status, request_type
  from public.driver_access_requests
  where auth_user_id = target_user_id;

  select role into office_role
  from public.account_access
  where user_id = target_user_id and status = 'active';
  office_active := office_role is not null;

  if driver_active then
    claims := jsonb_set(claims, '{role}', to_jsonb('driver_portal'::text));
    claims := jsonb_set(claims, '{user_role}', to_jsonb('driver'::text));
  elsif request_status in ('pending', 'rejected') or not office_active then
    claims := jsonb_set(claims, '{role}', to_jsonb('driver_portal'::text));
    claims := jsonb_set(
      claims,
      '{user_role}',
      to_jsonb(
        case
          when request_status is not null then request_type || '_request_' || request_status
          else 'unauthorised'
        end
      )
    );
  else
    claims := jsonb_set(claims, '{role}', to_jsonb('authenticated'::text));
    claims := jsonb_set(claims, '{user_role}', to_jsonb(office_role));
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
  sole_approver_id constant uuid := '6b36f383-28e0-48aa-99a0-c1e655d6c3f7'::uuid;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Invalid access decision.';
  end if;

  select * into target
  from public.driver_access_requests
  where id = p_request_id and status = 'pending'
  for update;

  if target.id is null then
    raise exception 'Pending access request not found.';
  end if;

  if p_reviewed_by <> sole_approver_id or not exists (
    select 1 from public.account_access
    where user_id = p_reviewed_by and role = 'admin' and status = 'active'
  ) then
    raise exception 'This account is not authorised to review access requests.';
  end if;

  -- Remove any accidental pre-approval privilege before assigning the reviewed role.
  delete from public.account_access where user_id = target.auth_user_id;
  update public.driver_accounts set active = false where auth_user_id = target.auth_user_id;

  if p_decision = 'approved' and target.requested_account_type = 'driver' then
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
  elsif p_decision = 'approved' and target.requested_account_type = 'office_staff' then
    insert into public.account_access (
      user_id,
      display_name,
      role,
      status,
      last_access_changed_at,
      changed_by
    ) values (
      target.auth_user_id,
      target.full_name,
      'office_staff',
      'active',
      now(),
      p_reviewed_by
    )
    on conflict (user_id) do update
      set display_name = excluded.display_name,
          role = 'office_staff',
          status = 'active',
          last_access_changed_at = now(),
          changed_by = p_reviewed_by;

    update public.driver_access_requests
    set status = 'approved', reviewed_at = now(), reviewed_by = p_reviewed_by,
        linked_driver_id = null, rejection_reason = null
    where id = p_request_id
    returning * into target;
  else
    update public.driver_access_requests
    set status = 'rejected', reviewed_at = now(), reviewed_by = p_reviewed_by,
        linked_driver_id = null, rejection_reason = nullif(btrim(p_rejection_reason), '')
    where id = p_request_id
    returning * into target;
  end if;

  return target;
end;
$$;

revoke all on public.driver_access_requests from public, anon, authenticated, driver_portal;
revoke all on function public.review_driver_access_request(uuid,text,text,text,uuid) from public, anon, authenticated, driver_portal;
grant execute on function public.review_driver_access_request(uuid,text,text,text,uuid) to service_role;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from public, anon, authenticated, driver_portal;

notify pgrst, 'reload schema';
commit;
