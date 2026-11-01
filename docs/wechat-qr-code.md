# 微信二维码

地图合集和 Scene 共享 `lib/wechat-qr.server.ts` 的 access_token 缓存、WeChat `getwxacode` 调用和 OSS 图片缓存。`app/manage/actions/wechat-qr.ts` 检查登录及团队访问权限，`components/wechat-qr-button.tsx` 负责加载、错误和重试展示。

- 团队：`pages/index/index?organizationId=…`。
- 合集：`pages/index/index?organizationId=…&workspaceId=…`，原 workspace UUID 和已有二维码保持有效。
- 场景：`pages/index/index?organizationId=…&sceneId=…`，首页缓存最近入口后打开 `pages/scene/scene`，系统返回键可回到选择页。

图片存放于 `wechat-qrcodes/<环境>/`，二维码缓存不在 PostgreSQL。合集使用 `org__workspace.png`，场景使用 `scenes/org__scene.png`。三个版本都复用后端 OSS 缓存；正式版图片的浏览器缓存为一年，体验版和开发版图片使用 `no-store`，避免调试时清理 OSS 后浏览器仍显示旧图。播放接口始终 `no-store`，每次打开读取最近保存的数据。场景归档或团队归档后，已有二维码也不能继续直接预览。

二维码版本在 `/admin/settings` 的「微信二维码」中切换，可选 `release`（正式版，默认）、`trial`（体验版）、`develop`（开发版）。修改立即生效，无需保存团队设置或重启 Web 服务。选择仅保存在当前浏览器的 `localStorage`（`spatial-memory.wechat-qr.environment`），对该站点的所有团队生效，也会同步到已经打开的场景、地图编辑标签页；不写入数据库，不影响其他浏览器。

前端每次请求二维码时传入 `environment`。服务端校验版本、登录和团队访问权限后，使用同一版本构造 OSS 缓存键和微信请求的 `env_version`。切换版本不会清缓存，切回时继续复用该版本的已有二维码。二维码弹窗显示当前版本；版本变化时关闭旧弹窗，避免展示旧版本二维码。

环境变量仅需 `WECHAT_APPID`、`WECHAT_APPSECRET` 和 OSS 配置，二维码版本不再由环境变量控制。

本地 Scene 不能通过正式版客户端访问本地数据库。扫码用到的小程序开发版也需包含当前代码；生成二维码不会自动编译或上传小程序。

接口测试覆盖生成权限、缓存键、参数长度、跨团队拒绝、最新保存内容和归档失效。

`node --import tsx --conditions react-server scripts/test-wechat-qr.ts` 验证同一服务进程内三个版本的请求、扫码参数、缓存隔离、切回复用及清缓存重建，不请求真实微信或 OSS。
