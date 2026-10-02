const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("driver portal routes are isolated from the office dashboard shell", () => {
  const driverLayout = read("app/driver/layout.tsx");
  const protectedLayout = read("app/driver/(protected)/layout.tsx");
  assert.doesNotMatch(driverLayout, /TopNavigation|Sidebar/);
  assert.doesNotMatch(protectedLayout, /TopNavigation|Sidebar/);
  assert.match(protectedLayout, /redirect\("\/driver\/login"\)/);
});

test("driver session uses an opaque HttpOnly cookie instead of exposing Supabase tokens", () => {
  const route = read("app/api/driver/session/route.ts");
  const server = read("lib/driver-portal-server.ts");
  assert.match(route, /httpOnly:\s*true/);
  assert.match(route, /sameSite:\s*"lax"/);
  assert.match(server, /randomBytes\(32\)\.toString\("base64url"\)/);
  assert.match(server, /createHash\("sha256"\)/);
  assert.doesNotMatch(route, /access_token|refresh_token/);
});

test("driver jobs are scoped by relational driver id for list and detail queries", () => {
  const server = read("lib/driver-portal-server.ts");
  const matches = server.match(/\.eq\("driver_id", session\.driverId\)/g) ?? [];
  assert.equal(matches.length, 2);
  assert.match(server, /\.eq\("id", bookingId\)[\s\S]*?\.eq\("driver_id", session\.driverId\)/);
});

test("driver job projection excludes office-only financial and note fields", () => {
  const server = read("lib/driver-portal-server.ts");
  const projection = server.slice(server.indexOf("const DRIVER_JOB_SELECT"), server.indexOf("function optionalNumber"));
  assert.doesNotMatch(projection, /notes|cost|price|margin|income|expense|amount/);
  for (const field of ["booking_date", "pickup_time", "pickup_place_id", "dropoff_place_id", "vehicle_registration"]) {
    assert.match(projection, new RegExp(`"${field}"`));
  }
});

test("database migration creates generic account linkage and denies direct driver table access", () => {
  const sql = read("supabase/migrations/20261001100000_driver_portal_phase_1.sql");
  assert.match(sql, /auth_user_id uuid not null unique references auth\.users/);
  assert.match(sql, /format_type\(a\.atttypid, a\.atttypmod\)/);
  assert.match(sql, /add column if not exists driver_id %s unique references public\.drivers/);
  assert.match(sql, /create role driver_portal nologin noinherit/);
  assert.match(sql, /revoke usage on schema public from driver_portal/);
  assert.match(sql, /revoke all on public\.driver_accounts from anon, authenticated, driver_portal/);
  assert.match(sql, /claims := jsonb_set\(claims, '\{role\}', to_jsonb\('driver_portal'/);
});

test("booking assignment preserves display text and stores a unique driver id", () => {
  const page = read("app/(dashboard)/booking-diary/page.tsx");
  const data = read("lib/data.ts");
  assert.match(page, /driver_id: driverIdByName\.get\(form\.driver\.trim\(\)\.toLocaleLowerCase\(\)\) \?\? null/);
  assert.match(page, /driver: form\.driver/);
  assert.match(data, /driver_id: rest\.driver_id \?\? null/);
  assert.match(data, /BOOKING_DIARY_ROUTE_COLUMNS[\s\S]*?"driver_id"/);
});

test("linked driver accounts are blocked from the office account resolver", () => {
  const server = read("lib/admin-user-management-server.ts");
  const dashboard = read("app/(dashboard)/layout.tsx");
  assert.match(server, /Driver accounts must use the driver portal/);
  assert.match(dashboard, /router\.replace\("\/driver"\)/);
});

test("normal login resolves driver precedence before choosing an office route", () => {
  const form = read("components/auth-form.tsx");
  const route = read("app/api/auth/login-routing/route.ts");
  assert.match(form, /resolveLoginRouting\(\s*verifiedSession\.access_token\s*\)/);
  assert.match(form, /routing\.accountType === "driver"/);
  assert.match(form, /router\.replace\("\/driver"\)/);
  assert.match(route, /findActiveDriverAccount\(admin, user\.id\)/);
  assert.match(route, /createDriverPortalSessionForAuthUser\(user\.id\)/);
});

test("dashboard checks authoritative routing before rendering office navigation", () => {
  const layout = read("app/(dashboard)/layout.tsx");
  const routingIndex = layout.indexOf("resolveLoginRouting(data.session!.access_token)");
  const navigationIndex = layout.indexOf("<TopNavigation />");
  assert.ok(routingIndex > -1);
  assert.ok(navigationIndex > routingIndex);
  assert.match(layout, /refresh\(\{ force: true \}\)/);
  assert.match(layout, /window\.location\.replace\("\/driver"\)/);
});

test("office access state is never cached across authenticated users", () => {
  const provider = read("lib/use-account-access.ts");
  assert.doesNotMatch(provider, /cachedAccessResult|ACCESS_TTL_MS|pendingAccessRequest/);
  assert.match(provider, /fetchCurrentAccess\(\)/);
});

test("driver cookie blocks direct office-route navigation before React renders", () => {
  const middleware = read("middleware.ts");
  for (const route of ["dashboard", "booking-diary", "fleet", "fuel", "reports", "admin"]) {
    assert.match(middleware, new RegExp(`"/${route}(?:/:path\\*)?"`));
  }
  assert.match(middleware, /request\.cookies\.has\(DRIVER_SESSION_COOKIE\)/);
  assert.match(middleware, /NextResponse\.redirect\(new URL\("\/driver"/);
});

test("driver workflow still excludes live tracking and proof-of-delivery controls", () => {
  const components = [
    read("components/driver/driver-home.tsx"),
    read("components/driver/driver-job-detail.tsx")
  ].join("\n");
  // Sequential progress is now intentionally supported; POD and live tracking remain out of scope.
  assert.match(components, /Complete job/);
  assert.doesNotMatch(components, /upload pod|proof of delivery|live tracking/i);
});
