/**
 * 交互管理模块
 * 三种模式：
 *  - pan：默认，相机导航 + 现有点击行为（clickHandler 只在此模式生效）
 *  - move：拖动素材点改坐标（松手发 ASSETS_MOVED 落库）
 *  - box：框选多选素材（发 ASSETS_SELECTED）
 */

import { getViewer } from "./viewerManager.js";
import {
  getAssetBillboards,
  getEntityByAssetId,
  setEntityPositionDegrees,
} from "./assetManager.js";
import { cartesianToLonLat } from "../utils/coordinateUtils.js";
import { sendAssetsMoved, sendAssetsSelected } from "./messageHandler.js";
import {
  setSelection,
  clearSelection,
  isSelected,
  getSelectedIds,
  setOnSelectionChange,
} from "./selectionManager.js";

let mode = "pan";
let locationPicking = false;
let handler = null;

// 拖动状态
let dragging = false;
let dragMoved = false;
let dragStartCarto = null; // { longitude, latitude } 度
let draggedAssets = []; // [{ id, entity, startLon, startLat, height }]

// 框选状态
let boxing = false;
let boxStart = null; // { x, y } 画布像素
let rectEl = null;

const BOX_CLICK_THRESHOLD = 4; // 小于此像素视为单击而非框选

/**
 * 读取 billboard 实体上的 assetId。
 */
function readAssetId(entity) {
  const p = entity?.properties?.assetId;
  if (!p) return undefined;
  return p.getValue ? p.getValue() : p;
}

/**
 * pick 命中的 asset 实体（返回 { entity, id } 或 null）。
 */
function pickAsset(position) {
  const viewer = getViewer();
  const picked = viewer.scene.pick(position);
  if (picked && picked.id) {
    const id = readAssetId(picked.id);
    if (id) return { entity: picked.id, id };
  }
  return null;
}

/**
 * 取光标处椭球面经纬度（度）。
 */
function groundCartoDegrees(position) {
  const viewer = getViewer();
  const cartesian = viewer.camera.pickEllipsoid(
    position,
    viewer.scene.globe.ellipsoid,
  );
  if (!cartesian) return null;
  const { longitude, latitude } = cartesianToLonLat(cartesian);
  return { longitude, latitude };
}

/**
 * 读取实体当前经纬度 + 高度。
 */
function entityCartoDegrees(entity) {
  const pos = entity.position?.getValue(Cesium.JulianDate.now());
  if (!pos) return null;
  return cartesianToLonLat(pos);
}

function setCameraInputs(enabled) {
  const viewer = getViewer();
  viewer.scene.screenSpaceCameraController.enableInputs = enabled;
}

// 各模式对应的鼠标光标
const MODE_CURSOR = {
  pan: "", // 默认（Cesium 导航）
  move: "move", // 四向箭头，提示可拖动
  box: "crosshair", // 十字，提示框选
};

/**
 * 按模式设置画布光标；拖动/框选进行中可传入临时光标（如 grabbing）。
 */
function applyCursor(cursor) {
  const viewer = getViewer();
  if (!viewer) return;
  viewer.scene.canvas.style.cursor =
    locationPicking ? "crosshair" : cursor !== undefined ? cursor : MODE_CURSOR[mode] ?? "";
}

// ---------------- 拖动 ----------------

function beginDrag(hit, position) {
  const ground = groundCartoDegrees(position);
  if (!ground) return;

  // 命中的素材在选中集里 → 拖整组；否则只拖它并把选中集设为它
  const ids = isSelected(hit.id) ? getSelectedIds() : [hit.id];
  if (!isSelected(hit.id)) setSelection([hit.id]);

  draggedAssets = ids
    .map((id) => {
      const entity = getEntityByAssetId(id);
      if (!entity) return null;
      const carto = entityCartoDegrees(entity);
      if (!carto) return null;
      return {
        id,
        entity,
        startLon: carto.longitude,
        startLat: carto.latitude,
        height: carto.height,
      };
    })
    .filter(Boolean);

  if (draggedAssets.length === 0) return;

  dragStartCarto = ground;
  dragging = true;
  dragMoved = false;
  setCameraInputs(false);
  applyCursor("grabbing");
}

function updateDrag(position) {
  const ground = groundCartoDegrees(position);
  if (!ground) return;
  dragMoved = true;

  const dLon = ground.longitude - dragStartCarto.longitude;
  const dLat = ground.latitude - dragStartCarto.latitude;

  draggedAssets.forEach((a) => {
    setEntityPositionDegrees(
      a.entity,
      a.startLon + dLon,
      a.startLat + dLat,
      a.height,
    );
  });
}

function endDrag() {
  setCameraInputs(true);

  if (dragMoved && draggedAssets.length > 0) {
    const moves = draggedAssets
      .map((a) => {
        const carto = entityCartoDegrees(a.entity);
        if (!carto) return null;
        return {
          assetId: a.id,
          longitude: carto.longitude,
          latitude: carto.latitude,
          height: carto.height,
        };
      })
      .filter(Boolean);
    if (moves.length > 0) sendAssetsMoved(moves);
  }

  dragging = false;
  dragMoved = false;
  dragStartCarto = null;
  draggedAssets = [];
  applyCursor(); // 恢复为当前模式光标
}

