const fs=require('node:fs');
let file='tests/hr-v7-browser.cjs',text=fs.readFileSync(file,'utf8');
text=text.replace("await page.waitForFunction(()=>document.querySelector('dialog canvas')?.width>0);","await previewRendered(page);");
text=text.replace("const {chromium}=require('C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');","const {chromium}=(()=>{try{return require(process.env.EES_PLAYWRIGHT_MODULE||'playwright');}catch{return require('C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');}})();");
fs.writeFileSync(file,text);
const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));
pkg.scripts['test:hr']='node --test --test-concurrency=1 tests/hr-v7-*.test.cjs';
pkg.scripts['test:hr:browser']='node tests/hr-v7-build.cjs && node tests/hr-v7-browser.cjs';
fs.writeFileSync('package.json',JSON.stringify(pkg,null,2)+'\n');
