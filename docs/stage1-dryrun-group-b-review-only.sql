-- REVIEW ONLY. NOT EXECUTED. Combined rolled-back DRY RUN for Stage 1 group B (oil_change_baselines, oil_change_history, vehicle_safety_inspections, vehicle_safety_inspection_items, vehicle_safety_issues, trip_journeys). Target: hafoaurzfgkkwpvzedvd (production) only after the owner approves the dry run.
-- It applies the group's policies INSIDE one transaction, simulates callers (admin, office_staff, read_only, unregistered, anon), then ABORTS by raising an exception
-- that carries the report. Nothing can be committed. The read_only simulation temporarily changes one office_staff row's role INSIDE the transaction (undone by the abort).
-- Read the result in the error text: "FAILS=0" means every check passed. Any FAIL: do not proceed to the real run.
begin;
set local lock_timeout = '5s';
select set_config('ees.harness_target', 'PRODUCTION-APPROVED', true);

do $precheck$
declare writers integer; blocked integer;
begin
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef and p.proname in ('is_office_account', 'current_account_role', 'is_account_active', 'is_account_admin')) <> 4 then
    raise exception 'role helper functions missing or not SECURITY DEFINER: stop';
  end if;
  if not has_function_privilege('authenticated', 'public.is_office_account()', 'EXECUTE') or not has_function_privilege('authenticated', 'public.current_account_role()', 'EXECUTE') then
    raise exception 'authenticated cannot execute the role helpers: every policy would fail: stop';
  end if;
  -- Lock-out simulation: who can still WRITE after this change? (active admin or office_staff who is not an active driver account)
  select count(*) into writers from public.account_access a where a.status = 'active' and a.role in ('admin', 'office_staff')
    and not exists (select 1 from public.driver_accounts d where d.auth_user_id = a.user_id and d.active = true);
  if writers < 1 then raise exception 'no administrator or office_staff would keep write access: stop'; end if;
  if not exists (select 1 from public.account_access a where a.status = 'active' and a.role = 'admin' and not exists (select 1 from public.driver_accounts d where d.auth_user_id = a.user_id and d.active = true)) then
    raise exception 'no administrator would remain an office account (an active driver account excludes them): stop';
  end if;
  -- Anyone with office access AND an active driver account would silently lose access: list the count, require it to be understood.
  select count(*) into blocked from public.account_access a where a.status = 'active' and exists (select 1 from public.driver_accounts d where d.auth_user_id = a.user_id and d.active = true);
  if blocked > 0 then raise exception '% office account(s) also have an active driver account and would lose access: resolve first', blocked; end if;
end
$precheck$;

drop policy if exists oil_change_baselines_delete_authenticated on public.oil_change_baselines;
drop policy if exists oil_change_baselines_insert_authenticated on public.oil_change_baselines;
drop policy if exists oil_change_baselines_select_authenticated on public.oil_change_baselines;
drop policy if exists oil_change_baselines_update_authenticated on public.oil_change_baselines;
drop policy if exists oil_change_history_delete_authenticated on public.oil_change_history;
drop policy if exists oil_change_history_insert_authenticated on public.oil_change_history;
drop policy if exists oil_change_history_select_authenticated on public.oil_change_history;
drop policy if exists oil_change_history_update_authenticated on public.oil_change_history;

-- ===== GROUP B: maintenance, safety and trips =====

-- oil_change_baselines
create policy oil_change_baselines_office_select on public.oil_change_baselines for select to authenticated using ((select public.is_office_account()));
create policy oil_change_baselines_office_insert on public.oil_change_baselines for insert to authenticated with check ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff'));
create policy oil_change_baselines_office_update on public.oil_change_baselines for update to authenticated using ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff')) with check ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff'));
create policy oil_change_baselines_office_delete on public.oil_change_baselines for delete to authenticated using ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff'));
alter table public.oil_change_baselines enable row level security;
revoke truncate, references, trigger, maintain on table public.oil_change_baselines from authenticated;

-- oil_change_history
create policy oil_change_history_office_select on public.oil_change_history for select to authenticated using ((select public.is_office_account()));
create policy oil_change_history_office_insert on public.oil_change_history for insert to authenticated with check ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff'));
create policy oil_change_history_office_update on public.oil_change_history for update to authenticated using ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff')) with check ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff'));
create policy oil_change_history_office_delete on public.oil_change_history for delete to authenticated using ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff'));
alter table public.oil_change_history enable row level security;
revoke truncate, references, trigger, maintain on table public.oil_change_history from authenticated;

