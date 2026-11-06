import type { ScenePosition } from "@/lib/scene/editor-interactions";
import { type CompositionInstance } from "@/lib/scene/protocol";
import { missingClip, newAlias, type EditorAssetRef, type EditorDefinition } from "../../lib/scene-document";
import type { SceneResource } from "./types";

type Content = EditorDefinition["content"];
export type ModelAddFailure = "archived" | "missing";
export type AssetReplaceFailure = ModelAddFailure | "kind";

function firstAnimation(resource: SceneResource | undefined, startSeconds: number) {
  const first = resource?.animations?.[0];
  return first && (resource.kind ?? "model") === "model" ? { clipIndex: first.index, startSeconds, loop: true } : null;
}

/** Resources are keyed by asset ID; repeated instances share the same current content. */
export function resourceKey(ref: EditorAssetRef | undefined) {
  return ref?.assetId ?? "";
}

/** Reuses the alias of `key`, or references `resource` under a new alias. */
function assetAlias(content: Content, key: string, resource: SceneResource | undefined, createAlias: () => string):
  { ok: true; alias: string; assets: Content["assets"] } | { ok: false; reason: ModelAddFailure } {
  if (!key) return { ok: false, reason: "missing" };
  const alias = Object.keys(content.assets).find((name) => resourceKey(content.assets[name]) === key);
  if (alias) return { ok: true, alias, assets: content.assets };
  if (!resource || resource.assetId !== key || !resource.url) return { ok: false, reason: "missing" };
  if (resource.assetState === "archived") return { ok: false, reason: "archived" };
  const created = createAlias();
  return { ok: true, alias: created, assets: { ...content.assets, [created]: { assetId: resource.assetId } } };
}

/**
 * Adds one instance of `key` (asset ID).
 * Instances of the same key share one alias. A new alias references
 * `resource`, which the caller passes explicitly: a model picked in the
 * library may not be in the editor's registered resources yet.
 */
export function addModelInstance(content: Content, { key, resource, id, position, startSeconds = 0, createAlias = newAlias }: {
  key: string; resource: SceneResource | undefined; id: string; position: ScenePosition; startSeconds?: number; createAlias?: () => string;
}): { ok: true; content: Content } | { ok: false; reason: ModelAddFailure } {
  const target = assetAlias(content, key, resource, createAlias);
  if (!target.ok) return target;
  const added: CompositionInstance = { id, asset: target.alias, position, rotation: [0, 0, 0], scale: [1, 1, 1], animation: firstAnimation(resource, startSeconds) };
  return { ok: true, content: { ...content, instances: [...content.instances, added], assets: target.assets } };
}

/**
 * Points instance `id` at asset `key` of the same kind, keeping its name, timing, transforms,
 * keyframes, grouping and media settings. Source-specific settings the new file cannot honour
 * (a missing animation clip, trims past its end) are reset; an alias left unused is removed.
 */
export function replaceInstanceAsset(content: Content, { id, key, resource, from, createAlias = newAlias }: {
  id: string; key: string; resource: SceneResource | undefined; from: SceneResource | undefined; createAlias?: () => string;
}): { ok: true; content: Content } | { ok: false; reason: AssetReplaceFailure } {
  const instance = content.instances.find((item) => item.id === id);
  if (!instance || instance.text || !instance.asset) return { ok: false, reason: "missing" };
  if (resourceKey(content.assets[instance.asset]) === key) return { ok: true, content };
  if (!resource || resource.assetId !== key) return { ok: false, reason: "missing" };
  if ((resource.kind ?? "model") !== (from?.kind ?? "model")) return { ok: false, reason: "kind" };
  const target = assetAlias(content, key, resource, createAlias);
  if (!target.ok) return target;
  const replaced: CompositionInstance = { ...instance, asset: target.alias };
  if (!replaced.animation || missingClip(replaced.animation, resource.animations)) {
    replaced.animation = firstAnimation(resource, instance.timing?.startSeconds ?? 0);
  }
  const length = resource.durationSeconds;
  if (replaced.media && length) {
    const media = { ...replaced.media };
    if (media.trimStartSeconds >= length) { media.trimStartSeconds = 0; media.trimEndSeconds = null; }
    else if (media.trimEndSeconds !== null && media.trimEndSeconds > length) media.trimEndSeconds = null;
    replaced.media = media;
  }
  const instances = content.instances.map((item) => item.id === id ? replaced : item);
  const assets = { ...target.assets };
  if (!instances.some((item) => item.asset === instance.asset)) delete assets[instance.asset];
  return { ok: true, content: { ...content, instances, assets } };
}
