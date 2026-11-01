# 数据层、认证与存储

应用使用 PostgreSQL + PostGIS、Kysely、Better Auth 与阿里云 OSS。内容模型和 API 见 [后端契约](team-workbench-backend-contract.md)，权限边界见 [权限说明](permissions.md)。

## 入口与事务

| 职责 | 模块 |
| --- | --- |
| SQL 与连接池 | `lib/db` |
| 服务端会话 | `lib/auth/server.ts` 的 `getSessionUser()` |
| 浏览器会话 | `lib/auth/client.ts` 的 `authClient` |
| 账号创建/删除 | `lib/auth/users.server.ts` |
| 团队管理权限 | `lib/permissions.ts`、`lib/permissions.server.ts` |
| 内容范围与能力 | `lib/content-model/access.server.ts` |
| 内容 HTTP 响应 | `lib/content-model/http.server.ts` |
| 错误记录 | `lib/log-error.ts` |
| OSS 与媒体 URL | `lib/storage/oss.ts`、`lib/storage/public-url.ts` |

只有一个具备完整权限的数据库连接，没有依靠 RLS 隔离请求。路由先获取会话，再经共享权限策略与领域服务检查归属、归档和并发锁。内容写入使用领域服务；不能只检查登录后直接按任意资源 ID 更新数据库。服务端模块带 server-only 守卫，不能导入 Client Component。

Kysely 查询失败会抛异常。复杂内容操作在 `db.transaction().execute(...)` 内完成，资源与索引必须同事务更新。内容 API 的返回与错误格式以 contracts/http helper 为准；通用管理接口以各自路由为准。

## SQL 约定

- `lib/db` 导出 db、sql、jsonArrayFrom、jsonObjectFrom。SQL 模板绑定参数，避免字符串拼接。
- 查询不存在的单条记录时 `executeTakeFirst()` 返回 undefined；需要错误时使用 `executeTakeFirstOrThrow()`。IN 查询先处理空数组。
- JSONB 写入沿用代码中的 `JSON.stringify` 约定，读取返回对象；嵌套 JSON 中时间字段是字符串。
- PostgreSQL 数组运算通过参数化 sql 模板和显式数组类型传值，避免将数组误当 SQL 值列表。
- 空间位置使用 PostGIS；读经纬度时提取 ST_X/ST_Y，距离查询显式处理 WGS84/SRID 与 geography。原始 geometry 不是可直接传给前端的坐标对象。
- count(*) 在连接层解析为 JS number。
- 数据库函数是否存在以当前 schema 和 migrations 为准，不沿用旧服务的 RPC 清单。

`db/schema.sql` 是新库基线，`db/migrations/` 是增量。统一通过 `npm run db:migrate` 执行，在开发数据库应用后用 `npm run db:codegen` 更新生成类型。升级与恢复见 [迁移手册](content-model-migration-runbook.md)。

## Auth

Server (route handlers, server components, server actions):

```ts
const user = await getSessionUser();      // null when logged out
```

Browser (`"use client"`):

```ts
import { authClient } from "@/lib/auth/client";
const { data: session, isPending } = authClient.useSession();   // session?.user
await authClient.signIn.email({ email, password });              // { data, error }
await authClient.signIn.social({ provider: "google", callbackURL: "/manage" });
await authClient.signOut();
await authClient.changePassword({ currentPassword, newPassword });
```

Calls return `{ data, error }`; `error` has `{ code, message, status }` —
codes such as `INVALID_EMAIL_OR_PASSWORD`, `USER_ALREADY_EXISTS`,
`EMAIL_NOT_VERIFIED`, `PASSWORD_TOO_SHORT`, `INVALID_TOKEN`. `lib/auth/auth-error.ts`
maps them to i18n keys.

