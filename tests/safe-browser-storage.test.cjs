const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const vm = require("node:vm");

function loadSafeStorageWithWindow(windowObject) {
  const source = fs.readFileSync(path.resolve("lib/safe-browser-storage.ts"), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020
    }
  }).outputText;
  const sandbox = {
    exports: {},
    window: windowObject
  };

  vm.createContext(sandbox);
  vm.runInContext(compiled, sandbox);
  return sandbox.exports;
}

test("safe browser storage falls back to memory when browser storage throws", () => {
  const blockedWindow = {};
  Object.defineProperty(blockedWindow, "localStorage", {
    get() {
      throw new DOMException("blocked", "SecurityError");
    }
  });
  Object.defineProperty(blockedWindow, "sessionStorage", {
    get() {
      throw new DOMException("blocked", "SecurityError");
    }
  });

  const { safeLocalStorage, safeSessionStorage } = loadSafeStorageWithWindow(blockedWindow);

  safeLocalStorage.setItem("auth", "token");
  assert.equal(safeLocalStorage.getItem("auth"), "token");
  safeLocalStorage.removeItem("auth");
  assert.equal(safeLocalStorage.getItem("auth"), null);

  safeSessionStorage.setItem("filters", "active");
  assert.equal(safeSessionStorage.getItem("filters"), "active");
});

test("app code avoids direct throwing browser storage access", () => {
  const files = [
    "app",
    "components",
    "lib"
  ].flatMap((root) => {
    const found = [];
    const walk = (current) => {
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const next = path.join(current, entry.name);
        if (entry.isDirectory()) {
          walk(next);
        } else if (/\.(tsx?|jsx?)$/.test(entry.name)) {
          found.push(next);
        }
      }
    };
    walk(root);
    return found;
  });

  const unsafeReferences = files
    .filter((file) => path.normalize(file) !== path.normalize("lib/safe-browser-storage.ts"))
    .flatMap((file) => {
      const source = fs.readFileSync(file, "utf8");
      return /window\.(localStorage|sessionStorage)|\b(localStorage|sessionStorage)\./.test(source) ? [file] : [];
    });

  assert.deepEqual(unsafeReferences, []);
});

test("Supabase browser client import path is non-throwing and has no placeholder fallback", () => {
  const source = fs.readFileSync(path.resolve("lib/supabase.ts"), "utf8");

  assert.doesNotMatch(source, /https:\/\/placeholder\.supabase\.co/);
  assert.doesNotMatch(source, /placeholder-anon-key/);
  assert.doesNotMatch(source, /@supabase\/supabase-js/);
  assert.doesNotMatch(source, /createClient\s*\(/);
  assert.doesNotMatch(source, /if\s*\(\s*missingSupabaseEnv\s*\)\s*{\s*throw/s);
  assert.match(source, /supabaseConfigError/);
  assert.match(source, /storage:\s*safeLocalStorage/);
  assert.match(source, /lock:\s*safeAuthLock/);
  assert.match(source, /__fuelBankSupabaseBrowserClient/);
  assert.match(source, /getSupabaseBrowserClient/);
  assert.match(source, /channel:\s*createNoopRealtimeChannel/);
});

test("login redirect does not refresh the stale login route after sign-in", () => {
  const source = fs.readFileSync(path.resolve("components/auth-form.tsx"), "utf8");
  const loginRedirectIndex = source.indexOf("router.replace(returnPath)");

  assert.notEqual(loginRedirectIndex, -1);
  assert.equal(source.includes("router.refresh()"), false);
  assert.match(source, /event\.preventDefault\(\)/);
  assert.match(source, /supabase\.auth\.getSession\(\)/);
});
