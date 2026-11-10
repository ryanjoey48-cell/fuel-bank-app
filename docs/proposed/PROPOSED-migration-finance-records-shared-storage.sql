-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- PROPOSED — NOT APPLIED — REVIEW ONLY.
--
-- Finance Records shared storage (intake → billing sheet → TRN register → documents → history).
-- This file is deliberately OUTSIDE supabase/migrations so no tooling can pick it up. It has only ever been run
-- against an in-memory PGlite database in tests/finance-records-storage-plan.test.cjs. It has NOT been reviewed
-- against the live schema, NOT backed up against, and NOT approved for any Supabase project (the configured project
-- has been identified as production). See docs/finance-records-shared-storage-plan.md for the prerequisites.
--
-- Additive only: no existing table is altered or dropped, no existing policy or function is replaced.
-- Depends on (all already prepared, none applied):
--   20261030100000_finance_verification_foundation  → public.finance_role_grants
--   20261102100000_finance_expenses_pricing         → public.finance_has_capability(), public.finance_reject_history_change()
--   existing live objects                           → public.clients, public.booking_diary, public.is_office_account(),
--                                                      public.current_account_role(), auth.users
-- ════════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- ───────────────────────── 1. Admin intake (one current row per booking; history is append-only) ─────────────────────────
create table public.finance_intake_records (
  booking_id uuid primary key,
  client_id uuid not null references public.clients(id) on delete restrict,
  work_order_number text not null check (length(btrim(work_order_number)) > 0),
  customer_job_number text,
  original_customer_job_number text,
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
-- A green-paper work-order number identifies exactly one booking (matches the local duplicate rule).
create unique index finance_intake_one_booking_per_work_order on public.finance_intake_records (lower(btrim(work_order_number)));
create index finance_intake_client_date on public.finance_intake_records (client_id, created_at);

-- Recorded receipt amounts. Blank = no row. A stored 0.00 is a real recorded zero (blank is never turned into zero).
create table public.finance_intake_receipts (
  booking_id uuid not null references public.finance_intake_records(booking_id) on delete restrict,
  kind text not null check (kind in ('parking','toll','overtime','container_pickup','overnight','other')),
  amount_thb numeric(12,2) not null check (amount_thb >= 0 and amount_thb <= 9999999999.99),
  primary key (booking_id, kind)
);

-- ───────────────────────── 2. Official TRN identity register (never simulated) ─────────────────────────
create table public.finance_trn_register_verifications (
  id uuid primary key default gen_random_uuid(),
  trn_year integer not null check (trn_year between 2000 and 2100),
  verified_through_number integer not null check (verified_through_number >= 0),
  evidence_note text not null check (length(btrim(evidence_note)) >= 10),
  verified_by uuid not null references auth.users(id) on delete restrict,
  verified_at timestamptz not null default now()
);
create index finance_trn_verifications_year on public.finance_trn_register_verifications (trn_year, verified_at);

create table public.finance_trn_register (
  id uuid primary key default gen_random_uuid(),
  trn_year integer not null check (trn_year between 2000 and 2100),
  trn_number integer not null check (trn_number > 0),
  trn_text text generated always as ('TRN' || lpad(trn_number::text, 3, '0') || '/' || trn_year::text) stored,
  status text not null check (status in ('issued','void')),
  origin text not null check (origin in ('historical_import','allocated')),
  sheet_id uuid,
  issued_by uuid references auth.users(id) on delete restrict,
  issued_at timestamptz not null default now(),
  void_reason text,
  unique (trn_year, trn_number),
  unique (trn_text),
  constraint finance_trn_void_reason check (status <> 'void' or length(btrim(coalesce(void_reason, ''))) >= 3),
  constraint finance_trn_allocated_needs_sheet check (origin <> 'allocated' or sheet_id is not null)
);

-- ───────────────────────── 3. Billing sheets (customer batches) ─────────────────────────
create table public.finance_billing_sheets (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  draft_identifier text not null unique,
  status text not null default 'draft' check (status in ('draft','needs_correction','ready_for_review','awaiting_approval','approved','issued','cancelled')),
  trn_id uuid unique references public.finance_trn_register(id) on delete restrict,
  revision integer not null default 1 check (revision > 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  confirmed_by uuid references auth.users(id) on delete restrict,
  confirmed_at timestamptz,
  constraint finance_sheet_issued_has_trn check ((status = 'issued') = (trn_id is not null))
);
alter table public.finance_trn_register
  add constraint finance_trn_register_sheet_fk foreign key (sheet_id) references public.finance_billing_sheets(id) on delete restrict;
create index finance_sheets_client_status on public.finance_billing_sheets (client_id, status);

-- Paper order: position is only the order of the physical green papers — never a work order, TRN or invoice number.
create table public.finance_billing_sheet_papers (
  sheet_id uuid not null references public.finance_billing_sheets(id) on delete restrict,
  position integer not null check (position between 1 and 200),
  booking_id uuid not null references public.finance_intake_records(booking_id) on delete restrict,
  primary key (sheet_id, position) deferrable initially deferred,
  unique (sheet_id, booking_id)
);

-- A work order belongs to at most ONE billing sheet at a time (and permanently once that sheet is issued).
create table public.finance_work_order_allocations (
  booking_id uuid primary key references public.finance_intake_records(booking_id) on delete restrict,
  sheet_id uuid not null references public.finance_billing_sheets(id) on delete restrict,
  allocated_at timestamptz not null default now()
);

-- Transport charge per paper. NULL = no price yet (blank is never an implied zero); zero is not a valid price.
create table public.finance_billing_sheet_lines (
  sheet_id uuid not null,
  booking_id uuid not null,
  transport_amount_thb numeric(12,2) check (transport_amount_thb is null or (transport_amount_thb > 0 and transport_amount_thb <= 9999999999.99)),
  transport_source text check (transport_source in ('manual','schedule')),
  rate_label text,
  rate_mapping_id uuid,
  primary key (sheet_id, booking_id),
  foreign key (sheet_id, booking_id) references public.finance_billing_sheet_papers(sheet_id, booking_id) on delete cascade,
  constraint finance_line_amount_has_source check ((transport_amount_thb is null) = (transport_source is null))
);

-- Customer-billable decision per extra charge. No row = undecided. 'bill' needs a positive amount; 'not_billable' has none.
create table public.finance_billing_sheet_extras (
  sheet_id uuid not null,
  booking_id uuid not null,
  kind text not null check (kind in ('parking','toll','overtime','container_pickup','overnight','other')),
  decision text not null check (decision in ('bill','not_billable')),
  amount_thb numeric(12,2),
  note text not null default '' check (length(note) <= 200),
  primary key (sheet_id, booking_id, kind),
  foreign key (sheet_id, booking_id) references public.finance_billing_sheet_papers(sheet_id, booking_id) on delete cascade,
  constraint finance_extra_amount_matches_decision check (
    (decision = 'bill' and amount_thb is not null and amount_thb > 0 and amount_thb <= 9999999999.99) or (decision = 'not_billable' and amount_thb is null))
);

-- ───────────────────────── 4. Immutable history: revisions (reproducible documents), approvals, events ─────────────────────────
create table public.finance_billing_sheet_revisions (
  id uuid primary key default gen_random_uuid(),
  sheet_id uuid not null references public.finance_billing_sheets(id) on delete restrict,
  revision_number integer not null check (revision_number > 0),
  action text not null check (action in ('confirmed','submitted','approved','issued','reopened','corrected')),
  -- Everything needed to re-render the statement / summary / invoice exactly as it was: header, papers in order,
  -- booking snapshots, charges and totals. The hash lets a later reader prove the snapshot was not altered.
  snapshot jsonb not null,
  snapshot_sha256 text not null check (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  total_thb numeric(12,2) not null check (total_thb >= 0 and total_thb <= 9999999999.99),
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
  event_type text not null check (event_type in ('created','paper_added','paper_removed','paper_moved','transport_set','extra_set','confirmed','reopened','submitted','approved','rejected','issued','cancelled','corrected')),
  details jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);
create index finance_sheet_events_sheet_time on public.finance_billing_sheet_events (sheet_id, occurred_at, id);

create trigger finance_sheet_revisions_immutable before update or delete on public.finance_billing_sheet_revisions for each row execute function public.finance_reject_history_change();
create trigger finance_sheet_approvals_immutable before update or delete on public.finance_billing_sheet_approvals for each row execute function public.finance_reject_history_change();
create trigger finance_sheet_events_immutable before update or delete on public.finance_billing_sheet_events for each row execute function public.finance_reject_history_change();
create trigger finance_trn_verifications_immutable before update or delete on public.finance_trn_register_verifications for each row execute function public.finance_reject_history_change();

-- ───────────────────────── 5. Invariants enforced in the database ─────────────────────────
-- 5a. Papers, charges and extras can only change while the sheet is editable.
create function public.finance_sheet_edit_guard() returns trigger language plpgsql set search_path = '' as $$
declare v_status text;
begin
  select status into v_status from public.finance_billing_sheets where id = coalesce(new.sheet_id, old.sheet_id);
  if v_status is null or v_status not in ('draft','needs_correction') then
    raise exception 'FINANCE_SHEET_LOCKED' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end $$;
create trigger finance_papers_edit_guard before insert or update or delete on public.finance_billing_sheet_papers for each row execute function public.finance_sheet_edit_guard();
create trigger finance_lines_edit_guard before insert or update or delete on public.finance_billing_sheet_lines for each row execute function public.finance_sheet_edit_guard();
create trigger finance_extras_edit_guard before insert or update or delete on public.finance_billing_sheet_extras for each row execute function public.finance_sheet_edit_guard();

-- 5b. Allocation projection: a work order cannot be on two sheets; issued allocations are permanent.
create function public.finance_paper_allocation() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    begin
      insert into public.finance_work_order_allocations(booking_id, sheet_id) values (new.booking_id, new.sheet_id);
    exception when unique_violation then
      raise exception 'FINANCE_WO_ALREADY_ALLOCATED' using errcode = 'P0001';
    end;
    return new;
  end if;
  delete from public.finance_work_order_allocations where booking_id = old.booking_id and sheet_id = old.sheet_id;
  return old;
end $$;
create trigger finance_paper_allocation_aiud after insert or delete on public.finance_billing_sheet_papers for each row execute function public.finance_paper_allocation();
revoke all on function public.finance_paper_allocation() from public, anon, authenticated;

-- 5c. Status transitions follow the lifecycle; an issued sheet is immutable; cancelling releases its work orders.
create function public.finance_sheet_status_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'FINANCE_SHEET_NOT_DELETABLE' using errcode = 'P0001'; end if;
  if old.status = 'issued' then raise exception 'FINANCE_ISSUED_IMMUTABLE' using errcode = 'P0001'; end if;
  if new.status is distinct from old.status and not (
       (old.status = 'draft'             and new.status in ('ready_for_review','cancelled')) or
       (old.status = 'needs_correction'  and new.status in ('ready_for_review','cancelled')) or
       (old.status = 'ready_for_review'  and new.status in ('needs_correction','awaiting_approval')) or
       (old.status = 'awaiting_approval' and new.status in ('approved','needs_correction')) or
       (old.status = 'approved'          and new.status in ('issued','needs_correction'))) then
    raise exception 'FINANCE_SHEET_STATUS_TRANSITION' using errcode = 'P0001';
  end if;
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    delete from public.finance_work_order_allocations where sheet_id = new.id;
  end if;
  return new;
end $$;
create trigger finance_sheet_status_guard_bud before update or delete on public.finance_billing_sheets for each row execute function public.finance_sheet_status_guard();
-- the allocation cleanup above runs with the caller's rights, so it is only reachable through the definer functions below
-- (authenticated users have no UPDATE privilege on the sheet table).

-- ───────────────────────── 6. Row level security: read for office accounts, writes only through functions ─────────────────────────
alter table public.finance_intake_records enable row level security;
alter table public.finance_intake_receipts enable row level security;
alter table public.finance_trn_register_verifications enable row level security;
alter table public.finance_trn_register enable row level security;
alter table public.finance_billing_sheets enable row level security;
alter table public.finance_billing_sheet_papers enable row level security;
alter table public.finance_work_order_allocations enable row level security;
alter table public.finance_billing_sheet_lines enable row level security;
alter table public.finance_billing_sheet_extras enable row level security;
alter table public.finance_billing_sheet_revisions enable row level security;
alter table public.finance_billing_sheet_approvals enable row level security;
alter table public.finance_billing_sheet_events enable row level security;
revoke all on public.finance_intake_records, public.finance_intake_receipts, public.finance_trn_register_verifications, public.finance_trn_register,
  public.finance_billing_sheets, public.finance_billing_sheet_papers, public.finance_work_order_allocations, public.finance_billing_sheet_lines,
  public.finance_billing_sheet_extras, public.finance_billing_sheet_revisions, public.finance_billing_sheet_approvals, public.finance_billing_sheet_events
  from anon, authenticated;
grant select on public.finance_intake_records, public.finance_intake_receipts, public.finance_trn_register_verifications, public.finance_trn_register,
  public.finance_billing_sheets, public.finance_billing_sheet_papers, public.finance_work_order_allocations, public.finance_billing_sheet_lines,
  public.finance_billing_sheet_extras, public.finance_billing_sheet_revisions, public.finance_billing_sheet_approvals, public.finance_billing_sheet_events
  to authenticated;
create policy finance_intake_office_read on public.finance_intake_records for select to authenticated using (public.is_office_account());
create policy finance_intake_receipts_office_read on public.finance_intake_receipts for select to authenticated using (public.is_office_account());
create policy finance_trn_verifications_office_read on public.finance_trn_register_verifications for select to authenticated using (public.is_office_account());
create policy finance_trn_register_office_read on public.finance_trn_register for select to authenticated using (public.is_office_account());
create policy finance_sheets_office_read on public.finance_billing_sheets for select to authenticated using (public.is_office_account());
create policy finance_sheet_papers_office_read on public.finance_billing_sheet_papers for select to authenticated using (public.is_office_account());
create policy finance_allocations_office_read on public.finance_work_order_allocations for select to authenticated using (public.is_office_account());
create policy finance_sheet_lines_office_read on public.finance_billing_sheet_lines for select to authenticated using (public.is_office_account());
create policy finance_sheet_extras_office_read on public.finance_billing_sheet_extras for select to authenticated using (public.is_office_account());
create policy finance_sheet_revisions_office_read on public.finance_billing_sheet_revisions for select to authenticated using (public.is_office_account());
create policy finance_sheet_approvals_office_read on public.finance_billing_sheet_approvals for select to authenticated using (public.is_office_account());
-- The activity history is not for every office account: finance reviewers, approvers and management only.
create policy finance_sheet_events_finance_read on public.finance_billing_sheet_events for select to authenticated
  using (public.finance_has_capability('finance_reviewer') or public.finance_has_capability('invoice_approver') or public.finance_has_capability('management_reviewer') or public.current_account_role() = 'super_admin');

-- ───────────────────────── 7. The two functions that carry the highest risk (the rest are specified in the plan) ─────────────────────────
-- Super admin verifies the historical TRN high-water mark against the real register BEFORE any number can be allocated.
create function public.finance_verify_trn_register(p_year integer, p_verified_through integer, p_evidence text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if public.current_account_role() is distinct from 'super_admin' then raise exception 'FINANCE_SUPER_ADMIN_REQUIRED' using errcode = '42501'; end if;
  insert into public.finance_trn_register_verifications(trn_year, verified_through_number, evidence_note, verified_by)
    values (p_year, p_verified_through, p_evidence, auth.uid()) returning id into v_id;
  return v_id;
end $$;

-- Concurrency-safe allocation of the next official TRN for an APPROVED sheet. The year's advisory lock serialises every
-- allocation; the unique (trn_year, trn_number) key is the second line of defence. Void numbers are never reused.
create function public.finance_allocate_trn(p_sheet_id uuid, p_year integer default null)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_year integer := coalesce(p_year, extract(year from (now() at time zone 'Asia/Bangkok'))::integer);
  v_status text; v_verified integer; v_max integer; v_next integer; v_register_id uuid; v_text text;
begin
  if not public.finance_has_capability('invoice_approver') then raise exception 'FINANCE_INVOICE_APPROVER_REQUIRED' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('finance_trn_register:' || v_year::text, 0));
  select status into v_status from public.finance_billing_sheets where id = p_sheet_id for update;
  if v_status is null then raise exception 'FINANCE_SHEET_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_status <> 'approved' then raise exception 'FINANCE_SHEET_NOT_APPROVED' using errcode = 'P0001'; end if;
  select max(verified_through_number) into v_verified from public.finance_trn_register_verifications where trn_year = v_year;
  if v_verified is null then raise exception 'FINANCE_TRN_REGISTER_NOT_VERIFIED' using errcode = 'P0001'; end if;
  select coalesce(max(trn_number), 0) into v_max from public.finance_trn_register where trn_year = v_year;
  v_next := greatest(v_verified, v_max) + 1;
  insert into public.finance_trn_register(trn_year, trn_number, status, origin, sheet_id, issued_by)
    values (v_year, v_next, 'issued', 'allocated', p_sheet_id, auth.uid()) returning id, trn_text into v_register_id, v_text;
  update public.finance_billing_sheets set status = 'issued', trn_id = v_register_id where id = p_sheet_id;
  insert into public.finance_billing_sheet_events(sheet_id, actor_id, event_type, details)
    values (p_sheet_id, auth.uid(), 'issued', jsonb_build_object('trn', v_text));
  return v_text;
end $$;

-- Reopen a confirmed sheet for correction. Amounts are untouched; the reason is recorded; later stages are refused.
create function public.finance_reopen_sheet(p_sheet_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_status text;
begin
  if not public.finance_has_capability('finance_reviewer') then raise exception 'FINANCE_REVIEWER_REQUIRED' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'FINANCE_REASON_REQUIRED' using errcode = '22023'; end if;
  select status into v_status from public.finance_billing_sheets where id = p_sheet_id for update;
  if v_status is distinct from 'ready_for_review' then raise exception 'FINANCE_SHEET_NOT_REOPENABLE' using errcode = 'P0001'; end if;
  update public.finance_billing_sheets set status = 'needs_correction', revision = revision + 1 where id = p_sheet_id;
  insert into public.finance_billing_sheet_events(sheet_id, actor_id, event_type, details)
    values (p_sheet_id, auth.uid(), 'reopened', jsonb_build_object('reason', btrim(p_reason)));
end $$;

revoke all on function public.finance_verify_trn_register(integer, integer, text), public.finance_allocate_trn(uuid, integer), public.finance_reopen_sheet(uuid, text) from public, anon;
grant execute on function public.finance_allocate_trn(uuid, integer), public.finance_reopen_sheet(uuid, text), public.finance_verify_trn_register(integer, integer, text) to authenticated;

-- ───────────────────────── 8. Verified pricing evidence (Diesel B7) ─────────────────────────
-- Exact calendar date only. Proposed values never price jobs. Superseded rows are retained for audit.
create table public.finance_fuel_references (
  id uuid primary key default gen_random_uuid(),
  reference_date date not null,
  product text not null default 'Diesel B7' check (product = 'Diesel B7'),
  region text not null default 'Bangkok' check (region = 'Bangkok'),
  price_thb numeric(8,2) not null check (price_thb > 0 and price_thb < 200),
  source_url text not null,
  evidence text not null check (length(btrim(evidence)) >= 10),
  status text not null check (status in ('proposed','verified','disputed')),
  method text not null default 'manual' check (method = 'manual'),
  retrieved_at timestamptz not null default now(),
  recorded_by uuid not null references auth.users(id) on delete restrict,
  verified_by uuid references auth.users(id) on delete restrict,
  verified_at timestamptz,
  dispute_reason text,
  superseded_at timestamptz,
  supersede_reason text,
  constraint finance_fuel_verified_actor check (status <> 'verified' or (verified_by is not null and verified_at is not null)),
  constraint finance_fuel_dispute_reason check (status <> 'disputed' or length(btrim(coalesce(dispute_reason, ''))) >= 10)
);
create unique index finance_fuel_one_active_per_date
  on public.finance_fuel_references (reference_date)
  where superseded_at is null;

-- ───────────────────────── 9. Customer rate mappings (proposed vs owner-approved) ─────────────────────────
create table public.finance_rate_mappings (
  id uuid primary key default gen_random_uuid(),
  schedule_id text not null,
  row_id text not null,
  client_id uuid not null references public.clients(id) on delete restrict,
  source_version text not null,
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  contract_reference text not null check (length(btrim(contract_reference)) >= 3),
  effective_from date not null,
  effective_to date,
  match jsonb not null default '{}'::jsonb,
  review_reason text not null default '',
  review_status text not null check (review_status in ('proposed','approved')),
  confirmed_by uuid not null references auth.users(id) on delete restrict,
  confirmed_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete restrict,
  revoke_reason text,
  constraint finance_rate_effective_window check (effective_to is null or effective_to >= effective_from),
  constraint finance_rate_revoke_reason check (revoked_at is null or length(btrim(coalesce(revoke_reason, ''))) >= 5)
);
create index finance_rate_mappings_client on public.finance_rate_mappings (client_id, review_status) where revoked_at is null;

-- ───────────────────────── 10. Customer billing profiles + change history ─────────────────────────
create table public.finance_customer_billing_profiles (
  id text primary key,
  version integer not null check (version > 0),
  effective_from date not null,
  review_status text not null check (review_status in ('draft','pending_owner_approval','approved','retired')),
  source text not null check (length(btrim(source)) >= 10),
  match_tokens text[] not null check (cardinality(match_tokens) >= 1),
  legal_name_th text not null,
  legal_name_en text,
  billing_address_th text not null,
  billing_address_en text,
  tax_id text not null,
  contact text,
  signature_name text,
  payment_terms text,
  withholding_note text,
  deduction jsonb,
  advance_payment_allowed boolean not null default false,
  invoice_template text not null default 'ees-xls-invoice-v1',
  trn_statement_template text not null default 'ees-trn-statement-v1',
  notes text[] not null default '{}',
  revision integer not null default 1 check (revision > 0),
  updated_by uuid not null references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now()
);
create table public.finance_customer_billing_profile_events (
  id bigint generated always as identity primary key,
  profile_id text not null references public.finance_customer_billing_profiles(id) on delete restrict,
  actor_id uuid not null references auth.users(id) on delete restrict,
  action text not null check (action in ('upsert_draft','submit','approve','retire','reject')),
  from_status text,
  to_status text not null,
  note text not null default '',
  occurred_at timestamptz not null default now()
);
create trigger finance_profile_events_immutable before update or delete on public.finance_customer_billing_profile_events
  for each row execute function public.finance_reject_history_change();

-- ───────────────────────── 11. Document artifact hashes (metadata only) ─────────────────────────
create table public.finance_document_artifacts (
  id uuid primary key default gen_random_uuid(),
  sheet_id uuid references public.finance_billing_sheets(id) on delete restrict,
  revision_id uuid references public.finance_billing_sheet_revisions(id) on delete restrict,
  kind text not null check (kind in ('trn_statement','invoice_draft','invoice_issued','supporting')),
  file_name text not null,
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  byte_length integer not null check (byte_length > 0),
  storage_uri text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

-- ───────────────────────── 12. Simulated TRN namespace (never official) ─────────────────────────
-- Local / rehearsal numbers only. Constrained to never collide with an official register row of the same text.
create table public.finance_simulated_trn_register (
  id uuid primary key default gen_random_uuid(),
  trn_year integer not null check (trn_year between 2000 and 2100),
  trn_number integer not null check (trn_number > 0),
  trn_text text generated always as ('TRN' || lpad(trn_number::text, 3, '0') || '/' || trn_year::text) stored,
  sheet_id uuid references public.finance_billing_sheets(id) on delete restrict,
  allocated_at timestamptz not null default now(),
  unique (trn_year, trn_number),
  unique (trn_text)
);
-- Hard separation: a simulated text must not exist as an official issued TRN.
create function public.finance_reject_simulated_official_collision() returns trigger language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from public.finance_trn_register r where r.trn_text = new.trn_text and r.status = 'issued') then
    raise exception 'FINANCE_TRN_NAMESPACE_COLLISION' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger finance_simulated_trn_collision before insert or update on public.finance_simulated_trn_register
  for each row execute function public.finance_reject_simulated_official_collision();

-- ───────────────────────── 13. Idempotent approval RPC (concurrency + no double approve) ─────────────────────────
create table public.finance_rpc_idempotency (
  scope text not null,
  idempotency_key text not null,
  sheet_id uuid,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (scope, idempotency_key)
);

create function public.finance_approve_sheet(p_sheet_id uuid, p_expected_revision integer, p_note text, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_status text; v_revision integer; v_prior jsonb; v_rev_id uuid;
begin
  if not (public.finance_has_capability('invoice_approver') or public.finance_has_capability('management_reviewer') or public.current_account_role() in ('admin','super_admin')) then
    raise exception 'FINANCE_APPROVER_REQUIRED' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_idempotency_key, ''))) < 8 then raise exception 'FINANCE_IDEMPOTENCY_REQUIRED' using errcode = '22023'; end if;
  select result into v_prior from public.finance_rpc_idempotency where scope = 'approve_sheet' and idempotency_key = p_idempotency_key;
  if v_prior is not null then return v_prior; end if;
  select status, revision into v_status, v_revision from public.finance_billing_sheets where id = p_sheet_id for update;
  if v_status is null then raise exception 'FINANCE_SHEET_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_revision is distinct from p_expected_revision then raise exception 'FINANCE_STALE' using errcode = 'P0001'; end if;
  if v_status not in ('ready_for_review','awaiting_approval') then raise exception 'FINANCE_SHEET_NOT_APPROVABLE' using errcode = 'P0001'; end if;
  insert into public.finance_billing_sheet_revisions(sheet_id, revision_number, action, snapshot, snapshot_sha256, total_thb, created_by)
    values (p_sheet_id, v_revision, 'approved', '{}'::jsonb, repeat('0', 64), 0, auth.uid())
    returning id into v_rev_id;
  insert into public.finance_billing_sheet_approvals(sheet_id, revision_id, decision, reason, decided_by)
    values (p_sheet_id, v_rev_id, 'approved', coalesce(nullif(btrim(p_note), ''), 'Approved'), auth.uid());
  update public.finance_billing_sheets set status = 'approved', revision = revision + 1 where id = p_sheet_id;
  insert into public.finance_billing_sheet_events(sheet_id, actor_id, event_type, details)
    values (p_sheet_id, auth.uid(), 'approved', jsonb_build_object('note', coalesce(p_note, '')));
  v_prior := jsonb_build_object('sheet_id', p_sheet_id, 'status', 'approved', 'revision_id', v_rev_id);
  insert into public.finance_rpc_idempotency(scope, idempotency_key, sheet_id, result) values ('approve_sheet', p_idempotency_key, p_sheet_id, v_prior);
  return v_prior;
end $$;
revoke all on function public.finance_approve_sheet(uuid, integer, text, text) from public, anon;
grant execute on function public.finance_approve_sheet(uuid, integer, text, text) to authenticated;

alter table public.finance_fuel_references enable row level security;
alter table public.finance_rate_mappings enable row level security;
alter table public.finance_customer_billing_profiles enable row level security;
alter table public.finance_customer_billing_profile_events enable row level security;
alter table public.finance_document_artifacts enable row level security;
alter table public.finance_simulated_trn_register enable row level security;
alter table public.finance_rpc_idempotency enable row level security;
revoke all on public.finance_fuel_references, public.finance_rate_mappings, public.finance_customer_billing_profiles,
  public.finance_customer_billing_profile_events, public.finance_document_artifacts, public.finance_simulated_trn_register, public.finance_rpc_idempotency
  from anon, authenticated;
grant select on public.finance_fuel_references, public.finance_rate_mappings, public.finance_customer_billing_profiles,
  public.finance_customer_billing_profile_events, public.finance_document_artifacts, public.finance_simulated_trn_register
  to authenticated;
create policy finance_fuel_office_read on public.finance_fuel_references for select to authenticated using (public.is_office_account());
create policy finance_rate_office_read on public.finance_rate_mappings for select to authenticated using (public.is_office_account());
create policy finance_profiles_office_read on public.finance_customer_billing_profiles for select to authenticated using (public.is_office_account());
create policy finance_profile_events_finance_read on public.finance_customer_billing_profile_events for select to authenticated
  using (public.finance_has_capability('finance_reviewer') or public.finance_has_capability('invoice_approver') or public.current_account_role() in ('admin','super_admin'));
create policy finance_artifacts_office_read on public.finance_document_artifacts for select to authenticated using (public.is_office_account());
create policy finance_simulated_trn_office_read on public.finance_simulated_trn_register for select to authenticated using (public.is_office_account());

commit;
