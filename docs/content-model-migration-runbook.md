# 单一内容模型迁移

本文保留仍在使用的升级、数据保留和恢复步骤。部署流程见 [线上部署说明](production-deployment.md)；历史演练结果不代表目标环境已完成迁移。

当前应用只运行团队素材、场景和地图合集模型。`npm run db:migrate` 按迁移账本逐项执行，每项在独立事务内转换数据并移除旧结构，不再按组织选择模型，不需要请求头、激活接口或灰度开关。

## 数据转换

- 原 `workspace` 保留 UUID、名称、团队、标签和二维码上下文，成为地图合集。团队拥有素材和场景，合集只拥有投放。
- 第一项迁移将旧素材和场景转换为团队内容，跨团队来源拆成独立素材，同团队跨合集使用独立投放。GPS、高度、标签和展示参数跟随投放迁移。
- `20261017220000_mutable_assets.sql` 随后将每个素材的 `current_version_id` 对应内容和文件合并到 `asset.payload` 与 `asset_resource`。地图投放、草稿及已发布场景统一通过 asset ID 使用当前内容，即使原来固定的是更早版本。
- 在 mutable-assets 这一中间步骤，草稿和发布布局转为 schema 4，删除 `assetVersionId`；布局本身、发布 ID、投放 ID 不变。不再保留运行时版本表、版本指针或切换逻辑。
- 匹配特征只保留当前参考图的数据，未完成任务标记为失败，特征主键改为 asset ID。后续替换参考图会清除旧特征。
- 迁移前完整内容保存在 `migration_archive.mutable_asset_source`；不再被当前素材使用的历史托管文件加入 `storage_hold`。这些归档只用于恢复，运行时不读取；迁移不删除物理文件。
- 缺少有效当前版本的素材会使本项迁移整体失败。原始无归属、无效场景等问题仍必须在第一项迁移前修复或明确隔离。
- workspace 成员授权、素材使用授权、旧公开 ID 映射、共享 scope、旧写入函数和模型状态均已移除。

## 执行

1. 对目标数据库做完整备份，并先在副本运行迁移。停止旧应用写入；本次升级包含删列和删表，旧应用不能继续连接升级后的库。
2. 使用目标数据库的 `DATABASE_URL` 和实际 `NEXT_PUBLIC_MEDIA_BASE_URL` 执行 `npm run db:migrate`。迁移不会上传或删除 OSS 文件。升级入口只有 `db:migrate`，分阶段切换和回切脚本已移除。
3. 检查迁移账本、合集数量、各合集投放、素材直接引用、资源清单及隔离归档。
4. 执行只读部署门禁：`node scripts/db/deployment-check.mjs | psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1`。手动部署与 GitHub 部署都会运行同一检查；未完成迁移会阻止部署，不会替你升级数据库。
5. 部署与该结构匹配的应用，并验证团队素材创建、场景保存、合集投放、小程序发现、二维码和匹配点。新库直接使用 `db/schema.sql` 的最终结构。

迁移器持有数据库级迁移锁，并为每项迁移在同一事务内执行数据转换和 DDL。失败会回滚当前迁移；已完成的迁移由 `schema_migrations` 跳过。成功之后需要回退时，应停写并恢复升级前备份及对应应用版本，不能重新启用旧模型写入。

## 验证脚本

`test-single-content-model-migration.ts` 使用 `scripts/test-support/pre-single-content-model.sql` 作为升级前快照，要求 127.0.0.1:55439 上全新的 `content_single_migration` 专用数据库。它验证失败回滚、跨团队拆分、合集独立投放、中间态场景固定引用、标签（含 Anchor）、高度、资源、逐条审核隔离、过期审核拒绝、失败时审核记录回滚和旧结构移除。后续 mutable-assets、mutable-scenes 与 transform 迁移继续转换为当前模型，分别由对应测试覆盖。

`test-content-model-services.ts`、`test-team-workbench-routes.ts`、`test-upload-dedup.ts` 和 `test-activities.ts` 通过 `npm run test:integration` 验证当前服务。CI 统一使用 127.0.0.1:55439 的 `content_services` 专用库；允许的测试库名见 `scripts/test-content-model-services-fixture.ts`。测试不连接生产存储。


`test-mutable-assets-migration.ts` 使用迁移前快照，在全新的 `content_mutable_migration`（127.0.0.1:55439）验证当前内容选择、旧版本引用转换、合集与投放 ID 保留、历史文件保护、识别特征迁移、失败回滚和账本重入。最终服务测试使用上文的 `content_services`；`content_mutable` 仍是 fixture 允许的历史测试库名，不是当前 CI 的默认库。

## Scene 保存即生效（20261018000000）

