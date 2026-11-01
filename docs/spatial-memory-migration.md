# Spatial Memory 生产身份迁移

日期：2026-11-01（北京时间）。本文件随部署更新；准备阶段的检查不能代替最终上线验收。

## 切换前已完成

- 首份数据库备份在隔离 PostGIS 17 副本完整恢复并执行手机号迁移。45 个原生产手机号账号待切换，验证用隔离账号另计。
- 手机号迁移保留账号、凭据、会话及成员关系；冲突、异常邮箱格式或同步失败回滚。真实数据库回归已接入 CI。
- 媒体迁移副本审计覆盖 31 张 public/auth 表及 92 个字符串字段；仅 8 条 anchor_embedding.image_url 需要更新。执行前后规范化内容 SHA256 和计数一致。历史归档不改。
- 新 OSS 桶完整复制并核对 12,214 个媒体对象（3,135,635,076 字节）和 33 个备份对象（84,743,057 字节），key/size/ETag/元数据/ACL/tags 一致；媒体 CORS 保留 ResponseVary，备份为私有、db/ 保留 30 天。
- RAM 用户原地改为 spatial-memory-app，UserId 与 AccessKey 不变；新策略只把原桶权限映射到新桶。旧策略在停止旧写入并验证新备份后解除。
- 新香港函数已创建，运行配置和代码校验值与原函数一致，保留相同 OAuth client 与 relay secret；未认证请求 401，公钥请求 200，无效授权码得到 Google 400 invalid_grant。真实个人 Google 授权不在自动验收范围。

## 顺序与恢复材料

服务器恢复目录：`/opt/spatial-memory-migration/20261101`（root 私有）。`preflight.dump`、`deploy-config.tgz` 为在线预备备份；停写后再生成 `final.dump`、`final-globals.sql`、`final-config.tgz`、`final.sha256`。本地受忽略目录保存副本及对象清单、配置和校验报告，密钥与备份不得入库。

1. 停止 app/pgAdmin，确认无剩余业务连接，做最终备份并复核 OSS 增量。
2. 停止旧 Compose/SAGE，冷复制四个持久卷到 spatial-memory 项目，移动部署目录；旧卷保持不变供回滚。新网络固定 172.18.0.0/16、网关 172.18.0.1，保持 SAGE 监听地址。
3. 临时本地维护角色执行数据库与三角色原地改名后删除自身。保留角色 OID、所有权、ACL 与已核验的 SCRAM 密码。原地更新 pgAdmin 保存连接和私有用户名，保留登录与加密密码。
4. 修改 SAGE systemd/虚拟环境绝对路径、服务器环境与备份 cron；仅启动数据库和 SAGE。
5. 通过 SSH 隧道运行 `npm run db:migrate`，然后运行媒体迁移脚本并保存证据；只读部署门禁通过后发布匹配镜像。
6. 验证账号登录、内容读写与乐观锁、媒体、CLI、小程序 API、pgAdmin、SAGE 就绪和真实离机备份，再记录开放流量时间。

`rollback.sh` 为服务器可执行恢复入口：停止新栈，恢复最终配置、旧卷、旧镜像和 SAGE/cron。开放新流量后该脚本会拒绝直接回退数据库，必须先备份并协调新写入，避免静默丢失切换后的数据。新旧卷不是同时运行的数据库。

一次性媒体迁移默认只读，执行前复制并验证对象、停止所有写入：

```sh
DATABASE_URL=... node --import tsx scripts/migrate/spatial-memory-media.ts \
  --source-origin https://sanlinlaojie-media.oss-cn-shanghai.aliyuncs.com \
  --source-origin http://sanlinlaojie-media.oss-cn-shanghai.aliyuncs.com \
  --target-origin https://spatial-memory-media.oss-cn-shanghai.aliyuncs.com --execute
```

## 微信发布边界

小程序代码已推送至 1f221f8，支持 schema 4/5/7/8。开发者工具登录已过期且扫码窗口关闭；用户随后明确选择先完成 Web、微信稍后处理。没有声称已上传、审核或正式发布。现有 IP API 入口继续提供服务，实际合法域名白名单未经微信平台重新核实。
