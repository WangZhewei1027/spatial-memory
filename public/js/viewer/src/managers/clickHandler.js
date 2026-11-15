/**
 * 点击事件处理模块
 */

import { CLICK_MARKER_CONFIG } from "../utils/config.js";
import { getViewer } from "./viewerManager.js";
import { cartesianToLonLat } from "../utils/coordinateUtils.js";
import { sendLocationClicked, sendAssetClicked } from "./messageHandler.js";
import { getMode, isLocationPicking } from "./interactionManager.js";

let clickedPointEntity = null; // 存储点击位置的标记

/**
 * 设置点击事件处理
 */
export function setupClickHandler() {
  const viewer = getViewer();
  if (!viewer) {
    console.warn("Viewer not initialized");
    return;
  }

  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

  handler.setInputAction((movement) => {
    handleMapClick(movement);
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  console.log("点击事件处理器已设置");
}

/**
 * 处理地图点击事件
 * @param {Object} movement - 鼠标移动事件
 */
function handleMapClick(movement) {
  const viewer = getViewer();
  if (!viewer) return;

  // 仅在 pan 模式下处理点击（move/box 模式由 interactionManager 接管）
  if (getMode() !== "pan") return;

  // 优先检查是否点击了 asset 实体（billboard）
  const picked = viewer.scene.pick(movement.position);
  if (!isLocationPicking() && picked && picked.id) {
    const assetId = picked.id.properties?.assetId?.getValue
      ? picked.id.properties.assetId.getValue()
      : picked.id.properties?.assetId;
    if (assetId) {
      sendAssetClicked(assetId);
      return;
    }
  }

  // 获取点击位置的地球坐标
  const cartesian = viewer.camera.pickEllipsoid(
    movement.position,
    viewer.scene.globe.ellipsoid,
  );

  if (cartesian) {
    // 转换为经纬度
    const { longitude, latitude, height } = cartesianToLonLat(cartesian);

    // 添加点击标记
    addClickMarker(longitude, latitude, height);

    // 发送消息给父窗口
    sendLocationClicked(longitude, latitude, height);
  }
}

/**
 * 在点击位置添加标记
 * @param {number} longitude - 经度
 * @param {number} latitude - 纬度
 * @param {number} height - 高度
 */
function addClickMarker(longitude, latitude, height) {
  const viewer = getViewer();
  if (!viewer) return;

  // 移除之前的标记点
  clearClickMarker();

  // 添加新的发光标记点
  clickedPointEntity = viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(longitude, latitude, height),
    point: {
      pixelSize: CLICK_MARKER_CONFIG.pointSize,
      color: CLICK_MARKER_CONFIG.pointColor,
      outlineColor: CLICK_MARKER_CONFIG.outlineColor,
      outlineWidth: CLICK_MARKER_CONFIG.outlineWidth,
      disableDepthTestDistance: Number.POSITIVE_INFINITY, // 始终显示在最前面
    },
    // 添加脉冲动画效果
    ellipse: {
      semiMinorAxis: CLICK_MARKER_CONFIG.ellipseSemiAxis,
      semiMajorAxis: CLICK_MARKER_CONFIG.ellipseSemiAxis,
      height: height,
      material: new Cesium.ColorMaterialProperty(
        CLICK_MARKER_CONFIG.pointColor.withAlpha(
          CLICK_MARKER_CONFIG.ellipseAlpha,
        ),
      ),
      outline: true,
      outlineColor: CLICK_MARKER_CONFIG.pointColor,
      outlineWidth: 2,
    },
  });
}

/**
 * 清除点击标记
 */
export function clearClickMarker() {
  const viewer = getViewer();
  if (!viewer) return;

  if (clickedPointEntity) {
    viewer.entities.remove(clickedPointEntity);
    clickedPointEntity = null;
  }
}

/**
 * 获取当前点击标记实体
 * @returns {Cesium.Entity|null}
 */
export function getClickMarker() {
  return clickedPointEntity;
}
