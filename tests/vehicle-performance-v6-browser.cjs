const { chromium } = require(['C:/Users/joery/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright', 'C:/Program Files/WindowsApps/OpenAI.CodexPrimaryRuntime.v26-1105-1297-0_26.1105.1297.0_x64__3k8sg7r9htsxt/dependencies/node/node_modules/playwright'].find(require('node:fs').existsSync));
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
const { lib } = require('./helpers/invoice-compare.cjs');
const f = lib('vehicle-performance-financial.ts'), sources = lib('vehicle-performance-source-reports.ts').loadVehicleSourceReports();
const { loadRoute } = require('./helpers/vehicle-v6-route.cjs');
fs.mkdirSync('tmp/vehicle-v6-browser-stores', {recursive:true});
const store = fs.mkdtempSync(path.resolve('tmp/vehicle-v6-browser-stores/run-'));
process.env.EES_VEHICLE_FINANCIAL_STORE_DIR = store;
assert.ok(!store.includes('.ees-local'));
const handlers = loadRoute(), origin = process.env.VEHICLE_V6_TEST_ORIGIN || 'http://127.0.0.1:3004';
const output = path.resolve('output/vehicle-performance-v6'); fs.mkdirSync(output,{recursive:true});
let putCount = 0, failSave = false;
const bridge = http.createServer(async (req,res) => {
  try {
    if (req.url !== '/api/vehicle-performance-v5' || !['GET','PUT'].includes(req.method)) {res.writeHead(404).end(); return;}
    const parts=[];for await (const chunk of req) parts.push(chunk);
    const request=new Request('http://isolated-test/api/vehicle-performance-v5',{method:req.method,headers:req.headers,...(req.method==='PUT'?{body:Buffer.concat(parts).toString('utf8')}:{})});
    const response=await handlers[req.method](request);
    if(req.method==='PUT' && response.ok)putCount++;
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());
  }catch(error){res.writeHead(500,{'content-type':'application/json'}).end(JSON.stringify({error:String(error)}));}
});
const legacyRecords=Array.from({length:7},(_,i)=>({id:'legacy-v6-'+i,user_id:'vp6-admin-fixture-user',year:2026,month:i+1,vehicle_registration:'V6-LEGACY',salary_cost:1000,trip_income:200,other_expenses:50,gross_revenue:10000+(i+1)*100,lpg_cost:0,notes:'Isolated January–July fixture',created_at:'2026-01-01',updated_at:'2026-01-01',created_by:null,updated_by:null}));
async function prepare(context, bridgeUrl, role='super_admin') {
  const token=role==='office_staff'?'vp6-staff':role==='read_only'?'vp6-reader':'vp6-admin';
  await context.addInitScript(({token,records})=>{
    const session={access_token:token,user:{id:token+'-fixture-user',email:'fixture@example.test'}};
    const query=(table)=>{const q=new Proxy({}, {get:(_,key)=>key==='then'?resolve=>resolve({data:table==='vehicle_monthly_performance'?records:[],error:null,count:0}):(...args)=>{if(['insert','update','upsert','delete'].includes(String(key)))throw new Error('No legacy financial writes are allowed in this test');return q;}});return q;};
    const channel={on:()=>channel,subscribe:()=>channel,unsubscribe:async()=> 'ok'};
    globalThis.__fuelBankSupabaseBrowserClient={auth:{getSession:async()=>({data:{session},error:null}),getUser:async()=>({data:{user:session.user},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},from:query,rpc:()=>query('none'),channel:()=>channel,removeChannel:async()=> 'ok'};
    window.__vpPdfTexts=[];window.__vpPdfCanvases=[];const draw=CanvasRenderingContext2D.prototype.fillText;CanvasRenderingContext2D.prototype.fillText=function(value,...args){window.__vpPdfTexts.push(String(value));if(this.canvas.width===1684&&!window.__vpPdfCanvases.includes(this.canvas))window.__vpPdfCanvases.push(this.canvas);return draw.call(this,value,...args);};
  }, {token,records:legacyRecords});
  await context.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname.startsWith('/api/'))console.log('API',route.request().method(),url.pathname);
    if(url.origin!==origin && !['data:','blob:'].includes(url.protocol))return route.abort();
    if(url.pathname==='/api/vehicle-performance-v5') {
      if(failSave && route.request().method()==='PUT')return route.fulfill({status:503,json:{error:'Isolated save failure — retry.'}});
      const response=await route.fetch({url:bridgeUrl+'/api/vehicle-performance-v5',headers:{...route.request().headers(),authorization:'Bearer '+token},timeout:120000});
      return route.fulfill({response});
    }
    if(url.pathname==='/api/admin/me')return route.fulfill({json:{access:{userId:token+'-fixture-user',email:'fixture@example.test',displayName:'Isolated fixture',role,status:'active',lastAccessChangedAt:null},permissions:[]}});
    if(url.pathname==='/api/auth/login-routing')return route.fulfill({json:{accountType:'office',destination:'/dashboard'}});
    if(url.pathname.startsWith('/api/'))return route.fulfill({json:{rows:[],batches:[],users:[],notifications:[],migrationReady:false,writesEnabled:false}});
    return route.continue();
  });
}
(async()=>{
  await new Promise(resolve=>bridge.listen(0,'127.0.0.1',resolve));const bridgeUrl='http://127.0.0.1:'+bridge.address().port;
  const browser=await chromium.launch({headless:true,channel:'msedge'});
  const context=await browser.newContext({viewport:{width:1920,height:1080},acceptDownloads:true});await prepare(context,bridgeUrl);
  const page=await context.newPage(),errors=[];page.setDefaultTimeout(120000);page.setDefaultNavigationTimeout(300000);
  page.on('pageerror',error=>{errors.push(error.message);console.log('PAGE ERROR',error.stack||error.message)});
  page.on('dialog',dialog=>{if(dialog.type()==='beforeunload')void dialog.accept();});
  const root=page.getByTestId('vehicle-financial-v6'),table=page.getByTestId('financial-vehicle-table');
  const row=reg=>table.locator('tbody tr').filter({has:page.locator(`th[scope="row"]`).filter({hasText:reg})});
  const cell=(reg,field)=>row(reg).locator(`input[data-vp-field="${field}"]`);
  const save=async()=>{const response=page.waitForResponse(r=>r.url().includes('/api/vehicle-performance-v5')&&r.request().method()==='PUT');await root.getByRole('button',{name:'Save Changes',exact:true}).click();const r=await response;assert.equal(r.status(),200);await page.waitForFunction(()=>document.querySelector('[data-testid="financial-save-status"]')?.textContent==='All changes saved');};
  const openManage=async()=>{await page.getByRole('tab',{name:'Manage Data',exact:true}).click();await root.waitFor({timeout:180000});};
  try {
    await page.goto(origin+'/vehicle-performance',{waitUntil:'domcontentloaded'});
    await page.locator('#vehicle-performance-month').waitFor({timeout:180000});
    await page.locator('#vehicle-performance-month').selectOption('9');
    await openManage();
    assert.equal(await table.locator('tbody tr').count(),21);assert.match(await root.getByTestId('financial-month-totals').innerText(),/1,814,085.89/);
    await page.screenshot({path:path.join(output,'september-desktop.png'),fullPage:true});
    await page.locator('#vehicle-performance-month').selectOption('8');await openManage();assert.equal(await table.locator('tbody tr').count(),21);assert.match(await root.getByTestId('financial-month-totals').innerText(),/1,805,097.00/);
    const registration='79-5318', base=sources[0].rows.find(r=>r.registration===registration), old=f.operationalVehicleFinancials(base), before=Number(base.cells.maintenance.value||0), amount=(before+123.45).toFixed(2);
    await cell(registration,'salary').focus();await page.keyboard.press('Tab');assert.equal(await cell(registration,'jobs').evaluate(el=>document.activeElement===el),true);
    await cell(registration,'maintenance').fill(amount);
    assert.match(await row(registration).getByTestId('vehicle-balance').innerText(),new RegExp(f.baht(old.balance-12345).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
    assert.match(await row(registration).getByTestId('vehicle-margin').innerText(),new RegExp(((old.balance-12345)/old.revenue*100).toFixed(2)));
    assert.equal(await cell(registration,'maintenance').locator('..').getAttribute('data-changed'),'true');
    const savesBefore=putCount;await save();assert.equal(putCount,savesBefore+1);
    const persisted=JSON.parse(fs.readFileSync(path.join(store,'adjustments.json')));assert.equal(persisted.entries.length,1);assert.equal(persisted.entries[0].previousValue,base.cells.maintenance.value);
    await page.reload({waitUntil:'domcontentloaded'});await page.locator('#vehicle-performance-month').waitFor();await page.locator('#vehicle-performance-month').selectOption('8');await openManage();await cell(registration,'maintenance').waitFor();assert.equal(await cell(registration,'maintenance').inputValue(),amount);
    await page.locator('#vehicle-performance-month').selectOption('9');assert.equal(await cell(registration,'maintenance').inputValue(),Number(sources[1].rows.find(r=>r.registration===registration).cells.maintenance.value||0).toFixed(2));
    await page.locator('#vehicle-performance-month').selectOption('8');assert.equal(await cell(registration,'maintenance').inputValue(),amount);
    console.log('21 rows/month, source controls, immediate balance/margin, atomic save, refresh and month independence PASS');
    const missing=sources[0].rows.find(r=>r.cells.maintenance.status==='unknown'&&f.COST_FIELDS.every(k=>k==='maintenance'||r.cells[k].status!=='unknown')&&r.cells.totalReceived.value!=null).registration;
    await cell(missing,'maintenance').fill('0');await save();await page.reload({waitUntil:'domcontentloaded'});await page.locator('#vehicle-performance-month').selectOption('8');await openManage();assert.equal(await cell(missing,'maintenance').inputValue(),'0.00');assert.equal(await row(missing).getAttribute('data-financial-state'),'confirmed');
    await cell(missing,'maintenance').fill('');await save();await page.reload({waitUntil:'domcontentloaded'});await page.locator('#vehicle-performance-month').selectOption('8');await openManage();assert.equal(await cell(missing,'maintenance').inputValue(),'');assert.equal(await row(missing).getAttribute('data-financial-state'),'provisional');
    await cell(missing,'maintenance').fill('N/A');await save();assert.equal(await row(missing).getAttribute('data-financial-state'),'confirmed');
    assert.equal(await table.locator('tbody td[data-field="lpg"] input').count(),1);
    assert.equal(await cell('3ฒล-4565','totalReceived').inputValue(),'');assert.equal((await row('3ฒล-4565').getByTestId('vehicle-balance').innerText()).trim(),'—');
    console.log('Explicit zero, unknown, N/A, automatic completeness, LPG and unconfirmed revenue PASS');
    await cell(registration,'salary').fill('123.45');page.once('dialog',dialog=>dialog.dismiss());await page.locator('#vehicle-performance-month').selectOption('9');assert.equal(await page.locator('#vehicle-performance-month').inputValue(),'8');assert.equal(await cell(registration,'salary').inputValue(),'123.45');
    await root.getByRole('button',{name:'Discard Unsaved Changes',exact:true}).click();assert.equal(await cell(registration,'salary').inputValue(),Number(base.cells.salary.value).toFixed(2));
    await cell(registration,'jobs').fill('1.5');await root.getByRole('alert').filter({hasText:'invalid cells'}).waitFor();assert.equal(await root.getByRole('button',{name:'Save Changes',exact:true}).isDisabled(),true);await cell(registration,'jobs').press('Escape');
    await cell(registration,'maintenance').fill('456.78');const count=putCount;failSave=true;await root.getByRole('button',{name:'Save Changes',exact:true}).click();await root.getByRole('alert').filter({hasText:'Isolated save failure'}).waitFor();assert.equal(putCount,count);assert.equal(await cell(registration,'maintenance').inputValue(),'456.78');failSave=false;await save();
    console.log('Unsaved month guard, discard, validation and failed-save retry PASS');
    const current=await (await fetch(bridgeUrl+'/api/vehicle-performance-v5',{headers:{Authorization:'Bearer vp6-admin'}})).json();const currentReport=current.reports[0],currentRow=currentReport.rows.find(r=>r.registration===registration);
    await cell(registration,'expenses').fill('333.33');
    const concurrent=await fetch(bridgeUrl+'/api/vehicle-performance-v5',{method:'PUT',headers:{Authorization:'Bearer vp6-admin','Content-Type':'application/json'},body:JSON.stringify({changes:[{year:2026,month:8,registration,field:'expenses',value:'222.22',kind:'amount',expected:f.financialCellVersion(currentReport,currentRow,'expenses')}]})});assert.equal(concurrent.status,200);
    const conflict=page.waitForResponse(r=>r.url().includes('/api/vehicle-performance-v5')&&r.request().method()==='PUT');await root.getByRole('button',{name:'Save Changes',exact:true}).click();assert.equal((await conflict).status(),409);assert.equal(await cell(registration,'expenses').inputValue(),'333.33');
    await root.getByRole('button',{name:'Reload saved values',exact:true}).click();await row(registration).getByRole('button',{name:'Keep edit',exact:true}).waitFor();await row(registration).getByRole('button',{name:'Keep edit',exact:true}).click();await save();assert.equal(await cell(registration,'expenses').inputValue(),'333.33');
    console.log('Concurrent save conflict preserves edits and requires deliberate resolution PASS');
    await page.screenshot({path:path.join(output,'august-edited-desktop.png'),fullPage:true});
    for(const sort of ['balance','revenue','jobs','fuel','margin'])await root.getByRole('combobox',{name:'Sort by',exact:true}).selectOption(sort);
    await page.locator('#vehicle-performance-search').fill(registration);assert.equal(await table.locator('tbody tr').count(),1);await page.locator('#vehicle-performance-search').fill('');
    await page.evaluate(()=>window.__vpPdfTexts.length=0);let download=page.waitForEvent('download');await root.getByRole('button',{name:'Download fleet PDF',exact:true}).click();await(await download).saveAs(path.join(output,'august-effective-en.pdf'));
    const canvases=await page.evaluate(()=>window.__vpPdfCanvases.map(c=>c.toDataURL('image/png')));canvases.forEach((data,i)=>fs.writeFileSync(path.join(output,'export-page-'+(i+1)+'.png'),Buffer.from(data.split(',')[1],'base64')));
    const texts=await page.evaluate(()=>window.__vpPdfTexts);assert.ok(texts.some(text=>text.includes('456.78')));assert.ok(texts.some(text=>text.includes('333.33')));assert.ok(texts.some(text=>text.includes('†')));assert.ok(texts.some(text=>text.includes('TOTAL')));fs.writeFileSync(path.join(output,'pdf-drawn-text.json'),JSON.stringify(texts,null,2));
    await row(registration).getByRole('button',{name:'Details '+registration,exact:true}).click();const dialog=page.getByRole('dialog');await dialog.waitFor();download=page.waitForEvent('download');await dialog.getByRole('button',{name:'Download vehicle PDF',exact:true}).click();await(await download).saveAs(path.join(output,'vehicle-effective-en.pdf'));await dialog.getByRole('button',{name:'Close details',exact:true}).click();
    for(let month=1;month<=7;month++){await page.locator('#vehicle-performance-month').selectOption(String(month));await page.locator('#vehicle-performance-table').waitFor();await page.getByRole('button',{name:'Fleet vehicle ranking',exact:false}).count();const body=await page.locator('#vehicle-performance-table').innerText();assert.match(body,/V6-LEGACY/);assert.ok(body.includes((10000+month*100).toLocaleString('en-GB')));assert.ok(body.includes((8750+month*100).toLocaleString('en-GB')));}
    await page.locator('#vehicle-performance-month').selectOption('9');await openManage();await page.evaluate(()=>localStorage.setItem('fuel-bank-language','th'));await page.reload({waitUntil:'domcontentloaded'});await page.locator('#vehicle-performance-month').selectOption('9');await openManage();download=page.waitForEvent('download');await root.getByRole('button',{name:'ดาวน์โหลด PDF ทั้งกองรถ',exact:true}).click();await(await download).saveAs(path.join(output,'september-effective-th.pdf'));await page.screenshot({path:path.join(output,'september-thai.png'),fullPage:true});
    for(const viewport of [{width:1280,height:800},{width:390,height:844}]){await page.setViewportSize(viewport);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);await page.screenshot({path:path.join(output,'worksheet-'+viewport.width+'.png'),fullPage:true});}
    console.log('Saved-value PDFs, amendment marks, all January–July months, sorting, keyboard, Thai and responsive layouts PASS');
    const staffContext=await browser.newContext();await prepare(staffContext,bridgeUrl,'office_staff');const staff=await staffContext.newPage();await staff.goto(origin+'/vehicle-performance',{waitUntil:'domcontentloaded'});await staff.getByTestId('vehicle-financial-v6').waitFor();assert.equal(await staff.getByTestId('financial-vehicle-table').locator('input:enabled').count(),0);assert.equal((await fetch(bridgeUrl+'/api/vehicle-performance-v5',{method:'PUT',headers:{Authorization:'Bearer vp6-staff','Content-Type':'application/json'},body:'{"changes":[]}'})).status,403);await staffContext.close();
    const readerContext=await browser.newContext();await prepare(readerContext,bridgeUrl,'read_only');const reader=await readerContext.newPage();await reader.goto(origin+'/vehicle-performance',{waitUntil:'domcontentloaded'});await reader.getByTestId('financial-access-denied').waitFor();await readerContext.close();
    assert.deepEqual(errors,[]);fs.writeFileSync(path.join(output,'browser-results.json'),JSON.stringify({passed:true,origin,isolatedStore:store,successfulServerSaves:putCount,rowsPerMonth:21,months:[8,9],legacyMonths:[1,2,3,4,5,6,7],viewports:[1920,1280,390],errors},null,2));console.log('PASS: real disk-backed route, editable table, persistence, calculations, safeguards and PDF exports');
  }catch(error){console.error(error);console.log('Browser state',await page.evaluate(()=>({url:location.href,client:!!window.__fuelBankSupabaseBrowserClient,apis:performance.getEntriesByType('resource').filter(r=>r.name.includes('/api/')).map(r=>({name:r.name,duration:r.duration}))})).catch(()=>null));await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});throw error;}
  finally{await browser.close();await new Promise(resolve=>bridge.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1});
