# 小程序文字素材样式

`workspace.miniapp_config.text_asset_miniapp_style` 控制当前地图的普通文字素材及弹幕显示。`plain_white` 使用纯白文字，`dialog_decorated` 使用气泡，新地图默认气泡。完整配置、历史值迁移和跨端发布顺序见[小程序接口](miniapp-api.md#每个地图合集的小程序设置)。

地图 navbar 的“设置”弹窗通过 `PATCH /api/collections/[id]` 保存完整配置并携带并发锁版本，团队写入者可修改未归档地图。团队设置和超级管理员团队详情不再维护文字样式。

扩展样式时，同步修改 `lib/content-model/collection-config.ts` 的类型与严格解析、新数据库迁移中的 CHECK 约束、弹窗选项及 `collectionSettings.styles` 中英文文案。小程序独立仓库同步更新 `utils/map-config.ts` 校验和渲染分支；配置成功加载后才可启动 AR，独立 Scene 预览保持自己的样式行为。
