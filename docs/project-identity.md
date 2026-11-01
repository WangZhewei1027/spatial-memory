# Spatial Memory 项目名称

产品统一显示为 **Spatial Memory**。工作区内的目录与包名：

| 用途 | 名称 |
| --- | --- |
| Web 仓库、npm 包与应用镜像 | `spatial-memory` |
| 小程序仓库与项目 | `spatial-memory-mini-program` |
| 独立 CLI 包 | `spatial-memory-web-cli` |
| CLI 命令 | `spatial-memory` |
| CLI 环境变量前缀 | `SPATIAL_MEMORY_` |
| CLI 默认会话文件 | `~/.config/spatial-memory/sessions.json` |

Web 和小程序 GitHub 仓库分别为 `WangZhewei1027/spatial-memory`、`WangZhewei1027/spatial-memory-mini-program`。CLI 独立发布安装包，源码位于同级目录；当前没有配置远端仓库。

## 兼容既有数据与部署

这次改名更新产品、代码、包、目录及 GitHub 仓库，没有迁移线上资源。以下旧标识仍用于定位现有数据，不能按品牌字符串直接替换：

- 手机号虚拟邮箱域名：`lib/phone-email.ts` 与 CLI 的 `src/contract.ts` 保持相同值，现有账号、短信登录与密码重置依赖它。
- PostgreSQL 数据库、角色、Compose 项目与持久卷，以及 `/opt/sanlin` 安装目录、备份任务、OSS 桶、RAM 身份和 Google 中转函数。实际值见[部署说明](production-deployment.md)和[环境模板](../deploy/env.example)；旧环境继续使用自己的配置。
- 数据库迁移互斥锁：保留原标识，使改名前后的迁移进程仍相互排斥。
- 已执行的 SQL、历史实验、部署记录、数据库备份和旧 CLI 安装包：保留当时的事实与校验值。
- 三林老街作为真实地点的素材说明和示例，不作为产品名称替换。

Web 本地偏好使用 `spatial-memory.*`；改名前的二维码环境与网格/列表偏好不迁移，首次进入分别使用正式环境和网格默认值。CLI 不自动读取旧会话目录；可显式指定旧会话文件，或在新目录重新登录。

后续若迁移账号域名或线上资源，需单独验证数据映射、权限、回滚和双端兼容。生产部署记录中的旧镜像名表示历史运行状态；新的构建和部署入口统一生成 `spatial-memory` 镜像。
