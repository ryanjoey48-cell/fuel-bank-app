-- REVIEW ONLY — NOT AN ACTIVE MIGRATION.
-- Do not execute in Supabase or move into supabase/migrations without approval.
--
-- Additive storage for staff-confirmed destination and truck-entrance pins.
-- This draft does not modify existing destination rows or existing RLS policies.
-- It adds one BEFORE DELETE trigger on ees_locations to safely attribute cascades.
-- Apply only as the Supabase postgres/database-owner session after review.
-- This design uses CREATEROLE and narrowly scoped SET ROLE access, not SUPERUSER.

begin;

do $preflight$
declare
  v_locations_rls boolean;
  v_pins_exists boolean := to_regclass('public.ees_location_map_pins') is not null;
  v_history_exists boolean := to_regclass('public.ees_location_map_pin_history') is not null;
  v_locations_id_type oid;
  v_executor_can_create_roles boolean;
  v_auditor_oid oid;
begin
  if current_user <> session_user then
    raise exception 'Run the migration directly as the SQL Editor role so its CREATEROLE and role-membership grants are unambiguous.';
  end if;

  select coalesce(rolsuper or rolcreaterole, false)
  into v_executor_can_create_roles
  from pg_roles where rolname = current_user;
  if not has_database_privilege(current_user, current_database(), 'CREATE') then
    raise exception 'The migration executor needs CREATE on the current database to add the private audit schema.';
  end if;

  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise exception 'The migration executor needs CREATE on schema public for the additive Locations tables and triggers.';
  end if;
  if not has_schema_privilege(current_user, 'public', 'USAGE') then
    raise exception 'The migration executor needs USAGE on schema public to reference Locations objects.';
  end if;
  if to_regnamespace('auth') is null
     or not has_schema_privilege(current_user, to_regnamespace('auth'), 'USAGE') then
    raise exception 'The migration executor needs USAGE on the auth schema to install authenticated RLS policies.';
  end if;

  if to_regclass('public.ees_locations') is null then
    raise exception 'Expected public.ees_locations to exist; the transaction has made no map-pin changes.';
  end if;

  if not exists (
    select 1 from pg_class
    where oid = 'public.ees_locations'::regclass
      and relowner = (select oid from pg_roles where rolname = current_user)
  ) then
    raise exception 'The migration executor must own public.ees_locations to install the narrowly scoped delete-audit trigger.';
  end if;

  if not has_table_privilege(current_user, 'public.ees_locations', 'REFERENCES') then
    raise exception 'The migration executor needs REFERENCES on public.ees_locations for the map-pin foreign key.';
  end if;

  select attribute.atttypid into v_locations_id_type
  from pg_attribute attribute
  where attribute.attrelid = 'public.ees_locations'::regclass
    and attribute.attname = 'id'
    and not attribute.attisdropped;
  if v_locations_id_type is distinct from 'uuid'::regtype then
    raise exception 'Expected public.ees_locations.id to be UUID; the transaction has made no map-pin changes.';
  end if;

  if not exists (
       select 1 from pg_proc procedure
       join pg_namespace namespace on namespace.oid = procedure.pronamespace
       where namespace.nspname = 'auth' and procedure.proname = 'uid'
         and procedure.pronargs = 0 and procedure.prorettype = 'uuid'::regtype
         and has_function_privilege(current_user, procedure.oid, 'EXECUTE')
         and has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
     )
     or to_regprocedure('public.is_office_account()') is null
     or to_regprocedure('public.is_account_active()') is null
     or to_regprocedure('public.current_account_role()') is null then
    raise exception 'Expected auth.uid() and the EES office, active-account and role functions; the transaction has made no map-pin changes.';
  end if;

  if to_regclass('public.account_access') is null
     or to_regclass('public.driver_accounts') is null then
    raise exception 'Expected public.account_access and public.driver_accounts for trusted service-role actor validation; the transaction has made no map-pin changes.';
  end if;

  if not exists (
    select 1 from pg_attribute
    where attrelid = 'public.account_access'::regclass
      and attname in ('user_id', 'role', 'status')
      and not attisdropped
    group by attrelid
    having count(distinct attname) = 3
  ) or not exists (
    select 1 from pg_attribute
    where attrelid = 'public.driver_accounts'::regclass
      and attname in ('auth_user_id', 'active')
      and not attisdropped
    group by attrelid
    having count(distinct attname) = 2
  ) then
    raise exception 'Expected account_access(user_id, role, status) and driver_accounts(auth_user_id, active) columns; no map-pin changes were made.';
  end if;

  if not exists (select 1 from pg_roles where rolname = 'authenticated')
     or not exists (select 1 from pg_roles where rolname = 'anon')
     or not exists (select 1 from pg_roles where rolname = 'service_role') then
    raise exception 'Expected Supabase anon, authenticated and service_role roles; the transaction has made no map-pin changes.';
  end if;

  if not has_schema_privilege('authenticated', 'public', 'USAGE')
     or not has_schema_privilege('service_role', 'public', 'USAGE') then
    raise exception 'authenticated and service_role need USAGE on public for the Locations API and RLS policies.';
  end if;
  if not has_schema_privilege('authenticated', 'auth', 'USAGE')
     or not has_function_privilege('authenticated', to_regprocedure('auth.uid()'), 'EXECUTE')
     or not has_function_privilege('authenticated', to_regprocedure('public.is_office_account()'), 'EXECUTE')
     or not has_function_privilege('authenticated', to_regprocedure('public.is_account_active()'), 'EXECUTE')
     or not has_function_privilege('authenticated', to_regprocedure('public.current_account_role()'), 'EXECUTE') then
    raise exception 'authenticated needs auth/public schema access and the EES policy helpers; no map-pin changes were made.';
  end if;

  if not has_table_privilege('service_role', 'public.account_access', 'select')
     or not has_table_privilege('service_role', 'public.driver_accounts', 'select')
     or not has_table_privilege('service_role', 'public.ees_locations', 'delete') then
    raise exception 'service_role must be able to read EES access tables and delete ees_locations for the validated API cascade function.';
  end if;

  select relation.relrowsecurity into v_locations_rls
  from pg_class relation
  join pg_namespace namespace on namespace.oid = relation.relnamespace
  where namespace.nspname = 'public' and relation.relname = 'ees_locations';
  if coalesce(v_locations_rls, false) is false then
    raise exception 'RLS must be enabled on public.ees_locations before coordinate storage is added.';
  end if;

  if v_pins_exists <> v_history_exists then
    raise exception 'Only one map-pin table exists. Review and reconcile the partial installation manually; this transaction has made no changes.';
  end if;

  if to_regnamespace('ees_locations_internal') is not null and not exists (
    select 1
    from pg_namespace schema
    where schema.nspname = 'ees_locations_internal'
      and schema.nspowner = (select oid from pg_roles where rolname = current_user)
      and obj_description(schema.oid, 'pg_namespace') =
        'EES Locations private trigger-function schema v1.'
  ) then
    raise exception 'The reserved ees_locations_internal schema exists with an unexpected owner or marker; review it before continuing.';
  end if;

  if v_pins_exists then
    if obj_description('public.ees_location_map_pins'::regclass, 'pg_class')
         is distinct from 'EES Locations map-pins schema v3: immutable confirmation identity, actor enforcement, restricted append-only audit.'
       or obj_description('public.ees_location_map_pin_history'::regclass, 'pg_class')
         is distinct from 'EES Locations map-pin history schema v3: INSERT-only trigger audit with row-level security.' then
      raise exception 'Map-pin tables already exist without the current v3 schema marker. Review an explicit upgrade before proceeding; no tables or location rows were changed.';
    end if;
  end if;

  if v_pins_exists and exists (
    select 1 from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname in ('ees_location_map_pins', 'ees_location_map_pin_history')
      and (not relation.relrowsecurity or relation.relforcerowsecurity)
  ) then
    raise exception 'Existing map-pin tables must have RLS enabled and FORCE ROW LEVEL SECURITY disabled for the restricted audit trigger owner; no changes were made.';
  end if;

  if v_pins_exists and exists (
    select 1 from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname in ('ees_location_map_pins', 'ees_location_map_pin_history')
      and relation.relowner <> (select oid from pg_roles where rolname = current_user)
  ) then
    raise exception 'Existing map-pin tables must be owned by the migration executor to safely repeat the additive migration.';
  end if;

  select oid into v_auditor_oid
  from pg_roles where rolname = 'ees_locations_map_pin_auditor';

  if v_auditor_oid is null and not coalesce(v_executor_can_create_roles, false) then
    raise exception 'The migration executor needs CREATEROLE to create the restricted audit role; SUPERUSER is not required.';
  end if;

  if v_auditor_oid is not null then
    if exists (
      select 1 from pg_roles role
      where role.oid = v_auditor_oid
        and (role.rolcanlogin or role.rolsuper or role.rolcreatedb or role.rolcreaterole
             or role.rolreplication or role.rolbypassrls or role.rolinherit)
    ) then
      raise exception 'The reserved audit role has login or elevated attributes; reconcile it before applying this transaction.';
    end if;

    if exists (
      select 1 from pg_auth_members membership
      where membership.roleid = v_auditor_oid
        and membership.member <> (select oid from pg_roles where rolname = current_user)
    ) or exists (
      select 1 from pg_auth_members membership
      where membership.member = v_auditor_oid
    ) then
      raise exception 'The reserved audit role has memberships other than the migration executor; reconcile it before applying this transaction.';
    end if;

    if not exists (
      select 1 from pg_auth_members membership
      where membership.roleid = v_auditor_oid
        and membership.member = (select oid from pg_roles where rolname = current_user)
        and membership.admin_option
    ) then
      raise exception 'The existing audit role is not administrable by this CREATEROLE session; reconcile it before applying this transaction.';
    end if;

    if to_regprocedure('ees_locations_internal.audit_ees_location_map_pin()') is not null
       and not exists (
         select 1 from pg_proc procedure
         where procedure.oid = to_regprocedure('ees_locations_internal.audit_ees_location_map_pin()')
           and procedure.proowner = v_auditor_oid
       ) then
      raise exception 'The existing audit trigger function is not owned by the restricted auditor role; review its ownership before applying this transaction.';
    end if;

    if exists (
      select 1 from pg_shdepend dependency
      where dependency.refclassid = 'pg_authid'::regclass
        and dependency.refobjid = v_auditor_oid
        and dependency.deptype = 'o'
        and not (
          dependency.classid = 'pg_proc'::regclass
          and dependency.objid = coalesce(
            to_regprocedure('ees_locations_internal.audit_ees_location_map_pin()')::oid,
            0::oid
          )
        )
    ) then
      raise exception 'The reserved audit role owns unexpected database objects; reconcile it before applying this transaction.';
    end if;
  end if;

  if (case when v_auditor_oid is null then true
           else not has_schema_privilege('ees_locations_map_pin_auditor', 'public', 'USAGE') end)
     and not (
       has_schema_privilege(current_user, 'public', 'USAGE WITH GRANT OPTION')
       or exists (
         select 1 from pg_namespace namespace
         cross join lateral aclexplode(coalesce(namespace.nspacl, acldefault('n', namespace.nspowner))) acl
         where namespace.nspname = 'public'
           and acl.grantee = 0
           and acl.privilege_type = 'USAGE'
       )
     ) then
    raise exception 'The restricted auditor needs USAGE on public to append audit rows, and the executor cannot grant it; no map-pin changes were made.';
  end if;
