const {spawnSync}=require('node:child_process');
const result=spawnSync(process.execPath,[require('node:path').join(require('node:path').dirname(require.resolve('eslint/package.json')),'bin','eslint.js'),'app','components','lib','src','types','middleware.ts','next.config.ts','tailwind.config.ts','--ext','.ts,.tsx'],{stdio:'inherit',windowsHide:true,env:{...process.env,ESLINT_USE_FLAT_CONFIG:'false'}});
process.exit(result.status??1);
