// Read-only endpoint checks. Uses only the public anonymous key and limit=0.
// A 401/42501 is expected for protected Maintenance tables without a staff session.
const fs = require('node:fs');
require('@next/env').loadEnvConfig(process.cwd());
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) throw new Error('Missing public Supabase configuration');
const sql = fs.readFileSync('supabase/migrations/20260914090000_add_maintenance.sql', 'utf8');
const tables = ['vehicles', 'drivers', 'weekly_mileage', 'fuel_logs', ...Array.from(sql.matchAll(/create table public\.(maintenance_\w+)/g), m => m[1]), 'grease_maintenance_records'];
(async () => {
  for (const table of tables) {
    const response = await fetch(`${url}/rest/v1/${table}?select=*&limit=0`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000)
    });
    const result = await response.json();
    console.log(table, response.status, Array.isArray(result) ? 'Endpoint exists' : `${result.code}: ${result.message}`);
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
