# 开发与质量检查

业务工程规则见 [CODING_STANDARDS.md](CODING_STANDARDS.md)，环境与数据库初始化见 [README.md](README.md)。本指南只适用于 `spatial-memory` 仓库。

## 本地准备

使用 `.nvmrc` 指定的 Node.js 版本与 npm，在仓库根目录运行：

```bash
npm ci
npm run hooks:install
```

`hooks:install` 将当前仓库的 `core.hooksPath` 设为相对路径 `.githooks`，每次克隆后执行一次。若已有自定义 Git hooks，先将其保留并接入本仓库检查，再切换路径；该命令会替换当前仓库的 hook 路径设置。相对路径兼容项目目录移动，不影响其他仓库。

依赖安装不自动更改 Git 配置，因此 CI 和 Docker 的 `npm ci` 不依赖 `.git` 或本地 hook。现有 `package-lock.json` 与 `.npmrc` 是依赖安装依据；新增依赖需说明实际用途。

媒体上传使用 sharp 和系统 FFmpeg/ffprobe（含 libmp3lame、libx264 和 AAC）；本地先安装 FFmpeg。模型缩略图使用锁定版本的 Playwright Chromium，安装依赖后执行 `npx playwright-core install --with-deps --only-shell chromium`（macOS 可省略 `--with-deps`）。默认离线回归实际转换合成媒体、渲染 GLB/Draco 模型并清理资源，不访问 OSS 或网络；CI 与生产镜像均安装这些运行依赖。缩略图协议和历史补全见 [素材缩略图](docs/asset-thumbnails.md)。

## 日常命令

| 命令 | 检查范围 |
| --- | --- |
| `npm test` / `npm run test:unit` | 不依赖真实数据库、外部服务和兄弟仓库的回归测试 |
| `npm run check:fast` | Next 类型生成、TypeScript、ESLint、上述测试 |
| `npm run check` | `check:fast` 加生产构建及客户端产物语法检查 |
| `npm run test:integration` | 内容服务、真实路由、上传去重和活动；显式提供已迁移的专用测试库 |
| `npm run test:scene-authoring` | 共享编排包的纯操作、采样与校验回归；先在包目录安装依赖 |
| `npm run test:scene-renderer` | 真实浏览器渲染集成测试；先在包目录安装依赖，并准备 Chrome/Chromium 和 FFmpeg |
| `npm run test:cli-auth` | CLI 浏览器授权与交换接口的 HTTP 回归；先构建兄弟 CLI，使用真实 Better Auth 与内存数据库 |
| `npm run test:cross-runtime` | Three.js 编辑器完整性与 Web/小程序实际播放一致性；需要兄弟仓库 |

提交前 hook 先检查暂存内容的空白错误，再执行 `check:fast`。检查不格式化文件、不自动暂存，校验的是整个工作区；部分暂存时仍需核对 `git diff --cached`，工作区通过不保证暂存快照通过。PR 中的 CI 检查实际提交的快照。

提交一个可解释的改动；在 PR 中说明行为变化、验证结果，以及迁移或跨端配套要求。纯格式化与业务行为调整分开提交。

## 自动检查的规则

| 规则 | 执行位置 | 失败处理 |
| --- | --- | --- |
| 严格类型与 Next 路由类型 | `typecheck`，沿用现有 TypeScript 配置 | 阻止提交 / CI |
| Radix 原始包只在 `components/ui/` 使用，包括重导出、require 和字面量动态导入 | ESLint，覆盖 `app/`、`components/`、`lib/` | 阻止提交 / CI |
| `lib/` 下的 `.server.ts` 及数据库、认证、存储、邮件入口显式导入 `server-only` | ESLint 本地规则；Next 构建检查客户端传递导入 | 阻止提交 / CI |
| Scene Core 无模块依赖、平台全局对象、网络、计时调度或动态代码执行 | ESLint，覆盖共享包 JS 源码 | 阻止提交 / CI |
| 业务回归及上述 lint 规则的正反例 | `test:unit` | 阻止提交 / CI |
| 生产构建、浏览器 chunk 语法 | 现有 `build` | 阻止 CI |
| 新库初始化、升级/回滚、内容保留、部署迁移门槛 | 现有 CI `database-migrations` job，专用 PostGIS 服务 | 阻止 CI |
| 内容服务、路由契约、上传去重与活动 | `test:integration`；CI 在同一临时 PostGIS 实例的独立库运行 | 阻止 CI |

规则回归直接调用真实 ESLint 配置，验证 Radix 边界、服务端标记和 Scene Core 限制，避免配置失效时出现假通过。

