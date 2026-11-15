// Exercise the actual iframe message, picking and interaction modules without WebGL.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

const root = path.resolve("public/js/viewer/src");
const sent = [], handlers = [], markers = new Set();
const listeners = new Map();
let position = { x: 10, y: 20, z: 3 };
const asset = { properties: { assetId: { getValue: () => "placement-a" } }, position: { getValue: () => position } };
const viewer = {
  scene: { canvas: { style: {} }, globe: { ellipsoid: {} }, pick: () => ({ id: asset }), screenSpaceCameraController: { enableInputs: true } },
  camera: { pickEllipsoid: point => ({ x: point.x, y: point.y, z: 2 }) },
  entities: { add: input => { markers.add(input); return input; }, remove: input => markers.delete(input) },
};
const color = { withAlpha: () => color };
const window = { addEventListener: (name, handler) => listeners.set(name, handler), parent: { postMessage: message => sent.push(message) } };
const modules = new Map([
  [path.join(root, "managers/viewerManager.js"), { getViewer: () => viewer, flyToOrigin() {} }],
  [path.join(root, "managers/assetManager.js"), { displayAssets() {}, focusOnAsset() {}, getAssetBillboards: () => [asset], getEntityByAssetId: () => asset, setEntityPositionDegrees: (_entity, x, y, z) => { position = { x, y, z }; } }],
  [path.join(root, "managers/selectionManager.js"), { setSelection() {}, clearSelection() {}, reapplyHighlight() {}, isSelected: () => false, getSelectedIds: () => [], setOnSelectionChange() {} }],
  [path.join(root, "utils/config.js"), { setOrigin() {}, CLICK_MARKER_CONFIG: { pointColor: color, outlineColor: color } }],
  [path.join(root, "utils/coordinateUtils.js"), { cartesianToLonLat: p => ({ longitude: p.x, latitude: p.y, height: p.z }) }],
]);
const document = { getElementById: () => ({ style: {}, appendChild() {} }), createElement: () => ({ style: {} }) };
const Cesium = {
  ScreenSpaceEventType: { LEFT_CLICK: "click", LEFT_DOWN: "down", MOUSE_MOVE: "move", LEFT_UP: "up" },
  ScreenSpaceEventHandler: class { constructor() { this.events = {}; handlers.push(this.events); } setInputAction(fn, type) { this.events[type] = fn; } },
  Cartesian3: { fromDegrees: (x, y, z) => ({ x, y, z }) },
  ColorMaterialProperty: class {}, JulianDate: { now: () => 0 },
};
function load(relative) {
  const filename = path.resolve(root, relative);
  if (modules.has(filename)) return modules.get(filename);
  const exports = {}; modules.set(filename, exports);
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, window, document, Cesium, console: { log() {}, warn() {} }, require: name => load(path.resolve(path.dirname(filename), name)) }, { filename });
  return exports;
}
const messages = load("managers/messageHandler.js");
const interaction = load("managers/interactionManager.js");
const clicks = load("managers/clickHandler.js");
messages.setupMessageListener(); clicks.setupClickHandler(); interaction.setupInteraction();
const click = handlers.find(events => events.click).click;
const gestures = handlers.find(events => events.down);
const toggle = enabled => listeners.get("message")({ data: { source: "manage", type: "SET_LOCATION_PICKING", payload: { enabled } } });
const at = (x, y) => ({ position: { x, y } });

interaction.setMode("move");
toggle(true);
assert.equal(interaction.getMode(), "pan");
assert.equal(viewer.scene.canvas.style.cursor, "crosshair");
gestures.down(at(10, 20)); gestures.move({ endPosition: { x: 12, y: 22 } }); gestures.up(at(12, 22));
assert.equal(sent.length, 0, "point picking never persists a drag or changes the selected asset");
click(at(122, 32));
assert.deepEqual(JSON.parse(JSON.stringify(sent.at(-1))), { type: "LOCATION_CLICKED", payload: { longitude: 122, latitude: 32, height: 2 }, source: "viewer", version: 1 });
assert.equal(markers.size, 1, "clicking an existing asset still picks a location");
toggle(false);
assert.equal(markers.size, 0, "finishing removes the temporary marker");
assert.equal(interaction.getMode(), "move", "the previous tool is restored");
assert.equal(viewer.scene.canvas.style.cursor, "move");

// Entering a pick cancels an unfinished drag without committing it.
gestures.down(at(10, 20)); gestures.move({ endPosition: { x: 12, y: 22 } });
assert.deepEqual(position, { x: 12, y: 22, z: 3 });
assert.equal(viewer.scene.screenSpaceCameraController.enableInputs, false);
const count = sent.length;
toggle(true);
assert.deepEqual(position, { x: 10, y: 20, z: 3 });
assert.equal(viewer.scene.screenSpaceCameraController.enableInputs, true);
assert.equal(sent.length, count);
toggle(false);

interaction.setMode("box"); gestures.down(at(10, 20)); toggle(true);
assert.equal(viewer.scene.screenSpaceCameraController.enableInputs, true);
toggle(false); assert.equal(interaction.getMode(), "box");
interaction.setMode("pan"); click(at(122, 32));
assert.equal(sent.at(-1).type, "ASSET_CLICKED", "normal asset selection resumes after picking");
console.log("PASS viewer pick mode: explicit location, no drag writes, cancel, marker cleanup and tool restoration");
