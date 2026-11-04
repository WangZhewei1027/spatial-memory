# 文档索引

这里保留当前 Web 平台的工程与运维说明。开发启动见 [项目 README](../README.md)，工程约束见 [AGENTS](../AGENTS.md)。文档中的运行状态和验收结果仅代表其标注时点；发布前按实际环境重新核对。

工程规范与审查依据见 [CODING_STANDARDS.md](../CODING_STANDARDS.md)；自动检查、Git hooks、CI 和测试分类见 [CONTRIBUTING.md](../CONTRIBUTING.md)。

## 领域与架构决策

- [项目名称](project-identity.md)：仓库、包、CLI 名称与既有数据和部署的兼容标识。
- [领域术语表](../GLOSSARY.md)：团队、地图合集、素材、活动、打卡点、活动投放和活动记录。
- [活动独立与多地图投放](adr/0001-independent-activities.md)：活动定义、投放和参与记录的独立关系。

## 内容与接口

| 文档 | 负责的内容 |
| --- | --- |
| [团队工作台](team-workbench.md) | 页面入口、团队上下文、前端数据流 |
| [后端契约](team-workbench-backend-contract.md) | 内容 API、DTO、并发控制与事务 |
| [权限](permissions.md) | 角色、能力、归档和邀请规则 |
| [数据层与认证](data-layer.md) | 数据库访问、会话与存储适配 |
| [素材流水线](asset-pipeline.md) | 预处理、上传回执、素材编辑与音频边界 |
| [视频与模型缩略图](asset-thumbnails.md) | 服务端派生图片、资源引用与历史补全 |
| [文件生命周期](asset-storage-lifecycle.md) | 文件复用、租约、保留和回收 |
| [Scene](scene-asset.md) | 场景文档、编辑、播放协议与验证入口 |
| [本地 Agent 编排](scene-agent.md) | CLI 素材导入、草稿、编排、截图与保存 |
| [地图交互](map-asset-interaction.md) | Placement、Cesium 消息与拖动保存 |
| [匹配点](anchor-matching.md) | 图片识别、参考特征、限流和诊断 |
| [小程序 API](miniapp-api.md) | 匿名读取、发现与播放 |
| [微信二维码](wechat-qr-code.md) | 入口参数、环境切换与缓存 |
| [文字样式](text-asset-miniapp-style.md) | 团队配置在小程序端的展示 |

共享实现：[Scene Core](../packages/scene-core/README.md) 负责播放与采样；[Scene Authoring](../packages/scene-authoring/README.md) 负责协议、校验与编排；[Scene Renderer](../packages/scene-renderer/README.md) 负责本地浏览器截图和素材探测。CLI 浏览器授权见[数据层与认证](data-layer.md#cli-browser-sign-in)。

## 界面开发

- [设计系统](design-system.md)：主题、排版和组件规则。
- [UI 分层](ui/architecture.md)：组件、业务功能和页面职责。
- [国际化](i18n-guide.md)：中英文文案与语言切换。
- [3D 模型预览](3d-model-preview.md)：素材预览组件与资源加载。

## 运维与迁移

- [线上部署](production-deployment.md)：服务关系、发布、备份和巡检。
- [活动迁移](activity-migration-runbook.md)：店铺多点活动、历史文字审核、备份副本演练和配套发布。
- [数据库迁移](content-model-migration-runbook.md)：升级、数据保留、逐条审核和回滚。
- [pgAdmin](pgadmin.md)：运维访问、角色、配置和恢复。
- [Google 中转](google-auth-relay.md)：独立函数部署、密钥和验证。
- [生产身份迁移记录](spatial-memory-migration.md)：2026-11-01 的切换证据、恢复材料与边界。
- [Web 发布历史](history/web-releases.md)：按日期保留的镜像、CI 和部署验收记录。

## Agent 工作流

- [GitHub Issues](agents/issue-tracker.md)：需求、规格和实现任务。
- [分流标签](agents/triage-labels.md)：五类标准标签。
- [领域文档](agents/domain.md)：术语表和架构决策的阅读与维护约定。
