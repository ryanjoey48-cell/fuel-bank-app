const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const runtime = require('react/jsx-runtime');
function load(file, deps = {}) {
  const module = { exports: {} };
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  new Function('require', 'module', 'exports', js)((name) => { if (name === './driver-route-options') return load('components/driver/driver-route-options.tsx', { react: require('react'), 'react/jsx-runtime': require('react/jsx-runtime'), 'lucide-react': require('lucide-react') }); if (name === './driver-disclosure') return load('components/driver/driver-disclosure.tsx', { 'react/jsx-runtime': require('react/jsx-runtime'), 'lucide-react': require('lucide-react') }); assert.ok(name in deps, name); return deps[name]; }, module, module.exports);
  return module.exports;
}
const ui = load('components/driver/driver-ui.tsx', { react: React, 'react/jsx-runtime': runtime, 'next/image': () => null });
const ops = load('lib/driver-operations.ts');
const portal = load('lib/driver-portal.ts');
const vehicleLabels = load('lib/driver-vehicle-types.ts');
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (tree.type?.name === 'DriverDisclosure') return nodes(tree.type(tree.props));
  return [tree, ...nodes(tree.props?.children)];
}
function hooks(seed = []) {
  let index = 0;
  const state = [...seed];
  return {
    state, reset() { index = 0; },
    react: { ...React, useState(initial) { const i = index++; if (!(i in state)) state[i] = initial; return [state[i], (value) => { state[i] = typeof value === 'function' ? value(state[i]) : value; }]; }, useEffect() {}, useCallback: (fn) => fn, useRef: (value) => ({ current: value }) }
  };
}
test('detail places next action before route and preserves sequential event buttons and final confirmation', async () => {
  const oldFetch = global.fetch;
  const icons = Object.fromEntries(['ArrowDown', 'ArrowLeft', 'ChevronRight', 'Check', 'Clock3', 'ExternalLink', 'MapPin', 'Navigation2', 'Phone', 'RefreshCw', 'Truck'].map((name) => [name, () => null]));
  try {
    for (let stage = 0; stage < 4; stage++) {
      const events = portal.DRIVER_JOB_EVENT_TYPES.slice(0, stage).map((eventType) => ({ eventType, eventTime: '2026-10-02T03:00:00Z', latitude: null, longitude: null }));
      const h = hooks([events, false]);
      const calls = [];
      global.fetch = async (url, init) => { calls.push({ url, init }); return { ok: true, json: async () => ({ event: { eventType: portal.DRIVER_JOB_EVENT_TYPES[stage], eventTime: '2026-10-02T04:00:00Z' } }) }; };
      const { DriverJobDetail } = load('components/driver/driver-job-detail.tsx', {
        react: h.react, 'react/jsx-runtime': runtime, 'lucide-react': icons,
        '@/lib/driver-operations': ops, 'next/navigation': { useRouter: () => ({ refresh() {} }) }, 'next/link': ({ children, ...props }) => React.createElement('a', props, children),
        '@/lib/language-provider': { useLanguage: () => ({ language: 'en' }) },
        '@/lib/driver-portal': portal, '@/lib/driver-vehicle-types': vehicleLabels
      });
      const tree = DriverJobDetail({ job: { id: 'own-job', bookingDate: '2026-10-02', pickupName: 'Pickup', dropoffName: 'Delivery' }, depot: { name: 'Depot', address: 'Depot' } });
      const action = nodes(tree).find((node) => node.type === 'section' && node.props['aria-labelledby'] === 'job-next-action');
      const button = nodes(action).find((node) => node.type === 'button');
      assert.equal(button.props.children, ['Arrived at pickup', 'Leave pickup', 'Arrived at delivery', 'Complete job'][stage]);
      const html = renderToStaticMarkup(tree);
      assert.ok(html.indexOf('id="job-next-action"') < html.indexOf('id="job-route"'));
      button.props.onClick();
      await new Promise(setImmediate);
      if (stage === 3) {
        assert.equal(h.state[6], true); assert.equal(calls.length, 0);
      } else {
        assert.equal(calls.length, 1);
        assert.equal(calls[0].url, '/api/driver/jobs/own-job/events');
        assert.deepEqual(JSON.parse(calls[0].init.body), { eventType: portal.DRIVER_JOB_EVENT_TYPES[stage], latitude: null, longitude: null });
        assert.equal(h.state[0].length, stage + 1);
      }
    }
  } finally { global.fetch = oldFetch; }
});
test('driver-only status wording and action labels cover every operational status in both languages', () => {
  for (const language of ['en', 'th']) for (const status of ops.operationStatuses) {
    assert.ok(ui.driverStatusCopy[language][status]);
    assert.ok(ui.driverJobAction(language, status));
  }
  assert.equal(ui.driverJobAction('en', 'ready'), 'Start job');
  for (const status of ['pickup', 'en_route', 'delivery']) assert.equal(ui.driverJobAction('en', status), 'Continue job');
  assert.equal(ui.driverJobAction('en', 'completed'), 'View completed job');
});
test('avatar hides an unloaded image, removes a failed image and retries a changed canonical URL', () => {
  const h = hooks();
  const avatar = load('components/driver/driver-ui.tsx', { react: h.react, 'react/jsx-runtime': runtime, 'next/image': () => null });
  const outer = avatar.DriverAvatar({ src: '/signed-old', name: 'Joey Test' });
  assert.equal(outer.props['aria-label'], 'Joey Test');
  assert.equal(outer.props.children[0].props.children, 'JT');
  const inner = outer.props.children[1];
  let image = inner.type(inner.props);
  assert.ok(image.props.className.includes('opacity-0'));
  image.props.onLoad(); h.reset();
  image = inner.type(inner.props);
  assert.ok(image.props.className.includes('opacity-100'));
  image.props.onError(); h.reset();
  assert.equal(inner.type(inner.props), null);
  const fresh = avatar.DriverAvatar({ src: '/signed-new', name: 'Joey Test' }).props.children[1];
  assert.notEqual(fresh.key, inner.key);
  assert.equal(fresh.props.src, '/signed-new');
  assert.equal(avatar.DriverAvatar({ name: '' }).props.children[0].props.children, 'EES');
});
for (const language of ['en', 'th']) {
  test(`jobs shows one current card and compact completed/upcoming links in ${language}`, () => {
    const icons = Object.fromEntries(['CalendarDays', 'ChevronRight', 'Clock3', 'PackageCheck', 'Truck'].map((name) => [name, () => null]));
    const { DriverHome } = load('components/driver/driver-home.tsx', { react: React, 'react/jsx-runtime': runtime, 'lucide-react': icons, 'next/link': ({ children, ...props }) => React.createElement('a', props, children), '@/lib/language-provider': { useLanguage: () => ({ language }) }, '@/lib/driver-operations': ops, './driver-ui': ui });
    const jobs = ['current', 'done', 'future'].map((id, index) => ({ id, bookingDate: index === 2 ? '2026-10-03' : '2026-10-02', pickupTime: '10:00', pickupName: 'Pickup', dropoffName: 'Delivery', vehicleRegistration: '1998', clientName: id }));
    const html = renderToStaticMarkup(React.createElement(DriverHome, { driverName: 'Joey', today: '2026-10-02', jobs, eventsByJob: { current: [{ eventType: 'pickup_arrived', eventTime: '2026-10-02T03:00:00Z' }], done: [{ eventType: 'job_completed', eventTime: '2026-10-02T04:00:00Z' }] } }));
    for (const job of jobs) assert.equal((html.match(new RegExp('href="/driver/jobs/' + job.id + '"', 'g')) || []).length, 1);
    assert.ok(html.indexOf('/driver/jobs/current') < html.indexOf('/driver/jobs/done'));
    assert.ok(html.includes(ui.driverJobAction(language, 'pickup')));
    assert.ok(html.includes(ui.driverJobAction(language, 'completed')));
    assert.ok(html.includes(language === 'en' ? 'Tomorrow' : 'พรุ่งนี้'));
  });
}
const profile = { displayName: 'Joey', officialName: 'Joey Test', driverId: '26', phone: '123', email: 'own@example.com', vehicle: '1998', avatarUrl: null };
function profileHarness(language = 'en') {
  const h = hooks([profile, 'Joey', '123']);
  const calls = [], changes = [];
  const component = load('components/driver/driver-profile.tsx', {
    react: h.react, 'react/jsx-runtime': runtime, './driver-ui': ui,
    'next/navigation': { useRouter: () => ({ refresh: () => calls.push('refresh') }) },
    '@/lib/language-provider': { useLanguage: () => ({ language, setLanguage: (value) => changes.push(value) }) }
  });
  const render = () => { h.reset(); return component.DriverProfilePage(); };
  return { ...h, calls, changes, render };
}
test('profile keeps password controls collapsed, identity visible and language selectable in EN/TH', () => {
  for (const language of ['en', 'th']) {
    const p = profileHarness(language);
    const tree = nodes(p.render());
    const details = tree.find((node) => node.type === 'details' && nodes(node).some(child => child.type === 'input' && child.props.type === 'password'));
    assert.ok(details); assert.equal(details.props.open, undefined);
    assert.equal(nodes(details).filter((node) => node.type === 'input' && node.props.type === 'password').length, 3);
    tree.find((node) => node.type === 'select').props.onChange({ target: { value: language === 'en' ? 'th' : 'en' } });
    assert.deepEqual(p.changes, [language === 'en' ? 'th' : 'en']);
    assert.ok(renderToStaticMarkup(p.render()).includes('1998'));
  }
});
test('profile save and avatar upload retain authenticated endpoints and canonical profile refresh', async () => {
  const oldFetch = global.fetch, oldWindow = global.window;
  const p = profileHarness();
  global.window = { dispatchEvent() {} };
  global.fetch = async (url, init) => { p.calls.push({ url, init }); return { ok: true, json: async () => ({ ...profile, avatarUrl: '/new-signed-avatar' }) }; };
  try {
    const tree = nodes(p.render());
    tree.find((node) => node.type === 'form').props.onSubmit({ preventDefault() {} });
    await new Promise(setImmediate);
    const save = p.calls.find((call) => call.url === '/api/driver/profile' && call.init?.method === 'PATCH');
    assert.deepEqual(JSON.parse(save.init.body), { displayName: 'Joey', phone: '123' });
    assert.ok(p.calls.some((call) => call.url === '/api/driver/profile' && call.init?.cache === 'no-store'));
    const upload = tree.find((node) => node.type === 'input' && node.props.type === 'file');
    const target = { files: [new File(['image'], 'photo.png', { type: 'image/png' })], value: 'photo.png' };
    upload.props.onChange({ target });
    await new Promise(setImmediate);
    const sent = p.calls.find((call) => call.url === '/api/driver/profile/avatar');
    assert.equal(sent.init.method, 'POST'); assert.ok(sent.init.body instanceof FormData);
    assert.equal(sent.init.body.get('avatar').type, 'image/png');
    assert.equal(target.value, ''); assert.equal(p.state[0].avatarUrl, '/new-signed-avatar');
    const count = p.calls.length;
    upload.props.onChange({ target: { files: [{ size: 5242881, type: 'image/png' }], value: '' } });
    assert.equal(p.calls.length, count); assert.equal(p.state[3], true);
  } finally { global.fetch = oldFetch; global.window = oldWindow; }
});
test('collapsed password form still validates and submits the same password payload', async () => {
  const oldFetch = global.fetch, oldWindow = global.window, oldFormData = global.FormData;
  const p = profileHarness();
  let reset = false;
  const body = { currentPassword: 'existing-secret', password: 'long-new-secret', confirmPassword: 'long-new-secret' };
  global.window = { dispatchEvent() {} };
  global.FormData = class { constructor(form) { this.form = form; } get(key) { return this.form[key]; } };
  global.fetch = async (url, init) => { p.calls.push({ url, init }); return { ok: true, json: async () => profile }; };
  try {
    const tree = nodes(p.render());
    const form = tree.find((node) => node.type === 'form' && nodes(node).some(child => child.type === 'input' && child.props.type === 'password'));
    const event = { preventDefault() {}, currentTarget: { ...body, reset() { reset = true; } } };
    form.props.onSubmit(event);
    await new Promise(setImmediate);
    const sent = p.calls.find((call) => call.url === '/api/driver/profile/password');
    assert.equal(sent.init.method, 'POST'); assert.deepEqual(JSON.parse(sent.init.body), body); assert.ok(reset);
    const count = p.calls.length;
    form.props.onSubmit({ ...event, currentTarget: { ...event.currentTarget, confirmPassword: 'mismatch' } });
    await new Promise(setImmediate);
    assert.equal(p.calls.length, count); assert.equal(p.state[3], true);
  } finally { global.fetch = oldFetch; global.window = oldWindow; global.FormData = oldFormData; }
});
test('Edit profile opens the existing personal details editor and focuses the name input', () => {
  for (const language of ['en', 'th']) {
    const p = profileHarness(language);
    const tree = nodes(p.render());
    let focused = false;
    const personal = tree.find(node => node.type === 'details' && nodes(node).some(child => child.type === 'input' && child.props.type === 'file'));
    assert.ok(personal); assert.equal(personal.props.open, undefined);
    const target = { open: false, querySelector: () => ({ focus() { focused = true; } }) };
    personal.props.ref.current = target;
    tree.find(node => node.type === 'button' && node.props.className.includes('driver-accent')).props.onClick();
    assert.ok(target.open); assert.ok(focused);
    const identity = tree.find(node => node.type === 'section');
    assert.equal(nodes(identity).filter(node => node.type === 'input').length, 0);
  }
});
for (const language of ['en','th']) for (const pathname of ['/driver','/driver/jobs/test','/driver/history','/driver/profile']) {
  test(`bottom navigation has one purple selection on a continuous surface: ${language} ${pathname}`, () => {
    const { DriverNavigation } = load('components/driver/driver-navigation.tsx', {
      react: React, 'react/jsx-runtime': runtime, 'lucide-react': require('lucide-react'),
      'next/link': ({children,...props}) => React.createElement('a',props,children),
      'next/navigation': {usePathname:()=>pathname},
      '@/lib/language-provider': {useLanguage:()=>({language})}
    });
    const html=renderToStaticMarkup(React.createElement(DriverNavigation));
    assert.equal((html.match(/aria-current="page"/g)||[]).length,1);
    assert.equal((html.match(/driver-accent/g)||[]).length,1);
    assert.ok(!html.includes('bg-[#152638]')); assert.ok(html.includes('pb-[env(safe-area-inset-bottom)]'));
    assert.equal((html.match(/href="/g)||[]).length,3);
  });
}
