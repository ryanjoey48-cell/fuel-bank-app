// Read-only diagnostics. Does not authenticate/impersonate users, write events,
// run the alert evaluator, upload files, change passwords or mark notifications read.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
for (const line of fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '');
}
const cache = new Map();
function source(file) {
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} }; cache.set(file, module);
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  new Function('require', 'module', 'exports', js)((key) => {
    if (key === 'server-only') return {};
    if (key === 'next/headers') return { cookies() { throw new Error('No user-session diagnostics allowed'); } };
    if (key.startsWith('@/')) return source(path.join(__dirname, '..', `${key.slice(2)}.ts`));
    return require(key);
  }, module, module.exports);
  return module.exports;
}
(async () => {
  const { createServerSupabaseAdmin } = source(path.join(__dirname, '..', 'lib/admin-user-management-server.ts'));
  const { operationsHistory, driverOperations } = source(path.join(__dirname, '..', 'lib/driver-work-server.ts'));
  const admin = createServerSupabaseAdmin();
  const today = await driverOperations(admin);
  console.log(JSON.stringify({ today: today.date, todayJobs: today.rows.length, profilePhotos: today.rows.filter((row) => row.profile?.avatarUrl).length }));
  for (const params of ['', 'q=Joey', 'q=PIONEERS', 'q=1998', 'from=2026-09-01&to=2026-10-01']) {
    const history = await operationsHistory(admin, new URLSearchParams(params));
    console.log(JSON.stringify({ historyFilter: params, jobs: history.rows.length, hasMore: history.hasMore, onlyCompleted: history.rows.every((row) => row.events.some((event) => event.eventType === 'job_completed')) }));
  }
  const notifications = await admin.from('driver_operational_notifications').select('id', { count: 'exact', head: true });
  if (notifications.error) throw new Error('Notification table unavailable');
  console.log(JSON.stringify({ notificationRecords: notifications.count }));
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
