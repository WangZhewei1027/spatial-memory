# 本地 Agent 场景编排

本阶段通过独立 `spatial-memory` CLI 接入本地 agent。Agent 负责素材选择、联网搜索、压缩工具选择、视觉判断和迭代；CLI 提供可校验的操作、真实预览和持久化，不绑定特定模型服务。

## 共享边界

- [`@spatial-memory/scene-authoring`](../packages/scene-authoring/README.md)：schema 6 的唯一协议与校验源码，以及纯函数 `createDocument / validate / apply / inspect / sample / diff`。批次操作失败不产生部分文档，保留稳定节点 ID，位置为米、旋转为弧度、时间为秒。Web 的协议导出和复制操作直接使用它；CLI 安装相同包。
- [`@spatial-memory/scene-renderer`](../packages/scene-renderer/README.md)：本地 Chromium 加载 Web 的实际 `EditorModels`、素材 pivot、媒体 surface 与 Scene Core。返回 PNG、世界包围盒、投影、媒体源时间、资源哈希及场景版本。截图失败不会替代成成功的占位图。
- CLI：现有认证和 HTTP API、本地素材导入缓存、草稿 revision/历史、操作执行、渲染产物和保存。离线安装包携带共享模块和渲染运行时；浏览器需本机 Chrome/Chromium 或 Playwright Chromium。
- `POST /api/organizations/:id/scenes/validate`：只读预检组织写权限、资源类型/归属、动画片段、归档状态和可选场景锁版本。保存仍在原事务内重新校验并更新引用。

后续网页 agent 服务可以复用编排包和 API，另行实现服务端任务、模型调用与运行隔离；当前没有引入第二套场景格式或 MCP 服务。

## Agent 可用能力

| 范围 | 接口 |
| --- | --- |
| 找素材 | `assets search`（库内名称搜索、分页）；联网搜索使用 agent 自己的搜索工具 |
| 导入与理解 | `assets import`（文件或 URL）、`assets inspect`（真实文件、尺寸、动画、时长、预览） |
| 草稿与恢复 | `runs open/status/history/restore`，写入要求当前 revision |
| 编排 | `scenes apply`：文档、素材别名、实例、分组、父子层级、本地/世界变换、朝向、布局、关键帧、轨道、时序排列 |
| 数值反馈 | `scenes inspect/sample/diff/validate`，支持提供素材事实 |
| 视觉反馈 | `scenes render`：显式时间或关键边界/中点、多镜头、PNG、manifest |
| 保存 | `scenes save`：新场景幂等创建，已有场景使用 lockVersion |

共享操作可读写所有 schema 6 已支持字段，包括空间位置、旋转、缩放、分组、动画、媒体裁剪/倍率/音量、空间音频、文字、透明度、显隐、时序和曲线。具体操作参数见编排包 README；相机参数属于观察视角，不写入场景内容。

## 上传与限制

复用现有 `/api/upload → receipt → team asset` 链路。仅模型原文件上限由 3 MiB 改为 **5 MiB（5 × 1024 × 1024 字节）**；其他上传限额、压缩/转码策略及 OSS 路径逻辑保持现有行为。CLI 不增加自动模型压缩，超限由 agent 自行处理后重试。

导入保存原文件 `sourceProbe` 和最终 OSS 文件 `finalProbe`，以最终文件事实编排；服务端缩图或转码后不能继续假定原文件尺寸和时长。上传回执、创建请求和幂等键保存在本地，失败重试复用已完成阶段。

取消素材/实例/关键帧数量、演出时长、坐标/缩放、分组深度、文字长度等人为编排上限。保留有限数值、正尺寸/倍率、非负时间、0–1 音量/透明度、引用有效性和无环层级等语义校验。设备不能播放的倍率明确报错，不静默改写参数。

## 闭环验收

验收顺序：库内检索 → 联网选择素材 → 原上传接口写入 OSS → 检查最终素材 → 创建草稿 → 编排 → 数值采样/服务端预检 → 多视角截图 → agent 实际看图 → 修正 → 重拍 → 保存并回读。

本次实测使用隔离本地数据库、测试团队和真实 OSS；导入 Khronos 的 [CesiumMan 样例](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/CesiumMan)，素材来源及授权记录随导入保留。初稿有两个人物重叠、标题越出镜头的问题，读取图像后通过操作文件调整世界位置、运动轨道和朝向，保持同一观众镜头复查。场景回读与最终草稿逐字段一致。

图片是抽样证据，不保证整个连续时间线无问题。世界包围盒交叠不等同于碰撞或遮挡；音频标记不是素材几何。带外部依赖的 GLTF/GLB 会明确返回 `MISSING_DEPENDENCIES`，由 agent 转为自包含文件后导入。AR 真机表现仍需独立验收。

## 验证命令

Web：`npm run check`、`npm run test:integration`、`npm run test:cross-runtime`。

共享包：`npm run test:scene-authoring`；渲染器先 `npm ci --prefix packages/scene-renderer`，再 `npm run test:scene-renderer`（浏览器测试需要 Chrome/Chromium，视频夹具需要 ffmpeg）。

CLI 仓库：`npm run typecheck`、`npm test`、`npm run test:package`。小程序仓库：`npm test`，媒体倍率用现有 scene-media 测试覆盖。
