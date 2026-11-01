# 小程序接口 `/api/miniapp/*`

小程序通过匿名 HTTP 接口读取当前团队、地图合集、Asset、Scene 和活动内容。所有响应 `Cache-Control: no-store`。管理端权限不授予匿名编辑权。参数错误 400，找不到或不可公开的内容 404，数据库异常 503。

| 接口 | 请求与返回 |
| --- | --- |
| GET `/organizations?ids=a,b` | 最多 50 个团队，返回 id/name 和小程序配置 |
| GET `/workspaces?ids=a,b` | 最多 50 个地图合集，返回 id/name；workspace UUID 就是 collection ID |
| GET `/scenes?ids=a,b&organization_id=…` | 最多 50 个指定团队的 Scene，返回 id/name；仅包含未归档团队中的 active 场景，供扫码历史展示名称 |
| POST `/assets/nearby` | `{user_lat,user_lng,max_distance_meters,p_workspace_id?,p_organization_id?}`；GPS 范围内启用投放 |
| POST `/assets/huge` | `{p_organization_id,p_workspace_id?}`；启用的巨大模型投放 |
| POST `/assets/scene` | `{asset_id,p_workspace_id?,p_organization_id?}`；asset_id 是 Placement ID，至少一个范围；返回其当前场景的播放清单 |
| POST `/scenes/preview` | `{scene_id,organization_id}`；独立场景当前保存内容的播放清单，未归档团队/场景才可访问 |
| GET `/activities?workspace_id=…&organization_id=…` | 当前地图启用的活动关联；返回活动自身的类型、规则、范围及各打卡点的固定 ID、坐标和图片 |
| GET `/activity-records?placement_id=…&user_lat=…&user_lng=…&max_distance_meters=…` | 当前投放的可见弹幕；坐标和距离可省略，距离最多 5000 米，每次最多 500 条 |
| POST `/activity-records` | `{placement_id,kind,point_id?,content?,participant_id,idempotency_key,user_lat,user_lng}`；写入独立活动记录，返回记录 ID |
| GET `/activity-progress?placement_id=…&participant_id=…` | 指定设备在该次店铺活动投放中已完成的 `point_ids`，使用打卡点定义 ID |
| POST `/anchors/recognize?workspace_id=…` | multipart image、latitude、longitude、accuracy、gps_timestamp、coordinate_system=wgs84；匹配当前参考图并返回关联投放 |

地图公开内容统一来自未归档团队、未归档合集中的 active Placement。两个范围同时提供时必须匹配。暂停或归档投放即从发现和地图场景接口消失。每个发现记录的 id 是独立 Placement ID，同一 Asset 或 Scene 在多个合集投放不会混淆。Source Asset ID 与 Scene ID 不充当地图实例 ID。

Asset 文件取当前 `asset_resource`，Scene 取当前 `scene.document` 并解析当前 Asset 文件。位置、高度、标签和展示覆盖来自 Placement。素材和场景保存后，客户端下次请求即可读到更新。不存在 legacy 查询分支、版本表、绑定映射或发布步骤。

播放字段 `file_type/file_url/text_content/metadata/config` 是公开渲染协议；`assets/scene` 的 asset_id 字段保持已印制地图入口的客户端契约。场景二维码使用 sceneId+organizationId，由独立预览页调用 `/scenes/preview`，不依赖合集或 GPS。未保存编辑不进入预览，归档场景禁止直接预览，既有地图投放继续使用其保存内容。

场景播放协议按内容选择：模型使用 schema 4/5，演出媒体和时间段使用 7，参数动画和空间音频使用 8，显式 `content.viewerPosition` 使用 9。观察位置以场景局部米制坐标保存；未设置时 Web 和小程序统一使用 `[0, 1.5, 2]`。小程序把该位置对齐手机世界坐标，仅旋转水平朝向，默认将场景原点放在手机前方 2 米、下方 1.5 米。保存的新位置通过上述两个接口原样下发；启用 schema 9 场景需配套更新小程序。

活动留言长度由活动规则决定，最多 500 字；参与写入每 IP 每分钟 60 次、每投放每分钟 120 次。提交事务重新检查团队、地图、活动及投放状态，打卡还检查所属点、归档状态和距固定地点的距离。匹配接口每设备每分钟 90 次（无合法 X-Client-Id 时按 IP），每合集每分钟 3000 次。识别请求可传 X-Recognition-Request-Id，响应回显请求 ID 与诊断耗时。

音频同名 `.webm`/`.m4a` 文件由保留层相互保护；上传不自动生成衍生文件，见 [素材流水线](asset-pipeline.md)。微信合法域名需包含后端 request/uploadFile 域名和媒体 downloadFile 域名。

组织配置仅公开 `confetti_enabled`、`footer_enabled` 和 `text_asset_miniapp_style`。新增公开配置时同步更新 `app/api/miniapp/organizations/route.ts` 的 `PUBLIC_CONFIG_KEYS`；未在白名单中的键不返回小程序。

## 活动与普通内容

活动记录独立于 Asset/Placement。`assets/nearby` 只返回普通内容，客户端通过活动接口发现投放并分别获取留言；两者可共用文字渲染，但不共享数据身份。客户端将活动记录标记为独立来源，在活动暂停、记录隐藏或离开投放范围后移除对应渲染。

一场店铺打卡活动包含多个固定地点的打卡点，整体可以关联多个地图。`points[].id` 与 `points[].point_id` 均为活动内的打卡点 ID；提交打卡使用 `point_id` 与活动投放 `placement_id`。无坐标点只提供目录展示，不能打卡。不同地图读取同一份活动坐标和规则，参与进度及留言仍按投放独立保存。

`participant_id` 是小程序保存在设备上的随机标识，不代表已验证账号或自然人。写入需要客户端请求幂等键，同一请求重试返回同一记录；同设备在同投放对同一点仅记一次打卡。管理端按团队权限查看记录并隐藏/恢复，公开接口不返回参与者标识。

旧 `/shops`、`/text-assets` 已移除，组织级店铺功能开关不再控制活动。发布必须配套升级数据库、Web 与小程序。历史文字按审核决定保留为普通地图 Asset，不自动视为弹幕；迁移与备份副本演练见[活动迁移手册](activity-migration-runbook.md)。
