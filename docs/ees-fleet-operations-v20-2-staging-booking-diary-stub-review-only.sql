-- REVIEW ONLY. Optional temporary stub for empty staging when Booking Diary
-- full schema is not yet installed. Required because V20 visit events FK
-- public.booking_diary(id). Do not apply on production.
-- Prefer installing the real Booking Diary schema when this project will host booking work.
-- Owner approval required. Additive only.

begin;

create table if not exists public.booking_diary (
  id uuid primary key
);

comment on table public.booking_diary is
  'TEMPORARY staging stub for Fleet V20 FK compatibility. Replace with full Booking Diary schema when available.';

-- Fleet review RPC (service_role) looks up booking ids; authenticated office may read later.
grant select on public.booking_diary to authenticated, service_role;
grant insert, update, delete on public.booking_diary to service_role;

commit;