在 mutable-assets 之后执行 mutable-scenes：`scene.draft_document` 改名为 `document`，保留最近保存的内容；所有状态的投放由发布版本解析到 scene_id。位置、标签、展示配置、投放 ID 和锁不变。旧场景、发布内容、发布依赖和场景投放先写入 `migration_archive.mutable_scene_source`，再移除 scene_revision、scene_revision_asset_ref 及投放版本字段。没有运行时兼容分支，也不自动执行旧发布操作。

`test-mutable-scenes-migration.ts` 在全新的 127.0.0.1:55439/content_scene_migration 验证保存内容优先、各状态投放、回滚、归档证据、租户外键和清理；新库基线另行验证。升级需协调 Web 与小程序版本，目标环境遵循上方停写、备份和验证流程。

## 无归属素材的逐条审核

旧数据若引用已删除的 workspace，迁移默认中止，不能猜测团队所有权。先在完整备份副本运行 `scripts/migrate/content-model/audit.ts`，核对孤立记录；审核文件必须放在仓库外并限制读取权限：

```json
{
  "format": "content-model-orphan-review-v1",
  "assets": [{
    "assetId": "原素材 UUID",
    "sourceHash": "audit 输出该条 mapping.source_hash 的 64 位 SHA-256",
    "reason": "逐条核实的原因及归档决定"
  }]
}
```

使用 `npm run db:migrate -- --archive-review /private/path/orphan-review.json` 执行。只有没有有效 workspace、没有已转换内容且没有其他数据错误的素材可以这样归档；有归属素材、格式错误、重复 ID 或源数据指纹变化都会中止。新发现的孤立记录也不会被自动忽略。审核写入与内容转换处于同一事务，后续转换失败时一并回滚。

归档保留完整旧行和审核原因；独有文件进入 `storage_hold`。运行时不创建虚假的团队或素材，不增加兼容分支。升级后重复运行由账本跳过，不重复归档。

2026-10-19 的线上副本有 4 条此类记录，逐条审核文件在工作区父目录 `.local-db-backups/premerge-20261019/orphan-review.json`。正式停写后必须重新备份和核对，不能将本次副本结果当作线上数据永不变化的保证。

## Anchor 标签恢复（20261019000000）

独立增量迁移从 `migration_archive.content_model_source` 恢复此前遗漏的 Anchor 地图标签。仅作用于确定的迁移生成投放 ID，且要求投放 `lock_version=1`；已编辑投放和已删除标签不受影响。新库没有归档，此步为空操作。已升级的开发库仍应按正常账本补跑这一项，不要修改或重跑旧迁移。

## 自动验证

GitHub 的可复用质量检查会启动一次性 PostGIS，验证空库初始化、重复运行、部署门禁、三段升级、回滚和数据保留。`test-deployment-check.ts` 还会确认缺少账本、漏迁移、账本与结构不一致、残留旧版本表均被拒绝。CI 不读取真实数据库或备份。

## Scene 变换文档迁移

`20261018000000_mutable_scenes.sql` 将历史 scene_revision 引用转为 scene_id，保留当前文档与投放参数，归档旧发布数据后移除运行时版本表。

旧 schema 4/5 由 `scripts/migrate/transform-scenes.ts` 转为 schema 6；旧 Theatre 原生静态覆盖、数值轨道、Bezier handles、hold 与多圈旋转在这里一次性展开到实例。旧格式只存在于迁移代码、历史采样 fixture 和归档中。

运行标准 `npm run db:migrate`：`20261020000000_transform_scenes.sql` 前会在同一迁移事务中调用 `migrateTransformScenes`，把原文和旧锁存入 `migration_archive.transform_scene_source`，转换并校验后增加 `lock_version`，最后加 schema 6 约束。已经是 schema 6 的文档跳过转换。不要单独执行 SQL 跳过 TypeScript 迁移。更早的 `20261019000000_native_theatre_scenes.sql` 仅保留为顺序迁移历史。

`scripts/test-transform-migration.ts` 需要本机 55432/sanlin 及已存在的 transform_scene_source 归档样本，在事务内还原样本、验证转换后回滚。它不是可在任意空库运行的测试；服务/路由测试则使用 55439 上脚本允许的专用库，不能混用。

## 历史恢复资料的位置

工作区父目录的 `.local-db-backups/v2-cutover-20261017-381beb17/` 保存早期本地转换的前后 dump、审核、身份映射及恢复记录；`.local-db-backups/premerge-20261019/` 保存当时生产副本、逐条审核和演练证据。旧记录中的数量、版本与环境状态仅代表其时点。

这些恢复资料不属于文档清理对象。恢复时先校验备份、确认所需源记录及对应代码版本；孤立素材只能在审核归属后恢复，不能按存储路径猜测团队。已升级且继续写入的数据库不可直接覆盖为旧快照，需先保存新增数据并制定恢复或前向修复步骤。
