# 活动模型迁移与发布

`20261028000000_independent_activities.sql` 将店铺打卡、经确认的用户留言迁移到独立活动模型；后续 `20261028010000_activity_owned_locations.sql` 将地点与参与规则归入活动内容，投放只保留地图关联和状态。Web、数据库和小程序必须协同切换到新架构；升级后不保留旧 `/shops`、`/text-assets` 接口或旧活动开关。生产迁移与应用部署是两个单独操作。

## 第一阶段：独立活动转换规则

- 团队拥有活动；活动包含多个打卡点；同一活动可投放到多个地图。第一阶段暂存各投放中的点坐标与启停，第二阶段将其归并为活动的固定地点与点状态。活动记录与 Asset、普通 Placement 分开。
- 历史 shop 按地图分组：一个地图中的店铺组成一场打卡活动及一次活动投放。跨地图复用的旧 shop 图片可以继续共享，但历史地图各自的打卡点归属被保留。未投放 shop 按团队组成“未投放店铺打卡”活动。
- 旧 shop Placement UUID 在第一阶段保留为点投放 UUID；第二阶段删除点投放表，旧 ID 及其坐标、时间、原状态、标签和展示配置在迁移归档中保留。完整原始 shop 行存入 `migration_archive.activity_source`，供核对和恢复；不作为旧接口兼容机制。
- 店铺主图保留原 Asset UUID，转为普通 image Asset；打卡图转为独立 image Asset 并引用原文件。没有主图的点允许无图片。迁移不上传、覆盖或删除 OSS 对象。
- 旧 `shop_checkin_enabled=true` 对应活动投放 active，其他值对应 paused；随后移除组织中的旧开关。地图、团队归档状态继续阻止公开访问。
- `origin=public_submission` 或匹配团队的 `placement.public_text` 审计证据可证明是用户留言。其他 `origin=legacy` 文字必须通过逐条、源指纹绑定的审核决定迁移或保留；不根据文字内容、固定投稿账号或没有标题来猜测。
- 确认迁移的留言保留旧 Placement UUID、正文、位置、创建时间和展示配置。旧 active 投放变为 visible 记录；其他状态保留为 hidden。仅有来源地图而无投放的留言保留为 hidden 记录。只有存在实际待迁移留言的地图才创建弹幕活动，不为空地图自动添加活动。
- 普通文字 Asset 及其地图投放不受影响。旧手机本地的打卡缓存不是服务端记录，迁移不能补造历史参与人或打卡记录。

## 第二阶段：固定地点与地图关联

打卡点的坐标迁入 `activity_point.location`，整体参与区域迁入 `activity.location/radius_meters`，有效规则归并到 `activity.config`。投放删除位置、范围和配置字段，`activity_point_placement` 表移除。活动、打卡点、活动投放和参与记录的既有 ID 保留，记录继续按活动投放隔离。相同活动与地图只能有一条关联，归档后通过恢复原关联继续使用。

迁移前先在完成第一阶段的备份副本中执行只读检查：

```bash
DATABASE_URL=... node --import tsx scripts/db/activity-location-preflight.ts --output /private/path/activity-locations.json
```

报告以 0600 权限保存，包含冲突的活动、点及来源投放。迁移事务会重新检查相同规则：同一点多个不同非空坐标、不同有效参与规则、不同范围、点启停不一致、不完整范围，或同活动同地图重复关联，均中止并整体回滚。不能任意挑选一份坐标、扩大范围或合并参与记录；有冲突时先确定目标内容并更新备份副本中的源数据再演练。

空位置与唯一非空点位置合并时保留非空位置；已投放活动中所有关联均停用的点转为归档，未投放活动的点状态保持原样。所有涉及的旧活动、点、投放和点投放行完整保存于 `migration_archive.activity_location_source`，参与记录与普通素材不改写。`db:migrate` 按序执行两阶段，已完成第一阶段的数据库只执行待办的第二阶段；不得修改已执行的旧迁移。

## 2026-11-15：单地图关联与两种启停状态

`20261115000000_single_activity_map.sql` 将旧草稿转为暂停，并递增投放的并发版本。新关联默认暂停，关联后只提供开启、暂停；取消关联仍以内部 `archived` 状态保留原投放与参与记录。每个活动最多一条未取消的地图关联，暂停也占用名额。

迁移前可只读检查尚未取消的重复关联：

