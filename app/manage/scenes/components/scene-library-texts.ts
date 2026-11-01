import { ERROR_TEXTS } from "../../lib/content-errors";
import type { IntegrationTexts } from "../../lib/integration-text";

export const SCENE_LIBRARY_TEXTS: IntegrationTexts = {
  ...ERROR_TEXTS,
  "contentModel.integration.sceneLibrary.label": ["素材库", "Asset library"],
  "contentModel.integration.sceneLibrary.search": ["搜索素材…", "Search assets…"],
  "contentModel.integration.sceneLibrary.add": ["添加 {{name}}", "Add {{name}}"],
  "contentModel.integration.sceneLibrary.drag": ["拖入舞台或时间轴；点击 + 或双击添加", "Drag onto the stage or timeline; click + or double-click to add"],
  "contentModel.integration.sceneLibrary.loadMore": ["加载更多", "Load more"],
  "contentModel.integration.sceneLibrary.emptyTeam": ["没有可用素材，导入后团队即可复用。", "No assets here yet. Import to share with your team."],
  "contentModel.integration.sceneLibrary.noResults": ["没有匹配的素材", "No matching assets"],
  "contentModel.integration.sceneLibrary.missing": ["文件缺失", "File missing"],
  "contentModel.integration.sceneLibrary.retry": ["重新加载", "Try again"],
  "contentModel.integration.sceneLibrary.loading": ["正在加载素材…", "Loading assets…"],
  "contentModel.integration.sceneLibrary.limit": ["场景对象数量已达上限。移除对象后可继续添加。", "This scene is at its object limit. Remove an object to add another."],
};
