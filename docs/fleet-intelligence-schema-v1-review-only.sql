-- PROPOSAL ONLY. Not a migration; never executed by this implementation.
-- Dedicated schema, no grants, no triggers or foreign keys into EES business tables.
-- Review retention, identity types, service roles and backup/restore before approval.
BEGIN;
CREATE SCHEMA fleet_intelligence;
REVOKE ALL ON SCHEMA fleet_intelligence FROM PUBLIC;

CREATE TABLE fleet_intelligence.device_mapping (
  id uuid PRIMARY KEY,
  vehicle_id text NOT NULL,
  device_id text NOT NULL,
  registration_snapshot text NOT NULL,
  valid_from timestamptz NOT NULL,
  valid_to timestamptz,
  confirmed_by uuid NOT NULL,
  evidence_reference text NOT NULL,
  CHECK (valid_to IS NULL OR valid_to > valid_from),
  UNIQUE (device_id, valid_from)
);
-- Approval prerequisite: mapping writer must serialize by device AND vehicle,
-- reject overlapping validity ranges, and retain prior mapping revisions.

CREATE TABLE fleet_intelligence.sync_window (
  scope_hash text PRIMARY KEY CHECK (length(scope_hash)=64),
  mapping_id uuid NOT NULL REFERENCES fleet_intelligence.device_mapping(id),
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','running','complete','incomplete','failed')),
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt>=0),
  lease_token uuid,
  lease_until timestamptz,
  retry_after timestamptz,
  cursor jsonb,
  last_error_code text,
  provider_contract_reference text NOT NULL,
  fetched_at timestamptz,
  CHECK (window_end>window_start)
);
CREATE TABLE fleet_intelligence.provider_budget (
  account_key text PRIMARY KEY,
  next_request_at timestamptz NOT NULL,
  paused_until timestamptz,
  contract_reference text NOT NULL
);
-- Store implementation must acquire budget+lease atomically, use fencing tokens,
-- and reject commits from an expired/replaced lease. No process-local production lock.