```sql
select activity_id, array_agg(workspace_id order by workspace_id) as workspace_ids
from activity_placement where status <> 'archived'
group by activity_id having count(*) > 1;
```

有冲突时，迁移列出活动和地图 ID 并整体回滚本次迁移；先由活动负责人确定保留地图，通过原版本管理页取消其他关联，再重试。不能自动选择某张地图或删除历史记录。先在备份副本完成升级验证，再在停写窗口按生产部署流程执行迁移并发布 Web。公开活动接口字段不变，小程序无需为本次限制同步改码。

记录中的 `organization_id` 与 `placement_id` 保留数据产生时的团队与地图来源；更换地图创建另一条投放，重新关联同一地图恢复原投放 ID 与打卡进度。同一地图多次关联不划分独立批次，也不保存组织或地图名称快照。当前活动不能跨团队关联地图。

## 迁移前审核

在与生产相同版本的完整备份副本上进行演练，显式传入该副本的 `DATABASE_URL`。已有迁移先按账本完成；活动迁移若发现未审核文字会中止，不会提交活动表或转换结果。

```bash
DATABASE_URL=... npm run db:migrate
DATABASE_URL=... node --import tsx scripts/db/activity-preflight.ts --output /private/path/activity-audit.json
```

preflight 使用只读事务，将完整文字、关联投放和资源证据写入新的私有文件（默认权限 0600，拒绝覆盖）；控制台只输出计数。不要将报告或审核文件提交到 Git、公开工单或日志。

对于报告中 `classification=review_required` 的每一条文字，审核文件使用：

```json
{
  "format": "activity-text-review-v1",
  "assets": [{
    "assetId": "原文字素材 UUID",
    "sourceHash": "报告中该条 sourceHash 的 64 位 SHA-256",
    "decision": "keep",
    "reason": "核对来源后保留为地图上的普通文字素材"
  }]
}
```

`decision=migrate` 表示迁为留言活动记录，`keep` 表示原素材及投放保留。审核必须覆盖所有模糊来源文字。源内容、归属、投放、资源、标签或场景引用改变后，旧审核指纹失效，需重新核对；不能批量重填新指纹而不检查变化。明确来源的用户留言不接受 `keep` 覆盖。

已确认要迁移的文字如果带媒体、场景引用、作为匹配点被引用，或没有有效目标地图，迁移会中止，需要先核对修复，不会静默删除依赖。

## 正式切换

1. 准备通过验证的新 Web 构建和新小程序版本，安排停写窗口。停止旧 Web 的全部写入和后台任务，并阻止旧小程序继续访问旧写接口。
2. 在停写后对生产做新的完整数据库备份，并验证备份可恢复。保存原应用版本、实际媒体域名与迁移前计数；不要把本地历史演练报告当作生产当前状态。
3. 使用最终备份再运行 preflight。与已审核副本比对；出现新增或改变的模糊来源文字时重新审核。确认 `NEXT_PUBLIC_MEDIA_BASE_URL` 是目标环境真实值，使源 payload 中的本站文件引用也进入文件保留清单。
4. 对明确的目标数据库执行：

   ```bash
   DATABASE_URL=... NEXT_PUBLIC_MEDIA_BASE_URL=... npm run db:migrate -- --activity-review /private/path/activity-review.json
   ```

5. 核对迁移账本、活动/点/投放/记录数量、旧地图与非活动内容的指纹、图片和奖励图的文件引用。执行只读部署门禁：

   ```bash
   node scripts/db/deployment-check.mjs | psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1
   ```

6. 部署新 Web 并发布新小程序，验证活动管理、跨地图复用、投放启停、留言提交/隐藏、打卡进度和地图入口。确认新客户端使用活动接口后恢复访问与写入。

迁移器持有全库迁移锁；本项迁移中的源行锁、审核、归档、数据转换、DDL 和账本写入处于同一事务。失败时本项整体回滚，修复后可重试；已提交的前置迁移不随本项回滚。成功后重复执行由账本跳过。

## 恢复与文件保留

迁移成功后不能只回滚 Web 或重新开放旧写接口。需要回退时再次停写，先导出升级后新增的活动数据以备人工处理，再将完整数据库恢复到切换前备份，并恢复对应旧 Web/小程序版本。迁移归档用于追溯，不是可在新旧应用之间混用的运行时数据源，也不代替完整备份。

