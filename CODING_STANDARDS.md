# 工程规范

适用于本仓库的 Web 平台、服务端 API、Cesium viewer 和共享 Scene Core。小程序是独立仓库，跨端改动遵循 [小程序 API](docs/miniapp-api.md) 与 [Scene Core](packages/scene-core/README.md) 的发布约定。

本规范整理现有架构和业务约定，并给出代码审查依据。自动执行的规则及开发流程见 [CONTRIBUTING.md](CONTRIBUTING.md)；命令与规则配置以 `package.json`、`eslint.config.mjs` 和 CI 为准。

## 模块与依赖

- 路由负责解析请求、建立调用者上下文、调用领域服务及映射响应。Asset、Scene、Placement 的业务规则放在各自服务及共享内容模型中；新增入口复用这些规则。
- 以实际变化和复用需求划分模块。抽取后应减少调用方需要理解的细节；只有转发调用、重复 DTO 或为假设需求增加参数的抽象，需要说明收益。
- 新增服务端实现放在 `lib/`，采用 `.server.ts` 并显式导入 `server-only`；既有基础设施入口沿用当前路径。共享类型、解析器与权限纯函数保持客户端可用；客户端需要的类型通过 `import type` 获取。`"use server"` 用于有意暴露的 Server Action，不代替模块隔离。
- Scene Core 只计算场景状态与时间采样。渲染、计时调度、资源获取和平台 API 由宿主承担；保留单文件、无依赖的运行时交付方式。
- `public/js/viewer/` 是 iframe 运行时。React 界面与 viewer 的交互走已有消息契约；改动消息时同时检查发送方、接收方和资源释放路径。
- `vendor/three-editor/` 的改动遵循其完整性清单与编辑器回归测试。生成文件通过对应命令更新；依赖与锁文件使用 npm 管理。

依据：[UI 分层](docs/ui/architecture.md)、[后端契约](docs/team-workbench-backend-contract.md)、[地图交互](docs/map-asset-interaction.md)、[Scene Core](packages/scene-core/README.md)。

## 数据、授权与兼容性

- 审查每个新增读写入口的授权路径：从会话到团队归属、角色与归档状态。公开接口要明确公开范围；登录状态、客户端 capabilities、维护人或 OSS 路径不能证明资源权限。
- 内容修改同时检查并发条件、事务边界和幂等性。资源、引用与索引的一致性必须由事务保障；遇到过期锁版本返回现有冲突契约，不覆盖他人的更新。
- 外部 JSON、URL 参数和第三方响应先按 `unknown` 验证，再转换为领域类型。优先复用当前解析器、DTO 与错误映射，类型断言不能代替运行时校验。
- SQL 值通过 Kysely 或参数化 SQL 绑定。动态表名、列名和排序依据必须来自受控集合。空间数据说明坐标系、单位及转换位置。
- Asset、Scene、Collection 与 Placement 的标识各有含义。改动 API、二维码或 iframe 消息时检查标识、错误码和协议版本的兼容性；历史迁移格式留在迁移脚本中。
- 托管文件的物理删除经过 `lib/storage/retention.server.ts`。审查复用、上传回执、对象锁和仍在使用的引用；资源归档不等同于删除文件。
- 数据库结构改动添加有序迁移，在开发库验证后生成类型。已在共享环境执行的迁移保持不变，修正通过新迁移完成；生产迁移遵循独立运行手册。

依据：[权限](docs/permissions.md)、[数据层](docs/data-layer.md)、[后端契约](docs/team-workbench-backend-contract.md)、[存储生命周期](docs/asset-storage-lifecycle.md)、[迁移手册](docs/content-model-migration-runbook.md)。

## 错误与外部资源

- 业务错误沿用对应 API 的错误契约。意外服务端异常通过 `lib/log-error.ts` 留下可定位的操作上下文（传入 `error` 以保留堆栈、错误码与 cause），返回可理解的失败结果；路由之外的渲染、Server Action 与未捕获异常由 `instrumentation.ts` 记为 `server`，浏览器上报统一使用 `lib/errors/client-report.ts`。审查日志和响应中是否泄漏令牌、凭据或用户敏感数据。
- 外部请求明确超时、失败与重试行为；有副作用的重试先确认幂等性。异步 UI 结果需要防止覆盖更新的选择或已卸载状态。
- Three.js、Cesium、音频、事件监听器、定时器和订阅有明确的拥有者与释放时机。缓存和共享资源只由拥有者释放，不能因一个视图卸载破坏其他消费者。

## 界面与语言

- 从 `components/ui/` 复用基础组件；产品组合留在相应业务层。新增封装应表达重复出现的产品行为。
- 字体、颜色、`Text`、图标按钮和交互状态遵循 [设计系统](docs/design-system.md)。图标按钮有可访问名称；加载、失败和空状态让用户知道当前状态及可执行操作。
- 用户可见文案按 [国际化约定](docs/i18n-guide.md) 同步中英文。审查修改的页面在两种主题、两种语言及目标宽度下是否可用。

## 测试与审查

- 测试验证调用者可观察的行为。优先通过公共函数、服务或路由验证结果；重构内部实现时，不应为了维持无关的调用次数断言而修改产品代码。
- 修复行为缺陷时添加能复现该缺陷的回归。权限与内容写入至少考虑未授权、只读、跨团队、归档和并发冲突中受影响的分支；API 变更同时核对消费者。
- 时钟、网络和外部服务由可控 fixture 或替身提供。真实数据库测试使用专用测试库并清理 fixture，不能从开发环境文件隐式取得连接。
- UI、跨端播放、数据库升级和外部登录有独立验收条件。类型检查、构建或纯逻辑测试通过，不能替代这些场景的验证。
- 审查关注需求实现、模块职责、权限、一致性、兼容性、资源释放和测试证据。规范例外给出具体原因与适用范围；机械规则新增自动检查，需要判断的规则在本文维护。

测试分类、实际命令和提交要求见 [贡献指南](CONTRIBUTING.md)。
