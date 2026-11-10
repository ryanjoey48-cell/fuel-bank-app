/** Starts an explicitly approved non-production profile only. Never applies migrations or seeds records. */
const {spawn}=require('node:child_process');const path=require('node:path');
const {readEnv}=require('./expenses-readiness.cjs');const {classifyEesSupabaseUrl,extractSupabaseProjectRef}=require('../lib/ees-database-environment.cjs');
function approvedProfile(file){
 const env=readEnv(file),url=env.NEXT_PUBLIC_SUPABASE_URL;
 if(classifyEesSupabaseUrl(url)!=='CANDIDATE_STAGING'||env.EES_EXPENSES_WRITES!=='approved-safe-environment'||env.EES_EXPENSES_APPROVED_SUPABASE_URL!==url)throw new Error('An explicit, matching Expenses test approval is required. Production profiles are refused.');
 for(const key of ['NEXT_PUBLIC_SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY']){
  if(!env[key])throw new Error('Both credentials must be supplied in the approved test profile; parent credentials are never reused.');
  if(env[key].split('.').length===3){let claim;try{claim=JSON.parse(Buffer.from(env[key].split('.')[1],'base64url').toString());}catch{throw new Error('Invalid test credential format.');}if(claim.ref&&claim.ref!==extractSupabaseProjectRef(url))throw new Error('Test credential and project URL do not match.');}
 }
 return env;
}
if(require.main===module){try{
 const env=approvedProfile(process.argv[2]||'.env.expenses-test.local');const port=process.env.EXPENSES_TEST_PORT||'3020';if(!/^\d{4,5}$/.test(port))throw new Error('Invalid test port.');
 const child=spawn(process.execPath,[path.join('node_modules','next','dist','bin','next'),'dev','--hostname','127.0.0.1','--port',port],{cwd:path.resolve(__dirname,'..'),stdio:'inherit',windowsHide:true,env:{...process.env,...env,EES_EXPENSES_FIXTURE:'0',EES_FINANCE_DEMO_ONLY:'0',NEXT_PUBLIC_EES_FINANCE_LOCAL_WORKSPACE:'0',NEXT_PUBLIC_EES_FINANCE_FIXTURE:'0',NEXT_PUBLIC_EES_FINANCE_PREVIEW:'0',EES_FLEET_MONITOR_ENABLED:'false',EES_WEB_PUSH_TEST_ENABLED:'false',FUEL_BANK_DIST_DIR:'.next-expenses-v11-approved-test',NEXT_TELEMETRY_DISABLED:'1'}});
 child.on('exit',code=>process.exit(code??1));
}catch(error){console.error(error.message);process.exitCode=1;}}
module.exports={approvedProfile};
