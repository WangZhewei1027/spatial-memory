# 小程序接口 `/api/miniapp/*`

小程序通过匿名 HTTP 接口读取当前团队、地图合集、Asset、Scene 和活动内容。所有响应 `Cache-Control: no-store`。管理端权限不授予匿名编辑权。参数错误 400，找不到或不可公开的内容 404，数据库异常 503。

| 接口 | 请求与返回 |
| --- | --- |
| GET `/organizations?ids=a,b` | 最多 50 个团队，只返回 id/name |
| GET `/workspaces?ids=a,b&organization_id=…` | 最多 50 个地图合集，返回 id/name/organization_id/config；团队参数可选，提供时必须匹配；workspace UUID 就是 collection ID |
| GET `/workspaces?organization_id=…` | 指定团队的所有未归档地图，按名称和 ID 排序，供团队入口选择具体地图；不允许无范围枚举 |
| GET `/scenes?ids=a,b&organization_id=…` | 最多 50 个指定团队的 Scene，返回 id/name；仅包含未归档团队中的 active 场景，供扫码历史展示名称 |
| POST `/assets/nearby` | `{user_lat,user_lng,max_distance_meters,p_workspace_id?,p_organization_id?}`；GPS 范围内启用投放 |
| POST `/assets/huge` | `{p_organization_id,p_workspace_id?}`；启用的巨大模型投放 |
| POST `/assets/scene` | `{asset_id,p_workspace_id?,p_organization_id?}`；asset_id 是 Placement ID，至少一个范围；返回其当前场景的播放清单 |
| POST `/scenes/preview` | `{scene_id,organization_id}`；独立场景当前保存内容的播放清单，未归档团队/场景才可访问 |
| GET `/activities?workspace_id=…&organization_id=…` | 当前地图启用的活动关联；返回活动自身的类型、规则、范围及各打卡点的固定 ID、坐标和图片 |
| GET `/activity-records?placement_id=…&user_lat=…&user_lng=…&max_distance_meters=…` | 当前投放的可见弹幕；坐标和距离可省略，距离最多 5000 米，每次最多 500 条 |
| POST `/activity-records` | `{placement_id,kind,point_id?,content?,participant_id,idempotency_key,user_lat,user_lng}`；写入独立活动记录，返回记录 ID |
| GET `/activity-progress?placement_id=…&participant_id=…` | 指定设备在该次店铺活动投放中已完成的 `point_ids`，使用打卡点定义 ID |
| POST `/anchors/candidates` | JSON GPS 与 workspace_id；返回附近参考图及 reference_version，见下文 |
| POST `/anchors/content` | 同样 GPS，加 anchor_id、reference_version；重新检查范围后返回关联投放 |
| POST `/anchors/recognize` | 旧图片上传入口返回 410 recognition_retired；不再调用 SAGE |

地图公开内容统一来自未归档团队、未归档合集中的 active Placement。两个范围同时提供时必须匹配。暂停或归档投放即从发现和地图场景接口消失。每个发现记录的 id 是独立 Placement ID，同一 Asset 或 Scene 在多个合集投放不会混淆。Source Asset ID 与 Scene ID 不充当地图实例 ID。

Asset 文件取当前 `asset_resource`，Scene 取当前 `scene.document` 并解析当前 Asset 文件。位置、高度、标签和展示覆盖来自 Placement。素材和场景保存后，客户端下次请求即可读到更新。不存在 legacy 查询分支、版本表、绑定映射或发布步骤。

播放字段 `file_type/file_url/text_content/metadata/config` 是公开渲染协议；`assets/scene` 的 asset_id 字段保持已印制地图入口的客户端契约。场景二维码使用 sceneId+organizationId，由独立预览页调用 `/scenes/preview`，不依赖合集或 GPS。未保存编辑不进入预览，归档场景禁止直接预览，既有地图投放继续使用其保存内容。

场景播放协议按内容选择：模型使用 schema 4/5，演出媒体和时间段使用 7，参数动画和空间音频使用 8，显式 `content.viewerPosition` 使用 9，`content.lighting` 使用 10（同时允许观察位置）。灯光字段、默认值及共享渲染约定见 [Scene Lighting](../packages/scene-lighting/README.md)，新旧客户端通过播放版本识别兼容性。观察位置以场景局部米制坐标保存；未设置时 Web 和小程序统一使用 `[0, 1.5, 2]`。小程序 OSD 命中后切换到 v2 SLAM，将该位置对齐空间相机，仅旋转水平朝向；默认将场景原点放在手机前方 2 米、下方 1.5 米，并保留在会话世界空间。GPS 与 Scene QR 使用相同放置方式；1.5 米是约定观看高度，不是实测地面，不使用平面 hitTest。保存的新位置通过上述两个接口原样下发；启用 schema 9 场景需配套更新小程序。

活动留言长度由活动规则决定，最多 500 字；参与写入每 IP 每分钟 60 次、每投放每分钟 120 次。提交事务重新检查团队、地图、活动及投放状态，打卡还检查所属点、归档状态和距固定地点的距离。OSD 候选与内容接口合计每设备每分钟 60 次（无合法 X-Client-Id 时按 IP），每合集每分钟 3000 次。

