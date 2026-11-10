-- REVISION 2 CORRECTIVE PROPOSAL ONLY. Never executed. V1 preserved alongside this file.
-- Prerequisite for review: approved btree_gist extension for text/range exclusions.
-- This file DOES NOT install extensions. No grants, deploy or production approval implied.
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
  CONSTRAINT calculation_v1_scope UNIQUE(vehicle_id,bangkok_day,input_manifest_hash,algorithm_version)
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

-- Corrective amendments. These modify only the proposed new schema in this rollback transaction.
ALTER TABLE fleet_intelligence.device_mapping
 ADD CONSTRAINT device_validity_no_overlap EXCLUDE USING gist
 (device_id WITH =, tstzrange(valid_from,valid_to,'[)') WITH &&),
 ADD CONSTRAINT vehicle_validity_no_overlap EXCLUDE USING gist
 (vehicle_id WITH =, tstzrange(valid_from,valid_to,'[)') WITH &&);
CREATE INDEX mapping_vehicle_time ON fleet_intelligence.device_mapping(vehicle_id,valid_from,valid_to);

CREATE TABLE fleet_intelligence.source_request (
 id uuid PRIMARY KEY,
 provider_account_key text NOT NULL,
 endpoint text NOT NULL,
 request_scope_hash text NOT NULL CHECK(length(request_scope_hash)=64),
 captured_at timestamptz NOT NULL,
 window_start timestamptz,
 window_end timestamptz,
 source_timezone text NOT NULL,
 timezone_evidence_reference text,
 http_status integer NOT NULL CHECK(http_status BETWEEN 100 AND 599),
 media_type text NOT NULL,
 response_bytes bigint NOT NULL CHECK(response_bytes>=0),
 payload_hash text NOT NULL CHECK(length(payload_hash)=64),
 schema_version text NOT NULL,
 normalization_version text NOT NULL,
 completeness text NOT NULL CHECK(completeness IN ('complete','incomplete','unknown')),
 pagination_state jsonb,
 retention_deadline timestamptz,
 legal_hold boolean NOT NULL DEFAULT false,
 CHECK(window_end IS NULL OR window_start IS NOT NULL AND window_end>window_start)
);
-- Hashes identify allowlisted evidence, not credentials. No authorization headers may be stored.
ALTER TABLE fleet_intelligence.sync_window
 ADD COLUMN provider_account_key text NOT NULL REFERENCES fleet_intelligence.provider_budget(account_key),
 ADD COLUMN policy_hash text NOT NULL CHECK(length(policy_hash)=64),
 ADD COLUMN normalization_version text NOT NULL,
 ADD COLUMN lease_generation bigint NOT NULL DEFAULT 0 CHECK(lease_generation>=0),
 ADD COLUMN last_committed_request uuid REFERENCES fleet_intelligence.source_request(id),
 ADD CONSTRAINT sync_scope UNIQUE(provider_account_key,mapping_id,window_start,window_end,policy_hash,normalization_version);
CREATE INDEX sync_recovery ON fleet_intelligence.sync_window(status,retry_after,window_start);
CREATE INDEX sync_expired_lease ON fleet_intelligence.sync_window(lease_until) WHERE status='running';
-- Future transactional RPC must compare lease_token AND generation AND expiry on commit/fail/release.
-- source_request + raw memberships + derived revision + cursor commit atomically. Not implemented here.

ALTER TABLE fleet_intelligence.raw_observation
 ADD COLUMN coordinate_status text NOT NULL CHECK(coordinate_status IN ('valid','invalid','missing')),
 ADD COLUMN position_source_raw text,
 ADD COLUMN gps_signal_raw text,
 ADD COLUMN source_timezone text NOT NULL,
 ADD COLUMN normalization_version text NOT NULL,
 ADD COLUMN distance_raw numeric,
 ADD COLUMN distance_semantics text NOT NULL DEFAULT 'unknown' CHECK(distance_semantics IN ('unknown','incremental','cumulative')),
 ADD COLUMN distance_unit text,
 ADD COLUMN distance_contract_reference text,
 ADD COLUMN authenticity text NOT NULL CHECK(authenticity IN ('authenticated_capture','unverified_input')),
 ADD COLUMN gps_quality text NOT NULL CHECK(gps_quality IN ('verified','unverified','invalid','unknown')),
 ADD CONSTRAINT raw_resolution_identity UNIQUE(evidence_hash,device_id,source_timestamp_utc),
 ADD CONSTRAINT raw_distance_contract CHECK(distance_semantics='unknown' OR (distance_unit IS NOT NULL AND distance_contract_reference IS NOT NULL));
