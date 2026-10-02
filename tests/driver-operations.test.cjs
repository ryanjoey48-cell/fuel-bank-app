const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const sharp = require('sharp');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
function load(file, dependencies = {}) {
  const m = { exports: {} };
  const js = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  new Function('require', 'module', 'exports', js)((key) => { assert.ok(key in dependencies, `Unexpected dependency ${key}`); return dependencies[key]; }, m, m.exports);
  return m.exports;
}
class DriverPortalError extends Error { constructor(status, message) { super(message); this.status = status; } }
const session = { authUserId: '553cac0d-4328-4359-a81f-0591a808083f', driverId: '26', driverName: 'Official Name', accountId: 'account', sessionId: 'session', vehicleRegistration: '1998' };
const ops = load('lib/driver-operations.ts');
for (const [eventType, status] of [['pickup_arrived', 'pickup'], ['pickup_departed', 'en_route'], ['delivery_arrived', 'delivery'], ['job_completed', 'completed']]) test(`status derives ${status} from latest ${eventType}`, () => {
  assert.equal(ops.jobStatus([{ eventType, eventTime: '2026-10-02T05:00:00Z' }, { eventType: 'pickup_arrived', eventTime: '2026-10-02T04:00:00Z' }]), status);
});
test('no events means Ready without mutating events', () => { const events = []; assert.equal(ops.jobStatus(events), 'ready'); assert.deepEqual(events, []); });
test('next job excludes completed bookings and refuses equally timed ambiguous jobs', () => {
  const jobs = ['a', 'b'].map((id) => ({ id, bookingDate: '2026-10-02', pickupTime: '10:00' }));
  assert.equal(ops.nextDriverJob(jobs, {}), null);
  assert.equal(ops.nextDriverJob(jobs, { a: [{ eventType: 'job_completed', eventTime: 'time' }] }).id, 'b');
  assert.equal(ops.nextDriverJob(jobs, Object.fromEntries(jobs.map((j) => [j.id, [{ eventType: 'job_completed', eventTime: 'time' }]]))), null);
});
test('admin-only profile endpoint rejects callers before resolving target account', async () => {
  class AdminApiError extends Error { constructor(status) { super('Denied'); this.status = status; } }
  const route = load('app/api/admin/driver-operations/profiles/[accountId]/route.ts', { '@/lib/admin-user-management-server': { AdminApiError, requireAdminAccess: async () => { throw new AdminApiError(403); } }, '@/lib/driver-profile-server': { readDriverProfile: () => { throw new Error('Should not query'); } }, '@/lib/driver-portal-server': { DriverPortalError } });
  assert.equal((await route.GET(new Request('http://localhost/api'), { params: Promise.resolve({ accountId: 'any' }) })).status, 403);
});
function profile(admin = {}, auth = {}) { return load('lib/driver-profile-server.ts', { 'server-only': {}, 'node:crypto': require('node:crypto'), sharp, '@supabase/supabase-js': { createClient: () => ({ auth }) }, '@/lib/admin-user-management-server': { createServerSupabaseAdmin: () => admin }, '@/lib/driver-portal-server': { DriverPortalError } }); }
test('profile allowlist rejects official identity and browser-supplied account ids', () => {
  const p = profile();
  for (const extra of ['auth_user_id', 'driver_id', 'officialName', 'name', 'avatar_path', 'role', 'email']) assert.throws(() => p.profileFields({ displayName: 'Test', phone: '', [extra]: 'spoof' }), { status: 400 });
  for (const body of [null, [], {}, { displayName: '', phone: '' }, { displayName: 'A', phone: 'bad<script>' }]) assert.throws(() => p.profileFields(body), { status: 400 });
});
test('profile writer derives account ownership only from verified session', async () => {
  let payload;
  const p = profile({ from(table) { assert.equal(table, 'driver_profiles'); return { async upsert(row) { payload = row; return { error: null }; } }; } });
  await p.updateDriverProfile(session, { displayName: '  Display  ', phone: ' +66 123 ' });
  assert.deepEqual(payload, { auth_user_id: session.authUserId, display_name: 'Display', phone: '+66 123' });
});
test('avatar rejects oversized, invalid bytes and disguised GIF before storage', async () => {
  const p = profile();
  await assert.rejects(p.uploadDriverAvatar(session, { size: 5242881, type: 'image/png' }), { status: 400 });
  await assert.rejects(p.uploadDriverAvatar(session, new File(['not an image'], 'a.png', { type: 'image/png' })), { status: 400 });
  const gif = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'red' } }).gif().toBuffer();
  await assert.rejects(p.uploadDriverAvatar(session, new File([gif], 'a.png', { type: 'image/png' })), { status: 400 });
});
test('avatar re-encodes own image to bounded WebP under server-generated own path', async () => {
  let uploaded; let saved;
  const p = profile({ auth: { admin: { async getUserById() { return { data: { user: { email: 'own@example.com', user_metadata: { phone: '+66 123' } } } }; } } }, from() { return { select() { return this; }, eq(key, value) { assert.equal(key, 'auth_user_id'); assert.equal(value, session.authUserId); return this; }, async maybeSingle() { return { data: null, error: null }; }, async upsert(row) { saved = row; return { error: null }; } }; }, storage: { from(bucket) { assert.equal(bucket, 'driver-avatars'); return { async upload(key, bytes, options) { uploaded = { key, bytes, options }; return { error: null }; }, async remove() { throw new Error('Unexpected deletion'); } }; } } });
  const png = await sharp({ create: { width: 800, height: 600, channels: 3, background: 'red' } }).png().toBuffer();
  await p.uploadDriverAvatar(session, new File([png], '../other.png', { type: 'image/png' }));
  assert.match(uploaded.key, new RegExp(`^${session.authUserId}/[0-9a-f-]{36}\\.webp$`));
  assert.equal(uploaded.options.upsert, false); assert.equal(saved.auth_user_id, session.authUserId);
  assert.equal(saved.phone, '+66 123'); assert.equal(saved.display_name, session.driverName);
  const metadata = await sharp(uploaded.bytes).metadata(); assert.equal(metadata.format, 'webp'); assert.equal(metadata.width, 512); assert.equal(metadata.exif, undefined);
});
test('password update reauthenticates same user, uses updateUser, revokes other portal sessions', async () => {
  const calls = [];
  const p = profile({ auth: { admin: { async getUserById(id) { assert.equal(id, session.authUserId); return { data: { user: { email: 'own@example.com' } } }; } } }, from(table) { assert.equal(table, 'driver_sessions'); return { update() { return this; }, eq(k, v) { calls.push([k, v]); return this; }, neq(k, v) { calls.push([k, v]); return this; }, async is() { return { error: null }; } }; } }, { async signInWithPassword(body) { assert.equal(body.email, 'own@example.com'); return { data: { user: { id: session.authUserId } } }; }, async updateUser(body) { calls.push(body); return { error: null }; }, async signOut() { calls.push('signout'); } });
  await p.changeDriverPassword(session, { currentPassword: 'current', password: 'long-new-password', confirmPassword: 'long-new-password' });
  assert.deepEqual(calls[0], { password: 'long-new-password' }); assert.ok(calls.some((entry) => Array.isArray(entry) && entry[0] === 'driver_account_id' && entry[1] === 'account')); assert.equal(calls.at(-1), 'signout');
});
test('password cannot proceed when reauthentication returns another user', async () => {
  let changed = false;
  const p = profile({ auth: { admin: { async getUserById() { return { data: { user: { email: 'own@example.com' } } }; } } } }, { async signInWithPassword() { return { data: { user: { id: 'other' } } }; }, async updateUser() { changed = true; } });
  await assert.rejects(p.changeDriverPassword(session, { currentPassword: 'current', password: 'long-new-password', confirmPassword: 'long-new-password' }), { status: 401 }); assert.equal(changed, false);
});
test('driver API requires cookie session and rejects cross-origin writes', async () => {
  const api = load('lib/driver-profile-api.ts', { 'server-only': {}, '@/lib/driver-portal-server': { DriverPortalError, getDriverPortalSession: async () => null } });
  await assert.rejects(api.ownDriver(), { status: 401 });
  await assert.rejects(api.ownDriver(new Request('http://localhost/api', { headers: { Origin: 'https://evil.test' } })), { status: 403 });
  const response = api.profileError(new DriverPortalError(403, 'Denied')); assert.equal(response.status, 403); assert.equal(response.headers.get('cache-control'), 'private, no-store');
});
test('body limits reject oversized chunked input without trusting Content-Length', async () => {
  const api = load('lib/driver-profile-api.ts', { 'server-only': {}, '@/lib/driver-portal-server': { DriverPortalError } });
  await assert.rejects(api.limitedBody(new Request('http://localhost/api', { method: 'POST', body: 'oversize' }), 3), { status: 413 });
  await assert.rejects(api.profileJson(new Request('http://localhost/api', { method: 'POST', body: 'null' })), { status: 400 });
});
test('admin operations denies unauthorised caller before any data query', async () => {
  class AdminApiError extends Error { constructor(status) { super('Denied'); this.status = status; } }
  let queried = false;
  const route = load('app/api/admin/driver-operations/route.ts', { '@/lib/admin-user-management-server': { AdminApiError, requireAdminAccess: async () => { throw new AdminApiError(403); } }, '@/lib/driver-work-server': { driverOperations: async () => { queried = true; } }, '@/lib/driver-portal-server': { DriverPortalError }, '@/lib/driver-notifications-server': { evaluatePickupWaits: async () => { throw new Error('Must not evaluate before authorization'); } } });
  const response = await route.GET(new Request('http://localhost/api')); assert.equal(response.status, 403); assert.equal(queried, false);
});
test('history rechecks booking ownership and scopes completion events by driver id', async () => {
  const calls = [];
  const admin = { from(table) { calls.push(table); return { select() { return this; }, eq(key, value) { calls.push([table, key, value]); return this; }, order() { return this; }, async range() { return { data: [{ booking_id: 'own', event_time: 'time' }], error: null }; }, async in(key, values) { calls.push([table, key, values]); return { data: [], error: null }; } }; } };
  const work = load('lib/driver-work-server.ts', { 'server-only': {}, '@/lib/admin-user-management-server': { createServerSupabaseAdmin: () => admin }, '@/lib/driver-portal-server': { DriverPortalError, DRIVER_JOB_SELECT: 'id', toDriverJob: () => { throw new Error('No owned bookings'); } }, '@/lib/driver-profile-server': {}, '@/lib/driver-operations': ops });
  assert.deepEqual(await work.driverHistoryWork(session), { rows: [], hasMore: false });
  assert.ok(calls.some(([table, key, value]) => table === 'driver_job_events' && key === 'driver_id' && value === '26'));
  assert.ok(calls.some(([table, key, value]) => table === 'booking_diary' && key === 'driver_id' && value === '26'));
});
test('completed home cards render Completed and next unfinished job first', () => {
  const React = require('react'); const icons = Object.fromEntries(['ArrowDown','CalendarDays','ChevronRight','Clock3','MapPin','PackageCheck','Route','Truck'].map((name) => [name, () => null]));
  const home = load('components/driver/driver-home.tsx', { 'react/jsx-runtime': require('react/jsx-runtime'), react: React, 'lucide-react': icons, 'next/link': ({ href, children, ...props }) => React.createElement('a', { href, ...props }, children), '@/lib/language-provider': { useLanguage: () => ({ language: 'en' }) }, '@/lib/driver-operations': ops });
  const jobs = ['done', 'next'].map((id) => ({ id, bookingDate: '2026-10-02', pickupTime: '10:00', pickupName: 'Pickup', dropoffName: 'Dropoff', clientName: id }));
  const html = require('react-dom/server').renderToStaticMarkup(React.createElement(home.DriverHome, { driverName: 'Test', jobs, today: '2026-10-02', eventsByJob: { done: [{ eventType: 'job_completed', eventTime: '2026-10-02T05:00:00Z' }] } }));
  assert.ok(html.includes('Completed')); assert.ok(html.includes('bg-emerald-100')); assert.ok(html.indexOf('/driver/jobs/next') < html.indexOf('/driver/jobs/done')); // Exactly one next job in each mutually exclusive responsive presentation.
  assert.equal((html.match(/NEXT JOB/g) || []).length, 2);
  assert.equal((html.match(/href="\/driver\/jobs\/next"/g) || []).length, 2);
  assert.equal((html.match(/href="\/driver\/jobs\/done"/g) || []).length, 2);
  assert.ok(html.includes('sm:hidden')); assert.ok(html.includes('hidden overflow-hidden')); assert.ok(html.includes('sm:block'));
});
test('mobile action retains one secure save button and full timeline', () => {
  const source = read('components/driver/driver-job-detail.tsx'); assert.ok(source.includes('bottom-[calc(52px+env(safe-area-inset-bottom))]')); assert.ok(source.includes('DRIVER_JOB_EVENT_TYPES.map')); assert.equal((source.match(/labels.actions\[stage\]/g) || []).length, 1);
});
test('profile migration isolates profile fields and private image storage', () => {
  const sql = read('supabase/migrations/20261004100000_driver_profiles_and_avatars.sql');
  assert.ok(sql.includes('enable row level security')); assert.ok(sql.includes('revoke all on public.driver_profiles')); assert.ok(sql.includes("'driver-avatars', 'driver-avatars', false, 5242880")); assert.equal(/alter table public\.drivers|update public\.drivers|grant .* to authenticated/i.test(sql), false);
});
