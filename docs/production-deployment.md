# 线上部署与服务说明

基础设施快照：**2026-11-01（北京时间）**。生产数据库、Compose 持久卷、部署路径、媒体与备份桶、RAM 身份和 Google 中转函数已完成 Spatial Memory 迁移。恢复材料和逐项验证见[迁移记录](spatial-memory-migration.md)。下列旧发布记录保留当时事实。

正式入口：**<https://www.spatialmemory.online/>**。整体由上海 Web 主机、OSS 文件存储、按需启动的 GPU 推理服务、中国香港 Google 登录中转函数，以及 Google、微信和短信接口组成。地图合集、Scene、基础素材属于同一个 Next.js 应用，共用同一个数据库。

## Web 与资源迁移发布（2026-11-01）

应用代码已发布至 `6a63f7cad3c88a094de06ec604b9a61f4b4b6ce9`（[Deploy 运行](https://github.com/WangZhewei1027/spatial-memory/actions/runs/41312619125)），运行镜像为 `sha256:b9c93443ed80aca2cf032a865957427c32278048c3696c6a0aacd1187516024d`。后续部署记录与备份权限修正不改变应用镜像。

- 45 个存量手机号账号迁移为 `phone.spatialmemory.local`，账号 ID、密码、会话、团队关系保留。另建的临时旧域账号已用原密码完成新域 Web/CLI 登录并清理；无短信发送。
- `/opt/spatial-memory`、Compose 项目及四卷使用新身份，PostgreSQL 数据库与三角色原地改名。pgAdmin 保存连接、SAGE systemd/虚拟环境与配置路径、03:30 备份 cron 已同步；网段仍为 172.18.0.0/16。
- 12,214 个 OSS 媒体对象和 33 个历史备份对象复制后逐项核对。8 条当前参考图 URL 更新，38 张业务/归档表的规范化内容指纹和计数一致。备份使用新私有桶；首份新备份全量恢复后 41 张表计数一致，临时恢复库已清理。
- 工程检查和数据库集成 CI 通过。线上 HTTP 验收覆盖资产幂等创建/更新、场景保存/重读、409/428 乐观锁、匿名拒绝、编辑器认证页面、媒体 Range，以及小程序 schema 8 参数与 Web/CLI 读写一致性。临时账号、团队和内容已清理；未将此验收表述为手机实机或完整浏览器交互测试。
- CLI `0.2.1` 直接使用当前 Scene/Asset/Collection API，私有仓库已推送到 `348b547`，10 项测试及离线安装验证通过。SAGE 仓库已推送到 `e5f4f85`。
- 小程序已推送 `1f221f8`；用户选择微信上传稍后处理，尚未上传、审核或正式上线。IP API 入口继续保留，避免影响现有小程序。

## Web 发布记录（2026-10-29 17:00）

应用已部署至 `57ccb54cc7f4cf0dd9e92ec30ff1d5b1ffe4de19`，[Deploy 运行记录](https://github.com/WangZhewei1027/spatial-memory/actions/runs/40844947452)于北京时间 17:00:58 成功完成。运行容器与该提交镜像一致（`sha256:0c403243582c…`），状态为 `healthy`；服务器 `.env` 的校验值与切换前一致。

- 发布包含此前提交的流式媒体与提前预加载、512 MiB / 5 分钟视频上传和服务端压缩、米制网格与原点、右上角相机预览，以及本轮精简编辑界面、透明度/音量关键帧和空间音频。Web 空间音频以虚拟相机为听者，计算距离衰减与左右声像。
- GitHub 的 `quality / validate`、`quality / database-migrations` 与部署均通过；包括 104 项离线测试、生产构建和 207 个客户端包语法检查，以及隔离数据库的迁移、回滚、服务、路由和上传去重检查。本地跨端回归包括 8,782 次变换比较与 18,328 次演出参数比较，精确参数最大误差均为 0。
- 本次没有新增数据库迁移，生产只读门禁通过。主、域名与备用 Caddy 文件均已同步：`/api/upload` 及其尾斜杠路径为 540 MB，普通请求仍为 35 MB；CI 已成功重新加载 Caddy。新容器启动时加载 `standalone-http.cjs`，实际核对请求接收期限为 900,000 ms、请求头期限为 60,000 ms。
- 线上首页、登录页返回 HTTP 200，未登录访问 `/api/organizations` 返回 307 并跳转登录。本次核验未上传用户素材或写入 OSS 对象。

配套小程序代码已在本机提交为 `7cc3a86`，尚未推送远端或发布微信版本。透明度、音量关键帧及空间音频使用播放 schema 8，需要配套播放器；原生流式音频支持距离衰减，左右声像仅在 Web 生效。旧场景继续按原有 schema 4/5/7 编译。本次 Web 发布不包含手机端实机播放验收。

## 上一版 Web 发布（2026-10-29 03:33）

应用已部署至 `2cf5961f938ee1403b6069358d0139d669b20afd`，[Deploy 运行记录](https://github.com/WangZhewei1027/spatial-memory/actions/runs/40753808359)第二次运行于北京时间 03:33:55 成功完成。运行容器与该提交镜像一致（`sha256:40335dc076ce…`），状态为 `healthy`；服务器 `.env` 的校验值与切换前一致。

- 发布包含独立活动模型、Island 演出编辑器、音视频与空间文字时间轴，以及服务端音频转码和图片压缩。本次 Web 的三个功能提交与配套小程序代码均已推送到各自远端。
- GitHub 的 `quality / validate` 与 `quality / database-migrations` 均通过，覆盖类型、lint、75 项离线回归、生产构建、活动两阶段迁移、冲突回滚、服务、路由和上传去重。首次部署被尚未完成的生产迁移门禁阻止；数据库升级后重跑发布任务，门禁、镜像传输、重启与冒烟检查全部通过。
- 生产已应用两项活动迁移。停写后的最终备份先完整恢复并验证，再执行生产迁移；副本与生产均通过 31 项检查。899 条历史文字及 12 组普通内容指纹保持不变，11 个店铺转为 1 场活动、11 个点和 1 条地图关联，19 项媒体引用完整保留。备份路径与恢复步骤见[活动迁移记录](activity-migration-runbook.md#2026-10-29生产数据库切换)。
- 线上首页、登录页返回 HTTP 200；未登录访问 `/api/organizations` 返回 307 并跳转登录。实际地图的活动接口返回 1 场活动、11 个点、19 项媒体引用；缺少地图或团队参数仍返回 400。
- 线上容器已实际完成合成音频的 MP3 32 kbps、24 kHz、单声道转码及 sharp JPEG 编码。Next 代理缓冲为 34 MiB，服务器主、域名与备用 Caddy 配置均为 35 MB；部署已重新加载 Caddy。该验证未写入用户素材或 OSS 对象。

小程序仓库已推送至 `8405126`，微信体验版和正式版尚未发布。新活动接口与 schema 7 演出场景仍需配套新小程序；本次 Web 部署不包含微信发布或手机端播放验收。

## 上一版 Web 发布（2026-10-28）

应用已部署至 `eb349a902d17e4034b89d898a70c29ec33f9bc1d`，[Deploy 运行记录](https://github.com/WangZhewei1027/spatial-memory/actions/runs/40651717067)全部成功。运行容器与该提交的镜像摘要一致（`sha256:6d76fc03855f…`），健康状态为 `healthy`；首页与登录页返回 HTTP 200，未登录访问 `/api/organizations` 按现有认证代理规则返回 307 并跳转 `/auth/login`。

- 发布包含共享 Scene Core 与原生场景编辑器、模型底部中心对齐、文档整理、工程规范、零警告 lint、提交 hook 和数据库集成 CI。
- 本地工程检查、49 项离线回归和数据库服务/路由/迁移检查通过；跨端播放 8,782 次比较的最大误差为 0。GitHub 的 `quality / validate` 与 `quality / database-migrations` 均通过。
- 生产库补齐 `20261019000000_native_theatre_scenes.sql` 与 `20261020000000_transform_scenes.sql`，标准迁移入口与只读部署门禁均通过。升级时没有场景记录，1,968 条投放保持不变；生产副本的 25 张业务与认证表在升级前后的记录数及内容校验值一致。
- 迁移前完整备份保存在服务器 `/opt/sanlin/backups/pre-migrate-20261028-eb349a9.dump`，本机副本位于仓库忽略目录 `.local-db-backups/release-20261028/pre-migrate-eb349a9.dump`。备份不进入 Git。

本记录只更新 Web 与上述数据库迁移的核对结果；下文的 GPU、短信、微信小程序和 Google 登录中转状态仍以各自标注日期为准。

## 部署关系图

实线表示业务访问，虚线表示部署或备份。

```mermaid
flowchart TB
    WEB["浏览器<br/>网站与管理后台"]
    MINI["微信小程序<br/>地图、Scene、AR 展示"]
    CI["GitHub Actions<br/>main 分支构建与部署"]
    FC_DEPLOY["函数独立部署脚本<br/>deploy-google-auth-relay.mjs"]

    subgraph SERVER["阿里云轻量应用服务器 · 上海 · 139.196.189.102"]
        CADDY["Caddy 容器 · HTTPS 入口<br/>www.spatialmemory.online<br/>证书自动续期"]
        APP["Next.js 容器 · 网站 + 后端 API<br/>登录、地图合集、Scene、基础素材"]
        PGADMIN["pgAdmin 4 容器 · 数据库管理<br/>db.spatialmemory.online<br/>独立登录 / 只读与维护连接"]
        DB[("PostgreSQL + PostGIS 容器<br/>用户、业务数据、空间位置<br/>仅内部访问")]
        SAGE["SAGE 网关 · systemd 服务<br/>选择 GPU、按需启动、故障切换"]
        BACKUP["定时备份任务<br/>每天北京时间 03:30"]

        CADDY -->|"页面和 API 请求"| APP
        CADDY -->|"db 子域名"| PGADMIN
        PGADMIN -->|"内部连接"| DB
        APP -->|"读写数据"| DB
        APP -->|"图片特征提取"| SAGE
        CADDY -->|"/_sage 路由"| SAGE
        DB -.->|"pg_dump"| BACKUP
    end

    subgraph CLOUD["独立云服务"]
        MEDIA[("OSS 素材存储<br/>spatial-memory-media<br/>图片、视频、音频、模型、二维码")]
        ARCHIVE[("OSS 私有备份存储<br/>spatial-memory-backups<br/>数据库备份文件")]
        GPU["阿里云 PAI-EAS · SAGE 推理<br/>GU30 / L20 / A10 按需选择<br/>核对时均已停止，等待请求启动"]
        WX["微信开放接口<br/>生成小程序二维码"]
        SMS["阿里云号码认证服务<br/>手机验证码"]
        GOOGLE["Google OAuth<br/>授权页、令牌与签名公钥"]
    end

    subgraph HONG_KONG["阿里云函数计算 · 中国香港 · cn-hongkong"]
        GOOGLE_RELAY["FC 3.0 · Google 登录中转<br/>spatial-memory-google-oauth-relay<br/>按需运行 · 128 MiB / 0.05 vCPU"]
    end

    WEB -->|"HTTPS · 页面、API、Google 授权回调"| CADDY
    WEB -->|"访问 Google 授权页"| GOOGLE
    MINI -->|"HTTPS API"| CADDY
    WEB -->|"加载素材"| MEDIA
    MINI -->|"加载素材"| MEDIA
    APP -->|"上传文件、缓存二维码"| MEDIA
    APP --> WX
    APP --> SMS
    APP -->|"POST /token、GET /jwks<br/>HTTPS + 独立调用密钥"| GOOGLE_RELAY
    GOOGLE_RELAY -->|"令牌交换 / 刷新、获取签名公钥"| GOOGLE
    SAGE -->|"启动、调用、空闲后停止"| GPU
    BACKUP -.->|"上传备份"| ARCHIVE
    CI -.->|"SSH 更新 Compose、Caddy 配置"| CADDY
    CI -.->|"SSH 部署镜像与 Compose 配置"| APP
    FC_DEPLOY -.->|"阿里云 API · 独立发布"| GOOGLE_RELAY
```

Google 授权页由用户浏览器直接访问，授权码随浏览器回调网站 `/api/auth/callback/google`。上海 Next.js 经香港函数交换令牌、获取 Google 公钥，再在上海完成验签、账号关联与会话创建；用户数据仍保存在上海 PostgreSQL，香港函数没有数据库访问权限。

## 服务用途与部署方式

Web 主机是阿里云**轻量应用服务器**，地域 `cn-shanghai`，部署目录 `/opt/spatial-memory`。Docker Compose 项目名为 `spatial-memory`，网络为 `spatial-memory_default`。

| 服务 | 用途 | 部署方式与位置 | 核对时状态 |
| --- | --- | --- | --- |
| Caddy | HTTPS、域名跳转、反向代理、证书自动续期 | Compose 的 `caddy`；容器 `spatial-memory-caddy-1`，镜像 `caddy:2-alpine`；挂载 `/opt/spatial-memory/Caddyfile`，证书保存在 `spatial-memory_caddy-data` 卷 | 运行中 |
| Next.js | Web 页面、管理 API、小程序 API、Better Auth 登录鉴权、上传与识别编排 | Compose 的 `app`；容器 `spatial-memory-app-1`，镜像 `spatial-memory:latest`；Node.js 22 + Next standalone，`linux/amd64` | 运行且健康 |
| PostgreSQL + PostGIS | 账号会话、团队、地图合集、素材、Scene、投放和空间查询 | Compose 的 `db`；容器 `spatial-memory-db-1`，镜像 `postgis/postgis:17-3.5`；数据库 `spatial_memory`，数据卷 `spatial-memory_db-data` | 运行且健康；唯一生产业务数据库 |
| pgAdmin 4 | 浏览表格、JSON、执行 SQL 和维护数据 | Compose 的 `pgadmin`；镜像 `dpage/pgadmin4:9.18`，独立配置卷 `spatial-memory_pgadmin-data`，512 MiB 内存上限；Caddy 提供 `db.spatialmemory.online` HTTPS | 2026-10-19 新增；登录与运维见 [pgAdmin 说明](pgadmin.md) |
| SAGE 网关 | 管理 GPU 生命周期、选择合格候选、预热校验和转发图片向量请求 | 主机 Python 虚拟环境 + `sage-fallback.service`，代码位于 `/opt/spatial-memory/sage-fallback`；独立于 Docker Compose | 运行中；控制器因空闲处于 `off` |
| SAGE 推理 | 将参考图、相机图片转为特征向量，供后端匹配；AR 渲染仍在手机端完成 | 阿里云 PAI-EAS 上海服务，GPU 由网关按需启动；详情见下节 | 所有候选 `Stopped`，运行实例数为 0 |
| OSS 素材桶 | 保存媒体、3D 模型、二维码和部分静态资源 | 上海桶 `spatial-memory-media`；应用经 OSS SDK 上传，客户端经公开 HTTPS 地址读取 | 已接入；使用 OSS 原始域名，未配置独立媒体 CDN |
| 数据库备份任务 | 导出生产数据库并上传到主机外的存储 | 主机 cron 执行 `/opt/spatial-memory/backup.sh`；`/etc/cron.d/spatial-memory-backup` 配置每天 03:30，服务器时区 `Asia/Shanghai` | 2026-11-01 迁移后手动执行与离机恢复验证成功 |
| OSS 备份桶 | 保存用于恢复的数据库 dump | 私有桶 `spatial-memory-backups`，对象前缀 `db/`；由备份脚本上传 | 已接入；不是运行中的数据库或热备副本 |
| 微信开放接口 | 获取 access token、生成合集和 Scene 的小程序码 | Next.js 服务端调用微信 API；生成图片按 `release/trial/develop` 分开缓存在 OSS，access token 缓存在应用进程内 | 已配置；二维码环境在 `/admin/settings` 浏览器端选择，默认 `release` |
| 阿里云号码认证服务 | 发送、校验手机号验证码 | Next.js 内的 `lib/auth/sms.ts` 调用 Dypnsapi；使用服务端 RAM 凭据，不额外部署短信进程 | 已接入；本次未发送真实短信测试 |
| Google 认证中转 | Google 令牌交换、刷新与签名公钥获取 | FC 3.0 中国香港 `cn-hongkong` 函数 `spatial-memory-google-oauth-relay`；Node.js 20、128 MiB、0.05 vCPU，按需运行；由 [独立脚本](../scripts/deploy-google-auth-relay.mjs) 发布，配置见 [中转说明](google-auth-relay.md) | 已上线；生产容器获取公钥、无效授权码回调与中转鉴权检查通过，真实账号授权仍需用户验证 |
| 微信小程序 | 扫码入口、地图内容与 Scene 播放、手机端 AR | 兄弟项目 `spatial-memory-mini-program` 通过微信开发者工具独立编译、上传和发布；通过 `/api/miniapp/*` 访问 Web 后端 | 配套 Scene / 新内容模型版本仍待用户另行发布 |
| GitHub Actions | 质量检查、镜像构建、Web 部署和冒烟检查 | [Deploy 工作流](../.github/workflows/deploy.yml)，push `main` 或手动触发 | 已启用；不发布小程序、SAGE 或香港 FC 函数 |

SMTP 邮件发送是可选功能，核对时未配置 `SMTP_HOST` / `SMTP_FROM`。Better Auth 运行在 Next.js 内，没有单独的认证容器。当前主链路不通过 Vercel 或 Supabase；历史迁移记录不代表仍在使用那些服务。

## 域名、端口与请求路径

`www.spatialmemory.online` 和 `spatialmemory.online` 的 DNS A 记录都指向 `139.196.189.102`。HTTP 跳转 HTTPS；裸域名再跳转到 `www`，保留路径与查询参数。原 IP 的 HTTPS 入口仍保留，供客户端域名切换过渡使用。

`db.spatialmemory.online` 同样指向此主机，由 Caddy 独立路由到 pgAdmin，不经过网站的登录系统。

| 入口 | 可达范围 | 作用 |
| --- | --- | --- |
| TCP 80、TCP/UDP 443 | 公网 → Caddy | HTTP 跳转、HTTPS / HTTP/3 |
| TCP 22 | 运维与 CI → 主机 SSH | 部署、只读检查、数据库隧道 |
| `app:3000` | Docker 内部网络 | Caddy 转发到 Next.js；未映射为主机公网端口 |
| `pgadmin:80` | Docker 内部网络 | Caddy 转发到数据库管理页面；未映射主机端口 |
| `db:5432` / `127.0.0.1:5432` | 应用容器 / 主机回环 | 应用数据库访问；外部运维通过 SSH 隧道进入 |
| `172.18.0.1:18080` | 主机 Docker 网桥 | SAGE 网关；应用的 `SAGE_EAS_ENDPOINT` 指向此地址 |
| `/_sage/*` | 经 Caddy 的 HTTPS 入口 | 去掉前缀后转发至网关；`/health`、`/embed`、`/status` 仍需网关 Token |
| `spatialth-relay-vsuiocyxbq.cn-hongkong.fcapp.run` | 公网 HTTPS 入口，函数校验独立调用密钥 | 香港 Google 中转，仅支持 `POST /token` 和 `GET /jwks`；调用密钥只在服务端配置 |

典型请求路径：

- 管理与扫码：客户端 → Caddy → Next.js → PostgreSQL。素材和 Scene 保存即生效，引用通过 ID 读取当前内容。
- 文件：浏览器上传原文件 → Next.js `/api/upload` 授权并压缩/转码 → OSS；浏览器和小程序按最终媒体 URL 加载文件，网页部分图片也经过 Next.js 图片优化接口。Docker runner 包含 FFmpeg/ffprobe，sharp 随服务端依赖打包；缺少转码运行时会拒绝音频上传，不保存未转换文件。
- 视频原文件最大 512 MiB / 5 分钟，图片/匹配图/音频最大 32 MiB。视频最终大小按 512 kbps 视频 + 32 kbps 音频控制，不再限制 5 MiB；其他素材最终对象仍最大 5 MiB。multipart 上限 513 MiB；上传端点绕过 Next proxy 请求体复制并流式落盘，路由继续校验会话和团队权限。主/备用 Caddy 仅对 `/api/upload` 开放 540 MB（十进制），其他请求仍为 35 MB。生产启动预加载 `scripts/standalone-http.cjs`，将 Node 接收请求期限从 5 分钟提高至 15 分钟，保留请求头 60 秒期限；视频编码最多 300 秒。发布需要重建镜像并加载配套 Caddy 配置，不能仅替换客户端资源。
- 识别：小程序 → Next.js 识别接口 → SAGE 网关 → PAI-EAS 返回向量 → 后端匹配并返回结果。
- Google 登录：浏览器访问 Google 授权页 → 浏览器回调 Caddy / Next.js → 香港 FC → Google 令牌与公钥接口 → Next.js 验签并在 PostgreSQL 中创建或关联账号、保存会话。

## SAGE 独立部署与运行策略

网关与模型源码位于兄弟项目 `ai-location`，主要说明在 `ai-location/deploy/sage/fallback/README.md`。**Web 的 GitHub Actions 和 `npm run deploy` 不会更新这两项服务。**

- 网关：Python 程序、虚拟环境和依赖部署到 `/opt/spatial-memory/sage-fallback`，由 systemd 管理；私有配置与云凭据在 `/etc/sage-fallback/`，恢复状态在 `/var/lib/sage-fallback/state.json`。更新后通过 systemd 重启并核对状态。
- 模型：通过 `ai-location/deploy/sage/` 的部署工具与阿里云 PAI-EAS 管理接口更新。模型、容器、规格或挂载变化需重新验证候选资格并更新网关注册表，不能只更新某个推理服务就视为全部发布完成。
- 正式候选按顺序尝试：GU30 32 核 `sage_qual_gu30_32_1014` → L20 `sage_qual_l20_1014` → A10 `sage_anchor_gpu`。名字含 `qual` 的前两项已用于正式调度。
- 两个未通过资格验证的服务 `sage_qual_gu30_1014`（8 核）、`sage_qual_gu30_16_1014`（16 核）保持停止，不参与自动启动。
- 顺序启动与回退，确认旧实例释放后才启动下一个；有需求时启动，空闲 1800 秒后释放。首次请求可能经历冷启动或缺货等待，不代表模型随时已就绪。
- `/readyz` 仅检查网关存活；带 Token 的 `/status` 只读状态。**`/health` 和 `/embed` 会登记需求，不能用作保持空闲时的定时巡检。**

## Web 发布方式

日常自动部署以 [Deploy](../.github/workflows/deploy.yml) 和 [质量检查](../.github/workflows/ui-quality.yml) 为准：

1. push `main` 或手动运行工作流，先完成 `npm run check`（类型、零警告 lint、离线回归、生产构建）以及隔离 PostGIS 的迁移、服务、路由与上传去重测试。
2. 构建 `linux/amd64` 的 `spatial-memory:<commit SHA>` 镜像。`NEXT_PUBLIC_*` 在构建时写入前端包，修改这类配置需要重新构建。
3. 经 SSH 对目标数据库运行只读部署门禁，核对迁移账本和实际结构；缺迁移或残留旧结构时阻止部署。
4. 使用 `docker save | gzip` 经 SSH 传输镜像，再在服务器 `docker load`；当前链路不使用镜像仓库。复制 Compose、Caddy 和备份脚本，保留服务器 `/opt/spatial-memory/.env`。
5. 将目标镜像标为 `spatial-memory:latest`，执行 Compose 更新、Caddy reload，最后访问首页做 HTTP 200 冒烟检查。

手工发布入口是 [`scripts/deploy.sh`](../scripts/deploy.sh)（`npm run deploy`）：本地构建后走相同的 SSH 传输方式，并安装备份 cron。与 CI 不同，**手工脚本会用所选环境文件覆盖服务器 `.env`**；应先核对该文件，避免覆盖现有域名、SAGE 或凭据配置。

部署配置索引：[`Dockerfile`](../Dockerfile)、[`docker-compose.yml`](../deploy/docker-compose.yml)、[`Caddyfile`](../deploy/Caddyfile)、[`env.example`](../deploy/env.example)。密钥、服务器 `.env`、SAGE 私有注册表和数据库 dump 均不提交 Git。

pgAdmin 的首次 secret 和数据库角色需按 [部署说明](pgadmin.md) 初始化；后续 Web 部署同步其公开配置与镜像，保留账号配置卷和私有凭据。

### OSS 媒体跨域与浏览器缓存（2026-10-29）

素材桶 `spatial-memory-media` 的 CORS 保留现有规则：来源 `*`，方法 `GET` / `HEAD`，允许请求头 `*`，暴露 `ETag` / `Content-Length`，预检缓存 86400 秒；已开启 `ResponseVary=true`。此设置让包括非跨域请求在内的响应都返回 `Vary: Origin`，避免普通素材预览与场景的 `crossOrigin="anonymous"` 请求错误复用缓存。此规则只允许跨域读取，不允许浏览器跨域上传或删除。

这次在 Chrome 复现了原音频 URL 加载失败，而同一文件使用新缓存键可以播放；仅重新获取该音频的缓存后，原 URL 也恢复。音频文件和编码没有修改。修改 CORS 配置不会自动失效浏览器已经缓存的旧响应；遇到旧页面仍报缺少 `Access-Control-Allow-Origin`，先保存未保存的场景，再重新加载；必要时在开发者工具禁用缓存后刷新一次。不要通过移除视频的 `crossOrigin` 来处理，WebGL 视频纹理仍需要 CORS。

排查时分别发送不带 Origin、带 `Origin: http://localhost:3000` 和带线上 Origin 的请求：三者均应有 `Vary: Origin`，后两者应有匹配的 `Access-Control-Allow-Origin`。同时检查 `Range` 请求返回 206 及其预检是否成功。预检缓存时间与对象的一年 `Cache-Control` 是两个独立设置；无需为了修复 CORS 禁用素材的长期缓存。配置说明见 [OSS CORS](https://help.aliyun.com/zh/oss/user-guide/configure-cross-origin-resource-sharing) 和 [PutBucketCors / ResponseVary](https://help.aliyun.com/zh/oss/developer-reference/putbucketcors)。

### 登录配置与 Google 网络依赖

新用户通过 Google 或中国大陆手机号注册，存量邮箱保留密码登录；密码重置仅支持手机号验证码。此改动不需要数据库迁移，认证回归由 `scripts/test-sms-auth.cjs` 纳入 CI。

Google 的 `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET` 保存于服务器 `/opt/spatial-memory/.env`，回调地址为 `https://www.spatialmemory.online/api/auth/callback/google`。生产凭据已于 2026-10-19 配置，重建应用容器后生效；凭据不进入仓库或镜像。

上海主机无法直连 Google，因此服务端请求通过中国香港 FC 中转。`GOOGLE_RELAY_URL` 和 `GOOGLE_RELAY_SECRET` 保存在 `/opt/spatial-memory/.env`，网站仍负责 OAuth state、PKCE、Google JWT 验签、账号关联与会话。香港函数没有数据库访问权限。用户浏览器仍须能打开 Google 授权页；真实账号授权与自动化测试的验证范围见 [中转说明](google-auth-relay.md)。

## 数据库迁移、备份与恢复边界

生产数据库已在 2026-10-19 完成团队内容模型迁移。后续改表仍需遵循以下顺序，部署脚本不会自动执行迁移：

1. 获取目标库完整备份，在隔离副本验证迁移及数据保留；需要破坏性升级时安排停写，并在停写后获取最新备份。
2. 经 [`scripts/db-tunnel.sh`](../scripts/db-tunnel.sh) 连接目标库，按 [迁移手册](content-model-migration-runbook.md) 执行 `npm run db:migrate`，核对迁移账本、引用和归档。
3. 运行只读部署门禁，再发布匹配结构的 Web；涉及客户端协议变化时协调小程序独立发布和验收。

[`deploy/backup.sh`](../deploy/backup.sh) 使用 PostgreSQL custom 格式压缩导出，保存为 `/opt/spatial-memory/backups/spatial-memory-<时间>.dump`，随后上传到私有 OSS 的 `db/` 前缀；本地通过 `find -mtime +3` 清理旧 dump。OSS 保留周期由桶生命周期配置管理，本文不将历史文档中的周期当作已重新核验值。

这些 dump 备份数据库内容，不包含 OSS 媒体文件、服务器配置或 SAGE 凭据。数据库文件与 Caddy 证书使用持久卷；替换应用容器不会清空它们。恢复时需匹配数据库结构与应用版本，删表删列之后不能只回滚旧应用镜像；详见迁移手册。

目前 Web 与数据库共用一台主机，没有自动接管的备用主机或数据库副本。OSS 备份用于恢复，不能替代高可用。

## 只读巡检与文档维护

以下命令不会迁移数据库或唤醒 GPU：

```bash
ssh root@139.196.189.102 'cd /opt/spatial-memory && docker compose ps'
ssh root@139.196.189.102 'systemctl status sage-fallback --no-pager'
ssh root@139.196.189.102 'curl --fail --silent --show-error http://172.18.0.1:18080/readyz'
ssh root@139.196.189.102 'tail -n 10 /var/log/spatial-memory-backup.log'
curl --head https://www.spatialmemory.online/
```

`/readyz` 成功只表示网关存活，不表示 GPU 已启动；首页成功也不覆盖短信、识别或手机 AR 全链路。更新域名、端口、Compose、GPU 候选、备份策略或小程序发布状态时，同时更新本文的核对日期与对应条目。

服务职责以本文和部署配置为准；数据库升级与恢复统一查阅 [迁移手册](content-model-migration-runbook.md)。上文运行状态仅代表文首标注的核对日期。
