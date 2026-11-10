-- SUPERSEDED BY docs/fleet-intelligence-persistence-review-only.sql (V4.7). This V4.3 draft is kept only for history. Do not use it.
-- REVIEW ONLY. NOT APPLIED. DO NOT RUN AGAINST ANY DATABASE WITHOUT OWNER APPROVAL.
--
-- Durable audit trail for historical vehicle-location access (journey playback and journey reports).
-- Mirrors the HistoryAuditEvent shape in lib/forth-history-audit.ts. Stores NO coordinates, tokens,
-- credentials, request bodies or addresses: only who, when, which vehicle/device, which window, and the outcome.
--
-- The script ends in ROLLBACK so that pasting it into a SQL console changes nothing.

begin;

create table if not exists public.forth_history_access_audit (
  id              uuid primary key default gen_random_uuid(),
  correlation_id  text not null check (correlation_id ~ '^[A-Za-z0-9-]{8,64}$'),
  occurred_at     timestamptz not null default now(),
  user_id         uuid,                                   -- auth.users id; null when unauthenticated
  role            text check (role in ('super_admin','admin','office_staff','read_only')),
  access_basis    text check (access_basis in ('role_permission','explicit_allowlist')),
  action          text not null check (action in ('playback_points','journey_report')),
  outcome         text not null check (outcome in (
                    'authorised_ready','unauthenticated','denied_no_office_access','denied_playback_permission',
                    'denied_gate_closed','rejected_invalid_request','rejected_device_not_in_fleet',
                    'rejected_ambiguous_device','rate_limited','upstream_unavailable','error')),
  reason          text check (reason ~ '^[a-z0-9_]{1,60}$'),
  http_status     integer,
  device_id       text check (device_id ~ '^[A-Za-z0-9_-]{1,40}$' or device_id = 'invalid'),
  request_date    text,                                   -- YYYY-MM-DD or YYYYMMDD
  window_start    text,                                   -- HH:mm or YYYYMMDDHHmmss
  window_end      text,
  observation_count integer check (observation_count is null or observation_count >= 0)
);

create index if not exists forth_history_access_audit_time_idx on public.forth_history_access_audit (occurred_at desc);
create index if not exists forth_history_access_audit_user_idx on public.forth_history_access_audit (user_id, occurred_at desc);

-- Append-only: only the server (service role) inserts; administrators may read; nobody updates or deletes through the API.
alter table public.forth_history_access_audit enable row level security;

-- V4.5 CORRECTION: the V4.3 draft used public.profiles(id, role). That table does NOT exist (checked against the live project and all repo
-- migrations, 2026-11-06). The role source is public.account_access(user_id, role, status). Reads use the existing SECURITY DEFINER helper
-- public.is_account_admin(), defined in supabase/migrations/20260723_admin_user_management.sql; confirm it exists live before approval
-- (see docs/fleet-intelligence-persistence-review.md, section "Checks the owner runs first"). The full, current proposal for this table is in
-- docs/fleet-intelligence-persistence-review-only.sql (table B). Prefer that file.
create policy forth_history_audit_admin_read on public.forth_history_access_audit
  for select to authenticated using (public.is_account_admin());
-- No insert/update/delete policies: the service role bypasses RLS for inserts; everyone else is denied.

-- Retention suggestion (owner to decide): keep 400 days, then archive. Not scheduled here.

rollback;  -- review only: remove this line ONLY after written owner approval of the migration.