// ---------------- 框选 ----------------

function ensureRect() {
  if (rectEl) return rectEl;
  rectEl = document.getElementById("selectionRect");
  if (!rectEl) {
    rectEl = document.createElement("div");
    rectEl.id = "selectionRect";
    document.getElementById("cesiumContainer").appendChild(rectEl);
  }
  return rectEl;
}

function beginBox(position) {
  boxing = true;
  boxStart = { x: position.x, y: position.y };
  const el = ensureRect();
  el.style.display = "block";
  el.style.left = `${position.x}px`;
  el.style.top = `${position.y}px`;
  el.style.width = "0px";
  el.style.height = "0px";
  setCameraInputs(false);
}

function updateBox(position) {
  if (!rectEl) return;
  const x = Math.min(boxStart.x, position.x);
  const y = Math.min(boxStart.y, position.y);
  const w = Math.abs(position.x - boxStart.x);
  const h = Math.abs(position.y - boxStart.y);
  rectEl.style.left = `${x}px`;
  rectEl.style.top = `${y}px`;
  rectEl.style.width = `${w}px`;
  rectEl.style.height = `${h}px`;
}

function endBox(position) {
  setCameraInputs(true);
  if (rectEl) rectEl.style.display = "none";

  const dx = Math.abs(position.x - boxStart.x);
  const dy = Math.abs(position.y - boxStart.y);

  if (dx < BOX_CLICK_THRESHOLD && dy < BOX_CLICK_THRESHOLD) {
    // 视为单击：选中光标下素材，空白则清空
    const hit = pickAsset(position);
    if (hit) setSelection([hit.id]);
    else clearSelection();
  } else {
    // 矩形框选
    const minX = Math.min(boxStart.x, position.x);
    const maxX = Math.max(boxStart.x, position.x);
    const minY = Math.min(boxStart.y, position.y);
    const maxY = Math.max(boxStart.y, position.y);
    const ids = collectAssetsInRect(minX, minY, maxX, maxY);
    setSelection(ids);
  }

  boxing = false;
  boxStart = null;
}

/**
 * 计算落在屏幕矩形内的素材 id。
 */
function collectAssetsInRect(minX, minY, maxX, maxY) {
  const viewer = getViewer();
  const scene = viewer.scene;
  const ids = [];

  getAssetBillboards().forEach((entity) => {
    const pos = entity.position?.getValue(Cesium.JulianDate.now());
    if (!pos) return;
    const win = Cesium.SceneTransforms.wgs84ToWindowCoordinates(scene, pos);
    if (!win) return;
    if (
      win.x >= minX &&
      win.x <= maxX &&
      win.y >= minY &&
      win.y <= maxY
    ) {
      const id = readAssetId(entity);
      if (id) ids.push(id);
    }
  });

  return ids;
}

// ---------------- 事件分派 ----------------

function onLeftDown(event) {
  if (locationPicking) return;
  if (mode === "move") {
    const hit = pickAsset(event.position);
    if (hit) beginDrag(hit, event.position);
  } else if (mode === "box") {
    beginBox(event.position);
  }
}

function onMouseMove(event) {
  if (locationPicking) return;
  if (mode === "move" && dragging) {
    updateDrag(event.endPosition);
  } else if (mode === "box" && boxing) {
    updateBox(event.endPosition);
  }
}

function onLeftUp(event) {
  if (locationPicking) return;
  if (mode === "move" && dragging) {
    endDrag();
  } else if (mode === "box" && boxing) {
    endBox(event.position);
  }
}

/**
 * 设置交互事件处理。
 */
export function setupInteraction() {
  const viewer = getViewer();
  if (!viewer) {
    console.warn("Viewer not initialized");
    return;
  }

  // 选中变化时通知父窗口
  setOnSelectionChange(sendAssetsSelected);

  handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  handler.setInputAction(onLeftDown, Cesium.ScreenSpaceEventType.LEFT_DOWN);
  handler.setInputAction(onMouseMove, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
  handler.setInputAction(onLeftUp, Cesium.ScreenSpaceEventType.LEFT_UP);

  applyCursor();
  console.log("交互事件处理器已设置");
}

/**
 * 获取当前模式。
 */
export function getMode() {
  return locationPicking ? "pan" : mode;
}

/** A temporary point-pick overrides move/box without changing the user's tool. */
export function setLocationPicking(enabled) {
  if (enabled && dragging) {
    draggedAssets.forEach((asset) => setEntityPositionDegrees(asset.entity, asset.startLon, asset.startLat, asset.height));
    dragMoved = false;
    endDrag();
  }
  if (enabled && boxing) {
    setCameraInputs(true);
    if (rectEl) rectEl.style.display = "none";
    boxing = false;
    boxStart = null;
  }
  locationPicking = enabled;
  applyCursor();
}

export function isLocationPicking() {
  return locationPicking;
}

/**
 * 切换模式，清理进行中的拖拽/框选。
 */
export function setMode(next) {
  if (next === mode) return;
  // 清理进行中的操作
  if (dragging) endDrag();
  if (boxing) {
    setCameraInputs(true);
    if (rectEl) rectEl.style.display = "none";
    boxing = false;
    boxStart = null;
  }
  mode = next;
  applyCursor();
  console.log("交互模式切换为:", mode);
}
