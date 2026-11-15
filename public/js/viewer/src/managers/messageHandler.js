/**
 * 消息通信处理模块
 */

import { displayAssets, focusOnAsset } from "./assetManager.js";
import { setOrigin } from "../utils/config.js";
import { flyToOrigin } from "./viewerManager.js";
import { setLocationPicking } from "./interactionManager.js";
import { clearClickMarker } from "./clickHandler.js";
import {
  setSelection,
  clearSelection,
  reapplyHighlight,
} from "./selectionManager.js";

/**
 * 监听来自父窗口的消息
 */
export function setupMessageListener() {
  window.addEventListener("message", handleMessage);
  console.log("消息监听器已设置");
}

/**
 * 处理接收到的消息
 * @param {MessageEvent} event - 消息事件
 */
function handleMessage(event) {
  if (event.data?.source === "manage") {
    const { type, payload } = event.data;

    switch (type) {
      case "SET_LOCATION_PICKING":
        setLocationPicking(payload?.enabled === true);
        clearClickMarker();
        break;
      case "SET_ASSETS":
        displayAssets(payload);
        // 重建 billboard 后重新套用已有选中高亮
        reapplyHighlight();
        break;
      case "FOCUS_ASSET":
        focusOnAsset(payload);
        break;
      case "SET_ORIGIN":
        setOrigin(payload);
        flyToOrigin();
        break;
      case "SET_SELECTION":
        // 父窗口（如列表多选）同步选中集到地图，不回传避免回环
        setSelection(payload?.assetIds ?? [], { silent: true });
        break;
      case "CLEAR_SELECTION":
        clearSelection({ silent: true });
        break;
      default:
        console.log("未知消息类型:", type);
    }
  }
}

/**
 * 向父窗口发送消息
 * @param {string} type - 消息类型
 * @param {Object} payload - 消息负载
 */
export function sendMessageToParent(type, payload) {
  if (window.parent !== window) {
    window.parent.postMessage(
      {
        type,
        payload,
        source: "viewer",
        version: 1,
      },
      "*",
    );
  }
}

/**
 * 发送位置点击事件到父窗口
 * @param {number} longitude - 经度
 * @param {number} latitude - 纬度
 * @param {number} height - 高度
 */
export function sendLocationClicked(longitude, latitude, height) {
  sendMessageToParent("LOCATION_CLICKED", {
    longitude,
    latitude,
    height,
  });

  console.log(
    `点击坐标: ${longitude.toFixed(6)}°, ${latitude.toFixed(
      6,
    )}°, ${height.toFixed(2)}m`,
  );
}

/**
 * 发送资产点击事件到父窗口
 * @param {string} assetId - 资产ID
 */
export function sendAssetClicked(assetId) {
  sendMessageToParent("ASSET_CLICKED", { assetId });
  console.log(`点击资产: ${assetId}`);
}

/**
 * 发送素材移动事件（拖动松手后批量落库）
 * @param {Array<{assetId: string, longitude: number, latitude: number, height: number}>} moves
 */
export function sendAssetsMoved(moves) {
  sendMessageToParent("ASSETS_MOVED", { moves });
  console.log(`移动 ${moves.length} 个素材`);
}

/**
 * 发送选中集变化事件
 * @param {string[]} assetIds
 */
export function sendAssetsSelected(assetIds) {
  sendMessageToParent("ASSETS_SELECTED", { assetIds });
  console.log(`选中 ${assetIds.length} 个素材`);
}
