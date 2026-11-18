# 素材与文件保留生命周期

本文描述 `lib/storage/retention.server.ts`、`lib/upload/receipts.server.ts` 和 `lib/assets/content.server.ts` 的当前协议。数据模型见 [数据层](data-layer.md)，上传入口见 [Asset Pipeline](asset-pipeline.md)。

## 素材与文件

Asset 属于团队，当前内容在 `asset.payload`，当前文件清单在 `asset_resource`。主文件、封面等分别登记 role。店铺活动的图片与奖励图引用普通图片 Asset，活动点引用也计入素材使用记录。多个素材可以引用同一个物理 key，不能因为 hash 相同就合并业务身份。

- 素材直接修改，场景和投放通过 asset ID 解析最新内容，没有素材版本或发布快照。
- 替换媒体使用新的受管 key，不原地覆盖对象字节；业务事务提交后才尝试回收旧文件。
- 本站 OSS URL 必须识别为受管文件，提交时使用上传回执或有权限的 `fromAssetId` 资源引用。
- 外站文件只保存 URL，无法保证远端字节不变，不进入 OSS 删除流程。
- 归档 Asset、Scene 或 Placement 不物理删除其文件；引用约束仍然有效。

官方模板的手动封面单独记录在 `template_preview`。保存时验证上传回执的用户、团队、类型和有效期，并锁定对象；即时回收和全局清扫均保留这些文件。替换或移除封面后，旧文件重新参与引用检查。

## 上传回执与团队内去重

上传按处理后的最终字节计算 SHA-256。去重以团队为范围，来源为有权使用的当前素材资源和有效上传回执。物理路径可能仍为首位上传者的 `assets/{userId}/…`，路径不代表素材所有权，删除用户不能按目录删除团队文件。

`upload_receipt` 绑定 user、organization、workspace、storage_key、hash、大小、用途和过期时间。素材提交校验操作者、团队、有效期及 `asset` 用途。回执有效期为 24 小时；`consumed_at` 记录提交，不代表文件可以删除。回执也保护上传完成但业务事务尚未提交的文件。

## 全局保留集合

`isKeyProtected` 检查单个 key，`collectProtectedKeys` 为清扫过滤候选，范围始终覆盖所有团队：

| 来源 | 必须保留的内容 |
| --- | --- |
| `asset_resource` | 所有当前素材引用的 storage_key |
| `asset.payload` | 内容中仍然引用的受管文件 |
| `activity_record` | 留言正文及记录元数据中仍然引用的受管文件 |
| `upload_receipt` | 未过期的上传租约 |
| `anchor_embedding` | 当前识别参考图 image_url |
| `storage_hold` | 数据迁移归档中独有的文件 |
| 音频派生文件 | 同名 `.webm` / `.m4a` 互相保护 |

物理删除默认关闭；仅当 `app_config.managed_object_deletion` 明确为 `{ "enabled": true }` 时，回收器才删除无引用对象，否则只报告候选。迁移不会自动开启删除，也不删除 OSS 对象。

## 回收协议

复用、素材提交和回收遵循相同协议：

1. 在事务中取得 `object-key:<storageKey>` advisory lock。
2. 复用或提交方在锁内建立回执或资源引用；回收方在锁内重新检查全部保留来源和上传租约。
3. 回收方保持锁直到 OSS 删除结束，避免检查与删除之间出现新的引用。
4. 存储错误记录为失败，不能当作对象不存在。

逻辑修改先提交，再尝试释放不再保留的文件。上传补偿、管理员清扫、用户/团队删除等入口都必须经过统一保留层。硬删除先生成完整删除计划，核对场景、投放、素材与文件依赖。

`migration_archive` 保存升级前数据，不参与运行时查询；其独有文件由 `storage_hold` 保护。它与可恢复的数据库备份均不是应该随手清除的缓存。清理归档或解除保留需另行确定恢复需求。

## 代码入口

| 模块 | 职责 |
| --- | --- |
| `lib/storage/retention.server.ts` | 全局保留、对象锁、删除开关、候选报告 |
| `lib/upload/receipts.server.ts` | 回执、团队内去重、提交身份校验 |
| `lib/assets/content.server.ts` | 直接更新当前内容与资源清单 |
| `app/api/admin/clean/route.ts` | 管理员检查和清扫 |
| `lib/user-deletion.server.ts` | 用户/团队删除预览与执行 |