end;
$preflight$;

create table if not exists public.ees_location_map_pins (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.ees_locations(id) on delete cascade,
  pin_type text not null check (pin_type in ('destination', 'truck_entrance')),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  pin_status text not null default 'manual_confirmed' check (pin_status = 'manual_confirmed'),
  coordinate_source text not null check (length(btrim(coordinate_source)) between 1 and 500),
  source_reference text check (source_reference is null or length(source_reference) <= 2048),
  created_by uuid not null,
  created_at timestamptz not null,
  confirmed_by uuid not null,
  confirmed_at timestamptz not null,
  updated_by uuid not null,
  updated_at timestamptz not null,
  constraint ees_location_map_pins_location_type_key unique (location_id, pin_type)
);

create table if not exists public.ees_location_map_pin_history (
  id uuid primary key default gen_random_uuid(),
  pin_id uuid not null,
  location_id uuid not null,
  pin_type text not null check (pin_type in ('destination', 'truck_entrance')),
  action text not null check (action in ('insert', 'update', 'delete')),
  old_latitude double precision,
  old_longitude double precision,
  old_pin_status text,
  old_coordinate_source text,
  old_source_reference text,
  new_latitude double precision,
  new_longitude double precision,
  new_pin_status text,
  new_coordinate_source text,
  new_source_reference text,
  original_created_by uuid not null,
  original_created_at timestamptz not null,
  original_confirmed_by uuid not null,
  original_confirmed_at timestamptz not null,
  changed_by uuid,
  changed_by_context text not null check (changed_by_context in ('authenticated_user', 'trusted_service_role', 'privileged_database_action')),
  changed_at timestamptz not null,
  constraint ees_location_map_pin_history_snapshot_check check (
    (
      action = 'insert'
      and old_latitude is null and old_longitude is null and old_pin_status is null
      and old_coordinate_source is null and old_source_reference is null
      and new_latitude is not null and new_longitude is not null and new_pin_status is not null
      and new_coordinate_source is not null
    ) or (
      action = 'update'
      and old_latitude is not null and old_longitude is not null and old_pin_status is not null
      and old_coordinate_source is not null
      and new_latitude is not null and new_longitude is not null and new_pin_status is not null
      and new_coordinate_source is not null
    ) or (
      action = 'delete'
      and old_latitude is not null and old_longitude is not null and old_pin_status is not null
      and old_coordinate_source is not null
      and new_latitude is null and new_longitude is null and new_pin_status is null
      and new_coordinate_source is null and new_source_reference is null
    )
  ),
  constraint ees_location_map_pin_history_actor_check check (
    (action = 'delete' and (
      (changed_by is null and changed_by_context = 'privileged_database_action')
      or (changed_by is not null and changed_by_context in ('authenticated_user', 'trusted_service_role'))
    )) or (
      action in ('insert', 'update') and changed_by is not null
      and changed_by_context in ('authenticated_user', 'trusted_service_role')
    )
  )
);

