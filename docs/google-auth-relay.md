# Google 登录香港中转

## 生产配置

- 地域：阿里云函数计算 3.0 `cn-hongkong`。
- 函数：`spatial-memory-google-oauth-relay`，Node.js 20，128 MiB，0.05 vCPU，15 秒超时；按需实例，无常驻预留实例，`reservedConcurrency=2` 限制扩容上限。
- HTTP 触发器：`authenticated-http`，地址 `https://spatialth-relay-vsuiocyxbq.cn-hongkong.fcapp.run`。
- 触发器由函数校验独立 Bearer 密钥。仅支持 `GET /jwks`、`POST /token`，不能指定上游 URL。
- 函数源代码：[index.mjs](../deploy/google-auth-relay/index.mjs)、[google.mjs](../deploy/google-auth-relay/google.mjs)。
- 网站插件：[google-relay.server.ts](../lib/auth/google-relay.server.ts)。插件只替换 Google 传输方法，不修改全局 fetch。

Google 回调保持 `https://www.spatialmemory.online/api/auth/callback/google`。
用户浏览器直接访问 Google 授权页；网站处理回调，向香港函数交换令牌并获取公钥，在上海验证 Google 签名、issuer、audience、有效期后创建或关联账号。
函数没有业务数据库、OSS 或短信权限，也不记录请求正文、授权码、令牌或密钥。

## 密钥与更新

网站 `/opt/spatial-memory/.env`：`GOOGLE_RELAY_URL`、`GOOGLE_RELAY_SECRET`，并保留已有 Google client ID / secret。
函数环境变量：相同的 `GOOGLE_RELAY_SECRET`、`GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`、精确匹配的 `GOOGLE_REDIRECT_URI`。
这些配置均不提交 Git，调用密钥不放入浏览器包。

部署脚本使用独立私有 JSON 文件，字段为 `accessKeyId`、`accessKeySecret`、可选 `securityToken` 和上述 `environmentVariables` 对象：

```sh
node scripts/deploy-google-auth-relay.mjs /absolute/private/config.json
```

脚本将函数目录打包，创建或更新目标函数、HTTP 触发器及并发上限。部署身份只应获准操作这一函数；它与网站现有 RAM 用户分开，完成临时部署后撤销凭据。
FC 源码变更需要运行此脚本，Web 的 GitHub Actions 不会自动发布 FC。
修改调用密钥时，需要同时更新函数与网站配置并重建应用容器；只更新一端会导致 Google 登录失败。

## 验证与故障处理

```sh
node --test scripts/test-sms-auth.cjs
node --import tsx --conditions react-server --test scripts/test-google-relay-function.mjs scripts/test-google-relay.mjs
```

测试使用隔离内存数据库和自行生成的测试签名密钥，覆盖新用户注册、存量已验证邮箱关联、未验证邮箱拒绝关联、PKCE、令牌验签与超时失败。
网络冒烟从上海应用容器执行：无密钥请求必须返回 401；正确密钥请求 `/jwks` 必须得到 Google 公钥；无效授权码请求 `/token` 得到上游 Google 400 表示网络与接口可达，不代表真实用户登录成功。
只有用户完成一次真实 Google 授权并在网站获得登录会话，才是完整线上账号验收；自动化冒烟不会代替用户授权。

如果中转故障，Google 登录失败并返回登录页，手机号和存量邮箱密码流程不依赖中转。
移除 `GOOGLE_RELAY_URL` 可恢复直连逻辑，但上海网络仍无法直连 Google，不应把此操作视为可用性修复。
网站可回滚至发布前镜像；函数支持从 Git 历史打包上一版代码重新部署。回滚不会迁移或清空用户数据库。
