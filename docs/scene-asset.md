# Scene：保存即生效

Scene 是团队拥有的独立场景。`scene.document` 保存 schema 6 编排，资源别名只引用 `{ assetId }`；支持模型、图片、音频和视频。实例保存初始 position/rotation/scale、可选数值轨道、出入场时间和对应的媒体参数。空间文字保存在实例的 `text` 中，只属于当前 Scene，不创建 Asset，也不进入 `scene_asset_ref`；复制场景会复制文字内容并复用已有媒体素材。可选 `groups` 是带变换和轨道的父节点，实例与分组通过 `parent` 组成最多 4 层的层级，`instances` 的顺序即时间轴轨道顺序。`scene_asset_ref` 是同一保存事务重建的素材依赖索引。Asset 和 Scene 都只有一份当前内容，没有发布或版本切换流程。

## 保存、引用和归档

- 团队 owner/admin/member 可以保存，viewer 只读。保存需要 `expectedLockVersion`：缺少返回 428，冲突返回 409，客户端保留未保存修改。计数器只用于并发控制。
- 保存会验证素材属于同一团队、文件可用、类型受支持、动画名/序号正确。模型动画仅允许用于模型；媒体播放参数仅允许用于音频/视频。已归档素材可保留原引用，但不能新增引用。
- 地图 Placement 引用 `{ kind: "scene", sceneId }`。保存立即更新所有地图中的场景内容，不改变投放位置、展示配置、状态和并发锁。
- 空场景可以保存和扫码预览；手机提示没有内容。新建 active 投放时要求非空场景和 GPS/匹配点发现路径。
- 归档后停止编辑、直接扫码预览和新增投放；已有投放继续使用保存的场景。恢复后可以继续使用。
- 复制生成独立场景，复用当前素材，不复制投放。创建、导入和复制均不需要地图合集。

## 编辑与二维码

场景库 `/manage/scenes` 打开 `/manage/scenes/[id]`。React 直接组合 Three.js Editor 原生视口、素材与对象侧栏、变换时间轴和标题/保存栏；同一个 `useSceneDocument` 管理内容与最多 60 个过去快照的撤销历史。一次原生变换拖动提交一次；关键帧、素材、片段设置和标题共用历史。播放位置不保存，内容变化才标记未保存，退出时提示。

素材库占满左列高度，时间轴只在右下方；桌面库宽 352px，低于 1200px 时为 320px，窄屏展开为不超过 352px 的覆盖面板。顶部按全部、模型、图片、视频、音频、文字分类；媒体只展示团队素材目录，支持网格/列表、跨分类保留的搜索词和时长，音频默认列表。文字分类提供独立的创建入口。分类与搜索固定，短屏仍由结果区内部滚动。舞台工具始终固定在左上角，桌面顶边和左边间距均为 12px，手机为 8px；具体布局见 [编辑器设计](../app/manage/scenes/DESIGN.md)。

导入只创建团队 Asset 并刷新目录，不插入场景。加号或双击可用素材从当前播放头插入，拖入舞台确定空间落点，拖入时间轴确定出现时间；单击素材不选择场景内对象，加号、双击或拖放始终新增实例。场景文字直接保存在 Scene 中，已有文字通过舞台或时间轴选择。只读禁止写入；播放或达到实例上限时禁止插入，仍可导入团队素材。

素材库与场景对象选择分离，不合并当前场景引用、不展示使用次数或场景选择状态。目录按原始返回行分页，每次操作最多扫描五页跳过不能用于场景的类型，失败保留已加载结果并从当前页重试。导入阶段及错误单独展示。缩略图只使用已有 thumbnail 或图片资源，不解码完整音视频或模型生成卡片预览。

时间轴提供 position/rotation/scale 的 9 个通道、关键帧增删与拖动改时、线性/缓动/保持插值。旋转字段显示度，存储为 Euler XYZ 弧度；保留多圈值。已有自定义 Bezier 会显示“原有曲线”，编辑数值和时间时保留其 handles。Ctrl/⌘ S 保存、Ctrl/⌘ Z 撤销、Shift Z 重做，空格播放/暂停；W/E/R 切换原生变换，F 聚焦。窄屏侧栏默认收起，时间轴独立滚动；相机预览叠在舞台右上角，打开时保留素材库、编辑工具和时间轴。