CREATE TABLE fleet_intelligence.request_observation (
 request_id uuid NOT NULL REFERENCES fleet_intelligence.source_request(id),
 row_ordinal integer NOT NULL CHECK(row_ordinal>=0),
 evidence_hash text NOT NULL REFERENCES fleet_intelligence.raw_observation(evidence_hash),
 PRIMARY KEY(request_id,row_ordinal)
);
CREATE INDEX request_observation_evidence ON fleet_intelligence.request_observation(evidence_hash);
ALTER TABLE fleet_intelligence.observation_resolution
 ADD COLUMN is_current boolean NOT NULL DEFAULT true,
 ADD CONSTRAINT resolved_observation_identity FOREIGN KEY(selected_evidence_hash,device_id,source_timestamp_utc)
 REFERENCES fleet_intelligence.raw_observation(evidence_hash,device_id,source_timestamp_utc);
CREATE UNIQUE INDEX one_current_observation_resolution ON fleet_intelligence.observation_resolution(device_id,source_timestamp_utc) WHERE is_current;

CREATE TABLE fleet_intelligence.provider_report_row (
 id uuid PRIMARY KEY,
 request_id uuid NOT NULL REFERENCES fleet_intelligence.source_request(id),
 row_ordinal integer NOT NULL CHECK(row_ordinal>=0),
 row_kind text NOT NULL CHECK(row_kind IN ('header','segment','total','invalid','foreign')),
 device_id text,
 registration_raw text,
 date_raw text,
 start_raw text,
 end_raw text,
 start_at timestamptz,
 end_at timestamptz,
 segment_state text NOT NULL CHECK(segment_state IN ('closed','open','not_applicable','invalid')),
 distance_raw text,
 distance_km numeric CHECK(distance_km>=0 AND distance_km<'Infinity'::numeric),
 distance_semantics text NOT NULL DEFAULT 'provider_reported',
 allowlisted_fields jsonb NOT NULL,
 semantic_hash text NOT NULL CHECK(length(semantic_hash)=64),
 UNIQUE(request_id,row_ordinal),
 CHECK(end_at IS NULL OR start_at IS NOT NULL AND end_at>=start_at)
);
CREATE INDEX provider_rows_scope ON fleet_intelligence.provider_report_row(device_id,start_at);
CREATE INDEX provider_semantic_hash ON fleet_intelligence.provider_report_row(semantic_hash);
-- Reconciliation includes only deduplicated exact-device/day segment rows.
-- Closed positive-distance segments must not overlap. Open nonzero or conflicting rows withhold the additive total.

