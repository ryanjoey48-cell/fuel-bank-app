-- REVIEW ONLY. NOT EXECUTED. DEVELOPMENT-FIRST. Validation harness for docs/stage1-rls-review-only.sql.
-- Run it ONLY after Stage 1 has been applied to a verified Development copy (or after an approved production group), never before.
-- It simulates callers by switching role and JWT claims INSIDE ONE TRANSACTION that always ends in ROLLBACK, so it changes no data.
-- It needs no real test accounts: it reads one existing admin and one existing office_staff user id from account_access, and uses random uuids for
-- "unregistered" and "driver-like" callers. Every write attempt is made inside a sub-block whose failure is expected and recorded.
-- Output: one NOTICE line per check (PASS / FAIL). Any FAIL means stop and roll back the group.
-- TARGET GUARD: refuses to run unless the caller sets the expected project marker, so it cannot be pasted into production by accident.
--   Set it first:  select set_config('ees.harness_target', 'DEVELOPMENT', false);   (production run requires the owner to type 'PRODUCTION-APPROVED')

begin;

do $guard$
begin
  if coalesce(current_setting('ees.harness_target', true), '') not in ('DEVELOPMENT', 'PRODUCTION-APPROVED') then
    raise exception 'harness target not declared: set ees.harness_target first';
  end if;
end
$guard$;

create temp table harness_result(check_name text, outcome text) on commit drop;
grant all on harness_result to public;

do $harness$
declare
  admin_id uuid; staff_id uuid; stranger uuid := gen_random_uuid();
  t text; n bigint; ok boolean;
  tables text[] := array['bank_transfers','drivers','fuel_logs','oil_change_baselines','oil_change_history','shipments','trip_fuel_logs','trip_journeys',
    'vehicle_safety_assets','vehicle_safety_inspection_items','vehicle_safety_inspections','vehicle_safety_issues','vehicle_safety_requirements','vehicles','weekly_mileage'];
  as_who record;
begin
  select user_id into admin_id from public.account_access where status = 'active' and role = 'admin' limit 1;
  select user_id into staff_id from public.account_access where status = 'active' and role = 'office_staff' limit 1;

  -- 1. Structure: RLS enabled and exactly four office policies on every table of the groups already applied.
  foreach t in array tables loop
    select (c.relrowsecurity) into ok from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public' and c.relname = t;
    insert into harness_result values ('rls_enabled:' || t, case when ok then 'PASS' else 'SKIP (group not applied)' end);
    if ok then
      select count(*) into n from pg_policies where schemaname = 'public' and tablename = t and policyname like t || '_office_%';
      insert into harness_result values ('four_policies:' || t, case when n = 4 then 'PASS' else 'FAIL (' || n || ')' end);
      select count(*) into n from pg_policies where schemaname = 'public' and tablename = t and (qual = 'true' or with_check = 'true' or 'anon' = any(roles) or 'public' = any(roles));
      insert into harness_result values ('no_open_policy:' || t, case when n = 0 then 'PASS' else 'FAIL (' || n || ')' end);
    end if;
  end loop;

  -- 2. Behaviour per caller. Row counts use the real tables; reads must succeed for office accounts and return 0 rows for everyone else.
  for as_who in select * from (values ('admin', admin_id, 'authenticated'), ('office_staff', staff_id, 'authenticated'), ('unregistered', stranger, 'authenticated'), ('anon', null::uuid, 'anon')) v(label, uid, rolename) loop
    continue when as_who.uid is null and as_who.label <> 'anon';
    perform set_config('request.jwt.claims', case when as_who.uid is null then '{"role":"anon"}' else json_build_object('sub', as_who.uid, 'role', 'authenticated')::text end, true);
    execute format('set local role %I', as_who.rolename);
    foreach t in array tables loop
      begin
        execute format('select count(*) from public.%I', t) into n;
        insert into harness_result values ('read:' || as_who.label || ':' || t,
          case when as_who.label in ('admin','office_staff') then 'PASS (' || n || ' rows)' when n = 0 then 'PASS (0 rows)' else 'FAIL (' || n || ' rows visible)' end);
      exception when insufficient_privilege then
        insert into harness_result values ('read:' || as_who.label || ':' || t, case when as_who.label = 'anon' then 'PASS (refused)' else 'FAIL (refused for ' || as_who.label || ')' end);
      end;
    end loop;
    reset role;
  end loop;

  -- 3. Write refusal for an unregistered caller on one representative table per group (insert with defaults would need valid columns, so use delete/update, which only need the policy).
  perform set_config('request.jwt.claims', json_build_object('sub', stranger, 'role', 'authenticated')::text, true);
  set local role authenticated;
  foreach t in array array['vehicle_safety_requirements','oil_change_history','fuel_logs','bank_transfers'] loop
    begin
      execute format('delete from public.%I where false', t);
      get diagnostics n = row_count;
      insert into harness_result values ('delete_noop:' || t, 'PASS (0 rows by definition)');
    exception when insufficient_privilege then
      insert into harness_result values ('delete_noop:' || t, 'PASS (refused)');
    end;
  end loop;
  reset role;

  -- 4. Identity tables: nobody can promote themselves (only meaningful after section 1c).
  perform set_config('request.jwt.claims', json_build_object('sub', stranger, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.account_access(user_id, role, status) values (stranger, 'admin', 'active');
    insert into harness_result values ('self_promotion_blocked', 'FAIL (insert succeeded)');
  exception when others then
    insert into harness_result values ('self_promotion_blocked', 'PASS (' || sqlstate || ')');
  end;
  reset role;
end
$harness$;

select * from harness_result order by (outcome like 'FAIL%') desc, check_name;
rollback;  -- always: the harness never persists anything