-- The trigger function lives outside Supabase's public API schema. The schema
-- is owned by the migration executor; only the non-login audit role receives
-- CREATE/USAGE, and no application role receives schema access.
create schema if not exists ees_locations_internal;
comment on schema ees_locations_internal is
  'EES Locations private trigger-function schema v1.';
revoke all on schema ees_locations_internal from public, anon, authenticated, service_role;

comment on table public.ees_location_map_pins is
  'EES Locations map-pins schema v3: immutable confirmation identity, actor enforcement, restricted append-only audit.';
comment on table public.ees_location_map_pin_history is
  'EES Locations map-pin history schema v3: INSERT-only trigger audit with row-level security.';

create index if not exists ees_location_map_pins_location_idx
  on public.ees_location_map_pins (location_id, pin_type);
create index if not exists ees_location_map_pins_updated_idx
  on public.ees_location_map_pins (updated_at desc);
create index if not exists ees_location_map_pin_history_location_idx
  on public.ees_location_map_pin_history (location_id, changed_at desc);

alter table public.ees_location_map_pins enable row level security;
alter table public.ees_location_map_pin_history enable row level security;

do $policy_guard$
begin
  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename in ('ees_location_map_pins', 'ees_location_map_pin_history')
      and policyname not in (
        'ees_location_map_pins_office_read',
        'ees_location_map_pins_office_insert',
        'ees_location_map_pins_office_update',
        'ees_location_map_pin_history_office_read',
        'ees_location_map_pin_history_auditor_insert'
      )
  ) then
    raise exception 'Unexpected map-pin RLS policy found; review policy interactions before applying this transaction.';
  end if;