Public registration supports Google and mainland China mobile numbers only.
`emailAndPassword.disableSignUp` blocks the email sign-up API, while password
sign-in remains enabled for existing email accounts. Password recovery is
SMS-only: the email reset request and token reset HTTP endpoints are disabled,
including previously issued tokens. The legacy `/auth/update-password` route
redirects to the phone recovery flow; there is no session-only reset action. Google
uses Better Auth's built-in provider with server-only `GOOGLE_CLIENT_ID` and
`GOOGLE_CLIENT_SECRET`; set the authorized redirect URI to
`${NEXT_PUBLIC_SITE_URL}/api/auth/callback/google` in Google Cloud Console
([provider setup](https://www.better-auth.com/docs/authentication/google)).
Missing Google credentials leave phone and existing email login available and
show a translated error when Google login is requested.

Production uses `lib/auth/google-relay.server.ts`, a Better Auth init plugin,
when `GOOGLE_RELAY_URL` is configured. It replaces only Google's token exchange,
refresh and JWKS transport with an authenticated Hong Kong FC endpoint. Google
JWT signatures, issuer, audience and expiry are verified in the web server
before profile data is accepted; state, PKCE, provider ID `google`, account
linking and session storage remain Better Auth's responsibility. Without relay
configuration the original direct Google transport is used. See
[Google relay operations](google-auth-relay.md).

Phone accounts keep the virtual-email scheme (`lib/phone-email.ts`): login is
`signIn.email` with the virtual email; sign-up / reset go through the server
actions in `lib/auth/sms.ts`, which call `lib/auth/users.server.ts` after the
SMS ticket check. Admin creation (`POST /api/users`, batch script) uses
`createUserWithPassword()`; deletion uses `deleteAuthUser()` (cascades to
`public.users` and memberships). `last_sign_in_at` lives on `public.users`
(maintained by a trigger on `auth.session`).
All phone server actions validate mainland China numbers and normalize an
optional +86 prefix to the existing 11-digit account identifier before sending
SMS, issuing/checking tickets, creating accounts or resetting passwords.

Legacy email confirmation needs SMTP (`lib/email.ts`). Google/phone registration
and SMS password recovery do not depend on SMTP.

### CLI browser sign-in

`spatial-memory auth login --provider google` opens `/auth/cli` in the system
browser. The page reuses Google sign-in and the existing
`/api/auth/callback/google` callback, then asks the signed-in user to allow the
local CLI to use their existing application permissions. Google cancellation
returns to this page. No additional Google client credentials or callback
registration are required.

`lib/auth/cli-login.server.ts` is a Better Auth plugin. Its authenticated
`POST /api/auth/cli/authorize` issues a 120-second single-use code, storing its
hash and the user/PKCE challenge/loopback binding in `auth.verification`.
`POST /api/auth/cli/exchange` verifies the code and S256 proof, atomically consumes
the grant, creates an independent session and sets the normal signed application
cookies. It never returns the browser session or Google tokens. No new tables,
Bearer authentication, CORS rules or trusted origins are needed.

The CLI listens only on `127.0.0.1` at a random nonprivileged port with the fixed
`/callback` path, verifies a random state, and exchanges the code directly with
the configured service. Redirect URI validation rejects other hosts, paths,
credentials, queries and fragments. Browser authorization requires a same-origin
request and a valid session. The CLI uses HTTPS except for local development,
keeps the verifier in memory, and saves cookies only after checking the resulting
identity through `/api/users/me`. Denial, timeout and interruption preserve any
previous CLI session. `auth logout` revokes the CLI session independently of the
browser. This follows the external-browser and PKCE approach in
[RFC 8252](https://www.rfc-editor.org/rfc/rfc8252).


## 存储

素材文件由 `asset_resource` 保存受管 storage_key 或外站 external_url；payload 也可能包含链接。通过 `lib/assets/urls.ts` 与 `lib/storage/public-url.ts` 生成和识别公开 URL。文件路径不是团队所有权依据。

`NEXT_PUBLIC_MEDIA_BASE_URL` 影响 URL 生成和受管资源识别。更换域名时同时核对存量完整 URL、payload、参考图、客户端构建和外部访问配置，不能只改环境变量就假定全部旧引用已迁移。

上传路由返回绑定调用者与团队的回执；素材提交使用回执或经授权的当前素材资源。物理删除统一走保留层，详见 [素材流水线](asset-pipeline.md) 与 [文件生命周期](asset-storage-lifecycle.md)。
