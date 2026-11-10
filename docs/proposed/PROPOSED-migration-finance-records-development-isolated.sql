-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- PROPOSED — NOT APPLIED — REVIEW ONLY — FINANCE DEVELOPMENT ISOLATED VARIANT
--
-- Target identity (when ever approved): EES Development project ref wpmnjfncaoogssgpqxek ONLY.
-- NEVER apply to production hafoaurzfgkkwpvzedvd.
--
-- This file is deliberately OUTSIDE supabase/migrations/. It has not been executed against any
-- remote database. Companion guards: lib/finance-migration-environment.ts
-- Design: docs/finance-v3-finance-only-staging-design.md
-- Dependency map: docs/finance-v3-development-dependency-map.md
--
-- Differences from the full shared-storage proposal:
--   * Does NOT require public.clients, public.booking_diary, or production finance capability helpers.
--   * Uses finance_dev_* synthetic fixture tables instead.
--   * Money columns are integer satang (100 = THB 1.00).
--   * Official TRN allocation RPC is present only as a hard-fail stub.
--   * Additive only: no DROP, no ALTER of existing non-finance tables.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

begin;

-- Guard comment for human operators (tools must also refuse production independently):
-- REQUIRED_PROJECT_REF=wpmnjfncaoogssgpqxek
-- FORBIDDEN_PROJECT_REF=hafoaurzfgkkwpvzedvd

-- ───────────────────────── 0. Immutable history helper (Finance-local) ─────────────────────────
create or replace function public.finance_reject_history_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'FINANCE_HISTORY_IMMUTABLE' using errcode = 'P0001';
end;
$$;

-- ───────────────────────── 1. Synthetic fixtures (no production PII) ─────────────────────────
create table public.finance_dev_clients (
  id uuid primary key default gen_random_uuid(),
  synthetic_code text not null unique check (synthetic_code ~ '^SYN-FINANCE-CUSTOMER-'),
  display_name text not null check (length(btrim(display_name)) >= 3),
  created_at timestamptz not null default now()
);

