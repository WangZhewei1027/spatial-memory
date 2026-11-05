import { ERROR_TEXTS } from "@/app/manage/lib/content-errors";
import type { IntegrationTexts } from "@/app/manage/lib/integration-text";

/**
 * zh/en fallbacks for every string the asset pages render through `tx`. The
 * locale files win once they carry these keys (see integration-text.ts).
 */
export const ASSET_TEXTS: IntegrationTexts = {
  ...ERROR_TEXTS,
  // Library
  "contentModel.integration.assets.unknownOrganization": ["当前团队", "Current team"],
  "contentModel.integration.assets.endpointMissing": ["素材服务尚未就绪，请稍后再试。", "The asset service is not available yet. Try again later."],
  "contentModel.integration.assets.created": ["已上传“{{name}}”", "Uploaded “{{name}}”"],
  "contentModel.integration.assets.open": ["打开", "Open"],
  // Create dialog
  "contentModel.integration.assets.create.title": ["上传素材", "Upload asset"],
  "contentModel.integration.assets.create.body": [
    "素材属于团队“{{team}}”，团队所有成员都能查看，成员及以上角色可以在场景和地图合集中使用。上传不会自动放到地图上。",
    "The asset belongs to the team “{{team}}”: everyone on the team can view it, and members and above can use it in scenes and map collections. Nothing is placed on a map.",
  ],
  "contentModel.integration.assets.create.type": ["类型", "Type"],
  "contentModel.integration.assets.create.name": ["名称", "Name"],
  "contentModel.integration.assets.create.file": ["文件", "File"],
  "contentModel.integration.assets.create.text": ["文字内容", "Text"],
  "contentModel.integration.assets.create.url": ["链接地址", "Link"],
  "contentModel.integration.assets.create.urlHint": ["支持网址或 iframe 嵌入代码。", "A web address or an iframe embed code."],
  "contentModel.integration.assets.create.submit": ["上传", "Upload"],
  "contentModel.integration.assets.create.retry": ["重试", "Retry"],
  "contentModel.integration.assets.create.cancel": ["取消", "Cancel"],
  "contentModel.integration.assets.create.preparing": ["正在处理文件…", "Processing file…"],
  "contentModel.integration.assets.create.uploading": ["正在上传…", "Uploading…"],
  "contentModel.integration.assets.create.creating": ["正在创建素材…", "Creating asset…"],
  // Detail
  "contentModel.integration.assetDetail.back": ["返回基础素材", "Back to assets"],
  "contentModel.integration.assetDetail.rename": ["重命名", "Rename"],
  "contentModel.integration.assetDetail.renameTitle": ["重命名素材", "Rename asset"],
  "contentModel.integration.assetDetail.renameBody": ["新名称在整个团队同步显示，已有引用不受影响。", "The new name shows across the team; existing references are unaffected."],
  "contentModel.integration.assetDetail.name": ["名称", "Name"],
  "contentModel.integration.assetDetail.save": ["保存", "Save"],
  "contentModel.integration.assetDetail.cancel": ["取消", "Cancel"],
  "contentModel.integration.assetDetail.duplicate": ["另存素材副本", "Save as copy"],
  "contentModel.integration.assetDetail.duplicateBody": [
    "副本是团队里的一个新素材，独立保存内容；原素材及其引用保持不变。",
    "The copy is a new team asset with independent content; the original and its references stay unchanged.",
  ],
  "contentModel.integration.assetDetail.duplicateName": ["{{name}} 副本", "{{name}} copy"],
  "contentModel.integration.assetDetail.duplicateAction": ["保存副本", "Save copy"],
  "contentModel.integration.assetDetail.notFound": ["素材不存在，或已不在你可访问的范围内。", "The asset does not exist or is no longer available to you."],
  "contentModel.integration.assetDetail.forbidden": ["你没有查看该素材的权限。", "You do not have access to this asset."],
  "contentModel.integration.assetDetail.archivedTitle": ["素材已归档", "Asset archived"],
  "contentModel.integration.assetDetail.archivedImpact": ["以下引用会继续使用该素材：", "These references continue to use this asset:"],
  "contentModel.integration.assetDetail.archivedNoImpact": ["目前没有引用。", "Nothing references it."],
  "contentModel.integration.assetDetail.refreshFailed": ["刷新失败，页面显示的可能不是最新数据。", "Refresh failed; this page may not show the latest data."],
  "contentModel.integration.assetDetail.dismiss": ["关闭", "Dismiss"],
  "contentModel.integration.assetDetail.text": ["文字内容", "Text"],
  "contentModel.integration.assetDetail.link": ["链接", "Link"],
};
