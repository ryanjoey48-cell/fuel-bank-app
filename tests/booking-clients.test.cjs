const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

function loadTypeScriptModule(relativePath) {
  const filename = path.resolve(relativePath);
  const source = fs.readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded._compile(compiled, filename);
  return loaded.exports;
}

const { normalizeClientName, normalizedClientKey } = loadTypeScriptModule("lib/clients.ts");

test("client names normalize Unicode and whitespace without fuzzy matching", () => {
  assert.equal(normalizeClientName("  ACME   Logistics  "), "ACME Logistics");
  assert.equal(normalizedClientKey("ACME Logistics"), normalizedClientKey(" acme   logistics "));
  assert.equal(normalizedClientKey("บริษัท เอ บี ซี"), normalizedClientKey("  บริษัท   เอ บี ซี "));
  assert.notEqual(normalizedClientKey("ACME Co"), normalizedClientKey("ACME Company"));
});

test("client migration preserves history and enforces safe new-booking rules", () => {
  const migration = fs.readFileSync(path.resolve("supabase/migrations/20260720_add_booking_clients.sql"), "utf8");
  assert.match(migration, /add column if not exists client_id uuid/i);
  assert.match(migration, /on delete restrict/i);
  assert.match(migration, /tg_op = 'INSERT' and new\.client_id is null/i);
  assert.match(migration, /new\.client_id is distinct from old\.client_id/i);
  assert.match(migration, /where id = new\.client_id\s+and active = true/i);
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /clients_update_admin/i);
  assert.match(migration, /Internal \/ Other/i);
  assert.doesNotMatch(migration, /update\s+public\.booking_diary\s+set\s+client_id/i);
});

test("Booking Diary UI carries clients through create, duplicate, search, filters, display, and export", () => {
  const page = fs.readFileSync(path.resolve("app/(dashboard)/booking-diary/page.tsx"), "utf8");
  assert.match(page, /client_id:\s*form\.client_id \|\| null/);
  assert.match(page, /const isNewBooking = !targetId/);
  assert.match(page, /selectedClient\.active/);
  assert.match(page, /bookingClientName\(booking\)/);
  assert.match(page, /value=\{clientFilter\}/);
  assert.match(page, /\[copy\.clientName\]: bookingClientName/);
  assert.match(page, /<ClientSelector/);
  assert.match(page, /<ClientDirectoryDialog/);
});

test("zero-use client deletion is atomic, admin-only, and checks every foreign key before delete", () => {
  const migration = fs.readFileSync(path.resolve("supabase/migrations/20260721_delete_unused_booking_clients.sql"), "utf8");
  const permissionCheck = migration.indexOf("Admin permission required to manage clients.");
  const rowLock = migration.indexOf("for update;");
  const protectedCheck = migration.indexOf("Internal / Other cannot be deleted.");
  const bookingCheck = migration.indexOf("used by bookings");
  const foreignKeyScan = migration.lastIndexOf("pg_catalog.pg_constraint");
  const deleteStatement = migration.indexOf("delete from public.clients client");

  assert.ok(permissionCheck >= 0);
  assert.ok(rowLock > permissionCheck);
  assert.ok(protectedCheck > rowLock);
  assert.ok(bookingCheck > protectedCheck);
  assert.ok(foreignKeyScan > bookingCheck);
  assert.ok(deleteStatement > foreignKeyScan);
  assert.match(migration, /constraint_row\.confrelid = 'public\.clients'::regclass/i);
  assert.match(migration, /target_attribute\.attname = 'id'/i);
  assert.match(migration, /revoke all on function public\.delete_unused_booking_client\(uuid\) from public/i);
  assert.match(migration, /grant execute on function public\.delete_unused_booking_client\(uuid\) to authenticated/i);
  assert.doesNotMatch(migration, /on delete cascade/i);
  assert.doesNotMatch(migration, /delete from public\.booking_diary/i);
  assert.doesNotMatch(migration, /update public\.booking_diary/i);
});

test("delete confirmation rechecks references after modal eligibility was loaded", () => {
  const migration = fs.readFileSync(path.resolve("supabase/migrations/20260721_delete_unused_booking_clients.sql"), "utf8");
  const data = fs.readFileSync(path.resolve("lib/data.ts"), "utf8");
  const dialog = fs.readFileSync(path.resolve("components/client-directory-dialog.tsx"), "utf8");

  assert.match(data, /get_booking_client_delete_eligibility/);
  assert.match(data, /delete_unused_booking_client/);
  assert.match(dialog, /await onDelete\(deleteTarget\.id\)/);
  assert.match(migration, /where booking\.client_id = target_client_id/i);
  assert.match(migration, /select exists\(select 1 from %s where %I = \$1\)/i);
  assert.match(migration, /delete from public\.clients client[\s\S]*where client\.id = target_client_id/i);
});

test("Manage Clients delete UI protects linked and system clients with EN/TH confirmation text", () => {
  const dialog = fs.readFileSync(path.resolve("components/client-directory-dialog.tsx"), "utf8");

  assert.match(dialog, /Delete client\?/);
  assert.match(dialog, /Are you sure you want to permanently delete/);
  assert.match(dialog, /This cannot be undone/);
  assert.match(dialog, /Cannot delete this client because it is used by bookings\. Deactivate it instead\./);
  assert.match(dialog, /ลบลูกค้า\?/);
  assert.match(dialog, /ไม่สามารถลบลูกค้านี้ได้เนื่องจากถูกใช้ในรายการจอง/);
  assert.match(dialog, /คุณไม่มีสิทธิ์ลบลูกค้า/);
  assert.match(dialog, /const internal = normalizedClientKey\(client\.name\) === "internal \/ other"/);
  assert.match(dialog, /const showDelete = !internal/);
  assert.match(dialog, /disabled=\{deleteBlocked\}/);
  assert.match(dialog, /role="alertdialog"/);
  assert.match(dialog, /className="is-destructive"/);
});

test("successful deletion refreshes local list and selection while failure refreshes server state", () => {
  const page = fs.readFileSync(path.resolve("app/(dashboard)/booking-diary/page.tsx"), "utf8");

  assert.match(page, /setClients\(\(current\) => current\.filter\(\(client\) => client\.id !== id\)\)/);
  assert.match(page, /setClientDeleteEligibility/);
  assert.match(page, /if \(clientFilter === id\) setClientFilter\(""\)/);
  assert.match(page, /if \(form\.client_id === id\)/);
  assert.match(page, /client_id: ""/);
  assert.match(page, /Client deleted successfully/);
  assert.match(page, /Promise\.allSettled\(\[[\s\S]*fetchClients\(\),[\s\S]*fetchClientDeleteEligibility\(\)/);
});

test("client delete controls wrap on mobile and confirmation remains above the manager", () => {
  const css = fs.readFileSync(path.resolve("app/globals.css"), "utf8");

  assert.match(css, /\.client-directory-list article > div:last-child\s*\{[^}]*flex-wrap:\s*wrap/s);
  assert.match(css, /\.client-directory-list article button\s*\{[^}]*min-height:\s*40px/s);
  assert.match(css, /\.client-delete-confirmation-backdrop\s*\{[^}]*z-index:\s*90/s);
  assert.match(css, /\.client-directory-backdrop\s*\{[^}]*z-index:\s*80/s);
  assert.match(css, /\.client-delete-confirmation-actions\s*\{[^}]*grid-template-columns/s);
});
