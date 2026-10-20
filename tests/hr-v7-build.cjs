// Builds the real app with synthetic public settings for isolated browser tests.
const {spawn}=require('node:child_process'),fs=require('node:fs');
const log=fs.createWriteStream('output/ees-hr-v7/qa-build.txt');
const child=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'build'],{windowsHide:true,env:{...process.env,NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:32123',NEXT_PUBLIC_SUPABASE_ANON_KEY:'synthetic-public-key',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service-key',FUEL_BANK_ISOLATED_BUILD:'1',FUEL_BANK_LOW_MEMORY:'1',NEXT_TELEMETRY_DISABLED:'1',NODE_OPTIONS:'--max-old-space-size=2048'}});
child.stdout.pipe(log);child.stderr.pipe(log);child.on('exit',code=>{log.end();console.log('HR synthetic production build exit:',code);process.exitCode=code??1;});
