# 权限体系

团队（数据库中的 organization）是内容所有权与权限边界。所有团队成员可读取团队的素材、场景和地图合集；服务端重新校验每次操作，UI 的 capabilities 只用于表达权限。

## 角色与操作

全局角色保存在 `public.users.role`，团队角色保存在 `organization_member.role`。全局 `super_admin` 绕过团队成员角色限制；团队和资源的归档规则仍由业务服务执行。

| 操作 | owner | admin | member | viewer |
| --- | :---: | :---: | :---: | :---: |
| 读取团队内容和合集 | ✓ | ✓ | ✓ | ✓ |
| 创建、编辑、归档/恢复素材与场景 | ✓ | ✓ | ✓ | — |
| 创建、编辑、归档/恢复合集和管理投放 | ✓ | ✓ | ✓ | — |
| 修改维护人信息 | ✓ | ✓ | — | — |
| 查看成员列表 | ✓ | ✓ | ✓ | — |
| 添加成员、邀请、修改/移除非 owner 成员 | ✓ | ✓ | — | — |
| 添加、修改或移除 owner | ✓ | — | — | — |
| 修改团队设置、删除团队 | ✓ | — | — | — |

权限键及全局管理权限以 [lib/permissions.ts](../lib/permissions.ts) 为准。素材的 `visibility`、`maintained_by`、来源合集、创建者和 OSS 路径都是元数据，不能代替团队归属。合集不维护独立成员授权。

## 服务端边界

- `lib/permissions.server.ts` 为团队管理接口加载用户上下文。
- `lib/content-model/access.server.ts` 检查内容范围、成员身份和归档状态；素材、Scene 和 Placement 的变更走对应领域服务。
- 未登录、无权限和不存在的资源按路由契约返回错误；不能假设所有越权读取都统一返回 404。
- 写入中的组织/资源锁防止归档与编辑交错，`expectedLockVersion` 防止并发覆盖。计数器不代表历史内容版本。
- DTO 的能力由同一套服务端规则计算。具体能力字段见 [contracts.ts](../lib/content-model/contracts.ts)，请求与路由见 [后端契约](team-workbench-backend-contract.md)。

## 归档与公开访问

- 已归档素材和场景不能编辑或新增引用；既有场景引用和投放继续解析其保存内容。
- 合集归档后停止公开发现，合集内投放只读；团队素材、场景不因此归档。
- 团队归档后停止该团队公开内容与内容写入。归档不会直接删除 OSS 文件。
- 地图发现读取 active 投放；Scene 二维码还允许直接预览未归档场景，无需合集。匹配点参考图状态接口也有明确的公开边界，见 [匹配点说明](anchor-matching.md)。
- OSS 媒体使用公开 URL；管理 API 的团队权限不等于文件字节保密。

## 注册与邀请

注册方式见 [数据层与认证](data-layer.md)。新用户由 `handle_new_user()` 创建 `users`、个人团队和 owner 成员关系，不创建默认合集。

owner/admin 可在团队成员页面搜索已有用户直接添加，或生成邀请链接。邀请角色仅允许 admin/member/viewer；链接不能授予 owner。接受邀请会幂等加入团队，校验过期与撤销状态；可选 `workspace_id` 只作为加入后的跳转目标，不创建项目授权。

接口为 `/api/organizations/[id]/members`、`/api/organizations/[id]/invitations`、`/api/invitations/[token]` 和 `/api/users/search`。成员接口额外保护 owner，admin 不能修改或移除 owner，也不能将成员提升为 owner。

## 导航

`/admin/settings` 需要 `org.settings`，`/admin/members` 需要 `org.members.view`。合集统一在 `/manage/collections` 管理。菜单可见性以 `SIDEBAR_VISIBILITY` 为准，客户端隐藏入口不能替代服务端授权。