-- vehicle_safety_inspections
create policy vehicle_safety_inspections_office_select on public.vehicle_safety_inspections for select to authenticated using ((select public.is_office_account()));
create policy vehicle_safety_inspections_office_insert on public.vehicle_safety_inspections for insert to authenticated with check ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff'));
create policy vehicle_safety_inspections_office_update on public.vehicle_safety_inspections for update to authenticated using ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff')) with check ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff'));
create policy vehicle_safety_inspections_office_delete on public.vehicle_safety_inspections for delete to authenticated using ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff'));
alter table public.vehicle_safety_inspections enable row level security;
revoke truncate, references, trigger, maintain on table public.vehicle_safety_inspections from authenticated;

-- vehicle_safety_inspection_items
create policy vehicle_safety_inspection_items_office_select on public.vehicle_safety_inspection_items for select to authenticated using ((select public.is_office_account()));
create policy vehicle_safety_inspection_items_office_insert on public.vehicle_safety_inspection_items for insert to authenticated with check ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff'));
create policy vehicle_safety_inspection_items_office_update on public.vehicle_safety_inspection_items for update to authenticated using ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff')) with check ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff'));
create policy vehicle_safety_inspection_items_office_delete on public.vehicle_safety_inspection_items for delete to authenticated using ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff'));
alter table public.vehicle_safety_inspection_items enable row level security;
revoke truncate, references, trigger, maintain on table public.vehicle_safety_inspection_items from authenticated;

-- vehicle_safety_issues
create policy vehicle_safety_issues_office_select on public.vehicle_safety_issues for select to authenticated using ((select public.is_office_account()));
create policy vehicle_safety_issues_office_insert on public.vehicle_safety_issues for insert to authenticated with check ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff'));
create policy vehicle_safety_issues_office_update on public.vehicle_safety_issues for update to authenticated using ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff')) with check ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff'));
create policy vehicle_safety_issues_office_delete on public.vehicle_safety_issues for delete to authenticated using ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff'));
alter table public.vehicle_safety_issues enable row level security;
revoke truncate, references, trigger, maintain on table public.vehicle_safety_issues from authenticated;

-- trip_journeys
create policy trip_journeys_office_select on public.trip_journeys for select to authenticated using ((select public.is_office_account()));
create policy trip_journeys_office_insert on public.trip_journeys for insert to authenticated with check ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff'));
create policy trip_journeys_office_update on public.trip_journeys for update to authenticated using ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff')) with check ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff'));
create policy trip_journeys_office_delete on public.trip_journeys for delete to authenticated using ((select public.is_office_account()) and (select public.current_account_role()) in ('admin', 'office_staff'));
alter table public.trip_journeys enable row level security;
revoke truncate, references, trigger, maintain on table public.trip_journeys from authenticated;

do $dryrun$
declare
  tables text[] := array['oil_change_baselines', 'oil_change_history', 'vehicle_safety_inspections', 'vehicle_safety_inspection_items', 'vehicle_safety_issues', 'trip_journeys'];
  t text; n bigint; base bigint; aff bigint; col text; ok boolean;
  admin_id uuid; staff_id uuid; stranger uuid := gen_random_uuid(); who record; report text := ''; fails integer := 0;
  baseline jsonb := '{}'::jsonb;