end;
$policy_guard$;

drop policy if exists ees_location_map_pins_office_read on public.ees_location_map_pins;
create policy ees_location_map_pins_office_read on public.ees_location_map_pins
  for select to authenticated
  using (
    public.is_office_account()
    and public.is_account_active()
    and public.current_account_role() in ('admin', 'office_staff', 'read_only')
  );

drop policy if exists ees_location_map_pins_office_insert on public.ees_location_map_pins;
create policy ees_location_map_pins_office_insert on public.ees_location_map_pins
  for insert to authenticated
  with check (
    public.is_office_account()
    and public.is_account_active()
    and public.current_account_role() in ('admin', 'office_staff')
    and created_by = auth.uid()
    and confirmed_by = auth.uid()
    and updated_by = auth.uid()
  );

drop policy if exists ees_location_map_pins_office_update on public.ees_location_map_pins;
create policy ees_location_map_pins_office_update on public.ees_location_map_pins
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
    and updated_by = auth.uid()
  );

drop policy if exists ees_location_map_pin_history_office_read on public.ees_location_map_pin_history;
create policy ees_location_map_pin_history_office_read on public.ees_location_map_pin_history
  for select to authenticated
  using (
    public.is_office_account()
    and public.is_account_active()
    and public.current_account_role() in ('admin', 'office_staff', 'read_only')
  );