CREATE TABLE fleet_intelligence.source_snapshot (
 id uuid PRIMARY KEY,
 source_table text NOT NULL CHECK(source_table IN ('booking_diary','fuel_logs','weekly_mileage')),
 source_record_id text NOT NULL,
 source_key_type text NOT NULL,
 payload_hash text NOT NULL CHECK(length(payload_hash)=64),
 captured_at timestamptz NOT NULL,
 source_created_at timestamptz,
 source_updated_at timestamptz,
 supported_columns text[] NOT NULL,
 allowlisted_fields jsonb NOT NULL,
 retention_deadline timestamptz,
 legal_hold boolean NOT NULL DEFAULT false,
 UNIQUE(source_table,source_record_id,payload_hash)
);
CREATE TABLE fleet_intelligence.odometer_checkpoint (
 id uuid PRIMARY KEY,
 snapshot_id uuid NOT NULL UNIQUE REFERENCES fleet_intelligence.source_snapshot(id),
 vehicle_id text NOT NULL,
 registration_raw text NOT NULL,
 source_kind text NOT NULL CHECK(source_kind IN ('fuel_logs','weekly_mileage')),
 source_observation_date date NOT NULL,
 observation_date_basis text NOT NULL CHECK(observation_date_basis IN ('reported_refuel_date','week_ending_proxy','confirmed_reading_date')),
 observed_at timestamptz,
 observation_earliest timestamptz NOT NULL,
 observation_latest timestamptz NOT NULL,
 entered_at timestamptz NOT NULL,
 odometer_raw text,
 odometer_km numeric CHECK(odometer_km>=0 AND odometer_km<'Infinity'::numeric),
 meter_epoch text NOT NULL,
 epoch_status text NOT NULL CHECK(epoch_status IN ('unconfirmed','confirmed','replacement','reset','bad_entry')),
 is_baseline boolean,
 identity_status text NOT NULL CHECK(identity_status IN ('confirmed','registration_only','ambiguous')),
 review_status text NOT NULL CHECK(review_status IN ('unreviewed','confirmed','rejected','superseded')),
 full_tank_status text NOT NULL DEFAULT 'unknown' CHECK(full_tank_status IN ('confirmed','not_full','unknown','unsupported')),
 fuel_type_raw text,
 purchased_litres numeric CHECK(purchased_litres>=0),
 purchase_cost_thb numeric CHECK(purchase_cost_thb>=0),
 UNIQUE(id,vehicle_id,source_kind,meter_epoch),
 CHECK(observation_latest>=observation_earliest),
 CHECK(observed_at IS NULL OR observed_at BETWEEN observation_earliest AND observation_latest)
);
-- NULL is unsupported/unknown baseline capability; do not treat it as a non-baseline reading.
CREATE INDEX checkpoint_vehicle_source_time ON fleet_intelligence.odometer_checkpoint(vehicle_id,source_kind,source_observation_date,observed_at);
CREATE TABLE fleet_intelligence.odometer_interval (
 id uuid PRIMARY KEY,
 vehicle_id text NOT NULL,
 source_kind text NOT NULL,
 meter_epoch text NOT NULL,
 from_checkpoint uuid NOT NULL,
 to_checkpoint uuid NOT NULL,
 distance_km numeric CHECK(distance_km>=0 AND distance_km<'Infinity'::numeric),
 status text NOT NULL CHECK(status IN ('known','verified_zero','incomplete','unknown','not_applicable')),
 uncertainty_reasons text[] NOT NULL,
 calculation_version text NOT NULL,
 policy_hash text NOT NULL,
 FOREIGN KEY(from_checkpoint,vehicle_id,source_kind,meter_epoch) REFERENCES fleet_intelligence.odometer_checkpoint(id,vehicle_id,source_kind,meter_epoch),
 FOREIGN KEY(to_checkpoint,vehicle_id,source_kind,meter_epoch) REFERENCES fleet_intelligence.odometer_checkpoint(id,vehicle_id,source_kind,meter_epoch),
 UNIQUE(from_checkpoint,to_checkpoint,calculation_version,policy_hash),
 CHECK(from_checkpoint<>to_checkpoint),
 CHECK(status<>'verified_zero' OR distance_km=0),
 CHECK(status NOT IN ('unknown','not_applicable') OR distance_km IS NULL)
);
CREATE TABLE fleet_intelligence.mileage_comparison (
 id uuid PRIMARY KEY,
 vehicle_id text NOT NULL,
 odometer_interval_id uuid REFERENCES fleet_intelligence.odometer_interval(id),
 other_odometer_interval_id uuid REFERENCES fleet_intelligence.odometer_interval(id),
 provider_request_id uuid REFERENCES fleet_intelligence.source_request(id),
 period_start timestamptz NOT NULL,
 period_end timestamptz NOT NULL,
 period_precision text NOT NULL CHECK(period_precision IN ('instant','day','uncertain')),
 status text NOT NULL CHECK(status IN ('within_tolerance','review_required','incomplete','not_comparable')),
 difference_km numeric,
 tolerance_policy_reference text NOT NULL,
 reasons text[] NOT NULL,
 reviewed_by uuid,
 reviewed_at timestamptz,
 CHECK(period_end>period_start),
 CHECK(status NOT IN ('not_comparable','incomplete') OR difference_km IS NULL)
);

