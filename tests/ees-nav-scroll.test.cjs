const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");

function loadTs(relativePath) {
  const filename = path.join(root, relativePath);
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded._compile(
    ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022
      }
    }).outputText,
    filename
  );
  return loaded.exports;
}

const {
  decideNavHidden,
  EES_NAV_SCROLL_DELTA_MIN,
  EES_NAV_SCROLL_TOP_THRESHOLD
} = loadTs("lib/ees-nav-scroll.ts");

test("navbar stays visible near the top of the page", () => {
  assert.equal(
    decideNavHidden({
      currentY: EES_NAV_SCROLL_TOP_THRESHOLD,
      lastY: 20,
      currentlyHidden: true,
      busy: false,
      focusInsideNav: false
    }),
    false
  );
});

test("navbar hides after scrolling down past the threshold", () => {
  assert.equal(
    decideNavHidden({
      currentY: 140,
      lastY: 140 - (EES_NAV_SCROLL_DELTA_MIN + 1),
      currentlyHidden: false,
      busy: false,
      focusInsideNav: false
    }),
    true
  );
});

test("navbar reappears when scrolling up", () => {
  assert.equal(
    decideNavHidden({
      currentY: 180,
      lastY: 180 + (EES_NAV_SCROLL_DELTA_MIN + 1),
      currentlyHidden: true,
      busy: false,
      focusInsideNav: false
    }),
    false
  );
});

test("navbar stays visible while dropdowns or mobile menu are busy", () => {
  assert.equal(
    decideNavHidden({
      currentY: 220,
      lastY: 180,
      currentlyHidden: false,
      busy: true,
      focusInsideNav: false
    }),
    false
  );
});

test("navbar stays visible during keyboard focus inside navigation", () => {
  assert.equal(
    decideNavHidden({
      currentY: 220,
      lastY: 180,
      currentlyHidden: false,
      busy: false,
      focusInsideNav: true
    }),
    false
  );
});

test("small scroll jitter does not flip visibility", () => {
  assert.equal(
    decideNavHidden({
      currentY: 200,
      lastY: 200 - (EES_NAV_SCROLL_DELTA_MIN - 1),
      currentlyHidden: false,
      busy: false,
      focusInsideNav: false
    }),
    false
  );
  assert.equal(
    decideNavHidden({
      currentY: 200,
      lastY: 200 + (EES_NAV_SCROLL_DELTA_MIN - 1),
      currentlyHidden: true,
      busy: false,
      focusInsideNav: false
    }),
    true
  );
});

test("floating navigation wires multi-root scroll helpers and brand lockup", () => {
  const nav = fs.readFileSync(path.join(root, "components/top-navigation.tsx"), "utf8");
  const css = fs.readFileSync(path.join(root, "app/globals.css"), "utf8");
  assert.match(nav, /collectNavScrollRoots/);
  assert.match(nav, /decideNavHidden/);
  assert.match(nav, /ees-floating-nav__brand-title/);
  assert.match(nav, /:focus-visible/);
  assert.doesNotMatch(nav, /scrollLocked/);
  assert.doesNotMatch(nav, /prefersReducedMotion\(\)/);
  assert.match(css, /\.ees-floating-nav\.is-nav-hidden/);
  const reducedMotionNav = css.slice(css.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
  assert.equal(reducedMotionNav.includes(".ees-floating-nav.is-nav-hidden"), false);
  assert.match(css, /\.ees-floating-nav__brand-copy/);
  assert.match(css, /min-height:\s*64px/);
});

test("office layout mounts one universal floating navbar for every authenticated route", () => {
  const layout = fs.readFileSync(path.join(root, "app/(dashboard)/layout.tsx"), "utf8");
  const nav = fs.readFileSync(path.join(root, "components/top-navigation.tsx"), "utf8");
  const css = fs.readFileSync(path.join(root, "app/globals.css"), "utf8");
  assert.equal((layout.match(/<TopNavigation/g) || []).length, 1);
  assert.match(layout, /has-floating-nav/);
  assert.equal(layout.includes("compact={isFleetTrackingRoute}"), false);
  assert.match(layout, /ees-office-shell/);
  assert.match(layout, /ees-fleet-viewport/);
  assert.equal(nav.includes("top-navigation-fleet-premium"), false);
  assert.match(nav, /skipAutoHide/);
  assert.match(css, /\.ees-floating-nav\s*\{[\s\S]*?position:\s*fixed/);
  assert.doesNotMatch(css, /top-navigation-fleet-premium/);
  assert.doesNotMatch(
    css,
    /\.dashboard-dispatch-shell > \.top-navigation\.ees-floating-nav \{[\s\S]*?position:\s*relative/
  );
});