create or replace function public.prepare_ees_location_map_pin_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor uuid;
  v_actor_role text;
  v_now timestamptz := pg_catalog.statement_timestamp();
begin
  if current_user = 'authenticated' then
    v_actor := auth.uid();
    if v_actor is null
       or not public.is_office_account()
       or not public.is_account_active()
       or coalesce(public.current_account_role(), '') not in ('admin', 'office_staff') then
      raise exception 'EES_MAP_PIN_FORBIDDEN' using errcode = '42501';
    end if;
  elsif current_user = 'service_role' then
    -- The application uses its service credential only after verifying the EES
    -- session. Validate its supplied actor against the same active office roles.
    v_actor := new.updated_by;
    select access.role into v_actor_role
    from public.account_access as access
    where access.user_id = v_actor and access.status = 'active';
    if v_actor is null
       or coalesce(v_actor_role, '') not in ('admin', 'office_staff')
       or exists (
         select 1 from public.driver_accounts as driver_account
         where driver_account.auth_user_id = v_actor and driver_account.active = true
       ) then
      raise exception 'EES_MAP_PIN_FORBIDDEN' using errcode = '42501';
    end if;
  else
    raise exception 'EES_MAP_PIN_FORBIDDEN' using errcode = '42501';
  end if;

  -- The INSERT/UPDATE audit trigger consumes only actor context stamped here,
  -- after the database has validated the authenticated or service-role actor.
  perform pg_catalog.set_config('ees.map_pin_audit_actor', v_actor::text, true);
  perform pg_catalog.set_config(
    'ees.map_pin_audit_context',
    case when current_user = 'authenticated' then 'authenticated_user' else 'trusted_service_role' end,
    true
  );

  if tg_op = 'INSERT' then
    -- Never accept caller-supplied identity or timestamps on creation.
    new.id := pg_catalog.gen_random_uuid();
    new.created_by := v_actor;
    new.created_at := v_now;
    new.confirmed_by := v_actor;
    new.confirmed_at := v_now;
    new.updated_by := v_actor;
    new.updated_at := v_now;
    return new;
  end if;

  if new.id is distinct from old.id
     or new.location_id is distinct from old.location_id
     or new.pin_type is distinct from old.pin_type
     or new.created_at is distinct from old.created_at then
    raise exception 'EES_MAP_PIN_IDENTITY_IMMUTABLE' using errcode = '23514';
  end if;

  -- Confirmation and creator identity are immutable. Ignore attempted direct
  -- rewrites while allowing another authorized office editor to correct a pin.
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.confirmed_by := old.confirmed_by;
  new.confirmed_at := old.confirmed_at;
  new.updated_by := v_actor;
  new.updated_at := v_now;
  return new;
