# Spatial Memory 项目名称

产品统一显示为 **Spatial Memory**。

| 用途 | 名称 |
| --- | --- |
| Web 仓库、npm 包与应用镜像 | `spatial-memory` |
| 小程序仓库与项目 | `spatial-memory-mini-program` |
| 独立 CLI 包 | `spatial-memory-web-cli` |
| CLI 命令、环境变量、会话文件 | `spatial-memory`、`SPATIAL_MEMORY_*`、`~/.config/spatial-memory/sessions.json` |
| 手机号虚拟邮箱域 | `phone.spatialmemory.local` |
| 生产目录与 Compose 项目 | `/opt/spatial-memory`、`spatial-memory` |
| PostgreSQL 数据库与应用角色 | `spatial_memory` |
| 数据库查看与维护角色 | `spatial_memory_readonly`、`spatial_memory_maintenance` |
| OSS 素材与备份桶 | `spatial-memory-media`、`spatial-memory-backups` |
| RAM 应用身份与存储策略 | `spatial-memory-app`、`SpatialMemoryStorageAccess` |
| Google 香港中转函数 | `spatial-memory-google-oauth-relay` |

GitHub 仓库均位于 `WangZhewei1027`：Web 和小程序维持原公开范围，`spatial-memory-web-cli` 与 `ai-location` 是私有仓库。

## 数据与资源迁移

2026-11-01 的切换步骤、备份、验证及回滚见[迁移记录](spatial-memory-migration.md)。此版本必须先完成生产迁移再部署，部署门禁会拒绝缺失手机号迁移的数据库。

手机号账号直接更新虚拟邮箱，账号 ID、密码、会话、团队成员关系保持不变；Web 与 CLI 使用同一新域，不保留旧域登录分支。迁移检查目标邮箱冲突和 auth/public 同步，异常时整个事务回滚。旧手机号验证码票据需重新申请。

媒体桶通过完整复制与校验后切换，当前数据中的旧媒体 URL 使用一次性迁移脚本更新。应用只使用新桶配置。旧卷、旧桶和函数的保留状态以迁移记录为准，保留的恢复材料不参与新的运行路径。

数据库迁移锁改为 `spatial-memory.schema-migrations`；切换时停止旧迁移进程及应用写入，再使用新锁，禁止旧脚本连接新生产库。

## 保留的历史与业务事实

已执行 SQL、历史部署记录、数据库备份、旧 CLI 安装包校验值，以及真实地点“三林老街”的素材说明保持原样。迁移工具中的旧名是明确的来源标识，不是运行时兼容逻辑。

Web 偏好使用 `spatial-memory.*`，默认正式环境和网格视图。CLI 不自动读取旧会话目录；使用新目录重新登录或显式指定会话文件。