音频同名 `.webm`/`.m4a` 文件由保留层相互保护；上传不自动生成衍生文件，见 [素材流水线](asset-pipeline.md)。微信合法域名需包含后端 request/uploadFile 域名；媒体域名同时加入 request（视频 MP4 Range 索引请求）和 downloadFile（模型、图片及旧媒体兼容下载）。

## 每个地图合集的小程序设置

地图的 `config` 固定包含以下公开字段，来自 `workspace.miniapp_config`；团队的 `organization.config` 不再用于小程序显示。地图查询排除归档地图及归档团队，未知或不匹配的 ID 不返回记录。

| 字段 | 取值 | 新地图默认值 |
| --- | --- | --- |
| `retrieval_mode` | `gps` / `anchor`（匹配识别） | `gps` |
| `text_asset_miniapp_style` | `plain_white` / `dialog_decorated` | `dialog_decorated` |
| `confetti_enabled` | boolean | false |
| `footer_enabled` | boolean | false |

管理端在地图 navbar 的“设置”弹窗保存这四项；团队设置不再提供这些控件。小程序进入或重新显示 AR 页时，先读取并校验当前地图的完整配置，再启动 GPS 的 SLAM 或匹配的 OSD 会话；页面不再提供识别模式切换。读取失败、配置无效或地图已归档时保留重试，不回退到 GPS 或旧团队缓存。首页水印也读取当前地图。仅团队入口先选择一个具体地图；独立 Scene 预览不读取此配置。

发布顺序：先备份数据库并执行 `20261108000000_collection_miniapp_config.sql`，再发布 Web，最后发布配套小程序。迁移把每个团队原有的三个显示设置一次性复制到其全部地图（含已归档地图），识别方式初始化为 GPS；之后各地图独立保存，新地图使用表中默认值。原组织 JSON 只保留作回滚依据，新配置不会双写回组织。旧小程序不能执行服务端识别方式，必须配套升级；新小程序访问未升级 Web 会提示配置加载失败。迁移回归见 `scripts/test-collection-config-migration.ts`，真实路由见 `scripts/test-collection-settings.ts`。

## 活动与普通内容

活动记录独立于 Asset/Placement。`assets/nearby` 只返回普通内容，客户端通过活动接口发现投放并分别获取留言；两者可共用文字渲染，但不共享数据身份。客户端将活动记录标记为独立来源，在活动暂停、记录隐藏或离开投放范围后移除对应渲染。

一场店铺打卡活动包含多个固定地点的打卡点，整体可以关联多个地图。`points[].id` 与 `points[].point_id` 均为活动内的打卡点 ID；提交打卡使用 `point_id` 与活动投放 `placement_id`。无坐标点只提供目录展示，不能打卡。不同地图读取同一份活动坐标和规则，参与进度及留言仍按投放独立保存。

`participant_id` 是小程序保存在设备上的随机标识，不代表已验证账号或自然人。写入需要客户端请求幂等键，同一请求重试返回同一记录；同设备在同投放对同一点仅记一次打卡。管理端按团队权限查看记录并隐藏/恢复，公开接口不返回参与者标识。

旧 `/shops`、`/text-assets` 已移除，组织级店铺功能开关不再控制活动。发布必须配套升级数据库、Web 与小程序。历史文字按审核决定保留为普通地图 Asset，不自动视为弹幕；迁移与备份副本演练见[活动迁移手册](activity-migration-runbook.md)。

## OSD 参考图与内容

两个新接口使用 JSON：`{workspace_id,latitude,longitude,accuracy,gps_timestamp,coordinate_system:"wgs84"}`。GPS 时间戳为毫秒，沿用服务端精度与时效校验；请求超时与重试由客户端管理。相机帧不上传。

`candidates` 返回 `{candidates:[{id,name,image_url,image_urls,reference_version,distance_meters}],gps_radius_meters}`。`image_urls` 按顺序列出目标的全部识别图（1–5 张），`image_url` 等于其中第一张，供只读一张图的旧客户端使用；`reference_version` 覆盖全部识别图及顺序，单图目标的版本值与多图支持之前相同。候选来自当前地图、未归档团队和地图中的 active anchor Placement，距离最多 200 米；同一基础 anchor 按最近投放去重。这里的 `id` 是 Anchor Asset ID，区别于返回内容里的 Placement ID。超过 200 个候选返回 422，客户端分批扫描所有候选，不静默截断。

`content` 还需 `anchor_id` 和候选返回的 `reference_version`。服务端重新读取当前候选及关联投放：目标离开 GPS 范围、暂停、删除或作用域归档返回 404，参考图版本变化返回 409。成功为 `{anchor:{id,name},assets:[...]}`，assets 仅包含当前启用的关联投放，沿用公开播放字段。版本是服务端不透明校验值，客户端原样回传。

该接口只发现和读取公开内容。设备自报 OSD 命中不是认证或打卡凭证；活动写入继续独立校验。`/api/assets/[id]/matching` GET/兼容 POST 只返回参考图存在状态和 `engine:"osd"`，不生成云端特征。无需数据库迁移或 SAGE 模型配置，已有参考图可复用；具体图片适配和识别效果由客户端校验及真机验收。

发布需配套更新 Web 与小程序：新客户端依赖新接口，旧上传客户端会收到 410 升级提示。代码发布不会自动停止已有 SAGE 云实例或取消其计费，实例退役单独处理。
