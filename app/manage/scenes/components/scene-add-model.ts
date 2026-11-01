import type { ScenePosition } from "@/lib/scene/editor-interactions";
import { type CompositionInstance } from "@/lib/scene/protocol";
import { newAlias, type EditorAssetRef, type EditorDefinition } from "../../lib/scene-document";
import type { SceneResource } from "./types";

type Content = EditorDefinition["content"];
export type ModelAddFailure = "archived" | "missing";

/** Resources are keyed by asset ID; repeated instances share the same current content. */
export function resourceKey(ref: EditorAssetRef | undefined) {
  return ref?.assetId ?? "";
}

/**
 * Adds one instance of `key` (asset ID).
 * Instances of the same key share one alias. A new alias references
 * `resource`, which the caller passes explicitly: a model picked in the
 * library may not be in the editor's registered resources yet.
 */
export function addModelInstance(content: Content, { key, resource, id, position, createAlias = newAlias }: {
  key: string; resource: SceneResource | undefined; id: string; position: ScenePosition; createAlias?: () => string;
}): { ok: true; content: Content } | { ok: false; reason: ModelAddFailure } {
  if (!key) return { ok: false, reason: "missing" };
  let alias = Object.keys(content.assets).find((name) => resourceKey(content.assets[name]) === key);
  let assets = content.assets;
  if (!alias) {
    if (!resource || resource.assetId !== key || !resource.url) return { ok: false, reason: "missing" };
    if (resource.assetState === "archived") return { ok: false, reason: "archived" };
    const ref: EditorAssetRef = { assetId: resource.assetId };
    alias = createAlias();
    assets = { ...assets, [alias]: ref };
  }
  const added: CompositionInstance = { id, asset: alias, position, rotation: [0, 0, 0], scale: [1, 1, 1], animation: null };
  return { ok: true, content: { ...content, instances: [...content.instances, added], assets } };
}
