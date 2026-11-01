# 浏览器数据库管理（pgAdmin 4）

入口：**<https://db.spatialmemory.online/>**。独立于网站登录，管理员账号为 `admin@spatialmemory.online`；它是登录标识，不依赖该邮箱收件。登录密码与数据库连接密码分别生成，存放在服务器 `/opt/spatial-memory/pgadmin/private/credentials.json`，仅 root 可读，不提交 Git。

## 日常使用

登录后展开左侧 `Spatial Memory`：

| 连接 | 数据库角色 | 用途 |
| --- | --- | --- |
| 生产库 · 只读 | `spatial_memory_readonly` | 日常查看 `public`、`auth` 和 `migration_archive`，默认事务只读；表权限拒绝写入 |
| 生产库 · 维护（可修改数据） | `spatial_memory_maintenance` | 可查询、增删改 `public` / `auth` 数据；归档只读，不授予超级用户、建库或建角色权限 |

首次连接时输入对应数据库密码；可保存只读连接密码，维护连接按需输入。`spatial_memory` → `Schemas` → `public` → `Tables` 下可找到 `asset`、`scene`、`workspace`、`placement` 等业务表。右键表 → `View/Edit Data` → `First 100 Rows` 打开表格；JSON/JSONB 单元格可打开 JSON 编辑器，`Query Tool` 用于 SQL。

网站的团队权限不限制这个运维入口：上述角色覆盖全库对应 schema，账号仅供数据库运维。直接修改会绕过业务服务的引用同步、乐观锁与校验；内容编辑优先使用网站，结构变化仍走项目数据库迁移。

## 服务与访问边界

- 镜像固定为 `dpage/pgadmin4:9.18`，Compose 服务 `pgadmin`，容器 `sanlin-pgadmin-1`；上限 512 MiB / 1 CPU，Gunicorn 4 个线程。
- Caddy 为 `db.spatialmemory.online` 提供 HTTPS，转发到 Docker 网络内 `pgadmin:80`；pgAdmin 不映射主机端口，数据库仍只绑定 `127.0.0.1:5432`。
- `/var/lib/pgadmin` 使用 `spatial-memory_pgadmin-data` 持久卷，保存 pgAdmin 账号、连接、偏好与会话；它是管理工具配置，不是第二套业务数据库。
- 登录密码通过 Compose secret 文件提供；禁用容器内 Postfix，邮件找回当前未配置。
- 预设连接来自 [`deploy/pgadmin/servers.json`](../deploy/pgadmin/servers.json)，首次启动导入，后续部署不覆盖用户已保存的连接。
- [`provision.py`](../deploy/pgadmin/provision.py) 创建访问角色与未来表的默认授权。为防止只读角色绕过表 ACL，撤销 `public` / `auth` 中非 trigger 的 `SECURITY DEFINER` 函数的 PUBLIC 执行权限，并显式授予维护角色；现有应用角色 `spatial_memory` 的所有权及执行能力保留。
- 只读 / 维护角色各限 5 个连接，查询超时分别为 30 / 60 秒，空闲事务超时 60 秒。

## 首次部署与更新

先备份数据库、角色和现有服务器配置，再部署；`provision.py` 需要在已完成内容模型迁移的数据库上运行。

1. 将 `deploy/pgadmin/servers.json` 和 `provision.py` 上传至 `/opt/spatial-memory/pgadmin/`。
2. 在服务器执行 `python3 /opt/spatial-memory/pgadmin/provision.py`。首次生成密码，重入复用私有凭据；已有 pgAdmin 账号的登录密码不会因此被重置。
3. 将 `db.spatialmemory.online` 的 A 记录指向 `139.196.189.102`。主机 `.env` 可设置 `PGADMIN_DOMAIN`、`PGADMIN_DEFAULT_EMAIL`，默认值见 [`env.example`](../deploy/env.example)。改初始邮箱不会自动重命名已经创建的 pgAdmin 账号。
4. 本地或 CI 拉取固定版本的 `linux/amd64` 镜像，经 SSH `docker load` 导入服务器；上传 Compose、Caddy 和 pgAdmin 配置。服务器不能直接访问 Docker Hub 时沿用此方式。
5. 在 `/opt/spatial-memory` 验证 `docker compose config --quiet`，执行 `docker compose up -d --no-deps pgadmin`，再验证并重新加载 Caddy；若修改了 Caddy 容器环境变量，需要单独更新该容器。
6. 验证 HTTPS、未登录保护、实际登录、两个连接、表格查询，以及只读角色的写入拒绝。检查网站仍正常及主机内存。

[`scripts/deploy.sh`](../scripts/deploy.sh) 与 [GitHub Deploy](../.github/workflows/deploy.yml) 会同步公开配置、在服务器缺镜像时传输镜像，并要求登录 secret 已初始化；不会自动重跑角色授权或重置密码。未来新增 schema、变更对象所有者或新建带写能力的 `SECURITY DEFINER` 函数时，应同时审核和更新这些访问权限。

## 凭据、备份与恢复

- `/opt/spatial-memory/pgadmin/private/` 为 root 私有目录，`credentials.json` 权限 `0600`；登录 secret 文件归 UID 5050 所有，权限 `0400`，仅挂载给 pgAdmin。
- 数据库角色密码变更后需同步私有凭据与 pgAdmin 的已保存连接。网页登录密码在 pgAdmin 内修改；初始化 secret 不会覆盖持久卷中的现有账号。
- 业务库继续由现有 cron 每日备份。该 dump 不包含 pgAdmin 的 SQLite 配置库和角色密码；恢复角色可使用私有凭据及 `provision.py`。pgAdmin 配置卷与私有凭据需另行受控备份，不放进公开 OSS 素材桶。
- 删除或重建 pgAdmin 容器不会删除业务库；删除 `spatial-memory_pgadmin-data` 则会丢失管理界面的设置和已保存连接。不要用 `docker compose down -v` 做日常更新。

只读巡检：

```bash
ssh root@139.196.189.102 'cd /opt/spatial-memory && docker compose ps pgadmin'
ssh root@139.196.189.102 'docker stats --no-stream sanlin-pgadmin-1'
curl --head https://db.spatialmemory.online/login
```

停止入口时先移除 Caddy 中的 pgAdmin 站点配置并 reload，再停止 `pgadmin`；保留配置卷和凭据供恢复。只有确认不再使用后，才单独审核移除数据库角色。

参考：[官方容器部署](https://www.pgadmin.org/docs/pgadmin4/latest/container_deployment.html)、[表格编辑](https://www.pgadmin.org/docs/pgadmin4/latest/editgrid.html)、[线上部署总览](production-deployment.md)。