end;
$$;

create or replace function public.prepare_ees_location_delete_audit_context()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor uuid;
  v_actor_role text;
  v_context text;
begin
  if current_user = 'authenticated' then
    v_actor := auth.uid();
    if v_actor is null
       or not public.is_office_account()
       or not public.is_account_active()
       or coalesce(public.current_account_role(), '') not in ('admin', 'office_staff') then
      raise exception 'EES_LOCATION_DELETE_FORBIDDEN' using errcode = '42501';
    end if;
    v_context := 'authenticated_user';
  elsif current_user = 'service_role' then
    -- The API RPC sets this actor only after verifying the EES session. Repeat
    -- validation here so a direct service-role delete cannot forge the audit.
    v_actor := nullif(pg_catalog.current_setting('ees.map_pin_audit_actor', true), '')::uuid;
    select access.role into v_actor_role
    from public.account_access as access
    where access.user_id = v_actor and access.status = 'active';
    if v_actor is null
       or coalesce(v_actor_role, '') not in ('admin', 'office_staff')
       or exists (
         select 1 from public.driver_accounts as driver_account
         where driver_account.auth_user_id = v_actor and driver_account.active = true
       ) then
      raise exception 'EES_LOCATION_DELETE_FORBIDDEN' using errcode = '42501';
    end if;
    v_context := 'trusted_service_role';
  else
    -- Direct SQL by a database administrator is retained as unattributed
    -- privileged activity; it is not mislabeled as an employee action.
    v_actor := null;
    v_context := 'privileged_database_action';
  end if;

  perform pg_catalog.set_config('ees.map_pin_audit_actor', coalesce(v_actor::text, ''), true);
  perform pg_catalog.set_config('ees.map_pin_audit_context', v_context, true);
  return old;
end;
$$;

-- CREATEROLE is sufficient: the creator receives ADMIN OPTION on a role it
-- creates and can grant itself SET ROLE access. The role owns only the trigger
-- function; it gets INSERT, not table ownership or UPDATE/DELETE, on history.
do $audit_role$
declare
  v_server_version integer := current_setting('server_version_num')::integer;
begin
  if not exists (select 1 from pg_roles where rolname = 'ees_locations_map_pin_auditor') then
    create role ees_locations_map_pin_auditor
      nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
  end if;

  if v_server_version >= 160000 then
    execute format(
      'grant ees_locations_map_pin_auditor to %I with set true, inherit false',
      current_user
    );
  else
    execute format('grant ees_locations_map_pin_auditor to %I', current_user);
  end if;

  if not has_schema_privilege('ees_locations_map_pin_auditor', 'public', 'USAGE') then
    if not has_schema_privilege(current_user, 'public', 'USAGE WITH GRANT OPTION') then
      raise exception 'The audit role needs USAGE on public to insert history, and the executor cannot grant it.';
    end if;
    grant usage on schema public to ees_locations_map_pin_auditor;
  end if;
end;
$audit_role$;

grant usage, create on schema ees_locations_internal to ees_locations_map_pin_auditor;

drop policy if exists ees_location_map_pin_history_auditor_insert
  on public.ees_location_map_pin_history;
create policy ees_location_map_pin_history_auditor_insert
  on public.ees_location_map_pin_history
  for insert to ees_locations_map_pin_auditor
  with check (true);

