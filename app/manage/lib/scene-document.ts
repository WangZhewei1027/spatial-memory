/** Pinned scene document helpers for the editor. */
import type { ModelAnimationInfo, SceneDocumentJson, AssetRef } from "@/lib/content-model/contracts";
import type { CompositionContent, InstanceAnimation } from "@/lib/scene/protocol";
import { parseSceneDocument } from "@/lib/scene/validate";

export interface EditorAssetRef {
  assetId: string;
}

export interface EditorDefinition {
  schemaVersion: 6;
  content: Omit<CompositionContent, "assets"> & { assets: Record<string, EditorAssetRef> };
}

/** Validate the scene document and give animated content a finite duration. */
export function normalizeDefinition(next: EditorDefinition): EditorDefinition {
  return parseSceneDocument(next);
}

export function fromDocument(document: SceneDocumentJson): EditorDefinition {
  const definition: EditorDefinition = {
    schemaVersion: 6,
    content: { ...(document.content as unknown as CompositionContent), assets: { ...document.content.assets } },
  };
  return normalizeDefinition(definition);
}

export function toDocument(definition: EditorDefinition): SceneDocumentJson {
  const assets: Record<string, AssetRef> = {};
  for (const [alias, ref] of Object.entries(definition.content.assets)) {
    assets[alias] = { assetId: ref.assetId };
  }
  const { kind, units, durationSeconds, loop, instances, groups, viewerPosition, lighting } = definition.content;
  return { schemaVersion: 6, content: { kind, units, durationSeconds, loop, assets, instances, ...(groups?.length ? { groups } : {}), ...(lighting ? { lighting: { ...lighting } } : {}), ...(viewerPosition ? { viewerPosition: [...viewerPosition] } : {}) } };
}

/** Imports use the same asset-reference schema as saved drafts. */
export function readSceneImport(text: string): SceneDocumentJson {
  return toDocument(fromDocument(parseSceneDocument(JSON.parse(text))));
}

export function newAlias() {
  return `m${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

/** Name of the clip the animation needs that `animations` does not provide, or null when compatible. */
export function missingClip(animation: InstanceAnimation | null | undefined, animations: ModelAnimationInfo[] | undefined): string | null {
  if (!animation || !animations) return null;
  if (animation.clipIndex !== undefined) {
    return animations.some((clip) => clip.index === animation.clipIndex) ? null : `#${animation.clipIndex + 1}`;
  }
  if (animation.clipName !== undefined) {
    return animations.filter((clip) => clip.name === animation.clipName).length === 1 ? null : animation.clipName;
  }
  return null;
}
