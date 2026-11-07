/**
 * Cesium 3D Viewer 主应用
 *
 * 功能模块:
 * - config.js: 配置管理
 * - coordinateUtils.js: 坐标转换
 * - viewerManager.js: Viewer管理和相机控制
 * - assetManager.js: 资产显示和管理
 * - messageHandler.js: 跨窗口通信
 * - clickHandler.js: 地图点击事件
 * - tilesetLoader.js: 3D Tiles加载
 */

import { CESIUM_ION_TOKEN, IS_MOBILE } from "./src/utils/config.js";
import {
  initViewer,
  resetCamera,
  flyToOrigin,
} from "./src/managers/viewerManager.js";
import {
  setupRecovery,
  waitForHealthyWebgl,
  recoverFromFatal,
} from "./src/managers/recoveryManager.js";
import { setupMessageListener, sendMessageToParent } from "./src/managers/messageHandler.js";
import { setupClickHandler } from "./src/managers/clickHandler.js";
import {
  setupInteraction,
  setMode,
} from "./src/managers/interactionManager.js";
import { load3DTiles, getTileset } from "./src/managers/tilesetLoader.js";
import { isMapScanModelEnabled } from "./src/utils/mapScanModel.js";

// 设置 Cesium Ion token
Cesium.Ion.defaultAccessToken = CESIUM_ION_TOKEN;

/**
 * 初始化应用
 */
async function init() {
  try {
    // 0. iOS Safari 崩溃后的冷却期内新建上下文必死，先探测等待
    if (!(await waitForHealthyWebgl())) return;

    // 1. 初始化 Viewer
    const viewer = initViewer();

    // 1.5 注册渲染错误 / WebGL 上下文丢失自动恢复（iOS Safari）
    setupRecovery(viewer);

    // 2. 设置消息监听
    setupMessageListener();

    // 3. 设置点击事件处理
    setupClickHandler();

    // 3.5 设置拖动/框选交互
    setupInteraction();
    // WebGL recovery can delay initialization beyond the iframe load event.
    // Ask the parent to replay the latest origin, assets and queued focus.
    sendMessageToParent("VIEWER_READY", {});

    // 4. 底图立即可用。扫描模型默认关闭，仅服务端明确放行的组织加载。
    document.getElementById("loading")?.classList.add("hidden");
    // 移动端仍保留显存保护；未开启的组织不会请求任何扫描模型瓦片。
    if (IS_MOBILE || !(await isMapScanModelEnabled())) return;

    // 桌面端延迟加载 3D Tiles（确保 DOM 已准备好）
    setTimeout(async () => {
      try {
        await load3DTiles();
        console.log("应用初始化完成");
      } catch (error) {
        console.error("3D Tiles 加载失败:", error);
      }
    }, 1000);
  } catch (error) {
    console.error("应用初始化失败:", error);
    // 构造阶段崩溃（如上下文创建即 lost）同样走限次自动恢复
    recoverFromFatal(error);
  }
}

/**
 * 重置相机到默认位置（全局函数）
 */
window.resetCamera = function () {
  const tileset = getTileset();
  if (tileset) {
    resetCamera(tileset);
  } else {
    // 移动端无地形，重置视角即回到 origin
    flyToOrigin();
  }
};

/**
 * 切换交互模式（全局函数，供工具栏按钮调用）
 * @param {"pan"|"move"|"box"} mode
 */
window.setViewerMode = function (mode) {
  setMode(mode);
  // 更新工具栏按钮 active 态
  document.querySelectorAll("#toolbar .tool-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === mode);
  });
};

// 启动应用
init();
