import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { test } from "node:test";
import ts from "typescript";

// Run the actual viewer entry point and setting reader. Cesium and the other
// managers are doubles so an offline test can observe whether tiles are loaded.
const root = path.resolve("public/js/viewer");
async function start({ search = "?organizationId=team-a", mobile = false, enabled = false, status = 200, failure = false, timeout = false } = {}) {
  const state = { requests: [], tiles: 0, ready: 0, hidden: false, recovered: false };
  const timers = new Set();
  const modules = new Map(Object.entries({
    "src/utils/config.js": { IS_MOBILE: mobile, CESIUM_ION_TOKEN: "test" },
    "src/managers/viewerManager.js": { initViewer: () => ({}), resetCamera() {}, flyToOrigin() {} },
    "src/managers/recoveryManager.js": { setupRecovery() {}, waitForHealthyWebgl: async () => true, recoverFromFatal: () => { state.recovered = true; } },
    "src/managers/messageHandler.js": { setupMessageListener() {}, sendMessageToParent: () => { state.ready++; } },
    "src/managers/clickHandler.js": { setupClickHandler() {} },
    "src/managers/interactionManager.js": { setupInteraction() {}, setMode() {} },
    "src/managers/tilesetLoader.js": { load3DTiles: async () => { state.tiles++; }, getTileset: () => null },
  }).map(([name, value]) => [path.join(root, name), value]));
  function load(filename) {
    if (modules.has(filename)) return modules.get(filename);
    const exports = {};
    modules.set(filename, exports);
    const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(compiled, {
      exports, URLSearchParams, AbortController,
      window: { location: { search } },
      document: { getElementById: () => ({ classList: { add: () => { state.hidden = true; } } }) },
      Cesium: { Ion: {} }, console,
      fetch: async (url, options) => {
        state.requests.push({ url, options });
        if (failure) throw new Error("offline");
        if (timeout) return new Promise((_, reject) => options.signal.addEventListener("abort", () => reject(new Error("timeout"))));
        return { ok: status === 200, json: async () => ({ data: { enabled } }) };
      },
      setTimeout: (fn, delay) => {
        timers.add(fn);
        if (delay === 1000 || timeout) queueMicrotask(fn);
        return fn;
      },
      clearTimeout: (fn) => timers.delete(fn),
      require: (name) => load(path.resolve(path.dirname(filename), name)),
    }, { filename });
    return exports;
  }
  load(path.join(root, "app.js"));
  await new Promise(setImmediate);
  assert.equal(state.ready, 1, "the map's message bridge becomes ready with or without the scan");
  assert.equal(state.hidden, true, "the optional scan must not block the base map");
  assert.equal(state.recovered, false, "configuration failures must not restart WebGL");
  return state;
}

test("default viewer and mobile viewers never request scan settings or tiles", async () => {
  for (const options of [{ search: "" }, { search: "?scanModel=true" }, { mobile: true, enabled: true }]) {
    const state = await start(options);
    assert.equal(state.requests.length, 0);
    assert.equal(state.tiles, 0);
  }
});

test("only explicit server approval loads the scan; disabled/error/timeout states load no tiles", async () => {
  for (const options of [{}, { enabled: "true" }, { enabled: 1 }, { enabled: null }, { enabled: true, status: 403 }, { status: 500 }, { failure: true }, { timeout: true }]) {
    const state = await start(options);
    assert.equal(state.requests.length, 1);
    assert.equal(state.tiles, 0);
  }
  const state = await start({ enabled: true });
  assert.equal(state.tiles, 1);
  assert.equal(state.requests[0].url, "/api/organizations/team-a/map-scan-model");
  assert.equal(state.requests[0].options.cache, "no-store");
  assert.equal(state.requests[0].options.credentials, "same-origin");
});

test("reopening a different organization rechecks its own setting", async () => {
  assert.equal((await start({ enabled: true })).tiles, 1);
  const other = await start({ search: "?organizationId=team-b" });
  assert.equal(other.requests[0].url, "/api/organizations/team-b/map-scan-model");
  assert.equal(other.tiles, 0);
});