begin
  if coalesce(current_setting('ees.harness_target', true), '') <> 'PRODUCTION-APPROVED' then raise exception 'target not declared'; end if;
  select user_id into admin_id from public.account_access where status = 'active' and role = 'admin' limit 1;
  select user_id into staff_id from public.account_access where status = 'active' and role = 'office_staff' limit 1;

  -- structure and baseline counts (as the executing owner role)
  foreach t in array tables loop
    select c.relrowsecurity into ok from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public' and c.relname = t;
    report := report || format('%s rls_on=%s; ', t, ok); if not ok then fails := fails + 1; end if;
    select count(*) into n from pg_policies where schemaname = 'public' and tablename = t and policyname like t || '_office_%';
    if n <> 4 then fails := fails + 1; report := report || format('FAIL %s policies=%s; ', t, n); end if;
    select count(*) into n from pg_policies where schemaname = 'public' and tablename = t and (qual = 'true' or with_check = 'true' or 'anon' = any(roles) or 'public' = any(roles));
    if n <> 0 then fails := fails + 1; report := report || format('FAIL %s open_policy; ', t); end if;
    execute format('select count(*) from public.%I', t) into base;
    baseline := baseline || jsonb_build_object(t, base);
  end loop;

  -- callers: admin and office_staff must see every row and be able to write one; unregistered and anon must see nothing
  for who in select * from (values ('admin', admin_id, 'authenticated'), ('office_staff', staff_id, 'authenticated'), ('unregistered', stranger, 'authenticated'), ('anon', null::uuid, 'anon')) v(label, uid, rolename) loop
    continue when who.uid is null and who.label <> 'anon';
    perform set_config('request.jwt.claims', case when who.uid is null then '{"role":"anon"}' else json_build_object('sub', who.uid, 'role', 'authenticated')::text end, true);
    execute format('set local role %I', who.rolename);
    foreach t in array tables loop
      begin
        execute format('select count(*) from public.%I', t) into n;
        base := (baseline ->> t)::bigint;
        if who.label in ('admin', 'office_staff') then
          if n <> base then fails := fails + 1; report := report || format('FAIL %s read %s saw %s of %s; ', t, who.label, n, base); end if;
        elsif n <> 0 then fails := fails + 1; report := report || format('FAIL %s read %s saw %s rows; ', t, who.label, n);
        end if;
        if who.label in ('admin', 'office_staff') and base > 0 then
          select a.attname into col from pg_attribute a where a.attrelid = ('public.' || t)::regclass and a.attnum > 0 and not a.attisdropped and a.attgenerated = '' and a.attidentity = '' order by a.attnum limit 1;
          execute format('update public.%I set %I = %I where ctid = (select ctid from public.%I limit 1)', t, col, col, t);
          get diagnostics aff = row_count;
          if aff <> 1 then fails := fails + 1; report := report || format('FAIL %s write %s affected %s; ', t, who.label, aff); end if;
        elsif who.label = 'unregistered' and base > 0 then
          select a.attname into col from pg_attribute a where a.attrelid = ('public.' || t)::regclass and a.attnum > 0 and not a.attisdropped and a.attgenerated = '' and a.attidentity = '' order by a.attnum limit 1;
          execute format('update public.%I set %I = %I where ctid = (select ctid from public.%I limit 1)', t, col, col, t);
          get diagnostics aff = row_count;
          if aff <> 0 then fails := fails + 1; report := report || format('FAIL %s write unregistered affected %s; ', t, aff); end if;
        end if;
      exception when insufficient_privilege then
        if who.label in ('admin', 'office_staff') then fails := fails + 1; report := report || format('FAIL %s %s refused; ', t, who.label); end if;
      when others then
        report := report || format('NOTE %s %s inconclusive (%s); ', t, who.label, sqlstate);
      end;
    end loop;
    reset role;
  end loop;

  -- read_only simulation: demote one office_staff row inside this transaction (undone by the abort), then check reads work and writes are refused
  begin
    update public.account_access set role = 'read_only' where user_id = staff_id;
    perform set_config('request.jwt.claims', json_build_object('sub', staff_id, 'role', 'authenticated')::text, true);
    set local role authenticated;
    foreach t in array tables loop
      begin
        execute format('select count(*) from public.%I', t) into n;
        if n <> (baseline ->> t)::bigint then fails := fails + 1; report := report || format('FAIL %s read read_only saw %s; ', t, n); end if;
        if (baseline ->> t)::bigint > 0 then
          select a.attname into col from pg_attribute a where a.attrelid = ('public.' || t)::regclass and a.attnum > 0 and not a.attisdropped and a.attgenerated = '' and a.attidentity = '' order by a.attnum limit 1;
          execute format('update public.%I set %I = %I where ctid = (select ctid from public.%I limit 1)', t, col, col, t);
          get diagnostics aff = row_count;
          if aff <> 0 then fails := fails + 1; report := report || format('FAIL %s write read_only affected %s; ', t, aff); end if;
        end if;
      exception when insufficient_privilege then null;
      when others then report := report || format('NOTE %s read_only inconclusive (%s); ', t, sqlstate);
      end;
    end loop;
    reset role;
  exception when others then
    reset role;
    report := report || format('NOTE read_only simulation inconclusive (%s); ', sqlstate);
  end;

  -- always abort: the exception message is the report and nothing is committed
  raise exception 'DRYRUN GROUP B REPORT: FAILS=% ; tables=% ; % ', fails, tables, report;
end
$dryrun$;
rollback;
