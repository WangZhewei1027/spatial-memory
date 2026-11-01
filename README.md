# Spatial Memory · Web 平台

管理团队素材、3D 场景和地图投放，为空间记忆与 AR 体验提供内容与接口。线上网站：[spatialmemory.online](https://www.spatialmemory.online/)。

本仓库只包含 Web 平台。微信小程序位于独立的兄弟仓库 `spatial-memory-mini-program`，通过 [小程序 API](docs/miniapp-api.md) 获取内容。

独立 CLI 位于同级 `spatial-memory-web-cli`，命令为 `spatial-memory`。名称约定与既有部署标识见[项目名称](docs/project-identity.md)。

## 业务与架构

- **Asset（素材）**：团队拥有的可编辑内容及其当前文件。
- **Scene（场景）**：引用素材的空间组合与时间轴；保存后立即用于预览和投放。
- **Collection（地图合集）**：数据库中的 `workspace`，用于组织地图投放与标签。
- **Placement（投放）**：将素材或场景放置到地图的位置与展示配置。

团队成员共享内容；owner/admin/member 可编辑，viewer 只读。授权由服务端统一执行，地图合集没有独立成员权限。

Web 使用 Next.js、React 和 TypeScript；数据层是 PostgreSQL + PostGIS、Kysely，认证使用 Better Auth，媒体存储使用阿里云 OSS。Three.js 编辑器通过共享的 [Scene Core](packages/scene-core/README.md) 处理场景求值，地图使用 Cesium iframe。部署使用 Docker Compose，详见 [线上部署说明](docs/production-deployment.md)。

## 本地开发

以下命令均在本仓库根目录运行。使用 Node.js 22（见 `.nvmrc`）：

```bash
npm ci
npm run hooks:install
```

上传处理与媒体回归测试还需要系统 `ffmpeg` 和 `ffprobe`（含 `libmp3lame`）。macOS 可运行 `brew install ffmpeg`，Debian/Ubuntu 使用 `apt-get install ffmpeg`。图片处理依赖 sharp，由 `npm ci` 安装；生产 Docker 镜像自带上述运行时。

准备本地 PostgreSQL + PostGIS 数据库，在 `.env.local` 配置：

```dotenv
DATABASE_URL=postgresql://spatial_memory:<password>@localhost:55432/spatial_memory
BETTER_AUTH_SECRET=<使用 openssl rand -base64 32 生成>
NEXT_PUBLIC_SITE_URL=http://localhost:3000
OSS_INTERNAL=false
```

将数据库连接替换为自己的本地配置。OSS、短信和 Google 登录所需的变量见 [环境变量模板](deploy/env.example)；按需要启用的功能填写。

确认 `DATABASE_URL` 指向开发数据库后，初始化并启动：

```bash
npm run db:migrate
npm run dev
```

访问 [localhost:3000](http://localhost:3000)。数据访问和鉴权约定见 [数据层说明](docs/data-layer.md)。

## 检查与发布

```bash
npm test            # 不依赖数据库或外部服务的回归测试
npm run check       # 类型检查、lint、上述测试、生产构建
npm run db:codegen  # 数据库结构变化后重新生成类型
```

提交前自动执行 `npm run check:fast`。默认回归清单在 `scripts/run-unit-tests.mjs`；数据库、完整 HTTP 和跨端测试需按改动单独运行。检查范围、hook 安装说明和测试环境要求见 [贡献指南](CONTRIBUTING.md)。

发布步骤、生产配置和备份见 [线上部署说明](docs/production-deployment.md)。部署脚本检查迁移状态，生产数据库迁移需单独执行。

## 开发文档

完整目录见 [文档索引](docs/README.md)。

- [AGENTS.md](AGENTS.md)：工程约束、按模块阅读的文档入口及 Agent 技能配置。
- [工程规范](CODING_STANDARDS.md) / [贡献指南](CONTRIBUTING.md)：代码审查标准、自动检查、提交和测试流程。
- [团队工作台](docs/team-workbench.md) / [后端契约](docs/team-workbench-backend-contract.md)：内容模型、权限与 API。
- [场景与播放](docs/scene-asset.md)：场景结构、编辑与播放约定。
- [设计系统](docs/design-system.md) / [UI 分层](docs/ui/architecture.md)：组件、排版和主题规则。
- [存储生命周期](docs/asset-storage-lifecycle.md)：上传凭据、文件复用与回收。
- [GitHub Issues 工作流](docs/agents/issue-tracker.md)：需求、规格与实现任务。