CREATE TABLE fleet_intelligence.raw_observation (
  evidence_hash text PRIMARY KEY CHECK (length(evidence_hash)=64),
  device_id text NOT NULL,
  source_timestamp_raw text,
  source_timestamp_utc timestamptz,
  received_at timestamptz NOT NULL,
  allowlisted_fields jsonb NOT NULL CHECK (jsonb_typeof(allowlisted_fields)='object')
);
CREATE INDEX raw_device_time ON fleet_intelligence.raw_observation(device_id, source_timestamp_utc);
CREATE TABLE fleet_intelligence.window_evidence (
  scope_hash text NOT NULL REFERENCES fleet_intelligence.sync_window(scope_hash),
  evidence_hash text NOT NULL REFERENCES fleet_intelligence.raw_observation(evidence_hash),
  PRIMARY KEY (scope_hash,evidence_hash)
);
-- Immutable raw revisions: never overwrite same-time corrections. Explicit office/provider
-- resolution selects a revision for calculation; unresolved conflicts produce unknown intervals.
CREATE TABLE fleet_intelligence.observation_resolution (
  id uuid PRIMARY KEY,
  device_id text NOT NULL,
  source_timestamp_utc timestamptz NOT NULL,
  selected_evidence_hash text NOT NULL REFERENCES fleet_intelligence.raw_observation(evidence_hash),
  supersedes uuid REFERENCES fleet_intelligence.observation_resolution(id),
  reviewed_by uuid NOT NULL,
  reviewed_at timestamptz NOT NULL,
  evidence_reference text NOT NULL
);
CREATE TABLE fleet_intelligence.calculation_run (
  id uuid PRIMARY KEY,
  vehicle_id text NOT NULL,
  bangkok_day date NOT NULL,
  input_manifest_hash text NOT NULL,
  algorithm_version text NOT NULL,
  policy jsonb NOT NULL,
  observed_km numeric CHECK (observed_km>=0),
  covered_seconds numeric NOT NULL CHECK (covered_seconds BETWEEN 0 AND 86400),
  invalid_timestamp_count integer NOT NULL CHECK (invalid_timestamp_count>=0),
  created_at timestamptz NOT NULL,
  supersedes uuid REFERENCES fleet_intelligence.calculation_run(id),
  UNIQUE(vehicle_id,bangkok_day,input_manifest_hash,algorithm_version)
);
CREATE TABLE fleet_intelligence.interval (
  run_id uuid NOT NULL REFERENCES fleet_intelligence.calculation_run(id),
  interval_key text NOT NULL,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  state text NOT NULL CHECK (state IN ('moving','stopped','idling','unknown','unavailable')),
  distance_km numeric CHECK(distance_km>=0),
  method text NOT NULL CHECK(method IN ('gps_chord','validated_counter','none')),
  reason text,
  evidence_hashes text[] NOT NULL,
  PRIMARY KEY(run_id,interval_key),
  CHECK(end_at>start_at),
  CHECK((method='none' AND distance_km IS NULL) OR (method<>'none' AND distance_km IS NOT NULL))
);
CREATE TABLE fleet_intelligence.journey (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES fleet_intelligence.calculation_run(id),
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  state text NOT NULL,
  interval_keys text[] NOT NULL,
  observed_km numeric CHECK(observed_km>=0),
  CHECK(end_at>start_at)
);
CREATE TABLE fleet_intelligence.job_match (
  id uuid PRIMARY KEY,
  journey_id uuid NOT NULL REFERENCES fleet_intelligence.journey(id),
  booking_id text NOT NULL,
  booking_snapshot_hash text NOT NULL,
  booking_evidence jsonb NOT NULL,
  score integer NOT NULL CHECK(score BETWEEN 0 AND 100),
  reasons text[] NOT NULL,
  status text NOT NULL CHECK(status IN ('suggested','confirmed','rejected','superseded')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  CHECK(status<>'confirmed' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))
);
CREATE TABLE fleet_intelligence.allocation_decision (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL,
  interval_key text NOT NULL,
  kind text NOT NULL CHECK(kind IN ('depot','job','repositioning')),
  job_match_id uuid REFERENCES fleet_intelligence.job_match(id),
  reviewed_by uuid NOT NULL,
  reviewed_at timestamptz NOT NULL,
  evidence_reference text NOT NULL,
  supersedes uuid REFERENCES fleet_intelligence.allocation_decision(id),
  FOREIGN KEY(run_id,interval_key) REFERENCES fleet_intelligence.interval(run_id,interval_key),
  CHECK(kind<>'job' OR job_match_id IS NOT NULL)
);
-- Read model selects current decisions; more than one current decision => unassigned.
CREATE TABLE fleet_intelligence.fuel_evidence (
  id uuid PRIMARY KEY,
  vehicle_id text NOT NULL,
  bangkok_day date NOT NULL,
  fuel_kind text NOT NULL CHECK(fuel_kind IN ('diesel','petrol','lpg')),
  method text NOT NULL CHECK(method IN ('purchased','measured','estimated')),
  litres numeric NOT NULL CHECK(litres>=0),
  cost_thb numeric CHECK(cost_thb>=0),
  source_reference text NOT NULL,
  input_evidence jsonb NOT NULL,
  validated_efficiency_reference text,
  valuation_reference text,
  CHECK(method<>'estimated' OR validated_efficiency_reference IS NOT NULL)
);
CREATE TABLE fleet_intelligence.reporting_snapshot (
  id uuid PRIMARY KEY,
  input_manifest_hash text NOT NULL,
  report_kind text NOT NULL,
  start_day date NOT NULL,
  end_day date NOT NULL,
  calculation_version text NOT NULL,
  reconciliation jsonb NOT NULL,
  totals jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  CHECK(end_day>=start_day)
);

-- Deny all browser access. No role policies/grants are proposed until deployment review.
DO $$ DECLARE t record; BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='fleet_intelligence' LOOP
    EXECUTE format('ALTER TABLE fleet_intelligence.%I ENABLE ROW LEVEL SECURITY',t.tablename);
    EXECUTE format('ALTER TABLE fleet_intelligence.%I FORCE ROW LEVEL SECURITY',t.tablename);
    EXECUTE format('REVOKE ALL ON fleet_intelligence.%I FROM PUBLIC',t.tablename);
  END LOOP;
END $$;
-- Deliberate review rollback: operator must prepare a separately approved migration.
ROLLBACK;
