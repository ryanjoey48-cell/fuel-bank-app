// Optional isolated PostgreSQL verification. Never connects to Supabase.
// PGLITE_MODULE_PATH must point to a separately installed @electric-sql/pglite package.
const { PGlite } = require(process.env.PGLITE_MODULE_PATH || '@electric-sql/pglite');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const db = new PGlite();
  let passed = 0;
  const check = async (label, action) => { await action(); passed++; console.log(`PASS ${label}`); };
  const booking = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const foreign = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const session = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  try {
    await db.exec(`
      create role anon; create role authenticated; create role driver_portal; create role service_role bypassrls;
      create schema auth;
      create table auth.users(id uuid primary key);
      create table public.drivers(id bigint primary key, active boolean not null);
      create table public.booking_diary(id uuid primary key, driver_id bigint references public.drivers(id));
      create table public.driver_accounts(id uuid primary key, driver_id bigint references public.drivers(id), auth_user_id uuid references auth.users(id), active boolean);
      create table public.driver_sessions(id uuid primary key, driver_account_id uuid references public.driver_accounts(id), revoked_at timestamptz, expires_at timestamptz);
      create function public.is_office_account() returns boolean language sql as $$ select current_setting('test.office', true) = 'true' $$;
      grant usage on schema public to authenticated, service_role;
      insert into auth.users values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
      insert into public.drivers values (26, true), (99, true);
      insert into public.booking_diary values ('${booking}',26), ('${foreign}',99);
      insert into public.driver_accounts values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',26,'dddddddd-dddd-4ddd-8ddd-dddddddddddd',true);
      insert into public.driver_sessions values ('${session}','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',null,now()+interval '1 day');
    `);
    await check('migration executes using deployed bigint driver / UUID booking types', async () => {
      await db.exec(fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261003100000_driver_job_events.sql'), 'utf8'));
    });
    const event = (type, id = booking, sessionId = session, lat = null, lng = null) => db.query(
      'select public.append_driver_job_event($1::uuid,$2::uuid,$3::text,$4::double precision,$5::double precision) as event',
      [sessionId, id, type, lat, lng]
    );
    await check('service-only function can execute while enforcing sequence', async () => {
      await db.exec('set role service_role');
      await assert.rejects(event('pickup_departed'), { code: 'PT409' });
      await db.exec('reset role');
    });
    await check('missing session is rejected', () => assert.rejects(event('pickup_arrived', booking, 'ffffffff-ffff-4fff-8fff-ffffffffffff'), { code: 'PT401' }));
    await check('another driver booking is rejected', () => assert.rejects(event('pickup_arrived', foreign), { code: 'PT404' }));
    await check('skipping arrival is rejected', () => assert.rejects(event('pickup_departed'), { code: 'PT409' }));
    await check('invalid GPS is rejected', () => assert.rejects(event('pickup_arrived', booking, session, 100, 0), { code: 'PT400' }));
    await check('arrival stores database timestamp and null GPS', async () => {
      const result = (await event('pickup_arrived')).rows[0].event;
      assert.ok(result.event_time);
      assert.equal(result.latitude, null);
      assert.equal(result.longitude, null);
    });
    await check('duplicate arrival is rejected', () => assert.rejects(event('pickup_arrived'), { code: 'PT409' }));
    await check('all remaining stages persist in exact order', async () => {
      for (const type of ['pickup_departed', 'delivery_arrived', 'job_completed']) await event(type);
      const { rows } = await db.query('select * from public.driver_job_events order by event_time');
      assert.deepEqual(rows.map((row) => row.event_type), ['pickup_arrived', 'pickup_departed', 'delivery_arrived', 'job_completed']);
      assert.ok(rows.every((row) => row.driver_id === 26 && row.auth_user_id === 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'));
    });
    await check('events after completion are rejected', () => assert.rejects(event('job_completed'), { code: 'PT409' }));
    await check('revoked sessions cannot append', async () => {
      await db.exec(`update public.driver_sessions set revoked_at=now() where id='${session}'`);
      await assert.rejects(event('job_completed'), { code: 'PT401' });
    });
    await check('authenticated clients cannot execute append RPC', async () => {
      await db.exec('set role authenticated');
      await assert.rejects(event('pickup_arrived'), { code: '42501' });
      await db.exec('reset role');
    });
    await check('service role has no direct event insert/update/delete grants', async () => {
      const { rows } = await db.query("select has_table_privilege('service_role','public.driver_job_events','INSERT') as insert, has_table_privilege('service_role','public.driver_job_events','UPDATE') as update, has_table_privilege('service_role','public.driver_job_events','DELETE') as delete");
      assert.deepEqual(rows[0], { insert: false, update: false, delete: false });
    });
    await check('office RLS allows read, non-office cannot read events', async () => {
      await db.exec("set role authenticated; set test.office = 'false'");
      assert.equal((await db.query('select count(*) as count from public.driver_job_events')).rows[0].count, 0);
      await db.exec("set test.office = 'true'");
      assert.equal((await db.query('select count(*) as count from public.driver_job_events')).rows[0].count, 4);
      await db.exec('reset role');
    });
    console.log(`Isolated PostgreSQL: ${passed} passed, 0 failed. No Supabase data changed.`);
  } finally { await db.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