ALTER TABLE fleet_intelligence.calculation_run DROP CONSTRAINT calculation_v1_scope;
ALTER TABLE fleet_intelligence.calculation_run
 ADD COLUMN policy_hash text NOT NULL CHECK(length(policy_hash)=64),
 ADD COLUMN normalization_version text NOT NULL,
 ADD COLUMN source_timezone text NOT NULL,
 ADD COLUMN raw_telemetry_seconds numeric CHECK(raw_telemetry_seconds BETWEEN 0 AND 86400),
 ADD COLUMN movement_coverage_seconds numeric CHECK(movement_coverage_seconds BETWEEN 0 AND 86400),
 ADD COLUMN reconciliation_status text NOT NULL CHECK(reconciliation_status IN ('pass','fail','incomplete','not_comparable')),
 ADD CONSTRAINT versioned_calculation UNIQUE(vehicle_id,bangkok_day,input_manifest_hash,algorithm_version,policy_hash,normalization_version),
 ADD CONSTRAINT run_vehicle UNIQUE(id,vehicle_id);
ALTER TABLE fleet_intelligence.interval DROP COLUMN evidence_hashes;
CREATE TABLE fleet_intelligence.interval_evidence (
 run_id uuid NOT NULL,
 interval_key text NOT NULL,
 evidence_hash text NOT NULL REFERENCES fleet_intelligence.raw_observation(evidence_hash),
 PRIMARY KEY(run_id,interval_key,evidence_hash),
 FOREIGN KEY(run_id,interval_key) REFERENCES fleet_intelligence.interval(run_id,interval_key)
);
CREATE INDEX interval_time ON fleet_intelligence.interval(run_id,start_at);
ALTER TABLE fleet_intelligence.journey DROP COLUMN interval_keys;
ALTER TABLE fleet_intelligence.journey
 ADD COLUMN segmentation_version text NOT NULL,
 ADD COLUMN boundary_uncertainty_seconds numeric NOT NULL CHECK(boundary_uncertainty_seconds>=0),
 ADD CONSTRAINT journey_state CHECK(state IN ('moving','stopped','idling','unknown','unavailable')),
 ADD CONSTRAINT journey_run UNIQUE(id,run_id);
CREATE TABLE fleet_intelligence.journey_interval (
 journey_id uuid NOT NULL,
 run_id uuid NOT NULL,
 interval_key text NOT NULL,
 ordinal integer NOT NULL,
 PRIMARY KEY(journey_id,interval_key),
 FOREIGN KEY(journey_id,run_id) REFERENCES fleet_intelligence.journey(id,run_id),
 FOREIGN KEY(run_id,interval_key) REFERENCES fleet_intelligence.interval(run_id,interval_key)
);
CREATE INDEX journey_time ON fleet_intelligence.journey(run_id,start_at);
ALTER TABLE fleet_intelligence.job_match
 ADD COLUMN run_id uuid NOT NULL,
 ADD COLUMN vehicle_id text NOT NULL,
 ADD COLUMN booking_snapshot_id uuid NOT NULL REFERENCES fleet_intelligence.source_snapshot(id),
 ADD CONSTRAINT match_run_vehicle FOREIGN KEY(run_id,vehicle_id) REFERENCES fleet_intelligence.calculation_run(id,vehicle_id),
 ADD CONSTRAINT match_journey_run FOREIGN KEY(journey_id,run_id) REFERENCES fleet_intelligence.journey(id,run_id),
 ADD CONSTRAINT match_run UNIQUE(id,run_id);
