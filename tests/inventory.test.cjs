const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const test = require('node:test');
const ts = require('typescript');

function load(filename) {
  filename = path.resolve(filename);
  const mod = new Module(filename, module);
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  mod.require = request => {
    if (request.startsWith('.')) {
      const base = path.resolve(path.dirname(filename), request);
      const target = [base, base+'.ts'].find(fs.existsSync);
      if (target) return load(target);
    }
    return require(request);
  };
  mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText, filename);
  return mod.exports;
}
const inventory=load('lib/inventory.ts');
const translations=load('lib/translations.ts').translations;
const audit={created_by:'u',created_at:'2026-09-16',updated_by:'u',updated_at:'2026-09-16'};
const item=(id,name)=>({...audit,id,category_id:'c',name,name_th:null,sku:null,description:null,unit:'piece',reorder_quantity:0,preferred_supplier:null,storage_location:null,notes:null,active:true});
const variant=(id,item_id,current_quantity,minimum_stock,name=null)=>({...audit,id,item_id,name,sku:null,is_default:name===null,current_quantity,minimum_stock,average_cost:250});

test('receiving twice accumulates stock and negative adjustments are rejected',()=>{
  let stock=0;
  stock=inventory.previewInventoryMovement(stock,10,'received');
  stock=inventory.previewInventoryMovement(stock,5,'received');
  assert.equal(stock,15);
  assert.throws(()=>inventory.previewInventoryMovement(stock,16,'adjustment_minus'),/NEGATIVE_STOCK/);
});

test('low and out-of-stock states follow exact thresholds',()=>{
  assert.equal(inventory.inventoryStockStatus(2,3),'low');
  assert.equal(inventory.inventoryStockStatus(0,3),'out');
  assert.equal(inventory.inventoryStockStatus(4,3),'ok');
});

test('variant quantities stay separate and stock value uses weighted costs',()=>{
  const data={categories:[],items:[item('p','Polo Shirt')],variants:[variant('l','p',5,2,'L'),variant('xl','p',10,2,'XL')],movements:[]};
  assert.deepEqual(data.variants.map(v=>[v.name,v.current_quantity]),[['L',5],['XL',10]]);
  assert.deepEqual(inventory.inventorySummary(data),{totalItems:1,lowStock:0,outOfStock:0,stockValue:3750});
});

test('inventory copy is complete in English and Thai',()=>{
  for(const language of ['en','th']) {
    const c=translations[language].inventory;
    for(const key of ['title','stockItems','receiveStock','movementType','lowStock','outOfStock','minimumStock','stockValue','storageLocation','supplier','quantity','unitCost','category','variant']) assert.ok(c[key],`${language}.${key}`);
    assert.ok(translations[language].nav.inventory);
  }
});

test('migration enforces atomic idempotent movements and immutable history',()=>{
  const sql=fs.readFileSync(path.resolve('supabase/migrations/20260916160000_add_inventory_phase_1.sql'),'utf8');
  assert.match(sql,/request_id uuid not null unique/);
  assert.match(sql,/for update/);
  assert.match(sql,/if found then return mid/);
  assert.match(sql,/INVENTORY_NEGATIVE_STOCK/);
  assert.match(sql,/revoke all on public\.inventory_categories,public\.inventory_items,public\.inventory_variants,public\.inventory_movements/);
  assert.doesNotMatch(sql,/grant (insert|update|delete) on public\.inventory_movements/i);
});

test('phase 2 issues preserve separate driver, vehicle and general-use movement semantics',()=>{
  assert.equal(inventory.previewInventoryMovement(10,2,'issued_to_driver'),8);
  assert.equal(inventory.previewInventoryMovement(5,1,'issued_to_vehicle'),4);
  assert.equal(inventory.previewInventoryMovement(3,2,'general_use'),1);
  assert.throws(()=>inventory.previewInventoryMovement(2,3,'issued_to_driver'),/NEGATIVE_STOCK/);
});

test('phase 2 migration links existing drivers and vehicles and keeps issue posting idempotent',()=>{
  const sql=fs.readFileSync(path.resolve('supabase/migrations/20260917100000_inventory_phase_2_issuing.sql'),'utf8');
  assert.match(sql,/driver_id uuid references public\.drivers\(id\)/);
  assert.match(sql,/vehicle_id uuid references public\.vehicles\(id\)/);
  assert.match(sql,/issued_to_driver.*issued_to_vehicle.*general_use/s);
  assert.match(sql,/INVENTORY_INSUFFICIENT_STOCK/);
  assert.match(sql,/pg_advisory_xact_lock/);
  assert.match(sql,/if found then return mid/);
  assert.match(sql,/created_by_name/);
  assert.doesNotMatch(sql,/create table public\.(drivers|vehicles)/i);
});

test('phase 2 issue UI exposes review, searchable targets, filters, and bilingual copy',()=>{
  const issue=fs.readFileSync(path.resolve('components/inventory-issue-dialog.tsx'),'utf8');
  const history=fs.readFileSync(path.resolve('components/inventory-history.tsx'),'utf8');
  assert.match(issue,/SearchPicker/);
  assert.match(issue,/reviewing/);
  assert.match(issue,/requestId=useRef\(crypto\.randomUUID\(\)\)/);
  for(const language of ['en','th']) for(const key of ['issueStock','issuedToDriver','issuedToVehicle','generalUse','driver','vehicle','insufficientStock','issueHistory','issuedBy']) assert.ok(translations[language].inventory[key],`${language}.${key}`);
  for(const filter of ['movementType','driverId','vehicleId','itemId','fromDate']) assert.ok(history.includes(filter),filter);
});
