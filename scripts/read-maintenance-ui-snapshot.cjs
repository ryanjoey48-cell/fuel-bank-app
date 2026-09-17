// Read-only snapshot of the three vehicles requested for UI review.
// Credentials stay in memory. Only GET requests are used. Output is git-ignored.
const fs = require('node:fs');
require('@next/env').loadEnvConfig(process.cwd());
const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!base || !key) throw new Error('Missing configured server-side Supabase credentials');
async function read(table, filters = {}) {
  const rows = [];
  for (let offset = 0; ; offset += 500) {
    const params = new URLSearchParams({select:'*',order:table === 'maintenance_requirement_vehicles'?'requirement_id,vehicle_id':'id',...filters,offset:String(offset),limit:'500'});
    const response = await fetch(`${base}/rest/v1/${table}?${params}`, {method:'GET',headers:{apikey:key,Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(15000)});
    if (!response.ok) throw new Error(`${table}: HTTP ${response.status}`);
    const data = await response.json();
    rows.push(...data);
    if (data.length < 500) return rows;
  }
}
(async () => {
  const vehicles = await read('vehicles',{vehicle_reg:'in.(701-1654,61-2835,79-2945)'});
  if (vehicles.length !== 3) throw new Error(`Expected three requested vehicles, found ${vehicles.length}`);
  const scope = `in.(${vehicles.map(v=>v.id).join(',')})`;
  const records = await read('maintenance_records',{vehicle_id:scope,is_deleted:'eq.false'});
  const recordScope = `in.(${records.map(record=>record.id).join(',')})`;
  const [items,attachments,requirements,applicability,mileage,drivers] = await Promise.all([
    records.length ? read('maintenance_items',{record_id:recordScope}) : [],
    records.length ? read('maintenance_attachments',{record_id:recordScope}) : [],
    read('maintenance_requirements'),read('maintenance_requirement_vehicles',{vehicle_id:scope}),
    read('weekly_mileage',{vehicle_id:scope}),read('drivers',{assigned_vehicle_id:scope})
  ]);
  fs.mkdirSync('tmp/maintenance-polish-qa',{recursive:true});
  fs.writeFileSync('tmp/maintenance-polish-qa/real-snapshot.json',JSON.stringify({vehicles,records,items,attachments,requirements,applicability,mileage,drivers,fuel:[]}));
  if (process.argv.includes('--receipts')) {
    for (const attachment of attachments) {
      const encoded = attachment.file_path.split('/').map(encodeURIComponent).join('/');
      const response = await fetch(`${base}/storage/v1/object/authenticated/maintenance-receipts/${encoded}`, { method: 'GET', headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(`Receipt read: HTTP ${response.status}`);
      if (!/^[a-zA-Z0-9-]+$/.test(attachment.id)) throw new Error('Unexpected attachment ID');
      fs.writeFileSync(`tmp/maintenance-polish-qa/receipt-${attachment.id}`, Buffer.from(await response.arrayBuffer()));
    }
  }
  console.log(JSON.stringify({vehicles:vehicles.map(v=>v.vehicle_reg),records:records.length,items:items.length,attachments:attachments.length}));
})().catch(error=>{console.error(error.message);process.exitCode=1});