`npm run lint` 使用 `--max-warnings 0`：error 与 warning 都会阻止提交和 CI。必要的局部例外需在代码旁解释用途及边界，不能全局关闭规则。格式化暂沿用文件现有风格，不引入整库重排。

## 测试分类

### 默认回归

`scripts/run-unit-tests.mjs` 是默认测试清单的唯一入口，使用现有 Node test runner 与 tsx。每个文件在独立进程执行，客户端/纯逻辑测试与需要 `react-server` 条件的服务端测试分组运行。

覆盖内容解析与角色策略、素材 URL/展示、历史内容转换的纯逻辑、场景采样/分组/编辑交互、viewer 资源回收、匹配状态、二维码和登录回归。外部调用均使用 fixture 或替身。

新增不需要外部环境的测试应加入该清单，并运行 `npm test`。需要数据库、启动服务、读取环境文件或兄弟仓库的脚本不能放入默认组；新增规则必须有违规失败和合法通过的例子。

### 数据库与 HTTP

CI 的数据库 job 定义在 [.github/workflows/ui-quality.yml](.github/workflows/ui-quality.yml)，使用临时 PostGIS 实例运行迁移回归，并在全新 `content_services` 库运行服务集成测试。默认 `npm test` 不操作数据库。

内容服务、路由和上传改动还需要对应集成测试：`scripts/test-content-model-services.ts`、`scripts/test-team-workbench-routes.ts`、`scripts/test-upload-dedup.ts`、`scripts/test-activities.ts`。先阅读脚本及 `scripts/test-content-model-services-fixture.ts`，按其中允许的主机、端口和库名准备专用数据库，显式设置 `DATABASE_URL` 后运行：

```bash
npm run db:migrate
npm run test:integration
```

这两个命令必须继承同一个显式设置的测试 `DATABASE_URL`；集成测试拒绝开发库、非本机地址和非测试端口。单独排查某套测试时可用 `node --import tsx --conditions react-server scripts/test-<对应名称>.ts`。完整 HTTP 验收另见 `scripts/test-content-model-http.ts` 的本地服务与 fixture 要求。数据库测试由 CI 单独运行，不属于本地 `npm run check`；PR 要报告相关集成验证，不能用构建成功替代。

共享包的独立检查与依赖准备见 [Scene Authoring](packages/scene-authoring/README.md)、[Scene Renderer](packages/scene-renderer/README.md)。`test:cli-auth` 的测试入口是 `scripts/test-cli-auth-client.mjs`；先运行 `npm --prefix ../spatial-memory-web-cli run build`，测试会启动临时本地 HTTP 服务与实际 CLI，不访问真实数据库或 Google，也不替代真实账号授权。

### UI 与跨端

修改场景播放、共享包或模型适配时，按 [Scene Core](packages/scene-core/README.md) 准备相邻小程序运行时，再执行 `test:cross-runtime`。普通 Web CI 不假定存在该兄弟仓库。

UI 改动按 [设计系统](docs/design-system.md) 检查受影响页面。消息、二维码或小程序 API 变更需验证对应消费者，并在发布说明中列出配套发布顺序。

`/manage` 的共享布局改动运行 `node scripts/test-manage-navigation.mjs`：先启动本地 Next 服务（默认 `http://localhost:3000`，可用 `MANAGE_TEST_ORIGIN` 指定本机端口）。脚本用隔离的会话和 API fixture 验证列表切换、慢响应及前进/后退期间导航与工作面保持稳定，不读取或修改业务数据；不放入无需运行服务的默认测试组。

基础素材详情浮岛运行 `node scripts/test-asset-inspector.mjs`，沿用同一本地服务与隔离 fixture。覆盖中英文、明暗主题、桌面/窄屏、列表筛选与滚动保留、历史导航和重命名后的列表同步；设置 `INSPECTOR_SCREENSHOTS` 可保存检查截图。

地图活动弹窗运行 `node scripts/test-map-activities.mjs`，需要本地服务，所有 API 读写和 viewer 均使用隔离 fixture。覆盖 navbar 入口、活动标记与旧链接、弹窗开关时地图及列表状态保留、关联与状态写入、冲突与读取失败恢复、只读/归档、中英文、明暗主题和窄屏。设置 `MAP_ACTIVITIES_SCREENSHOTS` 可保存截图。

## CI 与发布

保留现有工作流文件和 job ID；`ui-quality.yml` 的显示名称为 Engineering quality。PR 自动运行 `validate`（`npm run check`）与 `database-migrations`；主分支部署复用同一工作流，二者通过后才进入部署。

这是仓库内的检查配置；GitHub 分支保护是否将检查设为必需项，由仓库设置决定。生产迁移、发布和外部服务操作按 [部署说明](docs/production-deployment.md) 执行。
