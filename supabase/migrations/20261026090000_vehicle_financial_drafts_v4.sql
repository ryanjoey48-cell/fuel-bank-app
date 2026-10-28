-- Vehicle Performance V4 Phase 2 proposal.
-- Additive only: no backfill or data rewrite. Adds a fail-safe write-gate trigger
-- to the legacy finance table; no publication function is installed.
begin;

-- Fail before creating anything when the known EES prerequisites or any V4
-- object name is missing/conflicting. CREATE statements below are deliberately
-- non-idempotent so an incompatible partial install cannot be silently reused.
do $$
declare
  v_name text;
begin
  if to_regclass('public.account_access') is null
     or to_regclass('public.vehicles') is null
     or to_regclass('public.drivers') is null
     or to_regclass('public.vehicle_monthly_performance') is null
     or to_regclass('public.ees_driver_vehicle_assignments') is null
     or to_regclass('public.ees_employee_profiles') is null
     or to_regclass('public.ees_employee_compensation') is null
     or to_regclass('auth.users') is null then
    raise exception 'vehicle_finance_v4_required_dependency_missing';
  end if;

  if to_regrole('anon') is null or to_regrole('authenticated') is null or to_regrole('service_role') is null then
    raise exception 'vehicle_finance_v4_supabase_roles_missing';
  end if;

  if exists (
    select 1 from (values
      ('account_access','user_id','uuid'),
      ('vehicles','id','uuid'), ('vehicles','vehicle_reg','text'), ('vehicles','active','bool'),
      ('drivers','id','int8'), ('drivers','name','text'), ('drivers','active','bool'),
      ('ees_driver_vehicle_assignments','driver_id','int8'), ('ees_driver_vehicle_assignments','vehicle_id','uuid'),
      ('ees_driver_vehicle_assignments','effective_from','date'), ('ees_driver_vehicle_assignments','effective_to','date'),
      ('ees_driver_vehicle_assignments','assignment_kind','text'),
      ('ees_driver_vehicle_assignments','cancelled_at','timestamptz'),
      ('ees_employee_profiles','id','uuid'), ('ees_employee_profiles','driver_id','int8'),
      ('ees_employee_profiles','created_at','timestamptz'), ('ees_employee_profiles','updated_at','timestamptz'),
      ('ees_employee_compensation','id','uuid'), ('ees_employee_compensation','employee_id','uuid'),
      ('ees_employee_compensation','effective_from','date'), ('ees_employee_compensation','amount','numeric'),
      ('ees_employee_compensation','currency','text'), ('ees_employee_compensation','period','text'),
      ('ees_employee_compensation','recorded_at','timestamptz'),
      ('vehicle_monthly_performance','id','uuid')
    ) as expected(table_name,column_name,udt_name)
    where not exists (
      select 1 from information_schema.columns c
      where c.table_schema='public' and c.table_name=expected.table_name
        and c.column_name=expected.column_name and c.udt_name=expected.udt_name
    )
  ) then
    raise exception 'vehicle_finance_v4_schema_prerequisite_mismatch';
  end if;

  if exists (select 1 from information_schema.columns where table_schema='public'
      and table_name='account_access' and column_name in ('role','status')
      and data_type not in ('text','character varying'))
     or (select count(*) from information_schema.columns where table_schema='public'
      and table_name='account_access' and column_name in ('role','status')) <> 2
     or exists (select 1 from information_schema.columns where table_schema='public'
      and table_name in ('vehicles','drivers') and column_name in ('vehicle_reg','name')
      and data_type not in ('text','character varying')) then
    raise exception 'vehicle_finance_v4_text_schema_prerequisite_mismatch';
  end if;

  foreach v_name in array array[
    'vehicle_financial_import_batches','vehicle_financial_draft_entries',
    'vehicle_financial_revision_history','vehicle_financial_review_approvals',
    'vehicle_financial_current_approvals','vehicle_financial_approval_history',
    'vehicle_financial_publications','vehicle_financial_policy_approvals',
    'vehicle_financial_write_control','vehicle_financial_write_control_history'
  ] loop
    if to_regclass(format('public.%I',v_name)) is not null then
      raise exception 'vehicle_finance_v4_object_collision:%',v_name;
    end if;
  end loop;

  if exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind='i' and c.relname = any(array[
        'vehicle_financial_import_batches_month_idx',
        'vehicle_financial_import_batches_month_idempotency_key',
        'vehicle_financial_draft_entries_registration_idx',
        'vehicle_financial_revision_history_batch_idx',
        'vehicle_financial_current_approvals_pkey',
        'vehicle_financial_current_approvals_entry_key',
        'vehicle_financial_approval_history_pkey'
      ])) then
    raise exception 'vehicle_finance_v4_index_name_collision';
  end if;

  if exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname = any(array[
        'guard_vehicle_financial_immutable_rows','guard_vehicle_monthly_performance_v4_cutover',
        'set_vehicle_financial_legacy_write_mode','recover_vehicle_financial_legacy_write_control',
        'guard_vehicle_financial_publication_consistency','create_vehicle_financial_draft',
        'transition_vehicle_financial_draft','approve_vehicle_financial_policy',
        'verify_vehicle_financial_salary_allocations','list_vehicle_financial_draft_drivers'
      ])) then
    raise exception 'vehicle_finance_v4_function_name_collision';
  end if;

  if exists (select 1 from pg_trigger where not tgisinternal
      and tgname='vehicle_monthly_performance_v4_cutover_guard'
      and tgrelid='public.vehicle_monthly_performance'::regclass) then
    raise exception 'vehicle_finance_v4_legacy_trigger_collision';
  end if;
end $$;