场景与小程序共用米制坐标：1 个世界单位等于现实中的 1 米，XZ 网格每格为 1 米，Y 轴向上。编辑器用统一间距的网格代替原先叠加的 5 米粗格，并显示场景原点和长度为 1 米的 X/Y/Z 正向轴。辅助标记不属于场景内容，不参与素材选择、保存或导出；已有对象与关键帧不重新缩放。

左上角采用顶部紧凑视图条和左侧竖向变换工具。问号一键切换文字标签，旁边的小箭头展开 Gizmos 设置，集中管理网格与文字标签；文字标签选项在当前会话内统一切换“每格 1 米”、原点、虚拟相机及 X/Y/Z 一米标签；与网格开关独立，不写入 Scene，也不影响相机预览和实际播放。

虚拟摄像机在编辑器右上角的悬浮窗口提供 9:16 的小程序近似视角，默认垂直视场角 60°。二维码预设相机在场景坐标 `(0, 0, 2)`，地图预设在 `(0, 1.4, 2)`，两者都水平朝向 -Z，与小程序前方 2 米的放置规则对应。距离、高度、绕原点的水平角、俯仰角和视场角可在 Web 调整，只影响当前编辑会话的预览，不写入 Scene，也不改变小程序的放置位置。预览与主舞台共用时钟、模型、纹理及媒体播放器，随编辑和拖动时间轴实时更新；只在同一渲染器内增加局部相机绘制，不产生第二份音频。预览隐藏编辑辅助器和幽灵对象，保持正常素材着色；打开和关闭窗口都不改变主舞台的相机、选择或着色模式。手机使用 VisionKit 提供的实际相机投影和实时姿态，因此此预览用于估计构图与尺寸，不能代替真机视野和环境背景。

工具栏二维码复用地图合集的 WeChat token、OSS 缓存和弹窗组件。入口固定为 `pages/index/index?organizationId=…&sceneId=…`，首页打开 `pages/scene/scene`，不会改变所选地图或地图扫码历史。扫码展示最近保存的内容，未保存时弹窗明确说明。

`POST /api/miniapp/scenes/preview` 接收 `{ scene_id, organization_id }`，只返回未归档团队中的未归档场景。持有二维码即可匿名预览，与地图二维码相同。资源始终解析当前 Asset 文件；响应不缓存。

## 协议与共享 Core

`compileSceneManifest` 将文档 schema 6 与当前资源编译为播放清单：没有新功能且没有分组的场景保持 schema 4，有分组的旧场景保持 schema 5。包含 `text`、`timing`、`media` 或非模型素材的演出使用 schema 7；resources 记录从服务器读取的 `kind`，不能把新能力伪装成旧协议。包含实例 `opacity`、透明度/音量轨道或 `media.spatial` 的场景使用 schema 8。当前小程序播放器支持 4/5/7/8，并与 Web 共用 Scene Core 2.4.0 的采样与空间音频计算。上线时需要配套发布小程序；旧播放器拒绝未知版本，避免忽略关键帧或空间音频后错误播放。

两端从各节点的 `parent` 搭建 Object3D 层级，变换值都相对父分组。每个实例的 GLB 包在 `pivot` 节点中，按加载时的包围盒把底部中心对齐到实例原点（与小程序单素材 AR 放置同一规则，`test-scene-playback-parity.ts` 校验两端一致）；2026-10-22 之前保存的场景若使用原点偏移的模型，模型会移到实例原点处，需要重新摆放。`manifest.assetId` 是播放实例标识：地图入口为 Placement ID，直接扫码入口为 Scene ID；资源里的 assetId 才是基础素材 ID。

