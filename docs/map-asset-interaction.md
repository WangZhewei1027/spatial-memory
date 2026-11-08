# 合集地图与投放交互

`/manage/collections/[id]` 是单个地图合集的编辑器。合集沿用 workspace UUID，由路由显式提供团队和合集；`/manage` 默认进入基础素材。素材和 Scene 属于团队，地图操作对象是 Placement。

## 模块边界

| 模块 | 职责 |
| --- | --- |
| [PlacementMapView](../app/manage/components/placements/PlacementMapView.tsx) | 组合投放列表、Cesium iframe 和侧栏，接收合集能力 |
| [ManageGridLayout](../app/manage/components/placements/ManageGridLayout.tsx) | 加载占位与正式内容共用的响应式 CSS Grid；直接按容器尺寸排布三栏 |
| [usePlacementData](../app/manage/components/placements/usePlacementData.ts) | 按团队/合集加载投放及内容，处理读取取消与刷新 |
| [placement-store](../app/manage/lib/placement-store.ts) | 当前范围、投放、内容缓存、选择与刷新状态 |
| [placement-to-viewer](../app/manage/lib/placement-to-viewer.ts) | 将投放转换为 viewer 可读的字段 |
| [usePlacementViewer](../app/manage/hooks/usePlacementViewer.ts) | iframe 消息、相机定位、选中和拖动保存 |
| `public/js/viewer/` | 独立 Cesium 运行时，管理图标、选择和渲染资源 |

`GET /api/placements/[id]/content` 解析源素材或场景的当前内容。内容缓存按团队/合集、投放及目标标识匹配；素材锁版本也参与素材目标的缓存键。活动与普通内容独立加载；活动地图标记从活动定义读取固定地点，无坐标点只显示在活动目录中。

地图工作区不支持面板拖拽或缩放。布局由 CSS 容器查询和网格计算，首帧即按顶栏下方的实际空间排布，占位与正式面板保持相同尺寸；不使用挂载后的宽高测量、默认尺寸或位置过渡。宽度至少 996px 时三栏并排，768–995px 时地图在上、其余两栏在下，更窄时地图、列表、侧栏纵向排列并滚动。

## ID 与消息

普通内容发送给 viewer 的 `id`、返回消息中的 `assetId` 和 `assetIds` 均指 **Placement ID**。基础素材的身份单独放在 `sourceAssetId`，场景身份放在 `sceneId`。同一素材在两个合集的投放是两个独立实例。

活动标记使用“活动投放 ID:打卡点 ID”的组合标识，弹幕范围中心使用活动投放 ID；`activityPlacementId` 指向所属地图关联。坐标来自同一个活动/打卡点定义，不存在独立的点投放记录。点击可选择对应关联，拖动会恢复原位置并引导进入“活动内容”编辑。活动内容页内置的地图只修改活动草稿，统一保存后所有关联地图更新。

活动管理由合集顶部导航栏打开弹窗，独立于左侧投放/识别目标页签和右侧普通投放面板。活动标记点击会打开列表、滚动到对应关联并突出该行；状态下拉框直接保存关联状态，沿用并发锁与错误恢复。关闭弹窗不切换列表、不清空普通投放选择，也不重挂载 viewer。旧链接的 `tab=activities` 参数继续作为打开活动弹窗的入口。

消息封装使用 `{ type, payload, source, version: 1 }`，source 为 manage 或 viewer。

| 方向 | type | 作用 |
| --- | --- | --- |
| 父 → 子 | SET_ORIGIN | 设置地图中心 |
| 父 → 子 | SET_ASSETS | 同步转换后的投放列表 |
| 父 → 子 | FOCUS_ASSET | 定位到指定投放及其坐标 |
| 父 → 子 | SET_SELECTION / CLEAR_SELECTION | 同步或清空多选 |
| 子 → 父 | VIEWER_READY | viewer 初始化完成，父级重发状态 |
| 子 → 父 | LOCATION_CLICKED | 更新手动选点坐标 |
| 子 → 父 | ASSET_CLICKED / ASSETS_SELECTED | 更新投放选中状态 |
| 子 → 父 | ASSETS_MOVED | 提交拖动后的投放坐标 |

## 写入与恢复

拖动通过 `POST /api/placements/move` 保存，逐项发送 `placementId`、`expectedLockVersion` 和坐标，批次原子处理。前端先检查能力，服务端再次验证团队、合集、状态及锁版本。

拒绝或失败时重发 SET_ASSETS 恢复地图位置；锁冲突会提示并请求重新加载。归档投放不删除源素材；暂停或归档后停止公开发现。来源选择器使用团队素材及已保存场景，编辑源内容无需“升级投放”。

匹配点素材 ID 通过适配器映射为该列表中的匹配点投放 ID，再写入 viewer 的 `anchor_id`。业务关联和识别规则见 [匹配点说明](anchor-matching.md)。

## 地图 3D 扫描模型

`/super-admin/map-scan-model` 按组织管理扫描模型叠加层，仅全局 `super_admin` 可读取组织开关列表或修改。设置保存在 `app_config.map_scan_model_organizations`（值为组织 UUID 到布尔值的映射），与组织拥有者可编辑的 `organization.config` 分离；缺失配置或新组织一律关闭，无需数据库结构迁移。更新只合并一个组织的开关，避免并发修改其他组织时相互覆盖。

合集的 `ViewerFrame` 将所属组织 ID 传给 viewer。运行时通过需要团队读取权限的 `GET /api/organizations/[id]/map-scan-model` 获取当前开关；只有服务端明确返回 `enabled: true` 才加载扫描瓦片。配置错误、超时、无组织上下文、移动设备及归档组织都不加载扫描模型。底图和投放消息桥不等待配置请求；开关变更在刷新或重新打开合集地图后生效。该设置控制地图叠加层的性能开销，不改变素材和场景中的普通 3D 模型。

## 验证

`node scripts/test-map-layout.mjs` 逐帧验证进入、刷新和从地图列表打开期间的布局稳定性，覆盖加载占位和真实面板。所有 API 与 viewer 使用隔离 fixture；具体环境与截图开关见[贡献指南](../CONTRIBUTING.md)。

修改消息桥时检查定位、单选/多选、手动选点、拖动保存、锁冲突恢复和合集切换。viewer 的重复同步及资源释放由 `node scripts/test-viewer-resources.mjs` 覆盖；它不替代浏览器消息桥和数据库写入验证。
