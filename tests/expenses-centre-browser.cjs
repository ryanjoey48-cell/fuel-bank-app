/* Synthetic browser-only preview. Every non-loopback network request is blocked. */
const {chromium}=require('C:/Users/joery/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');const fs=require('node:fs');
const origin=process.env.EXPENSES_TEST_ORIGIN||'http://127.0.0.1:3017';
if(!['127.0.0.1','localhost'].includes(new URL(origin).hostname))throw new Error('Loopback fixture only');
fs.mkdirSync('output/expenses-centre',{recursive:true});
(async()=>{const browser=await chromium.launch({headless:true,channel:'msedge'});const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
const page=await context.newPage();const errors=[];const pendingRequests=new Set();page.on('request',r=>pendingRequests.add(r.url()));page.on('requestfinished',r=>pendingRequests.delete(r.url()));page.on('requestfailed',r=>{pendingRequests.delete(r.url());console.log('REQUEST FAILED',r.url(),r.failure());});page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
page.setDefaultTimeout(45000);page.setDefaultNavigationTimeout(180000);
await context.route('**/*',route=>['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname)||route.request().url().startsWith('blob:')||route.request().url().startsWith('data:')?route.continue():route.abort());
try{
 await page.goto(`${origin}/expenses-fixture`,{waitUntil:'networkidle'});await page.getByRole('heading',{name:'Expenses Centre',exact:true}).waitFor();
 await page.getByRole('button',{name:'TH',exact:true}).click();await page.getByRole('heading',{name:'ศูนย์ค่าใช้จ่าย',exact:true}).waitFor();
 await page.getByRole('button',{name:'EN',exact:true}).click();await page.getByRole('heading',{name:'Expenses Centre',exact:true}).waitFor();await page.getByText('ISOLATED FIXTURE PREVIEW',{exact:true}).waitFor();
 await page.screenshot({path:'output/expenses-centre/desktop-overview.png',fullPage:true});
 assert.equal(await page.locator('[data-expenses-workspace]').evaluate(el=>el.scrollWidth<=el.clientWidth+2),true);
 await page.getByRole('button',{name:'Add expense',exact:true}).click();
 await page.getByLabel(/^Total amount · THB/).fill('123.45');await page.getByLabel('Category *',{exact:true}).selectOption('office');
 await page.getByLabel('What was it for? *',{exact:true}).fill('Browser synthetic stationery');
 const fileInputs=page.locator('input[type=file]');assert.equal(await fileInputs.count(),3);assert.equal(await fileInputs.nth(0).getAttribute('capture'),'environment');assert.equal(await fileInputs.nth(1).getAttribute('capture'),null);
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6rF8AAAAASUVORK5CYII=','base64');
 await fileInputs.nth(1).setInputFiles([{name:'synthetic-photo.png',mimeType:'image/png',buffer:png}]);
 await fileInputs.nth(2).setInputFiles([{name:'synthetic-receipt.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\nsynthetic fixture only\n%%EOF')}]);
 assert.equal(await page.getByRole('link',{name:'synthetic-photo.png',exact:true}).count(),1);assert.equal(await page.getByRole('link',{name:'synthetic-receipt.pdf',exact:true}).count(),1);
 await page.screenshot({path:'output/expenses-centre/desktop-entry.png',fullPage:true});
 await page.getByRole('button',{name:'Remove attachment',exact:true}).last().click();assert.equal(await page.getByRole('link',{name:'synthetic-receipt.pdf',exact:true}).count(),0);
 await fileInputs.nth(2).setInputFiles([{name:'synthetic-receipt.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\nsynthetic fixture only\n%%EOF')}]);
 await page.getByLabel('Simulate one failed upload (fixture only)',{exact:true}).check();
 await page.getByRole('button',{name:'Submit expense',exact:true}).click();await page.getByText(/Failed · retry when saving/).waitFor();
 await page.getByRole('button',{name:'Retry & submit',exact:true}).click();await page.getByRole('heading',{name:'Browser synthetic stationery',exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Download',exact:true}).count(),2);await page.getByText('Expense saved. Your record and receipt status are shown below.',{exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Approve',exact:true}).isDisabled(),true);
 await page.getByLabel('Fixture actor',{exact:true}).selectOption('fixture-manager');await page.getByRole('button',{name:'Approve',exact:true}).click();await page.getByText('Approved',{exact:true}).waitFor();
 await page.getByLabel('Review note / reason / payment evidence',{exact:true}).fill('Synthetic payment evidence');await page.getByRole('button',{name:'Confirm payment',exact:true}).click();await page.getByRole('button',{name:'Close paid expense',exact:true}).click();await page.getByText('Closed',{exact:true}).waitFor();
 await page.screenshot({path:'output/expenses-centre/desktop-detail.png',fullPage:true});
 await page.getByRole('button',{name:'All Expenses',exact:true}).click();await page.getByLabel('Search expenses',{exact:true}).fill('Browser synthetic');assert.equal(await page.locator('tbody tr').count(),1);
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'CSV',exact:true}).click();const csv=await download;await csv.saveAs('output/expenses-centre/filtered.csv');assert.match(fs.readFileSync('output/expenses-centre/filtered.csv','utf8'),/Browser synthetic stationery/);assert.doesNotMatch(fs.readFileSync('output/expenses-centre/filtered.csv','utf8'),/Synthetic parking/);
 const xlsx=page.waitForEvent('download');await page.getByRole('button',{name:'Excel',exact:true}).click();await(await xlsx).saveAs('output/expenses-centre/filtered.xlsx');
 await page.getByRole('button',{name:'Reports',exact:true}).click();await page.emulateMedia({media:'print'});await page.screenshot({path:'output/expenses-centre/monthly-report-print.png',fullPage:true});await page.pdf({path:'output/expenses-centre/filtered-monthly-report.pdf',format:'A4',printBackground:true,margin:{top:'12mm',bottom:'12mm',left:'10mm',right:'10mm'}});await page.emulateMedia({media:'screen'});
 await page.getByRole('button',{name:'TH',exact:true}).click();await page.getByRole('heading',{name:'ศูนย์ค่าใช้จ่าย',exact:true}).waitFor();
 await page.getByRole('button',{name:'ภาพรวม',exact:true}).click();await page.screenshot({path:'output/expenses-centre/thai-overview.png',fullPage:true});
 await page.getByRole('button',{name:'EN',exact:true}).click();
 await page.getByRole('button',{name:'Clear additional filters',exact:true}).click();
 for(const [name,width,height]of[['iphone',390,844],['android',412,915]]){
  await page.setViewportSize({width,height});await page.getByRole('button',{name:'Overview',exact:true}).click();
  assert.equal(await page.locator('[data-expenses-workspace]').evaluate(el=>el.scrollWidth<=el.clientWidth+2),true,`${name} overflow`);
  await page.screenshot({path:`output/expenses-centre/${name}-overview.png`,fullPage:true});
  await page.getByRole('button',{name:'Add expense',exact:true}).click();await page.getByLabel('Allocate to *',{exact:true}).selectOption('vehicle');await page.getByLabel('Search registration · EN / TH',{exact:true}).fill('TEST-001');await page.getByLabel('Vehicle *',{exact:true}).selectOption('fixture-vehicle');
  assert.equal(await page.locator('[data-expenses-workspace]').evaluate(el=>el.scrollWidth<=el.clientWidth+2),true,`${name} form overflow`);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),true,`${name} document overflow`);
  const sizes=await page.locator('label').filter({has:page.locator('input[type=file]')}).evaluateAll(els=>els.map(el=>el.getBoundingClientRect().height));assert.ok(sizes.every(h=>h>=44));
  await page.screenshot({path:`output/expenses-centre/${name}-entry.png`,fullPage:true});
  await page.getByRole('button',{name:'Keep for later',exact:true}).click();
 }
 await page.reload();await page.getByRole('button',{name:'All Expenses',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Browser synthetic stationery',exact:true}).count(),0,'fixture data resets on refresh');
 // Real API refuses unauthenticated reads/writes; no credentials or company data involved.
 for(const method of ['GET','POST']){const response=await page.request.fetch(`${origin}/api/expenses-centre`,{method,...(method==='POST'?{data:{command:'create',body:{}}}:{})});assert.equal(response.status(),401);}
 assert.deepEqual(errors,[]);console.log('PASS desktop, 390/412px mobile, camera input, photo/PDF previews, multi-file/remove, submit, independent approval/payment, audit view, filtered CSV/XLSX, Thai, fixture isolation, API auth');
}catch(error){console.error('UI errors',errors,'Pending',Array.from(pendingRequests));console.error((await page.locator('body').innerText()).slice(-7000));await page.screenshot({path:'output/expenses-centre/browser-failure.png',fullPage:true});throw error;}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