所有迁移涉及的原资源及可识别的源 payload 文件进入 `storage_hold`。新活动通过普通图片 Asset 引用文件，继续使用统一的资源保留与对象锁机制。不要在本次切换中清理 `migration_archive`、解除保留或启用 OSS 物理删除。

## 2026-10-28 第一阶段：本地生产备份演练

最终演练重新使用 `.local-db-backups/release-20261028/pre-migrate-eb349a9.dump` 还原到独立的 `127.0.0.1:55439/content_activity_production_rehearsal_final`，生产数据库未被修改。用户明确确认：该备份的 **899 条历史文字全部作为地图上的普通 Asset 保留**，不迁成弹幕。逐条审核文件记录了这 899 条的精确源指纹与确认理由，最终副本重新核对后全部一致。

演练结果：11 个 shop 转为 1 场店铺打卡活动、11 个打卡点、1 次活动投放和 11 个点投放；19 条主图/奖励图资源引用逐项一致。保留了点投放 UUID、坐标和启停。未创建弹幕活动或虚构打卡记录。

文字 Asset、文字投放、文字资源/标签、全部地图、全部场景、非活动投放及非 shop 素材的转换前后 SHA-256 完全相同。最终副本还在数据库只读模式下通过真实 `getActivity`、`listActivityPlacements` 服务读取：1 场活动、1 次投放、11 个点均可管理，投放配置通过实际严格解析器。迁移业务配置只包含允许的活动字段，来源信息保存在地图关联和迁移归档中。

私有最终证据位于同一备份目录的 `activity-audit-final.json`、`activity-review.json`、`activity-rehearsal-before-final.json`、`activity-rehearsal-report-final.json`。该确认仅覆盖这些精确源记录；正式停写后的新备份仍须重新核对。

## 2026-10-28 第一阶段：本地开发库修复

`localhost:3000` 的开发服务使用 `localhost:55432/sanlin`。此前仅升级了隔离演练库，该开发库尚缺活动迁移，访问活动列表时出现 PostgreSQL `42P01: relation "activity" does not exist`。现已对该本地库单独备份并执行活动迁移，生产数据库未修改。

本地 preflight 有 900 条待审核文字。与此前已确认备份共同的 899 条正文、投放身份/归属/坐标/配置、资源、标签和场景引用一致，仅历史迁移时间不同，因此旧审核指纹不可复用。额外一条是已有普通地图投放的本地存量文字。重新核对后生成本地专用的 900 条 keep 审核，全部原样保留为 Asset。

备份位于 `.local-db-backups/activity-local-fix-20261028/before-activities.dump`，已在隔离数据库中完整还原验证。相同目录保留私有 preflight、审核、迁移前快照和 `verification.json`。迁移后有 1 场活动、11 个打卡点、1 次活动投放、11 个点投放；900 条文字和 893 条文字投放保留，19 条图片资源引用一致，八组普通内容指纹不变。真实 `listActivities` / `listActivityPlacements`、3000 公开活动接口及数据库部署门禁均通过。

## 2026-10-28 第二阶段：开发库迁移与生产备份副本演练

开发库 `localhost:55432/sanlin` 的第二阶段完整备份位于 `.local-db-backups/activity-owned-locations-20261028/before-owned-locations.dump`，已在独立的 55439 数据库中完整还原验证。迁移前为 2 场活动、11 个打卡点、1 条地图关联；只读预检未发现冲突。先在恢复副本上验证迁移，再升级开发库并重新生成数据库类型。迁移后 11 个点的 ID 和坐标逐一保留，九张普通数据表的 SHA-256 不变，`/tmp/activity-owned-locations-local-control.cjs verify` 已通过。恢复副本的私有比对报告保存在同一备份目录的 `activity-owned-locations-rehearsal-report.json`，权限为 0600。

生产备份的第二阶段验证没有直接修改历史证据库 `content_activity_production_rehearsal_final`。只读确认其第一阶段结果后，经 Docker `pg_dump` / `pg_restore` 复制到新建的随机测试库，在新副本执行最新迁移及部署门禁。899 条普通文字、19 项主图/奖励图资源引用、11 个打卡点的定义、ID 和坐标均保持一致；活动及地图关联的身份和状态保留，参与记录、普通内容及既有来源归档的指纹不变，旧点投放行完整进入第二阶段归档。

