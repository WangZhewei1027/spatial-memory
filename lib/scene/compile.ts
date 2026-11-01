import type { ModelAnimationInfo } from "@/lib/content-model/contracts";
import { compileVisibility } from "./visibility";
import { SCENE_FLAT_SCHEMA_VERSION, SCENE_SCHEMA_VERSION, SCENE_PERFORMANCE_SCHEMA_VERSION, SCENE_AUTOMATION_SCHEMA_VERSION, isSceneResourceKind, type SceneAssetManifest, type SceneDocument } from "./protocol";

/**
 * Preserve schema 4/5 for old model scenes; presentation timing, media and text
 * require schema 7 so an older player rejects before trying to load a media file as GLB.
 */
export function compileSceneManifest(
  publicId: string,
  document: SceneDocument,
  resources: SceneAssetManifest["resources"],
): SceneAssetManifest {
  const assets: Record<string, { assetId: string }> = {};
  for (const [alias, ref] of Object.entries(document.content.assets)) {
    if (!resources[alias]) throw new Error(`scene resource ${alias} is not resolved`);
    assets[alias] = { assetId: ref.assetId };
  }
  const content = compileVisibility({ ...document.content, assets });
  const automation = content.instances.some(instance => instance.opacity !== undefined || instance.tracks?.opacity || instance.tracks?.volume || instance.media?.spatial);
  const performance = document.content.instances.some(instance => instance.text || instance.timing || instance.media)
    || Object.values(resources).some(resource => resource.kind && resource.kind !== "model");
  return {
    assetId: publicId,
    schemaVersion: automation ? SCENE_AUTOMATION_SCHEMA_VERSION : performance ? SCENE_PERFORMANCE_SCHEMA_VERSION : document.content.groups?.length ? SCENE_SCHEMA_VERSION : SCENE_FLAT_SCHEMA_VERSION,
    content: flatten(content),
    resources,
  };
}

/**
 * Animation clips unavailable in current asset content (
 * block the save instead of silently dropping the animation). Assets with
 * an unknown clip list are not checked here; the player still verifies.
 */
export function clipIssues(
  document: { content: { instances: Pick<SceneDocument["content"]["instances"][number], "asset" | "animation">[] } },
  animationsByAlias: Record<string, ModelAnimationInfo[] | undefined>,
): { path: string; message: string }[] {
  const issues: { path: string; message: string }[] = [];
  document.content.instances.forEach((instance, index) => {
    const animation = instance.animation;
    const known = instance.asset ? animationsByAlias[instance.asset] : undefined;
    if (!animation || !known) return;
    const path = `content.instances[${index}].animation`;
    if (animation.clipName !== undefined) {
      const matches = known.filter((clip) => clip.name === animation.clipName).length;
      if (matches === 0) issues.push({ path, message: `素材没有动画 "${animation.clipName}"` });
      else if (matches > 1) issues.push({ path, message: `动画名 "${animation.clipName}" 在素材中不唯一，请改用序号` });
    } else if (animation.clipIndex !== undefined && !known.some((clip) => clip.index === animation.clipIndex)) {
      issues.push({ path, message: `素材没有第 ${animation.clipIndex} 个动画` });
    }
  });
  return issues;
}

/** Asset kind comes from authorized current content, never from client claims. */
export function resourceKindIssues(document: SceneDocument, kinds: Record<string, string>): { path: string; message: string }[] {
  const issues: { path: string; message: string }[] = [];
  for (const [alias, kind] of Object.entries(kinds)) {
    if (!isSceneResourceKind(kind)) issues.push({ path: `content.assets.${alias}`, message: "场景支持模型、图片、音频和视频素材；空间文字应在场景中创建" });
  }
  document.content.instances.forEach((instance, index) => {
    if (!instance.asset) return;
    const kind = kinds[instance.asset], path = `content.instances[${index}]`;
    if (instance.animation && kind !== "model") issues.push({ path: `${path}.animation`, message: "只有模型素材可以使用模型动画" });
    if (instance.tracks?.volume && kind !== "audio" && kind !== "video") issues.push({ path: `${path}.tracks.volume`, message: "只有音频和视频可以使用音量关键帧" });
    if (instance.media && kind !== "audio" && kind !== "video") issues.push({ path: `${path}.media`, message: "只有音频和视频可以使用媒体播放参数" });
  });
  return issues;
}

/** An empty group list compiles to the flat format; it never reaches a flat manifest. */
function flatten<T extends { groups?: unknown[] }>(content: T): T {
  if (content.groups?.length) return content;
  const { groups: _groups, ...rest } = content;
  return rest as T;
}