create table public.vehicle_financial_import_batches (
  id uuid primary key default gen_random_uuid(),
  reporting_month date not null check (extract(day from reporting_month) = 1),
  version integer not null check (version > 0),
  schema_version integer not null default 4 check (schema_version = 4),
  formula_version text not null default 'vehicle-finance-v4-v1',
  status text not null check (status in ('draft','needs_review','validated','in_review','approved','published')),
  source_file_name text not null,
  source_sha256 text not null check (source_sha256 ~ '^[a-fA-F0-9]{64}$'),
  source_format text not null check (source_format in ('xlsx','csv')),
  source_size_bytes bigint not null check (source_size_bytes >= 0),
  source_sheets jsonb not null default '[]'::jsonb,
  formula_reference text,
  source_totals jsonb not null default '{}'::jsonb,
  source_controls jsonb not null default '[]'::jsonb,
  calculated_totals jsonb not null default '{}'::jsonb,
  validation_issue_codes text[] not null default '{}',
  validation_ready boolean not null default false,
  validation_counts jsonb not null default '{"expected":0,"matched":0,"missing":0,"duplicate":0}'::jsonb,
  expected_vehicle_ids uuid[] not null default '{}',
  validation_snapshot jsonb not null default '{}'::jsonb,
  idempotency_hash text not null check (idempotency_hash ~ '^[a-fA-F0-9]{64}$'),
  content_hash text not null check (content_hash ~ '^[a-fA-F0-9]{64}$'),
  validated_content_hash text,
  historical_correction jsonb,
  salary_verification jsonb,
  uploaded_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  validated_at timestamptz,
  unique (reporting_month, version)
);

create index vehicle_financial_import_batches_month_idx
  on public.vehicle_financial_import_batches (reporting_month, version desc);
-- A byte-identical workbook may be corrected through new row annotations. Exact
-- same content cannot create a duplicate version, including concurrent requests.
create unique index vehicle_financial_import_batches_month_idempotency_key
  on public.vehicle_financial_import_batches (reporting_month, idempotency_hash);

create table public.vehicle_financial_draft_entries (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.vehicle_financial_import_batches(id) on delete restrict,
  -- Snapshot the canonical ID without an operational FK, so finance history neither
  -- cascades nor blocks lifecycle changes in the Vehicles module.
  vehicle_id uuid,
  registration_source text not null,
  registration_snapshot text,
  -- Month-specific identity snapshot; never depend on a driver's current assignment.
  assigned_employee_id text,
  assigned_employee_name_snapshot text,
  assignment_effective_from date,
  assignment_effective_to date,
  source_sheet text not null,
  source_row integer not null check (source_row > 0),
  source_values jsonb not null,
  raw_cells jsonb not null,
  salary numeric(14,2) check (salary is null or salary >= 0),
  jobs_completed integer check (jobs_completed is null or jobs_completed >= 0),
  trip_payments numeric(14,2) check (trip_payments is null or trip_payments >= 0),
  expenses numeric(14,2) check (expenses is null or expenses >= 0),
  parking_fees numeric(14,2) check (parking_fees is null or parking_fees >= 0),
  total_received numeric(14,2) check (total_received is null or total_received >= 0),
  fuel numeric(14,2) check (fuel is null or fuel >= 0),
  lpg numeric(14,2) check (lpg is null or lpg >= 0),
  lpg_treatment text not null check (lpg_treatment in ('included_in_fuel','separate','unknown')),
  maintenance numeric(14,2) check (maintenance is null or maintenance >= 0),
  check (assignment_effective_to is null or assignment_effective_from is null or assignment_effective_to >= assignment_effective_from),
  created_at timestamptz not null default now(),
  unique (batch_id, source_sheet, source_row)
);

-- Keep repeated source rows intact for review. Phase 1 validation blocks duplicate
-- canonical vehicles from review, and publication has its own unique month/vehicle key.
create index vehicle_financial_draft_entries_registration_idx
  on public.vehicle_financial_draft_entries (lower(btrim(registration_source)));

