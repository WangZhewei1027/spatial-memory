# 匹配点与图像识别

小程序在设备端用 MediaPipe 图像嵌入模型比对相机帧与参考图；服务端只按 GPS 返回当前合集附近的参考图，并在客户端确认命中后返回关联投放。相机图像不上传。识别表示附近地点匹配，不提供相机 6DoF 或厘米级 AR 重定位。客户端流程见小程序仓库 `docs/anchor-recognition.md`，接口字段见 [小程序接口](miniapp-api.md#识别参考图与内容)。

## 素材、投放与参考图

匹配点是 `file_type="anchor"` 的团队素材，参考图片来自 `asset_resource` 的 reference 资源（序号 0 起，最多 5 张；旧数据回退到 primary#0）。地理位置由该素材的 Placement 决定；其他投放通过 `anchor_id` 关联匹配点素材 ID。

识别目标在 `/manage/anchors` 独立创建与管理，导航位于活动和场景之间。名称、参考图、副本、归档/恢复和使用记录属于团队素材；地图仅选择已有目标、设置投放位置与状态、关联当前地图中的其他投放。创建匹配点素材、上传参考图和在合集投放是不同操作。浏览器上传 JPEG/PNG/WebP 原图（最多 32 MiB），服务端以最长边 1280px、JPEG quality 65 和 256 KiB 预算压缩，必要时降为 1024px / quality 50；透明图保留 PNG，最终上限 4 MiB。参考图集合与顺序决定 `reference_version`，换图后客户端会拿到新版本并重新计算特征；改名或移动投放不改变参考图。

识别候选来自当前未归档团队、未归档合集中的 active 匹配点投放，按匹配点素材去重。候选的 `id` 是匹配点素材 ID；内容响应里 `assets[].id` 是关联内容的 **Placement ID**。响应包含当前素材/场景内容及投放参数，不返回数据库实体或固定版本。

## 接口边界

| 接口 | 访问方式与作用 |
| --- | --- |
| `POST /api/miniapp/anchors/candidates` | 匿名 JSON，GPS 与 `workspace_id`；返回附近参考图及 `reference_version` |
| `POST /api/miniapp/anchors/content` | 匿名 JSON，同样 GPS，加 `anchor_id`、`reference_version`；重新检查范围后返回关联投放 |
| `POST /api/miniapp/anchors/recognize` | 已退役的图片上传入口，固定返回 410 `recognition_retired`，不调用任何模型 |
| `GET /api/assets/<anchor_id>/matching` | 公开状态读取：`{status:"ready"|"missing_image", engine:"on_device"}`；兼容 POST 行为相同 |

`proxy.ts` 放行 `matching` 状态路径；匹配点素材创建和编辑仍通过正常团队内容接口鉴权。服务端不再生成或保存云端特征，也不需要模型服务配置。

## 请求与匹配规则

GPS 字段为 `latitude`/`longitude`（WGS84）、`accuracy`（0～100 米）、`gps_timestamp`（过去 30 秒内的 Unix 毫秒）和固定的 `coordinate_system:"wgs84"`。候选半径为 `min(200, max(75, 2 × accuracy))` 米；超过 200 个候选返回 422，客户端分批扫描，不静默截断。

`content` 重新读取当前候选：目标离开 GPS 范围、暂停、删除或作用域归档返回 404，参考图版本变化返回 409。相似度阈值、连续确认和竞争候选处理都在客户端完成；设备自报的命中不是认证或打卡凭证。

## 限流与错误

候选与内容接口共用计数：每合集每设备 60 次/分钟（合法 `X-Client-Id`，否则按 IP），每合集共享 3000 次/分钟，均为进程内计数，超限返回 429。参数错误 400；精确状态以 [识别路由](../app/api/miniapp/anchors/candidates/route.ts) 和 `lib/anchor/recognition.server.ts` 为准。

## 验证

默认回归中的 `scripts/test-anchor-references.ts` 覆盖参考图顺序与版本，`scripts/test-anchor-attachments.ts` 覆盖关联与解除时的投放状态；集成测试 `scripts/test-content-model-services.ts` 检查换图后各合集的候选更新。它们不验证真机识别效果，联调仍需现场正负照片和小程序命中后的投放展示。
