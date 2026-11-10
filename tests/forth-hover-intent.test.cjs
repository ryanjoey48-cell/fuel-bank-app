const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");

function loadTypeScript(relative) {
  const file = path.join(root, relative);
  const module = new Module(file);
  module.filename = file;
  module.paths = Module._nodeModulePaths(path.dirname(file));
  module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, file);
  return module.exports;
}

const { createForthHoverIntent } = loadTypeScript("lib/forth-hover-intent.ts");

function createClock() {
  const timers = new Map();
  let nextId = 1;
  let now = 0;
  return {
    now: () => now,
    schedule(callback, delayMs) {
      const id = nextId++;
      timers.set(id, { fireAt: now + delayMs, callback });
      return id;
    },
    cancel(id) {
      timers.delete(id);
    },
    advance(ms) {
      now += ms;
      for (const [id, timer] of [...timers.entries()].sort((a, b) => a[1].fireAt - b[1].fireAt)) {
        if (timer.fireAt > now) continue;
        timers.delete(id);
        timer.callback();
      }
    }
  };
}

test("hover intent waits briefly before opening a single preview", () => {
  const opened = [];
  const closed = [];
  const clock = createClock();
  const intent = createForthHoverIntent((key) => opened.push(key), () => closed.push("close"), clock);
  intent.enter("A");
  assert.deepEqual(opened, []);
  clock.advance(179);
  assert.deepEqual(opened, []);
  clock.advance(1);
  assert.deepEqual(opened, ["A"]);
  assert.deepEqual(closed, []);
});

test("moving between icon and label of the same vehicle does not reopen the preview", () => {
  const opened = [];
  const clock = createClock();
  const intent = createForthHoverIntent((key) => opened.push(key), () => undefined, clock);
  intent.enter("A");
  clock.advance(180);
  intent.leave("A");
  intent.enter("A");
  clock.advance(160);
  assert.deepEqual(opened, ["A"]);
  intent.leave("A");
  clock.advance(160);
  intent.enter("A");
  clock.advance(180);
  assert.deepEqual(opened, ["A", "A"]);
});

test("keyboard focus opens immediately while click-dense groups can dismiss", () => {
  const opened = [];
  const closed = [];
  const clock = createClock();
  const intent = createForthHoverIntent((key) => opened.push(key), () => closed.push("close"), clock);
  intent.focus("B");
  assert.deepEqual(opened, ["B"]);
  intent.dismiss();
  assert.deepEqual(closed, ["close"]);
  intent.enter("C");
  intent.dismiss();
  clock.advance(500);
  assert.deepEqual(opened, ["B"]);
});

test("map wiring keeps one hover preview and click-first dense groups", () => {
  const map = fs.readFileSync(path.join(root, "components/forth-tracking-map.tsx"), "utf8");
  const css = fs.readFileSync(path.join(root, "components/forth-tracking-map.module.css"), "utf8");
  assert.match(map, /createForthHoverIntent/);
  assert.match(map, /vehicleHoverTooltip/);
  assert.match(map, /relatedTarget/);
  assert.match(map, /riseOnHover:\s*false/);
  assert.match(map, /refreshOpenHoverRef/);
  assert.match(map, /onSharedLocationRef\.current\?\.\(overlapKeys, "map_overlap"\)/);
  assert.equal(map.includes("bindTooltip("), false);
  assert.match(css, /\.vehicleHoverTooltip/);
});