-- The definer role can append through RLS but has no direct correction or
-- deletion privilege on this table. API roles retain read-only history access.
revoke all on table public.ees_location_map_pin_history
  from public, anon, authenticated, service_role, ees_locations_map_pin_auditor;
grant insert on table public.ees_location_map_pin_history
  to ees_locations_map_pin_auditor;
grant select on table public.ees_location_map_pin_history to authenticated;

set local role ees_locations_map_pin_auditor;
create or replace function ees_locations_internal.audit_ees_location_map_pin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changed_by uuid := nullif(pg_catalog.current_setting('ees.map_pin_audit_actor', true), '')::uuid;
  v_changed_by_context text := nullif(pg_catalog.current_setting('ees.map_pin_audit_context', true), '');
begin
  if tg_op = 'INSERT' then
    if v_changed_by is null or v_changed_by is distinct from new.updated_by
       or v_changed_by_context is null
       or v_changed_by_context not in ('authenticated_user', 'trusted_service_role') then
      raise exception 'EES_MAP_PIN_AUDIT_CONTEXT_INVALID' using errcode = '42501';
    end if;
    insert into public.ees_location_map_pin_history (
      pin_id, location_id, pin_type, action,
      new_latitude, new_longitude, new_pin_status, new_coordinate_source, new_source_reference,
      original_created_by, original_created_at, original_confirmed_by, original_confirmed_at,
      changed_by, changed_by_context, changed_at
    ) values (
      new.id, new.location_id, new.pin_type, 'insert',
      new.latitude, new.longitude, new.pin_status, new.coordinate_source, new.source_reference,
      new.created_by, new.created_at, new.confirmed_by, new.confirmed_at,
      v_changed_by, v_changed_by_context, pg_catalog.clock_timestamp()
    );
    return new;
  elsif tg_op = 'UPDATE' then
    if row(new.latitude, new.longitude, new.pin_status, new.coordinate_source, new.source_reference)
       is distinct from
       row(old.latitude, old.longitude, old.pin_status, old.coordinate_source, old.source_reference) then
       if v_changed_by is null or v_changed_by is distinct from new.updated_by
          or v_changed_by_context is null
          or v_changed_by_context not in ('authenticated_user', 'trusted_service_role') then
        raise exception 'EES_MAP_PIN_AUDIT_CONTEXT_INVALID' using errcode = '42501';
      end if;
      insert into public.ees_location_map_pin_history (
        pin_id, location_id, pin_type, action,
        old_latitude, old_longitude, old_pin_status, old_coordinate_source, old_source_reference,
        new_latitude, new_longitude, new_pin_status, new_coordinate_source, new_source_reference,
        original_created_by, original_created_at, original_confirmed_by, original_confirmed_at,
        changed_by, changed_by_context, changed_at
      ) values (
        new.id, new.location_id, new.pin_type, 'update',
        old.latitude, old.longitude, old.pin_status, old.coordinate_source, old.source_reference,
        new.latitude, new.longitude, new.pin_status, new.coordinate_source, new.source_reference,
        new.created_by, new.created_at, new.confirmed_by, new.confirmed_at,
        v_changed_by, v_changed_by_context, pg_catalog.clock_timestamp()
      );
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    if v_changed_by_context is null or v_changed_by_context not in (
         'authenticated_user', 'trusted_service_role', 'privileged_database_action'
       )
       or (v_changed_by_context = 'privileged_database_action' and v_changed_by is not null)
       or (v_changed_by_context <> 'privileged_database_action' and v_changed_by is null) then
      raise exception 'EES_MAP_PIN_AUDIT_CONTEXT_INVALID' using errcode = '42501';
    end if;
    insert into public.ees_location_map_pin_history (
      pin_id, location_id, pin_type, action,
      old_latitude, old_longitude, old_pin_status, old_coordinate_source, old_source_reference,
      original_created_by, original_created_at, original_confirmed_by, original_confirmed_at,
      changed_by, changed_by_context, changed_at
    ) values (
      old.id, old.location_id, old.pin_type, 'delete',
      old.latitude, old.longitude, old.pin_status, old.coordinate_source, old.source_reference,
      old.created_by, old.created_at, old.confirmed_by, old.confirmed_at,
      v_changed_by, v_changed_by_context, pg_catalog.clock_timestamp()
    );
    return old;
  end if;

  raise exception 'Unexpected EES map-pin trigger operation: %', tg_op;