- 实例使用米制 `position`、Euler XYZ 弧度 `rotation` 和 `scale`。可选 `tracks` 的键为 `position.x/y/z`、`rotation.x/y/z`、`scale.x/y/z`；每个关键帧为 `{ time, value, handles: [inX, inY, outX, outY], connectedRight }`，time 单位为秒。相邻帧使用左帧出柄与右帧入柄做 Bezier 插值；`connectedRight: false` 保持到下一帧，精确关键帧时间返回该帧值。没有轨道的通道使用静态姿态。实例另支持 `opacity` 与 `volume` 两个标量轨道（值为 0–1），使用相同的曲线、保持、改时和撤销规则；分组仅支持九个变换通道。静态透明度为实例 `opacity`（默认 1），静态音量为 `media.volume`（默认 1）。删去通道最后一帧会将当前采样值保留为静态值。
- `asset` 和 `text` 必须且只能提供一个。`text` 包含 `content`（1–4000 字符）、`color`、`fontSize`（0.02–5 米）、`width`（0.1–20 米）、`align`（left/center/right）和可选 `backgroundColor`。颜色为 #RRGGBB，省略背景色表示透明。文字和媒体使用相同的实例变换、分组、时间轴和撤销模型。
- 可选 `timing` 为 `{ startSeconds, endSeconds, fadeInSeconds, fadeOutSeconds }`；结束点不包含在可见区间内，null 表示跟随场景时长。历史淡入淡出使用同一线性包络，重叠时取较小值。编辑器出入场只提供起止时间，新实例的 fade 字段为 0；视觉渐变使用 opacity 关键帧，声音渐变使用 volume 关键帧。历史 fade 字段继续兼容播放，不因 UI 调整自动改写。没有 timing 的历史模型保留全程可见、结束后定格的行为。时长缩短不删除其后的时间点。
- 音频/视频的可选 `media` 为 `{ trimStartSeconds, trimEndSeconds, playbackRate, volume, loop, muted }`。trim 是素材内部的秒数，结束 null 代表源文件结束；速率 0.1–4，音量 0–1。共享 `mediaTime` 从场景时间映射至裁切后的素材时间，再由宿主管理播放、暂停和音量；淡入淡出同时作用于视觉透明度和音量。原生流式音频的音高处理由宿主决定，无法保证不同设备的变速音色完全相同。
- 实例及分组可保存 `hidden?: boolean`；隐藏与不透明度曲线、媒体静音独立，分组隐藏会传递到后代。Web 舞台与相机预览都隐藏这些对象，选中也不显示幽灵对象。编译播放清单时移除 `hidden`，仅将有效隐藏实例的 `opacity` 设为 0 并移除该份清单中的不透明度曲线；保存文档中的曲线保留，音量和静音不变。因此现有 schema 8 小程序播放器可直接获得一致画面，隐藏视频仍能播放声音。恢复可见后，原有不透明度曲线重新生效。
- `samplePresentation` 的视觉透明度为出入场包络 × 透明度采样；音量为 `sampleVolume` × `sampleFade` 包络 × 空间衰减，静音最终归零。视频透明度不会改变其声音。标量曲线允许纵向超调，但运行时将结果限制在 0–1。
- `media.spatial` 为可选 `{ enabled, refDistance, maxDistance, rolloffFactor }`，缺省关闭，避免改变旧场景声音。参考距离 0.1–100 米，最大距离从参考距离至 1000 米，衰减系数 0–10。使用反距离衰减：`gain = ref / (ref + rolloff × (clamp(distance, ref, max) - ref))`；超过最大距离保持该距离的增益。音源和听者均传入世界位置，分组、放置根节点、位置关键帧及相机移动都影响距离；左右声像相对相机 forward × up 方向计算。Web 与小程序共享计算规则，宿主按音频 API 能力输出声像，原生流式通路至少保留距离衰减。
- 保存限制 1 MiB、8 素材、24 实例、2400 关键帧，时长大于 0 且不超过 600 秒；静态场景可用 null 时长，新场景默认 10 秒。校验允许 Bezier 纵向超调。
- `packages/scene-core` 是 Web 与小程序共用的零依赖源码。接口为 `play/pause/seek/advance/sync/sample/subscribe/observe/bind/dispose`，另提供数值采样、`clipTime`、`samplePresentation`、`sampleFade`、`sampleOpacity`、`sampleVolume`、`sampleSpatialAudio` 和 `mediaTime`。宿主负责帧时钟、资源、渲染和编辑历史；Core 不持有全局项目表、DOM、定时器或 RAF。
- 每个播放器独立创建 Core；`dispose()` 停止播放并清空订阅、对象绑定与内容引用。GLB 骨骼/节点动画仍由各端 Three.AnimationMixer 求值，Core 只共享片段时间映射。
- Web 使用本地 npm 包；小程序提交 npm pack 快照与 esbuild 产物。小程序仓库的 `miniprogram/lib/scene-runtime/vendor/build-info.json` 记录版本、源码哈希和字节数，更新后需核对两端一致。更新命令见 [Scene Core README](../packages/scene-core/README.md)。

