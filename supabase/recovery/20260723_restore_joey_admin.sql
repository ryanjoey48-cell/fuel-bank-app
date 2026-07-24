-- Emergency recovery: restore Joey Ryan as the active administrator.
-- Run manually in Supabase SQL Editor only. This updates exactly one account.

begin;

do $$
declare
  target_user_id uuid;
  active_admin_count integer;
begin
  if to_regclass('public.account_access') is null then
    raise exception 'Recovery cannot continue: public.account_access does not exist. Apply the reviewed admin user management migration first.';
  end if;

  select users.id
  into target_user_id
  from auth.users users
  where lower(users.email) = 'joeryan09@outlook.com'
  order by users.created_at
  limit 1;

  if target_user_id is null then
    raise exception 'Recovery cannot continue: no auth.users account exists for joeryan09@outlook.com.';
  end if;

  insert into public.account_access (
    user_id,
    display_name,
    role,
    status,
    last_access_changed_at
  )
  values (
    target_user_id,
    'Joey Ryan',
    'admin',
    'active',
    now()
  )
  on conflict (user_id) do update
  set
    display_name = coalesce(nullif(public.account_access.display_name, ''), 'Joey Ryan'),
    role = 'admin',
    status = 'active',
    last_access_changed_at = now();

  select count(*)
  into active_admin_count
  from public.account_access
  where role = 'admin'
    and status = 'active';

  if active_admin_count < 1 then
    raise exception 'Recovery failed: no active administrator remains.';
  end if;
end;
$$;

commit;

select
  users.id as user_id,
  users.email,
  access.display_name,
  access.role,
  access.status,
  access.last_access_changed_at,
  (
    select count(*)
    from public.account_access admin_access
    where admin_access.role = 'admin'
      and admin_access.status = 'active'
  ) as active_admin_count
from auth.users users
join public.account_access access on access.user_id = users.id
where lower(users.email) = 'joeryan09@outlook.com';
