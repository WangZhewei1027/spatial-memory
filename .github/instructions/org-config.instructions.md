# 团队与地图配置

修改配置前先确定作用域：团队拥有内容与成员，地图合集拥有自己的小程序显示和识别设置。

- 小程序识别方式、文本样式、彩带、水印保存在 `workspace.miniapp_config`。扩展时遵循[小程序 API](../../docs/miniapp-api.md#每个地图合集的小程序设置)和[合集写入契约](../../docs/team-workbench-backend-contract.md#consistency)，同步服务端解析、数据库约束、地图设置弹窗、中英文文案及小程序消费者。
- 团队设置表单位于 `components/org-settings/`，由 `/admin/settings` 与超级管理员团队详情共用；新增团队字段需同步两条服务端写入路径的验证与授权。`organization.config` 是内部元数据，公开的 `/api/miniapp/organizations` 只返回名称。
- 历史团队显示值由数据库迁移一次性复制到各地图；之后读取和保存以地图为准，旧组织 JSON 仅作回滚依据。

完成条件：受影响的权限、归档、并发和跨地图隔离测试通过，公开接口只返回约定字段。运行[贡献指南](../../CONTRIBUTING.md)中的默认检查、相关真实数据库测试和 UI 回归；小程序改动在其独立仓库验证并记录配套发布顺序。