create table public.finance_dev_bookings (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.finance_dev_clients(id) on delete restrict,
  booking_date date not null,
  pickup text not null default '',
  delivery text not null default '',
  work_order_hint text check (work_order_hint is null or work_order_hint ~ '^SYN-WO-'),
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.finance_dev_capabilities (
  user_id uuid primary key references auth.users(id) on delete cascade,
  can_finance_review boolean not null default false,
  can_invoice_approve boolean not null default false,
  note text not null default 'synthetic staging capability'
);

create or replace function public.finance_dev_has_capability(p_capability text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_capability = 'finance_reviewer' then coalesce(
      (select can_finance_review from public.finance_dev_capabilities where user_id = auth.uid()), false)
    when p_capability = 'invoice_approver' then coalesce(
      (select can_invoice_approve from public.finance_dev_capabilities where user_id = auth.uid()), false)
    else false
  end;
$$;

create or replace function public.finance_dev_is_office()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.finance_dev_capabilities c where c.user_id = auth.uid()
  ) or public.finance_dev_has_capability('finance_reviewer') or public.finance_dev_has_capability('invoice_approver');
$$;

-- ───────────────────────── 2. Intake ─────────────────────────
create table public.finance_intake_records (
  booking_id uuid primary key references public.finance_dev_bookings(id) on delete restrict,
  client_id uuid not null references public.finance_dev_clients(id) on delete restrict,
  work_order_number text not null check (work_order_number ~ '^SYN-WO-' and length(btrim(work_order_number)) > 0),
  customer_job_number text,
  receipt_notes text not null default '' check (length(receipt_notes) <= 500),
  intake_check text check (intake_check in ('confirmed','flagged')),
  intake_note text not null default '' check (length(intake_note) <= 500),
  checked_by uuid references auth.users(id) on delete restrict,
  checked_at timestamptz,
  booking_snapshot jsonb not null,
  revision integer not null default 1 check (revision > 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  constraint finance_intake_flag_needs_note check (intake_check is distinct from 'flagged' or length(btrim(intake_note)) >= 3)
);
create unique index finance_intake_one_booking_per_work_order
  on public.finance_intake_records (lower(btrim(work_order_number)));

create table public.finance_intake_receipts (
  booking_id uuid not null references public.finance_intake_records(booking_id) on delete restrict,
  kind text not null check (kind in ('parking','toll','overtime','container_pickup','overnight','other')),
  amount_satang integer not null check (amount_satang >= 0 and amount_satang <= 99999999999),
  primary key (booking_id, kind)
);

-- ───────────────────────── 3. Simulated TRN only (official allocator stub raises) ─────────────────────────
create table public.finance_simulated_trn_register (
  id uuid primary key default gen_random_uuid(),
  trn_year integer not null check (trn_year between 2000 and 2100),
  trn_number integer not null check (trn_number > 0),
  trn_text text generated always as ('TRN' || lpad(trn_number::text, 3, '0') || '/' || trn_year::text) stored,
  sheet_id uuid,
  allocated_at timestamptz not null default now(),
  unique (trn_year, trn_number),
  unique (trn_text)
);

-- ───────────────────────── 4. Billing sheets ─────────────────────────
create table public.finance_billing_sheets (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.finance_dev_clients(id) on delete restrict,
  draft_identifier text not null unique,
  status text not null default 'draft'
    check (status in ('draft','needs_correction','ready_for_review','awaiting_approval','approved','cancelled')),
  -- Development isolated variant: issued/official TRN deliberately omitted from allowed statuses.
  simulated_trn_id uuid unique references public.finance_simulated_trn_register(id) on delete restrict,
  revision integer not null default 1 check (revision > 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  confirmed_by uuid references auth.users(id) on delete restrict,
  confirmed_at timestamptz
);

alter table public.finance_simulated_trn_register
  add constraint finance_simulated_trn_sheet_fk
  foreign key (sheet_id) references public.finance_billing_sheets(id) on delete restrict;

create table public.finance_billing_sheet_papers (
  sheet_id uuid not null references public.finance_billing_sheets(id) on delete restrict,
  position integer not null check (position between 1 and 200),
  booking_id uuid not null references public.finance_intake_records(booking_id) on delete restrict,
  primary key (sheet_id, position) deferrable initially deferred,
  unique (sheet_id, booking_id)
);

create table public.finance_work_order_allocations (
  booking_id uuid primary key references public.finance_intake_records(booking_id) on delete restrict,
  sheet_id uuid not null references public.finance_billing_sheets(id) on delete restrict,
  allocated_at timestamptz not null default now()
);

create table public.finance_billing_sheet_lines (
  sheet_id uuid not null,
  booking_id uuid not null,
  transport_amount_satang integer check (transport_amount_satang is null or (transport_amount_satang > 0 and transport_amount_satang <= 99999999999)),
  transport_source text check (transport_source in ('manual','schedule')),
  rate_label text,
  primary key (sheet_id, booking_id),
  foreign key (sheet_id, booking_id) references public.finance_billing_sheet_papers(sheet_id, booking_id) on delete cascade,
  constraint finance_line_amount_has_source check ((transport_amount_satang is null) = (transport_source is null))
);

create table public.finance_billing_sheet_extras (
  sheet_id uuid not null,
  booking_id uuid not null,
  kind text not null check (kind in ('parking','toll','overtime','container_pickup','overnight','other')),
  decision text not null check (decision in ('bill','not_billable')),
  amount_satang integer,
  note text not null default '' check (length(note) <= 200),
  primary key (sheet_id, booking_id, kind),
  foreign key (sheet_id, booking_id) references public.finance_billing_sheet_papers(sheet_id, booking_id) on delete cascade,
  constraint finance_extra_amount_matches_decision check (
    (decision = 'bill' and amount_satang is not null and amount_satang > 0 and amount_satang <= 99999999999)
    or (decision = 'not_billable' and amount_satang is null)
  )
);

-- ───────────────────────── 5. Revisions / approvals / events ─────────────────────────
create table public.finance_billing_sheet_revisions (
  id uuid primary key default gen_random_uuid(),
  sheet_id uuid not null references public.finance_billing_sheets(id) on delete restrict,
  revision_number integer not null check (revision_number > 0),
  action text not null check (action in ('confirmed','submitted','approved','reopened','corrected')),
  snapshot jsonb not null,
  snapshot_sha256 text not null check (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  total_satang integer not null check (total_satang >= 0 and total_satang <= 99999999999),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (sheet_id, revision_number)
);

create table public.finance_billing_sheet_approvals (
  id uuid primary key default gen_random_uuid(),
  sheet_id uuid not null references public.finance_billing_sheets(id) on delete restrict,
  revision_id uuid not null unique references public.finance_billing_sheet_revisions(id) on delete restrict,
  decision text not null check (decision in ('approved','rejected')),
  reason text not null check (length(btrim(reason)) >= 3),
  decided_by uuid not null references auth.users(id) on delete restrict,
  decided_at timestamptz not null default now()
);

create table public.finance_billing_sheet_events (
  id bigint generated always as identity primary key,
  sheet_id uuid not null references public.finance_billing_sheets(id) on delete restrict,
  booking_id uuid,
  actor_id uuid references auth.users(id) on delete restrict,
  event_type text not null,
  details jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create trigger finance_sheet_revisions_immutable
  before update or delete on public.finance_billing_sheet_revisions
  for each row execute function public.finance_reject_history_change();
create trigger finance_sheet_approvals_immutable
  before update or delete on public.finance_billing_sheet_approvals
  for each row execute function public.finance_reject_history_change();
create trigger finance_sheet_events_immutable
  before update or delete on public.finance_billing_sheet_events
  for each row execute function public.finance_reject_history_change();

-- Allocation: one WO → one sheet
create function public.finance_paper_allocation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    begin
      insert into public.finance_work_order_allocations(booking_id, sheet_id)
      values (new.booking_id, new.sheet_id);
    exception when unique_violation then
      raise exception 'FINANCE_WO_ALREADY_ALLOCATED' using errcode = 'P0001';
    end;
    return new;
  end if;
  delete from public.finance_work_order_allocations
  where booking_id = old.booking_id and sheet_id = old.sheet_id;
  return old;
end;
$$;
create trigger finance_paper_allocation_aiud
  after insert or delete on public.finance_billing_sheet_papers
  for each row execute function public.finance_paper_allocation();
revoke all on function public.finance_paper_allocation() from public, anon, authenticated;

-- ───────────────────────── 6. Pricing evidence + profiles ─────────────────────────
create table public.finance_fuel_references (
  id uuid primary key default gen_random_uuid(),
  reference_date date not null,
  product text not null default 'Diesel B7' check (product = 'Diesel B7'),
  price_satang_per_litre integer not null check (price_satang_per_litre > 0 and price_satang_per_litre < 20000),
  source_url text not null,
  evidence text not null check (length(btrim(evidence)) >= 10),
  status text not null check (status in ('proposed','verified','disputed')),
  retrieved_at timestamptz not null default now(),
  recorded_by uuid not null references auth.users(id) on delete restrict,
  verified_by uuid references auth.users(id) on delete restrict,
  verified_at timestamptz,
  superseded_at timestamptz,
  supersede_reason text
);
create unique index finance_fuel_one_active_per_date
  on public.finance_fuel_references (reference_date)
  where superseded_at is null;

create table public.finance_customer_billing_profiles (
  id text primary key,
  version integer not null check (version > 0),
  review_status text not null check (review_status in ('draft','pending_owner_approval','approved','retired')),
  source text not null check (length(btrim(source)) >= 10),
  match_tokens text[] not null check (cardinality(match_tokens) >= 1),
  legal_name_th text not null,
  billing_address_th text not null,
  tax_id text not null,
  revision integer not null default 1 check (revision > 0),
  updated_by uuid not null references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now()
);

-- ───────────────────────── 7. Idempotent approval RPC ─────────────────────────
create table public.finance_rpc_idempotency (
  scope text not null,
  idempotency_key text not null,
  sheet_id uuid,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (scope, idempotency_key)
);

create function public.finance_approve_sheet(
  p_sheet_id uuid,
  p_expected_revision integer,
  p_note text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_revision integer;
  v_prior jsonb;
  v_rev_id uuid;
begin
  if not public.finance_dev_has_capability('invoice_approver') then
    raise exception 'FINANCE_APPROVER_REQUIRED' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_idempotency_key, ''))) < 8 then
    raise exception 'FINANCE_IDEMPOTENCY_REQUIRED' using errcode = '22023';
  end if;
  select result into v_prior
  from public.finance_rpc_idempotency
  where scope = 'approve_sheet' and idempotency_key = p_idempotency_key;
  if v_prior is not null then
    return v_prior;
  end if;
  select status, revision into v_status, v_revision
  from public.finance_billing_sheets
  where id = p_sheet_id
  for update;
  if v_status is null then
    raise exception 'FINANCE_SHEET_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_revision is distinct from p_expected_revision then
    raise exception 'FINANCE_STALE' using errcode = 'P0001';
  end if;
  if v_status not in ('ready_for_review','awaiting_approval') then
    raise exception 'FINANCE_SHEET_NOT_APPROVABLE' using errcode = 'P0001';
  end if;
  insert into public.finance_billing_sheet_revisions(
    sheet_id, revision_number, action, snapshot, snapshot_sha256, total_satang, created_by
  ) values (
    p_sheet_id, v_revision, 'approved', '{}'::jsonb, repeat('0', 64), 0, auth.uid()
  ) returning id into v_rev_id;
  insert into public.finance_billing_sheet_approvals(sheet_id, revision_id, decision, reason, decided_by)
  values (p_sheet_id, v_rev_id, 'approved', coalesce(nullif(btrim(p_note), ''), 'Approved'), auth.uid());
  update public.finance_billing_sheets
  set status = 'approved', revision = revision + 1
  where id = p_sheet_id;
  insert into public.finance_billing_sheet_events(sheet_id, actor_id, event_type, details)
  values (p_sheet_id, auth.uid(), 'approved', jsonb_build_object('note', coalesce(p_note, '')));
  v_prior := jsonb_build_object('sheet_id', p_sheet_id, 'status', 'approved', 'revision_id', v_rev_id);
  insert into public.finance_rpc_idempotency(scope, idempotency_key, sheet_id, result)
  values ('approve_sheet', p_idempotency_key, p_sheet_id, v_prior);
  return v_prior;
end;
$$;

-- Official issuance deliberately impossible in this isolated variant.
create function public.finance_allocate_trn(p_sheet_id uuid, p_year integer default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'FINANCE_OFFICIAL_ISSUANCE_DISABLED_IN_DEVELOPMENT_ISOLATED_VARIANT' using errcode = 'P0001';
end;
$$;

revoke all on function public.finance_approve_sheet(uuid, integer, text, text) from public, anon;
revoke all on function public.finance_allocate_trn(uuid, integer) from public, anon;
grant execute on function public.finance_approve_sheet(uuid, integer, text, text) to authenticated;
-- allocate_trn remains executable only so callers receive the explicit disable error (not a silent success).
grant execute on function public.finance_allocate_trn(uuid, integer) to authenticated;

-- ───────────────────────── 8. RLS: read for office-capable staging users; no direct writes ─────────────────────────
alter table public.finance_dev_clients enable row level security;
alter table public.finance_dev_bookings enable row level security;
alter table public.finance_dev_capabilities enable row level security;
alter table public.finance_intake_records enable row level security;
alter table public.finance_intake_receipts enable row level security;
alter table public.finance_billing_sheets enable row level security;
alter table public.finance_billing_sheet_papers enable row level security;
alter table public.finance_work_order_allocations enable row level security;
alter table public.finance_billing_sheet_lines enable row level security;
alter table public.finance_billing_sheet_extras enable row level security;
alter table public.finance_billing_sheet_revisions enable row level security;
alter table public.finance_billing_sheet_approvals enable row level security;
alter table public.finance_billing_sheet_events enable row level security;
alter table public.finance_simulated_trn_register enable row level security;
alter table public.finance_fuel_references enable row level security;
alter table public.finance_customer_billing_profiles enable row level security;
alter table public.finance_rpc_idempotency enable row level security;

revoke all on
  public.finance_dev_clients, public.finance_dev_bookings, public.finance_dev_capabilities,
  public.finance_intake_records, public.finance_intake_receipts,
  public.finance_billing_sheets, public.finance_billing_sheet_papers, public.finance_work_order_allocations,
  public.finance_billing_sheet_lines, public.finance_billing_sheet_extras,
  public.finance_billing_sheet_revisions, public.finance_billing_sheet_approvals, public.finance_billing_sheet_events,
  public.finance_simulated_trn_register, public.finance_fuel_references, public.finance_customer_billing_profiles,
  public.finance_rpc_idempotency
from anon, authenticated;

grant select on
  public.finance_dev_clients, public.finance_dev_bookings,
  public.finance_intake_records, public.finance_intake_receipts,
  public.finance_billing_sheets, public.finance_billing_sheet_papers, public.finance_work_order_allocations,
  public.finance_billing_sheet_lines, public.finance_billing_sheet_extras,
  public.finance_billing_sheet_revisions, public.finance_billing_sheet_approvals,
  public.finance_simulated_trn_register, public.finance_fuel_references, public.finance_customer_billing_profiles
to authenticated;

create policy finance_dev_clients_office_read on public.finance_dev_clients
  for select to authenticated using (public.finance_dev_is_office());
create policy finance_dev_bookings_office_read on public.finance_dev_bookings
  for select to authenticated using (public.finance_dev_is_office());
create policy finance_intake_office_read on public.finance_intake_records
  for select to authenticated using (public.finance_dev_is_office());
create policy finance_intake_receipts_office_read on public.finance_intake_receipts
  for select to authenticated using (public.finance_dev_is_office());
create policy finance_sheets_office_read on public.finance_billing_sheets
  for select to authenticated using (public.finance_dev_is_office());
create policy finance_papers_office_read on public.finance_billing_sheet_papers
  for select to authenticated using (public.finance_dev_is_office());
create policy finance_allocations_office_read on public.finance_work_order_allocations
  for select to authenticated using (public.finance_dev_is_office());
create policy finance_lines_office_read on public.finance_billing_sheet_lines
  for select to authenticated using (public.finance_dev_is_office());
create policy finance_extras_office_read on public.finance_billing_sheet_extras
  for select to authenticated using (public.finance_dev_is_office());
create policy finance_revisions_office_read on public.finance_billing_sheet_revisions
  for select to authenticated using (public.finance_dev_is_office());
create policy finance_approvals_office_read on public.finance_billing_sheet_approvals
  for select to authenticated using (public.finance_dev_is_office());
create policy finance_simulated_trn_office_read on public.finance_simulated_trn_register
  for select to authenticated using (public.finance_dev_is_office());
create policy finance_fuel_office_read on public.finance_fuel_references
  for select to authenticated using (public.finance_dev_is_office());
create policy finance_profiles_office_read on public.finance_customer_billing_profiles
  for select to authenticated using (public.finance_dev_is_office());
create policy finance_events_approver_read on public.finance_billing_sheet_events
  for select to authenticated using (
    public.finance_dev_has_capability('finance_reviewer')
    or public.finance_dev_has_capability('invoice_approver')
  );

commit;

-- END PROPOSED — NOT APPLIED — REVIEW ONLY
