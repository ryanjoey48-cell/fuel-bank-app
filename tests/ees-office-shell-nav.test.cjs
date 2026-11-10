const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

function walkPages(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".recovery") continue;
      walkPages(full, out);
    } else if (entry.name === "page.tsx") {
      out.push(full);
    }
  }
  return out;
}

function toRoute(file) {
  const rel = path.relative(path.join(root, "app"), file).replace(/\\/g, "/");
  return (
    "/" +
    rel
      .replace(/\/page\.tsx$/, "")
      .replace(/\(dashboard\)\/?/g, "")
      .replace(/\(auth\)\/?/g, "")
      .replace(/\(protected\)\/?/g, "")
      .replace(/\[\.\.\.[^\]]+\]/g, "*")
      .replace(/\[([^\]]+)\]/g, ":$1")
      .replace(/\/+/g, "/")
      .replace(/^\/$/, "")
  ).replace(/\/$/, "") || "/";
}

test("every authenticated office page inherits the shared dashboard TopNavigation shell", () => {
  const layout = fs.readFileSync(path.join(root, "app/(dashboard)/layout.tsx"), "utf8");
  assert.match(layout, /ees-office-shell/);
  assert.match(layout, /has-floating-nav/);
  assert.match(layout, /<TopNavigation\s*\/>/);
  assert.equal(layout.includes("compact={isFleetTrackingRoute}"), false);
  assert.equal((layout.match(/<TopNavigation/g) || []).length, 1);

  for (const rel of ["hr/layout.tsx", "drivers/layout.tsx", "employees/layout.tsx"]) {
    const source = fs.readFileSync(path.join(root, "app", rel), "utf8");
    assert.match(source, /from ["']@\/app\/\(dashboard\)\/layout["']/);
  }

  const pages = walkPages(path.join(root, "app"));
  const officePages = pages.filter((file) => {
    const route = toRoute(file);
    if (route.startsWith("/driver")) return false;
    if (route === "/login" || route === "/") return false;
    if (route.startsWith("/access/")) return false;
    if (route === "/fleet-route-replay-fixture") return false;
    return (
      file.includes(`${path.sep}(dashboard)${path.sep}`) ||
      file.includes(`${path.sep}hr${path.sep}`) ||
      file.includes(`${path.sep}drivers${path.sep}`) ||
      file.includes(`${path.sep}employees${path.sep}`)
    );
  });

  assert.ok(officePages.length >= 40, `expected many office pages, found ${officePages.length}`);

  for (const file of officePages) {
    const source = fs.readFileSync(file, "utf8");
    assert.equal(
      /<TopNavigation\b/.test(source),
      false,
      `${toRoute(file)} must not mount a duplicate TopNavigation`
    );
  }
});

test("office shell uses fluid desktop width instead of a narrow max-width column", () => {
  const layout = fs.readFileSync(path.join(root, "app/(dashboard)/layout.tsx"), "utf8");
  const css = fs.readFileSync(path.join(root, "app/globals.css"), "utf8");

  assert.match(layout, /ees-shell-main--wide/);
  assert.match(layout, /ees-shell-main--narrow/);
  assert.match(layout, /\/booking-diary/);
  assert.match(layout, /\/weekly-mileage/);
  assert.match(css, /\.ees-shell-main--standard[\s\S]*?max-width:\s*none/);
  assert.match(css, /\.ees-office-shell\s+\.booking-diary-page[\s\S]*?max-width:\s*none/);
  assert.match(css, /padding-inline:\s*clamp\(24px/);
  assert.equal(/max-width:\s*1760px/.test(css), false);
  assert.equal(/\.booking-diary-page\s*\{[^}]*max-width:\s*1100px/.test(css) && !css.includes(".ees-office-shell .booking-diary-page"), false);
});

test("office route inventory covers the approved navigation destinations", () => {
  // Menu definitions (links, groups, permission gates) now live in lib/office-nav.tsx; the shell components render them. Assertions below are unchanged.
  const nav = fs.readFileSync(path.join(root, "components/top-navigation.tsx"), "utf8") + " " + fs.readFileSync(path.join(root, "lib/office-nav.tsx"), "utf8");
  const required = [
    "/dashboard",
    "/booking-diary",
    "/dispatch",
    "/shipments",
    "/trip-journey",
    "/locations",
    "/insurance",
    "/inventory",
    "/fleet-tracking",
    "/weekly-mileage",
    "/maintenance",
    "/finance-centre",
    "/fuel-logs",
    "/fuel-spend-report",
    "/vehicle-performance",
    "/hr",
    "/admin/driver-operations",
    "/safety",
    "/reports",
    "/admin/support-tickets",
    "/admin/users"
  ];

  for (const href of required) {
    assert.ok(nav.includes(`href: "${href}"`) || nav.includes(`href: '${href}'`), href);
  }

  const pages = new Set(walkPages(path.join(root, "app")).map(toRoute));
  for (const href of required) {
    assert.ok(pages.has(href), `missing page for ${href}`);
  }
});

test("Operations has the seven requested links in order on desktop and mobile", () => {
  // Menu definitions (links, groups, permission gates) now live in lib/office-nav.tsx; the shell components render them. Assertions below are unchanged.
  const nav = fs.readFileSync(path.join(root, "components/top-navigation.tsx"), "utf8") + " " + fs.readFileSync(path.join(root, "lib/office-nav.tsx"), "utf8");
  const operations = nav.slice(nav.indexOf("const operationsItems"), nav.indexOf("const fleetItems"));
  const hrefs = [...operations.matchAll(/href: "([^"]+)"/g)].map((match) => match[1]);

  assert.deepEqual(hrefs, [
    "/booking-diary",
    "/dispatch",
    "/shipments",
    "/trip-journey",
    "/locations",
    "/insurance",
    "/inventory"
  ]);
  assert.match(operations, /href: "\/locations",\s*label: copy\.locationsDirectory,\s*icon: MapPinned/);
  assert.doesNotMatch(operations, /copy\.locations\b|\/fleet-events/);
  assert.equal((nav.match(/entries\.map\(/g) || []).length, 2);

  const pages = new Set(walkPages(path.join(root, "app")).map(toRoute));
  for (const href of hrefs) {
    assert.ok(pages.has(href), `missing Operations page for ${href}`);
  }
  assert.ok(pages.has("/fleet-events"), "underlying Fleet Events page is retained");
});