## 播放与原生视口

小程序预览不请求 GPS。场景的模型、文字与媒体占位对象准备完成并获得有效相机帧后启用“放置场景”，点击时使用最新相机位置和水平朝向，放到前方 2 米、相机高度；轻触场景暂停/继续，底部控制也可暂停、继续和重播纯音频或暂时没有画面的场景。后台、错误、销毁会取消待处理结果并释放模型、解码器、音频节点与临时文件；超过 250ms 的相机帧不能用于放置。回到前台会重新读取保存内容并重新定位。

微信图片使用 Canvas 图片解码，空间文字从 Scene 数据绘制到独立纹理，不进入素材库。音视频通过远程 URL 渐进播放，两端共用 Core `mediaPreloadIds`：全部当前有效媒体，加上未来 5 秒内最近 2 条媒体，包含场景循环回绕。离开窗口释放播放器；预加载只定位到裁切起点，不发声。小程序普通音频使用原生 InnerAudioContext（0.5–2 倍速）；视频通过 Range 读取 MP4 索引，VideoDecoder 按素材时间取帧，默认 1 倍速音轨使用独立 audio-only PTS 解码器和 MediaAudioPlayer。原生 API 不支持的音频倍速、视频变速音轨及旧容器保留完整缓冲兼容路径。新上传 H.264/AAC faststart MP4 不经过完整下载。音频源按实例裁切、循环、音量和淡变播放。每个模型实例持有自己的材质，淡变不影响同素材的其他实例。字体字形及视频解码精度受宿主实现影响，时间轴与布局规则相同。

地图发现沿用 `/api/miniapp/assets/scene`，请求里的 `asset_id` 是投放 ID，并继续校验合集/团队范围；直接场景 ID 不能绕过地图投放状态校验。

`vendor/three-editor` 固定 r183 官方源码；Editor、Viewport、Selector、EditorControls、Toolbar、ViewHelper 和原生变换命令负责视口交互。`app/manage/scenes/components/three-editor/` 将子网格选取映射回实例，将完成的变换写入应用文档历史。模型模板缓存在当前视口按引用释放，关闭时清理 renderer、RAF、监听器和辅助资源。上游来源与补丁见 [集成说明](../vendor/three-editor/README.md)。

原生 Editor 的独立文件/JSON、任意材质/灯光/脚本未开放；层级通过时间轴轨道头部的分组编辑，不使用原生大纲树。演出扩展使用明确的播放协议版本，不能因 Web 支持而声称旧版小程序已支持。

## 迁移与验证

历史场景转换、原文归档和迁移顺序统一见 [迁移手册](content-model-migration-runbook.md)。

| 检查 | 入口与前提 |
| --- | --- |
| 采样与历史曲线转换 | `npx tsx scripts/test-scene-core.ts` |
| 媒体/空间文字协议与出入场采样 | `npx tsx scripts/test-scene-performance.ts` |
| 透明度/音量关键帧、空间衰减与协议门槛 | `npx tsx scripts/test-scene-automation.ts` |
| 分组与父子变换 | `npx tsx scripts/test-scene-hierarchy.ts` |
| 添加模型与编辑交互 | `scripts/test-scene-add-model.ts`、`scripts/test-scene-interactions.ts` |
| 米制网格、原点与虚拟摄像机 | `npx tsx scripts/test-scene-spatial-reference.ts` |
| 相机悬浮预览、编辑状态恢复与媒体单次驱动 | `npx tsx scripts/test-scene-camera-inset.ts` |
| Web 模型释放 | `npx tsx scripts/test-three-editor.ts` |
| 两端实际播放器一致性 | `npm run test:cross-runtime`，包含模型矩阵与演出素材/文字/音量/透明度；需要相邻小程序仓库及其运行时 fixture |
| 数据库转换 | `scripts/test-transform-migration.ts`，数据库和归档前提见迁移手册 |

编辑器改动还需验证保存/重开、撤销/重做、冲突时保留未保存内容、二维码预览及目标小程序协议。自动化播放器与内存检查不替代手机 AR 和真实客户端验收。