CREATE INDEX matches_booking_status ON fleet_intelligence.job_match(booking_id,status);
CREATE INDEX matches_journey_status ON fleet_intelligence.job_match(journey_id,status);
ALTER TABLE fleet_intelligence.allocation_decision
 ADD COLUMN is_current boolean NOT NULL DEFAULT true,
 ADD CONSTRAINT allocation_job_run FOREIGN KEY(job_match_id,run_id) REFERENCES fleet_intelligence.job_match(id,run_id);
CREATE UNIQUE INDEX current_interval_allocation ON fleet_intelligence.allocation_decision(run_id,interval_key) WHERE is_current;

CREATE TABLE fleet_intelligence.fill_to_fill_estimate (
 id uuid PRIMARY KEY,
 vehicle_id text NOT NULL,
 from_checkpoint uuid NOT NULL REFERENCES fleet_intelligence.odometer_checkpoint(id),
 to_checkpoint uuid NOT NULL REFERENCES fleet_intelligence.odometer_checkpoint(id),
 fuel_type text NOT NULL,
 status text NOT NULL CHECK(status IN ('estimated','unknown','incomplete','not_applicable')),
 all_fills_evidence_reference text,
 fuel_type_evidence_reference text,
 mixed_fuel boolean,
 estimated_consumed_litres numeric CHECK(estimated_consumed_litres>0),
 km_per_litre numeric CHECK(km_per_litre>0),
 assumptions jsonb NOT NULL,
 CHECK(status<>'estimated' OR (all_fills_evidence_reference IS NOT NULL AND fuel_type_evidence_reference IS NOT NULL AND mixed_fuel=false AND estimated_consumed_litres IS NOT NULL AND km_per_litre IS NOT NULL)),
 CHECK(from_checkpoint<>to_checkpoint)
);
CREATE TABLE fleet_intelligence.fill_estimate_checkpoint (
 estimate_id uuid NOT NULL REFERENCES fleet_intelligence.fill_to_fill_estimate(id),
 checkpoint_id uuid NOT NULL REFERENCES fleet_intelligence.odometer_checkpoint(id),
 role text NOT NULL CHECK(role IN ('opening_excluded','refill_included','closing_included')),
 PRIMARY KEY(estimate_id,checkpoint_id)
);
ALTER TABLE fleet_intelligence.fuel_evidence
 ALTER COLUMN litres DROP NOT NULL,
 ADD COLUMN snapshot_id uuid REFERENCES fleet_intelligence.source_snapshot(id),
 ADD COLUMN fill_estimate_id uuid REFERENCES fleet_intelligence.fill_to_fill_estimate(id),
 ADD COLUMN evidence_status text NOT NULL CHECK(evidence_status IN ('known','verified_zero','incomplete','unknown','not_applicable')),
 ADD COLUMN source_fuel_type_raw text,
 ADD COLUMN calibration_valid_from timestamptz,
 ADD COLUMN calibration_valid_to timestamptz,
 ADD COLUMN observation_start timestamptz,
 ADD COLUMN observation_end timestamptz,
 ADD COLUMN unit text NOT NULL DEFAULT 'L',
 ADD CONSTRAINT fuel_unknown_null CHECK(evidence_status NOT IN ('unknown','not_applicable') OR litres IS NULL);
CREATE INDEX fuel_scope ON fleet_intelligence.fuel_evidence(vehicle_id,bangkok_day,fuel_kind,method);
ALTER TABLE fleet_intelligence.reporting_snapshot
 ADD COLUMN source_completeness text NOT NULL CHECK(source_completeness IN ('complete','incomplete','unknown')),
 ADD COLUMN superseded_by uuid REFERENCES fleet_intelligence.reporting_snapshot(id),
 ADD CONSTRAINT report_manifest_scope UNIQUE(input_manifest_hash,report_kind,start_day,end_day,calculation_version);
-- Retention deletion must respect legal holds and FK-linked evidence and invalidate unsupported snapshots.
-- Positive finite distances, correct run-day containment, snapshot source-kind and equal-period comparisons
-- must also be validated by the future transactional store before commit. No write adapter is activated here.

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