end;
$$;
revoke all on function ees_locations_internal.audit_ees_location_map_pin()
  from public, anon, authenticated, service_role;
grant execute on function ees_locations_internal.audit_ees_location_map_pin()
  to session_user;
reset role;

revoke all on function public.prepare_ees_location_map_pin_write()
  from public, anon, authenticated, service_role;
revoke all on function public.prepare_ees_location_delete_audit_context()
  from public, anon, authenticated, service_role;

-- The Locations DELETE API uses service_role after verifying the EES user.
-- Carry that verified actor into an FK cascade in the same transaction so the
-- pin audit row records who initiated the delete. This is SECURITY INVOKER:
-- callers still need the service_role table privileges, and direct callers
-- cannot execute it as authenticated/anon. It changes only the requested
-- location row and its normal FK cascades.
create or replace function public.delete_ees_location_with_map_pin_audit_actor(
  p_location_id uuid,
  p_actor_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor_role text;
begin
  if current_user <> 'service_role' then
    raise exception 'EES_LOCATION_DELETE_FORBIDDEN' using errcode = '42501';
  end if;

  select access.role into v_actor_role
  from public.account_access as access
  where access.user_id = p_actor_id
    and access.status = 'active';

  if p_actor_id is null
     or coalesce(v_actor_role, '') not in ('admin', 'office_staff')
     or exists (
       select 1 from public.driver_accounts as driver_account
       where driver_account.auth_user_id = p_actor_id and driver_account.active = true
     ) then
    raise exception 'EES_LOCATION_DELETE_FORBIDDEN' using errcode = '42501';
  end if;

  perform pg_catalog.set_config('ees.map_pin_audit_actor', p_actor_id::text, true);
  delete from public.ees_locations where id = p_location_id;
end;
$$;

revoke all on function public.delete_ees_location_with_map_pin_audit_actor(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.delete_ees_location_with_map_pin_audit_actor(uuid, uuid)
  to service_role;

drop trigger if exists ees_location_map_pin_write_guard on public.ees_location_map_pins;
create trigger ees_location_map_pin_write_guard
  before insert or update on public.ees_location_map_pins
  for each row execute function public.prepare_ees_location_map_pin_write();

drop trigger if exists ees_location_map_pin_audit on public.ees_location_map_pins;
create trigger ees_location_map_pin_audit
  after insert or update or delete on public.ees_location_map_pins
  for each row execute function ees_locations_internal.audit_ees_location_map_pin();

drop trigger if exists ees_locations_map_pin_delete_context on public.ees_locations;
create trigger ees_locations_map_pin_delete_context
  before delete on public.ees_locations
  for each row execute function public.prepare_ees_location_delete_audit_context();

revoke all on table public.ees_location_map_pins from public, anon, authenticated, service_role;
grant select, insert, update on table public.ees_location_map_pins to authenticated, service_role;

commit;

-- The API still verifies the EES session, resolves account access and requires
-- business:write. The database triggers re-check office authorization and stamp
-- authenticated identity/timestamps so direct authenticated SQL cannot forge
-- them. The service_role branch is limited to validated active office actors.
-- The existing location DELETE API must call the actor-aware RPC above for a
-- service-role cascade to retain the verified human actor in pin history.
-- No existing destination rows, unrelated EES tables, or existing RLS policies are
-- changed by this review draft. It adds only the map-pin cascade-context trigger
-- to public.ees_locations among the existing EES tables.
-- Public OSM tiles are best-effort; do not bulk-download or prefetch tiles.
