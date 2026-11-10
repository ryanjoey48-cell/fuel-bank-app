/* Local, synthetic preview. Never reads/writes company records. */
const {spawn}=require('node:child_process');const path=require('node:path');
const port=process.env.EXPENSES_PREVIEW_PORT||'3018';
const dist=process.env.EXPENSES_PREVIEW_DIST_DIR||'.next-expenses-browser';
if(!/^\d{4,5}$/.test(port))throw new Error('Invalid preview port');
if(!/^\.next-expenses-[a-z0-9-]+$/.test(dist))throw new Error('Preview build directory must stay in this project.');
const child=spawn(process.execPath,[path.join('node_modules','next','dist','bin','next'),'dev','--hostname','127.0.0.1','--port',port],{
 cwd:path.resolve(__dirname,'..'),stdio:'inherit',windowsHide:true,
 env:{...process.env,EES_EXPENSES_FIXTURE:'1',EES_EXPENSES_WRITES:'',EES_EXPENSES_APPROVED_SUPABASE_URL:'',NEXT_PUBLIC_SUPABASE_URL:'',NEXT_PUBLIC_SUPABASE_ANON_KEY:'',SUPABASE_SERVICE_ROLE_KEY:'',FUEL_BANK_DIST_DIR:dist,NEXT_TELEMETRY_DISABLED:'1'}
});
child.on('exit',code=>process.exit(code??1));
