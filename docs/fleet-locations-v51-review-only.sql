-- REVIEW ONLY. NOT EXECUTED. DO NOT RUN WITHOUT THE OWNER NAMING THE EXACT TARGET AND CHANGE IN WRITING.
-- V5.1 smart customer locations: review-only extension of the existing Locations Directory pin model.
-- TARGET: project ref hafoaurzfgkkwpvzedvd ("Fuel Tracker App", CONFIRMED PRODUCTION). Needs a Development rehearsal on a faithful copy first
-- (the current Development project does not contain these tables). Apply only after Stage 1 security work and its own approval.
--
-- WHAT EXISTS TODAY (read-only audit, 2026-11-07)
--   public.ees_locations (103 rows): company_name, thai_name, alternative_names, address, province, destination_type, google_maps_url, truck_entrance_url,
--     verification_status in ('verified','needs_check') with verified_at, notes, source_info.
--   public.ees_location_map_pins (0 rows): UNIQUE (location_id, pin_type); pin_type in ('destination','truck_entrance'); pin_status = 'manual_confirmed' ONLY;
--     latitude/longitude range checks; coordinate_source (1-500 chars); source_reference; created_by/at; confirmed_by/at; updated_by/at.
--   public.ees_location_map_pin_history: insert/update/delete audit with old and new values and changed_by context (auditor-only INSERT policy).
--   Office-only RLS policies exist on all three.
--   No booking carries a pickup_location_id for Sirtec/CAL-COMP; Sirtec has no directory entry.
--
-- WHAT IS MISSING FOR V5.1 AND WHAT THIS PROPOSES (additive, nothing dropped, no data rewritten, no row marked verified automatically)
--   1. A 'loading_point' pin type, and more than one pin per type for sites with several entrances or bays (the UNIQUE (location_id, pin_type) must become
--      UNIQUE (location_id, pin_type, label)).
--   2. Statuses: verified_by_office, candidate_awaiting_review, needs_verification, rejected_invalid (today only manual_confirmed exists; it maps to verified_by_office).
--   3. Per-pin detection boundary (radius in metres, capped), vehicle-class restriction, evidence notes, last_reviewed_at.
--   4. Candidate pins that come from stop clusters: they are created ONLY by an office user choosing "propose this pin", never by the system, and are never used for matching.
--   5. Provenance history is already covered by the existing history table; it must be extended for the new columns.
-- The application (lib/fleet-location-priority.ts) already understands these shapes; until this is approved only the existing two pin types are read.

begin;
set local lock_timeout = '5s';

do $guard$
begin
  if current_setting('server_version_num')::int < 170000 then raise exception 'unexpected Postgres version: stop'; end if;
  if to_regclass('public.ees_location_map_pins') is null or to_regclass('public.ees_location_map_pin_history') is null then raise exception 'pin tables missing: this is not the audited database: stop'; end if;
  if (select count(*) from public.ees_location_map_pins) <> 0 then raise exception 'pins already exist: re-audit before changing the model: stop'; end if;
end
$guard$;

-- 1. Pin type, label and uniqueness.
alter table public.ees_location_map_pins drop constraint if exists ees_location_map_pins_pin_type_check;
alter table public.ees_location_map_pins add constraint ees_location_map_pins_pin_type_check check (pin_type in ('destination', 'truck_entrance', 'loading_point'));
alter table public.ees_location_map_pins add column if not exists label text not null default '';
alter table public.ees_location_map_pins add constraint ees_location_map_pins_label_len check (length(label) <= 80);
alter table public.ees_location_map_pins drop constraint if exists ees_location_map_pins_location_id_pin_type_key;
alter table public.ees_location_map_pins add constraint ees_location_map_pins_location_type_label_key unique (location_id, pin_type, label);

-- 2. Status: the old value is kept readable as an alias of verified_by_office. No existing row is changed (there are none).
alter table public.ees_location_map_pins drop constraint if exists ees_location_map_pins_pin_status_check;
alter table public.ees_location_map_pins add constraint ees_location_map_pins_pin_status_check
  check (pin_status in ('manual_confirmed', 'verified_by_office', 'candidate_awaiting_review', 'needs_verification', 'rejected_invalid'));

-- 3. Boundary, vehicle classes, evidence and review time.
alter table public.ees_location_map_pins add column if not exists radius_meters integer;
alter table public.ees_location_map_pins add constraint ees_location_map_pins_radius_range check (radius_meters is null or radius_meters between 25 and 1000);
alter table public.ees_location_map_pins add column if not exists vehicle_classes text[];
alter table public.ees_location_map_pins add constraint ees_location_map_pins_vehicle_classes_len check (vehicle_classes is null or cardinality(vehicle_classes) <= 8);
alter table public.ees_location_map_pins add column if not exists evidence_notes text;
alter table public.ees_location_map_pins add constraint ees_location_map_pins_evidence_len check (evidence_notes is null or length(evidence_notes) <= 2000);
alter table public.ees_location_map_pins add column if not exists last_reviewed_at timestamptz;

-- 4. Verified pins must say who verified them and when; candidate and rejected pins must not pretend to be verified.
alter table public.ees_location_map_pins add constraint ees_location_map_pins_verified_has_reviewer
  check (pin_status not in ('manual_confirmed', 'verified_by_office') or (confirmed_by is not null and confirmed_at is not null));

-- 5. History: carry the new fields so changes to a boundary or a status stay auditable.
alter table public.ees_location_map_pin_history drop constraint if exists ees_location_map_pin_history_pin_type_check;
alter table public.ees_location_map_pin_history add constraint ees_location_map_pin_history_pin_type_check check (pin_type in ('destination', 'truck_entrance', 'loading_point'));
alter table public.ees_location_map_pin_history add column if not exists old_radius_meters integer, add column if not exists new_radius_meters integer;
-- The existing audit trigger function must be reviewed and extended to write these two columns and the new statuses; do not drop it.

-- Validation after a rehearsal: select pin_type, pin_status, count(*) from public.ees_location_map_pins group by 1, 2;  (empty on first run)
-- Rollback (no data to lose while the table is empty): drop the added constraints and columns, restore the original pin_type/pin_status checks and UNIQUE (location_id, pin_type).
rollback;  -- REVIEW ONLY: replace with COMMIT only after written approval of this exact target and change.
