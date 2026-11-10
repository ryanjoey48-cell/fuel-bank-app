const assert = require("node:assert/strict");
const test = require("node:test");
const {
  EES_PRODUCTION_SUPABASE_PROJECT_REF,
  EES_DEVELOPMENT_SUPABASE_PROJECT_REF_CANDIDATE,
  EES_PILOT_002_DEPOT_LOCATION_ID,
  extractSupabaseProjectRef,
  classifyEesSupabaseUrl,
  isConfirmedEesProductionUrl,
  assertNotConfirmedProductionForExperimentalSql,
  assertApprovedStagingTarget,
  assertFleetMonitorSupabaseTarget,
  assertFleetMonitorAllowedLocationIds,
  filterGeofencesToLocationAllowlist,
  FleetMonitorDatabaseIsolationError
} = require("../lib/ees-database-environment.cjs");

test("classifies confirmed production and blocks experimental SQL", () => {
  assert.equal(EES_PRODUCTION_SUPABASE_PROJECT_REF, "hafoaurzfgkkwpvzedvd");
  assert.equal(
    extractSupabaseProjectRef("https://hafoaurzfgkkwpvzedvd.supabase.co"),
    "hafoaurzfgkkwpvzedvd"
  );
  assert.equal(classifyEesSupabaseUrl("https://hafoaurzfgkkwpvzedvd.supabase.co"), "CONFIRMED_PRODUCTION");
  assert.equal(isConfirmedEesProductionUrl("https://hafoaurzfgkkwpvzedvd.supabase.co"), true);
  assert.throws(
    () => assertNotConfirmedProductionForExperimentalSql("https://hafoaurzfgkkwpvzedvd.supabase.co"),
    /confirmed EES production/
  );
});

test("recognises recovered EES Development candidate without treating it as production", () => {
  assert.equal(EES_DEVELOPMENT_SUPABASE_PROJECT_REF_CANDIDATE, "wpmnjfncaoogssgpqxek");
  assert.equal(
    classifyEesSupabaseUrl("https://wpmnjfncaoogssgpqxek.supabase.co"),
    "CANDIDATE_STAGING"
  );
  assert.equal(isConfirmedEesProductionUrl("https://wpmnjfncaoogssgpqxek.supabase.co"), false);
  assert.doesNotThrow(() =>
    assertNotConfirmedProductionForExperimentalSql("https://wpmnjfncaoogssgpqxek.supabase.co")
  );
});

test("staging switch requires explicit owner-approved ref and never allows production", () => {
  assert.throws(
    () => assertApprovedStagingTarget("https://hafoaurzfgkkwpvzedvd.supabase.co", "wpmnjfncaoogssgpqxek"),
    /cannot target confirmed production/
  );
  assert.throws(
    () => assertApprovedStagingTarget("https://wpmnjfncaoogssgpqxek.supabase.co", null),
    /Owner-approved staging/
  );
  assert.throws(
    () => assertApprovedStagingTarget("https://wpmnjfncaoogssgpqxek.supabase.co", "otherref"),
    /does not match/
  );
  assert.doesNotThrow(() =>
    assertApprovedStagingTarget("https://wpmnjfncaoogssgpqxek.supabase.co", "wpmnjfncaoogssgpqxek")
  );
});

test("fleet monitor isolation allows only explicit staging allowlist and refuses production/mismatches", () => {
  const staging = "https://wpmnjfncaoogssgpqxek.supabase.co";
  const production = "https://hafoaurzfgkkwpvzedvd.supabase.co";
  assert.deepEqual(
    assertFleetMonitorSupabaseTarget({
      supabaseUrl: staging,
      allowedProjectRef: "wpmnjfncaoogssgpqxek",
      approvedStagingRef: "wpmnjfncaoogssgpqxek"
    }),
    { projectRef: "wpmnjfncaoogssgpqxek" }
  );
  assert.throws(
    () =>
      assertFleetMonitorSupabaseTarget({
        supabaseUrl: production,
        allowedProjectRef: "wpmnjfncaoogssgpqxek",
        approvedStagingRef: "wpmnjfncaoogssgpqxek"
      }),
    FleetMonitorDatabaseIsolationError
  );
  assert.throws(
    () =>
      assertFleetMonitorSupabaseTarget({
        supabaseUrl: null,
        allowedProjectRef: "wpmnjfncaoogssgpqxek",
        approvedStagingRef: "wpmnjfncaoogssgpqxek"
      }),
    /Supabase URL is missing/
  );
  assert.throws(
    () =>
      assertFleetMonitorSupabaseTarget({
        supabaseUrl: staging,
        allowedProjectRef: null,
        approvedStagingRef: "wpmnjfncaoogssgpqxek"
      }),
    /allowlisted project reference is required/
  );
  assert.throws(
    () =>
      assertFleetMonitorSupabaseTarget({
        supabaseUrl: staging,
        allowedProjectRef: "wpmnjfncaoogssgpqxek",
        approvedStagingRef: "otherref1234567890ab"
      }),
    /does not match the allowlisted/
  );
  assert.throws(
    () =>
      assertFleetMonitorSupabaseTarget({
        supabaseUrl: staging,
        allowedProjectRef: "hafoaurzfgkkwpvzedvd",
        approvedStagingRef: "hafoaurzfgkkwpvzedvd"
      }),
    /allowlist cannot include production/
  );
});

test("fleet monitor location allowlist is fail-closed and filters CAL-COMP away from Pilot 002", () => {
  assert.equal(EES_PILOT_002_DEPOT_LOCATION_ID, "cccccccc-dddd-4eee-8fff-000000000002");
  assert.throws(() => assertFleetMonitorAllowedLocationIds(""), /location allowlist is required/);
  assert.throws(() => assertFleetMonitorAllowedLocationIds(null), /location allowlist is required/);
  assert.throws(() => assertFleetMonitorAllowedLocationIds("not-a-uuid"), /invalid location id/);
  assert.deepEqual(assertFleetMonitorAllowedLocationIds(EES_PILOT_002_DEPOT_LOCATION_ID), [
    EES_PILOT_002_DEPOT_LOCATION_ID
  ]);
  const calcomp = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const filtered = filterGeofencesToLocationAllowlist(
    [
      { locationId: calcomp, label: "calcomp" },
      { locationId: EES_PILOT_002_DEPOT_LOCATION_ID, label: "depot" }
    ],
    [EES_PILOT_002_DEPOT_LOCATION_ID]
  );
  assert.deepEqual(filtered.map((z) => z.label), ["depot"]);
});