create table public.vehicle_financial_revision_history (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.vehicle_financial_import_batches(id) on delete restrict,
  from_status text,
  to_status text not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  reason text not null,
  content_hash text not null,
  event_details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index vehicle_financial_revision_history_batch_idx
  on public.vehicle_financial_revision_history (batch_id, created_at);

create table public.vehicle_financial_review_approvals (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.vehicle_financial_import_batches(id) on delete restrict,
  content_hash text not null,
  reviewer_id uuid not null references auth.users(id) on delete restrict,
  decision text not null check (decision in ('approved','rejected')),
  reason text not null,
  created_at timestamptz not null default now(),
  unique (batch_id, reviewer_id)
);

-- One current designation per canonical vehicle/month. Prior batch approvals
-- remain immutable evidence when an explicit supersession replaces a designation.
create table public.vehicle_financial_current_approvals (
  reporting_month date not null,
  vehicle_id uuid not null references public.vehicles(id) on delete restrict,
  batch_id uuid not null references public.vehicle_financial_import_batches(id) on delete restrict,
  entry_id uuid not null references public.vehicle_financial_draft_entries(id) on delete restrict,
  approval_id uuid not null references public.vehicle_financial_review_approvals(id) on delete restrict,
  designated_by uuid not null references auth.users(id) on delete restrict,
  designated_at timestamptz not null default now(),
  constraint vehicle_financial_current_approvals_pkey primary key (reporting_month, vehicle_id),
  constraint vehicle_financial_current_approvals_entry_key unique (entry_id)
);
create table public.vehicle_financial_approval_history (
  id uuid constraint vehicle_financial_approval_history_pkey primary key default gen_random_uuid(),
  reporting_month date not null,
  vehicle_id uuid not null,
  previous_batch_id uuid references public.vehicle_financial_import_batches(id) on delete restrict,
  next_batch_id uuid not null references public.vehicle_financial_import_batches(id) on delete restrict,
  approval_id uuid not null references public.vehicle_financial_review_approvals(id) on delete restrict,
  actor_id uuid not null references auth.users(id) on delete restrict,
  action text not null check (action in ('approved','superseded')),
  reason text not null,
  created_at timestamptz not null default now()
);

-- Publication is represented for future uniqueness checks, but this phase exposes
-- no insert RPC and leaves the UI publication control disabled.
create table public.vehicle_financial_publications (
  id uuid primary key default gen_random_uuid(),
  reporting_month date not null check (extract(day from reporting_month) = 1),
  vehicle_id uuid not null references public.vehicles(id) on delete restrict,
  entry_id uuid not null references public.vehicle_financial_draft_entries(id) on delete restrict,
  batch_id uuid not null references public.vehicle_financial_import_batches(id) on delete restrict,
  published_by uuid not null references auth.users(id) on delete restrict,
  published_at timestamptz not null default now(),
  unique (reporting_month, vehicle_id),
  unique (entry_id)
);

-- An approval is an immutable attestation to one fixed, code-reviewed policy
-- digest and a fixed evidence checklist. Hashes are fingerprints, never free text.
create table public.vehicle_financial_policy_approvals (
  policy_version text primary key check (policy_version = 'v4-accounting-draft-3'),
  formula_version text not null check (formula_version = 'vehicle-finance-v4-v1'),
  policy_hash text not null check (policy_hash = '190052557026203b9a6f8aa41090fc2050b374812b9f025c77b2a2b4aa04b17a'),
  owner_decision_sha256 text not null check (owner_decision_sha256 ~ '^[a-fA-F0-9]{64}$'),
  revenue_semantics_sha256 text not null check (revenue_semantics_sha256 ~ '^[a-fA-F0-9]{64}$'),
  expense_boundaries_sha256 text not null check (expense_boundaries_sha256 ~ '^[a-fA-F0-9]{64}$'),
  lpg_boundary_sha256 text not null check (lpg_boundary_sha256 ~ '^[a-fA-F0-9]{64}$'),
  source_reconciliation_sha256 text not null check (source_reconciliation_sha256 ~ '^[a-fA-F0-9]{64}$'),
  schema_compatibility_sha256 text not null check (schema_compatibility_sha256 ~ '^[a-fA-F0-9]{64}$'),
  approved_by uuid not null references auth.users(id) on delete restrict,
  approved_at timestamptz not null default now(),
  unique (policy_version, policy_hash)
);

-- Default preserves the current legacy write path. A future, separately approved
-- cutover changes this row; the trigger below is the database-level enforcement.
create table public.vehicle_financial_write_control (
  control_key text primary key check (control_key = 'vehicle_monthly_performance'),
  mode text not null check (mode in ('legacy_enabled','v4_only')),
  changed_by uuid references auth.users(id) on delete restrict,
  reason text not null,
  changed_at timestamptz not null default now()
);
insert into public.vehicle_financial_write_control(control_key,mode,reason)
values ('vehicle_monthly_performance','legacy_enabled','Additive V4 proposal default; legacy imports remain enabled until owner-approved cutover.')
;
create table public.vehicle_financial_write_control_history (
  id uuid primary key default gen_random_uuid(),
  control_key text not null,
  previous_mode text not null,
  next_mode text not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  reason text not null,
  created_at timestamptz not null default now()
);

create function public.guard_vehicle_financial_immutable_rows()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if tg_table_name = 'vehicle_financial_import_batches' and tg_op = 'UPDATE' then
    if (to_jsonb(new) - array['status','updated_at','validated_at','validated_content_hash']) is distinct from
       (to_jsonb(old) - array['status','updated_at','validated_at','validated_content_hash']) then
      raise exception 'vehicle_finance_batch_content_immutable';
    end if;
    if new.status is distinct from old.status and not (
      (old.status = 'draft' and new.status in ('needs_review','validated')) or
      (old.status = 'validated' and new.status = 'in_review') or
      (old.status = 'in_review' and new.status = 'approved')
    ) then raise exception 'vehicle_finance_invalid_status_transition'; end if;
    return new;
  end if;
  raise exception 'vehicle_finance_history_immutable';
end;
$$;

create trigger vehicle_financial_batch_immutable before update or delete on public.vehicle_financial_import_batches
for each row execute function public.guard_vehicle_financial_immutable_rows();
create trigger vehicle_financial_entries_immutable before update or delete on public.vehicle_financial_draft_entries
for each row execute function public.guard_vehicle_financial_immutable_rows();
create trigger vehicle_financial_revision_immutable before update or delete on public.vehicle_financial_revision_history
for each row execute function public.guard_vehicle_financial_immutable_rows();
create trigger vehicle_financial_approval_immutable before update or delete on public.vehicle_financial_review_approvals
for each row execute function public.guard_vehicle_financial_immutable_rows();
create trigger vehicle_financial_approval_history_immutable before update or delete on public.vehicle_financial_approval_history
for each row execute function public.guard_vehicle_financial_immutable_rows();
create trigger vehicle_financial_publication_immutable before update or delete on public.vehicle_financial_publications
for each row execute function public.guard_vehicle_financial_immutable_rows();
create trigger vehicle_financial_policy_approval_immutable before update or delete on public.vehicle_financial_policy_approvals
for each row execute function public.guard_vehicle_financial_immutable_rows();
create trigger vehicle_financial_write_control_history_immutable before update or delete on public.vehicle_financial_write_control_history
for each row execute function public.guard_vehicle_financial_immutable_rows();

alter table public.vehicle_financial_import_batches enable row level security;
alter table public.vehicle_financial_draft_entries enable row level security;
alter table public.vehicle_financial_revision_history enable row level security;
alter table public.vehicle_financial_review_approvals enable row level security;
alter table public.vehicle_financial_current_approvals enable row level security;
alter table public.vehicle_financial_approval_history enable row level security;
alter table public.vehicle_financial_publications enable row level security;
alter table public.vehicle_financial_policy_approvals enable row level security;
alter table public.vehicle_financial_write_control enable row level security;
alter table public.vehicle_financial_write_control_history enable row level security;

revoke all on public.vehicle_financial_import_batches, public.vehicle_financial_draft_entries,
  public.vehicle_financial_revision_history, public.vehicle_financial_review_approvals,
  public.vehicle_financial_current_approvals, public.vehicle_financial_approval_history,
  public.vehicle_financial_publications, public.vehicle_financial_policy_approvals,
  public.vehicle_financial_write_control, public.vehicle_financial_write_control_history from public, anon, authenticated, service_role;
-- The app service client reads these records; mutations occur only in narrow
-- SECURITY DEFINER RPCs. In particular, there is no direct publication write.
grant select on public.vehicle_financial_import_batches, public.vehicle_financial_draft_entries,
  public.vehicle_financial_revision_history, public.vehicle_financial_review_approvals,
  public.vehicle_financial_current_approvals, public.vehicle_financial_approval_history,
  public.vehicle_financial_publications, public.vehicle_financial_policy_approvals,
  public.vehicle_financial_write_control, public.vehicle_financial_write_control_history to service_role;

create function public.guard_vehicle_monthly_performance_v4_cutover()
returns trigger language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_mode text; v_found boolean;
begin
  select mode into v_mode from public.vehicle_financial_write_control
   where control_key = 'vehicle_monthly_performance';
  v_found := found;
  if not v_found then raise exception 'vehicle_finance_write_control_missing'; end if;
  if v_mode is null or v_mode not in ('legacy_enabled','v4_only') then
    raise exception 'vehicle_finance_write_control_invalid';
  end if;
  if v_mode = 'v4_only' then raise exception 'vehicle_finance_legacy_write_disabled'; end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger vehicle_monthly_performance_v4_cutover_guard
before insert or update or delete on public.vehicle_monthly_performance
for each row execute function public.guard_vehicle_monthly_performance_v4_cutover();

-- TRUNCATE bypasses row triggers and RLS. Preserve SELECT/INSERT/UPDATE/DELETE
-- for legacy operation, while refusing an inherited TRUNCATE grant that a
-- direct REVOKE cannot remove.
revoke truncate on public.vehicle_monthly_performance from public, anon, authenticated, service_role;
do $$ begin
  if has_table_privilege('anon','public.vehicle_monthly_performance','TRUNCATE')
     or has_table_privilege('authenticated','public.vehicle_monthly_performance','TRUNCATE')
     or has_table_privilege('service_role','public.vehicle_monthly_performance','TRUNCATE') then
    raise exception 'vehicle_finance_legacy_truncate_effective_grant';
  end if;
end $$;

create function public.set_vehicle_financial_legacy_write_mode(
  p_mode text, p_actor_id uuid, p_reason text
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_role text; v_previous text;
begin
  select role into v_role from public.account_access where user_id = p_actor_id and status = 'active';
  if coalesce(v_role,'') <> 'admin' then raise exception 'vehicle_finance_cutover_admin_required'; end if;
  if p_mode is null or p_mode not in ('legacy_enabled','v4_only') or nullif(btrim(p_reason),'') is null then
    raise exception 'vehicle_finance_cutover_reason_required';
  end if;
  if p_mode = 'v4_only' and not exists (
    select 1 from public.vehicle_financial_policy_approvals
    where policy_version='v4-accounting-draft-3'
      and formula_version='vehicle-finance-v4-v1'
      and policy_hash='190052557026203b9a6f8aa41090fc2050b374812b9f025c77b2a2b4aa04b17a'
  ) then raise exception 'vehicle_finance_cutover_policy_not_approved'; end if;
  perform pg_advisory_xact_lock(hashtext('vehicle-financial-legacy-write-gate')::bigint);
  select mode into v_previous from public.vehicle_financial_write_control
   where control_key = 'vehicle_monthly_performance' for update;
  if v_previous is null then raise exception 'vehicle_finance_cutover_control_missing'; end if;
  if v_previous not in ('legacy_enabled','v4_only') then raise exception 'vehicle_finance_cutover_control_invalid'; end if;
  if v_previous is distinct from p_mode then
    update public.vehicle_financial_write_control set mode = p_mode, changed_by = p_actor_id,
      reason = btrim(p_reason), changed_at = now()
      where control_key = 'vehicle_monthly_performance';
    insert into public.vehicle_financial_write_control_history(control_key,previous_mode,next_mode,actor_id,reason)
    values ('vehicle_monthly_performance',v_previous,p_mode,p_actor_id,btrim(p_reason));
  end if;
  return jsonb_build_object('mode',p_mode,'previous_mode',v_previous);
end;
$$;

-- Recovery can only restore the known-safe legacy mode. The service-only route
-- derives p_actor_id from a verified active administrator session.
create function public.recover_vehicle_financial_legacy_write_control(
  p_actor_id uuid, p_incident_sha256 text
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_role text; v_previous text; v_exists boolean;
begin
  select role into v_role from public.account_access where user_id=p_actor_id and status='active';
  if coalesce(v_role,'') <> 'admin' then raise exception 'vehicle_finance_recovery_admin_required'; end if;
  if p_incident_sha256 is null or p_incident_sha256 !~ '^[a-fA-F0-9]{64}$' then
    raise exception 'vehicle_finance_recovery_evidence_hash_required';
  end if;
  perform pg_advisory_xact_lock(hashtext('vehicle-financial-legacy-write-gate')::bigint);
  select mode into v_previous from public.vehicle_financial_write_control
   where control_key='vehicle_monthly_performance' for update;
  v_exists := found;
  if not v_exists or v_previous is null or v_previous not in ('legacy_enabled','v4_only') then
    insert into public.vehicle_financial_write_control(control_key,mode,changed_by,reason,changed_at)
    values ('vehicle_monthly_performance','legacy_enabled',p_actor_id,'Controlled recovery; evidence SHA-256 '||lower(p_incident_sha256),now())
    on conflict (control_key) do update set mode='legacy_enabled',changed_by=excluded.changed_by,
      reason=excluded.reason,changed_at=excluded.changed_at;
    insert into public.vehicle_financial_write_control_history(control_key,previous_mode,next_mode,actor_id,reason)
    values ('vehicle_monthly_performance',coalesce(v_previous,'missing_or_invalid'),'legacy_enabled',p_actor_id,
      'Controlled recovery; evidence SHA-256 '||lower(p_incident_sha256));
    return jsonb_build_object('mode','legacy_enabled','previous_mode',coalesce(v_previous,'missing_or_invalid'));
  end if;
  if v_previous = 'v4_only' then
    update public.vehicle_financial_write_control set mode='legacy_enabled',changed_by=p_actor_id,
      reason='Controlled recovery; evidence SHA-256 '||lower(p_incident_sha256),changed_at=now()
      where control_key='vehicle_monthly_performance';
    insert into public.vehicle_financial_write_control_history(control_key,previous_mode,next_mode,actor_id,reason)
    values ('vehicle_monthly_performance','v4_only','legacy_enabled',p_actor_id,
      'Controlled recovery; evidence SHA-256 '||lower(p_incident_sha256));
  end if;
  return jsonb_build_object('mode','legacy_enabled','previous_mode',v_previous);
end;
$$;

-- A policy decision is accepted only for the exact code-reviewed digest and a
-- fixed set of verified evidence fingerprints supplied by the trusted server.
-- There is no free-text approval field and no pre-seeded approval row.
create function public.approve_vehicle_financial_policy(
  p_policy_version text, p_formula_version text, p_policy_hash text,
  p_owner_decision_sha256 text, p_revenue_semantics_sha256 text,
  p_expense_boundaries_sha256 text, p_lpg_boundary_sha256 text,
  p_source_reconciliation_sha256 text, p_schema_compatibility_sha256 text,
  p_actor_id uuid
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_role text; v_row public.vehicle_financial_policy_approvals;
begin
  select role into v_role from public.account_access where user_id=p_actor_id and status='active';
  if coalesce(v_role,'') <> 'admin' then raise exception 'vehicle_finance_policy_admin_required'; end if;
  if p_policy_version <> 'v4-accounting-draft-3' or p_formula_version <> 'vehicle-finance-v4-v1'
     or p_policy_hash <> '190052557026203b9a6f8aa41090fc2050b374812b9f025c77b2a2b4aa04b17a' then raise exception 'vehicle_finance_policy_version_or_hash_mismatch'; end if;
  if exists (select 1 from unnest(array[p_owner_decision_sha256,p_revenue_semantics_sha256,
      p_expense_boundaries_sha256,p_lpg_boundary_sha256,p_source_reconciliation_sha256,
      p_schema_compatibility_sha256]) as evidence(hash)
      where evidence.hash is null or evidence.hash !~ '^[a-fA-F0-9]{64}$') then
    raise exception 'vehicle_finance_policy_evidence_incomplete';
  end if;
  insert into public.vehicle_financial_policy_approvals(
    policy_version,formula_version,policy_hash,owner_decision_sha256,revenue_semantics_sha256,
    expense_boundaries_sha256,lpg_boundary_sha256,source_reconciliation_sha256,
    schema_compatibility_sha256,approved_by
  ) values (
    p_policy_version,p_formula_version,lower(p_policy_hash),lower(p_owner_decision_sha256),
    lower(p_revenue_semantics_sha256),lower(p_expense_boundaries_sha256),lower(p_lpg_boundary_sha256),
    lower(p_source_reconciliation_sha256),lower(p_schema_compatibility_sha256),p_actor_id
  ) returning * into v_row;
  return jsonb_build_object('policy_version',v_row.policy_version,'formula_version',v_row.formula_version,
    'policy_hash',v_row.policy_hash,'approved_by',v_row.approved_by,'approved_at',v_row.approved_at);
end;
$$;

-- This function returns only row-level issue codes. It never returns HR names,
-- employee IDs, compensation amounts, or raw HR records to finance readers.
create function public.verify_vehicle_financial_salary_allocations(
  p_reporting_month date, p_allocations jsonb, p_actor_id uuid
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_role text; v_month_end date; v_item jsonb; v_row integer; v_sheet text; v_driver_text text;
  v_driver_id bigint; v_vehicle_id uuid; v_from date; v_to date; v_salary numeric;
  v_profile_id uuid; v_profile_count integer; v_profile_updated timestamptz;
  v_comp_amount numeric; v_comp_period text; v_comp_currency text; v_comp_date date;
  v_vehicle_count integer; v_hr_vehicle_count integer; v_salary_sum numeric; v_assignment_ok boolean; v_codes text[];
  v_rows jsonb := '[]'::jsonb; v_checked integer := 0; v_multi integer := 0;
begin
  select role into v_role from public.account_access where user_id=p_actor_id and status='active';
  if coalesce(v_role,'') not in ('admin','office_staff') then raise exception 'vehicle_finance_salary_check_forbidden'; end if;
  if p_reporting_month is null or extract(day from p_reporting_month) <> 1
     or jsonb_typeof(p_allocations) <> 'array' then raise exception 'vehicle_finance_salary_check_input_invalid'; end if;
  v_month_end := (p_reporting_month + interval '1 month - 1 day')::date;

  for v_item in select value from jsonb_array_elements(p_allocations) loop
    v_checked := v_checked + 1;
    v_codes := '{}';
    v_row := nullif(v_item->>'source_row','')::integer;
    v_sheet := coalesce(v_item->>'source_sheet','');
    v_driver_text := nullif(btrim(v_item->>'driver_id'),'');
    v_vehicle_id := nullif(v_item->>'vehicle_id','')::uuid;
    v_from := nullif(v_item->>'assignment_from','')::date;
    v_to := nullif(v_item->>'assignment_to','')::date;
    v_salary := nullif(v_item->>'source_salary','')::numeric;
    if v_driver_text is null or v_driver_text !~ '^[0-9]{1,19}$' then
      v_codes := array_append(v_codes,'driver_identity_missing_or_invalid');
    else
      begin v_driver_id := v_driver_text::bigint;
      exception when numeric_value_out_of_range then v_driver_id := null; end;
      if v_driver_id is null then
        v_codes := array_append(v_codes,'driver_identity_missing_or_invalid');
      else
        select count(*), (array_agg(p.id order by p.id))[1], max(p.updated_at) into v_profile_count,v_profile_id,v_profile_updated
          from public.ees_employee_profiles p where p.driver_id=v_driver_id;
        if v_profile_count=0 then v_codes := array_append(v_codes,'employee_profile_missing'); end if;
        if v_profile_count>1 then v_codes := array_append(v_codes,'employee_identity_ambiguous'); end if;
        if v_profile_count=1 then
          if v_profile_updated >= p_reporting_month then
            v_codes := array_append(v_codes,'employee_identity_history_requires_review');
          end if;
          select c.amount,c.period,c.currency,c.effective_from into v_comp_amount,v_comp_period,v_comp_currency,v_comp_date
            from public.ees_employee_compensation c where c.employee_id=v_profile_id and c.effective_from<=v_month_end
            order by c.effective_from desc,c.recorded_at desc,c.id desc limit 1;
          if not found then
            v_codes := array_append(v_codes,'monthly_payroll_missing');
          else
            if v_comp_period <> 'monthly' or v_comp_currency <> 'THB' then
              v_codes := array_append(v_codes,'monthly_thb_payroll_required');
            else
              if exists(select 1 from public.ees_employee_compensation c where c.employee_id=v_profile_id
                  and c.effective_from>p_reporting_month and c.effective_from<=v_month_end) then
                v_codes := array_append(v_codes,'payroll_changed_during_month');
              end if;
              select count(distinct nullif(e->>'vehicle_id','')::uuid),
                     sum(nullif(e->>'source_salary','')::numeric)
                into v_vehicle_count,v_salary_sum
                from jsonb_array_elements(p_allocations) e
                where nullif(btrim(e->>'driver_id'),'')=v_driver_text;
              select count(distinct a.vehicle_id) into v_hr_vehicle_count
                from public.ees_driver_vehicle_assignments a where a.driver_id=v_driver_id
                  and a.cancelled_at is null and a.effective_from<=v_month_end
                  and ((a.assignment_kind='permanent' and (a.effective_to is null or a.effective_to>p_reporting_month))
                    or (a.assignment_kind='temporary' and (a.effective_to is null or a.effective_to>=p_reporting_month)));
              if greatest(coalesce(v_vehicle_count,0),coalesce(v_hr_vehicle_count,0))>1 then
                v_multi := v_multi + 1;
                v_codes := array_append(v_codes,'multi_vehicle_salary_allocation_requires_reviewer');
                if v_salary_sum is distinct from v_comp_amount then
                  v_codes := array_append(v_codes,'employee_month_salary_allocation_mismatch');
                end if;
              elsif v_salary is null then
                v_codes := array_append(v_codes,'source_salary_unknown');
              elsif v_salary is distinct from v_comp_amount then
                v_codes := array_append(v_codes,'source_salary_payroll_mismatch');
              end if;
            end if;
          end if;
        end if;

        if v_vehicle_id is null then
          v_codes := array_append(v_codes,'canonical_vehicle_identity_missing');
        elsif v_from is null or v_to is null or v_from>v_to or v_from<p_reporting_month or v_to>v_month_end then
          v_codes := array_append(v_codes,'source_assignment_dates_missing_or_invalid');
        else
          select exists(select 1 from public.ees_driver_vehicle_assignments a
            where a.driver_id=v_driver_id and a.vehicle_id=v_vehicle_id and a.cancelled_at is null
              and a.effective_from<=v_from
              and ((a.assignment_kind='permanent' and (a.effective_to is null or a.effective_to>v_to))
                or (a.assignment_kind='temporary' and (a.effective_to is null or a.effective_to>=v_to))))
            into v_assignment_ok;
          if not v_assignment_ok then v_codes := array_append(v_codes,'dated_vehicle_assignment_mismatch'); end if;
          if exists(select 1 from public.ees_driver_vehicle_assignments a
              where a.driver_id=v_driver_id and a.vehicle_id<>v_vehicle_id and a.cancelled_at is null
                and a.effective_from<=v_to
                and ((a.assignment_kind='permanent' and (a.effective_to is null or a.effective_to>v_from))
                  or (a.assignment_kind='temporary' and (a.effective_to is null or a.effective_to>=v_from)))) then
            v_codes := array_append(v_codes,'overlapping_vehicle_assignment');
          end if;
        end if;
      end if;
    end if;
    v_rows := v_rows || jsonb_build_array(jsonb_build_object('source_sheet',v_sheet,'source_row',v_row,'issue_codes',to_jsonb(v_codes)));
  end loop;
  return jsonb_build_object('status',case
      when exists(select 1 from jsonb_array_elements(v_rows) x
        cross join lateral jsonb_array_elements_text(x->'issue_codes') as issue(code)
        where issue.code <> 'multi_vehicle_salary_allocation_requires_reviewer') then 'needs_review'
      when v_multi>0 then 'allocation_review'
      else 'checked' end,
    'checked_rows',v_checked,'multi_vehicle_rows',v_multi,'rows',v_rows);
end;
$$;

-- Return BIGINT IDs as decimal text so JavaScript never rounds driver identity.
create function public.list_vehicle_financial_draft_drivers()
returns table(driver_id text, name text, active boolean)
language sql security definer set search_path = pg_catalog, public, pg_temp as $$
  select d.id::text,d.name,d.active from public.drivers d order by d.name,d.id
$$;

create function public.guard_vehicle_financial_publication_consistency()
returns trigger language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_status text; v_month date; v_vehicle uuid;
begin
  perform pg_advisory_xact_lock(hashtext('vehicle-financial-approval:'||new.reporting_month::text)::bigint);
  select status, reporting_month into v_status, v_month
    from public.vehicle_financial_import_batches where id = new.batch_id;
  select vehicle_id into v_vehicle from public.vehicle_financial_draft_entries
    where id = new.entry_id and batch_id = new.batch_id;
  if v_status <> 'approved' or v_month is distinct from new.reporting_month or v_vehicle is distinct from new.vehicle_id then
    raise exception 'vehicle_finance_publication_reference_mismatch';
  end if;
  if not exists (select 1 from public.vehicle_financial_current_approvals a
      where a.reporting_month=new.reporting_month and a.vehicle_id=new.vehicle_id
        and a.batch_id=new.batch_id and a.entry_id=new.entry_id) then
    raise exception 'vehicle_finance_publication_not_current_approval';
  end if;
  return new;
end;
$$;
create trigger vehicle_financial_publication_consistency
before insert on public.vehicle_financial_publications
for each row execute function public.guard_vehicle_financial_publication_consistency();

create function public.create_vehicle_financial_draft(
  p_batch jsonb, p_entries jsonb, p_actor_id uuid
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_batch public.vehicle_financial_import_batches;
  v_role text;
  v_entry jsonb;
begin
  select role into v_role from public.account_access
   where user_id = p_actor_id and status = 'active';
  if coalesce(v_role,'') not in ('admin','office_staff') then raise exception 'vehicle_finance_import_forbidden'; end if;
  if jsonb_typeof(p_entries) <> 'array' then raise exception 'vehicle_finance_entries_must_be_array'; end if;
  if p_batch->>'status' <> 'draft' then raise exception 'vehicle_finance_invalid_initial_status'; end if;
  perform pg_advisory_xact_lock(hashtext('vehicle-financial:' || (p_batch->>'reporting_month'))::bigint);
  if exists (select 1 from public.vehicle_financial_import_batches
      where reporting_month = (p_batch->>'reporting_month')::date
        and idempotency_hash = p_batch->>'idempotency_hash') then
    raise exception 'vehicle_finance_duplicate_import';
  end if;
  if (p_batch->>'version')::integer <> (
      select coalesce(max(version),0) + 1 from public.vehicle_financial_import_batches
      where reporting_month = (p_batch->>'reporting_month')::date) then
    raise exception 'vehicle_finance_version_conflict';
  end if;

  insert into public.vehicle_financial_import_batches (
    reporting_month, version, schema_version, formula_version, status, source_file_name,
    source_sha256, source_format, source_size_bytes, source_sheets, formula_reference,
    source_totals, source_controls, calculated_totals, validation_issue_codes, validation_ready, validation_counts,
    expected_vehicle_ids, validation_snapshot, idempotency_hash, content_hash,
    validated_content_hash, historical_correction, salary_verification, uploaded_by, validated_at
  ) values (
    (p_batch->>'reporting_month')::date, (p_batch->>'version')::integer, 4,
    coalesce(p_batch->>'formula_version','vehicle-finance-v4-v1'), p_batch->>'status',
    p_batch->>'source_file_name', p_batch->>'source_sha256', p_batch->>'source_format',
    (p_batch->>'source_size_bytes')::bigint, coalesce(p_batch->'source_sheets','[]'::jsonb),
    nullif(p_batch->>'formula_reference',''), coalesce(p_batch->'source_totals','{}'::jsonb),
    coalesce(p_batch->'source_controls','[]'::jsonb),
    coalesce(p_batch->'calculated_totals','{}'::jsonb),
    coalesce(array(select jsonb_array_elements_text(coalesce(p_batch->'validation_issue_codes','[]'::jsonb))), '{}'),
    coalesce((p_batch->>'validation_ready')::boolean, false),
    coalesce(p_batch->'validation_counts','{"expected":0,"matched":0,"missing":0,"duplicate":0}'::jsonb),
    coalesce(array(select jsonb_array_elements_text(p_batch->'expected_vehicle_ids'))::uuid[], '{}'),
    coalesce(p_batch->'validation_snapshot','{}'::jsonb), p_batch->>'idempotency_hash', p_batch->>'content_hash',
    null,
    p_batch->'historical_correction', p_batch->'salary_verification', p_actor_id,
    case when p_batch->>'status' = 'validated' then now() else null end
  ) returning * into v_batch;

  for v_entry in select value from jsonb_array_elements(p_entries) loop
    insert into public.vehicle_financial_draft_entries (
      batch_id, vehicle_id, registration_source, registration_snapshot, assigned_employee_id, assigned_employee_name_snapshot,
      assignment_effective_from, assignment_effective_to,
      source_sheet, source_row, source_values, raw_cells, salary, jobs_completed, trip_payments,
      expenses, parking_fees, total_received, fuel, lpg, lpg_treatment, maintenance
    ) values (
      v_batch.id, nullif(v_entry->>'vehicle_id','')::uuid,
      coalesce(v_entry->>'registration_source',''), nullif(v_entry->>'registration_snapshot',''),
      nullif(v_entry->>'assigned_employee_id',''), nullif(v_entry->>'assigned_employee_name_snapshot',''),
      nullif(v_entry->>'assignment_effective_from','')::date, nullif(v_entry->>'assignment_effective_to','')::date, coalesce(v_entry->>'source_sheet',''),
      (v_entry->>'source_row')::integer, coalesce(v_entry->'source_values','{}'::jsonb),
      '[]'::jsonb, nullif(v_entry->>'salary','')::numeric,
      nullif(v_entry->>'jobs_completed','')::integer, nullif(v_entry->>'trip_payments','')::numeric,
      nullif(v_entry->>'expenses','')::numeric, nullif(v_entry->>'parking_fees','')::numeric,
      nullif(v_entry->>'total_received','')::numeric, nullif(v_entry->>'fuel','')::numeric,
      nullif(v_entry->>'lpg','')::numeric, coalesce(v_entry->>'lpg_treatment','unknown'),
      nullif(v_entry->>'maintenance','')::numeric
    );
  end loop;

  insert into public.vehicle_financial_revision_history (batch_id,to_status,actor_id,reason,content_hash,event_details)
  values (v_batch.id,v_batch.status,p_actor_id,'Import batch created',v_batch.content_hash,
          jsonb_build_object('source_sha256',v_batch.source_sha256,'entry_count',jsonb_array_length(p_entries)));
  return jsonb_build_object('id',v_batch.id,'version',v_batch.version,'status',v_batch.status,'content_hash',v_batch.content_hash);
end;
$$;

create function public.transition_vehicle_financial_draft(
  p_batch_id uuid, p_action text, p_expected_hash text, p_reason text, p_actor_id uuid,
  p_expected_current jsonb default null
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_batch public.vehicle_financial_import_batches;
  v_role text;
  v_target text;
  v_entry record; v_previous uuid; v_found boolean; v_approval_id uuid;
  v_entries integer; v_vehicles integer; v_prior integer := 0;
begin
  if nullif(btrim(p_reason),'') is null then raise exception 'vehicle_finance_reason_required'; end if;
  select role into v_role from public.account_access
   where user_id = p_actor_id and status = 'active';
  if p_action = 'validate' then
    if coalesce(v_role,'') not in ('admin','office_staff') then raise exception 'vehicle_finance_validation_forbidden'; end if;
    v_target := case when coalesce((select validation_snapshot->>'readyForReview' from public.vehicle_financial_import_batches where id=p_batch_id),'false')::boolean then 'validated' else 'needs_review' end;
  elsif p_action = 'submit_review' then
    if coalesce(v_role,'') not in ('admin','office_staff') then raise exception 'vehicle_finance_review_forbidden'; end if;
    v_target := 'in_review';
  elsif p_action in ('approve','supersede') then
    if coalesce(v_role,'') <> 'admin' then raise exception 'vehicle_finance_approval_forbidden'; end if;
    v_target := 'approved';
  else raise exception 'vehicle_finance_invalid_action'; end if;

  select * into v_batch from public.vehicle_financial_import_batches where id = p_batch_id for update;
  if not found then raise exception 'vehicle_finance_batch_not_found'; end if;
  if v_batch.content_hash <> p_expected_hash or v_batch.validated_content_hash is distinct from p_expected_hash then
    if not (p_action = 'validate' and v_batch.content_hash = p_expected_hash and v_batch.validated_content_hash is null) then
      raise exception 'vehicle_finance_content_changed';
    end if;
  end if;
  if p_action = 'validate' and v_batch.status <> 'draft' then raise exception 'vehicle_finance_validation_requires_draft'; end if;
  if v_target = 'in_review' and (v_batch.status <> 'validated' or
      coalesce((v_batch.validation_snapshot->>'readyForReview')::boolean,false) is not true) then
    raise exception 'vehicle_finance_review_requires_validation';
  end if;
  if v_target = 'approved' and (v_batch.status <> 'in_review' or p_actor_id = v_batch.uploaded_by) then
    raise exception 'vehicle_finance_approval_requires_independent_reviewer';
  end if;
  if v_target = 'approved' then
    perform pg_advisory_xact_lock(hashtext('vehicle-financial-approval:'||v_batch.reporting_month::text)::bigint);
    select count(*),count(distinct vehicle_id) into v_entries,v_vehicles
      from public.vehicle_financial_draft_entries where batch_id=p_batch_id;
    if v_entries=0 or v_entries<>v_vehicles then
      raise exception 'vehicle_finance_approval_vehicle_identity_invalid';
    end if;
    if p_action='supersede' and (jsonb_typeof(p_expected_current) is distinct from 'object'
        or (select count(*) from jsonb_object_keys(p_expected_current))<>v_entries) then
      raise exception 'vehicle_finance_supersession_snapshot_required';
    end if;
    for v_entry in select id,vehicle_id from public.vehicle_financial_draft_entries where batch_id=p_batch_id loop
      if exists(select 1 from public.vehicle_financial_publications p
          where p.reporting_month=v_batch.reporting_month and p.vehicle_id=v_entry.vehicle_id) then
        raise exception 'vehicle_finance_approved_vehicle_already_published';
      end if;
      select batch_id into v_previous from public.vehicle_financial_current_approvals
        where reporting_month=v_batch.reporting_month and vehicle_id=v_entry.vehicle_id for update;
      v_found := found;
      if p_action='approve' and v_found then raise exception 'vehicle_finance_current_approval_conflict'; end if;
      if p_action='supersede' and (not (p_expected_current ? v_entry.vehicle_id::text)
          or (p_expected_current->>v_entry.vehicle_id::text) is distinct from v_previous::text) then
        raise exception 'vehicle_finance_supersession_snapshot_stale';
      end if;
      if v_found then v_prior := v_prior+1; end if;
    end loop;
    if p_action='supersede' and v_prior=0 then raise exception 'vehicle_finance_supersession_requires_prior_approval'; end if;
  end if;
  if p_action = 'validate' then
    update public.vehicle_financial_import_batches set status = v_target, updated_at = now(),
      validated_at = case when v_target = 'validated' then now() else null end,
      validated_content_hash = case when v_target = 'validated' then p_expected_hash else null end
    where id = p_batch_id;
  else
    update public.vehicle_financial_import_batches set status = v_target, updated_at = now() where id = p_batch_id;
  end if;
  if v_target = 'approved' then
    insert into public.vehicle_financial_review_approvals(batch_id,content_hash,reviewer_id,decision,reason)
    values (p_batch_id,p_expected_hash,p_actor_id,'approved',p_reason) returning id into v_approval_id;
    for v_entry in select id,vehicle_id from public.vehicle_financial_draft_entries where batch_id=p_batch_id loop
      select batch_id into v_previous from public.vehicle_financial_current_approvals
        where reporting_month=v_batch.reporting_month and vehicle_id=v_entry.vehicle_id;
      if found then
        update public.vehicle_financial_current_approvals set batch_id=p_batch_id,entry_id=v_entry.id,
          approval_id=v_approval_id,designated_by=p_actor_id,designated_at=now()
          where reporting_month=v_batch.reporting_month and vehicle_id=v_entry.vehicle_id;
      else
        v_previous := null;
        insert into public.vehicle_financial_current_approvals
          (reporting_month,vehicle_id,batch_id,entry_id,approval_id,designated_by)
        values (v_batch.reporting_month,v_entry.vehicle_id,p_batch_id,v_entry.id,v_approval_id,p_actor_id);
      end if;
      insert into public.vehicle_financial_approval_history
        (reporting_month,vehicle_id,previous_batch_id,next_batch_id,approval_id,actor_id,action,reason)
      values (v_batch.reporting_month,v_entry.vehicle_id,v_previous,p_batch_id,v_approval_id,p_actor_id,
        case when v_previous is null then 'approved' else 'superseded' end,p_reason);
    end loop;
  end if;
  insert into public.vehicle_financial_revision_history(batch_id,from_status,to_status,actor_id,reason,content_hash)
  values (p_batch_id,v_batch.status,v_target,p_actor_id,p_reason,p_expected_hash);
  return jsonb_build_object('id',p_batch_id,'status',v_target,'content_hash',p_expected_hash);
end;
$$;

revoke all on function public.create_vehicle_financial_draft(jsonb,jsonb,uuid) from public, anon, authenticated;
revoke all on function public.transition_vehicle_financial_draft(uuid,text,text,text,uuid,jsonb) from public, anon, authenticated;
revoke all on function public.guard_vehicle_financial_immutable_rows() from public, anon, authenticated;
revoke all on function public.guard_vehicle_monthly_performance_v4_cutover() from public, anon, authenticated;
revoke all on function public.guard_vehicle_financial_publication_consistency() from public, anon, authenticated;
revoke all on function public.set_vehicle_financial_legacy_write_mode(text,uuid,text) from public, anon, authenticated;
revoke all on function public.recover_vehicle_financial_legacy_write_control(uuid,text) from public, anon, authenticated;
revoke all on function public.approve_vehicle_financial_policy(text,text,text,text,text,text,text,text,text,uuid) from public, anon, authenticated;
revoke all on function public.verify_vehicle_financial_salary_allocations(date,jsonb,uuid) from public, anon, authenticated;
revoke all on function public.list_vehicle_financial_draft_drivers() from public, anon, authenticated;
grant execute on function public.create_vehicle_financial_draft(jsonb,jsonb,uuid) to service_role;
grant execute on function public.transition_vehicle_financial_draft(uuid,text,text,text,uuid,jsonb) to service_role;
grant execute on function public.set_vehicle_financial_legacy_write_mode(text,uuid,text) to service_role;
grant execute on function public.recover_vehicle_financial_legacy_write_control(uuid,text) to service_role;
grant execute on function public.approve_vehicle_financial_policy(text,text,text,text,text,text,text,text,text,uuid) to service_role;
grant execute on function public.verify_vehicle_financial_salary_allocations(date,jsonb,uuid) to service_role;
grant execute on function public.list_vehicle_financial_draft_drivers() to service_role;

comment on table public.vehicle_financial_import_batches is
  'Versioned V4 monthly financial draft imports. No legacy backfill; approval does not publish.';
comment on column public.vehicle_financial_draft_entries.lpg_treatment is
  'included_in_fuel means LPG amount is not added again; separate means LPG is an additional expense; unknown withholds profit.';
comment on column public.vehicle_financial_draft_entries.salary is
  'Fixed monthly base pay. Kept separate from variable trip_payments.';
comment on column public.vehicle_financial_draft_entries.trip_payments is
  'Variable payments earned for jobs completed during the reporting month.';
comment on table public.vehicle_financial_policy_approvals is
  'Immutable approval evidence for one fixed V4 policy digest. Empty until an active administrator approves the exact policy and server-verified evidence manifest.';
comment on table public.vehicle_financial_write_control is
  'Additive legacy import cutover gate. Default legacy_enabled preserves production behavior; activate only after separately approved V4 cutover.';

commit;