第二阶段演练完成后再次核对历史证据库，确认其结构和数据未改变；新建的随机测试副本已删除。私有结果保存在 `.local-db-backups/activity-owned-locations-20261028/activity-owned-locations-production-rehearsal-report.json`，权限为 0600。报告保存后，开发备份验证库 `content_activity_owned_backup_check_20261028` 亦已清理，完整备份文件继续保留。这些操作只涉及本地开发库及备份副本，生产数据库未修改；正式生产切换仍须对停写后的最新备份重新执行两阶段检查。

## 2026-10-29：生产数据库切换

生产已成功应用 `20261028000000_independent_activities.sql` 和 `20261028010000_activity_owned_locations.sql`。本节记录数据库迁移结果；Web 部署状态另见[线上部署说明](production-deployment.md)。

停止旧应用写入后取得新的完整备份，服务器路径为 `/opt/sanlin/backups/pre-migrate-20261029-2cf5961.dump`，本地副本为 `.local-db-backups/release-20261029-2cf5961/pre-migrate.dump`。两份备份的 SHA-256 均为 `27881d0d19a4233156db39061229d9ad86b5704f60c862bdec4af84d1e3ce500`。最终恢复副本 `release_20261029_final` 的迁移前快照与停写后的生产快照一致；899 条历史文字的审核源指纹与原已确认记录逐条精确匹配，因此复用原审核，全部保留为普通 Asset。

本次从提交 `2cf5961` 的原迁移入口及依赖打包便携 Node 22 产物，SQL 与审核文件原样复制，保留原迁移锁、审核、事务和账本逻辑。打包只调整源码模块 URL 的定位，使活动预检读取正确的迁移 SQL，并保持导入的 audit 模块不触发独立命令入口。该同一产物先在最终恢复副本完成两阶段迁移与验证，再在服务器临时 Node 22 容器执行，两项迁移均成功。传输此类产物时需排除 macOS `._*` 附属文件，防止额外的 `._*.sql` 被迁移器扫描。

最终副本的 `final-report.json` 与生产的 `production-report.json` 均通过全部 31 项检查：

- 899 条普通文字全部保留；文字、普通素材、投放、资源、标签、地图、场景及场景资源引用共 12 组指纹不变。
- 11 个旧店铺转换为 1 场活动、11 个打卡点和 1 条地图关联；参与记录为 0，未补造历史记录。旧投放 UUID、位置、启停及展示信息完整归档，新活动、点和关联在第二阶段的身份、坐标和状态符合迁移规则。
- 19 项主图与奖励图资源引用逐项保留，原素材 ID、奖励图绑定及存储保留检查通过。
- 第一阶段来源归档有 182 行，第二阶段归档有 24 行；源记录完整性、迁移账本及只读部署门禁全部通过。

服务器 `.env` 未修改，未删除 OSS 物理文件。备份、审核文件、快照、报告、迁移日志及产物清单位于上述私有备份目录，不提交 Git；恢复仍遵循本手册的停写和完整备份流程。

小程序代码此次仅推送到 Git，尚未通过微信发布。新活动接口及演出播放协议 schema 7 仍须配套发布新客户端；旧播放器无法加载包含音视频、空间文字或出入场参数的 schema 7 场景。

## 自动验证

- `scripts/test-activity-migration.ts` 在全新 55439 专用数据库验证从旧 Asset 到独立活动、再到活动固定地点的两阶段完整升级。覆盖来源审核、过期/缺漏审核拒绝、失败回滚、多个点分组、媒体与普通文字保留、稳定身份、复合外键、重复提交/打卡唯一性；第二阶段再次核对点位置、记录和图片资源不变，以及旧关系完整归档。
- `scripts/test-activity-owned-locations-migration.ts` 自动创建并清理随机 55439 测试库，覆盖第二阶段的 11 组冲突与原子回滚用例，以及默认规则与投放覆盖归并、空点位置收敛、缺失/禁用点处理、完整参与区域、包含归档状态的唯一地图关联、记录与素材保留、外键隔离、清理函数和迁移重跑。
- `scripts/test-deployment-check.ts` 验证最新新库基线、重复迁移、账本与结构检查。缺少 `activity_point.location`、仍存在旧点投放表或投放位置/范围/配置列，以及残留未迁移 shop 或公开投稿 Asset，均阻止部署。

以上三项均接入既有 `database-migrations` CI job，分别覆盖完整升级链路、第二阶段冲突与保留规则、新库与部署门禁。服务、路由、小程序与 UI 验证按[贡献指南](../CONTRIBUTING.md)及对应活动模块测试执行。
