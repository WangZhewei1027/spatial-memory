# 视频与模型缩略图

视频与 3D 模型上传时由服务端生成静态图片，存入现有 OSS，并登记为同一素材的 `thumbnail` 资源。主文件仍使用 `primary`。缩略图与主文件使用同一套上传回执、团队内去重、对象锁和文件保留协议。

视频使用 FFmpeg 从最终视频截帧，模型使用隔离的无头 Chromium / Three.js 渲染。模型依赖必须内嵌；渲染过程不访问用户模型指定的网络 URL 或本地文件。服务端运行环境需要安装 FFmpeg 与 Chromium，具体依赖随 Docker 镜像和 CI 安装。

上传回执关联服务端生成的缩略图回执。创建或替换素材时，服务端自动登记两份资源，因此现有 Web、CLI 上传入口无需自己截图。更换主文件会同时更换缩略图；失败时不把旧文件的图片配到新文件上。素材列表与场景素材库读取 `thumbnail`；视频详情将同一图片用于播放前封面。

替换主文件的新回执若带有生成图片，它优先于请求中携带的旧 `thumbnail`，防止提交完整旧资源列表的客户端留下过期封面。主文件与图片的租约一并创建，上传补偿也一并释放两份未消费租约；物理删除仍由统一保留层控制。

## 运行与发布

本地安装：`npx playwright-core install --with-deps --only-shell chromium`；macOS 可省略 `--with-deps`。服务端为每份模型启动独立的 Chromium，使用软件 WebGL、固定相机与光照，支持 Draco 与 Meshopt；单进程同时最多处理一个模型截图，渲染时限为 30 秒。视频从最终 MP4 的前段截取一帧，缩放至最长边 512px；模型图片为 512 × 512 PNG。

发布此版本前需要应用 `db/migrations/20261104000000_upload_thumbnails.sql`，为上传回执增加可空的 `thumbnail_receipt_id` 关联；原有回执与客户端响应保持兼容。按生产迁移流程验证副本、备份和门禁后，再发布带 Chromium 的镜像。历史补全只上传普通图片并登记资源，不依赖此新增列，可先在原生产版本执行。

## 历史素材补全

补全脚本默认只读取数据库并输出缺少缩略图的素材。它不读取 `.env.local`，必须显式指定环境文件或提供环境变量：

```bash
node --import tsx --conditions react-server scripts/backfill-asset-thumbnails.ts --env-file .env.local
node --import tsx --conditions react-server scripts/backfill-asset-thumbnails.ts --env-file .env.local --limit 10 --apply
```

可用 `--asset-id UUID` 或 `--organization-id UUID` 限定范围。省略 `--limit` 会处理所有匹配项。生产执行前按[生产部署说明](production-deployment.md)核对目标数据库、备份和依赖；本脚本不会部署应用或迁移数据库。

执行按素材逐个进行，避免同时启动大量渲染任务。成功项不会在下次重复处理；失败或跳过项仍可重试。每条输出包含素材 ID、类型、状态和结果，末尾包含 `updated` / `skipped` / `failed` 计数。执行模式存在跳过或失败项时退出码为 2，启动失败为 1，全部完成为 0。

提交缩略图前，脚本按组织、素材、对象的顺序加锁，再次检查主文件标识和现有缩略图。若处理期间有人替换主文件、删除素材或已经补齐图片，本次结果会跳过；不会覆盖他人的更新。成功只新增 `thumbnail`、递增素材乐观锁并记录 `asset.thumbnail.backfill` 审计，不修改主文件、payload、名称、归档状态或投放。审计明确标记为维护任务，不声称由上传回执对应的团队成员发起。未使用的上传回执会过期并交给统一保留层回收。

已归档的素材也能补充派生图片，其归档状态保持不变；已归档团队仍保持只读并明确跳过。脚本仅自动读取受管 OSS 文件，对外部 URL、主文件缺失、无团队写入成员、超出当前大小边界的历史文件输出明确原因。外部资源应先导入受管存储后再重试。文件读取或渲染失败不会保存占位图作为成功结果。

## 2026-11-04 历史补全记录

生产库原有 143 个模型、5 个视频均无缩略图。本次成功补全 **137 个模型、5 个视频**。逐项核对原始资源清单、payload、归档状态均未改变；成功素材仅增加图片资源和一次乐观锁版本，缩略图对象已核对存在。重新执行只读扫描仅剩以下 6 条异常素材，不会重复处理成功项。

| 素材 | 原因与处理 |
| --- | --- |
| [3956991d…](https://www.spatialmemory.online/manage/assets/3956991d-5135-47ea-a5f0-554f64d87346) | 实际字节为 AppleDouble 元数据，不是模型；需替换为原始 GLB。 |
| [63ae4e4c…](https://www.spatialmemory.online/manage/assets/63ae4e4c-fd18-4ea3-9b68-4978e1346a41) | 同上。 |
| [be461fbd…](https://www.spatialmemory.online/manage/assets/be461fbd-060c-4405-859e-15be071b8078) | 同上。 |
| [e3992438…](https://www.spatialmemory.online/manage/assets/e3992438-dc1f-414e-9a8d-3f52afbe157a) | 同上。 |
| [faa8ce66…](https://www.spatialmemory.online/manage/assets/faa8ce66-0d5f-41df-a405-5aae901a49bf) | 同上。 |
| [c11a2990…](https://www.spatialmemory.online/manage/assets/c11a2990-3faa-493d-9900-6534b64498c2) | 实际是 glTF JSON，引用 `scene.bin` 与两份纹理；这些文件在对应 OSS 路径不存在。需重新导出含几何和纹理的 GLB。 |

补全前完整备份位于本机忽略目录 `.local-db-backups/thumbnail-backfill-20261104/`，含 `before.dump`、原始素材快照、执行结果和核对记录；备份已恢复到隔离数据库并验证新增回执迁移不改变素材内容。历史补全完成后，生产已应用 `20261104000000_upload_thumbnails.sql`；素材、资源、场景、投放及既有回执的数据指纹保持一致。发布前的最新完整备份与核对记录位于 `.local-db-backups/release-20261104-thumbnails/`。新上传的自动生成由包含 Chromium 的 Web 镜像提供。
